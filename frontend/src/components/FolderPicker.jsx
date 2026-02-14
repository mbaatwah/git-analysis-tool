import { useState, useMemo } from 'react';

export default function FolderPicker({ directories, selected, onSelect }) {
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState('');

  // Build tree structure from flat directory list
  const tree = useMemo(() => {
    if (!directories || directories.length === 0) return [];

    const filtered = search
      ? directories.filter((d) => d.toLowerCase().includes(search.toLowerCase()))
      : directories;

    // Get top-level dirs and build nested structure
    const topLevel = new Set();
    for (const dir of filtered) {
      const first = dir.split('/')[0];
      topLevel.add(first);
    }

    function getChildren(parent) {
      const children = new Set();
      const prefix = parent ? parent + '/' : '';
      for (const dir of filtered) {
        if (parent && !dir.startsWith(prefix)) continue;
        if (!parent && dir.includes('/')) {
          children.add(dir.split('/')[0]);
          continue;
        }
        const rest = parent ? dir.slice(prefix.length) : dir;
        if (!rest.includes('/')) {
          children.add(dir);
        } else {
          const next = rest.split('/')[0];
          children.add(prefix + next);
        }
      }
      return Array.from(children).sort();
    }

    return Array.from(topLevel).sort().map((dir) => dir);
  }, [directories, search]);

  // Get children for a directory
  const getChildDirs = (parent) => {
    if (!directories) return [];
    const prefix = parent + '/';
    const children = new Set();
    for (const dir of directories) {
      if (!dir.startsWith(prefix)) continue;
      const rest = dir.slice(prefix.length);
      if (!rest.includes('/')) {
        children.add(dir);
      } else {
        children.add(prefix + rest.split('/')[0]);
      }
    }
    return Array.from(children).sort();
  };

  const toggleExpand = (dir) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const topDirs = useMemo(() => {
    if (!directories) return [];
    const tops = new Set();
    for (const dir of directories) {
      tops.add(dir.split('/')[0]);
    }
    return Array.from(tops).sort();
  }, [directories]);

  function renderDir(dir, depth = 0) {
    const children = getChildDirs(dir);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(dir);
    const isSelected = selected === dir;
    const name = dir.split('/').pop();

    return (
      <div key={dir}>
        <div
          className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer text-xs transition-colors ${
            isSelected
              ? 'bg-indigo-600/30 text-indigo-300'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
          }`}
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => onSelect(isSelected ? null : dir)}
        >
          {hasChildren ? (
            <span
              className="text-gray-600 w-3 text-center shrink-0"
              onClick={(e) => { e.stopPropagation(); toggleExpand(dir); }}
            >
              {isExpanded ? '▾' : '▸'}
            </span>
          ) : (
            <span className="w-3 shrink-0" />
          )}
          <span className="truncate">{name}</span>
        </div>
        {hasChildren && isExpanded && children.map((child) => renderDir(child, depth + 1))}
      </div>
    );
  }

  if (!directories || directories.length === 0) return null;

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
        Folder Filter
      </label>

      {selected && (
        <div className="flex items-center justify-between bg-indigo-900/20 border border-indigo-800/50 rounded-md px-2 py-1 mb-2">
          <span className="text-xs text-indigo-300 font-mono truncate">{selected}</span>
          <button
            onClick={() => onSelect(null)}
            className="text-gray-500 hover:text-white text-xs ml-2 shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search folders..."
        className="w-full bg-gray-900 border border-gray-700 rounded-md px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 mb-2"
      />

      <div className="max-h-48 overflow-y-auto border border-gray-800 rounded-md bg-gray-900/50 p-1">
        {topDirs
          .filter((d) => !search || d.toLowerCase().includes(search.toLowerCase()) ||
            directories.some((dir) => dir.startsWith(d) && dir.toLowerCase().includes(search.toLowerCase())))
          .map((dir) => renderDir(dir, 0))}
      </div>
    </div>
  );
}
