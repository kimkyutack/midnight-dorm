-- Release history is public metadata. The client reads it with no-store so a
-- cached app shell can detect a newer deployed build without an account.
CREATE TABLE IF NOT EXISTS app_updates (
  version TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_updates_published_at
  ON app_updates(published_at DESC);

INSERT OR IGNORE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.27.2',
  '모바일 조작과 보상 흐름 개선',
  '화면 어디서나 드래그 이동, 이동 입력 재전송으로 끊김 완화, 복도 보상 낙하와 랜덤 보상 설치 흐름을 개선했습니다.',
  1785110400000
);
