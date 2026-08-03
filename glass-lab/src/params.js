// Parameter schema, defaults, and persistence (autosave + named presets).
// Names, slider ranges, and default values are copied from the
// liquid-glass-studio control panel so numbers here mean the same thing there.

export const GROUPS = [
  {
    id: 'basic',
    label: 'basic settings',
    open: true,
    items: [
      { key: 'refThickness', label: 'thickness', type: 'range', min: 1, max: 80, step: 0.01, def: 20 },
      { key: 'refFactor', label: 'refraction factor', type: 'range', min: 1, max: 4, step: 0.01, def: 1.4 },
      { key: 'refDispersion', label: 'dispersion gain', type: 'range', min: 0, max: 50, step: 0.01, def: 7 },
      { key: 'refFresnelRange', label: 'fresnel size', type: 'range', min: 0, max: 100, step: 0.01, def: 30 },
      { key: 'refFresnelHardness', label: 'fresnel hardness', type: 'range', min: 0, max: 100, step: 0.01, def: 20 },
      { key: 'refFresnelFactor', label: 'fresnel intensity', type: 'range', min: 0, max: 100, step: 0.01, def: 20 },
      { key: 'glareRange', label: 'glare size', type: 'range', min: 0, max: 100, step: 0.01, def: 30 },
      { key: 'glareHardness', label: 'glare hardness', type: 'range', min: 0, max: 100, step: 0.01, def: 20 },
      { key: 'glareFactor', label: 'glare intensity', type: 'range', min: 0, max: 120, step: 0.01, def: 90 },
      { key: 'glareConvergence', label: 'glare convergence', type: 'range', min: 0, max: 100, step: 0.01, def: 50 },
      { key: 'glareOppositeFactor', label: 'glare opposite side', type: 'range', min: 0, max: 100, step: 0.01, def: 80 },
      { key: 'glareAngle', label: 'glare angle', type: 'range', min: -180, max: 180, step: 0.01, def: -45 },
      // studio allows up to 200; the blur shader here unrolls to 100 taps
      { key: 'blurRadius', label: 'blur radius', type: 'range', min: 1, max: 100, step: 1, def: 1 },
      { key: 'blurEdge', label: 'blur edge', type: 'bool', def: true },
      { key: 'tintColor', label: 'tint', type: 'color', def: '#ffffff' },
      { key: 'tintAlpha', label: 'tint alpha', type: 'range', min: 0, max: 100, step: 0.5, def: 0 },
      { key: 'shadowExpand', label: 'shadow expand', type: 'range', min: 2, max: 100, step: 0.01, def: 25 },
      { key: 'shadowFactor', label: 'shadow intensity', type: 'range', min: 0, max: 100, step: 0.01, def: 15 },
      { key: 'shadowX', label: 'shadow position x', type: 'range', min: -20, max: 20, step: 0.1, def: 0 },
      { key: 'shadowY', label: 'shadow position y', type: 'range', min: -20, max: 20, step: 0.1, def: -10 },
    ],
  },
  {
    id: 'shape',
    label: 'shape settings',
    open: true,
    items: [
      { key: 'shapeWidth', label: 'shape width', type: 'range', min: 20, max: 800, step: 1, def: 380 },
      { key: 'shapeHeight', label: 'shape height', type: 'range', min: 20, max: 800, step: 1, def: 250 },
      { key: 'shapeRadius', label: 'shape radius', type: 'range', min: 1, max: 100, step: 0.1, def: 80 },
      { key: 'shapeRoundness', label: 'shape roundness', type: 'range', min: 2, max: 7, step: 0.01, def: 5 },
    ],
  },
  {
    id: 'border',
    label: 'border highlight',
    open: true,
    items: [
      { key: 'borderEnabled', label: 'white border', type: 'bool', def: true },
      { key: 'borderWidth', label: 'border width', type: 'range', min: 0.5, max: 24, step: 0.1, def: 3 },
      { key: 'borderIntensity', label: 'border intensity', type: 'range', min: 0, max: 100, step: 0.5, def: 85 },
    ],
  },
  {
    id: 'camera',
    label: 'camera',
    open: false,
    items: [
      { key: 'mirror', label: 'mirror', type: 'bool', def: true },
    ],
  },
];

export const DEFAULTS = Object.fromEntries(
  GROUPS.flatMap((g) => g.items.map((it) => [it.key, it.def])),
);

const KEY_CURRENT = 'glasslab:params';
const KEY_POS = 'glasslab:pos';
const KEY_PRESETS = 'glasslab:presets';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Merge saved values over defaults, dropping unknown keys.
function sanitize(saved) {
  const out = { ...DEFAULTS };
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
    }
  }
  return out;
}

export function loadCurrent() {
  return sanitize(readJSON(KEY_CURRENT, null));
}

export function saveCurrent(params) {
  try { localStorage.setItem(KEY_CURRENT, JSON.stringify(params)); } catch {}
}

export function loadPos() {
  const p = readJSON(KEY_POS, null);
  if (p && Number.isFinite(p.fx) && Number.isFinite(p.fy)) return p;
  return { fx: 0.42, fy: 0.5 };
}

export function savePos(pos) {
  try { localStorage.setItem(KEY_POS, JSON.stringify(pos)); } catch {}
}

export function listPresets() {
  const obj = readJSON(KEY_PRESETS, {});
  return obj && typeof obj === 'object' ? obj : {};
}

export function savePreset(name, params) {
  const all = listPresets();
  all[name] = { ...params };
  try { localStorage.setItem(KEY_PRESETS, JSON.stringify(all)); } catch {}
}

export function deletePreset(name) {
  const all = listPresets();
  delete all[name];
  try { localStorage.setItem(KEY_PRESETS, JSON.stringify(all)); } catch {}
}

export function loadPreset(name) {
  const all = listPresets();
  return all[name] ? sanitize(all[name]) : null;
}
