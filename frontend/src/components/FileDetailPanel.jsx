import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.js';

export default function FileDetailPanel({ file, repoId, onClose }) {
  const [history, setHistory] = useState(null);
  const { get, loading } = useApi();

  useEffect(() => {
    if (!file || !repoId) return;

    get(`/analysis/churn/file?repoId=${repoId}&filePath=${encodeURIComponent(file.file_path)}`)
      .then((data) => setHistory(data.history))
      .catch(() => setHistory(null));
  }, [file, repoId]);

  if (!file) return null;

  return (
    <div className="border-l border-gray-800 w-80 flex flex-col bg-gray-950 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-indigo-300 truncate" title={file.file_path}>
            {file.file_path}
          </p>
          <p className="text-xs text-gray-500 mt-1">{file.directory}/</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white text-lg leading-none shrink-0"
        >
          ×
        </button>
      </div>

      {/* Stats */}
      <div className="p-4 grid grid-cols-2 gap-3 border-b border-gray-800">
        <Stat label="Churn Score" value={file.churn_score} color="text-indigo-400" />
        <Stat label="Changes" value={file.change_count} color="text-white" />
        <Stat label="Insertions" value={`+${file.total_insertions}`} color="text-green-400" />
        <Stat label="Deletions" value={`-${file.total_deletions}`} color="text-red-400" />
        <Stat label="Authors" value={file.author_count} color="text-amber-400" />
        <Stat label="Days Active" value={file.days_active} color="text-gray-300" />
        <Stat
          label="Change Rate"
          value={`${file.change_rate}/day`}
          color="text-gray-300"
        />
        <Stat label="Extension" value={file.extension || '—'} color="text-gray-400" />
      </div>

      {/* Date Range */}
      <div className="p-4 border-b border-gray-800 text-xs text-gray-400 space-y-1">
        <p>
          First changed:{' '}
          <span className="text-gray-200">{new Date(file.first_changed).toLocaleDateString()}</span>
        </p>
        <p>
          Last changed:{' '}
          <span className="text-gray-200">{new Date(file.last_changed).toLocaleDateString()}</span>
        </p>
      </div>

      {/* Monthly History */}
      <div className="p-4 flex-1">
        <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
          Monthly History
        </h4>
        {loading ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : history && history.length > 0 ? (
          <div className="space-y-2">
            {history.map((h) => (
              <div
                key={h.month}
                className="flex items-center justify-between text-xs border border-gray-800/50 rounded-md px-3 py-2"
              >
                <span className="text-gray-300 font-mono">{h.month}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{h.change_count}×</span>
                  <span className="text-green-400">+{h.insertions}</span>
                  <span className="text-red-400">-{h.deletions}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-600">No history available</p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}
