import { useEffect, useRef, useState } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { useHandEvents } from '../gesture/useHandEvents';
import type { Point } from '../gesture/types';
import './JarvisMode.css';

const THEMES = ['teal', 'pink', 'amber'] as const;
const TOGGLES = ['shields', 'thrusters', 'comms'] as const;
const OPS = ['scan', 'deploy', 'trace', 'purge'] as const;

const RADAR_SIZE = 148;
const OP_DURATION_MS = 1500;
const DONE_FLASH_MS = 900;
const MAX_LOG_LINES = 6;

type OpStatus = 'idle' | 'running' | 'done';

interface OpState {
  status: OpStatus;
  progress: number;
}

interface Telemetry {
  cpu: number;
  mem: number;
  net: number;
}

function stamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function drift(value: number, min: number, max: number, step: number): number {
  const next = value + (Math.random() - 0.5) * 2 * step;
  return Math.min(max, Math.max(min, next));
}

function inRect(el: HTMLElement | null, at: Point): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
}

export default function JarvisMode() {
  const { frame } = useGestures();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});

  const [themeIdx, setThemeIdx] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const [telemetry, setTelemetry] = useState<Telemetry>({ cpu: 42, mem: 61, net: 28 });
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    shields: true,
    thrusters: false,
    comms: true,
  });
  const [ops, setOps] = useState<Record<string, OpState>>(() =>
    Object.fromEntries(OPS.map((o) => [o, { status: 'idle' as OpStatus, progress: 0 }])),
  );
  const [log, setLog] = useState<string[]>([
    `[${stamp()}] JARVIS interface online`,
    `[${stamp()}] all systems nominal`,
  ]);
  const [radarPos, setRadarPos] = useState<Point | null>(null);
  const [hovered, setHovered] = useState<Set<string>>(new Set());

  const hoverKeyRef = useRef('');
  /** handIndex -> grab offset between radar origin and cursor (stage-local). */
  const dragRef = useRef(new Map<number, Point>());
  const timersRef = useRef<Set<number>>(new Set());
  const runningOpsRef = useRef<Set<string>>(new Set());

  const setItem = (id: string) => (el: HTMLElement | null) => {
    itemRefs.current[id] = el;
  };

  const appendLog = (line: string) => {
    setLog((prev) => [...prev, `[${stamp()}] ${line}`].slice(-MAX_LOG_LINES));
  };

  // Initial radar placement, once the stage has a size.
  useEffect(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      setRadarPos({
        x: Math.max(16, rect.width / 2 - RADAR_SIZE / 2 - rect.width * 0.24),
        y: Math.max(16, rect.height - RADAR_SIZE - 40),
      });
    } else {
      setRadarPos({ x: 320, y: 320 });
    }
  }, []);

  // Fake live telemetry drift.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTelemetry((prev) => ({
        cpu: drift(prev.cpu, 8, 97, 9),
        mem: drift(prev.mem, 22, 92, 5),
        net: drift(prev.net, 4, 99, 13),
      }));
    }, 700);
    return () => window.clearInterval(id);
  }, []);

  // Sweep up any op timers still pending on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => {
        window.clearInterval(id);
        window.clearTimeout(id);
      });
      timers.clear();
    };
  }, []);

  // Per-frame hover targeting: glow anything a hand cursor is inside.
  useEffect(() => {
    const next = new Set<string>();
    for (const [id, el] of Object.entries(itemRefs.current)) {
      if (!el) continue;
      for (const hand of frame.hands) {
        if (inRect(el, hand.cursor)) {
          next.add(id);
          break;
        }
      }
    }
    const key = [...next].sort().join('|');
    if (key !== hoverKeyRef.current) {
      hoverKeyRef.current = key;
      setHovered(next);
    }
  }, [frame]);

  const pressReactor = () => {
    const nextIdx = (themeIdx + 1) % THEMES.length;
    setThemeIdx(nextIdx);
    setPulseKey((k) => k + 1);
    appendLog(`reactor recalibrated -> ${THEMES[nextIdx].toUpperCase()}`);
  };

  const flipToggle = (name: string) => {
    const next = !toggles[name];
    setToggles((prev) => ({ ...prev, [name]: next }));
    appendLog(`${name.toUpperCase()} ${next ? 'ONLINE' : 'OFFLINE'}`);
  };

  const startOp = (name: string) => {
    if (runningOpsRef.current.has(name)) return;
    runningOpsRef.current.add(name);
    appendLog(`${name.toUpperCase()} initiated…`);
    setOps((prev) => ({ ...prev, [name]: { status: 'running', progress: 0 } }));
    const started = performance.now();
    const tickId = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / OP_DURATION_MS);
      setOps((prev) => ({
        ...prev,
        [name]: { status: p >= 1 ? 'done' : 'running', progress: p },
      }));
      if (p >= 1) {
        window.clearInterval(tickId);
        timersRef.current.delete(tickId);
        appendLog(`${name.toUpperCase()} complete — OK`);
        const doneId = window.setTimeout(() => {
          timersRef.current.delete(doneId);
          runningOpsRef.current.delete(name);
          setOps((prev) => ({ ...prev, [name]: { status: 'idle', progress: 0 } }));
        }, DONE_FLASH_MS);
        timersRef.current.add(doneId);
      }
    }, 50);
    timersRef.current.add(tickId);
  };

  useHandEvents({
    onPinchStart: (handIndex, at) => {
      // Radar drag wins over everything (it floats on top).
      if (inRect(itemRefs.current['radar'], at) && radarPos) {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        dragRef.current.set(handIndex, {
          x: radarPos.x - (at.x - rect.left),
          y: radarPos.y - (at.y - rect.top),
        });
        return;
      }
      if (inRect(itemRefs.current['reactor'], at)) {
        pressReactor();
        return;
      }
      for (const t of TOGGLES) {
        if (inRect(itemRefs.current[`toggle-${t}`], at)) {
          flipToggle(t);
          return;
        }
      }
      for (const o of OPS) {
        if (inRect(itemRefs.current[`op-${o}`], at)) {
          startOp(o);
          return;
        }
      }
    },
    onPinchMove: (handIndex, at) => {
      const grab = dragRef.current.get(handIndex);
      if (!grab) return;
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setRadarPos({
        x: Math.min(Math.max(0, at.x - rect.left + grab.x), rect.width - RADAR_SIZE),
        y: Math.min(Math.max(0, at.y - rect.top + grab.y), rect.height - RADAR_SIZE),
      });
    },
    onPinchEnd: (handIndex) => {
      dragRef.current.delete(handIndex);
    },
  });

  const theme = THEMES[themeIdx];

  return (
    <div ref={rootRef} className={`jv-root jv-theme-${theme}`}>
      <section className="jv-panel jv-left">
        <h3 className="jv-panel-title">Systems</h3>
        <div className="jv-meters">
          {(['cpu', 'mem', 'net'] as const).map((k) => (
            <div className="jv-meter" key={k}>
              <span className="jv-meter-label">{k.toUpperCase()}</span>
              <div className="jv-meter-track">
                <div className="jv-meter-fill" style={{ width: `${telemetry[k]}%` }} />
              </div>
              <span className="jv-meter-value">
                {k === 'net' ? `${Math.round(telemetry.net * 12)}MB/S` : `${Math.round(telemetry[k])}%`}
              </span>
            </div>
          ))}
        </div>
        <div className="jv-toggles">
          {TOGGLES.map((name) => {
            const on = toggles[name];
            const hot = hovered.has(`toggle-${name}`);
            return (
              <div
                key={name}
                ref={setItem(`toggle-${name}`)}
                data-testid={`jv-toggle-${name}`}
                className={`jv-toggle${on ? ' jv-on' : ''}${hot ? ' jv-hot' : ''}`}
              >
                <span className="jv-toggle-name">{name.toUpperCase()}</span>
                <span className="jv-toggle-status">{on ? 'ONLINE' : 'OFFLINE'}</span>
                <span className="jv-switch">
                  <span className="jv-knob" />
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div
        ref={setItem('reactor')}
        data-testid="jv-reactor"
        className={`jv-reactor${hovered.has('reactor') ? ' jv-hot' : ''}`}
      >
        <span className="jv-ring jv-ring-a" />
        <span className="jv-ring jv-ring-b" />
        <span className="jv-ring jv-ring-c" />
        <span className="jv-core" />
        {pulseKey > 0 && <span key={pulseKey} className="jv-burst" />}
        <span className="jv-reactor-label">{theme.toUpperCase()} CORE</span>
      </div>

      <section className="jv-panel jv-right">
        <h3 className="jv-panel-title">Ops</h3>
        <div className="jv-ops">
          {OPS.map((name) => {
            const st = ops[name];
            const hot = hovered.has(`op-${name}`);
            return (
              <div
                key={name}
                ref={setItem(`op-${name}`)}
                data-testid={`jv-op-${name}`}
                className={`jv-op jv-op-${st.status}${hot ? ' jv-hot' : ''}`}
              >
                <span className="jv-op-fill" style={{ width: `${st.progress * 100}%` }} />
                <span className="jv-op-name">{st.status === 'done' ? 'DONE' : name.toUpperCase()}</span>
              </div>
            );
          })}
        </div>
        <div className="jv-log" data-testid="jv-log">
          {log.map((line, i) => (
            <div key={`${i}-${line}`} className="jv-log-line">
              {line}
            </div>
          ))}
        </div>
      </section>

      {radarPos && (
        <div
          ref={setItem('radar')}
          data-testid="jv-radar"
          className={`jv-radar${hovered.has('radar') ? ' jv-hot' : ''}`}
          style={{ transform: `translate(${radarPos.x}px, ${radarPos.y}px)` }}
        >
          <span className="jv-radar-grid" />
          <span className="jv-radar-sweep" />
          <span className="jv-radar-blip jv-blip-1" />
          <span className="jv-radar-blip jv-blip-2" />
          <span className="jv-radar-blip jv-blip-3" />
          <span className="jv-radar-label">RADAR</span>
        </div>
      )}

      <div className="jv-scanlines" />
      <div className="jv-vignette" />
    </div>
  );
}
