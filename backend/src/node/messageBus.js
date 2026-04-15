const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * MessageBus — central in-process message router simulating gRPC channels.
 * Routes messages between EdgeNode instances with optional fault injection.
 */
class MessageBus extends EventEmitter {
  constructor() {
    super();
    this.nodes = new Map(); // nodeId -> EdgeNode
  }

  /** Register a node with the bus */
  register(node) {
    this.nodes.set(node.nodeId, node);
  }

  /**
   * Deliver a data message to target node
   * @param {Object} msg
   */
  deliver(msg) {
    const target = this.nodes.get(msg.to);
    if (target && !target._crashed) {
      // Simulate network propagation delay (5-50ms)
      const delay = 5 + Math.random() * 45;
      setTimeout(() => {
        if (!target._crashed) {
          target.receiveMessage(msg);
          this.emit('delivered', msg);
        }
      }, delay);
    }
  }

  /**
   * Deliver a snapshot marker to target node
   * @param {string} snapshotId
   * @param {string} fromNodeId
   * @param {string} toNodeId
   */
  deliverMarker(snapshotId, fromNodeId, toNodeId) {
    const target = this.nodes.get(toNodeId);
    if (target && !target._crashed) {
      const delay = 5 + Math.random() * 20;
      setTimeout(() => {
        if (!target._crashed) {
          target.receiveMarker(snapshotId, fromNodeId);
          this.emit('markerDelivered', { snapshotId, from: fromNodeId, to: toNodeId });
        }
      }, delay);
    }
  }

  /** Get all registered node IDs */
  getNodeIds() {
    return Array.from(this.nodes.keys());
  }

  /** Get all nodes info */
  getAllNodesInfo() {
    const result = {};
    for (const [id, node] of this.nodes) {
      result[id] = node.getInfo();
    }
    return result;
  }
}

module.exports = MessageBus;
