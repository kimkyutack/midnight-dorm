import {
  EVENT_MISSIONS,
  eventMissionPeriodWindow,
  eventMissionsForPeriod,
  type EventMissionOverview,
  type EventMissionMetric,
  type EventMissionPeriod,
} from '../shared/eventMissions';

interface ProgressRow {
  metric: EventMissionMetric;
  period_type: EventMissionPeriod;
  period_key: string;
  progress_count: number;
}

interface ClaimRow {
  mission_id: string;
  period_key: string;
}

async function upgradeLegacyEventMissionSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DROP TRIGGER IF EXISTS trg_event_mission_reward_claim'),
    db.prepare('DROP INDEX IF EXISTS idx_event_mission_claims_account'),
    db.prepare('ALTER TABLE event_mission_progress RENAME TO event_mission_progress_legacy'),
    db.prepare(`CREATE TABLE event_mission_progress (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      metric TEXT NOT NULL CHECK (metric IN ('stage-clears', 'login-days', 'ranked-completions')),
      period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly')),
      period_key TEXT NOT NULL,
      progress_count INTEGER NOT NULL DEFAULT 0 CHECK (progress_count >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, metric, period_type, period_key)
    )`),
    db.prepare(`INSERT INTO event_mission_progress
      (account_id, metric, period_type, period_key, progress_count, updated_at)
      SELECT account_id, 'stage-clears', period_type, period_key, clear_count, updated_at
      FROM event_mission_progress_legacy`),
    db.prepare('DROP TABLE event_mission_progress_legacy'),
    db.prepare('ALTER TABLE event_mission_claims RENAME TO event_mission_claims_legacy'),
    db.prepare(`CREATE TABLE event_mission_claims (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      mission_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      reward_points INTEGER NOT NULL CHECK (reward_points BETWEEN 20 AND 200),
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, mission_id, period_key)
    )`),
    db.prepare(`INSERT INTO event_mission_claims
      (account_id, mission_id, period_key, reward_points, claimed_at)
      SELECT account_id, mission_id, period_key, reward_points, claimed_at
      FROM event_mission_claims_legacy`),
    db.prepare('DROP TABLE event_mission_claims_legacy'),
  ]);
}

