import './style.css';
import * as THREE from 'three';
import { BuildingLayer } from './render/buildings';
import { CameraKeys } from './render/cameraKeys';
import { ExitSigns } from './render/exits';
import { Preview } from './render/preview';
import { RoadLayer } from './render/roads';
import { createScene } from './render/scene';
import { VehicleLayer } from './render/vehicles';
import { ZoneOverlay } from './render/zones';
import { configFromSearch } from './shared/config';
import { RoadNetwork } from './shared/network';
import type { FromWorker, SnapshotMessage, ToWorker } from './shared/protocol';
import { ROAD_TOOLS, ToolController } from './tools/controller';
import { Hud } from './ui/hud';
import { Toolbar } from './ui/toolbar';
import { Tooltip } from './ui/tooltip';

const config = configFromSearch(location.search);
// Utan demostad börjar man vid motorvägens mittersta avfart, där staden kan anslutas.
const focus = config.demo ? { x: config.mapSize / 2, z: config.mapSize / 2 } : { x: config.mapSize / 2, z: config.mapSize - 600 };
const ctx = createScene(document.getElementById('app')!, config.mapSize, focus);
const canvas = ctx.renderer.domElement;
const roads = new RoadLayer();
const vehicles = new VehicleLayer();
const buildings = new BuildingLayer();
const zones = new ZoneOverlay();
const preview = new Preview();
const exits = new ExitSigns();
zones.group.visible = false;
ctx.scene.add(roads.group, buildings.group, vehicles.group, zones.group, preview.group, exits.group);
const notice = document.getElementById('notice')!;
const cameraKeys = new CameraKeys(ctx.camera, ctx.controls);
const tooltip = new Tooltip();

const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

let net = new RoadNetwork(config.mapSize);
let latest: SnapshotMessage | null = null;
let latestAt = 0;
let roadsDirty = false;
let trafficView = true;
let shiftHeld = false;

const tools = new ToolController(
  canvas,
  ctx.camera,
  preview,
  send,
  { tip: (text, error, x, y) => tooltip.show(text, error, x, y), changed: () => onToolChange() },
  config.mapSize,
);
const toolbar = new Toolbar(document.getElementById('toolbar')!, tools);
const hud = new Hud(document.getElementById('hud')!, {
  onSpeed: (speed) => send({ type: 'speed', speed }),
  onToggleTraffic: () => {
    trafficView = !trafficView;
    roadsDirty = true;
    return trafficView;
  },
});

function onToolChange(): void {
  toolbar.render();
  zones.group.visible = tools.tool === 'zone';
  ctx.grid.visible = tools.tool === 'grid' || (tools.gridSnap && ROAD_TOOLS.includes(tools.tool));
  canvas.style.cursor = tools.tool === 'select' ? '' : 'crosshair';
  applyMouseButtons();
}

/** I byggläge är vänster musknapp verktyget; panorera med mitten, Shift + vänster eller WASD. */
function applyMouseButtons(): void {
  const free = tools.tool === 'select' || shiftHeld;
  ctx.controls.mouseButtons = {
    LEFT: free ? THREE.MOUSE.PAN : null,
    MIDDLE: free ? THREE.MOUSE.DOLLY : THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
}

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'network':
      net = RoadNetwork.fromData(msg.data);
      roads.rebuild(net);
      exits.rebuild(net);
      tools.setNetwork(net);
      roadsDirty = true;
      document.getElementById('loading')?.remove();
      break;
    case 'cells':
      zones.setCells(msg.data);
      break;
    case 'cellZones':
      zones.updateZones(msg.ids, msg.zones);
      break;
    case 'buildings':
      buildings.apply(msg.removed, msg.added);
      break;
    case 'result':
      if (msg.failed > 0) {
        tooltip.toast(
          msg.built > 0 ? `${msg.failed} av ${msg.built + msg.failed} vägar kunde inte byggas: ${msg.reason}` : `Vägen kunde inte byggas: ${msg.reason}`,
        );
      }
      break;
    case 'snapshot':
      // Föregående snapshot används inte längre – skicka tillbaka buffertarna för återanvändning.
      if (latest) {
        const v = latest.vehicles.buffer as ArrayBuffer;
        const l = latest.edgeLoad.buffer as ArrayBuffer;
        send({ type: 'recycle', vehicles: v, edgeLoad: l }, [v, l]);
      }
      latest = msg;
      latestAt = performance.now();
      roadsDirty = true;
      break;
  }
};

worker.onerror = (ev) => {
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `Simuleringen kraschade: ${ev.message}`;
  else tooltip.toast(`Simuleringen kraschade: ${ev.message}`);
};

send({ type: 'init', config });
if (config.demo) document.getElementById('loading')!.textContent = 'Bygger demostaden…';

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Shift') {
    shiftHeld = true;
    applyMouseButtons();
    return;
  }
  if (ev.repeat) return;
  const key = ev.key.toLowerCase();
  if (ev.key === ' ') {
    ev.preventDefault();
    hud.togglePause();
  } else if (ev.key === 'Escape') tools.cancel();
  else if (key === 't') hud.toggleTraffic();
  else if (key === 'b') tools.setTool('bulldoze');
  else if (key === 'g') tools.toggleGridSnap();
  else hud.handleKey(ev.key);
});
window.addEventListener('keyup', (ev) => {
  if (ev.key !== 'Shift') return;
  shiftHeld = false;
  applyMouseButtons();
});

let frames = 0;
let fps = 0;
let fpsWindowStart = performance.now();
let lastHudUpdate = 0;
let lastFrame = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, now - lastFrame) / 1000);
  lastFrame = now;
  cameraKeys.update(dt);
  ctx.controls.update();
  if (latest && latest.networkVersion === net.version) {
    const gameDt = (latest.speed * Math.max(0, now - latestAt)) / 1000;
    vehicles.update(latest.vehicles, latest.vehicleCount, gameDt, ctx.camera, roads.paths);
    if (roadsDirty) {
      roads.update(latest.edgeLoad, trafficView);
      roadsDirty = false;
    }
  } else vehicles.hide();
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
    const lots = latest?.stats.unconnectedLots ?? 0;
    notice.textContent = lots > 0 ? `${lots.toLocaleString('sv-SE')} zonade tomter saknar anslutning till motorvägen – dra en väg till en avfart (blå ring)` : '';
    notice.classList.toggle('visible', lots > 0);
  }
}
onToolChange();
requestAnimationFrame(frame);
