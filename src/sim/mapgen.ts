import type { SimConfig } from '../shared/config';
import { mulberry32, valueNoise, type Rng } from '../shared/rng';
import { buildGraph, type EdgeSpec, type RoadGraph } from './graph';

export const Zone = { Residential: 0, Commercial: 1, Industrial: 2 } as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

export interface Buildings {
  count: number;
  x: Float32Array;
  z: Float32Array;
  zone: Uint8Array;
  /** Invånare (bostäder) eller arbetsplatser (handel/industri). */
  capacity: Int32Array;
  height: Float32Array;
  /** Korsningen där resor till och från byggnaden börjar och slutar. */
  accessNode: Int32Array;
}

export interface World {
  /** Kartans sida i meter. */
  size: number;
  tileSize: number;
  graph: RoadGraph;
  buildings: Buildings;
}

const ARTERIAL_SPEED = 60 / 3.6;
const LOCAL_SPEED = 40 / 3.6;
/** Andel lokalgator som tas bort för att få oregelbundna kvarter. */
const REMOVE_LOCAL_SEGMENT = 0.12;
/** Hur många rutor in från vägen som bebyggs. */
const BUILDING_DEPTH = 2;
const JOBS_PER_WORKER = 1.05;

/**
 * Slumpar fram en stad för prestandatestet: ett oregelbundet rutnät av gator och
 * huvudleder, byggnader längs gatorna och zoner som beror på avstånd till centrum.
 * Samma seed ger alltid samma stad.
 */
export function generateWorld(config: SimConfig): World {
  const rng = mulberry32(config.seed);
  const G = config.gridSize;
  const T = config.tileSize;
  const xs = roadLines(rng, G);
  const zs = roadLines(rng, G);
  const nx = xs.length;
  const gridCount = nx * zs.length;
  const tileXOf = (gridNode: number) => xs[gridNode % nx];
  const tileZOf = (gridNode: number) => zs[Math.floor(gridNode / nx)];

  // 1. Vägsegment mellan grannkorsningar (odirigerade, i rutnätsindex)
  const segA: number[] = [];
  const segB: number[] = [];
  const segArterial: boolean[] = [];
  const addSegment = (a: number, b: number, arterial: boolean) => {
    if (!arterial && rng() < REMOVE_LOCAL_SEGMENT) return;
    segA.push(a);
    segB.push(b);
    segArterial.push(arterial);
  };
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < nx; i++) {
      const n = j * nx + i;
      if (i + 1 < nx) addSegment(n, n + 1, isArterial(j));
      if (j + 1 < zs.length) addSegment(n, n + nx, isArterial(i));
    }
  }

  // 2. Behåll största sammanhängande delen av nätet och bygg grafen
  const keep = largestComponent(gridCount, segA, segB);
  const nodeOfGrid = new Int32Array(gridCount).fill(-1);
  const nodeX: number[] = [];
  const nodeZ: number[] = [];
  for (let n = 0; n < gridCount; n++) {
    if (!keep[n]) continue;
    nodeOfGrid[n] = nodeX.length;
    nodeX.push((tileXOf(n) + 0.5) * T);
    nodeZ.push((tileZOf(n) + 0.5) * T);
  }
  const edges: EdgeSpec[] = [];
  const keptSegments: number[] = [];
  for (let s = 0; s < segA.length; s++) {
    const a = nodeOfGrid[segA[s]];
    const b = nodeOfGrid[segB[s]];
    if (a < 0 || b < 0) continue;
    const lanes = segArterial[s] ? 2 : 1;
    const speed = segArterial[s] ? ARTERIAL_SPEED : LOCAL_SPEED;
    edges.push({ from: a, to: b, lanes, speed }, { from: b, to: a, lanes, speed });
    keptSegments.push(s);
  }
  const graph = buildGraph(nodeX, nodeZ, edges);

  // 3. Vägrutor: varje ruta längs ett segment ansluter till närmaste korsning
  const access = new Int32Array(G * G).fill(-1);
  const depth = new Int8Array(G * G).fill(-1);
  const queue = new Int32Array(G * G);
  let queueEnd = 0;
  for (const s of keptSegments) {
    const ax = tileXOf(segA[s]);
    const az = tileZOf(segA[s]);
    const bx = tileXOf(segB[s]);
    const bz = tileZOf(segB[s]);
    const len = Math.abs(bx - ax) + Math.abs(bz - az);
    const sx = Math.sign(bx - ax);
    const sz = Math.sign(bz - az);
    for (let t = 0; t <= len; t++) {
      const tile = (az + sz * t) * G + (ax + sx * t);
      if (depth[tile] !== 0) {
        depth[tile] = 0;
        queue[queueEnd++] = tile;
      }
      access[tile] = nodeOfGrid[t <= len / 2 ? segA[s] : segB[s]];
    }
  }

  // 4. Byggrutor: allt inom BUILDING_DEPTH rutor från en väg, med vägens anslutning
  for (let head = 0; head < queueEnd; head++) {
    const tile = queue[head];
    const d = depth[tile];
    if (d >= BUILDING_DEPTH) continue;
    const tx = tile % G;
    const tz = (tile - tx) / G;
    const neighbors = [tx > 0 ? tile - 1 : -1, tx < G - 1 ? tile + 1 : -1, tz > 0 ? tile - G : -1, tz < G - 1 ? tile + G : -1];
    for (const nt of neighbors) {
      if (nt < 0 || depth[nt] !== -1) continue;
      depth[nt] = d + 1;
      access[nt] = access[tile];
      queue[queueEnd++] = nt;
    }
  }

  // 5. Zoner, kapacitet och höjd
  const tiles: number[] = [];
  for (let t = 0; t < G * G; t++) if (depth[t] > 0) tiles.push(t);
  const count = tiles.length;
  const buildings: Buildings = {
    count,
    x: new Float32Array(count),
    z: new Float32Array(count),
    zone: new Uint8Array(count),
    capacity: new Int32Array(count),
    height: new Float32Array(count),
    accessNode: new Int32Array(count),
  };
  const raw = new Float32Array(count);
  const center = G / 2;
  for (let i = 0; i < count; i++) {
    const t = tiles[i];
    const tx = t % G;
    const tz = (t - tx) / G;
    buildings.x[i] = (tx + 0.5) * T;
    buildings.z[i] = (tz + 0.5) * T;
    buildings.accessNode[i] = access[t];

    const distance = Math.hypot(tx + 0.5 - center, tz + 0.5 - center) / center;
    const noise = valueNoise(tx / 20, tz / 20, config.seed);
    const industry = valueNoise(tx / 45, tz / 45, config.seed + 101);
    const density = clamp(1.25 - distance, 0.1, 1) * (0.5 + noise);
    let zone: Zone;
    if (distance > 0.3 && industry > 0.66) zone = Zone.Industrial;
    else if (rng() < (distance < 0.2 ? 0.6 : 0.07)) zone = Zone.Commercial;
    else zone = Zone.Residential;
    buildings.zone[i] = zone;
    raw[i] =
      zone === Zone.Residential
        ? 1 + density * density * 40
        : zone === Zone.Commercial
          ? 2 + density * density * 60
          : 10 + noise * 30;
  }
  distribute(raw, buildings.zone, true, config.population, rng, buildings.capacity);
  distribute(raw, buildings.zone, false, Math.ceil(config.population * JOBS_PER_WORKER), rng, buildings.capacity);

  for (let i = 0; i < count; i++) {
    const cap = buildings.capacity[i];
    const zone = buildings.zone[i];
    const height =
      zone === Zone.Residential
        ? 3.2 * Math.max(1, Math.ceil(cap / 4))
        : zone === Zone.Commercial
          ? 3.8 * Math.max(1, Math.ceil(cap / 12))
          : 6 + Math.min(cap, 80) / 10;
    buildings.height[i] = Math.min(height, 160);
  }

  return { size: G * T, tileSize: T, graph, buildings };
}

