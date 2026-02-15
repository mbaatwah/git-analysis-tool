import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';

export default function ComplexityExplorer({ files, repoId, directoryFilter, commits, onTimelineCommitChange }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [growthData, setGrowthData] = useState(null);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [treeSearch, setTreeSearch] = useState('');
  const [fileContent, setFileContent] = useState(null);
  const [fileDiff, setFileDiff] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [rightTab, setRightTab] = useState('content');
  const chartRef = useRef(null);
  const chartContainerRef = useRef(null);
  const [chartDims, setChartDims] = useState({ width: 0, height: 0 });

  // Timeline state
  const scrubberRef = useRef(null);
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(400);
  const playRef = useRef(null);
  const [timelineFiles, setTimelineFiles] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineCommit, setTimelineCommit] = useState(null);
  const SPEEDS = [1600, 800, 400, 200, 100, 50];
  const SPEED_LABELS = ['0.25x', '0.5x', '1x', '2x', '4x', '8x'];

  // The files to show: either timeline snapshot or current
  const displayFiles = useMemo(() => {
    if (timelineEnabled && timelineFiles) return timelineFiles;
    return files;
  }, [timelineEnabled, timelineFiles, files]);

  // Check if selected file exists at current timeline commit
  const fileExistsAtCommit = useMemo(() => {
    if (!timelineEnabled || !selectedFile) return true;
    if (!timelineFiles) return false;
    return timelineFiles.some(f => f.file_path === selectedFile.file_path);
  }, [timelineEnabled, selectedFile, timelineFiles]);

  // Init timeline index when enabled or commits change
  useEffect(() => {
    if (timelineEnabled && commits && commits.length > 0 && currentIndex === -1) {
      setCurrentIndex(commits.length - 1);
    }
  }, [timelineEnabled, commits]);

  // Fetch complexity snapshot when timeline index changes (with debounce)
  useEffect(() => {
    if (!timelineEnabled || !repoId || !commits || commits.length === 0 || currentIndex < 0) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setTimelineLoading(true);

      fetch(`/api/analysis/complexity/at-commit?repoId=${repoId}&commitIndex=${currentIndex}${directoryFilter ? `&directory=${encodeURIComponent(directoryFilter)}` : ''}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setTimelineFiles(data.files || []);
            setTimelineCommit(data.commit);
            setTimelineLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) setTimelineLoading(false);
        });
    }, 150); // 150ms debounce for scrubbing

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [timelineEnabled, currentIndex, repoId, directoryFilter]);

  // Auto-play
  useEffect(() => {
    if (playing && commits && commits.length > 0) {
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
  }, [playing, commits, speed]);

  // ResizeObserver for chart area
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setChartDims({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    if (chartContainerRef.current) observer.observe(chartContainerRef.current);
    return () => observer.disconnect();
  }, []);

  // Build file tree - ALWAYS use final files (not timeline snapshot) so tree structure is stable
  const tree = useMemo(() => {
    if (!files || files.length === 0) return [];
    const filtered = treeSearch
      ? files.filter((f) => f.file_path.toLowerCase().includes(treeSearch.toLowerCase()))
      : files;
    return buildTree(filtered);
  }, [files, treeSearch]);

  // Fetch file content AND diff when file is selected or timeline changes (with debounce during playback)
  useEffect(() => {
    if (!selectedFile || !repoId) {
      setFileContent(null);
      setFileDiff(null);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setContentLoading(true);

      // Build URL based on timeline state
      let url;
      let diffUrl = null;
      if (timelineEnabled && timelineCommit) {
        url = `/api/analysis/complexity/content?repoId=${repoId}&filePath=${encodeURIComponent(selectedFile.file_path)}`;
        // Get diff for this commit showing what changed
        diffUrl = `/api/analysis/complexity/diff?repoId=${repoId}&filePath=${encodeURIComponent(selectedFile.file_path)}&commitHash=${timelineCommit.fullHash || timelineCommit.hash}`;
      } else {
        url = `/api/analysis/complexity/content?repoId=${repoId}&filePath=${encodeURIComponent(selectedFile.file_path)}`;
      }

      // Fetch content
      fetch(url)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setFileContent(data);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFileContent(null);
          }
        });

      // Fetch diff if in timeline mode
      if (diffUrl) {
        fetch(diffUrl)
          .then((r) => r.json())
          .then((data) => {
            if (!cancelled) {
              setFileDiff(data.diff || null);
              setContentLoading(false);
            }
          })
          .catch(() => {
            if (!cancelled) {
              setFileDiff(null);
              setContentLoading(false);
            }
          });
      } else {
        setFileDiff(null);
        setContentLoading(false);
      }
    }, timelineEnabled && playing ? 200 : 0); // Debounce during playback, immediate when paused

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [selectedFile, repoId, timelineEnabled, timelineCommit, playing]);

  // Fetch growth data when file is selected
  useEffect(() => {
    if (!selectedFile || !repoId) {
      setGrowthData(null);
      return;
    }

    let cancelled = false;
    setGrowthLoading(true);

    fetch(`/api/analysis/complexity/file?repoId=${repoId}&filePath=${encodeURIComponent(selectedFile.file_path)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setGrowthData(data);
          setGrowthLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setGrowthLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedFile, repoId]);

  // Draw growth chart
  useEffect(() => {
    if (!chartRef.current || !growthData || !growthData.history || growthData.history.length === 0) return;
    if (chartDims.width === 0) return;

    const svg = d3.select(chartRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const width = chartDims.width - margin.left - margin.right;
    const height = chartDims.height - margin.top - margin.bottom;
    if (width <= 0 || height <= 0) return;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const history = growthData.history;
    const dates = history.map((d) => new Date(d.date));

    const x = d3.scaleTime()
      .domain(d3.extent(dates))
      .range([0, width]);

    // Two y-axes: lines (left), complexity (right)
    const yLines = d3.scaleLinear()
      .domain([0, d3.max(history, (d) => d.lines) * 1.1])
      .range([height, 0]);

    const yComplexity = d3.scaleLinear()
      .domain([0, Math.max(d3.max(history, (d) => d.complexity) * 1.2, 1)])
      .range([height, 0]);

    // Grid
    g.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yLines.ticks(5))
      .join('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', (d) => yLines(d)).attr('y2', (d) => yLines(d))
      .attr('stroke', 'rgba(255,255,255,0.05)');

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(Math.min(history.length, 8)).tickFormat(d3.timeFormat('%b %d')))
      .attr('color', 'rgba(255,255,255,0.3)')
      .selectAll('text').attr('fill', 'rgba(255,255,255,0.4)').attr('font-size', '9px');

    // Y axis left (lines)
    g.append('g')
      .call(d3.axisLeft(yLines).ticks(5))
      .attr('color', 'rgba(255,255,255,0.3)')
      .selectAll('text').attr('fill', 'rgba(99, 102, 241, 0.7)').attr('font-size', '9px');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -height / 2).attr('y', -35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(99, 102, 241, 0.5)')
      .attr('font-size', '9px')
      .text('Lines');

    // Y axis right (complexity)
    g.append('g')
      .attr('transform', `translate(${width},0)`)
      .call(d3.axisRight(yComplexity).ticks(5))
      .attr('color', 'rgba(255,255,255,0.3)')
      .selectAll('text').attr('fill', 'rgba(245, 158, 11, 0.7)').attr('font-size', '9px');

    g.append('text')
      .attr('transform', 'rotate(90)')
      .attr('x', height / 2).attr('y', -width - 35)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(245, 158, 11, 0.5)')
      .attr('font-size', '9px')
      .text('Complexity');

    // Lines area
    const linesArea = d3.area()
      .x((d) => x(new Date(d.date)))
      .y0(height)
      .y1((d) => yLines(d.lines))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', linesArea)
      .attr('fill', 'rgba(99, 102, 241, 0.15)');

    // Lines line
    const linesLine = d3.line()
      .x((d) => x(new Date(d.date)))
      .y((d) => yLines(d.lines))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', linesLine)
      .attr('fill', 'none')
      .attr('stroke', '#6366f1')
      .attr('stroke-width', 2);

    // Complexity line
    const complexityLine = d3.line()
      .x((d) => x(new Date(d.date)))
      .y((d) => yComplexity(d.complexity))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('d', complexityLine)
      .attr('fill', 'none')
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4 2');

    // Dots for each commit
    const dots = g.selectAll('.dot-group')
      .data(history)
      .join('g')
      .attr('class', 'dot-group');

    dots.append('circle')
      .attr('cx', (d) => x(new Date(d.date)))
      .attr('cy', (d) => yLines(d.lines))
      .attr('r', 3)
      .attr('fill', '#6366f1');

    dots.append('circle')
      .attr('cx', (d) => x(new Date(d.date)))
      .attr('cy', (d) => yComplexity(d.complexity))
      .attr('r', 3)
      .attr('fill', '#f59e0b');

    // Tooltip
    const tooltip = d3.select(chartContainerRef.current)
      .selectAll('.tt-growth')
      .data([0])
      .join('div')
      .attr('class', 'tt-growth')
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
      .attr('x', (d) => x(new Date(d.date)) - 10)
      .attr('y', 0)
      .attr('width', 20)
      .attr('height', height)
      .attr('fill', 'transparent')
      .on('mouseenter', (event, d) => {
        tooltip
          .html(
            `<div style="font-weight:600;margin-bottom:4px">${d.hash} · ${formatDate(d.date)}</div>` +
            `<div style="color:#818cf8">Lines: ${d.lines} (code: ${d.codeLines})</div>` +
            `<div style="color:#f59e0b">Complexity: ${d.complexity}</div>` +
            `<div style="color:#22c55e">Max indent: ${d.maxIndent}</div>` +
            `<div style="margin-top:4px;color:#94a3b8;font-size:10px">${d.message}</div>` +
            `<div style="color:#64748b;font-size:10px">${d.author}</div>`
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

    legend.append('line').attr('x1', 0).attr('x2', 16).attr('y1', 0).attr('y2', 0)
      .attr('stroke', '#6366f1').attr('stroke-width', 2);
    legend.append('text').attr('x', 20).attr('y', 4)
      .attr('fill', 'rgba(255,255,255,0.5)').attr('font-size', '9px').text('Lines');

    legend.append('line').attr('x1', 0).attr('x2', 16).attr('y1', 14).attr('y2', 14)
      .attr('stroke', '#f59e0b').attr('stroke-width', 2).attr('stroke-dasharray', '4 2');
    legend.append('text').attr('x', 20).attr('y', 18)
      .attr('fill', 'rgba(255,255,255,0.5)').attr('font-size', '9px').text('Complexity');

  }, [growthData, chartDims]);

  // Draw scrubber
  useEffect(() => {
    if (!scrubberRef.current || !commits || commits.length === 0 || !timelineEnabled) return;

    const svg = d3.select(scrubberRef.current);
    svg.selectAll('*').remove();

    const width = scrubberRef.current.clientWidth;
    const height = 50;
    const margin = { left: 50, right: 20 };
    const innerWidth = width - margin.left - margin.right;
    if (innerWidth <= 0) return;

    const g = svg.append('g').attr('transform', `translate(${margin.left}, 0)`);

    const xScale = d3.scaleLinear()
      .domain([0, commits.length - 1])
      .range([0, innerWidth])
      .clamp(true);

    // Track line
    g.append('line')
      .attr('x1', 0).attr('x2', innerWidth)
      .attr('y1', 25).attr('y2', 25)
      .attr('stroke', '#334155')
      .attr('stroke-width', 2);

    // Progress line
    g.append('line')
      .attr('x1', 0).attr('x2', xScale(currentIndex))
      .attr('y1', 25).attr('y2', 25)
      .attr('stroke', '#818cf8')
      .attr('stroke-width', 2);

    // Commit ticks
    const maxTicks = Math.min(commits.length, Math.floor(innerWidth / 3));
    const step = Math.max(1, Math.floor(commits.length / maxTicks));

    for (let i = 0; i < commits.length; i += step) {
      g.append('line')
        .attr('x1', xScale(i)).attr('x2', xScale(i))
        .attr('y1', 20).attr('y2', 30)
        .attr('stroke', i <= currentIndex ? '#818cf8' : '#475569')
        .attr('stroke-width', 1);
    }

    // Handle
    g.append('g')
      .attr('transform', `translate(${xScale(currentIndex)}, 25)`)
      .style('cursor', 'grab')
      .append('circle')
      .attr('r', 7)
      .attr('fill', '#6366f1')
      .attr('stroke', '#c7d2fe')
      .attr('stroke-width', 2);

    // Date labels
    if (commits.length > 0) {
      g.append('text')
        .attr('x', 0).attr('y', 44)
        .attr('fill', 'rgba(255,255,255,0.3)')
        .attr('font-size', '9px')
        .text(formatDate(commits[0].date));

      g.append('text')
        .attr('x', innerWidth).attr('y', 44)
        .attr('text-anchor', 'end')
        .attr('fill', 'rgba(255,255,255,0.3)')
        .attr('font-size', '9px')
        .text(formatDate(commits[commits.length - 1].date));

      g.append('text')
        .attr('x', xScale(currentIndex)).attr('y', 12)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255,255,255,0.6)')
        .attr('font-size', '10px')
        .text(`${currentIndex + 1}/${commits.length}`);
    }

    // Drag + click
    const drag = d3.drag()
      .on('drag', (event) => {
        const x = event.x - margin.left;
        const idx = Math.round(xScale.invert(x));
        setCurrentIndex(Math.max(0, Math.min(commits.length - 1, idx)));
      });

    svg.call(drag);

    svg.on('click', (event) => {
      const [mx] = d3.pointer(event);
      const idx = Math.round(xScale.invert(mx - margin.left));
      setCurrentIndex(Math.max(0, Math.min(commits.length - 1, idx)));
    });
  }, [commits, currentIndex, timelineEnabled]);

  const toggleDir = (dir) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const speedIndex = SPEEDS.indexOf(speed);
  const speedLabel = SPEED_LABELS[speedIndex] || '1x';

  if (!files || files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <p>No complexity data available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Timeline bar */}
      <div className="border-b border-gray-800 px-4 py-2 flex items-center gap-3 shrink-0">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={timelineEnabled}
            onChange={(e) => {
              setTimelineEnabled(e.target.checked);
              if (!e.target.checked) {
                setPlaying(false);
                setTimelineFiles(null);
                setTimelineCommit(null);
                setCurrentIndex(-1);
              }
            }}
            className="accent-indigo-500"
          />
          Timeline
        </label>

        {timelineEnabled && commits && commits.length > 0 && (
          <>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentIndex((p) => Math.max(0, p - 1))}
                disabled={currentIndex === 0}
                className="text-gray-400 hover:text-white disabled:text-gray-700 text-sm px-1"
              >◀</button>
              <button
                onClick={() => {
                  const idx = SPEEDS.indexOf(speed);
                  if (idx > 0) setSpeed(SPEEDS[idx - 1]);
                }}
                disabled={speedIndex <= 0}
                className="text-gray-400 hover:text-white disabled:text-gray-700 text-xs px-1"
              >⏪</button>
              <button
                onClick={() => setPlaying((p) => !p)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded-md"
              >{playing ? '⏸ Pause' : '▶ Play'}</button>
              <button
                onClick={() => {
                  const idx = SPEEDS.indexOf(speed);
                  if (idx < SPEEDS.length - 1) setSpeed(SPEEDS[idx + 1]);
                }}
                disabled={speedIndex >= SPEEDS.length - 1}
                className="text-gray-400 hover:text-white disabled:text-gray-700 text-xs px-1"
              >⏩</button>
              <span className="text-xs text-gray-500 font-mono w-8 text-center">{speedLabel}</span>
              <button
                onClick={() => setCurrentIndex((p) => Math.min(commits.length - 1, p + 1))}
                disabled={currentIndex >= commits.length - 1}
                className="text-gray-400 hover:text-white disabled:text-gray-700 text-sm px-1"
              >▶</button>
            </div>

            {timelineCommit && (
              <div className="flex items-center gap-3 text-xs overflow-hidden">
                <span className="text-indigo-400 font-mono font-medium">{timelineCommit.hash}</span>
                <span className="text-gray-300 truncate max-w-xs">{timelineCommit.message}</span>
                <span className="text-gray-500">{timelineCommit.author}</span>
                <span className="text-gray-600">{formatDate(timelineCommit.date)}</span>
              </div>
            )}

            {timelineLoading && <span className="text-xs text-indigo-400 animate-pulse ml-auto">Loading...</span>}
          </>
        )}
      </div>

      {/* Scrubber */}
      {timelineEnabled && commits && commits.length > 0 && (
        <div className="border-b border-gray-800 px-2 shrink-0">
          <svg ref={scrubberRef} width="100%" height="50" className="block" />
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
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
            {renderTree(tree, 0, selectedFile, setSelectedFile, expandedDirs, toggleDir, timelineEnabled, timelineFiles)}
          </div>
        </div>

        {/* Right pane — file content + commits */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedFile ? (
            <>
              {/* File stats header */}
              <div className="border-b border-gray-800 px-4 py-3 shrink-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-sm text-white truncate">{selectedFile.file_path}</h3>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="text-gray-500 hover:text-white text-xs"
                  >✕</button>
                </div>
                <div className="flex gap-4 mt-2 text-xs">
                  <Stat label="Lines" value={selectedFile.lines} color="text-gray-300" />
                  <Stat label="Code" value={selectedFile.codeLines} color="text-indigo-400" />
                  <Stat label="Complexity" value={selectedFile.complexity} color="text-amber-400" />
                  <Stat label="Max Indent" value={selectedFile.maxIndent} color="text-green-400" />
                  <Stat label="Blank" value={selectedFile.blankLines} color="text-gray-500" />
                  <Stat label="Comments" value={selectedFile.commentLines} color="text-gray-500" />
                </div>
                {selectedFile.complexity > 3 && (
                  <div className="mt-2 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/50 rounded px-2 py-1">
                    ⚠ High complexity ({selectedFile.complexity}) — this file may be hard to maintain
                  </div>
                )}
              </div>

              {/* Tab bar */}
              <div className="border-b border-gray-800 flex shrink-0">
                {['content', 'growth', 'commits'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setRightTab(tab)}
                    className={`px-4 py-2 text-xs capitalize transition-colors ${
                      rightTab === tab
                        ? 'text-indigo-400 border-b-2 border-indigo-400'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >{tab}</button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden min-h-0">
                {rightTab === 'content' ? (
                  <div className="h-full overflow-auto">
                    {contentLoading ? (
                      <div className="flex items-center justify-center h-full text-indigo-400 text-sm animate-pulse">
                        Loading file content...
                      </div>
                    ) : timelineEnabled && !fileExistsAtCommit ? (
                      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                        <div className="text-center">
                          <p>File does not exist at this commit</p>
                          <p className="text-xs mt-1 text-gray-600">
                            {timelineCommit?.hash} · {timelineCommit?.message}
                          </p>
                        </div>
                      </div>
                    ) : fileContent && fileContent.content ? (
                      <div className="h-full flex flex-col">
                        {timelineEnabled && fileDiff && (
                          <div className="border-b border-gray-800 px-3 py-2 bg-gray-900/50">
                            <div className="text-xs text-gray-400 mb-1">Changes in this commit:</div>
                            <div className="flex gap-3 text-xs">
                              <span className="text-green-400">+{fileDiff.additions || 0} lines</span>
                              <span className="text-red-400">-{fileDiff.deletions || 0} lines</span>
                              {fileDiff.changedLines && fileDiff.changedLines.length > 0 && (
                                <span className="text-gray-500">
                                  ({fileDiff.changedLines.length} hunks)
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        <pre className="p-3 text-xs font-mono leading-relaxed flex-1 overflow-auto">
                          {fileDiff && fileDiff.diffContent ? (
                            // Show diff view
                            fileDiff.diffContent.split('\n').map((line, i) => {
                              const isAdded = line.startsWith('+') && !line.startsWith('+++');
                              const isRemoved = line.startsWith('-') && !line.startsWith('---');
                              const isHeader = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff') || line.startsWith('index');
                              let bgClass = '';
                              let textClass = 'text-gray-300';
                              if (isAdded) { bgClass = 'bg-green-900/30'; textClass = 'text-green-300'; }
                              else if (isRemoved) { bgClass = 'bg-red-900/30'; textClass = 'text-red-300'; }
                              else if (isHeader) { textClass = 'text-gray-500 italic'; }
                              return (
                                <div key={i} className={`flex hover:bg-gray-800/30 ${bgClass}`}>
                                  <span className="text-gray-600 select-none w-10 text-right pr-3 shrink-0">{isHeader ? '' : i + 1}</span>
                                  <span className={`${textClass} whitespace-pre overflow-x-auto`}>{line || ' '}</span>
                                </div>
                              );
                            })
                          ) : (
                            // Show normal content
                            fileContent.content.split('\n').map((line, i) => (
                              <div key={i} className="flex hover:bg-gray-800/30">
                                <span className="text-gray-600 select-none w-10 text-right pr-3 shrink-0">{i + 1}</span>
                                <span className="text-gray-300 whitespace-pre overflow-x-auto">{highlightIndentation(line)}</span>
                              </div>
                            ))
                          )}
                        </pre>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                        {fileContent?.error || 'File content not available'}
                      </div>
                    )}
                  </div>
                ) : rightTab === 'growth' ? (
                  <div ref={chartContainerRef} className="h-full relative overflow-hidden p-2">
                    {growthLoading ? (
                      <div className="flex items-center justify-center h-full text-indigo-400 text-sm animate-pulse">
                        Loading file history...
                      </div>
                    ) : growthData && growthData.history && growthData.history.length > 0 ? (
                      <svg ref={chartRef} width={chartDims.width} height={chartDims.height} className="block" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                        No history data for this file
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto text-xs">
                    {growthLoading ? (
                      <div className="flex items-center justify-center h-full text-indigo-400 text-sm animate-pulse">
                        Loading...
                      </div>
                    ) : growthData && growthData.history && growthData.history.length > 0 ? (
                      <table className="w-full">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-950">
                            <th className="text-left px-2 py-1">Commit</th>
                            <th className="text-right px-2 py-1">Lines</th>
                            <th className="text-right px-2 py-1">Complexity</th>
                            <th className="text-right px-2 py-1">+/-</th>
                            <th className="text-left px-2 py-1">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...growthData.history].reverse().map((h, i) => (
                            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                              <td className="px-2 py-1 font-mono text-indigo-400">{h.hash}</td>
                              <td className="px-2 py-1 text-right text-gray-300">{h.lines}</td>
                              <td className="px-2 py-1 text-right text-amber-400">{h.complexity}</td>
                              <td className="px-2 py-1 text-right">
                                <span className="text-green-400">+{h.insertions}</span>{' '}
                                <span className="text-red-400">-{h.deletions}</span>
                              </td>
                              <td className="px-2 py-1 text-gray-500">{formatDate(h.date)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                        No history data
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-600">
              <div className="text-center">
                <p className="text-sm">Select a file from the tree to see its content and history</p>
                <p className="text-xs mt-1 text-gray-700">Lines, complexity, and content tracked across commits</p>
              </div>
            </div>
          )}
        </div>
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

function highlightIndentation(line) {
  if (!line) return line;
  const match = line.match(/^(\s+)/);
  if (!match) return line;
  const indent = match[1];
  const rest = line.slice(indent.length);
  const level = indent.replace(/\t/g, '    ').length;
  const opacity = Math.min(0.15 + level * 0.04, 0.6);
  return (
    <>
      <span style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}>{indent}</span>
      {rest}
    </>
  );
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

  // Sort: dirs first, then files, alphabetical
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

function getComplexityColor(complexity) {
  if (complexity >= 4) return 'text-red-400';
  if (complexity >= 3) return 'text-amber-400';
  if (complexity >= 2) return 'text-yellow-400';
  return 'text-gray-500';
}

function avgComplexity(node) {
  const files = collectFiles(node);
  if (files.length === 0) return 0;
  const sum = files.reduce((s, f) => s + f.complexity, 0);
  return Math.round((sum / files.length) * 100) / 100;
}

function collectFiles(node) {
  if (!node.children) return node.file ? [node.file] : [];
  return node.children.flatMap(collectFiles);
}

function renderTree(nodes, depth, selectedFile, setSelectedFile, expandedDirs, toggleDir, timelineEnabled, timelineFiles) {
  // Create a Set of file paths that exist at current timeline commit for O(1) lookup
  const timelineFileSet = timelineEnabled && timelineFiles
    ? new Set(timelineFiles.map(f => f.file_path))
    : null;

  return nodes.map((node) => {
    if (node.children) {
      // Directory — show average complexity
      const isExpanded = expandedDirs.has(node.path);
      const avg = avgComplexity(node);
      const cColor = getComplexityColor(avg);
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
          {isExpanded && renderTree(node.children, depth + 1, selectedFile, setSelectedFile, expandedDirs, toggleDir, timelineEnabled, timelineFiles)}
        </div>
      );
    }

    // File
    const isSelected = selectedFile && selectedFile.file_path === node.file.file_path;
    const cColor = getComplexityColor(node.file.complexity);
    // Check if file exists at current timeline commit
    const fileExists = !timelineEnabled || !timelineFileSet || timelineFileSet.has(node.file.file_path);

    return (
      <div
        key={node.path}
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer transition-colors ${
          isSelected ? 'bg-indigo-600/30 text-indigo-300' : fileExists ? 'text-gray-400 hover:text-white hover:bg-gray-800/50' : 'text-gray-600 hover:text-gray-500'
        }`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={() => setSelectedFile(isSelected ? null : node.file)}
        title={fileExists ? '' : 'File does not exist at this commit'}
      >
        <span className="w-3 shrink-0" />
        <span className={`truncate ${!fileExists ? 'line-through opacity-50' : ''}`}>{node.name}</span>
        <span className={`ml-auto shrink-0 font-mono ${fileExists ? cColor : 'text-gray-700'}`}>{node.file.complexity}</span>
      </div>
    );
  });
}
