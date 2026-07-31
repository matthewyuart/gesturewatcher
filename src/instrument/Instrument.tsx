import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Hand, Point } from '../gesture/types';
import { SynthEngine, type SynthParams, type WaveKind } from '../audio/SynthEngine';
import {
  chordMidis,
  degreeToMidi,
  midiName,
  midiToFreq,
  NOTE_NAMES,
  SCALES,
  type Extensions,
  type ScaleId,
} from '../audio/theory';
import { Knob } from './Knob';
import { Scope } from './Scope';
import './Instrument.css';

type Claim =
  | { type: 'knob'; param: keyof SynthParams; startY: number; startVal: number }
  | { type: 'melody'; startX: number }
  | { type: 'chord' }
  | { type: 'pressed' };

const WAVES: WaveKind[] = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_GLYPH: Record<WaveKind, string> = {
  sawtooth: '⋀⋀',
  square: '⊓⊔',
  triangle: '∿∿',
  sine: '∼∼',
};
const KNOB_ORDER: Array<{ param: keyof SynthParams; label: string }> = [
  { param: 'cutoff', label: 'FILTER' },
  { param: 'resonance', label: 'RES' },
  { param: 'attack', label: 'ATTACK' },
  { param: 'release', label: 'RELEASE' },
  { param: 'echo', label: 'ECHO' },
  { param: 'volume', label: 'VOLUME' },
];

const BEND_RANGE = 2; // semitones at full horizontal deflection
const BEND_PX = 150;

function inRect(el: Element | null, p: Point): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

