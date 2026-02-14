import { useState, useCallback } from 'react';
import { useApi } from './hooks/useApi.js';
import Treemap from './visualizations/Treemap.jsx';
import CouplingGraph from './visualizations/CouplingGraph.jsx';
import TimeTravel from './visualizations/TimeTravel.jsx';
import FileDetailPanel from './components/FileDetailPanel.jsx';
import DateFilter from './components/DateFilter.jsx';
import FolderPicker from './components/FolderPicker.jsx';

function App() {
  const [repoPath, setRepoPath] = useState('');
  const [repo, setRepo] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [churnData, setChurnData] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [view, setView] = useState('treemap');
  const [dateFilter, setDateFilter] = useState({});
  const [couplingData, setCouplingData] = useState(null);
  const [couplingThreshold, setCouplingThreshold] = useState(0.3);
  const [minCoChanges, setMinCoChanges] = useState(2);
  const [selectedCouplingNode, setSelectedCouplingNode] = useState(null);
  const [commitList, setCommitList] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [directories, setDirectories] = useState([]);
  const [directoryFilter, setDirectoryFilter] = useState(null);
  const { get, post, loading, error, setError } = useApi();

  const fetchChurnData = useCallback(
    async (repoId, filters = {}, dir) => {
      const params = new URLSearchParams({ repoId });
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (dir) params.set('directory', dir);

      const data = await get(`/analysis/churn?${params}`);
      setChurnData(data);
    },
    [get]
  );

  const fetchCouplingData = useCallback(
    async (repoId, filters = {}, threshold, minCo, dir) => {
      const params = new URLSearchParams({ repoId });
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      params.set('minCoupling', threshold ?? 0.3);
      params.set('minCoChanges', minCo ?? 2);
      if (dir) params.set('directory', dir);

      const data = await get(`/analysis/coupling?${params}`);
      setCouplingData(data);
    },
    [get]
  );

  const fetchCommitList = useCallback(
    async (repoId) => {
      const data = await get(`/analysis/commits?repoId=${repoId}`);
      setCommitList(data.commits || []);
    },
    [get]
  );

  const fetchSnapshot = useCallback(
    async (repoId, commitIndex, dir) => {
      setSnapshotLoading(true);
      try {
        const params = new URLSearchParams({ repoId, commitIndex });
        if (dir) params.set('directory', dir);
        const data = await get(`/analysis/snapshot?${params}`);
        setSnapshot(data);
      } finally {
        setSnapshotLoading(false);
      }
    },
    [get]
  );

  const handleSync = async () => {
    if (!repoPath.trim()) return;
    setError(null);
    setSelectedFile(null);
    try {
      const data = await post('/config/repo', { path: repoPath.trim() });
      setRepo(data.repo);
      setRepoInfo(data.info);
      const dirsData = await get(`/analysis/directories?repoId=${data.repo.id}`);
      setDirectories(dirsData.directories || []);
      await fetchChurnData(data.repo.id, {}, directoryFilter);
      await fetchCouplingData(data.repo.id, {}, couplingThreshold, minCoChanges, directoryFilter);
      await fetchCommitList(data.repo.id);
    } catch (e) {
      // error is already set by useApi
    }
  };

  const handleDateFilterChange = async (filters) => {
    setDateFilter(filters);
    if (repo) {
      setSelectedFile(null);
      setSelectedCouplingNode(null);
      await fetchChurnData(repo.id, filters, directoryFilter);
      await fetchCouplingData(repo.id, filters, couplingThreshold, minCoChanges, directoryFilter);
    }
  };

  const handleCouplingThresholdChange = async (val) => {
    setCouplingThreshold(val);
    if (repo) {
      setSelectedCouplingNode(null);
      await fetchCouplingData(repo.id, dateFilter, val, minCoChanges, directoryFilter);
    }
  };

  const handleMinCoChangesChange = async (val) => {
    setMinCoChanges(val);
    if (repo) {
      setSelectedCouplingNode(null);
      await fetchCouplingData(repo.id, dateFilter, couplingThreshold, val, directoryFilter);
    }
  };

  const handleFileSelect = (file) => {
    setSelectedFile((prev) =>
      prev && prev.file_path === file.file_path ? null : file
    );
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white tracking-tight">
            <span className="text-indigo-400">git</span>-analysis
          </h1>
          <div className="flex items-center gap-4">
            {view === 'coupling' && couplingData ? (
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>
                  <span className="text-gray-300 font-medium">{couplingData.summary.totalNodes}</span> files
                </span>
                <span>
                  <span className="text-indigo-400 font-medium">{couplingData.summary.totalPairs}</span> pairs
                </span>
                <span>
                  <span className="text-amber-400 font-medium">{couplingData.summary.crossDirectoryPairs}</span> cross-dir
                </span>
              </div>
            ) : churnData && (
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>
                  <span className="text-gray-300 font-medium">{churnData.summary.totalFiles}</span> files
                </span>
                <span>
                  avg score <span className="text-indigo-400 font-medium">{churnData.summary.avgChurnScore}</span>
                </span>
                <span>
                  max <span className="text-red-400 font-medium">{churnData.summary.maxChurnScore}</span>
                </span>
              </div>
            )}
            {repo && (
              <div className="text-sm text-gray-400">
                <span className="text-gray-300 font-medium">{repo.name}</span>
                {' · '}
                {repo.totalCommits} commits
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r border-gray-800 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Repository Path
            </label>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSync()}
              placeholder="/path/to/your/repo"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
            <button
              onClick={handleSync}
              disabled={loading}
              className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
            >
              {loading ? 'Syncing...' : 'Sync Repository'}
            </button>
          </div>

          {error && (
            <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {repoInfo && (
            <div className="space-y-1 text-sm">
              <h3 className="font-medium text-gray-300 text-xs uppercase tracking-wider">Repo</h3>
              <div className="text-gray-400 text-xs">
                <p>Branch: <span className="text-gray-200">{repoInfo.currentBranch}</span></p>
                <p>Branches: <span className="text-gray-200">{repoInfo.branches.length}</span></p>
                {repoInfo.remotes.length > 0 && (
                  <p className="truncate" title={repoInfo.remotes[0].url}>
                    Remote: <span className="text-gray-200">{repoInfo.remotes[0].url}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {repo && (
            <>
              <FolderPicker
                directories={directories}
                selected={directoryFilter}
                onSelect={(dir) => {
                  setDirectoryFilter(dir);
                  setSelectedFile(null);
                  setSelectedCouplingNode(null);
                  setSnapshot(null);
                  fetchChurnData(repo.id, dateFilter, dir);
                  fetchCouplingData(repo.id, dateFilter, couplingThreshold, minCoChanges, dir);
                }}
              />

              <DateFilter onFilterChange={handleDateFilterChange} />

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                  View
                </label>
                <div className="flex gap-1">
                  {['treemap', 'table', 'coupling', 'timeline'].map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={`flex-1 text-xs py-1.5 rounded-md transition-colors capitalize ${
                        view === v
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {view === 'timeline' ? (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    Legend
                  </label>
                  <div className="space-y-1 text-xs">
                    <LegendItem color="bg-amber-500" label="Changed in current commit" />
                    <LegendItem color="bg-red-500" label="Changed today" />
                    <LegendItem color="bg-orange-500" label="Changed this week" />
                    <LegendItem color="bg-indigo-500" label="Changed this month" />
                    <LegendItem color="bg-slate-700" label="Older" />
                  </div>
                  <p className="text-xs text-gray-600 mt-2">Drag the scrubber or click Play to travel through commits. File size = lines changed.</p>
                </div>
              ) : view === 'coupling' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Min Coupling: {couplingThreshold}
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={couplingThreshold}
                      onChange={(e) => handleCouplingThresholdChange(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>0.1</span>
                      <span>1.0</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Min Co-Changes: {minCoChanges}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      value={minCoChanges}
                      onChange={(e) => handleMinCoChangesChange(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-xs text-gray-600 mt-1">
                      <span>1</span>
                      <span>20</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      Legend
                    </label>
                    <div className="space-y-1 text-xs">
                      <LegendItem color="bg-amber-500" label="Cross-directory (dashed)" />
                      <LegendItem color="bg-slate-500" label="Same directory" />
                    </div>
                    <p className="text-xs text-gray-600 mt-2">Node size = change frequency. Edge thickness = coupling strength.</p>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    Recency
                  </label>
                  <div className="space-y-1 text-xs">
                    <LegendItem color="bg-red-500" label="< 7 days ago" />
                    <LegendItem color="bg-amber-500" label="< 30 days ago" />
                    <LegendItem color="bg-indigo-500" label="< 90 days ago" />
                    <LegendItem color="bg-slate-700" label="> 90 days ago" />
                  </div>
                </div>
              )}
            </>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto">
            {!repo ? (
              <div className="flex items-center justify-center h-full text-gray-600">
                <div className="text-center">
                  <p className="text-lg">Enter a repository path to get started</p>
                  <p className="text-sm mt-1">Point to any local git repository</p>
                </div>
              </div>
            ) : view === 'treemap' ? (
              <Treemap
                files={churnData?.files || []}
                onFileSelect={handleFileSelect}
                selectedFile={selectedFile}
              />
            ) : view === 'timeline' ? (
              <TimeTravel
                commits={commitList}
                snapshot={snapshot}
                loading={snapshotLoading}
                onCommitChange={(idx) => {
                  if (repo) fetchSnapshot(repo.id, idx, directoryFilter);
                }}
              />
            ) : view === 'coupling' ? (
              <CouplingGraph
                nodes={couplingData?.nodes || []}
                edges={couplingData?.edges || []}
                onNodeSelect={(nodeId) => {
                  setSelectedCouplingNode((prev) => prev === nodeId ? null : nodeId);
                  // Also select matching churn file for the detail panel
                  const churnFile = churnData?.files?.find((f) => f.file_path === nodeId);
                  if (churnFile) setSelectedFile(churnFile);
                  else setSelectedFile(null);
                }}
                selectedNode={selectedCouplingNode}
              />
            ) : (
              <div className="p-6">
                <FileTable
                  files={churnData?.files || []}
                  onFileSelect={handleFileSelect}
                  selectedFile={selectedFile}
                />
              </div>
            )}
          </div>

          {/* File Detail Panel */}
          {selectedFile && repo && (
            <FileDetailPanel
              file={selectedFile}
              repoId={repo.id}
              onClose={() => setSelectedFile(null)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-sm ${color}`} />
      <span className="text-gray-400">{label}</span>
    </div>
  );
}

function FileTable({ files, onFileSelect, selectedFile }) {
  if (!files.length) return <p className="text-gray-500">No churn data available.</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">
        Files by Churn Score{' '}
        <span className="text-gray-500 text-sm font-normal">({files.length} files)</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2 pr-4">File</th>
              <th className="pb-2 pr-4 text-right">Score</th>
              <th className="pb-2 pr-4 text-right">Changes</th>
              <th className="pb-2 pr-4 text-right">+/-</th>
              <th className="pb-2 pr-4 text-right">Authors</th>
              <th className="pb-2 text-right">Last Changed</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const isSelected = selectedFile && selectedFile.file_path === f.file_path;
              return (
                <tr
                  key={f.file_path}
                  onClick={() => onFileSelect(f)}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-900/30' : 'hover:bg-gray-900/50'
                  }`}
                >
                  <td className="py-2 pr-4 font-mono text-xs text-gray-200 max-w-md truncate">
                    {f.file_path}
                  </td>
                  <td className="py-2 pr-4 text-right text-indigo-400 font-semibold">
                    {f.churn_score}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-300">{f.change_count}</td>
                  <td className="py-2 pr-4 text-right">
                    <span className="text-green-400">+{f.total_insertions}</span>{' '}
                    <span className="text-red-400">-{f.total_deletions}</span>
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-300">{f.author_count}</td>
                  <td className="py-2 text-right text-gray-400 text-xs">
                    {new Date(f.last_changed).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
