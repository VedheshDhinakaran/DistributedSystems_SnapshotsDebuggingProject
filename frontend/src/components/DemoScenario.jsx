import { useState, useEffect, useRef } from 'react';
import CausalityGraph from './CausalityGraph.jsx';

const API = '/api';

const STEP_DESCRIPTIONS = [
  { num: 1, icon: '📤', desc: 'node-1 sends 3 messages to node-2', subtext: 'Establishes causal chain' },
  { num: 2, icon: '📸', desc: 'Coordinator initiates distributed snapshot', subtext: 'Chandy-Lamport markers propagate' },
  { num: 3, icon: '💥', desc: 'node-2 crashes mid-marker receive', subtext: 'Channel state is incomplete' },
  { num: 4, icon: '🔍', desc: 'Snapshot consistency validation', subtext: 'Detect missing channel state' },
  { num: 5, icon: '♻️', desc: 'node-2 recovers + deterministic replay', subtext: 'Verify state reconstruction' },
];

const STATUS_COLORS = {
  pending: 'var(--text-muted)',
  running: '#60a5fa',
  complete: '#4ade80',
  warning: '#fbbf24',
  error: '#f87171',
};

const STATUS_ICONS = {
  pending: '○',
  running: '⏳',
  complete: '✅',
  warning: '⚠️',
  error: '❌',
};

/**
 * DemoScenario — "Crash During Snapshot" scripted demo visualization.
 */
