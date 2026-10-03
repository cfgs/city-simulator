import * as THREE from 'three';

export type Rgb = readonly [number, number, number];

/** Bygger ihop platta ytor (vägar, korsningar, förhandsvisningar) till en BufferGeometry. */
export class MeshBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(x: number, y: number, z: number, color: Rgb): number {
    this.positions.push(x, y, z);
    this.colors.push(color[0], color[1], color[2]);
    return this.vertexCount - 1;
  }

  /** Triangel som alltid vänds uppåt (synlig ovanifrån). */
  triUp(a: number, b: number, c: number): void {
    const p = this.positions;
    const ux = p[b * 3] - p[a * 3];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    // y-komponenten av u × v
    if (uz * vx - ux * vz >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  /**
   * Remsa längs punkterna (x, z, tx, tz per punkt), från `from` till `to` meter åt höger
   * om färdriktningen. Negativa värden ligger till vänster.
   */
  ribbon(samples: Float32Array, from: number, to: number, y: number, color: Rgb): void {
    const n = samples.length / 4;
    let prevL = -1;
    let prevR = -1;
    for (let i = 0; i < n; i++) {
      const x = samples[i * 4];
      const z = samples[i * 4 + 1];
      const nx = -samples[i * 4 + 3];
      const nz = samples[i * 4 + 2];
      const l = this.vertex(x + nx * from, y, z + nz * from, color);
      const r = this.vertex(x + nx * to, y, z + nz * to, color);
      if (i > 0) {
        this.triUp(prevL, r, prevR);
        this.triUp(prevL, l, r);
      }
      prevL = l;
      prevR = r;
    }
  }

  /** Fylld konvex yta runt punkterna. */
  convex(points: [number, number][], y: number, color: Rgb): void {
    const hull = convexHull(points);
    if (hull.length < 3) return;
    const ids = hull.map(([x, z]) => this.vertex(x, y, z, color));
    for (let i = 1; i + 1 < ids.length; i++) this.triUp(ids[0], ids[i], ids[i + 1]);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const n = this.vertexCount;
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.indices, 1) : new THREE.Uint16BufferAttribute(this.indices, 1));
    return geometry;
  }
}

/** Konvext hölje (monotone chain). */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** sRGB-färg som linjära värden (det three.js räknar med). */
export function rgb(hex: number): Rgb {
  const c = new THREE.Color().setHex(hex);
  return [c.r, c.g, c.b];
}
