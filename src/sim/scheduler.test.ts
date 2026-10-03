import { describe, expect, it } from 'vitest';
import { EventType, MinuteScheduler } from './scheduler';

function collect(scheduler: MinuteScheduler, time: number): [number, number][] {
  const seen: [number, number][] = [];
  scheduler.advance(time, (c, t) => seen.push([c, t]));
  return seen;
}

describe('MinuteScheduler', () => {
  it('fires events in the minute they are scheduled for', () => {
    const s = new MinuteScheduler(0);
    s.schedule(90, 1, EventType.DepartWork);
    s.schedule(30, 2, EventType.DepartHome);
    expect(collect(s, 59)).toEqual([[2, EventType.DepartHome]]);
    expect(collect(s, 119)).toEqual([[1, EventType.DepartWork]]);
  });

  it('moves events scheduled in the past to the next minute', () => {
    const s = new MinuteScheduler(0);
    collect(s, 119);
    s.schedule(10, 4, EventType.ArriveTransit);
    expect(collect(s, 179)).toEqual([[4, EventType.ArriveTransit]]);
  });

  it('wraps around midnight', () => {
    const s = new MinuteScheduler(86_340); // 23:59
    s.schedule(86_400 + 60, 7, EventType.DepartWork); // 00:01 nästa dag
    expect(collect(s, 86_399)).toEqual([]);
    expect(collect(s, 86_400 + 60)).toEqual([[7, EventType.DepartWork]]);
  });

  it('accepts events scheduled while handling another event', () => {
    const s = new MinuteScheduler(0);
    s.schedule(0, 1, EventType.DepartWork);
    s.advance(0, (c) => s.schedule(0, c + 1, EventType.DepartHome));
    expect(collect(s, 60)).toEqual([[2, EventType.DepartHome]]);
  });
});
