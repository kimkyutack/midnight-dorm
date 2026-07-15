import { getStage, higherRank, rankFromXp, STAGES } from '../shared/progression';
import type { AccountProfile, PlayMode } from '../shared/types';

const SESSION_COOKIE = 'midnight_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1_000;
const PBKDF2_ITERATIONS = 210_000;

interface AccountRow {
  id: string;
  username: string;
  nickname: string;
  password_hash: string;
  password_salt: string;
  solo_xp: number;
  multiplayer_xp: number;
  solo_stage_index: number;
  multiplayer_stage_index: number;
  victories: number;
  login_failures: number;
  locked_until: number;
  created_at: number;
}

let schemaReady: Promise<void> | null = null;

export function ensureAuthSchema(db: D1Database): Promise<void> {
  schemaReady ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nickname TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, solo_xp INTEGER NOT NULL DEFAULT 0, multiplayer_xp INTEGER NOT NULL DEFAULT 0, solo_stage_index INTEGER NOT NULL DEFAULT 0, multiplayer_stage_index INTEGER NOT NULL DEFAULT 0, victories INTEGER NOT NULL DEFAULT 0, login_failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_results (match_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, play_mode TEXT NOT NULL CHECK (play_mode IN ('solo', 'multiplayer')), stage_index INTEGER NOT NULL, victory INTEGER NOT NULL CHECK (victory IN (0, 1)), xp_awarded INTEGER NOT NULL, elapsed_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (match_id, account_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_match_results_account ON match_results(account_id, created_at DESC)'),
  ]).then(() => undefined).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

const bytesToText = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
const textToBytes = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

async function sha256(value: string): Promise<string> {
  return bytesToText(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS }, key, 256);
  return bytesToText(new Uint8Array(bits));
}

function secureEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(first: BufferSource, second: BufferSource): boolean };
  return a.length === b.length && subtle.timingSafeEqual(a, b);
}

function profileFromRow(row: AccountRow): AccountProfile {
  const soloRank = rankFromXp(row.solo_xp);
  const multiplayerRank = rankFromXp(row.multiplayer_xp);
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    soloRank,
    multiplayerRank,
    displayRank: higherRank(soloRank, multiplayerRank),
    soloXp: row.solo_xp,
    multiplayerXp: row.multiplayer_xp,
    soloStageIndex: row.solo_stage_index,
    multiplayerStageIndex: row.multiplayer_stage_index,
    victories: row.victories,
    createdAt: row.created_at,
  };
}

function cookieValue(request: Request): string | null {
  const match = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function checkOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function createSession(db: D1Database, accountId: string): Promise<string> {
  const token = bytesToText(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), accountId, now + SESSION_MS, now).run();
  return token;
}

export async function getAuthenticatedProfile(request: Request, db: D1Database): Promise<AccountProfile | null> {
  await ensureAuthSchema(db);
  const token = cookieValue(request);
  if (!token) return null;
  const row = await db.prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(token), Date.now()).first<AccountRow>();
  return row ? profileFromRow(row) : null;
}

async function register(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  let body: { username?: string; nickname?: string; password?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '입력값을 확인해주세요.' }, { status: 400 }); }
  const username = body.username?.trim().toLowerCase() ?? '';
  const nickname = body.nickname?.trim() ?? '';
  const password = body.password ?? '';
  if (!/^[a-z0-9_]{4,20}$/.test(username)) return Response.json({ error: '아이디는 영문 소문자, 숫자, 밑줄 4~20자로 입력하세요.' }, { status: 400 });
  if (nickname.length < 2 || nickname.length > 12) return Response.json({ error: '닉네임은 2~12자로 입력하세요.' }, { status: 400 });
  if (password.length < 8 || password.length > 72) return Response.json({ error: '비밀번호는 8~72자로 입력하세요.' }, { status: 400 });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  const id = crypto.randomUUID();
  try {
    await db.prepare(`INSERT INTO accounts (id, username, nickname, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, username, nickname, await derivePassword(password, salt), bytesToText(salt), now, now).run();
  } catch {
    return Response.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 409 });
  }
  const token = await createSession(db, id);
  const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
  return Response.json({ profile: profileFromRow(row as AccountRow) }, { headers: { 'set-cookie': sessionCookie(request, token, SESSION_MS / 1_000) } });
}

async function login(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  let body: { username?: string; password?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '입력값을 확인해주세요.' }, { status: 400 }); }
  const username = body.username?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';
  const row = await db.prepare('SELECT * FROM accounts WHERE username = ?').bind(username).first<AccountRow>();
  const genericError = () => Response.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  if (!row) return genericError();
  const now = Date.now();
  if (row.locked_until > now) return Response.json({ error: '로그인 시도가 많아 잠시 잠겼습니다. 10분 뒤 다시 시도하세요.' }, { status: 429 });
  const valid = secureEqual(await derivePassword(password, textToBytes(row.password_salt)), row.password_hash);
  if (!valid) {
    const failures = row.login_failures + 1;
    await db.prepare('UPDATE accounts SET login_failures = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(failures, failures >= 5 ? now + 10 * 60_000 : 0, now, row.id).run();
    return genericError();
  }
  await db.prepare('UPDATE accounts SET login_failures = 0, locked_until = 0, last_login_at = ?, updated_at = ? WHERE id = ?').bind(now, now, row.id).run();
  const token = await createSession(db, row.id);
  return Response.json({ profile: profileFromRow(row) }, { headers: { 'set-cookie': sessionCookie(request, token, SESSION_MS / 1_000) } });
}

async function logout(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const token = cookieValue(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie(request, '', 0) } });
}

export async function routeAuth(request: Request, db: D1Database): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/')) return null;
  await ensureAuthSchema(db);
  if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, db);
  if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, db);
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, db);
  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const profile = await getAuthenticatedProfile(request, db);
    return profile ? Response.json({ profile, stages: STAGES }) : Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }
  return Response.json({ error: '지원하지 않는 인증 요청입니다.' }, { status: 404 });
}

export async function recordMatchResult(
  db: D1Database,
  input: { matchId: string; accountId: string; playMode: PlayMode; stageIndex: number; victory: boolean; elapsed: number },
): Promise<void> {
  await ensureAuthSchema(db);
  const stage = getStage(STAGES[input.stageIndex]?.id);
  const xp = input.victory ? stage.victoryXp : Math.max(10, Math.floor(stage.victoryXp * 0.18));
  const inserted = await db.prepare(`INSERT OR IGNORE INTO match_results (match_id, account_id, play_mode, stage_index, victory, xp_awarded, elapsed_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.matchId, input.accountId, input.playMode, input.stageIndex, input.victory ? 1 : 0, xp, Math.floor(input.elapsed), Date.now()).run();
  if ((inserted.meta.changes ?? 0) === 0) return;
  const xpColumn = input.playMode === 'solo' ? 'solo_xp' : 'multiplayer_xp';
  const stageColumn = input.playMode === 'solo' ? 'solo_stage_index' : 'multiplayer_stage_index';
  const nextStage = Math.min(STAGES.length - 1, input.stageIndex + (input.victory ? 1 : 0));
  await db.prepare(`UPDATE accounts SET ${xpColumn} = ${xpColumn} + ?, ${stageColumn} = MAX(${stageColumn}, ?), victories = victories + ?, updated_at = ? WHERE id = ?`)
    .bind(xp, nextStage, input.victory ? 1 : 0, Date.now(), input.accountId).run();
}
