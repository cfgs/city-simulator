import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/config';
import { CitizenState } from './population';
import { Simulation } from './sim';

describe('Simulation', () => {
  it('runs a full commuting day: everyone gets to work and back home', () => {
    const population = 3000;
    const sim = new Simulation({ ...DEFAULT_CONFIG, gridSize: 64, population, carShare: 0.5 });
    let peakOnRoad = 0;

    while (sim.time < 13 * 3600) {
      sim.tick();
      peakOnRoad = Math.max(peakOnRoad, sim.traffic.onRoad);
    }
    expect(peakOnRoad).toBeGreaterThan(0);
    expect(sim.countInState(CitizenState.Work)).toBe(population);

    // Till kl 03 nästa natt
    while (sim.time < 27 * 3600) sim.tick();
    expect(sim.countInState(CitizenState.Home)).toBe(population);
    expect(sim.traffic.onRoad).toBe(0);
    expect(sim.traffic.waiting).toBe(0);
  });
});
