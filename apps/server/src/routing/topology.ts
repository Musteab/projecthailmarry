import type { RegionStatic, RoadEdge, RoadNode } from '@bastion/shared';

/**
 * The immutable shape of a region's road network, in compressed sparse row form so that
 * shortest-path queries touch only typed arrays. Built once per region and shared by every
 * operation; the per-operation road status lives in RoadNetwork.
 */
export class RoadTopology {
  readonly nodes: RoadNode[];
  readonly edges: RoadEdge[];
  readonly nodeCount: number;
  readonly edgeCount: number;

  /** Outgoing arcs of node i are entries outStart[i] .. outStart[i+1]-1 of outTo / outEdge. */
  readonly outStart: Int32Array;
  readonly outTo: Int32Array;
  readonly outEdge: Int32Array;
  /** Incoming arcs, for "time to reach X from everywhere" queries. */
  readonly inStart: Int32Array;
  readonly inFrom: Int32Array;
  readonly inEdge: Int32Array;

  readonly edgeFrom: Int32Array;
  readonly edgeTo: Int32Array;
  /** Free-flow travel time of each edge in seconds. */
  readonly baseSeconds: Float64Array;

  private readonly nodeIndexById = new Map<string, number>();
  private readonly edgeIndexById = new Map<string, number>();

  constructor(region: Pick<RegionStatic, 'nodes' | 'edges'>) {
    this.nodes = region.nodes;
    this.edges = region.edges;
    this.nodeCount = region.nodes.length;
    this.edgeCount = region.edges.length;

    region.nodes.forEach((node, index) => {
      if (this.nodeIndexById.has(node.id)) throw new Error(`Duplicate road node id "${node.id}"`);
      this.nodeIndexById.set(node.id, index);
    });

    this.edgeFrom = new Int32Array(this.edgeCount);
    this.edgeTo = new Int32Array(this.edgeCount);
    this.baseSeconds = new Float64Array(this.edgeCount);
    const outDegree = new Int32Array(this.nodeCount + 1);
    const inDegree = new Int32Array(this.nodeCount + 1);

    region.edges.forEach((edge, index) => {
      if (this.edgeIndexById.has(edge.id)) throw new Error(`Duplicate road edge id "${edge.id}"`);
      this.edgeIndexById.set(edge.id, index);
      const from = this.nodeIndexById.get(edge.from);
      const to = this.nodeIndexById.get(edge.to);
      if (from === undefined || to === undefined) {
        throw new Error(`Road edge "${edge.id}" refers to an unknown node`);
      }
      this.edgeFrom[index] = from;
      this.edgeTo[index] = to;
      this.baseSeconds[index] = edge.lengthM / (edge.speedKph / 3.6);
      outDegree[from]!++;
      inDegree[to]!++;
      if (!edge.oneway) {
        outDegree[to]!++;
        inDegree[from]!++;
      }
    });

    const prefix = (degree: Int32Array) => {
      const start = new Int32Array(this.nodeCount + 1);
      for (let i = 0; i < this.nodeCount; i++) start[i + 1] = start[i]! + degree[i]!;
      return start;
    };
    this.outStart = prefix(outDegree);
    this.inStart = prefix(inDegree);
    const arcCount = this.outStart[this.nodeCount]!;
    this.outTo = new Int32Array(arcCount);
    this.outEdge = new Int32Array(arcCount);
    this.inFrom = new Int32Array(arcCount);
    this.inEdge = new Int32Array(arcCount);

    const outCursor = this.outStart.slice(0, this.nodeCount);
    const inCursor = this.inStart.slice(0, this.nodeCount);
    const addArc = (from: number, to: number, edge: number) => {
      const o = outCursor[from]!++;
      this.outTo[o] = to;
      this.outEdge[o] = edge;
      const i = inCursor[to]!++;
      this.inFrom[i] = from;
      this.inEdge[i] = edge;
    };
    for (let edge = 0; edge < this.edgeCount; edge++) {
      addArc(this.edgeFrom[edge]!, this.edgeTo[edge]!, edge);
      if (!region.edges[edge]!.oneway) addArc(this.edgeTo[edge]!, this.edgeFrom[edge]!, edge);
    }
  }

  nodeIndex(nodeId: string): number | undefined {
    return this.nodeIndexById.get(nodeId);
  }

  edgeIndex(edgeId: string): number | undefined {
    return this.edgeIndexById.get(edgeId);
  }

  /** Like nodeIndex, but an unknown id is a programming error. */
  requireNode(nodeId: string): number {
    const index = this.nodeIndexById.get(nodeId);
    if (index === undefined) throw new Error(`Unknown road node "${nodeId}"`);
    return index;
  }

  requireEdge(edgeId: string): number {
    const index = this.edgeIndexById.get(edgeId);
    if (index === undefined) throw new Error(`Unknown road edge "${edgeId}"`);
    return index;
  }
}
