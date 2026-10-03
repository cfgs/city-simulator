import type { SimConfig } from '../shared/config';
import { VEH_STRIDE, type FromWorker, type ToWorker, type WorldData } from '../shared/protocol';
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
  switch (msg.type) {
    case 'init':
      init(msg.config);
      break;
    case 'speed':
      speed = msg.speed;
      owed = 0;
      break;
    case 'recycle':
      vehiclePool.push(msg.vehicles);
      loadPool.push(msg.edgeLoad);
      break;
  }
};

function init(config: SimConfig): void {
  const s = new Simulation(config);
  sim = s;
  const { graph, buildings } = s.world;
  const world: WorldData = {
    size: s.world.size,
    tileSize: s.world.tileSize,
    nodeX: graph.nodeX,
    nodeZ: graph.nodeZ,
    edgeFrom: graph.edgeFrom,
    edgeTo: graph.edgeTo,
    edgeLanes: graph.edgeLanes,
    buildingX: buildings.x,
    buildingZ: buildings.z,
    buildingZone: buildings.zone,
    buildingHeight: buildings.height,
    maxVehicles: s.drivers,
  };
  // Kopieras (ingen transfer) – simuleringen behåller sina egna arrayer.
  post({ type: 'world', world });
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
  if (now - lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshot = now;
    sendSnapshot(s);
  }
  setTimeout(loop, 0);
}

function sendSnapshot(s: Simulation): void {
  const vehicles = new Float32Array(vehiclePool.pop() ?? new ArrayBuffer(Math.max(1, s.drivers) * VEH_STRIDE * 4));
  const edgeLoad = new Float32Array(loadPool.pop() ?? new ArrayBuffer(s.world.graph.edgeCount * 4));
  const vehicleCount = s.traffic.writeSnapshot(s.time, vehicles, edgeLoad);
  const currentSpeed = speed === 0 ? 0 : keepingUp && Number.isFinite(speed) ? speed : effectiveSpeed;
  post(
    {
      type: 'snapshot',
      time: s.time,
      speed: currentSpeed,
      vehicleCount,
      vehicles,
      edgeLoad,
      stats: s.stats({ tickMs, ticksPerSec, effectiveSpeed }),
    },
    [vehicles.buffer, edgeLoad.buffer],
  );
}