export default function Instrument() {
  const { frame, status, source, fps, setSource } = useGestures();
  const engineRef = useRef<SynthEngine | null>(null);
  if (!engineRef.current) engineRef.current = new SynthEngine();
  const engine = engineRef.current;

  const [audioOn, setAudioOn] = useState(false);
  const [params, setParams] = useState<SynthParams>({ ...engine.params });
  const [wave, setWaveState] = useState<WaveKind>('sawtooth');
  const [keyIndex, setKeyIndex] = useState(0); // C
  const [scaleId, setScaleId] = useState<ScaleId>('minor');
  const [octave, setOctave] = useState(4);
  const [ext, setExt] = useState<Extensions>({
    sixth: false,
    seventh: true,
    ninth: false,
    sus4: false,
  });
  const [lastNote, setLastNote] = useState<string>('—');
  const [melodyDegree, setMelodyDegree] = useState<number | null>(null);
  const [chordLit, setChordLit] = useState(false);

  const claimsRef = useRef(new Map<number, Claim>());
  const controlsRef = useRef(new Map<string, HTMLElement>());
  const panelsRef = useRef(new Map<string, HTMLElement>());
  const melodyStateRef = useRef({ degree: 0, midi: 60 });

  // Keep latest musical settings visible to event handlers without re-subscribing.
  const settings = { keyIndex, scaleId, octave, ext };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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

  const scaleLen = SCALES[scaleId].steps.length;
  const degreeCount = scaleLen * 2 + 1;

  const yToDegree = useCallback(
    (y: number): number => {
      const yn = Math.min(1, Math.max(0, (y / window.innerHeight - 0.1) / 0.78));
      return Math.round((1 - yn) * (degreeCount - 1));
    },
    [degreeCount],
  );

  const powerOn = useCallback(() => {
    void engine.start().then(() => {
      setAudioOn(engine.isRunning);
    }).catch(() => setAudioOn(false));
  }, [engine]);

  // Debug hook for headless verification.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__synth = () => engine.getDebugState();
    w.__synthEngine = engine;
    w.__synthUi = () => ({ ...settingsRef.current, audioOn });
    w.__controls = () =>
      Object.fromEntries(
        [...controlsRef.current].map(([id, el]) => {
          const r = el.getBoundingClientRect();
          return [id, [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]];
        }),
      );
  }, [engine, audioOn]);

  // Hand roles: 'Right' hand plays melody, 'Left' sweeps filter / plays chords.
  const roleOf = useCallback(
    (hands: Hand[], i: number): 'melody' | 'expression' => {
      const rightIdx = hands.findIndex((h) => h.handedness === 'Right');
      const melodyIdx = rightIdx >= 0 ? rightIdx : 0;
      return i === melodyIdx ? 'melody' : 'expression';
    },
    [],
  );

  const overAnyPanel = useCallback((p: Point): boolean => {
    for (const el of panelsRef.current.values()) if (inRect(el, p)) return true;
    return false;
  }, []);

  const hitControl = useCallback((p: Point): string | null => {
    for (const [id, el] of controlsRef.current) if (inRect(el, p)) return id;
    return null;
  }, []);

  const applyControl = useCallback(
    (id: string, handIndex: number, at: Point) => {
      if (id === 'power') {
        powerOn();
      } else if (id.startsWith('knob:')) {
        const param = id.slice(5) as keyof SynthParams;
        claimsRef.current.set(handIndex, {
          type: 'knob',
          param,
          startY: at.y,
          startVal: engine.params[param],
        });
        return;
      } else if (id.startsWith('wave:')) {
        const w = id.slice(5) as WaveKind;
        engine.setWave(w);
        setWaveState(w);
      } else if (id.startsWith('key:')) {
        setKeyIndex(Number(id.slice(4)));
      } else if (id.startsWith('scale:')) {
        setScaleId(id.slice(6) as ScaleId);
      } else if (id === 'oct:down') {
        setOctave((o) => Math.max(2, o - 1));
      } else if (id === 'oct:up') {
        setOctave((o) => Math.min(6, o + 1));
      } else if (id.startsWith('ext:')) {
        const name = id.slice(4) as keyof Extensions;
        setExt((e) => ({ ...e, [name]: !e[name] }));
      } else if (id === 'source') {
        setSource(source === 'camera' ? 'mouse' : 'camera');
      }
      claimsRef.current.set(handIndex, { type: 'pressed' });
    },
    [engine, powerOn, setSource, source],
  );

  useHandEvents({
    onPinchStart: (i, at) => {
      const control = hitControl(at);
      if (control) {
        applyControl(control, i, at);
        return;
      }
      if (overAnyPanel(at)) {
        claimsRef.current.set(i, { type: 'pressed' });
        return;
      }
      if (!engine.isRunning) return;
      const s = settingsRef.current;
      if (roleOf(frame.hands, i) === 'melody') {
        const degree = yToDegree(at.y);
        const midi = degreeToMidi(s.keyIndex, s.scaleId, degree, s.octave);
        melodyStateRef.current = { degree, midi };
        engine.noteOn(midiToFreq(midi));
        setLastNote(midiName(midi));
        setMelodyDegree(degree);
        claimsRef.current.set(i, { type: 'melody', startX: at.x });
      } else {
        const midis = chordMidis(s.keyIndex, s.scaleId, s.ext, s.octave - 1);
        engine.chordOn(midis.map(midiToFreq));
        setChordLit(true);
        claimsRef.current.set(i, { type: 'chord' });
      }
    },
    onPinchMove: (i, at) => {
      const claim = claimsRef.current.get(i);
      if (!claim) return;
      if (claim.type === 'knob') {
        const val = claim.startVal + (claim.startY - at.y) / 220;
        engine.setParam(claim.param, val);
        setParams({ ...engine.params });
      } else if (claim.type === 'melody') {
        const s = settingsRef.current;
        const degree = yToDegree(at.y);
        const midi = degreeToMidi(s.keyIndex, s.scaleId, degree, s.octave);
        melodyStateRef.current = { degree, midi };
        const bend = Math.max(-BEND_RANGE, Math.min(BEND_RANGE, (at.x - claim.startX) / BEND_PX));
        engine.setFreq(midiToFreq(midi + bend));
        setLastNote(midiName(midi));
        setMelodyDegree(degree);
      }
    },
    onPinchEnd: (i) => {
      const claim = claimsRef.current.get(i);
      claimsRef.current.delete(i);
      if (!claim) return;
      if (claim.type === 'melody') {
        engine.noteOff();
        setMelodyDegree(null);
      } else if (claim.type === 'chord') {
        engine.chordOff();
        setChordLit(false);
      }
    },
  });

  // Per-frame: expression hand sweeps the filter with height (no pinch needed).
  useEffect(() => {
    if (!engine.isRunning || frame.hands.length === 0) return;
    frame.hands.forEach((hand, i) => {
      if (claimsRef.current.has(i)) return;
      if (roleOf(frame.hands, i) !== 'expression') return;
      if (overAnyPanel(hand.cursor)) return;
      const norm = 1 - Math.min(1, Math.max(0, (hand.cursor.y / window.innerHeight - 0.1) / 0.78));
      engine.sweepCutoff(norm);
      setParams((p) => (Math.abs(p.cutoff - norm) > 0.005 ? { ...p, cutoff: norm } : p));
    });
  }, [frame, engine, roleOf, overAnyPanel]);

  // Hover detection for glow states.
  const hotControls = useMemo(() => {
    const hot = new Set<string>();
    for (const hand of frame.hands) {
      for (const [id, el] of controlsRef.current) {
        if (inRect(el, hand.cursor)) hot.add(id);
      }
    }
    return hot;
  }, [frame]);

  // Pitch ladder entries, top = highest.
  const ladder = useMemo(() => {
    const rows: Array<{ degree: number; name: string }> = [];
    for (let d = degreeCount - 1; d >= 0; d--) {
      rows.push({ degree: d, name: midiName(degreeToMidi(keyIndex, scaleId, d, octave)) });
    }
    return rows;
  }, [degreeCount, keyIndex, scaleId, octave]);

  const fmtPct = (v: number) => `${Math.round(v * 100)}`;

  return (
    <div className="gw-root" data-testid="instrument">
      {/* ---- Top strip: brand, scope, power, status ---- */}
      <section className="gw-panel gw-top" ref={registerPanel('top')}>
        <div className="gw-brand">
          <span className="gw-brand-name">Programma GW-1</span>
          <span className="gw-brand-sub">gesture synthesizer</span>
        </div>
        <div className="gw-scope-wrap">
          <Scope engine={engine} />
          <span className="gw-scope-note" data-testid="note-readout">{lastNote}</span>
        </div>
        <button
          className={`gw-power ${audioOn ? 'gw-power-on' : ''}`}
          onClick={powerOn}
          ref={registerControl('power') as unknown as Ref<HTMLButtonElement>}
          data-testid="power"
        >
          <span className="gw-power-led" />
          {audioOn ? 'live' : 'power'}
        </button>
        <div className="gw-status">
          <button className="gw-chip" onClick={() => setSource(source === 'camera' ? 'mouse' : 'camera')}>
            {source === 'camera' ? 'camera' : 'mouse'}
          </button>
          <span className="gw-chip gw-chip-dim">{status}</span>
          <span className="gw-chip gw-chip-dim">{fps}fps</span>
        </div>
      </section>

      {/* ---- Left panel: SYNTH ---- */}
      <section className="gw-panel gw-left" ref={registerPanel('left')}>
        <h3 className="gw-panel-title">synth <span className="gw-formula">δ₂ F(n,f)</span></h3>
        <div className="gw-waves">
          {WAVES.map((w) => (
            <button
              key={w}
              className={`gw-wave ${wave === w ? 'gw-active' : ''} ${hotControls.has(`wave:${w}`) ? 'gw-hot' : ''}`}
              ref={registerControl(`wave:${w}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`wave-${w}`}
            >
              {WAVE_GLYPH[w]}
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
        <div className="gw-silkscreen">
          f<sub>osc</sub> = f·2<sup>b/12</sup> · · · · · ▸ lp24
        </div>
      </section>

      {/* ---- Right panel: KEY ---- */}
      <section className="gw-panel gw-right" ref={registerPanel('right')}>
        <h3 className="gw-panel-title">key <span className="gw-formula">lim<sub>x→∂</sub></span></h3>
        <div className="gw-keys">
          {NOTE_NAMES.map((n, i) => (
            <button
              key={n}
              className={`gw-key ${i === keyIndex ? 'gw-active' : ''} ${hotControls.has(`key:${i}`) ? 'gw-hot' : ''} ${n.includes('#') ? 'gw-key-sharp' : ''}`}
              ref={registerControl(`key:${i}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`key-${i}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="gw-scales">
          {(Object.keys(SCALES) as ScaleId[]).map((id) => (
            <button
              key={id}
              className={`gw-scale ${scaleId === id ? 'gw-active' : ''} ${hotControls.has(`scale:${id}`) ? 'gw-hot' : ''}`}
              ref={registerControl(`scale:${id}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`scale-${id}`}
            >
              <span className="gw-led" />
              {SCALES[id].label}
            </button>
          ))}
        </div>
        <div className="gw-oct">
          <button
            className={`gw-oct-btn ${hotControls.has('oct:down') ? 'gw-hot' : ''}`}
            ref={registerControl('oct:down') as unknown as Ref<HTMLButtonElement>}
            data-testid="oct-down"
          >
            −
          </button>
          <span className="gw-oct-val" data-testid="oct-val">oct {octave}</span>
          <button
            className={`gw-oct-btn ${hotControls.has('oct:up') ? 'gw-hot' : ''}`}
            ref={registerControl('oct:up') as unknown as Ref<HTMLButtonElement>}
            data-testid="oct-up"
          >
            +
          </button>
        </div>
        <h4 className="gw-panel-sub">chord ext <span className={`gw-led gw-led-lg ${chordLit ? 'gw-led-on' : ''}`} data-testid="chord-led" /></h4>
        <div className="gw-exts">
          {(['sixth', 'seventh', 'ninth', 'sus4'] as const).map((name) => (
            <button
              key={name}
              className={`gw-ext ${ext[name] ? 'gw-active' : ''} ${hotControls.has(`ext:${name}`) ? 'gw-hot' : ''}`}
              ref={registerControl(`ext:${name}`) as unknown as Ref<HTMLButtonElement>}
              data-testid={`ext-${name}`}
            >
              <span className="gw-led" />
              {{ sixth: '6th', seventh: '7th', ninth: '9th', sus4: 'sus4' }[name]}
            </button>
          ))}
        </div>
        <div className="gw-silkscreen">⊕ regen mix ∂ · · · ▸ {NOTE_NAMES[keyIndex]} {SCALES[scaleId].label.toLowerCase()}</div>
      </section>

      {/* ---- Pitch ladder ---- */}
      <div className="gw-ladder" aria-hidden>
        {ladder.map((row) => (
          <div
            key={row.degree}
            className={`gw-ladder-row ${melodyDegree === row.degree ? 'gw-ladder-hit' : ''}`}
          >
            <span className="gw-ladder-tick" />
            {row.name}
          </div>
        ))}
      </div>

      {/* ---- Bottom hint ---- */}
      <footer className="gw-panel gw-hint" ref={registerPanel('hint')}>
        {audioOn ? (
          <>
            <b>right hand</b> height = note · pinch = play · drift sideways = bend
            <span className="gw-hint-sep">◆</span>
            <b>left hand</b> height = filter · pinch = chord
          </>
        ) : (
          <>press <b>power</b> to arm the synthesizer {source === 'camera' ? '· then raise your hands' : '· mouse mode: click = pinch'}</>
        )}
      </footer>
    </div>
  );
}
