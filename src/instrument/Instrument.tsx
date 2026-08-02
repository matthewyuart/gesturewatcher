import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
import { SynthEngine, type SynthParams, type WaveKind } from '../audio/SynthEngine';
import { DrumMachine, GENRES, type GenreId } from '../audio/DrumMachine';
import {
  buildChordNotes,
  CHORD_QUALITIES,
  chordName,
  midiName,
  midiToFreq,
  NOTE_NAMES,
  quality,
  type ChordSlot,
  type QualityId,
} from '../audio/theory';
import { Knob } from './Knob';
import { TechScope } from './TechScope';
import { StaffChord } from './StaffChord';
import { VideoBackdrop } from '../components/VideoBackdrop';
import './Instrument.css';

type Claim =
  | { type: 'knob'; param: keyof SynthParams; startY: number; startVal: number; startRoll: number; twist: boolean }
  | { type: 'chordSlot'; slot: number }
  | { type: 'bpmbar' }
  | { type: 'pressed' };

type SheetId = 'beat' | 'chords' | 'tone';

const WAVES: WaveKind[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_LABEL: Record<WaveKind, string> = {
  sawtooth: 'saw',
  square: 'sqr',
  triangle: 'tri',
  sine: 'sin',
};
const KNOB_ORDER: Array<{ param: keyof SynthParams; label: string }> = [
  { param: 'cutoff', label: 'filter' },
  { param: 'resonance', label: 'res' },
  { param: 'attack', label: 'attack' },
  { param: 'release', label: 'release' },
  { param: 'echo', label: 'echo' },
  { param: 'volume', label: 'volume' },
];
const FINGER_LABEL = ['thumb+index', 'thumb+middle', 'thumb+ring', 'thumb+pinky'];
const SHEETS: Array<{ id: SheetId; label: string }> = [
  { id: 'beat', label: 'beat' },
  { id: 'chords', label: 'chords' },
  { id: 'tone', label: 'tone' },
];

const CHORD_OCTAVE = 3;

function slot(root: number, q: QualityId): ChordSlot {
  return { root, quality: q, notes: buildChordNotes(root, q, CHORD_OCTAVE) };
}

/** Common progressions (after Berklee's list), city pop's royal road first. */
const PROGRESSIONS: Array<{ id: string; label: string; sub: string; slots: ChordSlot[] }> = [
  { id: 'citypop', label: 'city pop', sub: 'ivmaj7–v7–iii7–vi7', slots: [slot(5, 'maj7'), slot(7, 'dom7'), slot(4, 'min7'), slot(9, 'min7')] },
  { id: 'pop', label: 'pop', sub: 'i–v–vi–iv', slots: [slot(0, 'maj'), slot(7, 'maj'), slot(9, 'min'), slot(5, 'maj')] },
  { id: 'doowop', label: '50s', sub: 'i–vi–iv–v', slots: [slot(0, 'maj'), slot(9, 'min'), slot(5, 'maj'), slot(7, 'maj')] },
  { id: 'jazz', label: 'jazz', sub: 'ii7–v7–imaj7–vi7', slots: [slot(2, 'min7'), slot(7, 'dom7'), slot(0, 'maj7'), slot(9, 'min7')] },
  { id: 'andalusian', label: 'andalusian', sub: 'i–bvii–bvi–v7', slots: [slot(9, 'min'), slot(7, 'maj'), slot(5, 'maj'), slot(4, 'dom7')] },
  { id: 'blues', label: 'blues', sub: 'i7–iv7–v7–i7', slots: [slot(0, 'dom7'), slot(5, 'dom7'), slot(7, 'dom7'), slot(0, 'dom7')] },
];

/** Displacement map for the glass filter: R encodes x, G encodes y. */
const GLASS_MAP =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><defs><linearGradient id='x' x1='0' x2='1' y1='0' y2='0'><stop offset='0' stop-color='%23000000'/><stop offset='1' stop-color='%23ff0000'/></linearGradient><linearGradient id='y' x1='0' x2='0' y1='0' y2='1'><stop offset='0' stop-color='%23000000'/><stop offset='1' stop-color='%2300ff00'/></linearGradient></defs><rect width='64' height='64' fill='url(%23x)'/><rect width='64' height='64' fill='url(%23y)' style='mix-blend-mode:screen'/></svg>";

const TWIST_FULL = (Math.PI * 3) / 4;
const BPM_MIN = 60;
const BPM_MAX = 180;
/** Fixed chromatic ruler: 2 octaves + 1, anchored at C — never moves. */
const RULER_SPAN = 25;
/** Piano editor range: C3..C5 inclusive. */
const PIANO_LO = 48;
const PIANO_SPAN = 25;
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const WHITE_SET = new Set(WHITE_PCS);
const BLACK_SET = new Set([1, 3, 6, 8, 10]);
const EMPTY_SET: Set<string> = new Set();

/** Nearest midi whose pitch class is in `set` (downward on ties). */
function snapToSet(midi: number, set: Set<number>): number {
  for (let d = 0; d <= 6; d++) {
    if (set.has((((midi - d) % 12) + 12) % 12)) return midi - d;
    if (set.has((((midi + d) % 12) + 12) % 12)) return midi + d;
  }
  return midi;
}

function inRect(el: Element | null, p: Point): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function normAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export default function Instrument() {
  const { frame, status, source, fps, setSource, videoEl } = useGestures();
  const engineRef = useRef<SynthEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SynthEngine();
  const engine = engineRef.current;
  const drumRef = useRef<DrumMachine | null>(null);

  const [audioOn, setAudioOn] = useState(false);
  const [params, setParams] = useState<SynthParams>({ ...engine.params });
  const [wave, setWaveState] = useState<WaveKind>('sawtooth');
  const [melodyOctave, setMelodyOctave] = useState(4);
  const [melodyMode, setMelodyMode] = useState<'auto' | 'free'>('free');
  const [melodyDegree, setMelodyDegree] = useState<number | null>(null);

  const [chordSlots, setChordSlots] = useState<ChordSlot[]>(PROGRESSIONS[0].slots);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [lastSlot, setLastSlot] = useState(0);
  const [editSlot, setEditSlot] = useState(0);

  const [openSheet, setOpenSheet] = useState<SheetId | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [drumPlaying, setDrumPlaying] = useState(false);
  const [genre, setGenre] = useState<GenreId>('citypop');
  const [bpm, setBpm] = useState(GENRES.citypop.bpm);
  const [shade, setShade] = useState(0.3);

  const claimsRef = useRef(new Map<number, Claim>());
  const controlsRef = useRef(new Map<string, HTMLElement>());
  const panelsRef = useRef(new Map<string, HTMLElement>());
  const prevTouchRef = useRef(new Map<number, boolean[]>());
  const activeChordRef = useRef<{ hand: number; finger: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rulerElRef = useRef<HTMLDivElement | null>(null);
  const rulerRectRef = useRef<{ t: number; r: DOMRect | null }>({ t: 0, r: null });

  // Adaptive shade: brighter scene -> more shade, so white ink always pops.
  useEffect(() => {
    if (source !== 'camera' || !videoEl) {
      setShade(0.25);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const sample = () => {
      if (videoEl.readyState < 2) return;
      try {
        ctx.drawImage(videoEl, 0, 0, 32, 18);
        const d = ctx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        }
        const luma = sum / (d.length / 4) / 255;
        const next = Math.min(0.74, Math.max(0.3, 0.26 + luma * 0.6));
        setShade((prev) => (Math.abs(prev - next) > 0.03 ? next : prev));
      } catch {
        // frame not ready — try again next tick
      }
    };
    sample();
    const id = window.setInterval(sample, 800);
    return () => window.clearInterval(id);
  }, [source, videoEl]);

  // Scale that fits the sounding (or last) chord. The ruler is a FIXED
  // chromatic ladder; AUTO mode only changes which rungs melody snaps to.
  const scaleInfo = useMemo(() => {
    const s = chordSlots[activeSlot ?? lastSlot];
    const q = quality(s.quality);
    return { root: s.root, steps: q.scaleSteps, name: q.scaleName };
  }, [chordSlots, activeSlot, lastSlot]);

  const stateRef = useRef({ scaleInfo, melodyOctave, melodyMode, chordSlots, source });
  stateRef.current = { scaleInfo, melodyOctave, melodyMode, chordSlots, source };

  // Bass follows the root of the sounding / last chord.
  useEffect(() => {
    drumRef.current?.setBassRoot(chordSlots[activeSlot ?? lastSlot].root);
  }, [chordSlots, activeSlot, lastSlot]);

  const controlRefFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const registerControl = useCallback((id: string) => {
    let fn = controlRefFns.current.get(id);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) controlsRef.current.set(id, el);
        else controlsRef.current.delete(id);
      };
      controlRefFns.current.set(id, fn);
    }
    return fn;
  }, []);
  const panelRefFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const registerPanel = useCallback((id: string) => {
    let fn = panelRefFns.current.get(id);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) panelsRef.current.set(id, el);
        else panelsRef.current.delete(id);
      };
      panelRefFns.current.set(id, fn);
    }
    return fn;
  }, []);

  const powerOn = useCallback(() => {
    void engine
      .start()
      .then(() => {
        setAudioOn(engine.isRunning);
        const bus = engine.getDrumBus();
        if (bus && !drumRef.current) {
          drumRef.current = new DrumMachine(bus.ctx, bus.dest);
          drumRef.current.setBassRoot(stateRef.current.chordSlots[0].root);
        }
      })
      .catch(() => setAudioOn(false));
  }, [engine]);

  const chordOnSlot = useCallback(
    (slotIdx: number) => {
      if (!engine.isRunning) return;
      const s = stateRef.current;
      engine.chordOn(s.chordSlots[slotIdx].notes.map(midiToFreq));
      drumRef.current?.setBassRoot(s.chordSlots[slotIdx].root);
      setActiveSlot(slotIdx);
      setLastSlot(slotIdx);
    },
    [engine],
  );
  const chordOffAll = useCallback(() => {
    engine.chordOff();
    setActiveSlot(null);
  }, [engine]);

  const rulerRect = useCallback((): DOMRect | null => {
    if (performance.now() - rulerRectRef.current.t > 1000) {
      rulerRectRef.current = {
        t: performance.now(),
        r: rulerElRef.current?.getBoundingClientRect() ?? null,
      };
    }
    return rulerRectRef.current.r;
  }, []);

  /**
   * Note for a melody finger at a horizontal position mapped across the
   * ruler strip (left = low). Fixed chromatic; the finger picks the snap:
   * index = white keys · middle = black keys · ring = slide (auto/free).
   * No bend — the displayed note is always the sounding note.
   */
  const melodyMidiFor = useCallback((finger: number, x: number): number => {
    const s = stateRef.current;
    const r = rulerRect();
    const xn = r
      ? Math.min(1, Math.max(0, (x - r.left) / r.width))
      : Math.min(1, Math.max(0, (x / window.innerWidth - 0.12) / 0.76));
    const midi = 12 * (s.melodyOctave + 1) + Math.round(xn * (RULER_SPAN - 1));
    if (finger === 0) return snapToSet(midi, WHITE_SET);
    if (finger === 1) return snapToSet(midi, BLACK_SET);
    if (s.melodyMode === 'free') return midi;
    const set = new Set(s.scaleInfo.steps.map((st) => (s.scaleInfo.root + st) % 12));
    return snapToSet(midi, set);
  }, [rulerRect]);

  const midiToDegree = useCallback((midi: number): number => {
    return midi - 12 * (stateRef.current.melodyOctave + 1);
  }, []);

  const xToBpm = useCallback((x: number): number => {
    const el = controlsRef.current.get('bpm:bar');
    if (!el) return bpm;
    const r = el.getBoundingClientRect();
    const xn = Math.min(1, Math.max(0, (x - r.left) / r.width));
    return Math.round(BPM_MIN + xn * (BPM_MAX - BPM_MIN));
  }, [bpm]);

  const applyBpm = useCallback((next: number) => {
    setBpm(() => {
      const v = Math.min(BPM_MAX, Math.max(BPM_MIN, next));
      drumRef.current?.setBpm(v);
      return v;
    });
  }, []);

  /** Button semantics shared by native clicks and camera pinches. */
  const pressButton = useCallback(
    (id: string) => {
      const drum = drumRef.current;
      if (id === 'power') {
        powerOn();
      } else if (id === 'tutorial') {
        setShowTutorial((v) => !v);
      } else if (id.startsWith('tab:')) {
        const sheet = id.slice(4) as SheetId;
        setOpenSheet((cur) => (cur === sheet ? null : sheet));
      } else if (id === 'mode') {
        setMelodyMode((m) => (m === 'auto' ? 'free' : 'auto'));
      } else if (id.startsWith('wave:')) {
        const w = id.slice(5) as WaveKind;
        engine.setWave(w);
        setWaveState(w);
      } else if (id === 'oct:down') {
        setMelodyOctave((o) => Math.max(2, o - 1));
      } else if (id === 'oct:up') {
        setMelodyOctave((o) => Math.min(6, o + 1));
      } else if (id === 'drum:toggle') {
        if (drum) {
          if (drum.isPlaying) drum.stop();
          else drum.start();
          setDrumPlaying(drum.isPlaying);
        }
      } else if (id.startsWith('genre:')) {
        const g = id.slice(6) as GenreId;
        setGenre(g);
        if (drum) {
          drum.setGenre(g);
          setBpm(drum.bpm);
        } else {
          setBpm(GENRES[g].bpm);
        }
      } else if (id === 'bpm:down' || id === 'bpm:up') {
        applyBpm(bpm + (id === 'bpm:up' ? 4 : -4));
      } else if (id.startsWith('slotedit:')) {
        setEditSlot(Number(id.slice(9)));
      } else if (id.startsWith('root:')) {
        const root = Number(id.slice(5));
        setChordSlots((prev) =>
          prev.map((c, k) =>
            k === editSlot ? { ...c, root, notes: buildChordNotes(root, c.quality, CHORD_OCTAVE) } : c,
          ),
        );
      } else if (id.startsWith('qual:')) {
        const q = id.slice(5) as QualityId;
        setChordSlots((prev) =>
          prev.map((c, k) =>
            k === editSlot ? { ...c, quality: q, notes: buildChordNotes(c.root, q, CHORD_OCTAVE) } : c,
          ),
        );
      } else if (id.startsWith('preset:')) {
        const preset = PROGRESSIONS.find((p) => p.id === id.slice(7));
        if (preset) setChordSlots(preset.slots.map((s) => ({ ...s, notes: [...s.notes] })));
      } else if (id.startsWith('pk:')) {
        const midi = Number(id.slice(3));
        setChordSlots((prev) =>
          prev.map((c, k) =>
            k === editSlot
              ? {
                  ...c,
                  notes: c.notes.includes(midi)
                    ? c.notes.filter((n) => n !== midi)
                    : [...c.notes, midi].sort((a, b) => a - b),
                }
              : c,
          ),
        );
      } else if (id === 'source') {
        setSource(source === 'camera' ? 'mouse' : 'camera');
      }
    },
    [engine, powerOn, editSlot, setSource, source, bpm, applyBpm],
  );

  // Debug hooks for headless verification.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__synth = () => engine.getDebugState();
    w.__synthEngine = engine;
    w.__drum = () => {
      const d = drumRef.current;
      return d ? { playing: d.isPlaying, genre: d.genre, bpm: d.bpm } : null;
    };
    w.__ui = () => ({
      audioOn,
      openSheet,
      melodyMode,
      genre,
      bpm,
      shade,
      chords: stateRef.current.chordSlots.map(chordName),
      scale: `${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}`,
    });
  }, [engine, audioOn, openSheet, melodyMode, scaleInfo, genre, bpm, shade]);

  const overAnyPanel = useCallback((p: Point): boolean => {
    for (const el of panelsRef.current.values()) if (inRect(el, p)) return true;
    return false;
  }, []);
  const hitControl = useCallback((p: Point): string | null => {
    for (const [id, el] of controlsRef.current) if (inRect(el, p)) return id;
    return null;
  }, []);

  const applyControl = useCallback(
    (id: string, handIndex: number, at: Point, roll: number, hasLandmarks: boolean) => {
      if (id.startsWith('knob:')) {
        const param = id.slice(5) as keyof SynthParams;
        claimsRef.current.set(handIndex, {
          type: 'knob', param, startY: at.y,
          startVal: engine.params[param], startRoll: roll, twist: hasLandmarks,
        });
        return;
      }
      if (id.startsWith('card:')) {
        const slotIdx = Number(id.slice(5));
        if (engine.isRunning) {
          chordOnSlot(slotIdx);
          claimsRef.current.set(handIndex, { type: 'chordSlot', slot: slotIdx });
          return;
        }
      }
      if (id === 'bpm:bar') {
        applyBpm(xToBpm(at.x));
        claimsRef.current.set(handIndex, { type: 'bpmbar' });
        return;
      }
      pressButton(id);
      claimsRef.current.set(handIndex, { type: 'pressed' });
    },
    [engine, chordOnSlot, pressButton, applyBpm, xToBpm],
  );

  useHandEvents({
    onPinchStart: (i, at, hand) => {
      if (stateRef.current.source === 'mouse') {
        if (hitControl(at) || overAnyPanel(at)) {
          claimsRef.current.set(i, { type: 'pressed' });
          return;
        }
      } else {
        const control = hitControl(at);
        if (control) {
          applyControl(control, i, at, hand.roll, hand.landmarks.length === 21);
          return;
        }
        if (overAnyPanel(at)) {
          claimsRef.current.set(i, { type: 'pressed' });
          return;
        }
      }
      // Open air: melody handled per-frame by the right-hand finger effect.
    },
    onPinchMove: (i, at, hand) => {
      const claim = claimsRef.current.get(i);
      if (!claim) return;
      if (claim.type === 'knob') {
        const val = claim.twist
          ? claim.startVal + normAngle(hand.roll - claim.startRoll) / TWIST_FULL
          : claim.startVal + (claim.startY - at.y) / 220;
        engine.setParam(claim.param, val);
        setParams({ ...engine.params });
      } else if (claim.type === 'bpmbar') {
        applyBpm(xToBpm(at.x));
      }
    },
    onPinchEnd: (i) => {
      const claim = claimsRef.current.get(i);
      claimsRef.current.delete(i);
      if (claim?.type === 'chordSlot') chordOffAll();
    },
  });

  // Right hand: finger piano — index = white, middle = black, ring = slide.
  const melodyHoldRef = useRef<{ hand: number; finger: number } | null>(null);
  const prevRightTouchRef = useRef(new Map<number, boolean[]>());
  useEffect(() => {
    if (!engine.isRunning) return;
    const stopMelody = () => {
      engine.noteOff(0);
      melodyHoldRef.current = null;
      setMelodyDegree(null);
    };
    const seen = new Set<number>();
    frame.hands.forEach((hand, i) => {
      if (hand.handedness !== 'Right') return;
      seen.add(i);
      const isMouse = hand.landmarks.length !== 21;
      const touches = hand.fingerTouch;
      const prev = prevRightTouchRef.current.get(i) ?? [false, false, false, false];
      prevRightTouchRef.current.set(i, touches);
      const uiClaim = claimsRef.current.get(i);
      const cur = melodyHoldRef.current;

      let finger: number | null = null;
      if (!uiClaim) {
        for (const k of [0, 1, 2]) if (touches[k] && !prev[k]) finger = k;
        if (finger === null && cur?.hand === i && touches[cur.finger]) finger = cur.finger;
        if (finger === null) finger = [0, 1, 2].find((k) => touches[k]) ?? null;
      }

      if (finger !== null) {
        const midi = melodyMidiFor(isMouse ? 2 : finger, hand.cursor.x);
        if (cur?.hand !== i) {
          engine.noteOn(0, midiToFreq(midi));
        } else {
          engine.setFreq(0, midiToFreq(midi), finger === 2 || isMouse ? 0.05 : 0.008);
        }
        melodyHoldRef.current = { hand: i, finger };
        setMelodyDegree(midiToDegree(midi));
      } else if (cur?.hand === i) {
        stopMelody();
      }
    });
    if (melodyHoldRef.current && !seen.has(melodyHoldRef.current.hand)) stopMelody();
  }, [frame, engine, melodyMidiFor, midiToDegree]);

  // Left hand: thumb-to-finger touches trigger the four chord slots.
  useEffect(() => {
    if (!engine.isRunning) return;
    const seen = new Set<number>();
    frame.hands.forEach((hand, i) => {
      if (hand.handedness !== 'Left' || hand.landmarks.length !== 21) return;
      seen.add(i);
      const prev = prevTouchRef.current.get(i) ?? [false, false, false, false];
      const touches = hand.fingerTouch;
      const uiClaim = claimsRef.current.get(i);
      const active = activeChordRef.current;

      for (let k = 0; k < 4; k++) {
        if (touches[k] && !prev[k] && !(k === 0 && uiClaim)) {
          chordOnSlot(k);
          activeChordRef.current = { hand: i, finger: k };
        }
      }
      if (active && active.hand === i && !touches[active.finger]) {
        const still = touches.findIndex(Boolean);
        if (still >= 0 && !(still === 0 && uiClaim)) {
          chordOnSlot(still);
          activeChordRef.current = { hand: i, finger: still };
        } else {
          chordOffAll();
          activeChordRef.current = null;
        }
      }
      prevTouchRef.current.set(i, touches);
    });
    const active = activeChordRef.current;
    if (active && !seen.has(active.hand)) {
      chordOffAll();
      activeChordRef.current = null;
      prevTouchRef.current.delete(active.hand);
    }
  }, [frame, engine, chordOnSlot, chordOffAll]);

  // Hover highlights (camera only; mouse uses CSS :hover).
  const rectCacheRef = useRef<{ t: number; rects: Array<[string, DOMRect]> }>({ t: 0, rects: [] });
  const hotControls = useMemo(() => {
    if (source !== 'camera' || frame.hands.length === 0) return EMPTY_SET;
    const now = performance.now();
    if (now - rectCacheRef.current.t > 400) {
      rectCacheRef.current = {
        t: now,
        rects: [...controlsRef.current].map(([id, el]) => [id, el.getBoundingClientRect()]),
      };
    }
    const hot = new Set<string>();
    for (const hand of frame.hands) {
      for (const [id, r] of rectCacheRef.current.rects) {
        if (hand.cursor.x >= r.left && hand.cursor.x <= r.right && hand.cursor.y >= r.top && hand.cursor.y <= r.bottom) {
          hot.add(id);
        }
      }
    }
    return hot;
  }, [frame, source]);

  const ruler = useMemo(() => {
    const base = 12 * (melodyOctave + 1);
    const set = new Set(scaleInfo.steps.map((st) => (scaleInfo.root + st) % 12));
    const rows: Array<{ degree: number; name: string; isRoot: boolean; inScale: boolean }> = [];
    for (let d = 0; d < RULER_SPAN; d++) {
      const midi = base + d;
      const pc = midi % 12;
      rows.push({
        degree: d,
        name: midiName(midi),
        isRoot: pc === scaleInfo.root,
        inScale: melodyMode === 'free' || set.has(pc),
      });
    }
    return rows;
  }, [scaleInfo, melodyOctave, melodyMode]);

  // Floating staff card follows the left (chord) hand.
  const staffSlot = chordSlots[activeSlot ?? lastSlot];
  const staffPos = useMemo(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return null;
    const leftHand = frame.hands.find((h) => h.handedness === 'Left' && h.landmarks.length === 21);
    if (!leftHand) return null;
    const x = Math.min(stage.width - 200, Math.max(10, leftHand.cursor.x - stage.left + 26));
    const y = Math.min(stage.height - 160, Math.max(10, leftHand.cursor.y - stage.top - 170));
    return { x, y };
  }, [frame]);

  // ---- Native (mouse/trackpad) interaction helpers ----
  const knobDrag = useRef<{ param: keyof SynthParams; startY: number; startVal: number } | null>(null);
  const onKnobPointerDown = (param: keyof SynthParams) => (e: ReactPointerEvent<HTMLDivElement>) => {
    knobDrag.current = { param, startY: e.clientY, startVal: engine.params[param] };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onKnobPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = knobDrag.current;
    if (!d) return;
    engine.setParam(d.param, d.startVal + (d.startY - e.clientY) / 220);
    setParams({ ...engine.params });
  };
  const onKnobPointerUp = () => {
    knobDrag.current = null;
  };

  const bpmDrag = useRef(false);
  const onBpmPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    bpmDrag.current = true;
    applyBpm(xToBpm(e.clientX));
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onBpmPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (bpmDrag.current) applyBpm(xToBpm(e.clientX));
  };
  const onBpmPointerUp = () => {
    bpmDrag.current = false;
  };

  const cardHold = (slotIdx: number) => ({
    onPointerDown: () => chordOnSlot(slotIdx),
    onPointerUp: () => chordOffAll(),
    onPointerLeave: () => {
      if (activeSlot === slotIdx) chordOffAll();
    },
  });

  const fmtPct = (v: number) => `${Math.round(v * 100)}`;
  const sheetOpen = (id: SheetId) => openSheet === id;
  const btn = (id: string) => ({
    ref: registerControl(id) as unknown as Ref<HTMLButtonElement>,
    onClick: () => pressButton(id),
  });

  return (
    <div className="hts-page" data-testid="instrument">
      {/* Liquid-glass refraction filter: displacement map warps the backdrop
          at panel edges, split per color channel for chromatic aberration.
          One shared GPU-composited SVG filter — no per-frame JS. */}
      <svg className="hts-defs" aria-hidden width="0" height="0">
        <filter id="hts-glass" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feImage
            href={GLASS_MAP}
            x="0" y="0" width="100%" height="100%"
            preserveAspectRatio="none"
            result="map"
          />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="-30" xChannelSelector="R" yChannelSelector="G" result="dR" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="-23" xChannelSelector="R" yChannelSelector="G" result="dG" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="-16" xChannelSelector="R" yChannelSelector="G" result="dB" />
          <feColorMatrix in="dR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cR" />
          <feColorMatrix in="dG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="cG" />
          <feColorMatrix in="dB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="cB" />
          <feBlend in="cR" in2="cG" mode="screen" result="rg" />
          <feBlend in="rg" in2="cB" mode="screen" />
        </filter>
      </svg>
      <div className="hts-title">hts_01.</div>

      <div className="hts-stage" ref={stageRef}>
        <VideoBackdrop shade={shade} />

        {/* ---- Top-right pills ---- */}
        <div className="hts-pills" ref={registerPanel('pills')}>
          <button
            className={`gw-pill hts-pill ${showTutorial ? 'gw-active' : ''} ${hotControls.has('tutorial') ? 'gw-hot' : ''}`}
            data-testid="tutorial"
            {...btn('tutorial')}
          >
            tutorial
          </button>
          <button
            className={`gw-pill hts-pill ${audioOn ? 'gw-active' : ''} ${hotControls.has('power') ? 'gw-hot' : ''}`}
            data-testid="power"
            {...btn('power')}
          >
            {audioOn ? 'live' : 'on'}
          </button>
        </div>

        {/* ---- Melody ruler along the top ---- */}
        <div className="gw-ruler-wrap">
          <div className="gw-ruler" data-testid="ruler" ref={rulerElRef}>
            {ruler.map((row) => (
              <div
                key={row.degree}
                className={`gw-ruler-row ${melodyDegree === row.degree ? 'gw-ruler-hit' : ''} ${row.isRoot ? 'gw-ruler-root' : ''} ${row.inScale ? '' : 'gw-ruler-off'}`}
              >
                <span className="gw-ruler-tick" />
                <span className="gw-ruler-name">{row.name}</span>
              </div>
            ))}
          </div>
          <div className="gw-ruler-caption">
            <button className={`gw-pill hts-pill-sm ${hotControls.has('mode') ? 'gw-hot' : ''}`} data-testid="mode-toggle" {...btn('mode')}>
              {melodyMode === 'auto' ? `auto · ${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}` : 'free · chromatic'}
            </button>
          </div>
        </div>

        {/* ---- Tab rail ---- */}
        <nav className="gw-rail" ref={registerPanel('rail')}>
          {SHEETS.map((s) => (
            <button
              key={s.id}
              className={`gw-tab ${sheetOpen(s.id) ? 'gw-tab-open' : ''} ${hotControls.has(`tab:${s.id}`) ? 'gw-hot' : ''}`}
              data-testid={`tab-${s.id}`}
              {...btn(`tab:${s.id}`)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* ---- Sheets ---- */}
        <aside className={`gw-sheet ${openSheet ? 'gw-sheet-open' : ''}`} ref={registerPanel('sheet')}>
          {openSheet === 'beat' && (
            <div className="gw-sheet-body" data-testid="sheet-beat">
              <h3 className="gw-sheet-title">beat — seq.16</h3>
              <button
                className={`gw-play ${drumPlaying ? 'gw-active' : ''} ${hotControls.has('drum:toggle') ? 'gw-hot' : ''}`}
                data-testid="drum-toggle"
                {...btn('drum:toggle')}
              >
                {drumPlaying ? '■ stop' : '▶ play'}
              </button>
              <span className="gw-sheet-label">pattern // +bass on root</span>
              <div className="gw-genre-list">
                {(Object.keys(GENRES) as GenreId[]).map((id) => (
                  <button
                    key={id}
                    className={`gw-pill gw-genre ${genre === id ? 'gw-active' : ''} ${hotControls.has(`genre:${id}`) ? 'gw-hot' : ''}`}
                    data-testid={`genre-${id}`}
                    {...btn(`genre:${id}`)}
                  >
                    <span>{GENRES[id].label}</span>
                    <span className="gw-dim">{GENRES[id].bpm}</span>
                  </button>
                ))}
              </div>
              <span className="gw-sheet-label">tempo ── {bpm} bpm</span>
              <div
                className="gw-bpm-bar"
                ref={registerControl('bpm:bar') as unknown as Ref<HTMLDivElement>}
                data-testid="bpm-bar"
                onPointerDown={onBpmPointerDown}
                onPointerMove={onBpmPointerMove}
                onPointerUp={onBpmPointerUp}
              >
                <div className="gw-bpm-fill" style={{ width: `${((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100}%` }} />
              </div>
              <div className="gw-oct-row">
                <button className="gw-pill" data-testid="bpm-down" {...btn('bpm:down')}>−</button>
                <span className="gw-oct-val" data-testid="bpm-val">{bpm}</span>
                <button className="gw-pill" data-testid="bpm-up" {...btn('bpm:up')}>+</button>
              </div>
              <p className="gw-sheet-note">8-bit kit · synth bass follows chord root · no samples</p>
            </div>
          )}
          {openSheet === 'chords' && (
            <div className="gw-sheet-body" data-testid="sheet-chords">
              <h3 className="gw-sheet-title">chords — bank.04</h3>
              <span className="gw-sheet-label">progressions</span>
              <div className="gw-preset-list">
                {PROGRESSIONS.map((p) => (
                  <button
                    key={p.id}
                    className={`gw-pill gw-genre ${hotControls.has(`preset:${p.id}`) ? 'gw-hot' : ''}`}
                    data-testid={`preset-${p.id}`}
                    {...btn(`preset:${p.id}`)}
                  >
                    <span>{p.label}</span>
                    <span className="gw-dim">{p.sub}</span>
                  </button>
                ))}
              </div>
              <span className="gw-sheet-label">edit slot</span>
              <div className="gw-slot-row">
                {chordSlots.map((s, k) => (
                  <button
                    key={k}
                    className={`gw-pill ${editSlot === k ? 'gw-active' : ''} ${hotControls.has(`slotedit:${k}`) ? 'gw-hot' : ''}`}
                    data-testid={`slotedit-${k}`}
                    {...btn(`slotedit:${k}`)}
                  >
                    {chordName(s)}
                  </button>
                ))}
              </div>
              <span className="gw-sheet-label">root</span>
              <div className="gw-root-grid">
                {NOTE_NAMES.map((n, i) => (
                  <button
                    key={n}
                    className={`gw-pill ${chordSlots[editSlot].root === i ? 'gw-active' : ''} ${hotControls.has(`root:${i}`) ? 'gw-hot' : ''}`}
                    data-testid={`root-${i}`}
                    {...btn(`root:${i}`)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="gw-sheet-label">quality</span>
              <div className="gw-qual-grid">
                {CHORD_QUALITIES.map((q) => (
                  <button
                    key={q.id}
                    className={`gw-pill ${chordSlots[editSlot].quality === q.id ? 'gw-active' : ''} ${hotControls.has(`qual:${q.id}`) ? 'gw-hot' : ''}`}
                    data-testid={`qual-${q.id}`}
                    {...btn(`qual:${q.id}`)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <span className="gw-sheet-label">
                voicing // {chordSlots[editSlot].notes.map((m) => midiName(m)).join(' · ') || '—'}
              </span>
              <div className="gw-piano" data-testid="piano">
                {(() => {
                  const whites: number[] = [];
                  for (let m = PIANO_LO; m < PIANO_LO + PIANO_SPAN; m++) {
                    if (WHITE_PCS.includes(m % 12)) whites.push(m);
                  }
                  const whiteW = 100 / whites.length;
                  const notes = chordSlots[editSlot].notes;
                  return (
                    <>
                      {whites.map((m) => (
                        <button
                          key={m}
                          className={`gw-pkey-w ${notes.includes(m) ? 'gw-pkey-on' : ''} ${hotControls.has(`pk:${m}`) ? 'gw-hot' : ''}`}
                          data-testid={`pk-${m}`}
                          {...btn(`pk:${m}`)}
                        />
                      ))}
                      {Array.from({ length: PIANO_SPAN }, (_, i) => PIANO_LO + i)
                        .filter((m) => !WHITE_PCS.includes(m % 12))
                        .map((m) => {
                          const whitesBefore = whites.filter((w) => w < m).length;
                          return (
                            <button
                              key={m}
                              className={`gw-pkey-b ${notes.includes(m) ? 'gw-pkey-on' : ''} ${hotControls.has(`pk:${m}`) ? 'gw-hot' : ''}`}
                              style={{ left: `calc(${whitesBefore * whiteW}% - 4.5%)` }}
                              data-testid={`pk-${m}`}
                              {...btn(`pk:${m}`)}
                            />
                          );
                        })}
                    </>
                  );
                })()}
              </div>
              <span className="gw-piano-range gw-micro">c3 ─────────── c5 · tap keys to edit voicing</span>
            </div>
          )}
          {openSheet === 'tone' && (
            <div className="gw-sheet-body" data-testid="sheet-tone">
              <h3 className="gw-sheet-title">tone — osc.2</h3>
              <div className="gw-wave-row">
                {WAVES.map((w) => (
                  <button
                    key={w}
                    className={`gw-pill ${wave === w ? 'gw-active' : ''} ${hotControls.has(`wave:${w}`) ? 'gw-hot' : ''}`}
                    data-testid={`wave-${w}`}
                    {...btn(`wave:${w}`)}
                  >
                    {WAVE_LABEL[w]}
                  </button>
                ))}
              </div>
              <div className="gw-knob-grid">
                {KNOB_ORDER.map(({ param, label }) => (
                  <div
                    key={param}
                    onPointerDown={onKnobPointerDown(param)}
                    onPointerMove={onKnobPointerMove}
                    onPointerUp={onKnobPointerUp}
                  >
                    <Knob
                      label={label}
                      value={params[param]}
                      readout={fmtPct(params[param])}
                      hot={hotControls.has(`knob:${param}`)}
                      registerRef={registerControl(`knob:${param}`)}
                    />
                  </div>
                ))}
              </div>
              <span className="gw-sheet-label">melody octave</span>
              <div className="gw-oct-row">
                <button className="gw-pill" data-testid="oct-down" {...btn('oct:down')}>−</button>
                <span className="gw-oct-val" data-testid="oct-val">{melodyOctave}</span>
                <button className="gw-pill" data-testid="oct-up" {...btn('oct:up')}>+</button>
              </div>
              <span className="gw-sheet-label">tracking</span>
              <div className="gw-cam-row">
                <button
                  className={`gw-pill ${hotControls.has('source') ? 'gw-hot' : ''}`}
                  data-testid="source-toggle"
                  {...btn('source')}
                >
                  {source === 'camera' ? 'camera' : 'mouse'}
                </button>
                <span className="gw-dim">{status}</span>
                <span className="gw-dim">{fps} fps</span>
              </div>
              <p className="gw-sheet-note">
                pinch a knob + twist your wrist · mouse: drag vertically. tracking runs locally — the feed never leaves this device.
              </p>
            </div>
          )}
        </aside>

        {/* ---- Chord cards along the bottom ---- */}
        <div className="gw-chords" ref={registerPanel('chordcards')}>
          {chordSlots.map((s, k) => (
            <button
              key={k}
              className={`gw-card ${activeSlot === k ? 'gw-card-live' : ''} ${hotControls.has(`card:${k}`) ? 'gw-hot' : ''}`}
              ref={registerControl(`card:${k}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`card-${k}`}
              {...cardHold(k)}
            >
              <span className="gw-card-finger">{FINGER_LABEL[k]}</span>
              <span className="gw-card-name">{chordName(s)}</span>
            </button>
          ))}
        </div>

        {/* ---- Technical scope ---- */}
        <div className="gw-scope-dock" ref={registerPanel('scope')}>
          <TechScope engine={engine} />
        </div>

        {/* ---- Floating staff: follows the left hand; anchors above the
             chord cards when a chord sounds without a tracked hand ---- */}
        {audioOn && staffPos && (
          <div className="gw-staff-float" style={{ transform: `translate(${staffPos.x}px, ${staffPos.y}px)` }}>
            <StaffChord midis={staffSlot.notes} label={chordName(staffSlot)} />
          </div>
        )}
        {audioOn && !staffPos && activeSlot !== null && (
          <div className="gw-staff-float gw-staff-anchored">
            <StaffChord midis={staffSlot.notes} label={chordName(staffSlot)} />
          </div>
        )}

        {/* ---- Tutorial overlay ---- */}
        {showTutorial && (
          <div className="hts-tutorial" ref={registerPanel('tutorial')} data-testid="tutorial-card">
            <h3 className="gw-sheet-title">how to play</h3>
            <p><span className="gw-dim">right hand</span> — pinch to play melody along the top ruler. thumb+index = white keys · thumb+middle = black keys · thumb+ring = slide.</p>
            <p><span className="gw-dim">left hand</span> — thumb+index/middle/ring/pinky holds chords 1–4. the floating staff shows the notes.</p>
            <p><span className="gw-dim">knobs</span> — pinch, then twist your wrist. everything also works with a mouse.</p>
            <p><span className="gw-dim">first</span> — press “on” to arm the audio, open beat and press play.</p>
          </div>
        )}
      </div>
    </div>
  );
}
