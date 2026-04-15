const { v4: uuidv4 } = require('uuid');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * SnapshotStorage — stores and retrieves global consistent snapshots.
 * Uses MongoDB for persistence, with gzip compression.
 * Falls back to in-memory if MongoDB unavailable.
 */
class SnapshotStorage {
  /**
   * @param {Object} mongoCollection - Mongoose model for snapshots (optional)
   */
  constructor(mongoCollection = null) {
    this.mongo = mongoCollection;
    this.inMemory = new Map(); // snapshotId -> snapshot
  }

  /**
   * Save a global snapshot
   * @param {Object} snapshot - { id, nodeStates, channelStates, initiatedAt, completedAt, metrics }
   */
  async save(snapshot) {
    const record = {
      id: snapshot.id,
      nodeStates: snapshot.nodeStates,
      channelStates: snapshot.channelStates,
      initiatedAt: snapshot.initiatedAt,
      completedAt: snapshot.completedAt || Date.now(),
      metrics: snapshot.metrics || {},
    };

    // Store in memory
    this.inMemory.set(record.id, record);

    // Persist to MongoDB (with compression)
    if (this.mongo) {
      try {
        const compressed = await gzip(JSON.stringify(record));
        await this.mongo.create({
          id: record.id,
          data: compressed.toString('base64'),
          initiatedAt: record.initiatedAt,
          completedAt: record.completedAt,
          nodeCount: Object.keys(record.nodeStates).length,
          metrics: record.metrics,
        });
      } catch (err) {
        // MongoDB unavailable, in-memory only
      }
    }

    return record;
  }

  /**
   * Load a snapshot by ID
   * @param {string} snapshotId
   */
  async load(snapshotId) {
    // Try in-memory first
    if (this.inMemory.has(snapshotId)) {
      return this.inMemory.get(snapshotId);
    }

    // Try MongoDB
    if (this.mongo) {
      try {
        const doc = await this.mongo.findOne({ id: snapshotId }).lean();
        if (doc) {
          const decompressed = await gunzip(Buffer.from(doc.data, 'base64'));
          const snapshot = JSON.parse(decompressed.toString());
          this.inMemory.set(snapshotId, snapshot);
          return snapshot;
        }
      } catch (err) {
        // Fall through
      }
    }

    return null;
  }

  /**
   * List all snapshots (metadata only)
   */
  async list() {
    // Try MongoDB
    if (this.mongo) {
      try {
        const docs = await this.mongo
          .find({}, { id: 1, initiatedAt: 1, completedAt: 1, nodeCount: 1, metrics: 1 })
          .sort({ initiatedAt: -1 })
          .limit(100)
          .lean();
        if (docs.length > 0) return docs;
      } catch (err) {
        // Fall through
      }
    }

    // In-memory fallback
    return Array.from(this.inMemory.values()).map(s => ({
      id: s.id,
      initiatedAt: s.initiatedAt,
      completedAt: s.completedAt,
      nodeCount: Object.keys(s.nodeStates).length,
      metrics: s.metrics || {},
    }));
  }
}

module.exports = SnapshotStorage;
