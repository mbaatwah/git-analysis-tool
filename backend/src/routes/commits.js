import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../utils/errors.js';
import { getCommits, getCommitWithFiles, getRepo } from '../db/queries.js';

const router = Router();

// GET /api/commits?repoId=1&page=1&limit=50&author=...&startDate=...&endDate=...
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { repoId, page, limit, author, startDate, endDate } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getCommits(Number(repoId), {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
      author,
      startDate,
      endDate,
    });

    res.json(result);
  })
);

// GET /api/commits/:id — Single commit with file changes
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const commit = getCommitWithFiles(Number(id));

    if (!commit) {
      throw new NotFoundError(`Commit with id ${id} not found`);
    }

    res.json(commit);
  })
);

export default router;
