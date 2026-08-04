import { higherRank, rankedTierForRating, rankFromXp } from '../shared/progression';
import type { DirectMessage, FriendRequest, SocialConversation, SocialFriend, SocialInvite, SocialPerson, SocialSnapshot } from '../shared/social';
import type { AccountProfile, RankId } from '../shared/types';
import { getAuthenticatedProfile } from './auth';
import type { SocialPresence } from './SocialPresence';
import type { SocialPush } from './SocialPresence';

const MAX_FRIENDS = 100;
const MAX_REQUESTS_PER_DAY = 20;
const MAX_MESSAGE_LENGTH = 200;
const MESSAGE_WINDOW_MS = 5_000;
const MAX_MESSAGES_PER_WINDOW = 5;
const INVITE_TTL_MS = 5 * 60_000;
const noStoreHeaders = { 'cache-control': 'no-store, max-age=0, must-revalidate', pragma: 'no-cache' };

export interface SocialEnv {
  SOCIAL_PRESENCE: DurableObjectNamespace<SocialPresence>;
  DATA_ENV: 'remote-d1' | 'local-e2e';
}

interface AccountSocialRow {
  id: string;
  nickname: string;
  profile_avatar: string;
  profile_avatar_updated_at: number;
  solo_xp: number;
  multiplayer_xp: number;
  ranked_rating: number;
}

interface FriendshipRow {
  account_low_id: string;
  account_high_id: string;
  requested_by_id: string;
  status: 'pending' | 'accepted';
  created_at: number;
  accepted_at: number | null;
}

