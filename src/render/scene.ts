import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { GRID_STEP } from '../shared/roadplan';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  /** Rutnätet som visas när fästning mot rutnät är på. */
  grid: THREE.Object3D;
}

const SKY = 0xbfd6e8;
const GROUND = 0x86a872;
const OUTSIDE = 0x6f8a62;

export function createScene(container: HTMLElement, mapSize: number): SceneContext {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, mapSize * 0.9, mapSize * 2.5);

  const center = mapSize / 2;
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, mapSize * 4);
  camera.position.set(center, 420, center + 420);

  const controls = new MapControls(camera, renderer.domElement);
  controls.target.set(center, 0, center);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minDistance = 20;
  controls.maxDistance = mapSize * 1.6;
  controls.zoomToCursor = true;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8a6a, 1.8));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(-0.6, 1, 0.35);
  scene.add(sun);

  // Marken skjuts bakåt i djupbufferten så att vägar och zoner inte flimrar mot den.
  const groundMaterial = (color: number) =>
    new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(mapSize, mapSize), groundMaterial(GROUND));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center, 0, center);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(mapSize * 4, mapSize * 4), groundMaterial(OUTSIDE));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(center, -0.5, center);
  scene.add(ground, outside);

  const grid = new THREE.GridHelper(mapSize, mapSize / GRID_STEP, 0xffffff, 0xffffff);
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.12;
  gridMaterial.depthWrite = false;
  grid.position.set(center, 0.05, center);
  grid.visible = false;
  scene.add(grid);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls, grid };
}
