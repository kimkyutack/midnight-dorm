CREATE TABLE IF NOT EXISTS account_random_box_daily (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  remaining_count INTEGER NOT NULL DEFAULT 10 CHECK (remaining_count >= 0),
  refills_claimed INTEGER NOT NULL DEFAULT 0 CHECK (refills_claimed BETWEEN 0 AND 2),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_account_random_box_daily_period
  ON account_random_box_daily(period_key, account_id);

INSERT INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.08.07.1',
  '연출 상점과 일일 랜덤 상자',
  '• 명찰 10종과 홈 배경 10종을 추가하고 상점·보관함·홈·인게임 이름표를 하나의 장착 흐름으로 연결했습니다.\n• 랜덤 상자는 매일 10회 지급되며 아이템 상점에서 하루 두 번, 한 번에 5회씩 광고 보상으로 보충할 수 있습니다. 광고 제거 이용자는 즉시 받습니다.\n• 복도 드롭 등급, 발전기 업그레이드 외형, 프레스티지 침대 잔상, 보급품 버튼, 프리미엄 캐시 가격과 구슬 포인트 상한을 함께 조정했습니다.',
  1786086400000
)
ON CONFLICT(version) DO UPDATE SET
  title = excluded.title,
  summary = excluded.summary,
  published_at = excluded.published_at;
