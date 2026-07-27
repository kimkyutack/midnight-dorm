import { getAuthenticatedProfile } from './auth';
import type { AccountProfile } from '../shared/types';

type MailScope = 'global' | 'personal' | 'reward';

interface MailRow {
  id: string;
  scope: MailScope;
  recipient_account_id: string | null;
  subject: string;
  body: string;
  reward_points: number;
  created_at: number;
  expires_at: number | null;
  read_at: number | null;
  claimed_at: number | null;
}

export interface MailboxMessage {
  id: string;
  scope: MailScope;
  subject: string;
  body: string;
  rewardPoints: number;
  createdAt: number;
  expiresAt: number | null;
  readAt: number | null;
  claimedAt: number | null;
}

const noStoreHeaders = {
  'cache-control': 'no-store, max-age=0, must-revalidate',
  pragma: 'no-cache',
};

/** Local E2E uses an empty D1 instance rather than applying migrations. */
export async function ensureMailboxSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS mailbox_messages (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('global', 'personal', 'reward')),
      recipient_account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_mailbox_messages_delivery ON mailbox_messages(scope, recipient_account_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS mailbox_receipts (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      mail_id TEXT NOT NULL REFERENCES mailbox_messages(id) ON DELETE CASCADE,
      read_at INTEGER,
      claimed_at INTEGER,
      PRIMARY KEY (account_id, mail_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_mailbox_receipts_unread ON mailbox_receipts(account_id, read_at)'),
    db.prepare(`INSERT OR IGNORE INTO mailbox_messages
      (id, scope, recipient_account_id, subject, body, reward_points, created_at, expires_at)
      VALUES (?, 'global', NULL, ?, ?, 0, ?, NULL)`)
      .bind(
        'mail-global-20260727-home',
        '병동 우편함이 열렸습니다',
        '이제 서버 공지와 개인 보상은 홈 화면의 우편함에서 확인할 수 있습니다. 새 우편은 빨간 점으로 알려드립니다.',
        1785157800000,
      ),
  ]);
}

function checkOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function messageFromRow(row: MailRow): MailboxMessage {
  return {
    id: row.id,
    scope: row.scope,
    subject: row.subject,
    body: row.body,
    rewardPoints: Math.max(0, row.reward_points),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    readAt: row.read_at,
    claimedAt: row.claimed_at,
  };
}

async function listMailbox(db: D1Database, accountId: string): Promise<MailboxMessage[]> {
  const result = await db.prepare(`SELECT
      message.id, message.scope, message.recipient_account_id, message.subject,
      message.body, message.reward_points, message.created_at, message.expires_at,
      receipt.read_at, receipt.claimed_at
    FROM mailbox_messages AS message
    LEFT JOIN mailbox_receipts AS receipt
      ON receipt.mail_id = message.id AND receipt.account_id = ?
    WHERE (message.scope = 'global' OR message.recipient_account_id = ?)
      AND (message.expires_at IS NULL OR message.expires_at > ?)
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT 60`)
    .bind(accountId, accountId, Date.now())
    .all<MailRow>();
  return (result.results ?? []).map(messageFromRow);
}

async function visibleMail(db: D1Database, accountId: string, mailId: string): Promise<MailRow | null> {
  return db.prepare(`SELECT
      message.id, message.scope, message.recipient_account_id, message.subject,
      message.body, message.reward_points, message.created_at, message.expires_at,
      receipt.read_at, receipt.claimed_at
    FROM mailbox_messages AS message
    LEFT JOIN mailbox_receipts AS receipt
      ON receipt.mail_id = message.id AND receipt.account_id = ?
    WHERE message.id = ?
      AND (message.scope = 'global' OR message.recipient_account_id = ?)
      AND (message.expires_at IS NULL OR message.expires_at > ?)`)
    .bind(accountId, mailId, accountId, Date.now())
    .first<MailRow>();
}

async function markRead(db: D1Database, accountId: string, mailId: string): Promise<MailboxMessage | null> {
  const message = await visibleMail(db, accountId, mailId);
  if (!message) return null;
  const now = Date.now();
  await db.prepare(`INSERT INTO mailbox_receipts (account_id, mail_id, read_at, claimed_at)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(account_id, mail_id) DO UPDATE SET read_at = excluded.read_at`)
    .bind(accountId, mailId, now).run();
  return messageFromRow({ ...message, read_at: now });
}

async function claimReward(
  db: D1Database,
  profile: AccountProfile,
  mailId: string,
): Promise<{ message: MailboxMessage; profile: AccountProfile } | { error: string }> {
  const message = await visibleMail(db, profile.id, mailId);
  if (!message) return { error: '받을 수 없는 우편입니다.' };
  if (message.reward_points <= 0) return { error: '이 우편에는 수령할 보상이 없습니다.' };
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO mailbox_receipts (account_id, mail_id, read_at, claimed_at)
      VALUES (?, ?, ?, NULL)`)
    .bind(profile.id, mailId, now).run();
  const claimed = await db.prepare(`UPDATE mailbox_receipts
      SET read_at = ?, claimed_at = ?
      WHERE account_id = ? AND mail_id = ? AND claimed_at IS NULL`)
    .bind(now, now, profile.id, mailId).run();
  if ((claimed.meta.changes ?? 0) !== 1) return { error: '이미 수령한 보상입니다.' };
  await db.prepare(`INSERT OR IGNORE INTO account_customization (account_id, custom_points, appearance, updated_at)
      VALUES (?, 0, '{}', ?)`)
    .bind(profile.id, now).run();
  await db.prepare(`UPDATE account_customization
      SET custom_points = custom_points + ?, updated_at = ? WHERE account_id = ?`)
    .bind(message.reward_points, now, profile.id).run();
  return {
    message: messageFromRow({ ...message, read_at: now, claimed_at: now }),
    profile: { ...profile, customPoints: profile.customPoints + message.reward_points },
  };
}

export async function routeMailbox(request: Request, db: D1Database, bootstrapSchema = false): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/mailbox')) return null;
  try {
    if (bootstrapSchema) await ensureMailboxSchema(db);
    const profile = await getAuthenticatedProfile(request, db, bootstrapSchema);
    if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    if (url.pathname === '/api/mailbox' && request.method === 'GET') {
      const messages = await listMailbox(db, profile.id);
      return Response.json({ messages, unreadCount: messages.filter((message) => !message.readAt).length }, { headers: noStoreHeaders });
    }
    const match = url.pathname.match(/^\/api\/mailbox\/([a-zA-Z0-9-]{8,120})\/(read|claim)$/);
    if (!match || request.method !== 'POST') return Response.json({ error: '지원하지 않는 우편함 요청입니다.' }, { status: 404 });
    if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
    const [, mailId, action] = match;
    if (action === 'read') {
      const message = await markRead(db, profile.id, mailId as string);
      return message
        ? Response.json({ message }, { headers: noStoreHeaders })
        : Response.json({ error: '우편을 찾을 수 없습니다.' }, { status: 404 });
    }
    const result = await claimReward(db, profile, mailId as string);
    return 'error' in result
      ? Response.json(result, { status: 409 })
      : Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    const missingTable = error instanceof Error && /no such table: mailbox_/i.test(error.message);
    if (!missingTable) console.error('Mailbox request failed', error);
    return Response.json({ error: missingTable ? '우편함을 준비 중입니다. 잠시 후 다시 시도해주세요.' : '우편함을 불러오지 못했습니다.' }, { status: 503 });
  }
}
