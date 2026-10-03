import { describe, expect, it } from 'vitest';
import { closestPoint, crossings, minRadius, pointAt, sampleQuad, splitQuad, straight, subQuad, type Quad } from './geometry';

const bend: Quad = { ax: 0, az: 0, cx: 50, cz: 100, bx: 100, bz: 0 };

describe('geometry', () => {
  it('splits a curve exactly at t', () => {
    const [left, right] = splitQuad(bend, 0.3);
    const p = pointAt(bend, 0.3);
    expect(left.bx).toBeCloseTo(p.x);
    expect(left.bz).toBeCloseTo(p.z);
    expect(right.ax).toBeCloseTo(p.x);
    // Andra halvans mittpunkt ska ligga på originalkurvan
    const mid = pointAt(right, 0.5);
    const original = pointAt(bend, 0.3 + 0.7 * 0.5);
    expect(mid.x).toBeCloseTo(original.x);
    expect(mid.z).toBeCloseTo(original.z);
  });

  it('extracts the part of a curve between two parameters', () => {
    const part = subQuad(bend, 0.25, 0.75);
    expect(part.ax).toBeCloseTo(pointAt(bend, 0.25).x);
    expect(part.bz).toBeCloseTo(pointAt(bend, 0.75).z);
    expect(pointAt(part, 0.5).x).toBeCloseTo(pointAt(bend, 0.5).x);
  });

  it('finds where two roads cross', () => {
    const a = sampleQuad(straight(0, 50, 100, 50));
    const b = sampleQuad(straight(30, 0, 30, 100));
    const hits = crossings(a, b);
    expect(hits).toHaveLength(1);
    expect(hits[0].x).toBeCloseTo(30);
    expect(hits[0].z).toBeCloseTo(50);
    expect(hits[0].ta).toBeCloseTo(0.3, 2);
    expect(hits[0].tb).toBeCloseTo(0.5, 2);
  });

  it('finds the closest point on a road', () => {
    const hit = closestPoint(sampleQuad(straight(0, 0, 100, 0)), 40, 7);
    expect(hit.dist).toBeCloseTo(7);
    expect(hit.s).toBeCloseTo(40);
    expect(hit.t).toBeCloseTo(0.4, 2);
  });

  it('estimates curve radius', () => {
    expect(minRadius(sampleQuad(straight(0, 0, 100, 0)))).toBe(Infinity);
    // Krökningsradien i spetsen av den här kurvan är exakt 10 m.
    const tight = sampleQuad({ ax: 0, az: 0, cx: 10, cz: 10, bx: 0, bz: 20 });
    expect(minRadius(tight)).toBeCloseTo(10, 0);
  });
});
