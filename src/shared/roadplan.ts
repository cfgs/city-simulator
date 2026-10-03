import {
  angleBetween,
  closestPoint,
  crossings,
  distanceTo,
  minRadius,
  sampleQuad,
  subQuad,
  tangentAt,
  type Point,
  type Polyline,
  type Quad,
} from './geometry';
import { ROAD_SPECS, type RoadNetwork, type RoadType } from './network';

/**
 * Vägplaneraren: tar en önskad väg (en eller flera sammanhängande kurvor) och räknar ut
 * hur den passar in i vägnätet – var den fäster, var nya korsningar uppstår och om den
 * är tillåten. Samma kod körs i huvudtråden (förhandsvisning) och i simuleringen
 * (det som faktiskt byggs), så det man ser är det man får.
 */

/** Rutnätets steg i meter när fästning mot rutnät är på (samma som zoncellernas storlek). */
export const GRID_STEP = 8;
export const SNAP_NODE = 10;
export const SNAP_SEGMENT = 8;
/** Kortaste tillåtna vägsträcka – och närmaste avstånd mellan två korsningar. */
export const MIN_SEGMENT = 12;
export const MIN_ANGLE = (25 * Math.PI) / 180;
export const MIN_RADIUS = 14;
/** Runt korsningar är det tillåtet att vägar ligger nära varandra. */
const JUNCTION_CLEARANCE = 22;
const MAP_MARGIN = 8;

export type StopRef = { kind: 'node'; node: number } | { kind: 'split'; seg: number; t: number } | { kind: 'new' };

export interface Snapped {
  x: number;
  z: number;
  ref: StopRef;
}

export interface PlanStop {
  /** Kurvparameter längs den nya vägen. */
  t: number;
  x: number;
  z: number;
  ref: StopRef;
}

export interface PlannedCurve {
  curve: Quad;
  /** Ändpunkter och korsningar längs kurvan, sorterade efter t. */
  stops: PlanStop[];
}

export interface RoadPlan {
  valid: boolean;
  reason: string;
  type: RoadType;
  curves: PlannedCurve[];
}

export interface NetworkChange {
  added: number[];
  removed: number[];
}

/** Fäster en punkt mot befintlig korsning, befintlig väg eller (valfritt) rutnätet. */
export function snapPoint(net: RoadNetwork, x: number, z: number, grid: boolean): Snapped {
  const node = net.nearestNode(x, z, SNAP_NODE);
  if (node) return { x: node.x, z: node.z, ref: { kind: 'node', node: node.id } };
  const hit = net.nearestSegment(x, z, SNAP_SEGMENT);
  if (hit) {
    const seg = net.segments.get(hit.seg)!;
    if (hit.s < MIN_SEGMENT) return nodeSnap(net, seg.a);
    if (seg.poly.length - hit.s < MIN_SEGMENT) return nodeSnap(net, seg.b);
    return { x: hit.x, z: hit.z, ref: { kind: 'split', seg: hit.seg, t: hit.t } };
  }
  if (grid) return { x: Math.round(x / GRID_STEP) * GRID_STEP, z: Math.round(z / GRID_STEP) * GRID_STEP, ref: { kind: 'new' } };
  return { x, z, ref: { kind: 'new' } };
}

function nodeSnap(net: RoadNetwork, id: number): Snapped {
  const n = net.node(id);
  return { x: n.x, z: n.z, ref: { kind: 'node', node: id } };
}

