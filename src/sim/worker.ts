import type { SimConfig } from '../shared/config';
import { VEH_STRIDE, type BuildingData, type FromWorker, type ToWorker } from '../shared/protocol';
import { buildDemo } from './demo';
import { Simulation } from './sim';

/** Max tid per varv i loopen som får gå till simuleringstick. */
const TICK_BUDGET_MS = 12;
/** Tid per varv för att räkna om vägvalsträd med aktuella köer. */
const ROUTE_BUDGET_MS = 1.5;
const SNAPSHOT_INTERVAL_MS = 50;

let sim: Simulation | null = null;
let speed = 60;
let owed = 0;
let keepingUp = true;
let lastLoop = 0;
let lastSnapshot = 0;

// Mätfönster för prestandasiffrorna i HUD:en
let windowStart = 0;
let windowGameStart = 0;
let windowTicks = 0;
let windowTickTime = 0;
let effectiveSpeed = 0;
let ticksPerSec = 0;
let tickMs = 0;

const vehiclePool: ArrayBuffer[] = [];
const loadPool: ArrayBuffer[] = [];

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    init(msg.config);
    return;
  }
  if (msg.type === 'speed') {
    speed = msg.speed;
    owed = 0;
    return;
  }
  if (msg.type === 'recycle') {
    vehiclePool.push(msg.vehicles);
    loadPool.push(msg.edgeLoad);
    return;
  }
  const s = sim;
  if (!s) return;
  switch (msg.type) {
    case 'buildRoads': {
      const result = s.buildRoads(msg.roads, msg.roadType);
      post({ type: 'result', requestId: msg.requestId, ...result });
      break;
    }
    case 'bulldoze':
      s.bulldoze(msg.segments);
      break;
    case 'zone':
      s.zone(msg.x, msg.z, msg.radius, msg.zone);
      break;
  }
};

function init(config: SimConfig): void {
  const s = new Simulation(config);
  if (config.demo) buildDemo(s);
  sim = s;
  s.dirty.network = true;
  s.dirty.cells = true;
  lastLoop = windowStart = performance.now();
  windowGameStart = s.time;
  loop();
}

function loop(): void {
  const s = sim!;
  const start = performance.now();
  const realDt = Math.min(0.25, (start - lastLoop) / 1000);
  lastLoop = start;

  if (speed > 0) {
    owed = Number.isFinite(speed) ? owed + speed * realDt : Infinity;
    while (owed >= 1 && performance.now() - start < TICK_BUDGET_MS) {
      const t0 = performance.now();
      s.tick();
      windowTickTime += performance.now() - t0;
      windowTicks++;
      owed -= 1;
    }
    // Hann vi inte ikapp släpper vi efterskottet: spelet går långsammare i stället för att frysa.
    keepingUp = owed < 1;
    if (!keepingUp) owed = 0;
    s.router.refresh(ROUTE_BUDGET_MS);
  }

  const now = performance.now();
  if (now - windowStart >= 1000) {
    const seconds = (now - windowStart) / 1000;
    effectiveSpeed = (s.time - windowGameStart) / seconds;
    ticksPerSec = windowTicks / seconds;
    tickMs = windowTicks > 0 ? windowTickTime / windowTicks : 0;
    windowStart = now;
    windowGameStart = s.time;
    windowTicks = 0;
    windowTickTime = 0;
  }
  flushChanges(s);
  if (now - lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshot = now;
    sendSnapshot(s);
  }
  setTimeout(loop, 0);
}

/** Skickar ändringar i vägnät, zoner och byggnader till renderingen. */
function flushChanges(s: Simulation): void {
  const { dirty } = s;
  if (dirty.network) {
    post({ type: 'network', data: s.net.toData() });
    dirty.network = false;
  }
  if (dirty.cells) {
    const data = s.zoning.data();
    post({ type: 'cells', data }, [data.x.buffer, data.z.buffer, data.dirX.buffer, data.dirZ.buffer, data.zone.buffer]);
    dirty.cells = false;
    dirty.cellZones.clear();
  } else if (dirty.cellZones.size > 0) {
    const ids = Int32Array.from(dirty.cellZones);
    const zones = Uint8Array.from(ids, (c) => s.zoning.zone[c]);
    post({ type: 'cellZones', ids, zones }, [ids.buffer, zones.buffer]);
    dirty.cellZones.clear();
  }
  const b = s.buildings;
  if (b.added.size > 0 || b.removed.size > 0) {
    const ids = Int32Array.from(b.added);
    const pick = (a: Float32Array) => Float32Array.from(ids, (id) => a[id]);
    const added: BuildingData = {
      ids,
      x: pick(b.x),
      z: pick(b.z),
      dirX: pick(b.dirX),
      dirZ: pick(b.dirZ),
      width: pick(b.width),
      depth: pick(b.depth),
      height: pick(b.height),
      zone: Uint8Array.from(ids, (id) => b.zone[id]),
    };
    post({ type: 'buildings', removed: Int32Array.from(b.removed), added });
    b.added.clear();
    b.removed.clear();
  }
}

function sendSnapshot(s: Simulation): void {
  const needed = Math.max(1, s.traffic.onRoad) * VEH_STRIDE * 4;
  let vbuf = vehiclePool.pop();
  if (!vbuf || vbuf.byteLength < needed) vbuf = new ArrayBuffer(Math.ceil(needed * 1.5));
  const edgeBytes = Math.max(1, s.graph.edgeCount) * 4;
  let lbuf = loadPool.pop();
  if (!lbuf || lbuf.byteLength !== edgeBytes) lbuf = new ArrayBuffer(edgeBytes);
  const vehicles = new Float32Array(vbuf);
  const edgeLoad = new Float32Array(lbuf);
  const vehicleCount = s.traffic.writeSnapshot(s.time, vehicles, edgeLoad);
  const currentSpeed = speed === 0 ? 0 : keepingUp && Number.isFinite(speed) ? speed : effectiveSpeed;
  post(
    {
      type: 'snapshot',
      time: s.time,
      networkVersion: s.net.version,
      speed: currentSpeed,
      vehicleCount,
      vehicles,
      edgeLoad,
      stats: s.stats({ tickMs, ticksPerSec, effectiveSpeed }),
    },
    [vehicles.buffer, edgeLoad.buffer],
  );
}
