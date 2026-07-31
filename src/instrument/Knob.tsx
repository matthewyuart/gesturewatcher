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
const TICKS = 11;

/** Hardware-style black knob with a white indicator line. Dumb/controlled —
 *  all interaction happens centrally in Instrument. */
export function Knob({ label, value, readout, hot, active, registerRef, size = 52 }: KnobProps) {
  const angle = -SWEEP / 2 + value * SWEEP;
  return (
    <div
      className={`gw-knob ${hot ? 'gw-hot' : ''} ${active ? 'gw-active' : ''}`}
      ref={registerRef}
      data-testid={`knob-${label.toLowerCase()}`}
    >
      <div className="gw-knob-dial" style={{ width: size, height: size }}>
        <svg className="gw-knob-ticks" viewBox="0 0 100 100">
          {Array.from({ length: TICKS }, (_, i) => {
            const a = ((-SWEEP / 2 + (i / (TICKS - 1)) * SWEEP) * Math.PI) / 180;
            const r1 = 46;
            const r2 = 50;
            return (
              <line
                key={i}
                x1={50 + r1 * Math.sin(a)}
                y1={50 - r1 * Math.cos(a)}
                x2={50 + r2 * Math.sin(a)}
                y2={50 - r2 * Math.cos(a)}
              />
            );
          })}
        </svg>
        <div className="gw-knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
          <div className="gw-knob-line" />
        </div>
      </div>
      <span className="gw-knob-label">{label}</span>
      {readout && <span className="gw-knob-readout">{readout}</span>}
    </div>
  );
}
