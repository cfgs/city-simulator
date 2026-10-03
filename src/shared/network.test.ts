import { describe, expect, it } from 'vitest';
import { straight } from './geometry';
import { RoadNetwork, RoadType } from './network';

function road(net: RoadNetwork, ax: number, az: number, bx: number, bz: number): number {
  const a = net.addNode(ax, az);
  const b = net.addNode(bx, bz);
  return net.addSegment(a, b, straight(ax, az, bx, bz), RoadType.Street);
}

describe('RoadNetwork', () => {
  it('splits a road into pieces with new junctions', () => {
    const net = new RoadNetwork(1000);
    const seg = road(net, 100, 100, 400, 100);
    const ids = net.splitSegment(seg, [0.25, 0.5]);
    expect(ids).toHaveLength(2);
    expect(net.segments.size).toBe(3);
    expect(net.nodes.size).toBe(4);
    expect(net.node(ids[0]).x).toBeCloseTo(175);
    expect(net.node(ids[1]).segs).toHaveLength(2);
    expect(net.segments.has(seg)).toBe(false);
  });

  it('removes junctions that no longer have any roads', () => {
    const net = new RoadNetwork(1000);
    const seg = road(net, 100, 100, 400, 100);
    net.removeSegment(seg);
    expect(net.nodes.size).toBe(0);
  });

  it('finds the nearest road and junction', () => {
    const net = new RoadNetwork(1000);
    const seg = road(net, 100, 100, 400, 100);
    expect(net.nearestSegment(250, 105, 8)?.seg).toBe(seg);
    expect(net.nearestSegment(250, 120, 8)).toBeNull();
    expect(net.nearestNode(103, 98, 10)?.x).toBe(100);
  });

  it('survives a round trip through its transfer format', () => {
    const net = new RoadNetwork(1000);
    road(net, 100, 100, 400, 100);
    const seg = road(net, 200, 300, 500, 300);
    net.splitSegment(seg, [0.5]);
    const copy = RoadNetwork.fromData(net.toData());
    expect([...copy.nodes.keys()]).toEqual([...net.nodes.keys()]);
    expect([...copy.segments.keys()]).toEqual([...net.segments.keys()]);
    for (const [id, s] of net.segments) {
      expect(copy.segments.get(id)!.poly.length).toBeCloseTo(s.poly.length, 3);
      expect(copy.segments.get(id)!.seq).toBe(s.seq);
    }
    // Nya id:n fortsätter efter de kopierade
    expect(copy.addNode(0, 0)).toBe(Math.max(...net.nodes.keys()) + 1);
  });
});
