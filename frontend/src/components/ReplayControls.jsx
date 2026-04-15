import { useState } from 'react';

const API = '/api';

/**
 * ReplayControls — UI for loading snapshots and controlling time-travel replay.
 */
export default function ReplayControls({ snapshots, replayState }) {
  const [speed, setSpeed] = useState(500);
  const [loading, setLoading] = useState(false);

  const loadSnapshot = async (id) => {
    setLoading(true);
    try {
      await fetch(`${API}/replay/${id}/load`, { method: 'POST' });
    } finally {
      setLoading(false);
    }
  };

  const play = () => fetch(`${API}/replay/play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervalMs: speed }),
  });

  const pause = () => fetch(`${API}/replay/pause`, { method: 'POST' });
  const step = () => fetch(`${API}/replay/step`, { method: 'POST' });

  const jumpTo = (idx) => fetch(`${API}/replay/jump/${idx}`, { method: 'POST' });

  const progress = replayState.totalEvents > 0
    ? ((replayState.currentIndex + 1) / replayState.totalEvents) * 100
    : 0;

  return (
    <div className="replay-controls">
      {/* Snapshot selector */}
      {snapshots.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📸</div>
          <p>No snapshots yet. Trigger one from the Snapshot tab.</p>
        </div>
      ) : (
        <div>
          <div className="section-title">Select Snapshot to Restore</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
            {snapshots.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-deep)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <span className="snapshot-id">{s.id.slice(0, 16)}…</span>
                <span className="snapshot-meta">{s.nodeCount || 0} nodes · {s.metrics?.latencyMs || 0}ms</span>
                <button className="btn btn-primary" onClick={() => loadSnapshot(s.id)} disabled={loading} style={{ fontSize: 11, padding: '4px 10px' }}>
                  Load
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      {replayState.snapshotId && (
        <>
          <div className="replay-progress">
            <div className="flex-between" style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Event {Math.max(0, replayState.currentIndex + 1)} / {replayState.totalEvents}</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Speed control */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            <div className="fault-label">
              <span>Replay Speed</span>
              <span style={{ color: 'var(--accent-cyan)' }}>{speed}ms / step</span>
            </div>
            <input type="range" min={100} max={2000} step={100} value={speed} onChange={e => setSpeed(+e.target.value)} />
          </div>

          {/* Playback buttons */}
          <div className="replay-btns">
            <button className="btn btn-success" onClick={play} disabled={replayState.isPlaying}>▶ Play</button>
            <button className="btn btn-primary" onClick={pause} disabled={!replayState.isPlaying}>⏸ Pause</button>
            <button className="btn" onClick={step} disabled={replayState.isPlaying}>⏭ Step</button>
            <button className="btn" onClick={() => jumpTo(0)}>⏮ Reset</button>
          </div>

          {/* Current event display */}
          {replayState.currentEvent && (
            <div>
              <div className="section-title">Current Replay Event</div>
              <div className="replay-event">{JSON.stringify(replayState.currentEvent, null, 2)}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
