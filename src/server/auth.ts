import { getStage, higherRank, rankFromXp, rankLabel, STAGES } from '../shared/progression';
import { cosmeticAvailable, cosmeticById, customizationReward, DEFAULT_APPEARANCE, DEFAULT_TURRET_SKINS, normalizeAppearance, normalizeTurretSkins, STARTER_COSMETICS } from '../shared/customization';
import type { AccountProfile, AvatarAppearance, CosmeticSlot, PlayMode, TurretKind, TurretSkinLoadout } from '../shared/types';

const SESSION_COOKIE = 'midnight_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1_000;
const PASSWORD_SCHEME = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 100_000;

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

interface CustomizationRow {
  custom_points: number;
  appearance: string;
}

interface TurretLoadoutRow {
  skins: string;
}

async function ensureLegacyAuthColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(accounts)').all<{ name: string }>();
  const existing = new Set(columns.results?.map((row) => row.name) ?? []);
  const definitions = [
    ['password_hash', `TEXT NOT NULL DEFAULT ''`],
    ['password_salt', `TEXT NOT NULL DEFAULT ''`],
    ['solo_xp', 'INTEGER NOT NULL DEFAULT 0'],
    ['multiplayer_xp', 'INTEGER NOT NULL DEFAULT 0'],
    ['solo_stage_index', 'INTEGER NOT NULL DEFAULT 0'],
    ['multiplayer_stage_index', 'INTEGER NOT NULL DEFAULT 0'],
    ['victories', 'INTEGER NOT NULL DEFAULT 0'],
    ['login_failures', 'INTEGER NOT NULL DEFAULT 0'],
    ['locked_until', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_login_at', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const;
  const missing = definitions
    .filter(([column]) => !existing.has(column))
    .map(([column, definition]) => db.prepare(`ALTER TABLE accounts ADD COLUMN ${column} ${definition}`));
  if (missing.length > 0) await db.batch(missing);
}

export async function ensureAuthSchema(db: D1Database): Promise<void> {
  // D1 promises are request-scoped in Workers. Never cache this promise at module
  // scope: a later request would try to await I/O created by another request.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nickname TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, solo_xp INTEGER NOT NULL DEFAULT 0, multiplayer_xp INTEGER NOT NULL DEFAULT 0, solo_stage_index INTEGER NOT NULL DEFAULT 0, multiplayer_stage_index INTEGER NOT NULL DEFAULT 0, victories INTEGER NOT NULL DEFAULT 0, login_failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_results (match_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, play_mode TEXT NOT NULL CHECK (play_mode IN ('solo', 'multiplayer')), stage_index INTEGER NOT NULL, victory INTEGER NOT NULL CHECK (victory IN (0, 1)), xp_awarded INTEGER NOT NULL, elapsed_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (match_id, account_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_match_results_account ON match_results(account_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_customization (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, custom_points INTEGER NOT NULL DEFAULT 0 CHECK (custom_points >= 0), appearance TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_cosmetics (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, purchased_at INTEGER NOT NULL, PRIMARY KEY (account_id, item_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_cosmetics_account ON account_cosmetics(account_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_turret_loadouts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, skins TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`),
  ]);
  await ensureLegacyAuthColumns(db);
}

const bytesToText = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
const textToBytes = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

