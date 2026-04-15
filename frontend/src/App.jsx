import { useState, useEffect, useRef, useCallback } from 'react';
import NetworkGraph from './components/NetworkGraph.jsx';
import EventTimeline from './components/EventTimeline.jsx';
import CausalityGraph from './components/CausalityGraph.jsx';
import ReplayControls from './components/ReplayControls.jsx';
import SnapshotPanel from './components/SnapshotPanel.jsx';
import FaultInjector from './components/FaultInjector.jsx';
import BenchmarkChart from './components/BenchmarkChart.jsx';
import ReplayVerifier from './components/ReplayVerifier.jsx';
import SnapshotValidatorPanel from './components/SnapshotValidatorPanel.jsx';
import DemoScenario from './components/DemoScenario.jsx';

const API = '/api';
const WS_URL = `ws://${window.location.hostname}:3001/ws`;

const TABS = [
  { id: 'overview', label: 'Overview', icon: '🗺️' },
  { id: 'timeline', label: 'Timeline', icon: '⏱️' },
  { id: 'causality', label: 'Causality DAG', icon: '🖗' },
  { id: 'snapshots', label: 'Snapshots', icon: '📸' },
  { id: 'replay', label: 'Time-Travel', icon: '⏮️' },
  { id: 'faults', label: 'Fault Injection', icon: '⚡' },
  { id: 'benchmark', label: 'Benchmark', icon: '📈' },
  { id: 'validation', label: 'Validation', icon: '✅' },
  { id: 'verify', label: 'Verify Replay', icon: '🔍' },
  { id: 'demo', label: 'Demo Scenario', icon: '🎬' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [nodes, setNodes] = useState({});
  const [events, setEvents] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [faults, setFaults] = useState({});
  const [replayState, setReplayState] = useState({ isPlaying: false, currentIndex: -1, totalEvents: 0, currentEvent: null, snapshotId: null });
  const [wsStatus, setWsStatus] = useState('disconnected');
  const [stats, setStats] = useState({ totalEvents: 0, totalSends: 0, totalDrops: 0, snapCount: 0 });

  const wsRef = useRef(null);

  // ── Stats tracker ────────────────────────────────────────────────────────
  const statsRef = useRef({ totalEvents: 0, totalSends: 0, totalDrops: 0, snapCount: 0 });

  // ── Fetch initial data ────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [nodesRes, eventsRes, snapRes, faultsRes] = await Promise.all([
        fetch(`${API}/nodes`).then(r => r.json()),
        fetch(`${API}/events?limit=300`).then(r => r.json()),
        fetch(`${API}/snapshots`).then(r => r.json()),
        fetch(`${API}/faults`).then(r => r.json()),
      ]);
      setNodes(nodesRes);
      setEvents(eventsRes);
      setSnapshots(snapRes);
      setFaults(faultsRes);
    } catch (err) {
      // Backend may not be up yet
    }
  }, []);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(connectWs, 3000);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleWsMessage(msg);
      } catch (_) {}
    };
  }, []);

  const handleWsMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'event':
        statsRef.current.totalEvents++;
        if (msg.event?.type === 'SEND') statsRef.current.totalSends++;
        if (msg.event?.type === 'MESSAGE_DROP') statsRef.current.totalDrops++;
        setStats({ ...statsRef.current });
        setEvents(prev => {
          const next = [...prev, msg.event].slice(-500);
          return next;
        });
        break;

      case 'snapshot':
        statsRef.current.snapCount++;
        setStats({ ...statsRef.current });
        fetchAll(); // Refresh snapshot list
        break;

      case 'messageSent':
      case 'messageReceived':
      case 'internalEvent':
        // Update node state if available
        if (msg.nodeId) {
          setNodes(prev => {
            if (!prev[msg.nodeId]) return prev;
            const counter = msg.counter ?? prev[msg.nodeId]?.state?.counter;
            return {
              ...prev,
              [msg.nodeId]: {
                ...prev[msg.nodeId],
                state: { ...prev[msg.nodeId]?.state, counter },
                vectorClock: msg.vectorClock || prev[msg.nodeId]?.vectorClock,
                lamport: msg.lamport || prev[msg.nodeId]?.lamport,
              },
            };
          });
        }
        break;

      case 'nodeCrashed':
        setNodes(prev => ({
          ...prev,
          [msg.nodeId]: { ...prev[msg.nodeId], crashed: true, status: 'crashed' },
        }));
        break;

      case 'nodeRecovered':
        setNodes(prev => ({
          ...prev,
          [msg.nodeId]: { ...prev[msg.nodeId], crashed: false, status: 'active' },
        }));
        break;

      case 'replay':
        setReplayState(prev => ({
          ...prev,
          isPlaying: msg.action === 'playing',
          currentIndex: msg.currentIndex ?? prev.currentIndex,
          totalEvents: msg.totalEvents ?? prev.totalEvents,
          currentEvent: msg.event || prev.currentEvent,
          snapshotId: msg.snapshotId ?? prev.snapshotId,
        }));
        break;
    }
  }, [fetchAll]);

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchAll();
    connectWs();
    const interval = setInterval(fetchAll, 10000); // Periodic refresh
    return () => { clearInterval(interval); wsRef.current?.close(); };
  }, [fetchAll, connectWs]);

  const nodeIds = Object.keys(nodes);
  const activeNodes = Object.values(nodes).filter(n => !n.crashed).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-logo">
          <div className="logo-icon">⬡</div>
          <div>
            <div className="logo-text">DistDebug</div>
            <div className="logo-sub">Distributed Snapshot & Time-Travel Debugger</div>
          </div>
        </div>
        <div className="header-status">
          <div className={`status-dot ${wsStatus !== 'connected' ? 'disconnected' : ''}`}>
            {wsStatus === 'connected' ? 'Live' : 'Disconnected'}
          </div>
          <span className="badge badge-blue">{activeNodes}/{nodeIds.length} nodes active</span>
          <span className="badge badge-purple">{snapshots.length} snapshots</span>
        </div>
      </header>

      {/* Tabs */}
      <nav className="app-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="app-content fade-in">
        {/* Stats bar */}
        <div className="stats-bar">
          <div className="stat-card">
            <div className="stat-label">Active Nodes</div>
            <div className="stat-value">{activeNodes}</div>
            <div className="stat-sub">of {nodeIds.length} total</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Events Logged</div>
            <div className="stat-value">{stats.totalEvents.toLocaleString()}</div>
            <div className="stat-sub">this session</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Msgs Sent</div>
            <div className="stat-value">{stats.totalSends}</div>
            <div className="stat-sub">across all nodes</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Msgs Dropped</div>
            <div className="stat-value" style={{ backgroundImage: stats.totalDrops > 0 ? 'linear-gradient(135deg, #f87171, #ef4444)' : undefined }}>
              {stats.totalDrops}
            </div>
            <div className="stat-sub">by fault injection</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Snapshots</div>
            <div className="stat-value">{snapshots.length}</div>
            <div className="stat-sub">stored globally</div>
          </div>
        </div>

        {/* ── Tab: Overview ─────────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="two-col">
              {/* Network Graph */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title"><span className="card-title-icon">🌐</span> Node Communication Graph</div>
                  <span className="badge badge-blue">Live</span>
                </div>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  <NetworkGraph nodes={nodes} recentEvents={events.slice(-100)} />
                </div>
              </div>

              {/* Node cards */}
              <div className="card">
                <div className="card-header">
                  <div className="card-title"><span className="card-title-icon">🖥️</span> Node States</div>
                </div>
                <div className="card-body">
                  <div className="nodes-grid">
                    {nodeIds.map(id => {
                      const n = nodes[id];
                      return (
                        <div key={id} className={`node-card${n.crashed ? ' crashed' : ''}`}>
                          <div className="node-card-header">
                            <span className="node-id">{id}</span>
                            <span className={`badge ${n.crashed ? 'badge-red' : 'badge-green'}`}>
                              {n.crashed ? '✗ Crashed' : '✓ Active'}
                            </span>
                          </div>
                          <div className="node-stat"><span>Counter</span><span>{n.state?.counter || 0}</span></div>
                          <div className="node-stat"><span>Lamport</span><span>{n.lamport || 0}</span></div>
                          <div className="node-stat" style={{ overflow: 'hidden' }}>
                            <span>VClock</span>
                            <span style={{ fontSize: 9, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {JSON.stringify(n.vectorClock || {})}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Live Event Feed */}
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">📡</span> Live Event Stream</div>
                <span className="badge badge-green">{events.length} events</span>
              </div>
              <div className="card-body" style={{ padding: '8px 12px' }}>
                <div className="event-feed">
                  {events.slice(-50).reverse().map((e, i) => (
                    <div key={e.id || i} className="event-item">
                      <span className="event-time">{new Date(e.timestamp || 0).toISOString().substr(11, 8)}</span>
                      <span className="event-node">{e.nodeId}</span>
                      <span className="event-desc">
                        <span className={`badge ${
                          e.type === 'SEND' ? 'badge-green' :
                          e.type === 'RECEIVE' ? 'badge-purple' :
                          e.type === 'NODE_CRASH' ? 'badge-red' :
                          e.type?.includes('SNAPSHOT') ? 'badge-amber' :
                          'badge-blue'
                        }`} style={{ marginRight: 6 }}>{e.type}</span>
                        {e.data?.message || e.data?.text || ''}
                      </span>
                      <span className="event-lp">L:{e.lamport}</span>
                    </div>
                  ))}
                  {events.length === 0 && (
                    <div className="empty-state"><div className="empty-state-icon">📡</div><p>Waiting for events…</p></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Timeline ─────────────────────────────────────────────────── */}
        {activeTab === 'timeline' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">⏱️</span> Event Timeline (Swim Lanes)</div>
              <span className="badge badge-blue">{events.length} events</span>
            </div>
            <div className="card-body">
              {events.length < 2 ? (
                <div className="empty-state"><div className="empty-state-icon">⏱️</div><p>Waiting for events…</p></div>
              ) : (
                <EventTimeline events={events} nodeIds={nodeIds} />
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Causality DAG ──────────────────────────────────────── */}
        {activeTab === 'causality' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🕸️</span> Causality DAG (Happens-Before Relationships)</div>
              <div className="flex-row gap-8">
                <span className="badge badge-purple">← ancestor</span>
                <span className="badge badge-green">descendant →</span>
                <span className="badge badge-amber">◌ concurrent</span>
              </div>
            </div>
            <div className="card-body">
              <CausalityGraph
                replayEvent={replayState.currentEvent}
                replayIndex={replayState.currentIndex}
              />
            </div>
          </div>
        )}

        {/* ── Tab: Snapshots ────────────────────────────────────────────────── */}
        {activeTab === 'snapshots' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📸</span> Distributed Snapshots (Chandy-Lamport)</div>
            </div>
            <div className="card-body">
              <SnapshotPanel snapshots={snapshots} onRefresh={fetchAll} />
            </div>
          </div>
        )}

        {/* ── Tab: Replay ───────────────────────────────────────────────────── */}
        {activeTab === 'replay' && (
          <div className="two-col">
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">⏮️</span> Time-Travel Replay</div>
                <span className={`badge ${replayState.isPlaying ? 'badge-green' : 'badge-blue'}`}>
                  {replayState.isPlaying ? '▶ Playing' : '⏸ Paused'}
                </span>
              </div>
              <div className="card-body">
                <ReplayControls snapshots={snapshots} replayState={replayState} />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <div className="card-title"><span className="card-title-icon">🔍</span> Replay Timeline</div>
              </div>
              <div className="card-body">
                {replayState.snapshotId && events.length > 0 ? (
                  <EventTimeline events={events.slice(0, replayState.currentIndex + 1)} nodeIds={nodeIds} />
                ) : (
                  <div className="empty-state"><div className="empty-state-icon">⏮️</div><p>Load a snapshot to begin replay.</p></div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Fault Injection ─────────────────────────────────────────── */}
        {activeTab === 'faults' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">⚡</span> Fault Injection System</div>
              <span className="badge badge-amber">Danger Zone</span>
            </div>
            <div className="card-body">
              {nodeIds.length === 0 ? (
                <div className="empty-state">Connecting to backend…</div>
              ) : (
                <FaultInjector nodeIds={nodeIds} faults={faults} />
              )}
            </div>
          </div>
        )}

        {/* ── Tab: Benchmark ────────────────────────────────────────────────── */}
        {activeTab === 'benchmark' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">📈</span> Performance Benchmarks</div>
              <span className="badge badge-blue">Research Mode</span>
            </div>
            <div className="card-body">
              <BenchmarkChart />
            </div>
          </div>
        )}

        {/* ── Tab: Validation ───────────────────────────────────────────────── */}
        {activeTab === 'validation' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">✅</span> Snapshot Consistency Validation</div>
              <span className="badge badge-green">Chandy-Lamport Invariants</span>
            </div>
            <div className="card-body">
              <SnapshotValidatorPanel snapshots={snapshots} />
            </div>
          </div>
        )}

        {/* ── Tab: Verify Replay ────────────────────────────────────── */}
        {activeTab === 'verify' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🔍</span> Deterministic Replay Verification</div>
              <span className="badge badge-purple">SHA-256 Hash Comparison</span>
            </div>
            <div className="card-body">
              <ReplayVerifier snapshots={snapshots} />
            </div>
          </div>
        )}

        {/* ── Tab: Demo Scenario ─────────────────────────────────────── */}
        {activeTab === 'demo' && (
          <div className="card">
            <div className="card-header">
              <div className="card-title"><span className="card-title-icon">🎬</span> Crash-During-Snapshot Demo</div>
              <span className="badge badge-amber">Scripted Failure Scenario</span>
            </div>
            <div className="card-body">
              <DemoScenario />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
