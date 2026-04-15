/**
 * Vector Clock Implementation
 * Provides causality tracking for distributed events.
 * 
 * A vector clock is a map: { nodeId -> logicalTime }
 * Rules:
 *   - On internal event / send: increment own component
 *   - On receive: element-wise max of local + received, then increment own
 */
class VectorClock {
  /**
   * @param {string} nodeId - The ID of the node owning this clock
   * @param {string[]} allNodeIds - All node IDs in the system
   */
  constructor(nodeId, allNodeIds = []) {
    this.nodeId = nodeId;
    this.clock = {};
    // Initialize all known nodes to 0
    for (const id of allNodeIds) {
      this.clock[id] = 0;
    }
    if (!this.clock[nodeId]) {
      this.clock[nodeId] = 0;
    }
  }

  /**
   * Increment own component (on send or internal event)
   * @returns {Object} Updated clock map
   */
  increment() {
    this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    return this.toObject();
  }

  /**
   * Merge with received clock vector then increment own component (on receive)
   * @param {Object} receivedClock - Received vector clock map
   * @returns {Object} Updated clock map
   */
  merge(receivedClock) {
    // Element-wise max
    const allKeys = new Set([...Object.keys(this.clock), ...Object.keys(receivedClock)]);
    for (const key of allKeys) {
      this.clock[key] = Math.max(this.clock[key] || 0, receivedClock[key] || 0);
    }
    // Increment own
    this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    return this.toObject();
  }

  /**
   * Check if clock A happened-before clock B (A → B)
   * A → B iff: all A[i] <= B[i] AND exists j where A[j] < B[j]
   * @param {Object} a - Vector clock map
   * @param {Object} b - Vector clock map
   */
  static happensBefore(a, b) {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let strictlyLess = false;
    for (const key of allKeys) {
      const av = a[key] || 0;
      const bv = b[key] || 0;
      if (av > bv) return false;  // violated: a[i] > b[i]
      if (av < bv) strictlyLess = true;
    }
    return strictlyLess;
  }

  /**
   * Check if two events are concurrent (neither happens-before the other)
   * @param {Object} a - Vector clock map
   * @param {Object} b - Vector clock map
   */
  static concurrent(a, b) {
    return !VectorClock.happensBefore(a, b) && !VectorClock.happensBefore(b, a);
  }

  /**
   * Check if A equals B
   */
  static equal(a, b) {
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of allKeys) {
      if ((a[key] || 0) !== (b[key] || 0)) return false;
    }
    return true;
  }

  /** Deep copy of current clock */
  clone() {
    const copy = new VectorClock(this.nodeId);
    copy.clock = { ...this.clock };
    return copy;
  }

  /** Return plain object representation */
  toObject() {
    return { ...this.clock };
  }

  /** Set clock from external object (for restoring from snapshot) */
  fromObject(obj) {
    this.clock = { ...obj };
  }
}

module.exports = VectorClock;
