-- Account mail uses a receipt per player so global announcements, personal
-- messages, and point rewards all keep independent read/claim state.
CREATE TABLE IF NOT EXISTS mailbox_messages (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'personal', 'reward')),
  recipient_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_delivery
  ON mailbox_messages(scope, recipient_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mailbox_receipts (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mail_id TEXT NOT NULL REFERENCES mailbox_messages(id) ON DELETE CASCADE,
  read_at INTEGER,
  claimed_at INTEGER,
  PRIMARY KEY (account_id, mail_id)
);

CREATE INDEX IF NOT EXISTS idx_mailbox_receipts_unread
  ON mailbox_receipts(account_id, read_at);

INSERT OR IGNORE INTO mailbox_messages (
  id, scope, recipient_account_id, subject, body, reward_points, created_at, expires_at
) VALUES (
  'mail-global-20260727-home',
  'global',
  NULL,
  '병동 우편함이 열렸습니다',
  '이제 서버 공지와 개인 보상은 홈 화면의 우편함에서 확인할 수 있습니다. 새 우편은 빨간 점으로 알려드립니다.',
  0,
  1785157800000,
  NULL
);

INSERT OR IGNORE INTO app_updates (version, title, summary, published_at)
VALUES (
  '2026.07.27.5',
  '우편함과 홈 빠른 메뉴',
  '• 홈 상단에 우편함을 추가해 서버 공지·개인 우편·보상 우편을 한곳에서 확인할 수 있습니다.' || char(10) ||
  '• 업데이트 내역·광고 제거·랭킹을 세로형 빠른 메뉴로 정리했습니다.',
  1785157800000
);
