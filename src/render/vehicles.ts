import * as THREE from 'three';
import { VEH_STRIDE, V_EDGE, V_ID, V_LANE, V_MAX, V_PROGRESS, V_RATE, type WorldData } from '../shared/protocol';
import { LANE_WIDTH } from '../sim/graph';
import { ROAD_Y } from './roads';

const CAR_COLORS = [0xe8e8e8, 0x2b2b2b, 0xb3261e, 0x2f5fa8, 0x8a8f96, 0xd9c27a, 0x3f7d4a];
/** Meter från korsningens mitt där bilar stannar, så att köer inte står mitt i korsningen. */
const STOP_CLEARANCE = 8;

/**
 * Ritar bara bilar på vägkanter som syns i kameran. Positionen räknas fram per bildruta
 * från senaste snapshot: position + fart × tid sedan snapshoten, men aldrig förbi köplatsen.
 */
export class VehicleLayer {
  readonly mesh: THREE.InstancedMesh;
  visibleCount = 0;
  private readonly startX: Float32Array;
  private readonly startZ: Float32Array;
  private readonly dirX: Float32Array;
  private readonly dirZ: Float32Array;
  private readonly usableLength: Float32Array;
  private readonly sphereX: Float32Array;
  private readonly sphereZ: Float32Array;
  private readonly sphereR: Float32Array;
  private readonly visibleEdge: Uint8Array;
  private readonly palette = new Float32Array(CAR_COLORS.length * 3);
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  constructor(world: WorldData) {
    const E = world.edgeFrom.length;
    this.startX = new Float32Array(E);
    this.startZ = new Float32Array(E);
    this.dirX = new Float32Array(E);
    this.dirZ = new Float32Array(E);
    this.usableLength = new Float32Array(E);
    this.sphereX = new Float32Array(E);
    this.sphereZ = new Float32Array(E);
    this.sphereR = new Float32Array(E);
    this.visibleEdge = new Uint8Array(E);
    for (let e = 0; e < E; e++) {
      const ax = world.nodeX[world.edgeFrom[e]];
      const az = world.nodeZ[world.edgeFrom[e]];
      const bx = world.nodeX[world.edgeTo[e]];
      const bz = world.nodeZ[world.edgeTo[e]];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const clearance = Math.min(STOP_CLEARANCE, len * 0.25);
      this.startX[e] = ax + dx * clearance;
      this.startZ[e] = az + dz * clearance;
      this.dirX[e] = dx;
      this.dirZ[e] = dz;
      this.usableLength[e] = len - 2 * clearance;
      this.sphereX[e] = (ax + bx) / 2;
      this.sphereZ[e] = (az + bz) / 2;
      this.sphereR[e] = len / 2 + world.edgeLanes[e] * LANE_WIDTH;
    }

    const geometry = new THREE.BoxGeometry(4.4, 1.5, 1.9);
    geometry.translate(0, ROAD_Y + 0.75, 0);
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), Math.max(1, world.maxVehicles));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color()); // skapar färgattributet
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;

    const c = new THREE.Color();
    CAR_COLORS.forEach((hex, i) => {
      c.setHex(hex);
      this.palette.set([c.r, c.g, c.b], i * 3);
    });
  }

  /** `gameDt` = spelsekunder sedan snapshoten togs. */
  update(data: Float32Array, count: number, gameDt: number, camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const { sphereX, sphereZ, sphereR, visibleEdge, sphere, frustum } = this;
    for (let e = 0; e < visibleEdge.length; e++) {
      sphere.center.set(sphereX[e], 0, sphereZ[e]);
      sphere.radius = sphereR[e];
      visibleEdge[e] = frustum.intersectsSphere(sphere) ? 1 : 0;
    }

    const { startX, startZ, dirX, dirZ, usableLength, palette } = this;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const col = this.mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const o = i * VEH_STRIDE;
      const e = data[o + V_EDGE];
      if (visibleEdge[e] === 0) continue;
      const progress = Math.min(data[o + V_PROGRESS] + data[o + V_RATE] * gameDt, data[o + V_MAX]);
      const along = progress * usableLength[e];
      const side = (data[o + V_LANE] + 0.5) * LANE_WIDTH;
      const dx = dirX[e];
      const dz = dirZ[e];
      // Rotation runt Y så att bilens längdaxel pekar längs vägen, plus förflyttning.
      const k = n * 16;
      m[k] = dx;
      m[k + 1] = 0;
      m[k + 2] = dz;
      m[k + 3] = 0;
      m[k + 4] = 0;
      m[k + 5] = 1;
      m[k + 6] = 0;
      m[k + 7] = 0;
      m[k + 8] = -dz;
      m[k + 9] = 0;
      m[k + 10] = dx;
      m[k + 11] = 0;
      m[k + 12] = startX[e] + dx * along - dz * side;
      m[k + 13] = 0;
      m[k + 14] = startZ[e] + dz * along + dx * side;
      m[k + 15] = 1;
      const p = (data[o + V_ID] % CAR_COLORS.length) * 3;
      col[n * 3] = palette[p];
      col[n * 3 + 1] = palette[p + 1];
      col[n * 3 + 2] = palette[p + 2];
      n++;
    }

    this.mesh.count = n;
    this.visibleCount = n;
    if (n === 0) return;
    const matrixAttr = this.mesh.instanceMatrix;
    const colorAttr = this.mesh.instanceColor!;
    matrixAttr.clearUpdateRanges();
    matrixAttr.addUpdateRange(0, n * 16);
    matrixAttr.needsUpdate = true;
    colorAttr.clearUpdateRanges();
    colorAttr.addUpdateRange(0, n * 3);
    colorAttr.needsUpdate = true;
  }
}
