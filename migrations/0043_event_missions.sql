CREATE TABLE IF NOT EXISTS event_mission_progress (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('stage-clears', 'login-days', 'ranked-completions')),
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly')),
  period_key TEXT NOT NULL,
  progress_count INTEGER NOT NULL DEFAULT 0 CHECK (progress_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, metric, period_type, period_key)
);

CREATE TABLE IF NOT EXISTS event_mission_login_days (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  week_key TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, day_key)
);

CREATE TABLE IF NOT EXISTS event_mission_claims (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  reward_points INTEGER NOT NULL CHECK (reward_points BETWEEN 20 AND 200),
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, mission_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_event_mission_claims_account
  ON event_mission_claims(account_id, claimed_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_event_mission_reward_claim
AFTER INSERT ON event_mission_claims
BEGIN
  UPDATE account_customization
  SET custom_points = custom_points + NEW.reward_points,
      updated_at = NEW.claimed_at
  WHERE account_id = NEW.account_id;
END;

-- Keep the D1 catalog in sync with the shared catalog used for purchases.
-- The server currently validates prices from TypeScript, while D1 remains the
-- source of truth for future catalog APIs and operational inspection.
UPDATE cosmetic_catalog
SET point_price = CASE id
  WHEN 'character-cat' THEN 900
  WHEN 'character-puppy' THEN 1100
  WHEN 'character-hamster' THEN 1500
  WHEN 'character-crocodile' THEN 2500
  WHEN 'character-duck' THEN 2300
  WHEN 'character-tiger' THEN 3000
  WHEN 'character-dinosaur' THEN 3400
  WHEN 'character-monkey' THEN 4000
  WHEN 'character-gorilla' THEN 4400
  WHEN 'skin-look-bunny-ward' THEN 800
  WHEN 'skin-look-cat-ward' THEN 4000
  WHEN 'skin-look-puppy-ward' THEN 4000
  WHEN 'skin-look-bear-ward' THEN 4000
  WHEN 'skin-look-fox-ward' THEN 4000
  WHEN 'skin-look-hamster-ward' THEN 4000
  WHEN 'skin-look-crocodile-ward' THEN 4000
  WHEN 'skin-look-duck-ward' THEN 4000
  WHEN 'skin-look-tiger-ward' THEN 4000
  WHEN 'skin-look-dinosaur-ward' THEN 4000
  WHEN 'skin-look-monkey-ward' THEN 4000
  WHEN 'skin-look-gorilla-ward' THEN 4000
  WHEN 'skin-look-puppy-surfer' THEN 8000
  WHEN 'skin-look-tiger-lifeguard' THEN 8000
  WHEN 'skin-look-cat-neon-rider' THEN 8000
  WHEN 'skin-look-hamster-cyber-driver' THEN 8000
  WHEN 'skin-look-crocodile-police-enforcer' THEN 8000
  WHEN 'skin-look-monkey-secret-agent' THEN 8000
  WHEN 'tile-wave-surfer' THEN 1800
  WHEN 'tile-beach-lifeguard' THEN 1800
  WHEN 'tile-cyberpunk-neon' THEN 1800
  WHEN 'tile-special-ops-headquarters' THEN 1800
  WHEN 'turret-basic-surfer-water' THEN 2500
  WHEN 'turret-basic-lifeguard-parasol' THEN 2500
  WHEN 'turret-basic-cyberpunk-laser' THEN 2500
  WHEN 'turret-basic-special-ops-tracker' THEN 2500
  WHEN 'turret-basic-toy' THEN 600
  WHEN 'turret-basic-pumpkin' THEN 900
  WHEN 'turret-rapid-candy' THEN 750
  WHEN 'turret-rapid-dragon' THEN 1100
  WHEN 'turret-frost-globe' THEN 850
  WHEN 'turret-frost-crystal' THEN 1250
  WHEN 'turret-arc-idol' THEN 1350
  WHEN 'turret-arc-crown' THEN 1800
  ELSE point_price
END
WHERE id IN (
  'character-cat', 'character-puppy', 'character-hamster',
  'character-crocodile', 'character-duck', 'character-tiger',
  'character-dinosaur', 'character-monkey', 'character-gorilla',
  'skin-look-bunny-ward', 'skin-look-cat-ward', 'skin-look-puppy-ward',
  'skin-look-bear-ward', 'skin-look-fox-ward', 'skin-look-hamster-ward',
  'skin-look-crocodile-ward', 'skin-look-duck-ward', 'skin-look-tiger-ward',
  'skin-look-dinosaur-ward', 'skin-look-monkey-ward', 'skin-look-gorilla-ward',
  'skin-look-puppy-surfer', 'skin-look-tiger-lifeguard',
  'skin-look-cat-neon-rider', 'skin-look-hamster-cyber-driver',
  'skin-look-crocodile-police-enforcer', 'skin-look-monkey-secret-agent',
  'tile-wave-surfer', 'tile-beach-lifeguard', 'tile-cyberpunk-neon',
  'tile-special-ops-headquarters', 'turret-basic-surfer-water',
  'turret-basic-lifeguard-parasol', 'turret-basic-cyberpunk-laser',
  'turret-basic-special-ops-tracker', 'turret-basic-toy',
  'turret-basic-pumpkin', 'turret-rapid-candy', 'turret-rapid-dragon',
  'turret-frost-globe', 'turret-frost-crystal', 'turret-arc-idol',
  'turret-arc-crown'
);

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.03.1',
  '일일·주간 이벤트 미션',
  '• 홈에 이벤트 센터를 추가하고 일일 1·2·3회, 주간 5·10·20회 스테이지 클리어 미션을 시작했습니다.' || char(10) ||
  '• 50~200P 보상을 개별 또는 일괄 수령할 수 있으며, 받을 보상이 있으면 홈 이벤트 버튼에 빨간 점이 표시됩니다.' || char(10) ||
  '• 새 포인트 수급량에 맞춰 외형과 전술 보급 상점 가격을 조정하고, 방장 본인의 방 입장 연출을 제거했습니다.',
  1785723000000
);
