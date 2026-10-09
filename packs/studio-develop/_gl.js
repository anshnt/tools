// WebGL2 develop pipeline. Three kinds of pass, all on the GPU:
//   1. main:   geometry (crop, straighten, flips) + white balance, exposure, tone, HSL, color grading and tone curve
//   2. detail: small and large gaussian blurs (only when texture, clarity, dehaze, sharpening or noise reduction are used)
//   3. final:  local contrast, sharpening, noise reduction, dehaze, vignette, grain, dither, written to the canvas
// Intermediate images are half floats when the GPU can render to them, so strong edits do not band.
import { HUE_CENTERS, HUE_WIDTHS, curveLut, geometry, normalize, orientedSize } from './_model.js'

// Offscreen passes store the image top-down (texel row 0 = top, like an uploaded image); only the final pass to the canvas flips.
const VERT = `#version 300 es
out vec2 v_uv;
uniform float u_flip;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = vec2(p.x, u_flip > 0.5 ? 1.0 - p.y : p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const COMMON = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`

const MAIN = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_src;
uniform sampler2D u_lut;
uniform vec2 u_p0, u_ax, u_ay, u_srcSize;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_temp, u_tint, u_vibrance, u_saturation;
uniform bool u_bw, u_opaque, u_useLut;
uniform vec3 u_hsl[8];
uniform float u_centers[8];
uniform float u_widths[8];
uniform vec3 u_gTint[3];
uniform float u_gSat[3];
uniform float u_gLum[3];
uniform float u_gBlend, u_gBalance;
${COMMON}
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
vec3 toSrgb(vec3 c) { c = max(c, vec3(0.0)); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float enc(float x) { x = max(x, 0.0); return x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
float dec(float x) { return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4); }

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5, d = mx - mn, h = 0.0, s = 0.0;
  if (d > 1e-5) {
    s = d / (1.0 - abs(2.0 * l - 1.0) + 1e-5);
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, clamp(s, 0.0, 1.0), l);
}
vec3 hsl2rgb(vec3 c) {
  vec3 k = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (k - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  vec2 suv = u_p0 + u_ax * v_uv.x + u_ay * v_uv.y;
  vec2 dpx = min(suv, 1.0 - suv) * u_srcSize;
  float inside = clamp(min(dpx.x, dpx.y) + 1.0, 0.0, 1.0);
  vec3 c = toLin(texture(u_src, suv).rgb);

  // white balance and exposure in linear light
  float t = u_temp, g = u_tint;
  c *= vec3(exp(0.34 * t), 1.0, exp(-0.34 * t)) * vec3(exp(0.10 * g), exp(-0.18 * g), exp(0.10 * g));
  c *= exp2(u_exposure);

  // tone on perceptual luminance, then the ratio is applied back to color so hues hold
  float L = max(luma(c), 1e-5);
  float x = enc(L);
  float bp = -u_blacks * 0.12, wp = 1.0 - u_whites * 0.12;
  x = (x - bp) / max(wp - bp, 0.25);
  float xc = clamp(x, 0.0, 1.0);
  x = xc + u_shadows * 1.4 * xc * (1.0 - xc) * (1.0 - xc) + u_highlights * 1.2 * xc * xc * (1.0 - xc) + (x - xc);
  xc = clamp(x, 0.0, 1.0);
  if (u_contrast >= 0.0) {
    float t2 = mix(xc, smoothstep(0.0, 1.0, xc), u_contrast);
    xc = clamp(0.5 + (t2 - 0.5) * (1.0 + 0.3 * u_contrast), 0.0, 1.0);
  } else {
    xc = 0.5 + (xc - 0.5) * (1.0 + u_contrast * 0.85);
  }
  c *= min(dec(xc) / L, 24.0);
  vec3 e = toSrgb(c);

  // vibrance and saturation
  float lm = luma(e);
  float mx = max(e.r, max(e.g, e.b)), mn = min(e.r, min(e.g, e.b));
  float sat = (mx - mn) / (mx + 1e-4);
  vec3 hs0 = rgb2hsl(clamp(e, 0.0, 1.0));
  float hd0 = abs(hs0.x * 360.0 - 25.0);
  hd0 = min(hd0, 360.0 - hd0);
  float skin = 1.0 - 0.55 * (1.0 - smoothstep(0.0, 60.0, hd0));
  float vw = u_vibrance >= 0.0 ? (1.0 - sat) * skin : sat;
  e = mix(vec3(lm), e, max(0.0, 1.0 + u_vibrance * vw * 0.95 + u_saturation));

  // HSL mixer (8 hue ranges); in black and white mode the luminance sliders act as the color filter mix
  vec3 hsl = rgb2hsl(clamp(e, 0.0, 1.0));
  float hdeg = hsl.x * 360.0, dh = 0.0, ds = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float d = abs(hdeg - u_centers[i]);
    d = min(d, 360.0 - d);
    float w = 1.0 - smoothstep(0.0, u_widths[i], d);
    dh += w * u_hsl[i].x; ds += w * u_hsl[i].y; dl += w * u_hsl[i].z;
  }
  float amt = smoothstep(0.015, 0.2, hsl.y);
  hsl.x = fract(hsl.x + dh * amt / 360.0 + 1.0);
  hsl.y = clamp(hsl.y * (1.0 + ds * amt), 0.0, 1.0);
  hsl.z = clamp(mix(hsl.z, dl > 0.0 ? 1.0 : 0.0, abs(dl) * 0.6 * amt), 0.0, 1.0);
  e = hsl2rgb(hsl);
  if (u_bw) e = vec3(luma(e));

  // color grading with three luminance zones
  float lg = luma(e);
  float mid = 0.5 + u_gBalance * 0.35;
  float sM = pow(1.0 - smoothstep(0.0, mid, lg), mix(2.4, 0.8, u_gBlend));
  float hM = pow(smoothstep(mid, 1.0, lg), mix(2.4, 0.8, u_gBlend));
  float mM = pow(max(1.0 - sM - hM, 0.0), mix(1.6, 0.8, u_gBlend));
  float zs = sM + mM + hM + 1e-4;
  vec3 add = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float m = (i == 0 ? sM : (i == 1 ? mM : hM)) / zs;
    add += m * ((u_gTint[i] - luma(u_gTint[i])) * u_gSat[i] * 0.55 + vec3(u_gLum[i] * 0.22));
  }
  e += add;

  // tone curve (master then per channel, baked into the lookup)
  if (u_useLut) {
    vec3 q = clamp(e, 0.0, 1.0) * 255.0 + 0.5;
    e = vec3(texture(u_lut, vec2(q.r / 256.0, 0.5)).r, texture(u_lut, vec2(q.g / 256.0, 0.5)).g, texture(u_lut, vec2(q.b / 256.0, 0.5)).b);
  }
  o = vec4(e, u_opaque ? 1.0 : inside);
}`

const DOWN = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_texel;
void main() {
  o = 0.25 * (texture(u_tex, v_uv + u_texel * vec2(-0.5, -0.5)) + texture(u_tex, v_uv + u_texel * vec2(0.5, -0.5))
    + texture(u_tex, v_uv + u_texel * vec2(-0.5, 0.5)) + texture(u_tex, v_uv + u_texel * vec2(0.5, 0.5)));
}`

