-- Season-ranked progression is deliberately separate from casual XP and stages.
ALTER TABLE accounts ADD COLUMN selected_play_mode TEXT NOT NULL DEFAULT 'solo';
ALTER TABLE accounts ADD COLUMN ranked_rating INTEGER NOT NULL DEFAULT 800;
ALTER TABLE accounts ADD COLUMN ranked_season_id TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN ranked_placement_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN ranked_contracts_played INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ranked_results (
  match_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  contract_number INTEGER NOT NULL,
  score INTEGER NOT NULL,
  victory INTEGER NOT NULL CHECK (victory IN (0, 1)),
  elapsed_seconds INTEGER NOT NULL,
  door_hp_ratio REAL NOT NULL,
  supplies_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_ranked_results_season_score
  ON ranked_results(season_id, score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ranked_results_account
  ON ranked_results(account_id, season_id, created_at DESC);
