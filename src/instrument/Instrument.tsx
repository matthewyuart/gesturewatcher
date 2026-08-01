import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
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
import { CamTile } from './CamTile';
import './Instrument.css';

type Claim =
  | { type: 'knob'; param: keyof SynthParams; startY: number; startVal: number; startRoll: number; twist: boolean }
  | { type: 'melody'; startX: number }
  | { type: 'chordSlot'; slot: number }
  | { type: 'pressed' };

type SheetId = 'beat' | 'chords' | 'sound' | 'cam';

const WAVES: WaveKind[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_LABEL: Record<WaveKind, string> = {
  sawtooth: 'saw',
  square: 'sqr',
  triangle: 'tri',
  sine: 'sin',
};
const KNOB_ORDER: Array<{ param: keyof SynthParams; label: string }> = [
  { param: 'cutoff', label: 'FILTER' },
  { param: 'resonance', label: 'RES' },
  { param: 'attack', label: 'ATTACK' },
  { param: 'release', label: 'RELEASE' },
  { param: 'echo', label: 'ECHO' },
  { param: 'volume', label: 'VOLUME' },
];
const FINGER_LABEL = ['index', 'middle', 'ring', 'pinky'];
const SHEETS: Array<{ id: SheetId; label: string }> = [
  { id: 'beat', label: 'beat' },
  { id: 'chords', label: 'chords' },
  { id: 'sound', label: 'sound' },
  { id: 'cam', label: 'cam' },
];

const BEND_RANGE = 2;
const BEND_PX = 150;
const TWIST_FULL = (Math.PI * 3) / 4;
const CHORD_OCTAVE = 3;

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

  const [chordSlots, setChordSlots] = useState<ChordSlot[]>([
    { root: 0, quality: 'maj7' },   // Cmaj7
    { root: 9, quality: 'min7' },   // Am7
    { root: 5, quality: 'maj7' },   // Fmaj7
    { root: 7, quality: 'dom7' },   // G7
  ]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [lastSlot, setLastSlot] = useState(0);
  const [editSlot, setEditSlot] = useState(0);

  const [openSheet, setOpenSheet] = useState<SheetId | null>(null);
  const [drumPlaying, setDrumPlaying] = useState(false);
  const [genre, setGenre] = useState<GenreId>('lofi');
  const [bpm, setBpm] = useState(GENRES.lofi.bpm);

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

  const stateRef = useRef({ scaleInfo, degreeCount, melodyOctave, chordSlots });
  stateRef.current = { scaleInfo, degreeCount, melodyOctave, chordSlots };

  useEffect(() => {
    setMelodyDegree((d) => (d !== null && d >= degreeCount ? degreeCount - 1 : d));
  }, [degreeCount]);

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
        if (bus && !drumRef.current) drumRef.current = new DrumMachine(bus.ctx, bus.dest);
      })
      .catch(() => setAudioOn(false));
  }, [engine]);

  const chordOnSlot = useCallback(
    (slot: number) => {
      const s = stateRef.current;
      engine.chordOn(chordMidis(s.chordSlots[slot], CHORD_OCTAVE).map(midiToFreq));
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
      chords: stateRef.current.chordSlots.map(chordName),
      scale: `${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}`,
      degreeCount,
    });
  }, [engine, audioOn, openSheet, melodyMode, scaleInfo, degreeCount]);

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
      const drum = drumRef.current;
      if (id === 'power') {
        powerOn();
      } else if (id.startsWith('knob:')) {
        const param = id.slice(5) as keyof SynthParams;
        claimsRef.current.set(handIndex, {
          type: 'knob', param, startY: at.y,
          startVal: engine.params[param], startRoll: roll, twist: hasLandmarks,
        });
        return;
      } else if (id.startsWith('card:')) {
        const slot = Number(id.slice(5));
        if (engine.isRunning) {
          chordOnSlot(slot);
          claimsRef.current.set(handIndex, { type: 'chordSlot', slot });
          return;
        }
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
        const delta = id === 'bpm:up' ? 4 : -4;
        setBpm((b) => {
          const next = Math.min(160, Math.max(50, b + delta));
          drum?.setBpm(next);
          return next;
        });
      } else if (id.startsWith('slotedit:')) {
        setEditSlot(Number(id.slice(9)));
      } else if (id.startsWith('root:')) {
        const root = Number(id.slice(5));
        setChordSlots((prev) => prev.map((c, k) => (k === editSlot ? { ...c, root } : c)));
      } else if (id.startsWith('qual:')) {
        const q = id.slice(5) as QualityId;
        setChordSlots((prev) => prev.map((c, k) => (k === editSlot ? { ...c, quality: q } : c)));
      } else if (id === 'source') {
        setSource(source === 'camera' ? 'mouse' : 'camera');
      }
      claimsRef.current.set(handIndex, { type: 'pressed' });
    },
    [engine, powerOn, chordOnSlot, editSlot, setSource, source],
  );

  useHandEvents({
    onPinchStart: (i, at, hand) => {
      const control = hitControl(at);
      if (control) {
        applyControl(control, i, at, hand.roll, hand.landmarks.length === 21);
        return;
      }
      if (overAnyPanel(at)) {
        claimsRef.current.set(i, { type: 'pressed' });
        return;
      }
      // Open air: melody for the right hand (mouse hand is 'Right').
      // The left hand's index pinch is chord 1 — handled by the touch effect.
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
        // Index finger doubles as the UI pinch — skip it while claimed.
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
    // Hand vanished mid-chord.
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

  const fmtPct = (v: number) => `${Math.round(v * 100)}`;
  const sheetOpen = (id: SheetId) => openSheet === id;

  return (
    <div className="gw-root" data-testid="instrument">
      {/* ---- Header ---- */}
      <header className="gw-header" ref={registerPanel('header')}>
        <div className="gw-brand">
          <span className="gw-brand-name">Programma GW-1</span>
          <span className="gw-brand-sub">
            {drumPlaying ? `${GENRES[genre].label.toLowerCase()} · ${bpm} bpm` : 'gesture instrument'}
          </span>
        </div>
        <button
          className={`gw-power ${audioOn ? 'gw-power-on' : ''}`}
          onClick={powerOn}
          ref={registerControl('power') as unknown as Ref<HTMLButtonElement>}
          data-testid="power"
        >
          {audioOn ? 'live' : 'power'}
        </button>
      </header>

      {/* ---- Chord cards (left) ---- */}
      <div className="gw-chords" ref={registerPanel('chordcards')}>
        <span className="gw-col-label">left hand · thumb +</span>
        {chordSlots.map((slot, k) => (
          <button
            key={k}
            className={`gw-card ${activeSlot === k ? 'gw-card-live' : ''} ${hotControls.has(`card:${k}`) ? 'gw-hot' : ''}`}
            ref={registerControl(`card:${k}`) as unknown as Ref<HTMLButtonElement>}
            data-testid={`card-${k}`}
          >
            <span className="gw-card-finger">{FINGER_LABEL[k]}</span>
            <span className="gw-card-name">{chordName(slot)}</span>
          </button>
        ))}
      </div>

      {/* ---- Melody ruler (right) ---- */}
      <div className="gw-ruler-wrap" ref={registerPanel('ruler')}>
        <button
          className={`gw-mode ${hotControls.has('mode') ? 'gw-hot' : ''}`}
          ref={registerControl('mode') as unknown as Ref<HTMLButtonElement>}
          data-testid="mode-toggle"
        >
          {melodyMode === 'auto' ? `auto · ${NOTE_NAMES[scaleInfo.root]} ${scaleInfo.name}` : 'free · chromatic'}
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
        <span className="gw-col-label">right hand · pinch = play</span>
      </div>

      {/* ---- Tab rail ---- */}
      <nav className="gw-rail" ref={registerPanel('rail')}>
        {SHEETS.map((s) => (
          <button
            key={s.id}
            className={`gw-tab ${sheetOpen(s.id) ? 'gw-tab-open' : ''} ${hotControls.has(`tab:${s.id}`) ? 'gw-hot' : ''}`}
            ref={registerControl(`tab:${s.id}`) as unknown as Ref<HTMLButtonElement>}
            data-testid={`tab-${s.id}`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* ---- Sheets ---- */}
      <aside className={`gw-sheet ${openSheet ? 'gw-sheet-open' : ''}`} ref={registerPanel('sheet')}>
        {openSheet === 'beat' && drum(
          drumPlaying, genre, bpm, registerControl, hotControls,
        )}
        {openSheet === 'chords' && (
          <div className="gw-sheet-body" data-testid="sheet-chords">
            <h3 className="gw-sheet-title">chords</h3>
            <div className="gw-slot-row">
              {chordSlots.map((slot, k) => (
                <button
                  key={k}
                  className={`gw-pill ${editSlot === k ? 'gw-active' : ''} ${hotControls.has(`slotedit:${k}`) ? 'gw-hot' : ''}`}
                  ref={registerControl(`slotedit:${k}`) as unknown as Ref<HTMLButtonElement>}
                  data-testid={`slotedit-${k}`}
                >
                  {chordName(slot)}
                </button>
              ))}
            </div>
            <span className="gw-sheet-label">root</span>
            <div className="gw-root-grid">
              {NOTE_NAMES.map((n, i) => (
                <button
                  key={n}
                  className={`gw-pill ${chordSlots[editSlot].root === i ? 'gw-active' : ''} ${hotControls.has(`root:${i}`) ? 'gw-hot' : ''}`}
                  ref={registerControl(`root:${i}`) as unknown as Ref<HTMLButtonElement>}
                  data-testid={`root-${i}`}
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
                  ref={registerControl(`qual:${q.id}`) as unknown as Ref<HTMLButtonElement>}
                  data-testid={`qual-${q.id}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="gw-sheet-note">
              melody auto-locks to {NOTE_NAMES[chordSlots[editSlot].root]} {quality(chordSlots[editSlot].quality).scaleName} over this chord
            </p>
          </div>
        )}
        {openSheet === 'sound' && (
          <div className="gw-sheet-body" data-testid="sheet-sound">
            <h3 className="gw-sheet-title">sound</h3>
            <div className="gw-wave-row">
              {WAVES.map((w) => (
                <button
                  key={w}
                  className={`gw-pill ${wave === w ? 'gw-active' : ''} ${hotControls.has(`wave:${w}`) ? 'gw-hot' : ''}`}
                  ref={registerControl(`wave:${w}`) as unknown as Ref<HTMLButtonElement>}
                  data-testid={`wave-${w}`}
                >
                  {WAVE_LABEL[w]}
                </button>
              ))}
            </div>
            <div className="gw-knob-grid">
              {KNOB_ORDER.map(({ param, label }) => (
                <Knob
                  key={param}
                  label={label}
                  value={params[param]}
                  readout={fmtPct(params[param])}
                  hot={hotControls.has(`knob:${param}`)}
                  registerRef={registerControl(`knob:${param}`)}
                />
              ))}
            </div>
            <span className="gw-sheet-label">melody octave</span>
            <div className="gw-oct-row">
              <button className="gw-pill" ref={registerControl('oct:down') as unknown as Ref<HTMLButtonElement>} data-testid="oct-down">−</button>
              <span className="gw-oct-val" data-testid="oct-val">{melodyOctave}</span>
              <button className="gw-pill" ref={registerControl('oct:up') as unknown as Ref<HTMLButtonElement>} data-testid="oct-up">+</button>
            </div>
            <p className="gw-sheet-note">pinch a knob, then twist your wrist</p>
          </div>
        )}
        {openSheet === 'cam' && (
          <div className="gw-sheet-body" data-testid="sheet-cam">
            <h3 className="gw-sheet-title">camera</h3>
            <CamTile />
            <div className="gw-cam-row">
              <button
                className={`gw-pill ${hotControls.has('source') ? 'gw-hot' : ''}`}
                ref={registerControl('source') as unknown as Ref<HTMLButtonElement>}
                onClick={() => setSource(source === 'camera' ? 'mouse' : 'camera')}
                data-testid="source-toggle"
              >
                {source === 'camera' ? 'camera' : 'mouse'}
              </button>
              <span className="gw-dim">{status}</span>
              <span className="gw-dim">{fps} fps</span>
            </div>
            <p className="gw-sheet-note">
              tracking runs locally in your browser — the feed never leaves this device
            </p>
          </div>
        )}
      </aside>

      {/* ---- Scope + hint ---- */}
      <div className="gw-scope-dock" ref={registerPanel('scope')}>
        <Scope engine={engine} />
      </div>
      <footer className="gw-hint" ref={registerPanel('hint')}>
        {audioOn ? (
          <>right hand pinch = melody · left hand thumb+finger = chords · pull sideways = bend</>
        ) : (
          <>press power to arm{source === 'mouse' ? ' · mouse mode: click = pinch' : ''}</>
        )}
      </footer>
    </div>
  );

  function drum(
    playing: boolean,
    g: GenreId,
    tempo: number,
    reg: (id: string) => (el: HTMLElement | null) => void,
    hot: Set<string>,
  ) {
    return (
      <div className="gw-sheet-body" data-testid="sheet-beat">
        <h3 className="gw-sheet-title">beat</h3>
        <button
          className={`gw-play ${playing ? 'gw-active' : ''} ${hot.has('drum:toggle') ? 'gw-hot' : ''}`}
          ref={reg('drum:toggle') as unknown as Ref<HTMLButtonElement>}
          data-testid="drum-toggle"
        >
          {playing ? 'stop' : 'play'}
        </button>
        <span className="gw-sheet-label">pattern</span>
        <div className="gw-genre-list">
          {(Object.keys(GENRES) as GenreId[]).map((id) => (
            <button
              key={id}
              className={`gw-pill gw-genre ${g === id ? 'gw-active' : ''} ${hot.has(`genre:${id}`) ? 'gw-hot' : ''}`}
              ref={reg(`genre:${id}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`genre-${id}`}
            >
              <span>{GENRES[id].label.toLowerCase()}</span>
              <span className="gw-dim">{GENRES[id].bpm}</span>
            </button>
          ))}
        </div>
        <span className="gw-sheet-label">tempo</span>
        <div className="gw-oct-row">
          <button className="gw-pill" ref={reg('bpm:down') as unknown as Ref<HTMLButtonElement>} data-testid="bpm-down">−</button>
          <span className="gw-oct-val" data-testid="bpm-val">{tempo} bpm</span>
          <button className="gw-pill" ref={reg('bpm:up') as unknown as Ref<HTMLButtonElement>} data-testid="bpm-up">+</button>
        </div>
        <p className="gw-sheet-note">8-bit patterns, synthesized live — no samples</p>
      </div>
    );
  }
}
