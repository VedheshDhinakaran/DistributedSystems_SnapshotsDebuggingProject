const EventLogger = require('../src/logging/eventLogger');
const EventTypes = require('../src/logging/logTypes');

describe('Snapshot Integration (Chandy-Lamport)', () => {
  const MessageBus = require('../src/node/messageBus');
  const FaultController = require('../src/faultInjection/faultController');
  const EdgeNode = require('../src/node/edgeNode');
  const SnapshotCoordinator = require('../src/snapshot/coordinator');
  const SnapshotStorage = require('../src/snapshot/snapshotStorage');

  let messageBus, faultController, eventLogger, storage, coordinator, nodes;
  const nodeIds = ['n1', 'n2', 'n3'];

  beforeEach(() => {
    messageBus = new MessageBus();
    faultController = new FaultController();
    eventLogger = new EventLogger();
    storage = new SnapshotStorage();
    nodes = nodeIds.map(id => new EdgeNode(id, nodeIds, messageBus, eventLogger, faultController));
    for (const node of nodes) messageBus.register(node);
    coordinator = new SnapshotCoordinator(messageBus, storage, eventLogger);
    coordinator.wireNodes(nodes);
  });

  afterEach(() => {
    for (const node of nodes) {
      if (node._intervalHandle) clearInterval(node._intervalHandle);
    }
  });

  test('snapshot completes with all node states', async () => {
    // Start nodes briefly
    for (const node of nodes) node.start();
    await new Promise(r => setTimeout(r, 200));

    const snapshot = await coordinator.initiateSnapshot();

    expect(snapshot).toBeDefined();
    expect(snapshot.id).toBeTruthy();
    expect(Object.keys(snapshot.nodeStates).length).toBe(3);
    expect(snapshot.nodeStates['n1']).toBeDefined();
    expect(snapshot.nodeStates['n2']).toBeDefined();
    expect(snapshot.nodeStates['n3']).toBeDefined();
  }, 10000);

  test('snapshot can be stored and loaded', async () => {
    for (const node of nodes) node.start();
    await new Promise(r => setTimeout(r, 200));

    const snapshot = await coordinator.initiateSnapshot();
    const loaded = await storage.load(snapshot.id);

    expect(loaded).not.toBeNull();
    expect(loaded.id).toBe(snapshot.id);
    expect(Object.keys(loaded.nodeStates).length).toBe(3);
  }, 10000);

  test('snapshot metrics include latency', async () => {
    for (const node of nodes) node.start();
    await new Promise(r => setTimeout(r, 200));

    const snapshot = await coordinator.initiateSnapshot();
    expect(snapshot.metrics.latencyMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.metrics.nodeCount).toBe(3);
  }, 10000);

  test('event logger captures events during simulation', async () => {
    for (const node of nodes) node.start();
    await new Promise(r => setTimeout(r, 600));

    const events = await eventLogger.query({});
    expect(events.length).toBeGreaterThan(0);

    const hasInternal = events.some(e => e.type === EventTypes.INTERNAL || e.type === EventTypes.NODE_RECOVER);
    expect(hasInternal).toBe(true);
  }, 10000);
});
