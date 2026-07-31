CREATE TABLE IF NOT EXISTS account_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, account_id)
);

CREATE INDEX IF NOT EXISTS idx_account_identities_account
  ON account_identities(account_id);

CREATE TABLE IF NOT EXISTS store_purchase_receipts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  product_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'rejected')),
  created_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (platform, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_store_purchase_receipts_account
  ON store_purchase_receipts(account_id, created_at DESC);
