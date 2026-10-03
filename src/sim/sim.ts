import type { SimConfig } from '../shared/config';
import type { Quad } from '../shared/geometry';
import { RoadNetwork, type RoadType } from '../shared/network';
import type { SimStats } from '../shared/protocol';
import { mulberry32, gaussian, type Rng } from '../shared/rng';
import { applyPlan, planRoad, type NetworkChange } from '../shared/roadplan';
import { CELL, ZoneType } from '../shared/zones';
import { Buildings } from './buildings';
import { denseNodeOf, graphFromNetwork, type RoadGraph } from './graph';
import { buildHighway } from './highway';
import { CitizenState, Population, Travel } from './population';
import { Router } from './routing';
import { EventType, MinuteScheduler } from './scheduler';
import { Traffic } from './traffic';
import { Zoning } from './zoning';

const DAY = 86_400;
const HOUR = 3600;
/** Spelsekunder per tick. */
const DT = 1;
/** Kollektivtrafik simuleras som restid: väntetid + avstånd / snittfart. */
const TRANSIT_WAIT = 300;
const TRANSIT_SPEED = 6;
const COST_UPDATE_INTERVAL = 10;
/** Tillväxt per spelminut: så många kandidatceller prövas, var och en med den här chansen. */
const GROW_TRIES = 400;
const GROW_CHANCE = 0.25;

export interface BuildResult {
  built: number;
  failed: number;
  reason: string;
}

/**
 * Hela simuleringen. Ren TypeScript utan DOM-beroenden, så den kan köras i en Web Worker
 * och testas direkt i Vitest. Tar emot kommandon (bygg väg, riv, zona) och håller reda på
 * vad som ändrats så att workern kan skicka ändringarna till renderingen.
 */
export class Simulation {
  readonly net: RoadNetwork;
  graph: RoadGraph;
  readonly router: Router;
  readonly traffic: Traffic;
  readonly zoning: Zoning;
  readonly buildings = new Buildings();
  readonly people = new Population();
  /** Spelsekunder sedan dag 1 kl 00:00. */
  time: number;
  /** Vad som ändrats sedan workern senast skickade ändringar. */
  readonly dirty = { network: false, cells: false, cellZones: new Set<number>() };
  private readonly scheduler: MinuteScheduler;
  private readonly rng: Rng;
  private inTransit = 0;
  private ticks = 0;
  /** Korsningar (stabila id) vars vägar når motorvägen. null = ingen motorväg, allt räknas som anslutet. */
  private connected: Uint8Array | null = null;
  private unconnectedLots = 0;

  constructor(readonly config: SimConfig) {
    this.rng = mulberry32(config.seed);
    this.net = new RoadNetwork(config.mapSize);
    this.graph = graphFromNetwork(this.net);
    this.router = new Router(this.graph);
    this.traffic = new Traffic(this.graph, this.router, 0);
    this.zoning = new Zoning(config.mapSize);
    this.time = config.startHour * HOUR;
    this.scheduler = new MinuteScheduler(this.time);
    if (config.outsideConnection) {
      buildHighway(this.net);
      this.networkChanged({ added: [...this.net.segments.keys()], removed: [] });
    }
  }

  // ---------------------------------------------------------------- Kommandon

  /** Bygger vägar i tur och ordning. Ogiltiga vägar hoppas över. */
  buildRoads(roads: Quad[][], type: RoadType): BuildResult {
    const result: BuildResult = { built: 0, failed: 0, reason: '' };
    const change: NetworkChange = { added: [], removed: [] };
    for (const road of roads) {
      const plan = planRoad(this.net, road, type);
      if (!plan.valid) {
        result.failed++;
        result.reason = plan.reason;
        continue;
      }
      const c = applyPlan(this.net, plan);
      change.added.push(...c.added);
      change.removed.push(...c.removed);
      result.built++;
    }
    if (result.built > 0) this.networkChanged(change);
    return result;
  }

  bulldoze(segments: number[]): void {
    const removed = segments.filter((id) => this.net.segments.get(id)?.locked === false);
    if (removed.length === 0) return;
    for (const id of removed) this.net.removeSegment(id);
    this.networkChanged({ added: [], removed });
  }

  zone(x: number, z: number, radius: number, zone: ZoneType): void {
    const { changed, demolish } = this.zoning.paint(x, z, radius, zone);
    for (const c of changed) this.dirty.cellZones.add(c);
    this.demolish(demolish);
  }

