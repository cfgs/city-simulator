import * as THREE from 'three';
import type { WorldData } from '../shared/protocol';
import { LANE_WIDTH } from '../sim/graph';

export const ROAD_Y = 0.3;
const LUT_SIZE = 64;
/** Beläggning under detta räknas som tom väg. */
const EMPTY_LOAD = 0.03;

/**
 * Alla vägar som ett enda mesh. Varje riktad kant är en remsa från mittlinjen ut åt
 * höger, så de två riktningarna bildar tillsammans hela vägen och kan färgas var för sig.
 */
export class RoadLayer {
  readonly mesh: THREE.Mesh;
  private readonly colors: Float32Array;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly lut = new Float32Array(LUT_SIZE * 3);
  private readonly asphalt = new THREE.Color().setRGB(0.32, 0.33, 0.35, THREE.SRGBColorSpace);

  constructor(world: WorldData) {
    const E = world.edgeFrom.length;
    const positions = new Float32Array(E * 12);
    const normals = new Float32Array(E * 12);
    this.colors = new Float32Array(E * 12);
    const indices = new Uint32Array(E * 6);

    for (let e = 0; e < E; e++) {
      const a = world.edgeFrom[e];
      const b = world.edgeTo[e];
      const ax = world.nodeX[a];
      const az = world.nodeZ[a];
      const bx = world.nodeX[b];
      const bz = world.nodeZ[b];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const width = world.edgeLanes[e] * LANE_WIDTH;
      // Högervektor (-dz, dx) gånger vägbredden
      const rx = (-(bz - az) / len) * width;
      const rz = ((bx - ax) / len) * width;
      positions.set([ax, ROAD_Y, az, bx, ROAD_Y, bz, bx + rx, ROAD_Y, bz + rz, ax + rx, ROAD_Y, az + rz], e * 12);
      for (let k = 0; k < 4; k++) normals[e * 12 + k * 3 + 1] = 1;
      const v = e * 4;
      indices.set([v, v + 2, v + 1, v, v + 3, v + 2], e * 6);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('color', this.colorAttr);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));

    this.buildLut();
    this.update(new Float32Array(E), false);
  }

  /** Färgar vägarna efter beläggning (trafikvy) eller som vanlig asfalt. */
  update(edgeLoad: Float32Array, trafficView: boolean): void {
    const { colors, lut, asphalt } = this;
    const E = colors.length / 12;
    for (let e = 0; e < E; e++) {
      let r = asphalt.r;
      let g = asphalt.g;
      let b = asphalt.b;
      if (trafficView) {
        const i = Math.min(LUT_SIZE - 1, Math.floor(edgeLoad[e] * (LUT_SIZE - 1))) * 3;
        r = lut[i];
        g = lut[i + 1];
        b = lut[i + 2];
      }
      const o = e * 12;
      for (let k = 0; k < 12; k += 3) {
        colors[o + k] = r;
        colors[o + k + 1] = g;
        colors[o + k + 2] = b;
      }
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Asfalt → grönt → gult → rött när vägen fylls. */
  private buildLut(): void {
    const green = new THREE.Color().setRGB(0.3, 0.72, 0.35, THREE.SRGBColorSpace);
    const yellow = new THREE.Color().setRGB(0.98, 0.8, 0.2, THREE.SRGBColorSpace);
    const red = new THREE.Color().setRGB(0.88, 0.16, 0.12, THREE.SRGBColorSpace);
    const c = new THREE.Color();
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      if (t < EMPTY_LOAD) c.copy(this.asphalt);
      else if (t < 0.45) c.lerpColors(green, yellow, (t - EMPTY_LOAD) / (0.45 - EMPTY_LOAD));
      else if (t < 0.85) c.lerpColors(yellow, red, (t - 0.45) / 0.4);
      else c.copy(red);
      this.lut.set([c.r, c.g, c.b], i * 3);
    }
  }
}
