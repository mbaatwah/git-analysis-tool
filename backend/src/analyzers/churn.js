import { getDb } from '../db/schema.js';

/**
 * Compute churn score for each file in a repo.
 * Formula: change_count * log(total_lines_changed + 1)
 * This balances frequency (how often a file changes) with magnitude (how much changes).
 */
export function getChurnAnalysis(repoId, { startDate, endDate, directory, minScore, limit, sortBy = 'churn_score' } = {}) {
  const db = getDb();
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

  const rows = db.prepare(`
    SELECT
      fc.file_path,
      COUNT(DISTINCT fc.commit_id) as change_count,
      SUM(fc.insertions) as total_insertions,
      SUM(fc.deletions) as total_deletions,
      SUM(fc.insertions + fc.deletions) as total_lines_changed,
      MIN(c.date) as first_changed,
      MAX(c.date) as last_changed,
      COUNT(DISTINCT c.author_name) as author_count
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE ${where}
    GROUP BY fc.file_path
  `).all(...params);

  // Compute churn scores and derived metrics
  const scored = rows.map((row) => {
    const churnScore = row.change_count * Math.log(row.total_lines_changed + 1);
    const daySpan = getDaysBetween(row.first_changed, row.last_changed);
    const changeRate = daySpan > 0 ? row.change_count / daySpan : row.change_count;

    // Determine directory path for grouping
    const parts = row.file_path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const ext = getExtension(row.file_path);

    return {
      file_path: row.file_path,
      directory: dir,
      extension: ext,
      change_count: row.change_count,
      total_insertions: row.total_insertions,
      total_deletions: row.total_deletions,
      total_lines_changed: row.total_lines_changed,
      churn_score: Math.round(churnScore * 100) / 100,
      change_rate: Math.round(changeRate * 1000) / 1000,
      first_changed: row.first_changed,
      last_changed: row.last_changed,
      author_count: row.author_count,
      days_active: daySpan,
    };
  });

  // Filter by minimum score
  let filtered = scored;
  if (minScore != null) {
    filtered = filtered.filter((f) => f.churn_score >= minScore);
  }

  // Sort
  const sortFields = {
    churn_score: (a, b) => b.churn_score - a.churn_score,
    change_count: (a, b) => b.change_count - a.change_count,
    total_lines_changed: (a, b) => b.total_lines_changed - a.total_lines_changed,
    change_rate: (a, b) => b.change_rate - a.change_rate,
    last_changed: (a, b) => new Date(b.last_changed) - new Date(a.last_changed),
  };

  const sortFn = sortFields[sortBy] || sortFields.churn_score;
  filtered.sort(sortFn);

  // Apply limit
  if (limit != null) {
    filtered = filtered.slice(0, limit);
  }

  // Compute summary stats
  const summary = computeSummary(filtered);

  return { files: filtered, summary };
}

/**
 * Get churn aggregated by directory.
 */
export function getChurnByDirectory(repoId, { startDate, endDate, depth = 1 } = {}) {
  const { files } = getChurnAnalysis(repoId, { startDate, endDate });

  const dirMap = new Map();

  for (const file of files) {
    const parts = file.file_path.split('/');
    const dirParts = parts.slice(0, Math.min(depth, parts.length - 1));
    const dir = dirParts.length > 0 ? dirParts.join('/') : '.';

    if (!dirMap.has(dir)) {
      dirMap.set(dir, {
        directory: dir,
        file_count: 0,
        total_change_count: 0,
        total_insertions: 0,
        total_deletions: 0,
        total_lines_changed: 0,
        total_churn_score: 0,
        authors: new Set(),
      });
    }

    const entry = dirMap.get(dir);
    entry.file_count++;
    entry.total_change_count += file.change_count;
    entry.total_insertions += file.total_insertions;
    entry.total_deletions += file.total_deletions;
    entry.total_lines_changed += file.total_lines_changed;
    entry.total_churn_score += file.churn_score;
  }

  const directories = Array.from(dirMap.values())
    .map((d) => ({
      ...d,
      total_churn_score: Math.round(d.total_churn_score * 100) / 100,
      authors: undefined,
    }))
    .sort((a, b) => b.total_churn_score - a.total_churn_score);

  return { directories };
}

/**
 * Get churn history for a single file over time (bucketed by month).
 */
export function getFileChurnHistory(repoId, filePath) {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      strftime('%Y-%m', c.date) as month,
      COUNT(*) as change_count,
      SUM(fc.insertions) as insertions,
      SUM(fc.deletions) as deletions,
      GROUP_CONCAT(DISTINCT c.author_name) as authors
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE fc.repo_id = ? AND fc.file_path = ?
    GROUP BY month
    ORDER BY month ASC
  `).all(repoId, filePath);

  const history = rows.map((r) => ({
    month: r.month,
    change_count: r.change_count,
    insertions: r.insertions,
    deletions: r.deletions,
    authors: r.authors.split(','),
  }));

  return { file_path: filePath, history };
}

// ── Helpers ──

function getDaysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const diff = Math.abs(b - a);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getExtension(filePath) {
  const dot = filePath.lastIndexOf('.');
  return dot !== -1 ? filePath.slice(dot + 1) : '';
}

function computeSummary(files) {
  if (files.length === 0) {
    return { totalFiles: 0, avgChurnScore: 0, maxChurnScore: 0, totalChanges: 0 };
  }

  const totalChanges = files.reduce((sum, f) => sum + f.change_count, 0);
  const totalChurn = files.reduce((sum, f) => sum + f.churn_score, 0);
  const maxChurn = Math.max(...files.map((f) => f.churn_score));

  return {
    totalFiles: files.length,
    avgChurnScore: Math.round((totalChurn / files.length) * 100) / 100,
    maxChurnScore: Math.round(maxChurn * 100) / 100,
    totalChanges,
  };
}
