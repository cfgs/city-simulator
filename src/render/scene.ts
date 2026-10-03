import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
}

const SKY = 0xbfd6e8;
const GROUND = 0x86a872;

export function createScene(container: HTMLElement, worldSize: number): SceneContext {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, worldSize * 0.9, worldSize * 2.5);

  const center = worldSize / 2;
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 5, worldSize * 4);
  camera.position.set(center - worldSize * 0.12, worldSize * 0.16, center + worldSize * 0.2);

  // Vänster: panorera · Höger: rotera · Scroll: zooma
  const controls = new MapControls(camera, renderer.domElement);
  controls.target.set(center, 0, center);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minDistance = 25;
  controls.maxDistance = worldSize * 1.6;
  controls.zoomToCursor = true;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8a6a, 1.8));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-0.6, 1, 0.35);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(worldSize * 3, worldSize * 3),
    // Skjuts bakåt i djupbufferten så att vägarna inte flimrar mot marken på långt håll.
    new THREE.MeshLambertMaterial({ color: GROUND, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center, 0, center);
  scene.add(ground);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls };
}
