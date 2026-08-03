/**
 * Liquid glass renderer — standalone, zero dependencies, WebGL2.
 *
 * Shader math ported from github.com/iyinchao/liquid-glass-studio (MIT,
 * © Charles Yin): lens-model edge refraction, per-channel chromatic
 * dispersion, LCH fresnel rim and angle-lit glare over rounded-rect SDFs.
 * Verified side-by-side against that project.
 *
 * Four passes per frame, all at full canvas resolution (running the blur at
 * half res is what makes it look like washed-out plastic instead of glass):
 *
 *   bgPass  — draw the backdrop source + shade into an offscreen texture
 *   vBlur   — separable gaussian, vertical
 *   hBlur   — separable gaussian, horizontal
 *   mainPass— refract/tint/light every registered shape, output straight alpha
 *
 * The canvas is TRANSPARENT outside the shapes (plus their shadow), so it can
 * sit directly over an existing <video> or DOM background. The backdrop source
 * is still needed as a texture — that is what gets bent and blurred.
 *
 *   const glass = new LiquidGlass(canvas, { preset: GLASS_PRESET });
 *   glass.setSource(videoEl, { x, y, w, h });   // displayed content rect, css px
 *   glass.setShapes([{ x, y, width, height, radius: 12 }]);
 *   glass.start();
 */

const MAX_SHAPES = 16;
const MAX_BLUR_RADIUS = 200;

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Shared SDF. Shapes arrive in device px, y-up, as center.xy + halfSize.zw.
const SDF_CHUNK = `
uniform vec2 u_resolution;
uniform float u_dpr;
uniform int u_shapeCount;
uniform vec4 u_shapeRects[${MAX_SHAPES}];
uniform vec3 u_shapeParams[${MAX_SHAPES}]; // x = corner radius (device px), y = roundness, z = border weight 0..1
uniform float u_mergeRate;

float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  return pow(pow(p.x, n) + pow(p.y, n), 1.0 / n) - r;
}

float rectSDF(vec2 p, vec2 halfSize, float cr, float n) {
  cr = min(cr, min(halfSize.x, halfSize.y));
  vec2 d = abs(p) - halfSize;
  if (d.x > -cr && d.y > -cr) {
    vec2 cornerCenter = sign(p) * (halfSize - vec2(cr));
    return superellipseCornerSDF(p - cornerCenter, cr, n);
  }
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float smin(float a, float b, float k) {
  k = max(k, 1e-5);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// p = device px. Result is normalized by resolution.y, as in the studio.
float sdfAt(vec2 p, vec2 offset) {
  float d = 1e9;
  float k = u_mergeRate * u_resolution.y;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_shapeCount) break;
    vec4 r = u_shapeRects[i];
    float di = rectSDF(p - r.xy - offset, r.zw, u_shapeParams[i].x, u_shapeParams[i].y);
    d = i == 0 ? di : smin(d, di, k);
  }
  return d / u_resolution.y;
}

float mainSDF(vec2 p) {
  return sdfAt(p, vec2(0.0));
}

// border weight of the nearest shape (per-shape activation rings)
float borderWeightAt(vec2 p) {
  float d = 1e9;
  float b = 0.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= u_shapeCount) break;
    vec4 r = u_shapeRects[i];
    float di = rectSDF(p - r.xy, r.zw, u_shapeParams[i].x, u_shapeParams[i].y);
    if (di < d) {
      d = di;
      b = u_shapeParams[i].z;
    }
  }
  return b;
}`;

// ---- pass 1: backdrop ----

const BG_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

${SDF_CHUNK}

uniform sampler2D u_src;
uniform int u_srcReady;
uniform vec4 u_srcRect;   // displayed content rect, device px, y-up
uniform int u_mirror;
uniform float u_shade;
uniform vec3 u_voidColor;

