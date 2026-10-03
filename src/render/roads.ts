import * as THREE from 'three';
import { atLength, resample } from '../shared/geometry';
import { ROAD_SPECS, RoadType, trimAt, type RoadNetwork, type RoadSegment } from '../shared/network';
import { MeshBuilder, rgb, type Rgb } from './meshBuilder';

export const ROAD_Y = 0.3;
const LUT_SIZE = 64;
/** Beläggning under detta räknas som tom väg. */
const EMPTY_LOAD = 0.03;
const ASPHALT = rgb(0x52555a);
const HIGHWAY = rgb(0x3e4146);
const SAMPLE_STEP = 3;

/**
 * Väggeometri per tät kant, i kantens körriktning. Används för att placera bilar längs
 * kurvorna: punkterna ligger med jämnt avstånd mellan korsningarnas kanter.
 */
export interface EdgePaths {
  edgeCount: number;
  /** Första punkten (index) och antal punkter per kant. */
  offset: Int32Array;
  count: Int32Array;
  /** Körbar längd mellan korsningarna. */
  length: Float32Array;
  /** x, z, tx, tz per punkt. */
  data: Float32Array;
  /** Omslutande cirkel per kant (för att bara rita bilar som syns). */
  cx: Float32Array;
  cz: Float32Array;
  radius: Float32Array;
}

/**
 * Alla vägar som ett mesh, byggt om från vägnätet vid varje ändring. Varje vägsträcka
 * är två remsor – en per körriktning – så att trafikvyn kan färga riktningarna var för
 * sig. Vägarna kortas av vid korsningarna, och korsningen fylls med en egen yta.
 */
export class RoadLayer {
  readonly group = new THREE.Group();
  paths: EdgePaths = emptyPaths();
  private mesh: THREE.Mesh | null = null;
  private colorAttr: THREE.BufferAttribute | null = null;
  /** Första vertex och antal vertexar per tät kant. */
  private edgeVerts = new Int32Array(0);
  /** Grundfärg per tät kant (när trafikvyn inte färgar den). */
  private edgeColor: Rgb[] = [];
  private readonly lut = new Float32Array(LUT_SIZE * 3);
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor() {
    this.buildLut();
  }

  rebuild(net: RoadNetwork): void {
    const segs = [...net.segments.values()];
    const E = segs.length * 2;
    const builder = new MeshBuilder();
    this.edgeVerts = new Int32Array(E * 2);
    this.edgeColor = new Array(E);
    const pathChunks: Float32Array[] = new Array(E);
    const paths: EdgePaths = {
      edgeCount: E,
      offset: new Int32Array(E),
      count: new Int32Array(E),
      length: new Float32Array(E),
      data: new Float32Array(0),
      cx: new Float32Array(E),
      cz: new Float32Array(E),
      radius: new Float32Array(E),
    };

    segs.forEach((seg, k) => {
      const hw = ROAD_SPECS[seg.type].halfWidth;
      const L = seg.poly.length;
      let ta = trimAt(net, seg.a, seg.id);
      let tb = trimAt(net, seg.b, seg.id);
      if (ta + tb > L - 1) {
        const f = Math.max(0, L - 1) / (ta + tb);
        ta *= f;
        tb *= f;
      }
      const samples = resample(seg.poly, ta, L - tb, isStraight(seg) ? Infinity : SAMPLE_STEP);
      const color = seg.type === RoadType.Highway ? HIGHWAY : ASPHALT;
      for (const dir of [0, 1]) {
        const e = 2 * k + dir;
        const start = builder.vertexCount;
        this.edgeColor[e] = color;
        if (dir === 0) builder.ribbon(samples, 0, hw, ROAD_Y, color);
        else builder.ribbon(samples, -hw, 0, ROAD_Y, color);
        this.edgeVerts[e * 2] = start;
        this.edgeVerts[e * 2 + 1] = builder.vertexCount - start;
        pathChunks[e] = dir === 0 ? samples : reversed(samples);
        paths.length[e] = L - ta - tb;
        const b = bounds(samples);
        paths.cx[e] = b.cx;
        paths.cz[e] = b.cz;
        paths.radius[e] = b.r + hw;
      }
    });

    let total = 0;
    for (let e = 0; e < E; e++) {
      paths.offset[e] = total;
      paths.count[e] = pathChunks[e].length / 4;
      total += paths.count[e];
    }
    paths.data = new Float32Array(total * 4);
    for (let e = 0; e < E; e++) paths.data.set(pathChunks[e], paths.offset[e] * 4);
    this.paths = paths;

    for (const node of net.nodes.values()) this.junction(builder, net, node.id);

    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const geometry = builder.build();
    this.colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.group.add(this.mesh);
  }

