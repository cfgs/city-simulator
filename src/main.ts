import './style.css';
import { createBuildings } from './render/buildings';
import { RoadLayer } from './render/roads';
import { createScene, type SceneContext } from './render/scene';
import { VehicleLayer } from './render/vehicles';
import { configFromSearch } from './shared/config';
import type { FromWorker, SnapshotMessage, ToWorker, WorldData } from './shared/protocol';
import { Hud } from './ui/hud';

const config = configFromSearch(location.search);
const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

let view: { ctx: SceneContext; roads: RoadLayer; vehicles: VehicleLayer } | null = null;
let latest: SnapshotMessage | null = null;
let latestAt = 0;
let roadsDirty = false;
let trafficView = true;

const hud = new Hud(document.getElementById('hud')!, {
  onSpeed: (speed) => send({ type: 'speed', speed }),
  onToggleTraffic: () => {
    trafficView = !trafficView;
    roadsDirty = true;
    return trafficView;
  },
});

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const msg = ev.data;
  if (msg.type === 'world') {
    setupWorld(msg.world);
    return;
  }
  // Föregående snapshot används inte längre – skicka tillbaka buffertarna för återanvändning.
  if (latest) {
    const vehicles = latest.vehicles.buffer as ArrayBuffer;
    const edgeLoad = latest.edgeLoad.buffer as ArrayBuffer;
    send({ type: 'recycle', vehicles, edgeLoad }, [vehicles, edgeLoad]);
  }
  latest = msg;
  latestAt = performance.now();
  roadsDirty = true;
};

worker.onerror = (ev) => {
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `Simuleringen kraschade: ${ev.message}`;
};

send({ type: 'init', config });

function setupWorld(world: WorldData): void {
  const ctx = createScene(document.getElementById('app')!, world.size);
  const roads = new RoadLayer(world);
  const vehicles = new VehicleLayer(world);
  ctx.scene.add(createBuildings(world), roads.mesh, vehicles.mesh);
  view = { ctx, roads, vehicles };
  document.getElementById('loading')?.remove();
}

let frames = 0;
let fps = 0;
let fpsWindowStart = performance.now();
let lastHudUpdate = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (!view) return;
  const { ctx, roads, vehicles } = view;
  ctx.controls.update();
  if (latest) {
    const gameDt = (latest.speed * Math.max(0, now - latestAt)) / 1000;
    vehicles.update(latest.vehicles, latest.vehicleCount, gameDt, ctx.camera);
    if (roadsDirty) {
      roads.update(latest.edgeLoad, trafficView);
      roadsDirty = false;
    }
  }
  ctx.renderer.render(ctx.scene, ctx.camera);

  frames++;
  if (now - fpsWindowStart >= 500) {
    fps = (frames * 1000) / (now - fpsWindowStart);
    frames = 0;
    fpsWindowStart = now;
  }
  if (now - lastHudUpdate >= 250) {
    lastHudUpdate = now;
    hud.update(latest?.stats ?? null, fps, vehicles.visibleCount);
  }
}
requestAnimationFrame(frame);
