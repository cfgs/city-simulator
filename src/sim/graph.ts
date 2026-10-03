/** Meter som ett fordon tar upp i en kö (bil + avstånd). */
export const VEHICLE_SPACING = 7.5;
/** Fordon per sekund och körfält som kan lämna en vägkant (1800 per timme). */
export const LANE_FLOW_CAP = 0.5;
export const LANE_WIDTH = 3.5;

export interface EdgeSpec {
  from: number;
  to: number;
  lanes: number;
  /** Meter per sekund. */
  speed: number;
}

/**
 * Vägnätet som riktad graf. Noder är korsningar, kanter är vägsträckor i en riktning.
 * Allt ligger i typade arrayer (struct-of-arrays) för att undvika GC-pauser.
 * Grannlistor i CSR-format: utgående kanter från nod n är outEdges[outStart[n] .. outStart[n + 1]).
 */
export interface RoadGraph {
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
    const length = Math.hypot(nodeX[to] - nodeX[from], nodeZ[to] - nodeZ[from]);
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

  return {
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
  };
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
