const { v4: uuidv4 } = require('uuid');

/**
 * DemoScenario — scripted 5-step "Crash During Snapshot" showcase.
 *
 * Step 1 (t=0ms):    node-1 sends 3 messages to node-2
 * Step 2 (t=400ms):  Coordinator initiates snapshot
 * Step 3 (t=450ms):  node-2 crashes mid-marker (before recording full state)
 * Step 4 (t=1200ms): SnapshotValidator detects inconsistency
 * Step 5 (t=2000ms): node-2 recovers; replay engine loads + replays
 */
class DemoScenario {
  /**
   * @param {Object[]} nodes - EdgeNode instances
   * @param {Object} messageBus
   * @param {Object} coordinator - SnapshotCoordinator
   * @param {Object} snapshotStorage - SnapshotStorage
   * @param {Object} snapshotValidator
   * @param {Object} replayEngine
   * @param {Object} eventLogger
   * @param {Function} broadcast - WebSocket broadcast function
   */
  constructor(nodes, messageBus, coordinator, snapshotStorage, snapshotValidator, replayEngine, eventLogger, broadcast) {
    this.nodes = nodes;
    this.messageBus = messageBus;
    this.coordinator = coordinator;
    this.snapshotStorage = snapshotStorage;
    this.validator = snapshotValidator;
    this.replayEngine = replayEngine;
    this.eventLogger = eventLogger;
    this.broadcast = broadcast;

    this._reset();
  }

  _reset() {
    this.state = {
      phase: 'idle',           // idle | running | complete | error
      currentStep: 0,          // 1-5
      totalSteps: 5,
      steps: [
        { num: 1, label: 'Send messages from node-1 to node-2', status: 'pending' },
        { num: 2, label: 'Initiate distributed snapshot', status: 'pending' },
        { num: 3, label: 'Crash node-2 mid-marker (inject failure)', status: 'pending' },
        { num: 4, label: 'Validate snapshot consistency', status: 'pending' },
        { num: 5, label: 'Recover node-2 + deterministic replay', status: 'pending' },
      ],
      snapshotId: null,
      validationResult: null,
      replayResult: null,
      events: [],     // demo-specific events captured
      startedAt: null,
      completedAt: null,
      error: null,
    };
  }

  getStatus() {
    return { ...this.state };
  }

  /** Run the full scripted scenario */
  async run() {
    if (this.state.phase === 'running') {
      throw new Error('Demo already running');
    }

    this._reset();
    this.state.phase = 'running';
    this.state.startedAt = Date.now();

    this._emit('demo:start', { message: 'Crash-During-Snapshot scenario started' });

    try {
      await this._step1_sendMessages();
      await this._sleep(400);

      await this._step2_initiateSnapshot();
      await this._sleep(50);

      await this._step3_crashNode();
      await this._sleep(750);

      await this._step4_validateSnapshot();
      await this._sleep(800);

      await this._step5_recoverAndReplay();

      this.state.phase = 'complete';
      this.state.completedAt = Date.now();
      this._emit('demo:complete', { elapsed: this.state.completedAt - this.state.startedAt });

    } catch (err) {
      this.state.phase = 'error';
      this.state.error = err.message;
      this._emit('demo:error', { error: err.message });
    }

    return this.state;
  }

  // ── Step 1: node-1 sends messages to node-2 ──────────────────────────────

  async _step1_sendMessages() {
    this._setStep(1, 'running');
    const sender = this.nodes.find(n => n.nodeId === 'node-1');
    const target = 'node-2';

    if (!sender) throw new Error('node-1 not found');

    // Ensure sender is active
    if (sender._crashed) sender.recover();

    // Send 3 messages to node-2 with short gap
    for (let i = 1; i <= 3; i++) {
      sender.sendMessage(target, { demo: true, seq: i, text: `Demo msg ${i} from node-1` });
      await this._sleep(80);
    }

    this._setStep(1, 'complete', {
      messagesSent: 3,
      from: 'node-1',
      to: target,
    });
    this._emit('demo:step1', { sent: 3 });
  }

  // ── Step 2: Initiate snapshot ─────────────────────────────────────────────

  async _step2_initiateSnapshot() {
    this._setStep(2, 'running');
    this._emit('demo:step2', { message: 'Initiating snapshot...' });

    // Fire snapshot — don't await fully (we want to crash mid-way)
    let snap = null;
    const snapPromise = this.coordinator.initiateSnapshot().then(s => { snap = s; }).catch(() => {});
    
    // Wait a bit for snapshot to start propagating
    await this._sleep(100);

    this._setStep(2, 'complete', { message: 'Snapshot markers sent to all nodes' });
    this._emit('demo:step2', { message: 'Snapshot markers propagating...' });

    // Store the resolved snapshot ID once available
    setTimeout(() => {
      if (snap) this.state.snapshotId = snap.id;
    }, 500);
  }

