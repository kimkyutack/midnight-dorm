PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  solo_xp INTEGER NOT NULL DEFAULT 0,
  multiplayer_xp INTEGER NOT NULL DEFAULT 0,
  solo_stage_index INTEGER NOT NULL DEFAULT 0,
  multiplayer_stage_index INTEGER NOT NULL DEFAULT 0,
  victories INTEGER NOT NULL DEFAULT 0,
  login_failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS match_results (
  match_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  play_mode TEXT NOT NULL CHECK (play_mode IN ('solo', 'multiplayer')),
  stage_index INTEGER NOT NULL,
  victory INTEGER NOT NULL CHECK (victory IN (0, 1)),
  xp_awarded INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_match_results_account ON match_results(account_id, created_at DESC);