export function planRoad(net: RoadNetwork, input: Quad[], type: RoadType): RoadPlan {
  const fail = (reason: string): RoadPlan => ({ valid: false, reason, type, curves: input.map((c) => ({ curve: c, stops: [] })) });
  if (input.length === 0) return fail('Ingen väg');
  const spec = ROAD_SPECS[type];

  const curves = input.map((c) => ({ ...c }));
  const first = curves[0];
  const last = curves[curves.length - 1];
  const start = snapPoint(net, first.ax, first.az, false);
  const end = snapPoint(net, last.bx, last.bz, false);
  first.ax = start.x;
  first.az = start.z;
  last.bx = end.x;
  last.bz = end.z;
  if (curves.length === 1 && sameRef(start.ref, end.ref) && start.ref.kind !== 'new') return fail('Vägen börjar och slutar på samma ställe');

  const polys = curves.map((c) => sampleQuad(c));
  for (const poly of polys) {
    if (poly.length < MIN_SEGMENT) return fail('För kort väg');
    if (minRadius(poly) < MIN_RADIUS) return fail('För skarp kurva');
    if (poly.minX < MAP_MARGIN || poly.minZ < MAP_MARGIN || poly.maxX > net.mapSize - MAP_MARGIN || poly.maxZ > net.mapSize - MAP_MARGIN) {
      return fail('Utanför kartan');
    }
  }
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 2; j < polys.length; j++) {
      if (crossings(polys[i], polys[j]).length > 0) return fail('Vägen korsar sig själv');
    }
    if (i + 1 < curves.length) {
      const out = tangentAt(curves[i], 1);
      const into = tangentAt(curves[i + 1], 0);
      if (angleBetween(-out.x, -out.z, into.x, into.z) < MIN_ANGLE) return fail('För skarp kurva');
    }
  }

  const planned: PlannedCurve[] = [];
  for (let i = 0; i < curves.length; i++) {
    const curve = curves[i];
    const poly = polys[i];
    const stops: PlanStop[] = [
      { t: 0, x: curve.ax, z: curve.az, ref: i === 0 ? start.ref : { kind: 'new' } },
      { t: 1, x: curve.bx, z: curve.bz, ref: i === curves.length - 1 ? end.ref : { kind: 'new' } },
    ];
    // Korsningar som vägen passerar nära dras vägen genom, i stället för att skapa nya
    // korsningar strax intill (som skulle ge väldigt korta sträckor och spetsiga vinklar).
    const passed = passedJunctions(net, poly, stops);
    for (const p of passed) stops.push(nodeStop(net, p.node, p.t));
    for (const segId of net.segmentsNear(poly.minX - 1, poly.minZ - 1, poly.maxX + 1, poly.maxZ + 1)) {
      const seg = net.segments.get(segId)!;
      for (const hit of crossings(poly, seg.poly)) {
        // Träffar precis vid våra ändpunkter är redan hanterade av fästningen.
        if (touchesEnd(hit, stops[0], seg) || touchesEnd(hit, stops[1], seg)) continue;
        // ... och träffar runt en korsning vi passerar genom ersätts av korsningen.
        if (passed.some((p) => (seg.a === p.node || seg.b === p.node) && Math.hypot(hit.x - p.x, hit.z - p.z) < 2 * MIN_SEGMENT)) continue;
        const ta = tangentAt(curve, hit.ta);
        const tb = tangentAt(seg.curve, hit.tb);
        if (acuteAngle(ta, tb) < MIN_ANGLE) return fail('För spetsig vinkel mot en annan väg');
        const along = closestPoint(seg.poly, hit.x, hit.z).s;
        if (along < MIN_SEGMENT) stops.push(nodeStop(net, seg.a, hit.ta));
        else if (seg.poly.length - along < MIN_SEGMENT) stops.push(nodeStop(net, seg.b, hit.ta));
        else stops.push({ t: hit.ta, x: hit.x, z: hit.z, ref: { kind: 'split', seg: segId, t: hit.tb } });
      }
    }
    stops.sort((a, b) => a.t - b.t);
    planned.push({ curve, stops: mergeStops(stops) });
  }

  // Resten av kontrollerna görs på exakt de sträckor som kommer att byggas: där vägen
  // fäster mot en befintlig korsning flyttas sträckans ände dit.
  const pieces: Piece[] = [];
  for (const { curve, stops } of planned) {
    for (let k = 0; k + 1 < stops.length; k++) {
      if (sameStop(stops[k], stops[k + 1])) continue;
      const q = piece(curve, stops[k], stops[k + 1]);
      pieces.push({ from: stops[k], to: stops[k + 1], q, poly: sampleQuad(q) });
    }
  }
  for (const p of pieces) {
    if (p.poly.length < MIN_SEGMENT) return fail('För tätt mellan korsningar');
    if (minRadius(p.poly) < MIN_RADIUS) return fail('För skarp kurva');
  }
  const splitProblem = checkSplits(net, planned);
  if (splitProblem) return fail(splitProblem);
  const angleProblem = checkJunctionAngles(net, pieces);
  if (angleProblem) return fail(angleProblem);
  if (tooCloseToOtherRoads(net, pieces, spec.halfWidth)) return fail('För nära en annan väg');

  return { valid: true, reason: '', type, curves: planned };
}

interface Piece {
  from: PlanStop;
  to: PlanStop;
  q: Quad;
  poly: Polyline;
}

/**
 * Delsträckan mellan två stopp, med ändarna där korsningarna faktiskt hamnar. Kontrollpunkten
 * flyttas med lika mycket som ändarna i snitt, så att en rak väg förblir rak.
 */
function piece(curve: Quad, from: PlanStop, to: PlanStop): Quad {
  const q = subQuad(curve, from.t, to.t);
  return {
    ax: from.x,
    az: from.z,
    cx: q.cx + (from.x - q.ax + to.x - q.bx) / 2,
    cz: q.cz + (from.z - q.az + to.z - q.bz) / 2,
    bx: to.x,
    bz: to.z,
  };
}

function sameStop(a: PlanStop, b: PlanStop): boolean {
  if (a.ref.kind === 'node' && b.ref.kind === 'node') return a.ref.node === b.ref.node;
  return Math.hypot(a.x - b.x, a.z - b.z) < 0.5;
}

