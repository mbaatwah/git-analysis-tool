import { getDb } from '../db/schema.js';
import { getRepo } from '../db/queries.js';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

const TAB_SIZE = 4;
const MAX_FILES_PER_REQUEST = 500; // Limit to prevent timeouts
const CACHE_SIZE = 50; // Keep last 50 commit complexity results

// Simple LRU cache for complexity at commit
const complexityCache = new Map();

function getCacheKey(repoId, commitIndex, directory) {
  return `${repoId}:${commitIndex}:${directory || 'all'}`;
}

function getCached(repoId, commitIndex, directory) {
  const key = getCacheKey(repoId, commitIndex, directory);
  const cached = complexityCache.get(key);
  if (cached && Date.now() - cached.ts < 60000) { // 1 minute TTL
    // Move to end (LRU)
    complexityCache.delete(key);
    complexityCache.set(key, cached);
    return cached.data;
  }
  return null;
}

function setCached(repoId, commitIndex, directory, data) {
  const key = getCacheKey(repoId, commitIndex, directory);
  // Evict oldest if at capacity
  if (complexityCache.size >= CACHE_SIZE) {
    const firstKey = complexityCache.keys().next().value;
    complexityCache.delete(firstKey);
  }
  complexityCache.set(key, { data, ts: Date.now() });
}

/**
 * Calculate indentation-based complexity for a single file's content.
 * Returns: { lines, blankLines, commentLines, codeLines, totalIndent, avgIndent, maxIndent, complexity }
 */
function calcComplexity(content) {
  const rawLines = content.split('\n');
  const lines = rawLines.length;
  let blankLines = 0;
  let commentLines = 0;
  let codeLines = 0;
  let totalIndent = 0;
  let maxIndent = 0;
  let inBlockComment = false;

  for (const line of rawLines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      blankLines++;
      continue;
    }

    // Simple block comment tracking
    if (inBlockComment) {
      commentLines++;
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) inBlockComment = false;
      inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      commentLines++;
      continue;
    }

    codeLines++;

    // Calculate indentation: expand tabs to spaces, count leading spaces
    const expanded = line.replace(/\t/g, ' '.repeat(TAB_SIZE));
    const indent = expanded.length - expanded.trimStart().length;
    const logicalIndent = Math.floor(indent / TAB_SIZE);

    totalIndent += logicalIndent;
    if (logicalIndent > maxIndent) maxIndent = logicalIndent;
  }

  const avgIndent = codeLines > 0 ? Math.round((totalIndent / codeLines) * 100) / 100 : 0;
  // Complexity = total indentation / code lines (Tornhill's metric)
  const complexity = codeLines > 0 ? Math.round((totalIndent / codeLines) * 100) / 100 : 0;

  return {
    lines,
    blankLines,
    commentLines,
    codeLines,
    totalIndent,
    avgIndent,
    maxIndent,
    complexity,
  };
}

/**
 * Get complexity analysis for all current files in the repo.
 */
export function getComplexityAnalysis(repoId, { directory } = {}) {
  const repo = getRepo(repoId);
  if (!repo) return { files: [], summary: {} };

  const repoPath = repo.path;
  const db = getDb();

  // Get all known file paths from commits
  let dirFilter = '';
  const params = [repoId];
  if (directory) {
    dirFilter = `AND fc.file_path LIKE ?`;
    params.push(`${directory}/%`);
  }

  const fileRows = db.prepare(`
    SELECT DISTINCT fc.file_path
    FROM file_changes fc
    WHERE fc.repo_id = ? ${dirFilter}
    ORDER BY fc.file_path
  `).all(...params);

  const files = [];

  for (const row of fileRows) {
    const filePath = row.file_path;
    const fullPath = path.join(repoPath, filePath);

    // Only analyze files that still exist
    if (!fs.existsSync(fullPath)) continue;

    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) continue;
      // Skip binary / very large files
      if (stat.size > 500_000) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const metrics = calcComplexity(content);

      files.push({
        file_path: filePath,
        directory: getDirectory(filePath),
        extension: getExtension(filePath),
        size: stat.size,
        ...metrics,
      });
    } catch {
      // Skip files we can't read
    }
  }

  // Sort by complexity descending
  files.sort((a, b) => b.complexity - a.complexity);

  const totalFiles = files.length;
  const avgComplexity = totalFiles > 0
    ? Math.round(files.reduce((s, f) => s + f.complexity, 0) / totalFiles * 100) / 100
    : 0;
  const maxComplexity = totalFiles > 0 ? files[0].complexity : 0;
  const highComplexityFiles = files.filter((f) => f.complexity > 3).length;

  return {
    files,
    summary: {
      totalFiles,
      avgComplexity,
      maxComplexity,
      highComplexityFiles,
    },
  };
}

