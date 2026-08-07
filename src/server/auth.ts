import { getStage, higherRank, rankedTierForRating, rankFromXp, rankLabel, STAGES } from '../shared/progression';
import { appearanceAfterCosmeticEquip, characterAvailable, cosmeticAvailable, cosmeticById, customizationReward, DEFAULT_APPEARANCE, DEFAULT_TURRET_SKINS, defaultSkinForCharacter, isDefaultSkinForCharacter, normalizeAppearance, normalizeTurretSkins, STARTER_COSMETICS } from '../shared/customization';
import { normalizeConsumableId, shopConsumableById } from '../shared/shopConsumables';
import type { AccountProfile, AvatarAppearance, ConsumableId, OwnedConsumable, PlayMode, ProfileDisplayMode, PromotionCampaignId, PromotionCampaignSetting, RankedTier, StorefrontThemeId, StorefrontThemeSetting, TurretKind, TurretSkinLoadout } from '../shared/types';
import { rankedContractScoreMultiplier, rankedRatingDelta, type RankedContributionSummary } from './rankedScoring';
import { claimEventMissionRewards, ensureEventMissionSchema, eventMissionOverview, recordLoginMissionProgress, recordRankedCompletionMissionProgress, recordStageClearMissionProgress } from './eventMissions';
import { claimAttendanceReward, redeemAttendancePremiumChoice } from './attendanceRewards';
import { hideSeekVictoryPoints, type HideSeekResultReason, type HideSeekRole } from '../shared/hideSeek';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { BASIC_PROFILE_FRAME_ID, duplicatePointRefund, GHOST_ORB_CASH_COST, GHOST_ORB_DRAW_TABLE, GHOST_ORB_PACKAGE_COST, GHOST_ORB_PITY_DRAWS, ghostOrbEligibleCosmetics, MOONLIT_PHANTOM_SKIN_ID, PRESTIGE_PACKAGES, prestigeAccessoryById, prestigeAccessoryIdsForPackages, prestigeEmoteById, prestigePackageById } from '../shared/prestige';
import { CASH_PRODUCT_BY_ID, cashGrantAmount, firstCashPurchaseBonus } from '../shared/storeProducts';
import { presentationById } from '../shared/presentation';

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
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const PROMOTION_IDS = new Set(['hide-seek-release', 'summer', 'cyberpunk', 'special-ops']);
const STOREFRONT_THEMES = [
  {
    id: 'summer', label: '여름 테마', sortOrder: 20,
    cosmeticIds: [
      'skin-look-puppy-surfer', 'skin-look-tiger-lifeguard',
      'tile-wave-surfer', 'tile-beach-lifeguard',
      'turret-basic-surfer-water', 'turret-basic-lifeguard-parasol',
    ],
  },
  {
    id: 'cyberpunk', label: '사이버펑크 테마', sortOrder: 30,
    cosmeticIds: [
      'skin-look-cat-neon-rider', 'skin-look-hamster-cyber-driver',
      'tile-cyberpunk-neon', 'turret-basic-cyberpunk-laser',
    ],
  },
  {
    id: 'special-ops', label: '특수수사본부 테마', sortOrder: 10,
    cosmeticIds: [
      'skin-look-crocodile-police-enforcer', 'skin-look-monkey-secret-agent',
      'tile-special-ops-headquarters', 'turret-basic-special-ops-tracker',
    ],
  },
] as const;
const AD_FREE_ENTITLEMENT_ID = 'ad-removal';
const AD_FREE_MONTH_MS = 30 * 24 * 60 * 60 * 1_000;
const RANDOM_BOX_DAILY_FREE = 10;
const RANDOM_BOX_REFILL_AMOUNT = 5;
const RANDOM_BOX_MAX_REFILLS = 2;

function kstDayKey(now = Date.now()): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

const publicPrestigeProfileImageUrl = (profileImageId: string | null | undefined): string | null => {
  if (profileImageId === 'profile-image-moonlit-phantom-fox')
    return '/assets/profile-images/moonlit-phantom-fox.webp?v=prestige-v2';
  if (profileImageId === 'profile-image-starlit-cloud-rabbit')
    return '/assets/profile-images/starlit-cloud-rabbit.webp?v=prestige-v2';
  if (profileImageId === 'profile-image-abyssal-knight-gorilla')
    return '/assets/profile-images/abyssal-knight-gorilla.webp?v=prestige-v2';
  return null;
};

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

interface CashWalletRow {
  cash_balance: number;
}