  /** Färgar vägarna efter beläggning (trafikvy) eller som vanlig asfalt. */
  update(edgeLoad: Float32Array | null, trafficView: boolean): void {
    if (!this.colorAttr) return;
    const colors = this.colorAttr.array as Float32Array;
    const E = this.edgeVerts.length / 2;
    const useLoad = trafficView && edgeLoad !== null && edgeLoad.length >= E;
    for (let e = 0; e < E; e++) {
      let [r, g, b] = this.edgeColor[e];
      if (useLoad && edgeLoad![e] >= EMPTY_LOAD) {
        const i = Math.min(LUT_SIZE - 1, Math.floor(edgeLoad![e] * (LUT_SIZE - 1))) * 3;
        r = this.lut[i];
        g = this.lut[i + 1];
        b = this.lut[i + 2];
      }
      const start = this.edgeVerts[e * 2];
      const end = start + this.edgeVerts[e * 2 + 1];
      for (let v = start; v < end; v++) {
        colors[v * 3] = r;
        colors[v * 3 + 1] = g;
        colors[v * 3 + 2] = b;
      }
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Korsningsyta: konvext hölje runt vägarnas avkortade ändar (eller en rund ände). */
  private junction(builder: MeshBuilder, net: RoadNetwork, nodeId: number): void {
    const node = net.node(nodeId);
    const points: [number, number][] = [[node.x, node.z]];
    for (const segId of node.segs) {
      const seg = net.segments.get(segId)!;
      const hw = ROAD_SPECS[seg.type].halfWidth;
      const atStart = seg.a === nodeId;
      const trim = Math.min(trimAt(net, nodeId, segId), seg.poly.length / 2);
      const p = atLength(seg.poly, atStart ? trim : seg.poly.length - trim);
      const sign = atStart ? 1 : -1;
      const dx = p.tx * sign;
      const dz = p.tz * sign;
      points.push([p.x - dz * hw, p.z + dx * hw], [p.x + dz * hw, p.z - dx * hw]);
      if (node.segs.length === 1) {
        // Återvändsgränd: rundad ände bakom korsningen
        for (let a = -60; a <= 60; a += 30) {
          const rad = (a * Math.PI) / 180;
          const bx = -dx * Math.cos(rad) - -dz * Math.sin(rad);
          const bz = -dx * Math.sin(rad) + -dz * Math.cos(rad);
          points.push([node.x + bx * hw, node.z + bz * hw]);
        }
      }
    }
    const onHighway = node.segs.some((s) => net.segments.get(s)!.type === RoadType.Highway);
    builder.convex(points, ROAD_Y + 0.01, onHighway ? HIGHWAY : ASPHALT);
  }

  private buildLut(): void {
    const asphalt = new THREE.Color().setRGB(ASPHALT[0], ASPHALT[1], ASPHALT[2]);
    const green = new THREE.Color().setRGB(0.3, 0.72, 0.35, THREE.SRGBColorSpace);
    const yellow = new THREE.Color().setRGB(0.98, 0.8, 0.2, THREE.SRGBColorSpace);
    const red = new THREE.Color().setRGB(0.88, 0.16, 0.12, THREE.SRGBColorSpace);
    const c = new THREE.Color();
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      if (t < EMPTY_LOAD) c.copy(asphalt);
      else if (t < 0.45) c.lerpColors(green, yellow, (t - EMPTY_LOAD) / (0.45 - EMPTY_LOAD));
      else if (t < 0.85) c.lerpColors(yellow, red, (t - 0.45) / 0.4);
      else c.copy(red);
      this.lut.set([c.r, c.g, c.b], i * 3);
    }
  }
}

function emptyPaths(): EdgePaths {
  return {
    edgeCount: 0,
    offset: new Int32Array(0),
    count: new Int32Array(0),
    length: new Float32Array(0),
    data: new Float32Array(0),
    cx: new Float32Array(0),
    cz: new Float32Array(0),
    radius: new Float32Array(0),
  };
}

function isStraight(seg: RoadSegment): boolean {
  const c = seg.curve;
  return Math.hypot(c.cx - (c.ax + c.bx) / 2, c.cz - (c.az + c.bz) / 2) < 0.05;
}

/** Samma punkter i omvänd ordning och riktning. */
function reversed(samples: Float32Array): Float32Array {
  const n = samples.length / 4;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i;
    out[i * 4] = samples[j * 4];
    out[i * 4 + 1] = samples[j * 4 + 1];
    out[i * 4 + 2] = -samples[j * 4 + 2];
    out[i * 4 + 3] = -samples[j * 4 + 3];
  }
  return out;
}

function bounds(samples: Float32Array): { cx: number; cz: number; r: number } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < samples.length; i += 4) {
    minX = Math.min(minX, samples[i]);
    maxX = Math.max(maxX, samples[i]);
    minZ = Math.min(minZ, samples[i + 1]);
    maxZ = Math.max(maxZ, samples[i + 1]);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2 };
}
