const mongoose = require('mongoose');

// ─── Event Schema ─────────────────────────────────────────────────────────────
const EventSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  nodeId: { type: String, required: true, index: true },
  type: { type: String, required: true, index: true },
  lamport: { type: Number, default: 0 },
  vectorClock: { type: Map, of: Number },
  data: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Number, required: true, index: true },
}, { timestamps: true });

// ─── Snapshot Schema ──────────────────────────────────────────────────────────
const SnapshotSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  data: { type: String, required: true }, // gzip compressed base64
  initiatedAt: { type: Number, required: true },
  completedAt: { type: Number },
  nodeCount: { type: Number },
  metrics: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

const EventModel = mongoose.model('Event', EventSchema);
const SnapshotModel = mongoose.model('Snapshot', SnapshotSchema);

module.exports = { EventModel, SnapshotModel };
