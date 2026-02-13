import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';

const COLORS = {
  hot: '#ef4444',
  warm: '#f59e0b',
  cool: '#6366f1',
  cold: '#334155',
};

function getRecencyColor(lastChanged, now) {
  if (!lastChanged) return COLORS.cold;
  const daysAgo = (now - new Date(lastChanged)) / (1000 * 60 * 60 * 24);
  if (daysAgo < 7) return COLORS.hot;
  if (daysAgo < 30) return COLORS.warm;
  if (daysAgo < 90) return COLORS.cool;
  return COLORS.cold;
}

function buildHierarchy(files) {
  const root = { name: 'root', children: [] };
  const dirMap = new Map();

  for (const file of files) {
    const parts = file.file_path.split('/');
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts.slice(0, i + 1).join('/');
      if (!dirMap.has(dirName)) {
        const node = { name: parts[i], fullPath: dirName, children: [] };
        current.children.push(node);
        dirMap.set(dirName, node);
      }
      current = dirMap.get(dirName);
    }

    current.children.push({
      name: parts[parts.length - 1],
      fullPath: file.file_path,
      value: file.churn_score,
      data: file,
    });
  }

  return root;
}

export default function Treemap({ files, onFileSelect, selectedFile }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height: Math.max(height, 400) });
      }
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!files || files.length === 0 || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width, height } = dimensions;
    const now = new Date();
    const hierarchy = buildHierarchy(files);

    const root = d3
      .hierarchy(hierarchy)
      .sum((d) => d.value || 0)
      .sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([width, height])
      .paddingInner(2)
      .paddingOuter(4)
      .paddingTop(20)
      .round(true)(root);

    const leaf = svg
      .selectAll('g')
      .data(root.leaves())
      .join('g')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`)
      .style('cursor', 'pointer');

    leaf
      .append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 3)
      .attr('fill', (d) => {
        const isSelected = selectedFile && d.data.fullPath === selectedFile.file_path;
        if (isSelected) return '#818cf8';
        return getRecencyColor(d.data.data?.last_changed, now);
      })
      .attr('fill-opacity', (d) => {
        const score = d.data.data?.churn_score || 0;
        const maxScore = Math.max(...files.map((f) => f.churn_score));
        return 0.4 + (score / maxScore) * 0.6;
      })
      .attr('stroke', (d) => {
        const isSelected = selectedFile && d.data.fullPath === selectedFile.file_path;
        return isSelected ? '#c7d2fe' : 'rgba(255,255,255,0.1)';
      })
      .attr('stroke-width', (d) => {
        const isSelected = selectedFile && d.data.fullPath === selectedFile.file_path;
        return isSelected ? 2 : 0.5;
      });

    leaf
      .append('clipPath')
      .attr('id', (d, i) => `clip-${i}`)
      .append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0));

    leaf
      .append('text')
      .attr('clip-path', (d, i) => `url(#clip-${i})`)
      .attr('x', 4)
      .attr('y', 14)
      .attr('fill', 'white')
      .attr('font-size', '11px')
      .attr('font-family', 'monospace')
      .text((d) => {
        const w = d.x1 - d.x0;
        if (w < 40) return '';
        return d.data.name;
      });

    leaf
      .append('text')
      .attr('clip-path', (d, i) => `url(#clip-${i})`)
      .attr('x', 4)
      .attr('y', 28)
      .attr('fill', 'rgba(255,255,255,0.6)')
      .attr('font-size', '9px')
      .text((d) => {
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        if (w < 60 || h < 35) return '';
        const score = d.data.data?.churn_score;
        return score != null ? `score: ${score}` : '';
      });

    leaf.on('click', (event, d) => {
      if (d.data.data && onFileSelect) {
        onFileSelect(d.data.data);
      }
    });

    // Tooltip
    const tooltip = d3
      .select(containerRef.current)
      .selectAll('.treemap-tooltip')
      .data([0])
      .join('div')
      .attr('class', 'treemap-tooltip')
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

    leaf
      .on('mouseenter', (event, d) => {
        const data = d.data.data;
        if (!data) return;
        tooltip
          .html(
            `<div style="font-weight:600;margin-bottom:4px;font-family:monospace">${d.data.fullPath}</div>` +
            `<div>Churn: <span style="color:#818cf8">${data.churn_score}</span></div>` +
            `<div>Changes: <span style="color:#818cf8">${data.change_count}</span></div>` +
            `<div style="color:#4ade80">+${data.total_insertions}</div>` +
            `<div style="color:#f87171">-${data.total_deletions}</div>` +
            `<div>Authors: ${data.author_count}</div>`
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

    // Directory labels
    const internalNodes = root.descendants().filter((d) => d.depth === 1 && d.children);
    svg
      .selectAll('.dir-label')
      .data(internalNodes)
      .join('text')
      .attr('class', 'dir-label')
      .attr('x', (d) => d.x0 + 6)
      .attr('y', (d) => d.y0 + 14)
      .attr('fill', 'rgba(255,255,255,0.4)')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('text-transform', 'uppercase')
      .attr('letter-spacing', '0.5px')
      .text((d) => d.data.name);
  }, [files, dimensions, onFileSelect, selectedFile]);

  if (!files || files.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-600">
        No churn data available
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[400px]">
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="block"
      />
    </div>
  );
}