void main() {
  vec3 bgColor = u_voidColor;

  if (u_srcReady == 1) {
    vec2 uv = (gl_FragCoord.xy - u_srcRect.xy) / u_srcRect.zw;
    // Fade to void over a band instead of a hard cut: dispersion samples R,
    // G and B at different offsets, so a 1px source edge splits into a
    // coloured fringe (the red bar along the letterbox boundary).
    vec2 fade = 12.0 / max(u_srcRect.zw, vec2(1.0));
    vec2 m = smoothstep(vec2(0.0), fade, uv) * smoothstep(vec2(0.0), fade, 1.0 - uv);
    vec2 cuv = clamp(uv, 0.0, 1.0);
    if (u_mirror == 1) cuv.x = 1.0 - cuv.x;
    bgColor = mix(u_voidColor, texture(u_src, cuv).rgb, m.x * m.y);
  }

  // the app's own dimming layer, so refraction samples what the eye sees
  bgColor *= 1.0 - u_shade;

  fragColor = vec4(bgColor, 1.0);
}`;

// ---- passes 2+3: separable gaussian ----

const BLUR_FRAG = `#version 300 es
precision highp float;
#define MAX_BLUR_RADIUS (${MAX_BLUR_RADIUS})
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_prevPassTexture;
uniform vec2 u_texResolution;
uniform vec2 u_dir;
uniform int u_blurRadius;
uniform float u_blurWeights[MAX_BLUR_RADIUS + 1];

void main() {
  vec2 texelSize = 1.0 / u_texResolution;
  vec4 color = texture(u_prevPassTexture, v_uv) * u_blurWeights[0];
  for (int i = 1; i <= u_blurRadius; ++i) {
    float w = u_blurWeights[i];
    vec2 offset = u_dir * float(i) * texelSize;
    color += texture(u_prevPassTexture, v_uv + offset) * w;
    color += texture(u_prevPassTexture, v_uv - offset) * w;
  }
  fragColor = color;
}`;

// ---- pass 4: the glass ----

const MAIN_FRAG = `#version 300 es
precision highp float;
#define PI (3.14159265359)

const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
out vec4 fragColor;

${SDF_CHUNK}

uniform sampler2D u_bg;
uniform sampler2D u_blurredBg;
uniform vec4 u_tint;
uniform float u_refThickness;
uniform float u_refFactor;
uniform float u_refDispersion;
uniform float u_refFresnelRange;
uniform float u_refFresnelHardness;
uniform float u_refFresnelFactor;
uniform float u_glareRange;
uniform float u_glareHardness;
uniform float u_glareFactor;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareAngle;
uniform int u_blurEdge;
uniform float u_borderWidth;
uniform float u_borderFactor;
uniform float u_shadowExpand;
uniform float u_shadowFactor;
uniform vec2 u_shadowPosition;

float safeAsin(float x) { return asin(clamp(x, -1.0, 1.0)); }

vec2 getNormal(vec2 p) {
  vec2 h = vec2(max(abs(dFdx(p.x)), 0.0001), max(abs(dFdy(p.y)), 0.0001));
  vec2 grad = vec2(
    mainSDF(p + vec2(h.x, 0.0)) - mainSDF(p - vec2(h.x, 0.0)),
    mainSDF(p + vec2(0.0, h.y)) - mainSDF(p - vec2(0.0, h.y))
  ) / (2.0 * h);
  return grad * 1.414213562 * 1000.0;
}

float vec2ToAngle(vec2 v) {
  float a = atan(v.y, v.x);
  if (a < 0.0) a += 2.0 * PI;
  return a;
}

