import { straight, type Point, type Quad } from '../shared/geometry';
import { GRID_STEP, MIN_SEGMENT } from '../shared/roadplan';

/** Avstånd mellan gatorna i rutnätsverktyget: 4 cellrader på varje sida plus gatan. */
export const GRID_BLOCK = 72;
/** Minsta avstånd mellan punkterna som blir korsningar i en frihandsväg. */
const FREEHAND_SPACING = 30;
const FREEHAND_TOLERANCE = 3;

export function snapToGrid(p: Point): Point {
  return { x: Math.round(p.x / GRID_STEP) * GRID_STEP, z: Math.round(p.z / GRID_STEP) * GRID_STEP };
}

/**
 * Gör om en ritad musbana till en mjuk kedja av kurvor. Banan förenklas först
 * (Ramer–Douglas–Peucker), sedan blir varje mellanpunkt kontrollpunkt för en kurva som
 * går mellan mittpunkterna på sträckorna runt den – det ger en jämn väg utan knyckar.
 */
export function fitFreehand(path: Point[]): Quad[] {
  if (path.length < 2) return [];
  let pts = simplify(path, FREEHAND_TOLERANCE);
  const spaced: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(pts[i], spaced[spaced.length - 1]) >= FREEHAND_SPACING) spaced.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (spaced.length > 1 && dist(last, spaced[spaced.length - 1]) < FREEHAND_SPACING / 2) spaced.pop();
  spaced.push(last);
  pts = spaced;
  if (pts.length === 2) return [straight(pts[0].x, pts[0].z, pts[1].x, pts[1].z)];

  const curves: Quad[] = [];
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  for (let i = 1; i < pts.length - 1; i++) {
    const from = i === 1 ? pts[0] : mid(pts[i - 1], pts[i]);
    const to = i === pts.length - 2 ? pts[pts.length - 1] : mid(pts[i], pts[i + 1]);
    curves.push({ ax: from.x, az: from.z, cx: pts[i].x, cz: pts[i].z, bx: to.x, bz: to.z });
  }
  return curves;
}

/** Gator för ett rutnät i rektangeln mellan två hörn (som redan fäst mot rutnätet). */
export function gridLines(a: Point, b: Point): Quad[] {
  const xs = steps(Math.min(a.x, b.x), Math.max(a.x, b.x));
  const zs = steps(Math.min(a.z, b.z), Math.max(a.z, b.z));
  if (xs.length < 2 || zs.length < 2) return [];
  const x0 = xs[0];
  const x1 = xs[xs.length - 1];
  const z0 = zs[0];
  const z1 = zs[zs.length - 1];
  return [...xs.map((x) => straight(x, z0, x, z1)), ...zs.map((z) => straight(x0, z, x1, z))];
}

function steps(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to + 0.01; p += GRID_BLOCK) out.push(p);
  if (out.length > 0 && to - out[out.length - 1] >= MIN_SEGMENT * 2) out.push(to);
  return out;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  let worst = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToLine(points[i], a, b);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  const left = simplify(points.slice(0, index + 1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return dist(p, a);
  return Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / len;
}
