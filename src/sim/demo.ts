import { straight, type Quad } from '../shared/geometry';
import { RoadType } from '../shared/network';
import { ZoneType } from '../shared/zones';
import type { Simulation } from './sim';

const BLOCK = 72;
const GRID_HALF = 14 * BLOCK;
const RING_RADIUS = 1500;

/**
 * Bygger en färdig stad för prestandatest (?demo) – med samma verktyg som spelaren:
 * ett rutnät med huvudleder, en ringväg av kurvor och fyra infarter. Allt zonas och
 * byggs ut direkt.
 */
export function buildDemo(sim: Simulation): void {
  const c = sim.net.mapSize / 2;
  const lines: number[] = [];
  for (let p = c - GRID_HALF; p <= c + GRID_HALF; p += BLOCK) lines.push(p);
  const lo = lines[0];
  const hi = lines[lines.length - 1];

  for (const type of [RoadType.Avenue, RoadType.Street]) {
    const pick = (i: number) => (i % 4 === 0) === (type === RoadType.Avenue);
    sim.buildRoads(
      lines.filter((_, i) => pick(i)).map((x) => [straight(x, lo, x, hi)]),
      type,
    );
  }
  for (const type of [RoadType.Avenue, RoadType.Street]) {
    const pick = (i: number) => (i % 4 === 0) === (type === RoadType.Avenue);
    sim.buildRoads(
      lines.filter((_, i) => pick(i)).map((z) => [straight(lo, z, hi, z)]),
      type,
    );
  }

  // Ringväg: åtta kurvor runt rutnätet
  const ring: Quad[] = [];
  const step = Math.PI / 4;
  const controlRadius = RING_RADIUS / Math.cos(step / 2);
  for (let k = 0; k < 8; k++) {
    const a0 = k * step;
    const a1 = a0 + step;
    const am = a0 + step / 2;
    ring.push({
      ax: c + RING_RADIUS * Math.cos(a0),
      az: c + RING_RADIUS * Math.sin(a0),
      cx: c + controlRadius * Math.cos(am),
      cz: c + controlRadius * Math.sin(am),
      bx: c + RING_RADIUS * Math.cos(a1),
      bz: c + RING_RADIUS * Math.sin(a1),
    });
  }
  sim.buildRoads([ring], RoadType.Avenue);
  sim.buildRoads(
    [
      [straight(hi, c, c + RING_RADIUS, c)],
      [straight(lo, c, c - RING_RADIUS, c)],
      [straight(c, hi, c, c + RING_RADIUS)],
      [straight(c, lo, c, c - RING_RADIUS)],
    ],
    RoadType.Avenue,
  );

  // Anslut motorvägens avfarter till ringvägen, annars kan ingen flytta in
  sim.buildRoads(
    sim.net.exits.map((id) => {
      const exit = sim.net.node(id);
      const d = Math.hypot(exit.x - c, exit.z - c);
      const ring = { x: c + ((exit.x - c) * RING_RADIUS) / d, z: c + ((exit.z - c) * RING_RADIUS) / d };
      return [straight(exit.x, exit.z, ring.x, ring.z)];
    }),
    RoadType.Avenue,
  );

  // Handel i centrum, industriområden i öster och väster, bostäder i övrigt.
  // Ytorna är valda så att antalet jobb ungefär motsvarar antalet invånare.
  sim.zoneAll((x, z) => {
    const d = Math.hypot(x - c, z - c);
    if (d < 560) return ZoneType.Commercial;
    if (Math.abs(x - c) > 560 && Math.abs(z - c) < 640 && d < 1100) return ZoneType.Industrial;
    return ZoneType.Residential;
  });
  sim.growAll();
}