async function sha256(value: string): Promise<string> {
  return bytesToText(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function derivePassword(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return bytesToText(new Uint8Array(bits));
}

function encodePasswordHash(hash: string): string {
  return `${PASSWORD_SCHEME}$${PBKDF2_ITERATIONS}$${hash}`;
}

function decodePasswordHash(value: string): { hash: string; iterations: number } | null {
  const match = value.match(/^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const iterations = Number(match[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100_000) return null;
  return { iterations, hash: match[2] as string };
}

function secureEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }
  return difference === 0;
}

function profileFromRow(
  row: AccountRow,
  customization: CustomizationRow | null,
  purchasedCosmetics: string[],
  turretLoadout: TurretLoadoutRow | null,
): AccountProfile {
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
    customPoints: customization?.custom_points ?? 0,
    ownedCosmetics: [...new Set([...STARTER_COSMETICS, ...purchasedCosmetics])],
    appearance: normalizeAppearance(parseAppearance(customization?.appearance)),
    turretSkins: parseTurretSkins(turretLoadout?.skins),
    createdAt: row.created_at,
  };
}

function parseTurretSkins(value: string | undefined): TurretSkinLoadout {
  if (!value) return { ...DEFAULT_TURRET_SKINS };
  try {
    return normalizeTurretSkins(JSON.parse(value));
  } catch {
    return { ...DEFAULT_TURRET_SKINS };
  }
}

function parseAppearance(value: string | undefined): AvatarAppearance {
  if (!value) return { ...DEFAULT_APPEARANCE };
  try {
    return normalizeAppearance(JSON.parse(value));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

async function profileForRow(db: D1Database, row: AccountRow): Promise<AccountProfile> {
  const [customization, cosmetics, turretLoadout] = await Promise.all([
    db.prepare('SELECT custom_points, appearance FROM account_customization WHERE account_id = ?')
      .bind(row.id).first<CustomizationRow>(),
    db.prepare('SELECT item_id FROM account_cosmetics WHERE account_id = ? ORDER BY purchased_at ASC')
      .bind(row.id).all<{ item_id: string }>(),
    db.prepare('SELECT skins FROM account_turret_loadouts WHERE account_id = ?')
      .bind(row.id).first<TurretLoadoutRow>(),
  ]);
  return profileFromRow(row, customization, cosmetics.results?.map((item) => item.item_id) ?? [], turretLoadout);
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

async function prepareSession(): Promise<{ token: string; tokenHash: string; createdAt: number; expiresAt: number }> {
  const token = bytesToText(crypto.getRandomValues(new Uint8Array(32)));
  const createdAt = Date.now();
  return {
    token,
    tokenHash: await sha256(token),
    createdAt,
    expiresAt: createdAt + SESSION_MS,
  };
}

async function authenticatedProfileFromReadySchema(request: Request, db: D1Database): Promise<AccountProfile | null> {
  const row = await authenticatedRowFromReadySchema(request, db);
  return row ? profileForRow(db, row) : null;
}

async function authenticatedRowFromReadySchema(request: Request, db: D1Database): Promise<AccountRow | null> {
  const token = cookieValue(request);
  if (!token) return null;
  const row = await db.prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(token), Date.now()).first<AccountRow>();
  return row ?? null;
}

export async function getAuthenticatedProfile(request: Request, db: D1Database, bootstrapSchema = false): Promise<AccountProfile | null> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  return authenticatedProfileFromReadySchema(request, db);
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
  const existing = await db.prepare('SELECT id FROM accounts WHERE username = ?').bind(username).first<{ id: string }>();
  if (existing) return Response.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 409 });
  try {
    const passwordHash = encodePasswordHash(await derivePassword(password, salt));
    const session = await prepareSession();
    await db.batch([
      db.prepare(`INSERT INTO accounts (id, username, nickname, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, username, nickname, passwordHash, bytesToText(salt), now, now),
      db.prepare(`INSERT INTO account_customization (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
        .bind(id, JSON.stringify(DEFAULT_APPEARANCE), now),
      db.prepare(`INSERT INTO account_turret_loadouts (account_id, skins, updated_at) VALUES (?, ?, ?)`)
        .bind(id, JSON.stringify(DEFAULT_TURRET_SKINS), now),
      db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(session.tokenHash, id, session.expiresAt, session.createdAt),
    ]);
    const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
    return Response.json({ profile: await profileForRow(db, row as AccountRow) }, { headers: { 'set-cookie': sessionCookie(request, session.token, SESSION_MS / 1_000) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed[^\n]*accounts\.username/i.test(message)) {
      return Response.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 409 });
    }
    console.error('Account registration failed', error);
    return Response.json({ error: '계정 저장에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 503 });
  }
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
  const storedPassword = decodePasswordHash(row.password_hash);
  if (!storedPassword) {
    return Response.json({ error: '이 계정은 이전 개발용 암호 형식입니다. 계정을 다시 생성해주세요.' }, { status: 409 });
  }
  const valid = secureEqual(
    await derivePassword(password, textToBytes(row.password_salt), storedPassword.iterations),
    storedPassword.hash,
  );
  if (!valid) {
    const failures = row.login_failures + 1;
    await db.prepare('UPDATE accounts SET login_failures = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .bind(failures, failures >= 5 ? now + 10 * 60_000 : 0, now, row.id).run();
    return genericError();
  }
  await db.prepare('UPDATE accounts SET login_failures = 0, locked_until = 0, last_login_at = ?, updated_at = ? WHERE id = ?').bind(now, now, row.id).run();
  const token = await createSession(db, row.id);
  return Response.json({ profile: await profileForRow(db, row) }, { headers: { 'set-cookie': sessionCookie(request, token, SESSION_MS / 1_000) } });
}

async function logout(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const token = cookieValue(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie(request, '', 0) } });
}

async function customize(request: Request, db: D1Database, action: 'purchase' | 'equip'): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { itemId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '아이템을 확인해주세요.' }, { status: 400 }); }
  const item = cosmeticById(body.itemId ?? '');
  if (!item) return Response.json({ error: '존재하지 않는 커스텀 아이템입니다.' }, { status: 404 });
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO account_customization (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
    .bind(row.id, JSON.stringify(DEFAULT_APPEARANCE), now).run();
  await db.prepare(`INSERT OR IGNORE INTO account_turret_loadouts (account_id, skins, updated_at) VALUES (?, ?, ?)`)
    .bind(row.id, JSON.stringify(DEFAULT_TURRET_SKINS), now).run();
  const profile = await profileForRow(db, row);

  if (action === 'purchase') {
    if (item.unlock.kind !== 'points') return Response.json({ error: '이 아이템은 구매 대상이 아닙니다.' }, { status: 400 });
    if (profile.ownedCosmetics.includes(item.id)) return Response.json({ error: '이미 보유한 아이템입니다.' }, { status: 409 });
    if (profile.customPoints < item.unlock.price) return Response.json({ error: '커스텀 포인트가 부족합니다.' }, { status: 409 });
    const debit = await db.prepare('UPDATE account_customization SET custom_points = custom_points - ?, updated_at = ? WHERE account_id = ? AND custom_points >= ?')
      .bind(item.unlock.price, now, row.id, item.unlock.price).run();
    if ((debit.meta.changes ?? 0) === 0) return Response.json({ error: '커스텀 포인트가 부족합니다.' }, { status: 409 });
    try {
      await db.prepare('INSERT INTO account_cosmetics (account_id, item_id, purchased_at) VALUES (?, ?, ?)')
        .bind(row.id, item.id, now).run();
    } catch (error) {
      await db.prepare('UPDATE account_customization SET custom_points = custom_points + ?, updated_at = ? WHERE account_id = ?')
        .bind(item.unlock.price, now, row.id).run();
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed/i.test(message)) return Response.json({ error: '이미 보유한 아이템입니다.' }, { status: 409 });
      throw error;
    }
    return Response.json({ profile: await profileForRow(db, row) });
  }

  if (!cosmeticAvailable(item, profile.displayRank, profile.ownedCosmetics)) {
    const error = item.unlock.kind === 'rank'
      ? `${rankLabel(item.unlock.rank)} 등급 조건을 아직 달성하지 못했습니다.`
      : '먼저 아이템을 구매해주세요.';
    return Response.json({ error }, { status: 403 });
  }
  if (item.slot === 'turret' && item.turretKind) {
    const turretSkins = { ...profile.turretSkins, [item.turretKind as TurretKind]: item.id };
    await db.prepare('UPDATE account_turret_loadouts SET skins = ?, updated_at = ? WHERE account_id = ?')
      .bind(JSON.stringify(turretSkins), now, row.id).run();
  } else {
    const appearance = { ...profile.appearance, [item.slot as Exclude<CosmeticSlot, 'turret'>]: item.id };
    await db.prepare('UPDATE account_customization SET appearance = ?, updated_at = ? WHERE account_id = ?')
      .bind(JSON.stringify(appearance), now, row.id).run();
  }
  return Response.json({ profile: await profileForRow(db, row) });
}

