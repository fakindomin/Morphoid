/** Tiny SVG path builder working in rig millimetres; projection happens in d(). */
export type XY = readonly [number, number];
export type ToPx = (x: number, y: number) => XY;

type Cmd = [string, ...number[]];

export class Path {
  private c: Cmd[] = [];
  M(x: number, y: number): this { this.c.push(['M', x, y]); return this; }
  L(x: number, y: number): this { this.c.push(['L', x, y]); return this; }
  Q(cx: number, cy: number, x: number, y: number): this { this.c.push(['Q', cx, cy, x, y]); return this; }
  C(a: number, b: number, c: number, d: number, x: number, y: number): this { this.c.push(['C', a, b, c, d, x, y]); return this; }
  Z(): this { this.c.push(['Z']); return this; }
  get empty(): boolean { return this.c.length === 0; }
  append(p: Path): this { this.c.push(...p.c); return this; }

  d(to: ToPx): string {
    let out = '';
    for (const [op, ...n] of this.c) {
      out += op;
      for (let i = 0; i < n.length; i += 2) {
        const [px, py] = to(n[i]!, n[i + 1]!);
        out += `${px.toFixed(1)},${py.toFixed(1)} `;
      }
    }
    return out;
  }

  /** Polygons (one per subpath) with curves sampled; coordinates stay in mm. */
  flatten(steps = 8): XY[][] {
    const polys: XY[][] = [];
    let cur: XY[] = [];
    let last: XY = [0, 0];
    const flush = (): void => { if (cur.length > 2) polys.push(cur); cur = []; };
    for (const [op, ...n] of this.c) {
      if (op === 'M') { flush(); last = [n[0]!, n[1]!]; cur.push(last); }
      else if (op === 'L') { last = [n[0]!, n[1]!]; cur.push(last); }
      else if (op === 'Q') {
        const [cx, cy, x, y] = n as [number, number, number, number];
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([u * u * last[0] + 2 * u * t * cx + t * t * x, u * u * last[1] + 2 * u * t * cy + t * t * y]);
        }
        last = [x, y];
      } else if (op === 'C') {
        const [a, b, c2, d, x, y] = n as [number, number, number, number, number, number];
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([
            u * u * u * last[0] + 3 * u * u * t * a + 3 * u * t * t * c2 + t * t * t * x,
            u * u * u * last[1] + 3 * u * u * t * b + 3 * u * t * t * d + t * t * t * y,
          ]);
        }
        last = [x, y];
      } else if (op === 'Z') flush();
    }
    flush();
    return polys;
  }

  /** Copy shifted by (dx, dy) mm. */
  translated(dx: number, dy: number): Path {
    const p = new Path();
    p.c = this.c.map(([op, ...n]) => [op, ...n.map((v, i) => v + (i % 2 === 0 ? dx : dy))] as Cmd);
    return p;
  }
}

const K = 0.5523;

export function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0): Path {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const T = (a: number, b: number): XY => [cx + a * cos - b * sin, cy + a * sin + b * cos];
  const pts: [number, number][][] = [
    [[rx, K * ry], [K * rx, ry], [0, ry]],
    [[-K * rx, ry], [-rx, K * ry], [-rx, 0]],
    [[-rx, -K * ry], [-K * rx, -ry], [0, -ry]],
    [[K * rx, -ry], [rx, -K * ry], [rx, 0]],
  ];
  const p = new Path();
  const s = T(rx, 0);
  p.M(s[0], s[1]);
  for (const seg of pts) {
    const [a, b, c] = seg.map(([x, y]) => T(x, y)) as [XY, XY, XY];
    p.C(a[0], a[1], b[0], b[1], c[0], c[1]);
  }
  return p.Z();
}

export function polygon(points: readonly XY[]): Path {
  const p = new Path();
  points.forEach(([x, y], i) => (i === 0 ? p.M(x, y) : p.L(x, y)));
  return p.Z();
}

export function line(a: XY, b: XY): Path {
  return new Path().M(a[0], a[1]).L(b[0], b[1]);
}

/** Straight tube between two points with end widths. */
export function tube(a: XY, b: XY, w0: number, w1: number): Path {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return polygon([
    [a[0] + nx * w0 / 2, a[1] + ny * w0 / 2], [b[0] + nx * w1 / 2, b[1] + ny * w1 / 2],
    [b[0] - nx * w1 / 2, b[1] - ny * w1 / 2], [a[0] - nx * w0 / 2, a[1] - ny * w0 / 2],
  ]);
}

/** Quadratic curve a -> b (control c) swept with a width profile w(t), t in [0,1]. */
export function taper(a: XY, c: XY, b: XY, w: (t: number) => number, n = 10, oneSided = false): Path {
  const left: XY[] = [], right: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    const tx = 2 * u * (c[0] - a[0]) + 2 * t * (b[0] - c[0]);
    const ty = 2 * u * (c[1] - a[1]) + 2 * t * (b[1] - c[1]);
    const l = Math.hypot(tx, ty) || 1;
    const nx = -ty / l, ny = tx / l, hw = Math.max(0, w(t)) / 2;
    if (oneSided) { // spine is the left edge; the body grows to the right of the direction of travel
      left.push([x, y]);
      right.push([x - nx * hw * 2, y - ny * hw * 2]);
    } else {
      left.push([x + nx * hw, y + ny * hw]);
      right.push([x - nx * hw, y - ny * hw]);
    }
  }
  return polygon([...left, ...right.reverse()]);
}
