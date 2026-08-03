import { memo, useEffect, useRef } from 'react';
import { useGestures } from '../gesture/GestureProvider';

/**
 * Liquid-glass renderer — shader math ported from
 * github.com/iyinchao/liquid-glass-studio (MIT, © Charles Yin): lens-model
 * edge refraction, per-channel chromatic dispersion, fresnel rim and
 * angle-lit glare over a rounded-rect SDF.
 *
 * ONE WebGL2 canvas overlays the stage (above the video+shade, below all
 * panels) and draws every registered glass shape per frame, sampling the
 * live camera texture — far cheaper than per-element backdrop-filters, and
 * it works in every browser. Elements opt in by mounting <GlassShape>.
 */

const registry = new Map<HTMLElement, number>(); // element -> corner radius (css px)

export const GlassShape = memo(function GlassShape({ radius }: { radius: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    registry.set(host, radius);
    return () => {
      registry.delete(host);
    };
  }, [radius]);
  return <span ref={ref} className="gw-fx" aria-hidden />;
});

const VERT = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rect;
uniform vec2 u_canvas;
out vec2 v_local;
out vec2 v_screen;
void main() {
  vec2 px = u_rect.xy + a_pos * u_rect.zw;
  v_screen = px;
  v_local = px - (u_rect.xy + u_rect.zw * 0.5);
  vec2 clip = (px / u_canvas) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec2 v_screen;
uniform sampler2D u_tex;
uniform int u_hasTex;
uniform vec2 u_half;
uniform float u_radius;
uniform vec4 u_videoRect;
uniform float u_shade;
uniform float u_thickness;
uniform float u_ior;
uniform float u_dispersion;
out vec4 fragColor;

const float PI = 3.14159265359;
const float FRES_RANGE = 30.0;
const float FRES_HARD = 0.2;
const float FRES_FACTOR = 0.35;
const float GLARE_RANGE = 30.0;
const float GLARE_HARD = 0.2;
const float GLARE_FACTOR = 0.9;
const float GLARE_CONV = 0.5;
const float GLARE_OPP = 0.8;
const float GLARE_ANGLE = -PI / 4.0;
const float TINT = 0.10;

float sdRoundedRect(vec2 p, vec2 halfSize, float r) {
  vec2 d = abs(p) - halfSize + vec2(r);
  return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0))) - r;
}

vec2 sdfNormal(vec2 p) {
  const float e = 1.0;
  float dx = sdRoundedRect(p + vec2(e, 0.0), u_half, u_radius) - sdRoundedRect(p - vec2(e, 0.0), u_half, u_radius);
  float dy = sdRoundedRect(p + vec2(0.0, e), u_half, u_radius) - sdRoundedRect(p - vec2(0.0, e), u_half, u_radius);
  return normalize(vec2(dx, dy));
}

vec3 sampleScene(vec2 px, float lod) {
  if (u_hasTex == 0) return vec3(0.10) * (1.0 - u_shade);
  vec2 uv = (px - u_videoRect.xy) / u_videoRect.zw;
  uv.x = 1.0 - uv.x; // the feed renders mirrored
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
  return texture(u_tex, uv, lod).rgb * (1.0 - u_shade);
}

void main() {
  float sd = sdRoundedRect(v_local, u_half, u_radius);
  if (sd > 1.0) {
    fragColor = vec4(0.0);
    return;
  }
  float d = max(-sd, 0.0);

  // lens-model edge factor (liquid-glass-studio)
  float xr = 1.0 - d / u_thickness;
  float thetaI = asin(clamp(xr * xr, 0.0, 1.0));
  float thetaT = asin(clamp(sin(thetaI) / u_ior, -1.0, 1.0));
  float edgeFactor = d >= u_thickness ? 0.0 : -tan(thetaT - thetaI);

  vec3 col;
  vec2 n = sdfNormal(v_local);
  if (edgeFactor <= 0.0) {
    col = sampleScene(v_screen, 2.0); // lightly frosted interior
  } else {
    vec2 off = n * edgeFactor * u_thickness;
    float lod = mix(0.5, 2.0, d / u_thickness);
    float dR = 1.0 + 0.02 * u_dispersion;
    float dB = 1.0 - 0.02 * u_dispersion;
    col.r = sampleScene(v_screen - off * dR, lod).r;
    col.g = sampleScene(v_screen - off, lod).g;
    col.b = sampleScene(v_screen - off * dB, lod).b;
  }

  col = mix(col, vec3(1.0), TINT * 0.35);

  float fres = clamp(pow(1.0 + sd / 1500.0 * pow(500.0 / FRES_RANGE, 2.0) + FRES_HARD, 5.0), 0.0, 1.0);
  col = mix(col, vec3(1.0), fres * FRES_FACTOR);

  float glareGeo = clamp(pow(1.0 + sd / 1500.0 * pow(500.0 / GLARE_RANGE, 2.0) + GLARE_HARD, 5.0), 0.0, 1.0);
  float ang = atan(n.y, n.x);
  if (ang < 0.0) ang += PI * 2.0;
  float ga = (ang - PI / 4.0 + GLARE_ANGLE) * 2.0;
  bool farside = (ga > PI * 1.5 && ga < PI * 3.5) || ga < -PI * 0.5;
  float gaf = (0.5 + sin(ga) * 0.5) * (farside ? 1.2 * GLARE_OPP : 1.2) * GLARE_FACTOR;
  gaf = clamp(pow(gaf, 0.1 + GLARE_CONV * 2.0), 0.0, 1.0);
  col = mix(col, vec3(1.0), gaf * glareGeo);

  fragColor = vec4(col, clamp(0.5 - sd, 0.0, 1.0));
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    throw new Error(
      `shader compile failed (type ${type}, contextLost ${gl.isContextLost()}): ${log || '<empty log>'}`,
    );
  }
  return sh;
}

