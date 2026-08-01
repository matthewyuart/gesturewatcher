export type HandPose = 'open' | 'point' | 'pinch' | 'fist' | 'unknown';

export interface Point {
  x: number;
  y: number;
}

export interface Hand {
  /** Which hand, from the user's point of view (mirrored). */
  handedness: 'Left' | 'Right';
  /** Smoothed cursor position in viewport CSS pixels. */
  cursor: Point;
  /** True while thumb and index are pinched together. Acts as "click / grab". */
  pinch: boolean;
  /** 0 (fingers apart) .. 1 (fully pinched). */
  pinchStrength: number;
  /** Coarse hand pose. 'pinch' wins over other poses. */
  pose: HandPose;
  /**
   * Hand roll in radians: angle of the wrist→middle-knuckle axis in screen
   * space. 0 = fingers pointing up, positive = rotated clockwise on screen.
   * Always 0 in mouse mode (no landmarks).
   */
  roll: number;
  /**
   * Thumb-tip touching each fingertip: [index, middle, ring, pinky].
   * fingerTouch[0] mirrors `pinch`. Mouse mode: [pinch, false, false, false].
   */
  fingerTouch: boolean[];
  /** All 21 landmarks in viewport CSS pixels (mirrored), for skeleton drawing. */
  landmarks: Point[];
}

export interface GestureFrame {
  hands: Hand[];
  /** performance.now() timestamp of the frame. */
  t: number;
}

export type GestureSource = 'camera' | 'mouse';

export type GestureStatus =
  | 'idle'
  | 'loading'
  | 'running'
  | 'camera-denied'
  | 'error';
