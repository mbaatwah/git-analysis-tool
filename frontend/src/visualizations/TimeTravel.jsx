import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';

export default function TimeTravel({ commits, snapshot, onCommitChange, loading }) {
  const scrubberRef = useRef(null);
  const treemapRef = useRef(null);
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(commits.length - 1);
  const [speed, setSpeed] = useState(400);
  const playRef = useRef(null);
  const SPEEDS = [1600, 800, 400, 200, 100, 50];
  const SPEED_LABELS = ['0.25x', '0.5x', '1x', '2x', '4x', '8x'];
  const [treeDims, setTreeDims] = useState({ width: 0, height: 0 });

  // Sync currentIndex when commits change
  useEffect(() => {
    if (commits.length > 0 && currentIndex >= commits.length) {
      setCurrentIndex(commits.length - 1);
    }
  }, [commits.length]);

  // ResizeObserver for treemap area
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setTreeDims({ width, height });
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Notify parent when index changes
  useEffect(() => {
    if (commits.length > 0 && onCommitChange) {
      onCommitChange(currentIndex);
    }
  }, [currentIndex, commits.length]);

  // Auto-play
  useEffect(() => {
    if (playing && commits.length > 0) {
      playRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= commits.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, speed);
    }
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, commits.length, speed]);

  const speedIndex = SPEEDS.indexOf(speed);
  const speedLabel = SPEED_LABELS[speedIndex] || '1x';

  const slower = () => {
    const idx = SPEEDS.indexOf(speed);
    if (idx > 0) setSpeed(SPEEDS[idx - 1]);
  };

  const faster = () => {
    const idx = SPEEDS.indexOf(speed);
    if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1]);
  };

  // Draw scrubber
  useEffect(() => {
    if (!scrubberRef.current || commits.length === 0) return;

    const svg = d3.select(scrubberRef.current);
    svg.selectAll('*').remove();

    const width = scrubberRef.current.clientWidth;
    const height = 60;
    const margin = { left: 50, right: 20 };
    const innerWidth = width - margin.left - margin.right;

    const g = svg.append('g').attr('transform', `translate(${margin.left}, 0)`);

    // Scale
    const xScale = d3.scaleLinear()
      .domain([0, commits.length - 1])
      .range([0, innerWidth])
      .clamp(true);

    // Track line
    g.append('line')
      .attr('x1', 0).attr('x2', innerWidth)
      .attr('y1', 30).attr('y2', 30)
      .attr('stroke', '#334155')
      .attr('stroke-width', 2);

    // Progress line
    g.append('line')
      .attr('x1', 0).attr('x2', xScale(currentIndex))
      .attr('y1', 30).attr('y2', 30)
      .attr('stroke', '#818cf8')
      .attr('stroke-width', 2);

    // Commit ticks (sample if too many)
    const maxTicks = Math.min(commits.length, Math.floor(innerWidth / 3));
    const step = Math.max(1, Math.floor(commits.length / maxTicks));

    for (let i = 0; i < commits.length; i += step) {
      g.append('line')
        .attr('x1', xScale(i)).attr('x2', xScale(i))
        .attr('y1', 25).attr('y2', 35)
        .attr('stroke', i <= currentIndex ? '#818cf8' : '#475569')
        .attr('stroke-width', 1);
    }

    // Handle
    const handle = g.append('g')
      .attr('transform', `translate(${xScale(currentIndex)}, 30)`)
      .style('cursor', 'grab');

    handle.append('circle')
      .attr('r', 8)
      .attr('fill', '#6366f1')
      .attr('stroke', '#c7d2fe')
      .attr('stroke-width', 2);

    // Date labels
    if (commits.length > 0) {
      g.append('text')
        .attr('x', 0).attr('y', 52)
        .attr('fill', 'rgba(255,255,255,0.3)')
        .attr('font-size', '9px')
        .text(formatDate(commits[0].date));

      g.append('text')
        .attr('x', innerWidth).attr('y', 52)
        .attr('text-anchor', 'end')
        .attr('fill', 'rgba(255,255,255,0.3)')
        .attr('font-size', '9px')
        .text(formatDate(commits[commits.length - 1].date));

      // Current commit label
      g.append('text')
        .attr('x', xScale(currentIndex)).attr('y', 14)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255,255,255,0.6)')
        .attr('font-size', '10px')
        .text(`${currentIndex + 1}/${commits.length}`);
    }

    // Drag behavior on entire SVG area
    const drag = d3.drag()
      .on('drag', (event) => {
        const x = event.x - margin.left;
        const idx = Math.round(xScale.invert(x));
        const clamped = Math.max(0, Math.min(commits.length - 1, idx));
        setCurrentIndex(clamped);
      });

    svg.call(drag);

    // Click to jump
    svg.on('click', (event) => {
      const [mx] = d3.pointer(event);
      const idx = Math.round(xScale.invert(mx - margin.left));
      const clamped = Math.max(0, Math.min(commits.length - 1, idx));
      setCurrentIndex(clamped);
    });

  }, [commits, currentIndex]);

  // Draw treemap
  useEffect(() => {
    if (!treemapRef.current || !snapshot || !snapshot.files || snapshot.files.length === 0) return;
    if (treeDims.width === 0) return;

    const svg = d3.select(treemapRef.current);
    svg.selectAll('*').remove();

    const { width, height } = treeDims;
    const files = snapshot.files;

    // Build hierarchy
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

    // Cells
    const cell = g.selectAll('g')
      .data(leaves)
      .join('g')
      .attr('transform', (d) => `translate(${d.x0},${d.y0})`);

    cell.append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('fill', (d) => {
        if (d.data.file.changedInThisCommit) return '#f59e0b';
        return getRecencyColor(d.data.file.last_changed, snapshot.commit?.date);
      })
      .attr('fill-opacity', (d) => d.data.file.changedInThisCommit ? 0.9 : 0.6)
      .attr('stroke', (d) => d.data.file.changedInThisCommit ? '#fbbf24' : 'rgba(0,0,0,0.3)')
      .attr('stroke-width', (d) => d.data.file.changedInThisCommit ? 2 : 0.5)
      .attr('rx', 2);

    // Labels
    cell.filter((d) => (d.x1 - d.x0) > 40 && (d.y1 - d.y0) > 14)
      .append('text')
      .attr('x', 4).attr('y', 12)
      .attr('fill', 'rgba(255,255,255,0.8)')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .text((d) => {
        const name = d.data.name;
        const maxLen = Math.floor((d.x1 - d.x0 - 8) / 5.5);
        return name.length > maxLen ? name.slice(0, maxLen) + '…' : name;
      });

    // Tooltip
    const tooltip = d3.select(containerRef.current)
      .selectAll('.tt-timetravel')
      .data([0])
      .join('div')
      .attr('class', 'tt-timetravel')
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

    cell
      .on('mouseenter', (event, d) => {
        const f = d.data.file;
        tooltip
          .html(
            `<div style="font-weight:600;font-family:monospace;margin-bottom:4px">${f.file_path}</div>` +
            `<div>Changes: <span style="color:#818cf8">${f.change_count}</span></div>` +
            `<div><span style="color:#22c55e">+${f.total_insertions}</span> <span style="color:#ef4444">-${f.total_deletions}</span></div>` +
            `<div>Authors: ${f.author_count}</div>` +
            (f.changedInThisCommit ? `<div style="color:#f59e0b;font-weight:600;margin-top:4px">★ Changed in this commit</div>` : '')
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

  }, [snapshot, treeDims]);

  if (!commits || commits.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <p>No commits available</p>
      </div>
    );
  }

  const commit = snapshot?.commit;

  return (
    <div className="flex flex-col h-full">
      {/* Commit info bar */}
      <div className="border-b border-gray-800 px-4 py-2 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentIndex((p) => Math.max(0, p - 1))}
            disabled={currentIndex === 0}
            className="text-gray-400 hover:text-white disabled:text-gray-700 text-sm px-1"
          >
            ◀
          </button>
          <button
            onClick={slower}
            disabled={speedIndex <= 0}
            className="text-gray-400 hover:text-white disabled:text-gray-700 text-xs px-1"
            title="Slower"
          >
            ⏪
          </button>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded-md"
          >
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button
            onClick={faster}
            disabled={speedIndex >= SPEEDS.length - 1}
            className="text-gray-400 hover:text-white disabled:text-gray-700 text-xs px-1"
            title="Faster"
          >
            ⏩
          </button>
          <span className="text-xs text-gray-500 font-mono w-8 text-center">{speedLabel}</span>
          <button
            onClick={() => setCurrentIndex((p) => Math.min(commits.length - 1, p + 1))}
            disabled={currentIndex >= commits.length - 1}
            className="text-gray-400 hover:text-white disabled:text-gray-700 text-sm px-1"
          >
            ▶
          </button>
        </div>

        {commit && (
          <div className="flex items-center gap-3 text-xs overflow-hidden">
            <span className="text-indigo-400 font-mono font-medium">{commit.hash}</span>
            <span className="text-gray-300 truncate max-w-xs">{commit.message}</span>
            <span className="text-gray-500">{commit.author}</span>
            <span className="text-gray-600">{formatDate(commit.date)}</span>
          </div>
        )}

        {loading && <span className="text-xs text-indigo-400 animate-pulse ml-auto">Loading...</span>}

        {snapshot && (
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-500 shrink-0">
            <span><span className="text-gray-300 font-medium">{snapshot.summary.totalFiles}</span> files</span>
            <span><span className="text-gray-300 font-medium">{snapshot.summary.commitsSoFar}</span>/{commits.length} commits</span>
          </div>
        )}
      </div>

      {/* Treemap area */}
      <div ref={containerRef} className="flex-1 relative min-h-0 overflow-hidden">
        {snapshot && snapshot.files.length > 0 ? (
          <svg ref={treemapRef} width={treeDims.width} height={treeDims.height} className="block" />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            {loading ? 'Loading snapshot...' : 'No files at this point in history'}
          </div>
        )}
      </div>

      {/* Scrubber */}
      <div className="border-t border-gray-800 px-2 py-1 shrink-0">
        <svg ref={scrubberRef} width="100%" height="60" className="block" />
      </div>

      {/* Files changed in this commit */}
      {snapshot && snapshot.filesInCommit && snapshot.filesInCommit.length > 0 && (
        <div className="border-t border-gray-800 px-4 py-2 shrink-0 max-h-24 overflow-y-auto">
          <span className="text-xs text-gray-500 uppercase tracking-wider font-medium">
            Changed in this commit ({snapshot.filesInCommit.length}):
          </span>
          <div className="flex flex-wrap gap-1 mt-1">
            {snapshot.filesInCommit.map((f) => (
              <span key={f.file_path} className="text-xs font-mono bg-amber-900/30 text-amber-300 px-2 py-0.5 rounded">
                {f.file_path}
                <span className="text-green-400 ml-1">+{f.insertions}</span>
                <span className="text-red-400 ml-0.5">-{f.deletions}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getRecencyColor(lastChanged, refDate) {
  if (!lastChanged || !refDate) return '#334155';
  const diff = (new Date(refDate) - new Date(lastChanged)) / (1000 * 60 * 60 * 24);
  if (diff < 1) return '#ef4444';    // today
  if (diff < 7) return '#f97316';    // this week
  if (diff < 30) return '#6366f1';   // this month
  return '#334155';                    // older
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
