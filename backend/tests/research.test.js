/**
 * Tests for SnapshotValidator and deterministic replay sort.
 */
const SnapshotValidator = require('../src/snapshot/snapshotValidator');
const ReplayEngine = require('../src/replay/replayEngine');
const VectorClock = require('../src/clocks/vectorClock');

// ── Mock storage/logger helpers ──────────────────────────────────────────────

function makeStorage(snapshot) {
  return {
    load: async (id) => (id === snapshot?.id ? snapshot : null),
    list: async () => (snapshot ? [{ id: snapshot.id }] : []),
  };
}

function makeLogger(events = []) {
  return {
    query: async () => events,
    getEventsSince: async (ts) => events.filter(e => e.timestamp >= ts),
    subscribe: () => {},
  };
}

function makeSnap(overrides = {}) {
  return {
    id: 'snap-1',
    initiatedAt: 1000,
    completedAt: 2000,
    nodeStates: {
      'n1': { lamport: 5, state: { counter: 5 }, vectorClock: { n1: 5, n2: 3 } },
      'n2': { lamport: 3, state: { counter: 3 }, vectorClock: { n1: 2, n2: 3 } },
    },
    channelStates: {
      'n2': { 'n1': [] }, // n1→n2 channel, no in-transit messages
    },
    ...overrides,
  };
}

// ── SnapshotValidator Tests ────────────────────────────────────────────────────

describe('SnapshotValidator', () => {
  test('valid snapshot with no violations', async () => {
    const snap = makeSnap();
    const validator = new SnapshotValidator(makeStorage(snap), makeLogger([]));
    const result = await validator.validate('snap-1');

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.stats.totalNodes).toBe(2);
  });

  test('detects duplicate message in channel', async () => {
    const snap = makeSnap({
      channelStates: {
        'n2': {
          'n1': [
            { id: 'msg-1', payload: 'hello' },
            { id: 'msg-1', payload: 'hello' }, // duplicate!
          ],
        },
      },
    });
    const validator = new SnapshotValidator(makeStorage(snap), makeLogger([]));
    const result = await validator.validate('snap-1');

    expect(result.valid).toBe(false);
    const dup = result.violations.find(v => v.rule === 'DUPLICATE_MESSAGE');
    expect(dup).toBeDefined();
    expect(dup.msgId).toBe('msg-1');
  });

  test('detects orphan RECEIVE (no corresponding SEND)', async () => {
    const snap = makeSnap();
    const events = [
      { id: 'e1', type: 'RECEIVE', nodeId: 'n2', data: { msgId: 'ghost-msg' }, timestamp: 500, lamport: 3 },
    ];
    const validator = new SnapshotValidator(makeStorage(snap), makeLogger(events));
    const result = await validator.validate('snap-1');

    expect(result.valid).toBe(false);
    const orphan = result.violations.find(v => v.rule === 'ORPHAN_RECEIVE');
    expect(orphan).toBeDefined();
    expect(orphan.msgId).toBe('ghost-msg');
  });

  test('detects missing node state', async () => {
    const snap = makeSnap({ nodeStates: { 'n1': null, 'n2': { lamport: 3, vectorClock: {}, state: {} } } });
    const validator = new SnapshotValidator(makeStorage(snap), makeLogger([]));
    const result = await validator.validate('snap-1');

    expect(result.valid).toBe(false);
    const missing = result.violations.find(v => v.rule === 'MISSING_NODE_STATE');
    expect(missing).toBeDefined();
  });

  test('snapshot not found returns invalid', async () => {
    const validator = new SnapshotValidator(makeStorage(null), makeLogger([]));
    const result = await validator.validate('nonexistent');

    expect(result.valid).toBe(false);
    expect(result.violations[0].rule).toBe('SNAPSHOT_NOT_FOUND');
  });

  test('returns snapshot hash in stats', async () => {
    const snap = makeSnap();
    const validator = new SnapshotValidator(makeStorage(snap), makeLogger([]));
    const result = await validator.validate('snap-1');

    expect(result.stats.snapshotHash).toBeDefined();
    expect(result.stats.snapshotHash.length).toBeGreaterThan(8);
  });
});

