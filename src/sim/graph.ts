import { ROAD_SPECS, type RoadNetwork } from '../shared/network';

/** Meter som ett fordon tar upp i en kö (bil + avstånd). */
export const VEHICLE_SPACING = 7.5;
/** Fordon per sekund och körfält som kan lämna en vägkant (1800 per timme). */
export const LANE_FLOW_CAP = 0.5;

export interface EdgeSpec {
  from: number;
  to: number;
  lanes: number;
  /** Meter per sekund. */
  speed: number;
  /** Längd i meter. Utelämnad = rakt avstånd mellan noderna. */
  length?: number;
}

/**
 * Vägnätet som riktad graf med täta index, optimerad för simuleringen. Byggs om från
 * RoadNetwork vid varje ändring. Allt ligger i typade arrayer (struct-of-arrays).
 *
 * Kant e hör till vägsträckan med tätt index e >> 1, i riktning e & 1 (0 = a → b).
 * Grannlistor i CSR-format: utgående kanter från nod n är outEdges[outStart[n] .. outStart[n + 1]).
 */
export interface RoadGraph {
  /** Vägnätets version som grafen byggdes från. */
  version: number;
  nodeCount: number;
  nodeX: Float32Array;
  nodeZ: Float32Array;
  edgeCount: number;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeLength: Float32Array;
  edgeLanes: Uint8Array;
  /** Restid i sekunder utan trafik. */
  edgeFreeTime: Float32Array;
  /** Fordon per sekund som kan lämna kanten. */
  edgeFlowCap: Float32Array;
  /** Antal fordon som får plats på kanten. */
  edgeStorage: Int32Array;
  outStart: Int32Array;
  outEdges: Int32Array;
  inStart: Int32Array;
  inEdges: Int32Array;
  /** Stabilt id per tät nod och per tät vägsträcka. */
  nodeStable: Int32Array;
  segStable: Int32Array;
  /** Tätt index per stabilt id, −1 om det inte finns. */
  denseNode: Int32Array;
  denseSeg: Int32Array;
}

export function buildGraph(nodeX: ArrayLike<number>, nodeZ: ArrayLike<number>, edges: EdgeSpec[]): RoadGraph {
  const nodeCount = nodeX.length;
  const edgeCount = edges.length;
  const edgeFrom = new Int32Array(edgeCount);
  const edgeTo = new Int32Array(edgeCount);
  const edgeLength = new Float32Array(edgeCount);
  const edgeLanes = new Uint8Array(edgeCount);
  const edgeFreeTime = new Float32Array(edgeCount);
  const edgeFlowCap = new Float32Array(edgeCount);
  const edgeStorage = new Int32Array(edgeCount);

  for (let e = 0; e < edgeCount; e++) {
    const { from, to, lanes, speed } = edges[e];
    const length = edges[e].length ?? Math.hypot(nodeX[to] - nodeX[from], nodeZ[to] - nodeZ[from]);
    edgeFrom[e] = from;
    edgeTo[e] = to;
    edgeLength[e] = length;
    edgeLanes[e] = lanes;
    edgeFreeTime[e] = Math.max(1, length / speed);
    edgeFlowCap[e] = lanes * LANE_FLOW_CAP;
    edgeStorage[e] = Math.max(1, Math.floor((lanes * length) / VEHICLE_SPACING));
  }

  const [outStart, outEdges] = buildCsr(nodeCount, edgeFrom);
  const [inStart, inEdges] = buildCsr(nodeCount, edgeTo);
  const identity = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
  const segCount = Math.ceil(edgeCount / 2);

  return {
    version: 0,
    nodeCount,
    nodeX: Float32Array.from(nodeX),
    nodeZ: Float32Array.from(nodeZ),
    edgeCount,
    edgeFrom,
    edgeTo,
    edgeLength,
    edgeLanes,
    edgeFreeTime,
    edgeFlowCap,
    edgeStorage,
    outStart,
    outEdges,
    inStart,
    inEdges,
    nodeStable: identity(nodeCount),
    segStable: identity(segCount),
    denseNode: identity(nodeCount),
    denseSeg: identity(segCount),
  };
}

/** Bygger simuleringens graf från vägnätet. Täta index följer vägnätets id-ordning. */
export function graphFromNetwork(net: RoadNetwork): RoadGraph {
  const nodes = [...net.nodes.values()];
  const segs = [...net.segments.values()];
  const denseNode = new Int32Array(nodes.length > 0 ? nodes[nodes.length - 1].id + 1 : 0).fill(-1);
  nodes.forEach((n, i) => (denseNode[n.id] = i));
  const denseSeg = new Int32Array(segs.length > 0 ? segs[segs.length - 1].id + 1 : 0).fill(-1);
  const edges: EdgeSpec[] = [];
  segs.forEach((s, k) => {
    denseSeg[s.id] = k;
    const { lanes, speed } = ROAD_SPECS[s.type];
    const length = s.poly.length;
    edges.push({ from: denseNode[s.a], to: denseNode[s.b], lanes, speed, length }, { from: denseNode[s.b], to: denseNode[s.a], lanes, speed, length });
  });
  const graph = buildGraph(
    nodes.map((n) => n.x),
    nodes.map((n) => n.z),
    edges,
  );
  graph.version = net.version;
  graph.nodeStable = Int32Array.from(nodes, (n) => n.id);
  graph.segStable = Int32Array.from(segs, (s) => s.id);
  graph.denseNode = denseNode;
  graph.denseSeg = denseSeg;
  return graph;
}

/** Tätt nodindex för ett stabilt id, eller −1. */
export function denseNodeOf(graph: RoadGraph, stableId: number): number {
  return stableId >= 0 && stableId < graph.denseNode.length ? graph.denseNode[stableId] : -1;
}

/** Grupperar kanter per nod (nodeOf[e] anger vilken nod kanten hör till). */
function buildCsr(nodeCount: number, nodeOf: Int32Array): [Int32Array, Int32Array] {
  const start = new Int32Array(nodeCount + 1);
  for (let e = 0; e < nodeOf.length; e++) start[nodeOf[e] + 1]++;
  for (let n = 0; n < nodeCount; n++) start[n + 1] += start[n];
  const cursor = start.slice(0, nodeCount);
  const list = new Int32Array(nodeOf.length);
  for (let e = 0; e < nodeOf.length; e++) list[cursor[nodeOf[e]]++] = e;
  return [start, list];
}
