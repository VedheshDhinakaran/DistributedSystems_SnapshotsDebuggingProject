import { useState } from 'react';

const API = '/api';

/**
 * ReplayVerifier — shows deterministic replay verification results.
 * Compares SHA-256 state hashes between baseline and re-run.
 */
export default function ReplayVerifier({ snapshots }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  const verify = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/replay/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: selectedId }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="section-title mb-12">Deterministic Replay Verification</div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Runs replay twice from the same snapshot. Compares SHA-256 state hashes to verify determinism.
      </p>

      <div className="flex-row gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
        <select
          style={{ flex: 1, minWidth: 200, background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">— Select a snapshot —</option>
          {snapshots.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
        </select>
        <button className="btn btn-primary" onClick={verify} disabled={!selectedId || loading}>
          {loading ? '⏳ Verifying…' : '🔍 Verify'}
        </button>
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Status badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px', background: result.deterministic ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', borderRadius: 10, border: `1px solid ${result.deterministic ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            <div style={{ fontSize: 32 }}>{result.deterministic ? '✅' : '❌'}</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: result.deterministic ? '#4ade80' : '#f87171' }}>
                {result.deterministic ? 'Deterministic' : 'Non-Deterministic'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {result.eventCount} events replayed · verified at {new Date(result.verifiedAt).toLocaleTimeString()}
              </div>
            </div>
          </div>

          {/* Hash comparison */}
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header"><div className="card-title"><span className="card-title-icon">🔑</span> State Hash Comparison</div></div>
            <div className="card-body" style={{ padding: '8px 16px' }}>
              {[
                { label: 'Baseline Hash', hash: result.baselineHash, color: 'var(--accent-blue)' },
                { label: 'Replay #1 Hash', hash: result.replayHash, color: 'var(--accent-cyan)' },
                { label: 'Replay #2 Hash', hash: result.secondReplayHash, color: 'var(--accent-cyan)' },
              ].map(({ label, hash }) => (
                <div key={label} className="node-stat">
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>
                    {hash?.slice(0, 24)}…
                  </span>
                </div>
              ))}
              <div className="node-stat">
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Hashes Match</span>
                <span className={`badge ${result.replayHash === result.secondReplayHash ? 'badge-green' : 'badge-red'}`}>
                  {result.replayHash === result.secondReplayHash ? '✓ Yes' : '✗ No'}
                </span>
              </div>
            </div>
          </div>

          {/* Mismatches */}
          {result.mismatches?.length > 0 && (
            <div className="card" style={{ margin: 0, border: '1px solid rgba(239,68,68,0.3)' }}>
              <div className="card-header"><div className="card-title" style={{ color: '#f87171' }}><span className="card-title-icon">⚠️</span> Mismatches ({result.mismatches.length})</div></div>
              <div className="card-body" style={{ padding: '8px 16px' }}>
                {result.mismatches.map((m, i) => (
                  <div key={i} style={{ padding: '8px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>{m.type}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginTop: 2 }}>{m.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <p>Select a snapshot and click Verify to check deterministic replay.</p>
        </div>
      )}
    </div>
  );
}