interface CashFirstPurchaseRow {
  product_id: string;
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

interface PromotionCampaignRow {
  id: PromotionCampaignId;
  is_visible: number;
  sort_order: number;
}

interface StorefrontThemeRow {
  id: StorefrontThemeId;
  is_store_visible: number;
  sort_order: number;
  cosmetic_id: string | null;
  item_order: number | null;
}

interface PrestigeWalletRow {
  ghost_orbs: number;
  pity_draw_count: number;
}

interface PrestigeLoadoutRow {
  profile_image_id: string | null;
  profile_frame_id: string | null;
  emote_ids: string;
}

interface PrestigeEffectLoadoutRow {
  nameplate_id: string | null;
  home_aura_id: string | null;
}

interface RandomBoxDailyRow {
  remaining_count: number;
  refills_claimed: number;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS pending_apple_signups (
      token_hash TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      suggested_name TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_pending_apple_signups_expiry ON pending_apple_signups(expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_nickname_registry (
      normalized_nickname TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS match_results (match_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, play_mode TEXT NOT NULL CHECK (play_mode IN ('solo', 'multiplayer')), stage_index INTEGER NOT NULL, victory INTEGER NOT NULL CHECK (victory IN (0, 1)), xp_awarded INTEGER NOT NULL, elapsed_seconds INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (match_id, account_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_match_results_account ON match_results(account_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS hide_seek_results (
      match_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('ghost', 'survivor')),
      victory INTEGER NOT NULL CHECK (victory IN (0, 1)),
      completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
      abandoned INTEGER NOT NULL DEFAULT 0 CHECK (abandoned IN (0, 1)),
      elapsed_seconds INTEGER NOT NULL,
      reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
      reward_claimed_at INTEGER NOT NULL DEFAULT 0,
      reward_multiplier INTEGER NOT NULL DEFAULT 0 CHECK (reward_multiplier IN (0, 1, 2)),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (match_id, account_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_hide_seek_results_account ON hide_seek_results(account_id, created_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_customization (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, custom_points INTEGER NOT NULL DEFAULT 0 CHECK (custom_points >= 0), appearance TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_cash_wallets (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, cash_balance INTEGER NOT NULL DEFAULT 0 CHECK (cash_balance >= 0), updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_cash_first_purchase_rewards (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, product_id TEXT NOT NULL, claim_token TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (account_id, product_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_cosmetics (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, purchased_at INTEGER NOT NULL, PRIMARY KEY (account_id, item_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_cosmetics_account ON account_cosmetics(account_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_turret_loadouts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, skins TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_prestige_wallets (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, ghost_orbs INTEGER NOT NULL DEFAULT 0 CHECK (ghost_orbs >= 0), pity_draw_count INTEGER NOT NULL DEFAULT 0 CHECK (pity_draw_count >= 0), total_draw_count INTEGER NOT NULL DEFAULT 0 CHECK (total_draw_count >= 0), updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_prestige_packages (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, package_id TEXT NOT NULL, acquired_at INTEGER NOT NULL, PRIMARY KEY (account_id, package_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_prestige_loadouts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, profile_image_id TEXT, profile_frame_id TEXT, emote_ids TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_prestige_effect_loadouts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, nameplate_id TEXT, home_aura_id TEXT, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_prestige_accessories (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, accessory_id TEXT NOT NULL, acquired_at INTEGER NOT NULL, PRIMARY KEY (account_id, accessory_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_random_box_daily (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      remaining_count INTEGER NOT NULL DEFAULT 10 CHECK (remaining_count >= 0),
      refills_claimed INTEGER NOT NULL DEFAULT 0 CHECK (refills_claimed BETWEEN 0 AND 2),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, period_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_consumables (account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0), updated_at INTEGER NOT NULL, PRIMARY KEY (account_id, item_id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_consumables_account ON account_consumables(account_id, updated_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_promotion_dismissals (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      promotion_id TEXT NOT NULL,
      dismissed_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, promotion_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_account_promotion_dismissals_account ON account_promotion_dismissals(account_id, dismissed_at DESC)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS promotion_campaigns (
      id TEXT PRIMARY KEY,
      is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_promotion_campaigns_listing ON promotion_campaigns(is_visible, sort_order, id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cosmetic_theme_settings (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      is_store_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_store_visible IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS cosmetic_theme_items (
      theme_id TEXT NOT NULL REFERENCES cosmetic_theme_settings(id) ON DELETE CASCADE,
      cosmetic_id TEXT NOT NULL,
      item_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (theme_id, cosmetic_id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cosmetic_theme_items_cosmetic ON cosmetic_theme_items(cosmetic_id, theme_id)'),
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
  await ensureEventMissionSchema(db);
  const configNow = Date.now();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO promotion_campaigns
      (id, is_visible, sort_order, updated_at) VALUES ('hide-seek-release', 1, 0, ?)`)
      .bind(configNow),
    ...STOREFRONT_THEMES.map((theme) => db.prepare(`INSERT OR IGNORE INTO promotion_campaigns
      (id, is_visible, sort_order, updated_at) VALUES (?, 1, ?, ?)`)
      .bind(theme.id, theme.sortOrder, configNow)),
    ...STOREFRONT_THEMES.map((theme) => db.prepare(`INSERT OR IGNORE INTO cosmetic_theme_settings
      (id, label, is_store_visible, sort_order, updated_at) VALUES (?, ?, 1, ?, ?)`)
      .bind(theme.id, theme.label, theme.sortOrder, configNow)),
    ...STOREFRONT_THEMES.flatMap((theme) => theme.cosmeticIds.map((cosmeticId, itemOrder) =>
      db.prepare(`INSERT OR IGNORE INTO cosmetic_theme_items
        (theme_id, cosmetic_id, item_order) VALUES (?, ?, ?)`)
        .bind(theme.id, cosmeticId, itemOrder))),
  ]);
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
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_hide_seek_reward_claim
    AFTER UPDATE OF reward_claimed_at ON hide_seek_results
    WHEN OLD.reward_claimed_at = 0
      AND NEW.reward_claimed_at > 0
      AND NEW.completed = 1
      AND NEW.abandoned = 0
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
  promotionCampaigns: PromotionCampaignSetting[],
  storefrontThemes: StorefrontThemeSetting[],
  prestigeWallet: PrestigeWalletRow | null,
  prestigePackages: string[],
  purchasedPrestigeAccessoryIds: string[],
  prestigeLoadout: PrestigeLoadoutRow | null,
  prestigeEffectLoadout: PrestigeEffectLoadoutRow | null,
  cashWallet: CashWalletRow | null,
  cashFirstPurchaseProductIds: string[],
  randomBoxDaily: RandomBoxDailyRow | null,
  randomBoxPeriodKey: string,
): AccountProfile {
  const soloRank = rankFromXp(row.solo_xp);
  const multiplayerRank = rankFromXp(row.multiplayer_xp);
  const displayRank = higherRank(soloRank, multiplayerRank);
  const ownedPrestigePackages = PRESTIGE_PACKAGES.filter((entry) => prestigePackages.includes(entry.id));
  const ownedPrestigeAccessoryIds = [...new Set([
    ...prestigeAccessoryIdsForPackages(prestigePackages),
    ...purchasedPrestigeAccessoryIds.filter((id) => Boolean(prestigeAccessoryById(id) || presentationById(id))),
  ])];
  const ownedCosmetics = [...new Set([
    ...STARTER_COSMETICS,
    ...purchasedCosmetics.filter((itemId) => Boolean(cosmeticById(itemId))),
    ...ownedPrestigePackages.flatMap((entry) => entry.cosmeticIds),
  ])];
  const requestedAppearance = normalizeAppearance(parseAppearance(customization?.appearance));
  const requestedCharacterAvailable = characterAvailable(
    requestedAppearance.character,
    displayRank,
    ownedCosmetics,
  );
  const availableAppearance = requestedCharacterAvailable
    ? requestedAppearance
    : DEFAULT_APPEARANCE;
  const requestedSkin = cosmeticById(availableAppearance.skin);
  const ownsRequestedSkin = isDefaultSkinForCharacter(
    availableAppearance.skin,
    availableAppearance.character,
  ) || (
    ownedCosmetics.includes(availableAppearance.skin) &&
    requestedSkin?.slot === 'skin' &&
    requestedSkin.characterId === availableAppearance.character
  );
  const appearance = ownsRequestedSkin
    ? availableAppearance
    : {
        ...availableAppearance,
        skin: defaultSkinForCharacter(availableAppearance.character),
      };
  const selectedPlayMode = row.selected_play_mode === 'multiplayer' || row.selected_play_mode === 'ranked'
    ? row.selected_play_mode
    : 'solo';
  const requestedProfileDisplayMode = row.profile_display_mode;
  const avatarUpdatedAt = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
  const profileAvatarUrl = row.profile_avatar && avatarUpdatedAt > 0
    ? `/api/profile-avatar/${encodeURIComponent(row.id)}?v=${avatarUpdatedAt}`
    : null;
  const requestedProfileImageId = prestigeLoadout?.profile_image_id ?? null;
  const profileImageId = requestedProfileImageId && ownedPrestigeAccessoryIds.includes(requestedProfileImageId)
    ? requestedProfileImageId
    : null;
  const requestedProfileFrameId = prestigeLoadout?.profile_frame_id ?? BASIC_PROFILE_FRAME_ID;
  const profileFrameId = requestedProfileFrameId === BASIC_PROFILE_FRAME_ID
    || ownedPrestigeAccessoryIds.includes(requestedProfileFrameId)
      ? requestedProfileFrameId
      : BASIC_PROFILE_FRAME_ID;
  const requestedNameplateId = prestigeEffectLoadout?.nameplate_id ?? null;
  const nameplateId = requestedNameplateId && ownedPrestigeAccessoryIds.includes(requestedNameplateId)
    ? requestedNameplateId
    : null;
  const requestedHomeBackgroundId = prestigeEffectLoadout?.home_aura_id ?? null;
  const homeBackgroundId = requestedHomeBackgroundId && ownedPrestigeAccessoryIds.includes(requestedHomeBackgroundId)
    ? requestedHomeBackgroundId
    : null;
  let equippedEmoteIds: string[] = [];
  try {
    const parsed = JSON.parse(prestigeLoadout?.emote_ids ?? '[]');
    if (Array.isArray(parsed)) equippedEmoteIds = parsed.filter((id): id is string =>
      typeof id === 'string' && ownedPrestigeAccessoryIds.includes(id) && Boolean(prestigeEmoteById(id)),
    ).slice(0, 4);
  } catch { equippedEmoteIds = []; }
  const selectedProfileAvatarUrl = profileImageId
    ? profileImageId === 'profile-image-moonlit-phantom-fox'
      ? '/assets/profile-images/moonlit-phantom-fox.webp?v=prestige-v2'
      : profileImageId === 'profile-image-starlit-cloud-rabbit'
        ? '/assets/profile-images/starlit-cloud-rabbit.webp?v=prestige-v2'
        : '/assets/profile-images/abyssal-knight-gorilla.webp?v=prestige-v2'
    : profileAvatarUrl;
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
    profileAvatarUrl: selectedProfileAvatarUrl,
    uploadedProfileAvatarUrl: profileAvatarUrl,
    prestige: {
      ghostOrbs: Math.max(0, prestigeWallet?.ghost_orbs ?? 0),
      pityDrawCount: Math.max(0, prestigeWallet?.pity_draw_count ?? 0),
      ownedPackageIds: [...new Set(prestigePackages)],
      profileImageId,
      profileFrameId,
      nameplateId,
      homeBackgroundId,
      ownedAccessoryIds: ownedPrestigeAccessoryIds,
      ownedEmoteIds: ownedPrestigeAccessoryIds.filter((id) => Boolean(prestigeEmoteById(id))),
      equippedEmoteIds,
    },
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
    cash: Math.max(0, cashWallet?.cash_balance ?? 0),
    cashFirstPurchaseProductIds,
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
    randomBoxes: {
      remaining: Math.max(0, randomBoxDaily?.remaining_count ?? RANDOM_BOX_DAILY_FREE),
      refillsClaimed: Math.max(0, randomBoxDaily?.refills_claimed ?? 0),
      maxRefills: RANDOM_BOX_MAX_REFILLS,
      refillAmount: RANDOM_BOX_REFILL_AMOUNT,
      periodKey: randomBoxPeriodKey,
    },
    dismissedPromotionIds: [...new Set(dismissedPromotionIds.filter((promotionId) => PROMOTION_IDS.has(promotionId)))],
    promotionCampaigns,
    storefrontThemes,
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
  // These reads form one coherent profile and are used together by login,
  // room admission, the shop and the event screens. A D1 batch keeps the
  // database work identical while collapsing ten binding round trips into one.
  const randomBoxPeriodKey = kstDayKey();
  await db.prepare(`INSERT OR IGNORE INTO account_random_box_daily
      (account_id, period_key, remaining_count, refills_claimed, updated_at)
    VALUES (?, ?, ?, 0, ?)`)
    .bind(row.id, randomBoxPeriodKey, RANDOM_BOX_DAILY_FREE, Date.now()).run();
  const profileResults = await db.batch([
    db.prepare('SELECT custom_points, appearance FROM account_customization WHERE account_id = ?')
      .bind(row.id),
    db.prepare('SELECT item_id FROM account_cosmetics WHERE account_id = ? ORDER BY purchased_at ASC')
      .bind(row.id),
    db.prepare('SELECT skins FROM account_turret_loadouts WHERE account_id = ?')
      .bind(row.id),
    db.prepare('SELECT item_id, quantity FROM account_consumables WHERE account_id = ? AND quantity > 0 ORDER BY updated_at DESC')
      .bind(row.id),
    db.prepare('SELECT promotion_id FROM account_promotion_dismissals WHERE account_id = ? ORDER BY dismissed_at DESC')
      .bind(row.id),
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
      .bind(row.id, rankedSeasonId()),
    db.prepare(`SELECT COUNT(*) AS count
      FROM match_results m
      WHERE m.account_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM ranked_results r
          WHERE r.match_id = m.match_id AND r.account_id = m.account_id
        )`).bind(row.id),
    db.prepare(`SELECT plan, expires_at FROM account_entitlements
      WHERE account_id = ? AND entitlement_id = ?`)
      .bind(row.id, AD_FREE_ENTITLEMENT_ID),
    db.prepare(`SELECT id, is_visible, sort_order FROM promotion_campaigns
      ORDER BY sort_order ASC, id ASC`),
    db.prepare(`SELECT s.id, s.is_store_visible, s.sort_order,
        i.cosmetic_id, i.item_order
      FROM cosmetic_theme_settings s
      LEFT JOIN cosmetic_theme_items i ON i.theme_id = s.id
      ORDER BY s.sort_order ASC, s.id ASC, i.item_order ASC, i.cosmetic_id ASC`),
    db.prepare('SELECT ghost_orbs, pity_draw_count FROM account_prestige_wallets WHERE account_id = ?')
      .bind(row.id),
    db.prepare('SELECT package_id FROM account_prestige_packages WHERE account_id = ? ORDER BY acquired_at ASC')
      .bind(row.id),
    db.prepare('SELECT accessory_id FROM account_prestige_accessories WHERE account_id = ? ORDER BY acquired_at ASC')
      .bind(row.id),
    db.prepare('SELECT profile_image_id, profile_frame_id, emote_ids FROM account_prestige_loadouts WHERE account_id = ?')
      .bind(row.id),
    db.prepare('SELECT nameplate_id, home_aura_id FROM account_prestige_effect_loadouts WHERE account_id = ?')
      .bind(row.id),
    db.prepare('SELECT cash_balance FROM account_cash_wallets WHERE account_id = ?')
      .bind(row.id),
    db.prepare('SELECT product_id FROM account_cash_first_purchase_rewards WHERE account_id = ?')
      .bind(row.id),
    db.prepare(`SELECT remaining_count, refills_claimed FROM account_random_box_daily
      WHERE account_id = ? AND period_key = ?`).bind(row.id, randomBoxPeriodKey),
  ]);
  const customizationResult = profileResults[0]!;
  const cosmetics = profileResults[1]!;
  const turretLoadoutResult = profileResults[2]!;
  const consumables = profileResults[3]!;
  const dismissedPromotions = profileResults[4]!;
  const rankedScores = profileResults[5]!;
  const generalMatchesResult = profileResults[6]!;
  const adFreeEntitlementResult = profileResults[7]!;
  const promotionCampaignRows = profileResults[8]!;
  const storefrontThemeRows = profileResults[9]!;
  const prestigeWalletResult = profileResults[10]!;
  const prestigePackagesResult = profileResults[11]!;
  const prestigeAccessoriesResult = profileResults[12]!;
  const prestigeLoadoutResult = profileResults[13]!;
  const prestigeEffectLoadoutResult = profileResults[14]!;
  const cashWalletResult = profileResults[15]!;
  const cashFirstPurchaseResult = profileResults[16]!;
  const randomBoxDailyResult = profileResults[17]!;
  const customization = (customizationResult.results?.[0] as CustomizationRow | undefined) ?? null;
  const cashWallet = (cashWalletResult.results?.[0] as CashWalletRow | undefined) ?? null;
  const cashFirstPurchaseProductIds = (cashFirstPurchaseResult.results ?? [])
    .map((item) => (item as CashFirstPurchaseRow).product_id)
    .filter((productId) => CASH_PRODUCT_BY_ID.has(productId));
  const turretLoadout = (turretLoadoutResult.results?.[0] as TurretLoadoutRow | undefined) ?? null;
  const generalMatches = generalMatchesResult.results?.[0] as { count: number } | undefined;
  const adFreeEntitlement = (adFreeEntitlementResult.results?.[0] as AdFreeEntitlementRow | undefined) ?? null;
  const generalMatchCount = Math.max(0, generalMatches?.count ?? 0);
  if (
    !row.tutorial_completed &&
    (
      row.solo_xp > 0 ||
      row.multiplayer_xp > 0 ||
      row.solo_stage_index > 0 ||
      row.multiplayer_stage_index > 0 ||
      row.victories > 0 ||
      generalMatchCount > 0
    )
  ) {
    // Some long-lived production accounts missed the historical backfill.
    // Repair them while loading the authoritative profile so an experienced
    // account can never be routed back into the first-match tutorial.
    await db.prepare(`UPDATE accounts
      SET tutorial_completed = 1, updated_at = ?
      WHERE id = ? AND tutorial_completed = 0`)
      .bind(Date.now(), row.id).run();
    row = { ...row, tutorial_completed: 1 };
  }
  const profile = profileFromRow(
    row,
    customization,
    (cosmetics.results ?? []).map((item) => (item as { item_id: string }).item_id),
    turretLoadout,
    (consumables.results ?? []).map((item) => ({
      itemId: (item as ConsumableRow).item_id,
      quantity: (item as ConsumableRow).quantity,
    })),
    (dismissedPromotions.results ?? []).map((item) => (item as { promotion_id: string }).promotion_id),
    generalMatchCount,
    adFreeEntitlement,
    ((promotionCampaignRows.results ?? []) as PromotionCampaignRow[])
      .filter((campaign) => PROMOTION_IDS.has(campaign.id))
      .map((campaign) => ({
        id: campaign.id,
        isVisible: campaign.is_visible === 1,
        sortOrder: campaign.sort_order,
      })),
    [...((storefrontThemeRows.results ?? []) as StorefrontThemeRow[]).reduce((themes, row) => {
      if (!PROMOTION_IDS.has(row.id)) return themes;
      const existing = themes.get(row.id) ?? {
        id: row.id,
        isStoreVisible: row.is_store_visible === 1,
        sortOrder: row.sort_order,
        cosmeticIds: [],
      };
      if (row.cosmetic_id) existing.cosmeticIds.push(row.cosmetic_id);
      themes.set(row.id, existing);
      return themes;
    }, new Map<StorefrontThemeId, StorefrontThemeSetting>()).values()],
    (prestigeWalletResult.results?.[0] as PrestigeWalletRow | undefined) ?? null,
    (prestigePackagesResult.results ?? []).map((item) => (item as { package_id: string }).package_id),
    (prestigeAccessoriesResult.results ?? []).map((item) => (item as { accessory_id: string }).accessory_id),
    (prestigeLoadoutResult.results?.[0] as PrestigeLoadoutRow | undefined) ?? null,
    (prestigeEffectLoadoutResult.results?.[0] as PrestigeEffectLoadoutRow | undefined) ?? null,
    cashWallet,
    cashFirstPurchaseProductIds,
    (randomBoxDailyResult.results?.[0] as RandomBoxDailyRow | undefined) ?? null,
    randomBoxPeriodKey,
  );
  profile.ranked.bestContractScores = (rankedScores.results ?? []).map((result) => (result as { score: number }).score);
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

function friendCodeFor(accountId: string): string {
  return `FD-${accountId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
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

async function register(
  request: Request,
  db: D1Database,
  completeTutorial = false,
): Promise<Response> {
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
      db.prepare(`INSERT INTO accounts (id, username, nickname, password_hash, password_salt, friend_code, tutorial_completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, username, nickname, passwordHash, bytesToText(salt), friendCodeFor(id), completeTutorial ? 1 : 0, now, now),
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
    await recordLoginMissionProgress(db, id, now);
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
  await recordLoginMissionProgress(db, row.id, now);
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
  await recordLoginMissionProgress(db, identity.id, now);
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
        (id, username, nickname, password_hash, password_salt, friend_code, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, '', '', ?, ?, ?, ?)`)
        .bind(accountId, username, nicknameInput.nickname, friendCodeFor(accountId), now, now, now),
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
  await recordLoginMissionProgress(db, accountId, now);
  return nativeSessionResponse(request, await profileForRow(db, row as AccountRow), session.token);
}

interface AppleIdentityClaims {
  sub: string;
  email?: string;
  email_verified?: boolean | 'true' | 'false';
}

async function appleLogin(request: Request, db: D1Database, appleClientId: string | undefined): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  if (!appleClientId) return Response.json({ error: 'Apple 로그인이 서버에 설정되지 않았습니다.' }, { status: 503 });
  let body: { idToken?: string; displayName?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Apple 로그인 정보를 확인해주세요.' }, { status: 400 }); }
  if (!body.idToken || body.idToken.length > 8_192) return Response.json({ error: 'Apple ID 토큰이 올바르지 않습니다.' }, { status: 400 });

  let claims: AppleIdentityClaims;
  try {
    const verified = await jwtVerify(body.idToken, APPLE_JWKS, {
      audience: appleClientId,
      issuer: 'https://appleid.apple.com',
    });
    claims = verified.payload as unknown as AppleIdentityClaims;
  } catch (error) {
    console.warn('Apple ID token verification failed', error);
    return Response.json({ error: 'Apple 계정을 확인하지 못했습니다.' }, { status: 401 });
  }
  const verifiedEmail = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.sub) return Response.json({ error: 'Apple 계정 식별자를 확인하지 못했습니다.' }, { status: 401 });

  const identity = await db.prepare(`SELECT a.* FROM account_identities i
    JOIN accounts a ON a.id = i.account_id WHERE i.provider = 'apple' AND i.subject = ?`)
    .bind(claims.sub).first<AccountRow>();
  const now = Date.now();
  if (identity) {
    await db.prepare('UPDATE accounts SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(now, now, identity.id).run();
    await recordLoginMissionProgress(db, identity.id, now);
    const token = await createSession(db, identity.id);
    return nativeSessionResponse(request, await profileForRow(db, identity), token);
  }
  // Apple only supplies the private relay email on the first authorization.
  // Refuse an incomplete first credential instead of creating an un-recoverable account.
  if (!claims.email || !verifiedEmail) return Response.json({ error: '처음 Apple 로그인 시 이메일 공유를 허용해주세요.' }, { status: 401 });
  const signupToken = bytesToText(crypto.getRandomValues(new Uint8Array(32)));
  const suggestedName = (body.displayName?.normalize('NFKC').trim() || claims.email.split('@')[0] || '새 생존자').slice(0, 12);
  await db.batch([
    db.prepare('DELETE FROM pending_apple_signups WHERE expires_at <= ? OR subject = ?').bind(now, claims.sub),
    db.prepare(`INSERT INTO pending_apple_signups (token_hash, subject, email, suggested_name, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(await sha256(signupToken), claims.sub, claims.email, suggestedName, now + 15 * 60_000, now),
  ]);
  return Response.json({ status: 'nickname-required', signupToken, suggestedNickname: suggestedName });
}

async function completeAppleSignup(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  let body: { signupToken?: string; nickname?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '가입 정보를 확인해주세요.' }, { status: 400 }); }
  if (!body.signupToken || !/^[A-Za-z0-9_-]{20,200}$/.test(body.signupToken)) return Response.json({ error: 'Apple 가입 인증이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 });
  const nicknameInput = validatedNickname(body.nickname);
  if (!nicknameInput) return Response.json({ error: '닉네임은 2~12자로 입력하세요.' }, { status: 400 });
  const now = Date.now();
  const pending = await db.prepare(`SELECT subject FROM pending_apple_signups WHERE token_hash = ? AND expires_at > ?`)
    .bind(await sha256(body.signupToken), now).first<{ subject: string }>();
  if (!pending) return Response.json({ error: 'Apple 가입 인증이 만료되었습니다. 다시 로그인해주세요.' }, { status: 401 });
  const duplicate = await db.prepare('SELECT account_id FROM account_nickname_registry WHERE normalized_nickname = ?')
    .bind(nicknameInput.normalized).first<{ account_id: string }>();
  if (duplicate) return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
  const accountId = crypto.randomUUID();
  const session = await prepareSession();
  try {
    await db.batch([
      db.prepare(`INSERT INTO accounts (id, username, nickname, password_hash, password_salt, friend_code, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, '', '', ?, ?, ?, ?)`)
        .bind(accountId, `a_${(await sha256(pending.subject)).slice(0, 18)}`, nicknameInput.nickname, friendCodeFor(accountId), now, now, now),
      db.prepare(`INSERT INTO account_identities (provider, subject, account_id, created_at) VALUES ('apple', ?, ?, ?)`)
        .bind(pending.subject, accountId, now),
      db.prepare(`INSERT INTO account_nickname_registry (normalized_nickname, account_id, created_at) VALUES (?, ?, ?)`)
        .bind(nicknameInput.normalized, accountId, now),
      db.prepare(`INSERT INTO account_customization (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
        .bind(accountId, JSON.stringify(DEFAULT_APPEARANCE), now),
      db.prepare(`INSERT INTO account_turret_loadouts (account_id, skins, updated_at) VALUES (?, ?, ?)`)
        .bind(accountId, JSON.stringify(DEFAULT_TURRET_SKINS), now),
      db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .bind(session.tokenHash, accountId, session.expiresAt, session.createdAt),
      db.prepare('DELETE FROM pending_apple_signups WHERE subject = ?').bind(pending.subject),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed[\s\S]*(account_nickname_registry|accounts\.nickname)/i.test(message)) return Response.json({ error: '이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.' }, { status: 409 });
    console.error('Apple account creation failed', error);
    return Response.json({ error: 'Apple 계정을 게임 계정에 연결하지 못했습니다.' }, { status: 503 });
  }
  const row = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first<AccountRow>();
  await recordLoginMissionProgress(db, accountId, now);
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
    if (item.unlock.kind !== 'points' && item.unlock.kind !== 'cash') return Response.json({ error: '이 아이템은 구매 대상이 아닙니다.' }, { status: 400 });
    const hiddenTheme = profile.storefrontThemes.find(
      (theme) => !theme.isStoreVisible && theme.cosmeticIds.includes(item.id),
    );
    if (hiddenTheme) return Response.json({ error: '현재 상점에서 판매하지 않는 테마 아이템입니다.' }, { status: 404 });
    if (item.slot === 'skin' && (!item.characterId || !characterAvailable(item.characterId, profile.displayRank, profile.ownedCosmetics))) {
      return Response.json({ error: '먼저 이 스킨의 캐릭터를 보유해야 합니다.' }, { status: 403 });
    }
    if (profile.ownedCosmetics.includes(item.id)) return Response.json({ error: '이미 보유한 아이템입니다.' }, { status: 409 });
    const cashPurchase = item.unlock.kind === 'cash';
    if (cashPurchase) {
      await db.prepare(`INSERT OR IGNORE INTO account_cash_wallets
        (account_id, cash_balance, updated_at) VALUES (?, 0, ?)`).bind(row.id, now).run();
    }
    const debit = cashPurchase
      ? await db.prepare('UPDATE account_cash_wallets SET cash_balance = cash_balance - ?, updated_at = ? WHERE account_id = ? AND cash_balance >= ?')
        .bind(item.unlock.price, now, row.id, item.unlock.price).run()
      : await db.prepare('UPDATE account_customization SET custom_points = custom_points - ?, updated_at = ? WHERE account_id = ? AND custom_points >= ?')
        .bind(item.unlock.price, now, row.id, item.unlock.price).run();
    if ((debit.meta.changes ?? 0) === 0)
      return Response.json({ error: cashPurchase ? '캐시가 부족합니다.' : '커스텀 포인트가 부족합니다.' }, { status: 409 });
    try {
      await db.prepare('INSERT INTO account_cosmetics (account_id, item_id, purchased_at) VALUES (?, ?, ?)')
        .bind(row.id, item.id, now).run();
    } catch (error) {
      await db.prepare(cashPurchase
        ? 'UPDATE account_cash_wallets SET cash_balance = cash_balance + ?, updated_at = ? WHERE account_id = ?'
        : 'UPDATE account_customization SET custom_points = custom_points + ?, updated_at = ? WHERE account_id = ?')
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
  if (
    item.slot === 'skin' &&
    item.characterId &&
    !characterAvailable(item.characterId, profile.displayRank, profile.ownedCosmetics)
  ) {
    const error = item.id === MOONLIT_PHANTOM_SKIN_ID
      ? '별여우 초롱 해금 필요.'
      : `${cosmeticById(item.characterId)?.label ?? '해당 캐릭터'}를 먼저 해금해주세요.`;
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

async function updatePrestigeLoadout(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { profileImageId?: string | null; profileFrameId?: string | null; nameplateId?: string | null; homeBackgroundId?: string | null; emoteIds?: string[] };
  try { body = await request.json(); } catch { return Response.json({ error: '프레스티지 장착 정보를 확인해주세요.' }, { status: 400 }); }
  const packageRows = await db.prepare(`SELECT package_id FROM account_prestige_packages WHERE account_id = ?`)
    .bind(row.id).all<{ package_id: string }>();
  const ownedPackageIds = new Set((packageRows.results ?? []).map((entry) => entry.package_id));
  const accessoryRows = await db.prepare('SELECT accessory_id FROM account_prestige_accessories WHERE account_id = ?')
    .bind(row.id).all<{ accessory_id: string }>();
  const ownedAccessoryIds = new Set([
    ...prestigeAccessoryIdsForPackages([...ownedPackageIds]),
    ...(accessoryRows.results ?? []).map((entry) => entry.accessory_id),
  ]);
  const ownsAccessory = (id: string | null | undefined, category?: string): boolean => {
    if (!id) return true;
    const accessory = prestigeAccessoryById(id) ?? presentationById(id);
    return Boolean(accessory && (!category || accessory.category === category) && ownedAccessoryIds.has(id));
  };
  if (body.profileImageId !== undefined && body.profileImageId !== null && !ownsAccessory(body.profileImageId, 'profile'))
    return Response.json({ error: '선택할 수 없는 프로필 이미지입니다.' }, { status: 400 });
  if (body.profileFrameId !== undefined && body.profileFrameId !== null && body.profileFrameId !== BASIC_PROFILE_FRAME_ID && !ownsAccessory(body.profileFrameId, 'frame'))
    return Response.json({ error: '선택할 수 없는 프로필 테두리입니다.' }, { status: 400 });
  if (body.nameplateId !== undefined && !ownsAccessory(body.nameplateId, 'nameplate'))
    return Response.json({ error: '선택할 수 없는 명찰입니다.' }, { status: 400 });
  if (body.homeBackgroundId !== undefined && !ownsAccessory(body.homeBackgroundId, 'background'))
    return Response.json({ error: '선택할 수 없는 홈 배경입니다.' }, { status: 400 });
  const emoteIds = [...new Set(body.emoteIds ?? [])];
  if (emoteIds.length > 4 || emoteIds.some((id) => {
    const emote = prestigeEmoteById(id);
    return !emote || !ownedAccessoryIds.has(id);
  }))
    return Response.json({ error: '이모티콘은 보유한 항목 중 최대 4개까지 장착할 수 있습니다.' }, { status: 400 });
  const current = await db.prepare(`SELECT profile_image_id, profile_frame_id, emote_ids
    FROM account_prestige_loadouts WHERE account_id = ?`).bind(row.id).first<PrestigeLoadoutRow>();
  let currentEmoteIds: string[] = [];
  try {
    const parsed = JSON.parse(current?.emote_ids ?? '[]');
    if (Array.isArray(parsed)) currentEmoteIds = parsed.filter((id): id is string =>
      typeof id === 'string' && Boolean(prestigeEmoteById(id)),
    ).slice(0, 4);
  } catch {
    currentEmoteIds = [];
  }
  const now = Date.now();
  await db.prepare(`INSERT INTO account_prestige_loadouts
      (account_id, profile_image_id, profile_frame_id, emote_ids, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      profile_image_id = excluded.profile_image_id,
      profile_frame_id = excluded.profile_frame_id,
      emote_ids = excluded.emote_ids,
      updated_at = excluded.updated_at`)
    .bind(
      row.id,
      body.profileImageId === undefined ? current?.profile_image_id ?? null : body.profileImageId,
      body.profileFrameId === undefined ? current?.profile_frame_id ?? null : body.profileFrameId,
      JSON.stringify(body.emoteIds === undefined ? currentEmoteIds : emoteIds),
      now,
    ).run();
  const currentEffects = await db.prepare(`SELECT nameplate_id, home_aura_id
    FROM account_prestige_effect_loadouts WHERE account_id = ?`).bind(row.id).first<PrestigeEffectLoadoutRow>();
  await db.prepare(`INSERT INTO account_prestige_effect_loadouts
      (account_id, nameplate_id, home_aura_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      nameplate_id = excluded.nameplate_id,
      home_aura_id = excluded.home_aura_id,
      updated_at = excluded.updated_at`)
    .bind(
      row.id,
      body.nameplateId === undefined ? currentEffects?.nameplate_id ?? null : body.nameplateId,
      body.homeBackgroundId === undefined ? currentEffects?.home_aura_id ?? null : body.homeBackgroundId,
      now,
    ).run();
  return Response.json({ profile: await profileForRow(db, row) });
}

async function exchangePrestigePackage(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { packageId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '교환할 프레스티지 패키지를 확인해주세요.' }, { status: 400 }); }
  const prestigePackage = prestigePackageById(body.packageId ?? '');
  if (!prestigePackage) return Response.json({ error: '존재하지 않는 프레스티지 패키지입니다.' }, { status: 404 });
  if (!prestigePackage.available)
    return Response.json({ error: `${prestigePackage.title} 패키지는 현재 제작 중입니다.` }, { status: 409 });
  const owned = await db.prepare(`SELECT 1 AS owned FROM account_prestige_packages
    WHERE account_id = ? AND package_id = ?`).bind(row.id, prestigePackage.id).first<{ owned: number }>();
  if (owned) return Response.json({ error: `이미 ${prestigePackage.title} 패키지를 보유하고 있습니다.` }, { status: 409 });
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO account_prestige_wallets
    (account_id, ghost_orbs, pity_draw_count, total_draw_count, updated_at)
    VALUES (?, 0, 0, 0, ?)`).bind(row.id, now).run();
  const debit = await db.prepare(`UPDATE account_prestige_wallets
    SET ghost_orbs = ghost_orbs - ?, updated_at = ?
    WHERE account_id = ? AND ghost_orbs >= ?`)
    .bind(GHOST_ORB_PACKAGE_COST, now, row.id, GHOST_ORB_PACKAGE_COST).run();
  if ((debit.meta.changes ?? 0) === 0)
    return Response.json({ error: `귀신구슬 ${GHOST_ORB_PACKAGE_COST}개가 필요합니다.` }, { status: 409 });
  let packageInserted = false;
  try {
    await db.prepare(`INSERT INTO account_prestige_packages (account_id, package_id, acquired_at)
      VALUES (?, ?, ?)`).bind(row.id, prestigePackage.id, now).run();
    packageInserted = true;
    await db.prepare(`INSERT INTO account_prestige_loadouts
        (account_id, profile_image_id, profile_frame_id, emote_ids, updated_at)
      VALUES (?, NULL, ?, '[]', ?)
      ON CONFLICT(account_id) DO UPDATE SET
        profile_frame_id = excluded.profile_frame_id,
        updated_at = excluded.updated_at`)
      .bind(row.id, prestigePackage.profileFrameId, now).run();
  } catch (error) {
    if (packageInserted) {
      await db.prepare(`DELETE FROM account_prestige_packages
        WHERE account_id = ? AND package_id = ?`)
        .bind(row.id, prestigePackage.id).run();
    }
    await db.prepare(`UPDATE account_prestige_wallets
      SET ghost_orbs = ghost_orbs + ?, updated_at = ? WHERE account_id = ?`)
      .bind(GHOST_ORB_PACKAGE_COST, Date.now(), row.id).run();
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message))
      return Response.json({ error: `이미 ${prestigePackage.title} 패키지를 보유하고 있습니다.` }, { status: 409 });
    throw error;
  }
  return Response.json({ profile: await profileForRow(db, row) });
}

async function exchangePrestigeAccessory(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { accessoryId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '교환할 소품을 확인해주세요.' }, { status: 400 }); }
  const accessory = prestigeAccessoryById(body.accessoryId ?? '');
  if (!accessory) return Response.json({ error: '존재하지 않는 소품입니다.' }, { status: 404 });
  const packageRows = await db.prepare('SELECT package_id FROM account_prestige_packages WHERE account_id = ?')
    .bind(row.id).all<{ package_id: string }>();
  const ownedPackageIds = (packageRows.results ?? []).map((entry) => entry.package_id);
  const alreadyOwned = prestigeAccessoryIdsForPackages(ownedPackageIds).includes(accessory.id)
    || Boolean(await db.prepare('SELECT 1 AS owned FROM account_prestige_accessories WHERE account_id = ? AND accessory_id = ?')
      .bind(row.id, accessory.id).first<{ owned: number }>());
  if (alreadyOwned) return Response.json({ error: '이미 보유한 소품입니다.' }, { status: 409 });
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO account_prestige_wallets
    (account_id, ghost_orbs, pity_draw_count, total_draw_count, updated_at)
    VALUES (?, 0, 0, 0, ?)`).bind(row.id, now).run();
  const debit = await db.prepare(`UPDATE account_prestige_wallets
    SET ghost_orbs = ghost_orbs - ?, updated_at = ?
    WHERE account_id = ? AND ghost_orbs >= ?`)
    .bind(accessory.orbCost, now, row.id, accessory.orbCost).run();
  if ((debit.meta.changes ?? 0) === 0)
    return Response.json({ error: `귀신구슬 ${accessory.orbCost}개가 필요합니다.` }, { status: 409 });
  try {
    await db.prepare(`INSERT INTO account_prestige_accessories (account_id, accessory_id, acquired_at)
      VALUES (?, ?, ?)`).bind(row.id, accessory.id, now).run();
  } catch (error) {
    await db.prepare(`UPDATE account_prestige_wallets
      SET ghost_orbs = ghost_orbs + ?, updated_at = ? WHERE account_id = ?`)
      .bind(accessory.orbCost, Date.now(), row.id).run();
    throw error;
  }
  return Response.json({ profile: await profileForRow(db, row) });
}

function secureGhostOrbRandom(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] ?? 0) / 0x1_0000_0000;
}

function randomGhostOrbTableEntry() {
  const totalWeight = GHOST_ORB_DRAW_TABLE.reduce((sum, reward) => sum + reward.weight, 0);
  let roll = secureGhostOrbRandom() * totalWeight;
  return GHOST_ORB_DRAW_TABLE.find((reward) => {
    roll -= reward.weight;
    return roll <= 0;
  }) ?? GHOST_ORB_DRAW_TABLE[0];
}

async function drawGhostOrbs(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { count?: number };
  try { body = await request.json(); } catch { return Response.json({ error: '소환 횟수를 확인해주세요.' }, { status: 400 }); }
  const count = body.count === 10 ? 10 : body.count === 1 ? 1 : 0;
  if (!count) return Response.json({ error: '소환 횟수는 1회 또는 10회여야 합니다.' }, { status: 400 });
  const cashCost = count * GHOST_ORB_CASH_COST;

  const profile = await profileForRow(db, row);
  const ownedCosmetics = new Set(profile.ownedCosmetics);
  const newlyOwnedCosmetics = new Set<string>();
  const eligibleCosmetics = ghostOrbEligibleCosmetics();
  const guaranteedOrb = GHOST_ORB_DRAW_TABLE.find((reward) => reward.kind === 'orbs' && reward.amount === 1)!;
  const rewards: Array<{
    kind: 'points' | 'orbs' | 'cosmetic' | 'duplicate';
    amount?: number;
    itemId?: string;
    label: string;
    symbol: string;
    detail: string;
  }> = [];
  let pointReward = 0;
  let orbReward = 0;
  let pityDrawCount = profile.prestige.pityDrawCount;

  for (let index = 0; index < count; index += 1) {
    const selected = pityDrawCount >= GHOST_ORB_PITY_DRAWS - 1
      ? guaranteedOrb
      : randomGhostOrbTableEntry();
    if (selected.kind === 'orbs') {
      orbReward += selected.amount;
      pityDrawCount = 0;
      rewards.push({
        kind: 'orbs',
        amount: selected.amount,
        label: `귀신구슬 ${selected.amount}개`,
        symbol: '◉',
        detail: '프레스티지 교환 재료',
      });
      continue;
    }
    pityDrawCount += 1;
    if (selected.kind === 'points') {
      pointReward += selected.amount;
      rewards.push({
        kind: 'points',
        amount: selected.amount,
        label: `${selected.amount.toLocaleString()} P`,
        symbol: '✦',
        detail: '커스텀 포인트',
      });
      continue;
    }
    const candidates = eligibleCosmetics.filter((item) => item.slot === selected.slot);
    const item = candidates[Math.floor(secureGhostOrbRandom() * candidates.length)];
    if (!item) {
      pointReward += 100;
      rewards.push({ kind: 'points', amount: 100, label: '100 P', symbol: '✦', detail: '커스텀 포인트' });
      continue;
    }
    if (ownedCosmetics.has(item.id)) {
      const refund = duplicatePointRefund(item.id);
      pointReward += refund;
      rewards.push({
        kind: 'duplicate',
        amount: refund,
        itemId: item.id,
        label: item.label,
        symbol: item.symbol,
        detail: `중복 전환 +${refund.toLocaleString()} P`,
      });
      continue;
    }
    ownedCosmetics.add(item.id);
    newlyOwnedCosmetics.add(item.id);
    rewards.push({
      kind: 'cosmetic',
      itemId: item.id,
      label: item.label,
      symbol: item.symbol,
      detail: '신규 획득',
    });
  }

  const now = Date.now();
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO account_cash_wallets
      (account_id, cash_balance, updated_at) VALUES (?, 0, ?)`).bind(row.id, now),
    // D1 batch execution is atomic. The CHECK constraint deliberately aborts
    // the full reward batch if another request spent the remaining cash first.
    db.prepare(`UPDATE account_cash_wallets
      SET cash_balance = cash_balance - ?, updated_at = ? WHERE account_id = ?`)
      .bind(cashCost, now, row.id),
    db.prepare(`INSERT OR IGNORE INTO account_customization
      (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
      .bind(row.id, JSON.stringify(DEFAULT_APPEARANCE), now),
    db.prepare(`INSERT OR IGNORE INTO account_prestige_wallets
      (account_id, ghost_orbs, pity_draw_count, total_draw_count, updated_at)
      VALUES (?, 0, 0, 0, ?)`).bind(row.id, now),
    db.prepare(`UPDATE account_customization
      SET custom_points = custom_points + ?, updated_at = ? WHERE account_id = ?`)
      .bind(pointReward, now, row.id),
    db.prepare(`UPDATE account_prestige_wallets
      SET ghost_orbs = ghost_orbs + ?, pity_draw_count = ?,
        total_draw_count = total_draw_count + ?, updated_at = ?
      WHERE account_id = ?`)
      .bind(orbReward, pityDrawCount, count, now, row.id),
    ...[...newlyOwnedCosmetics].map((itemId) => db.prepare(`INSERT OR IGNORE INTO account_cosmetics
      (account_id, item_id, purchased_at) VALUES (?, ?, ?)`)
      .bind(row.id, itemId, now)),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (/CHECK constraint failed|cash_balance/i.test(error instanceof Error ? error.message : String(error))) {
      return Response.json({ error: `캐시 ${cashCost.toLocaleString()}개가 필요합니다.` }, { status: 409 });
    }
    throw error;
  }
  return Response.json({
    profile: await profileForRow(db, row),
    rewards,
    freePurchase: false,
    storeConnected: true,
    cashSpent: cashCost,
  }, { headers: { 'cache-control': 'no-store' } });
}

async function grantDevelopmentCash(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { productId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '캐시 상품을 확인해주세요.' }, { status: 400 }); }
  const product = CASH_PRODUCT_BY_ID.get(body.productId ?? '');
  if (!product) return Response.json({ error: '등록되지 않은 캐시 상품입니다.' }, { status: 404 });
  const now = Date.now();
  const claimToken = crypto.randomUUID();
  const firstBonus = firstCashPurchaseBonus(product);
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO account_cash_wallets
      (account_id, cash_balance, updated_at) VALUES (?, 0, ?)`).bind(row.id, now),
    db.prepare(`INSERT OR IGNORE INTO account_cash_first_purchase_rewards
      (account_id, product_id, claim_token, claimed_at) VALUES (?, ?, ?, ?)`)
      .bind(row.id, product.id, claimToken, now),
    // The marker and wallet update share the same D1 batch. Only the request
    // that inserted this unique claim token receives the first-purchase bonus.
    db.prepare(`UPDATE account_cash_wallets
      SET cash_balance = cash_balance + ? + CASE WHEN EXISTS (
        SELECT 1 FROM account_cash_first_purchase_rewards
        WHERE account_id = ? AND product_id = ? AND claim_token = ?
      ) THEN ? ELSE 0 END,
        updated_at = ?
      WHERE account_id = ?`)
      .bind(product.cash, row.id, product.id, claimToken, firstBonus, now, row.id),
  ]);
  const firstPurchase = (results[1]?.meta.changes ?? 0) === 1;
  return Response.json({
    profile: await profileForRow(db, row),
    firstPurchase,
    grantedCash: cashGrantAmount(product, firstPurchase),
  }, { headers: { 'cache-control': 'no-store' } });
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

async function purchasePresentation(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { itemId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: '연출 상품을 확인해주세요.' }, { status: 400 }); }
  const item = presentationById(body.itemId);
  if (!item) return Response.json({ error: '판매 중인 연출 상품이 아닙니다.' }, { status: 404 });
  const alreadyOwned = await db.prepare(`SELECT 1 AS owned FROM account_prestige_accessories
    WHERE account_id = ? AND accessory_id = ?`).bind(row.id, item.id).first<{ owned: number }>();
  if (alreadyOwned) return Response.json({ error: '이미 보유한 상품입니다.' }, { status: 409 });
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO account_customization
      (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
      .bind(row.id, JSON.stringify(DEFAULT_APPEARANCE), now),
    db.prepare(`INSERT OR IGNORE INTO account_cash_wallets
      (account_id, cash_balance, updated_at) VALUES (?, 0, ?)`)
      .bind(row.id, now),
  ]);
  const wallet = item.currency === 'cash' ? 'account_cash_wallets' : 'account_customization';
  const column = item.currency === 'cash' ? 'cash_balance' : 'custom_points';
  try {
    const [debit, grant] = await db.batch([
      db.prepare(`UPDATE ${wallet} SET ${column} = ${column} - ?, updated_at = ?
        WHERE account_id = ?`).bind(item.price, now, row.id),
      db.prepare(`INSERT INTO account_prestige_accessories (account_id, accessory_id, acquired_at)
        VALUES (?, ?, ?)`).bind(row.id, item.id, now),
    ]);
    if ((debit?.meta.changes ?? 0) !== 1 || (grant?.meta.changes ?? 0) !== 1)
      return Response.json({ error: item.currency === 'cash' ? '캐시가 부족합니다.' : '커스텀 포인트가 부족합니다.' }, { status: 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) return Response.json({ error: '이미 보유한 상품입니다.' }, { status: 409 });
    if (/CHECK constraint failed|constraint/i.test(message))
      return Response.json({ error: item.currency === 'cash' ? '캐시가 부족합니다.' : '커스텀 포인트가 부족합니다.' }, { status: 409 });
    throw error;
  }
  return Response.json({ profile: await profileForRow(db, row) }, { headers: { 'cache-control': 'no-store' } });
}

async function claimRandomBoxRefill(request: Request, db: D1Database): Promise<Response> {
  if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
  const row = await authenticatedRowFromReadySchema(request, db);
  if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  let body: { rewardedAdCompleted?: boolean };
  try { body = await request.json(); } catch { return Response.json({ error: '랜덤 상자 수령 요청을 확인해주세요.' }, { status: 400 }); }
  const now = Date.now();
  const periodKey = kstDayKey(now);
  const entitlement = await db.prepare(`SELECT plan, expires_at FROM account_entitlements
    WHERE account_id = ? AND entitlement_id = ?`).bind(row.id, AD_FREE_ENTITLEMENT_ID).first<AdFreeEntitlementRow>();
  const adFree = entitlement?.plan === 'permanent'
    || (entitlement?.plan === 'monthly' && (entitlement.expires_at ?? 0) > now);
  if (!adFree && body.rewardedAdCompleted !== true)
    return Response.json({ error: '보상형 광고를 끝까지 시청해야 랜덤 상자를 받을 수 있습니다.' }, { status: 409 });
  await db.prepare(`INSERT OR IGNORE INTO account_random_box_daily
      (account_id, period_key, remaining_count, refills_claimed, updated_at)
    VALUES (?, ?, ?, 0, ?)`)
    .bind(row.id, periodKey, RANDOM_BOX_DAILY_FREE, now).run();
  const claimed = await db.prepare(`UPDATE account_random_box_daily
    SET remaining_count = remaining_count + ?, refills_claimed = refills_claimed + 1, updated_at = ?
    WHERE account_id = ? AND period_key = ? AND refills_claimed < ?`)
    .bind(RANDOM_BOX_REFILL_AMOUNT, now, row.id, periodKey, RANDOM_BOX_MAX_REFILLS).run();
  if ((claimed.meta.changes ?? 0) !== 1)
    return Response.json({ error: '오늘 받을 수 있는 랜덤 상자를 모두 수령했습니다.' }, { status: 409 });
  return Response.json({ profile: await profileForRow(db, row) }, { headers: { 'cache-control': 'no-store' } });
}

export async function consumeRandomBox(
  db: D1Database,
  accountId: string,
  bootstrapSchema = false,
): Promise<{ ok: true; remaining: number } | { ok: false; error: string }> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const now = Date.now();
  const periodKey = kstDayKey(now);
  await db.prepare(`INSERT OR IGNORE INTO account_random_box_daily
      (account_id, period_key, remaining_count, refills_claimed, updated_at)
    VALUES (?, ?, ?, 0, ?)`)
    .bind(accountId, periodKey, RANDOM_BOX_DAILY_FREE, now).run();
  const used = await db.prepare(`UPDATE account_random_box_daily
    SET remaining_count = remaining_count - 1, updated_at = ?
    WHERE account_id = ? AND period_key = ? AND remaining_count > 0`)
    .bind(now, accountId, periodKey).run();
  if ((used.meta.changes ?? 0) !== 1)
    return { ok: false, error: '남은 랜덤 상자가 없습니다. 상점 > 아이템 탭에서 보충하세요.' };
  const current = await db.prepare(`SELECT remaining_count FROM account_random_box_daily
    WHERE account_id = ? AND period_key = ?`).bind(accountId, periodKey).first<{ remaining_count: number }>();
  return { ok: true, remaining: Math.max(0, current?.remaining_count ?? 0) };
}

export async function refundRandomBox(
  db: D1Database,
  accountId: string,
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const now = Date.now();
  const periodKey = kstDayKey(now);
  await db.prepare(`UPDATE account_random_box_daily
    SET remaining_count = remaining_count + 1, updated_at = ?
    WHERE account_id = ? AND period_key = ?`)
    .bind(now, accountId, periodKey).run();
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

  type ClaimableRewardRow = {
    victory: number;
    completed: number;
    abandoned: number;
    reward_points: number;
    reward_claimed_at: number;
    reward_multiplier: number;
  };
  let rewardSource: 'stage' | 'hide-seek' = 'stage';
  let match = await db.prepare(`SELECT victory, 1 AS completed, 0 AS abandoned,
      reward_points, reward_claimed_at, reward_multiplier
    FROM match_results WHERE match_id = ? AND account_id = ?`)
    .bind(matchId, row.id)
    .first<ClaimableRewardRow>();
  if (!match) {
    rewardSource = 'hide-seek';
    match = await db.prepare(`SELECT victory, completed, abandoned,
        reward_points, reward_claimed_at, reward_multiplier
      FROM hide_seek_results WHERE match_id = ? AND account_id = ?`)
      .bind(matchId, row.id)
      .first<ClaimableRewardRow>();
  }
  if (!match) {
    return Response.json(
      { error: '전리품 정산이 아직 끝나지 않았습니다. 잠시 후 다시 시도해주세요.' },
      { status: 404 },
    );
  }
  if (match.completed !== 1 || match.abandoned === 1 || match.victory !== 1 || match.reward_points <= 0) {
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
  const rewardTable = rewardSource === 'hide-seek' ? 'hide_seek_results' : 'match_results';
  const completionGuard = rewardSource === 'hide-seek' ? ' AND completed = 1 AND abandoned = 0' : '';
  const claimed = await db.prepare(`UPDATE ${rewardTable}
    SET reward_claimed_at = ?, reward_multiplier = ?
    WHERE match_id = ? AND account_id = ? AND reward_claimed_at = 0${completionGuard}`)
    .bind(now, multiplier, matchId, row.id)
    .run();
  const finalMatch = (claimed.meta.changes ?? 0) === 1
    ? { ...match, reward_claimed_at: now, reward_multiplier: multiplier }
    : await db.prepare(`SELECT victory,
          ${rewardSource === 'hide-seek' ? 'completed, abandoned,' : '1 AS completed, 0 AS abandoned,'}
          reward_points, reward_claimed_at, reward_multiplier
        FROM ${rewardTable} WHERE match_id = ? AND account_id = ?`)
      .bind(matchId, row.id)
      .first<ClaimableRewardRow>();
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
  appleClientId?: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith('/api/auth/')
    && !url.pathname.startsWith('/api/customize/')
    && !url.pathname.startsWith('/api/shop/')
    && !url.pathname.startsWith('/api/rewards/')
    && !url.pathname.startsWith('/api/entitlements/')
    && !url.pathname.startsWith('/api/events/')
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
    if (url.pathname === '/api/auth/register' && request.method === 'POST') {
      return register(request, db, bootstrapSchema);
    }
    if (
      bootstrapSchema
      && url.pathname === '/api/auth/test/reset-tutorial'
      && request.method === 'POST'
    ) {
      const row = await authenticatedRowFromReadySchema(request, db);
      if (!row) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      await db.prepare('UPDATE accounts SET tutorial_completed = 0, updated_at = ? WHERE id = ?')
        .bind(Date.now(), row.id).run();
      return Response.json({ ok: true });
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') return login(request, db);
    if (url.pathname === '/api/auth/google' && request.method === 'POST') return googleLogin(request, db, googleClientId);
    if (url.pathname === '/api/auth/google/complete' && request.method === 'POST') return completeGoogleSignup(request, db);
    if (url.pathname === '/api/auth/apple' && request.method === 'POST') return appleLogin(request, db, appleClientId);
    if (url.pathname === '/api/auth/apple/complete' && request.method === 'POST') return completeAppleSignup(request, db);
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, db);
    if (url.pathname === '/api/auth/nickname/check' && request.method === 'POST') return checkNicknameAvailability(request, db);
    if (url.pathname === '/api/auth/nickname' && request.method === 'POST') return setNickname(request, db);
    if (url.pathname === '/api/auth/play-mode' && request.method === 'POST') return setSelectedPlayMode(request, db);
    if (url.pathname === '/api/auth/profile-display' && request.method === 'POST') return setProfileDisplayMode(request, db);
    if (url.pathname === '/api/auth/profile-avatar' && request.method === 'POST') return setProfileAvatar(request, db);
    if (url.pathname === '/api/auth/promotion-dismissals' && request.method === 'POST') return dismissPromotion(request, db);
    if (url.pathname === '/api/customize/purchase' && request.method === 'POST') return customize(request, db, 'purchase');
    if (url.pathname === '/api/customize/equip' && request.method === 'POST') return customize(request, db, 'equip');
    if (url.pathname === '/api/customize/presentation/purchase' && request.method === 'POST') return purchasePresentation(request, db);
    if (url.pathname === '/api/auth/prestige-loadout' && request.method === 'POST') return updatePrestigeLoadout(request, db);
    if (url.pathname === '/api/auth/prestige-package/exchange' && request.method === 'POST') return exchangePrestigePackage(request, db);
    if (url.pathname === '/api/auth/prestige-accessory/exchange' && request.method === 'POST') return exchangePrestigeAccessory(request, db);
    if (url.pathname === '/api/auth/ghost-orb/draw' && request.method === 'POST') return drawGhostOrbs(request, db);
    if (bootstrapSchema && url.pathname === '/api/auth/cash/dev-grant' && request.method === 'POST') return grantDevelopmentCash(request, db);
    if (url.pathname === '/api/shop/consumables/purchase' && request.method === 'POST') return purchaseConsumable(request, db);
    if (url.pathname === '/api/shop/random-box/claim' && request.method === 'POST') return claimRandomBoxRefill(request, db);
    if (url.pathname === '/api/rewards/match/claim' && request.method === 'POST') return claimMatchReward(request, db);
    if (url.pathname === '/api/events/missions' && request.method === 'GET') {
      const profile = await authenticatedProfileFromReadySchema(request, db);
      if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      await recordLoginMissionProgress(db, profile.id, Date.now(), bootstrapSchema);
      return Response.json(
        { overview: await eventMissionOverview(db, profile.id, Date.now(), bootstrapSchema) },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    if (url.pathname === '/api/events/missions/claim' && request.method === 'POST') {
      if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const profile = await authenticatedProfileFromReadySchema(request, db);
      if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      let body: { missionIds?: unknown };
      try { body = await request.json(); } catch { body = {}; }
      const missionIds = Array.isArray(body.missionIds)
        ? body.missionIds.filter((id): id is string => typeof id === 'string').slice(0, 20)
        : [];
      return Response.json(
        await claimEventMissionRewards(db, profile.id, missionIds, Date.now(), bootstrapSchema),
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    if (url.pathname === '/api/events/attendance/claim' && request.method === 'POST') {
      if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const profile = await authenticatedProfileFromReadySchema(request, db);
      if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      let body: { day?: unknown };
      try { body = await request.json(); } catch { body = {}; }
      const day = typeof body.day === 'number' ? Math.floor(body.day) : 0;
      try {
        return Response.json(
          await claimAttendanceReward(db, profile.id, day, Date.now(), bootstrapSchema),
          { headers: { 'cache-control': 'no-store' } },
        );
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : '출석 보상을 수령하지 못했습니다.' }, { status: 409 });
      }
    }
    if (url.pathname === '/api/events/attendance/premium-choice' && request.method === 'POST') {
      if (!checkOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다.' }, { status: 403 });
      const profile = await authenticatedProfileFromReadySchema(request, db);
      if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      let body: { itemId?: unknown };
      try { body = await request.json(); } catch { body = {}; }
      const itemId = typeof body.itemId === 'string' ? body.itemId : '';
      try {
        return Response.json(
          await redeemAttendancePremiumChoice(db, profile.id, itemId, Date.now(), bootstrapSchema),
          { headers: { 'cache-control': 'no-store' } },
        );
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : '프리미엄 스킨을 선택하지 못했습니다.' }, { status: 409 });
      }
    }
    if (url.pathname === '/api/entitlements/ad-free/purchase' && request.method === 'POST') return purchaseMockAdFree(request, db);
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const row = await authenticatedRowFromReadySchema(request, db);
      if (row) await recordLoginMissionProgress(db, row.id, Date.now(), bootstrapSchema);
      const profile = row ? await profileForRow(db, row) : null;
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
  input: { matchId: string; accountId: string; playMode: PlayMode; stageId?: string; stageIndex: number; victory: boolean; elapsed: number; timeAttack?: boolean; missionRewardPoints?: number },
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
  const missionRewardPoints = input.victory
    ? Math.max(0, Math.min(150, Math.floor(input.missionRewardPoints ?? 0)))
    : 0;
  const points = Math.round(basePoints * eventBonus) + missionRewardPoints;
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
  if (input.victory && !tutorialMatch) {
    await recordStageClearMissionProgress(db, input.accountId, now, bootstrapSchema);
  }
}

export async function recordHideSeekMatchResults(
  db: D1Database,
  input: {
    matchId: string;
    winner: HideSeekRole;
    resultReason: HideSeekResultReason;
    elapsed: number;
    players: readonly {
      accountId?: string;
      role: HideSeekRole | null;
      isBot: boolean;
      abandoned: boolean;
    }[];
  },
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureAuthSchema(db);
  const participants = [...new Map(input.players
    .filter((player) => !player.isBot && player.accountId && player.role)
    .map((player) => [player.accountId as string, player])).values()];
  if (participants.length === 0) return;
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const player of participants) {
    const accountId = player.accountId as string;
    const role = player.role as HideSeekRole;
    const rewardPoints = hideSeekVictoryPoints(role, input.winner, player.abandoned);
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO account_customization
        (account_id, custom_points, appearance, updated_at) VALUES (?, 0, ?, ?)`)
        .bind(accountId, JSON.stringify(DEFAULT_APPEARANCE), now),
      db.prepare(`INSERT OR IGNORE INTO hide_seek_results (
          match_id, account_id, role, victory, completed, abandoned,
          elapsed_seconds, reward_points, reward_claimed_at,
          reward_multiplier, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`)
        .bind(
          input.matchId,
          accountId,
          role,
          role === input.winner ? 1 : 0,
          player.abandoned ? 0 : 1,
          player.abandoned ? 1 : 0,
          Math.max(0, Math.floor(input.elapsed)),
          rewardPoints,
          now,
        ),
    );
  }
  await db.batch(statements);
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
  if (!input.contribution.abandoned) {
    await recordRankedCompletionMissionProgress(db, input.accountId, now, bootstrapSchema);
  }
}

export interface RankedLeaderboardEntry {
  accountId: string;
  avatarUrl: string | null;
  profileFrameId: string | null;
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
      a.profile_avatar_updated_at AS profile_avatar_updated_at, a.ranked_rating AS ranked_rating,
      pl.profile_image_id AS profile_image_id, pl.profile_frame_id AS profile_frame_id
    FROM totals JOIN accounts a ON a.id = totals.account_id
    LEFT JOIN account_prestige_loadouts pl ON pl.account_id = a.id
    ORDER BY totals.score DESC, totals.attained_at ASC
    LIMIT 50`).bind(seasonId).all<{
      account_id: string;
      nickname: string;
      profile_avatar: string;
      profile_avatar_updated_at: number;
      ranked_rating: number;
      profile_image_id: string | null;
      profile_frame_id: string | null;
    }>();
  return (rows.results ?? []).map((row, index) => {
    const avatarUpdatedAt = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
    const hasAvatar = Boolean(row.profile_avatar) && avatarUpdatedAt > 0;
    const rating = Math.max(0, row.ranked_rating ?? 800);
    return {
      accountId: row.account_id,
      avatarUrl: publicPrestigeProfileImageUrl(row.profile_image_id) ?? (hasAvatar
        ? `/api/profile-avatar/${encodeURIComponent(row.account_id)}?v=${avatarUpdatedAt}`
        : null),
      profileFrameId: row.profile_frame_id ?? BASIC_PROFILE_FRAME_ID,
      nickname: row.nickname,
      rank: index + 1,
      rating,
      tier: rankedTierForRating(rating),
    };
  });
}

export type ProgressionLeaderboardMode = 'solo' | 'multiplayer';

export interface ProgressionLeaderboardEntry {
  accountId: string;
  avatarUrl: string | null;
  profileFrameId: string | null;
  nickname: string;
  rank: number;
  xp: number;
  tier: ReturnType<typeof rankFromXp>;
  stageIndex: number;
}

/** Public progression leaderboard. Only completed progression is included. */
export async function progressionLeaderboard(
  db: D1Database,
  mode: ProgressionLeaderboardMode,
): Promise<ProgressionLeaderboardEntry[]> {
  const xpColumn = mode === 'solo' ? 'solo_xp' : 'multiplayer_xp';
  const stageColumn = mode === 'solo' ? 'solo_stage_index' : 'multiplayer_stage_index';
  const rows = await db.prepare(`SELECT a.id AS id, a.nickname AS nickname, a.profile_avatar AS profile_avatar, a.profile_avatar_updated_at AS profile_avatar_updated_at,
      pl.profile_image_id AS profile_image_id, pl.profile_frame_id AS profile_frame_id,
      ${xpColumn} AS xp, ${stageColumn} AS stage_index
    FROM accounts a LEFT JOIN account_prestige_loadouts pl ON pl.account_id = a.id
    WHERE ${xpColumn} > 0 OR ${stageColumn} > 0
    ORDER BY ${xpColumn} DESC, ${stageColumn} DESC, victories DESC, created_at ASC
    LIMIT 50`).all<{
      id: string;
      nickname: string;
      profile_avatar: string;
      profile_avatar_updated_at: number;
      profile_image_id: string | null;
      profile_frame_id: string | null;
      xp: number;
      stage_index: number;
    }>();
  return (rows.results ?? []).map((row, index) => {
    const avatarUpdatedAt = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
    return {
      accountId: row.id,
      avatarUrl: publicPrestigeProfileImageUrl(row.profile_image_id) ?? (row.profile_avatar && avatarUpdatedAt > 0
        ? `/api/profile-avatar/${encodeURIComponent(row.id)}?v=${avatarUpdatedAt}`
        : null),
      profileFrameId: row.profile_frame_id ?? BASIC_PROFILE_FRAME_ID,
      nickname: row.nickname,
      rank: index + 1,
      xp: Math.max(0, row.xp ?? 0),
      tier: rankFromXp(Math.max(0, row.xp ?? 0)),
      stageIndex: Math.max(0, row.stage_index ?? 0),
    };
  });
}

export interface PublicRankingProfile {
  accountId: string;
  avatarUrl: string | null;
  profileFrameId: string | null;
  nickname: string;
  solo: { xp: number; tier: ReturnType<typeof rankFromXp>; stageIndex: number };
  multiplayer: { xp: number; tier: ReturnType<typeof rankFromXp>; stageIndex: number };
  ranked: { rating: number; tier: RankedTier; contractsPlayed: number };
  victories: number;
}

/** A deliberately small, safe profile used by the public ranking card. */
export async function publicRankingProfile(
  db: D1Database,
  accountId: string,
): Promise<PublicRankingProfile | null> {
  const row = await db.prepare(`SELECT a.id AS id, a.nickname AS nickname, a.profile_avatar AS profile_avatar, a.profile_avatar_updated_at AS profile_avatar_updated_at,
      pl.profile_image_id AS profile_image_id, pl.profile_frame_id AS profile_frame_id,
      solo_xp, multiplayer_xp, solo_stage_index, multiplayer_stage_index, victories,
      ranked_rating, ranked_season_id, ranked_contracts_played
    FROM accounts a LEFT JOIN account_prestige_loadouts pl ON pl.account_id = a.id
    WHERE a.id = ?`).bind(accountId).first<{
      id: string;
      nickname: string;
      profile_avatar: string;
      profile_avatar_updated_at: number;
      profile_image_id: string | null;
      profile_frame_id: string | null;
      solo_xp: number;
      multiplayer_xp: number;
      solo_stage_index: number;
      multiplayer_stage_index: number;
      victories: number;
      ranked_rating: number;
      ranked_season_id: string;
      ranked_contracts_played: number;
    }>();
  if (!row) return null;
  const avatarUpdatedAt = Math.max(0, Math.floor(row.profile_avatar_updated_at ?? 0));
  const soloXp = Math.max(0, row.solo_xp ?? 0);
  const multiplayerXp = Math.max(0, row.multiplayer_xp ?? 0);
  const rankedCurrent = row.ranked_season_id === rankedSeasonId();
  const rankedRating = rankedCurrent ? Math.max(0, row.ranked_rating ?? 800) : 800;
  return {
    accountId: row.id,
    avatarUrl: publicPrestigeProfileImageUrl(row.profile_image_id) ?? (row.profile_avatar && avatarUpdatedAt > 0
      ? `/api/profile-avatar/${encodeURIComponent(row.id)}?v=${avatarUpdatedAt}`
      : null),
    profileFrameId: row.profile_frame_id ?? BASIC_PROFILE_FRAME_ID,
    nickname: row.nickname,
    solo: { xp: soloXp, tier: rankFromXp(soloXp), stageIndex: Math.max(0, row.solo_stage_index ?? 0) },
    multiplayer: { xp: multiplayerXp, tier: rankFromXp(multiplayerXp), stageIndex: Math.max(0, row.multiplayer_stage_index ?? 0) },
    ranked: {
      rating: rankedRating,
      tier: rankedTierForRating(rankedRating),
      contractsPlayed: rankedCurrent ? Math.max(0, row.ranked_contracts_played ?? 0) : 0,
    },
    victories: Math.max(0, row.victories ?? 0),
  };
}