const BLUR = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_dir; uniform float u_w[5];
void main() {
  vec4 s = texture(u_tex, v_uv) * u_w[0];
  for (int i = 1; i < 5; i++) s += (texture(u_tex, v_uv + u_dir * float(i)) + texture(u_tex, v_uv - u_dir * float(i))) * u_w[i];
  o = s;
}`

const FINAL = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_a, u_s, u_l;
uniform bool u_detail, u_opaque, u_clip;
uniform float u_texture, u_clarity, u_dehaze, u_sharpen, u_sharpMask, u_nrLuma, u_nrColor;
uniform float u_vig, u_vigMid, u_vigFeather, u_vigRound, u_aspect;
uniform float u_grain, u_grainSize, u_grainRough, u_scale;
${COMMON}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec4 a4 = texture(u_a, v_uv);
  vec3 c = a4.rgb;
  float alpha = u_opaque ? 1.0 : a4.a;
  if (u_detail) {
    vec3 S = texture(u_s, v_uv).rgb, B = texture(u_l, v_uv).rgb;
    float lc = luma(c), ls = luma(S);
    float d0 = lc - ls;
    // light noise reduction: luminance and color, edge aware
    if (u_nrLuma > 0.0 || u_nrColor > 0.0) {
      float edgeL = smoothstep(0.0, 0.012 + 0.09 * u_nrLuma, abs(d0));
      float edgeC = smoothstep(0.0, 0.02 + 0.10 * u_nrColor, length((c - lc) - (S - ls)));
      float lumN = mix(lc, ls, u_nrLuma * (1.0 - edgeL));
      vec3 chr = mix(c - lc, S - ls, u_nrColor * (1.0 - edgeC));
      c = chr + lumN;
    }
    // texture (fine detail), clarity (local contrast) and sharpening act on luminance
    float t = u_texture < 0.0 ? u_texture : u_texture * 1.4;
    float lcN = luma(c);
    float mid = 4.0 * clamp(lcN, 0.0, 1.0) * (1.0 - clamp(lcN, 0.0, 1.0));
    float dl = lcN - luma(B);
    float dd = clamp(d0, -0.12, 0.12);
    float sharp = u_sharpen * 1.7 * mix(1.0, smoothstep(0.004, 0.035, abs(d0)), u_sharpMask);
    c += vec3(d0 * t + dl * u_clarity * 1.25 * (0.35 + 0.65 * mid) + dd * sharp);
    // dehaze: estimate the haze from the blurred dark channel
    if (abs(u_dehaze) > 0.001) {
      float dark = min(min(B.r, B.g), B.b);
      float hz = clamp(dark / 0.95, 0.0, 0.95);
      if (u_dehaze > 0.0) {
        float tt = max(1.0 - u_dehaze * 0.9 * hz, 0.14);
        c = (c - 0.95 * (1.0 - tt)) / tt;
        c = mix(vec3(luma(c)), c, 1.0 + u_dehaze * 0.22);
      } else {
        c = mix(c, vec3(0.92), -u_dehaze * 0.32);
      }
    }
  }
  // vignette
  if (abs(u_vig) > 0.001) {
    vec2 q = (v_uv - 0.5) * 2.0;
    float r = u_vigRound;
    vec2 cs = vec2(mix(1.0, u_aspect, max(r, 0.0)), 1.0);
    vec2 p = q * cs;
    float de = length(p) / length(cs);
    float dc = max(abs(q.x), abs(q.y));
    float dist = mix(de, dc, max(-r, 0.0));
    float a = mix(0.0, 0.85, u_vigMid), b = a + mix(0.06, 0.95, u_vigFeather);
    float v = smoothstep(a, b, dist);
    c = u_vig < 0.0 ? c * (1.0 - (-u_vig) * v * 0.97) : mix(c, vec3(1.0), u_vig * v * 0.9);
  }
  // film grain, sized relative to the image so previews and exports match
  if (u_grain > 0.0) {
    vec2 gp = gl_FragCoord.xy / (u_scale * mix(0.7, 3.2, u_grainSize));
    float n = mix(vnoise(gp) * 0.6 + vnoise(gp * 2.3 + 7.0) * 0.4, hash12(floor(gp)), u_grainRough);
    float gcl = clamp(luma(c), 0.0, 1.0);
    float m = 1.0 - 0.75 * pow(abs(2.0 * gcl - 1.0), 3.0);
    c += (n - 0.5) * u_grain * 0.5 * m;
  }
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  c = clamp(c, 0.0, 1.0);
  if (u_clip) {
    float mxc = max(c.r, max(c.g, c.b)), mnc = min(c.r, min(c.g, c.b));
    if (mxc >= 0.992) c = vec3(1.0, 0.2, 0.15);
    else if (mnc <= 0.004) c = vec3(0.15, 0.4, 1.0);
  }
  o = vec4(c * alpha, alpha);
}`

