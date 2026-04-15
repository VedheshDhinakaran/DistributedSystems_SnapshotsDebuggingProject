const client = require('prom-client');

// Create a default registry
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom metrics
const snapshotLatency = new client.Histogram({
  name: 'snapshot_latency_seconds',
  help: 'Time taken to complete a distributed snapshot',
  labelNames: ['status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const snapshotCount = new client.Counter({
  name: 'snapshot_total',
  help: 'Total number of snapshots taken',
  registers: [register],
});

const eventLoggedTotal = new client.Counter({
  name: 'events_logged_total',
  help: 'Total number of events logged',
  labelNames: ['nodeId', 'type'],
  registers: [register],
});

const messagesSentTotal = new client.Counter({
  name: 'messages_sent_total',
  help: 'Total messages sent across all nodes',
  registers: [register],
});

const messagesDroppedTotal = new client.Counter({
  name: 'messages_dropped_total',
  help: 'Total messages dropped due to fault injection',
  registers: [register],
});

const replaySteps = new client.Counter({
  name: 'replay_steps_total',
  help: 'Total replay steps taken',
  registers: [register],
});

const activeNodes = new client.Gauge({
  name: 'active_nodes',
  help: 'Number of currently active (non-crashed) nodes',
  registers: [register],
});

module.exports = {
  register,
  snapshotLatency,
  snapshotCount,
  eventLoggedTotal,
  messagesSentTotal,
  messagesDroppedTotal,
  replaySteps,
  activeNodes,
};
