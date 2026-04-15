import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const API = '/api';

/**
 * BenchmarkChart — D3.js performance visualizations.
 * Shows: latency vs nodes (bars), replay time vs rate, memory over time.
 */
export default function BenchmarkChart() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({ phase: 'idle', current: 0, total: 0 });
  const [running, setRunning] = useState(false);
  const barRef = useRef(null);
  const areaRef = useRef(null);

  const fetchData = async () => {
    const [res, stat] = await Promise.all([
      fetch(`${API}/benchmark/results`).then(r => r.json()),
      fetch(`${API}/benchmark/status`).then(r => r.json()),
    ]);
    setData(res);
    setStatus(stat);
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (data?.chartData?.latencyVsNodes?.length > 0) drawLatencyBars(data.chartData);
  }, [data]);

  const runBenchmark = async () => {
    setRunning(true);
    await fetch(`${API}/benchmark/run`, { method: 'POST' });
    // Poll progress
    const poll = setInterval(async () => {
      const s = await fetch(`${API}/benchmark/status`).then(r => r.json());
      setStatus(s);
      if (s.phase === 'complete') {
        clearInterval(poll);
        setRunning(false);
        await fetchData();
      }
    }, 800);
  };

  const drawLatencyBars = (chartData) => {
    if (!barRef.current) return;
    const el = barRef.current;
    d3.select(el).selectAll('*').remove();

    const W = el.clientWidth || 400, H = 220;
    const margin = { top: 16, right: 16, bottom: 40, left: 60 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const svg = d3.select(el).append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const nodes = chartData.latencyVsNodes;
    const x = d3.scaleBand().domain(nodes.map(d => d.nodeCount)).range([0, w]).padding(0.3);
    const y = d3.scaleLinear().domain([0, d3.max(nodes, d => d.avgLatencyMs) * 1.2]).range([h, 0]);

    const colorScale = d3.scaleSequential(d3.interpolateCool)
      .domain([0, nodes.length - 1]);

    // Bars
    g.selectAll('rect')
      .data(nodes)
      .join('rect')
      .attr('x', d => x(d.nodeCount))
      .attr('width', x.bandwidth())
      .attr('y', d => y(d.avgLatencyMs))
      .attr('height', d => h - y(d.avgLatencyMs))
      .attr('fill', (_, i) => colorScale(i))
      .attr('rx', 4)
      .attr('opacity', 0.85);

    // Labels on bars
    g.selectAll('.bar-label')
      .data(nodes)
      .join('text')
      .attr('class', 'bar-label')
      .attr('x', d => x(d.nodeCount) + x.bandwidth() / 2)
      .attr('y', d => y(d.avgLatencyMs) - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', 10)
      .text(d => `${d.avgLatencyMs}ms`);

    // Axes
    g.append('g').attr('transform', `translate(0,${h})`)
      .call(d3.axisBottom(x).tickFormat(d => `n=${d}`))
      .selectAll('text').attr('fill', '#94a3b8').style('font-size', '11px');

    g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d => `${d}ms`))
      .selectAll('text').attr('fill', '#94a3b8').style('font-size', '11px');

    g.selectAll('.domain, .tick line').attr('stroke', '#334155');

    // Title
    svg.append('text').attr('x', W / 2).attr('y', 12).attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8').attr('font-size', 11)
      .text('Avg Snapshot Latency (ms) vs Node Count');
  };

  const pct = status.total > 0 ? Math.round((status.current / status.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Controls */}
      <div className="flex-between">
        <div>
          <div className="section-title" style={{ marginBottom: 2 }}>Performance Benchmarks</div>
          <span className="badge badge-blue">{data?.total || 0} experiments stored</span>
        </div>
        <button className="btn btn-success" onClick={runBenchmark} disabled={running || status.phase === 'running'}>
          {running || status.phase === 'running' ? `⏳ ${pct}%` : '▶ Run Full Matrix'}
        </button>
      </div>

      {/* Progress bar */}
      {(running || status.phase === 'running') && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 6, overflow: 'hidden', height: 8 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-cyan))', transition: 'width 0.4s' }} />
        </div>
      )}

      {/* Chart: Latency vs Nodes */}
      {data?.chartData?.latencyVsNodes?.length > 0 ? (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">📊</span> Snapshot Latency vs Node Count</div>
          </div>
          <div className="card-body" style={{ padding: '8px 16px' }}>
            <div ref={barRef} style={{ width: '100%', minHeight: 220 }} />
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p>No benchmark data yet. Click <strong>Run Full Matrix</strong> to start.</p>
        </div>
      )}

      {/* Summary table */}
      {data?.chartData?.latencyVsFault?.length > 0 && (
        <div className="two-col" style={{ gap: 12 }}>
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header"><div className="card-title"><span className="card-title-icon">💥</span> Latency by Fault Scenario</div></div>
            <div className="card-body" style={{ padding: '6px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Scenario</th>
                    <th style={{ textAlign: 'right', padding: '4px 0' }}>Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.chartData.latencyVsFault.map(({ fault, avgLatencyMs }) => (
                    <tr key={fault}>
                      <td style={{ padding: '4px 0', color: 'var(--text-primary)' }}>{fault}</td>
                      <td style={{ textAlign: 'right', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{avgLatencyMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ margin: 0 }}>
            <div className="card-header"><div className="card-title"><span className="card-title-icon">⏮️</span> Replay Time by Message Rate</div></div>
            <div className="card-body" style={{ padding: '6px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 0' }}>Rate</th>
                    <th style={{ textAlign: 'right', padding: '4px 0' }}>Avg Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {data.chartData.replayVsRate.map(({ rate, avgReplayMs }) => (
                    <tr key={rate}>
                      <td style={{ padding: '4px 0', color: 'var(--text-primary)' }}>{rate}</td>
                      <td style={{ textAlign: 'right', color: 'var(--accent-purple)', fontFamily: 'var(--font-mono)' }}>{avgReplayMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Raw results preview */}
      {data?.results?.length > 0 && (
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title"><span className="card-title-icon">🗂️</span> Raw Results ({data.results.length})</div>
            <a href="/api/benchmark/csv" className="btn" style={{ fontSize: 11 }}>⬇ CSV</a>
          </div>
          <div className="card-body" style={{ padding: '8px' }}>
            <div style={{ overflowX: 'auto', maxHeight: 240 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', position: 'sticky', top: 0, background: 'var(--surface-1)' }}>
                    {['nodes', 'rate', 'fault', 'latencyMs', 'replayMs', 'memMB', 'events'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.results.slice(-20).map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.nodeCount}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.messageRate}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.faultScenario}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--accent-cyan)' }}>{r.snapshotLatencyMs}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', color: 'var(--accent-purple)' }}>{r.replayTimeMs}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.memUsageMB}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.eventCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
