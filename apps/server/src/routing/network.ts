import type { LngLat, RoadState } from '@bastion/shared';
import type { RoadTopology } from './topology';

export interface Route {
  /** edges in travel order */
  edgeIds: string[];
  /** node ids in travel order, including both ends */
  nodeIds: string[];
  /** polyline in travel order */
  geometry: LngLat[];
  seconds: number;
  lengthM: number;
}

/** Whether an edge in this state can be driven. */
export function isPassable(state: RoadState | null | undefined): boolean {
  if (!state || state.status === 'open') return true;
  return state.speedFactor !== undefined && state.speedFactor > 0;
}

/** Binary min-heap of (node, key) pairs on typed arrays, with lazy deletion. */
class MinHeap {
  private nodes: Int32Array;
  private keys: Float64Array;
  private size = 0;

  constructor(capacity: number) {
    this.nodes = new Int32Array(Math.max(16, capacity));
    this.keys = new Float64Array(Math.max(16, capacity));
  }

  get length(): number {
    return this.size;
  }

  push(node: number, key: number): void {
    if (this.size === this.nodes.length) {
      const nodes = new Int32Array(this.size * 2);
      nodes.set(this.nodes);
      this.nodes = nodes;
      const keys = new Float64Array(this.size * 2);
      keys.set(this.keys);
      this.keys = keys;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.nodes[i] = this.nodes[parent]!;
      this.keys[i] = this.keys[parent]!;
      i = parent;
    }
    this.nodes[i] = node;
    this.keys[i] = key;
  }

  /** Removes the smallest entry. `lastKey` holds its key afterwards. */
  lastKey = 0;
  pop(): number {
    const top = this.nodes[0]!;
    this.lastKey = this.keys[0]!;
    const node = this.nodes[--this.size]!;
    const key = this.keys[this.size]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1]! < this.keys[child]!) child++;
      if (this.keys[child]! >= key) break;
      this.nodes[i] = this.nodes[child]!;
      this.keys[i] = this.keys[child]!;
      i = child;
    }
    this.nodes[i] = node;
    this.keys[i] = key;
    return top;
  }
}

interface Search {
  dist: Float64Array;
  prevNode: Int32Array;
  prevEdge: Int32Array;
  /** the node that ended the search early, or -1 */
  reached: number;
}

/**
 * The road network of one operation: a shared topology plus this operation's road status.
 * Answers shortest-path and travel-time queries over whatever is currently passable.
 */
export class RoadNetwork {
  /** Travel-time multiplier per edge; Infinity means the edge cannot be driven. */
  private readonly multiplier: Float64Array;
  /** Bumped on every change, so callers can tell whether cached answers are stale. */
  version = 0;

  constructor(readonly topology: RoadTopology) {
    this.multiplier = new Float64Array(topology.edgeCount).fill(1);
  }

  /** Sets an edge directly. `speedFactor` is the fraction of normal speed (0 < f <= 1). */
  setEdge(edgeId: string, passable: boolean, speedFactor = 1): void {
    const edge = this.topology.requireEdge(edgeId);
    const next = passable ? 1 / Math.min(1, Math.max(0.01, speedFactor)) : Infinity;
    if (this.multiplier[edge] !== next) {
      this.multiplier[edge] = next;
      this.version++;
    }
  }

  /** Applies a road state from the world. `null` or absent means plainly open. */
  applyRoadState(edgeId: string, state: RoadState | null | undefined): void {
    this.setEdge(edgeId, isPassable(state), state?.speedFactor ?? 1);
  }

  isEdgePassable(edgeId: string): boolean {
    return this.multiplier[this.topology.requireEdge(edgeId)] !== Infinity;
  }

  /**
   * Runs `fn` with the given edges hypothetically open at full speed, then restores them.
   * Lets restoration ask "what if this were repaired" without touching the world.
   * `fn` must be synchronous.
   */
  withUnblocked<T>(edgeIds: Iterable<string>, fn: () => T): T {
    const saved: [number, number][] = [];
    for (const edgeId of edgeIds) {
      const edge = this.topology.edgeIndex(edgeId);
      if (edge === undefined) continue;
      saved.push([edge, this.multiplier[edge]!]);
      this.multiplier[edge] = 1;
    }
    try {
      return fn();
    } finally {
      for (const [edge, value] of saved) this.multiplier[edge] = value;
    }
  }

