CREATE TABLE IF NOT EXISTS pending_google_signups (
  token_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  suggested_name TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_google_signups_expiry
  ON pending_google_signups(expires_at);

CREATE TABLE IF NOT EXISTS account_nickname_registry (
  normalized_nickname TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO account_nickname_registry
  (normalized_nickname, account_id, created_at)
SELECT lower(trim(nickname)), id, created_at
FROM accounts
WHERE length(trim(nickname)) BETWEEN 2 AND 12;
