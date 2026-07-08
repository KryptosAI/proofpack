import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '..', 'data', 'proofpack.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      stripe_account_id TEXT,
      stripe_customer_id TEXT,
      connected_at TEXT,
      plan TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      name TEXT NOT NULL,
      scopes TEXT DEFAULT 'read,write',
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS connect_accounts (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      stripe_user_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      token_type TEXT DEFAULT 'bearer',
      stripe_publishable_key TEXT,
      scope TEXT,
      livemode INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proof_events (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      user_id TEXT NOT NULL,
      event TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      ip_address TEXT,
      user_agent TEXT,
      device_id TEXT,
      session_id TEXT,
      timestamp TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_merchant ON proof_events(merchant_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_events_event ON proof_events(merchant_id, event);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON proof_events(merchant_id, user_id, timestamp);

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      stripe_dispute_id TEXT NOT NULL UNIQUE,
      charge_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      payment_intent_id TEXT,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'needs_response',
      evidence_submitted INTEGER DEFAULT 0,
      evidence_submitted_at TEXT,
      evidence_due_by TEXT,
      user_id TEXT,
      fraud_score REAL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_disputes_merchant ON disputes(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_disputes_user ON disputes(merchant_id, user_id);

    CREATE TABLE IF NOT EXISTS fraud_flags (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      dispute_id TEXT REFERENCES disputes(id),
      flag_type TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_configs (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      alert_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      config TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '["charge.dispute.created","charge.dispute.closed"]',
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS template_overrides (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id),
      dispute_reason TEXT,
      section TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
