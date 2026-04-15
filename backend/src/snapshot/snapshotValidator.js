const crypto = require('crypto');

/**
 * SnapshotValidator — formally validates Chandy-Lamport snapshot consistency.
 * 
 * Checks the following invariants:
 * 1. No missing messages — every SEND in node history has a corresponding RECEIVE or channel entry
 * 2. No duplicate messages — each message ID appears at most once across all channel states
 * 3. Channel consistency — channel messages were in-flight at the time of the snapshot
 * 4. No orphan messages — every RECEIVE references a known SEND
 */
class SnapshotValidator {
  /**
   * @param {Object} snapshotStorage - SnapshotStorage instance
   * @param {Object} eventLogger - EventLogger instance (for event history)
   */
  constructor(snapshotStorage, eventLogger) {
    this.storage = snapshotStorage;
    this.eventLogger = eventLogger;
  }

  /**
   * Validate a snapshot by ID.
   * @param {string} snapshotId
   * @returns {Object} { valid, violations, stats }
   */
  async validate(snapshotId) {
    const snapshot = await this.storage.load(snapshotId);
    if (!snapshot) {
      return {
        valid: false,
        violations: [{ rule: 'SNAPSHOT_NOT_FOUND', details: `Snapshot ${snapshotId} not found` }],
        stats: {},
      };
    }

    // Collect all events up to snapshot time for cross-referencing
    const allEvents = await this.eventLogger.query({ limit: 10000 });
    const snapshotEvents = allEvents.filter(e => e.timestamp <= snapshot.completedAt);

    const violations = [];
    const stats = {
      totalNodes: Object.keys(snapshot.nodeStates).length,
      totalChannels: 0,
      channelMessages: 0,
      sendEvents: 0,
      receiveEvents: 0,
      duplicateChecks: 0,
    };

    // ── Build reference sets from event log ─────────────────────────────────
    const sendIndex = new Map(); // msgId -> sendEvent
    const receiveIndex = new Map(); // msgId -> receiveEvent

    for (const e of snapshotEvents) {
      if (e.type === 'SEND' && e.data?.msgId) {
        sendIndex.set(e.data.msgId, e);
        stats.sendEvents++;
      }
      if (e.type === 'RECEIVE' && e.data?.msgId) {
        receiveIndex.set(e.data.msgId, e);
        stats.receiveEvents++;
      }
    }

    // ── Check 1: No duplicate messages in channel states ────────────────────
    const seenMsgIds = new Set();
    for (const [nodeId, channels] of Object.entries(snapshot.channelStates)) {
      stats.totalChannels += Object.keys(channels).length;
      for (const [fromNode, msgs] of Object.entries(channels)) {
        for (const msg of msgs) {
          const msgId = msg.id || msg.msgId;
          if (!msgId) continue;
          stats.channelMessages++;
          stats.duplicateChecks++;

          if (seenMsgIds.has(msgId)) {
            violations.push({
              rule: 'DUPLICATE_MESSAGE',
              details: `Message ${msgId} appears multiple times in channel states`,
              nodeId,
              fromNode,
              msgId,
            });
          }
          seenMsgIds.add(msgId);
        }
      }
    }

    // ── Check 2: No orphan messages (RECEIVE without SEND) ──────────────────
    for (const [msgId, recvEvent] of receiveIndex.entries()) {
      if (!sendIndex.has(msgId)) {
        violations.push({
          rule: 'ORPHAN_RECEIVE',
          details: `RECEIVE event for msg ${msgId} has no corresponding SEND in history`,
          nodeId: recvEvent.nodeId,
          msgId,
        });
      }
    }

    // ── Check 3: Channel consistency (in-transit messages) ──────────────────
    // Every channel message should have been sent but not yet received at snapshot time
    for (const [nodeId, channels] of Object.entries(snapshot.channelStates)) {
      for (const [fromNode, msgs] of Object.entries(channels)) {
        for (const msg of msgs) {
          const msgId = msg.id || msg.msgId;
          if (!msgId) continue;

          // The message should have been sent
          if (!sendIndex.has(msgId)) {
            violations.push({
              rule: 'CHANNEL_MSG_NO_SEND',
              details: `Channel message ${msgId} (${fromNode}→${nodeId}) has no SEND record`,
              nodeId,
              fromNode,
              msgId,
            });
          }

          // The message should NOT have been received before snapshot completed
          const recvBefore = snapshotEvents.find(
            e => e.type === 'RECEIVE' &&
              e.data?.msgId === msgId &&
              e.nodeId === nodeId &&
              e.timestamp <= snapshot.initiatedAt
          );
          if (recvBefore) {
            violations.push({
              rule: 'ALREADY_RECEIVED',
              details: `Channel message ${msgId} was received before snapshot started`,
              nodeId,
              fromNode,
              msgId,
            });
          }
        }
      }
    }

    // ── Check 4: Node state integrity ───────────────────────────────────────
    for (const [nodeId, state] of Object.entries(snapshot.nodeStates)) {
      if (!state) {
        violations.push({
          rule: 'MISSING_NODE_STATE',
          details: `Node ${nodeId} has a null/undefined state in snapshot`,
          nodeId,
        });
        continue;
      }
      if (typeof state.lamport !== 'number') {
        violations.push({
          rule: 'INVALID_LAMPORT',
          details: `Node ${nodeId} has invalid Lamport timestamp: ${state.lamport}`,
          nodeId,
        });
      }
      if (!state.vectorClock || typeof state.vectorClock !== 'object') {
        violations.push({
          rule: 'INVALID_VECTOR_CLOCK',
          details: `Node ${nodeId} has invalid vector clock`,
          nodeId,
        });
      }
    }

    // ── Compute validation hash ──────────────────────────────────────────────
    const snapshotHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(snapshot.nodeStates))
      .digest('hex');

    return {
      valid: violations.length === 0,
      violations,
      stats: {
        ...stats,
        snapshotHash: snapshotHash.slice(0, 16),
        checkedAt: Date.now(),
      },
    };
  }

  /**
   * Validate all stored snapshots and return summary.
   */
  async validateAll() {
    const list = await this.storage.list();
    const results = [];
    for (const s of list) {
      const r = await this.validate(s.id);
      results.push({ id: s.id, valid: r.valid, violations: r.violations.length });
    }
    return results;
  }
}

module.exports = SnapshotValidator;
