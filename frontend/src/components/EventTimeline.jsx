import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

const EVENT_COLORS = {
  INTERNAL: '#63b3ed',
  SEND: '#34d399',
  RECEIVE: '#a78bfa',
  SNAPSHOT_STATE: '#fbbf24',
  SNAPSHOT_MARKER: '#fbbf24',
  NODE_CRASH: '#f87171',
  NODE_RECOVER: '#34d399',
  MESSAGE_DROP: '#f87171',
  REPLAY: '#38bdf8',
};

/**
 * EventTimeline — D3.js swim-lane timeline showing events per node.
 */
export default function EventTimeline({ events, nodeIds }) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !events.length || !nodeIds.length) return;

    const container = svgRef.current.parentElement;
    const W = container.clientWidth || 700;
    const LANE_H = 60;
    const MARGIN = { top: 20, right: 20, bottom: 30, left: 80 };
    const H = nodeIds.length * LANE_H + MARGIN.top + MARGIN.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('width', W).attr('height', H);

    const innerW = W - MARGIN.left - MARGIN.right;
    const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    const times = events.map(e => e.timestamp).filter(Boolean);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);

    const xScale = d3.scaleLinear()
      .domain([tMin, tMax || tMin + 1000])
      .range([0, innerW]);

    const yScale = d3.scaleBand()
      .domain(nodeIds)
      .range([0, nodeIds.length * LANE_H])
      .padding(0.3);

    // Lane backgrounds
    nodeIds.forEach((nId, i) => {
      g.append('rect')
        .attr('x', 0)
        .attr('y', i * LANE_H)
        .attr('width', innerW)
        .attr('height', LANE_H)
        .attr('fill', i % 2 === 0 ? 'rgba(99,179,237,0.03)' : 'rgba(0,0,0,0)')
        .attr('rx', 4);
    });

    // Node labels
    svg.append('g')
      .selectAll('text')
      .data(nodeIds)
      .join('text')
      .attr('x', MARGIN.left - 8)
      .attr('y', (d, i) => MARGIN.top + i * LANE_H + LANE_H / 2 + 4)
      .attr('text-anchor', 'end')
      .attr('font-size', 11)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-weight', 600)
      .attr('fill', '#63b3ed')
      .text(d => d.replace('node-', 'N'));

    // Horizontal lane lines
    nodeIds.forEach((nId, i) => {
      g.append('line')
        .attr('x1', 0).attr('y1', i * LANE_H + LANE_H / 2)
        .attr('x2', innerW).attr('y2', i * LANE_H + LANE_H / 2)
        .attr('stroke', 'rgba(99,179,237,0.1)')
        .attr('stroke-dasharray', '4,4');
    });

    // X axis
    const xAxis = d3.axisBottom(xScale)
      .ticks(6)
      .tickFormat(d => `+${((d - tMin) / 1000).toFixed(1)}s`);

    g.append('g')
      .attr('transform', `translate(0,${nodeIds.length * LANE_H})`)
      .call(xAxis)
      .call(g => g.select('.domain').attr('stroke', 'rgba(99,179,237,0.2)'))
      .call(g => g.selectAll('.tick line').attr('stroke', 'rgba(99,179,237,0.15)'))
      .call(g => g.selectAll('.tick text').attr('fill', '#4a6080').attr('font-size', 9));

    // Tooltip
    const tooltip = d3.select(tooltipRef.current);

    // Events
    const validEvents = events.filter(e => e.timestamp && nodeIds.includes(e.nodeId));
    const laneIdx = Object.fromEntries(nodeIds.map((id, i) => [id, i]));

    g.selectAll('.event-dot')
      .data(validEvents)
      .join('circle')
      .attr('class', 'event-dot')
      .attr('cx', d => xScale(d.timestamp))
      .attr('cy', d => (laneIdx[d.nodeId] || 0) * LANE_H + LANE_H / 2)
      .attr('r', 5)
      .attr('fill', d => EVENT_COLORS[d.type] || '#63b3ed')
      .attr('stroke', '#050b14')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.9)
      .on('mouseover', (event, d) => {
        tooltip
          .style('display', 'block')
          .style('left', `${event.clientX + 12}px`)
          .style('top', `${event.clientY - 20}px`);
        tooltip.select('.tt-title').text(d.type);
        tooltip.select('.tt-node').text(d.nodeId);
        tooltip.select('.tt-lamport').text(d.lamport ?? '—');
        tooltip.select('.tt-vc').text(JSON.stringify(d.vectorClock || {}));
        tooltip.select('.tt-time').text(new Date(d.timestamp).toISOString().substr(11, 12));
      })
      .on('mouseout', () => tooltip.style('display', 'none'));

  }, [events, nodeIds]);

  return (
    <div>
      <div className="chart-container">
        <svg ref={svgRef} style={{ display: 'block' }} />
      </div>
      <div ref={tooltipRef} className="tooltip" style={{ display: 'none' }}>
        <div className="tooltip-title tt-title"></div>
        <div className="tooltip-row"><span className="tooltip-key">Node</span><span className="tooltip-val tt-node"></span></div>
        <div className="tooltip-row"><span className="tooltip-key">Lamport</span><span className="tooltip-val tt-lamport"></span></div>
        <div className="tooltip-row"><span className="tooltip-key">VClock</span><span className="tooltip-val tt-vc" style={{ fontSize: 10 }}></span></div>
        <div className="tooltip-row"><span className="tooltip-key">Time</span><span className="tooltip-val tt-time"></span></div>
      </div>
    </div>
  );
}