  private search(sources: number[], reverse: boolean, targets: Uint8Array | null): Search {
    const { nodeCount, baseSeconds } = this.topology;
    const start = reverse ? this.topology.inStart : this.topology.outStart;
    const neighbour = reverse ? this.topology.inFrom : this.topology.outTo;
    const arcEdge = reverse ? this.topology.inEdge : this.topology.outEdge;
    const multiplier = this.multiplier;

    const dist = new Float64Array(nodeCount).fill(Infinity);
    const prevNode = new Int32Array(nodeCount).fill(-1);
    const prevEdge = new Int32Array(nodeCount).fill(-1);
    const heap = new MinHeap(nodeCount);
    for (const source of sources) {
      if (dist[source] !== 0) {
        dist[source] = 0;
        heap.push(source, 0);
      }
    }

    let reached = -1;
    while (heap.length > 0) {
      const node = heap.pop();
      const d = heap.lastKey;
      if (d > dist[node]!) continue; // stale entry
      if (targets && targets[node]) {
        reached = node;
        break;
      }
      for (let arc = start[node]!, end = start[node + 1]!; arc < end; arc++) {
        const edge = arcEdge[arc]!;
        const m = multiplier[edge]!;
        if (m === Infinity) continue;
        const next = neighbour[arc]!;
        const candidate = d + baseSeconds[edge]! * m;
        if (candidate < dist[next]!) {
          dist[next] = candidate;
          prevNode[next] = node;
          prevEdge[next] = edge;
          heap.push(next, candidate);
        }
      }
    }
    return { dist, prevNode, prevEdge, reached };
  }

  private targetMask(nodeIds: string[]): Uint8Array {
    const mask = new Uint8Array(this.topology.nodeCount);
    for (const id of nodeIds) mask[this.topology.requireNode(id)] = 1;
    return mask;
  }

  /** Fastest drivable route between two nodes, or null when they are disconnected. */
  route(fromNodeId: string, toNodeId: string): Route | null {
    const from = this.topology.requireNode(fromNodeId);
    const to = this.topology.requireNode(toNodeId);
    const mask = new Uint8Array(this.topology.nodeCount);
    mask[to] = 1;
    const search = this.search([from], false, mask);
    if (search.reached !== to) return null;

    const edgeIndexes: number[] = [];
    const nodeIndexes: number[] = [to];
    for (let node = to; node !== from; node = search.prevNode[node]!) {
      edgeIndexes.push(search.prevEdge[node]!);
      nodeIndexes.push(search.prevNode[node]!);
    }
    edgeIndexes.reverse();
    nodeIndexes.reverse();

    const { edges, nodes, edgeFrom } = this.topology;
    const geometry: LngLat[] = [nodes[from]!.position];
    let lengthM = 0;
    edgeIndexes.forEach((edgeIndex, i) => {
      const edge = edges[edgeIndex]!;
      lengthM += edge.lengthM;
      const forward = edgeFrom[edgeIndex] === nodeIndexes[i];
      const points = forward ? edge.geometry : [...edge.geometry].reverse();
      for (let p = 1; p < points.length; p++) geometry.push(points[p]!);
    });

    return {
      edgeIds: edgeIndexes.map((index) => edges[index]!.id),
      nodeIds: nodeIndexes.map((index) => nodes[index]!.id),
      geometry,
      seconds: search.dist[to]!,
      lengthM,
    };
  }

  /**
   * Travel time in seconds between every node and the nearest of the given nodes, indexed like
   * topology.nodes. Infinity means unreachable.
   * - default: time to drive FROM the nearest source TO each node;
   * - `toward: true`: time to drive FROM each node TO the nearest source (what "can residents
   *   reach a hospital" needs when there are one-way streets).
   */
  travelTimes(nodeIds: string[], options: { toward?: boolean } = {}): Float64Array {
    const sources = nodeIds.map((id) => this.topology.requireNode(id));
    return this.search(sources, options.toward === true, null).dist;
  }

  /** The candidate that can be reached soonest from `fromNodeId`, or null if none can. */
  nearest(
    fromNodeId: string,
    candidateNodeIds: string[],
  ): { nodeId: string; seconds: number } | null {
    if (candidateNodeIds.length === 0) return null;
    const from = this.topology.requireNode(fromNodeId);
    const search = this.search([from], false, this.targetMask(candidateNodeIds));
    if (search.reached === -1) return null;
    return {
      nodeId: this.topology.nodes[search.reached]!.id,
      seconds: search.dist[search.reached]!,
    };
  }

  /** Travel time in seconds between two nodes, or Infinity when disconnected. */
  secondsBetween(fromNodeId: string, toNodeId: string): number {
    const to = this.topology.requireNode(toNodeId);
    const mask = new Uint8Array(this.topology.nodeCount);
    mask[to] = 1;
    const search = this.search([this.topology.requireNode(fromNodeId)], false, mask);
    return search.reached === to ? search.dist[to]! : Infinity;
  }
}
