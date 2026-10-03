import { VEH_STRIDE, V_EDGE, V_ID, V_LANE, V_MAX, V_PROGRESS, V_RATE } from '../shared/protocol';
import { VEHICLE_SPACING, type RoadGraph } from './graph';
import type { Router } from './routing';

/** Sekunder ett fordon får stå först i kö mot en full väg innan det släpps in ändå (förhindrar total låsning). */
export const STUCK_TIME = 60;
/** Hur mycket ny mätning väger in i kantkostnaden vid varje uppdatering. */
const COST_SMOOTHING = 0.3;
const MAX_LANES = 8;

/**
 * Mesoskopisk köbaserad trafikmodell (samma princip som MATSim:s kösimulering).
 *
 * Varje vägkant är en FIFO-kö. Ett fordon som kör in på en kant kan lämna den tidigast
 * efter kantens fria restid, och bara om (1) kanten släpper ut tillräckligt många fordon
 * per sekund och (2) nästa kant har plats. Det ger köer, flaskhalsar och köer som växer
 * bakåt genom korsningar – utan att simulera varje bils rörelse. Exakta positioner räknas
 * bara ut i snapshoten, och renderingen ritar bara de fordon som syns.
 *
 * Fordon indexeras med samma id som invånaren som kör.
 */
export class Traffic {
  // Per fordon
  /** Startkorsning för fordon som väntar på att köra ut. */
  private readonly vehNode: Int32Array;
  private readonly vehDest: Int32Array;
  /** Nästa fordon i samma kö (länkad lista), -1 sist. */
  private readonly vehNext: Int32Array;
  /** När fordonet körde in på kanten (eller började vänta på att köra ut). */
  private readonly vehEnter: Float64Array;
  /** Tidigaste tid fordonet kan lämna kanten. */
  private readonly vehExit: Float64Array;
  private readonly vehDepart: Float64Array;

  // Per kant
  private readonly head: Int32Array;
  private readonly tail: Int32Array;
  readonly count: Int32Array;
  private readonly flowAccum: Float32Array;

  private pending: number[] = [];
  private readonly laneAhead = new Int32Array(MAX_LANES);
  /** Fordon som kommit fram sedan förra tömningen. Töms av simuleringen. */
  readonly arrived: number[] = [];
  onRoad = 0;
  /** Glidande medelvärde av restid (sekunder) för avslutade bilresor. */
  avgTripTime = 0;

  constructor(
    private readonly graph: RoadGraph,
    private readonly router: Router,
    vehicleCount: number,
  ) {
    this.vehNode = new Int32Array(vehicleCount);
    this.vehDest = new Int32Array(vehicleCount);
    this.vehNext = new Int32Array(vehicleCount).fill(-1);
    this.vehEnter = new Float64Array(vehicleCount);
    this.vehExit = new Float64Array(vehicleCount);
    this.vehDepart = new Float64Array(vehicleCount);
    const E = graph.edgeCount;
    this.head = new Int32Array(E).fill(-1);
    this.tail = new Int32Array(E).fill(-1);
    this.count = new Int32Array(E);
    this.flowAccum = new Float32Array(E);
  }

  /** Fordon som väntar på plats för att köra ut på första vägen. */
  get waiting(): number {
    return this.pending.length;
  }

  /** Startar en bilresa. Returnerar false om det inte finns någon väg. */
  depart(v: number, origin: number, dest: number, now: number): boolean {
    this.vehDepart[v] = now;
    if (origin === dest) {
      this.arrived.push(v);
      return true;
    }
    if (this.router.nextEdge(dest, origin) < 0) return false;
    this.vehNode[v] = origin;
    this.vehDest[v] = dest;
    this.vehEnter[v] = now;
    this.pending.push(v);
    return true;
  }

