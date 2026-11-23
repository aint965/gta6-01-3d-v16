// render.js — handwritten WebGL2 renderer for Palkon Auto.
// One shader program, one merged static buffer for the city, one dynamic
// buffer for every car + pedestrian (all classes, none skipped), a sky
// buffer rebuilt per lighting preset, and a shadow buffer per preset.
// Face culling is deliberately OFF: winding mistakes must never blank the city.
import { ROADS, DIAGONAL, CANAL, HARBOUR, BEACH, PARK, PLAZA, TOWER, FOUNTAIN } from './city.js';
import { mulberry32, range, pick } from './rng.js';
import { carsInHeadlightCone } from './drive.js';

export const PRESETS = {
  midday: {
    name: 'MIDDAY', time: '12:00',
    sunDir: [0.45, 0.75, 0.35], sunColor: [1.0, 0.95, 0.85], ambient: [0.55, 0.55, 0.58],
    fogColor: [0.75, 0.82, 0.88], fogDensity: 0.00035,
    skyTop: [0.25, 0.5, 0.8], skyHorizon: [0.78, 0.84, 0.9],
    sunPos: [2500, 3200, 1500], sunDisc: [1.0, 0.95, 0.7], stars: false,
  },
  sunset: {
    name: 'SUNSET', time: '18:40',
    sunDir: [-0.85, 0.18, 0.1], sunColor: [1.0, 0.55, 0.25], ambient: [0.35, 0.3, 0.32],
    fogColor: [0.9, 0.55, 0.35], fogDensity: 0.00045,
    skyTop: [0.35, 0.25, 0.5], skyHorizon: [1.0, 0.55, 0.25],
    sunPos: [-4200, 520, 320], sunDisc: [1.0, 0.6, 0.2], stars: false,
  },
  night: {
    name: 'NIGHT', time: '23:30',
    sunDir: [0.2, 0.6, -0.3], sunColor: [0.25, 0.35, 0.6], ambient: [0.16, 0.18, 0.25],
    fogColor: [0.05, 0.07, 0.12], fogDensity: 0.0004,
    skyTop: [0.02, 0.03, 0.08], skyHorizon: [0.1, 0.12, 0.2],
    sunPos: [800, 1800, -2200], sunDisc: [0.9, 0.95, 1.0], stars: true,
  },
};

