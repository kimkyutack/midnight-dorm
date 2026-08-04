CREATE TABLE IF NOT EXISTS hide_seek_results (
  match_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ghost', 'survivor')),
  victory INTEGER NOT NULL CHECK (victory IN (0, 1)),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
  abandoned INTEGER NOT NULL DEFAULT 0 CHECK (abandoned IN (0, 1)),
  elapsed_seconds INTEGER NOT NULL,
  reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
  reward_claimed_at INTEGER NOT NULL DEFAULT 0,
  reward_multiplier INTEGER NOT NULL DEFAULT 0 CHECK (reward_multiplier IN (0, 1, 2)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_hide_seek_results_account
  ON hide_seek_results(account_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_hide_seek_reward_claim
AFTER UPDATE OF reward_claimed_at ON hide_seek_results
WHEN OLD.reward_claimed_at = 0
  AND NEW.reward_claimed_at > 0
  AND NEW.completed = 1
  AND NEW.abandoned = 0
  AND NEW.victory = 1
  AND NEW.reward_points > 0
  AND NEW.reward_multiplier IN (1, 2)
BEGIN
  UPDATE account_customization
  SET custom_points = custom_points + (NEW.reward_points * NEW.reward_multiplier),
      updated_at = NEW.reward_claimed_at
  WHERE account_id = NEW.account_id;
END;