export async function ensureEventMissionSchema(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(event_mission_progress)')
    .all<{ name: string }>();
  const columnNames = new Set((columns.results ?? []).map((column) => column.name));
  if (columnNames.has('clear_count') && !columnNames.has('metric')) {
    await upgradeLegacyEventMissionSchema(db);
  }
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS event_mission_progress (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      metric TEXT NOT NULL CHECK (metric IN ('stage-clears', 'login-days', 'ranked-completions')),
      period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly')),
      period_key TEXT NOT NULL,
      progress_count INTEGER NOT NULL DEFAULT 0 CHECK (progress_count >= 0),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, metric, period_type, period_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS event_mission_login_days (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      week_key TEXT NOT NULL,
      recorded_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, day_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS event_mission_claims (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      mission_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      reward_points INTEGER NOT NULL CHECK (reward_points BETWEEN 20 AND 200),
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, mission_id, period_key)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_event_mission_claims_account ON event_mission_claims(account_id, claimed_at DESC)'),
  ]);
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_event_mission_reward_claim
    AFTER INSERT ON event_mission_claims
    BEGIN
      UPDATE account_customization
      SET custom_points = custom_points + NEW.reward_points,
          updated_at = NEW.claimed_at
      WHERE account_id = NEW.account_id;
    END`).run();
}

async function incrementMissionMetric(
  db: D1Database,
  accountId: string,
  metric: EventMissionMetric,
  now: number,
): Promise<void> {
  const periods = (['daily', 'weekly'] as const).map((period) => ({
    period,
    ...eventMissionPeriodWindow(period, now),
  }));
  await db.batch(periods.map(({ period, key }) =>
    db.prepare(`INSERT INTO event_mission_progress
      (account_id, metric, period_type, period_key, progress_count, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(account_id, metric, period_type, period_key)
      DO UPDATE SET progress_count = progress_count + 1, updated_at = excluded.updated_at`)
      .bind(accountId, metric, period, key, now)));
}

export async function recordStageClearMissionProgress(
  db: D1Database,
  accountId: string,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureEventMissionSchema(db);
  await incrementMissionMetric(db, accountId, 'stage-clears', now);
}

export async function recordRankedCompletionMissionProgress(
  db: D1Database,
  accountId: string,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureEventMissionSchema(db);
  await incrementMissionMetric(db, accountId, 'ranked-completions', now);
}

export async function recordLoginMissionProgress(
  db: D1Database,
  accountId: string,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<void> {
  if (bootstrapSchema) await ensureEventMissionSchema(db);
  const daily = eventMissionPeriodWindow('daily', now);
  const weekly = eventMissionPeriodWindow('weekly', now);
  const inserted = await db.prepare(`INSERT OR IGNORE INTO event_mission_login_days
    (account_id, day_key, week_key, recorded_at) VALUES (?, ?, ?, ?)`)
    .bind(accountId, daily.key, weekly.key, now).run();
  if ((inserted.meta.changes ?? 0) === 0) return;
  const weeklyLoginDays = await db.prepare(`SELECT COUNT(*) AS count
    FROM event_mission_login_days WHERE account_id = ? AND week_key = ?`)
    .bind(accountId, weekly.key).first<{ count: number }>();
  await db.batch([
    db.prepare(`INSERT INTO event_mission_progress
      (account_id, metric, period_type, period_key, progress_count, updated_at)
      VALUES (?, 'login-days', 'daily', ?, 1, ?)
      ON CONFLICT(account_id, metric, period_type, period_key)
      DO UPDATE SET progress_count = 1, updated_at = excluded.updated_at`)
      .bind(accountId, daily.key, now),
    db.prepare(`INSERT INTO event_mission_progress
      (account_id, metric, period_type, period_key, progress_count, updated_at)
      VALUES (?, 'login-days', 'weekly', ?, ?, ?)
      ON CONFLICT(account_id, metric, period_type, period_key)
      DO UPDATE SET progress_count = excluded.progress_count, updated_at = excluded.updated_at`)
      .bind(accountId, weekly.key, Math.max(1, weeklyLoginDays?.count ?? 1), now),
  ]);
}

export async function eventMissionOverview(
  db: D1Database,
  accountId: string,
  now = Date.now(),
  bootstrapSchema = false,
): Promise<EventMissionOverview> {
  if (bootstrapSchema) await ensureEventMissionSchema(db);
  const daily = eventMissionPeriodWindow('daily', now);
  const weekly = eventMissionPeriodWindow('weekly', now);
  const [progressResult, claimsResult, wallet] = await Promise.all([
    db.prepare(`SELECT metric, period_type, period_key, progress_count
      FROM event_mission_progress
      WHERE account_id = ?
        AND ((period_type = 'daily' AND period_key = ?)
          OR (period_type = 'weekly' AND period_key = ?))`)
      .bind(accountId, daily.key, weekly.key).all<ProgressRow>(),
    db.prepare(`SELECT mission_id, period_key
      FROM event_mission_claims
      WHERE account_id = ? AND period_key IN (?, ?)`)
      .bind(accountId, daily.key, weekly.key).all<ClaimRow>(),
    db.prepare('SELECT custom_points FROM account_customization WHERE account_id = ?')
      .bind(accountId).first<{ custom_points: number }>(),
  ]);
  const progress = new Map(
    (progressResult.results ?? []).map((row) => [`${row.metric}:${row.period_type}:${row.period_key}`, row.progress_count]),
  );
  const claimed = new Set(
    (claimsResult.results ?? []).map((row) => `${row.mission_id}:${row.period_key}`),
  );
  const periodState = (period: EventMissionPeriod, window: typeof daily) => {
    return {
      key: window.key,
      resetsAt: window.resetsAt,
      missions: eventMissionsForPeriod(period).map((mission) => {
        const missionClaimed = claimed.has(`${mission.id}:${window.key}`);
        const metricProgress = progress.get(`${mission.metric}:${period}:${window.key}`) ?? 0;
        const completed = metricProgress >= mission.target;
        return {
          ...mission,
          progress: Math.min(metricProgress, mission.target),
          completed,
          claimed: missionClaimed,
          claimable: completed && !missionClaimed,
        };
      }),
    };
  };
  const periods = {
    daily: periodState('daily', daily),
    weekly: periodState('weekly', weekly),
  };
  const missions = [...periods.daily.missions, ...periods.weekly.missions];
  return {
    serverNow: now,
    customPoints: wallet?.custom_points ?? 0,
    claimableCount: missions.filter((mission) => mission.claimable).length,
    hasProgress: missions.some((mission) => mission.progress > 0),
    periods,
  };
}

export async function claimEventMissionRewards(
  db: D1Database,
  accountId: string,
  requestedMissionIds: readonly string[],
  now = Date.now(),
  bootstrapSchema = false,
): Promise<{ overview: EventMissionOverview; awardedPoints: number; claimedCount: number }> {
  if (bootstrapSchema) await ensureEventMissionSchema(db);
  await db.prepare(`INSERT OR IGNORE INTO account_customization
    (account_id, custom_points, appearance, updated_at) VALUES (?, 0, '{}', ?)`)
    .bind(accountId, now).run();
  const requested = new Set(requestedMissionIds);
  const definitions = EVENT_MISSIONS.filter((mission) => requested.size === 0 || requested.has(mission.id));
  const statements = definitions.map((mission) => {
    const window = eventMissionPeriodWindow(mission.period, now);
    return {
      mission,
      statement: db.prepare(`INSERT OR IGNORE INTO event_mission_claims
        (account_id, mission_id, period_key, reward_points, claimed_at)
        SELECT ?, ?, ?, ?, ?
        WHERE COALESCE((
          SELECT progress_count FROM event_mission_progress
          WHERE account_id = ? AND metric = ? AND period_type = ? AND period_key = ?
        ), 0) >= ?`)
        .bind(
          accountId,
          mission.id,
          window.key,
          mission.rewardPoints,
          now,
          accountId,
          mission.metric,
          mission.period,
          window.key,
          mission.target,
        ),
    };
  });
  const results = statements.length > 0
    ? await db.batch(statements.map(({ statement }) => statement))
    : [];
  let awardedPoints = 0;
  let claimedCount = 0;
  results.forEach((result, index) => {
    // D1 includes the wallet update performed by the AFTER INSERT trigger in
    // meta.changes, so a successful claim can report 2 rather than 1.
    if ((result.meta.changes ?? 0) === 0) return;
    claimedCount += 1;
    awardedPoints += statements[index]?.mission.rewardPoints ?? 0;
  });
  return {
    overview: await eventMissionOverview(db, accountId, now),
    awardedPoints,
    claimedCount,
  };
}
