import { getDb } from '../db/schema.js';

/**
 * Compute co-change coupling between files.
 * For each commit, record which files changed together.
 * coupling_score = co_changes(A,B) / max(changes(A), changes(B))
 */
export function getCouplingAnalysis(repoId, { startDate, endDate, directory, minCoupling = 0.3, minCoChanges = 2, limit } = {}) {
  const db = getDb();

  // Get all commits with their changed files (filtered)
  const conditions = ['fc.repo_id = ?'];
  const params = [repoId];

  if (startDate) {
    conditions.push('c.date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('c.date <= ?');
    params.push(endDate);
  }
  if (directory) {
    conditions.push('fc.file_path LIKE ?');
    params.push(`${directory}%`);
  }

  const where = conditions.join(' AND ');

  // Get file change counts
  const fileCounts = new Map();
  const fileCountRows = db.prepare(`
    SELECT fc.file_path, COUNT(DISTINCT fc.commit_id) as change_count
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE ${where}
    GROUP BY fc.file_path
  `).all(...params);

  for (const row of fileCountRows) {
    fileCounts.set(row.file_path, row.change_count);
  }

  // Get commit → files mapping
  const commitFiles = db.prepare(`
    SELECT fc.commit_id, fc.file_path
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE ${where}
    ORDER BY fc.commit_id
  `).all(...params);

  // Group files by commit
  const commitMap = new Map();
  for (const row of commitFiles) {
    if (!commitMap.has(row.commit_id)) {
      commitMap.set(row.commit_id, []);
    }
    commitMap.get(row.commit_id).push(row.file_path);
  }

  // Count co-changes for each file pair
  const pairCounts = new Map();

  for (const [, files] of commitMap) {
    // Skip commits with too many files (likely merges/reformats)
    if (files.length > 50) continue;
    // Skip single-file commits
    if (files.length < 2) continue;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = files[i] < files[j]
          ? `${files[i]}\0${files[j]}`
          : `${files[j]}\0${files[i]}`;

        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  // Compute coupling scores
  const pairs = [];

  for (const [key, coChanges] of pairCounts) {
    if (coChanges < minCoChanges) continue;

    const [fileA, fileB] = key.split('\0');
    const countA = fileCounts.get(fileA) || 0;
    const countB = fileCounts.get(fileB) || 0;
    const maxChanges = Math.max(countA, countB);

    if (maxChanges === 0) continue;

    const couplingScore = coChanges / maxChanges;

    if (couplingScore < minCoupling) continue;

    // Determine if files are in different directories (structural debt signal)
    const dirA = getDirectory(fileA);
    const dirB = getDirectory(fileB);
    const crossDirectory = dirA !== dirB;

    pairs.push({
      fileA,
      fileB,
      coChanges,
      changesA: countA,
      changesB: countB,
      couplingScore: Math.round(couplingScore * 1000) / 1000,
      crossDirectory,
      directoryA: dirA,
      directoryB: dirB,
    });
  }

  // Sort by coupling score descending
  pairs.sort((a, b) => b.couplingScore - a.couplingScore);

  // Apply limit
  const limited = limit != null ? pairs.slice(0, limit) : pairs;

  // Build node list for graph visualization
  const nodeSet = new Set();
  for (const pair of limited) {
    nodeSet.add(pair.fileA);
    nodeSet.add(pair.fileB);
  }

  const nodes = Array.from(nodeSet).map((filePath) => ({
    id: filePath,
    directory: getDirectory(filePath),
    changeCount: fileCounts.get(filePath) || 0,
  }));

  const summary = {
    totalPairs: limited.length,
    totalNodes: nodes.length,
    avgCoupling: limited.length > 0
      ? Math.round((limited.reduce((s, p) => s + p.couplingScore, 0) / limited.length) * 1000) / 1000
      : 0,
    crossDirectoryPairs: limited.filter((p) => p.crossDirectory).length,
  };

  return {
    nodes,
    edges: limited,
    summary,
  };
}

/**
 * Get files most coupled to a specific file.
 */
export function getFileCoupling(repoId, filePath, { minCoChanges = 1 } = {}) {
  const db = getDb();

  // Get all commits that changed this file
  const commitIds = db.prepare(`
    SELECT DISTINCT fc.commit_id
    FROM file_changes fc
    WHERE fc.repo_id = ? AND fc.file_path = ?
  `).all(repoId, filePath).map((r) => r.commit_id);

  if (commitIds.length === 0) return { file_path: filePath, coupled: [] };

  // Get all files that appeared in those commits
  const placeholders = commitIds.map(() => '?').join(',');
  const coFiles = db.prepare(`
    SELECT fc.file_path, COUNT(DISTINCT fc.commit_id) as co_changes
    FROM file_changes fc
    WHERE fc.commit_id IN (${placeholders}) AND fc.file_path != ? AND fc.repo_id = ?
    GROUP BY fc.file_path
    HAVING co_changes >= ?
    ORDER BY co_changes DESC
  `).all(...commitIds, filePath, repoId, minCoChanges);

  const totalChanges = commitIds.length;

  const coupled = coFiles.map((f) => ({
    file_path: f.file_path,
    co_changes: f.co_changes,
    coupling_score: Math.round((f.co_changes / totalChanges) * 1000) / 1000,
    directory: getDirectory(f.file_path),
    cross_directory: getDirectory(f.file_path) !== getDirectory(filePath),
  }));

  return { file_path: filePath, total_changes: totalChanges, coupled };
}

// ── Helpers ──

function getDirectory(filePath) {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}
