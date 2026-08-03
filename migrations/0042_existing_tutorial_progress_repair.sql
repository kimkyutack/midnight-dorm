-- Re-run the historical tutorial backfill for production accounts that were
-- created before tutorial state became authoritative or missed that rollout.
UPDATE accounts
SET tutorial_completed = 1,
    updated_at = CASE
      WHEN updated_at > 0 THEN updated_at
      ELSE created_at
    END
WHERE tutorial_completed = 0
  AND (
    solo_xp > 0
    OR multiplayer_xp > 0
    OR solo_stage_index > 0
    OR multiplayer_stage_index > 0
    OR victories > 0
    OR EXISTS (
      SELECT 1
      FROM match_results
      WHERE match_results.account_id = accounts.id
    )
  );
