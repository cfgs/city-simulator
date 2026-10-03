import { atLength, distanceTo } from '../shared/geometry';
import type { CellData } from '../shared/protocol';
import { ROAD_SPECS, trimAt, type RoadNetwork, type RoadSegment } from '../shared/network';
import type { NetworkChange } from '../shared/roadplan';
import { CELL, DEAD_CELL, DEPTH, ZoneType } from '../shared/zones';

/** Cellmittpunkter närmare än så räknas som överlappande. */
const OVERLAP = 7;
/** Mellanrum mellan vägkanten och första cellraden. */
const ROAD_GAP = 0.5;
const HASH = 16;

/** Cellerna längs en vägsträcka: kolumner längs vägen × två sidor × DEPTH rader. */
interface SegCells {
  cols: number;
  /** Meter längs vägen där första kolumnen börjar. */
  s0: number;
  cells: Int32Array;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface RegenResult {
  /** Byggnader som förlorade någon av sina celler och ska rivas. */
  demolished: number[];
  /** Byggnader som står kvar, med sina nya cell-id:n. */
  moved: Map<number, number[]>;
}

/**
 * Zonceller längs vägarna, som i Cities: Skylines. Varje vägsträcka får celler på båda
 * sidor som följer kurvan. Celler som krockar med andra vägar eller med äldre celler
 * skapas inte, och celler bakom en blockerad cell skapas inte heller.
 *
 * När vägnätet ändras genereras cellerna om lokalt runt ändringen. Nya celler på samma
 * plats som gamla ärver zon och byggnad, så att t.ex. en ny korsning inte nollställer
 * kvarteren runt omkring.
 */
export class Zoning {
  x = new Float32Array(0);
  z = new Float32Array(0);
  dirX = new Float32Array(0);
  dirZ = new Float32Array(0);
  zone = new Uint8Array(0);
  seg = new Int32Array(0);
  col = new Int32Array(0);
  side = new Uint8Array(0);
  depth = new Uint8Array(0);
  building = new Int32Array(0);
  alive = new Uint8Array(0);
  /** Antal använda platser (högsta id + 1). */
  slots = 0;
  aliveCount = 0;
  private free: number[] = [];
  readonly bySeg = new Map<number, SegCells>();
  private readonly hash = new Map<number, number[]>();
  /** Celler där en byggnad kan växa upp: zonade, i första raden mot vägen och utan byggnad. */
  readonly candidates = new Set<number>();

  constructor(readonly mapSize: number) {}

