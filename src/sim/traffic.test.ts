import { describe, expect, it } from 'vitest';
import { VEH_STRIDE, V_EDGE, V_MAX, V_PROGRESS } from '../shared/protocol';
import { buildGraph, LANE_FLOW_CAP } from './graph';
import { Router } from './routing';
import { STUCK_TIME, Traffic } from './traffic';

/** Rak väg 0 → 1 → 2 med ett körfält. Längderna avgör hur många bilar som får plats. */
function line(firstLength: number, secondLength: number) {
  const graph = buildGraph(
    [0, firstLength, firstLength + secondLength],
    [0, 0, 0],
    [
      { from: 0, to: 1, lanes: 1, speed: 15 },
      { from: 1, to: 2, lanes: 1, speed: 15 },
    ],
  );
  const router = new Router(graph);
  return { graph, router };
}

function run(traffic: Traffic, from: number, until: number, onStep?: (now: number) => void): Map<number, number> {
  const arrivals = new Map<number, number>();
  for (let now = from; now <= until; now++) {
    traffic.step(now, 1);
    for (const v of traffic.arrived) arrivals.set(v, now);
    traffic.arrived.length = 0;
    onStep?.(now);
  }
  return arrivals;
}

describe('Traffic', () => {
  it('lets vehicles leave an edge no faster than its flow capacity', () => {
    const { graph, router } = line(150, 150);
    const traffic = new Traffic(graph, router, 6);
    for (let v = 0; v < 6; v++) traffic.depart(v, 0, 2, 0);
    const arrivals = run(traffic, 1, 200);

    expect(arrivals.size).toBe(6);
    expect(traffic.onRoad).toBe(0);
    const times = [...arrivals.values()].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1 / LANE_FLOW_CAP);
    // Ingen kan vara framme snabbare än den fria restiden för båda sträckorna.
    expect(times[0]).toBeGreaterThanOrEqual(2 * (150 / 15));
  });

  it('never overfills a downstream edge unless a vehicle has been stuck too long', () => {
    // Andra sträckan rymmer bara 2 bilar.
    const { graph, router } = line(300, 15);
    expect(graph.edgeStorage[1]).toBe(2);
    const traffic = new Traffic(graph, router, 30);
    for (let v = 0; v < 30; v++) traffic.depart(v, 0, 2, 0);
    let maxOnSecond = 0;
    const arrivals = run(traffic, 1, 2000, () => {
      maxOnSecond = Math.max(maxOnSecond, traffic.count[1]);
    });
    expect(arrivals.size).toBe(30);
    expect(maxOnSecond).toBeLessThanOrEqual(graph.edgeStorage[1]);
  });

  it('breaks a gridlock by forcing stuck vehicles onward after STUCK_TIME', () => {
    // Triangel 0 → 1 → 2 → 0 där varje sträcka rymmer en bil. Alla tre bilar vill vidare
    // till nästa sträcka, som är full – utan regeln står de still för alltid.
    const graph = buildGraph(
      [0, 10, 5],
      [0, 0, 8.66],
      [
        { from: 0, to: 1, lanes: 1, speed: 15 },
        { from: 1, to: 2, lanes: 1, speed: 15 },
        { from: 2, to: 0, lanes: 1, speed: 15 },
      ],
    );
    expect([...graph.edgeStorage]).toEqual([1, 1, 1]);
    const traffic = new Traffic(graph, new Router(graph), 3);
    traffic.depart(0, 0, 2, 0);
    traffic.depart(1, 1, 0, 0);
    traffic.depart(2, 2, 1, 0);

    const early = run(traffic, 1, STUCK_TIME - 5);
    expect(early.size).toBe(0);
    const later = run(traffic, STUCK_TIME - 4, STUCK_TIME + 30);
    expect(later.size).toBe(3);
  });

  it('refuses trips without a route', () => {
    const { graph, router } = line(100, 100);
    const traffic = new Traffic(graph, router, 1);
    expect(traffic.depart(0, 2, 0, 0)).toBe(false);
  });

  it('writes queued vehicles one car length apart in the snapshot', () => {
    const { graph, router } = line(300, 15);
    const traffic = new Traffic(graph, router, 10);
    for (let v = 0; v < 10; v++) traffic.depart(v, 0, 2, 0);
    run(traffic, 1, 30);
    const out = new Float32Array(10 * VEH_STRIDE);
    const load = new Float32Array(graph.edgeCount);
    const n = traffic.writeSnapshot(30, out, load);

    const onFirst = [];
    for (let i = 0; i < n; i++) {
      const o = i * VEH_STRIDE;
      expect(out[o + V_PROGRESS]).toBeLessThanOrEqual(out[o + V_MAX]);
      if (out[o + V_EDGE] === 0) onFirst.push(out[o + V_MAX]);
    }
    expect(onFirst.length).toBeGreaterThan(2);
    for (let i = 1; i < onFirst.length; i++) expect(onFirst[i - 1] - onFirst[i]).toBeCloseTo(7.5 / 300, 5);
    for (let e = 0; e < graph.edgeCount; e++) expect(load[e]).toBeCloseTo(traffic.count[e] / graph.edgeStorage[e], 6);
  });
});
