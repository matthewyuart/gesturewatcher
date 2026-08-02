import { useEffect, useRef } from 'react';
import type { SynthEngine } from '../audio/SynthEngine';
import './TechScope.css';

const W = 230;
const H = 120;
const SAMPLE_RATE = 48000;
const TRACE_SAMPLES = 700;

/** Bench-style mini oscilloscope with rising-edge trigger and readouts. */
export function TechScope({ engine }: { engine: SynthEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const buf = new Float32Array(2048);
    let raf = 0;
    let timer = 0;
    let stopped = false;

    const draw = () => {
      if (stopped) return;
      // Whichever scheduler fired, cancel the other pending one.
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);

      // Screen
      ctx.fillStyle = '#0a0c0a';
      ctx.fillRect(0, 0, W, H);

      // Graticule: 10x6 divisions, brighter center axes.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(120,255,140,0.10)';
      ctx.beginPath();
      for (let i = 1; i < 10; i++) {
        const x = (i / 10) * W;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let j = 1; j < 6; j++) {
        const y = (j / 6) * H;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,255,140,0.22)';
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      const ok = engine.readWaveform(buf);
      if (!ok) buf.fill(0);

      // Signal stats.
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const vpp = max - min;
      const silent = vpp < 0.01;

      // Rising-edge trigger: first zero-upcrossing in the first ~1024 samples.
      let trig = 0;
      let triggered = false;
      for (let i = 1; i < 1024; i++) {
        if (buf[i - 1] < 0 && buf[i] >= 0) {
          trig = i;
          triggered = true;
          break;
        }
      }

      // Frequency estimate: periods between first and last rising crossing.
      let freq = 0;
      if (!silent) {
        let first = -1;
        let last = -1;
        let crossings = 0;
        for (let i = 1; i < buf.length; i++) {
          if (buf[i - 1] < 0 && buf[i] >= 0) {
            if (first < 0) first = i;
            last = i;
            crossings++;
          }
        }
        if (crossings >= 2 && last > first) {
          freq = ((crossings - 1) * SAMPLE_RATE) / (last - first);
        }
      }

      // Trace.
      const mid = H / 2;
      const n = Math.min(TRACE_SAMPLES, buf.length - trig);
      ctx.strokeStyle = '#59f07d';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = buf[trig + i];
        const x = (i / (n - 1)) * W;
        const y = mid - v * H * 0.42;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Readouts.
      ctx.fillStyle = 'rgba(200,255,210,0.75)';
      ctx.font = '8px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('ch1 · 100mv/div', 4, 4);
      ctx.textAlign = 'right';
      ctx.fillText(triggered && !silent ? "trig'd" : 'free', W - 4, 4);
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText(silent || freq <= 0 ? 'f: —' : `f: ${freq.toFixed(1)}hz`, 4, H - 4);
      ctx.textAlign = 'right';
      ctx.fillText(`vpp: ${vpp.toFixed(2)}`, W - 4, H - 4);

      if (engine.isRunning) {
        raf = requestAnimationFrame(draw);
        timer = window.setTimeout(draw, 150);
      } else {
        // Idle until the synth is armed — no 60fps loop for a flat line.
        timer = window.setTimeout(draw, 500);
      }
    };
    draw();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [engine]);

  return <canvas ref={canvasRef} className="gw-tscope" width={W} height={H} data-testid="scope" />;
}