  // ── Step 3: Crash node-2 mid-marker ──────────────────────────────────────

  async _step3_crashNode() {
    this._setStep(3, 'running');
    const target = this.nodes.find(n => n.nodeId === 'node-2');

    if (!target) throw new Error('node-2 not found');

    this._emit('demo:step3', { message: 'Crashing node-2...', nodeId: 'node-2' });
    target.crash();

    this._setStep(3, 'complete', {
      crashedNode: 'node-2',
      message: 'node-2 crashed before recording full channel state',
    });
    this._emit('demo:step3', {
      message: 'node-2 crashed! Snapshot may be inconsistent.',
      nodeId: 'node-2',
      severity: 'error',
    });
  }

  // ── Step 4: Validate snapshot consistency ─────────────────────────────────

  async _step4_validateSnapshot() {
    this._setStep(4, 'running');
    this._emit('demo:step4', { message: 'Validating snapshot consistency...' });

    // Get the latest snapshot to validate
    const snapList = await this.snapshotStorage.list();
    const latestSnap = snapList[snapList.length - 1];

    let validationResult = { valid: true, violations: [], stats: {} };

    if (latestSnap) {
      this.state.snapshotId = latestSnap.id;
      try {
        validationResult = await this.validator.validate(latestSnap.id);
      } catch (err) {
        validationResult = { valid: false, violations: [{ rule: 'VALIDATION_ERROR', details: err.message }], stats: {} };
      }
    } else {
      // No snapshot yet (crash happened before completion) — synthesize validation failure
      validationResult = {
        valid: false,
        violations: [
          { rule: 'INCOMPLETE_SNAPSHOT', details: 'Snapshot could not complete — node-2 crashed before recording its channel state' },
          { rule: 'MISSING_NODE_STATE', details: 'node-2 state is absent from the global snapshot', nodeId: 'node-2' },
        ],
        stats: { totalNodes: this.nodes.length, totalChannels: 0, snapshotHash: 'n/a' },
      };
    }

    this.state.validationResult = validationResult;

    this._setStep(4, validationResult.valid ? 'complete' : 'warning', {
      valid: validationResult.valid,
      violations: validationResult.violations.length,
    });

    this._emit('demo:step4', {
      valid: validationResult.valid,
      violations: validationResult.violations,
      message: validationResult.valid
        ? '✅ Snapshot consistent (crash happened after recording)'
        : `❌ ${validationResult.violations.length} consistency violation(s) detected`,
    });
  }

  // ── Step 5: Recover node-2 + Replay ──────────────────────────────────────

  async _step5_recoverAndReplay() {
    this._setStep(5, 'running');

    // Recover node-2
    const target = this.nodes.find(n => n.nodeId === 'node-2');
    if (target) {
      target.recover();
      this._emit('demo:step5', { message: 'node-2 recovered', nodeId: 'node-2' });
      await this._sleep(300);
    }

    // Load the snapshot into replay engine and run deterministic verify
    let replayResult = null;
    if (this.state.snapshotId) {
      try {
        await this.replayEngine.loadSnapshot(this.state.snapshotId);
        replayResult = await this.replayEngine.verify(this.state.snapshotId);
        this.state.replayResult = replayResult;
      } catch (err) {
        replayResult = { error: err.message, deterministic: false };
        this.state.replayResult = replayResult;
      }
    }

    this._setStep(5, 'complete', {
      recovered: 'node-2',
      replayDeterministic: replayResult?.deterministic,
    });

    this._emit('demo:step5', {
      message: replayResult?.deterministic
        ? '✅ Deterministic replay confirmed — system recovered correctly'
        : '⚠️ Replay shows divergence — state before crash differs',
      deterministic: replayResult?.deterministic,
      hashes: replayResult ? {
        baseline: replayResult.baselineHash,
        replay: replayResult.replayHash,
      } : null,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _setStep(num, status, detail = {}) {
    this.state.currentStep = num;
    const step = this.state.steps[num - 1];
    if (step) {
      step.status = status;
      step.detail = detail;
      step.completedAt = Date.now();
    }
  }

  _emit(type, data) {
    const event = { type, ...data, demoTimestamp: Date.now() };
    this.state.events.push(event);
    this.broadcast({ type: 'demoEvent', event });
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = DemoScenario;
