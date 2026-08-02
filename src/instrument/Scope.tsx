import { useEffect, useRef } from 'react';
import type { SynthEngine } from '../audio/SynthEngine';

/** Small oscilloscope reading the synth's analyser. */
export function Scope({ engine }: { engine: SynthEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const buf = new Float32Array(2048);
    let raf = 0;
    let timer = 0;
    let stopped = false;

    const draw = () => {
      if (stopped) return;
      // Whichever scheduler fired, cancel the other pending one.
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ctx.clearRect(0, 0, W, H);

      const dark = document.body.dataset.tone === 'dark';
      // Graticule
      ctx.strokeStyle = dark ? 'rgba(245, 244, 240, 0.15)' : 'rgba(23, 22, 26, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      for (let gx = W / 6; gx < W; gx += W / 6) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
      }
      ctx.stroke();

      const ok = engine.readWaveform(buf);
      ctx.strokeStyle = dark ? '#f5f4f0' : '#17161a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const n = 512;
      for (let i = 0; i < n; i++) {
        const v = ok ? buf[i * 2] : 0;
        const x = (i / (n - 1)) * W;
        const y = H / 2 - v * H * 0.85;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

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

  return <canvas ref={canvasRef} className="gw-scope" width={180} height={44} data-testid="scope" />;
}