  /** Sätter zon på alla celler enligt en funktion (används av demostaden). */
  zoneAll(pick: (x: number, z: number) => ZoneType): void {
    const zn = this.zoning;
    for (let c = 0; c < zn.slots; c++) if (zn.alive[c]) zn.setZone(c, pick(zn.x[c], zn.z[c]));
    this.dirty.cells = true;
  }

  /** Låter byggnader växa upp på alla lediga zonade tomter direkt (används av demostaden). */
  growAll(): void {
    for (let spawned = 1; spawned > 0; ) {
      spawned = 0;
      for (const cell of [...this.zoning.candidates]) {
        if (!this.zoning.candidates.has(cell) || !this.isConnected(cell)) continue;
        this.spawnLot(cell, true);
        spawned++;
      }
    }
  }

  // ---------------------------------------------------------------- Tick

  tick(): void {
    this.time += DT;
    this.scheduler.advance(this.time, this.handleEvent);
    this.traffic.step(this.time, DT);
    const arrived = this.traffic.arrived;
    for (let i = 0; i < arrived.length; i++) {
      const c = arrived[i];
      if (this.people.alive[c] && this.people.travel[c] === Travel.Car) this.arrive(c);
    }
    arrived.length = 0;
    if (++this.ticks % COST_UPDATE_INTERVAL === 0) this.traffic.updateCosts();
    if (this.time % 60 === 0) this.grow();
  }

  stats(perf: Pick<SimStats, 'tickMs' | 'ticksPerSec' | 'effectiveSpeed'>): SimStats {
    const { people, buildings } = this;
    return {
      time: this.time,
      population: people.count,
      drivers: people.drivers,
      buildings: buildings.count,
      homes: buildings.totalHomes,
      jobs: buildings.totalJobs,
      filledJobs: buildings.filledJobs,
      unemployed: people.unemployed.size,
      atHome: people.stateCount[CitizenState.Home],
      atWork: people.stateCount[CitizenState.Work],
      movingIn: people.stateCount[CitizenState.MovingIn],
      unconnectedLots: this.unconnectedLots,
      onRoad: this.traffic.onRoad,
      waitingToEnter: this.traffic.waiting,
      inTransit: this.inTransit,
      routeTrees: this.router.treeCount,
      avgCarTripMin: this.traffic.avgTripTime / 60,
      ...perf,
    };
  }

  // ---------------------------------------------------------------- Vägnät

  private networkChanged(change: NetworkChange): void {
    const removed = new Set(change.removed);
    const added = change.added.filter((id) => !removed.has(id) && this.net.segments.has(id));
    const result = this.zoning.regenerate(this.net, { added, removed: change.removed }, (b) => this.buildings.cells[b].length);
    for (const [b, cells] of result.moved) {
      this.buildings.cells[b] = cells;
      this.buildings.access[b] = this.zoning.accessNode(this.net, cells[0]);
    }
    this.demolish(result.demolished);
    this.graph = graphFromNetwork(this.net);
    this.router.reset(this.graph);
    this.traffic.remap(this.graph, this.time);
    this.updateConnectivity();
    this.dirty.network = true;
    this.dirty.cells = true;
  }

  /** Vilka korsningar når motorvägens ändar (omvärlden)? */
  private updateConnectivity(): void {
    const { net } = this;
    if (net.outside.length === 0) {
      this.connected = null;
      return;
    }
    let maxId = 0;
    for (const id of net.nodes.keys()) maxId = Math.max(maxId, id);
    const connected = new Uint8Array(maxId + 1);
    const stack = net.outside.filter((id) => net.nodes.has(id));
    for (const id of stack) connected[id] = 1;
    while (stack.length > 0) {
      const node = net.nodes.get(stack.pop()!)!;
      for (const segId of node.segs) {
        const seg = net.segments.get(segId)!;
        const other = seg.a === node.id ? seg.b : seg.a;
        if (connected[other]) continue;
        connected[other] = 1;
        stack.push(other);
      }
    }
    this.connected = connected;
  }

  private isConnected(cell: number): boolean {
    if (!this.connected) return true;
    const node = this.zoning.accessNode(this.net, cell);
    return node < this.connected.length && this.connected[node] === 1;
  }

  // ---------------------------------------------------------------- Byggnader

  /** Byggnader växer bara upp på tomter vars vägar når motorvägen. */
  private grow(): void {
    let tries = 0;
    let unconnected = 0;
    for (const cell of this.zoning.candidates) {
      if (!this.isConnected(cell)) {
        unconnected++;
        continue;
      }
      if (tries++ < GROW_TRIES && this.rng() < GROW_CHANCE) this.spawnLot(cell, false);
    }
    this.unconnectedLots = unconnected;
  }

