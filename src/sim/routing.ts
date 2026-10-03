import type { RoadGraph } from './graph';
import { MinHeap } from './heap';

/**
 * Vägval med ett "nästa kant"-träd per destination.
 *
 * I stället för att lagra en rutt per fordon räknas, för varje destination, ut vilken
 * kant man ska ta från varje korsning för att komma dit snabbast (omvänd Dijkstra).
 * Alla som ska till samma ställe delar trädet, och eftersom träden räknas om med aktuella
 * restider väljer fordonen automatiskt nya vägar runt köer, även mitt under resan.
 *
 * Minnet växer med (antal korsningar)², vilket sätter taket för kartstorleken – se PLAN.md.
 */
export class Router {
  /** Aktuell kostnad (förväntad restid i sekunder) per kant. Uppdateras av trafikmodellen. */
  readonly edgeCost: Float32Array;
  private readonly trees: (Int32Array | undefined)[];
  /** Destinationer som har ett träd, i den ordning de uppdateras. */
  private readonly built: number[] = [];
  private cursor = 0;
  private readonly dist: Float64Array;
  private readonly heap = new MinHeap();

  constructor(private readonly graph: RoadGraph) {
    this.edgeCost = Float32Array.from(graph.edgeFreeTime);
    this.trees = new Array(graph.nodeCount);
    this.dist = new Float64Array(graph.nodeCount);
  }

  get treeCount(): number {
    return this.built.length;
  }

  /** Kanten att ta från `node` mot `dest`, eller -1 om det inte finns någon väg. */
  nextEdge(dest: number, node: number): number {
    let tree = this.trees[dest];
    if (tree === undefined) {
      tree = new Int32Array(this.graph.nodeCount);
      this.compute(dest, tree);
      this.trees[dest] = tree;
      this.built.push(dest);
    }
    return tree[node];
  }

  /** Räknar om befintliga träd med aktuella kostnader, i tur och ordning, inom en tidsbudget. */
  refresh(budgetMs: number): number {
    const total = this.built.length;
    const start = performance.now();
    let n = 0;
    while (n < total && performance.now() - start < budgetMs) {
      if (this.cursor >= total) this.cursor = 0;
      const dest = this.built[this.cursor++];
      this.compute(dest, this.trees[dest]!);
      n++;
    }
    return n;
  }

  /** Omvänd Dijkstra från destinationen längs inkommande kanter. */
  private compute(dest: number, out: Int32Array): void {
    const { inStart, inEdges, edgeFrom } = this.graph;
    const cost = this.edgeCost;
    const dist = this.dist;
    const heap = this.heap;
    dist.fill(Infinity);
    out.fill(-1);
    dist[dest] = 0;
    heap.clear();
    heap.push(dest, 0);
    while (heap.size > 0) {
      const u = heap.pop();
      const du = heap.lastKey;
      if (du > dist[u]) continue;
      for (let k = inStart[u]; k < inStart[u + 1]; k++) {
        const e = inEdges[k];
        const v = edgeFrom[e];
        const nd = du + cost[e];
        if (nd < dist[v]) {
          dist[v] = nd;
          out[v] = e;
          heap.push(v, nd);
        }
      }
    }
  }
}