/**
 * Get file growth over time: how a specific file's lines and complexity changed across commits.
 * We reconstruct the file at each commit where it was changed using git show.
 */
export function getFileGrowth(repoId, filePath) {
  const repo = getRepo(repoId);
  if (!repo) return { filePath, history: [] };

  const db = getDb();

  // Get all commits where this file changed, in chronological order
  const commits = db.prepare(`
    SELECT
      c.hash,
      c.author_name,
      c.message,
      c.date,
      fc.insertions,
      fc.deletions
    FROM file_changes fc
    JOIN commits c ON c.id = fc.commit_id
    WHERE fc.repo_id = ? AND fc.file_path = ?
    ORDER BY c.date ASC
  `).all(repoId, filePath);

  if (commits.length === 0) return { filePath, history: [] };

  const history = [];

  for (const commit of commits) {
    try {
      const content = execSync(
        `git show ${commit.hash}:${filePath}`,
        { cwd: repo.path, encoding: 'utf-8', maxBuffer: 2_000_000, timeout: 5000 }
      );
      const metrics = calcComplexity(content);

      history.push({
        hash: commit.hash.slice(0, 7),
        author: commit.author_name,
        message: commit.message,
        date: commit.date,
        insertions: commit.insertions,
        deletions: commit.deletions,
        ...metrics,
      });
    } catch {
      // File might not exist at this commit (e.g., rename), skip
    }
  }

  return { filePath, history };
}

/**
 * Read current file content from disk.
 */
export function getFileContent(repoId, filePath) {
  const repo = getRepo(repoId);
  if (!repo) return { filePath, content: null, error: 'Repo not found' };

  const fullPath = path.join(repo.path, filePath);
  try {
    if (!fs.existsSync(fullPath)) return { filePath, content: null, error: 'File not found' };
    const stat = fs.statSync(fullPath);
    if (stat.size > 500_000) return { filePath, content: null, error: 'File too large' };
    const content = fs.readFileSync(fullPath, 'utf-8');
    const metrics = calcComplexity(content);
    return { filePath, content, ...metrics };
  } catch {
    return { filePath, content: null, error: 'Could not read file' };
  }
}

/**
 * Read file content at a specific commit hash using git show.
 */
export function getFileContentAtCommit(repoId, filePath, commitHash) {
  const repo = getRepo(repoId);
  if (!repo) return { filePath, content: null, error: 'Repo not found' };

  try {
    const content = execSync(
      `git show ${commitHash}:${filePath}`,
      { cwd: repo.path, encoding: 'utf-8', maxBuffer: 2_000_000, timeout: 5000 }
    );
    const metrics = calcComplexity(content);
    return { filePath, commitHash, content, ...metrics };
  } catch {
    return { filePath, commitHash, content: null, error: 'File not available at this commit' };
  }
}

/**
 * Get complexity analysis for all files as they existed at a specific commit index.
 * Uses git show to read each file at that commit - with caching and batch processing.
 */
export function getComplexityAtCommit(repoId, commitIndex, { directory } = {}) {
  const repo = getRepo(repoId);
  if (!repo) return { files: [], summary: {} };

  // Check cache first
  const cached = getCached(repoId, commitIndex, directory);
  if (cached) return cached;

  const db = getDb();

  // Get all commits in order
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

  // Get all files that existed up to this commit - LIMIT to prevent timeouts
  const dirFilter = directory ? `AND fc.file_path LIKE '${directory}/%'` : '';
  const fileRows = db.prepare(`
    SELECT DISTINCT fc.file_path
    FROM file_changes fc
    WHERE fc.commit_id IN (${placeholders}) AND fc.repo_id = ? ${dirFilter}
    ORDER BY fc.file_path
    LIMIT ${MAX_FILES_PER_REQUEST}
  `).all(...commitIds, repoId);

  // Batch process files using git cat-file --batch for much better performance
  const files = batchProcessFiles(repo.path, currentCommit.hash, fileRows);

  files.sort((a, b) => b.complexity - a.complexity);

  const totalFiles = files.length;
  const avgComplexity = totalFiles > 0
    ? Math.round(files.reduce((s, f) => s + f.complexity, 0) / totalFiles * 100) / 100
    : 0;
  const maxComplexity = totalFiles > 0 ? files[0].complexity : 0;
  const highComplexityFiles = files.filter((f) => f.complexity > 3).length;

  const result = {
    commit: {
      index: commitIndex,
      hash: currentCommit.hash.slice(0, 7),
      fullHash: currentCommit.hash,
      author: currentCommit.author_name,
      message: currentCommit.message,
      date: currentCommit.date,
    },
    files,
    summary: {
      totalFiles,
      avgComplexity,
      maxComplexity,
      highComplexityFiles,
    },
  };

  // Cache the result
  setCached(repoId, commitIndex, directory, result);
  return result;
}

