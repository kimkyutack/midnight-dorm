CREATE TABLE IF NOT EXISTS account_attendance_progress (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  attendance_count INTEGER NOT NULL DEFAULT 0 CHECK (attendance_count BETWEEN 0 AND 30),
  last_attended_day_key TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_attendance_claims (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  attendance_day INTEGER NOT NULL CHECK (attendance_day BETWEEN 1 AND 30),
  reward_kind TEXT NOT NULL CHECK (reward_kind IN ('points', 'cosmetic', 'premium-choice')),
  reward_item_id TEXT,
  reward_points INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, attendance_day)
);

CREATE TABLE IF NOT EXISTS account_attendance_vouchers (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  attendance_day INTEGER NOT NULL,
  redeemed_item_id TEXT,
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  PRIMARY KEY (account_id, attendance_day)
);

CREATE INDEX IF NOT EXISTS idx_attendance_claims_account
  ON account_attendance_claims(account_id, claimed_at DESC);

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.07.2',
  '30일 출석판과 판별 생존 미션',
  '• 연속 출석 부담 없이 접속 횟수로 채우는 30일 출석 보상판을 추가했습니다. 7일 단위 특별 보상과 30일 프리미엄 스킨 선택권을 받을 수 있습니다.\n• 침대를 점유하면 30종 이상의 후보에서 매 판 새로 구성되는 생존 미션이 표시됩니다. 마지막 목표는 항상 스테이지 클리어입니다.\n• 완료한 판별 미션 포인트는 스테이지 클리어 보상에 합산되며, 진행도와 지급 결과는 서버에서 판정합니다.',
  1786094576000
)
ON CONFLICT(version) DO UPDATE SET
  title = excluded.title,
  summary = excluded.summary,
  published_at = excluded.published_at;
