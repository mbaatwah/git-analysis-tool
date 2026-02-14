import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

const DIR_COLORS = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f43f5e', '#84cc16', '#e879f9', '#22d3ee',
];

export default function CouplingGraph({ nodes, edges, onNodeSelect, selectedNode }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const simulationRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height: Math.max(height, 400) });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nodes || nodes.length === 0 || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;

    // Assign colors by directory
    const dirs = [...new Set(nodes.map((n) => n.directory))];
    const dirColor = (dir) => DIR_COLORS[dirs.indexOf(dir) % DIR_COLORS.length];

    // Size scale based on change count
    const maxChanges = Math.max(...nodes.map((n) => n.changeCount), 1);
    const radiusScale = d3.scaleSqrt().domain([0, maxChanges]).range([5, 25]);

    // Edge width based on coupling score
    const maxCoupling = Math.max(...edges.map((e) => e.couplingScore), 0.1);
    const edgeWidthScale = d3.scaleLinear().domain([0, maxCoupling]).range([0.5, 4]);
    const edgeOpacityScale = d3.scaleLinear().domain([0, maxCoupling]).range([0.15, 0.7]);

    // Build graph data
    const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]));
    const graphEdges = edges
      .filter((e) => nodeMap.has(e.fileA) && nodeMap.has(e.fileB))
      .map((e) => ({
        source: e.fileA,
        target: e.fileB,
        ...e,
      }));

    const graphNodes = nodes.map((n) => ({ ...n }));

    // Container group for zoom
    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation(graphNodes)
      .force('link', d3.forceLink(graphEdges).id((d) => d.id).distance(120).strength((d) => d.couplingScore * 0.5))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => radiusScale(d.changeCount) + 4));

    simulationRef.current = simulation;

    // Edges
    const link = g.append('g')
      .selectAll('line')
      .data(graphEdges)
      .join('line')
      .attr('stroke', (d) => d.crossDirectory ? '#f59e0b' : '#475569')
      .attr('stroke-width', (d) => edgeWidthScale(d.couplingScore))
      .attr('stroke-opacity', (d) => edgeOpacityScale(d.couplingScore))
      .attr('stroke-dasharray', (d) => d.crossDirectory ? '4,2' : 'none');

    // Nodes
    const node = g.append('g')
      .selectAll('g')
      .data(graphNodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(drag(simulation));

    node.append('circle')
      .attr('r', (d) => radiusScale(d.changeCount))
      .attr('fill', (d) => {
        if (selectedNode && d.id === selectedNode) return '#818cf8';
        return dirColor(d.directory);
      })
      .attr('fill-opacity', 0.8)
      .attr('stroke', (d) => {
        if (selectedNode && d.id === selectedNode) return '#c7d2fe';
        return 'rgba(255,255,255,0.2)';
      })
      .attr('stroke-width', (d) => selectedNode && d.id === selectedNode ? 2 : 1);

    node.append('text')
      .attr('dy', (d) => radiusScale(d.changeCount) + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(255,255,255,0.6)')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text((d) => {
        const parts = d.id.split('/');
        return parts[parts.length - 1];
      });

    // Click handler
    node.on('click', (event, d) => {
      if (onNodeSelect) onNodeSelect(d.id);
    });

    // Tooltip
    const tooltip = d3
      .select(containerRef.current)
      .selectAll('.graph-tooltip')
      .data([0])
      .join('div')
      .attr('class', 'graph-tooltip')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', 'rgba(15, 23, 42, 0.95)')
      .style('border', '1px solid rgba(99, 102, 241, 0.4)')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '12px')
      .style('color', '#e2e8f0')
      .style('opacity', 0)
      .style('z-index', 50);

    node
      .on('mouseenter', (event, d) => {
        const connectedEdges = graphEdges.filter(
          (e) => e.source.id === d.id || e.target.id === d.id
        );
        tooltip
          .html(
            `<div style="font-weight:600;margin-bottom:4px;font-family:monospace">${d.id}</div>` +
            `<div>Changes: <span style="color:#818cf8">${d.changeCount}</span></div>` +
            `<div>Connections: <span style="color:#818cf8">${connectedEdges.length}</span></div>` +
            `<div>Directory: ${d.directory}</div>`
          )
          .style('opacity', 1);
      })
      .on('mousemove', (event) => {
        const rect = containerRef.current.getBoundingClientRect();
        tooltip
          .style('left', event.clientX - rect.left + 12 + 'px')
          .style('top', event.clientY - rect.top - 10 + 'px');
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
      });

    // Edge tooltip
    link
      .on('mouseenter', (event, d) => {
        tooltip
          .html(
            `<div style="font-family:monospace;font-size:10px;margin-bottom:4px">${d.fileA}</div>` +
            `<div style="font-family:monospace;font-size:10px;margin-bottom:4px">↔ ${d.fileB}</div>` +
            `<div>Coupling: <span style="color:#818cf8;font-weight:600">${d.couplingScore}</span></div>` +
            `<div>Co-changes: ${d.coChanges}</div>` +
            (d.crossDirectory ? `<div style="color:#f59e0b">⚠ Cross-directory</div>` : '')
          )
          .style('opacity', 1);
      })
      .on('mousemove', (event) => {
        const rect = containerRef.current.getBoundingClientRect();
        tooltip
          .style('left', event.clientX - rect.left + 12 + 'px')
          .style('top', event.clientY - rect.top - 10 + 'px');
      })
      .on('mouseleave', () => {
        tooltip.style('opacity', 0);
      });

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, edges, dimensions, onNodeSelect, selectedNode]);

  if (!nodes || nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600">
        <div className="text-center">
          <p>No coupling data available</p>
          <p className="text-sm mt-1">Try lowering the threshold or widening the date range</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px]">
      <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block" />
    </div>
  );
}

function drag(simulation) {
  function dragstarted(event) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragended(event) {
    if (!event.active) simulation.alphaTarget(0);
    event.subject.fx = null;
    event.subject.fy = null;
  }

  return d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);
}
