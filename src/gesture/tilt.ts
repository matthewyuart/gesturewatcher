/**
 * Left-hand wrist tilt → filter modulation.
 *
 * `Hand.roll` is 0 when the hand points straight up and grows positive as
 * the hand rotates clockwise on screen. Straight up is a true neutral:
 * inside the deadzone the filter sits exactly where the knob was left, and
 * rotating either way sweeps it toward an extreme.
 */

/** ~11°: straight up (and small wobble around it) adjusts nothing. */
export const TILT_DEAD = 0.2;
/** ~75°: full sweep. Beyond this the amount saturates. */
export const TILT_FULL = 1.3;
/**
 * ~150°: past this the hand is essentially inverted (hanging down at rest),
 * not playing. Without this, a resting hand sits near ±180° where the sign
 * of `roll` flips, so the tiniest wobble would slam the filter between
 * fully open and fully closed. Treat that posture as neutral instead.
 */
export const TILT_REST = 2.6;

/** Signed -1..1 tilt from a wrist roll angle; exactly 0 in the deadzone. */
export function tiltAmount(roll: number): number {
  if (!Number.isFinite(roll)) return 0;
  const a = Math.abs(roll);
  if (a <= TILT_DEAD || a >= TILT_REST) return 0;
  const t = Math.min(1, (a - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
  return roll > 0 ? t : -t;
}

/**
 * Cutoff for a tilt: 0 keeps the knob's base value, +1 reaches fully open,
 * -1 fully closed — so both directions keep full travel from any base.
 */
export function tiltCutoff(base: number, tilt: number): number {
  const b = Math.min(1, Math.max(0, base));
  const t = Math.min(1, Math.max(-1, Number.isFinite(tilt) ? tilt : 0));
  return t >= 0 ? b + t * (1 - b) : b * (1 + t);
}

/**
 * Live tilt state published by the instrument. The hand overlay reads it to
 * label its arc with the resulting cutoff — a plain module value so the
 * per-frame canvas never forces a React render.
 */
export const tiltState = { base: 0.72, cutoff: 0.72, tilt: 0, armed: true };
