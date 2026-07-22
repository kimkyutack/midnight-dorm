PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_consumables (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_account_consumables_account
  ON account_consumables(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS match_consumable_uses (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  target TEXT NOT NULL DEFAULT '{}',
  UNIQUE (match_id, account_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_match_consumable_uses_match
  ON match_consumable_uses(match_id, account_id);
