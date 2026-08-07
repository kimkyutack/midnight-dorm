import {
  ATTENDANCE_REWARDS,
  attendanceRewardForDay,
  type AttendanceOverview,
} from '../shared/attendanceRewards';
import {
  COSMETIC_CATALOG,
  cosmeticById,
  type CosmeticDefinition,
} from '../shared/customization';
import { eventMissionPeriodWindow } from '../shared/eventMissions';

interface AttendanceProgressRow {
  attendance_count: number;
  last_attended_day_key: string;
}

interface AttendanceClaimRow {
  attendance_day: number;
}

interface AttendanceVoucherRow {
  attendance_day: number;
  redeemed_item_id: string | null;
}

export async function ensureAttendanceSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS account_attendance_progress (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      attendance_count INTEGER NOT NULL DEFAULT 0 CHECK (attendance_count BETWEEN 0 AND 30),
      last_attended_day_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_attendance_claims (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      attendance_day INTEGER NOT NULL CHECK (attendance_day BETWEEN 1 AND 30),
      reward_kind TEXT NOT NULL CHECK (reward_kind IN ('points', 'cosmetic', 'premium-choice')),
      reward_item_id TEXT,
      reward_points INTEGER NOT NULL DEFAULT 0,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, attendance_day)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS account_attendance_vouchers (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      attendance_day INTEGER NOT NULL,
      redeemed_item_id TEXT,
      created_at INTEGER NOT NULL,
      redeemed_at INTEGER,
      PRIMARY KEY (account_id, attendance_day)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_attendance_claims_account ON account_attendance_claims(account_id, claimed_at DESC)'),
  ]);
}

export async function recordAttendanceVisit(
  db: D1Database,
  accountId: string,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureAttendanceSchema(db);
  const dayKey = eventMissionPeriodWindow('daily', now).key;
  await db.prepare(`INSERT INTO account_attendance_progress
    (account_id, attendance_count, last_attended_day_key, updated_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET
      attendance_count = CASE
        WHEN account_attendance_progress.last_attended_day_key <> excluded.last_attended_day_key
        THEN MIN(30, account_attendance_progress.attendance_count + 1)
        ELSE account_attendance_progress.attendance_count
      END,
      last_attended_day_key = excluded.last_attended_day_key,
      updated_at = excluded.updated_at`)
    .bind(accountId, dayKey, now).run();
}

function premiumSkinChoices(
  owned: ReadonlySet<string>,
): NonNullable<AttendanceOverview['premiumChoice']> {
  const catalog: readonly CosmeticDefinition[] = COSMETIC_CATALOG;
  const choices = catalog
    .filter((item) =>
      item.slot === 'skin' &&
      item.premium === true &&
      item.prestige !== true &&
      item.unlock.kind === 'cash' &&
      item.unlock.price === 2_500 &&
      !owned.has(item.id))
    .map((item) => ({
      itemId: item.id,
      label: item.label,
      imageUrl: item.assetDirectory
        ? `/assets/sprites/skins/${item.assetDirectory}/concept.png`
        : `/assets/sprites/survivors/${item.characterId ?? 'character-bunny'}/concept.png`,
    }));
  return { pending: true, sourceDay: 30, choices };
}

export async function attendanceOverview(
  db: D1Database,
  accountId: string,
  bootstrapSchema = false,
): Promise<AttendanceOverview> {
  if (bootstrapSchema) await ensureAttendanceSchema(db);
  const [progress, claims, voucher, cosmetics] = await Promise.all([
    db.prepare(`SELECT attendance_count, last_attended_day_key
      FROM account_attendance_progress WHERE account_id = ?`)
      .bind(accountId).first<AttendanceProgressRow>(),
    db.prepare(`SELECT attendance_day FROM account_attendance_claims
      WHERE account_id = ?`).bind(accountId).all<AttendanceClaimRow>(),
    db.prepare(`SELECT attendance_day, redeemed_item_id FROM account_attendance_vouchers
      WHERE account_id = ? AND redeemed_item_id IS NULL ORDER BY attendance_day DESC LIMIT 1`)
      .bind(accountId).first<AttendanceVoucherRow>(),
    db.prepare('SELECT item_id FROM account_cosmetics WHERE account_id = ?')
      .bind(accountId).all<{ item_id: string }>(),
  ]);
  const attendanceCount = Math.max(0, Math.min(30, progress?.attendance_count ?? 0));
  const claimedDays = new Set((claims.results ?? []).map((row) => row.attendance_day));
  const rewards = ATTENDANCE_REWARDS.map((reward) => ({
    ...reward,
    unlocked: reward.day <= attendanceCount,
    claimed: claimedDays.has(reward.day),
    claimable: reward.day <= attendanceCount && !claimedDays.has(reward.day),
  }));
  const owned = new Set((cosmetics.results ?? []).map((row) => row.item_id));
  return {
    attendanceCount,
    lastAttendedDayKey: progress?.last_attended_day_key ?? '',
    claimableCount: rewards.filter((reward) => reward.claimable).length,
    rewards,
    premiumChoice: voucher ? premiumSkinChoices(owned) : null,
  };
}

