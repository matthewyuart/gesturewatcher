/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { classifyHand, fingerTouches } from './classify';
import { OneEuroPoint } from './oneEuro';
import type { GestureFrame, GestureSource, GestureStatus, Hand } from './types';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';
const WASM_PATH = `${import.meta.env.BASE_URL}mediapipe/wasm`;

interface GestureContextValue {
  frame: GestureFrame;
  status: GestureStatus;
  source: GestureSource;
  fps: number;
  /** The camera <video> element, for picture-in-picture preview. Null in mouse mode. */
  videoEl: HTMLVideoElement | null;
  /** Switch between camera tracking and mouse simulation. */
  setSource: (source: GestureSource) => void;
}

const EMPTY_FRAME: GestureFrame = { hands: [], t: 0 };

const GestureContext = createContext<GestureContextValue | null>(null);

export function useGestures(): GestureContextValue {
  const ctx = useContext(GestureContext);
  if (!ctx) throw new Error('useGestures must be used inside <GestureProvider>');
  return ctx;
}

export function GestureProvider({ children }: { children: ReactNode }) {
  const [frame, setFrame] = useState<GestureFrame>(EMPTY_FRAME);
  const [status, setStatus] = useState<GestureStatus>('idle');
  const [source, setSourceState] = useState<GestureSource>(() =>
    new URLSearchParams(window.location.search).has('mouse') ? 'mouse' : 'camera',
  );
  const [fps, setFps] = useState(0);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const sourceRef = useRef(source);
  sourceRef.current = source;

  // ---- Mouse simulation ----------------------------------------------------
  // `latch` guarantees even an instantaneous click registers as a full
  // pinch-press for at least one frame of the (possibly slow) tracking loop.
  const mouse = useRef({ x: -100, y: -100, down: false, latch: false, present: false });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
      mouse.current.present = true;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) {
        mouse.current.down = true;
        mouse.current.latch = true;
        mouse.current.x = e.clientX;
        mouse.current.y = e.clientY;
        mouse.current.present = true;
      }
    };
    const onUp = () => {
      mouse.current.down = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // ---- Tracking loop -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let fallbackTimer = 0;
    let landmarker: HandLandmarker | null = null;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;

    const filters = new Map<number, OneEuroPoint>();
    const wasPinching = new Map<number, boolean>();
    const wasTouching = new Map<number, boolean[]>();
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    const mouseHand = (): Hand[] => {
      const m = mouse.current;
      if (!m.present) return [];
      const pinch = m.down || m.latch;
      if (!m.down) m.latch = false; // consumed: report one pinched frame, release next
      return [
        {
          handedness: 'Right',
          cursor: { x: m.x, y: m.y },
          pinch,
          pinchStrength: pinch ? 1 : 0,
          pose: pinch ? 'pinch' : 'point',
          roll: 0,
          fingerTouch: [pinch, false, false, false],
          landmarks: [],
        },
      ];
    };

    const tick = (t: number) => {
      if (cancelled) return;
      let hands: Hand[] = [];

      if (sourceRef.current === 'mouse' || !landmarker || !video) {
        hands = mouseHand();
      } else {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        try {
          const result = landmarker.detectForVideo(video, t);
          hands = result.landmarks.map((lm, i) => {
            const prevPinch = wasPinching.get(i) ?? false;
            const cls = classifyHand(lm, prevPinch);
            wasPinching.set(i, cls.pinch);
            const touches = fingerTouches(
              lm,
              wasTouching.get(i) ?? [false, false, false, false],
            );
            wasTouching.set(i, touches);

            // Cursor anchor: midpoint of thumb tip + index tip (stable while pinching).
            const rawX = (1 - (lm[4].x + lm[8].x) / 2) * vw;
            const rawY = ((lm[4].y + lm[8].y) / 2) * vh;
            let filter = filters.get(i);
            if (!filter) {
              filter = new OneEuroPoint();
              filters.set(i, filter);
            }
            const cursor = filter.filter(rawX, rawY, t);

            const label = result.handedness[i]?.[0]?.categoryName;
            const screenLm = lm.map((p) => ({ x: (1 - p.x) * vw, y: p.y * vh }));
            // Roll: wrist (0) -> middle MCP (9) axis; 0 = up, +cw on screen.
            const roll = Math.atan2(
              screenLm[9].x - screenLm[0].x,
              -(screenLm[9].y - screenLm[0].y),
            );
            return {
              handedness: label === 'Left' ? 'Left' : 'Right',
              cursor,
              pinch: cls.pinch,
              pinchStrength: cls.pinchStrength,
              pose: cls.pose,
              roll,
              fingerTouch: touches,
              landmarks: screenLm,
            } satisfies Hand;
          });
          // Drop filters for hands that disappeared.
          for (const key of filters.keys()) {
            if (key >= hands.length) {
              filters.delete(key);
              wasPinching.delete(key);
              wasTouching.delete(key);
            }
          }
        } catch {
          // A single bad frame shouldn't kill the loop.
        }
      }

      frameCount++;
      if (t - fpsWindowStart >= 1000) {
        setFps(Math.round((frameCount * 1000) / (t - fpsWindowStart)));
        frameCount = 0;
        fpsWindowStart = t;
      }

      setFrame({ hands, t });
      schedule();
    };

    // rAF when the page is visible; a timer fallback keeps the loop alive
    // when rAF is throttled or paused (hidden tab, embedded preview panes).
    const run = (t: number) => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallbackTimer);
      tick(t);
    };
    const schedule = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(run);
      fallbackTimer = window.setTimeout(() => run(performance.now()), 150);
    };

    const start = async () => {
      if (sourceRef.current === 'mouse') {
        setStatus('running');
        setVideoEl(null);
        schedule();
        return;
      }

      setStatus('loading');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        // No camera / permission denied — fall back to mouse simulation.
        setStatus('camera-denied');
        setSourceState('mouse');
        return;
      }

      try {
        video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        if (cancelled) return;
        setVideoEl(video);
        setStatus('running');
        schedule();
      } catch (err) {
        console.error('Hand tracking init failed:', err);
        setStatus('error');
        setSourceState('mouse');
      }
    };

    void start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(fallbackTimer);
      stream?.getTracks().forEach((track) => track.stop());
      landmarker?.close();
      setVideoEl(null);
    };
  }, [source]);

  const setSource = useCallback((next: GestureSource) => {
    setSourceState(next);
  }, []);

  return (
    <GestureContext.Provider
      value={{ frame, status, source, fps, videoEl, setSource }}
    >
      {children}
    </GestureContext.Provider>
  );
}
