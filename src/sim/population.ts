import type { SimConfig } from '../shared/config';
import { gaussian, type Rng } from '../shared/rng';
import { Zone, type World } from './mapgen';

export const CitizenState = { Home: 0, ToWork: 1, Work: 2, ToHome: 3 } as const;
export type CitizenState = (typeof CitizenState)[keyof typeof CitizenState];

const HOUR = 3600;

/** Alla invånare som struct-of-arrays. Index = invånarens id (och bilens id). */
export interface Citizens {
  count: number;
  homeNode: Int32Array;
  workNode: Int32Array;
  hasCar: Uint8Array;
  /** Klockslag (sekunder efter midnatt) när invånaren åker till jobbet. */
  workStart: Float32Array;
  /** Klockslag när invånaren åker hem. */
  workEnd: Float32Array;
  state: Uint8Array;
}

/**
 * Skapar invånarna. I prototypen pendlar alla: bostad → jobb → bostad varje dag.
 * Bostäder fylls efter kapacitet, jobb dras slumpvis bland alla arbetsplatser.
 */
export function createCitizens(world: World, config: SimConfig, rng: Rng): Citizens {
  const n = config.population;
  const b = world.buildings;
  const citizens: Citizens = {
    count: n,
    homeNode: new Int32Array(n),
    workNode: new Int32Array(n),
    hasCar: new Uint8Array(n),
    workStart: new Float32Array(n),
    workEnd: new Float32Array(n),
    state: new Uint8Array(n).fill(CitizenState.Home),
  };

  const homes = slots(b.capacity, b.zone, b.accessNode, true);
  const jobs = slots(b.capacity, b.zone, b.accessNode, false);
  shuffle(jobs, rng);
  const anyNode = () => b.accessNode[Math.floor(rng() * b.count)];

  for (let c = 0; c < n; c++) {
    citizens.homeNode[c] = homes.length > 0 ? homes[c % homes.length] : anyNode();
    citizens.workNode[c] = jobs.length > 0 ? jobs[c % jobs.length] : anyNode();
    citizens.hasCar[c] = rng() < config.carShare ? 1 : 0;
    const start = clamp(7.5 * HOUR + gaussian(rng) * 0.75 * HOUR, 5.75 * HOUR, 10.5 * HOUR);
    citizens.workStart[c] = start;
    citizens.workEnd[c] = clamp(start + 8.5 * HOUR + gaussian(rng) * 0.5 * HOUR, start + HOUR, 23.5 * HOUR);
  }
  return citizens;
}

/** En post per invånar- eller arbetsplats, med byggnadens anslutningskorsning. */
function slots(capacity: Int32Array, zone: Uint8Array, accessNode: Int32Array, residential: boolean): Int32Array {
  let total = 0;
  for (let i = 0; i < capacity.length; i++) if ((zone[i] === Zone.Residential) === residential) total += capacity[i];
  const out = new Int32Array(total);
  let k = 0;
  for (let i = 0; i < capacity.length; i++) {
    if ((zone[i] === Zone.Residential) !== residential) continue;
    for (let j = 0; j < capacity[i]; j++) out[k++] = accessNode[i];
  }
  return out;
}

function shuffle(a: Int32Array, rng: Rng): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
