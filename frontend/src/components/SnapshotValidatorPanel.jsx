import { useState } from 'react';

const API = '/api';

const RULE_DESCRIPTIONS = {
  'DUPLICATE_MESSAGE': 'Message appears multiple times across channel states',
  'ORPHAN_RECEIVE': 'RECEIVE event with no corresponding SEND in history',
  'CHANNEL_MSG_NO_SEND': 'Channel message with no SEND record',
  'ALREADY_RECEIVED': 'Channel message was received before snapshot started',
  'MISSING_NODE_STATE': 'Node has null/undefined state in snapshot',
  'INVALID_LAMPORT': 'Node has invalid Lamport timestamp',
  'INVALID_VECTOR_CLOCK': 'Node has invalid vector clock',
  'SNAPSHOT_NOT_FOUND': 'Snapshot not found in storage',
};

/**
 * SnapshotValidatorPanel — validates Chandy-Lamport snapshot invariants.
 */
export default function SnapshotValidatorPanel({ snapshots }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [batchResults, setBatchResults] = useState(null);

  const validate = async () => {
    if (!selectedId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/snapshot/validate/${selectedId}`);
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const validateAll = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/snapshot/validate-all`);
      setBatchResults(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="section-title mb-12">Chandy-Lamport Snapshot Validation</div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
        Formally verifies snapshot consistency invariants: no missing messages,
        no duplicates, channel consistency, and no orphan receives.
      </p>

      <div className="flex-row gap-8 mb-12" style={{ flexWrap: 'wrap' }}>
        <select
          style={{ flex: 1, minWidth: 200, background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">— Select snapshot —</option>
          {snapshots.map(s => <option key={s.id} value={s.id}>{s.id?.slice(0, 20)}…</option>)}
        </select>
        <button className="btn btn-primary" onClick={validate} disabled={!selectedId || loading}>
          {loading ? '⏳ Validating…' : '✅ Validate'}
        </button>
        <button className="btn" onClick={validateAll} disabled={loading}>
          Validate All ({snapshots.length})
        </button>
      </div>

      {/* Batch results */}
      {batchResults && (
        <div className="card" style={{ margin: '0 0 12px 0' }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📋</span> Batch Validation Results</div>
            <span className="badge badge-blue">{batchResults.length} snapshots</span>
          </div>
          <div className="card-body" style={{ padding: '6px 16px' }}>
            {batchResults.map(r => (
              <div key={r.id} className="node-stat">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{r.id?.slice(0, 16)}…</span>
                <span className={`badge ${r.valid ? 'badge-green' : 'badge-red'}`}>
                  {r.valid ? '✓ Valid' : `✗ ${r.violations} violations`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Single validation result */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Status banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '16px',
            background: result.valid ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            borderRadius: 10,
            border: `1px solid ${result.valid ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            <div style={{ fontSize: 32 }}>{result.valid ? '✅' : '❌'}</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: result.valid ? '#4ade80' : '#f87171' }}>
                {result.valid ? 'Snapshot is Consistent' : `${result.violations?.length} Invariant Violations`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {result.stats?.totalNodes} nodes · {result.stats?.channelMessages} channel messages · hash: {result.stats?.snapshotHash}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { label: 'Nodes', val: result.stats?.totalNodes },
              { label: 'Channels', val: result.stats?.totalChannels },
              { label: 'SEND events', val: result.stats?.sendEvents },
              { label: 'RECEIVE events', val: result.stats?.receiveEvents },
            ].map(({ label, val }) => (
              <div key={label} className="stat-card" style={{ padding: '10px 12px' }}>
                <div className="stat-label" style={{ fontSize: 10 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{val ?? '—'}</div>
              </div>
            ))}
          </div>

          {/* Violations list */}
          {result.violations?.length > 0 && (
            <div className="card" style={{ margin: 0, border: '1px solid rgba(239,68,68,0.3)' }}>
              <div className="card-header">
                <div className="card-title" style={{ color: '#f87171' }}>
                  <span className="card-title-icon">🚨</span> Violations
                </div>
              </div>
              <div className="card-body" style={{ padding: '8px 16px' }}>
                {result.violations.map((v, i) => (
                  <div key={i} style={{ padding: '10px 0', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span className="badge badge-red">{v.rule}</span>
                      {v.nodeId && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>node: {v.nodeId}</span>}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{v.details}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {RULE_DESCRIPTIONS[v.rule] || ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !batchResults && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">✅</div>
          <p>Select a snapshot to validate its Chandy-Lamport consistency invariants.</p>
        </div>
      )}
    </div>
  );
}
