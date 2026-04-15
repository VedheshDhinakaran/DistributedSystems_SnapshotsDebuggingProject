/**
 * Lamport Clock Implementation
 * Provides basic causal ordering for distributed events.
 */
class LamportClock {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.time = 0;
  }

  /** Increment on internal event or send */
  increment() {
    this.time += 1;
    return this.time;
  }

  /**
   * Update on message receive: time = max(local, received) + 1
   * @param {number} receivedTime - Lamport time from incoming message
   */
  update(receivedTime) {
    this.time = Math.max(this.time, receivedTime) + 1;
    return this.time;
  }

  /** Get current clock value */
  value() {
    return this.time;
  }

  /** Serialize for transmission */
  toJSON() {
    return { nodeId: this.nodeId, time: this.time };
  }
}

module.exports = LamportClock;
