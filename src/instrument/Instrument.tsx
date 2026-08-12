import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
import { tiltAmount, tiltCutoff, tiltState } from '../gesture/tilt';
import { SynthEngine, type ChordWave, type SynthParams, type WaveKind } from '../audio/SynthEngine';
import { DrumMachine, GENRES, type GenreId } from '../audio/DrumMachine';
import {
  buildChordNotes,
  CHORD_QUALITIES,
  chordName,
  midiName,
  midiToFreq,
  NOTE_NAMES,
  quality,
  recognizeChord,
  IONIAN,
  AEOLIAN,
  type ChordSlot,
  type QualityId,
} from '../audio/theory';
import { GlassCanvas, GlassShape } from './GlassCanvas';
import { Knob } from './Knob';
import { TechScope } from './TechScope';
import { StaffChord } from './StaffChord';
import { VideoBackdrop } from '../components/VideoBackdrop';
import './Instrument.css';

type Claim =
  | { type: 'knob'; param: keyof SynthParams; startY: number; startVal: number; startRoll: number; twist: boolean }
  | { type: 'chordSlot'; slot: number }
  | { type: 'bpmbar' }
  | { type: 'shadebar' }
  | { type: 'pressed' };

type SheetId = 'beat' | 'chords' | 'tone';

const WAVES: WaveKind[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_LABEL: Record<WaveKind, string> = {
  sawtooth: 'saw',
  square: 'sqr',
  triangle: 'tri',
  sine: 'sin',
};
const CHORD_WAVES: ChordWave[] = ['pad', 'sawtooth', 'square', 'triangle', 'sine'];
const CHORD_WAVE_LABEL: Record<ChordWave, string> = { ...WAVE_LABEL, pad: 'pad' };
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

function slot(root: number, q: QualityId, notes?: number[]): ChordSlot {
  return { root, quality: q, notes: notes ?? buildChordNotes(root, q, CHORD_OCTAVE) };
}

/** Common progressions (after Berklee's list), plastic love's loop first. */
const PROGRESSIONS: Array<{ id: string; label: string; sub: string; slots: ChordSlot[] }> = [
  // in g minor: Gm7 · C13b9 (c-bb-db-e-a) · Am · Dm7
  { id: 'plasticlove', label: 'plastic love', sub: 'i7–iv7–ii–v7', slots: [slot(7, 'min7'), slot(0, 'dom7', [48, 58, 61, 64, 69]), slot(9, 'min'), slot(2, 'min7')] },
  { id: 'citypop', label: 'city pop', sub: 'ivmaj7–v7–iii7–vi7', slots: [slot(5, 'maj7'), slot(7, 'dom7'), slot(4, 'min7'), slot(9, 'min7')] },
  { id: 'pop', label: 'pop', sub: 'i–v–vi–iv', slots: [slot(0, 'maj'), slot(7, 'maj'), slot(9, 'min'), slot(5, 'maj')] },
  { id: 'doowop', label: '50s', sub: 'i–vi–iv–v', slots: [slot(0, 'maj'), slot(9, 'min'), slot(5, 'maj'), slot(7, 'maj')] },
  { id: 'jazz', label: 'jazz', sub: 'ii7–v7–imaj7–vi7', slots: [slot(2, 'min7'), slot(7, 'dom7'), slot(0, 'maj7'), slot(9, 'min7')] },
  { id: 'andalusian', label: 'andalusian', sub: 'i–bvii–bvi–v7', slots: [slot(9, 'min'), slot(7, 'maj'), slot(5, 'maj'), slot(4, 'dom7')] },
  { id: 'blues', label: 'blues', sub: 'i7–iv7–v7–i7', slots: [slot(0, 'dom7'), slot(5, 'dom7'), slot(7, 'dom7'), slot(0, 'dom7')] },
];

// Memoized presentational components — skip re-render on unrelated frames.
const MKnob = memo(Knob);
const MTechScope = memo(TechScope);
const MStaffChord = memo(StaffChord);

const TWIST_FULL = (Math.PI * 3) / 4;
const BPM_MIN = 60;
const BPM_MAX = 180;
const SHADE_MAX = 0.9;
/** Fixed chromatic ruler: 2 octaves + 1, anchored at C — never moves. */
const RULER_SPAN = 25;
/** Piano editor range: C3..C5 inclusive. */
const PIANO_LO = 48;
const PIANO_SPAN = 25;
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
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
  const { frame, status, source, fps, setSource } = useGestures();
  const engineRef = useRef<SynthEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SynthEngine();
  const engine = engineRef.current;
  const drumRef = useRef<DrumMachine | null>(null);

  const [audioOn, setAudioOn] = useState(false);
  const [params, setParams] = useState<SynthParams>({ ...engine.params });
  const [wave, setWaveState] = useState<WaveKind>('sawtooth');
  const [chordWave, setChordWaveState] = useState<ChordWave>('pad');
  const [melodyOctave, setMelodyOctave] = useState(4);
  const [melodyMode, setMelodyMode] = useState<'auto' | 'free'>('free');
  // The "1" of the piece: index finger plays in-key notes, middle finger the
  // outside ones. Defaults to d minor.
  const [keyRoot, setKeyRoot] = useState(2);
  const [keyMode, setKeyMode] = useState<'maj' | 'min'>('min');
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
  const [shade, setShade] = useState(0.55);

  const claimsRef = useRef(new Map<number, Claim>());
  const controlsRef = useRef(new Map<string, HTMLElement>());
  const panelsRef = useRef(new Map<string, HTMLElement>());
  const prevTouchRef = useRef(new Map<number, boolean[]>());
  const activeChordRef = useRef<{ hand: number; finger: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rulerElRef = useRef<HTMLDivElement | null>(null);
  const rulerRectRef = useRef<{ t: number; r: DOMRect | null }>({ t: 0, r: null });

  // Scale that fits the sounding (or last) chord. The ruler is a FIXED
  // chromatic ladder; AUTO mode only changes which rungs melody snaps to.
  const scaleInfo = useMemo(() => {
    const s = chordSlots[activeSlot ?? lastSlot];
    const q = quality(s.quality);
    return { root: s.root, steps: q.scaleSteps, name: q.scaleName };
  }, [chordSlots, activeSlot, lastSlot]);

  /** Pitch classes in the key, and the chromatic leftovers. */
  const keySets = useMemo(() => {
    const inSet = new Set((keyMode === 'maj' ? IONIAN : AEOLIAN).map((st) => (keyRoot + st) % 12));
    const outSet = new Set<number>();
    for (let pc = 0; pc < 12; pc++) if (!inSet.has(pc)) outSet.add(pc);
    return { inSet, outSet };
  }, [keyRoot, keyMode]);

  const stateRef = useRef({ scaleInfo, melodyOctave, melodyMode, chordSlots, source, keySets });
  stateRef.current = { scaleInfo, melodyOctave, melodyMode, chordSlots, source, keySets };

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

  // Live by default: arm the audio as early as the browser allows. The
  // autoplay policy blocks AudioContext until a user gesture, so try on
  // mount and retry on the first real interaction (start() is idempotent —
  // it resumes a suspended context).
  useEffect(() => {
    if (audioOn) return;
    powerOn();
    const arm = () => powerOn();
    window.addEventListener('pointerdown', arm, true);
    window.addEventListener('keydown', arm, true);
    return () => {
      window.removeEventListener('pointerdown', arm, true);
      window.removeEventListener('keydown', arm, true);
    };
  }, [audioOn, powerOn]);

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

  // ---- Left-hand tilt -> filter ----------------------------------------
  // The filter knob sets a BASE value; the left hand's wrist angle
  // modulates around it (straight up = untouched). engine.params.cutoff
  // therefore holds the live, tilted value, so knob interactions have to
  // read and write the base instead of the engine's current value.
  const filterBaseRef = useRef(engine.params.cutoff);
  const tiltRef = useRef(0);
  const tiltHeldRef = useRef(false);
  const tiltArmedRef = useRef(true);

  const lastCutoffRef = useRef(engine.params.cutoff);
  const applyTilt = useCallback(
    (tilt: number) => {
      tiltRef.current = tilt;
      const cutoff = tiltCutoff(filterBaseRef.current, tilt);
      tiltState.base = filterBaseRef.current;
      tiltState.cutoff = cutoff;
      tiltState.tilt = tilt;
      // This runs on every frame the hand moves at all. Re-anchoring the
      // filter's ramp with an unchanged target would keep restarting the
      // approach and stop it ever settling, so only touch audio on a real
      // change (0.0005 of the normalised range is far below audible).
      if (Math.abs(cutoff - lastCutoffRef.current) < 0.0005) return;
      lastCutoffRef.current = cutoff;
      engine.sweepCutoff(cutoff);
    },
    [engine],
  );

  /** Starting value for a knob drag — cutoff drags move the base. */
  const knobStart = useCallback(
    (param: keyof SynthParams): number =>
      param === 'cutoff' ? filterBaseRef.current : engine.params[param],
    [engine],
  );

  /** Commit a knob value; the displayed cutoff is always the base. */
  const applyKnob = useCallback(
    (param: keyof SynthParams, value: number) => {
      if (param === 'cutoff') {
        filterBaseRef.current = Math.min(1, Math.max(0, value));
        applyTilt(tiltRef.current);
      } else {
        engine.setParam(param, value);
      }
      setParams({ ...engine.params, cutoff: filterBaseRef.current });
    },
    [engine, applyTilt],
  );

  const rulerRect = useCallback((): DOMRect | null => {
    if (performance.now() - rulerRectRef.current.t > 1000) {
      const r = rulerElRef.current?.getBoundingClientRect() ?? null;
      rulerRectRef.current = {
        t: performance.now(),
        // A collapsed/hidden layout reports zero-size rects — treat as absent
        // so the mapping falls back instead of dividing by zero.
        r: r && r.width > 8 ? r : null,
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
    const midi = 12 * (s.melodyOctave + 1) + Math.round((Number.isFinite(xn) ? xn : 0.5) * (RULER_SPAN - 1));
    if (finger === 0) return snapToSet(midi, s.keySets.inSet);
    if (finger === 1) return snapToSet(midi, s.keySets.outSet);
    if (s.melodyMode === 'free') return midi;
    const set = new Set(s.scaleInfo.steps.map((st) => (s.scaleInfo.root + st) % 12));
    return snapToSet(midi, set);
  }, [rulerRect]);

  const midiToDegree = useCallback((midi: number): number => {
    return midi - 12 * (stateRef.current.melodyOctave + 1);
  }, []);

  /** 0..1 position of x across a registered bar control (null if unmounted). */
  const barFrac = useCallback((id: string, x: number): number | null => {
    const el = controlsRef.current.get(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  }, []);

  const applyBpm = useCallback((next: number) => {
    setBpm(() => {
      const v = Math.min(BPM_MAX, Math.max(BPM_MIN, next));
      drumRef.current?.setBpm(v);
      return v;
    });
  }, []);

  const applyBpmAt = useCallback((x: number) => {
    const f = barFrac('bpm:bar', x);
    if (f !== null) applyBpm(Math.round(BPM_MIN + f * (BPM_MAX - BPM_MIN)));
  }, [barFrac, applyBpm]);

  const applyShadeAt = useCallback((x: number) => {
    const f = barFrac('shade:bar', x);
    if (f !== null) setShade(Math.round(f * SHADE_MAX * 100) / 100);
  }, [barFrac]);

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
      } else if (id.startsWith('key:')) {
        setKeyRoot(Number(id.slice(4)));
      } else if (id.startsWith('keymode:')) {
        setKeyMode(id.slice(8) as 'maj' | 'min');
      } else if (id.startsWith('wave:')) {
        const w = id.slice(5) as WaveKind;
        engine.setWave(w);
        setWaveState(w);
      } else if (id.startsWith('cwave:')) {
        const w = id.slice(6) as ChordWave;
        engine.setChordWave(w);
        setChordWaveState(w);
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
    // finger-piano routing is camera-only; this makes it testable headlessly
    w.__melody = (finger: number, x: number) => midiName(melodyMidiFor(finger, x));
    // Tilt helpers are exposed so the mapping can be exercised headlessly
    // (mouse mode has no landmarks, so roll is always 0 there).
    w.__tilt = () => ({ ...tiltState, amount: tiltAmount, cutoffFor: tiltCutoff });
    w.__ui = () => ({
      audioOn,
      openSheet,
      melodyMode,
      genre,
      bpm,
      shade,
      tilt: tiltState.tilt,
      filterBase: tiltState.base,
      filterLive: tiltState.cutoff,
      chords: stateRef.current.chordSlots.map(chordName),
      scale: `${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}`,
      key: `${NOTE_NAMES[keyRoot]} ${keyMode}`,
    });
  }, [engine, audioOn, openSheet, melodyMode, scaleInfo, genre, bpm, shade, keyRoot, keyMode, melodyMidiFor]);

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
          startVal: knobStart(param), startRoll: roll, twist: hasLandmarks,
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
        applyBpmAt(at.x);
        claimsRef.current.set(handIndex, { type: 'bpmbar' });
        return;
      }
      if (id === 'shade:bar') {
        applyShadeAt(at.x);
        claimsRef.current.set(handIndex, { type: 'shadebar' });
        return;
      }
      pressButton(id);
      claimsRef.current.set(handIndex, { type: 'pressed' });
    },
    [engine, chordOnSlot, pressButton, applyBpmAt, applyShadeAt, knobStart],
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
        applyKnob(claim.param, val);
      } else if (claim.type === 'bpmbar') {
        applyBpmAt(at.x);
      } else if (claim.type === 'shadebar') {
        applyShadeAt(at.x);
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

  // Left hand: wrist angle sweeps the filter around the knob's base value.
  // Straight up is neutral, and the deadzone keeps a steady hand from
  // drifting. No React state here — the overlay reads `tiltState` so this
  // stays free of per-frame renders.
  useEffect(() => {
    const i = frame.hands.findIndex(
      (h) => h.handedness === 'Left' && h.landmarks.length === 21,
    );
    const hand = i >= 0 ? frame.hands[i] : null;
    const release = () => {
      if (tiltHeldRef.current) {
        tiltHeldRef.current = false;
        applyTilt(0);
      }
    };
    if (!hand) {
      release();
      tiltArmedRef.current = true; // a hand raised into frame works at once
      tiltState.armed = true;
      return;
    }
    // A knob twist is the one interaction that CONSUMES this hand's roll:
    // the wrist is deliberately rotated, and is left rotated when the pinch
    // ends. So hold the filter at the base being dialled, and re-arm only
    // once the wrist comes back through neutral — otherwise releasing a
    // knob would fling the filter to wherever the wrist happened to stop.
    // Every other claim (chord card, bpm/shade bar) leaves roll free, and
    // those are this hand's natural targets, so tilt keeps running through
    // them rather than snapping to base and back.
    if (claimsRef.current.get(i)?.type === 'knob') {
      release();
      tiltArmedRef.current = false;
      tiltState.armed = false;
      return;
    }
    if (!tiltArmedRef.current) {
      if (tiltAmount(hand.roll) !== 0) {
        release();
        return;
      }
      tiltArmedRef.current = true;
      tiltState.armed = true;
    }
    // A pure function of the CURRENT angle — never an accumulator. Frames
    // are deduped while a hand holds still, so anything that had to
    // converge over successive frames would freeze part-way there.
    // Smoothing already happens downstream: handsEqual ignores roll jitter
    // under ~0.6 deg, and sweepCutoff ramps the filter over 50ms.
    tiltHeldRef.current = true;
    applyTilt(tiltAmount(hand.roll));
  }, [frame, applyTilt]);

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
  // Flat-side roots (F, Bb, Eb, Ab, Db, Gb) spell black keys as flats —
  // judged from the recognized root of the actual voicing.
  const staffRoot = recognizeChord(staffSlot.notes)?.root ?? staffSlot.root;
  const staffFlats = [5, 10, 3, 8, 1, 6].includes(staffRoot);
  const stageRectRef = useRef<{ t: number; r: DOMRect | null }>({ t: 0, r: null });
  const staffPos = useMemo(() => {
    const leftHand = frame.hands.find((h) => h.handedness === 'Left' && h.landmarks.length === 21);
    if (!leftHand) return null;
    // Cached stage rect — no per-frame forced layout while the hand moves.
    if (performance.now() - stageRectRef.current.t > 1000) {
      const r = stageRef.current?.getBoundingClientRect() ?? null;
      stageRectRef.current = { t: performance.now(), r: r && r.width > 8 ? r : null };
    }
    const stage = stageRectRef.current.r;
    if (!stage) return null;
    const x = Math.min(stage.width - 200, Math.max(10, leftHand.cursor.x - stage.left + 26));
    const y = Math.min(stage.height - 160, Math.max(10, leftHand.cursor.y - stage.top - 170));
    return { x, y };
  }, [frame]);

  // ---- Native (mouse/trackpad) interaction helpers ----
  const knobDrag = useRef<{ param: keyof SynthParams; startY: number; startVal: number } | null>(null);
  const onKnobPointerDown = (param: keyof SynthParams) => (e: ReactPointerEvent<HTMLDivElement>) => {
    knobDrag.current = { param, startY: e.clientY, startVal: knobStart(param) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onKnobPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = knobDrag.current;
    if (!d) return;
    applyKnob(d.param, d.startVal + (d.startY - e.clientY) / 220);
  };
  const onKnobPointerUp = () => {
    knobDrag.current = null;
  };

  // Horizontal bar drag (bpm / shade): applyAt(x) while the pointer is down.
  const barDrag = useRef<((x: number) => void) | null>(null);
  const barHandlers = (applyAt: (x: number) => void) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      barDrag.current = applyAt;
      applyAt(e.clientX);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      barDrag.current?.(e.clientX);
    },
    onPointerUp: () => {
      barDrag.current = null;
    },
  });

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
      {/* ---- Header on the black bezel: title left, pills right ---- */}
      <div className="hts-header">
        <div className="hts-title">hts_01.</div>
        <div className="hts-pills" ref={registerPanel('pills')}>
          <button
            className={`gw-pill hts-pill ${melodyMode === 'auto' ? 'gw-active' : ''} ${hotControls.has('mode') ? 'gw-hot' : ''}`}
            data-testid="mode-toggle"
            {...btn('mode')}
          >
            {melodyMode === 'auto' ? `auto · ${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}` : 'free · chromatic'}
          </button>
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
      </div>

      <div className="hts-stage" ref={stageRef}>
        <VideoBackdrop shade={shade} />
        <GlassCanvas shade={shade} />

        {/* ---- Melody ruler along the top, right-aligned ---- */}
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
        </div>

        {/* ---- Tab rail ---- */}
        <nav className="gw-rail gw-lg" ref={registerPanel('rail')}>
          <GlassShape radius={14} />
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
        <aside className={`gw-sheet gw-lg ${openSheet ? 'gw-sheet-open' : ''}`} ref={registerPanel('sheet')}>
          <GlassShape radius={16} />

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
                {...barHandlers(applyBpmAt)}
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
              <span className="gw-sheet-label">
                key — the “1” // index finger plays in-key, middle finger outside
              </span>
              <div className="gw-root-grid">
                {NOTE_NAMES.map((n, i) => (
                  <button
                    key={n}
                    className={`gw-pill ${keyRoot === i ? 'gw-active' : ''} ${hotControls.has(`key:${i}`) ? 'gw-hot' : ''}`}
                    data-testid={`key-${i}`}
                    {...btn(`key:${i}`)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="gw-slot-row">
                {(['maj', 'min'] as const).map((m) => (
                  <button
                    key={m}
                    className={`gw-pill ${keyMode === m ? 'gw-active' : ''} ${hotControls.has(`keymode:${m}`) ? 'gw-hot' : ''}`}
                    data-testid={`keymode-${m}`}
                    {...btn(`keymode:${m}`)}
                  >
                    {m === 'maj' ? 'major' : 'minor'}
                  </button>
                ))}
              </div>
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
                              style={{ left: `calc(${whitesBefore * whiteW}% - 2.1%)` }}
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
              <span className="gw-sheet-label">melody wave</span>
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
              <span className="gw-sheet-label">chord wave // pad = saw bass + triangle above</span>
              <div className="gw-wave-row">
                {CHORD_WAVES.map((w) => (
                  <button
                    key={w}
                    className={`gw-pill ${chordWave === w ? 'gw-active' : ''} ${hotControls.has(`cwave:${w}`) ? 'gw-hot' : ''}`}
                    data-testid={`cwave-${w}`}
                    {...btn(`cwave:${w}`)}
                  >
                    {CHORD_WAVE_LABEL[w]}
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
                    <MKnob
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
              <span className="gw-sheet-label">shade ── {Math.round(shade * 100)}%</span>
              <div
                className="gw-bpm-bar"
                ref={registerControl('shade:bar') as unknown as Ref<HTMLDivElement>}
                data-testid="shade-bar"
                {...barHandlers(applyShadeAt)}
              >
                <div className="gw-bpm-fill" style={{ width: `${(shade / SHADE_MAX) * 100}%` }} />
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
              className={`gw-card gw-lg ${activeSlot === k ? 'gw-card-live' : ''} ${hotControls.has(`card:${k}`) ? 'gw-hot' : ''}`}
              ref={registerControl(`card:${k}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`card-${k}`}
              {...cardHold(k)}
            >
              <GlassShape radius={12} />
              <span className="gw-card-finger">{FINGER_LABEL[k]}</span>
              <span className="gw-card-name">{chordName(s)}</span>
            </button>
          ))}
        </div>

        {/* ---- Technical scope ---- */}
        <div className="gw-scope-dock" ref={registerPanel('scope')}>
          <MTechScope engine={engine} />
        </div>

        {/* ---- Floating staff: follows the left hand; anchors above the
             chord cards when a chord sounds without a tracked hand ---- */}
        {audioOn && staffPos && (
          <div className="gw-staff-float gw-lg" style={{ transform: `translate(${staffPos.x}px, ${staffPos.y}px)` }}>
            <GlassShape radius={12} />
            <MStaffChord midis={staffSlot.notes} label={chordName(staffSlot)} preferFlats={staffFlats} />
          </div>
        )}
        {audioOn && !staffPos && activeSlot !== null && (
          <div className="gw-staff-float gw-staff-anchored gw-lg">
            <GlassShape radius={12} />
            <MStaffChord midis={staffSlot.notes} label={chordName(staffSlot)} preferFlats={staffFlats} />
          </div>
        )}

        {/* ---- Tutorial overlay ---- */}
        {showTutorial && (
          <div className="hts-tutorial" ref={registerPanel('tutorial')} data-testid="tutorial-card">
            <h3 className="gw-sheet-title">how to play</h3>
            <p><span className="gw-dim">right hand</span> — pinch to play melody along the top ruler. thumb+index = notes in the key · thumb+middle = notes outside it · thumb+ring = slide.</p>
            <p><span className="gw-dim">left hand</span> — thumb+index/middle/ring/pinky holds chords 1–4. the floating staff shows the notes.</p>
            <p><span className="gw-dim">knobs</span> — pinch, then twist your wrist. everything also works with a mouse.</p>
            <p><span className="gw-dim">first</span> — press “on” to arm the audio, open beat and press play.</p>
          </div>
        )}
      </div>
    </div>
  );
}