/** Bygger en godkänd plan: delar befintliga vägar och lägger till de nya sträckorna. */
export function applyPlan(net: RoadNetwork, plan: RoadPlan): NetworkChange {
  const removed: number[] = [];
  const before = new Set(net.segments.keys());

  // 1. Dela befintliga vägar där den nya vägen ansluter eller korsar.
  //    Delningar närmare än en meter från varandra blir samma korsning.
  const splitTs = new Map<number, number[]>();
  for (const { stops } of plan.curves) {
    for (const { ref } of stops) {
      if (ref.kind === 'split') splitTs.set(ref.seg, [...(splitTs.get(ref.seg) ?? []), ref.t]);
    }
  }
  const splitNodes = new Map<string, number>();
  for (const [segId, ts] of splitTs) {
    const length = net.segments.get(segId)!.poly.length;
    ts.sort((a, b) => a - b);
    const unique: number[] = [];
    const alias = new Map<number, number>();
    for (const t of ts) {
      const last = unique[unique.length - 1];
      if (last !== undefined && (t - last) * length < 1) alias.set(t, last);
      else {
        unique.push(t);
        alias.set(t, t);
      }
    }
    const ids = net.splitSegment(segId, unique);
    const nodeOf = new Map(unique.map((t, i) => [t, ids[i]]));
    for (const t of ts) splitNodes.set(splitKey(segId, t), nodeOf.get(alias.get(t)!)!);
    removed.push(segId);
  }

  // 2. Korsningar för alla stopp (nya punkter på samma plats delar korsning)
  const used: { id: number; x: number; z: number }[] = [];
  const resolve = (stop: PlanStop): number => {
    let id: number;
    if (stop.ref.kind === 'node') id = stop.ref.node;
    else if (stop.ref.kind === 'split') id = splitNodes.get(splitKey(stop.ref.seg, stop.ref.t))!;
    else {
      const near = used.find((u) => Math.hypot(u.x - stop.x, u.z - stop.z) < 1.5);
      id = near ? near.id : net.addNode(stop.x, stop.z);
    }
    const n = net.node(id);
    used.push({ id, x: n.x, z: n.z });
    return id;
  };

  // 3. Nya vägsträckor mellan stoppen
  for (const { curve, stops } of plan.curves) {
    const ids = stops.map(resolve);
    for (let i = 0; i + 1 < stops.length; i++) {
      if (ids[i] === ids[i + 1]) continue;
      net.addSegment(ids[i], ids[i + 1], piece(curve, stops[i], stops[i + 1]), plan.type);
    }
  }

  const added = [...net.segments.keys()].filter((id) => !before.has(id));
  return { added, removed };
}

function splitKey(seg: number, t: number): string {
  return `${seg}:${t.toFixed(6)}`;
}

function sameRef(a: StopRef, b: StopRef): boolean {
  if (a.kind === 'node' && b.kind === 'node') return a.node === b.node;
  if (a.kind === 'split' && b.kind === 'split') return a.seg === b.seg && Math.abs(a.t - b.t) < 1e-3;
  return false;
}

function touchesEnd(hit: Point, stop: PlanStop, seg: { id: number; a: number; b: number }): boolean {
  if (Math.hypot(hit.x - stop.x, hit.z - stop.z) > 3) return false;
  const r = stop.ref;
  return (r.kind === 'split' && r.seg === seg.id) || (r.kind === 'node' && (r.node === seg.a || r.node === seg.b));
}

/** Befintliga korsningar som kurvan passerar närmare än MIN_SEGMENT (utom vid ändpunkterna). */
function passedJunctions(net: RoadNetwork, poly: Polyline, ends: PlanStop[]): { node: number; t: number; x: number; z: number }[] {
  const out: { node: number; t: number; x: number; z: number }[] = [];
  const seen = new Set<number>();
  for (const segId of net.segmentsNear(poly.minX - MIN_SEGMENT, poly.minZ - MIN_SEGMENT, poly.maxX + MIN_SEGMENT, poly.maxZ + MIN_SEGMENT)) {
    const seg = net.segments.get(segId)!;
    for (const id of [seg.a, seg.b]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const n = net.node(id);
      if (ends.some((e) => (e.ref.kind === 'node' && e.ref.node === id) || Math.hypot(e.x - n.x, e.z - n.z) < 2 * MIN_SEGMENT)) continue;
      const hit = closestPoint(poly, n.x, n.z);
      if (hit.dist < MIN_SEGMENT) out.push({ node: id, t: hit.t, x: n.x, z: n.z });
    }
  }
  return out;
}

function nodeStop(net: RoadNetwork, id: number, t: number): PlanStop {
  const n = net.node(id);
  return { t, x: n.x, z: n.z, ref: { kind: 'node', node: id } };
}

