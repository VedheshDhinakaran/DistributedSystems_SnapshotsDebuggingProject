const crypto = require('crypto');
const VectorClock = require('../clocks/vectorClock');

/**
 * ReplayEngine — deterministic time-travel debugging.
 * 
 * v2 enhancements:
 *  - Strict causal sort: vector clock → Lamport → nodeId (lexicographic) → timestamp
 *  - SHA-256 state hash for determinism verification
 *  - verify() runs replay twice and compares final state hashes
 *  - baseline snapshots for hash anchoring
 */
class ReplayEngine {
  constructor(snapshotStorage, eventLogger, nodes, broadcast) {
    this.storage = snapshotStorage;
    this.eventLogger = eventLogger;
    this.nodes = nodes;
    this.broadcast = broadcast;

    this.replayEvents = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this._playTimer = null;
    this.snapshotId = null;
    this.snapshotTimestamp = null;

    // Determinism tracking
    this._baselineHashes = new Map(); // snapshotId -> finalStateHash
  }

  // ── Snapshot Loading ────────────────────────────────────────────────────────

  async loadSnapshot(snapshotId) {
    this.pause();
    this.snapshotId = snapshotId;
    this.currentIndex = -1;
    this.replayEvents = [];

    const snapshot = await this.storage.load(snapshotId);
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

    this.snapshotTimestamp = snapshot.initiatedAt;

    // Stop all nodes and restore state from snapshot
    for (const node of this.nodes) {
      if (node._intervalHandle) clearInterval(node._intervalHandle);
      const nodeSnap = snapshot.nodeStates[node.nodeId];
      if (nodeSnap) node.restoreFromSnapshot(nodeSnap);
    }

    const rawEvents = await this.eventLogger.getEventsSince(this.snapshotTimestamp);
    this.replayEvents = this._causalSort(rawEvents);

    this.broadcast({
      type: 'replay',
      action: 'loaded',
      snapshotId,
      eventCount: this.replayEvents.length,
      currentIndex: this.currentIndex,
    });

    return { snapshot, eventCount: this.replayEvents.length };
  }

  // ── Causal Sort (Deterministic) ─────────────────────────────────────────────

  /**
   * Strict deterministic causal ordering:
   * Primary:   vector clock happens-before relation
   * Tiebreak 1: Lamport timestamp
   * Tiebreak 2: nodeId (lexicographic) ← NEW determinism guarantee
   * Tiebreak 3: wall-clock timestamp
   */
  _causalSort(events) {
    return [...events].sort((a, b) => {
      const vc_a = a.vectorClock || {};
      const vc_b = b.vectorClock || {};

      if (VectorClock.happensBefore(vc_a, vc_b)) return -1;
      if (VectorClock.happensBefore(vc_b, vc_a)) return 1;

      // Concurrent — deterministic tiebreakers
      if (a.lamport !== b.lamport) return (a.lamport || 0) - (b.lamport || 0);
      if (a.nodeId !== b.nodeId) return a.nodeId < b.nodeId ? -1 : 1; // lexicographic
      return (a.timestamp || 0) - (b.timestamp || 0);
    });
  }

  // ── Playback Controls ───────────────────────────────────────────────────────

  play(intervalMs = 500) {
    if (this.isPlaying) return;
    if (this.currentIndex >= this.replayEvents.length - 1) {
      this.currentIndex = -1;
    }
    this.isPlaying = true;
    this.broadcast({ type: 'replay', action: 'playing', currentIndex: this.currentIndex });

    this._playTimer = setInterval(() => {
      if (this.currentIndex >= this.replayEvents.length - 1) {
        this.pause();
        this.broadcast({ type: 'replay', action: 'complete', currentIndex: this.currentIndex });
        return;
      }
      this.stepForward();
    }, intervalMs);
  }

  pause() {
    this.isPlaying = false;
    if (this._playTimer) {
      clearInterval(this._playTimer);
      this._playTimer = null;
    }
    this.broadcast({ type: 'replay', action: 'paused', currentIndex: this.currentIndex });
  }

  stepForward() {
    if (this.currentIndex >= this.replayEvents.length - 1) return null;
    this.currentIndex++;
    const event = this.replayEvents[this.currentIndex];

    this.broadcast({
      type: 'replay',
      action: 'step',
      event,
      currentIndex: this.currentIndex,
      totalEvents: this.replayEvents.length,
    });

    return event;
  }

