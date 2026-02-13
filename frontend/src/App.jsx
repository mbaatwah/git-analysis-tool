import { useState } from 'react';
import { useApi } from './hooks/useApi.js';

function App() {
  const [repoPath, setRepoPath] = useState('');
  const [repo, setRepo] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [files, setFiles] = useState([]);
  const [commits, setCommits] = useState(null);
  const [view, setView] = useState('files');
  const { get, post, loading, error, setError } = useApi();

  const handleSync = async () => {
    if (!repoPath.trim()) return;
    setError(null);
    try {
      const data = await post('/config/repo', { path: repoPath.trim() });
      setRepo(data.repo);
      setRepoInfo(data.info);

      const filesData = await get(`/files?repoId=${data.repo.id}`);
      setFiles(filesData.files);

      const commitsData = await get(`/commits?repoId=${data.repo.id}&limit=25`);
      setCommits(commitsData);
    } catch (e) {
      // error is already set by useApi
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-white tracking-tight">
            <span className="text-indigo-400">git</span>-analysis
          </h1>
          {repo && (
            <div className="text-sm text-gray-400">
              <span className="text-gray-300 font-medium">{repo.name}</span>
              {' · '}
              {repo.totalCommits} commits synced
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className="w-80 border-r border-gray-800 p-4 flex flex-col gap-4">
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
            <div className="space-y-2 text-sm">
              <h3 className="font-medium text-gray-300">Repo Info</h3>
              <div className="text-gray-400">
                <p>Branch: <span className="text-gray-200">{repoInfo.currentBranch}</span></p>
                <p>Branches: <span className="text-gray-200">{repoInfo.branches.length}</span></p>
                {repoInfo.remotes.length > 0 && (
                  <p>Remote: <span className="text-gray-200">{repoInfo.remotes[0].url}</span></p>
                )}
              </div>
            </div>
          )}

          {repo && (
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => setView('files')}
                className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${
                  view === 'files'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Files
              </button>
              <button
                onClick={() => setView('commits')}
                className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${
                  view === 'commits'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                Commits
              </button>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 overflow-auto">
          {!repo ? (
            <div className="flex items-center justify-center h-full text-gray-600">
              <div className="text-center">
                <p className="text-lg">Enter a repository path to get started</p>
                <p className="text-sm mt-1">Point to any local git repository</p>
              </div>
            </div>
          ) : view === 'files' ? (
            <FileList files={files} />
          ) : (
            <CommitList commits={commits} />
          )}
        </main>
      </div>
    </div>
  );
}

function FileList({ files }) {
  if (!files.length) return <p className="text-gray-500">No file data available.</p>;

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">
        Files by Churn <span className="text-gray-500 text-sm font-normal">({files.length} files)</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2 pr-4">File</th>
              <th className="pb-2 pr-4 text-right">Changes</th>
              <th className="pb-2 pr-4 text-right">Insertions</th>
              <th className="pb-2 pr-4 text-right">Deletions</th>
              <th className="pb-2 pr-4 text-right">Authors</th>
              <th className="pb-2 text-right">Last Changed</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.file_path} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                <td className="py-2 pr-4 font-mono text-xs text-gray-200 max-w-md truncate">
                  {f.file_path}
                </td>
                <td className="py-2 pr-4 text-right text-indigo-400 font-medium">{f.change_count}</td>
                <td className="py-2 pr-4 text-right text-green-400">+{f.total_insertions}</td>
                <td className="py-2 pr-4 text-right text-red-400">-{f.total_deletions}</td>
                <td className="py-2 pr-4 text-right text-gray-300">{f.author_count}</td>
                <td className="py-2 text-right text-gray-400 text-xs">
                  {new Date(f.last_changed).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CommitList({ commits }) {
  if (!commits || !commits.commits.length) {
    return <p className="text-gray-500">No commits available.</p>;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">
        Recent Commits{' '}
        <span className="text-gray-500 text-sm font-normal">
          ({commits.total} total, showing {commits.commits.length})
        </span>
      </h2>
      <div className="space-y-2">
        {commits.commits.map((c) => (
          <div key={c.id} className="border border-gray-800 rounded-lg p-3 hover:bg-gray-900/50">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{c.message}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {c.author_name} · {new Date(c.date).toLocaleDateString()} ·{' '}
                  <span className="text-green-400">+{c.insertions}</span>{' '}
                  <span className="text-red-400">-{c.deletions}</span>{' '}
                  <span className="text-gray-400">({c.files_changed} files)</span>
                </p>
              </div>
              <code className="text-xs text-gray-600 ml-3 shrink-0">{c.hash.slice(0, 7)}</code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
