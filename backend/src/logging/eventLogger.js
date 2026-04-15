const { v4: uuidv4 } = require('uuid');

/**
 * EventLogger — logs all distributed events to Redis (fast) and MongoDB (persistent).
 * Falls back to in-memory storage if Redis/MongoDB unavailable (development mode).
 */
class EventLogger {
  /**
   * @param {Object} redisClient - ioredis client (optional)
   * @param {Object} mongoCollection - Mongoose model or MongoDB collection (optional)
   */
  constructor(redisClient = null, mongoCollection = null) {
    this.redis = redisClient;
    this.mongo = mongoCollection;
    this.inMemory = []; // fallback in-memory store
    this.subscribers = []; // WebSocket broadcast callbacks
  }

  /**
   * Log an event
   * @param {Object} event - { nodeId, type, lamport, vectorClock, data, timestamp }
   */
  async log(event) {
    const entry = {
      id: uuidv4(),
      nodeId: event.nodeId,
      type: event.type,
      lamport: event.lamport,
      vectorClock: event.vectorClock,
      data: event.data || {},
      timestamp: event.timestamp || Date.now(),
    };

    // Always store in memory (for quick access and fallback)
    this.inMemory.push(entry);
    // Cap in-memory to last 5000 events
    if (this.inMemory.length > 5000) this.inMemory.shift();

    // Store in Redis
    if (this.redis) {
      try {
        const key = `events:${entry.nodeId}`;
        await this.redis.rpush(key, JSON.stringify(entry));
        await this.redis.ltrim(key, -2000, -1); // Keep last 2000 per node
        await this.redis.rpush('events:all', JSON.stringify(entry));
        await this.redis.ltrim('events:all', -10000, -1);
      } catch (err) {
        // Redis unavailable, continue with in-memory
      }
    }

    // Store in MongoDB
    if (this.mongo) {
      try {
        await this.mongo.create(entry);
      } catch (err) {
        // MongoDB unavailable, continue with in-memory
      }
    }

    // Broadcast to subscribers (WebSocket clients)
    this._broadcast({ type: 'event', event: entry });

    return entry;
  }

  /**
   * Query events from in-memory store (or Redis if available)
   * @param {Object} filters - { nodeId, eventType, since (timestamp), limit }
   */
  async query(filters = {}) {
    let events = [...this.inMemory];

    // Try MongoDB first for full history
    if (this.mongo) {
      try {
        const q = {};
        if (filters.nodeId) q.nodeId = filters.nodeId;
        if (filters.eventType) q.type = filters.eventType;
        if (filters.since) q.timestamp = { $gte: filters.since };
        const limit = filters.limit || 500;
        const docs = await this.mongo.find(q).sort({ timestamp: 1 }).limit(limit).lean();
        if (docs.length > 0) return docs;
      } catch (err) {
        // Fall through to in-memory
      }
    }

    if (filters.nodeId) events = events.filter(e => e.nodeId === filters.nodeId);
    if (filters.eventType) events = events.filter(e => e.type === filters.eventType);
    if (filters.since) events = events.filter(e => e.timestamp >= filters.since);
    if (filters.limit) events = events.slice(-filters.limit);

    return events;
  }

  /**
   * Get events after a snapshot timestamp (for replay)
   * @param {number} afterTimestamp
   * @param {string} snapshotId
   */
  async getEventsSince(afterTimestamp) {
    return this.query({ since: afterTimestamp });
  }

  /** Clear all events (for testing) */
  clear() {
    this.inMemory = [];
  }

  /** Subscribe to live event stream */
  subscribe(callback) {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter(s => s !== callback);
    };
  }

  _broadcast(data) {
    for (const cb of this.subscribers) {
      try { cb(data); } catch (e) { /* ignore */ }
    }
  }
}

module.exports = EventLogger;
