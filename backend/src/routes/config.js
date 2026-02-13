import { Router } from 'express';
import { asyncHandler, ValidationError } from '../utils/errors.js';
import { extractRepo, getRepoInfo, validateRepoPath } from '../extractors/gitExtractor.js';
import { getRepoByPath } from '../db/queries.js';

const router = Router();

// POST /api/config/repo — Set and sync a repository
router.post(
  '/repo',
  asyncHandler(async (req, res) => {
    const { path: repoPath } = req.body;

    if (!repoPath || typeof repoPath !== 'string') {
      throw new ValidationError('Repository path is required');
    }

    const absPath = await validateRepoPath(repoPath);
    const info = await getRepoInfo(absPath);

    const { repo, newCommits } = await extractRepo(absPath, (progress) => {
      // Progress could be sent via SSE/WebSocket in the future
      console.log(`Sync progress: ${progress.processed}/${progress.total} commits processed`);
    });

    res.json({
      repo: {
        id: repo.id,
        path: repo.path,
        name: repo.name,
        totalCommits: repo.total_commits,
        lastSyncedAt: repo.last_synced_at,
      },
      info,
      newCommits,
    });
  })
);

// GET /api/config/repo — Get current repo status
router.get(
  '/repo',
  asyncHandler(async (req, res) => {
    const { path: repoPath } = req.query;

    if (!repoPath) {
      throw new ValidationError('Repository path query parameter is required');
    }

    const repo = getRepoByPath(repoPath);
    if (!repo) {
      return res.json({ repo: null, synced: false });
    }

    const info = await getRepoInfo(repoPath);

    res.json({
      repo: {
        id: repo.id,
        path: repo.path,
        name: repo.name,
        totalCommits: repo.total_commits,
        lastSyncedAt: repo.last_synced_at,
      },
      info,
      synced: true,
    });
  })
);

export default router;