  jumpToEvent(target) {
    let index;
    if (typeof target === 'number') {
      index = target;
    } else {
      index = this.replayEvents.findIndex(e => e.id === target);
    }
    if (index < 0 || index >= this.replayEvents.length) return null;

    this.currentIndex = index;
    const event = this.replayEvents[index];

    this.broadcast({
      type: 'replay',
      action: 'jumped',
      event,
      currentIndex: this.currentIndex,
      totalEvents: this.replayEvents.length,
    });

    return event;
  }

  // ── Determinism Verification ────────────────────────────────────────────────

  /**
   * Compute a SHA-256 hash of the final node states after full replay.
   * This hash is deterministic: same events + same initial state → same hash.
   */
  computeStateHash(nodeStates) {
    // Sort keys for stable serialization
    const stableState = {};
    for (const nodeId of Object.keys(nodeStates).sort()) {
      const s = nodeStates[nodeId];
      stableState[nodeId] = {
        lamport: s?.lamport ?? 0,
        counter: s?.state?.counter ?? 0,
        vectorClock: s?.vectorClock
          ? Object.fromEntries(Object.entries(s.vectorClock).sort())
          : {},
      };
    }
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(stableState))
      .digest('hex');
  }

  /**
   * Run a full silent replay (no interval, no broadcast) and capture final state hash.
   * @param {string} snapshotId
   * @returns {string} Final state hash
   */
  async _silentReplay(snapshotId) {
    const snapshot = await this.storage.load(snapshotId);
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

    // Restore node states (in memory only)
    const virtualStates = {};
    for (const [nodeId, nodeSnap] of Object.entries(snapshot.nodeStates)) {
      virtualStates[nodeId] = {
        lamport: nodeSnap?.lamport ?? 0,
        state: { ...nodeSnap?.state },
        vectorClock: { ...nodeSnap?.vectorClock },
      };
    }

    // Fetch + sort events
    const rawEvents = await this.eventLogger.getEventsSince(snapshot.initiatedAt);
    const sorted = this._causalSort(rawEvents);

    // Simulate applying events (increment counters)
    for (const event of sorted) {
      if (event.type === 'INTERNAL' && virtualStates[event.nodeId]) {
        virtualStates[event.nodeId].state.counter =
          (virtualStates[event.nodeId].state.counter || 0) + 1;
        virtualStates[event.nodeId].lamport = event.lamport || virtualStates[event.nodeId].lamport;
      }
    }

    return this.computeStateHash(virtualStates);
  }

  /**
   * Verify deterministic replay for a given snapshot.
   * Runs silent replay twice, compares hashes.
   * @param {string} snapshotId
   * @returns {Object} { deterministic, baselineHash, replayHash, mismatches, eventCount }
   */
  async verify(snapshotId) {
    const snapshot = await this.storage.load(snapshotId);
    if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`);

    const rawEvents = await this.eventLogger.getEventsSince(snapshot.initiatedAt);
    const sorted = this._causalSort(rawEvents);
    const eventCount = sorted.length;

    // Run replay twice
    const hash1 = await this._silentReplay(snapshotId);
    const hash2 = await this._silentReplay(snapshotId);

    const deterministic = hash1 === hash2;

    // Compare with stored baseline (if exists)
    const baselineHash = this._baselineHashes.get(snapshotId) || null;
    if (!baselineHash) {
      // First time: store hash1 as the baseline
      this._baselineHashes.set(snapshotId, hash1);
    }

    const mismatches = [];
    if (!deterministic) {
      mismatches.push({
        type: 'HASH_MISMATCH',
        detail: 'Two consecutive replays produced different state hashes',
        hash1,
        hash2,
      });
    }
    if (baselineHash && baselineHash !== hash1) {
      mismatches.push({
        type: 'BASELINE_DEVIATION',
        detail: 'Replay hash differs from stored baseline',
        baselineHash,
        currentHash: hash1,
      });
    }

    const result = {
      deterministic,
      snapshotId,
      baselineHash: baselineHash || hash1,
      replayHash: hash1,
      secondReplayHash: hash2,
      mismatches,
      eventCount,
      verifiedAt: Date.now(),
    };

    this.broadcast({ type: 'replayVerification', ...result });
    return result;
  }

  // ── State ───────────────────────────────────────────────────────────────────

  getState() {
    return {
      snapshotId: this.snapshotId,
      isPlaying: this.isPlaying,
      currentIndex: this.currentIndex,
      totalEvents: this.replayEvents.length,
      currentEvent: this.replayEvents[this.currentIndex] || null,
    };
  }
}

module.exports = ReplayEngine;
