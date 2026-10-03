import { closestPoint, pointAt, sampleQuad, subQuad, type ClosestPoint, type Polyline, type Quad } from './geometry';

export const LANE_WIDTH = 3.5;

export const RoadType = { Street: 0, Avenue: 1 } as const;
export type RoadType = (typeof RoadType)[keyof typeof RoadType];

export interface RoadSpec {
  /** Körfält per riktning. */
  lanes: number;
  /** Meter per sekund. */
  speed: number;
  /** Bredd från mittlinjen till vägkanten. */
  halfWidth: number;
  label: string;
}

export const ROAD_SPECS: readonly RoadSpec[] = [
  { lanes: 1, speed: 40 / 3.6, halfWidth: LANE_WIDTH, label: 'Gata' },
  { lanes: 2, speed: 60 / 3.6, halfWidth: 2 * LANE_WIDTH, label: 'Huvudled' },
];

export interface RoadNode {
  readonly id: number;
  x: number;
  z: number;
  /** Vägsträckor som börjar eller slutar här. */
  segs: number[];
}

export interface RoadSegment {
  readonly id: number;
  a: number;
  b: number;
  curve: Quad;
  type: RoadType;
  /** Byggordning. Delade vägar behåller sitt ursprungliga nummer (styr zonprioritet). */
  seq: number;
  poly: Polyline;
}

/** Vägnätet i ett format som kan skickas mellan trådar. */
export interface NetworkData {
  version: number;
  mapSize: number;
  nodeIds: Int32Array;
  nodeX: Float32Array;
  nodeZ: Float32Array;
  segIds: Int32Array;
  segA: Int32Array;
  segB: Int32Array;
  segCX: Float32Array;
  segCZ: Float32Array;
  segType: Uint8Array;
  segSeq: Int32Array;
}

export interface SegmentHit extends ClosestPoint {
  seg: number;
}

const BUCKET = 64;

/**
 * Redigerbart vägnät med stabila id:n. Id:n återanvänds aldrig, och Map-ordningen är
 * därmed alltid stigande id – simuleringens täta index bygger på den ordningen.
 * Används både av simuleringen (sanningen) och av huvudtråden (spegel för verktygen).
 */
export class RoadNetwork {
  readonly nodes = new Map<number, RoadNode>();
  readonly segments = new Map<number, RoadSegment>();
  version = 0;
  private nextNodeId = 0;
  private nextSegId = 0;
  private nextSeq = 0;
  private readonly buckets = new Map<number, number[]>();

  constructor(readonly mapSize: number) {}

  addNode(x: number, z: number, id = this.nextNodeId): number {
    this.nextNodeId = Math.max(this.nextNodeId, id + 1);
    this.nodes.set(id, { id, x, z, segs: [] });
    this.version++;
    return id;
  }

  /** Lägger till en vägsträcka. Kurvans ändpunkter sätts alltid till nodernas positioner. */
  addSegment(a: number, b: number, curve: Quad, type: RoadType, seq = this.nextSeq, id = this.nextSegId): number {
    const na = this.node(a);
    const nb = this.node(b);
    const c: Quad = { ax: na.x, az: na.z, cx: curve.cx, cz: curve.cz, bx: nb.x, bz: nb.z };
    this.nextSegId = Math.max(this.nextSegId, id + 1);
    this.nextSeq = Math.max(this.nextSeq, seq + 1);
    const seg: RoadSegment = { id, a, b, curve: c, type, seq, poly: sampleQuad(c) };
    this.segments.set(id, seg);
    na.segs.push(id);
    nb.segs.push(id);
    this.index(seg, true);
    this.version++;
    return id;
  }

  /** Tar bort en vägsträcka och korsningar som inte längre har några vägar. */
  removeSegment(id: number): void {
    const seg = this.segments.get(id);
    if (!seg) return;
    this.index(seg, false);
    this.segments.delete(id);
    for (const n of [seg.a, seg.b]) {
      const node = this.nodes.get(n);
      if (!node) continue;
      node.segs = node.segs.filter((s) => s !== id);
      if (node.segs.length === 0) this.nodes.delete(n);
    }
    this.version++;
  }

  /**
   * Delar en vägsträcka vid kurvparametrarna `ts` (stigande, mellan 0 och 1) och skapar
   * nya korsningar där. Returnerar de nya korsningarnas id i samma ordning som `ts`.
   */
  splitSegment(id: number, ts: number[]): number[] {
    const seg = this.segments.get(id);
    if (!seg) throw new Error(`Okänd vägsträcka ${id}`);
    const nodeIds = ts.map((t) => {
      const p = pointAt(seg.curve, t);
      return this.addNode(p.x, p.z);
    });
    const chain = [seg.a, ...nodeIds, seg.b];
    const params = [0, ...ts, 1];
    for (let i = 0; i + 1 < chain.length; i++) {
      this.addSegment(chain[i], chain[i + 1], subQuad(seg.curve, params[i], params[i + 1]), seg.type, seg.seq);
    }
    this.removeSegment(id);
    return nodeIds;
  }

