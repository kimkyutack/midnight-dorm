PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_customization (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  custom_points INTEGER NOT NULL DEFAULT 0 CHECK (custom_points >= 0),
  appearance TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_cosmetics (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  purchased_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_account_cosmetics_account ON account_cosmetics(account_id);
