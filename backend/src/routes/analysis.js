import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../utils/errors.js';
import { getRepo } from '../db/queries.js';
import { getChurnAnalysis, getChurnByDirectory, getFileChurnHistory } from '../analyzers/churn.js';

const router = Router();

// GET /api/analysis/churn?repoId=1&startDate=...&endDate=...&directory=...&minScore=...&limit=...&sortBy=...
router.get(
  '/churn',
  asyncHandler(async (req, res) => {
    const { repoId, startDate, endDate, directory, minScore, limit, sortBy } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getChurnAnalysis(Number(repoId), {
      startDate,
      endDate,
      directory,
      minScore: minScore != null ? Number(minScore) : undefined,
      limit: limit != null ? Number(limit) : undefined,
      sortBy,
    });

    res.json({
      repoId: Number(repoId),
      filters: { startDate, endDate, directory, minScore, sortBy },
      ...result,
    });
  })
);

// GET /api/analysis/churn/directories?repoId=1&depth=1&startDate=...&endDate=...
router.get(
  '/churn/directories',
  asyncHandler(async (req, res) => {
    const { repoId, depth, startDate, endDate } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getChurnByDirectory(Number(repoId), {
      startDate,
      endDate,
      depth: depth != null ? Number(depth) : 1,
    });

    res.json({
      repoId: Number(repoId),
      ...result,
    });
  })
);

// GET /api/analysis/churn/file?repoId=1&filePath=src/server.js
router.get(
  '/churn/file',
  asyncHandler(async (req, res) => {
    const { repoId, filePath } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }
    if (!filePath) {
      throw new ValidationError('filePath query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getFileChurnHistory(Number(repoId), filePath);

    res.json({
      repoId: Number(repoId),
      ...result,
    });
  })
);

export default router;
