interface SliderProps {
  index: number;
  /** Current handle position as a scale degree (0 = bottom). */
  degree: number;
  degreeCount: number;
  /** Note name at the handle. */
  noteName: string;
  playing: boolean;
  hot?: boolean;
  registerRef: (el: HTMLDivElement | null) => void;
}

/** Flat vertical pitch slider — one lead voice each. Scale-locked ticks;
 *  the handle sits on the last played degree. Interaction is central. */
export function Slider({ index, degree, degreeCount, noteName, playing, hot, registerRef }: SliderProps) {
  const posPct = degreeCount > 1 ? (1 - degree / (degreeCount - 1)) * 100 : 50;
  return (
    <div
      className={`gw-slider ${playing ? 'gw-slider-live' : ''} ${hot ? 'gw-hot' : ''}`}
      ref={registerRef}
      data-testid={`slider-${index}`}
    >
      <div className="gw-slider-track">
        {Array.from({ length: degreeCount }, (_, d) => (
          <span
            key={d}
            className="gw-slider-tick"
            style={{ top: `${degreeCount > 1 ? (1 - d / (degreeCount - 1)) * 100 : 50}%` }}
          />
        ))}
        <div
          className="gw-slider-handle"
          style={{ top: `${posPct}%` }}
          data-testid={`slider-handle-${index}`}
        >
          <span className="gw-slider-note">{noteName}</span>
        </div>
      </div>
      <span className="gw-slider-label">voice {index === 0 ? 'a' : 'b'}</span>
    </div>
  );
}