  regenerate(net: RoadNetwork, change: NetworkChange, cellCountOf: (building: number) => number): RegenResult {
    const reach = DEPTH * CELL + ROAD_SPECS[ROAD_SPECS.length - 1].halfWidth + 4;
    const box = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    const extend = (minX: number, minZ: number, maxX: number, maxZ: number) => {
      box.minX = Math.min(box.minX, minX);
      box.minZ = Math.min(box.minZ, minZ);
      box.maxX = Math.max(box.maxX, maxX);
      box.maxZ = Math.max(box.maxZ, maxZ);
    };
    for (const id of change.removed) {
      const sc = this.bySeg.get(id);
      if (sc) extend(sc.minX, sc.minZ, sc.maxX, sc.maxZ);
    }
    for (const id of change.added) {
      const p = net.segments.get(id)?.poly;
      if (p) extend(p.minX - reach, p.minZ - reach, p.maxX + reach, p.maxZ + reach);
    }
    if (box.minX === Infinity) return { demolished: [], moved: new Map() };

    // Alla vägar vars celler kan påverkas av ändringen
    const affected = new Set(net.segmentsNear(box.minX - reach, box.minZ - reach, box.maxX + reach, box.maxZ + reach));
    for (const id of change.added) if (net.segments.has(id)) affected.add(id);

    // Gamla celler: ta bort ur rumsindexet men behåll datan tills de nya har ärvt från dem
    const old: number[] = [];
    for (const id of [...change.removed, ...affected]) {
      const sc = this.bySeg.get(id);
      if (!sc) continue;
      for (const c of sc.cells) {
        if (c < 0) continue;
        this.unhash(c);
        old.push(c);
      }
      this.bySeg.delete(id);
    }
    const oldIndex = new Map<number, number[]>();
    const touched = new Set<number>();
    for (const c of old) {
      const key = cellKey(Math.floor(this.x[c] / 4), Math.floor(this.z[c] / 4));
      oldIndex.set(key, [...(oldIndex.get(key) ?? []), c]);
      if (this.building[c] >= 0) touched.add(this.building[c]);
    }
    const usedOld = new Set<number>();
    const buildingCells = new Map<number, number[]>();
    const inherit = (c: number) => {
      const o = this.findOld(oldIndex, usedOld, c);
      if (o < 0) return;
      usedOld.add(o);
      this.zone[c] = this.zone[o];
      const b = this.building[o];
      if (b >= 0) {
        this.building[c] = b;
        buildingCells.set(b, [...(buildingCells.get(b) ?? []), c]);
      }
    };

    // Äldst väg först – den har företräde när celler krockar
    const order = [...affected].map((id) => net.segments.get(id)!).sort((a, b) => a.seq - b.seq || a.id - b.id);
    for (const seg of order) this.generate(net, seg, inherit);
    for (const c of old) this.release(c);

    const demolished: number[] = [];
    const moved = new Map<number, number[]>();
    for (const b of touched) {
      const cells = buildingCells.get(b) ?? [];
      if (cells.length === cellCountOf(b)) {
        moved.set(b, cells);
        continue;
      }
      demolished.push(b);
      for (const c of cells) this.building[c] = -1;
    }
    for (const seg of order) {
      for (const c of this.bySeg.get(seg.id)!.cells) if (c >= 0) this.updateCandidate(c);
    }
    return { demolished, moved };
  }

  /** Sätter zon på alla celler inom radien. Byggnader på celler som byter zon rivs. */
  paint(x: number, z: number, radius: number, zone: ZoneType): { changed: number[]; demolish: number[] } {
    const changed: number[] = [];
    const demolish = new Set<number>();
    for (const c of this.cellsNear(x, z, radius)) {
      if (this.zone[c] === zone) continue;
      this.zone[c] = zone;
      changed.push(c);
      if (this.building[c] >= 0) demolish.add(this.building[c]);
      this.updateCandidate(c);
    }
    return { changed, demolish: [...demolish] };
  }

  /** Sätter zon direkt på en cell (används av demostaden). */
  setZone(c: number, zone: ZoneType): void {
    this.zone[c] = zone;
    this.updateCandidate(c);
  }