/**
 * Batch process files using git cat-file --batch for much better performance
 * than individual git show commands.
 */
function batchProcessFiles(repoPath, commitHash, fileRows) {
  if (fileRows.length === 0) return [];

  const files = [];
  const batchSize = 50; // Process 50 files at a time

  for (let i = 0; i < fileRows.length; i += batchSize) {
    const batch = fileRows.slice(i, i + batchSize);
    const batchResults = processFileBatch(repoPath, commitHash, batch);
    files.push(...batchResults);
  }

  return files;
}

/**
 * Process a batch of files using a single git cat-file --batch command.
 */
function processFileBatch(repoPath, commitHash, fileBatch) {
  const results = [];

  // Build the batch input for git cat-file
  const batchInput = fileBatch
    .map(row => `${commitHash}:${row.file_path}`)
    .join('\n') + '\n';

  try {
    // Use git cat-file --batch to get multiple files in one go
    const gitProcess = spawn('git', ['cat-file', '--batch'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });

    gitProcess.stdin.write(batchInput);
    gitProcess.stdin.end();

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Wait for process to complete synchronously (we need results now)
    const buffer = execSync(
      `echo "${batchInput.replace(/"/g, '\\"')}" | git cat-file --batch`,
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 10_000_000, timeout: 10000 }
    );

    // Parse the batch output - git cat-file --batch returns entries separated by blob headers
    const entries = parseBatchOutput(buffer, fileBatch);
    results.push(...entries);

  } catch (err) {
    // Fallback to individual git show for this batch if batch fails
    for (const row of fileBatch) {
      try {
        const content = execSync(
          `git show ${commitHash}:${row.file_path}`,
          { cwd: repoPath, encoding: 'utf-8', maxBuffer: 2_000_000, timeout: 3000 }
        );
        const metrics = calcComplexity(content);
        results.push({
          file_path: row.file_path,
          directory: getDirectory(row.file_path),
          extension: getExtension(row.file_path),
          ...metrics,
        });
      } catch {
        // Skip files that don't exist at this commit
      }
    }
  }

  return results;
}

/**
 * Parse git cat-file --batch output into individual file contents.
 * Format: <commit:path> SP <type> SP <size> LF <content> LF
 */
function parseBatchOutput(output, fileBatch) {
  const results = [];
  let cursor = 0;

  for (const row of fileBatch) {
    // Find the header line
    const headerEnd = output.indexOf('\n', cursor);
    if (headerEnd === -1) break;

    const header = output.slice(cursor, headerEnd);
    const match = header.match(/^\S+ blob (\d+)$/);
    if (!match) {
      // Not a blob (possibly "missing" or other), skip
      cursor = headerEnd + 1;
      continue;
    }

    const size = parseInt(match[1]);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;

    if (contentEnd > output.length) break;

    const content = output.slice(contentStart, contentEnd);
    cursor = contentEnd + 1; // Skip the trailing newline

    // Skip if too large
    if (size > 500_000) continue;

    const metrics = calcComplexity(content);
    results.push({
      file_path: row.file_path,
      directory: getDirectory(row.file_path),
      extension: getExtension(row.file_path),
      ...metrics,
    });
  }

  return results;
}

/**
 * Get the diff for a file at a specific commit (what changed in that commit).
 * Uses git show to get the patch for that specific commit.
 */
export function getFileDiffAtCommit(repoId, filePath, commitHash) {
  const repo = getRepo(repoId);
  if (!repo) return { filePath, commitHash, diff: null, error: 'Repo not found' };

  try {
    // Get the diff for this specific commit - much faster than fetching two full files
    const diffOutput = execSync(
      `git show ${commitHash} --format="" --no-color -- ${filePath}`,
      { cwd: repo.path, encoding: 'utf-8', maxBuffer: 2_000_000, timeout: 3000 }
    );

    // Parse the diff to extract additions/deletions
    const lines = diffOutput.split('\n');
    let additions = 0;
    let deletions = 0;
    const diffLines = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      diffLines.push(line);
    }

    return {
      filePath,
      commitHash,
      diff: {
        additions,
        deletions,
        diffContent: diffOutput,
        changedLines: diffLines.filter(l => l.startsWith('@@')).map(l => {
          // Parse hunk header like @@ -1,5 +1,7 @@
          const match = l.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
          if (match) {
            return {
              oldStart: parseInt(match[1]),
              oldCount: parseInt(match[2] || '1'),
              newStart: parseInt(match[3]),
              newCount: parseInt(match[4] || '1'),
            };
          }
          return null;
        }).filter(Boolean),
      },
    };
  } catch (err) {
    return { filePath, commitHash, diff: null, error: 'Could not get diff for this commit' };
  }
}

function getDirectory(filePath) {
  const parts = filePath.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
}

function getExtension(filePath) {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts.pop() : '';
}
