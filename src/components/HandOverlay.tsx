import { useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';

// Landmark connection pairs for drawing the hand skeleton.
const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

/**
 * Full-viewport canvas that draws hand skeletons plus a cursor ring per hand.
 * Rendered above every mode; pointer-events: none.
 */
export function HandOverlay() {
  const { frame } = useGestures();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Ink follows the detected video tone (set on <body> by the instrument).
    const dark = document.body.dataset.tone === 'dark';
    const ink = dark ? '#f5f4f0' : '#17161a';
    const inkSoft = dark ? 'rgba(245, 244, 240, 0.25)' : 'rgba(23, 22, 26, 0.2)';
    const inkFill = dark ? 'rgba(245, 244, 240, 0.85)' : 'rgba(23, 22, 26, 0.85)';

    for (const hand of frame.hands) {
      // Skeleton (camera mode only — mouse mode has no landmarks).
      if (hand.landmarks.length === 21) {
        ctx.strokeStyle = inkSoft;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [a, b] of CONNECTIONS) {
          ctx.moveTo(hand.landmarks[a].x, hand.landmarks[a].y);
          ctx.lineTo(hand.landmarks[b].x, hand.landmarks[b].y);
        }
        ctx.stroke();
        ctx.fillStyle = inkSoft;
        for (const p of hand.landmarks) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Cursor ring: shrinks as the pinch closes; fills when pinched.
      const { x, y } = hand.cursor;
      const radius = 22 - hand.pinchStrength * 10;
      ctx.lineWidth = 2;
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (hand.pinch) {
        ctx.fillStyle = inkFill;
        ctx.fill();
      }
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [frame]);

  return <canvas ref={canvasRef} className="hand-overlay" />;
}
