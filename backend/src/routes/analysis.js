import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../utils/errors.js';
import { getRepo } from '../db/queries.js';
import { getChurnAnalysis, getChurnByDirectory, getFileChurnHistory } from '../analyzers/churn.js';
import { getCouplingAnalysis, getFileCoupling } from '../analyzers/coupling.js';
import { getCommitList, getSnapshotAtCommit, getDirectoryTree } from '../analyzers/timeline.js';

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

// GET /api/analysis/coupling?repoId=1&minCoupling=0.3&minCoChanges=2&directory=...&startDate=...&endDate=...&limit=...
router.get(
  '/coupling',
  asyncHandler(async (req, res) => {
    const { repoId, startDate, endDate, directory, minCoupling, minCoChanges, limit } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getCouplingAnalysis(Number(repoId), {
      startDate,
      endDate,
      directory,
      minCoupling: minCoupling != null ? Number(minCoupling) : undefined,
      minCoChanges: minCoChanges != null ? Number(minCoChanges) : undefined,
      limit: limit != null ? Number(limit) : undefined,
    });

    res.json({
      repoId: Number(repoId),
      filters: { startDate, endDate, directory, minCoupling, minCoChanges },
      ...result,
    });
  })
);

// GET /api/analysis/coupling/file?repoId=1&filePath=src/server.js
router.get(
  '/coupling/file',
  asyncHandler(async (req, res) => {
    const { repoId, filePath, minCoChanges } = req.query;

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

    const result = getFileCoupling(Number(repoId), filePath, {
      minCoChanges: minCoChanges != null ? Number(minCoChanges) : undefined,
    });

    res.json({
      repoId: Number(repoId),
      ...result,
    });
  })
);

// GET /api/analysis/commits?repoId=1
router.get(
  '/commits',
  asyncHandler(async (req, res) => {
    const { repoId } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const commits = getCommitList(Number(repoId));
    res.json({ repoId: Number(repoId), commits });
  })
);

// GET /api/analysis/snapshot?repoId=1&commitIndex=5
router.get(
  '/snapshot',
  asyncHandler(async (req, res) => {
    const { repoId, commitIndex } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }
    if (commitIndex == null) {
      throw new ValidationError('commitIndex query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const { directory } = req.query;
    const result = getSnapshotAtCommit(Number(repoId), Number(commitIndex), { directory });
    res.json({ repoId: Number(repoId), ...result });
  })
);

// GET /api/analysis/directories?repoId=1
router.get(
  '/directories',
  asyncHandler(async (req, res) => {
    const { repoId } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const directories = getDirectoryTree(Number(repoId));
    res.json({ repoId: Number(repoId), directories });
  })
);

export default router;
