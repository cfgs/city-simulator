import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/config';
import { generateWorld, Zone } from './mapgen';

const config = { ...DEFAULT_CONFIG, gridSize: 96, population: 5000 };

describe('generateWorld', () => {
  const world = generateWorld(config);
  const { graph, buildings } = world;

  it('produces a road network where every intersection can reach every other', () => {
    const seen = new Uint8Array(graph.nodeCount);
    const stack = [0];
    seen[0] = 1;
    while (stack.length > 0) {
      const n = stack.pop()!;
      for (let k = graph.outStart[n]; k < graph.outStart[n + 1]; k++) {
        const to = graph.edgeTo[graph.outEdges[k]];
        if (!seen[to]) {
          seen[to] = 1;
          stack.push(to);
        }
      }
    }
    expect(graph.nodeCount).toBeGreaterThan(10);
    expect(seen.every((s) => s === 1)).toBe(true);
  });

  it('houses exactly the configured population and has enough jobs', () => {
    let homes = 0;
    let jobs = 0;
    for (let i = 0; i < buildings.count; i++) {
      if (buildings.zone[i] === Zone.Residential) homes += buildings.capacity[i];
      else jobs += buildings.capacity[i];
    }
    expect(homes).toBe(config.population);
    expect(jobs).toBeGreaterThanOrEqual(config.population);
  });

  it('connects every building to an intersection', () => {
    for (let i = 0; i < buildings.count; i++) {
      expect(buildings.accessNode[i]).toBeGreaterThanOrEqual(0);
      expect(buildings.accessNode[i]).toBeLessThan(graph.nodeCount);
    }
  });

  it('is deterministic for a given seed', () => {
    const again = generateWorld(config);
    expect(again.graph.edgeCount).toBe(graph.edgeCount);
    expect([...again.buildings.capacity]).toEqual([...buildings.capacity]);
  });
});
