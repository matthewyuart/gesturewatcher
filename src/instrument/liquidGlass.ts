/**
 * iOS-26 style liquid-glass refraction for the web, after the approach used
 * by github.com/archisvaze/liquid-glass (and github.com/topics/ios26-liquid-glass):
 * bake a physically-derived displacement map — Snell refraction through a
 * convex-squircle glass bezel — plus an angle-lit specular rim into per-element
 * images, and run them through an SVG filter referenced from
 * `backdrop-filter: url(#…)` ON the element, so the warp clips to the
 * element's own rounded corners. Chromium-only (others keep css blur glass).
 */

export interface GlassMaps {
  w: number;
  h: number;
  /** displacement map data-uri: R = dx, G = dy, neutral 128 */
  disp: string;
  /** specular rim data-uri (white, alpha-shaped) */
  spec: string;
  /** feDisplacementMap scale that decodes the map back to pixels */
  scale: number;
}

const SAMPLES = 96;
const IOR = 1.9;

/** Convex squircle: bezel height 0 at the outer edge → 1 at its inner edge. */
function surfaceHeight(t: number): number {
  return Math.pow(1 - Math.pow(1 - t, 4), 0.25);
}

/**
 * Horizontal refraction offset (px) of a vertical ray entering the bezel at
 * relative depth t in [0,1): Snell through the curved surface, then travel
 * through the glass slab to the backdrop.
 */
function refractionProfile(thickness: number, bezel: number): Float64Array {
  const eta = 1 / IOR;
  const out = new Float64Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / SAMPLES;
    const y = surfaceHeight(t);
    const slope = (surfaceHeight(Math.min(t + 1e-4, 1)) - y) / 1e-4;
    const norm = Math.hypot(slope, 1);
    // outward surface normal (cross-section), incident ray travels (0,-1)
    const nx = -slope / norm;
    const ny = 1 / norm;
    const cosI = ny; // -(d·n) with d = (0,-1)
    const sin2T = eta * eta * (1 - cosI * cosI);
    if (sin2T >= 1) continue; // total internal reflection — leave 0
    const cosT = Math.sqrt(1 - sin2T);
    const k = eta * cosI - cosT;
    const rx = k * nx; // = eta·dx + k·nx with dx = 0
    const ry = -eta + k * ny;
    // horizontal drift over the depth to the backdrop
    out[i] = rx * ((y * bezel + thickness) / -ry);
  }
  return out;
}

/**
 * Signed distance geometry shared by both maps: for a pixel, the offset from
 * the nearest rounded-corner center (0 along straight edges), so `dist` is
 * the distance used against the corner radius.
 */
function edgeGeom(x1: number, y1: number, w: number, h: number, r: number) {
  const x = x1 < r ? x1 - r : x1 >= w - r ? x1 - r - (w - r * 2) : 0;
  const y = y1 < r ? y1 - r : y1 >= h - r ? y1 - r - (h - r * 2) : 0;
  return { x, y, dSq: x * x + y * y };
}

export function buildGlassMaps(w: number, h: number, radius: number): GlassMaps {
  const minDim = Math.min(w, h);
  const r = Math.min(radius, minDim / 2);
  const bezel = Math.max(2, Math.min(r - 1, minDim / 2 - 1));
  const thickness = minDim * 0.5;

  const profile = refractionProfile(thickness, bezel);
  let maxDisp = 1;
  for (const v of profile) maxDisp = Math.max(maxDisp, Math.abs(v));

  const rSq = r * r;
  const r1Sq = (r + 1) ** 2;
  const rInSq = Math.max(r - bezel, 0) ** 2;

  // ---- displacement map: edges pull the backdrop inward (lens magnify) ----
  const dc = document.createElement('canvas');
  dc.width = w;
  dc.height = h;
  const dctx = dc.getContext('2d')!;
  const dimg = dctx.createImageData(w, h);
  const dd = dimg.data;
  for (let i = 0; i < dd.length; i += 4) {
    dd[i] = 128;
    dd[i + 1] = 128;
    dd[i + 3] = 255;
  }

  // ---- specular rim: brightest where the edge faces the light ----
  const sc = document.createElement('canvas');
  sc.width = w;
  sc.height = h;
  const sctx = sc.getContext('2d')!;
  const simg = sctx.createImageData(w, h);
  const sd = simg.data;
  const lightAngle = Math.PI / 3;
  const lx = Math.cos(lightAngle);
  const ly = Math.sin(lightAngle);

  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      const { x, y, dSq } = edgeGeom(x1, y1, w, h, r);
      if (dSq > r1Sq || dSq < rInSq || dSq === 0) continue;
      const dist = Math.sqrt(dSq);
      const intoBezel = r - dist; // 0 at the border → bezel at its inner edge
      // anti-aliased outer rim
      const op = dSq < rSq ? 1 : 1 - (dist - r) / (Math.sqrt(r1Sq) - r);
      if (op <= 0) continue;
      const ux = x / dist;
      const uy = y / dist;
      const idx = (y1 * w + x1) * 4;

      const pi = Math.min(((intoBezel / bezel) * SAMPLES) | 0, SAMPLES - 1);
      const disp = profile[pi];
      dd[idx] = (128 + (-ux * disp * op * 127) / maxDisp + 0.5) | 0;
      dd[idx + 1] = (128 + (-uy * disp * op * 127) / maxDisp + 0.5) | 0;

      const facing = Math.abs(ux * lx + -uy * ly);
      const edge = Math.sqrt(Math.max(0, 1 - (1 - intoBezel) ** 2));
      const gleam = facing * edge;
      const col = (255 * gleam) | 0;
      sd[idx] = col;
      sd[idx + 1] = col;
      sd[idx + 2] = col;
      sd[idx + 3] = (col * gleam * op) | 0;
    }
  }
  dctx.putImageData(dimg, 0, 0);
  sctx.putImageData(simg, 0, 0);

  return { w, h, disp: dc.toDataURL(), spec: sc.toDataURL(), scale: maxDisp };
}
