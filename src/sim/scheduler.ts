const MINUTES_PER_DAY = 1440;

export const EventType = { DepartWork: 0, DepartHome: 1, ArriveTransit: 2 } as const;
export type EventType = (typeof EventType)[keyof typeof EventType];

/**
 * Händelsekö med en hink per spelminut under ett dygn (ringbuffert).
 * Gör att simuleringen bara rör de invånare som faktiskt gör något just nu,
 * i stället för att gå igenom alla varje tick.
 */
export class MinuteScheduler {
  private readonly buckets: number[][] = Array.from({ length: MINUTES_PER_DAY }, () => []);
  /** Senaste absoluta minut som är helt behandlad. */
  private processedMinute: number;

  constructor(startTime: number) {
    this.processedMinute = Math.floor(startTime / 60) - 1;
  }

  /**
   * Lägger in en händelse. Tider som redan passerat körs nästa minut, och tider längre
   * fram än ett dygn kortas till knappt ett dygn (ringbufferten räcker inte längre).
   */
  schedule(time: number, citizen: number, type: EventType): void {
    let minute = Math.floor(time / 60);
    if (minute <= this.processedMinute) minute = this.processedMinute + 1;
    if (minute >= this.processedMinute + MINUTES_PER_DAY) minute = this.processedMinute + MINUTES_PER_DAY - 1;
    this.buckets[minute % MINUTES_PER_DAY].push(citizen * 4 + type);
  }

  /** Kör alla händelser till och med minuten som `time` ligger i. */
  advance(time: number, handle: (citizen: number, type: EventType) => void): void {
    const target = Math.floor(time / 60);
    while (this.processedMinute < target) {
      this.processedMinute++;
      const bucket = this.buckets[this.processedMinute % MINUTES_PER_DAY];
      for (let i = 0; i < bucket.length; i++) {
        const packed = bucket[i];
        handle(packed >> 2, (packed & 3) as EventType);
      }
      bucket.length = 0;
    }
  }
}
