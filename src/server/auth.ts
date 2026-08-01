import { getStage, higherRank, rankedTierForRating, rankFromXp, rankLabel, STAGES } from '../shared/progression';
import { appearanceAfterCosmeticEquip, characterAvailable, cosmeticAvailable, cosmeticById, customizationReward, DEFAULT_APPEARANCE, DEFAULT_TURRET_SKINS, defaultSkinForCharacter, isDefaultSkinForCharacter, normalizeAppearance, normalizeTurretSkins, STARTER_COSMETICS } from '../shared/customization';
import { normalizeConsumableId, shopConsumableById } from '../shared/shopConsumables';
import type { AccountProfile, AvatarAppearance, ConsumableId, OwnedConsumable, PlayMode, ProfileDisplayMode, RankedTier, TurretKind, TurretSkinLoadout } from '../shared/types';
import { rankedContractScoreMultiplier, rankedRatingDelta, type RankedContributionSummary } from './rankedScoring';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const SESSION_COOKIE = 'midnight_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1_000;
const PASSWORD_SCHEME = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 100_000;
const PROFILE_AVATAR_MAX_BYTES = 72 * 1024;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const RANKED_SEASON_ZERO_KST = Date.UTC(2026, 6, 20, 0, 0, 0) - KST_OFFSET_MS;
/** Seasons intentionally use a predictable four-week cadence, not calendar months. */
const RANKED_SEASON_MS = 28 * 24 * 60 * 60 * 1_000;
const RANKED_CONTRACT_MS = 48 * 60 * 60 * 1_000;
const RANKED_CONTRACTS_PER_SEASON = 14;
const RANKED_SCORED_CONTRACTS_PER_SEASON = 8;
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const PROMOTION_IDS = new Set(['summer', 'cyberpunk', 'special-ops']);
const AD_FREE_ENTITLEMENT_ID = 'ad-removal';
const AD_FREE_MONTH_MS = 30 * 24 * 60 * 60 * 1_000;

/** Four-week seasons begin at Monday 00:00 KST. */
export function rankedSeasonId(now = Date.now()): string {
  const index = Math.max(1, Math.floor((now - RANKED_SEASON_ZERO_KST) / RANKED_SEASON_MS) + 1);
  return `S${index}`;
}

/** Contract windows are anchored to each four-week season, never to Unix time. */
export function rankedContractNumber(now = Date.now()): number {
  const seasonIndex = Math.max(0, Math.floor((now - RANKED_SEASON_ZERO_KST) / RANKED_SEASON_MS));
  const seasonStart = RANKED_SEASON_ZERO_KST + seasonIndex * RANKED_SEASON_MS;
  return Math.min(RANKED_CONTRACTS_PER_SEASON, Math.max(1, Math.floor((now - seasonStart) / RANKED_CONTRACT_MS) + 1));
}

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
  selected_play_mode?: string;
  profile_display_mode?: string;
  profile_avatar?: string;
  profile_avatar_updated_at?: number;
  ranked_rating?: number;
  ranked_season_id?: string;
  ranked_placement_count?: number;
  ranked_contracts_played?: number;
  tutorial_completed?: number;
  created_at: number;
}

interface CustomizationRow {
  custom_points: number;
  appearance: string;
}

interface TurretLoadoutRow {
  skins: string;
}

interface ConsumableRow {
  item_id: ConsumableId;
  quantity: number;
}

