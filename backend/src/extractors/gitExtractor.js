import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs';
import { upsertRepo, updateRepoSyncStatus, insertCommitsBatch, getLastCommitHash } from '../db/queries.js';

const BATCH_SIZE = 500;

export async function validateRepoPath(repoPath) {
  const absPath = path.resolve(repoPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Path does not exist: ${absPath}`);
  }

  const git = simpleGit(absPath);
  const isRepo = await git.checkIsRepo();

  if (!isRepo) {
    throw new Error(`Not a git repository: ${absPath}`);
  }

  return absPath;
}

export async function extractRepo(repoPath, onProgress) {
  const absPath = await validateRepoPath(repoPath);
  const repoName = path.basename(absPath);
  const repo = upsertRepo(absPath, repoName);
  const git = simpleGit(absPath);

  const lastHash = getLastCommitHash(repo.id);

  const logArgs = [
    '--all',
    '--numstat',
    '--format=COMMIT_START%n%H%n%aN%n%aE%n%aI%n%s',
  ];

  if (lastHash) {
    logArgs.push(`${lastHash}..HEAD`);
  }

  const logResult = await git.raw(['log', ...logArgs]);

  if (!logResult || logResult.trim() === '') {
    updateRepoSyncStatus(repo.id, repo.total_commits || 0);
    return { repo, newCommits: 0 };
  }

  const commits = parseGitLog(logResult, repo.id);

  let totalInserted = 0;
  for (let i = 0; i < commits.length; i += BATCH_SIZE) {
    const batch = commits.slice(i, i + BATCH_SIZE);
    const inserted = insertCommitsBatch(batch);
    totalInserted += inserted;

    if (onProgress) {
      onProgress({
        processed: Math.min(i + BATCH_SIZE, commits.length),
        total: commits.length,
        inserted: totalInserted,
      });
    }
  }

  const newTotal = (repo.total_commits || 0) + totalInserted;
  updateRepoSyncStatus(repo.id, newTotal);

  return { repo: { ...repo, total_commits: newTotal }, newCommits: totalInserted };
}

function parseGitLog(logOutput, repoId) {
  const commits = [];
  const blocks = logOutput.split('COMMIT_START\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 5) continue;

    const [hash, authorName, authorEmail, date, message, ...fileLines] = lines;

    const files = [];
    let totalInsertions = 0;
    let totalDeletions = 0;

    for (const line of fileLines) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const [ins, del, filePath] = parts;
      const isBinary = ins === '-' && del === '-';
      const insertions = isBinary ? 0 : parseInt(ins, 10) || 0;
      const deletions = isBinary ? 0 : parseInt(del, 10) || 0;

      files.push({
        file_path: filePath,
        insertions,
        deletions,
        is_binary: isBinary,
      });

      totalInsertions += insertions;
      totalDeletions += deletions;
    }

    commits.push({
      repo_id: repoId,
      hash,
      author_name: authorName,
      author_email: authorEmail,
      date,
      message: message || '(no message)',
      insertions: totalInsertions,
      deletions: totalDeletions,
      files_changed: files.length,
      files,
    });
  }

  return commits;
}

export async function getRepoInfo(repoPath) {
  const absPath = await validateRepoPath(repoPath);
  const git = simpleGit(absPath);

  const [branchSummary, remotes] = await Promise.all([
    git.branch(),
    git.getRemotes(true),
  ]);

  return {
    path: absPath,
    name: path.basename(absPath),
    currentBranch: branchSummary.current,
    branches: branchSummary.all,
    remotes: remotes.map((r) => ({ name: r.name, url: r.refs.fetch })),
  };
}
