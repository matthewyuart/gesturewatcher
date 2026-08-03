/**
 * Liquid-glass material preset.
 *
 * These are the values dialled in on the glass lab, which are in turn the
 * defaults from iyinchao/liquid-glass-studio. Every field maps 1:1 to a
 * control in the lab, so you can keep tuning there and re-export.
 *
 * Units follow the studio: the 0-100 fields are percentages that the renderer
 * divides down, angles are degrees, lengths are CSS pixels.
 */
export const GLASS_PRESET = {
  // --- refraction -------------------------------------------------------
  /** depth of the refracting rim, css px. Bigger = fatter lens edge. */
  refThickness: 20,
  /** index of refraction. 1 = no bend, 1.4 ≈ glass. */
  refFactor: 1.4,
  /** per-channel offset gain — this is the chromatic aberration. 0 = none. */
  refDispersion: 7,

  // --- fresnel rim ------------------------------------------------------
  refFresnelRange: 30,
  refFresnelHardness: 20,
  refFresnelFactor: 20,

  // --- glare ------------------------------------------------------------
  glareRange: 30,
  glareHardness: 20,
  glareFactor: 90,
  glareConvergence: 50,
  glareOppositeFactor: 80,
  /** degrees; -45 puts the highlight top-left / bottom-right. */
  glareAngle: -45,

  // --- frost ------------------------------------------------------------
  /**
   * Gaussian radius applied to the backdrop before refraction.
   * 1 = clear glass (studio default). For panels carrying text, 20-40 gives
   * a frosted backdrop that keeps type legible.
   */
  blurRadius: 1,
  /** true = the whole interior uses the blurred backdrop, not just the rim. */
  blurEdge: true,

  // --- tint -------------------------------------------------------------
  /** hex rgb; only applied in proportion to tintAlpha. */
  tintColor: '#ffffff',
  /** 0-100. 0 = untinted. */
  tintAlpha: 0,

  // --- drop shadow ------------------------------------------------------
  shadowExpand: 25,
  shadowFactor: 15,
  shadowX: 0,
  /** negative y drops the shadow below the shape (studio convention). */
  shadowY: -10,

  // --- shape ------------------------------------------------------------
  /** superellipse exponent for the corners: 2 = circular, 5 = squircle. */
  shapeRoundness: 5,
  /**
   * Smooth-min join between shapes, in normalized units (0-0.3).
   * >0 makes nearby panels fuse like mercury; 0 keeps them separate.
   */
  mergeRate: 0,

  // --- white border highlight ------------------------------------------
  borderEnabled: false,
  /** css px */
  borderWidth: 3,
  /** 0-100 */
  borderIntensity: 85,
};

export default GLASS_PRESET;