export const GlassCanvas = memo(function GlassCanvas({ shade }: { shade: number }) {
  const { videoEl } = useGestures();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadeRef = useRef(shade);
  shadeRef.current = shade;

  useEffect(() => {
    // The glass layer is decoration — it must never take the app down.
    try {
      return initGlass(canvasRef.current, videoEl, shadeRef);
    } catch (err) {
      console.error('liquid glass init failed:', err);
    }
  }, [videoEl]);

  return <canvas ref={canvasRef} className="gw-glass-canvas" aria-hidden />;
});

function initGlass(
  canvas: HTMLCanvasElement | null,
  videoEl: HTMLVideoElement | null,
  shadeRef: { current: number },
): (() => void) | undefined {
  {
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
    if (!gl) return;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('glass shader link failed:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);
    const U = (name: string) => gl.getUniformLocation(prog, name);
    const uRect = U('u_rect');
    const uCanvas = U('u_canvas');
    const uHalf = U('u_half');
    const uRadius = U('u_radius');
    const uVideoRect = U('u_videoRect');
    const uShade = U('u_shade');
    const uHasTex = U('u_hasTex');
    gl.uniform1i(U('u_tex'), 0);
    gl.uniform1f(U('u_thickness'), 16);
    gl.uniform1f(U('u_ior'), 1.4);
    gl.uniform1f(U('u_dispersion'), 7);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let lastVideoTime = -1;
    let hasTex = false;
    let pattern: HTMLCanvasElement | null = null;

    // Headless-testing hook: uploads a stripe pattern in place of the camera
    // so warp/dispersion are visible without a video feed.
    (window as unknown as Record<string, unknown>).__glassPattern = (on: boolean) => {
      if (on) {
        pattern = document.createElement('canvas');
        pattern.width = 640;
        pattern.height = 360;
        const c = pattern.getContext('2d')!;
        const colors = ['#ff004c', '#ffe600', '#00e0ff'];
        for (let i = 0; i < 40; i++) {
          c.fillStyle = colors[i % 3];
          c.save();
          c.translate(320, 180);
          c.rotate(Math.PI / 4);
          c.fillRect(-600 + i * 30, -400, 30, 800);
          c.restore();
        }
      } else {
        pattern = null;
      }
      lastVideoTime = -1;
    };

    let raf = 0;
    let timer = 0;
    let stopped = false;

    const draw = () => {
      if (stopped) return;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);

      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw > 0 && ch > 0) {
        const W = Math.round(cw * dpr);
        const H = Math.round(ch * dpr);
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // refresh the backdrop texture from the camera (or the test pattern)
        const src = pattern ?? (videoEl && videoEl.readyState >= 2 ? videoEl : null);
        if (src) {
          const t = pattern ? 1 : (videoEl as HTMLVideoElement).currentTime;
          if (t !== lastVideoTime) {
            lastVideoTime = t;
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            gl.generateMipmap(gl.TEXTURE_2D);
            hasTex = true;
          }
        } else {
          hasTex = false;
        }

        if (registry.size > 0) {
          const cRect = canvas.getBoundingClientRect();
          // displayed content rect of the letterboxed video, in canvas px
          let vr = [0, 0, 1, 1];
          if (videoEl && videoEl.videoWidth > 0 && !pattern) {
            const el = videoEl.getBoundingClientRect();
            const s = Math.min(el.width / videoEl.videoWidth, el.height / videoEl.videoHeight);
            const w = videoEl.videoWidth * s;
            const h = videoEl.videoHeight * s;
            vr = [
              (el.left + (el.width - w) / 2 - cRect.left) * dpr,
              (el.top + (el.height - h) / 2 - cRect.top) * dpr,
              w * dpr,
              h * dpr,
            ];
          } else if (pattern) {
            vr = [0, 0, cRect.width * dpr, cRect.height * dpr];
          }
          gl.uniform2f(uCanvas, W, H);
          gl.uniform4f(uVideoRect, vr[0], vr[1], vr[2], vr[3]);
          gl.uniform1f(uShade, shadeRef.current);
          gl.uniform1i(uHasTex, hasTex ? 1 : 0);

          for (const [el, radius] of registry) {
            const r = el.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) continue;
            gl.uniform4f(uRect, (r.left - cRect.left) * dpr, (r.top - cRect.top) * dpr, r.width * dpr, r.height * dpr);
            gl.uniform2f(uHalf, (r.width * dpr) / 2, (r.height * dpr) / 2);
            gl.uniform1f(uRadius, Math.min(radius, Math.min(r.width, r.height) / 2) * dpr);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
          }
        }
      }

      raf = requestAnimationFrame(draw);
      timer = window.setTimeout(draw, 200); // hidden-tab fallback
    };
    draw();

    // No loseContext() here: getContext() on remount (StrictMode double-mount)
    // returns the same context object, which would then be permanently dead.
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }
}
