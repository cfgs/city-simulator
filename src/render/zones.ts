import * as THREE from 'three';
import type { CellData } from '../shared/protocol';
import { CELL, DEAD_CELL, ZoneType } from '../shared/zones';

const COLORS: Record<number, number> = {
  [ZoneType.None]: 0xf2f2f2,
  [ZoneType.Residential]: 0x3fbf4f,
  [ZoneType.Commercial]: 0x3f7fe0,
  [ZoneType.Industrial]: 0xe0b030,
};
const SIZE = CELL - 0.8;

/** Zoncellerna som halvgenomskinliga rutor på marken. Visas när ett zonverktyg är valt. */
export class ZoneOverlay {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false });
  private readonly color = new THREE.Color();

  setCells(data: CellData): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    const n = Math.max(1, data.slots);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    const m = mesh.instanceMatrix.array as Float32Array;
    m.fill(0);
    for (let c = 0; c < data.slots; c++) {
      if (data.zone[c] === DEAD_CELL) continue;
      const dx = data.dirX[c] * SIZE;
      const dz = data.dirZ[c] * SIZE;
      m.set([dx, 0, dz, 0, 0, 1, 0, 0, -dz, 0, dx, 0, data.x[c], 0.08, data.z[c], 1], c * 16);
    }
    mesh.setColorAt(0, this.color.setHex(COLORS[ZoneType.None]));
    for (let c = 0; c < data.slots; c++) mesh.setColorAt(c, this.color.setHex(COLORS[data.zone[c]] ?? COLORS[ZoneType.None]));
    mesh.count = data.slots;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.mesh = mesh;
    this.group.add(mesh);
  }

  updateZones(ids: Int32Array, zones: Uint8Array): void {
    const mesh = this.mesh;
    if (!mesh) return;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] >= mesh.count) continue;
      mesh.setColorAt(ids[i], this.color.setHex(COLORS[zones[i]] ?? COLORS[ZoneType.None]));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