  cellsNear(x: number, z: number, radius: number): number[] {
    const out: number[] = [];
    const r2 = radius * radius;
    for (let bx = Math.floor((x - radius) / HASH); bx <= Math.floor((x + radius) / HASH); bx++) {
      for (let bz = Math.floor((z - radius) / HASH); bz <= Math.floor((z + radius) / HASH); bz++) {
        for (const c of this.hash.get(cellKey(bx, bz)) ?? []) {
          const dx = this.x[c] - x;
          const dz = this.z[c] - z;
          if (dx * dx + dz * dz <= r2) out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Största tomten med samma zon från en cell i första raden: 1–2 kolumner bred och
   * 1–DEPTH rader djup, bara celler utan byggnad.
   */
  lotFrom(cell: number): number[] {
    const sc = this.bySeg.get(this.seg[cell])!;
    const side = this.side[cell];
    const col = this.col[cell];
    const zone = this.zone[cell];
    const at = (c: number, d: number) => (c < sc.cols ? sc.cells[(side * sc.cols + c) * DEPTH + d] : -1);
    const free = (c: number) => c >= 0 && this.zone[c] === zone && this.building[c] < 0;
    const cols = free(at(col + 1, 0)) ? [col, col + 1] : [col];
    const out: number[] = [];
    for (let d = 0; d < DEPTH; d++) {
      const row = cols.map((c) => at(c, d));
      if (!row.every(free)) break;
      out.push(...row);
    }
    return out;
  }

  setBuilding(cells: number[], building: number): void {
    for (const c of cells) {
      this.building[c] = building;
      this.candidates.delete(c);
    }
  }

  clearBuilding(cells: number[]): void {
    for (const c of cells) {
      if (!this.alive[c]) continue;
      this.building[c] = -1;
      this.updateCandidate(c);
    }
  }

  /** Korsningen som resor till och från cellen går via (närmaste änden av vägsträckan). */
  accessNode(net: RoadNetwork, cell: number): number {
    const seg = net.segments.get(this.seg[cell])!;
    const sc = this.bySeg.get(seg.id)!;
    const s = sc.s0 + (this.col[cell] + 0.5) * CELL;
    return s < seg.poly.length / 2 ? seg.a : seg.b;
  }

  /** Kopia av alla cellplatser för renderingen. */
  data(): CellData {
    const n = this.slots;
    const zone = this.zone.slice(0, n);
    for (let c = 0; c < n; c++) if (!this.alive[c]) zone[c] = DEAD_CELL;
    return {
      slots: n,
      x: this.x.slice(0, n),
      z: this.z.slice(0, n),
      dirX: this.dirX.slice(0, n),
      dirZ: this.dirZ.slice(0, n),
      zone,
    };
  }

  private generate(net: RoadNetwork, seg: RoadSegment, onCell: (c: number) => void): void {
    const halfWidth = ROAD_SPECS[seg.type].halfWidth;
    const poly = seg.poly;
    const trimA = trimAt(net, seg.a, seg.id);
    const trimB = trimAt(net, seg.b, seg.id);
    const usable = poly.length - trimA - trimB;
    const cols = Math.max(0, Math.floor(usable / CELL + 1e-6));
    const sc: SegCells = {
      cols,
      s0: trimA + (usable - cols * CELL) / 2,
      cells: new Int32Array(cols * 2 * DEPTH).fill(-1),
      minX: poly.minX,
      minZ: poly.minZ,
      maxX: poly.maxX,
      maxZ: poly.maxZ,
    };
    this.bySeg.set(seg.id, sc);
    const margin = CELL / 2;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      for (let col = 0; col < cols; col++) {
        const p = atLength(poly, sc.s0 + (col + 0.5) * CELL);
        const nx = -p.tz * sign;
        const nz = p.tx * sign;
        for (let d = 0; d < DEPTH; d++) {
          const offset = halfWidth + ROAD_GAP + (d + 0.5) * CELL;
          const x = p.x + nx * offset;
          const z = p.z + nz * offset;
          if (x < margin || z < margin || x > this.mapSize - margin || z > this.mapSize - margin) break;
          if (this.overlaps(x, z) || this.nearRoad(net, x, z)) break;
          const c = this.alloc(x, z, p.tx, p.tz, seg.id, side, col, d);
          sc.cells[(side * cols + col) * DEPTH + d] = c;
          sc.minX = Math.min(sc.minX, x - CELL);
          sc.minZ = Math.min(sc.minZ, z - CELL);
          sc.maxX = Math.max(sc.maxX, x + CELL);
          sc.maxZ = Math.max(sc.maxZ, z + CELL);
          onCell(c);
        }
      }
    }
  }

  private overlaps(x: number, z: number): boolean {
    const bx = Math.floor(x / HASH);
    const bz = Math.floor(z / HASH);
    for (let i = bx - 1; i <= bx + 1; i++) {
      for (let j = bz - 1; j <= bz + 1; j++) {
        for (const c of this.hash.get(cellKey(i, j)) ?? []) {
          if (Math.abs(this.x[c] - x) < OVERLAP && Math.abs(this.z[c] - z) < OVERLAP && Math.hypot(this.x[c] - x, this.z[c] - z) < OVERLAP) return true;
        }
      }
    }
    return false;
  }

  /** Ligger cellen (helt eller delvis) på någon väg? */
  private nearRoad(net: RoadNetwork, x: number, z: number): boolean {
    const reach = ROAD_SPECS[ROAD_SPECS.length - 1].halfWidth + CELL;
    for (const id of net.segmentsNear(x - reach, z - reach, x + reach, z + reach)) {
      const seg = net.segments.get(id)!;
      const limit = ROAD_SPECS[seg.type].halfWidth + CELL / 2 + ROAD_GAP - 0.1;
      const p = seg.poly;
      if (x < p.minX - limit || x > p.maxX + limit || z < p.minZ - limit || z > p.maxZ + limit) continue;
      if (distanceTo(p, x, z) < limit) return true;
    }
    return false;
  }

  /**
   * Hittar den gamla cell som bäst motsvarar den nya: samma riktning, samma avstånd från
   * vägen och högst en halv cell förskjuten längs vägen. När en väg delas flyttas
   * kolumnerna lite, och då ska zonerna ändå följa med.
   */
  private findOld(index: Map<number, number[]>, used: Set<number>, c: number): number {
    const x = this.x[c];
    const z = this.z[c];
    const dx = this.dirX[c];
    const dz = this.dirZ[c];
    const bx = Math.floor(x / 4);
    const bz = Math.floor(z / 4);
    let best = -1;
    let bestAlong = CELL / 2 + 0.5;
    for (let i = bx - 2; i <= bx + 2; i++) {
      for (let j = bz - 2; j <= bz + 2; j++) {
        for (const o of index.get(cellKey(i, j)) ?? []) {
          if (used.has(o)) continue;
          if (Math.abs(this.dirX[o] * dx + this.dirZ[o] * dz) < 0.95) continue;
          const ox = this.x[o] - x;
          const oz = this.z[o] - z;
          const along = Math.abs(ox * dx + oz * dz);
          const across = Math.abs(ox * dz - oz * dx);
          if (across < 1.5 && along < bestAlong) {
            best = o;
            bestAlong = along;
          }
        }
      }
    }
    return best;
  }

  private alloc(x: number, z: number, dx: number, dz: number, seg: number, side: number, col: number, depth: number): number {
    const c = this.free.length > 0 ? this.free.pop()! : this.slots++;
    if (c >= this.alive.length) this.grow(Math.max(1024, this.alive.length * 2));
    this.x[c] = x;
    this.z[c] = z;
    this.dirX[c] = dx;
    this.dirZ[c] = dz;
    this.seg[c] = seg;
    this.side[c] = side;
    this.col[c] = col;
    this.depth[c] = depth;
    this.zone[c] = ZoneType.None;
    this.building[c] = -1;
    this.alive[c] = 1;
    this.aliveCount++;
    const key = cellKey(Math.floor(x / HASH), Math.floor(z / HASH));
    const list = this.hash.get(key);
    if (list) list.push(c);
    else this.hash.set(key, [c]);
    return c;
  }

  private release(c: number): void {
    this.alive[c] = 0;
    this.aliveCount--;
    this.candidates.delete(c);
    this.free.push(c);
  }

  private unhash(c: number): void {
    const key = cellKey(Math.floor(this.x[c] / HASH), Math.floor(this.z[c] / HASH));
    const list = this.hash.get(key);
    if (!list) return;
    const i = list.indexOf(c);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.hash.delete(key);
  }

  private updateCandidate(c: number): void {
    if (this.alive[c] && this.depth[c] === 0 && this.zone[c] !== ZoneType.None && this.building[c] < 0) this.candidates.add(c);
    else this.candidates.delete(c);
  }

  private grow(n: number): void {
    const copy = <T extends Float32Array | Int32Array | Uint8Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      b.set(a);
      return b;
    };
    this.x = copy(this.x);
    this.z = copy(this.z);
    this.dirX = copy(this.dirX);
    this.dirZ = copy(this.dirZ);
    this.zone = copy(this.zone);
    this.seg = copy(this.seg);
    this.col = copy(this.col);
    this.side = copy(this.side);
    this.depth = copy(this.depth);
    this.building = copy(this.building);
    this.alive = copy(this.alive);
  }
}

function cellKey(bx: number, bz: number): number {
  return (bx + 1024) * 8192 + (bz + 1024);
}
