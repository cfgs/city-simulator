import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../shared/config';
import { straight } from '../shared/geometry';
import { RoadType } from '../shared/network';
import { CELL, DEPTH, ZoneType } from '../shared/zones';
import { Simulation } from './sim';

function newSim() {
  return new Simulation({ ...DEFAULT_CONFIG, mapSize: 2000, outsideConnection: false });
}

function cellsOf(sim: Simulation, segId: number) {
  return [...sim.zoning.bySeg.get(segId)!.cells].filter((c) => c >= 0);
}

describe('Zoning', () => {
  it('lines both sides of a road with cells, DEPTH rows deep', () => {
    const sim = newSim();
    sim.buildRoads([[straight(400, 400, 800, 400)]], RoadType.Street);
    const [seg] = sim.net.segments.keys();
    const cols = Math.floor(400 / CELL);
    expect(cellsOf(sim, seg)).toHaveLength(cols * 2 * DEPTH);
    // Första raden ligger precis utanför vägkanten
    const c = cellsOf(sim, seg)[0];
    expect(Math.abs(sim.zoning.z[c] - 400)).toBeCloseTo(3.5 + 0.5 + CELL / 2, 3);
  });

  it('removes cells under a new crossing road but keeps zoning elsewhere', () => {
    const sim = newSim();
    sim.buildRoads([[straight(400, 400, 800, 400)]], RoadType.Street);
    sim.zone(500, 410, 30, ZoneType.Residential);
    const zonedBefore = countZoned(sim);
    expect(zonedBefore).toBeGreaterThan(10);

    sim.buildRoads([[straight(600, 300, 600, 500)]], RoadType.Street);
    // Inga celler får ligga på den nya vägen
    for (let c = 0; c < sim.zoning.slots; c++) {
      if (sim.zoning.alive[c]) expect(Math.abs(sim.zoning.x[c] - 600)).toBeGreaterThan(3.5);
    }
    // Zonerna vid x≈500 ligger långt från den nya vägen och ska ha ärvts
    expect(countZoned(sim)).toBe(zonedBefore);
  });

  it('only offers front-row zoned cells without buildings for growth', () => {
    const sim = newSim();
    sim.buildRoads([[straight(400, 400, 800, 400)]], RoadType.Street);
    sim.zone(600, 420, 40, ZoneType.Commercial);
    expect(sim.zoning.candidates.size).toBeGreaterThan(0);
    for (const c of sim.zoning.candidates) {
      expect(sim.zoning.depth[c]).toBe(0);
      expect(sim.zoning.zone[c]).toBe(ZoneType.Commercial);
    }
  });

  it('demolishes buildings when a road is built through them', () => {
    const sim = newSim();
    sim.buildRoads([[straight(400, 400, 800, 400)]], RoadType.Street);
    sim.zone(600, 420, 60, ZoneType.Residential);
    sim.growAll();
    const before = sim.buildings.count;
    expect(before).toBeGreaterThan(0);
    expect(sim.people.count).toBe(sim.buildings.totalHomes);

    sim.buildRoads([[straight(600, 300, 600, 500)]], RoadType.Street);
    expect(sim.buildings.count).toBeLessThan(before);
    expect(sim.people.count).toBe(sim.buildings.totalHomes);
  });
});

function countZoned(sim: Simulation): number {
  let n = 0;
  for (let c = 0; c < sim.zoning.slots; c++) if (sim.zoning.alive[c] && sim.zoning.zone[c] !== ZoneType.None) n++;
  return n;
}
