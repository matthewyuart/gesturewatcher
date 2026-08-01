import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
import { SynthEngine, type SynthParams, type WaveKind } from '../audio/SynthEngine';
import { DrumMachine, GENRES, type GenreId } from '../audio/DrumMachine';
import {
  CHORD_QUALITIES,
  CHROMATIC,
  chordMidis,
  chordName,
  midiName,
  midiToFreq,
  NOTE_NAMES,
  quality,
  scaleDegreeToMidi,
  type ChordSlot,
  type QualityId,
} from '../audio/theory';
import { Knob } from './Knob';
import { Scope } from './Scope';
import './Instrument.css';

type Claim =
  | { type: 'knob'; param: keyof SynthParams; startY: number; startVal: number; startRoll: number; twist: boolean }
  | { type: 'melody'; startX: number }
  | { type: 'chordSlot'; slot: number }
  | { type: 'bpmbar' }
  | { type: 'pressed' };

type SheetId = 'beat' | 'chords' | 'sound' | 'cam';

const WAVES: WaveKind[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_LABEL: Record<WaveKind, string> = {
  sawtooth: 'SAW',
  square: 'SQR',
  triangle: 'TRI',
  sine: 'SIN',
};
const KNOB_ORDER: Array<{ param: keyof SynthParams; label: string }> = [
  { param: 'cutoff', label: 'FILTER' },
  { param: 'resonance', label: 'RES' },
  { param: 'attack', label: 'ATTACK' },
  { param: 'release', label: 'RELEASE' },
  { param: 'echo', label: 'ECHO' },
  { param: 'volume', label: 'VOLUME' },
];
const FINGER_LABEL = ['THUMB+INDEX', 'THUMB+MIDDLE', 'THUMB+RING', 'THUMB+PINKY'];
const SHEETS: Array<{ id: SheetId; label: string }> = [
  { id: 'beat', label: 'beat' },
  { id: 'chords', label: 'chords' },
  { id: 'sound', label: 'sound' },
  { id: 'cam', label: 'track' },
];

/** Common progressions (after Berklee's list), city pop's royal road first. */
const PROGRESSIONS: Array<{ id: string; label: string; sub: string; slots: ChordSlot[] }> = [
  {
    id: 'citypop', label: 'CITY POP', sub: 'IVmaj7–V7–iii7–vi7',
    slots: [
      { root: 5, quality: 'maj7' }, { root: 7, quality: 'dom7' },
      { root: 4, quality: 'min7' }, { root: 9, quality: 'min7' },
    ],
  },
  {
    id: 'pop', label: 'POP', sub: 'I–V–vi–IV',
    slots: [
      { root: 0, quality: 'maj' }, { root: 7, quality: 'maj' },
      { root: 9, quality: 'min' }, { root: 5, quality: 'maj' },
    ],
  },
  {
    id: 'doowop', label: '50S', sub: 'I–vi–IV–V',
    slots: [
      { root: 0, quality: 'maj' }, { root: 9, quality: 'min' },
      { root: 5, quality: 'maj' }, { root: 7, quality: 'maj' },
    ],
  },
  {
    id: 'jazz', label: 'JAZZ', sub: 'ii7–V7–Imaj7–vi7',
    slots: [
      { root: 2, quality: 'min7' }, { root: 7, quality: 'dom7' },
      { root: 0, quality: 'maj7' }, { root: 9, quality: 'min7' },
    ],
  },
  {
    id: 'andalusian', label: 'ANDALUSIAN', sub: 'i–bVII–bVI–V7',
    slots: [
      { root: 9, quality: 'min' }, { root: 7, quality: 'maj' },
      { root: 5, quality: 'maj' }, { root: 4, quality: 'dom7' },
    ],
  },
  {
    id: 'blues', label: 'BLUES', sub: 'I7–IV7–V7–I7',
    slots: [
      { root: 0, quality: 'dom7' }, { root: 5, quality: 'dom7' },
      { root: 7, quality: 'dom7' }, { root: 0, quality: 'dom7' },
    ],
  },
];

const BEND_RANGE = 2;
const BEND_PX = 150;
const TWIST_FULL = (Math.PI * 3) / 4;
const CHORD_OCTAVE = 3;
const BPM_MIN = 60;
const BPM_MAX = 180;

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
  const [melodyOctave, setMelodyOctave] = useState(4);
  const [melodyMode, setMelodyMode] = useState<'auto' | 'free'>('auto');
  const [melodyDegree, setMelodyDegree] = useState<number | null>(null);

  const [chordSlots, setChordSlots] = useState<ChordSlot[]>(PROGRESSIONS[0].slots);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [lastSlot, setLastSlot] = useState(0);
  const [editSlot, setEditSlot] = useState(0);

  const [openSheet, setOpenSheet] = useState<SheetId | null>(null);
  const [drumPlaying, setDrumPlaying] = useState(false);
  const [genre, setGenre] = useState<GenreId>('citypop');
  const [bpm, setBpm] = useState(GENRES.citypop.bpm);

  const claimsRef = useRef(new Map<number, Claim>());
  const controlsRef = useRef(new Map<string, HTMLElement>());
  const panelsRef = useRef(new Map<string, HTMLElement>());
  const prevTouchRef = useRef(new Map<number, boolean[]>());
  const activeChordRef = useRef<{ hand: number; finger: number } | null>(null);

  // Melody scale follows the sounding (or last) chord; FREE = chromatic.
  const scaleInfo = useMemo(() => {
    const slot = chordSlots[activeSlot ?? lastSlot];
    if (melodyMode === 'free') {
      return { root: slot.root, steps: CHROMATIC, name: 'chromatic' };
    }
    const q = quality(slot.quality);
    return { root: slot.root, steps: q.scaleSteps, name: q.scaleName };
  }, [chordSlots, activeSlot, lastSlot, melodyMode]);
  const degreeCount = scaleInfo.steps.length * 2 + 1;

  const stateRef = useRef({ scaleInfo, degreeCount, melodyOctave, chordSlots, source });
  stateRef.current = { scaleInfo, degreeCount, melodyOctave, chordSlots, source };

  useEffect(() => {
    setMelodyDegree((d) => (d !== null && d >= degreeCount ? degreeCount - 1 : d));
  }, [degreeCount]);

  // Bass follows the root of the sounding / last chord.
  useEffect(() => {
    drumRef.current?.setBassRoot(chordSlots[activeSlot ?? lastSlot].root);
  }, [chordSlots, activeSlot, lastSlot]);

  const registerControl = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) controlsRef.current.set(id, el);
      else controlsRef.current.delete(id);
    },
    [],
  );
  const registerPanel = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) panelsRef.current.set(id, el);
      else panelsRef.current.delete(id);
    },
    [],
  );

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
    (slot: number) => {
      if (!engine.isRunning) return;
      const s = stateRef.current;
      engine.chordOn(chordMidis(s.chordSlots[slot], CHORD_OCTAVE).map(midiToFreq));
      drumRef.current?.setBassRoot(s.chordSlots[slot].root);
      setActiveSlot(slot);
      setLastSlot(slot);
    },
    [engine],
  );
  const chordOffAll = useCallback(() => {
    engine.chordOff();
    setActiveSlot(null);
  }, [engine]);

  const yToDegree = useCallback((y: number): number => {
    const dc = stateRef.current.degreeCount;
    const yn = Math.min(1, Math.max(0, (y / window.innerHeight - 0.12) / 0.72));
    return Math.round((1 - yn) * (dc - 1));
  }, []);

  const melodyMidi = useCallback((degree: number): number => {
    const s = stateRef.current;
    return scaleDegreeToMidi(s.scaleInfo.root, s.scaleInfo.steps, degree, s.melodyOctave);
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
        setChordSlots((prev) => prev.map((c, k) => (k === editSlot ? { ...c, root } : c)));
      } else if (id.startsWith('qual:')) {
        const q = id.slice(5) as QualityId;
        setChordSlots((prev) => prev.map((c, k) => (k === editSlot ? { ...c, quality: q } : c)));
      } else if (id.startsWith('preset:')) {
        const preset = PROGRESSIONS.find((p) => p.id === id.slice(7));
        if (preset) setChordSlots(preset.slots.map((s) => ({ ...s })));
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
      chords: stateRef.current.chordSlots.map(chordName),
      scale: `${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}`,
      degreeCount,
    });
  }, [engine, audioOn, openSheet, melodyMode, scaleInfo, degreeCount, genre, bpm]);

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
        const slot = Number(id.slice(5));
        if (engine.isRunning) {
          chordOnSlot(slot);
          claimsRef.current.set(handIndex, { type: 'chordSlot', slot });
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
      // In mouse mode every control is native — the pinch pipeline only
      // plays melody in the open area (clicks on UI become no-ops here).
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
      // Open air: melody for the right hand (mouse hand is 'Right').
      if (!engine.isRunning || hand.handedness !== 'Right') return;
      const degree = yToDegree(at.y);
      engine.noteOn(0, midiToFreq(melodyMidi(degree)));
      setMelodyDegree(degree);
      claimsRef.current.set(i, { type: 'melody', startX: at.x });
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
      } else if (claim.type === 'melody') {
        const degree = yToDegree(at.y);
        const bend = Math.max(-BEND_RANGE, Math.min(BEND_RANGE, (at.x - claim.startX) / BEND_PX));
        engine.setFreq(0, midiToFreq(melodyMidi(degree) + bend));
        setMelodyDegree(degree);
      } else if (claim.type === 'bpmbar') {
        applyBpm(xToBpm(at.x));
      }
    },
    onPinchEnd: (i) => {
      const claim = claimsRef.current.get(i);
      claimsRef.current.delete(i);
      if (!claim) return;
      if (claim.type === 'melody') {
        engine.noteOff(0);
        setMelodyDegree(null);
      } else if (claim.type === 'chordSlot') {
        chordOffAll();
      }
    },
  });

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

  const hotControls = useMemo(() => {
    const hot = new Set<string>();
    for (const hand of frame.hands) {
      for (const [id, el] of controlsRef.current) {
        if (inRect(el, hand.cursor)) hot.add(id);
      }
    }
    return hot;
  }, [frame]);

  const ruler = useMemo(() => {
    const rows: Array<{ degree: number; name: string; isRoot: boolean }> = [];
    for (let d = degreeCount - 1; d >= 0; d--) {
      const midi = scaleDegreeToMidi(scaleInfo.root, scaleInfo.steps, d, melodyOctave);
      rows.push({ degree: d, name: midiName(midi), isRoot: d % scaleInfo.steps.length === 0 });
    }
    return rows;
  }, [degreeCount, scaleInfo, melodyOctave]);

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

  const cardHold = (slot: number) => ({
    onPointerDown: () => chordOnSlot(slot),
    onPointerUp: () => chordOffAll(),
    onPointerLeave: () => {
      if (activeSlot === slot) chordOffAll();
    },
  });

  const fmtPct = (v: number) => `${Math.round(v * 100)}`;
  const sheetOpen = (id: SheetId) => openSheet === id;
  const btn = (id: string) => ({
    ref: registerControl(id) as unknown as Ref<HTMLButtonElement>,
    onClick: () => pressButton(id),
  });

  return (
    <div className="gw-root" data-testid="instrument">
      {/* ---- Header ---- */}
      <header className="gw-header" ref={registerPanel('header')}>
        <div className="gw-brand">
          <span className="gw-brand-name">HTS_01</span>
          <span className="gw-brand-sub">HAND TRACKED SYNTH // 01</span>
          <span className="gw-micro">
            [INDEX] 000{new Date().getFullYear()} · STATUS ── {audioOn ? 'LIVE' : 'STANDBY'}
          </span>
        </div>
        <div className="gw-header-right">
          <span className="gw-micro gw-micro-right">
            {drumPlaying ? `⊕ ${GENRES[genre].label} / ${bpm} BPM` : '⊘ SEQ IDLE'}
            <br />CH:02 · VECTOR PATH ─ STABLE
          </span>
          <button
            className={`gw-power ${audioOn ? 'gw-power-on' : ''}`}
            data-testid="power"
            {...btn('power')}
          >
            <span className="gw-power-led" />
            {audioOn ? 'live' : 'power'}
          </button>
        </div>
      </header>

      {/* ---- Chord cards (left) ---- */}
      <div className="gw-chords" ref={registerPanel('chordcards')}>
        <span className="gw-micro">LEFT HAND // CHORD BANK</span>
        {chordSlots.map((slot, k) => (
          <button
            key={k}
            className={`gw-card ${activeSlot === k ? 'gw-card-live' : ''} ${hotControls.has(`card:${k}`) ? 'gw-hot' : ''}`}
            ref={registerControl(`card:${k}`) as unknown as Ref<HTMLButtonElement>}
            data-testid={`card-${k}`}
            {...cardHold(k)}
          >
            <span className="gw-card-finger">[{FINGER_LABEL[k]}]</span>
            <span className="gw-card-name">{chordName(slot)}</span>
            <span className="gw-card-id">0{k + 1} ▸ {NOTE_NAMES[slot.root]}·{quality(slot.quality).scaleName.slice(0, 3)}</span>
          </button>
        ))}
      </div>

      {/* ---- Melody ruler (right) ---- */}
      <div className="gw-ruler-wrap" ref={registerPanel('ruler')}>
        <button className={`gw-mode ${hotControls.has('mode') ? 'gw-hot' : ''}`} data-testid="mode-toggle" {...btn('mode')}>
          {melodyMode === 'auto' ? `AUTO · ${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name.toUpperCase()}` : 'FREE · CHROMATIC'}
        </button>
        <div className="gw-ruler" data-testid="ruler">
          {ruler.map((row) => (
            <div
              key={row.degree}
              className={`gw-ruler-row ${melodyDegree === row.degree ? 'gw-ruler-hit' : ''} ${row.isRoot ? 'gw-ruler-root' : ''}`}
            >
              <span className="gw-ruler-name">{row.name}</span>
              <span className="gw-ruler-tick" />
            </div>
          ))}
        </div>
        <span className="gw-micro">RIGHT HAND // PINCH = PLAY</span>
      </div>

      {/* ---- Tab rail ---- */}
      <nav className="gw-rail" ref={registerPanel('rail')}>
        <span className="gw-micro gw-rail-micro">MENU</span>
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
        <span className="gw-micro gw-rail-micro">EGH-9320</span>
      </nav>

      {/* ---- Sheets ---- */}
      <aside className={`gw-sheet ${openSheet ? 'gw-sheet-open' : ''}`} ref={registerPanel('sheet')}>
        {openSheet === 'beat' && (
          <div className="gw-sheet-body" data-testid="sheet-beat">
            <h3 className="gw-sheet-title">⊕ BEAT — SEQ.16</h3>
            <button
              className={`gw-play ${drumPlaying ? 'gw-active' : ''} ${hotControls.has('drum:toggle') ? 'gw-hot' : ''}`}
              data-testid="drum-toggle"
              {...btn('drum:toggle')}
            >
              {drumPlaying ? '■ STOP' : '▶ PLAY'}
            </button>
            <span className="gw-sheet-label">PATTERN // +BASS ON ROOT</span>
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
            <span className="gw-sheet-label">TEMPO ── {bpm} BPM</span>
            <div
              className="gw-bpm-bar"
              ref={registerControl('bpm:bar') as unknown as Ref<HTMLDivElement>}
              data-testid="bpm-bar"
              onPointerDown={onBpmPointerDown}
              onPointerMove={onBpmPointerMove}
              onPointerUp={onBpmPointerUp}
            >
              <div
                className="gw-bpm-fill"
                style={{ width: `${((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN)) * 100}%` }}
              />
            </div>
            <div className="gw-oct-row">
              <button className="gw-pill" data-testid="bpm-down" {...btn('bpm:down')}>−</button>
              <span className="gw-oct-val" data-testid="bpm-val">{bpm}</span>
              <button className="gw-pill" data-testid="bpm-up" {...btn('bpm:up')}>+</button>
            </div>
            <p className="gw-sheet-note">8-BIT KIT · SYNTH BASS FOLLOWS CHORD ROOT · NO SAMPLES</p>
          </div>
        )}
        {openSheet === 'chords' && (
          <div className="gw-sheet-body" data-testid="sheet-chords">
            <h3 className="gw-sheet-title">⊕ CHORDS — BANK.04</h3>
            <span className="gw-sheet-label">PROGRESSIONS</span>
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
            <span className="gw-sheet-label">EDIT SLOT</span>
            <div className="gw-slot-row">
              {chordSlots.map((slot, k) => (
                <button
                  key={k}
                  className={`gw-pill ${editSlot === k ? 'gw-active' : ''} ${hotControls.has(`slotedit:${k}`) ? 'gw-hot' : ''}`}
                  data-testid={`slotedit-${k}`}
                  {...btn(`slotedit:${k}`)}
                >
                  {chordName(slot)}
                </button>
              ))}
            </div>
            <span className="gw-sheet-label">ROOT</span>
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
            <span className="gw-sheet-label">QUALITY</span>
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
            <p className="gw-sheet-note">
              MELODY AUTO-LOCKS ▸ {NOTE_NAMES[chordSlots[editSlot].root]} {quality(chordSlots[editSlot].quality).scaleName.toUpperCase()}
            </p>
          </div>
        )}
        {openSheet === 'sound' && (
          <div className="gw-sheet-body" data-testid="sheet-sound">
            <h3 className="gw-sheet-title">⊕ SOUND — OSC.2</h3>
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
            <span className="gw-sheet-label">MELODY OCTAVE</span>
            <div className="gw-oct-row">
              <button className="gw-pill" data-testid="oct-down" {...btn('oct:down')}>−</button>
              <span className="gw-oct-val" data-testid="oct-val">{melodyOctave}</span>
              <button className="gw-pill" data-testid="oct-up" {...btn('oct:up')}>+</button>
            </div>
            <p className="gw-sheet-note">PINCH + TWIST WRIST · MOUSE: DRAG VERTICALLY</p>
          </div>
        )}
        {openSheet === 'cam' && (
          <div className="gw-sheet-body" data-testid="sheet-cam">
            <h3 className="gw-sheet-title">⊕ TRACK — EGH.9320</h3>
            <div className="gw-cam-row">
              <button
                className={`gw-pill ${hotControls.has('source') ? 'gw-hot' : ''}`}
                data-testid="source-toggle"
                {...btn('source')}
              >
                {source === 'camera' ? 'CAMERA' : 'MOUSE'}
              </button>
              <span className="gw-dim">{status.toUpperCase()}</span>
              <span className="gw-dim">{fps} FPS</span>
            </div>
            <p className="gw-sheet-note">
              ALL TRACKING RUNS LOCALLY // THE FEED NEVER LEAVES THIS DEVICE
            </p>
          </div>
        )}
      </aside>

      {/* ---- Scope + hint ---- */}
      <div className="gw-scope-dock" ref={registerPanel('scope')}>
        <Scope engine={engine} />
        <span className="gw-micro">OUTPUT: ANALOG ∿ RATE: CONSTANT</span>
      </div>
      <footer className="gw-hint" ref={registerPanel('hint')}>
        {audioOn ? (
          <>R.HAND PINCH = MELODY // L.HAND THUMB+FINGER = CHORDS // PULL SIDEWAYS = BEND</>
        ) : (
          <>PRESS POWER TO ARM{source === 'mouse' ? ' // MOUSE MODE: CLICK = PINCH' : ' // RAISE BOTH HANDS'}</>
        )}
      </footer>

      {/* ---- White frame ---- */}
      <div className="gw-frame" aria-hidden />
      <span className="gw-frame-cross gw-fc-tl" aria-hidden>+</span>
      <span className="gw-frame-cross gw-fc-br" aria-hidden>+</span>
    </div>
  );
}