interface AdFreeEntitlementRow {
  plan: string;
  expires_at: number | null;
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
    ['selected_play_mode', `TEXT NOT NULL DEFAULT 'solo'`],
    ['profile_display_mode', `TEXT NOT NULL DEFAULT 'solo'`],
    ['profile_avatar', `TEXT NOT NULL DEFAULT ''`],
    ['profile_avatar_updated_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['ranked_rating', 'INTEGER NOT NULL DEFAULT 800'],
    ['ranked_season_id', `TEXT NOT NULL DEFAULT ''`],
    ['ranked_placement_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['ranked_contracts_played', 'INTEGER NOT NULL DEFAULT 0'],
    ['tutorial_completed', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const;
  const missing = definitions
    .filter(([column]) => !existing.has(column))
    .map(([column, definition]) => db.prepare(`ALTER TABLE accounts ADD COLUMN ${column} ${definition}`));
  if (missing.length > 0) await db.batch(missing);
}

async function ensureRankedResultColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(ranked_results)').all<{ name: string }>();
  const existing = new Set(columns.results?.map((row) => row.name) ?? []);
  const definitions = [
    ['rating_delta', 'INTEGER NOT NULL DEFAULT 0'],
    ['contribution_score', 'REAL NOT NULL DEFAULT 0'],
    ['contribution_rank', 'INTEGER NOT NULL DEFAULT 0'],
    ['participation_ratio', 'REAL NOT NULL DEFAULT 0'],
    ['died', 'INTEGER NOT NULL DEFAULT 0'],
    ['abandoned', 'INTEGER NOT NULL DEFAULT 0'],
    ['ghost_level', 'INTEGER NOT NULL DEFAULT 1'],
  ] as const;
  const missing = definitions
    .filter(([column]) => !existing.has(column))
    .map(([column, definition]) =>
      db.prepare(`ALTER TABLE ranked_results ADD COLUMN ${column} ${definition}`),
    );
  if (missing.length > 0) await db.batch(missing);
}

async function ensureMatchRewardColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(match_results)').all<{ name: string }>();
  const existing = new Set(columns.results?.map((row) => row.name) ?? []);
  const definitions = [
    ['reward_points', 'INTEGER NOT NULL DEFAULT 0'],
    ['reward_claimed_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['reward_multiplier', 'INTEGER NOT NULL DEFAULT 0'],
  ] as const;
  const missing = definitions
    .filter(([column]) => !existing.has(column))
    .map(([column, definition]) =>
      db.prepare(`ALTER TABLE match_results ADD COLUMN ${column} ${definition}`),
    );
  if (missing.length > 0) await db.batch(missing);
}

export async function ensureAuthSchema(db: D1Database): Promise<void> {
  // D1 promises are request-scoped in Workers. Never cache this promise at module
  // scope: a later request would try to await I/O created by another request.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, nickname TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, solo_xp INTEGER NOT NULL DEFAULT 0, multiplayer_xp INTEGER NOT NULL DEFAULT 0, solo_stage_index INTEGER NOT NULL DEFAULT 0, multiplayer_stage_index INTEGER NOT NULL DEFAULT 0, victories INTEGER NOT NULL DEFAULT 0, login_failures INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, selected_play_mode TEXT NOT NULL DEFAULT 'solo', profile_display_mode TEXT NOT NULL DEFAULT 'solo', profile_avatar TEXT NOT NULL DEFAULT '', profile_avatar_updated_at INTEGER NOT NULL DEFAULT 0, ranked_rating INTEGER NOT NULL DEFAULT 800, ranked_season_id TEXT NOT NULL DEFAULT '', ranked_placement_count INTEGER NOT NULL DEFAULT 0, ranked_contracts_played INTEGER NOT NULL DEFAULT 0, tutorial_completed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_identities (
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (provider, subject),
      UNIQUE (provider, account_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_identities_account ON account_identities(account_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS pending_google_signups (
      token_hash TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      suggested_name TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pending_google_signups_expiry ON pending_google_signups(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_nickname_registry (
      normalized_nickname TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_results (match_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, play_mode TEXT NOT NULL CHECK (play_mode IN ('solo', 'multiplayer')), stage_index INTEGER NOT NULL, victory INTEGER NOT NULL CHECK (victory IN (0, 1)), xp_awarded INTEGER NOT NULL, elapsed_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (match_id, account_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_match_results_account ON match_results(account_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_customization (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, custom_points INTEGER NOT NULL DEFAULT 0 CHECK (custom_points >= 0), appearance TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_cosmetics (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, purchased_at INTEGER NOT NULL, PRIMARY KEY (account_id, item_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_cosmetics_account ON account_cosmetics(account_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_turret_loadouts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, skins TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_consumables (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0), updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, item_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_consumables_account ON account_consumables(account_id, updated_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_promotion_dismissals (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      promotion_id TEXT NOT NULL,
      dismissed_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, promotion_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_promotion_dismissals_account ON account_promotion_dismissals(account_id, dismissed_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_entitlements (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      entitlement_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'mock',
      starts_at INTEGER NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, entitlement_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_entitlements_expiry ON account_entitlements(entitlement_id, expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_consumable_uses (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, used_at INTEGER NOT NULL, target TEXT NOT NULL DEFAULT '{}', UNIQUE (match_id, account_id, item_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_match_consumable_uses_match ON match_consumable_uses(match_id, account_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS ranked_results (match_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, season_id TEXT NOT NULL, contract_id TEXT NOT NULL, contract_number INTEGER NOT NULL, score INTEGER NOT NULL, victory INTEGER NOT NULL CHECK (victory IN (0, 1)), elapsed_seconds INTEGER NOT NULL, door_hp_ratio REAL NOT NULL, supplies_used INTEGER NOT NULL DEFAULT 0, rating_delta INTEGER NOT NULL DEFAULT 0, contribution_score REAL NOT NULL DEFAULT 0, contribution_rank INTEGER NOT NULL DEFAULT 0, participation_ratio REAL NOT NULL DEFAULT 0, died INTEGER NOT NULL DEFAULT 0, abandoned INTEGER NOT NULL DEFAULT 0, ghost_level INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, PRIMARY KEY (match_id, account_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ranked_results_season_score ON ranked_results(season_id, score DESC, created_at ASC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ranked_results_account ON ranked_results(account_id, season_id, created_at DESC)'),
  ]);
  await ensureLegacyAuthColumns(db);
  await ensureRankedResultColumns(db);
  await ensureMatchRewardColumns(db);
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_match_reward_claim
    AFTER UPDATE OF reward_claimed_at ON match_results
    WHEN OLD.reward_claimed_at = 0
      AND NEW.reward_claimed_at > 0
      AND NEW.victory = 1
      AND NEW.reward_points > 0
      AND NEW.reward_multiplier IN (1, 2)
    BEGIN
      UPDATE account_customization
      SET custom_points = custom_points + (NEW.reward_points * NEW.reward_multiplier),
          updated_at = NEW.reward_claimed_at
      WHERE account_id = NEW.account_id;
    END`).run();
  await db.prepare(`INSERT OR IGNORE INTO account_nickname_registry
    (normalized_nickname, account_id, created_at)
    SELECT lower(trim(nickname)), id, created_at FROM accounts
    WHERE length(trim(nickname)) BETWEEN 2 AND 12`).run();
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
  consumables: OwnedConsumable[],
  dismissedPromotionIds: string[],
  generalMatchCount: number,
  adFreeEntitlement: AdFreeEntitlementRow | null,
): AccountProfile {
  const soloRank = rankFromXp(row.solo_xp);
  const multiplayerRank = rankFromXp(row.multiplayer_xp);
  const displayRank = higherRank(soloRank, multiplayerRank);
  const ownedCosmetics = [...new Set([
    ...STARTER_COSMETICS,
    ...purchasedCosmetics.filter((itemId) => Boolean(cosmeticById(itemId))),
  ])];
  const requestedAppearance = normalizeAppearance(parseAppearance(customization?.appearance));
  const ownsRequestedSkin = isDefaultSkinForCharacter(
    requestedAppearance.skin,
    requestedAppearance.character,
  ) || (
    ownedCosmetics.includes(requestedAppearance.skin) &&
    characterAvailable(requestedAppearance.character, displayRank, ownedCosmetics)
  );
  const appearance = ownsRequestedSkin
    ? requestedAppearance
    : {
        ...requestedAppearance,
        skin: defaultSkinForCharacter(requestedAppearance.character),
      };
  const selectedPlayMode = row.selected_play_mode === 'multiplayer' || row.selected_play_mode === 'ranked'
    ? row.selected_play_mode
    : 'solo';
  const requestedProfileDisplayMode = row.profile_display_mode;
  const avatarUpdatedAt = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
  const profileAvatarUrl = row.profile_avatar && avatarUpdatedAt > 0
    ? `/api/profile-avatar/${encodeURIComponent(row.id)}?v=${avatarUpdatedAt}`
    : null;
  const currentSeason = rankedSeasonId();
  const seasonIsCurrent = row.ranked_season_id === currentSeason;
  const rankedRating = seasonIsCurrent ? Math.max(0, row.ranked_rating ?? 800) : 800;
  const rankedPlacements = seasonIsCurrent ? Math.max(0, row.ranked_placement_count ?? 0) : 0;
  const rankedContracts = seasonIsCurrent ? Math.max(0, row.ranked_contracts_played ?? 0) : 0;
  const profileDisplayMode: ProfileDisplayMode = requestedProfileDisplayMode === 'ranked' && rankedContracts > 0
    ? 'ranked'
    : requestedProfileDisplayMode === 'multiplayer'
      ? 'multiplayer'
      : 'solo';
  const normalizedConsumables = [...consumables.reduce((inventory, owned) => {
    const itemId = normalizeConsumableId(owned.itemId);
    if (itemId && owned.quantity > 0) {
      inventory.set(itemId, (inventory.get(itemId) ?? 0) + owned.quantity);
    }
    return inventory;
  }, new Map<ConsumableId, number>())].map(([itemId, quantity]) => ({ itemId, quantity }));
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    soloRank,
    multiplayerRank,
    displayRank,
    soloXp: row.solo_xp,
    multiplayerXp: row.multiplayer_xp,
    soloStageIndex: row.solo_stage_index,
    multiplayerStageIndex: row.multiplayer_stage_index,
    selectedPlayMode,
    profileDisplayMode,
    profileAvatarUrl,
    ranked: {
      seasonId: currentSeason,
      rating: rankedRating,
      tier: rankedTierForRating(rankedRating),
      placementCompleted: rankedPlacements,
      // Normal 5 is index 5, so the next unlocked index is 6 only after
      // that stage is actually cleared. Ranked matches never count here.
      eligible: row.solo_stage_index >= 6 && generalMatchCount >= 10,
      contractsPlayed: rankedContracts,
      bestContractScores: [],
    },
    victories: row.victories,
    customPoints: customization?.custom_points ?? 0,
    adFree: {
      active: adFreeEntitlement?.plan === 'permanent'
        || (
          adFreeEntitlement?.plan === 'monthly'
          && (adFreeEntitlement.expires_at ?? 0) > Date.now()
        ),
      plan: adFreeEntitlement?.plan === 'monthly' || adFreeEntitlement?.plan === 'permanent'
        ? adFreeEntitlement.plan
        : null,
      expiresAt: adFreeEntitlement?.expires_at ?? null,
    },
    // Old individual equipment purchases remain in the database for audit
    // purposes, but they are no longer part of an account's usable inventory.
    ownedCosmetics,
    appearance,
    turretSkins: parseTurretSkins(turretLoadout?.skins),
    consumables: normalizedConsumables,
    dismissedPromotionIds: [...new Set(dismissedPromotionIds.filter((promotionId) => PROMOTION_IDS.has(promotionId)))],
    tutorialCompleted: Boolean(row.tutorial_completed),
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
  const currentSeason = rankedSeasonId();
  if (row.ranked_season_id !== currentSeason) {
    await db.prepare(`UPDATE accounts
      SET ranked_season_id = ?, ranked_rating = 800, ranked_placement_count = 0,
        ranked_contracts_played = 0, updated_at = ?
      WHERE id = ?`).bind(currentSeason, Date.now(), row.id).run();
    row = {
      ...row,
      ranked_season_id: currentSeason,
      ranked_rating: 800,
      ranked_placement_count: 0,
      ranked_contracts_played: 0,
    };
  }
  const [customization, cosmetics, turretLoadout, consumables, dismissedPromotions, rankedScores, generalMatches, adFreeEntitlement] = await Promise.all([
    db.prepare('SELECT custom_points, appearance FROM account_customization WHERE account_id = ?')
      .bind(row.id).first<CustomizationRow>(),
    db.prepare('SELECT item_id FROM account_cosmetics WHERE account_id = ? ORDER BY purchased_at ASC')
      .bind(row.id).all<{ item_id: string }>(),
    db.prepare('SELECT skins FROM account_turret_loadouts WHERE account_id = ?')
      .bind(row.id).first<TurretLoadoutRow>(),
    db.prepare('SELECT item_id, quantity FROM account_consumables WHERE account_id = ? AND quantity > 0 ORDER BY updated_at DESC')
      .bind(row.id).all<ConsumableRow>(),
    db.prepare('SELECT promotion_id FROM account_promotion_dismissals WHERE account_id = ? ORDER BY dismissed_at DESC')
      .bind(row.id).all<{ promotion_id: string }>(),
    db.prepare(`WITH contract_attempts AS (
        SELECT score, created_at,
          ROW_NUMBER() OVER (PARTITION BY contract_id ORDER BY score DESC, created_at ASC) AS contract_rank
        FROM ranked_results
        WHERE account_id = ? AND season_id = ?
      )
      SELECT score FROM contract_attempts
      WHERE contract_rank = 1
      ORDER BY score DESC, created_at ASC
      LIMIT ${RANKED_SCORED_CONTRACTS_PER_SEASON}`)
      .bind(row.id, rankedSeasonId()).all<{ score: number }>(),
    db.prepare(`SELECT COUNT(*) AS count
      FROM match_results m
      WHERE m.account_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM ranked_results r
          WHERE r.match_id = m.match_id AND r.account_id = m.account_id
        )`).bind(row.id).first<{ count: number }>(),
    db.prepare(`SELECT plan, expires_at FROM account_entitlements
      WHERE account_id = ? AND entitlement_id = ?`)
      .bind(row.id, AD_FREE_ENTITLEMENT_ID).first<AdFreeEntitlementRow>(),
  ]);
  const profile = profileFromRow(
    row,
    customization,
    cosmetics.results?.map((item) => item.item_id) ?? [],
    turretLoadout,
    (consumables.results ?? []).map((item) => ({ itemId: item.item_id, quantity: item.quantity })),
    (dismissedPromotions.results ?? []).map((item) => item.promotion_id),
    Math.max(0, generalMatches?.count ?? 0),
    adFreeEntitlement,
  );
  profile.ranked.bestContractScores = (rankedScores.results ?? []).map((result) => result.score);
  return profile;
}

function sessionToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+([A-Za-z0-9_-]{20,200})$/i)?.[1];
  if (bearer) return bearer;
  const url = new URL(request.url);
  if (url.pathname.endsWith('/ws')) {
    const websocketToken = url.searchParams.get('nativeSession');
    if (websocketToken && /^[A-Za-z0-9_-]{20,200}$/.test(websocketToken)) return websocketToken;
  }
  const match = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

function sessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function checkOrigin(request: Request): boolean {
  if (request.headers.get('x-native-origin-verified') === '1') return true;
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function nativeSessionResponse(
  request: Request,
  profile: AccountProfile,
  token: string,
): Response {
  const native = request.headers.get('x-native-origin-verified') === '1';
  return Response.json(
    { status: 'authenticated', profile, ...(native ? { sessionToken: token } : {}) },
    { headers: { 'set-cookie': sessionCookie(request, token, SESSION_MS / 1_000) } },
  );
}

function normalizedNickname(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
}

function validatedNickname(value: string | undefined): { nickname: string; normalized: string } | null {
  const nickname = (value ?? '').normalize('NFKC').trim();
  if (nickname.length < 2 || nickname.length > 12 || /[\u0000-\u001f\u007f]/.test(nickname)) return null;
  return { nickname, normalized: normalizedNickname(nickname) };
}

function profileAvatarPayload(value: string): { mime: 'image/jpeg' | 'image/png' | 'image/webp'; encoded: string } | null {
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return null;
  const encoded = match[2] as string;
  const estimatedBytes = Math.floor((encoded.length * 3) / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes > PROFILE_AVATAR_MAX_BYTES) return null;
  return { mime: match[1] as 'image/jpeg' | 'image/png' | 'image/webp', encoded };
}

function decodeAvatarPayload(encoded: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
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
  const token = sessionToken(request);
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
  const nicknameInput = validatedNickname(body.nickname);
  const nickname = nicknameInput?.nickname ?? '';
  const password = body.password ?? '';
  if (!/^[a-z0-9_]{4,20}$/.test(username)) return Response.json({ error: '아이디는 영문 소문자, 숫자, 밑줄 4~20자로 입력하세요.' }, { status: 400 });
  if (!nicknameInput) return Response.json({ error: '닉네임은 2~12자로 입력하세요.' }, { status: 400 });
  if (password.length < 8 || password.length > 72) return Response.json({ error: '비밀번호는 8~72자로 입력하세요.' }, { status: 400 });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  const id = crypto.randomUUID();
  const existing = await db.prepare('SELECT id FROM accounts WHERE username = ?').bind(username).first<{ id: string }>();
  if (existing) return Response.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 409 });
  const nicknameOwner = await db.prepare('SELECT account_id FROM account_nickname_registry WHERE normalized_nickname = ?')
    .bind(nicknameInput.normalized).first<{ account_id: string }>();
  if (nicknameOwner) return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
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
      db.prepare(`INSERT INTO account_nickname_registry (normalized_nickname, account_id, created_at)
        VALUES (?, ?, ?)`).bind(nicknameInput.normalized, id, now),
      db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(session.tokenHash, id, session.expiresAt, session.createdAt),
    ]);
    const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
    return nativeSessionResponse(request, await profileForRow(db, row as AccountRow), session.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed[^\n]*accounts\.username/i.test(message)) {
      return Response.json({ error: '이미 사용 중인 아이디입니다.' }, { status: 409 });
    }
    if (/UNIQUE constraint failed[^\n]*account_nickname_registry/i.test(message)) {
      return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
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
  return nativeSessionResponse(request, await profileForRow(db, row), token);
}

async function logout(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const token = sessionToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return Response.json({ ok: true }, { headers: { 'set-cookie': sessionCookie(request, '', 0) } });
}

interface GoogleIdentityClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

async function googleLogin(
  request: Request,
  db: D1Database,
  googleClientId: string | undefined,
): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  if (!googleClientId) return Response.json({ error: 'Google 로그인이 서버에 설정되지 않았습니다.' }, { status: 503 });
  let body: { idToken?: string };
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Google 로그인 정보를 확인해주세요.' }, { status: 400 });
  }
  if (!body.idToken || body.idToken.length > 8_192) {
    return Response.json({ error: 'Google ID 토큰이 올바르지 않습니다.' }, { status: 400 });
  }

  let claims: GoogleIdentityClaims;
  try {
    const verified = await jwtVerify(body.idToken, GOOGLE_JWKS, {
      audience: googleClientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    claims = verified.payload as unknown as GoogleIdentityClaims;
  } catch (error) {
    console.warn('Google ID token verification failed', error);
    return Response.json({ error: 'Google 계정을 확인하지 못했습니다.' }, { status: 401 });
  }
  if (!claims.sub || !claims.email || claims.email_verified !== true) {
    return Response.json({ error: '확인된 Google 계정이 필요합니다.' }, { status: 401 });
  }

  const identity = await db.prepare(`SELECT a.* FROM account_identities i
    JOIN accounts a ON a.id = i.account_id
    WHERE i.provider = 'google' AND i.subject = ?`)
    .bind(claims.sub).first<AccountRow>();
  if (!identity) {
    const signupToken = bytesToText(crypto.getRandomValues(new Uint8Array(32)));
    const now = Date.now();
    const suggestedName = (claims.name?.normalize('NFKC').trim() || claims.email.split('@')[0] || '새 생존자').slice(0, 12);
    await db.batch([
      db.prepare('DELETE FROM pending_google_signups WHERE expires_at <= ? OR subject = ?')
        .bind(now, claims.sub),
      db.prepare(`INSERT INTO pending_google_signups
        (token_hash, subject, email, suggested_name, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(await sha256(signupToken), claims.sub, claims.email, suggestedName, now + 15 * 60_000, now),
    ]);
    return Response.json({
      status: 'nickname-required',
      signupToken,
      suggestedNickname: suggestedName,
    });
  }

  const now = Date.now();
  await db.prepare('UPDATE accounts SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, identity.id).run();
  const token = await createSession(db, identity.id);
  return nativeSessionResponse(request, await profileForRow(db, identity), token);
}

async function completeGoogleSignup(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  let body: { signupToken?: string; nickname?: string };
  try { body = await request.json(); } catch {
    return Response.json({ error: '가입 정보를 확인해주세요.' }, { status: 400 });
  }
  if (!body.signupToken || !/^[A-Za-z0-9_-]{20,200}$/.test(body.signupToken)) {
    return Response.json({ error: 'Google 가입 인증이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 });
  }
  const nicknameInput = validatedNickname(body.nickname);
  if (!nicknameInput) {
    return Response.json({ error: '닉네임은 2~12자로 입력하세요.' }, { status: 400 });
  }
  const now = Date.now();
  const pending = await db.prepare(`SELECT subject, email FROM pending_google_signups
    WHERE token_hash = ? AND expires_at > ?`)
    .bind(await sha256(body.signupToken), now)
    .first<{ subject: string; email: string }>();
  if (!pending) {
    return Response.json({ error: 'Google 가입 인증이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 });
  }
  const duplicate = await db.prepare('SELECT account_id FROM account_nickname_registry WHERE normalized_nickname = ?')
    .bind(nicknameInput.normalized).first<{ account_id: string }>();
  if (duplicate) {
    return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
  }

  const accountId = crypto.randomUUID();
  const username = `g_${(await sha256(pending.subject)).slice(0, 18)}`;
  const session = await prepareSession();
  try {
    await db.batch([
      db.prepare(`INSERT INTO accounts
        (id, username, nickname, password_hash, password_salt, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, '', '', ?, ?, ?)`)
        .bind(accountId, username, nicknameInput.nickname, now, now, now),
      db.prepare(`INSERT INTO account_identities (provider, subject, account_id, created_at)
        VALUES ('google', ?, ?, ?)`).bind(pending.subject, accountId, now),
      db.prepare(`INSERT INTO account_nickname_registry (normalized_nickname, account_id, created_at)
        VALUES (?, ?, ?)`).bind(nicknameInput.normalized, accountId, now),
      db.prepare(`INSERT INTO account_customization (account_id, custom_points, appearance, updated_at)
        VALUES (?, 0, ?, ?)`).bind(accountId, JSON.stringify(DEFAULT_APPEARANCE), now),
      db.prepare(`INSERT INTO account_turret_loadouts (account_id, skins, updated_at)
        VALUES (?, ?, ?)`).bind(accountId, JSON.stringify(DEFAULT_TURRET_SKINS), now),
      db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(session.tokenHash, accountId, session.expiresAt, session.createdAt),
      db.prepare('DELETE FROM pending_google_signups WHERE subject = ?').bind(pending.subject),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed[^\n]*(account_nickname_registry|accounts\.nickname)/i.test(message)) {
      return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
    }
    console.error('Google account creation failed', error);
    return Response.json({ error: 'Google 계정을 게임 계정에 연결하지 못했습니다.' }, { status: 503 });
  }
  const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first<AccountRow>();
  return nativeSessionResponse(request, await profileForRow(db, row as AccountRow), session.token);
}

async function checkNicknameAvailability(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { nickname?: string };
  try { body = await request.json(); } catch {
    return Response.json({ error: '닉네임을 확인해주세요.' }, { status: 400 });
  }
  const input = validatedNickname(body.nickname);
  if (!input) return Response.json({ error: '닉네임은 2~12자로 입력하세요.' }, { status: 400 });
  const owner = await db.prepare(
    'SELECT account_id FROM account_nickname_registry WHERE normalized_nickname = ?',
  ).bind(input.normalized).first<{ account_id: string }>();
  return Response.json({
    nickname: input.nickname,
    available: !owner || owner.account_id === row.id,
  });
}

async function setNickname(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { nickname?: string };
  try { body = await request.json(); } catch {
    return Response.json({ error: '닉네임을 확인해주세요.' }, { status: 400 });
  }
  const input = validatedNickname(body.nickname);
  if (!input) return Response.json({ error: '닉네임은 2~12자로 입력하세요.' }, { status: 400 });
  const owner = await db.prepare(
    'SELECT account_id FROM account_nickname_registry WHERE normalized_nickname = ?',
  ).bind(input.normalized).first<{ account_id: string }>();
  if (owner && owner.account_id !== row.id)
    return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
  const now = Date.now();
  try {
    await db.batch([
      db.prepare('DELETE FROM account_nickname_registry WHERE account_id = ?').bind(row.id),
      db.prepare(`INSERT INTO account_nickname_registry
        (normalized_nickname, account_id, created_at) VALUES (?, ?, ?)`)
        .bind(input.normalized, row.id, now),
      db.prepare('UPDATE accounts SET nickname = ?, updated_at = ? WHERE id = ?')
        .bind(input.nickname, now, row.id),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed[^\n]*(account_nickname_registry|accounts\.nickname)/i.test(message))
      return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
    throw error;
  }
  const updated = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(row.id).first<AccountRow>();
  return Response.json({ profile: await profileForRow(db, updated ?? { ...row, nickname: input.nickname }) });
}

async function setSelectedPlayMode(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { playMode?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '플레이 방식을 확인해주세요.' }, { status: 400 }); }
  if (body.playMode !== 'solo' && body.playMode !== 'multiplayer' && body.playMode !== 'ranked')
    return Response.json({ error: '지원하지 않는 플레이 방식입니다.' }, { status: 400 });
  await db.prepare('UPDATE accounts SET selected_play_mode = ?, updated_at = ? WHERE id = ?')
    .bind(body.playMode, Date.now(), row.id).run();
  const updated = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(row.id).first<AccountRow>();
  return Response.json({ profile: await profileForRow(db, updated ?? row) });
}

async function setProfileDisplayMode(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { displayMode?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '표시할 등급을 확인해주세요.' }, { status: 400 }); }
  if (body.displayMode !== 'solo' && body.displayMode !== 'multiplayer' && body.displayMode !== 'ranked')
    return Response.json({ error: '지원하지 않는 등급 표시입니다.' }, { status: 400 });
  if (body.displayMode === 'ranked') {
    const currentProfile = await profileForRow(db, row);
    if (currentProfile.ranked.contractsPlayed < 1)
      return Response.json({ error: '첫 랭크전을 완료한 뒤부터 랭크 라벨을 선택할 수 있습니다.' }, { status: 400 });
  }
  await db.prepare('UPDATE accounts SET profile_display_mode = ?, updated_at = ? WHERE id = ?')
    .bind(body.displayMode, Date.now(), row.id).run();
  const updated = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(row.id).first<AccountRow>();
  return Response.json({ profile: await profileForRow(db, updated ?? row) });
}

async function setProfileAvatar(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { avatarData?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: '프로필 사진을 확인해주세요.' }, { status: 400 }); }
  const avatarData = body.avatarData;
  if (avatarData !== null && typeof avatarData !== 'string')
    return Response.json({ error: '프로필 사진 형식이 올바르지 않습니다.' }, { status: 400 });
  if (typeof avatarData === 'string' && !profileAvatarPayload(avatarData))
    return Response.json({ error: '사진은 72KB 이하의 JPEG, PNG 또는 WebP여야 합니다.' }, { status: 400 });
  const now = Date.now();
  await db.prepare('UPDATE accounts SET profile_avatar = ?, profile_avatar_updated_at = ?, updated_at = ? WHERE id = ?')
    .bind(avatarData ?? '', now, now, row.id).run();
  const updated = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(row.id).first<AccountRow>();
  return Response.json({ profile: await profileForRow(db, updated ?? row) });
}

async function dismissPromotion(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { promotionId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: '이벤트 정보를 확인해주세요.' }, { status: 400 }); }
  if (typeof body.promotionId !== 'string' || !PROMOTION_IDS.has(body.promotionId))
    return Response.json({ error: '지원하지 않는 이벤트입니다.' }, { status: 400 });
  await db.prepare(`INSERT OR IGNORE INTO account_promotion_dismissals
    (account_id, promotion_id, dismissed_at) VALUES (?, ?, ?)`)
    .bind(row.id, body.promotionId, Date.now()).run();
  return Response.json({ profile: await profileForRow(db, row) });
}

/**
 * Player portraits are intentionally tiny, validated images.  Profile photos
 * are public in rooms, so this endpoint is unauthenticated but only returns
 * a pre-validated account asset and never proxies arbitrary URLs.
 */
export async function profileAvatarResponse(
  db: D1Database,
  accountId: string,
  bootstrapSchema = false,
): Promise<Response> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const row = await db.prepare('SELECT profile_avatar FROM accounts WHERE id = ?')
    .bind(accountId).first<{ profile_avatar: string }>();
  const payload = row?.profile_avatar ? profileAvatarPayload(row.profile_avatar) : null;
  if (!payload) return new Response(null, { status: 404 });
  const bytes = decodeAvatarPayload(payload.encoded);
  if (!bytes) return new Response(null, { status: 404 });
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-type': payload.mime,
      'cache-control': 'public, max-age=604800, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
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
    if (item.slot === 'skin' && (!item.characterId || !characterAvailable(item.characterId, profile.displayRank, profile.ownedCosmetics))) {
      return Response.json({ error: '먼저 이 스킨의 캐릭터를 보유해야 합니다.' }, { status: 403 });
    }
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
    const appearance = appearanceAfterCosmeticEquip(profile.appearance, item);
    await db.prepare('UPDATE account_customization SET appearance = ?, updated_at = ? WHERE account_id = ?')
      .bind(JSON.stringify(appearance), now, row.id).run();
  }
  return Response.json({ profile: await profileForRow(db, row) });
}

async function purchaseConsumable(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { itemId?: string; quantity?: number };
  try { body = await request.json(); } catch { return Response.json({ error: '아이템을 확인해주세요.' }, { status: 400 }); }
  const item = shopConsumableById(body.itemId ?? '');
  const quantity = body.quantity === 5 ? 5 : body.quantity === 1 ? 1 : 0;
  if (!item || !quantity) return Response.json({ error: '구매할 전술 보급을 확인해주세요.' }, { status: 404 });
  const total = item.price * quantity;
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO account_customization (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
    .bind(row.id, JSON.stringify(DEFAULT_APPEARANCE), now).run();
  const current = await db.prepare('SELECT custom_points FROM account_customization WHERE account_id = ?')
    .bind(row.id).first<{ custom_points: number }>();
  if ((current?.custom_points ?? 0) < total) return Response.json({ error: '커스텀 포인트가 부족합니다.' }, { status: 409 });
  try {
    // 첫 UPDATE의 CHECK 제약이 실패하면 batch 전체가 되돌아가므로 포인트와
    // 재고가 어긋나지 않는다. 클라이언트 잔액은 신뢰하지 않는다.
    await db.batch([
      db.prepare('UPDATE account_customization SET custom_points = custom_points - ?, updated_at = ? WHERE account_id = ?')
        .bind(total, now, row.id),
      db.prepare(`INSERT INTO account_consumables (account_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`)
        .bind(row.id, item.id, quantity, now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/CHECK constraint failed|constraint/i.test(message)) {
      return Response.json({ error: '커스텀 포인트가 부족합니다.' }, { status: 409 });
    }
    throw error;
  }
  return Response.json({ profile: await profileForRow(db, row) });
}

/**
 * 게임 방에서 실제 사용에 성공할 때만 한 판 1회 기록과 계정 재고 차감을
 * 같은 D1 batch로 처리한다. 같은 match/account/item 재전송은 새 UUID가
 * 기록되지 않아 차감도 일어나지 않는다.
 */
export async function consumeMatchConsumable(
  db: D1Database,
  input: { matchId: string; accountId: string; itemId: ConsumableId; target: unknown },
  bootstrapSchema = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const item = shopConsumableById(input.itemId);
  if (!item) return { ok: false, error: '존재하지 않는 전술 보급입니다.' };
  const useId = crypto.randomUUID();
  const now = Date.now();
  const target = JSON.stringify(input.target).slice(0, 1_500);
  const [record, decrement] = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO match_consumable_uses (id, match_id, account_id, item_id, used_at, target)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM account_consumables
        WHERE account_id = ? AND item_id = ? AND quantity > 0
      )`)
      .bind(useId, input.matchId, input.accountId, item.id, now, target, input.accountId, item.id),
    db.prepare(`UPDATE account_consumables SET quantity = quantity - 1, updated_at = ?
      WHERE account_id = ? AND item_id = ? AND quantity > 0
      AND EXISTS (SELECT 1 FROM match_consumable_uses WHERE id = ?)`)
      .bind(now, input.accountId, item.id, useId),
  ]);
  if ((record?.meta.changes ?? 0) === 1 && (decrement?.meta.changes ?? 0) === 1) return { ok: true };
  if ((record?.meta.changes ?? 0) === 1) {
    await db.prepare('DELETE FROM match_consumable_uses WHERE id = ?').bind(useId).run();
  }
  return { ok: false, error: '보급 재고가 없거나 이번 판에 이미 사용했습니다.' };
}

async function purchaseMockAdFree(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) {
    return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  }
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '광고 제거 상품을 확인해주세요.' }, { status: 400 });
  }
  if (body.plan !== 'monthly' && body.plan !== 'permanent') {
    return Response.json({ error: '지원하지 않는 광고 제거 상품입니다.' }, { status: 400 });
  }

  const now = Date.now();
  const current = await db.prepare(`SELECT plan, expires_at FROM account_entitlements
    WHERE account_id = ? AND entitlement_id = ?`)
    .bind(row.id, AD_FREE_ENTITLEMENT_ID)
    .first<AdFreeEntitlementRow>();
  if (current?.plan === 'permanent') {
    return Response.json({ profile: await profileForRow(db, row) });
  }
  const expiresAt = body.plan === 'monthly'
    ? Math.max(now, current?.expires_at ?? 0) + AD_FREE_MONTH_MS
    : null;
  await db.prepare(`INSERT INTO account_entitlements
      (account_id, entitlement_id, plan, source, starts_at, expires_at, updated_at)
    VALUES (?, ?, ?, 'mock', ?, ?, ?)
    ON CONFLICT(account_id, entitlement_id) DO UPDATE SET
      plan = excluded.plan,
      source = excluded.source,
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at`)
    .bind(row.id, AD_FREE_ENTITLEMENT_ID, body.plan, now, expiresAt, now)
    .run();
  return Response.json({ profile: await profileForRow(db, row) });
}

async function claimMatchReward(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) {
    return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  }
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { matchId?: string; multiplier?: number; rewardedAdCompleted?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '전리품 요청을 확인해주세요.' }, { status: 400 });
  }
  const matchId = body.matchId?.trim() ?? '';
  const multiplier = body.multiplier === 2 ? 2 : body.multiplier === 1 ? 1 : 0;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(matchId) || multiplier === 0) {
    return Response.json({ error: '전리품 요청이 올바르지 않습니다.' }, { status: 400 });
  }

  const entitlement = await db.prepare(`SELECT plan, expires_at FROM account_entitlements
    WHERE account_id = ? AND entitlement_id = ?`)
    .bind(row.id, AD_FREE_ENTITLEMENT_ID)
    .first<AdFreeEntitlementRow>();
  const adFreeActive = entitlement?.plan === 'permanent'
    || (entitlement?.plan === 'monthly' && (entitlement.expires_at ?? 0) > Date.now());
  // Native AdMob SSV must replace this temporary client completion flag before
  // paid production launch. Ad-free accounts never need an ad completion flag.
  if (multiplier === 2 && !adFreeActive && body.rewardedAdCompleted !== true) {
    return Response.json({ error: '보상형 광고를 끝까지 시청해야 2배 전리품을 받을 수 있습니다.' }, { status: 409 });
  }

  const match = await db.prepare(`SELECT victory, reward_points, reward_claimed_at,
      reward_multiplier
    FROM match_results
    WHERE match_id = ? AND account_id = ?`)
    .bind(matchId, row.id)
    .first<{
      victory: number;
      reward_points: number;
      reward_claimed_at: number;
      reward_multiplier: number;
    }>();
  if (!match) {
    return Response.json(
      { error: '전리품 정산이 아직 끝나지 않았습니다. 잠시 후 다시 시도해주세요.' },
      { status: 404 },
    );
  }
  if (match.victory !== 1 || match.reward_points <= 0) {
    return Response.json({ error: '수령할 승리 전리품이 없습니다.' }, { status: 409 });
  }

  const now = Date.now();
  // The result event and the reward claim can arrive on separate requests.
  // Ensure the wallet row exists before the trigger credits points so a fast
  // claim can never be marked complete without actually paying the player.
  await db.prepare(`INSERT OR IGNORE INTO account_customization
      (account_id, custom_points, appearance, updated_at)
    VALUES (?, 0, ?, ?)`)
    .bind(row.id, JSON.stringify(DEFAULT_APPEARANCE), now)
    .run();
  const claimed = await db.prepare(`UPDATE match_results
    SET reward_claimed_at = ?, reward_multiplier = ?
    WHERE match_id = ? AND account_id = ? AND reward_claimed_at = 0`)
    .bind(now, multiplier, matchId, row.id)
    .run();
  const finalMatch = (claimed.meta.changes ?? 0) === 1
    ? { ...match, reward_claimed_at: now, reward_multiplier: multiplier }
    : await db.prepare(`SELECT victory, reward_points, reward_claimed_at,
          reward_multiplier
        FROM match_results
        WHERE match_id = ? AND account_id = ?`)
      .bind(matchId, row.id)
      .first<{
        victory: number;
        reward_points: number;
        reward_claimed_at: number;
        reward_multiplier: number;
      }>();
  if (!finalMatch || finalMatch.reward_claimed_at <= 0) {
    return Response.json({ error: '전리품 지급 상태를 확인하지 못했습니다.' }, { status: 503 });
  }
  const appliedMultiplier = finalMatch.reward_multiplier === 2 ? 2 : 1;
  return Response.json({
    profile: await profileForRow(db, row),
    pointsAwarded: finalMatch.reward_points * appliedMultiplier,
    multiplier: appliedMultiplier,
    alreadyClaimed: (claimed.meta.changes ?? 0) === 0,
  });
}

export async function routeAuth(
  request: Request,
  db: D1Database,
  bootstrapSchema = false,
  googleClientId?: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith('/api/auth/')
    && !url.pathname.startsWith('/api/customize/')
    && !url.pathname.startsWith('/api/shop/')
    && !url.pathname.startsWith('/api/rewards/')
    && !url.pathname.startsWith('/api/entitlements/')
  ) return null;
  try {
    if (url.pathname === '/api/auth/google/config' && request.method === 'GET') {
      if (!googleClientId) {
        return Response.json(
          { error: 'Google 로그인이 서버에 설정되지 않았습니다.' },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        );
      }
      return Response.json(
        { clientId: googleClientId },
        { headers: { 'cache-control': 'public, max-age=300' } },
      );
    }
    if (bootstrapSchema) await ensureAuthSchema(db);
    if (url.pathname === '/api/auth/register' && request.method === 'POST') return register(request, db);
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, db);
    if (url.pathname === '/api/auth/google' && request.method === 'POST') return googleLogin(request, db, googleClientId);
    if (url.pathname === '/api/auth/google/complete' && request.method === 'POST') return completeGoogleSignup(request, db);
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, db);
    if (url.pathname === '/api/auth/nickname/check' && request.method === 'POST') return checkNicknameAvailability(request, db);
    if (url.pathname === '/api/auth/nickname' && request.method === 'POST') return setNickname(request, db);
    if (url.pathname === '/api/auth/play-mode' && request.method === 'POST') return setSelectedPlayMode(request, db);
    if (url.pathname === '/api/auth/profile-display' && request.method === 'POST') return setProfileDisplayMode(request, db);
    if (url.pathname === '/api/auth/profile-avatar' && request.method === 'POST') return setProfileAvatar(request, db);
    if (url.pathname === '/api/auth/promotion-dismissals' && request.method === 'POST') return dismissPromotion(request, db);
    if (url.pathname === '/api/customize/purchase' && request.method === 'POST') return customize(request, db, 'purchase');
    if (url.pathname === '/api/customize/equip' && request.method === 'POST') return customize(request, db, 'equip');
    if (url.pathname === '/api/shop/consumables/purchase' && request.method === 'POST') return purchaseConsumable(request, db);
    if (url.pathname === '/api/rewards/match/claim' && request.method === 'POST') return claimMatchReward(request, db);
    if (url.pathname === '/api/entitlements/ad-free/purchase' && request.method === 'POST') return purchaseMockAdFree(request, db);
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
  input: { matchId: string; accountId: string; playMode: PlayMode; stageId?: string; stageIndex: number; victory: boolean; elapsed: number; timeAttack?: boolean },
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const tutorialMatch = input.stageId === 'tutorial-1';
  const stage = getStage(input.stageId ?? STAGES[input.stageIndex]?.id);
  const baseXp = input.victory ? stage.victoryXp : Math.max(10, Math.floor(stage.victoryXp * 0.18));
  const basePoints = input.victory
    ? tutorialMatch
      ? 100
      : customizationReward(input.stageIndex)
    : 0;
  // The 35% event bonus is awarded only for a successful Time Attack clear.
  const eventBonus = input.victory && input.timeAttack ? 1.35 : 1;
  const xp = Math.round(baseXp * eventBonus);
  const points = Math.round(basePoints * eventBonus);
  const now = Date.now();
  const rewardClaimedAt = tutorialMatch && input.victory ? now : 0;
  const rewardMultiplier = tutorialMatch && input.victory ? 1 : 0;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO match_results (
      match_id, account_id, play_mode, stage_index, victory, xp_awarded,
      elapsed_seconds, reward_points, reward_claimed_at, reward_multiplier,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.matchId,
      input.accountId,
      input.playMode,
      input.stageIndex,
      input.victory ? 1 : 0,
      xp,
      Math.floor(input.elapsed),
      points,
      rewardClaimedAt,
      rewardMultiplier,
      now,
    ).run();
  if ((inserted.meta.changes ?? 0) === 0) return;
  const xpColumn = input.playMode === 'solo' ? 'solo_xp' : 'multiplayer_xp';
  const stageColumn = input.playMode === 'solo' ? 'solo_stage_index' : 'multiplayer_stage_index';
  const nextStage = tutorialMatch
    ? 0
    : Math.min(STAGES.length - 1, input.stageIndex + (input.victory ? 1 : 0));
  await db.batch([
    db.prepare(`UPDATE accounts SET ${xpColumn} = ${xpColumn} + ?, ${stageColumn} = MAX(${stageColumn}, ?), victories = victories + ?, tutorial_completed = MAX(tutorial_completed, ?), updated_at = ? WHERE id = ?`)
      .bind(xp, nextStage, input.victory ? 1 : 0, tutorialMatch && input.victory ? 1 : 0, now, input.accountId),
    db.prepare(`INSERT OR IGNORE INTO account_customization (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
      .bind(input.accountId, JSON.stringify(DEFAULT_APPEARANCE), now),
    db.prepare('UPDATE account_customization SET custom_points = custom_points + ?, updated_at = ? WHERE account_id = ?')
      .bind(tutorialMatch ? points : 0, now, input.accountId),
  ]);
}

export async function recordRankedMatchResult(
  db: D1Database,
  input: {
    matchId: string;
    accountId: string;
    seasonId: string;
    contractId: string;
    contractNumber: number;
    victory: boolean;
    elapsed: number;
    doorHpRatio: number;
    suppliesUsed: number;
    ghostLevel: number;
    contribution: RankedContributionSummary;
  },
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const safeDoorHp = Math.max(0, Math.min(1, input.doorHpRatio));
  const timeScore = Math.max(0, 1_200 - Math.floor(input.elapsed * 2));
  const baseScore = Math.max(
    0,
    (input.victory ? 7_500 : 1_200) +
      timeScore +
      Math.round(safeDoorHp * 1_000) -
      input.suppliesUsed * 180,
  );
  const score = Math.round(
    baseScore *
      rankedContractScoreMultiplier({
        contributionScore: input.contribution.score,
        participationRatio: input.contribution.participationRatio,
        died: input.contribution.died,
        abandoned: input.contribution.abandoned,
      }),
  );
  const placementBeforeResult = await db.prepare(
    'SELECT ranked_placement_count FROM accounts WHERE id = ?',
  ).bind(input.accountId).first<{ ranked_placement_count: number }>();
  const ratingDelta = rankedRatingDelta({
    victory: input.victory,
    doorHpRatio: safeDoorHp,
    ghostLevel: input.ghostLevel,
    contributionScore: input.contribution.score,
    contributionRank: input.contribution.rank,
    participantCount: input.contribution.participantCount,
    participationRatio: input.contribution.participationRatio,
    died: input.contribution.died,
    abandoned: input.contribution.abandoned,
    placementCompleted: Math.max(0, Math.min(5, placementBeforeResult?.ranked_placement_count ?? 0)),
  });
  const previousBest = await db.prepare(`SELECT MAX(score) AS score, COUNT(*) AS attempts
    FROM ranked_results
    WHERE account_id = ? AND season_id = ? AND contract_id = ?`)
    .bind(input.accountId, input.seasonId, input.contractId)
    .first<{ score: number | null; attempts: number }>();
  const inserted = await db.prepare(`INSERT OR IGNORE INTO ranked_results (
      match_id, account_id, season_id, contract_id, contract_number, score,
      victory, elapsed_seconds, door_hp_ratio, supplies_used, rating_delta,
      contribution_score, contribution_rank, participation_ratio, died,
      abandoned, ghost_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.matchId,
      input.accountId,
      input.seasonId,
      input.contractId,
      input.contractNumber,
      score,
      input.victory ? 1 : 0,
      Math.floor(input.elapsed),
      safeDoorHp,
      input.suppliesUsed,
      ratingDelta,
      input.contribution.score,
      input.contribution.rank,
      input.contribution.participationRatio,
      input.contribution.died ? 1 : 0,
      input.contribution.abandoned ? 1 : 0,
      input.ghostLevel,
      Date.now(),
    ).run();
  if ((inserted.meta.changes ?? 0) === 0) return;
  const firstAttemptForContract = (previousBest?.attempts ?? 0) === 0;
  const now = Date.now();
  // RP is a per-match consequence, not a best-contract consequence. A death
  // or abandon must therefore be applied even when this attempt does not
  // improve the contract score used by the season leaderboard.
  await db.prepare(`UPDATE accounts
    SET ranked_season_id = ?, ranked_rating = MAX(0, ranked_rating + ?),
      ranked_placement_count = MIN(5, ranked_placement_count + 1),
      ranked_contracts_played = ranked_contracts_played + ?, updated_at = ?
    WHERE id = ?`)
    .bind(
      input.seasonId,
      ratingDelta,
      firstAttemptForContract ? 1 : 0,
      now,
      input.accountId,
    ).run();
}

export interface RankedLeaderboardEntry {
  avatarUrl: string | null;
  nickname: string;
  rank: number;
  rating: number;
  tier: RankedTier;
}

export async function rankedLeaderboard(
  db: D1Database,
  seasonId = rankedSeasonId(),
): Promise<RankedLeaderboardEntry[]> {
  const rows = await db.prepare(`WITH contract_attempts AS (
      SELECT r.account_id, r.contract_id, r.score, r.created_at,
        ROW_NUMBER() OVER (PARTITION BY r.account_id, r.contract_id ORDER BY r.score DESC, r.created_at ASC) AS contract_rank
      FROM ranked_results r
      WHERE r.season_id = ?
    ), scored AS (
      SELECT account_id, score, created_at,
        ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY score DESC, created_at ASC) AS score_rank
      FROM contract_attempts
      WHERE contract_rank = 1
    ), totals AS (
      SELECT account_id, SUM(score) AS score, MIN(created_at) AS attained_at
      FROM scored
      WHERE score_rank <= ${RANKED_SCORED_CONTRACTS_PER_SEASON}
      GROUP BY account_id
    )
    SELECT a.id AS account_id, a.nickname AS nickname, a.profile_avatar AS profile_avatar,
      a.profile_avatar_updated_at AS profile_avatar_updated_at, a.ranked_rating AS ranked_rating
    FROM totals JOIN accounts a ON a.id = totals.account_id
    ORDER BY totals.score DESC, totals.attained_at ASC
    LIMIT 50`).bind(seasonId).all<{
      account_id: string;
      nickname: string;
      profile_avatar: string;
      profile_avatar_updated_at: number;
      ranked_rating: number;
    }>();
  return (rows.results ?? []).map((row, index) => {
    const avatarUpdatedAt = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
    const hasAvatar = Boolean(row.profile_avatar) && avatarUpdatedAt > 0;
    const rating = Math.max(0, row.ranked_rating ?? 800);
    return {
      avatarUrl: hasAvatar
        ? `/api/profile-avatar/${encodeURIComponent(row.account_id)}?v=${avatarUpdatedAt}`
        : null,
      nickname: row.nickname,
      rank: index + 1,
      rating,
      tier: rankedTierForRating(rating),
    };
  });
}