function gauss(sigma) {
  const w = Array.from({ length: 5 }, (_, i) => Math.exp(-(i * i) / (2 * sigma * sigma)))
  const sum = w[0] + 2 * (w[1] + w[2] + w[3] + w[4])
  return new Float32Array(w.map((x) => x / sum))
}

function hueRgb(h) {
  const k = (n) => (n + h / 60) % 6
  const f = (n) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5), f(3), f(1)]
}

/** Create a renderer that draws into `canvas`. Throws a friendly Error when WebGL2 is not available. */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('This photo editor needs WebGL2, which is not available in this browser.')
  const floatRT = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
  gl.getExtension('OES_texture_float_linear')
  const maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 16384)
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic')

  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(s)}`)
    return s
  }
  const vs = compile(gl.VERTEX_SHADER, VERT)
  const programs = {}
  const program = (name, frag) => {
    const p = gl.createProgram()
    gl.attachShader(p, vs)
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Shader link error: ${gl.getProgramInfoLog(p)}`)
    const locs = new Map()
    programs[name] = { p, loc: (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n)); return locs.get(n) } }
    gl.useProgram(p)
    gl.uniform1f(programs[name].loc('u_flip'), name === 'final' ? 1 : 0)
    return programs[name]
  }
  const main = program('main', MAIN), down = program('down', DOWN), blur = program('blur', BLUR), fin = program('final', FINAL)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)

  const f1 = (pg, n, v) => gl.uniform1f(pg.loc(n), v)
  const i1 = (pg, n, v) => gl.uniform1i(pg.loc(n), v ? 1 : 0)
  const f2 = (pg, n, a) => gl.uniform2f(pg.loc(n), a[0], a[1])

  function makeTex(w, h, { float = false, filter = gl.LINEAR } = {}) {
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
  const targets = new Map() // name -> {tex, fbo, w, h}
  function target(name, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))
    let t = targets.get(name)
    if (t && t.w === w && t.h === h) return t
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    const tex = makeTex(w, h, { float: floatRT })
    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    t = { tex, fbo, w, h }
    targets.set(name, t)
    return t
  }
  function bind(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
  }
  function draw(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null)
    gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  let srcTex = null, srcW = 1, srcH = 1
  const lutTex = makeTex(256, 1, { filter: gl.NEAREST })
  let lutKey = ''
  let lost = false
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true })

  return {
    canvas, maxSize, floatRT,
    get lost() { return lost },
    /** Upload the source image (canvas, image or bitmap). Reports its raw pixel size. */
    setSource(source, w, h) {
      if (srcTex) gl.deleteTexture(srcTex)
      srcW = w; srcH = h
      srcTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4)
    },
    /**
     * Render the photo with `settings` at width x height into the canvas.
     * opts: opaque (force alpha 1, for export), clip (show clipped highlights red and shadows blue)
     */
    render(settings, width, height, opts = {}) {
      if (!srcTex || lost) return
      const s = normalize(settings)
      width = Math.max(1, Math.round(width)); height = Math.max(1, Math.round(height))
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      const long = Math.max(width, height)
      const scale = long / 1500

      // curve lookup
      const lutArr = curveLut(s.curve)
      const useLut = s.curve.rgb.length !== 2 || s.curve.r.length !== 2 || s.curve.g.length !== 2 || s.curve.b.length !== 2 ||
        [s.curve.rgb, s.curve.r, s.curve.g, s.curve.b].some((c) => c[0][0] !== 0 || c[0][1] !== 0 || c[1][0] !== 255 || c[1][1] !== 255)
      if (useLut) {
        const key = lutArr.join(',')
        if (key !== lutKey) {
          lutKey = key
          gl.bindTexture(gl.TEXTURE_2D, lutTex)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutArr)
        }
      }

      // pass 1: main
      const A = target('A', width, height)
      const g = geometry(s, srcW, srcH)
      gl.useProgram(main.p)
      bind(0, srcTex); gl.uniform1i(main.loc('u_src'), 0)
      bind(1, lutTex); gl.uniform1i(main.loc('u_lut'), 1)
      f2(main, 'u_p0', g.p0); f2(main, 'u_ax', g.ax); f2(main, 'u_ay', g.ay); f2(main, 'u_srcSize', [srcW, srcH])
      f1(main, 'u_exposure', s.exposure); f1(main, 'u_contrast', s.contrast / 100)
      f1(main, 'u_highlights', s.highlights / 100); f1(main, 'u_shadows', s.shadows / 100)
      f1(main, 'u_whites', s.whites / 100); f1(main, 'u_blacks', s.blacks / 100)
      f1(main, 'u_temp', s.temp / 100); f1(main, 'u_tint', s.tint / 100)
      f1(main, 'u_vibrance', s.vibrance / 100); f1(main, 'u_saturation', s.saturation / 100)
      i1(main, 'u_bw', s.bw); i1(main, 'u_opaque', !!opts.opaque); i1(main, 'u_useLut', useLut)
      const hsl = new Float32Array(24)
      for (let i = 0; i < 8; i++) { hsl[i * 3] = (s.hue[i] / 100) * 30; hsl[i * 3 + 1] = s.sat[i] / 100; hsl[i * 3 + 2] = s.lum[i] / 100 }
      gl.uniform3fv(main.loc('u_hsl'), hsl)
      gl.uniform1fv(main.loc('u_centers'), new Float32Array(HUE_CENTERS))
      gl.uniform1fv(main.loc('u_widths'), new Float32Array(HUE_WIDTHS))
      const wheels = [s.grade.sh, s.grade.mid, s.grade.hi]
      gl.uniform3fv(main.loc('u_gTint'), new Float32Array(wheels.flatMap((w) => hueRgb(w.h))))
      gl.uniform1fv(main.loc('u_gSat'), new Float32Array(wheels.map((w) => w.s / 100)))
      gl.uniform1fv(main.loc('u_gLum'), new Float32Array(wheels.map((w) => w.l / 100)))
      f1(main, 'u_gBlend', s.grade.blend / 100); f1(main, 'u_gBalance', s.grade.balance / 100)
      draw(A)

      // pass 2: blurs, only when a detail control is in use
      const detail = s.texture !== 0 || s.clarity !== 0 || s.dehaze !== 0 || s.sharpen > 0 || s.nrLuma > 0 || s.nrColor > 0
      let S = A, Lb = A
      if (detail) {
        gl.useProgram(blur.p)
        const wS = gauss(1.25)
        const B = target('B', width, height)
        S = target('S', width, height)
        gl.uniform1i(blur.loc('u_tex'), 0)
        gl.uniform1fv(blur.loc('u_w'), wS)
        bind(0, A.tex); f2(blur, 'u_dir', [1 / width, 0]); draw(B)
        bind(0, B.tex); f2(blur, 'u_dir', [0, 1 / height]); draw(S)
        // large blur at 1/8 resolution, two rounds
        gl.useProgram(down.p)
        gl.uniform1i(down.loc('u_tex'), 0)
        let prev = A
        for (let i = 1; i <= 3; i++) {
          const t = target(`D${i}`, width / 2 ** i, height / 2 ** i)
          bind(0, prev.tex); f2(down, 'u_texel', [1 / prev.w, 1 / prev.h]); draw(t)
          prev = t
        }
        const E = target('E', prev.w, prev.h)
        Lb = target('F', prev.w, prev.h)
        gl.useProgram(blur.p)
        gl.uniform1fv(blur.loc('u_w'), gauss(2))
        bind(0, prev.tex); f2(blur, 'u_dir', [1 / prev.w, 0]); draw(E)
        bind(0, E.tex); f2(blur, 'u_dir', [0, 1 / prev.h]); draw(Lb)
        bind(0, Lb.tex); f2(blur, 'u_dir', [1 / prev.w, 0]); draw(E)
        bind(0, E.tex); f2(blur, 'u_dir', [0, 1 / prev.h]); draw(Lb)
      }

      // pass 3: final to canvas
      gl.useProgram(fin.p)
      bind(0, A.tex); gl.uniform1i(fin.loc('u_a'), 0)
      bind(1, S.tex); gl.uniform1i(fin.loc('u_s'), 1)
      bind(2, Lb.tex); gl.uniform1i(fin.loc('u_l'), 2)
      i1(fin, 'u_detail', detail); i1(fin, 'u_opaque', !!opts.opaque); i1(fin, 'u_clip', !!opts.clip)
      f1(fin, 'u_texture', s.texture / 100); f1(fin, 'u_clarity', s.clarity / 100); f1(fin, 'u_dehaze', s.dehaze / 100)
      f1(fin, 'u_sharpen', s.sharpen / 100); f1(fin, 'u_sharpMask', s.sharpMask / 100)
      f1(fin, 'u_nrLuma', s.nrLuma / 100); f1(fin, 'u_nrColor', s.nrColor / 100)
      f1(fin, 'u_vig', s.vignette / 100); f1(fin, 'u_vigMid', s.vigMid / 100); f1(fin, 'u_vigFeather', s.vigFeather / 100); f1(fin, 'u_vigRound', s.vigRound / 100)
      f1(fin, 'u_aspect', width / height)
      f1(fin, 'u_grain', s.grain / 100); f1(fin, 'u_grainSize', s.grainSize / 100); f1(fin, 'u_grainRough', s.grainRough / 100); f1(fin, 'u_scale', scale)
      draw(null)
    },
    /** Free GPU memory (used between big exports). */
    trim() {
      for (const t of targets.values()) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
      targets.clear()
      if (srcTex) { gl.deleteTexture(srcTex); srcTex = null }
      canvas.width = canvas.height = 1
    },
    dispose() {
      this.trim()
      gl.deleteTexture(lutTex)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
    oriented: (rot) => orientedSize(srcW, srcH, rot),
  }
}