export async function claimAttendanceReward(
  db: D1Database,
  accountId: string,
  day: number,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<{ overview: AttendanceOverview; awardedPoints: number; awardedItemId: string | null; premiumChoiceRequired: boolean }> {
  if (bootstrapSchema) await ensureAttendanceSchema(db);
  const reward = attendanceRewardForDay(day);
  if (!reward) throw new Error('출석 보상 일수를 확인해주세요.');
  const progress = await db.prepare(`SELECT attendance_count FROM account_attendance_progress
    WHERE account_id = ?`).bind(accountId).first<{ attendance_count: number }>();
  if ((progress?.attendance_count ?? 0) < day) throw new Error('아직 받을 수 없는 출석 보상입니다.');
  await db.prepare(`INSERT OR IGNORE INTO account_customization
    (account_id, custom_points, appearance, updated_at) VALUES (?, 0, '{}', ?)`)
    .bind(accountId, now).run();
  const owned = reward.itemId
    ? await db.prepare('SELECT 1 AS owned FROM account_cosmetics WHERE account_id = ? AND item_id = ?')
      .bind(accountId, reward.itemId).first<{ owned: number }>()
    : null;
  const duplicate = Boolean(owned);
  const premiumChoiceRequired = day === 30 && duplicate;
  const awardedPoints = reward.kind === 'points'
    ? reward.amount ?? 0
    : duplicate && !premiumChoiceRequired
      ? reward.duplicatePoints ?? 0
      : 0;
  const rewardKind = premiumChoiceRequired ? 'premium-choice' : reward.kind;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO account_attendance_claims
    (account_id, attendance_day, reward_kind, reward_item_id, reward_points, claimed_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(accountId, day, rewardKind, reward.itemId ?? null, awardedPoints, now).run();
  if ((inserted.meta.changes ?? 0) === 0) {
    return {
      overview: await attendanceOverview(db, accountId),
      awardedPoints: 0,
      awardedItemId: null,
      premiumChoiceRequired: false,
    };
  }
  if (awardedPoints > 0) {
    await db.prepare(`UPDATE account_customization SET custom_points = custom_points + ?, updated_at = ?
      WHERE account_id = ?`).bind(awardedPoints, now, accountId).run();
  }
  let awardedItemId: string | null = null;
  if (reward.kind === 'cosmetic' && reward.itemId && !duplicate) {
    await db.prepare(`INSERT OR IGNORE INTO account_cosmetics (account_id, item_id, purchased_at)
      VALUES (?, ?, ?)`).bind(accountId, reward.itemId, now).run();
    awardedItemId = reward.itemId;
  }
  if (premiumChoiceRequired) {
    const currentOwned = await db.prepare('SELECT item_id FROM account_cosmetics WHERE account_id = ?')
      .bind(accountId).all<{ item_id: string }>();
    const choices = premiumSkinChoices(new Set((currentOwned.results ?? []).map((row) => row.item_id))).choices;
    if (choices.length === 0) {
      await db.prepare(`UPDATE account_customization SET custom_points = custom_points + 2500, updated_at = ?
        WHERE account_id = ?`).bind(now, accountId).run();
    } else {
      await db.prepare(`INSERT OR IGNORE INTO account_attendance_vouchers
        (account_id, attendance_day, redeemed_item_id, created_at, redeemed_at)
        VALUES (?, 30, NULL, ?, NULL)`).bind(accountId, now).run();
    }
  }
  const overview = await attendanceOverview(db, accountId);
  return {
    overview,
    awardedPoints: premiumChoiceRequired && overview.premiumChoice === null ? 2_500 : awardedPoints,
    awardedItemId,
    premiumChoiceRequired: Boolean(overview.premiumChoice),
  };
}

export async function redeemAttendancePremiumChoice(
  db: D1Database,
  accountId: string,
  itemId: string,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<{ overview: AttendanceOverview; awardedItemId: string }> {
  if (bootstrapSchema) await ensureAttendanceSchema(db);
  const ownedRows = await db.prepare('SELECT item_id FROM account_cosmetics WHERE account_id = ?')
    .bind(accountId).all<{ item_id: string }>();
  const choices = premiumSkinChoices(new Set((ownedRows.results ?? []).map((row) => row.item_id))).choices;
  if (!choices.some((choice) => choice.itemId === itemId)) throw new Error('선택할 수 없는 프리미엄 스킨입니다.');
  const item = cosmeticById(itemId);
  if (!item) throw new Error('프리미엄 스킨을 찾을 수 없습니다.');
  const redeemed = await db.prepare(`UPDATE account_attendance_vouchers
    SET redeemed_item_id = ?, redeemed_at = ?
    WHERE account_id = ? AND attendance_day = 30 AND redeemed_item_id IS NULL`)
    .bind(itemId, now, accountId).run();
  if ((redeemed.meta.changes ?? 0) === 0) throw new Error('사용할 수 있는 프리미엄 스킨 선택권이 없습니다.');
  await db.prepare(`INSERT OR IGNORE INTO account_cosmetics (account_id, item_id, purchased_at)
    VALUES (?, ?, ?)`).bind(accountId, itemId, now).run();
  return { overview: await attendanceOverview(db, accountId), awardedItemId: itemId };
}
