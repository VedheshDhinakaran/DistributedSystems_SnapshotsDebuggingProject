const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * BenchmarkRunner — automated performance experiment framework.
 * 
 * Runs matrix of experiments across:
 *   - nodeCount: [2, 5, 10, 20]
 *   - messageRate: [low, medium, high]
 *   - faultScenario: [none, delay, drop, crash]
 * 
 * Captures: snapshot latency, replay time, memory usage, event throughput, drop rate.
 */
class BenchmarkRunner {
  /**
   * @param {Object} messageBus
   * @param {Object} coordinator
   * @param {Object} snapshotStorage
   * @param {Object} eventLogger
   * @param {Object} replayEngine
   * @param {Object} faultController
   * @param {Function} nodeFactory - fn(nodeIds, messageBus, eventLogger, faultController) => EdgeNode[]
   */
  constructor(messageBus, coordinator, snapshotStorage, eventLogger, replayEngine, faultController, nodeFactory) {
    this.messageBus = messageBus;
    this.coordinator = coordinator;
    this.storage = snapshotStorage;
    this.eventLogger = eventLogger;
    this.replayEngine = replayEngine;
    this.faultController = faultController;
    this.nodeFactory = nodeFactory;

    this.results = [];
    this.running = false;
    this.progress = { current: 0, total: 0, phase: 'idle', experiment: null };

    // Ensure data directory exists
    this.dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.resultsFile = path.join(this.dataDir, 'benchmark_results.json');

    // Load existing results
    this._loadResults();
  }

  /** Experiment configuration matrix */
  static get EXPERIMENTS() {
    return {
      nodeCounts: [2, 5, 10, 20],
      messageRates: {
        low: 0.15,
        medium: 0.45,
        high: 0.85,
      },
      faultScenarios: ['none', 'delay', 'drop', 'crash'],
    };
  }

  /** Get current progress */
  getProgress() {
    return { ...this.progress };
  }

  /** Return all stored results */
  getResults() {
    return this.results;
  }

  /**
   * Run the full benchmark matrix.
   * @param {Object} opts - { nodeCounts, messageRates, faultScenarios } (optional overrides)
   */
  async runAll(opts = {}) {
    if (this.running) throw new Error('Benchmark already running');
    this.running = true;

    const { nodeCounts, messageRates, faultScenarios } = BenchmarkRunner.EXPERIMENTS;
    const nc = opts.nodeCounts || nodeCounts;
    const mr = opts.messageRates || messageRates;
    const fs_names = opts.faultScenarios || faultScenarios;

    const experiments = [];
    for (const n of nc) {
      for (const [rateName, rateVal] of Object.entries(mr)) {
        for (const fault of fs_names) {
          experiments.push({ nodeCount: n, rateName, rateVal, fault });
        }
      }
    }

    this.progress = { current: 0, total: experiments.length, phase: 'running', experiment: null };

    const batchResults = [];
    for (const exp of experiments) {
      this.progress.current++;
      this.progress.experiment = exp;
      try {
        const result = await this._runExperiment(exp);
        batchResults.push(result);
        this.results.push(result);
      } catch (err) {
        batchResults.push({ ...exp, error: err.message });
      }
    }

    this.running = false;
    this.progress = { current: experiments.length, total: experiments.length, phase: 'complete', experiment: null };
    this._saveResults();

    return batchResults;
  }

