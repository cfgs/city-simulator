import * as THREE from 'three';
import { ROAD_SPECS, type RoadNetwork } from '../shared/network';

const SIGN_BLUE = '#1f5fbf';

/**
 * Blå avfartsskyltar vid motorvägens avfarter. Så länge en avfart inte är ansluten visas
 * också en blå ring på marken där spelaren ska dra sin väg.
 */
export class ExitSigns {
  readonly group = new THREE.Group();
  private readonly poleMaterial = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
  private readonly boardMaterials: THREE.Material[];
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0x3f8cff, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly pole = new THREE.BoxGeometry(0.5, 10, 0.5).translate(0, 5, 0);
  private readonly board = new THREE.BoxGeometry(11, 4.8, 0.4);
  private readonly ring = new THREE.RingGeometry(7, 9.5, 40).rotateX(-Math.PI / 2);

  constructor() {
    const text = new THREE.MeshLambertMaterial({ map: signTexture() });
    const plain = new THREE.MeshLambertMaterial({ color: SIGN_BLUE });
    // Lådans sidor: +x, −x, +y, −y, +z, −z – texten på fram- och baksidan
    this.boardMaterials = [plain, plain, plain, plain, text, text];
  }

  rebuild(net: RoadNetwork): void {
    this.group.clear();
    for (const id of net.exits) {
      const node = net.nodes.get(id);
      if (!node) continue;
      const stub = node.segs.map((s) => net.segments.get(s)!).find((s) => s.locked);
      if (!stub) continue;
      // Riktning längs avfarten, från motorvägen in mot staden
      const other = net.node(stub.a === id ? stub.b : stub.a);
      const len = Math.hypot(node.x - other.x, node.z - other.z) || 1;
      const dx = (node.x - other.x) / len;
      const dz = (node.z - other.z) / len;
      const side = ROAD_SPECS[stub.type].halfWidth + 7;
      // Skylten står vid sidan av vägen, en bit innan änden, och vänd mot trafiken från motorvägen
      const x = node.x - dx * 25 - dz * side;
      const z = node.z - dz * 25 + dx * side;
      const pole = new THREE.Mesh(this.pole, this.poleMaterial);
      pole.position.set(x, 0, z);
      const board = new THREE.Mesh(this.board, this.boardMaterials);
      board.position.set(x, 11, z);
      board.rotation.y = Math.atan2(dx, dz);
      this.group.add(pole, board);
      if (node.segs.length === 1) {
        const ring = new THREE.Mesh(this.ring, this.ringMaterial);
        ring.position.set(node.x, 0.6, node.z);
        ring.renderOrder = 3;
        this.group.add(ring);
      }
    }
  }
}

function signTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = SIGN_BLUE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Avfart', canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
