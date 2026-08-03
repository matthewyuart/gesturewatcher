// glass lab — liquid glass panel over the live camera.
// WebGL2, 4 passes: bg (camera+shadow) → hblur → vblur → glass.

import { VERT, BG_FRAG, BLUR_FRAG, MAIN_FRAG } from './shaders.js';
import { loadCurrent, saveCurrent, loadPos, savePos, BG_IMAGE } from './params.js';
import { listImages } from './images.js';
import { buildUI } from './ui.js';

const MAX_BLUR_RADIUS = 200;

const canvas = document.getElementById('stage');
const panelEl = document.getElementById('panel');
const camStateEl = document.getElementById('cam-state');

const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
if (!gl) {
  camStateEl.textContent = 'webgl2 not available';
  throw new Error('webgl2 not available');
}

// ---- gl helpers ----

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
  }
  return s;
}

function program(vertSrc, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'program link failed');
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

function createTarget(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

const quad = gl.createVertexArray();
gl.bindVertexArray(quad);
const vb = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vb);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

const progBg = program(VERT, BG_FRAG);
const progBlur = program(VERT, BLUR_FRAG);
const progMain = program(VERT, MAIN_FRAG);

// ---- state ----

const params = loadCurrent();
const pos = loadPos(); // fractional viewport coords of glass center

let dpr = 1;
let cssW = 0;
let cssH = 0;
let texBg = null;
let texA = null;
let texB = null;

const spring = {
  x: 0, y: 0, vx: 0, vy: 0, // current (css px)
  tx: 0, ty: 0, // target
  init: false,
};

let dragging = false;
let grabDX = 0;
let grabDY = 0;

// pointer position in css px — the blob shape follows it
const pointer = { x: -9999, y: -9999 };

function makeTexture(fill) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(fill));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

let camReady = false;
let video = null;
const camTex = makeTexture([20, 20, 24, 255]);

// user photo background
const imgTex = makeTexture([40, 40, 46, 255]);
let imgReady = false;
let imgRatio = 16 / 9;
let imgLoadedUrl = '';

function loadBgImage(url) {
  if (url === imgLoadedUrl) return;
  imgLoadedUrl = url;
  imgReady = false;
  if (!url) return;
  const im = new Image();
  im.onload = () => {
    if (imgLoadedUrl !== url) return;
    gl.bindTexture(gl.TEXTURE_2D, imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    imgRatio = im.width / im.height;
    imgReady = true;
  };
  im.onerror = () => { imgReady = false; };
  im.src = url;
}

let blurWeights = new Float32Array(MAX_BLUR_RADIUS + 1);
let blurWeightsRadius = -1;

// matches the studio's computeGaussianKernelByRadius (sigma = radius / 3)
function computeBlurWeights(radius) {
  if (radius === blurWeightsRadius) return;
  blurWeightsRadius = radius;
  blurWeights = new Float32Array(MAX_BLUR_RADIUS + 1);
  const r = Math.max(radius, 0);
  const sigma = r / 3.0;
  let sum = 0;
  for (let i = 0; i <= r; i++) {
    const w = sigma > 0 ? Math.exp((-0.5 * (i * i)) / (sigma * sigma)) : (i === 0 ? 1 : 0);
    blurWeights[i] = w;
    sum += i === 0 ? w : 2 * w;
  }
  for (let i = 0; i <= r; i++) blurWeights[i] /= sum;
}

// ---- persistence (debounced) ----

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrent(params);
    savePos(pos);
  }, 250);
}

// ---- resize ----

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = window.innerWidth;
  cssH = window.innerHeight;
  canvas.width = Math.max(2, Math.round(cssW * dpr));
  canvas.height = Math.max(2, Math.round(cssH * dpr));

  // all three targets are full canvas resolution, as in the studio
  texBg = createTarget(canvas.width, canvas.height);
  texA = createTarget(canvas.width, canvas.height);
  texB = createTarget(canvas.width, canvas.height);

  if (!spring.init) {
    spring.x = spring.tx = pos.fx * cssW;
    spring.y = spring.ty = pos.fy * cssH;
    spring.init = true;
  } else {
    spring.tx = pos.fx * cssW;
    spring.ty = pos.fy * cssH;
  }
}

window.addEventListener('resize', resize);
resize();

// ---- camera ----

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    camReady = true;
    camStateEl.textContent = 'camera: live';
  } catch (err) {
    camReady = false;
    camStateEl.textContent = 'camera: unavailable (fallback bg)';
    console.warn('[glass-lab] camera failed:', err && err.name, err && err.message);
  }
}
startCamera();

