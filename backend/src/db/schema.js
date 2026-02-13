import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'git-analysis.db');

let db = null;

export function getDb() {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      last_synced_at TEXT,
      total_commits INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      hash TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_email TEXT NOT NULL,
      date TEXT NOT NULL,
      message TEXT NOT NULL,
      insertions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      files_changed INTEGER DEFAULT 0,
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
      UNIQUE(repo_id, hash)
    );

    CREATE TABLE IF NOT EXISTS file_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commit_id INTEGER NOT NULL,
      repo_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      insertions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0,
      is_binary INTEGER DEFAULT 0,
      FOREIGN KEY (commit_id) REFERENCES commits(id) ON DELETE CASCADE,
      FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_commits_repo_id ON commits(repo_id);
    CREATE INDEX IF NOT EXISTS idx_commits_date ON commits(date);
    CREATE INDEX IF NOT EXISTS idx_commits_author ON commits(author_name);
    CREATE INDEX IF NOT EXISTS idx_file_changes_commit_id ON file_changes(commit_id);
    CREATE INDEX IF NOT EXISTS idx_file_changes_repo_id ON file_changes(repo_id);
    CREATE INDEX IF NOT EXISTS idx_file_changes_file_path ON file_changes(file_path);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
