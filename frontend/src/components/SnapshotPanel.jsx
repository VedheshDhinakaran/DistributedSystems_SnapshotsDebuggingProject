import { useState } from 'react';

const API = '/api';

/**
 * SnapshotPanel — list of available snapshots with trigger + restore actions.
 */
export default function SnapshotPanel({ snapshots, onRefresh }) {
  const [triggering, setTriggering] = useState(false);

  const triggerSnapshot = async () => {
    setTriggering(true);
    try {
      await fetch(`${API}/snapshot`, { method: 'POST' });
      await onRefresh?.();
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div>
      <div className="flex-between mb-12">
        <div className="section-title" style={{ marginBottom: 0 }}>
          Stored Snapshots ({snapshots.length})
        </div>
        <button className="btn btn-success" onClick={triggerSnapshot} disabled={triggering}>
          {triggering ? '⏳ Capturing…' : '📸 Trigger Snapshot'}
        </button>
      </div>

      {snapshots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <p>No snapshots yet. Trigger one above.</p>
        </div>
      ) : (
        <div className="snapshot-list">
          {snapshots.map(s => (
            <div key={s.id} className="snapshot-item">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span className="snapshot-id">{s.id}</span>
                <span className="snapshot-meta">
                  {new Date(s.initiatedAt).toLocaleTimeString()} ·
                  {s.nodeCount} nodes ·
                  {s.metrics?.latencyMs ? ` ${s.metrics.latencyMs}ms` : ''}
                </span>
              </div>
              <div className="snapshot-actions">
                <span className="badge badge-green">✓ Stored</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
