// GLSL for the 4-pass pipeline, ported from iyinchao/liquid-glass-studio (MIT):
// bgPass -> vBlurPass -> hBlurPass -> mainPass, all at full canvas resolution.
// Shape set matches the studio (rounded-rect + circle joined by a smooth-min),
// with the camera added as a background source and a white border highlight.

export const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Shared SDF chunk. Requires u_dpr, u_resolution, the shape uniforms (CSS px),
// u_shapeCenter / u_blobCenter (device px, y-up), u_mergeRate, u_showBlob.
const SDF_CHUNK = `
float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  float v = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
  return v - r;
}

float roundedRectSDF(vec2 p, float width, float height, float cornerRadius, float n) {
  float cr = cornerRadius * u_dpr;
  vec2 d = abs(p) - vec2(width * u_dpr, height * u_dpr) * 0.5;
  if (d.x > -cr && d.y > -cr) {
    vec2 cornerCenter = sign(p) * (vec2(width * u_dpr, height * u_dpr) * 0.5 - vec2(cr));
    return superellipseCornerSDF(p - cornerCenter, cr, n);
  }
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float smin(float a, float b, float k) {
  k = max(k, 1e-5);
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// p in device pixels (gl_FragCoord.xy); result normalized by resolution.y,
// offset by u_sdfOffset (used by the shadow pass).
float mainSDFAt(vec2 p, vec2 sdfOffset) {
  vec2 pr = (p - u_shapeCenter - sdfOffset) / u_resolution.y;
  vec2 pb = (p - u_blobCenter - sdfOffset) / u_resolution.y;

  float dRect = roundedRectSDF(
    pr,
    u_shapeWidth / u_resolution.y,
    u_shapeHeight / u_resolution.y,
    u_shapeRadius / u_resolution.y,
    u_shapeRoundness
  );
  float dBlob = u_showBlob == 1
    ? sdCircle(pb, u_blobRadius * u_dpr / u_resolution.y)
    : 1.0;

  return smin(dBlob, dRect, u_mergeRate);
}

float mainSDF(vec2 p) {
  return mainSDFAt(p, vec2(0.0));
}
`;

// Uniform block shared by every pass that evaluates the SDF.
const SHAPE_UNIFORMS = `
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_shapeCenter;
uniform vec2 u_blobCenter;
uniform float u_shapeWidth;
uniform float u_shapeHeight;
uniform float u_shapeRadius;
uniform float u_shapeRoundness;
uniform float u_blobRadius;
uniform float u_mergeRate;
uniform int u_showBlob;
`;

// ---- pass 1: background (source image/pattern + drop shadow) ----

