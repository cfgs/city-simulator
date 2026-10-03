import * as THREE from 'three';
import type { BuildingData } from '../shared/protocol';
import { ZoneType } from '../shared/zones';

/** Platshållarfärger per zon. Ersätts senare av temats grafik. */
const ZONE_COLORS: Record<number, number> = {
  [ZoneType.Residential]: 0x9cc58a,
  [ZoneType.Commercial]: 0x7fa7d9,
  [ZoneType.Industrial]: 0xd9b26a,
};

/**
 * Alla byggnader som lådor i ett instansierat mesh (ett ritanrop). Instansindex =
 * byggnadens id i simuleringen; rivna byggnader får skala noll.
 */
export class BuildingLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private readonly material = new THREE.MeshLambertMaterial();
  private readonly color = new THREE.Color();

  apply(removed: Int32Array, added: BuildingData): void {
    let maxId = -1;
    for (const id of added.ids) maxId = Math.max(maxId, id);
    this.ensureCapacity(maxId + 1);
    const mesh = this.mesh;
    if (!mesh) return;
    const m = mesh.instanceMatrix.array as Float32Array;
    for (const id of removed) {
      if (id < mesh.count) m.fill(0, id * 16, id * 16 + 16);
    }
    for (let i = 0; i < added.ids.length; i++) {
      const id = added.ids[i];
      const dx = added.dirX[i];
      const dz = added.dirZ[i];
      const w = added.width[i];
      const d = added.depth[i];
      const b = id * 16;
      // Bredd längs vägen, djup vinkelrätt mot den
      m.set([dx * w, 0, dz * w, 0, 0, added.height[i], 0, 0, -dz * d, 0, dx * d, 0, added.x[i], 0, added.z[i], 1], b);
      const jitter = (((id * 2654435761) % 1000) / 1000 - 0.5) * 0.1;
      this.color.setHex(ZONE_COLORS[added.zone[i]] ?? 0xcccccc).offsetHSL(0, 0, jitter);
      mesh.setColorAt(id, this.color);
      if (id >= mesh.count) mesh.count = id + 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private ensureCapacity(n: number): void {
    const capacity = this.mesh ? this.mesh.instanceMatrix.count : 0;
    if (n <= capacity) return;
    const next = Math.max(1024, n * 2);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, next);
    mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
    (mesh.instanceMatrix.array as Float32Array).fill(0);
    mesh.count = 0;
    mesh.frustumCulled = false;
    if (this.mesh) {
      (mesh.instanceMatrix.array as Float32Array).set(this.mesh.instanceMatrix.array);
      (mesh.instanceColor!.array as Float32Array).set(this.mesh.instanceColor!.array);
      mesh.count = this.mesh.count;
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.mesh = mesh;
    this.group.add(mesh);
  }
}
