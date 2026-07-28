-- Persistent social data.  The presence Durable Object is only a delivery
-- channel; D1 remains the durable source for every request and message.
ALTER TABLE accounts ADD COLUMN friend_code TEXT NOT NULL DEFAULT '';

UPDATE accounts
SET friend_code = 'FD-' || upper(substr(replace(id, '-', ''), 1, 8))
WHERE friend_code = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_friend_code
  ON accounts(friend_code);

CREATE TABLE IF NOT EXISTS friendships (
  account_low_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_high_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  requested_by_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (account_low_id, account_high_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_low ON friendships(account_low_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_high ON friendships(account_high_id, status);

CREATE TABLE IF NOT EXISTS friend_request_events (
  id TEXT PRIMARY KEY,
  sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friend_request_events_sender
  ON friend_request_events(sender_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation
  ON direct_messages(conversation_key, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_reads (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_key TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, conversation_key)
);

CREATE TABLE IF NOT EXISTS game_invites (
  id TEXT PRIMARY KEY,
  sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  declined_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_game_invites_recipient
  ON game_invites(recipient_account_id, expires_at DESC);
