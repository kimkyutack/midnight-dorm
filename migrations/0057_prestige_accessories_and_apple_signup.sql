CREATE TABLE IF NOT EXISTS pending_apple_signups (
  token_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  suggested_name TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_apple_signups_expiry
  ON pending_apple_signups(expires_at);

CREATE TABLE IF NOT EXISTS account_prestige_effect_loadouts (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  nameplate_id TEXT,
  home_aura_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_prestige_accessories (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  accessory_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, accessory_id)
);

CREATE INDEX IF NOT EXISTS idx_account_prestige_accessories_account
  ON account_prestige_accessories(account_id, acquired_at ASC);

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.06.1',
  '연결 안정성 및 앱 캐시 갱신',
  '• 운영 D1에 프레스티지 소품과 연출 장착 스키마를 추가해 로그인 이후 API가 중단되던 문제를 해결했습니다.' || char(10) ||
  '• Apple 로그인 임시 가입 스키마를 함께 추가했습니다.' || char(10) ||
  '• 앱 셸과 서비스워커 캐시를 새 버전으로 갱신하고, 잘못된 API 요청도 HTML 대신 JSON 오류로 응답하도록 개선했습니다.',
  1785999600000
);
