import { describe, expect, it } from 'vitest';
import { straight, type Quad } from './geometry';
import { RoadNetwork, RoadType } from './network';
import { applyPlan, planRoad } from './roadplan';

function build(net: RoadNetwork, curves: Quad[], type: RoadType = RoadType.Street) {
  const plan = planRoad(net, curves, type);
  if (plan.valid) applyPlan(net, plan);
  return plan;
}

const degrees = (n: number) => (n * Math.PI) / 180;

describe('planRoad / applyPlan', () => {
  it('builds a single road on an empty map', () => {
    const net = new RoadNetwork(1000);
    expect(build(net, [straight(100, 100, 400, 100)]).valid).toBe(true);
    expect(net.nodes.size).toBe(2);
    expect(net.segments.size).toBe(1);
  });

  it('creates a junction where two roads cross', () => {
    const net = new RoadNetwork(1000);
    build(net, [straight(100, 200, 400, 200)]);
    const plan = build(net, [straight(250, 50, 250, 350)]);
    expect(plan.valid).toBe(true);
    expect(plan.curves[0].stops.map((s) => s.ref.kind)).toEqual(['new', 'split', 'new']);
    expect(net.nodes.size).toBe(5);
    expect(net.segments.size).toBe(4);
    const center = net.nearestNode(250, 200, 1)!;
    expect(center.segs).toHaveLength(4);
  });

  it('snaps a road ending next to another road into a T-junction', () => {
    const net = new RoadNetwork(1000);
    build(net, [straight(100, 200, 400, 200)]);
    build(net, [straight(250, 50, 250, 195)]);
    expect(net.nodes.size).toBe(4);
    expect(net.segments.size).toBe(3);
    expect(net.nearestNode(250, 200, 1)!.segs).toHaveLength(3);
  });

  it('connects to an existing junction instead of making a new one next to it', () => {
    const net = new RoadNetwork(1000);
    build(net, [straight(100, 200, 400, 200)]);
    build(net, [straight(104, 203, 104, 450)]);
    expect(net.nodes.size).toBe(3);
    expect(net.node([...net.nodes.keys()][0]).segs).toHaveLength(2);
  });

  it('rejects crossings at a sharp angle', () => {
    const net = new RoadNetwork(1000);
    build(net, [straight(100, 200, 500, 200)]);
    const dz = Math.tan(degrees(10)) * 300;
    const plan = planRoad(net, [straight(150, 200 - dz / 2, 450, 200 + dz / 2)], RoadType.Street);
    expect(plan.valid).toBe(false);
    expect(plan.reason).toMatch(/vinkel/);
  });

  it('rejects a road running right next to another', () => {
    const net = new RoadNetwork(1000);
    build(net, [straight(100, 200, 500, 200)]);
    // Böjer in till 6 m från den befintliga vägen utan att korsa den
    expect(planRoad(net, [{ ax: 150, az: 230, cx: 300, cz: 182, bx: 450, bz: 230 }], RoadType.Street).reason).toMatch(/nära/);
    // Rak parallell väg 6 m bort fäster mot den befintliga och blir en spetsig korsning
    expect(planRoad(net, [straight(150, 206, 450, 206)], RoadType.Street).valid).toBe(false);
    expect(planRoad(net, [straight(150, 240, 450, 240)], RoadType.Street).valid).toBe(true);
  });

  it('rejects curves that are too tight', () => {
    const net = new RoadNetwork(1000);
    expect(planRoad(net, [{ ax: 100, az: 100, cx: 140, cz: 115, bx: 100, bz: 130 }], RoadType.Street).reason).toMatch(/kurva/);
  });

  it('rejects roads outside the map', () => {
    const net = new RoadNetwork(1000);
    expect(planRoad(net, [straight(100, 100, 1200, 100)], RoadType.Street).valid).toBe(false);
  });

  it('builds a curved chain with shared joints', () => {
    const net = new RoadNetwork(1000);
    const plan = build(net, [
      { ax: 100, az: 100, cx: 200, cz: 100, bx: 250, bz: 150 },
      { ax: 250, az: 150, cx: 300, cz: 200, bx: 300, bz: 300 },
    ]);
    expect(plan.valid).toBe(true);
    expect(net.segments.size).toBe(2);
    expect(net.nodes.size).toBe(3);
  });

  it('lets a diagonal pass through a grid, snapping to junctions it passes close to', () => {
    const net = new RoadNetwork(1000);
    const lines = [100, 172, 244, 316, 388, 460, 532, 604];
    for (const x of lines) build(net, [straight(x, 100, x, 604)]);
    for (const z of lines) build(net, [straight(100, z, 604, z)]);
    const before = net.nodes.size;
    // Nästan 45°: passerar ett par meter från flera korsningar och korsar resten mitt på gatorna
    const plan = build(net, [straight(125, 140, 590, 580)]);
    expect(plan.valid).toBe(true);
    expect(net.nodes.size).toBeGreaterThan(before);
    for (const node of net.nodes.values()) for (const s of node.segs) expect(net.segments.has(s)).toBe(true);
  });

  it('keeps a straight road straight when its ends snap to nearby junctions', () => {
    const net = new RoadNetwork(4096);
    const lines: number[] = [];
    for (let p = 1040; p <= 3056; p += 72) lines.push(p);
    for (const x of lines) build(net, [straight(x, 1040, x, 3056)]);
    for (const z of lines) build(net, [straight(1040, z, 3056, z)]);
    // Samma diagonal som i demostaden, som tidigare nekades som "för skarp kurva"
    expect(planRoad(net, [straight(1830, 1870, 2290, 2300)], RoadType.Street).valid).toBe(true);
    expect(planRoad(net, [straight(1300, 1350, 2790, 2770)], RoadType.Street).valid).toBe(true);
  });

  it('builds a grid line by line with junctions at every crossing', () => {
    const net = new RoadNetwork(1000);
    const lines = [100, 172, 244];
    for (const x of lines) expect(build(net, [straight(x, 100, x, 244)]).valid).toBe(true);
    for (const z of lines) expect(build(net, [straight(100, z, 244, z)]).valid).toBe(true);
    expect(net.nodes.size).toBe(9);
    expect(net.segments.size).toBe(12);
    expect(net.nearestNode(172, 172, 1)!.segs).toHaveLength(4);
  });
});

describe('motorvägen', () => {
  function withHighway() {
    const net = new RoadNetwork(1000);
    const a = net.addNode(-100, 800);
    const b = net.addNode(1100, 800);
    net.addSegment(a, b, straight(-100, 800, 1100, 800), RoadType.Highway, { locked: true });
    const [j] = net.splitSegment([...net.segments.keys()][0], [0.5]);
    const end = net.addNode(500, 710);
    net.addSegment(j, end, straight(500, 800, 500, 710), RoadType.Avenue, { locked: true });
    net.exits.push(end);
    return { net, exit: net.node(end) };
  }

  it('cannot be crossed', () => {
    const { net } = withHighway();
    expect(planRoad(net, [straight(300, 600, 300, 950)], RoadType.Street).reason).toMatch(/Motorvägen/);
  });

  it('cannot be connected to except at an exit', () => {
    const { net } = withHighway();
    expect(planRoad(net, [straight(300, 600, 300, 798)], RoadType.Street).valid).toBe(false);
  });

  it('connects at an exit', () => {
    const { net, exit } = withHighway();
    const plan = build(net, [straight(300, 600, exit.x, exit.z)]);
    expect(plan.valid).toBe(true);
    expect(net.node(net.exits[0]).segs).toHaveLength(2);
  });
});