export default function DemoScenario() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [demoEvents, setDemoEvents] = useState([]);
  const eventFeedRef = useRef(null);

  // Poll status during run
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/demo/status`);
        const data = await res.json();
        setStatus(data);
        if (data.events) setDemoEvents(data.events);
      } catch (_) {}
    }, 600);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll event feed
  useEffect(() => {
    if (eventFeedRef.current) {
      eventFeedRef.current.scrollTop = eventFeedRef.current.scrollHeight;
    }
  }, [demoEvents]);

  const runDemo = async () => {
    setLoading(true);
    try {
      await fetch(`${API}/demo/run`, { method: 'POST' });
    } finally {
      setLoading(false);
    }
  };

  const resetDemo = async () => {
    await fetch(`${API}/demo/reset`, { method: 'POST' });
    setDemoEvents([]);
  };

  const phase = status?.phase || 'idle';
  const isRunning = phase === 'running';
  const isComplete = phase === 'complete';
  const hasError = phase === 'error';
  const currentStep = status?.currentStep || 0;

  const pct = currentStep > 0 ? Math.round((currentStep / 5) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header + control buttons */}
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 4 }}>Crash-During-Snapshot Failure Demo</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: 0 }}>
            Scripted 5-step scenario: message send → snapshot → mid-crash → validate → recover + replay
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={resetDemo} disabled={isRunning}>↺ Reset</button>
          <button
            className="btn btn-success"
            onClick={runDemo}
            disabled={isRunning || loading}
          >
            {isRunning ? '⏳ Running…' : '🎬 Run Crash Scenario'}
          </button>
        </div>
      </div>

      {/* Phase status badge */}
      {status && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
          background: isComplete ? 'rgba(34,197,94,0.08)' : hasError ? 'rgba(239,68,68,0.08)' : isRunning ? 'rgba(96,165,250,0.08)' : 'var(--surface-2)',
          borderRadius: 8,
          border: `1px solid ${isComplete ? 'rgba(74,222,128,0.3)' : hasError ? 'rgba(248,113,113,0.3)' : isRunning ? 'rgba(96,165,250,0.3)' : 'var(--border)'}`,
          fontSize: 12,
        }}>
          <span style={{ fontSize: 16 }}>{isComplete ? '✅' : hasError ? '❌' : isRunning ? '⏳' : '○'}</span>
          <span style={{ color: isComplete ? '#4ade80' : hasError ? '#f87171' : isRunning ? '#60a5fa' : 'var(--text-muted)', fontWeight: 600 }}>
            {phase.toUpperCase()}
          </span>
          {status.startedAt && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
              {isComplete ? `completed in ${((status.completedAt - status.startedAt) / 1000).toFixed(1)}s` : `step ${currentStep}/5`}
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      {isRunning && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden', height: 6 }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: 'linear-gradient(90deg, #60a5fa, #4ade80)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      )}

      {/* 5-step timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
        {STEP_DESCRIPTIONS.map((step) => {
          const stepState = status?.steps?.[step.num - 1] || { status: 'pending' };
          const isActive = status?.currentStep === step.num && isRunning;
          return (
            <div
              key={step.num}
              style={{
                background: isActive ? 'rgba(96,165,250,0.1)' : 'var(--surface-2)',
                border: `1px solid ${isActive ? 'rgba(96,165,250,0.4)' : 'var(--border)'}`,
                borderRadius: 10, padding: '12px 10px',
                transition: 'all 0.3s',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {isActive && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, #60a5fa, #4ade80)',
                  animation: 'pulse 1.5s ease infinite',
                }} />
              )}
              <div style={{ fontSize: 18, marginBottom: 4 }}>{step.icon}</div>
              <div style={{ fontSize: 10, color: STATUS_COLORS[stepState.status] || 'var(--text-muted)', marginBottom: 4 }}>
                {STATUS_ICONS[stepState.status] || '○'} Step {step.num}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.3 }}>
                {step.desc}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                {step.subtext}
              </div>
              {stepState.detail && (
                <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {typeof stepState.detail === 'object'
                    ? Object.entries(stepState.detail).map(([k, v]) => `${k}: ${v}`).join(' · ')
                    : stepState.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Live event feed */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📡</span> Demo Event Stream</div>
            <span className="badge badge-blue">{demoEvents.length} events</span>
          </div>
          <div
            ref={eventFeedRef}
            className="card-body event-feed"
            style={{ padding: '8px 12px', maxHeight: 220, overflowY: 'auto' }}
          >
            {demoEvents.length === 0 ? (
              <div className="empty-state" style={{ padding: '20px 0' }}>
                <div className="empty-state-icon">📡</div>
                <p>Run the demo to see events</p>
              </div>
            ) : (
              demoEvents.map((e, i) => (
                <div key={i} className="event-item" style={{
                  color: e.severity === 'error' ? '#f87171' : e.type?.includes('step3') ? '#fbbf24' : undefined
                }}>
                  <span className="event-time">{new Date(e.demoTimestamp || 0).toISOString().substr(11, 8)}</span>
                  <span className={`badge ${
                    e.type?.includes('complete') ? 'badge-green' :
                    e.type?.includes('step3') || e.severity === 'error' ? 'badge-red' :
                    e.type?.includes('step4') ? 'badge-amber' :
                    'badge-blue'
                  }`} style={{ fontSize: 9 }}>{e.type}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{e.message || ''}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Validation result */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🔍</span> Validation + Replay</div>
          </div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {status?.validationResult ? (
              <div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  background: status.validationResult.valid ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                  borderRadius: 8, border: `1px solid ${status.validationResult.valid ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
                  marginBottom: 10
                }}>
                  <span style={{ fontSize: 22 }}>{status.validationResult.valid ? '✅' : '❌'}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: status.validationResult.valid ? '#4ade80' : '#f87171', fontSize: 13 }}>
                      {status.validationResult.valid ? 'Snapshot Consistent' : 'Inconsistency Detected'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {status.validationResult.violations?.length || 0} violations
                    </div>
                  </div>
                </div>

                {status.validationResult.violations?.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    {status.validationResult.violations.map((v, i) => (
                      <div key={i} style={{ padding: '4px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                        <span className="badge badge-red" style={{ fontSize: 9, marginBottom: 2, display: 'inline-block' }}>{v.rule}</span>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{v.details}</div>
                      </div>
                    ))}
                  </div>
                )}

                {status?.replayResult && (
                  <div style={{
                    background: 'var(--surface-2)', borderRadius: 6, padding: '8px 10px', fontSize: 11
                  }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Deterministic Replay</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: status.replayResult.deterministic ? '#4ade80' : '#f87171' }}>
                        {status.replayResult.deterministic ? '✅ Deterministic' : '❌ Non-deterministic'}
                      </span>
                      {status.replayResult.eventCount !== undefined && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{status.replayResult.eventCount} events replayed</span>
                      )}
                    </div>
                    {status.replayResult.baselineHash && (
                      <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: '#475569' }}>
                        hash: {status.replayResult.baselineHash?.slice(0, 20)}…
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '30px 0' }}>
                <div className="empty-state-icon">🔍</div>
                <p>Validation results appear here after step 4</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live causality mini-DAG */}
      {(isRunning || isComplete || demoEvents.length > 0) && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🕸️</span> Live Causality DAG (during demo)</div>
            <span className="badge badge-purple">Auto-refresh</span>
          </div>
          <div className="card-body">
            <CausalityGraph replayEvent={null} replayIndex={-1} />
          </div>
        </div>
      )}
    </div>
  );
}