export const BG_FRAG = `#version 300 es
precision highp float;

#define PI (3.14159265359)

in vec2 v_uv;
out vec4 fragColor;

${SHAPE_UNIFORMS}

uniform float u_time;
uniform float u_shadowExpand;
uniform float u_shadowFactor;
uniform vec2 u_shadowPosition;
uniform sampler2D u_bgTex;
uniform float u_bgTexRatio;
uniform int u_bgTexReady;
uniform int u_mirror;
uniform int u_bgType;

${SDF_CHUNK}

float chessboard(vec2 uv, float size, int mode) {
  float yBars = step(size * 2.0, mod(uv.y * 2.0, size * 4.0));
  float xBars = step(size * 2.0, mod(uv.x * 2.0, size * 4.0));
  if (mode == 0) return yBars;
  if (mode == 1) return xBars;
  return abs(yBars - xBars);
}

vec2 getCoverUV(vec2 uv, float canvasAspect, float textureAspect) {
  if (canvasAspect > textureAspect) {
    float scale = textureAspect / canvasAspect;
    uv.y = uv.y * scale + 0.5 - 0.5 * scale;
  } else {
    float scale = canvasAspect / textureAspect;
    uv.x = uv.x * scale + 0.5 - 0.5 * scale;
  }
  return uv;
}

vec3 hsv2rgbBg(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Soft drifting blobs — the stand-in when no camera and no image is loaded.
vec3 gradientBg(vec2 uv, float t) {
  vec3 col = vec3(0.10, 0.105, 0.12);
  vec2 a = uv - vec2(0.30 + 0.10 * sin(t * 0.23), 0.62 + 0.08 * cos(t * 0.31));
  vec2 b = uv - vec2(0.72 + 0.09 * cos(t * 0.17), 0.36 + 0.10 * sin(t * 0.27));
  vec2 c = uv - vec2(0.52 + 0.12 * sin(t * 0.13), 0.78 + 0.07 * cos(t * 0.19));
  col += vec3(0.55, 0.30, 0.18) * exp(-dot(a, a) * 9.0);
  col += vec3(0.16, 0.30, 0.48) * exp(-dot(b, b) * 7.0);
  col += vec3(0.20, 0.38, 0.28) * exp(-dot(c, c) * 11.0);
  return col;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  vec2 fragCss = gl_FragCoord.xy / u_dpr;
  vec3 bgColor;

  if (u_bgType == 0 || u_bgType == 6) {
    // 0 = camera, 6 = custom image; both arrive through u_bgTex
    if (u_bgTexReady == 1) {
      vec2 uv = v_uv;
      if (u_bgType == 0 && u_mirror == 1) uv.x = 1.0 - uv.x;
      uv = getCoverUV(uv, u_resolution.x / u_resolution.y, u_bgTexRatio);
      bgColor = texture(u_bgTex, uv).rgb;
    } else {
      bgColor = gradientBg(v_uv, u_time);
    }
  } else if (u_bgType == 1) {
    // studio "chessboard"
    bgColor = vec3(1.0 - chessboard(fragCss, 20.0, 2) / 4.0);
  } else if (u_bgType == 2) {
    // studio "bars" quadrants — hard edges make dispersion obvious
    bgColor = vec3(1.0);
    if (v_uv.x < 0.5 && v_uv.y > 0.5) {
      bgColor = vec3(chessboard(fragCss, 10.0, 0));
    } else if (v_uv.x > 0.5 && v_uv.y < 0.5) {
      bgColor = vec3(chessboard(fragCss, 10.0, 1));
    } else if (v_uv.x < 0.5 && v_uv.y < 0.5) {
      bgColor = vec3(0.0);
    }
  } else if (u_bgType == 3) {
    // studio "half"
    bgColor = vec3(step(0.5, v_uv.y) * 0.6 + 0.3);
  } else if (u_bgType == 4) {
    // fine graph paper
    vec2 g = abs(fract(fragCss / 40.0) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.02, min(g.x, g.y));
    vec2 g2 = abs(fract(fragCss / 200.0) - 0.5);
    float major = 1.0 - smoothstep(0.0, 0.005, min(g2.x, g2.y));
    bgColor = mix(vec3(0.93), vec3(0.62, 0.70, 0.82), line * 0.7);
    bgColor = mix(bgColor, vec3(0.35, 0.48, 0.68), major * 0.8);
  } else {
    // saturated hue field — makes chromatic fringing easy to read
    float hue = fract(v_uv.x * 0.9 + v_uv.y * 0.15);
    bgColor = hsv2rgbBg(vec3(hue, 0.75, 0.55 + 0.35 * v_uv.y));
  }

  // drop shadow of the glass shape
  vec2 shadowOffset = u_shadowPosition * u_dpr;
  float merged = mainSDFAt(gl_FragCoord.xy, shadowOffset);
  float shadow = exp(-1.0 / u_shadowExpand * abs(merged) * u_resolution1x.y) * 0.6 * u_shadowFactor;

  fragColor = vec4(bgColor - vec3(shadow), 1.0);
}
`;

// ---- passes 2+3: separable gaussian blur, full resolution ----

