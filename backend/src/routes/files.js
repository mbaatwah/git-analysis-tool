import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../utils/errors.js';
import { getFileStats, getRepo } from '../db/queries.js';

const router = Router();

// GET /api/files?repoId=1&startDate=...&endDate=...&directory=...
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { repoId, startDate, endDate, directory } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const files = getFileStats(Number(repoId), {
      startDate,
      endDate,
      directory,
    });

    res.json({
      repoId: Number(repoId),
      totalFiles: files.length,
      files,
    });
  })
);

export default router;