/** Slår ihop stopp som hamnat på samma ställe (t.ex. två träffar vid samma korsning). */
function mergeStops(stops: PlanStop[]): PlanStop[] {
  const out: PlanStop[] = [];
  for (const s of stops) {
    const prev = out[out.length - 1];
    const same =
      prev !== undefined &&
      (Math.hypot(prev.x - s.x, prev.z - s.z) < 1 || (prev.ref.kind === 'node' && s.ref.kind === 'node' && prev.ref.node === s.ref.node));
    if (!same) {
      out.push(s);
      continue;
    }
    // Föredra befintliga korsningar, men behåll vägens ändpunkter på t = 0 och 1.
    const keep = rank(s.ref) > rank(prev.ref) ? s : prev;
    out[out.length - 1] = { ...keep, t: prev.t === 0 ? 0 : s.t === 1 ? 1 : keep.t };
  }
  return out;
}

function rank(ref: StopRef): number {
  return ref.kind === 'node' ? 2 : ref.kind === 'split' ? 1 : 0;
}

function acuteAngle(a: Point, b: Point): number {
  const angle = angleBetween(a.x, a.z, b.x, b.z);
  return Math.min(angle, Math.PI - angle);
}

/** Flera delningar av samma befintliga väg måste ligga minst en sträcka isär. */
function checkSplits(net: RoadNetwork, curves: PlannedCurve[]): string | null {
  const bySeg = new Map<number, number[]>();
  for (const { stops } of curves) {
    for (const s of stops) {
      if (s.ref.kind !== 'split') continue;
      const seg = net.segments.get(s.ref.seg)!;
      const list = bySeg.get(seg.id) ?? [];
      list.push(closestPoint(seg.poly, s.x, s.z).s);
      bySeg.set(seg.id, list);
    }
  }
  for (const list of bySeg.values()) {
    list.sort((a, b) => a - b);
    for (let i = 0; i + 1 < list.length; i++) {
      if (list[i + 1] - list[i] > 0.5 && list[i + 1] - list[i] < MIN_SEGMENT) return 'För tätt mellan korsningar';
    }
  }
  return null;
}

/** Vinklarna mellan den nya vägen och befintliga vägar där de möts. */
function checkJunctionAngles(net: RoadNetwork, pieces: Piece[]): string | null {
  for (const p of pieces) {
    const out = tangentAt(p.q, 0);
    const into = tangentAt(p.q, 1);
    const ends: [PlanStop, Point][] = [
      [p.from, out],
      [p.to, { x: -into.x, z: -into.z }],
    ];
    for (const [stop, dir] of ends) {
      for (const e of existingDirections(net, stop)) {
        if (angleBetween(dir.x, dir.z, e.x, e.z) < MIN_ANGLE) return 'För spetsig vinkel i korsningen';
      }
    }
  }
  return null;
}

/** Riktningarna ut från stoppet längs de befintliga vägar som möts där. */
function existingDirections(net: RoadNetwork, stop: PlanStop): Point[] {
  const out: Point[] = [];
  if (stop.ref.kind === 'node') {
    const node = net.node(stop.ref.node);
    for (const s of node.segs) {
      const seg = net.segments.get(s)!;
      if (seg.a === node.id) out.push(tangentAt(seg.curve, 0));
      if (seg.b === node.id) {
        const t = tangentAt(seg.curve, 1);
        out.push({ x: -t.x, z: -t.z });
      }
    }
  } else if (stop.ref.kind === 'split') {
    const t = tangentAt(net.segments.get(stop.ref.seg)!.curve, stop.ref.t);
    out.push(t, { x: -t.x, z: -t.z });
  }
  return out;
}

/** Vägen får inte gå parallellt med eller tätt intill en annan väg utanför korsningarna. */
function tooCloseToOtherRoads(net: RoadNetwork, pieces: Piece[], halfWidth: number): boolean {
  const stops = pieces.flatMap((p) => [p.from, p.to]);
  const reach = halfWidth + ROAD_SPECS[ROAD_SPECS.length - 1].halfWidth + 1;
  for (const { poly } of pieces) {
    const n = Math.max(1, Math.ceil(poly.length / 3));
    for (let i = 0; i <= n; i++) {
      const idx = Math.round((i / n) * (poly.ts.length - 1));
      const x = poly.pts[idx * 2];
      const z = poly.pts[idx * 2 + 1];
      if (stops.some((s) => Math.hypot(s.x - x, s.z - z) < JUNCTION_CLEARANCE)) continue;
      for (const segId of net.segmentsNear(x - reach, z - reach, x + reach, z + reach)) {
        const seg = net.segments.get(segId)!;
        if (distanceTo(seg.poly, x, z) < halfWidth + ROAD_SPECS[seg.type].halfWidth + 1) return true;
      }
    }
  }
  return false;
}
