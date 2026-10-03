/**
 * Geometri för vägar. Varje vägsträcka är en kvadratisk Bézierkurva: start (a),
 * kontrollpunkt (c) och slut (b). En rak väg har kontrollpunkten mitt emellan.
 * Kvadratiska kurvor går att dela exakt (de Casteljau), vilket gör det enkelt att
 * skapa nya korsningar mitt på en befintlig väg.
 */
export interface Quad {
  ax: number;
  az: number;
  cx: number;
  cz: number;
  bx: number;
  bz: number;
}

export interface Point {
  x: number;
  z: number;
}

/** Kurvan som tät polylinje, med kurvparameter och ackumulerad längd per punkt. */
export interface Polyline {
  /** x, z omväxlande. */
  pts: Float32Array;
  ts: Float32Array;
  cum: Float32Array;
  length: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function straight(ax: number, az: number, bx: number, bz: number): Quad {
  return { ax, az, cx: (ax + bx) / 2, cz: (az + bz) / 2, bx, bz };
}

export function pointAt(q: Quad, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * q.ax + 2 * u * t * q.cx + t * t * q.bx,
    z: u * u * q.az + 2 * u * t * q.cz + t * t * q.bz,
  };
}

/** Normaliserad riktning längs kurvan vid t. */
export function tangentAt(q: Quad, t: number): Point {
  let x = 2 * (1 - t) * (q.cx - q.ax) + 2 * t * (q.bx - q.cx);
  let z = 2 * (1 - t) * (q.cz - q.az) + 2 * t * (q.bz - q.cz);
  let len = Math.hypot(x, z);
  if (len < 1e-9) {
    x = q.bx - q.ax;
    z = q.bz - q.az;
    len = Math.hypot(x, z) || 1;
  }
  return { x: x / len, z: z / len };
}

/** Delar kurvan exakt vid t. */
export function splitQuad(q: Quad, t: number): [Quad, Quad] {
  const p01x = q.ax + (q.cx - q.ax) * t;
  const p01z = q.az + (q.cz - q.az) * t;
  const p12x = q.cx + (q.bx - q.cx) * t;
  const p12z = q.cz + (q.bz - q.cz) * t;
  const mx = p01x + (p12x - p01x) * t;
  const mz = p01z + (p12z - p01z) * t;
  return [
    { ax: q.ax, az: q.az, cx: p01x, cz: p01z, bx: mx, bz: mz },
    { ax: mx, az: mz, cx: p12x, cz: p12z, bx: q.bx, bz: q.bz },
  ];
}

/** Den del av kurvan som ligger mellan t0 och t1. */
export function subQuad(q: Quad, t0: number, t1: number): Quad {
  let r = t1 >= 1 ? q : splitQuad(q, t1)[0];
  if (t0 <= 0) return { ...r };
  r = splitQuad(r, t0 / t1)[1];
  return r;
}

/** Tät polylinje längs kurvan, med högst `maxStep` meter mellan punkterna. */
export function sampleQuad(q: Quad, maxStep = 2): Polyline {
  const approx = (Math.hypot(q.cx - q.ax, q.cz - q.az) + Math.hypot(q.bx - q.cx, q.bz - q.cz) + Math.hypot(q.bx - q.ax, q.bz - q.az)) / 2;
  const n = Math.min(512, Math.max(1, Math.ceil(approx / maxStep)));
  const pts = new Float32Array((n + 1) * 2);
  const ts = new Float32Array(n + 1);
  const cum = new Float32Array(n + 1);
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  let length = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = pointAt(q, t);
    pts[i * 2] = p.x;
    pts[i * 2 + 1] = p.z;
    ts[i] = t;
    if (i > 0) length += Math.hypot(p.x - pts[i * 2 - 2], p.z - pts[i * 2 - 1]);
    cum[i] = length;
    if (p.x < minX) minX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { pts, ts, cum, length, minX, minZ, maxX, maxZ };
}

export interface PathPoint {
  x: number;
  z: number;
  /** Normaliserad riktning. */
  tx: number;
  tz: number;
  /** Kurvparameter. */
  t: number;
}

/** Punkt och riktning `s` meter in längs polylinjen. */
export function atLength(pl: Polyline, s: number): PathPoint {
  const { cum } = pl;
  const last = cum.length - 1;
  if (s <= 0) return segmentPoint(pl, 0, 0);
  if (s >= pl.length) return segmentPoint(pl, last - 1, 1);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const f = segLen > 0 ? (s - cum[lo]) / segLen : 0;
  return segmentPoint(pl, lo, f);
}

function segmentPoint(pl: Polyline, i: number, f: number): PathPoint {
  const { pts, ts } = pl;
  const x0 = pts[i * 2];
  const z0 = pts[i * 2 + 1];
  const x1 = pts[i * 2 + 2];
  const z1 = pts[i * 2 + 3];
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  return {
    x: x0 + (x1 - x0) * f,
    z: z0 + (z1 - z0) * f,
    tx: (x1 - x0) / len,
    tz: (z1 - z0) / len,
    t: ts[i] + (ts[i + 1] - ts[i]) * f,
  };
}

export interface ClosestPoint {
  dist: number;
  x: number;
  z: number;
  /** Kurvparameter. */
  t: number;
  /** Meter från kurvans start. */
  s: number;
}