  node(id: number): RoadNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Okänd korsning ${id}`);
    return n;
  }

  /** Bredaste vägen (halv bredd) som ansluter till korsningen, förutom `except`. */
  maxHalfWidthAt(nodeId: number, except = -1): number {
    let max = 0;
    for (const s of this.node(nodeId).segs) {
      if (s === except) continue;
      max = Math.max(max, ROAD_SPECS[this.segments.get(s)!.type].halfWidth);
    }
    return max;
  }

  /** Vägsträckor vars polylinje kan ligga inom rektangeln. */
  segmentsNear(minX: number, minZ: number, maxX: number, maxZ: number): number[] {
    const out = new Set<number>();
    const bx0 = Math.floor(minX / BUCKET);
    const bx1 = Math.floor(maxX / BUCKET);
    const bz0 = Math.floor(minZ / BUCKET);
    const bz1 = Math.floor(maxZ / BUCKET);
    for (let bx = bx0; bx <= bx1; bx++) {
      for (let bz = bz0; bz <= bz1; bz++) {
        const list = this.buckets.get(bucketKey(bx, bz));
        if (!list) continue;
        for (const s of list) {
          const p = this.segments.get(s)!.poly;
          if (p.maxX >= minX && p.minX <= maxX && p.maxZ >= minZ && p.minZ <= maxZ) out.add(s);
        }
      }
    }
    return [...out];
  }

  nearestNode(x: number, z: number, radius: number): RoadNode | null {
    let best: RoadNode | null = null;
    let bestDist = radius;
    for (const s of this.segmentsNear(x - radius, z - radius, x + radius, z + radius)) {
      const seg = this.segments.get(s)!;
      for (const n of [seg.a, seg.b]) {
        const node = this.nodes.get(n)!;
        const d = Math.hypot(node.x - x, node.z - z);
        if (d <= bestDist) {
          bestDist = d;
          best = node;
        }
      }
    }
    return best;
  }

  nearestSegment(x: number, z: number, radius: number): SegmentHit | null {
    let best: SegmentHit | null = null;
    for (const s of this.segmentsNear(x - radius, z - radius, x + radius, z + radius)) {
      const hit = closestPoint(this.segments.get(s)!.poly, x, z);
      if (hit.dist <= radius && (!best || hit.dist < best.dist)) best = { ...hit, seg: s };
    }
    return best;
  }

  toData(): NetworkData {
    const nodes = [...this.nodes.values()];
    const segs = [...this.segments.values()];
    return {
      version: this.version,
      mapSize: this.mapSize,
      nodeIds: Int32Array.from(nodes, (n) => n.id),
      nodeX: Float32Array.from(nodes, (n) => n.x),
      nodeZ: Float32Array.from(nodes, (n) => n.z),
      segIds: Int32Array.from(segs, (s) => s.id),
      segA: Int32Array.from(segs, (s) => s.a),
      segB: Int32Array.from(segs, (s) => s.b),
      segCX: Float32Array.from(segs, (s) => s.curve.cx),
      segCZ: Float32Array.from(segs, (s) => s.curve.cz),
      segType: Uint8Array.from(segs, (s) => s.type),
      segSeq: Int32Array.from(segs, (s) => s.seq),
    };
  }

  static fromData(d: NetworkData): RoadNetwork {
    const net = new RoadNetwork(d.mapSize);
    for (let i = 0; i < d.nodeIds.length; i++) net.addNode(d.nodeX[i], d.nodeZ[i], d.nodeIds[i]);
    for (let i = 0; i < d.segIds.length; i++) {
      const curve: Quad = { ax: 0, az: 0, cx: d.segCX[i], cz: d.segCZ[i], bx: 0, bz: 0 };
      net.addSegment(d.segA[i], d.segB[i], curve, d.segType[i] as RoadType, d.segSeq[i], d.segIds[i]);
    }
    net.version = d.version;
    return net;
  }

  private index(seg: RoadSegment, add: boolean): void {
    const p = seg.poly;
    for (let bx = Math.floor(p.minX / BUCKET); bx <= Math.floor(p.maxX / BUCKET); bx++) {
      for (let bz = Math.floor(p.minZ / BUCKET); bz <= Math.floor(p.maxZ / BUCKET); bz++) {
        const key = bucketKey(bx, bz);
        const list = this.buckets.get(key);
        if (add) {
          if (list) list.push(seg.id);
          else this.buckets.set(key, [seg.id]);
        } else if (list) {
          const i = list.indexOf(seg.id);
          if (i >= 0) list.splice(i, 1);
          if (list.length === 0) this.buckets.delete(key);
        }
      }
    }
  }
}

function bucketKey(bx: number, bz: number): number {
  return (bx + 1024) * 4096 + (bz + 1024);
}

/** Avstånd (meter) från korsningen där en vägs yta börjar, så att den inte går in i korsande vägar. */
export function trimAt(net: RoadNetwork, nodeId: number, segId: number): number {
  const node = net.node(nodeId);
  if (node.segs.length < 2) return 0;
  return net.maxHalfWidthAt(nodeId, segId) + 1;
}