  /** `immediate`: invånarna bor där direkt i stället för att köra in från omvärlden. */
  private spawnLot(cell: number, immediate: boolean): void {
    const zn = this.zoning;
    const cells = zn.lotFrom(cell);
    if (cells.length === 0) return;
    const zone = zn.zone[cell] as ZoneType;
    const columns = cells.length > 1 && zn.col[cells[1]] !== zn.col[cells[0]] ? 2 : 1;
    const rows = cells.length / columns;
    let x = 0;
    let z = 0;
    for (const c of cells) {
      x += zn.x[c];
      z += zn.z[c];
    }
    const n = cells.length;
    const rng = this.rng;
    let height: number;
    let capacity: number;
    if (zone === ZoneType.Residential) {
      const floors = 1 + (rng() < 0.35 ? 1 : 0) + (rng() < 0.1 ? 1 : 0);
      height = floors * 3.2;
      capacity = Math.max(1, Math.round(n * 1.5 * floors));
    } else if (zone === ZoneType.Commercial) {
      const floors = 1 + Math.floor(rng() * 3);
      height = floors * 3.8;
      capacity = n * 2 * floors;
    } else {
      height = 6 + rng() * 5;
      capacity = n * 3;
    }
    const b = this.buildings.create({
      x: x / n,
      z: z / n,
      dirX: zn.dirX[cell],
      dirZ: zn.dirZ[cell],
      width: columns * CELL - 1.5,
      depth: rows * CELL - 1.5,
      height,
      zone,
      capacity,
      access: zn.accessNode(this.net, cell),
      cells,
    });
    zn.setBuilding(cells, b);
    if (zone === ZoneType.Residential) this.moveIn(b, immediate);
    else this.fillJobs();
  }

  /** River byggnader: de boende flyttar från staden, de anställda blir arbetslösa. */
  private demolish(ids: number[]): void {
    if (ids.length === 0) return;
    const doomed = new Uint8Array(this.buildings.slots);
    for (const b of ids) doomed[b] = 1;
    const p = this.people;
    for (let c = 0; c < p.slots; c++) {
      if (!p.alive[c]) continue;
      if (doomed[p.home[c]]) this.moveOut(c);
      else if (p.work[c] >= 0 && doomed[p.work[c]]) this.loseJob(c);
    }
    for (const b of ids) {
      this.zoning.clearBuilding(this.buildings.cells[b]);
      this.buildings.remove(b);
    }
    this.fillJobs();
  }

  // ---------------------------------------------------------------- Invånare

  private moveIn(home: number, immediate: boolean): void {
    const p = this.people;
    const rng = this.rng;
    const fromOutside = !immediate && this.net.outside.length > 0;
    this.traffic.ensureVehicles(p.slots + this.buildings.capacity[home]);
    for (let i = 0; i < this.buildings.capacity[home]; i++) {
      const c = p.alloc(this.time, rng() < this.config.carShare);
      p.home[c] = home;
      if (fromOutside) {
        p.setState(c, CitizenState.MovingIn);
        this.travelFromOutside(c, home);
      }
      const start = clamp(7.5 * HOUR + gaussian(rng) * 0.75 * HOUR, 5.75 * HOUR, 10.5 * HOUR);
      p.workStart[c] = start;
      p.workEnd[c] = clamp(start + 8.5 * HOUR + gaussian(rng) * 0.5 * HOUR, start + HOUR, 23.5 * HOUR);
      this.buildings.filled[home]++;
      this.assignJob(c);
    }
  }

  private moveOut(c: number): void {
    const p = this.people;
    this.cancelTrip(c);
    if (p.work[c] >= 0) this.buildings.releaseJob(p.work[c]);
    p.release(c, this.time);
  }

  private assignJob(c: number): void {
    const p = this.people;
    const job = this.buildings.takeJob(this.rng);
    if (job < 0) {
      p.unemployed.add(c);
      return;
    }
    p.work[c] = job;
    p.unemployed.delete(c);
    if (p.state[c] === CitizenState.Home) this.scheduler.schedule(this.nextOccurrence(p.workStart[c], 60), c, EventType.DepartWork);
  }

