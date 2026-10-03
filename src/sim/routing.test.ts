import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { Router } from './routing';

// Romb: 0 → 1 → 3 är snabb, 0 → 2 → 3 är långsam. Inga kanter tillbaka.
function diamond() {
  return buildGraph(
    [0, 100, 0, 100],
    [0, 0, 100, 100],
    [
      { from: 0, to: 1, lanes: 1, speed: 20 }, // e0
      { from: 1, to: 3, lanes: 1, speed: 20 }, // e1
      { from: 0, to: 2, lanes: 1, speed: 10 }, // e2
      { from: 2, to: 3, lanes: 1, speed: 10 }, // e3
    ],
  );
}

describe('Router', () => {
  it('picks the fastest next edge towards the destination', () => {
    const router = new Router(diamond());
    expect(router.nextEdge(3, 0)).toBe(0);
    expect(router.nextEdge(3, 1)).toBe(1);
    expect(router.nextEdge(3, 2)).toBe(3);
  });

  it('returns -1 when the destination cannot be reached', () => {
    const router = new Router(diamond());
    expect(router.nextEdge(0, 3)).toBe(-1);
  });

  it('reroutes around congestion after a refresh', () => {
    const router = new Router(diamond());
    expect(router.nextEdge(3, 0)).toBe(0);
    router.edgeCost[1] = 1000;
    expect(router.refresh(Infinity)).toBe(1);
    expect(router.nextEdge(3, 0)).toBe(2);
  });
});
