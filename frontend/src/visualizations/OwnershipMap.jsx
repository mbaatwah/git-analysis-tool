import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

const AUTHOR_COLORS = [
  '#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f43f5e', '#84cc16', '#e879f9', '#22d3ee',
  '#fb923c', '#a78bfa', '#2dd4bf', '#fbbf24', '#f87171',
];

export default function OwnershipMap({ files, authors, summary, onFileSelect, selectedFile }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });

  // Author color mapping
  const authorColor = (name) => {
    if (!authors || authors.length === 0) return '#475569';
    const idx = authors.findIndex((a) => a.name === name);
    return idx >= 0 ? AUTHOR_COLORS[idx % AUTHOR_COLORS.length] : '#475569';
  };

  // ResizeObserver
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Draw treemap
  useEffect(() => {
    if (!svgRef.current || !files || files.length === 0 || dims.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dims;

    const root = buildHierarchy(files);
    const treemapLayout = d3.treemap()
      .size([width, height])
      .paddingInner(1)
      .paddingOuter(2)
      .round(true);

    const hierarchy = d3.hierarchy(root)
      .sum((d) => d.size || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    treemapLayout(hierarchy);

    const leaves = hierarchy.leaves().filter((d) => d.data.file);
    const g = svg.append('g');

    const cell = g.selectAll('g')
      .data(leaves)
      .join('g')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

    // Rect colored by primary author
    cell.append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('fill', (d) => authorColor(d.data.file.primary_author))
      .attr('fill-opacity', (d) => {
        // Higher opacity = higher ownership concentration
        return 0.3 + (d.data.file.concentration / 100) * 0.6;
      })
      .attr('stroke', (d) => {
        if (selectedFile && selectedFile.file_path === d.data.file.file_path) return '#fff';
        if (d.data.file.bus_factor_risk) return '#ef4444';
        return 'rgba(0,0,0,0.3)';
      })
      .attr('stroke-width', (d) => {
        if (selectedFile && selectedFile.file_path === d.data.file.file_path) return 2;
        if (d.data.file.bus_factor_risk) return 1.5;
        return 0.5;
      })
      .attr('rx', 2)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        if (onFileSelect) onFileSelect(d.data.file);
      });

    // Bus factor risk indicator
    cell.filter((d) => d.data.file.bus_factor_risk && (d.x1 - d.x0) > 16 && (d.y1 - d.y0) > 16)
      .append('text')
      .attr('x', (d) => d.x1 - d.x0 - 4)
      .attr('y', 12)
      .attr('text-anchor', 'end')
      .attr('fill', '#ef4444')
      .attr('font-size', '10px')
      .text('⚠');

    // Labels
    cell.filter((d) => (d.x1 - d.x0) > 50 && (d.y1 - d.y0) > 26)
      .each(function (d) {
        const el = d3.select(this);
        const w = d.x1 - d.x0;

        // File name
        const name = d.data.name;
        const maxLen = Math.floor((w - 8) / 5.5);
        el.append('text')
          .attr('x', 4).attr('y', 12)
          .attr('fill', 'rgba(255,255,255,0.9)')
          .attr('font-size', '9px')
          .attr('font-family', 'monospace')
          .text(name.length > maxLen ? name.slice(0, maxLen) + '…' : name);

        // Author name
        el.append('text')
          .attr('x', 4).attr('y', 23)
          .attr('fill', 'rgba(255,255,255,0.5)')
          .attr('font-size', '8px')
          .text(d.data.file.primary_author + ' ' + d.data.file.primary_ownership_pct + '%');
      });

    // Tooltip
    const tooltip = d3.select(containerRef.current)
      .selectAll('.tt-ownership')
      .data([0])
      .join('div')
      .attr('class', 'tt-ownership')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', 'rgba(15, 23, 42, 0.95)')
      .style('border', '1px solid rgba(99, 102, 241, 0.4)')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '11px')
      .style('color', '#e2e8f0')
      .style('opacity', 0)
      .style('z-index', 50)
      .style('max-width', '300px');

    cell
      .on('mouseenter', (event, d) => {
        const f = d.data.file;
        const authorsHtml = f.authors.slice(0, 5).map((a) =>
          `<div style="display:flex;justify-content:space-between;gap:12px">` +
          `<span>${a.author}</span>` +
          `<span style="color:#818cf8">${a.ownership_pct}%</span>` +
          `</div>`
        ).join('');

        tooltip
          .html(
            `<div style="font-weight:600;font-family:monospace;margin-bottom:4px">${f.file_path}</div>` +
            `<div style="margin-bottom:4px">` +
            `Bus factor: <span style="color:${f.bus_factor_risk ? '#ef4444' : '#22c55e'};font-weight:600">${f.bus_factor}</span>` +
            `${f.bus_factor_risk ? ' <span style="color:#ef4444">⚠ RISK</span>' : ''}` +
            `</div>` +
            `<div style="margin-bottom:4px">Concentration: <span style="color:#f59e0b">${f.concentration}%</span></div>` +
            `<div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:4px;margin-top:4px">` +
            authorsHtml +
            `</div>`
          )
          .style('opacity', 1);
      })
      .on('mousemove', (event) => {
        const rect = containerRef.current.getBoundingClientRect();
        tooltip
          .style('left', event.clientX - rect.left + 12 + 'px')
          .style('top', event.clientY - rect.top - 10 + 'px');
      })
      .on('mouseleave', () => tooltip.style('opacity', 0));

  }, [files, dims, selectedFile, authors]);

  if (!files || files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <p>No ownership data available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <svg ref={svgRef} width={dims.width} height={dims.height} className="block" />
    </div>
  );
}

function buildHierarchy(files) {
  const root = { name: 'root', children: [] };

  for (const file of files) {
    const parts = file.file_path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (i === parts.length - 1) {
        current.children.push({
          name: part,
          size: Math.max(file.total_lines_changed || 1, 1),
          file,
        });
      } else {
        let child = current.children.find((c) => c.name === part && c.children);
        if (!child) {
          child = { name: part, children: [] };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  return root;
}
