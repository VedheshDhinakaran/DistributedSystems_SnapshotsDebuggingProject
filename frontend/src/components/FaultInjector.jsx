import { useState } from 'react';

const API = '/api';

/**
 * FaultInjector — per-node fault configuration UI.
 * Controls crash probability, artificial delay, and message drop rate.
 */
export default function FaultInjector({ nodeIds, faults }) {
  const [configs, setConfigs] = useState(() =>
    Object.fromEntries(nodeIds.map(id => [id, {
      dropProbability: (faults[id]?.dropProbability || 0),
      delayMs: (faults[id]?.delayMs || 0),
    }]))
  );

  const apply = async (nodeId) => {
    await fetch(`${API}/fault/${nodeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configs[nodeId]),
    });
  };

  const clear = async (nodeId) => {
    await fetch(`${API}/fault/${nodeId}`, { method: 'DELETE' });
    setConfigs(prev => ({ ...prev, [nodeId]: { dropProbability: 0, delayMs: 0 } }));
  };

  const crashNode = async (nodeId) => {
    await fetch(`${API}/nodes/${nodeId}/crash`, { method: 'POST' });
  };

  const recoverNode = async (nodeId) => {
    await fetch(`${API}/nodes/${nodeId}/recover`, { method: 'POST' });
  };

  const update = (nodeId, field, val) => {
    setConfigs(prev => ({ ...prev, [nodeId]: { ...prev[nodeId], [field]: val } }));
  };

  return (
    <div>
      <div className="section-title mb-12">Per-Node Fault Configuration</div>
      <div className="fault-grid">
        {nodeIds.map(nodeId => (
          <div key={nodeId} className="fault-card">
            <h4>⚡ {nodeId}</h4>

            <div className="fault-control">
              <div className="fault-label">
                <span>Drop Probability</span>
                <span>{(configs[nodeId]?.dropProbability * 100 || 0).toFixed(0)}%</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05}
                value={configs[nodeId]?.dropProbability || 0}
                onChange={e => update(nodeId, 'dropProbability', +e.target.value)}
              />
            </div>

            <div className="fault-control">
              <div className="fault-label">
                <span>Added Delay</span>
                <span>{configs[nodeId]?.delayMs || 0}ms</span>
              </div>
              <input
                type="range" min={0} max={3000} step={100}
                value={configs[nodeId]?.delayMs || 0}
                onChange={e => update(nodeId, 'delayMs', +e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn btn-primary" onClick={() => apply(nodeId)} style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}>
                Apply
              </button>
              <button className="btn" onClick={() => clear(nodeId)} style={{ flex: 1, justifyContent: 'center', fontSize: 11 }}>
                Clear
              </button>
              <button className="btn btn-danger" onClick={() => crashNode(nodeId)} style={{ fontSize: 11 }}>
                💥 Crash
              </button>
              <button className="btn btn-success" onClick={() => recoverNode(nodeId)} style={{ fontSize: 11 }}>
                ↺ Recover
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
