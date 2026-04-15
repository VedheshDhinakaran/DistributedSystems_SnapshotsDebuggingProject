require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const Redis = require('ioredis');

const MessageBus = require('./node/messageBus');
const EdgeNode = require('./node/edgeNode');
const FaultController = require('./faultInjection/faultController');
const EventLogger = require('./logging/eventLogger');
const SnapshotStorage = require('./snapshot/snapshotStorage');
const SnapshotCoordinator = require('./snapshot/coordinator');
const ReplayEngine = require('./replay/replayEngine');
const SnapshotValidator = require('./snapshot/snapshotValidator');
const BenchmarkRunner = require('./benchmark/benchmarkRunner');
const CausalityGraph = require('./causality/causalityGraph');
const DemoScenario = require('./demo/demoScenario');
const metrics = require('./metrics/prometheusMetrics');
const createRoutes = require('./api/routes');
const { EventModel, SnapshotModel } = require('./db/models');

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/dbs-system';
const REDIS_URI = process.env.REDIS_URI || 'redis://localhost:6379';
const NODE_COUNT = parseInt(process.env.NODE_COUNT || '5', 10);

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const server = http.createServer(app);

// ─── WebSocket Server ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
});

function broadcast(data) {
  const str = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  }
}

// ─── External Services (optional) ────────────────────────────────────────────
let redisClient = null;
let mongoConnected = false;

async function connectExternal() {
  // Redis
  try {
    redisClient = new Redis(REDIS_URI, { lazyConnect: true, connectTimeout: 3000 });
    await redisClient.connect();
    console.log('✅ Redis connected');
  } catch (err) {
    console.warn('⚠️  Redis unavailable, using in-memory fallback');
    redisClient = null;
  }

  // MongoDB
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 3000 });
    mongoConnected = true;
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.warn('⚠️  MongoDB unavailable, using in-memory fallback');
  }
}

// ─── Core System Bootstrap ────────────────────────────────────────────────────
async function bootstrap() {
  await connectExternal();

  const nodeIds = Array.from({ length: NODE_COUNT }, (_, i) => `node-${i + 1}`);

  // Create core services
  const messageBus = new MessageBus();
  const faultController = new FaultController();
  const eventLogger = new EventLogger(
    redisClient,
    mongoConnected ? EventModel : null
  );
  const snapshotStorage = new SnapshotStorage(
    mongoConnected ? SnapshotModel : null
  );

  // Subscribe logger to broadcast events via WebSocket
  eventLogger.subscribe((data) => broadcast(data));

  // Create and register edge nodes
  const nodes = nodeIds.map(id =>
    new EdgeNode(id, nodeIds, messageBus, eventLogger, faultController)
  );
  for (const node of nodes) {
    messageBus.register(node);
  }

  // Coordinator, Replay Engine, Validator, and Benchmark Runner
  const coordinator = new SnapshotCoordinator(messageBus, snapshotStorage, eventLogger);
  coordinator.wireNodes(nodes);

  const replayEngine = new ReplayEngine(snapshotStorage, eventLogger, nodes, broadcast);
  const snapshotValidator = new SnapshotValidator(snapshotStorage, eventLogger);
  const benchmarkRunner = new BenchmarkRunner(
    messageBus, coordinator, snapshotStorage, eventLogger, replayEngine, faultController,
    null // nodeFactory (not needed for in-process benchmark)
  );

  console.log('🔬 SnapshotValidator + BenchmarkRunner initialized');

  const causalityGraph = new CausalityGraph(eventLogger);
  const demoScenario = new DemoScenario(
    nodes, messageBus, coordinator, snapshotStorage, snapshotValidator, replayEngine, eventLogger, broadcast
  );
  console.log('🕸️  CausalityGraph + DemoScenario initialized');

  // Wire node events to WebSocket
  for (const node of nodes) {
    node.on('internalEvent', (data) => broadcast({ type: 'internalEvent', ...data }));
    node.on('messageSent', (msg) => broadcast({ type: 'messageSent', msg }));
    node.on('messageReceived', (data) => broadcast({ type: 'messageReceived', ...data }));
    node.on('messageDropped', (msg) => broadcast({ type: 'messageDropped', msg }));
    node.on('crashed', (nodeId) => {
      broadcast({ type: 'nodeCrashed', nodeId });
      metrics.activeNodes.set(nodes.filter(n => !n._crashed).length);
    });
    node.on('recovered', (nodeId) => {
      broadcast({ type: 'nodeRecovered', nodeId });
      metrics.activeNodes.set(nodes.filter(n => !n._crashed).length);
    });
  }

  // Start all nodes
  for (const node of nodes) node.start();
  metrics.activeNodes.set(NODE_COUNT);
  console.log(`🚀 ${NODE_COUNT} edge nodes started: ${nodeIds.join(', ')}`);

  // Auto-snapshot every 30 seconds
  setInterval(async () => {
    try {
      await coordinator.initiateSnapshot();
      console.log('📸 Auto-snapshot taken');
    } catch (err) {
      console.warn('Auto-snapshot failed:', err.message);
    }
  }, 30000);

  // ─── Routes ──────────────────────────────────────────────────────────────
  app.use('/api', createRoutes({
    messageBus, coordinator, snapshotStorage, eventLogger,
    replayEngine, faultController, nodes,
    benchmarkRunner, snapshotValidator,
    causalityGraph, demoScenario,
  }));

  // Prometheus metrics endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.end(await metrics.register.metrics());
  });

  // ─── Start Server ─────────────────────────────────────────────────────────
  server.listen(PORT, () => {
    console.log(`\n🌐 Backend server running at http://localhost:${PORT}`);
    console.log(`📊 Metrics at http://localhost:${PORT}/metrics`);
    console.log(`🔌 WebSocket at ws://localhost:${PORT}/ws\n`);
  });
}

bootstrap().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
