import { ZoneType } from '../shared/zones';

export interface BuildingSpec {
  x: number;
  z: number;
  /** Riktning längs vägen. */
  dirX: number;
  dirZ: number;
  /** Bredd längs vägen. */
  width: number;
  /** Djup från vägen. */
  depth: number;
  height: number;
  zone: ZoneType;
  /** Invånare (bostäder) eller arbetsplatser. */
  capacity: number;
  /** Korsningen resor går via (stabilt id). */
  access: number;
  cells: number[];
}

/** Alla byggnader som struct-of-arrays. Platser återanvänds när byggnader rivs. */
export class Buildings {
  x = new Float32Array(0);
  z = new Float32Array(0);
  dirX = new Float32Array(0);
  dirZ = new Float32Array(0);
  width = new Float32Array(0);
  depth = new Float32Array(0);
  height = new Float32Array(0);
  zone = new Uint8Array(0);
  capacity = new Int32Array(0);
  /** Antal boende eller anställda. */
  filled = new Int32Array(0);
  access = new Int32Array(0);
  alive = new Uint8Array(0);
  cells: number[][] = [];
  slots = 0;
  count = 0;
  totalHomes = 0;
  totalJobs = 0;
  filledJobs = 0;
  private free: number[] = [];
  /** Arbetsplatser med lediga platser, och var i listan varje byggnad ligger. */
  private openJobs: number[] = [];
  private openIndex = new Int32Array(0);
  /** Ändringar sedan senaste utskick till renderingen. */
  readonly added = new Set<number>();
  readonly removed = new Set<number>();

  create(spec: BuildingSpec): number {
    const b = this.free.length > 0 ? this.free.pop()! : this.slots++;
    if (b >= this.alive.length) this.grow(Math.max(256, this.alive.length * 2));
    this.x[b] = spec.x;
    this.z[b] = spec.z;
    this.dirX[b] = spec.dirX;
    this.dirZ[b] = spec.dirZ;
    this.width[b] = spec.width;
    this.depth[b] = spec.depth;
    this.height[b] = spec.height;
    this.zone[b] = spec.zone;
    this.capacity[b] = spec.capacity;
    this.filled[b] = 0;
    this.access[b] = spec.access;
    this.alive[b] = 1;
    this.cells[b] = spec.cells;
    this.count++;
    if (spec.zone === ZoneType.Residential) this.totalHomes += spec.capacity;
    else {
      this.totalJobs += spec.capacity;
      this.openJob(b);
    }
    this.added.add(b);
    return b;
  }

  remove(b: number): void {
    if (!this.alive[b]) return;
    if (this.zone[b] === ZoneType.Residential) this.totalHomes -= this.capacity[b];
    else {
      this.totalJobs -= this.capacity[b];
      this.filledJobs -= this.filled[b];
      this.closeJob(b);
    }
    this.alive[b] = 0;
    this.cells[b] = [];
    this.count--;
    this.free.push(b);
    this.added.delete(b);
    this.removed.add(b);
  }

  /** Tar en ledig arbetsplats (slumpvis byggnad), eller −1 om det inte finns någon. */
  takeJob(rng: () => number): number {
    if (this.openJobs.length === 0) return -1;
    const b = this.openJobs[Math.floor(rng() * this.openJobs.length)];
    this.filled[b]++;
    this.filledJobs++;
    if (this.filled[b] >= this.capacity[b]) this.closeJob(b);
    return b;
  }

  releaseJob(b: number): void {
    if (!this.alive[b]) return;
    this.filled[b]--;
    this.filledJobs--;
    this.openJob(b);
  }

  get hasOpenJobs(): boolean {
    return this.openJobs.length > 0;
  }

  private openJob(b: number): void {
    if (this.openIndex[b] >= 0 || this.filled[b] >= this.capacity[b]) return;
    this.openIndex[b] = this.openJobs.length;
    this.openJobs.push(b);
  }

  private closeJob(b: number): void {
    const i = this.openIndex[b];
    if (i < 0) return;
    const last = this.openJobs.pop()!;
    if (last !== b) {
      this.openJobs[i] = last;
      this.openIndex[last] = i;
    }
    this.openIndex[b] = -1;
  }

  private grow(n: number): void {
    const copy = <T extends Float32Array | Int32Array | Uint8Array>(a: T, fill?: number): T => {
      const b = new (a.constructor as new (n: number) => T)(n);
      if (fill !== undefined) b.fill(fill);
      b.set(a);
      return b;
    };
    this.x = copy(this.x);
    this.z = copy(this.z);
    this.dirX = copy(this.dirX);
    this.dirZ = copy(this.dirZ);
    this.width = copy(this.width);
    this.depth = copy(this.depth);
    this.height = copy(this.height);
    this.zone = copy(this.zone);
    this.capacity = copy(this.capacity);
    this.filled = copy(this.filled);
    this.access = copy(this.access);
    this.alive = copy(this.alive);
    this.openIndex = copy(this.openIndex, -1);
  }
}
