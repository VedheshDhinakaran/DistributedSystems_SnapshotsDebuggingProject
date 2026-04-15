const LamportClock = require('../src/clocks/lamportClock');
const VectorClock = require('../src/clocks/vectorClock');

// ── Lamport Clock Tests ────────────────────────────────────────────────────────
describe('LamportClock', () => {
  test('starts at 0', () => {
    const lc = new LamportClock('A');
    expect(lc.value()).toBe(0);
  });

  test('increments correctly', () => {
    const lc = new LamportClock('A');
    lc.increment();
    expect(lc.value()).toBe(1);
    lc.increment();
    expect(lc.value()).toBe(2);
  });

  test('update takes max(local, received) + 1', () => {
    const a = new LamportClock('A');
    a.increment(); // a=1
    a.update(5);   // max(1,5)+1 = 6
    expect(a.value()).toBe(6);
  });

  test('update when local > received', () => {
    const a = new LamportClock('A');
    a.increment(); // a=1
    a.increment(); // a=2
    a.increment(); // a=3
    a.update(1);   // max(3,1)+1 = 4
    expect(a.value()).toBe(4);
  });

  test('provides ordering: send before receive', () => {
    const sender = new LamportClock('S');
    const receiver = new LamportClock('R');
    sender.increment(); // send event: s=1
    receiver.update(sender.value()); // receive: max(0,1)+1 = 2
    expect(receiver.value()).toBeGreaterThan(sender.value());
  });
});

// ── Vector Clock Tests ─────────────────────────────────────────────────────────
describe('VectorClock', () => {
  const nodes = ['A', 'B', 'C'];

  test('initializes to all zeros', () => {
    const vc = new VectorClock('A', nodes);
    expect(vc.toObject()).toEqual({ A: 0, B: 0, C: 0 });
  });

  test('increment updates own component only', () => {
    const vc = new VectorClock('A', nodes);
    vc.increment();
    expect(vc.toObject()).toEqual({ A: 1, B: 0, C: 0 });
  });

  test('merge does element-wise max then increments own', () => {
    const a = new VectorClock('A', nodes);
    const b = new VectorClock('B', nodes);
    a.increment(); // A: {A:1, B:0, C:0}
    b.increment(); // B: {A:0, B:1, C:0}
    b.increment(); // B: {A:0, B:2, C:0}

    // A receives from B
    a.merge(b.toObject()); // max(A,B) = {A:1, B:2, C:0}, then A++ = {A:2, B:2, C:0}
    expect(a.toObject()).toEqual({ A: 2, B: 2, C: 0 });
  });

  test('happensBefore: A→B after A sends to B', () => {
    const a = new VectorClock('A', nodes);
    const b = new VectorClock('B', nodes);
    a.increment();
    const sentClock = a.toObject(); // snapshot of A's clock at send time

    b.merge(sentClock); // B receives
    const receivedClock = b.toObject();

    expect(VectorClock.happensBefore(sentClock, receivedClock)).toBe(true);
    expect(VectorClock.happensBefore(receivedClock, sentClock)).toBe(false);
  });

  test('concurrent events: no causal relation', () => {
    const a = new VectorClock('A', nodes);
    const b = new VectorClock('B', nodes);
    a.increment(); // A acts independently
    b.increment(); // B acts independently

    expect(VectorClock.concurrent(a.toObject(), b.toObject())).toBe(true);
  });

  test('equal clocks', () => {
    const a = new VectorClock('A', nodes);
    const b = new VectorClock('A', nodes);
    a.increment();
    b.increment();
    expect(VectorClock.equal(a.toObject(), b.toObject())).toBe(true);
  });

  test('clone produces independent copy', () => {
    const a = new VectorClock('A', nodes);
    a.increment();
    const copy = a.clone();
    a.increment();
    expect(copy.toObject().A).toBe(1);
    expect(a.toObject().A).toBe(2);
  });

  test('no double counting in merge', () => {
    // Simulate A sends, B receives, B sends back to A — A should not double-count
    const a = new VectorClock('A', nodes);
    const b = new VectorClock('B', nodes);
    a.increment(); // A sends: {A:1}
    b.merge(a.toObject()); // B receives+ticks: {A:1, B:1}
    const bAfterReceive = b.toObject();
    a.merge(bAfterReceive); // A receives back: {A:2, B:1}
    expect(a.toObject()).toEqual({ A: 2, B: 1, C: 0 });
  });
});
