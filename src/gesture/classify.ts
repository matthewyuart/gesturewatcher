import type { HandPose } from './types';

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

// Landmark indices — https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Palm size used to normalize thresholds across hand distance from camera. */
function handScale(lm: NormalizedLandmark[]): number {
  return Math.max(dist(lm[WRIST], lm[MIDDLE_MCP]), 1e-6);
}

function fingerExtended(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
): boolean {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.15;
}

export interface Classification {
  pose: HandPose;
  pinch: boolean;
  pinchStrength: number;
}

// Hysteresis thresholds (ratio of pinch distance to hand scale).
const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;

/**
 * Classify a hand's pose from normalized landmarks.
 * `wasPinching` enables hysteresis so a pinch doesn't flicker at the boundary.
 */
export function classifyHand(
  lm: NormalizedLandmark[],
  wasPinching: boolean,
): Classification {
  const scale = handScale(lm);
  const pinchRatio = dist(lm[THUMB_TIP], lm[INDEX_TIP]) / scale;
  const threshold = wasPinching ? PINCH_OFF : PINCH_ON;
  const pinch = pinchRatio < threshold;
  const pinchStrength = Math.max(
    0,
    Math.min(1, (PINCH_OFF - pinchRatio) / PINCH_OFF),
  );

  const index = fingerExtended(lm, INDEX_TIP, INDEX_PIP);
  const middle = fingerExtended(lm, MIDDLE_TIP, MIDDLE_PIP);
  const ring = fingerExtended(lm, RING_TIP, RING_PIP);
  const pinky = fingerExtended(lm, PINKY_TIP, PINKY_PIP);
  const extendedCount = [index, middle, ring, pinky].filter(Boolean).length;

  let pose: HandPose = 'unknown';
  if (pinch) pose = 'pinch';
  else if (extendedCount >= 4) pose = 'open';
  else if (index && !middle && !ring && !pinky) pose = 'point';
  else if (extendedCount === 0) pose = 'fist';

  return { pose, pinch, pinchStrength };
}
