interface KnobProps {
  label: string;
  value: number; // 0..1
  readout?: string;
  hot?: boolean;
  active?: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
  size?: number;
}

const SWEEP = 270; // degrees of rotation from min to max

/** Flat schematic knob: outlined ring + indicator line, like a patch diagram.
 *  Dumb/controlled — all interaction happens centrally in Instrument. */
export function Knob({ label, value, readout, hot, active, registerRef, size = 54 }: KnobProps) {
  const angle = ((-SWEEP / 2 + value * SWEEP) * Math.PI) / 180;
  const r = 34;
  const inner = 12;
  return (
    <div
      className={`gw-knob ${hot ? 'gw-hot' : ''} ${active ? 'gw-active' : ''}`}
      ref={registerRef}
      data-testid={`knob-${label.toLowerCase()}`}
    >
      <svg className="gw-knob-svg" viewBox="0 0 100 100" style={{ width: size, height: size }}>
        <circle cx="50" cy="50" r={r} className="gw-knob-ring" />
        <line
          x1={50 + inner * Math.sin(angle)}
          y1={50 - inner * Math.cos(angle)}
          x2={50 + r * Math.sin(angle)}
          y2={50 - r * Math.cos(angle)}
          className="gw-knob-needle"
        />
        {/* min / max end ticks */}
        {[-SWEEP / 2, SWEEP / 2].map((deg) => {
          const a = (deg * Math.PI) / 180;
          return (
            <line
              key={deg}
              x1={50 + (r + 5) * Math.sin(a)}
              y1={50 - (r + 5) * Math.cos(a)}
              x2={50 + (r + 11) * Math.sin(a)}
              y2={50 - (r + 11) * Math.cos(a)}
              className="gw-knob-tick"
            />
          );
        })}
      </svg>
      <span className="gw-knob-label">{label}</span>
      {readout && <span className="gw-knob-readout">{readout}</span>}
    </div>
  );
}
