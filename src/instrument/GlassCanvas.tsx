import { memo, useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';
import { LiquidGlass } from './liquid-glass.js';
import { GLASS_PRESET } from './glass-preset.js';

/**
 * Liquid-glass layer — drop-in replacement for the previous GlassCanvas.
 *
 * Same public API as before (<GlassCanvas shade> + <GlassShape radius>), but
 * the renderer underneath is the one verified side-by-side against
 * iyinchao/liquid-glass-studio: full-resolution backdrop blur, Snell edge
 * refraction, per-channel chromatic dispersion, LCH fresnel + glare.
 *
 * ONE WebGL2 canvas overlays the stage (above video+shade, below all panels)
 * and draws every registered shape per frame, sampling the live camera
 * texture. Elements opt in by mounting <GlassShape radius={n} />.
 *
 * Material tuning lives in ./glass-preset.js — re-export it from the glass lab
 * (/glass-lab/, "copy config for main app") after dialling in new values.
 */

const registry = new Map<HTMLElement, number>(); // element -> corner radius (css px)

/** Stripe texture for the headless `__glassPattern` test hook (HANDOFF.md). */
function makePattern(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext('2d')!;
  const colors = ['#ff004c', '#ffe600', '#00e0ff'];
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = colors[i % 3];
    ctx.save();
    ctx.translate(320, 180);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-600 + i * 30, -400, 30, 800);
    ctx.restore();
  }
  return c;
}

export const GlassShape = memo(function GlassShape({ radius }: { radius: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    registry.set(host, radius);
    return () => {
      registry.delete(host);
    };
  }, [radius]);
  return <span ref={ref} className="gw-fx" aria-hidden />;
});

export const GlassCanvas = memo(function GlassCanvas({ shade }: { shade: number }) {
  const { videoEl } = useGestures();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadeRef = useRef(shade);
  shadeRef.current = shade;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // The glass layer is decoration — it must never take the app down.
    let glass: LiquidGlass;
    try {
      // mirror: the DOM video renders with scaleX(-1); sample to match.
      glass = new LiquidGlass(canvas, { preset: GLASS_PRESET, mirror: true });
    } catch (err) {
      console.error('liquid glass init failed:', err);
      return;
    }

    glass.setSource(videoEl, null);

    // Headless-testing hook: substitutes a stripe pattern for the camera so
    // warp/dispersion are visible without a video feed.
    let pattern: HTMLCanvasElement | null = null;
    (window as unknown as Record<string, unknown>).__glassPattern = (on: boolean) => {
      pattern = on ? makePattern() : null;
    };

    const onResize = () => glass.resize();
    window.addEventListener('resize', onResize);

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      glass.resize();

      const canvasRect = canvas.getBoundingClientRect();

      // registered panels -> shapes, in css px relative to the canvas
      const shapes: {
        x: number; y: number; width: number; height: number; radius: number;
      }[] = [];
      for (const [el, radius] of registry) {
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        shapes.push({
          x: r.left - canvasRect.left,
          y: r.top - canvasRect.top,
          width: r.width,
          height: r.height,
          radius,
        });
      }
      glass.setShapes(shapes);

      // displayed content rect of the letterboxed (object-fit: contain) video
      if (pattern) {
        glass.setSource(pattern, { x: 0, y: 0, w: canvasRect.width, h: canvasRect.height });
      } else if (videoEl && videoEl.videoWidth > 0) {
        const el = videoEl.getBoundingClientRect();
        const s = Math.min(el.width / videoEl.videoWidth, el.height / videoEl.videoHeight);
        const w = videoEl.videoWidth * s;
        const h = videoEl.videoHeight * s;
        glass.setSource(videoEl, {
          x: el.left - canvasRect.left + (el.width - w) / 2,
          y: el.top - canvasRect.top + (el.height - h) / 2,
          w,
          h,
        });
      } else {
        glass.setSource(null, null);
      }

      glass.setShade(shadeRef.current);
      glass.renderFrame();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      glass.dispose();
    };
  }, [videoEl]);

  return <canvas ref={canvasRef} className="gw-glass-canvas" aria-hidden />;
});
