import { useEffect, useRef } from 'react';
import { useGestures } from './GestureProvider';
import type { Hand, Point } from './types';

export interface HandEventHandlers {
  /** Fired once when a hand starts pinching. Return value ignored. */
  onPinchStart?: (handIndex: number, at: Point, hand: Hand) => void;
  /** Fired every frame while a hand is pinching. */
  onPinchMove?: (handIndex: number, at: Point, hand: Hand) => void;
  /** Fired once when a pinch releases. */
  onPinchEnd?: (handIndex: number, at: Point, hand: Hand) => void;
  /** Fired every frame for every visible hand (pinching or not). */
  onHandMove?: (handIndex: number, hand: Hand) => void;
}

/**
 * Edge-detection helper on top of useGestures(): turns per-frame hand state
 * into pinch start/move/end events. Handlers are kept in a ref, so callers
 * may pass fresh closures every render without re-subscribing.
 */
export function useHandEvents(handlers: HandEventHandlers): void {
  const { frame } = useGestures();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const prevPinch = useRef<boolean[]>([]);

  useEffect(() => {
    const h = handlersRef.current;
    const pinchingNow: boolean[] = [];
    frame.hands.forEach((hand, i) => {
      h.onHandMove?.(i, hand);
      const was = prevPinch.current[i] ?? false;
      if (hand.pinch && !was) h.onPinchStart?.(i, hand.cursor, hand);
      else if (hand.pinch && was) h.onPinchMove?.(i, hand.cursor, hand);
      else if (!hand.pinch && was) h.onPinchEnd?.(i, hand.cursor, hand);
      pinchingNow[i] = hand.pinch;
    });
    // Hands that vanished mid-pinch: emit end at their last position.
    for (let i = frame.hands.length; i < prevPinch.current.length; i++) {
      if (prevPinch.current[i]) {
        // Position unknown — report offscreen.
        h.onPinchEnd?.(
          i,
          { x: -1, y: -1 },
          {
            handedness: 'Right',
            cursor: { x: -1, y: -1 },
            pinch: false,
            pinchStrength: 0,
            pose: 'unknown',
            roll: 0,
            fingerTouch: [false, false, false, false],
            landmarks: [],
          },
        );
      }
    }
    prevPinch.current = pinchingNow;
  }, [frame]);
}