// ---- drag ----

function insideGlass(x, y) {
  const hw = params.shapeWidth / 2;
  const hh = params.shapeHeight / 2;
  return Math.abs(x - spring.x) <= hw && Math.abs(y - spring.y) <= hh;
}

canvas.addEventListener('pointerdown', (e) => {
  if (insideGlass(e.clientX, e.clientY)) {
    dragging = true;
    grabDX = spring.x - e.clientX;
    grabDY = spring.y - e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  if (dragging) {
    spring.tx = e.clientX + grabDX;
    spring.ty = e.clientY + grabDY;
    pos.fx = spring.tx / cssW;
    pos.fy = spring.ty / cssH;
    scheduleSave();
  } else {
    canvas.style.cursor = insideGlass(e.clientX, e.clientY) ? 'grab' : 'default';
  }
});

const endDrag = (e) => {
  if (dragging) {
    dragging = false;
    canvas.style.cursor = insideGlass(e.clientX, e.clientY) ? 'grab' : 'default';
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---- ui ----

buildUI(panelEl, params, scheduleSave);

// ---- render ----

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function stepSpring(dt) {
  const k = 160;
  const damp = 2 * Math.sqrt(k);
  spring.vx += (k * (spring.tx - spring.x) - damp * spring.vx) * dt;
  spring.vy += (k * (spring.ty - spring.y) - damp * spring.vy) * dt;
  spring.x += spring.vx * dt;
  spring.y += spring.vy * dt;
}

// Shape size stretches with drag speed, as in the studio's springSizeFactor.
function shapeSize() {
  const f = params.springSizeFactor / 100;
  return {
    w: params.shapeWidth + Math.abs(spring.vx) * 0.02 * params.shapeWidth * f,
    h: params.shapeHeight + Math.abs(spring.vy) * 0.02 * params.shapeHeight * f,
  };
}

function setShapeUniforms(u, centerDev, blobDev, size, radiusPx) {
  gl.uniform2f(u.u_shapeCenter, centerDev[0], centerDev[1]);
  gl.uniform2f(u.u_blobCenter, blobDev[0], blobDev[1]);
  gl.uniform1f(u.u_shapeWidth, size.w);
  gl.uniform1f(u.u_shapeHeight, size.h);
  gl.uniform1f(u.u_shapeRadius, radiusPx);
  gl.uniform1f(u.u_shapeRoundness, params.shapeRoundness);
  gl.uniform1f(u.u_blobRadius, params.blobRadius);
  gl.uniform1f(u.u_mergeRate, params.mergeRate);
  gl.uniform1i(u.u_showBlob, params.showBlob ? 1 : 0);
}

let lastT = 0;
let lastRender = 0;

function render(tMs) {
  lastRender = performance.now();
  const t = tMs / 1000;
  const dt = Math.min(Math.max(t - lastT, 0.001), 1 / 30);
  lastT = t;

  stepSpring(dt);

  if (camReady && video && video.readyState >= 2) {
    gl.bindTexture(gl.TEXTURE_2D, camTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  const size = shapeSize();
  const centerDev = [spring.x * dpr, (cssH - spring.y) * dpr];
  const blobDev = [pointer.x * dpr, (cssH - pointer.y) * dpr];
  const radiusPx = (Math.min(size.w, size.h) / 2) * (params.shapeRadius / 100);

  // camera and user photos share one background sampler
  const usingImage = params.bgType === BG_IMAGE;
  if (usingImage) {
    const images = listImages();
    loadBgImage(images[params.bgImageIndex] ? images[params.bgImageIndex].url : '');
  }
  const bgTex = usingImage ? imgTex : camTex;
  const bgTexReady = usingImage ? imgReady : camReady;
  const bgTexRatio = usingImage
    ? imgRatio
    : camReady && video && video.videoWidth
      ? video.videoWidth / video.videoHeight
      : 16 / 9;

  gl.bindVertexArray(quad);

  // pass 1: background + shadow → texBg
  gl.bindFramebuffer(gl.FRAMEBUFFER, texBg.fbo);
  gl.viewport(0, 0, texBg.w, texBg.h);
  gl.useProgram(progBg.p);
  gl.uniform2f(progBg.u.u_resolution, texBg.w, texBg.h);
  gl.uniform1f(progBg.u.u_dpr, dpr);
  gl.uniform1f(progBg.u.u_time, t);
  setShapeUniforms(progBg.u, centerDev, blobDev, size, radiusPx);
  gl.uniform1f(progBg.u.u_shadowExpand, params.shadowExpand);
  gl.uniform1f(progBg.u.u_shadowFactor, params.shadowFactor / 100);
  gl.uniform2f(progBg.u.u_shadowPosition, params.shadowX, params.shadowY);
  gl.uniform1i(progBg.u.u_bgType, params.bgType | 0);
  gl.uniform1f(progBg.u.u_bgTexRatio, bgTexRatio);
  gl.uniform1i(progBg.u.u_bgTexReady, bgTexReady ? 1 : 0);
  gl.uniform1i(progBg.u.u_mirror, params.mirror ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, bgTex);
  gl.uniform1i(progBg.u.u_bgTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // passes 2+3: separable blur, full resolution (vertical then horizontal)
  const radius = Math.round(params.blurRadius);
  computeBlurWeights(radius);
  gl.useProgram(progBlur.p);
  gl.uniform1fv(progBlur.u.u_blurWeights, blurWeights);
  gl.uniform1i(progBlur.u.u_blurRadius, radius);
  gl.uniform2f(progBlur.u.u_resolution, canvas.width, canvas.height);
  gl.uniform1i(progBlur.u.u_prevPassTexture, 0);
  gl.activeTexture(gl.TEXTURE0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, texA.fbo);
  gl.viewport(0, 0, texA.w, texA.h);
  gl.uniform2f(progBlur.u.u_dir, 0, 1);
  gl.bindTexture(gl.TEXTURE_2D, texBg.tex);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.bindFramebuffer(gl.FRAMEBUFFER, texB.fbo);
  gl.viewport(0, 0, texB.w, texB.h);
  gl.uniform2f(progBlur.u.u_dir, 1, 0);
  gl.bindTexture(gl.TEXTURE_2D, texA.tex);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // pass 4: glass → screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.useProgram(progMain.p);
  gl.uniform2f(progMain.u.u_resolution, canvas.width, canvas.height);
  gl.uniform1f(progMain.u.u_dpr, dpr);
  setShapeUniforms(progMain.u, centerDev, blobDev, size, radiusPx);
  gl.uniform1i(progMain.u.u_step, params.step | 0);
  const [tr, tg, tb] = hexToRgb01(params.tintColor);
  gl.uniform4f(progMain.u.u_tint, tr, tg, tb, params.tintAlpha / 100);
  gl.uniform1f(progMain.u.u_refThickness, params.refThickness);
  gl.uniform1f(progMain.u.u_refFactor, params.refFactor);
  gl.uniform1f(progMain.u.u_refDispersion, params.refDispersion);
  gl.uniform1f(progMain.u.u_refFresnelRange, Math.max(params.refFresnelRange, 0.5));
  gl.uniform1f(progMain.u.u_refFresnelHardness, params.refFresnelHardness / 100);
  gl.uniform1f(progMain.u.u_refFresnelFactor, params.refFresnelFactor / 100);
  gl.uniform1f(progMain.u.u_glareRange, Math.max(params.glareRange, 0.5));
  gl.uniform1f(progMain.u.u_glareHardness, params.glareHardness / 100);
  gl.uniform1f(progMain.u.u_glareFactor, params.glareFactor / 100);
  gl.uniform1f(progMain.u.u_glareConvergence, params.glareConvergence / 100);
  gl.uniform1f(progMain.u.u_glareOppositeFactor, params.glareOppositeFactor / 100);
  gl.uniform1f(progMain.u.u_glareAngle, (params.glareAngle * Math.PI) / 180);
  gl.uniform1i(progMain.u.u_blurEdge, params.blurEdge ? 1 : 0);
  gl.uniform1f(progMain.u.u_borderWidth, params.borderWidth);
  gl.uniform1f(progMain.u.u_borderFactor, params.borderEnabled ? params.borderIntensity / 100 : 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texBg.tex);
  gl.uniform1i(progMain.u.u_bg, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texB.tex);
  gl.uniform1i(progMain.u.u_blurredBg, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function tick(tMs) {
  requestAnimationFrame(tick);
  render(tMs);
}
requestAnimationFrame(tick);

// Headless/backgrounded contexts pause rAF — keep rendering via a timer fallback.
setInterval(() => {
  if (performance.now() - lastRender > 400) render(performance.now());
}, 200);

// debug hook
window.__glassLab = () => ({
  params: { ...params },
  pos: { ...pos },
  camReady,
  spring: { x: spring.x, y: spring.y },
  canvas: { w: canvas.width, h: canvas.height, dpr },
});
