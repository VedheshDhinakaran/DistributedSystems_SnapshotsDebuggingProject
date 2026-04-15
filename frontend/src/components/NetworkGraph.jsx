import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

/**
 * NetworkGraph — D3.js force-directed graph showing node communication.
 * Animates message edges as they flow between nodes.
 */
export default function NetworkGraph({ nodes, recentEvents }) {
  const svgRef = useRef(null);
  const simRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const container = svgRef.current.parentElement;
    const W = container.clientWidth || 600;
    const H = 340;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);

    // Gradient defs
    const defs = svg.append('defs');
    const grad = defs.append('radialGradient').attr('id', 'nodeGrad');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#63b3ed').attr('stop-opacity', 0.9);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#3182ce').attr('stop-opacity', 0.6);

    const crashGrad = defs.append('radialGradient').attr('id', 'crashGrad');
    crashGrad.append('stop').attr('offset', '0%').attr('stop-color', '#f87171').attr('stop-opacity', 0.9);
    crashGrad.append('stop').attr('offset', '100%').attr('stop-color', '#dc2626').attr('stop-opacity', 0.6);

    defs.append('marker')
      .attr('id', 'arrow')
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('refX', 20).attr('refY', 3)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,0 L0,6 L6,3 z')
      .attr('fill', 'rgba(99,179,237,0.6)');

    const nodeData = Object.values(nodes).map(n => ({ ...n }));
    const linkData = [];

    // Build links from recent SEND events
    const sendEvents = recentEvents.filter(e => e.type === 'SEND' && e.data?.targetId);
    const linkSet = new Map();
    for (const e of sendEvents.slice(-30)) {
      const key = `${e.nodeId}->${e.data.targetId}`;
      if (!linkSet.has(key)) {
        linkSet.set(key, { source: e.nodeId, target: e.data.targetId, count: 0 });
      }
      linkSet.get(key).count++;
    }
    linkData.push(...linkSet.values());

    // Simulation
    const sim = d3.forceSimulation(nodeData)
      .force('link', d3.forceLink(linkData).id(d => d.nodeId).distance(120))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide(50));

    simRef.current = sim;

    // Grid background
    const grid = svg.append('g').attr('class', 'grid');
    for (let x = 0; x < W; x += 40) {
      grid.append('line').attr('x1', x).attr('y1', 0).attr('x2', x).attr('y2', H)
        .attr('stroke', 'rgba(99,179,237,0.04)').attr('stroke-width', 1);
    }
    for (let y = 0; y < H; y += 40) {
      grid.append('line').attr('x1', 0).attr('y1', y).attr('x2', W).attr('y2', y)
        .attr('stroke', 'rgba(99,179,237,0.04)').attr('stroke-width', 1);
    }

    // Links
    const link = svg.append('g')
      .selectAll('line')
      .data(linkData)
      .join('line')
      .attr('stroke', 'rgba(99,179,237,0.35)')
      .attr('stroke-width', d => Math.min(d.count * 0.5 + 1, 4))
      .attr('stroke-dasharray', '4,3')
      .attr('marker-end', 'url(#arrow)');

    // Node groups
    const nodeGroup = svg.append('g')
      .selectAll('g')
      .data(nodeData)
      .join('g')
      .attr('class', 'node-group')
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    // Glow ring
    nodeGroup.append('circle')
      .attr('r', 28)
      .attr('fill', 'none')
      .attr('stroke', d => d.crashed ? 'rgba(248,113,113,0.2)' : 'rgba(99,179,237,0.2)')
      .attr('stroke-width', 8);

    // Main circle
    nodeGroup.append('circle')
      .attr('class', 'node-circle')
      .attr('r', 22)
      .attr('fill', d => d.crashed ? 'url(#crashGrad)' : 'url(#nodeGrad)')
      .attr('stroke', d => d.crashed ? 'rgba(248,113,113,0.6)' : 'rgba(99,179,237,0.6)')
      .attr('stroke-width', 1.5);

    // Labels
    nodeGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 4)
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', '#e2e8f0')
      .text(d => d.nodeId.replace('node-', 'N'));

    // Counter badge
    nodeGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', 38)
      .attr('font-size', 9)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', 'rgba(148,163,184,0.8)')
      .text(d => `cnt:${d.state?.counter || 0}`);

    // Status dot
    nodeGroup.append('circle')
      .attr('cx', 16).attr('cy', -16)
      .attr('r', 5)
      .attr('fill', d => d.crashed ? '#f87171' : '#34d399')
      .attr('stroke', '#050b14')
      .attr('stroke-width', 1.5);

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodeGroup.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => sim.stop();
  }, [nodes, recentEvents]);

  return (
    <div className="chart-container">
      <svg ref={svgRef} style={{ display: 'block' }} />
    </div>
  );
}
