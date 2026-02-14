import { getDb } from '../db/schema.js';

/**
 * Get ownership analysis for all files in a repo.
 * Per-file: primary author, author contributions (commits, lines), bus factor.
 */
export function getOwnershipAnalysis(repoId, { startDate, endDate, directory } = {}) {
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
    params.push(`${directory}/%`);
  }

  const where = conditions.join(' AND ');

  // Per-file, per-author stats
  const rows = db.prepare(`
    SELECT
      fc.file_path,
      c.author_name,
      COUNT(DISTINCT fc.commit_id) as commits,
      SUM(fc.insertions) as insertions,
      SUM(fc.deletions) as deletions,
      SUM(fc.insertions + fc.deletions) as lines_changed,
      MAX(c.date) as last_commit_date
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE ${where}
    GROUP BY fc.file_path, c.author_name
    ORDER BY fc.file_path, lines_changed DESC
  `).all(...params);

  // Group by file
  const fileMap = new Map();
  for (const row of rows) {
    if (!fileMap.has(row.file_path)) {
      fileMap.set(row.file_path, []);
    }
    fileMap.get(row.file_path).push({
      author: row.author_name,
      commits: row.commits,
      insertions: row.insertions,
      deletions: row.deletions,
      lines_changed: row.lines_changed,
      last_commit_date: row.last_commit_date,
    });
  }

  // Build file ownership records
  const files = [];
  const authorTotals = new Map(); // global author stats
  let busFactorRiskCount = 0;

  for (const [filePath, authors] of fileMap) {
    const totalLines = authors.reduce((s, a) => s + a.lines_changed, 0);
    const totalCommits = authors.reduce((s, a) => s + a.commits, 0);

    // Primary author = most lines changed
    const primary = authors[0];
    const primaryOwnership = totalLines > 0
      ? Math.round((primary.lines_changed / totalLines) * 100)
      : 0;

    const busFactor = authors.length;
    const isBusFactorRisk = busFactor === 1;
    if (isBusFactorRisk) busFactorRiskCount++;

    // Ownership concentration (Herfindahl index — higher = more concentrated)
    const concentration = totalLines > 0
      ? Math.round(
          authors.reduce((sum, a) => {
            const share = a.lines_changed / totalLines;
            return sum + share * share;
          }, 0) * 100
        )
      : 0;

    files.push({
      file_path: filePath,
      directory: getDirectory(filePath),
      primary_author: primary.author,
      primary_ownership_pct: primaryOwnership,
      bus_factor: busFactor,
      bus_factor_risk: isBusFactorRisk,
      concentration, // 100 = one author owns everything, lower = more distributed
      total_commits: totalCommits,
      total_lines_changed: totalLines,
      authors: authors.map((a) => ({
        ...a,
        ownership_pct: totalLines > 0 ? Math.round((a.lines_changed / totalLines) * 100) : 0,
      })),
    });

    // Accumulate global author stats
    for (const a of authors) {
      const existing = authorTotals.get(a.author) || { commits: 0, lines_changed: 0, files: 0 };
      existing.commits += a.commits;
      existing.lines_changed += a.lines_changed;
      existing.files += 1;
      authorTotals.set(a.author, existing);
    }
  }

  // Sort by concentration (most concentrated first — highest risk)
  files.sort((a, b) => b.concentration - a.concentration);

  // Global author summary
  const authors = Array.from(authorTotals.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.lines_changed - a.lines_changed);

  return {
    files,
    authors,
    summary: {
      totalFiles: files.length,
      totalAuthors: authors.length,
      busFactorRiskFiles: busFactorRiskCount,
      busFactorRiskPct: files.length > 0
        ? Math.round((busFactorRiskCount / files.length) * 100)
        : 0,
      avgConcentration: files.length > 0
        ? Math.round(files.reduce((s, f) => s + f.concentration, 0) / files.length)
        : 0,
    },
  };
}

function getDirectory(filePath) {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}