  step(now: number, dt: number): void {
    const { edgeTo, edgeFlowCap, edgeStorage, edgeCount } = this.graph;
    const { head, count, flowAccum, vehExit, vehDest } = this;

    for (let e = 0; e < edgeCount; e++) {
      const perTick = edgeFlowCap[e] * dt;
      let acc = Math.min(flowAccum[e] + perTick, Math.max(1, perTick));
      while (acc >= 1) {
        const v = head[e];
        if (v === -1 || vehExit[v] > now) break;
        const node = edgeTo[e];
        const dest = vehDest[v];
        const next = node === dest ? -1 : this.router.nextEdge(dest, node);
        if (next >= 0 && count[next] >= edgeStorage[next] && now - vehExit[v] < STUCK_TIME) break;
        this.dequeue(e);
        acc -= 1;
        if (next < 0) {
          this.onRoad--;
          this.finish(v, now);
        } else {
          this.enqueue(next, v, now);
        }
      }
      flowAccum[e] = acc;
    }

    this.admitPending(now);
  }

  /** Uppdaterar vägvalets kantkostnader från aktuella köer. */
  updateCosts(): void {
    const { edgeFreeTime, edgeFlowCap, edgeCount } = this.graph;
    const cost = this.router.edgeCost;
    for (let e = 0; e < edgeCount; e++) {
      // Antingen kör man i fri fart, eller så avgör kön hur lång tid det tar.
      const expected = Math.max(edgeFreeTime[e], this.count[e] / edgeFlowCap[e]);
      cost[e] += (expected - cost[e]) * COST_SMOOTHING;
    }
  }

  /**
   * Skriver alla fordon på vägarna till `out` (VEH_STRIDE fält per fordon) och
   * beläggningen per kant till `edgeLoad`. Returnerar antalet fordon.
   */
  writeSnapshot(now: number, out: Float32Array, edgeLoad: Float32Array): number {
    const { edgeLength, edgeLanes, edgeFreeTime, edgeStorage, edgeCount } = this.graph;
    const { head, count, vehNext, vehEnter, laneAhead } = this;
    let n = 0;
    for (let e = 0; e < edgeCount; e++) {
      edgeLoad[e] = count[e] / edgeStorage[e];
      let v = head[e];
      if (v === -1) continue;
      const lanes = Math.min(edgeLanes[e], MAX_LANES);
      const length = edgeLength[e];
      const freeTime = edgeFreeTime[e];
      laneAhead.fill(0, 0, lanes);
      while (v !== -1 && (n + 1) * VEH_STRIDE <= out.length) {
        const lane = v % lanes;
        const queuePos = laneAhead[lane]++;
        const max = Math.max(0, 1 - (queuePos * VEHICLE_SPACING) / length);
        const free = Math.min(1, (now - vehEnter[v]) / freeTime);
        const o = n * VEH_STRIDE;
        out[o + V_EDGE] = e;
        out[o + V_LANE] = lane;
        out[o + V_PROGRESS] = Math.min(free, max);
        out[o + V_RATE] = free < max ? 1 / freeTime : 0;
        out[o + V_MAX] = max;
        out[o + V_ID] = v;
        n++;
        v = vehNext[v];
      }
    }
    return n;
  }

  private admitPending(now: number): void {
    const { edgeStorage } = this.graph;
    const pending = this.pending;
    let kept = 0;
    for (let i = 0; i < pending.length; i++) {
      const v = pending[i];
      const e = this.router.nextEdge(this.vehDest[v], this.vehNode[v]);
      if (e < 0) {
        this.finish(v, now);
      } else if (this.count[e] < edgeStorage[e] || now - this.vehEnter[v] >= STUCK_TIME) {
        this.enqueue(e, v, now);
        this.onRoad++;
      } else {
        pending[kept++] = v;
      }
    }
    pending.length = kept;
  }

  private enqueue(e: number, v: number, now: number): void {
    this.vehEnter[v] = now;
    this.vehExit[v] = now + this.graph.edgeFreeTime[e];
    this.vehNext[v] = -1;
    const tail = this.tail[e];
    if (tail === -1) this.head[e] = v;
    else this.vehNext[tail] = v;
    this.tail[e] = v;
    this.count[e]++;
  }

  private dequeue(e: number): void {
    const v = this.head[e];
    this.head[e] = this.vehNext[v];
    if (this.head[e] === -1) this.tail[e] = -1;
    this.vehNext[v] = -1;
    this.count[e]--;
  }

  private finish(v: number, now: number): void {
    const trip = now - this.vehDepart[v];
    this.avgTripTime = this.avgTripTime === 0 ? trip : this.avgTripTime + (trip - this.avgTripTime) * 0.01;
    this.arrived.push(v);
  }
}
