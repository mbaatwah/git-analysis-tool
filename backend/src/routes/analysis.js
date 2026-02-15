import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../utils/errors.js';
import { getRepo } from '../db/queries.js';
import { getChurnAnalysis, getChurnByDirectory, getFileChurnHistory } from '../analyzers/churn.js';
import { getCouplingAnalysis, getFileCoupling } from '../analyzers/coupling.js';
import { getCommitList, getSnapshotAtCommit, getDirectoryTree } from '../analyzers/timeline.js';
import { getOwnershipAnalysis } from '../analyzers/ownership.js';
import { getComplexityAnalysis, getFileGrowth, getFileContent, getFileContentAtCommit, getComplexityAtCommit, getFileDiffAtCommit } from '../analyzers/complexity.js';

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

// GET /api/analysis/ownership?repoId=1&directory=...&startDate=...&endDate=...
router.get(
  '/ownership',
  asyncHandler(async (req, res) => {
    const { repoId, startDate, endDate, directory } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getOwnershipAnalysis(Number(repoId), {
      startDate,
      endDate,
      directory,
    });

    res.json({
      repoId: Number(repoId),
      filters: { startDate, endDate, directory },
      ...result,
    });
  })
);

// GET /api/analysis/complexity?repoId=1&directory=...
router.get(
  '/complexity',
  asyncHandler(async (req, res) => {
    const { repoId, directory } = req.query;

    if (!repoId) {
      throw new ValidationError('repoId query parameter is required');
    }

    const repo = getRepo(Number(repoId));
    if (!repo) {
      throw new NotFoundError(`Repository with id ${repoId} not found`);
    }

    const result = getComplexityAnalysis(Number(repoId), { directory });
    res.json({ repoId: Number(repoId), ...result });
  })
);

// GET /api/analysis/complexity/file?repoId=1&filePath=src/server.js
router.get(
  '/complexity/file',
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

    const result = getFileGrowth(Number(repoId), filePath);
    res.json({ repoId: Number(repoId), ...result });
  })
);

// GET /api/analysis/complexity/content?repoId=1&filePath=src/server.js
router.get(
  '/complexity/content',
  asyncHandler(async (req, res) => {
    const { repoId, filePath } = req.query;

    if (!repoId) throw new ValidationError('repoId query parameter is required');
    if (!filePath) throw new ValidationError('filePath query parameter is required');

    const repo = getRepo(Number(repoId));
    if (!repo) throw new NotFoundError(`Repository with id ${repoId} not found`);

    const result = getFileContent(Number(repoId), filePath);
    res.json({ repoId: Number(repoId), ...result });
  })
);

// GET /api/analysis/complexity/content-at?repoId=1&filePath=src/server.js&commitHash=abc1234
router.get(
  '/complexity/content-at',
  asyncHandler(async (req, res) => {
    const { repoId, filePath, commitHash } = req.query;

    if (!repoId) throw new ValidationError('repoId query parameter is required');
    if (!filePath) throw new ValidationError('filePath query parameter is required');
    if (!commitHash) throw new ValidationError('commitHash query parameter is required');

    const repo = getRepo(Number(repoId));
    if (!repo) throw new NotFoundError(`Repository with id ${repoId} not found`);

    const result = getFileContentAtCommit(Number(repoId), filePath, commitHash);
    res.json({ repoId: Number(repoId), ...result });
  })
);

// GET /api/analysis/complexity/at-commit?repoId=1&commitIndex=5&directory=...
router.get(
  '/complexity/at-commit',
  asyncHandler(async (req, res) => {
    const { repoId, commitIndex, directory } = req.query;

    if (!repoId) throw new ValidationError('repoId query parameter is required');
    if (commitIndex == null) throw new ValidationError('commitIndex query parameter is required');

    const repo = getRepo(Number(repoId));
    if (!repo) throw new NotFoundError(`Repository with id ${repoId} not found`);

    const result = getComplexityAtCommit(Number(repoId), Number(commitIndex), { directory });
    res.json({ repoId: Number(repoId), ...result });
  })
);

// GET /api/analysis/complexity/diff?repoId=1&filePath=src/server.js&commitHash=abc1234
router.get(
  '/complexity/diff',
  asyncHandler(async (req, res) => {
    const { repoId, filePath, commitHash } = req.query;

    if (!repoId) throw new ValidationError('repoId query parameter is required');
    if (!filePath) throw new ValidationError('filePath query parameter is required');
    if (!commitHash) throw new ValidationError('commitHash query parameter is required');

    const repo = getRepo(Number(repoId));
    if (!repo) throw new NotFoundError(`Repository with id ${repoId} not found`);

    const result = getFileDiffAtCommit(Number(repoId), filePath, commitHash);
    res.json({ repoId: Number(repoId), ...result });
  })
);

export default router;