const VERT = `#version 300 es
in vec3 aPos; in vec3 aNormal; in vec4 aColor; in vec3 aEmissive; in vec2 aTex; in float aUseTex; in float aSpec;
uniform mat4 uVP; uniform vec3 uViewPos;
out vec4 vColor; out vec3 vEmissive; out vec2 vTex; out float vUseTex; out float vFog; out vec3 vNormal; out vec3 vWorld; out float vSpec;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  vColor = aColor; vEmissive = aEmissive; vTex = aTex; vUseTex = aUseTex; vSpec = aSpec;
  vNormal = aNormal; vWorld = aPos;
  vFog = distance(aPos, uViewPos);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vColor; in vec3 vEmissive; in vec2 vTex; in float vUseTex; in float vFog; in vec3 vNormal; in vec3 vWorld; in float vSpec;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient; uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uViewPos; uniform sampler2D uTex;
out vec4 outColor;
void main() {
  vec3 tex = vUseTex > 0.5 ? texture(uTex, vTex).rgb : vec3(1.0);
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 viewDir = normalize(uViewPos - vWorld);
  vec3 halfDir = normalize(normalize(uSunDir) + viewDir);
  float spec = pow(max(dot(n, halfDir), 0.0), 24.0) * vSpec;
  vec3 base = vColor.rgb * tex;
  vec3 lit = base * (uAmbient + uSunColor * diff) + base * spec * uSunColor + vEmissive * tex;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFog * vFog);
  vec3 col = mix(lit, uFogColor, clamp(f, 0.0, 1.0));
  outColor = vec4(col, vColor.a);
}`;

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgba(hex, a = 1) {
  const [r, g, b] = hexRgb(hex);
  return [r, g, b, a];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function rotXZ(x, z, cx, cz, cos, sin) {
  const dx = x - cx;
  const dz = z - cz;
  return [cx + dx * cos - dz * sin, cz + dx * sin + dz * cos];
}

// ---- minimal mat4 helpers (column-major, like WebGL) ----
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye, center, up) {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
  ];
}
function mul(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

const STRIDE = 17; // pos3 normal3 color4 emissive3 tex2 useTex1 spec1

class Builder {
  constructor() { this.a = []; }
  v(p, n, color, emissive, tex = [0, 0], useTex = 0, spec = 0) {
    this.a.push(p[0], p[1], p[2], n[0], n[1], n[2], color[0], color[1], color[2], color[3], emissive[0], emissive[1], emissive[2], tex[0], tex[1], useTex, spec);
  }
  // Quad from 4 corners (two triangles); normal computed when not given.
  quad(p1, p2, p3, p4, o) {
    const n = o.normal ?? norm(cross(sub(p2, p1), sub(p4, p1)));
    const c = o.color;
    const e = o.emissive ?? [0, 0, 0];
    const s = o.spec ?? 0;
    const t = o.tex;
    const u = o.useTex ?? 0;
    if (t) {
      this.v(p1, n, c, e, [t[0], t[1]], u, s);
      this.v(p2, n, c, e, [t[2], t[1]], u, s);
      this.v(p3, n, c, e, [t[2], t[3]], u, s);
      this.v(p1, n, c, e, [t[0], t[1]], u, s);
      this.v(p3, n, c, e, [t[2], t[3]], u, s);
      this.v(p4, n, c, e, [t[0], t[3]], u, s);
    } else {
      this.v(p1, n, c, e, [0, 0], u, s);
      this.v(p2, n, c, e, [0, 0], u, s);
      this.v(p3, n, c, e, [0, 0], u, s);
      this.v(p1, n, c, e, [0, 0], u, s);
      this.v(p3, n, c, e, [0, 0], u, s);
      this.v(p4, n, c, e, [0, 0], u, s);
    }
  }
  // Axis-aligned ground quad at height y (normal up), corners (x0,z0)-(x1,z1).
  ground(x0, z0, x1, z1, y, o) {
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], { ...o, normal: [0, 1, 0] });
  }
  // Box with bottom at cy, centre (cx, cz), size w (x) h (y) d (z), optional Y rotation.
  box(cx, cy, cz, w, h, d, o, rot = 0) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const c = (x, z) => rotXZ(x, z, cx, cz, cos, sin);
    const hw = w / 2;
    const hd = d / 2;
    const y0 = cy;
    const y1 = cy + h;
    const corners = [
      c(cx - hw, cz - hd), c(cx + hw, cz - hd), c(cx + hw, cz + hd), c(cx - hw, cz + hd),
    ];
    const [p00, p10, p11, p01] = corners;
    const top = (x, z) => [x, y1, z];
    const bot = (x, z) => [x, y0, z];
    // top, bottom, and the four sides
    this.quad(top(p00[0], p00[1]), top(p10[0], p10[1]), top(p11[0], p11[1]), top(p01[0], p01[1]), { ...o, normal: [0, 1, 0] });
    this.quad(bot(p01[0], p01[1]), bot(p11[0], p11[1]), bot(p10[0], p10[1]), bot(p00[0], p00[1]), { ...o, normal: [0, -1, 0] });
    this.quad(bot(p00[0], p00[1]), bot(p10[0], p10[1]), top(p10[0], p10[1]), top(p00[0], p00[1]), o);
    this.quad(bot(p10[0], p10[1]), bot(p11[0], p11[1]), top(p11[0], p11[1]), top(p10[0], p10[1]), o);
    this.quad(bot(p11[0], p11[1]), bot(p01[0], p01[1]), top(p01[0], p01[1]), top(p11[0], p11[1]), o);
    this.quad(bot(p01[0], p01[1]), bot(p00[0], p00[1]), top(p00[0], p00[1]), top(p01[0], p01[1]), o);
  }
  pyramid(cx, cy, cz, w, h, d, o, rot = 0) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const c = (x, z) => rotXZ(x, z, cx, cz, cos, sin);
    const hw = w / 2;
    const hd = d / 2;
    const apex = [cx, cy + h, cz];
    const corners = [c(cx - hw, cz - hd), c(cx + hw, cz - hd), c(cx + hw, cz + hd), c(cx - hw, cz + hd)].map(([x, z]) => [x, cy, z]);
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const n = norm(cross(sub(b, a), sub(apex, a)));
      this.v(a, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(b, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(apex, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
    }
  }
  // Vertical prism (n-sided), bottom at cy.
  prism(cx, cy, cz, r, h, sides, o) {
    const top = [];
    const bot = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      top.push([x, cy + h, z]);
      bot.push([x, cy, z]);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const n = norm(cross(sub(top[j], top[i]), sub(bot[i], top[i])));
      this.v(bot[i], n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(bot[j], n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(top[j], n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(bot[i], n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(top[j], n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(top[i], n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
    }
    // Top cap: a proper triangle fan — the centre vertex is pushed once per
    // triangle, so the cap contributes 3 vertices per side and the vertex
    // stream stays a multiple of 3 (an earlier version pushed the centre
    // once and then pairs, 17 vertices, which shifted every later triangle
    // in the buffer by 2 and drew long stray triangles across the city).
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.v([cx, cy + h, cz], [0, 1, 0], o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(top[i], [0, 1, 0], o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(top[j], [0, 1, 0], o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
    }
  }
  cone(cx, cy, cz, r, h, o) {
    const apex = [cx, cy + h, cz];
    const sides = 10;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
      const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
      const n = norm(cross(sub(p1, p0), sub(apex, p0)));
      this.v(p0, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(p1, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(apex, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
    }
  }
  // Flat disc on the ground (normal up), triangle fan.
  disc(cx, y, cz, r, o, sides = 20) {
    const n = [0, 1, 0];
    const c = [cx, y, cz];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r];
      const p1 = [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r];
      this.v(c, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(p0, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
      this.v(p1, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, o.spec ?? 0);
    }
  }
  // Disc floating in space, facing `dir` (used for sun/moon).
  skyDisc(center, dir, r, o, sides = 24) {
    const d = norm(dir);
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const right = norm(cross(d, up));
    const upv = cross(right, d);
    const n = d;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0 = [center[0] + (right[0] * Math.cos(a0) + upv[0] * Math.sin(a0)) * r, center[1] + (right[1] * Math.cos(a0) + upv[1] * Math.sin(a0)) * r, center[2] + (right[2] * Math.cos(a0) + upv[2] * Math.sin(a0)) * r];
      const p1 = [center[0] + (right[0] * Math.cos(a1) + upv[0] * Math.sin(a1)) * r, center[1] + (right[1] * Math.cos(a1) + upv[1] * Math.sin(a1)) * r, center[2] + (right[2] * Math.cos(a1) + upv[2] * Math.sin(a1)) * r];
      this.v(center, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, 0);
      this.v(p0, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, 0);
      this.v(p1, n, o.color, o.emissive ?? [0, 0, 0], [0, 0], 0, 0);
    }
  }
  toFloat32() {
    return new Float32Array(this.a);
  }
  get count() {
    return this.a.length / STRIDE;
  }
}

function makeNeonTexture(gl) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const signs = ['SOLMAR', 'PALKO', 'MARINA', 'BEACH'];
  const colors = ['#ff8a6a', '#5fd3c8', '#7fb5ff', '#ffd25f'];
  for (let i = 0; i < 4; i++) {
    const x0 = i * 256;
    ctx.fillStyle = '#101418';
    ctx.fillRect(x0, 0, 256, 256);
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 6;
    ctx.strokeRect(x0 + 8, 8, 240, 240);
    ctx.font = 'bold 64px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = colors[i];
    ctx.shadowBlur = 28;
    ctx.fillStyle = colors[i];
    ctx.fillText(signs[i], x0 + 128, 128);
    ctx.shadowBlur = 0;
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export class Renderer {
  constructor(canvas, city, opts = {}) {
    this.canvas = canvas;
    this.city = city;
    this.opts = opts; // debug skips: { noShadows, noWindows, noTrees, noSky }
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    this.loc = {};
    for (const name of ['aPos', 'aNormal', 'aColor', 'aEmissive', 'aTex', 'aUseTex', 'aSpec']) {
      const l = gl.getAttribLocation(prog, name);
      if (l < 0) throw new Error(`attribute ${name} missing`);
      this.loc[name] = l;
    }
    for (const name of ['uVP', 'uViewPos', 'uSunDir', 'uSunColor', 'uAmbient', 'uFogColor', 'uFogDensity', 'uTex']) {
      const u = gl.getUniformLocation(prog, name);
      if (u === null) throw new Error(`uniform ${name} missing`);
      this.loc[name] = u;
    }
    // Four independent buffers: static city, sky, shadows, dynamic cars+people.
    // One shared VAO; the attrib pointers are re-pointed at whichever buffer
    // is bound before each draw (vertexAttribPointer reads the bound buffer).
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buffers = {
      static: gl.createBuffer(),
      sky: gl.createBuffer(),
      shadow: gl.createBuffer(),
      dyn: gl.createBuffer(),
    };
    this.neonTex = makeNeonTexture(gl);
    gl.uniform1i(this.loc.uTex, 0);
    this.staticCount = 0;
    this.skyCount = 0;
    this.shadowCount = 0;
    this.dynCount = 0;
    this.stageB = null; // Stage B state (null = Stage A behaviour).
    this.buildStatic();
  }

  // Stage B state: {playerCar, headlightsOn, preset, time, eRing, markers,
  // mara, dust, lightStates}. Null = Stage A behaviour.
  setStageB(sb) {
    this.stageB = sb;
  }

  // Bind one of the four buffers and re-point the attrib pointers at it.
  bindBuffer(buf) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const off = (i) => i * 4;
    const attrs = [
      ['aPos', 3, 0], ['aNormal', 3, 3], ['aColor', 4, 6], ['aEmissive', 3, 10], ['aTex', 2, 13], ['aUseTex', 1, 15], ['aSpec', 1, 16],
    ];
    for (const [name, size, idx] of attrs) {
      gl.enableVertexAttribArray(this.loc[name]);
      gl.vertexAttribPointer(this.loc[name], size, gl.FLOAT, false, STRIDE * 4, off(idx));
    }
  }

  upload(builder, buf) {
    const gl = this.gl;
    if (builder.count % 3 !== 0) {
      console.warn(`[render] vertex count ${builder.count} is not a multiple of 3 — triangles will misalign`);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, builder.toFloat32(), gl.STATIC_DRAW);
    return builder.count;
  }

  buildStatic() {
    const b = new Builder();
    const city = this.city;
    // Ground base + colour patches so the grass is not one flat sheet.
    b.ground(-1920, -1728, 1920, 1728, 0, { color: rgba('#6f9e5a') });
    const rng = mulberry32(20261123);
    for (let i = 0; i < 26; i++) {
      const x = range(rng, -1800, 1800);
      const z = range(rng, -1600, 1600);
      const s = range(rng, 120, 320);
      b.ground(x - s / 2, z - s / 2, x + s / 2, z + s / 2, 0.05, { color: rgba(pick(rng, ['#5d8a4c', '#7aa864', '#678f52'])) });
    }
    // Beach sand + canal + harbour water.
    b.ground(BEACH.x0, BEACH.z0, BEACH.x1, BEACH.z1, 0.08, { color: rgba('#e0cf9a') });
    b.ground(CANAL.x0, CANAL.z0, CANAL.x1, CANAL.z1, 0.1, { color: rgba('#2e6f8e'), emissive: [0.05, 0.12, 0.18], spec: 0.9 });
    b.ground(HARBOUR.x0, HARBOUR.z0, HARBOUR.x1, HARBOUR.z1, 0.1, { color: rgba('#2e6f8e'), emissive: [0.05, 0.12, 0.18], spec: 0.9 });
    // Park lawn.
    b.ground(PARK.x0, PARK.z0, PARK.x1, PARK.z1, 0.06, { color: rgba('#5d8a4c') });
    // Roads (asphalt raised to 0.15 so it never z-fights the grass plane).
    for (const r of ROADS) {
      if (r.axis === 'z') b.ground(r.cx - r.w / 2, -r.len / 2, r.cx + r.w / 2, r.len / 2, 0.15, { color: rgba('#3f444b'), spec: 0.05 });
      else b.ground(-r.len / 2, r.cz - r.w / 2, r.len / 2, r.cz + r.w / 2, 0.15, { color: rgba('#3f444b'), spec: 0.05 });
      // Centre dashes.
      const dashColor = rgba('#d8c95a');
      if (r.axis === 'z') {
        for (let z = -1680; z <= 1680; z += 60) b.ground(r.cx - 1, z, r.cx + 1, z + 26, 0.16, { color: dashColor });
      } else {
        for (let x = -1860; x <= 1860; x += 60) b.ground(x, r.cz - 1, x + 26, r.cz + 1, 0.16, { color: dashColor });
      }
    }
    // Diagonal avenue (rotated ground quad).
    {
      const dx = DIAGONAL.x2 - DIAGONAL.x1;
      const dz = DIAGONAL.z2 - DIAGONAL.z1;
      const len = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz);
      const cx = (DIAGONAL.x1 + DIAGONAL.x2) / 2;
      const cz = (DIAGONAL.z1 + DIAGONAL.z2) / 2;
      const hw = DIAGONAL.w / 2;
      const hl = len / 2;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const c = (x, z) => rotXZ(x, z, cx, cz, cos, sin);
      const [p00, p10, p11, p01] = [c(cx - hw, cz - hl), c(cx + hw, cz - hl), c(cx + hw, cz + hl), c(cx - hw, cz + hl)];
      b.quad([p00[0], 0.15, p00[1]], [p10[0], 0.15, p10[1]], [p11[0], 0.15, p11[1]], [p01[0], 0.15, p01[1]], { color: rgba('#3f444b'), normal: [0, 1, 0] });
    }
    // Bridges over the canal (3, at z = -600, 0, 600).
    for (const z of [-600, 0, 600]) {
      b.ground(-1580, z - 14, -1420, z + 14, 0.35, { color: rgba('#8a7f6a') });
    }
    // Sidewalks along the boulevard.
    b.ground(400 - 64 / 2 - 10, -1728, 400 - 64 / 2, 1728, 0.3, { color: rgba('#c9c2b4') });
    b.ground(400 + 64 / 2, -1728, 400 + 64 / 2 + 10, 1728, 0.3, { color: rgba('#c9c2b4') });
    // Central plaza: stone disc, clock tower, fountain.
    b.disc(PLAZA.x, 0.2, PLAZA.z, PLAZA.r, { color: rgba('#cfc4ae') });
    b.box(TOWER.x, 0.2, TOWER.z, TOWER.w, TOWER.h, TOWER.d, { color: rgba('#e8dcc0'), spec: 0.1 });
    b.pyramid(TOWER.x, 0.2 + TOWER.h, TOWER.z, TOWER.w + 6, 26, TOWER.d + 6, { color: rgba('#5a4a3a') });
    // Clock face (white quad + two dark hands) on the tower's south face.
    b.quad([TOWER.x - 10, 128, TOWER.z + TOWER.d / 2 + 0.3], [TOWER.x + 10, 128, TOWER.z + TOWER.d / 2 + 0.3], [TOWER.x + 10, 148, TOWER.z + TOWER.d / 2 + 0.3], [TOWER.x - 10, 148, TOWER.z + TOWER.d / 2 + 0.3], { color: rgba('#f4efe2'), emissive: [0.25, 0.23, 0.18] });
    b.quad([TOWER.x - 0.8, 138, TOWER.z + TOWER.d / 2 + 0.5], [TOWER.x + 0.8, 138, TOWER.z + TOWER.d / 2 + 0.5], [TOWER.x + 0.8, 146, TOWER.z + TOWER.d / 2 + 0.5], [TOWER.x - 0.8, 146, TOWER.z + TOWER.d / 2 + 0.5], { color: rgba('#1c2024') });
    // Fountain: rim + water.
    b.disc(FOUNTAIN.x, 0.3, FOUNTAIN.z, FOUNTAIN.r + 3, { color: rgba('#b8ac96') });
    b.disc(FOUNTAIN.x, 0.45, FOUNTAIN.z, FOUNTAIN.r, { color: rgba('#4fa8c8'), emissive: [0.1, 0.25, 0.3], spec: 0.9 });
    b.prism(FOUNTAIN.x, 0.45, FOUNTAIN.z, 3, 6, 8, { color: rgba('#e8e4d8') });
    // Buildings with real windows (some lit, some dark).
    for (const bd of city.buildings) {
      const spec = bd.kind === 'glass' ? 0.9 : 0.15;
      const emissive = bd.kind === 'glass' ? [0.05, 0.08, 0.1] : [0, 0, 0];
      b.box(bd.x, 0, bd.z, bd.w, bd.h, bd.d, { color: rgba(bd.color), emissive, spec }, bd.rot);
      // Roof cap.
      b.box(bd.x, bd.h, bd.z, bd.w + 1, 1.2, bd.d + 1, { color: rgba(bd.roof) }, bd.rot);
      // Windows on the four faces.
      if (!this.opts.noWindows) {
      const brng = mulberry32(bd.seed);
      const floors = Math.max(1, Math.floor(bd.h / 9));
      const cos = Math.cos(bd.rot);
      const sin = Math.sin(bd.rot);
      const faceWin = (fx, fz, along, faceNormal) => {
        const count = Math.max(1, Math.floor(along / 12));
        for (let f = 0; f < floors; f++) {
          for (let i = 0; i < count; i++) {
            if (brng() < 0.25) continue; // not every slot has a window
            const t = (i + 0.5) / count - 0.5;
            const y = 4 + f * 9;
            const lit = brng() < 0.42;
            const wx = fx + faceNormal[2] * t * along * 0 + faceNormal[0] * 0 + (faceNormal[0] === 0 ? t * along : 0);
            const wz = fz + (faceNormal[2] === 0 ? t * along : 0);
            // Build the window quad on the face plane, offset 0.2 out.
            const off = 0.2;
            const px = wx + faceNormal[0] * off;
            const pz = wz + faceNormal[2] * off;
            const half = 1.6;
            const up = [0, 1, 0];
            const right = [faceNormal[2], 0, -faceNormal[0]];
            const c = [px, y, pz];
            const a = [c[0] - right[0] * half - up[0] * 1.1, c[1] - right[1] * half - up[1] * 1.1, c[2] - right[2] * half - up[2] * 1.1];
            const bb = [c[0] + right[0] * half - up[0] * 1.1, c[1] + right[1] * half - up[1] * 1.1, c[2] + right[2] * half - up[2] * 1.1];
            const cc = [c[0] + right[0] * half + up[0] * 1.1, c[1] + right[1] * half + up[1] * 1.1, c[2] + right[2] * half + up[2] * 1.1];
            const dd = [c[0] - right[0] * half + up[0] * 1.1, c[1] - right[1] * half + up[1] * 1.1, c[2] - right[2] * half + up[2] * 1.1];
            b.quad(a, bb, cc, dd, {
              color: lit ? rgba('#ffd9a0') : rgba('#232a33'),
              emissive: lit ? [0.85, 0.6, 0.3] : [0, 0, 0],
              normal: faceNormal,
            });
          }
        }
      };
      // Rotate face normals with the building.
      const rotN = (nx, nz) => {
        const [rx, rz] = rotXZ(nx, nz, 0, 0, cos, sin);
        return [rx, 0, rz];
      };
      // Four faces: +z, -z, +x, -x (in building-local space, rotated).
      const hw = bd.w / 2;
      const hd = bd.d / 2;
      const faceDefs = [
        { n: [0, 0, 1], at: [bd.x, bd.z + hd], along: bd.w },
        { n: [0, 0, -1], at: [bd.x, bd.z - hd], along: bd.w },
        { n: [1, 0, 0], at: [bd.x + hw, bd.z], along: bd.d },
        { n: [-1, 0, 0], at: [bd.x - hw, bd.z], along: bd.d },
      ];
      let winBudget = 28;
      for (const fd of faceDefs) {
        if (winBudget <= 0) break;
        const n = rotN(fd.n[0], fd.n[2]);
        // Rotate the face centre around the building centre too.
        const [rx, rz] = rotXZ(fd.at[0], fd.at[1], bd.x, bd.z, cos, sin);
        const before = b.count;
        faceWin(rx, rz, fd.along, n);
        winBudget -= Math.max(0, Math.round((b.count - before) / 6));
      }
      }
    }
    // Trees: trunk + two cones.
    if (!this.opts.noTrees) {
    for (const t of city.trees) {
      b.box(t.x, 0, t.z, 1.2, 3, 1.2, { color: rgba('#6b4a2e') });
      b.cone(t.x, 3, t.z, 5, t.h * 0.6, { color: rgba(t.shade) });
      b.cone(t.x, 3 + t.h * 0.45, t.z, 3.4, t.h * 0.5, { color: rgba(t.shade) });
    }
    }
    // Lamps: pole + glowing head + light pool on the pavement.
    for (const l of city.lamps) {
      b.prism(l.x, 0, l.z, 0.5, 9, 6, { color: rgba('#2e3438') });
      b.box(l.x, 9, l.z, 2.2, 0.8, 1.2, { color: rgba('#f4e2b0'), emissive: [0.9, 0.72, 0.4] });
      b.disc(l.x, 0.32, l.z, 7, { color: rgba('#ffdf9e', 0.4), emissive: [0.45, 0.34, 0.16] });
    }
    // Traffic lights: pole + head + red/green dots.
    for (const tl of city.trafficLights) {
      b.prism(tl.x, 0, tl.z, 0.5, 11, 6, { color: rgba('#2e3438') });
      b.box(tl.x, 11, tl.z, 2, 5, 1.4, { color: rgba('#1c2024') });
      b.box(tl.x - 0.7, 14.4, tl.z + 0.75, 1.4, 1.4, 0.3, { color: rgba('#ff2a1a'), emissive: [0.25, 0.04, 0.03] });
      b.box(tl.x - 0.7, 12.6, tl.z + 0.75, 1.4, 1.4, 0.3, { color: rgba('#22ff55'), emissive: [0.05, 0.25, 0.08] });
    }
    // Boats: hull + cabin + mast.
    for (const boat of city.boats) {
      b.box(boat.x, 0.1, boat.z, 10, 2.4, 4, { color: rgba('#5a3a28') }, boat.rot);
      b.box(boat.x, 2.5, boat.z, 4, 2, 3, { color: rgba('#e8e4d8') }, boat.rot);
      b.prism(boat.x, 2.5, boat.z, 0.3, 9, 6, { color: rgba('#3a3f45') });
    }
    // Neon billboards: posts + glowing panel + light pool.
    city.signs.forEach((s, i) => {
      const ang = Math.atan2(400 - s.x, 0 - s.z);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const u0 = i / 4;
      const u1 = (i + 1) / 4;
      const px = s.x;
      const pz = s.z;
      // Panel quad facing the plaza.
      const w = 34;
      const h = 12;
      const y0 = 12;
      const y1 = 24;
      const right = [cos, 0, -sin];
      const c = [px, 0, pz];
      const a = [c[0] - right[0] * w / 2, y0, c[2] - right[2] * w / 2];
      const bb = [c[0] + right[0] * w / 2, y0, c[2] + right[2] * w / 2];
      const cc = [c[0] + right[0] * w / 2, y1, c[2] + right[2] * w / 2];
      const dd = [c[0] - right[0] * w / 2, y1, c[2] - right[2] * w / 2];
      const n = [sin, 0, cos];
      b.quad(a, bb, cc, dd, { color: rgba('#101418'), emissive: [0.12, 0.12, 0.14], tex: [u0, 0, u1, 1], useTex: 1, normal: n });
      // Backing board.
      b.quad(dd, cc, bb, a, { color: rgba('#101418'), normal: [-n[0], 0, -n[2]] });
      // Posts.
      b.box(px - right[0] * 12, 0, pz - right[2] * 12, 1, 12, 1, { color: rgba('#2e3438') });
      b.box(px + right[0] * 12, 0, pz + right[2] * 12, 1, 12, 1, { color: rgba('#2e3438') });
      // Light pool in front of the sign.
      b.disc(px + n[0] * 8, 0.32, pz + n[2] * 8, 12, { color: rgba(s.color, 0.35), emissive: hexRgb(s.color).map((v) => v * 0.35) });
    });
    // Benches + bins around the plaza (clear path kept in front of markers).
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.5;
      const x = PLAZA.x + Math.cos(a) * (PLAZA.r - 18);
      const z = PLAZA.z + Math.sin(a) * (PLAZA.r - 18);
      b.box(x, 0.3, z, 5, 1.2, 2, { color: rgba('#7a6a52') });
    }
    this.staticCount = this.upload(b, this.buffers.static);
  }

  buildSky(presetName) {
    const p = PRESETS[presetName];
    const b = new Builder();
    const R = 7000;
    // Sky dome: rings at 0, 30, 90 degrees elevation.
    const rings = [
      { elev: 0, t: 0 },
      { elev: 30, t: 0.55 },
      { elev: 90, t: 1 },
    ];
    const seg = 24;
    const ringPts = rings.map((r) => {
      const el = (r.elev * Math.PI) / 180;
      const rr = R * Math.cos(el);
      const y = R * Math.sin(el);
      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pts.push([rr * Math.cos(a), y, rr * Math.sin(a)]);
      }
      return { pts, t: r.t };
    });
    const mix = (a, b2, t) => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, a[2] + (b2[2] - a[2]) * t];
    for (let r = 0; r < rings.length - 1; r++) {
      const lo = ringPts[r];
      const hi = ringPts[r + 1];
      for (let i = 0; i < seg; i++) {
        const cLo = mix(p.skyHorizon, p.skyTop, lo.t);
        const cHi = mix(p.skyHorizon, p.skyTop, hi.t);
        const colLo = [0, 0, 0, 1];
        const colHi = [0, 0, 0, 1];
        const n = [0, 1, 0];
        b.v(lo.pts[i], n, colLo, cLo, [0, 0], 0, 0);
        b.v(lo.pts[i + 1], n, colLo, cLo, [0, 0], 0, 0);
        b.v(hi.pts[i + 1], n, colHi, cHi, [0, 0], 0, 0);
        b.v(lo.pts[i], n, colLo, cLo, [0, 0], 0, 0);
        b.v(hi.pts[i + 1], n, colHi, cHi, [0, 0], 0, 0);
        b.v(hi.pts[i], n, colHi, cHi, [0, 0], 0, 0);
      }
    }
    // Sun / moon disc, aimed so the shot cameras see it.
    const sunC = [p.sunPos[0], p.sunPos[1], p.sunPos[2]];
    const sunDir = norm(sunC);
    b.skyDisc(sunC, sunDir, 320, { color: [0, 0, 0, 1], emissive: p.sunDisc });
    // Stars (night only): small emissive quads on the dome.
    if (p.stars) {
      const srng = mulberry32(777);
      for (let i = 0; i < 140; i++) {
        const a = srng() * Math.PI * 2;
        const el = (20 + srng() * 65) * Math.PI / 180;
        const dir = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
        const c = [dir[0] * R * 0.98, dir[1] * R * 0.98, dir[2] * R * 0.98];
        const up = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const right = norm(cross(dir, up));
        const upv = cross(right, dir);
        const s = 14 + srng() * 10;
        const e = [0.85, 0.9, 1.0];
        const col = [0, 0, 0, 1];
        const p0 = [c[0] - right[0] * s - upv[0] * s, c[1] - right[1] * s - upv[1] * s, c[2] - right[2] * s - upv[2] * s];
        const p1 = [c[0] + right[0] * s - upv[0] * s, c[1] + right[1] * s - upv[1] * s, c[2] + right[2] * s - upv[2] * s];
        const p2 = [c[0] + right[0] * s + upv[0] * s, c[1] + right[1] * s + upv[1] * s, c[2] + right[2] * s + upv[2] * s];
        const p3 = [c[0] - right[0] * s + upv[0] * s, c[1] - right[1] * s + upv[1] * s, c[2] - right[2] * s + upv[2] * s];
        b.v(p0, dir, col, e, [0, 0], 0, 0);
        b.v(p1, dir, col, e, [0, 0], 0, 0);
        b.v(p2, dir, col, e, [0, 0], 0, 0);
        b.v(p0, dir, col, e, [0, 0], 0, 0);
        b.v(p2, dir, col, e, [0, 0], 0, 0);
        b.v(p3, dir, col, e, [0, 0], 0, 0);
      }
    }
    this.skyCount = this.upload(b, this.buffers.sky);
  }

  buildShadows(presetName) {
    const p = PRESETS[presetName];
    const b = new Builder();
    const dir = norm([-p.sunDir[0], 0, -p.sunDir[2]]);
    const stretch = Math.min(2.5, 0.9 / Math.max(0.18, p.sunDir[1]));
    for (const bd of this.city.buildings) {
      const len = bd.h * stretch;
      const hw = bd.w / 2;
      const cx = bd.x + dir[0] * len / 2;
      const cz = bd.z + dir[2] * len / 2;
      const perp = [-dir[2], dir[0]];
      const a = [cx - perp[0] * hw - dir[0] * len / 2, 0.25, cz - perp[1] * hw - dir[2] * len / 2];
      const bb = [cx + perp[0] * hw - dir[0] * len / 2, 0.25, cz + perp[1] * hw - dir[2] * len / 2];
      const cc = [cx + perp[0] * hw + dir[0] * len / 2, 0.25, cz + perp[1] * hw + dir[2] * len / 2];
      const dd = [cx - perp[0] * hw + dir[0] * len / 2, 0.25, cz - perp[1] * hw + dir[2] * len / 2];
      b.quad(a, bb, cc, dd, { color: [0.05, 0.05, 0.08, 0.3], normal: [0, 1, 0] });
    }
    this.shadowCount = this.upload(b, this.buffers.shadow);
  }

  // Rebuilds the dynamic buffer from the city's cars + pedestrians (all classes).
  // Stage B extras (when this.stageB is set): headlight cones + lit-car boost,
  // E prompt ring, mission markers, Mara, dust, live traffic-light dots.
  buildDynamic() {
    const b = new Builder();
    const sb = this.stageB;
    // Cars inside the player's headlight cone get a warm emissive boost.
    // playerCar is set whenever the player is driving (the yellow diamond
    // above the driven car must render with the lights off too); only the
    // cone + lit-car boost are gated on headlightsOn.
    const litCars = new Set();
    let playerCar = null;
    if (sb && sb.playerCar) {
      playerCar = sb.playerCar;
      if (sb.headlightsOn) {
        for (const c of carsInHeadlightCone(playerCar, this.city.cars)) litCars.add(c);
      }
    }
    const car = (c) => {
      const rot = c.rot;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const local = (lx, lz) => {
        const [rx, rz] = rotXZ(lx, lz, 0, 0, cos, sin);
        return [c.x + rx, c.z + rz];
      };
      const boost = litCars.has(c) ? [0.5, 0.45, 0.3] : [0, 0, 0];
      const body = { color: rgba(c.color), spec: 0.5, emissive: boost };
      const glass = { color: rgba('#1c2733'), spec: 0.8 };
      const wheel = { color: rgba('#14161a') };
      // Body (4.4 long along local z, 2 wide) + cabin + 4 wheels.
      const [bx0, bz0] = local(-1, -2.2);
      const [bx1, bz1] = local(1, -2.2);
      const [bx2, bz2] = local(1, 2.2);
      const [bx3, bz3] = local(-1, 2.2);
      const y0 = 0.35;
      const y1 = 1.35;
      const n = [0, 1, 0];
      b.quad([bx0, y0, bz0], [bx1, y0, bz1], [bx1, y1, bz1], [bx0, y1, bz0], body);
      b.quad([bx1, y0, bz1], [bx2, y0, bz2], [bx2, y1, bz2], [bx1, y1, bz1], body);
      b.quad([bx2, y0, bz2], [bx3, y0, bz3], [bx3, y1, bz3], [bx2, y1, bz2], body);
      b.quad([bx3, y0, bz3], [bx0, y0, bz0], [bx0, y1, bz0], [bx3, y1, bz3], body);
      b.quad([bx0, y1, bz0], [bx1, y1, bz1], [bx2, y1, bz2], [bx3, y1, bz3], { ...body, normal: n });
      const [cx0, cz0] = local(-0.85, -0.9);
      const [cx1, cz1] = local(0.85, -0.9);
      const [cx2, cz2] = local(0.85, 1.0);
      const [cx3, cz3] = local(-0.85, 1.0);
      b.quad([cx0, y1, cz0], [cx1, y1, cz1], [cx1, y1 + 0.85, cz1], [cx0, y1 + 0.85, cz0], glass);
      b.quad([cx1, y1, cz1], [cx2, y1, cz2], [cx2, y1 + 0.85, cz2], [cx1, y1 + 0.85, cz1], glass);
      b.quad([cx2, y1, cz2], [cx3, y1, cz3], [cx3, y1 + 0.85, cz3], [cx2, y1 + 0.85, cz2], glass);
      b.quad([cx3, y1, cz3], [cx0, y1, cz0], [cx0, y1 + 0.85, cz0], [cx3, y1 + 0.85, cz3], glass);
      b.quad([cx0, y1 + 0.85, cz0], [cx1, y1 + 0.85, cz1], [cx2, y1 + 0.85, cz2], [cx3, y1 + 0.85, cz3], { ...glass, normal: n });
      for (const [lx, lz] of [[-0.95, -1.5], [0.95, -1.5], [-0.95, 1.5], [0.95, 1.5]]) {
        const [wx, wz] = local(lx, lz);
        b.box(wx, 0.1, wz, 0.5, 0.7, 0.5, wheel, rot);
      }
      if (c.kind === 'taxi' || c.kind === 'drivable') {
        const [sx, sz] = local(0, 0);
        b.box(sx, y1 + 0.85, sz, 1.4, 0.5, 0.7, { color: rgba('#f4efe2'), emissive: [0.9, 0.8, 0.55] }, rot);
      }
      // Taillights (rear face) + headlights (front face, night/sunset traffic).
      const rear = (lx) => local(lx, -2.25);
      const front = (lx) => local(lx, 2.25);
      for (const lx of [-0.6, 0.6]) {
        const [tx0, tz0] = rear(lx - 0.25);
        const [tx1, tz1] = rear(lx + 0.25);
        b.quad([tx0, 0.7, tz0], [tx1, 0.7, tz1], [tx1, 1.05, tz1], [tx0, 1.05, tz0], { color: rgba('#ff2a1a'), emissive: [0.9, 0.1, 0.1] });
        if (sb && (sb.preset === 'night' || sb.preset === 'sunset') && (c.kind === 'traffic' || c.kind === 'taxi')) {
          const [hx0, hz0] = front(lx - 0.25);
          const [hx1, hz1] = front(lx + 0.25);
          b.quad([hx0, 0.7, hz0], [hx1, 0.7, hz1], [hx1, 1.05, hz1], [hx0, 1.05, hz0], { color: rgba('#fff2c0'), emissive: [0.9, 0.85, 0.6] });
        }
      }
    };
    for (const c of this.city.cars) car(c);
    for (const p of this.city.pedestrians) {
      b.box(p.x, 0, p.z, 1.1, 2.2, 0.7, { color: rgba(p.jacket) }, p.rot);
      b.box(p.x, 2.2, p.z, 0.7, 0.7, 0.7, { color: rgba('#e8b98a') }, p.rot);
    }
    // Player headlight cones: two ground trapezoids + a soft pool ahead.
    if (sb && playerCar && sb.headlightsOn) {
      const preset = sb.preset || 'midday';
      const strength = preset === 'night' ? 1.0 : preset === 'sunset' ? 0.7 : 0.35;
      const [fx, fz] = [-Math.sin(playerCar.rot), Math.cos(playerCar.rot)];
      const rx = -fz;
      const rz = fx;
      for (const side of [-0.7, 0.7]) {
        const hx = playerCar.x + rx * side;
        const hz = playerCar.z + rz * side;
        const nL = [hx - rx * 0.6 + fx * 2.4, hz - rz * 0.6 + fz * 2.4];
        const nR = [hx + rx * 0.6 + fx * 2.4, hz + rz * 0.6 + fz * 2.4];
        const fL = [hx - rx * 3.2 + fx * 24, hz - rz * 3.2 + fz * 24];
        const fR = [hx + rx * 3.2 + fx * 24, hz + rz * 3.2 + fz * 24];
        b.quad([nL[0], 0.22, nL[1]], [nR[0], 0.22, nR[1]], [fR[0], 0.22, fR[1]], [fL[0], 0.22, fL[1]], {
          color: [1, 0.95, 0.75, 0.5 * strength],
          emissive: [0.9 * strength, 0.82 * strength, 0.55 * strength],
          normal: [0, 1, 0],
        });
      }
      b.disc(playerCar.x + fx * 12, 0.21, playerCar.z + fz * 12, 7, {
        color: [1, 0.95, 0.75, 0.3 * strength],
        emissive: [0.5 * strength, 0.45 * strength, 0.28 * strength],
      });
    }
    // Yellow diamond above the driven car.
    if (playerCar) {
      const bob = 0.4 * Math.sin((sb.time ?? 0) * 2);
      b.pyramid(playerCar.x, 4.2 + bob, playerCar.z, 2.2, 2.2, 2.2, { color: rgba('#ffd25f'), emissive: [0.9, 0.7, 0.2] });
    }
    // E prompt ring on the ground around the nearest car.
    if (sb && sb.eRing) {
      b.disc(sb.eRing.x, 0.24, sb.eRing.z, sb.eRing.r, {
        color: sb.eRing.locked ? [0.6, 0.6, 0.65, 0.3] : [1, 0.82, 0.37, 0.35],
        emissive: sb.eRing.locked ? [0.2, 0.2, 0.22] : [0.45, 0.35, 0.1],
      });
    }
    // Mission markers: ground cylinder + floating diamond + ground ring.
    if (sb && sb.markers) {
      for (const m of sb.markers) {
        const bob = 0.5 * Math.sin((sb.time ?? 0) * 2.5);
        b.prism(m.x, 0.3, m.z, 3, 14, 10, { color: rgba(m.color, 0.35), emissive: hexRgb(m.color).map((v) => v * 0.5) });
        b.pyramid(m.x, 15 + bob, m.z, 3, 3, 3, { color: rgba(m.color), emissive: hexRgb(m.color).map((v) => v * 0.8) });
        b.disc(m.x, 0.26, m.z, 6, { color: rgba(m.color, 0.3), emissive: hexRgb(m.color).map((v) => v * 0.3) });
      }
    }
    // Mara on foot.
    if (sb && sb.mara) {
      b.box(sb.mara.x, 0, sb.mara.z, 1.1, 2.2, 0.7, { color: rgba('#e84c3d') }, sb.mara.rot);
      b.box(sb.mara.x, 2.2, sb.mara.z, 0.7, 0.7, 0.7, { color: rgba('#e8b98a') }, sb.mara.rot);
    }
    // Dust puffs from collisions.
    if (sb && sb.dust) {
      for (const d of sb.dust) {
        const a = Math.max(0, 0.4 * (1 - d.age / d.life));
        b.disc(d.x, 0.3, d.z, 2 + d.age * 3, { color: [0.8, 0.75, 0.65, a], emissive: [0.1, 0.1, 0.1] });
      }
    }
    // Live traffic-light dots: a bright box at the active lamp.
    if (sb && sb.lightStates) {
      for (const ls of sb.lightStates) {
        const y = ls.state === 'red' ? 14.4 : ls.state === 'green' ? 12.6 : 13.5;
        const col = ls.state === 'red' ? '#ff2a1a' : ls.state === 'green' ? '#22ff55' : '#ffb020';
        const em = ls.state === 'red' ? [1, 0.15, 0.1] : ls.state === 'green' ? [0.2, 1, 0.3] : [1, 0.65, 0.1];
        b.box(ls.x - 0.7, y, ls.z + 0.75, 1.8, 1.8, 0.4, { color: rgba(col), emissive: em });
      }
    }
    this.dynCount = this.upload(b, this.buffers.dyn);
  }

  draw(presetName, camera, aspect) {
    const gl = this.gl;
    const p = PRESETS[presetName];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(p.fogColor[0], p.fogColor[1], p.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const proj = perspective((60 * Math.PI) / 180, aspect, 1, 12000);
    const view = lookAt(camera.pos, camera.target, [0, 1, 0]);
    const vp = mul(proj, view);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.loc.uVP, false, new Float32Array(vp));
    gl.uniform3fv(this.loc.uViewPos, new Float32Array(camera.pos));
    gl.uniform3fv(this.loc.uSunDir, new Float32Array(p.sunDir));
    gl.uniform3fv(this.loc.uSunColor, new Float32Array(p.sunColor));
    gl.uniform3fv(this.loc.uAmbient, new Float32Array(p.ambient));
    gl.uniform3fv(this.loc.uFogColor, new Float32Array(p.fogColor));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.neonTex);
    // Sky: no fog, no depth write.
    gl.uniform1f(this.loc.uFogDensity, 0);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    if (!this.opts.noSky) {
      this.bindBuffer(this.buffers.sky);
      gl.drawArrays(gl.TRIANGLES, 0, this.skyCount);
    }
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    // Shadows, then the city, then the dynamic cars + pedestrians.
    gl.uniform1f(this.loc.uFogDensity, p.fogDensity);
    if (!this.opts.noShadows) {
      this.bindBuffer(this.buffers.shadow);
      gl.drawArrays(gl.TRIANGLES, 0, this.shadowCount);
    }
    this.bindBuffer(this.buffers.static);
    gl.drawArrays(gl.TRIANGLES, 0, this.staticCount);
    this.buildDynamic();
    this.bindBuffer(this.buffers.dyn);
    gl.drawArrays(gl.TRIANGLES, 0, this.dynCount);
  }
}
