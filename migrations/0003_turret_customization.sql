PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_turret_loadouts (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  skins TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);