export function closestPoint(pl: Polyline, x: number, z: number): ClosestPoint {
  const { pts, ts, cum } = pl;
  let best: ClosestPoint = { dist: Infinity, x: 0, z: 0, t: 0, s: 0 };
  for (let i = 0; i + 1 < ts.length; i++) {
    const x0 = pts[i * 2];
    const z0 = pts[i * 2 + 1];
    const dx = pts[i * 2 + 2] - x0;
    const dz = pts[i * 2 + 3] - z0;
    const lenSq = dx * dx + dz * dz;
    let f = lenSq > 0 ? ((x - x0) * dx + (z - z0) * dz) / lenSq : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const px = x0 + dx * f;
    const pz = z0 + dz * f;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.dist) {
      best = { dist: d, x: px, z: pz, t: ts[i] + (ts[i + 1] - ts[i]) * f, s: cum[i] + (cum[i + 1] - cum[i]) * f };
    }
  }
  return best;
}

/** Kortaste avståndet från en punkt till polylinjen (snabbare än closestPoint). */
export function distanceTo(pl: Polyline, x: number, z: number): number {
  const { pts } = pl;
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i];
    const z0 = pts[i + 1];
    const dx = pts[i + 2] - x0;
    const dz = pts[i + 3] - z0;
    const lenSq = dx * dx + dz * dz;
    let f = lenSq > 0 ? ((x - x0) * dx + (z - z0) * dz) / lenSq : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    const ex = x0 + dx * f - x;
    const ez = z0 + dz * f - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Var två sträckor skär varandra: andel längs första (u) och andra (v), eller null. */
export function segmentIntersection(
  p1x: number,
  p1z: number,
  p2x: number,
  p2z: number,
  p3x: number,
  p3z: number,
  p4x: number,
  p4z: number,
): [number, number] | null {
  const d1x = p2x - p1x;
  const d1z = p2z - p1z;
  const d2x = p4x - p3x;
  const d2z = p4z - p3z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const ex = p3x - p1x;
  const ez = p3z - p1z;
  const u = (ex * d2z - ez * d2x) / denom;
  const v = (ex * d1z - ez * d1x) / denom;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [u, v];
}

export interface Crossing {
  /** Kurvparameter på första kurvan. */
  ta: number;
  /** Kurvparameter på andra kurvan. */
  tb: number;
  x: number;
  z: number;
}

/** Alla punkter där två polylinjer korsar varandra. */
export function crossings(a: Polyline, b: Polyline): Crossing[] {
  const out: Crossing[] = [];
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ) return out;
  const pa = a.pts;
  const pb = b.pts;
  for (let i = 0; i + 1 < a.ts.length; i++) {
    const ax0 = pa[i * 2];
    const az0 = pa[i * 2 + 1];
    const ax1 = pa[i * 2 + 2];
    const az1 = pa[i * 2 + 3];
    const minX = Math.min(ax0, ax1);
    const maxX = Math.max(ax0, ax1);
    const minZ = Math.min(az0, az1);
    const maxZ = Math.max(az0, az1);
    if (maxX < b.minX || minX > b.maxX || maxZ < b.minZ || minZ > b.maxZ) continue;
    for (let j = 0; j + 1 < b.ts.length; j++) {
      const bx0 = pb[j * 2];
      const bz0 = pb[j * 2 + 1];
      const bx1 = pb[j * 2 + 2];
      const bz1 = pb[j * 2 + 3];
      if (Math.max(bx0, bx1) < minX || Math.min(bx0, bx1) > maxX || Math.max(bz0, bz1) < minZ || Math.min(bz0, bz1) > maxZ) continue;
      const hit = segmentIntersection(ax0, az0, ax1, az1, bx0, bz0, bx1, bz1);
      if (!hit) continue;
      const [u, v] = hit;
      const x = ax0 + (ax1 - ax0) * u;
      const z = az0 + (az1 - az0) * u;
      // Samma korsning kan hittas två gånger när den ligger precis på en brytpunkt.
      if (out.some((c) => Math.abs(c.x - x) < 0.5 && Math.abs(c.z - z) < 0.5)) continue;
      out.push({
        ta: a.ts[i] + (a.ts[i + 1] - a.ts[i]) * u,
        tb: b.ts[j] + (b.ts[j + 1] - b.ts[j]) * v,
        x,
        z,
      });
    }
  }
  return out;
}

/** Minsta kurvradie längs polylinjen (uppskattad från riktningsändringen mellan punkterna). */
export function minRadius(pl: Polyline): number {
  const { pts } = pl;
  let min = Infinity;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const ax = pts[i] - pts[i - 2];
    const az = pts[i + 1] - pts[i - 1];
    const bx = pts[i + 2] - pts[i];
    const bz = pts[i + 3] - pts[i + 1];
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
    const angle = Math.acos(cos);
    if (angle < 1e-6) continue;
    const r = (la + lb) / 2 / angle;
    if (r < min) min = r;
  }
  return min;
}

/** Vinkeln mellan två riktningar, 0–π. */
export function angleBetween(ax: number, az: number, bx: number, bz: number): number {
  const la = Math.hypot(ax, az) || 1;
  const lb = Math.hypot(bx, bz) || 1;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb))));
}

/**
 * Punkter med jämnt avstånd längs polylinjen mellan s0 och s1.
 * Returnerar x, z, tx, tz per punkt (minst två punkter).
 */
export function resample(pl: Polyline, s0: number, s1: number, step: number): Float32Array {
  const len = Math.max(0, s1 - s0);
  const n = Math.max(1, Math.ceil(len / step));
  const out = new Float32Array((n + 1) * 4);
  for (let i = 0; i <= n; i++) {
    const p = atLength(pl, s0 + (len * i) / n);
    out[i * 4] = p.x;
    out[i * 4 + 1] = p.z;
    out[i * 4 + 2] = p.tx;
    out[i * 4 + 3] = p.tz;
  }
  return out;
}
