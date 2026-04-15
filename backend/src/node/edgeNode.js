const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const LamportClock = require('../clocks/lamportClock');
const VectorClock = require('../clocks/vectorClock');
const EventTypes = require('../logging/logTypes');

/**
 * EdgeNode — simulates an independent distributed node.
 * 
 * Each node:
 *  - Maintains Lamport + Vector clocks
 *  - Sends/receives messages via the MessageBus
 *  - Handles Chandy-Lamport snapshot markers
 *  - Runs autonomous internal logic
 */
class EdgeNode extends EventEmitter {
  /**
   * @param {string} nodeId
   * @param {string[]} allNodeIds - All node IDs in the system
   * @param {Object} messageBus - Central message bus reference
   * @param {Object} eventLogger - Event logger reference
   * @param {Object} faultController - Fault injection reference
   */
  constructor(nodeId, allNodeIds, messageBus, eventLogger, faultController) {
    super();
    this.nodeId = nodeId;
    this.allNodeIds = allNodeIds;
    this.messageBus = messageBus;
    this.eventLogger = eventLogger;
    this.faultController = faultController;

    this.lamport = new LamportClock(nodeId);
    this.vector = new VectorClock(nodeId, allNodeIds);

    // Node state — represents local application state
    this.state = {
      counter: 0,
      data: {},
      status: 'active',
    };

    // Chandy-Lamport snapshot state
    this.snapshotInProgress = false;
    this.snapshotId = null;
    this.localSnapshotState = null;
    this.channelStates = {}; // channelStates[fromNodeId] = [msgs recorded]
    this.markersReceived = new Set(); // which senders have sent us a marker

    // Autonomous behavior
    this._intervalHandle = null;
    this._crashed = false;
  }

  /** Start autonomous internal event loop */
  start() {
    this._crashed = false;
    this.state.status = 'active';
    const delay = 800 + Math.random() * 700;
    this._intervalHandle = setInterval(() => this._autonomousTick(), delay);
    this._logEvent(EventTypes.NODE_RECOVER, { message: `Node ${this.nodeId} started` });
  }

  /** Stop the node (crash) */
  crash() {
    if (this._intervalHandle) clearInterval(this._intervalHandle);
    this._crashed = true;
    this.state.status = 'crashed';
    this._logEvent(EventTypes.NODE_CRASH, { message: `Node ${this.nodeId} crashed` });
    this.emit('crashed', this.nodeId);
  }

  /** Recover from crash */
  recover() {
    if (!this._crashed) return;
    this.start();
    this.emit('recovered', this.nodeId);
  }

  /** Internal autonomous event — simulates application work */
  _autonomousTick() {
    if (this._crashed) return;

    this.lamport.increment();
    this.vector.increment();
    this.state.counter += 1;

    this._logEvent(EventTypes.INTERNAL, {
      message: `Internal tick`,
      counter: this.state.counter,
    });

    this.emit('internalEvent', {
      nodeId: this.nodeId,
      counter: this.state.counter,
      vectorClock: this.vector.toObject(),
      lamport: this.lamport.value(),
    });

    // Occasionally send a message to a random peer
    if (Math.random() < 0.4) {
      const peers = this.allNodeIds.filter(id => id !== this.nodeId);
      if (peers.length > 0) {
        const target = peers[Math.floor(Math.random() * peers.length)];
        this.sendMessage(target, {
          text: `Hello from ${this.nodeId}`,
          counter: this.state.counter,
        });
      }
    }
  }

  /**
   * Send a message to another node via the message bus
   * @param {string} targetId
   * @param {Object} payload
   */
  sendMessage(targetId, payload) {
    if (this._crashed) return;

    this.lamport.increment();
    this.vector.increment();

    const msg = {
      id: uuidv4(),
      from: this.nodeId,
      to: targetId,
      type: 'DATA',
      payload,
      lamport: this.lamport.value(),
      vectorClock: this.vector.toObject(),
      sentAt: Date.now(),
    };

    this._logEvent(EventTypes.SEND, { targetId, msgId: msg.id, payload });
    this.emit('messageSent', msg);

    // Route through fault controller (handles delay, drop, etc.)
    this.faultController.applyFault(this.nodeId, msg, (faultedMsg) => {
      if (faultedMsg) {
        this.messageBus.deliver(faultedMsg);
      } else {
        this._logEvent(EventTypes.MESSAGE_DROP, { targetId, msgId: msg.id });
        this.emit('messageDropped', msg);
      }
    });
  }

