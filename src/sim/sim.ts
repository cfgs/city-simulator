import type { SimConfig } from '../shared/config';
import type { SimStats } from '../shared/protocol';
import { mulberry32 } from '../shared/rng';
import { generateWorld, type World } from './mapgen';
import { CitizenState, createCitizens, type Citizens } from './population';
import { Router } from './routing';
import { EventType, MinuteScheduler } from './scheduler';
import { Traffic } from './traffic';

const DAY = 86_400;
/** Spelsekunder per tick. */
const DT = 1;
/** Kollektivtrafik simuleras som restid: väntetid + avstånd / snittfart. */
const TRANSIT_WAIT = 300;
const TRANSIT_SPEED = 6;
const COST_UPDATE_INTERVAL = 10;

/**
 * Hela simuleringen. Ren TypeScript utan DOM-beroenden, så den kan köras i en
 * Web Worker och testas direkt i Vitest.
 */
export class Simulation {
  readonly world: World;
  readonly citizens: Citizens;
  readonly router: Router;
  readonly traffic: Traffic;
  readonly drivers: number;
  /** Spelsekunder sedan dag 1 kl 00:00. */
  time: number;
  private readonly scheduler: MinuteScheduler;
  private readonly stateCount = new Int32Array(4);
  private inTransit = 0;
  private ticks = 0;

  constructor(readonly config: SimConfig) {
    this.world = generateWorld(config);
    this.citizens = createCitizens(this.world, config, mulberry32(config.seed ^ 0x9e3779b9));
    this.router = new Router(this.world.graph);
    this.traffic = new Traffic(this.world.graph, this.router, this.citizens.count);
    this.time = config.startHour * 3600;
    this.scheduler = new MinuteScheduler(this.time);

    const { count, workStart, hasCar } = this.citizens;
    let drivers = 0;
    for (let c = 0; c < count; c++) {
      drivers += hasCar[c];
      let t = workStart[c];
      if (t <= this.time) t += DAY;
      this.scheduler.schedule(t, c, EventType.DepartWork);
    }
    this.drivers = drivers;
    this.stateCount[CitizenState.Home] = count;
  }

  tick(): void {
    this.time += DT;
    this.scheduler.advance(this.time, this.handleEvent);
    this.traffic.step(this.time, DT);
    const arrived = this.traffic.arrived;
    for (let i = 0; i < arrived.length; i++) this.arrive(arrived[i]);
    arrived.length = 0;
    if (++this.ticks % COST_UPDATE_INTERVAL === 0) this.traffic.updateCosts();
  }

  countInState(state: CitizenState): number {
    return this.stateCount[state];
  }

  stats(perf: Pick<SimStats, 'tickMs' | 'ticksPerSec' | 'effectiveSpeed'>): SimStats {
    return {
      time: this.time,
      population: this.citizens.count,
      drivers: this.drivers,
      atHome: this.stateCount[CitizenState.Home],
      atWork: this.stateCount[CitizenState.Work],
      onRoad: this.traffic.onRoad,
      waitingToEnter: this.traffic.waiting,
      inTransit: this.inTransit,
      routeTrees: this.router.treeCount,
      avgCarTripMin: this.traffic.avgTripTime / 60,
      ...perf,
    };
  }

  private handleEvent = (c: number, type: EventType): void => {
    const { homeNode, workNode } = this.citizens;
    switch (type) {
      case EventType.DepartWork:
        this.setState(c, CitizenState.ToWork);
        this.startTrip(c, homeNode[c], workNode[c]);
        break;
      case EventType.DepartHome:
        this.setState(c, CitizenState.ToHome);
        this.startTrip(c, workNode[c], homeNode[c]);
        break;
      case EventType.ArriveTransit:
        this.inTransit--;
        this.arrive(c);
        break;
    }
  };

  private startTrip(c: number, from: number, to: number): void {
    if (this.citizens.hasCar[c] && this.traffic.depart(c, from, to, this.time)) return;
    const { nodeX, nodeZ } = this.world.graph;
    const distance = Math.abs(nodeX[to] - nodeX[from]) + Math.abs(nodeZ[to] - nodeZ[from]);
    this.inTransit++;
    this.scheduler.schedule(this.time + TRANSIT_WAIT + distance / TRANSIT_SPEED, c, EventType.ArriveTransit);
  }

  private arrive(c: number): void {
    const dayStart = Math.floor(this.time / DAY) * DAY;
    const { state, workStart, workEnd } = this.citizens;
    if (state[c] === CitizenState.ToWork) {
      this.setState(c, CitizenState.Work);
      let t = dayStart + workEnd[c];
      if (t <= this.time) t = this.time + 1800;
      this.scheduler.schedule(t, c, EventType.DepartHome);
    } else if (state[c] === CitizenState.ToHome) {
      this.setState(c, CitizenState.Home);
      let t = dayStart + workStart[c];
      if (t <= this.time + 3600) t += DAY;
      this.scheduler.schedule(t, c, EventType.DepartWork);
    }
  }

  private setState(c: number, s: CitizenState): void {
    this.stateCount[this.citizens.state[c]]--;
    this.stateCount[s]++;
    this.citizens.state[c] = s;
  }
}
