/**
 * Coat texture (gene F): fur, scales or armour as a shallow relief on the torso. The relief only sinks into the
 * surface (at most COAT_DEPTH), so the silhouette, the print audit and the joints stay as they are.
 *
 * One height function serves all three views: the bake adds it to the torso's distance field, the 3D preview turns it
 * into a bump on the torso (COAT_GLSL mirrors coatDepth line by line), and the 2D sketch draws the side view of its
 * grooves (coatPath). Coordinates are the torso's own frame: u along the body (forward +), v up, z sideways.
 */
import { Path, taper, tube, type XY } from './path';

export interface Coat {
  /** 1 fur, 2 scales, 3 armour (gene F; 0 smooth has no coat) */
  kind: 1 | 2 | 3;
  /** torso centre and tilt: the frame the relief is laid out in */
  cx: number; cy: number; tilt: number;
}

/** How deep (mm) the grooves sink into the torso. */
export const COAT_DEPTH = 0.45;

const FUR = { lane: 2, seg: 5, angle: 0.45, wave: 0.5 };
const SCALE = { col: 3.2, row: 2.6 };
const ARMOUR = { plate: 4.8 };

const fract = (v: number): number => v - Math.floor(v);
const sstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (n: number): number => fract(Math.sin(n * 127.1) * 43758.5453);

/** fur: locks running back and down, staggered along their lanes; grooves between them */
function furH(a: number, b: number): number {
  const c = Math.cos(FUR.angle), s_ = Math.sin(FUR.angle);
  const s = -a * c - b * s_, q = a * s_ - b * c + FUR.wave * Math.sin(s * 0.4);
  const lane = Math.floor(q / FUR.lane), qc = Math.abs((fract(q / FUR.lane) - 0.5) * FUR.lane);
  const t = fract((s + hash(lane) * FUR.seg) / FUR.seg);
  const w = FUR.lane * 0.5 * (0.3 + 0.55 * Math.sin(Math.PI * t));
  return sstep(w - 0.3, w, qc);
}

/** scales: a staggered (hexagonal) lattice; grooves on the cell borders, each scale slightly domed */
function scaleH(a: number, b: number): number {
  const r0 = Math.floor(b / SCALE.row + 0.5);
  let d1 = 1e9, d2 = 1e9;
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    const off = (r & 1) ? SCALE.col / 2 : 0, c0 = Math.floor((a - off) / SCALE.col + 0.5);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const d = Math.hypot(a - (c * SCALE.col + off), b - r * SCALE.row);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  }
  return Math.max(1 - sstep(0.12, 0.5, (d2 - d1) / 2), 0.3 * Math.min(1, d1 / 1.8));
}

/** armour: plates across the back, each a little lower towards its rear edge, with a groove between plates */
function armourH(u: number): number {
  const f = fract(u / ARMOUR.plate), e = Math.min(f, 1 - f) * ARMOUR.plate;
  return Math.max(1 - sstep(0.15, 0.55, e), 0.3 * (1 - f));
}

/**
 * How deep (mm, >= 0) the coat sinks the torso surface at world point (x, y, z) whose outward normal is (nx, ny, nz).
 * Fur and scales are projected onto the side, the top and the front and blended by the normal (the top is mirrored at
 * the spine so both flanks match); armour depends only on the position along the body.
 */
export function coatDepth(c: Coat, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const cs = Math.cos(c.tilt), sn = Math.sin(c.tilt), dx = x - c.cx, dy = y - c.cy;
  const u = dx * cs + dy * sn, v = -dx * sn + dy * cs;
  if (c.kind === 3) return COAT_DEPTH * armourH(u);
  const nu = nx * cs + ny * sn, nv = -nx * sn + ny * cs;
  const ws = nz * nz, wt = nv * nv, wf = nu * nu, sum = ws + wt + wf || 1;
  const H = c.kind === 1 ? furH : scaleH, az = Math.abs(z);
  return COAT_DEPTH * (ws * H(u, v) + wt * H(u, -az) + wf * H(az, v)) / sum;
}

