import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';

export default function FileChurnView({ files, repoId }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [churnData, setChurnData] = useState(null);
  const [churnLoading, setChurnLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [treeSearch, setTreeSearch] = useState('');
  const chartRef = useRef(null);
  const chartContainerRef = useRef(null);
  const [chartDims, setChartDims] = useState({ width: 0, height: 0 });

  // ResizeObserver for chart area - re-run when selectedFile changes so container gets measured
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setChartDims({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(chartContainerRef.current);
    return () => observer.disconnect();
  }, [selectedFile]);

  // Build file tree
  const tree = useMemo(() => {
    if (!files || files.length === 0) return [];
    const filtered = treeSearch
      ? files.filter((f) => f.file_path.toLowerCase().includes(treeSearch.toLowerCase()))
      : files;
    return buildTree(filtered);
  }, [files, treeSearch]);

  // Fetch churn data when file is selected
  useEffect(() => {
    if (!selectedFile || !repoId) {
      setChurnData(null);
      return;
    }

    let cancelled = false;
    setChurnLoading(true);

    fetch(`/api/analysis/churn/file?repoId=${repoId}&filePath=${encodeURIComponent(selectedFile.file_path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setChurnData(data);
          setChurnLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChurnLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedFile, repoId]);

  // Draw churn chart
  useEffect(() => {
    if (!chartRef.current || !churnData || !churnData.history || churnData.history.length === 0) return;
    if (chartDims.width === 0) return;

    const svg = d3.select(chartRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const width = chartDims.width - margin.left - margin.right;
    const height = chartDims.height - margin.top - margin.bottom;
    if (width <= 0 || height <= 0) return;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const history = churnData.history;
    const dates = history.map((d) => new Date(d.month + '-01'));

    const x = d3.scaleTime()
      .domain(d3.extent(dates))
      .range([0, width]);

    const yChanges = d3.scaleLinear()
      .domain([0, d3.max(history, (d) => d.change_count) * 1.1])
      .range([height, 0]);

    const yLines = d3.scaleLinear()
      .domain([0, d3.max(history, (d) => Math.max(d.insertions, d.deletions)) * 1.1])
      .range([height, 0]);

    // Grid
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yChanges.ticks(5))
      .join('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', (d) => yChanges(d)).attr('y2', (d) => yChanges(d))
      .attr('stroke', 'rgba(255,255,255,0.05)');

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(Math.min(history.length, 8)).tickFormat(d3.timeFormat('%b %Y')))
      .attr('color', 'rgba(255,255,255,0.3)')
      .selectAll('text').attr('fill', 'rgba(255,255,255,0.4)').attr('font-size', '9px');

    // Y axis left (changes)
    g.append('g')
      .call(d3.axisLeft(yChanges).ticks(5))
      .attr('color', 'rgba(255,255,255,0.3)')
      .selectAll('text').attr('fill', 'rgba(99, 102, 241, 0.7)').attr('font-size', '9px');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(99, 102, 241, 0.5)')
      .attr('font-size', '9px')
      .text('Changes');

    // Y axis right (insertions/deletions)
    g.append('g')
      .attr('transform', `translate(${width},0)`)
      .call(d3.axisRight(yLines).ticks(5))
      .attr('color', 'rgba(255,255,255,0.3)')
      .selectAll('text').attr('fill', 'rgba(34, 197, 94, 0.7)').attr('font-size', '9px');

    g.append('text')
      .attr('transform', 'rotate(90)')
      .attr('x', height / 2).attr('y', -width - 35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(34, 197, 94, 0.5)')
      .attr('font-size', '9px')
      .text('Lines (+/-)');

    // Change count bars
    g.selectAll('.change-bar')
      .data(history)
      .join('rect')
      .attr('class', 'change-bar')
      .attr('x', (d) => x(new Date(d.month + '-01')) - width / history.length * 0.3)
      .attr('y', (d) => yChanges(d.change_count))
      .attr('width', width / history.length * 0.6)
      .attr('height', (d) => height - yChanges(d.change_count))
      .attr('fill', 'rgba(99, 102, 241, 0.6)')
      .attr('rx', 2);

    // Insertions line
    const insertionsLine = d3.line()
      .x((d) => x(new Date(d.month + '-01')))
      .y((d) => yLines(d.insertions))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', insertionsLine)
      .attr('fill', 'none')
      .attr('stroke', '#22c55e')
      .attr('stroke-width', 2);

    // Deletions line
    const deletionsLine = d3.line()
      .x((d) => x(new Date(d.month + '-01')))
      .y((d) => yLines(d.deletions))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', deletionsLine)
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 2');

    // Dots for each data point
    const dots = g.selectAll('.dot-group')
      .data(history)
      .join('g')
      .attr('class', 'dot-group');

    // Insertion dots
    dots.append('circle')
      .attr('cx', (d) => x(new Date(d.month + '-01')))
      .attr('cy', (d) => yLines(d.insertions))
      .attr('r', 4)
      .attr('fill', '#22c55e');

    // Deletion dots
    dots.append('circle')
      .attr('cx', (d) => x(new Date(d.month + '-01')))
      .attr('cy', (d) => yLines(d.deletions))
      .attr('r', 4)
      .attr('fill', '#ef4444');

    // Tooltip
    const tooltip = d3.select(chartContainerRef.current)
      .selectAll('.tt-churn')
      .data([0])
      .join('div')
      .attr('class', 'tt-churn')
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('background', 'rgba(15, 23, 42, 0.95)')
      .style('border', '1px solid rgba(99, 102, 241, 0.4)')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '11px')
      .style('color', '#e2e8f0')
      .style('opacity', 0)
      .style('z-index', 50);

    // Invisible overlay for hover
    dots.append('rect')
      .attr('x', (d) => x(new Date(d.month + '-01')) - 10)
      .attr('y', 0)
      .attr('width', 20)
      .attr('height', height)
      .attr('fill', 'transparent')
      .on('mouseenter', (event, d) => {
        tooltip
          .html(
            `<div style="font-weight:600;margin-bottom:4px">${d.month}</div>` +
            `<div style="color:#818cf8">Changes: ${d.change_count}</div>` +
            `<div style="color:#22c55e">Insertions: +${d.insertions}</div>` +
            `<div style="color:#ef4444">Deletions: -${d.deletions}</div>` +
            `<div style="color:#94a3b8;font-size:10px">Authors: ${d.authors.slice(0, 3).join(', ')}${d.authors.length > 3 ? ' +' + (d.authors.length - 3) + ' more' : ''}</div>`
          )
          .style('opacity', 1);
      })
      .on('mousemove', (event) => {
        const rect = chartContainerRef.current.getBoundingClientRect();
        tooltip
          .style('left', event.clientX - rect.left + 12 + 'px')
          .style('top', event.clientY - rect.top - 10 + 'px');
      })
      .on('mouseleave', () => tooltip.style('opacity', 0));

    // Legend
    const legend = g.append('g').attr('transform', `translate(${width - 160}, 0)`);

    legend.append('rect').attr('width', 12).attr('height', 8).attr('fill', 'rgba(99, 102, 241, 0.6)').attr('rx', 2);
    legend.append('text').attr('x', 16).attr('y', 7)
      .attr('fill', 'rgba(255,255,255,0.5)').attr('font-size', '9px').text('Changes');

    legend.append('line').attr('x1', 0).attr('x2', 16).attr('y1', 14).attr('y2', 14)
      .attr('stroke', '#22c55e').attr('stroke-width', 2);
    legend.append('text').attr('x', 20).attr('y', 18)
      .attr('fill', 'rgba(255,255,255,0.5)').attr('font-size', '9px').text('Insertions');

    legend.append('line').attr('x1', 0).attr('x2', 16).attr('y1', 28).attr('y2', 28)
      .attr('stroke', '#ef4444').attr('stroke-width', 2).attr('stroke-dasharray', '4 2');
    legend.append('text').attr('x', 20).attr('y', 32)
      .attr('fill', 'rgba(255,255,255,0.5)').attr('font-size', '9px').text('Deletions');

  }, [churnData, chartDims]);

  const toggleDir = (dir) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  if (!files || files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <p>No files available</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* File tree */}
      <div className="w-72 border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-2 border-b border-gray-800">
          <input
            type="text"
            value={treeSearch}
            onChange={(e) => setTreeSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-1 text-xs">
          {renderTree(tree, 0, selectedFile, setSelectedFile, expandedDirs, toggleDir)}
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedFile ? (
          <>
            {/* File header */}
            <div className="border-b border-gray-800 px-4 py-3 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm text-white truncate">{selectedFile.file_path}</h3>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="text-gray-500 hover:text-white text-xs"
                >✕</button>
              </div>
              <div className="flex gap-4 mt-2 text-xs">
                <Stat label="Changes" value={selectedFile.change_count || '-'} color="text-indigo-400" />
                <Stat label="Insertions" value={selectedFile.total_insertions || '-'} color="text-green-400" />
                <Stat label="Deletions" value={selectedFile.total_deletions || '-'} color="text-red-400" />
                <Stat label="Authors" value={selectedFile.author_count || '-'} color="text-purple-400" />
                <Stat label="Months" value={churnData?.history?.length || '-'} color="text-amber-400" />
              </div>
            </div>

            {/* Chart */}
            <div ref={chartContainerRef} className="flex-1 relative overflow-hidden p-4">
              {churnLoading ? (
                <div className="flex items-center justify-center h-full text-indigo-400 text-sm animate-pulse">
                  Loading churn history...
                </div>
              ) : churnData && churnData.history && churnData.history.length > 0 ? (
                <svg ref={chartRef} width={chartDims.width} height={chartDims.height} className="block" />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                  No churn history for this file
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600">
            <div className="text-center">
              <p className="text-sm">Select a file to see its churn over time</p>
              <p className="text-xs mt-1 text-gray-700">The chart shows monthly changes, insertions, and deletions</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function Stat({ label, value, color }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildTree(files) {
  const root = { name: 'root', children: [], path: '' };

  for (const file of files) {
    const parts = file.file_path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join('/');

      if (i === parts.length - 1) {
        current.children.push({ name: part, file, path: fullPath });
      } else {
        let child = current.children.find((c) => c.name === part && c.children);
        if (!child) {
          child = { name: part, children: [], path: fullPath };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  sortTree(root);
  return root.children;
}

function sortTree(node) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    const aDir = !!a.children;
    const bDir = !!b.children;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.children) sortTree(child);
  }
}

function getChurnScoreColor(churnScore) {
  if (churnScore >= 10) return 'text-red-400';
  if (churnScore >= 5) return 'text-amber-400';
  if (churnScore >= 2) return 'text-yellow-400';
  return 'text-gray-500';
}

function avgChurnScore(node) {
  const files = collectFiles(node);
  if (files.length === 0) return 0;
  const sum = files.reduce((s, f) => s + (f.churn_score || 0), 0);
  return Math.round((sum / files.length) * 100) / 100;
}

function collectFiles(node) {
  if (!node.children) return node.file ? [node.file] : [];
  return node.children.flatMap(collectFiles);
}

function renderTree(nodes, depth, selectedFile, setSelectedFile, expandedDirs, toggleDir) {
  return nodes.map((node) => {
    if (node.children) {
      const isExpanded = expandedDirs.has(node.path);
      const avg = avgChurnScore(node);
      const cColor = getChurnScoreColor(avg);
      return (
        <div key={node.path}>
          <div
            className="flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer text-gray-400 hover:text-white hover:bg-gray-800/50"
            style={{ paddingLeft: depth * 14 + 4 }}
            onClick={() => toggleDir(node.path)}
          >
            <span className="text-gray-600 w-3 text-center shrink-0">
              {isExpanded ? '▾' : '▸'}
            </span>
            <span className="text-blue-400/70">📁</span>
            <span className="truncate">{node.name}</span>
            <span className={`ml-auto shrink-0 font-mono text-[10px] ${cColor}`}>{avg}</span>
          </div>
          {isExpanded && renderTree(node.children, depth + 1, selectedFile, setSelectedFile, expandedDirs, toggleDir)}
        </div>
      );
    }

    const isSelected = selectedFile && selectedFile.file_path === node.file.file_path;
    const cColor = getChurnScoreColor(node.file.churn_score || 0);

    return (
      <div
        key={node.path}
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer transition-colors ${
          isSelected ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
        }`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => setSelectedFile(isSelected ? null : node.file)}
      >
        <span className="w-3 shrink-0" />
        <span className="truncate">{node.name}</span>
        <span className={`ml-auto shrink-0 font-mono ${cColor}`}>{node.file.churn_score || 0}</span>
      </div>
    );
  });
}
