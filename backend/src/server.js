import express from 'express';
import cors from 'cors';
import { errorHandler } from './utils/errors.js';
import { getDb, closeDb } from './db/schema.js';
import configRouter from './routes/config.js';
import commitsRouter from './routes/commits.js';
import filesRouter from './routes/files.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
getDb();
console.log('Database initialized');

// Routes
app.use('/api/config', configRouter);
app.use('/api/commits', commitsRouter);
app.use('/api/files', filesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Git Analysis backend running on http://localhost:${PORT}`);
});

export default app;