interface MessageRow {
  id: string;
  sender_account_id: string;
  recipient_account_id: string;
  body: string;
  created_at: number;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function pairFor(left: string, right: string): { low: string; high: string } {
  return left < right ? { low: left, high: right } : { low: right, high: left };
}

function conversationKey(left: string, right: string): string {
  const pair = pairFor(left, right);
  return `${pair.low}:${pair.high}`;
}

function friendCodeFor(accountId: string): string {
  return `FD-${accountId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function personFromRow(row: AccountSocialRow): SocialPerson {
  const rank: RankId = higherRank(rankFromXp(row.solo_xp), rankFromXp(row.multiplayer_xp));
  const avatarVersion = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
  return {
    accountId: row.id,
    nickname: row.nickname,
    avatarUrl: row.profile_avatar && avatarVersion > 0
      ? `/api/profile-avatar/${encodeURIComponent(row.id)}?v=${avatarVersion}`
      : null,
    rank,
    rankedTier: rankedTierForRating(Math.max(0, Math.floor(row.ranked_rating ?? 800))),
  };
}

function messageFromRow(row: MessageRow): DirectMessage {
  return {
    id: row.id,
    senderAccountId: row.sender_account_id,
    recipientAccountId: row.recipient_account_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

async function ensureSocialSchema(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(accounts)').all<{ name: string }>();
  const existing = new Set(columns.results?.map((row) => row.name) ?? []);
  if (!existing.has('friend_code')) {
    await db.prepare("ALTER TABLE accounts ADD COLUMN friend_code TEXT NOT NULL DEFAULT ''").run();
  }
  await db.batch([
    db.prepare("UPDATE accounts SET friend_code = 'FD-' || upper(substr(replace(id, '-', ''), 1, 8)) WHERE friend_code = ''"),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_friend_code ON accounts(friend_code)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS friendships (
      account_low_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      account_high_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      requested_by_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
      created_at INTEGER NOT NULL,
      accepted_at INTEGER,
      PRIMARY KEY (account_low_id, account_high_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_friendships_low ON friendships(account_low_id, status)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_friendships_high ON friendships(account_high_id, status)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS friend_request_events (
      id TEXT PRIMARY KEY,
      sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_friend_request_events_sender ON friend_request_events(sender_account_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      conversation_key TEXT NOT NULL,
      sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation ON direct_messages(conversation_key, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS conversation_reads (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      conversation_key TEXT NOT NULL,
      read_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, conversation_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS game_invites (
      id TEXT PRIMARY KEY,
      sender_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recipient_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      room_code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      declined_at INTEGER
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_game_invites_recipient ON game_invites(recipient_account_id, expires_at DESC)'),
  ]);
}

async function friendshipFor(db: D1Database, left: string, right: string): Promise<FriendshipRow | null> {
  const pair = pairFor(left, right);
  return db.prepare(`SELECT account_low_id, account_high_id, requested_by_id, status, created_at, accepted_at
    FROM friendships WHERE account_low_id = ? AND account_high_id = ?`)
    .bind(pair.low, pair.high).first<FriendshipRow>();
}

async function requireFriendship(db: D1Database, left: string, right: string): Promise<boolean> {
  return (await friendshipFor(db, left, right))?.status === 'accepted';
}

async function push(env: SocialEnv, accountId: string, event: SocialPush): Promise<void> {
  try {
    await env.SOCIAL_PRESENCE.getByName(accountId).notify(event);
  } catch (error) {
    // Notification delivery is intentionally best-effort; D1 unread state is
    // fetched when the recipient next opens the social panel.
    console.warn('Social notification delivery failed', error);
  }
}

async function accountById(db: D1Database, accountId: string): Promise<SocialPerson | null> {
  const row = await db.prepare(`SELECT id, nickname, profile_avatar, profile_avatar_updated_at,
      solo_xp, multiplayer_xp, ranked_rating FROM accounts WHERE id = ?`)
    .bind(accountId).first<AccountSocialRow>();
  return row ? personFromRow(row) : null;
}

async function snapshotFor(db: D1Database, profile: AccountProfile): Promise<SocialSnapshot> {
  const now = Date.now();
  const [codeRow, friendRows, requestRows, messageRows, inviteRows] = await Promise.all([
    db.prepare('SELECT friend_code FROM accounts WHERE id = ?').bind(profile.id).first<{ friend_code: string }>(),
    db.prepare(`SELECT f.accepted_at, a.id, a.nickname, a.profile_avatar, a.profile_avatar_updated_at,
      a.solo_xp, a.multiplayer_xp, a.ranked_rating
      FROM friendships f JOIN accounts a ON a.id = CASE WHEN f.account_low_id = ? THEN f.account_high_id ELSE f.account_low_id END
      WHERE (f.account_low_id = ? OR f.account_high_id = ?) AND f.status = 'accepted'
      ORDER BY a.nickname COLLATE NOCASE ASC`)
      .bind(profile.id, profile.id, profile.id).all<AccountSocialRow & { accepted_at: number }>(),
    db.prepare(`SELECT f.requested_by_id, f.created_at, a.id, a.nickname, a.profile_avatar, a.profile_avatar_updated_at,
      a.solo_xp, a.multiplayer_xp, a.ranked_rating
      FROM friendships f JOIN accounts a ON a.id = CASE WHEN f.requested_by_id = ?
        THEN CASE WHEN f.account_low_id = ? THEN f.account_high_id ELSE f.account_low_id END ELSE f.requested_by_id END
      WHERE (f.account_low_id = ? OR f.account_high_id = ?) AND f.status = 'pending'
      ORDER BY f.created_at DESC`)
      .bind(profile.id, profile.id, profile.id, profile.id).all<AccountSocialRow & { requested_by_id: string; created_at: number }>(),
    db.prepare(`SELECT m.id, m.sender_account_id, m.recipient_account_id, m.body, m.created_at,
      CASE WHEN m.sender_account_id = ? THEN m.recipient_account_id ELSE m.sender_account_id END AS other_id
      FROM direct_messages m
      WHERE m.sender_account_id = ? OR m.recipient_account_id = ?
      ORDER BY m.created_at DESC LIMIT 240`)
      .bind(profile.id, profile.id, profile.id).all<MessageRow & { other_id: string }>(),
    db.prepare(`SELECT i.id, i.room_code, i.created_at, i.expires_at, a.id AS sender_id, a.nickname,
      a.profile_avatar, a.profile_avatar_updated_at, a.solo_xp, a.multiplayer_xp, a.ranked_rating
      FROM game_invites i JOIN accounts a ON a.id = i.sender_account_id
      WHERE i.recipient_account_id = ? AND i.expires_at > ? AND i.accepted_at IS NULL AND i.declined_at IS NULL
      ORDER BY i.created_at DESC`)
      .bind(profile.id, now).all<AccountSocialRow & { id: string; sender_id: string; room_code: string; created_at: number; expires_at: number }>(),
  ]);
  const friends = (friendRows.results ?? []).map((row) => ({ ...personFromRow(row), acceptedAt: row.accepted_at })) as SocialFriend[];
  const requests = (requestRows.results ?? []).map((row) => ({
    ...personFromRow(row), createdAt: row.created_at,
    direction: row.requested_by_id === profile.id ? 'outgoing' : 'incoming',
  })) as FriendRequest[];
  const people = new Map<string, SocialPerson>();
  for (const friend of friends) people.set(friend.accountId, friend);
  const seenConversations = new Set<string>();
  const conversations: SocialConversation[] = [];
  let unreadCount = requests.filter((request) => request.direction === 'incoming').length;
  for (const row of messageRows.results ?? []) {
    const key = conversationKey(profile.id, row.other_id);
    if (seenConversations.has(key)) continue;
    seenConversations.add(key);
    const other = people.get(row.other_id) ?? await accountById(db, row.other_id);
    if (!other) continue;
    const read = await db.prepare('SELECT read_at FROM conversation_reads WHERE account_id = ? AND conversation_key = ?')
      .bind(profile.id, key).first<{ read_at: number }>();
    const unread = await db.prepare(`SELECT COUNT(*) AS count FROM direct_messages
      WHERE conversation_key = ? AND recipient_account_id = ? AND created_at > ?`)
      .bind(key, profile.id, read?.read_at ?? 0).first<{ count: number }>();
    const unreadMessages = Math.max(0, unread?.count ?? 0);
    unreadCount += unreadMessages;
    conversations.push({ ...other, lastMessage: messageFromRow(row), unreadCount: unreadMessages });
  }
  const invites = (inviteRows.results ?? []).map((row) => ({
    ...personFromRow({ ...row, id: row.sender_id }), id: row.id, roomCode: row.room_code,
    createdAt: row.created_at, expiresAt: row.expires_at,
  })) as SocialInvite[];
  unreadCount += invites.length;
  return {
    friendCode: codeRow?.friend_code || friendCodeFor(profile.id),
    friends,
    requests,
    conversations,
    invites,
    unreadCount,
  };
}

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH)
    : '';
}

export async function routeSocial(request: Request, db: D1Database, env: SocialEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/social')) return null;
  const bootstrap = env.DATA_ENV === 'local-e2e';
  if (bootstrap) await ensureSocialSchema(db);
  const profile = await getAuthenticatedProfile(request, db, bootstrap);
  if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  try {
    if (url.pathname === '/api/social/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });
      return env.SOCIAL_PRESENCE.getByName(profile.id).fetch(new Request('https://social.internal/connect', request));
    }
    if (url.pathname === '/api/social/summary' && request.method === 'GET') {
      const social = await snapshotFor(db, profile);
      return Response.json({ unreadCount: social.unreadCount }, { headers: noStoreHeaders });
    }
    if (url.pathname === '/api/social' && request.method === 'GET') {
      return Response.json(await snapshotFor(db, profile), { headers: noStoreHeaders });
    }
    if (url.pathname === '/api/social/friends/request' && request.method === 'POST') {
      if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const body = await request.json<{ friendCode?: unknown; accountId?: unknown }>().catch(() => ({}));
      const requestBody = body as { friendCode?: unknown; accountId?: unknown };
      const friendCode = typeof requestBody.friendCode === 'string' ? requestBody.friendCode.replace(/\s+/g, '').toUpperCase() : '';
      const accountId = typeof requestBody.accountId === 'string' ? requestBody.accountId.trim() : '';
      if (!/^FD-[A-F0-9]{8}$/.test(friendCode) && !/^[a-zA-Z0-9-]{8,80}$/.test(accountId))
        return Response.json({ error: '친구 대상을 확인해주세요.' }, { status: 400 });
      const target = accountId
        ? await db.prepare('SELECT id FROM accounts WHERE id = ?').bind(accountId).first<{ id: string }>()
        : await db.prepare('SELECT id FROM accounts WHERE friend_code = ?').bind(friendCode).first<{ id: string }>();
      if (!target) return Response.json({ error: '해당 친구 코드를 찾지 못했습니다.' }, { status: 404 });
      if (target.id === profile.id) return Response.json({ error: '자기 자신은 친구로 추가할 수 없습니다.' }, { status: 400 });
      const today = Date.now() - 24 * 60 * 60_000;
      const sent = await db.prepare(`SELECT COUNT(*) AS count FROM friend_request_events
        WHERE sender_account_id = ? AND created_at >= ?`).bind(profile.id, today).first<{ count: number }>();
      if ((sent?.count ?? 0) >= MAX_REQUESTS_PER_DAY) return Response.json({ error: '오늘 보낼 수 있는 친구 요청 수를 초과했습니다.' }, { status: 429 });
      const friendCount = await db.prepare(`SELECT COUNT(*) AS count FROM friendships
        WHERE (account_low_id = ? OR account_high_id = ?) AND status = 'accepted'`).bind(profile.id, profile.id).first<{ count: number }>();
      if ((friendCount?.count ?? 0) >= MAX_FRIENDS) return Response.json({ error: `친구는 최대 ${MAX_FRIENDS}명까지 추가할 수 있습니다.` }, { status: 409 });
      const existing = await friendshipFor(db, profile.id, target.id);
      if (existing?.status === 'accepted') return Response.json({ error: '이미 친구입니다.' }, { status: 409 });
      if (existing?.status === 'pending') return Response.json({ error: '이미 처리 대기 중인 친구 요청입니다.' }, { status: 409 });
      const pair = pairFor(profile.id, target.id);
      const requestedAt = Date.now();
      await db.batch([
        db.prepare(`INSERT INTO friendships (account_low_id, account_high_id, requested_by_id, status, created_at)
          VALUES (?, ?, ?, 'pending', ?)`)
          .bind(pair.low, pair.high, profile.id, requestedAt),
        db.prepare(`INSERT INTO friend_request_events (id, sender_account_id, recipient_account_id, created_at)
          VALUES (?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), profile.id, target.id, requestedAt),
      ]);
      await push(env, target.id, { type: 'friend-request', fromAccountId: profile.id });
      return Response.json({ ok: true });
    }
    const friendshipMatch = url.pathname.match(/^\/api\/social\/friends\/([a-zA-Z0-9-]{8,80})\/(accept|decline|remove)$/);
    if (friendshipMatch && request.method === 'POST') {
      if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const [, otherId, action] = friendshipMatch;
      if (otherId === profile.id) return Response.json({ error: '대상을 확인해주세요.' }, { status: 400 });
      const existing = await friendshipFor(db, profile.id, otherId as string);
      if (!existing) return Response.json({ error: '친구 관계를 찾지 못했습니다.' }, { status: 404 });
      const pair = pairFor(profile.id, otherId as string);
      if (action === 'accept') {
        if (existing.status === 'accepted') return Response.json({ ok: true, alreadyAccepted: true });
        if (existing.status !== 'pending' || existing.requested_by_id === profile.id)
          return Response.json({ error: '수락할 친구 요청이 없습니다.' }, { status: 409 });
        const accepted = await db.prepare(`UPDATE friendships SET status = 'accepted', accepted_at = ?
          WHERE account_low_id = ? AND account_high_id = ? AND status = 'pending' AND requested_by_id = ?`)
          .bind(Date.now(), pair.low, pair.high, otherId).run();
        if ((accepted.meta.changes ?? 0) === 0) {
          const current = await friendshipFor(db, profile.id, otherId as string);
          if (current?.status === 'accepted') return Response.json({ ok: true, alreadyAccepted: true });
          return Response.json({ error: '수락할 친구 요청이 없습니다.' }, { status: 409 });
        }
        await push(env, otherId as string, { type: 'friend-accepted', fromAccountId: profile.id });
      } else if (action === 'decline') {
        if (existing.status !== 'pending') return Response.json({ error: '거절할 친구 요청이 없습니다.' }, { status: 409 });
        await db.prepare('DELETE FROM friendships WHERE account_low_id = ? AND account_high_id = ?').bind(pair.low, pair.high).run();
      } else {
        if (existing.status !== 'accepted') return Response.json({ error: '삭제할 친구가 없습니다.' }, { status: 409 });
        await db.prepare('DELETE FROM friendships WHERE account_low_id = ? AND account_high_id = ?').bind(pair.low, pair.high).run();
      }
      return Response.json({ ok: true });
    }
    const messagesMatch = url.pathname.match(/^\/api\/social\/messages\/([a-zA-Z0-9-]{8,80})$/);
    if (messagesMatch) {
      const otherId = messagesMatch[1] as string;
      if (!await requireFriendship(db, profile.id, otherId)) return Response.json({ error: '친구와만 대화할 수 있습니다.' }, { status: 403 });
      const key = conversationKey(profile.id, otherId);
      if (request.method === 'GET') {
        const rows = await db.prepare(`SELECT id, sender_account_id, recipient_account_id, body, created_at
          FROM direct_messages WHERE conversation_key = ? ORDER BY created_at DESC LIMIT 80`).bind(key).all<MessageRow>();
        const messages = (rows.results ?? []).reverse().map(messageFromRow);
        await db.prepare(`INSERT INTO conversation_reads (account_id, conversation_key, read_at) VALUES (?, ?, ?)
          ON CONFLICT(account_id, conversation_key) DO UPDATE SET read_at = excluded.read_at`)
          .bind(profile.id, key, Date.now()).run();
        return Response.json({ messages }, { headers: noStoreHeaders });
      }
      if (request.method === 'POST') {
        if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
        const body = await request.json<{ body?: unknown }>().catch(() => ({}));
        const text = normalizedText((body as { body?: unknown }).body);
        if (!text) return Response.json({ error: '메시지를 입력해주세요.' }, { status: 400 });
        const recent = await db.prepare(`SELECT COUNT(*) AS count FROM direct_messages
          WHERE sender_account_id = ? AND recipient_account_id = ? AND created_at >= ?`)
          .bind(profile.id, otherId, Date.now() - MESSAGE_WINDOW_MS).first<{ count: number }>();
        if ((recent?.count ?? 0) >= MAX_MESSAGES_PER_WINDOW) return Response.json({ error: '메시지를 너무 빠르게 보냈습니다.' }, { status: 429 });
        const message: DirectMessage = {
          id: crypto.randomUUID(), senderAccountId: profile.id, recipientAccountId: otherId, body: text, createdAt: Date.now(),
        };
        await db.prepare(`INSERT INTO direct_messages (id, conversation_key, sender_account_id, recipient_account_id, body, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(message.id, key, message.senderAccountId, message.recipientAccountId, message.body, message.createdAt).run();
        await push(env, otherId, { type: 'message', fromAccountId: profile.id });
        return Response.json({ message });
      }
    }
    if (url.pathname === '/api/social/invites' && request.method === 'POST') {
      if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const body = await request.json<{ recipientId?: unknown; roomCode?: unknown }>().catch(() => ({}));
      const inviteBody = body as { recipientId?: unknown; roomCode?: unknown };
      const recipientId = typeof inviteBody.recipientId === 'string' ? inviteBody.recipientId : '';
      const roomCode = typeof inviteBody.roomCode === 'string' ? inviteBody.roomCode.trim().toUpperCase() : '';
      if (!/^[A-Z2-9]{8}$/.test(roomCode)) return Response.json({ error: '초대할 방 코드를 확인해주세요.' }, { status: 400 });
      if (!await requireFriendship(db, profile.id, recipientId)) return Response.json({ error: '친구에게만 초대할 수 있습니다.' }, { status: 403 });
      const now = Date.now();
      await db.prepare(`INSERT INTO game_invites (id, sender_account_id, recipient_account_id, room_code, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), profile.id, recipientId, roomCode, now, now + INVITE_TTL_MS).run();
      await push(env, recipientId, { type: 'invite', fromAccountId: profile.id });
      return Response.json({ ok: true });
    }
    const inviteMatch = url.pathname.match(/^\/api\/social\/invites\/([a-zA-Z0-9-]{8,80})\/(accept|decline)$/);
    if (inviteMatch && request.method === 'POST') {
      if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const [, inviteId, action] = inviteMatch;
      const invite = await db.prepare(`SELECT room_code FROM game_invites WHERE id = ? AND recipient_account_id = ?
        AND expires_at > ? AND accepted_at IS NULL AND declined_at IS NULL`)
        .bind(inviteId, profile.id, Date.now()).first<{ room_code: string }>();
      if (!invite) return Response.json({ error: '만료되었거나 처리된 초대입니다.' }, { status: 404 });
      await db.prepare(`UPDATE game_invites SET ${action}_at = ? WHERE id = ?`).bind(Date.now(), inviteId).run();
      return Response.json({ ok: true, roomCode: action === 'accept' ? invite.room_code : undefined });
    }
    return Response.json({ error: '지원하지 않는 소셜 요청입니다.' }, { status: 404 });
  } catch (error) {
    console.error('Social request failed', error);
    return Response.json({ error: '소셜 서버 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 503 });
  }
}
