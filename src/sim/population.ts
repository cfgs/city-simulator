/** MovingIn = på väg in till staden från omvärlden för att flytta in. */
export const CitizenState = { Home: 0, ToWork: 1, Work: 2, ToHome: 3, MovingIn: 4 } as const;
export type CitizenState = (typeof CitizenState)[keyof typeof CitizenState];

export const Travel = { None: 0, Car: 1, Transit: 2 } as const;
export type Travel = (typeof Travel)[keyof typeof Travel];

const DAY = 86_400;

/**
 * Alla invånare som struct-of-arrays. Index = invånarens id (och bilens id).
 * En plats som blir ledig återanvänds först efter ett dygn, så att gamla händelser
 * i händelsekön aldrig kan träffa en ny invånare på samma plats.
 */
export class Population {
  alive = new Uint8Array(0);
  home = new Int32Array(0);
  /** Arbetsplatsens byggnad, −1 = arbetslös. */
  work = new Int32Array(0);
  hasCar = new Uint8Array(0);
  /** Klockslag (sekunder efter midnatt) när invånaren åker till jobbet. */
  workStart = new Float32Array(0);
  /** Klockslag när invånaren åker hem. */
  workEnd = new Float32Array(0);
  state = new Uint8Array(0);
  travel = new Uint8Array(0);
  /** Antal använda platser (högsta id + 1). */
  slots = 0;
  count = 0;
  drivers = 0;
  readonly stateCount = new Int32Array(5);
  readonly unemployed = new Set<number>();
  private released: number[] = [];
  private releasedAt: number[] = [];
  private releasedHead = 0;

  get capacity(): number {
    return this.alive.length;
  }

  alloc(now: number, hasCar: boolean): number {
    let c: number;
    if (this.releasedHead < this.released.length && this.releasedAt[this.releasedHead] + DAY <= now) {
      c = this.released[this.releasedHead++];
      if (this.releasedHead > 4096) {
        this.released = this.released.slice(this.releasedHead);
        this.releasedAt = this.releasedAt.slice(this.releasedHead);
        this.releasedHead = 0;
      }
    } else {
      c = this.slots++;
      if (c >= this.alive.length) this.grow(Math.max(4096, this.alive.length * 2));
    }
    this.alive[c] = 1;
    this.work[c] = -1;
    this.hasCar[c] = hasCar ? 1 : 0;
    this.state[c] = CitizenState.Home;
    this.travel[c] = Travel.None;
    this.stateCount[CitizenState.Home]++;
    this.count++;
    if (hasCar) this.drivers++;
    return c;
  }

  release(c: number, now: number): void {
    this.alive[c] = 0;
    this.stateCount[this.state[c]]--;
    this.count--;
    if (this.hasCar[c]) this.drivers--;
    this.unemployed.delete(c);
    this.released.push(c);
    this.releasedAt.push(now);
  }

  setState(c: number, s: CitizenState): void {
    this.stateCount[this.state[c]]--;
    this.stateCount[s]++;
    this.state[c] = s;
  }

  private grow(n: number): void {
    const copy = <T extends Float32Array | Int32Array | Uint8Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      b.set(a);
      return b;
    };
    this.alive = copy(this.alive);
    this.home = copy(this.home);
    this.work = copy(this.work);
    this.hasCar = copy(this.hasCar);
    this.workStart = copy(this.workStart);
    this.workEnd = copy(this.workEnd);
    this.state = copy(this.state);
    this.travel = copy(this.travel);
  }
}
