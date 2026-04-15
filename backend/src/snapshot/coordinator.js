const { v4: uuidv4 } = require('uuid');
const metrics = require('../metrics/prometheusMetrics');

/**
 * SnapshotCoordinator — implements the Chandy-Lamport distributed snapshot algorithm.
 * 
 * Algorithm:
 * 1. Coordinator initiates snapshot, sends MARKER to all nodes via message bus
 * 2. Each node: on first marker → record local state, forward markers, start recording channels
 * 3. Each node: on subsequent marker from channel C → stop recording channel C
 * 4. When all nodes report complete → assemble global snapshot
 */
class SnapshotCoordinator {
  /**
   * @param {Object} messageBus - MessageBus instance
   * @param {Object} snapshotStorage - SnapshotStorage instance
   * @param {Object} eventLogger - EventLogger instance (for broadcasting)
   */
  constructor(messageBus, snapshotStorage, eventLogger) {
    this.messageBus = messageBus;
    this.storage = snapshotStorage;
    this.eventLogger = eventLogger;
    this.pendingSnapshots = new Map(); // snapshotId -> { pending, results }
  }

  /**
   * Initiate a global snapshot
   * @returns {Promise<Object>} The assembled global snapshot
   */
  async initiateSnapshot() {
    const snapshotId = uuidv4();
    const nodeIds = this.messageBus.getNodeIds();
    const initiatedAt = Date.now();

    const snapshotTimer = metrics.snapshotLatency
      ? metrics.snapshotLatency.startTimer()
      : null;

    return new Promise((resolve, reject) => {
      const pending = new Set(nodeIds);
      const results = {};

      this.pendingSnapshots.set(snapshotId, { pending, results, resolve, reject, initiatedAt });

      // Listen for node snapshot completion events
      const onSnapshotComplete = (data) => {
        if (data.snapshotId !== snapshotId) return;
        results[data.nodeId] = data;
        pending.delete(data.nodeId);

        if (pending.size === 0) {
          // All nodes have completed their local snapshot
          this._assembleSnapshot(snapshotId, results, initiatedAt, snapshotTimer)
            .then(resolve)
            .catch(reject);
          this.messageBus.removeListener('snapshotComplete', onSnapshotComplete);
          this.pendingSnapshots.delete(snapshotId);
        }
      };

      this.messageBus.on('snapshotComplete', onSnapshotComplete);

      // Timeout safety (30 seconds)
      setTimeout(() => {
        if (this.pendingSnapshots.has(snapshotId)) {
          this.pendingSnapshots.delete(snapshotId);
          this.messageBus.removeListener('snapshotComplete', onSnapshotComplete);
          // Assemble with whatever we have
          this._assembleSnapshot(snapshotId, results, initiatedAt, snapshotTimer)
            .then(resolve)
            .catch(reject);
        }
      }, 30000);

      // Send markers to all nodes
      for (const nodeId of nodeIds) {
        this.messageBus.deliverMarker(snapshotId, 'COORDINATOR', nodeId);
      }
    });
  }

  /** Wire up edge nodes to report their snapshot completion to this coordinator */
  wireNodes(nodes) {
    for (const node of nodes) {
      node.on('snapshotComplete', (data) => {
        this.messageBus.emit('snapshotComplete', data);
      });
    }
  }

  /**
   * Assemble the global snapshot from all node results
   */
  async _assembleSnapshot(snapshotId, results, initiatedAt, timer) {
    const nodeStates = {};
    const channelStates = {};

    for (const [nodeId, data] of Object.entries(results)) {
      nodeStates[nodeId] = data.localState;
      channelStates[nodeId] = data.channelStates || {};
    }

    const completedAt = Date.now();
    const latencyMs = completedAt - initiatedAt;

    const snapshot = {
      id: snapshotId,
      nodeStates,
      channelStates,
      initiatedAt,
      completedAt,
      metrics: {
        latencyMs,
        nodeCount: Object.keys(nodeStates).length,
      },
    };

    if (timer) timer({ status: 'success' });
    metrics.snapshotCount && metrics.snapshotCount.inc();

    await this.storage.save(snapshot);

    this.eventLogger && this.eventLogger._broadcast({
      type: 'snapshot',
      snapshot: {
        id: snapshot.id,
        initiatedAt: snapshot.initiatedAt,
        completedAt: snapshot.completedAt,
        latencyMs,
        nodeCount: Object.keys(nodeStates).length,
      },
    });

    return snapshot;
  }
}

module.exports = SnapshotCoordinator;
