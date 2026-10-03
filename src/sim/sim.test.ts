import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/config';
import { straight } from '../shared/geometry';
import { RoadType } from '../shared/network';
import { ZoneType } from '../shared/zones';
import { buildDemo } from './demo';
import { CitizenState } from './population';
import { Simulation } from './sim';

/** Ett litet rutnät 4×4 kvarter med bostäder i väster och jobb i öster. */
function smallTown(): Simulation {
  const sim = new Simulation({ ...DEFAULT_CONFIG, mapSize: 2000, carShare: 0.6, startHour: 0 });
  const lines = [400, 472, 544, 616, 688];
  sim.buildRoads(lines.map((x) => [straight(x, 400, x, 688)]), RoadType.Street);
  sim.buildRoads(lines.map((z) => [straight(400, z, 688, z)]), RoadType.Street);
  sim.zoneAll((x) => (x < 544 ? ZoneType.Residential : x < 616 ? ZoneType.Commercial : ZoneType.Industrial));
  return sim;
}

function runUntil(sim: Simulation, hour: number, onTick?: () => void): void {
  while (sim.time < hour * 3600) {
    sim.tick();
    onTick?.();
  }
}

function checkInvariants(sim: Simulation): void {
  const p = sim.people;
  const states = p.stateCount.reduce((a, b) => a + b, 0);
  expect(states).toBe(p.count);
  expect(sim.traffic.onRoad).toBeGreaterThanOrEqual(0);
  expect(p.count).toBe(sim.buildings.totalHomes);
  let employed = 0;
  for (let c = 0; c < p.slots; c++) if (p.alive[c] && p.work[c] >= 0) employed++;
  expect(employed).toBe(sim.buildings.filledJobs);
}

describe('Simulation', () => {
  it('grows buildings on zoned land and runs a commuting day', () => {
    const sim = smallTown();
    expect(sim.net.nodes.size).toBe(25);
    runUntil(sim, 5);
    expect(sim.buildings.count).toBeGreaterThan(50);
    expect(sim.people.count).toBeGreaterThan(200);
    checkInvariants(sim);

    let peakOnRoad = 0;
    runUntil(sim, 13, () => (peakOnRoad = Math.max(peakOnRoad, sim.traffic.onRoad)));
    expect(peakOnRoad).toBeGreaterThan(0);
    expect(sim.people.stateCount[CitizenState.Work]).toBeGreaterThan(0);

    runUntil(sim, 27);
    const p = sim.people;
    expect(p.stateCount[CitizenState.Home]).toBe(p.count);
    expect(sim.traffic.onRoad).toBe(0);
    checkInvariants(sim);
  });

  it('keeps going when roads are bulldozed during rush hour', () => {
    const sim = smallTown();
    runUntil(sim, 8);
    expect(sim.traffic.onRoad + sim.traffic.waiting).toBeGreaterThan(0);
    const victims = [...sim.net.segments.keys()].filter((_, i) => i % 5 === 0);
    sim.bulldoze(victims);
    checkInvariants(sim);
    runUntil(sim, 27);
    checkInvariants(sim);
    expect(sim.people.stateCount[CitizenState.ToWork] + sim.people.stateCount[CitizenState.ToHome]).toBe(0);
  });

  it('keeps cars in their queues when an unrelated road is added', () => {
    const sim = smallTown();
    runUntil(sim, 8);
    const before = sim.traffic.onRoad;
    sim.buildRoads([[straight(1200, 1200, 1400, 1200)]], RoadType.Street);
    expect(sim.traffic.onRoad).toBe(before);
    checkInvariants(sim);
  });

  it('builds the demo city', () => {
    const sim = new Simulation(DEFAULT_CONFIG);
    buildDemo(sim);
    expect(sim.net.segments.size).toBeGreaterThan(1000);
    expect(sim.buildings.count).toBeGreaterThan(5000);
    expect(sim.people.count).toBeGreaterThan(50_000);
    checkInvariants(sim);
  });
});
