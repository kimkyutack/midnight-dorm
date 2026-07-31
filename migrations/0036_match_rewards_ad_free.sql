ALTER TABLE match_results ADD COLUMN reward_points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE match_results ADD COLUMN reward_claimed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE match_results ADD COLUMN reward_multiplier INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS account_entitlements (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entitlement_id TEXT NOT NULL,
  plan TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'mock',
  starts_at INTEGER NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, entitlement_id)
);

CREATE INDEX IF NOT EXISTS idx_account_entitlements_expiry
  ON account_entitlements(entitlement_id, expires_at);

CREATE TRIGGER IF NOT EXISTS trg_match_reward_claim
AFTER UPDATE OF reward_claimed_at ON match_results
WHEN OLD.reward_claimed_at = 0
  AND NEW.reward_claimed_at > 0
  AND NEW.victory = 1
  AND NEW.reward_points > 0
  AND NEW.reward_multiplier IN (1, 2)
BEGIN
  UPDATE account_customization
  SET custom_points = custom_points + (NEW.reward_points * NEW.reward_multiplier),
      updated_at = NEW.reward_claimed_at
  WHERE account_id = NEW.account_id;
END;
