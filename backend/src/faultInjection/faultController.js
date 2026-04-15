/**
 * FaultController v2 — per-node fault config + scenario presets.
 * 
 * Scenarios:
 *  STORM              — High message rate burst (100 random messages)
 *  CRASH_DURING_SNAPSHOT — Crash a node 50ms after snapshot starts
 *  DELAYED_MARKERS    — 2s delay on all nodes (slow marker propagation)
 *  PARTITION          — Split nodes into two groups; inter-group msgs dropped
 */
class FaultController {
  constructor() {
    this.faults = {};
    this.defaultConfig = {
      crashProbability: 0,
      delayMs: 0,
      dropProbability: 0,
    };
    this.activeScenario = null;
    this._partitionGroups = null; // [Set, Set] for PARTITION scenario
  }

  // ── Per-Node Fault Config ───────────────────────────────────────────────────

  setFault(nodeId, config) {
    this.faults[nodeId] = { ...this.defaultConfig, ...config };
  }

  getFault(nodeId) {
    return this.faults[nodeId] || { ...this.defaultConfig };
  }

  getAllFaults() {
    return { ...this.faults };
  }

  clearFault(nodeId) {
    delete this.faults[nodeId];
  }

  clearAllFaults() {
    this.faults = {};
    this.activeScenario = null;
    this._partitionGroups = null;
  }

  // ── Message Fault Application ────────────────────────────────────────────────

  /**
   * Apply fault logic before delivery.
   * @param {string} fromNodeId
   * @param {Object} msg
   * @param {Function} callback - (msg|null) => void
   */
  applyFault(fromNodeId, msg, callback) {
    // PARTITION scenario: check inter-group message
    if (this._partitionGroups) {
      const [g1, g2] = this._partitionGroups;
      const fromInG1 = g1.has(fromNodeId);
      const toInG2 = g2.has(msg.to);
      const fromInG2 = g2.has(fromNodeId);
      const toInG1 = g1.has(msg.to);

      if ((fromInG1 && toInG2) || (fromInG2 && toInG1)) {
        // Cross-partition message — drop it
        callback(null);
        return;
      }
    }

    const config = this.faults[fromNodeId] || this.defaultConfig;

    if (Math.random() < config.dropProbability) {
      callback(null);
      return;
    }

    const delay = config.delayMs + Math.random() * (config.delayMs * 0.5);
    if (delay > 0) {
      setTimeout(() => callback(msg), delay);
    } else {
      callback(msg);
    }
  }

  // ── Scenario Presets ─────────────────────────────────────────────────────────

  /**
   * Activate a named fault scenario.
   * @param {string} scenario - STORM | CRASH_DURING_SNAPSHOT | DELAYED_MARKERS | PARTITION
   * @param {Object} context - { nodeIds, nodes, coordinator } (for crash/partition scenarios)
   */
  async activateScenario(scenario, context = {}) {
    this.clearAllFaults();
    this.activeScenario = scenario;
    const { nodeIds = [], nodes = [], coordinator = null } = context;

    switch (scenario) {
      case 'STORM':
        return this._scenarioStorm(nodes);

      case 'CRASH_DURING_SNAPSHOT':
        return this._scenarioCrashDuringSnapshot(nodes, coordinator);

      case 'DELAYED_MARKERS':
        return this._scenarioDelayedMarkers(nodeIds);

      case 'PARTITION':
        return this._scenarioPartition(nodeIds);

      default:
        throw new Error(`Unknown scenario: ${scenario}. Valid: STORM, CRASH_DURING_SNAPSHOT, DELAYED_MARKERS, PARTITION`);
    }
  }

  /**
   * STORM: Inject a burst of 100 random messages over 3 seconds to simulate high concurrency.
   * Also boosts drop probability so some are lost.
   */
  async _scenarioStorm(nodes) {
    const activePeers = nodes.filter(n => !n._crashed && n.allNodeIds?.length > 1);
    if (activePeers.length === 0) return { scenario: 'STORM', status: 'no_active_nodes' };

    let fired = 0;
    const interval = setInterval(() => {
      if (fired >= 100) { clearInterval(interval); return; }
      const sender = activePeers[Math.floor(Math.random() * activePeers.length)];
      const peerId = sender.allNodeIds?.find(id => id !== sender.nodeId);
      if (peerId) {
        sender.sendMessage(peerId, { type: 'STORM', burst: fired });
        fired++;
      }
    }, 30); // 30ms intervals = ~33 msgs/sec

    return { scenario: 'STORM', status: 'active', expectedMessages: 100 };
  }

  /**
   * CRASH_DURING_SNAPSHOT: Initiates snapshot, then crashes a random node after 50ms.
   */
  async _scenarioCrashDuringSnapshot(nodes, coordinator) {
    if (!coordinator) return { scenario: 'CRASH_DURING_SNAPSHOT', status: 'no_coordinator' };

    const activeNodes = nodes.filter(n => !n._crashed);
    if (activeNodes.length === 0) return { scenario: 'CRASH_DURING_SNAPSHOT', status: 'no_active_nodes' };

    // Start snapshot (fire-and-forget)
    coordinator.initiateSnapshot().catch(() => {});

    // Crash a random node after 50ms
    const target = activeNodes[Math.floor(Math.random() * activeNodes.length)];
    setTimeout(() => target.crash(), 50);

    return { scenario: 'CRASH_DURING_SNAPSHOT', status: 'active', targetNode: target.nodeId };
  }

  /**
   * DELAYED_MARKERS: Apply 2 second delay to all nodes, simulating slow network.
   */
  _scenarioDelayedMarkers(nodeIds) {
    for (const id of nodeIds) {
      this.setFault(id, { delayMs: 2000, dropProbability: 0 });
    }
    return { scenario: 'DELAYED_MARKERS', status: 'active', delayMs: 2000, nodeCount: nodeIds.length };
  }

  /**
   * PARTITION: Split nodes into two groups. Messages between groups are dropped.
   */
  _scenarioPartition(nodeIds) {
    if (nodeIds.length < 2) {
      return { scenario: 'PARTITION', status: 'insufficient_nodes' };
    }
    const mid = Math.floor(nodeIds.length / 2);
    const g1 = new Set(nodeIds.slice(0, mid));
    const g2 = new Set(nodeIds.slice(mid));
    this._partitionGroups = [g1, g2];

    return {
      scenario: 'PARTITION',
      status: 'active',
      group1: [...g1],
      group2: [...g2],
    };
  }

  getScenarioStatus() {
    return {
      activeScenario: this.activeScenario,
      partitioned: !!this._partitionGroups,
      partitionGroups: this._partitionGroups
        ? [[ ...this._partitionGroups[0]], [...this._partitionGroups[1]]]
        : null,
    };
  }
}

module.exports = FaultController;
