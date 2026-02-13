import { getDb } from './schema.js';

// ── Repos ──

export function upsertRepo(repoPath, name) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO repos (path, name) VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET name = excluded.name
  `);
  stmt.run(repoPath, name);
  return db.prepare('SELECT * FROM repos WHERE path = ?').get(repoPath);
}

export function getRepo(repoId) {
  return getDb().prepare('SELECT * FROM repos WHERE id = ?').get(repoId);
}

export function getRepoByPath(repoPath) {
  return getDb().prepare('SELECT * FROM repos WHERE path = ?').get(repoPath);
}

export function updateRepoSyncStatus(repoId, totalCommits) {
  getDb().prepare(`
    UPDATE repos SET last_synced_at = datetime('now'), total_commits = ? WHERE id = ?
  `).run(totalCommits, repoId);
}

// ── Commits ──

export function insertCommitsBatch(commits) {
  const db = getDb();
  const insertCommit = db.prepare(`
    INSERT OR IGNORE INTO commits (repo_id, hash, author_name, author_email, date, message, insertions, deletions, files_changed)
    VALUES (@repo_id, @hash, @author_name, @author_email, @date, @message, @insertions, @deletions, @files_changed)
  `);
  const insertFileChange = db.prepare(`
    INSERT INTO file_changes (commit_id, repo_id, file_path, insertions, deletions, is_binary)
    VALUES (@commit_id, @repo_id, @file_path, @insertions, @deletions, @is_binary)
  `);

  const transaction = db.transaction((commits) => {
    let count = 0;
    for (const commit of commits) {
      const result = insertCommit.run(commit);
      if (result.changes > 0) {
        count++;
        const commitId = result.lastInsertRowid;
        for (const file of commit.files) {
          insertFileChange.run({
            commit_id: commitId,
            repo_id: commit.repo_id,
            file_path: file.file_path,
            insertions: file.insertions,
            deletions: file.deletions,
            is_binary: file.is_binary ? 1 : 0,
          });
        }
      }
    }
    return count;
  });

  return transaction(commits);
}

export function getCommits(repoId, { page = 1, limit = 50, author, startDate, endDate } = {}) {
  const db = getDb();
  const conditions = ['c.repo_id = ?'];
  const params = [repoId];

  if (author) {
    conditions.push('c.author_name LIKE ?');
    params.push(`%${author}%`);
  }
  if (startDate) {
    conditions.push('c.date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('c.date <= ?');
    params.push(endDate);
  }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) as count FROM commits c WHERE ${where}`).get(...params).count;
  const rows = db.prepare(`
    SELECT c.* FROM commits c WHERE ${where} ORDER BY c.date DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return { commits: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function getCommitWithFiles(commitId) {
  const db = getDb();
  const commit = db.prepare('SELECT * FROM commits WHERE id = ?').get(commitId);
  if (!commit) return null;

  const files = db.prepare('SELECT * FROM file_changes WHERE commit_id = ?').all(commitId);
  return { ...commit, files };
}

// ── Files ──

export function getFileStats(repoId, { startDate, endDate, directory } = {}) {
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
    ORDER BY change_count DESC
  `).all(...params);

  return rows;
}

export function getLastCommitHash(repoId) {
  const row = getDb().prepare(
    'SELECT hash FROM commits WHERE repo_id = ? ORDER BY date DESC LIMIT 1'
  ).get(repoId);
  return row ? row.hash : null;
}
