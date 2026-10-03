import * as THREE from 'three';
import type { WorldData } from '../shared/protocol';

/** Platshållarfärger per zon (bostad, handel, industri). Ersätts senare av temats grafik. */
const ZONE_COLORS = [0x9cc58a, 0x7fa7d9, 0xd9b26a];

/** Alla byggnader som lådor i ett enda instansierat mesh – ett enda ritanrop. */
export function createBuildings(world: WorldData): THREE.InstancedMesh {
  const n = world.buildingX.length;
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), n);
  const footprint = world.tileSize * 0.72;
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    m.makeScale(footprint, world.buildingHeight[i], footprint);
    m.setPosition(world.buildingX[i], 0, world.buildingZ[i]);
    mesh.setMatrixAt(i, m);
    const jitter = (((i * 2654435761) % 1000) / 1000 - 0.5) * 0.1;
    color.setHex(ZONE_COLORS[world.buildingZone[i]]).offsetHSL(0, 0, jitter);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