export async function routeAuth(request: Request, db: D1Database, bootstrapSchema = false): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/customize/')) return null;
  try {
    if (bootstrapSchema) await ensureAuthSchema(db);
    if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, db);
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, db);
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, db);
    if (url.pathname === '/api/customize/purchase' && request.method === 'POST') return customize(request, db, 'purchase');
    if (url.pathname === '/api/customize/equip' && request.method === 'POST') return customize(request, db, 'equip');
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const profile = await authenticatedProfileFromReadySchema(request, db);
      return profile ? Response.json({ profile, stages: STAGES }) : Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    return Response.json({ error: '지원하지 않는 인증 요청입니다.' }, { status: 404 });
  } catch (error) {
    console.error('Auth request failed', error);
    return Response.json({ error: '인증 서버 처리에 실패했습니다. 잠시 후 다시 시도해주세요.' }, { status: 503 });
  }
}

export async function recordMatchResult(
  db: D1Database,
  input: { matchId: string; accountId: string; playMode: PlayMode; stageIndex: number; victory: boolean; elapsed: number },
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const stage = getStage(STAGES[input.stageIndex]?.id);
  const xp = input.victory ? stage.victoryXp : Math.max(10, Math.floor(stage.victoryXp * 0.18));
  const points = input.victory ? customizationReward(input.stageIndex) : 0;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO match_results (match_id, account_id, play_mode, stage_index, victory, xp_awarded, elapsed_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.matchId, input.accountId, input.playMode, input.stageIndex, input.victory ? 1 : 0, xp, Math.floor(input.elapsed), Date.now()).run();
  if ((inserted.meta.changes ?? 0) === 0) return;
  const xpColumn = input.playMode === 'solo' ? 'solo_xp' : 'multiplayer_xp';
  const stageColumn = input.playMode === 'solo' ? 'solo_stage_index' : 'multiplayer_stage_index';
  const nextStage = Math.min(STAGES.length - 1, input.stageIndex + (input.victory ? 1 : 0));
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE accounts SET ${xpColumn} = ${xpColumn} + ?, ${stageColumn} = MAX(${stageColumn}, ?), victories = victories + ?, updated_at = ? WHERE id = ?`)
      .bind(xp, nextStage, input.victory ? 1 : 0, now, input.accountId),
    db.prepare(`INSERT OR IGNORE INTO account_customization (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
      .bind(input.accountId, JSON.stringify(DEFAULT_APPEARANCE), now),
    db.prepare('UPDATE account_customization SET custom_points = custom_points + ?, updated_at = ? WHERE account_id = ?')
      .bind(points, now, input.accountId),
  ]);
}
