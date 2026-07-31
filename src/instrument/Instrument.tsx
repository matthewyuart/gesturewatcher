import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
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
import { Slider } from './Slider';
import { Scope } from './Scope';
import './Instrument.css';

type Claim =
  | { type: 'knob'; param: keyof SynthParams; startY: number; startVal: number; startRoll: number; twist: boolean }
  | { type: 'slider'; which: number; centerX: number }
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

const BEND_RANGE = 2; // semitones at full sideways pull
const BEND_PX = 150;
const TWIST_FULL = (Math.PI * 3) / 4; // 135° of wrist roll = full knob range

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
  const [chordLit, setChordLit] = useState(false);

  const scaleLen = SCALES[scaleId].steps.length;
  const degreeCount = scaleLen * 2 + 1;

  // Per-voice slider state: handle degree, sounding flag.
  const [voiceDegrees, setVoiceDegrees] = useState<number[]>([scaleLen, scaleLen + 2]);
  const [voiceLive, setVoiceLive] = useState<boolean[]>([false, false]);

  const claimsRef = useRef(new Map<number, Claim>());
  const controlsRef = useRef(new Map<string, HTMLElement>());
  const panelsRef = useRef(new Map<string, HTMLElement>());

  const settings = { keyIndex, scaleId, octave, ext };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Clamp slider handles when the scale (degree count) changes.
  useEffect(() => {
    setVoiceDegrees((prev) => prev.map((d) => Math.min(d, degreeCount - 1)));
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
    void engine.start().then(() => {
      setAudioOn(engine.isRunning);
    }).catch(() => setAudioOn(false));
  }, [engine]);

  // Debug hooks for headless verification.
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

  const overAnyPanel = useCallback((p: Point): boolean => {
    for (const el of panelsRef.current.values()) if (inRect(el, p)) return true;
    return false;
  }, []);

  const hitControl = useCallback((p: Point): string | null => {
    for (const [id, el] of controlsRef.current) if (inRect(el, p)) return id;
    return null;
  }, []);

  const sliderDegree = useCallback(
    (which: number, y: number): number => {
      const el = controlsRef.current.get(`slider:${which}`);
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const yn = Math.min(1, Math.max(0, (y - r.top) / r.height));
      return Math.round((1 - yn) * (degreeCount - 1));
    },
    [degreeCount],
  );

  const startSliderVoice = useCallback(
    (which: number, handIndex: number, at: Point) => {
      if (!engine.isRunning) return;
      const s = settingsRef.current;
      const el = controlsRef.current.get(`slider:${which}`);
      const r = el?.getBoundingClientRect();
      const degree = sliderDegree(which, at.y);
      const midi = degreeToMidi(s.keyIndex, s.scaleId, degree, s.octave);
      engine.noteOn(which, midiToFreq(midi));
      setVoiceDegrees((prev) => prev.map((d, i) => (i === which ? degree : d)));
      setVoiceLive((prev) => prev.map((v, i) => (i === which ? true : v)));
      claimsRef.current.set(handIndex, {
        type: 'slider',
        which,
        centerX: r ? r.left + r.width / 2 : at.x,
      });
    },
    [engine, sliderDegree],
  );

  const applyControl = useCallback(
    (id: string, handIndex: number, at: Point, roll: number, hasLandmarks: boolean) => {
      if (id === 'power') {
        powerOn();
      } else if (id.startsWith('slider:')) {
        startSliderVoice(Number(id.slice(7)), handIndex, at);
        return;
      } else if (id.startsWith('knob:')) {
        const param = id.slice(5) as keyof SynthParams;
        claimsRef.current.set(handIndex, {
          type: 'knob',
          param,
          startY: at.y,
          startVal: engine.params[param],
          startRoll: roll,
          twist: hasLandmarks,
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
    [engine, powerOn, setSource, source, startSliderVoice],
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
      // Open air: chord pad (any hand).
      if (!engine.isRunning) return;
      const s = settingsRef.current;
      const midis = chordMidis(s.keyIndex, s.scaleId, s.ext, s.octave - 1);
      engine.chordOn(midis.map(midiToFreq));
      setChordLit(true);
      claimsRef.current.set(i, { type: 'chord' });
    },
    onPinchMove: (i, at, hand) => {
      const claim = claimsRef.current.get(i);
      if (!claim) return;
      if (claim.type === 'knob') {
        // Twist: wrist roll turns the knob. Mouse fallback: vertical drag.
        const val = claim.twist
          ? claim.startVal + normAngle(hand.roll - claim.startRoll) / TWIST_FULL
          : claim.startVal + (claim.startY - at.y) / 220;
        engine.setParam(claim.param, val);
        setParams({ ...engine.params });
      } else if (claim.type === 'slider') {
        const s = settingsRef.current;
        const degree = sliderDegree(claim.which, at.y);
        const midi = degreeToMidi(s.keyIndex, s.scaleId, degree, s.octave);
        const bend = Math.max(
          -BEND_RANGE,
          Math.min(BEND_RANGE, (at.x - claim.centerX) / BEND_PX),
        );
        engine.setFreq(claim.which, midiToFreq(midi + bend));
        setVoiceDegrees((prev) => prev.map((d, k) => (k === claim.which ? degree : d)));
      }
    },
    onPinchEnd: (i) => {
      const claim = claimsRef.current.get(i);
      claimsRef.current.delete(i);
      if (!claim) return;
      if (claim.type === 'slider') {
        engine.noteOff(claim.which);
        setVoiceLive((prev) => prev.map((v, k) => (k === claim.which ? false : v)));
      } else if (claim.type === 'chord') {
        engine.chordOff();
        setChordLit(false);
      }
    },
  });

  // Hover detection for outline highlights.
  const hotControls = useMemo(() => {
    const hot = new Set<string>();
    for (const hand of frame.hands) {
      for (const [id, el] of controlsRef.current) {
        if (inRect(el, hand.cursor)) hot.add(id);
      }
    }
    return hot;
  }, [frame]);

  // Ladder between the two sliders, top = highest degree.
  const ladder = useMemo(() => {
    const rows: Array<{ degree: number; name: string }> = [];
    for (let d = degreeCount - 1; d >= 0; d--) {
      rows.push({ degree: d, name: midiName(degreeToMidi(keyIndex, scaleId, d, octave)) });
    }
    return rows;
  }, [degreeCount, keyIndex, scaleId, octave]);

  const voiceNote = (which: number) =>
    midiName(degreeToMidi(keyIndex, scaleId, voiceDegrees[which] ?? 0, octave));

  const fmtPct = (v: number) => `${Math.round(v * 100)}`;

  return (
    <div className="gw-root" data-testid="instrument">
      {/* ---- Top strip ---- */}
      <section className="gw-panel gw-top" ref={registerPanel('top')}>
        <div className="gw-brand">
          <span className="gw-brand-name">Programma GW-1</span>
          <span className="gw-brand-sub">gesture synthesizer</span>
        </div>
        <div className="gw-scope-wrap">
          <Scope engine={engine} />
          <span className="gw-scope-note" data-testid="note-readout">
            {voiceLive[0] ? voiceNote(0) : '·'} / {voiceLive[1] ? voiceNote(1) : '·'}
          </span>
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
        <div className="gw-silkscreen">pinch + twist wrist · f·2<sup>b/12</sup></div>
      </section>

      {/* ---- Center: two pitch sliders + ladder ---- */}
      <div className="gw-sliders">
        <Slider
          index={0}
          degree={voiceDegrees[0]}
          degreeCount={degreeCount}
          noteName={voiceNote(0)}
          playing={voiceLive[0]}
          hot={hotControls.has('slider:0')}
          registerRef={registerControl('slider:0')}
        />
        <div className="gw-ladder" aria-hidden>
          {ladder.map((row) => (
            <div
              key={row.degree}
              className={`gw-ladder-row ${
                (voiceLive[0] && voiceDegrees[0] === row.degree) ||
                (voiceLive[1] && voiceDegrees[1] === row.degree)
                  ? 'gw-ladder-hit'
                  : ''
              }`}
            >
              {row.name}
            </div>
          ))}
        </div>
        <Slider
          index={1}
          degree={voiceDegrees[1]}
          degreeCount={degreeCount}
          noteName={voiceNote(1)}
          playing={voiceLive[1]}
          hot={hotControls.has('slider:1')}
          registerRef={registerControl('slider:1')}
        />
      </div>

      {/* ---- Right panel: KEY ---- */}
      <section className="gw-panel gw-right" ref={registerPanel('right')}>
        <h3 className="gw-panel-title">key <span className="gw-formula">lim<sub>x→∂</sub></span></h3>
        <div className="gw-keys">
          {NOTE_NAMES.map((n, i) => (
            <button
              key={n}
              className={`gw-key ${i === keyIndex ? 'gw-active' : ''} ${hotControls.has(`key:${i}`) ? 'gw-hot' : ''}`}
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
        <div className="gw-silkscreen">⊕ trigger routing · {NOTE_NAMES[keyIndex]} {SCALES[scaleId].label.toLowerCase()}</div>
      </section>

      {/* ---- Bottom hint ---- */}
      <footer className="gw-panel gw-hint" ref={registerPanel('hint')}>
        {audioOn ? (
          <>
            pinch a <b>slider</b> = note · pull sideways = bend · pinch <b>open air</b> = chord · pinch a <b>knob</b> + twist wrist
          </>
        ) : (
          <>press <b>power</b> to arm {source === 'camera' ? '· then raise your hands' : '· mouse mode: click = pinch'}</>
        )}
      </footer>
    </div>
  );
}