// --- LCH stack (Rachmanin0xFF/GLSL-Color-Functions, MIT) ---
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
const mat3 RGB_TO_XYZ_M = mat3(0.4124,0.3576,0.1805, 0.2126,0.7152,0.0722, 0.0193,0.1192,0.9505);
const mat3 XYZ_TO_RGB_M = mat3(3.2406255,-1.537208,-0.4986286, -0.9689307,1.8757561,0.0415175, 0.0557101,-0.2040211,1.0569959);
float UNCOMPAND_SRGB(float a){ return a > 0.04045 ? pow((a + 0.055)/1.055, 2.4) : a/12.92; }
float COMPAND_RGB(float a){ return a <= 0.0031308 ? 12.92*a : 1.055*pow(a, 0.41666666666) - 0.055; }
vec3 SRGB_TO_RGB(vec3 c){ return vec3(UNCOMPAND_SRGB(c.x), UNCOMPAND_SRGB(c.y), UNCOMPAND_SRGB(c.z)); }
vec3 RGB_TO_SRGB(vec3 c){ return vec3(COMPAND_RGB(c.x), COMPAND_RGB(c.y), COMPAND_RGB(c.z)); }
float XYZ_TO_LAB_F(float x){ return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704*x + 0.13793103448; }
vec3 XYZ_TO_LAB(vec3 xyz){
  vec3 s = xyz / D65_WHITE;
  s = vec3(XYZ_TO_LAB_F(s.x), XYZ_TO_LAB_F(s.y), XYZ_TO_LAB_F(s.z));
  return vec3(116.0*s.y - 16.0, 500.0*(s.x - s.y), 200.0*(s.y - s.z));
}
vec3 SRGB_TO_LCH(vec3 srgb){
  vec3 lab = XYZ_TO_LAB(SRGB_TO_RGB(srgb) * RGB_TO_XYZ_M);
  return vec3(lab.x, sqrt(dot(lab.yz, lab.yz)), atan(lab.z, lab.y) * 57.2957795131);
}
float LAB_TO_XYZ_F(float x){ return x > 0.206897 ? x*x*x : 0.12841854934*(x - 0.137931034); }
vec3 LAB_TO_XYZ(vec3 lab){
  float w = (lab.x + 16.0)/116.0;
  return D65_WHITE * vec3(LAB_TO_XYZ_F(w + lab.y/500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - lab.z/200.0));
}
vec3 LCH_TO_SRGB(vec3 lch){
  vec3 lab = vec3(lch.x, lch.y*cos(lch.z*0.01745329251), lch.y*sin(lch.z*0.01745329251));
  return RGB_TO_SRGB(LAB_TO_XYZ(lab) * XYZ_TO_RGB_M);
}
// --- end LCH stack ---