function roadLines(rng: Rng, gridSize: number): number[] {
  const lines: number[] = [];
  for (let p = 2 + Math.floor(rng() * 3); p <= gridSize - 3; p += 5 + Math.floor(rng() * 5)) lines.push(p);
  return lines;
}

/** Var fjärde gata är en huvudled med två körfält per riktning. */
function isArterial(lineIndex: number): boolean {
  return lineIndex % 4 === 2;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Markerar noderna i den största sammanhängande delen av nätet (union-find). */
function largestComponent(n: number, a: number[], b: number[]): Uint8Array {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const degree = new Int32Array(n);
  for (let s = 0; s < a.length; s++) {
    parent[find(a[s])] = find(b[s]);
    degree[a[s]]++;
    degree[b[s]]++;
  }
  const size = new Int32Array(n);
  let best = -1;
  for (let i = 0; i < n; i++) {
    if (degree[i] === 0) continue;
    const root = find(i);
    size[root]++;
    if (best < 0 || size[root] > size[best]) best = root;
  }
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = degree[i] > 0 && find(i) === best ? 1 : 0;
  return keep;
}

/**
 * Fördelar `total` (invånare eller jobb) på byggnaderna i proportion till råvärdet,
 * så att summan blir exakt `total`.
 */
function distribute(raw: Float32Array, zone: Uint8Array, residential: boolean, total: number, rng: Rng, out: Int32Array): void {
  const indices: number[] = [];
  let sum = 0;
  for (let i = 0; i < raw.length; i++) {
    if ((zone[i] === Zone.Residential) !== residential) continue;
    indices.push(i);
    sum += raw[i];
  }
  if (indices.length === 0) return;
  let assigned = 0;
  for (const i of indices) {
    out[i] = Math.floor((raw[i] / sum) * total);
    assigned += out[i];
  }
  for (; assigned < total; assigned++) out[indices[Math.floor(rng() * indices.length)]]++;
}