  /**
   * Receive a message from another node (called by message bus)
   * @param {Object} msg
   */
  receiveMessage(msg) {
    if (this._crashed) return;

    // Chandy-Lamport: if snapshot in progress, record channel messages
    if (this.snapshotInProgress && !this.markersReceived.has(msg.from)) {
      if (!this.channelStates[msg.from]) {
        this.channelStates[msg.from] = [];
      }
      // Record this message as in-transit on this channel
      this.channelStates[msg.from].push(msg);
    }

    // Update clocks
    this.lamport.update(msg.lamport);
    this.vector.merge(msg.vectorClock);

    this._logEvent(EventTypes.RECEIVE, {
      fromId: msg.from,
      msgId: msg.id,
      payload: msg.payload,
    });

    this.emit('messageReceived', {
      nodeId: this.nodeId,
      msg,
      vectorClock: this.vector.toObject(),
      lamport: this.lamport.value(),
    });
  }

  /**
   * Handle a snapshot marker (Chandy-Lamport algorithm)
   * @param {string} snapshotId
   * @param {string} fromNodeId - who sent this marker
   */
  receiveMarker(snapshotId, fromNodeId) {
    if (this._crashed) return;

    if (!this.snapshotInProgress) {
      // First marker received: record local state NOW
      this.snapshotInProgress = true;
      this.snapshotId = snapshotId;
      this.localSnapshotState = this._captureLocalState();
      this.channelStates = {};
      this.markersReceived = new Set();

      this._logEvent(EventTypes.SNAPSHOT_STATE, {
        snapshotId,
        trigger: fromNodeId,
        localState: this.localSnapshotState,
      });

      // Forward marker to all other nodes (excluding sender)
      const peers = this.allNodeIds.filter(id => id !== this.nodeId);
      for (const peerId of peers) {
        this.messageBus.deliverMarker(snapshotId, this.nodeId, peerId);
      }
    }

    // Record that we have received a marker from this channel
    this.markersReceived.add(fromNodeId);
    // Stop recording messages from this channel
    if (!this.channelStates[fromNodeId]) {
      this.channelStates[fromNodeId] = [];
    }

    // Check if markers received from ALL other nodes
    const peers = this.allNodeIds.filter(id => id !== this.nodeId);
    const allReceived = peers.every(id => this.markersReceived.has(id));

    if (allReceived) {
      this._finalizeSnapshot();
    }
  }

  /** Capture current local state for snapshot */
  _captureLocalState() {
    return {
      nodeId: this.nodeId,
      state: { ...this.state },
      lamport: this.lamport.value(),
      vectorClock: this.vector.toObject(),
      capturedAt: Date.now(),
    };
  }

  /** Finalize local snapshot contribution and emit to coordinator */
  _finalizeSnapshot() {
    const result = {
      nodeId: this.nodeId,
      snapshotId: this.snapshotId,
      localState: this.localSnapshotState,
      channelStates: { ...this.channelStates },
    };
    this.snapshotInProgress = false;
    this.emit('snapshotComplete', result);
  }

  /** Restore node state from a snapshot (for replay) */
  restoreFromSnapshot(snapshotState) {
    this.state = { ...snapshotState.state };
    this.lamport.time = snapshotState.lamport;
    this.vector.fromObject(snapshotState.vectorClock);
    this._logEvent(EventTypes.NODE_RECOVER, {
      message: 'Restored from snapshot',
      snapshotState,
    });
  }

  /** Internal: log event to event logger */
  async _logEvent(type, data) {
    if (!this.eventLogger) return;
    await this.eventLogger.log({
      nodeId: this.nodeId,
      type,
      lamport: this.lamport.value(),
      vectorClock: this.vector.toObject(),
      data,
      timestamp: Date.now(),
    });
  }

  /** Get current node info */
  getInfo() {
    return {
      nodeId: this.nodeId,
      status: this.state.status,
      state: this.state,
      lamport: this.lamport.value(),
      vectorClock: this.vector.toObject(),
      crashed: this._crashed,
    };
  }
}

module.exports = EdgeNode;
