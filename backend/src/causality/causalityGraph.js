/**
 * CausalityGraph Engine — builds a proper DAG from event logs using vector clocks.
 *
 * Algorithm:
 *  1. Filter + sample events (max 80 by default)
 *  2. Build "direct reachability" edges: A→B if VC(A) < VC(B) (strict happens-before)
 *  3. Transitivity reduction: remove A→C if A→B→C already exists (cleaner graph)
 *  4. Topological sort → assign layers for Y-axis layout
 *  5. Detect concurrent pairs (no happens-before in either direction)
 */
const VectorClock = require('../clocks/vectorClock');

class CausalityGraph {
  /**
   * @param {Object} eventLogger - EventLogger instance
   */
  constructor(eventLogger) {
    this.eventLogger = eventLogger;
  }

  /**
   * Build a DAG from the event log.
   * @param {Object} opts
   * @param {number}   opts.limit      - max events to sample (default 80)
   * @param {string}   opts.nodeId     - filter by node
   * @param {number}   opts.since      - filter events after timestamp
   * @param {number}   opts.until      - filter events before timestamp
   * @param {number}   opts.replayIdx  - highlight event at replay index
   * @returns {{ nodes, edges, concurrentPairs, stats }}
   */
  async buildGraph(opts = {}) {
    const { limit = 80, nodeId, since, until } = opts;

    // ── 1. Fetch + filter events ─────────────────────────────────────────────
    let events = await this.eventLogger.query({ limit: 500 });

    if (nodeId) events = events.filter(e => e.nodeId === nodeId);
    if (since)  events = events.filter(e => e.timestamp >= since);
    if (until)  events = events.filter(e => e.timestamp <= until);

    // Sort by Lamport then nodeId for deterministic results
    events.sort((a, b) => {
      if ((a.lamport || 0) !== (b.lamport || 0)) return (a.lamport || 0) - (b.lamport || 0);
      return (a.nodeId || '') < (b.nodeId || '') ? -1 : 1;
    });

    // Sample: take the last <limit> events
    if (events.length > limit) events = events.slice(events.length - limit);

    const n = events.length;

    // ── 2. Build raw happens-before edges ────────────────────────────────────
    // adj[i][j] = true means event[i] → event[j] (direct or transitive)
    const adj = Array.from({ length: n }, () => new Array(n).fill(false));
    const directEdges = []; // candidate edges before reduction

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const vc_i = events[i].vectorClock;
        const vc_j = events[j].vectorClock;
        if (!vc_i || !vc_j) continue;

        if (VectorClock.happensBefore(vc_i, vc_j)) {
          adj[i][j] = true;
          directEdges.push([i, j]);
        } else if (VectorClock.happensBefore(vc_j, vc_i)) {
          adj[j][i] = true;
          directEdges.push([j, i]);
        }
      }
    }

    // ── 3. Transitivity reduction ─────────────────────────────────────────────
    // Remove edge i→j if there's an intermediate k such that i→k and k→j
    const reducedEdges = directEdges.filter(([src, tgt]) => {
      // Check if there's ANY k != src, k != tgt such that src→k and k→tgt
      for (let k = 0; k < n; k++) {
        if (k === src || k === tgt) continue;
        if (adj[src][k] && adj[k][tgt]) {
          return false; // redundant edge
        }
      }
      return true;
    });

    // ── 4. Topological sort + layer assignment ────────────────────────────────
    const layers = this._assignLayers(n, adj);

    // Group by layer to assign Y positions within layers
    const layerGroups = {};
    for (let i = 0; i < n; i++) {
      const l = layers[i];
      if (!layerGroups[l]) layerGroups[l] = [];
      layerGroups[l].push(i);
    }

    // ── 5. Detect concurrent pairs ────────────────────────────────────────────
    const concurrentPairs = [];
    for (let i = 0; i < Math.min(n, 20); i++) {
      for (let j = i + 1; j < Math.min(n, 20); j++) {
        const vc_i = events[i].vectorClock;
        const vc_j = events[j].vectorClock;
        if (!vc_i || !vc_j) continue;
        const iBefore = VectorClock.happensBefore(vc_i, vc_j);
        const jBefore = VectorClock.happensBefore(vc_j, vc_i);
        if (!iBefore && !jBefore) {
          concurrentPairs.push([events[i].id, events[j].id]);
        }
      }
    }

    // ── 6. Build output ────────────────────────────────────────────────────────
    const nodes = events.map((e, i) => ({
      id: e.id || `evt-${i}`,
      eventId: e.id,
      nodeId: e.nodeId,
      eventType: e.type,
      vectorClock: e.vectorClock || {},
      lamport: e.lamport || 0,
      timestamp: e.timestamp,
      layer: layers[i],
      posInLayer: layerGroups[layers[i]].indexOf(i),
      layerSize: layerGroups[layers[i]].length,
      data: e.data,
    }));

    const edges = reducedEdges.map(([src, tgt]) => ({
      id: `${events[src].id || src}->${events[tgt].id || tgt}`,
      source: events[src].id || `evt-${src}`,
      target: events[tgt].id || `evt-${tgt}`,
      sourceIdx: src,
      targetIdx: tgt,
    }));

    const maxLayer = Math.max(...layers, 0);

    return {
      nodes,
      edges,
      concurrentPairs,
      stats: {
        totalEvents: n,
        totalEdges: edges.length,
        layers: maxLayer + 1,
        concurrentPairCount: concurrentPairs.length,
        filteredBy: { nodeId, since, until },
      },
    };
  }

  /**
   * Assign topological layers to each node using longest-path algorithm.
   * Layer 0 = no predecessors. Layer of node = max(layer of predecessors) + 1.
   */
  _assignLayers(n, adj) {
    const layers = new Array(n).fill(0);
    // Iterate in topological order (since events are pre-sorted by Lamport, this
    // approximates topological order already)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (adj[i][j]) {
          layers[j] = Math.max(layers[j], layers[i] + 1);
        }
      }
    }
    return layers;
  }

  /**
   * Compute causal ancestors of an event index (all events that lead to it).
   */
  getAncestors(eventId, nodes, edges) {
    const ancestors = new Set();
    const queue = [eventId];
    const edgeByTarget = new Map();

    for (const e of edges) {
      if (!edgeByTarget.has(e.target)) edgeByTarget.set(e.target, []);
      edgeByTarget.get(e.target).push(e.source);
    }

    while (queue.length > 0) {
      const curr = queue.pop();
      for (const src of (edgeByTarget.get(curr) || [])) {
        if (!ancestors.has(src)) {
          ancestors.add(src);
          queue.push(src);
        }
      }
    }
    return ancestors;
  }

  /**
   * Compute causal descendants of an event index (all events caused by it).
   */
  getDescendants(eventId, nodes, edges) {
    const desc = new Set();
    const queue = [eventId];
    const edgeBySource = new Map();

    for (const e of edges) {
      if (!edgeBySource.has(e.source)) edgeBySource.set(e.source, []);
      edgeBySource.get(e.source).push(e.target);
    }

    while (queue.length > 0) {
      const curr = queue.pop();
      for (const tgt of (edgeBySource.get(curr) || [])) {
        if (!desc.has(tgt)) {
          desc.add(tgt);
          queue.push(tgt);
        }
      }
    }
    return desc;
  }
}

module.exports = CausalityGraph;