// ── Deterministic Replay Sort Tests ──────────────────────────────────────────

describe('ReplayEngine (deterministic sort)', () => {
  function makeReplay() {
    const storage = { load: async () => null, list: async () => [] };
    const logger = makeLogger([]);
    return new ReplayEngine(storage, logger, [], () => {});
  }

  test('events with happens-before are sorted causally', () => {
    const replay = makeReplay();
    const events = [
      { id: 'e2', nodeId: 'n2', lamport: 2, timestamp: 200, vectorClock: { n1: 1, n2: 1 } },
      { id: 'e1', nodeId: 'n1', lamport: 1, timestamp: 100, vectorClock: { n1: 1, n2: 0 } },
    ];
    const sorted = replay._causalSort(events);
    expect(sorted[0].id).toBe('e1');
    expect(sorted[1].id).toBe('e2');
  });

  test('concurrent events use Lamport as tiebreaker', () => {
    const replay = makeReplay();
    const events = [
      { id: 'eB', nodeId: 'n2', lamport: 5, timestamp: 200, vectorClock: { n1: 0, n2: 1 } },
      { id: 'eA', nodeId: 'n1', lamport: 3, timestamp: 100, vectorClock: { n1: 1, n2: 0 } },
    ];
    const sorted = replay._causalSort(events);
    expect(sorted[0].id).toBe('eA'); // lower Lamport first
    expect(sorted[1].id).toBe('eB');
  });

  test('same Lamport uses nodeId as tiebreaker (determinism guarantee)', () => {
    const replay = makeReplay();
    const events = [
      { id: 'eZ', nodeId: 'n2', lamport: 3, timestamp: 100, vectorClock: { n1: 0, n2: 1 } },
      { id: 'eA', nodeId: 'n1', lamport: 3, timestamp: 100, vectorClock: { n1: 1, n2: 0 } },
    ];
    const sorted = replay._causalSort(events);
    // n1 < n2 lexicographically → n1 should come first
    expect(sorted[0].nodeId).toBe('n1');
    expect(sorted[1].nodeId).toBe('n2');
  });

  test('same input always produces same output (idempotent)', () => {
    const replay = makeReplay();
    const events = [
      { id: 'e3', nodeId: 'n3', lamport: 3, timestamp: 300, vectorClock: { n1: 0, n2: 0, n3: 1 } },
      { id: 'e1', nodeId: 'n1', lamport: 1, timestamp: 100, vectorClock: { n1: 1, n2: 0, n3: 0 } },
      { id: 'e2', nodeId: 'n2', lamport: 2, timestamp: 200, vectorClock: { n1: 1, n2: 1, n3: 0 } },
    ];
    const sorted1 = replay._causalSort([...events]);
    const sorted2 = replay._causalSort([...events]);
    const ids1 = sorted1.map(e => e.id);
    const ids2 = sorted2.map(e => e.id);
    expect(ids1).toEqual(ids2);
  });

  test('computeStateHash is stable across calls', () => {
    const replay = makeReplay();
    const states = {
      n1: { lamport: 5, state: { counter: 5 }, vectorClock: { n1: 5, n2: 3 } },
      n2: { lamport: 3, state: { counter: 3 }, vectorClock: { n1: 2, n2: 3 } },
    };
    const h1 = replay.computeStateHash(states);
    const h2 = replay.computeStateHash(states);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex length
  });

  test('different states produce different hashes', () => {
    const replay = makeReplay();
    const s1 = { n1: { lamport: 5, state: { counter: 5 }, vectorClock: {} } };
    const s2 = { n1: { lamport: 6, state: { counter: 6 }, vectorClock: {} } };
    expect(replay.computeStateHash(s1)).not.toBe(replay.computeStateHash(s2));
  });
});
