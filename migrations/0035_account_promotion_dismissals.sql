CREATE TABLE IF NOT EXISTS account_promotion_dismissals (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  promotion_id TEXT NOT NULL,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_account_promotion_dismissals_account
  ON account_promotion_dismissals(account_id, dismissed_at DESC);

INSERT OR REPLACE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.31.3',
  '첫 생존 훈련과 출시 이벤트 개선',
  '• 첫 생존 훈련의 포탑 피해와 안내 흐름을 다듬었습니다.' || char(10) ||
  '• 훈련 중 설치·업그레이드가 끝나면 안내 창이 자동으로 닫힙니다.' || char(10) ||
  '• 출시 이벤트의 다시 보지 않기 설정을 계정별로 저장해, 다른 계정의 이벤트가 숨겨지지 않습니다.',
  1785484800000
);
