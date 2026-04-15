const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

/**
 * REST API Routes — v2 with benchmark, validation, deterministic replay, and scenario endpoints.
 * @param {Object} deps - All system dependencies
 */
function createRoutes(deps) {
  const {
    messageBus, coordinator, snapshotStorage, eventLogger,
    replayEngine, faultController, nodes,
    benchmarkRunner, snapshotValidator,
    causalityGraph, demoScenario,
  } = deps;

  // ─── Node Info ────────────────────────────────────────────────────────────
  router.get('/nodes', (req, res) => {
    res.json(messageBus.getAllNodesInfo());
  });

  router.post('/nodes/:nodeId/crash', (req, res) => {
    const node = nodes.find(n => n.nodeId === req.params.nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    node.crash();
    res.json({ nodeId: node.nodeId, status: 'crashed' });
  });

  router.post('/nodes/:nodeId/recover', (req, res) => {
    const node = nodes.find(n => n.nodeId === req.params.nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    node.recover();
    res.json({ nodeId: node.nodeId, status: 'active' });
  });

  // ─── Snapshot ─────────────────────────────────────────────────────────────
  router.post('/snapshot', async (req, res) => {
    try {
      const snapshot = await coordinator.initiateSnapshot();
      res.json({ success: true, snapshot: { id: snapshot.id, metrics: snapshot.metrics } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/snapshots', async (req, res) => {
    try {
      const list = await snapshotStorage.list();
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/snapshots/:id', async (req, res) => {
    try {
      const snapshot = await snapshotStorage.load(req.params.id);
      if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Snapshot Validation ───────────────────────────────────────────────────
  router.post('/snapshot/validate/:id', async (req, res) => {
    try {
      const result = await snapshotValidator.validate(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/snapshot/validate-all', async (req, res) => {
    try {
      const result = await snapshotValidator.validateAll();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Replay ───────────────────────────────────────────────────────────────
  router.post('/replay/:id/load', async (req, res) => {
    try {
      const result = await replayEngine.loadSnapshot(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/replay/play', (req, res) => {
    const intervalMs = req.body.intervalMs || 500;
    replayEngine.play(intervalMs);
    res.json(replayEngine.getState());
  });

  router.post('/replay/pause', (req, res) => {
    replayEngine.pause();
    res.json(replayEngine.getState());
  });

  router.post('/replay/step', (req, res) => {
    const event = replayEngine.stepForward();
    res.json({ event, state: replayEngine.getState() });
  });

  router.post('/replay/jump/:target', (req, res) => {
    const target = isNaN(req.params.target)
      ? req.params.target
      : parseInt(req.params.target, 10);
    const event = replayEngine.jumpToEvent(target);
    res.json({ event, state: replayEngine.getState() });
  });

  router.get('/replay/state', (req, res) => {
    res.json(replayEngine.getState());
  });

  // ── Deterministic Replay Verification ────────────────────────────────────
  router.post('/replay/verify', async (req, res) => {
    try {
      const snapshotId = req.body.snapshotId || replayEngine.snapshotId;
      if (!snapshotId) return res.status(400).json({ error: 'No snapshot loaded. Provide snapshotId in body.' });
      const result = await replayEngine.verify(snapshotId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Events ───────────────────────────────────────────────────────────────
  router.get('/events', async (req, res) => {
    try {
      const filters = {
        nodeId: req.query.nodeId,
        eventType: req.query.type,
        since: req.query.since ? parseInt(req.query.since) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit) : 200,
      };
      const events = await eventLogger.query(filters);
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Fault Injection ──────────────────────────────────────────────────────
  router.post('/fault/:nodeId', (req, res) => {
    const { crashProbability = 0, delayMs = 0, dropProbability = 0 } = req.body;
    faultController.setFault(req.params.nodeId, { crashProbability, delayMs, dropProbability });
    res.json({ nodeId: req.params.nodeId, config: faultController.getFault(req.params.nodeId) });
  });

  router.delete('/fault/:nodeId', (req, res) => {
    faultController.clearFault(req.params.nodeId);
    res.json({ nodeId: req.params.nodeId, config: faultController.getFault(req.params.nodeId) });
  });

  router.get('/faults', (req, res) => {
    res.json({
      faults: faultController.getAllFaults(),
      ...faultController.getScenarioStatus(),
    });
  });

  // ── Fault Scenarios ───────────────────────────────────────────────────────
  router.post('/faults/scenario', async (req, res) => {
    const { scenario } = req.body;
    if (!scenario) return res.status(400).json({ error: 'scenario required in body' });
    try {
      const result = await faultController.activateScenario(scenario, {
        nodeIds: nodes.map(n => n.nodeId),
        nodes,
        coordinator,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/faults/scenario', (req, res) => {
    faultController.clearAllFaults();
    res.json({ cleared: true });
  });

  // ─── Benchmarking ─────────────────────────────────────────────────────────
  router.post('/benchmark/run', async (req, res) => {
    if (benchmarkRunner.running) {
      return res.status(409).json({ error: 'Benchmark already running', progress: benchmarkRunner.getProgress() });
    }
    const opts = req.body || {};
    // Run in background; return accepted immediately
    res.json({ accepted: true, message: 'Benchmark started in background', progress: benchmarkRunner.getProgress() });
    benchmarkRunner.runAll(opts).catch(err => console.error('Benchmark error:', err));
  });

  router.get('/benchmark/results', (req, res) => {
    res.json({
      results: benchmarkRunner.getResults(),
      chartData: benchmarkRunner.getChartData(),
      total: benchmarkRunner.getResults().length,
    });
  });

  router.get('/benchmark/status', (req, res) => {
    res.json(benchmarkRunner.getProgress());
  });

  router.get('/benchmark/csv', (req, res) => {
    const csv = benchmarkRunner.exportCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="benchmark_results.csv"');
    res.send(csv);
  });

  // ─── Causality Graph ─────────────────────────────────────────────────
  router.get('/causality/graph', async (req, res) => {
    if (!causalityGraph) return res.status(503).json({ error: 'CausalityGraph not initialized' });
    try {
      const opts = {
        limit: req.query.limit ? parseInt(req.query.limit) : 80,
        nodeId: req.query.nodeId || undefined,
        since: req.query.since ? parseInt(req.query.since) : undefined,
        until: req.query.until ? parseInt(req.query.until) : undefined,
      };
      const graph = await causalityGraph.buildGraph(opts);
      res.json(graph);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Demo Scenario ─────────────────────────────────────────────────
  router.post('/demo/run', async (req, res) => {
    if (!demoScenario) return res.status(503).json({ error: 'DemoScenario not initialized' });
    if (demoScenario.state?.phase === 'running') {
      return res.status(409).json({ error: 'Demo already running', status: demoScenario.getStatus() });
    }
    res.json({ accepted: true, message: 'Crash-during-snapshot demo starting...' });
    demoScenario.run().catch(err => console.error('Demo error:', err));
  });

  router.get('/demo/status', (req, res) => {
    if (!demoScenario) return res.status(503).json({ error: 'DemoScenario not initialized' });
    res.json(demoScenario.getStatus());
  });

  router.post('/demo/reset', (req, res) => {
    if (!demoScenario) return res.status(503).json({ error: 'DemoScenario not initialized' });
    demoScenario._reset();
    res.json({ reset: true });
  });

  // ─── Health ───────────────────────────────────────────────────────────────
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  return router;
}

module.exports = createRoutes;
