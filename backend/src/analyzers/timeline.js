import { getDb } from '../db/schema.js';

/**
 * Get all commits in chronological order for the scrubber.
 */
export function getCommitList(repoId) {
  const db = getDb();

  const commits = db.prepare(`
    SELECT id, hash, author_name, message, date
    FROM commits
    WHERE repo_id = ?
    ORDER BY date ASC
  `).all(repoId);

  return commits.map((c, index) => ({
    index,
    id: c.id,
    hash: c.hash.slice(0, 7),
    author: c.author_name,
    message: c.message,
    date: c.date,
  }));
}

/**
 * Get codebase snapshot up to a specific commit index.
 * Returns cumulative file stats (same shape as churn files) so the treemap can render it.
 */
/**
 * Get distinct directories from all file changes for a repo.
 */
export function getDirectoryTree(repoId) {
  const db = getDb();

  const rows = db.prepare(`
    SELECT DISTINCT file_path FROM file_changes WHERE repo_id = ?
  `).all(repoId);

  const dirs = new Set();
  for (const row of rows) {
    const parts = row.file_path.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }

  return Array.from(dirs).sort();
}

export function getSnapshotAtCommit(repoId, commitIndex, { directory } = {}) {
  const db = getDb();

  // Get all commit IDs up to and including the given index
  const allCommits = db.prepare(`
    SELECT id, hash, author_name, message, date
    FROM commits
    WHERE repo_id = ?
    ORDER BY date ASC
  `).all(repoId);

  if (commitIndex < 0 || commitIndex >= allCommits.length) {
    return { commit: null, files: [], summary: {} };
  }

  const currentCommit = allCommits[commitIndex];
  const commitIds = allCommits.slice(0, commitIndex + 1).map((c) => c.id);
  const placeholders = commitIds.map(() => '?').join(',');

  // Cumulative file stats up to this commit
  const dirFilter = directory ? `AND fc.file_path LIKE '${directory}/%'` : '';
  const files = db.prepare(`
    SELECT
      fc.file_path,
      COUNT(DISTINCT fc.commit_id) as change_count,
      SUM(fc.insertions) as total_insertions,
      SUM(fc.deletions) as total_deletions,
      SUM(fc.insertions + fc.deletions) as total_lines_changed,
      MAX(c.date) as last_changed,
      MIN(c.date) as first_changed,
      COUNT(DISTINCT c.author_name) as author_count
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE fc.commit_id IN (${placeholders}) AND fc.repo_id = ? ${dirFilter}
    GROUP BY fc.file_path
    ORDER BY total_lines_changed DESC
  `).all(...commitIds, repoId);

  // Which files changed in THIS specific commit (for highlighting)
  const changedInCurrent = db.prepare(`
    SELECT file_path, insertions, deletions
    FROM file_changes
    WHERE commit_id = ? AND repo_id = ? ${directory ? `AND file_path LIKE '${directory}/%'` : ''}
  `).all(currentCommit.id, repoId);

  const changedSet = new Set(changedInCurrent.map((f) => f.file_path));

  // Add churn_score and changed flag to each file
  const enriched = files.map((f) => {
    const age = Math.max(1, Math.ceil(
      (new Date(currentCommit.date) - new Date(f.first_changed)) / (1000 * 60 * 60 * 24)
    ));
    const churnScore = Math.round(
      (f.total_lines_changed / Math.sqrt(age)) * (1 + Math.log(f.change_count)) * 100
    ) / 100;

    return {
      ...f,
      churn_score: churnScore,
      changedInThisCommit: changedSet.has(f.file_path),
      directory: getDirectory(f.file_path),
      extension: getExtension(f.file_path),
    };
  });

  return {
    commit: {
      index: commitIndex,
      id: currentCommit.id,
      hash: currentCommit.hash.slice(0, 7),
      author: currentCommit.author_name,
      message: currentCommit.message,
      date: currentCommit.date,
    },
    totalCommits: allCommits.length,
    filesInCommit: changedInCurrent,
    files: enriched,
    summary: {
      totalFiles: enriched.length,
      totalAuthors: new Set(allCommits.slice(0, commitIndex + 1).map((c) => c.author_name)).size,
      commitsSoFar: commitIndex + 1,
    },
  };
}

function getDirectory(filePath) {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

function getExtension(filePath) {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts.pop() : '';
}