// Per-channel sampling — the chromatic aberration.
vec4 getTextureDispersion(sampler2D tex1, sampler2D tex2, float mixRate, vec2 offset, float factor) {
  vec4 pixel = vec4(1.0);
  float bgR = texture(tex1, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float bgG = texture(tex1, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float bgB = texture(tex1, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;
  float blurR = texture(tex2, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float blurG = texture(tex2, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float blurB = texture(tex2, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;
  pixel.r = mix(bgR, blurR, mixRate);
  pixel.g = mix(bgG, blurG, mixRate);
  pixel.b = mix(bgB, blurB, mixRate);
  return pixel;
}

void main() {
  vec2 res1x = u_resolution.xy / u_dpr;
  float merged = mainSDF(gl_FragCoord.xy);

  vec4 outColor = vec4(0.0);

  if (merged < 0.005) {
    float nmerged = -1.0 * (merged * res1x.y);

    float x_R_ratio = 1.0 - nmerged / u_refThickness;
    float thetaI = safeAsin(pow(x_R_ratio, 2.0));
    float thetaT = safeAsin(1.0 / u_refFactor * sin(thetaI));
    float edgeFactor = -1.0 * tan(thetaT - thetaI);
    if (nmerged >= u_refThickness) edgeFactor = 0.0;

    if (edgeFactor <= 0.0) {
      outColor = texture(u_blurredBg, v_uv);
      outColor = mix(outColor, vec4(u_tint.rgb, 1.0), u_tint.a * 0.8);
    } else {
      float edgeH = nmerged / u_refThickness;
      vec2 normal = getNormal(gl_FragCoord.xy);
      vec4 blurredPixel = getTextureDispersion(
        u_bg, u_blurredBg,
        u_blurEdge > 0 ? 1.0 : edgeH,
        -normal * edgeFactor * 0.05 * u_dpr * vec2(u_resolution.y / (res1x.x * u_dpr), 1.0),
        u_refDispersion
      );

      outColor = mix(blurredPixel, vec4(u_tint.rgb, 1.0), u_tint.a * 0.8);

      float fresnelFactor = clamp(pow(1.0 + merged * res1x.y / 1500.0 *
        pow(500.0 / u_refFresnelRange, 2.0) + u_refFresnelHardness, 5.0), 0.0, 1.0);
      vec3 fresnelTintLCH = SRGB_TO_LCH(mix(vec3(1.0), u_tint.rgb, u_tint.a * 0.5));
      fresnelTintLCH.x = clamp(fresnelTintLCH.x + 20.0 * fresnelFactor * u_refFresnelFactor, 0.0, 100.0);
      outColor = mix(outColor, vec4(LCH_TO_SRGB(fresnelTintLCH), 1.0),
        fresnelFactor * u_refFresnelFactor * 0.7 * length(normal));

      float glareGeoFactor = clamp(pow(1.0 + merged * res1x.y / 1500.0 *
        pow(500.0 / u_glareRange, 2.0) + u_glareHardness, 5.0), 0.0, 1.0);
      float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
      int glareFarside = 0;
      if (glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) || glareAngle < PI * (0.0 - 0.5)) {
        glareFarside = 1;
      }
      float glareAngleFactor = (0.5 + sin(glareAngle) * 0.5) *
        (glareFarside == 1 ? 1.2 * u_glareOppositeFactor : 1.2) * u_glareFactor;
      glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

      vec3 glareTintLCH = SRGB_TO_LCH(mix(blurredPixel.rgb, u_tint.rgb, u_tint.a * 0.5));
      glareTintLCH.x = clamp(glareTintLCH.x + 150.0 * glareAngleFactor * glareGeoFactor, 0.0, 120.0);
      glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
      outColor = mix(outColor, vec4(LCH_TO_SRGB(glareTintLCH), 1.0),
        glareAngleFactor * glareGeoFactor * length(normal));
    }
  }

  // white border highlight hugging the rim, weighted per shape (activation)
  if (u_borderFactor > 0.0) {
    float bw = borderWeightAt(gl_FragCoord.xy);
    if (bw > 0.0) {
      float dCss = merged * res1x.y;
      float band = abs(dCss + u_borderWidth * 0.5) - u_borderWidth * 0.5;
      float mask = 1.0 - smoothstep(-0.75, 0.75, band);
      outColor = mix(outColor, vec4(1.0), mask * u_borderFactor * bw);
    }
  }

  // straight-alpha output: opaque over the shape, shadow outside, clear beyond
  float coverage = 1.0 - smoothstep(-0.001, 0.001, merged);
  float shadowSdf = sdfAt(gl_FragCoord.xy, u_shadowPosition * u_dpr);
  float shadow = exp(-1.0 / u_shadowExpand * abs(shadowSdf) * res1x.y) * 0.6 * u_shadowFactor;
  shadow *= 1.0 - coverage;

  float alpha = clamp(coverage + shadow, 0.0, 1.0);
  vec3 rgb = alpha > 0.0 ? mix(vec3(0.0), outColor.rgb, coverage / max(alpha, 1e-5)) : vec3(0.0);
  fragColor = vec4(rgb, alpha);
}`;

// ---------------------------------------------------------------------------

function hexToRgb01(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class LiquidGlass {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{preset?: object, maxDpr?: number, voidColor?: [number,number,number]}} [options]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.preset = { ...options.preset };
    this.maxDpr = options.maxDpr ?? 2;
    this.voidColor = options.voidColor ?? [0, 0, 0];

    this.shapes = [];
    this.source = null;
    this.sourceRect = null;
    this.mirror = !!options.mirror;
    this.shade = 0;
    this.running = false;
    this._raf = 0;
    this._blurWeights = new Float32Array(MAX_BLUR_RADIUS + 1);
    this._blurWeightsRadius = -1;
    this._lastFrameKey = '';

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
    });
    if (!gl) throw new Error('[liquid-glass] WebGL2 is not available');
    this.gl = gl;

    this.progBg = this._program(VERT, BG_FRAG);
    this.progBlur = this._program(VERT, BLUR_FRAG);
    this.progMain = this._program(VERT, MAIN_FRAG);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.srcTex = this._texture([0, 0, 0, 255]);
    this.targets = null;
    this.resize();
  }

  // ---- gl plumbing ----

  _compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`[liquid-glass] shader compile failed: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  }

  _program(vertSrc, fragSrc) {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`[liquid-glass] link failed: ${gl.getProgramInfoLog(p)}`);
    }
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  _texture(fill) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(fill));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _target(w, h) {
    const gl = this.gl;
    const tex = this._texture([0, 0, 0, 255]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  // matches the studio's computeGaussianKernelByRadius
  _weights(radius) {
    if (radius === this._blurWeightsRadius) return;
    this._blurWeightsRadius = radius;
    this._blurWeights = new Float32Array(MAX_BLUR_RADIUS + 1);
    const sigma = radius / 3.0;
    let sum = 0;
    for (let i = 0; i <= radius; i++) {
      const w = sigma > 0 ? Math.exp((-0.5 * (i * i)) / (sigma * sigma)) : i === 0 ? 1 : 0;
      this._blurWeights[i] = w;
      sum += i === 0 ? w : 2 * w;
    }
    for (let i = 0; i <= radius; i++) this._blurWeights[i] /= sum;
  }

  // ---- public api ----

  /** Merge in preset changes; unspecified fields keep their current value. */
  setPreset(partial) {
    Object.assign(this.preset, partial);
    return this;
  }

  getPreset() {
    return { ...this.preset };
  }

  /**
   * Backdrop to refract.
   * @param {HTMLVideoElement|HTMLImageElement|HTMLCanvasElement|null} source
   * @param {{x:number,y:number,w:number,h:number}|null} rect displayed content
   *   rect in CSS px relative to the canvas; null = fill the canvas.
   */
  setSource(source, rect = null) {
    this.source = source;
    this.sourceRect = rect;
    return this;
  }

  setMirror(on) {
    this.mirror = !!on;
    return this;
  }

  /** 0..1 dimming applied to the backdrop before refraction. */
  setShade(v) {
    this.shade = Math.min(1, Math.max(0, v || 0));
    return this;
  }

  /**
   * @param {Array<{x:number,y:number,width:number,height:number,radius?:number,roundness?:number}>} shapes
   *   CSS px, top-left origin, relative to the canvas. Beyond 16 are ignored.
   */
  setShapes(shapes) {
    this.shapes = shapes.slice(0, MAX_SHAPES);
    return this;
  }

  /** Re-read the canvas' CSS size and rebuild the offscreen targets. */
  resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const cssW = this.canvas.clientWidth || this.canvas.width;
    const cssH = this.canvas.clientHeight || this.canvas.height;
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (this.canvas.width === w && this.canvas.height === h && this.targets) return this;

    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.targets) {
      for (const t of Object.values(this.targets)) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    // all full resolution — half-res blur is what kills the glass look
    this.targets = { bg: this._target(w, h), a: this._target(w, h), b: this._target(w, h) };
    return this;
  }

  /** Draw one frame. Safe to call directly if you drive your own rAF loop. */
  renderFrame() {
    const gl = this.gl;
    const p = this.preset;
    if (!this.targets) return;

    const { bg, a, b } = this.targets;
    const dpr = this.dpr;
    const W = this.canvas.width;
    const H = this.canvas.height;

    // upload the backdrop
    let srcReady = false;
    const src = this.source;
    if (src) {
      const ready = src instanceof HTMLVideoElement ? src.readyState >= 2 : src.width > 0 || src.complete;
      if (ready) {
        gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        srcReady = true;
      }
    }

    // source rect in device px, y-up
    const r = this.sourceRect;
    const srcRect = r
      ? [r.x * dpr, H - (r.y + r.h) * dpr, r.w * dpr, r.h * dpr]
      : [0, 0, W, H];

    // shapes -> uniform arrays (device px, y-up)
    const count = this.shapes.length;
    const rects = new Float32Array(MAX_SHAPES * 4);
    const sparams = new Float32Array(MAX_SHAPES * 3);
    for (let i = 0; i < count; i++) {
      const s = this.shapes[i];
      const cx = (s.x + s.width / 2) * dpr;
      const cy = H - (s.y + s.height / 2) * dpr;
      rects.set([cx, cy, (s.width / 2) * dpr, (s.height / 2) * dpr], i * 4);
      sparams.set([(s.radius ?? 12) * dpr, s.roundness ?? p.shapeRoundness ?? 5, s.border ?? 0], i * 3);
    }

    const setShapeUniforms = (prog) => {
      gl.uniform2f(prog.u.u_resolution, W, H);
      gl.uniform1f(prog.u.u_dpr, dpr);
      gl.uniform1i(prog.u.u_shapeCount, count);
      gl.uniform4fv(prog.u.u_shapeRects, rects);
      gl.uniform3fv(prog.u.u_shapeParams, sparams);
      gl.uniform1f(prog.u.u_mergeRate, p.mergeRate ?? 0);
    };

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // pass 1: backdrop
    gl.bindFramebuffer(gl.FRAMEBUFFER, bg.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.progBg.p);
    setShapeUniforms(this.progBg);
    gl.uniform4f(this.progBg.u.u_srcRect, srcRect[0], srcRect[1], srcRect[2], srcRect[3]);
    gl.uniform1i(this.progBg.u.u_srcReady, srcReady ? 1 : 0);
    gl.uniform1i(this.progBg.u.u_mirror, this.mirror ? 1 : 0);
    gl.uniform1f(this.progBg.u.u_shade, this.shade);
    gl.uniform3fv(this.progBg.u.u_voidColor, this.voidColor);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(this.progBg.u.u_src, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // passes 2+3: blur (vertical then horizontal), full res
    const radius = Math.max(0, Math.round(p.blurRadius ?? 1));
    this._weights(radius);
    gl.useProgram(this.progBlur.p);
    gl.uniform1fv(this.progBlur.u.u_blurWeights, this._blurWeights);
    gl.uniform1i(this.progBlur.u.u_blurRadius, radius);
    gl.uniform2f(this.progBlur.u.u_texResolution, W, H);
    gl.uniform1i(this.progBlur.u.u_prevPassTexture, 0);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
    gl.uniform2f(this.progBlur.u.u_dir, 0, 1);
    gl.bindTexture(gl.TEXTURE_2D, bg.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
    gl.uniform2f(this.progBlur.u.u_dir, 1, 0);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 4: glass to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;

    const m = this.progMain;
    gl.useProgram(m.p);
    setShapeUniforms(m);
    const [tr, tg, tb] = hexToRgb01(p.tintColor ?? '#ffffff');
    gl.uniform4f(m.u.u_tint, tr, tg, tb, (p.tintAlpha ?? 0) / 100);
    gl.uniform1f(m.u.u_refThickness, p.refThickness);
    gl.uniform1f(m.u.u_refFactor, p.refFactor);
    gl.uniform1f(m.u.u_refDispersion, p.refDispersion);
    gl.uniform1f(m.u.u_refFresnelRange, Math.max(p.refFresnelRange, 0.5));
    gl.uniform1f(m.u.u_refFresnelHardness, p.refFresnelHardness / 100);
    gl.uniform1f(m.u.u_refFresnelFactor, p.refFresnelFactor / 100);
    gl.uniform1f(m.u.u_glareRange, Math.max(p.glareRange, 0.5));
    gl.uniform1f(m.u.u_glareHardness, p.glareHardness / 100);
    gl.uniform1f(m.u.u_glareFactor, p.glareFactor / 100);
    gl.uniform1f(m.u.u_glareConvergence, p.glareConvergence / 100);
    gl.uniform1f(m.u.u_glareOppositeFactor, p.glareOppositeFactor / 100);
    gl.uniform1f(m.u.u_glareAngle, ((p.glareAngle ?? 0) * Math.PI) / 180);
    gl.uniform1i(m.u.u_blurEdge, p.blurEdge ? 1 : 0);
    gl.uniform1f(m.u.u_borderWidth, p.borderWidth ?? 0);
    gl.uniform1f(m.u.u_borderFactor, p.borderEnabled ? (p.borderIntensity ?? 0) / 100 : 0);
    gl.uniform1f(m.u.u_shadowExpand, Math.max(p.shadowExpand ?? 25, 0.01));
    gl.uniform1f(m.u.u_shadowFactor, (p.shadowFactor ?? 0) / 100);
    gl.uniform2f(m.u.u_shadowPosition, p.shadowX ?? 0, p.shadowY ?? 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bg.tex);
    gl.uniform1i(m.u.u_bg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, b.tex);
    gl.uniform1i(m.u.u_blurredBg, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Start an internal rAF loop. */
  start() {
    if (this.running) return this;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(tick);
      this.renderFrame();
    };
    this._raf = requestAnimationFrame(tick);
    return this;
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    return this;
  }

  dispose() {
    this.stop();
    const gl = this.gl;
    if (this.targets) {
      for (const t of Object.values(this.targets)) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    gl.deleteTexture(this.srcTex);
    for (const prog of [this.progBg, this.progBlur, this.progMain]) gl.deleteProgram(prog.p);
    this.targets = null;
  }
}

export const MAX_GLASS_SHAPES = MAX_SHAPES;
export default LiquidGlass;
