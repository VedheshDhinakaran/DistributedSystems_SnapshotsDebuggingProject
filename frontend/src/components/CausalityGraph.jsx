import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';

const API = '/api';

const EVENT_COLORS = {
  SEND: '#34d399',
  RECEIVE: '#a78bfa',
  INTERNAL: '#60a5fa',
  NODE_CRASH: '#f87171',
  NODE_RECOVER: '#4ade80',
  SNAPSHOT_INITIATE: '#fbbf24',
  SNAPSHOT_COMPLETE: '#fb923c',
  MARKER: '#e879f9',
};

const getColor = (type) => EVENT_COLORS[type] || '#94a3b8';

/**
 * CausalityGraph v2 — Interactive layered DAG with:
 * - Backend-built graph (GET /api/causality/graph)
 * - Layered DAG layout (topological X, position-in-layer Y)
 * - Click to highlight causal chains (ancestors + descendants)
 * - Filter by nodeId + time range
 * - Replay sync: highlights current event and its ancestors
 * - Hover tooltip with full vector clock
 */
export default function CausalityGraph({ replayEvent, replayIndex }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  const [graph, setGraph] = useState({ nodes: [], edges: [], concurrentPairs: [], stats: {} });
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [filterNodeId, setFilterNodeId] = useState('');
  const [availableNodes, setAvailableNodes] = useState([]);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, data: null });

  // Fetch graph from backend
  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 80 });
      if (filterNodeId) params.set('nodeId', filterNodeId);

      const res = await fetch(`${API}/causality/graph?${params}`);
      const data = await res.json();
      setGraph(data);

      // Extract unique nodeIds for filter chips
      const ids = [...new Set(data.nodes.map(n => n.nodeId))].filter(Boolean);
      setAvailableNodes(ids);
    } catch (err) {
      console.error('failedto fetch causality graph:', err);
    } finally {
      setLoading(false);
    }
  }, [filterNodeId]);

  useEffect(() => {
    fetchGraph();
    const interval = setInterval(fetchGraph, 5000);
    return () => clearInterval(interval);
  }, [fetchGraph]);

  // Recompute causal chain for selected / replay-synced node
  const getCausalChain = useCallback((nodeId) => {
    if (!nodeId) return { ancestors: new Set(), descendants: new Set() };

    const ancestors = new Set();
    const descendants = new Set();

    const edgesByTarget = new Map();
    const edgesBySource = new Map();

    for (const e of graph.edges) {
      if (!edgesByTarget.has(e.target)) edgesByTarget.set(e.target, []);
      edgesByTarget.get(e.target).push(e.source);
      if (!edgesBySource.has(e.source)) edgesBySource.set(e.source, []);
      edgesBySource.get(e.source).push(e.target);
    }

    // BFS ancestors
    const queue = [nodeId];
    while (queue.length) {
      const curr = queue.pop();
      for (const src of (edgesByTarget.get(curr) || [])) {
        if (!ancestors.has(src)) { ancestors.add(src); queue.push(src); }
      }
    }

    // BFS descendants
    queue.push(nodeId);
    while (queue.length) {
      const curr = queue.pop();
      for (const tgt of (edgesBySource.get(curr) || [])) {
        if (!descendants.has(tgt)) { descendants.add(tgt); queue.push(tgt); }
      }
    }

    return { ancestors, descendants };
  }, [graph]);

  // D3 render
  useEffect(() => {
    if (!svgRef.current || graph.nodes.length === 0) return;

    const el = containerRef.current;
    const W = el?.clientWidth || 780;
    const H = 460;
    const MARGIN = { top: 30, right: 30, bottom: 30, left: 30 };
    const innerW = W - MARGIN.left - MARGIN.right;
    const innerH = H - MARGIN.top - MARGIN.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', W).attr('height', H);

    // Defs: arrow markers + glow filter
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'dagArrow')
      .attr('markerWidth', 7).attr('markerHeight', 7)
      .attr('refX', 16).attr('refY', 3.5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,0 L0,7 L7,3.5 z').attr('fill', 'rgba(167,139,250,0.8)');

    defs.append('marker')
      .attr('id', 'dagArrowHighlight')
      .attr('markerWidth', 7).attr('markerHeight', 7)
      .attr('refX', 16).attr('refY', 3.5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,0 L0,7 L7,3.5 z').attr('fill', '#fbbf24');

    defs.append('marker')
      .attr('id', 'dagArrowReplay')
      .attr('markerWidth', 7).attr('markerHeight', 7)
      .attr('refX', 16).attr('refY', 3.5)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,0 L0,7 L7,3.5 z').attr('fill', '#34d399');

    const glowFilter = defs.append('filter').attr('id', 'glow');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    // ── Layout: assign X by layer, Y by position in layer ────────────────────
    const maxLayer = Math.max(...graph.nodes.map(n => n.layer), 0);
    const layerSpacing = Math.min(innerW / (maxLayer + 1), 120);
    const nodeRadius = 9;

    // Group nodes by layer
    const byLayer = {};
    for (const n of graph.nodes) {
      if (!byLayer[n.layer]) byLayer[n.layer] = [];
      byLayer[n.layer].push(n);
    }

    // Compute X, Y positions
    const positions = {};
    for (const [layer, layerNodes] of Object.entries(byLayer)) {
      const x = parseInt(layer) * layerSpacing + layerSpacing / 2;
      layerNodes.forEach((n, idx) => {
        const totalH = layerNodes.length * 50;
        const startY = (innerH - totalH) / 2;
        positions[n.id] = {
          x,
          y: startY + idx * 50 + 25,
        };
      });
    }

    // Build concurrent set
    const concurrentSet = new Set(
      (graph.concurrentPairs || []).flatMap(([a, b]) => [a, b])
    );

    // Causal chain of selected / replay node
    const activeNodeId = replayEvent?.id || selectedNode;
    const { ancestors, descendants } = getCausalChain(activeNodeId);

    const isHighlighted = (id) => id === activeNodeId || ancestors.has(id) || descendants.has(id);
    const isDimmed = activeNodeId ? !isHighlighted : false; // no selection = no dim

    // ── Edges ─────────────────────────────────────────────────────────────────
    g.selectAll('.dag-edge')
      .data(graph.edges)
      .join('path')
      .attr('class', 'dag-edge')
      .attr('d', (e) => {
        const s = positions[e.source];
        const t = positions[e.target];
        if (!s || !t) return '';
        const mx = (s.x + t.x) / 2;
        // Cubic bezier for curved edges
        return `M${s.x},${s.y} C${mx},${s.y} ${mx},${t.y} ${t.x},${t.y}`;
      })
      .attr('fill', 'none')
      .attr('stroke', (e) => {
        if (!activeNodeId) return 'rgba(167,139,250,0.3)';
        const srcHl = isHighlighted(e.source);
        const tgtHl = isHighlighted(e.target);
        if (e.source === activeNodeId || e.target === activeNodeId) return '#fbbf24';
        if (srcHl && tgtHl) return 'rgba(251,191,36,0.5)';
        return 'rgba(167,139,250,0.08)';
      })
      .attr('stroke-width', (e) => {
        if (!activeNodeId) return 1.5;
        if (e.source === activeNodeId || e.target === activeNodeId) return 2.5;
        return isHighlighted(e.source) && isHighlighted(e.target) ? 1.8 : 0.5;
      })
      .attr('marker-end', (e) => {
        if (!activeNodeId) return 'url(#dagArrow)';
        if (e.source === activeNodeId || e.target === activeNodeId) return 'url(#dagArrowHighlight)';
        return 'url(#dagArrow)';
      })
      .attr('opacity', (e) => {
        if (!activeNodeId) return 0.7;
        return (isHighlighted(e.source) && isHighlighted(e.target)) ? 1 : 0.12;
      });

    // ── Nodes ─────────────────────────────────────────────────────────────────
    const nodeGroups = g.selectAll('.dag-node-g')
      .data(graph.nodes, d => d.id)
      .join('g')
      .attr('class', 'dag-node-g')
      .attr('transform', (d) => {
        const p = positions[d.id];
        return p ? `translate(${p.x},${p.y})` : 'translate(0,0)';
      })
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(prev => prev === d.id ? null : d.id);
        setHoveredNode(null);
      })
      .on('mousemove', (event, d) => {
        const rect = svgRef.current.getBoundingClientRect();
        setTooltip({
          visible: true,
          x: event.clientX - rect.left + 14,
          y: event.clientY - rect.top - 10,
          data: d,
        });
      })
      .on('mouseleave', () => setTooltip(t => ({ ...t, visible: false })));

    // Concurrent event ring
    nodeGroups.filter(d => concurrentSet.has(d.id))
      .append('circle')
      .attr('r', nodeRadius + 5)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(251,191,36,0.4)')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 2');

    // Active (replay) glow ring
    nodeGroups.filter(d => d.id === activeNodeId)
      .append('circle')
      .attr('r', nodeRadius + 7)
      .attr('fill', 'rgba(52,211,153,0.15)')
      .attr('stroke', '#34d399')
      .attr('stroke-width', 2)
      .attr('filter', 'url(#glow)');

    // Main circle
    nodeGroups.append('circle')
      .attr('r', (d) => d.id === activeNodeId ? nodeRadius + 2 : nodeRadius)
      .attr('fill', (d) => getColor(d.eventType))
      .attr('stroke', (d) => {
        if (d.id === activeNodeId) return '#fff';
        if (ancestors.has(d.id)) return '#fbbf24';
        if (descendants.has(d.id)) return '#34d399';
        return 'rgba(0,0,0,0.4)';
      })
      .attr('stroke-width', (d) => (d.id === activeNodeId || ancestors.has(d.id) || descendants.has(d.id)) ? 2 : 1)
      .attr('opacity', d => {
        if (!activeNodeId) return 0.9;
        return isHighlighted(d.id) ? 1 : 0.2;
      });

    // Node label (nodeId abbreviated)
    nodeGroups.append('text')
      .attr('dy', nodeRadius + 13)
      .attr('text-anchor', 'middle')
      .attr('font-size', 8)
      .attr('fill', '#64748b')
      .attr('pointer-events', 'none')
      .text(d => d.nodeId?.replace('node-', 'N'));

    // Dismiss on SVG click
    svg.on('click', () => {
      setSelectedNode(null);
      setTooltip(t => ({ ...t, visible: false }));
    });

  }, [graph, selectedNode, replayEvent, getCausalChain]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Filter Node:</span>
          <button
            className={`badge ${!filterNodeId ? 'badge-purple' : 'badge-blue'}`}
            style={{ cursor: 'pointer', border: 'none', background: !filterNodeId ? 'rgba(167,139,250,0.2)' : undefined }}
            onClick={() => setFilterNodeId('')}
          >All</button>
          {availableNodes.map(id => (
            <button
              key={id}
              className={`badge ${filterNodeId === id ? 'badge-purple' : 'badge-blue'}`}
              style={{ cursor: 'pointer', border: 'none', background: filterNodeId === id ? 'rgba(167,139,250,0.3)' : undefined }}
              onClick={() => setFilterNodeId(prev => prev === id ? '' : id)}
            >{id}</button>
          ))}
        </div>
        <button className="btn" style={{ fontSize: 11 }} onClick={fetchGraph} disabled={loading}>
          {loading ? '⏳' : '↻ Refresh'}
        </button>
        {graph.stats?.totalEdges !== undefined && (
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {graph.stats.totalEvents} events · {graph.stats.totalEdges} causal edges · {graph.stats.layers} layers
          </span>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        {Object.entries(EVENT_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            <span style={{ color: 'var(--text-muted)' }}>{type}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px dashed rgba(251,191,36,0.6)', background: 'transparent' }} />
          <span style={{ color: 'var(--text-muted)' }}>CONCURRENT</span>
        </div>
      </div>

      {/* Selected node info bar */}
      {selectedNode && (() => {
        const n = graph.nodes.find(nd => nd.id === selectedNode);
        const { ancestors, descendants } = getCausalChain(selectedNode);
        return n ? (
          <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 8, padding: '8px 14px', marginBottom: 10, fontSize: 11 }}>
            <span style={{ color: '#a78bfa', fontWeight: 600 }}>{n.eventType}</span>
            {' '}on <span style={{ color: 'var(--text-primary)' }}>{n.nodeId}</span>
            {' · '}Lamport: <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{n.lamport}</span>
            {' · '}
            <span style={{ color: '#fbbf24' }}>{ancestors.size} ancestors</span>
            {', '}
            <span style={{ color: '#34d399' }}>{descendants.size} descendants</span>
            <button style={{ marginLeft: 10, fontSize: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setSelectedNode(null)}>✕ clear</button>
          </div>
        ) : null;
      })()}

      {/* Replay sync indicator */}
      {replayEvent && (
        <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 8, padding: '6px 14px', marginBottom: 8, fontSize: 11 }}>
          <span style={{ color: '#34d399' }}>▶ Replay synced</span>{' '}— current event: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{replayEvent.type}</span> on <span style={{ color: 'var(--accent-cyan)' }}>{replayEvent.nodeId}</span>
        </div>
      )}

      {/* DAG SVG */}
      <div ref={containerRef} className="chart-container" style={{ minHeight: 460, position: 'relative' }}>
        {graph.nodes.length === 0 && !loading && (
          <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
            <div className="empty-state-icon">🕸️</div>
            <p>No events yet. Wait for events to accumulate or change filter.</p>
          </div>
        )}
        <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
      </div>

      {/* Hover tooltip */}
      {tooltip.visible && tooltip.data && (
        <div style={{
          position: 'absolute',
          left: tooltip.x, top: tooltip.y,
          background: 'rgba(15,23,42,0.97)',
          border: '1px solid rgba(167,139,250,0.3)',
          borderRadius: 8, padding: '10px 14px',
          fontSize: 11, zIndex: 1000,
          pointerEvents: 'none',
          minWidth: 200,
          maxWidth: 280,
        }}>
          <div style={{ fontWeight: 700, color: getColor(tooltip.data.eventType), marginBottom: 6 }}>
            {tooltip.data.eventType}
          </div>
          {[
            ['Node', tooltip.data.nodeId],
            ['Lamport', tooltip.data.lamport],
            ['Layer', tooltip.data.layer],
            ['Time', new Date(tooltip.data.timestamp || 0).toISOString().substr(11, 12)],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
              <span style={{ color: '#64748b' }}>{k}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: '#e2e8f0' }}>{String(v)}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, color: '#64748b', fontSize: 9, lineHeight: 1.5 }}>
            VC: {JSON.stringify(tooltip.data.vectorClock || {})}
          </div>
          <div style={{ marginTop: 4, color: '#475569', fontSize: 9 }}>
            Click to highlight causal chain
          </div>
        </div>
      )}
    </div>
  );
}