/** GLSL twin of coatDepth (uniform `coat` = (kind, cx, cy, tilt)). */
export const COAT_GLSL = /* glsl */ `
float cFract(float v) { return v - floor(v); }
float cHash(float n) { return cFract(sin(n * 127.1) * 43758.5453); }
float furH(float a, float b) {
  float c = cos(${FUR.angle.toFixed(3)}), s_ = sin(${FUR.angle.toFixed(3)});
  float s = -a * c - b * s_, q = a * s_ - b * c + ${FUR.wave.toFixed(3)} * sin(s * 0.4);
  float lane = floor(q / ${FUR.lane.toFixed(3)}), qc = abs((cFract(q / ${FUR.lane.toFixed(3)}) - 0.5) * ${FUR.lane.toFixed(3)});
  float t = cFract((s + cHash(lane) * ${FUR.seg.toFixed(3)}) / ${FUR.seg.toFixed(3)});
  float w = ${FUR.lane.toFixed(3)} * 0.5 * (0.3 + 0.55 * sin(3.14159265 * t));
  return smoothstep(w - 0.3, w, qc);
}
float scaleH(float a, float b) {
  float r0 = floor(b / ${SCALE.row.toFixed(3)} + 0.5);
  float d1 = 1e9, d2 = 1e9;
  for (int i = -1; i <= 1; i++) {
    float r = r0 + float(i);
    float off = mod(abs(r), 2.0) > 0.5 ? ${(SCALE.col / 2).toFixed(3)} : 0.0;
    float c0 = floor((a - off) / ${SCALE.col.toFixed(3)} + 0.5);
    for (int j = -1; j <= 1; j++) {
      float d = length(vec2(a - ((c0 + float(j)) * ${SCALE.col.toFixed(3)} + off), b - r * ${SCALE.row.toFixed(3)}));
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return max(1.0 - smoothstep(0.12, 0.5, (d2 - d1) / 2.0), 0.3 * min(1.0, d1 / 1.8));
}
float armourH(float u) {
  float f = cFract(u / ${ARMOUR.plate.toFixed(3)}), e = min(f, 1.0 - f) * ${ARMOUR.plate.toFixed(3)};
  return max(1.0 - smoothstep(0.15, 0.55, e), 0.3 * (1.0 - f));
}
float coatDepth(vec4 c, vec3 p, vec3 n) {
  float cs = cos(c.w), sn = sin(c.w), dx = p.x - c.y, dy = p.y - c.z;
  float u = dx * cs + dy * sn, v = -dx * sn + dy * cs;
  if (c.x > 2.5) return ${COAT_DEPTH.toFixed(3)} * armourH(u);
  float nu = n.x * cs + n.y * sn, nv = -n.x * sn + n.y * cs;
  float ws = n.z * n.z, wt = nv * nv, wf = nu * nu, sum = max(ws + wt + wf, 1e-4);
  float az = abs(p.z);
  float h = c.x < 1.5
    ? ws * furH(u, v) + wt * furH(u, -az) + wf * furH(az, v)
    : ws * scaleH(u, v) + wt * scaleH(u, -az) + wf * scaleH(az, v);
  return ${COAT_DEPTH.toFixed(3)} * h / sum;
}`;

/**
 * The side view of the coat's grooves for the 2D sketch, in the torso's own frame centred on (0, 0) (the caller moves
 * and tilts it with the torso and clips it to the torso outline). rx, ry: half the area to cover.
 */
export function coatPath(kind: 1 | 2 | 3, rx: number, ry: number, at: XY): Path {
  const out = new Path();
  const P = (a: number, b: number): XY => [at[0] + a, at[1] + b];
  if (kind === 3) {
    for (let k = Math.ceil(-rx / ARMOUR.plate); k * ARMOUR.plate <= rx; k++) out.append(tube(P(k * ARMOUR.plate, -ry), P(k * ARMOUR.plate, ry), 0.8, 0.8));
  } else if (kind === 2) {
    const { col, row } = SCALE;
    const y0 = (row * row - col * col / 4) / (2 * row), top = row - y0;
    for (let r = Math.floor(-ry / row) - 1; r * row <= ry + row; r++) {
      const off = (r & 1) ? col / 2 : 0;
      for (let c = Math.floor((-rx - off) / col) - 1; c * col + off <= rx + col; c++) {
        const a = c * col + off, b = r * row;
        out.append(tube(P(a - col / 2, b + y0), P(a, b + top), 0.45, 0.45));
        out.append(tube(P(a, b + top), P(a + col / 2, b + y0), 0.45, 0.45));
        out.append(tube(P(a + col / 2, b + y0), P(a + col / 2, b - y0), 0.45, 0.45));
      }
    }
  } else {
    // fur: the gap between neighbouring locks, drawn as a flick that is widest where the locks narrow (their ends)
    const c = Math.cos(FUR.angle), s_ = Math.sin(FUR.angle), R = Math.hypot(rx, ry) + FUR.seg;
    const toAB = (s: number, qEff: number): XY => { const q = qEff - FUR.wave * Math.sin(s * 0.4); return P(-c * s + s_ * q, -s_ * s - c * q); };
    for (let k = Math.floor(-R / FUR.lane); k * FUR.lane <= R; k++) {
      const q = k * FUR.lane, start = -hash(k) * FUR.seg; // a boundary between lane k-1 and k: lock ends of lane k
      for (let s = start - Math.ceil(R / FUR.seg) * FUR.seg; s < R; s += FUR.seg) {
        out.append(taper(toAB(s - 1.2, q), toAB(s + 0.6, q), toAB(s + 2.8, q), (t) => 0.75 * (1 - t) + 0.15, 6));
      }
    }
  }
  return out;
}
