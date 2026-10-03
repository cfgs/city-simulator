import * as THREE from 'three';
import { LANE_WIDTH } from '../shared/network';
import { VEH_STRIDE, V_EDGE, V_ID, V_LANE, V_MAX, V_PROGRESS, V_RATE } from '../shared/protocol';
import { ROAD_Y, type EdgePaths } from './roads';

const CAR_COLORS = [0xe8e8e8, 0x2b2b2b, 0xb3261e, 0x2f5fa8, 0x8a8f96, 0xd9c27a, 0x3f7d4a];

/**
 * Ritar bara bilar på vägkanter som syns i kameran. Positionen räknas fram per bildruta
 * från senaste snapshot – position + fart × tid sedan snapshoten, men aldrig förbi
 * köplatsen – och placeras längs vägens kurva med hjälp av kantens punkter.
 */
export class VehicleLayer {
  readonly group = new THREE.Group();
  visibleCount = 0;
  private mesh: THREE.InstancedMesh | null = null;
  private visibleEdge = new Uint8Array(0);
  private readonly palette = new Float32Array(CAR_COLORS.length * 3);
  private readonly geometry = new THREE.BoxGeometry(4.4, 1.5, 1.9).translate(0, ROAD_Y + 0.75, 0);
  private readonly material = new THREE.MeshLambertMaterial();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  constructor() {
    const c = new THREE.Color();
    CAR_COLORS.forEach((hex, i) => {
      c.setHex(hex);
      this.palette.set([c.r, c.g, c.b], i * 3);
    });
  }

  hide(): void {
    if (this.mesh) this.mesh.count = 0;
    this.visibleCount = 0;
  }

  /** `gameDt` = spelsekunder sedan snapshoten togs. */
  update(data: Float32Array, count: number, gameDt: number, camera: THREE.Camera, paths: EdgePaths): void {
    this.ensureCapacity(count);
    const mesh = this.mesh!;
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    if (this.visibleEdge.length < paths.edgeCount) this.visibleEdge = new Uint8Array(paths.edgeCount);
    const { visibleEdge, sphere, frustum, palette } = this;
    for (let e = 0; e < paths.edgeCount; e++) {
      sphere.center.set(paths.cx[e], 0, paths.cz[e]);
      sphere.radius = paths.radius[e];
      visibleEdge[e] = frustum.intersectsSphere(sphere) ? 1 : 0;
    }

    const { offset, count: pointCount, length, data: pts } = paths;
    const m = mesh.instanceMatrix.array as Float32Array;
    const col = mesh.instanceColor!.array as Float32Array;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const o = i * VEH_STRIDE;
      const e = data[o + V_EDGE];
      if (e >= paths.edgeCount || visibleEdge[e] === 0) continue;
      const points = pointCount[e];
      const len = length[e];
      const progress = Math.min(data[o + V_PROGRESS] + data[o + V_RATE] * gameDt, data[o + V_MAX]);
      // Punkterna ligger med jämnt avstånd: hitta de två närmaste och interpolera.
      const f = len > 0.01 && points > 1 ? (progress * (points - 1)) : 0;
      const k = Math.min(points - 2, Math.max(0, Math.floor(f)));
      const u = Math.max(0, Math.min(1, f - k));
      const p0 = (offset[e] + k) * 4;
      const p1 = points > 1 ? p0 + 4 : p0;
      const dx = pts[p0 + 2];
      const dz = pts[p0 + 3];
      const side = (data[o + V_LANE] + 0.5) * LANE_WIDTH;
      const x = pts[p0] + (pts[p1] - pts[p0]) * u - dz * side;
      const z = pts[p0 + 1] + (pts[p1 + 1] - pts[p0 + 1]) * u + dx * side;
      // Rotation runt Y så att bilens längdaxel pekar längs vägen, plus förflyttning.
      const b = n * 16;
      m[b] = dx;
      m[b + 1] = 0;
      m[b + 2] = dz;
      m[b + 3] = 0;
      m[b + 4] = 0;
      m[b + 5] = 1;
      m[b + 6] = 0;
      m[b + 7] = 0;
      m[b + 8] = -dz;
      m[b + 9] = 0;
      m[b + 10] = dx;
      m[b + 11] = 0;
      m[b + 12] = x;
      m[b + 13] = 0;
      m[b + 14] = z;
      m[b + 15] = 1;
      const pc = (data[o + V_ID] % CAR_COLORS.length) * 3;
      col[n * 3] = palette[pc];
      col[n * 3 + 1] = palette[pc + 1];
      col[n * 3 + 2] = palette[pc + 2];
      n++;
    }

    mesh.count = n;
    this.visibleCount = n;
    if (n === 0) return;
    const matrixAttr = mesh.instanceMatrix;
    const colorAttr = mesh.instanceColor!;
    matrixAttr.clearUpdateRanges();
    matrixAttr.addUpdateRange(0, n * 16);
    matrixAttr.needsUpdate = true;
    colorAttr.clearUpdateRanges();
    colorAttr.addUpdateRange(0, n * 3);
    colorAttr.needsUpdate = true;
  }

  /** Byter till ett större instansmesh när antalet bilar växer. */
  private ensureCapacity(count: number): void {
    const capacity = this.mesh ? this.mesh.instanceMatrix.count : 0;
    if (count <= capacity && this.mesh) return;
    const next = Math.max(1024, count * 2);
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, next);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color());
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.group.add(mesh);
  }
}
