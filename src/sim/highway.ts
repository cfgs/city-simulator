import { pointAt, straight, tangentAt, type Point } from '../shared/geometry';
import { RoadType, type RoadNetwork } from '../shared/network';

/** Ungefärligt avstånd från kartans sydkant till motorvägen. */
const EDGE_OFFSET = 360;
/** Hur långt utanför kartan motorvägen fortsätter innan den "lämnar världen". */
const OUTSIDE = 300;
const EXIT_LENGTH = 90;
/** Avfarternas läge längs motorvägen, som andel av kartans bredd. */
const EXITS = [0.25, 0.5, 0.75];

/**
 * Bygger motorvägen längs kartans sydkant, med lätta svängar. Ändarna ligger utanför
 * kartan och är stadens förbindelse med omvärlden. Längs vägen finns färdiga avfarter:
 * korta låsta vägstumpar in mot kartan som spelaren ansluter sina vägar till.
 */
export function buildHighway(net: RoadNetwork): void {
  const S = net.mapSize;
  const z = S - EDGE_OFFSET;
  const pts: Point[] = [
    { x: -OUTSIDE, z: z + 30 },
    { x: S * 0.15, z: z + 30 },
    { x: S * 0.35, z: z - 70 },
    { x: S * 0.55, z: z - 20 },
    { x: S * 0.78, z: z + 70 },
    { x: S + OUTSIDE, z: z + 50 },
  ];
  // Mjuk kedja: mellanpunkterna blir kontrollpunkter och kurvorna möts mitt emellan dem.
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
  const joints = [pts[0], mid(pts[1], pts[2]), mid(pts[2], pts[3]), mid(pts[3], pts[4]), pts[5]];
  const nodes = joints.map((p) => net.addNode(p.x, p.z));
  for (let i = 0; i + 1 < joints.length; i++) {
    const a = joints[i];
    const b = joints[i + 1];
    const c = pts[i + 1];
    net.addSegment(nodes[i], nodes[i + 1], { ax: a.x, az: a.z, cx: c.x, cz: c.z, bx: b.x, bz: b.z }, RoadType.Highway, { locked: true });
  }
  net.outside = [nodes[0], nodes[nodes.length - 1]];

  for (const f of EXITS) {
    const x = S * f;
    const seg = [...net.segments.values()].find((s) => s.type === RoadType.Highway && s.poly.minX <= x && s.poly.maxX >= x)!;
    const t = solveX(seg.curve, x);
    const [junction] = net.splitSegment(seg.id, [t]);
    const dir = tangentAt(seg.curve, t);
    // Normalen som pekar in mot kartan (norrut, minskande z)
    const nx = dir.z;
    const nz = -dir.x;
    const sign = nz < 0 ? 1 : -1;
    const j = net.node(junction);
    const end = net.addNode(j.x + nx * sign * EXIT_LENGTH, j.z + nz * sign * EXIT_LENGTH);
    net.addSegment(junction, end, straight(j.x, j.z, net.node(end).x, net.node(end).z), RoadType.Avenue, { locked: true });
    net.exits.push(end);
  }
}

/** Kurvparametern där kurvan passerar x (kurvorna går monotont i x). */
function solveX(curve: Parameters<typeof pointAt>[0], x: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (pointAt(curve, m).x < x) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