export const BLUR_FRAG = `#version 300 es
precision highp float;

#define MAX_BLUR_RADIUS (200)

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_prevPassTexture;
uniform vec2 u_resolution;
uniform vec2 u_dir;
uniform int u_blurRadius;
uniform float u_blurWeights[MAX_BLUR_RADIUS + 1];

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 color = texture(u_prevPassTexture, v_uv) * u_blurWeights[0];
  for (int i = 1; i <= u_blurRadius; ++i) {
    float w = u_blurWeights[i];
    vec2 offset = u_dir * float(i) * texelSize;
    color += texture(u_prevPassTexture, v_uv + offset) * w;
    color += texture(u_prevPassTexture, v_uv - offset) * w;
  }
  fragColor = color;
}
`;

// ---- pass 4: liquid glass ----

export const MAIN_FRAG = `#version 300 es
precision highp float;

#define PI (3.14159265359)

const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
out vec4 fragColor;

${SHAPE_UNIFORMS}

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
uniform int u_step;

${SDF_CHUNK}

float safeAsin(float x) {
  return asin(clamp(x, -1.0, 1.0));
}

vec2 getNormal(vec2 p) {
  vec2 h = vec2(max(abs(dFdx(p.x)), 0.0001), max(abs(dFdy(p.y)), 0.0001));
  vec2 grad = vec2(
    mainSDF(p + vec2(h.x, 0.0)) - mainSDF(p - vec2(h.x, 0.0)),
    mainSDF(p + vec2(0.0, h.y)) - mainSDF(p - vec2(0.0, h.y))
  ) / (2.0 * h);
  return grad * 1.414213562 * 1000.0;
}

float vec2ToAngle(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  return angle;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 vec2ToRgb(vec2 v) {
  return hsv2rgb(vec3(vec2ToAngle(v) / (2.0 * PI), 1.0, 1.0));
}

// --- LCH color stack (from Rachmanin0xFF/GLSL-Color-Functions, MIT) ---
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
const mat3 RGB_TO_XYZ_M = mat3(
  0.4124, 0.3576, 0.1805,
  0.2126, 0.7152, 0.0722,
  0.0193, 0.1192, 0.9505
);
const mat3 XYZ_TO_RGB_M = mat3(
   3.2406255, -1.537208 , -0.4986286,
  -0.9689307,  1.8757561,  0.0415175,
   0.0557101, -0.2040211,  1.0569959
);
float UNCOMPAND_SRGB(float a) {
  return a > 0.04045 ? pow((a + 0.055) / 1.055, 2.4) : a / 12.92;
}
float COMPAND_RGB(float a) {
  return a <= 0.0031308 ? 12.92 * a : 1.055 * pow(a, 0.41666666666) - 0.055;
}
vec3 SRGB_TO_RGB(vec3 srgb) {
  return vec3(UNCOMPAND_SRGB(srgb.x), UNCOMPAND_SRGB(srgb.y), UNCOMPAND_SRGB(srgb.z));
}
vec3 RGB_TO_SRGB(vec3 rgb) {
  return vec3(COMPAND_RGB(rgb.x), COMPAND_RGB(rgb.y), COMPAND_RGB(rgb.z));
}
float XYZ_TO_LAB_F(float x) {
  return x > 0.00885645167 ? pow(x, 0.333333333) : 7.78703703704 * x + 0.13793103448;
}
vec3 XYZ_TO_LAB(vec3 xyz) {
  vec3 s = xyz / D65_WHITE;
  s = vec3(XYZ_TO_LAB_F(s.x), XYZ_TO_LAB_F(s.y), XYZ_TO_LAB_F(s.z));
  return vec3(116.0 * s.y - 16.0, 500.0 * (s.x - s.y), 200.0 * (s.y - s.z));
}
vec3 SRGB_TO_LCH(vec3 srgb) {
  vec3 lab = XYZ_TO_LAB(SRGB_TO_RGB(srgb) * RGB_TO_XYZ_M);
  return vec3(lab.x, sqrt(dot(lab.yz, lab.yz)), atan(lab.z, lab.y) * 57.2957795131);
}
float LAB_TO_XYZ_F(float x) {
  return x > 0.206897 ? x * x * x : 0.12841854934 * (x - 0.137931034);
}
vec3 LAB_TO_XYZ(vec3 lab) {
  float w = (lab.x + 16.0) / 116.0;
  return D65_WHITE * vec3(LAB_TO_XYZ_F(w + lab.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - lab.z / 200.0));
}
vec3 LCH_TO_SRGB(vec3 lch) {
  vec3 lab = vec3(lch.x, lch.y * cos(lch.z * 0.01745329251), lch.y * sin(lch.z * 0.01745329251));
  return RGB_TO_SRGB(LAB_TO_XYZ(lab) * XYZ_TO_RGB_M);
}
// --- end LCH stack ---

// Per-channel refraction offsets — the chromatic aberration.
vec4 getTextureDispersion(
  sampler2D tex1,
  sampler2D tex2,
  float mixRate,
  vec2 offset,
  float factor
) {
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
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  float merged = mainSDF(gl_FragCoord.xy);

  vec4 outColor;

  // debug steps 0..8 mirror the studio's "Show Step" views
  if (u_step <= 0) {
    float px = 2.0 / u_resolution.y;
    vec3 col = merged > 0.0 ? vec3(merged) : vec3(-merged * 2.0);
    col *= 3.0;
    col = mix(col, vec3(1.0),
      1.0 - smoothstep(0.5 / u_resolution1x.y - px, 0.5 / u_resolution1x.y + px, abs(merged)));
    outColor = vec4(col, 1.0);
  } else if (u_step <= 1) {
    float px = 2.0 / u_resolution.y;
    vec3 col = merged > 0.0 ? vec3(0.9, 0.6, 0.3) : vec3(0.65, 0.85, 1.0);
    col *= 1.0 - exp(-0.03 * abs(merged) * u_resolution1x.y);
    col *= 0.6 + 0.4 * smoothstep(-0.5, 0.5, cos(0.25 * abs(merged) * u_resolution1x.y * 2.0));
    col = mix(col, vec3(1.0),
      1.0 - smoothstep(1.5 / u_resolution1x.y - px, 1.5 / u_resolution1x.y + px, abs(merged)));
    outColor = vec4(col, 1.0);
  } else if (u_step <= 2) {
    if (merged < 0.0) {
      vec2 normal = getNormal(gl_FragCoord.xy);
      outColor = vec4(vec2ToRgb(normal) * clamp(length(normal), 0.0, 1.0), 1.0);
    } else {
      outColor = vec4(vec3(0.15), 1.0);
    }
  } else if (u_step <= 3 || u_step <= 4) {
    if (merged < 0.0) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);
      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = safeAsin(pow(x_R_ratio, 2.0));
      float thetaT = safeAsin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) edgeFactor = 0.0;

      if (u_step <= 3) {
        outColor = vec4(vec3(edgeFactor), 1.0);
      } else {
        vec2 normal = getNormal(gl_FragCoord.xy);
        outColor = vec4(vec2ToRgb(normal) * edgeFactor * u_dpr * length(normal), 1.0);
      }
    } else {
      outColor = vec4(vec3(0.0), 1.0);
    }
  } else if (u_step <= 5) {
    outColor = merged < 0.0 ? texture(u_blurredBg, v_uv) : texture(u_bg, v_uv);
  } else if (u_step <= 8) {
    // 6 = refraction only, 7 = + fresnel, 8 = + glare (all on the blurred bg)
    if (merged < 0.0) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);
      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = safeAsin(pow(x_R_ratio, 2.0));
      float thetaT = safeAsin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) edgeFactor = 0.0;

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
      } else {
        vec2 normal = getNormal(gl_FragCoord.xy);
        vec2 offset = -normal * edgeFactor * 0.05 * u_dpr *
          vec2(u_resolution.y / u_resolution1x.x, 1.0);
        outColor = texture(u_blurredBg, v_uv + offset, u_step <= 6 ? 0.0 : u_refDispersion);

        if (u_step >= 7) {
          float fresnelFactor = clamp(
            pow(1.0 + merged * u_resolution1x.y / 1500.0 *
              pow(500.0 / u_refFresnelRange, 2.0) + u_refFresnelHardness, 5.0), 0.0, 1.0);
          outColor = mix(outColor, vec4(1.0), fresnelFactor * u_refFresnelFactor * 0.7);
        }
        if (u_step >= 8) {
          float glareGeoFactor = clamp(
            pow(1.0 + merged * u_resolution1x.y / 1500.0 *
              pow(500.0 / u_glareRange, 2.0) + u_glareHardness, 5.0), 0.0, 1.0);
          float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
          int glareFarside = 0;
          if (glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) ||
              glareAngle < PI * (0.0 - 0.5)) {
            glareFarside = 1;
          }
          float glareAngleFactor = (0.5 + sin(glareAngle) * 0.5) *
            (glareFarside == 1 ? 0.8 : 1.2) * u_glareFactor;
          glareAngleFactor = clamp(pow(glareAngleFactor, 0.3 + u_glareConvergence * 1.5), 0.0, 1.0);
          outColor = mix(outColor, vec4(1.0), glareAngleFactor * glareGeoFactor);
        }
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else {
    // step 9 — the full material
    if (merged < 0.005) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      // refraction edge factor (Snell through a circular edge profile)
      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = safeAsin(pow(x_R_ratio, 2.0));
      float thetaT = safeAsin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
        outColor = mix(outColor, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);
      } else {
        float edgeH = nmerged / u_refThickness;
        vec2 normal = getNormal(gl_FragCoord.xy);
        vec4 blurredPixel = getTextureDispersion(
          u_bg,
          u_blurredBg,
          u_blurEdge > 0 ? 1.0 : edgeH,
          -normal *
            edgeFactor *
            0.05 *
            u_dpr *
            vec2(u_resolution.y / (u_resolution1x.x * u_dpr), 1.0),
          u_refDispersion
        );

        // basic tint
        outColor = mix(blurredPixel, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);

        // fresnel rim
        float fresnelFactor = clamp(
          pow(
            1.0 +
              merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
              u_refFresnelHardness,
            5.0
          ),
          0.0,
          1.0
        );

        vec3 fresnelTintLCH = SRGB_TO_LCH(
          mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        fresnelTintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
        fresnelTintLCH.x = clamp(fresnelTintLCH.x, 0.0, 100.0);

        outColor = mix(
          outColor,
          vec4(LCH_TO_SRGB(fresnelTintLCH), 1.0),
          fresnelFactor * u_refFresnelFactor * 0.7 * length(normal)
        );

        // glare
        float glareGeoFactor = clamp(
          pow(
            1.0 +
              merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) +
              u_glareHardness,
            5.0
          ),
          0.0,
          1.0
        );

        float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
        int glareFarside = 0;
        if (
          glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) ||
          glareAngle < PI * (0.0 - 0.5)
        ) {
          glareFarside = 1;
        }
        float glareAngleFactor =
          (0.5 + sin(glareAngle) * 0.5) *
          (glareFarside == 1
            ? 1.2 * u_glareOppositeFactor
            : 1.2) *
          u_glareFactor;
        glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

        vec3 glareTintLCH = SRGB_TO_LCH(
          mix(blurredPixel.rgb, vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        glareTintLCH.x += 150.0 * glareAngleFactor * glareGeoFactor;
        glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
        glareTintLCH.x = clamp(glareTintLCH.x, 0.0, 120.0);

        outColor = mix(
          outColor,
          vec4(LCH_TO_SRGB(glareTintLCH), 1.0),
          glareAngleFactor * glareGeoFactor * length(normal)
        );
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }

    // anti-aliased composite onto the background
    outColor = mix(outColor, texture(u_bg, v_uv), smoothstep(-0.001, 0.001, merged));
  }

  // white border highlight hugging the shape edge (band just inside the rim)
  if (u_borderFactor > 0.0 && u_step >= 9) {
    float dCss = merged * u_resolution1x.y;
    float bw = u_borderWidth;
    float band = abs(dCss + bw * 0.5) - bw * 0.5;
    float mask = 1.0 - smoothstep(-0.75, 0.75, band);
    outColor = mix(outColor, vec4(1.0), mask * u_borderFactor);
  }

  fragColor = outColor;
}
`;