  private loseJob(c: number): void {
    const p = this.people;
    p.work[c] = -1;
    p.unemployed.add(c);
    if (p.state[c] === CitizenState.ToWork || p.state[c] === CitizenState.Work) {
      this.cancelTrip(c);
      p.setState(c, CitizenState.Home);
    }
  }

  /** Ger arbetslösa jobb så länge det finns lediga platser. */
  private fillJobs(): void {
    for (const c of this.people.unemployed) {
      if (!this.buildings.hasOpenJobs) break;
      this.assignJob(c);
    }
  }

  private cancelTrip(c: number): void {
    const p = this.people;
    if (p.travel[c] === Travel.Car) this.traffic.cancel(c);
    else if (p.travel[c] === Travel.Transit) this.inTransit--;
    p.travel[c] = Travel.None;
  }

  private handleEvent = (c: number, type: EventType): void => {
    const p = this.people;
    if (!p.alive[c]) return;
    switch (type) {
      case EventType.DepartWork:
        if (p.state[c] !== CitizenState.Home || p.work[c] < 0) return;
        p.setState(c, CitizenState.ToWork);
        this.startTrip(c, p.home[c], p.work[c]);
        break;
      case EventType.DepartHome:
        if (p.state[c] !== CitizenState.Work) return;
        p.setState(c, CitizenState.ToHome);
        this.startTrip(c, p.work[c], p.home[c]);
        break;
      case EventType.ArriveTransit:
        if (p.travel[c] !== Travel.Transit) return;
        this.inTransit--;
        this.arrive(c);
        break;
    }
  };

  /** Nyinflyttade kör in från en av motorvägens ändar till sin nya bostad. */
  private travelFromOutside(c: number, home: number): void {
    const p = this.people;
    const b = this.buildings;
    const entry = this.net.outside[Math.floor(this.rng() * this.net.outside.length)];
    if (p.hasCar[c]) {
      const origin = denseNodeOf(this.graph, entry);
      const dest = denseNodeOf(this.graph, b.access[home]);
      if (origin >= 0 && dest >= 0 && this.traffic.depart(c, origin, dest, this.time)) {
        p.travel[c] = Travel.Car;
        return;
      }
    }
    const n = this.net.node(entry);
    const distance = Math.abs(b.x[home] - n.x) + Math.abs(b.z[home] - n.z);
    p.travel[c] = Travel.Transit;
    this.inTransit++;
    this.scheduler.schedule(this.time + TRANSIT_WAIT + distance / TRANSIT_SPEED, c, EventType.ArriveTransit);
  }

  private startTrip(c: number, from: number, to: number): void {
    const p = this.people;
    const b = this.buildings;
    if (p.hasCar[c]) {
      const origin = denseNodeOf(this.graph, b.access[from]);
      const dest = denseNodeOf(this.graph, b.access[to]);
      if (origin >= 0 && dest >= 0 && this.traffic.depart(c, origin, dest, this.time)) {
        p.travel[c] = Travel.Car;
        return;
      }
    }
    const distance = Math.abs(b.x[to] - b.x[from]) + Math.abs(b.z[to] - b.z[from]);
    p.travel[c] = Travel.Transit;
    this.inTransit++;
    this.scheduler.schedule(this.time + TRANSIT_WAIT + distance / TRANSIT_SPEED, c, EventType.ArriveTransit);
  }

  private arrive(c: number): void {
    const p = this.people;
    p.travel[c] = Travel.None;
    if (p.state[c] === CitizenState.ToWork) {
      p.setState(c, CitizenState.Work);
      const dayStart = Math.floor(this.time / DAY) * DAY;
      let t = dayStart + p.workEnd[c];
      if (t <= this.time) t = this.time + 1800;
      this.scheduler.schedule(t, c, EventType.DepartHome);
    } else if (p.state[c] === CitizenState.ToHome) {
      p.setState(c, CitizenState.Home);
      if (p.work[c] >= 0) this.scheduler.schedule(this.nextOccurrence(p.workStart[c], HOUR), c, EventType.DepartWork);
    } else if (p.state[c] === CitizenState.MovingIn) {
      p.setState(c, CitizenState.Home);
      if (p.work[c] >= 0) this.scheduler.schedule(this.nextOccurrence(p.workStart[c], 60), c, EventType.DepartWork);
    }
  }

  /** Nästa gång klockan visar `timeOfDay`, minst `margin` sekunder fram. */
  private nextOccurrence(timeOfDay: number, margin: number): number {
    let t = Math.floor(this.time / DAY) * DAY + timeOfDay;
    if (t <= this.time + margin) t += DAY;
    return t;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
