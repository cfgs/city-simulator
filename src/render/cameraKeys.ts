import * as THREE from 'three';
import type { MapControls } from 'three/addons/controls/MapControls.js';

const PAN_KEYS: Record<string, [number, number]> = {
  w: [0, 1],
  arrowup: [0, 1],
  s: [0, -1],
  arrowdown: [0, -1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};
const ROTATE_KEYS: Record<string, number> = { q: 1, e: -1 };

/** Panorera med WASD/piltangenter och rotera med Q/E – fungerar även med styrplatta. */
export class CameraKeys {
  private readonly held = new Set<string>();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: MapControls,
  ) {
    window.addEventListener('keydown', (ev) => {
      const key = ev.key.toLowerCase();
      if (key in PAN_KEYS || key in ROTATE_KEYS) this.held.add(key);
    });
    window.addEventListener('keyup', (ev) => this.held.delete(ev.key.toLowerCase()));
    window.addEventListener('blur', () => this.held.clear());
  }

  update(dt: number): void {
    if (this.held.size === 0) return;
    const { camera, controls } = this;
    let px = 0;
    let pz = 0;
    let rot = 0;
    for (const key of this.held) {
      if (key in PAN_KEYS) {
        px += PAN_KEYS[key][0];
        pz += PAN_KEYS[key][1];
      } else rot += ROTATE_KEYS[key];
    }
    if (px !== 0 || pz !== 0) {
      camera.getWorldDirection(this.forward);
      this.forward.y = 0;
      this.forward.normalize();
      this.right.set(-this.forward.z, 0, this.forward.x);
      // Snabbare ju högre upp kameran är
      const speed = Math.max(80, camera.position.distanceTo(controls.target)) * 0.9 * dt;
      const move = this.forward.multiplyScalar(pz * speed).add(this.right.multiplyScalar(px * speed));
      camera.position.add(move);
      controls.target.add(move);
    }
    if (rot !== 0) {
      this.offset.copy(camera.position).sub(controls.target);
      this.offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, rot * 1.5 * dt);
      camera.position.copy(controls.target).add(this.offset);
    }
  }
}