  /**
   * Run a single benchmark experiment.
   * Uses in-process simulation (spin up ephemeral nodes, run for warmupMs, measure).
   */
  async _runExperiment({ nodeCount, rateName, rateVal, fault }) {
    const expId = uuidv4();
    const EdgeNode = require('../node/edgeNode');
    const MessageBus = require('../node/messageBus');
    const FaultController = require('../faultInjection/faultController');
    const EventLogger = require('../logging/eventLogger');
    const SnapshotStorage = require('../snapshot/snapshotStorage');
    const SnapshotCoordinator = require('../snapshot/coordinator');
    const ReplayEngine = require('../replay/replayEngine');

    // Create isolated environment for this experiment
    const bus = new MessageBus();
    const fc = new FaultController();
    const logger = new EventLogger(); // in-memory only
    const storage = new SnapshotStorage();
    const coordinator = new SnapshotCoordinator(bus, storage, logger);

    const nodeIds = Array.from({ length: nodeCount }, (_, i) => `bench-${i + 1}`);
    const nodes = nodeIds.map(id => new EdgeNode(id, nodeIds, bus, logger, fc));
    for (const node of nodes) bus.register(node);
    coordinator.wireNodes(nodes);

    // Apply fault scenario
    this._applyFaultScenario(fault, nodeIds, fc, nodes);

    // Warm-up: run nodes for 600ms
    for (const node of nodes) node.start();
    await this._sleep(600);

    // Measure: heap before snapshot
    const memBefore = process.memoryUsage().heapUsed / (1024 * 1024);
    const cpuBefore = process.cpuUsage();
    const t0 = Date.now();

    // ── Snapshot latency ──────────────────────────────────────────────────
    const snapshot = await coordinator.initiateSnapshot();
    const snapshotLatencyMs = Date.now() - t0;

    // ── Memory (peak during snapshot) ─────────────────────────────────────
    const memAfter = process.memoryUsage().heapUsed / (1024 * 1024);
    const memUsageMB = Math.max(0, memAfter - memBefore);

    // ── CPU usage ─────────────────────────────────────────────────────────
    const cpuAfter = process.cpuUsage(cpuBefore);
    const cpuMs = (cpuAfter.user + cpuAfter.system) / 1000; // microseconds → ms

    // ── Event throughput ──────────────────────────────────────────────────
    const events = await logger.query({ limit: 5000 });
    const throughput = events.length / 0.6; // per second (over warmup period)

    // ── Message drop stats ────────────────────────────────────────────────
    const drops = events.filter(e => e.type === 'MESSAGE_DROP').length;
    const sends = events.filter(e => e.type === 'SEND').length;
    const dropRate = sends > 0 ? drops / sends : 0;

    // ── Replay time ───────────────────────────────────────────────────────
    const replayEngine = new ReplayEngine(storage, logger, nodes, () => {});
    const t1 = Date.now();
    await replayEngine.loadSnapshot(snapshot.id);
    // Step through all events
    while (replayEngine.currentIndex < replayEngine.replayEvents.length - 1) {
      replayEngine.stepForward();
    }
    const replayTimeMs = Date.now() - t1;

    // ── Cleanup ───────────────────────────────────────────────────────────
    for (const node of nodes) {
      if (node._intervalHandle) clearInterval(node._intervalHandle);
    }
    fc.clearAllFaults && fc.clearAllFaults();

    const result = {
      id: expId,
      timestamp: Date.now(),
      nodeCount,
      messageRate: rateName,
      messageRateValue: rateVal,
      faultScenario: fault,
      snapshotLatencyMs,
      replayTimeMs,
      memUsageMB: parseFloat(memUsageMB.toFixed(2)),
      cpuMs: parseFloat(cpuMs.toFixed(2)),
      eventCount: events.length,
      throughputEventsPerSec: parseFloat(throughput.toFixed(1)),
      messagesSent: sends,
      messagesDropped: drops,
      dropRate: parseFloat(dropRate.toFixed(3)),
    };

    return result;
  }

  /** Apply fault scenario configuration to nodes */
  _applyFaultScenario(fault, nodeIds, fc, nodes) {
    switch (fault) {
      case 'delay':
        for (const id of nodeIds) {
          fc.setFault(id, { delayMs: 200, dropProbability: 0 });
        }
        break;
      case 'drop':
        for (const id of nodeIds) {
          fc.setFault(id, { dropProbability: 0.3, delayMs: 0 });
        }
        break;
      case 'crash':
        // Crash ~20% of nodes after 200ms
        const crashCount = Math.max(1, Math.floor(nodeIds.length * 0.2));
        setTimeout(() => {
          for (let i = 0; i < crashCount; i++) {
            if (nodes[i]) nodes[i].crash();
          }
        }, 200);
        break;
      case 'none':
      default:
        break;
    }
  }

  /** Load results from disk */
  _loadResults() {
    try {
      if (fs.existsSync(this.resultsFile)) {
        const raw = fs.readFileSync(this.resultsFile, 'utf-8');
        this.results = JSON.parse(raw);
      }
    } catch (err) {
      this.results = [];
    }
  }

  /** Save results to disk */
  _saveResults() {
    try {
      fs.writeFileSync(this.resultsFile, JSON.stringify(this.results, null, 2));
    } catch (err) {
      // Ignore write errors
    }
  }

  /** Export results as CSV string */
  exportCSV() {
    if (this.results.length === 0) return '';
    const keys = Object.keys(this.results[0]);
    const header = keys.join(',');
    const rows = this.results.map(r => keys.map(k => r[k] ?? '').join(','));
    return [header, ...rows].join('\n');
  }

  /** Get results grouped by dimension for chart plotting */
  getChartData() {
    const byNodeCount = {};
    const byFault = {};
    const byRate = {};

    for (const r of this.results) {
      // By node count
      if (!byNodeCount[r.nodeCount]) byNodeCount[r.nodeCount] = [];
      byNodeCount[r.nodeCount].push(r.snapshotLatencyMs);

      // By fault scenario
      if (!byFault[r.faultScenario]) byFault[r.faultScenario] = [];
      byFault[r.faultScenario].push(r.snapshotLatencyMs);

      // By message rate
      if (!byRate[r.messageRate]) byRate[r.messageRate] = [];
      byRate[r.messageRate].push(r.replayTimeMs);
    }

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
      latencyVsNodes: Object.entries(byNodeCount).map(([n, v]) => ({
        nodeCount: +n,
        avgLatencyMs: parseFloat(avg(v).toFixed(1)),
      })).sort((a, b) => a.nodeCount - b.nodeCount),

      latencyVsFault: Object.entries(byFault).map(([f, v]) => ({
        fault: f,
        avgLatencyMs: parseFloat(avg(v).toFixed(1)),
      })),

      replayVsRate: Object.entries(byRate).map(([r, v]) => ({
        rate: r,
        avgReplayMs: parseFloat(avg(v).toFixed(1)),
      })),

      memoryOverTime: this.results.map(r => ({
        timestamp: r.timestamp,
        memUsageMB: r.memUsageMB,
        nodeCount: r.nodeCount,
      })),

      raw: this.results,
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BenchmarkRunner;
