import { DurableObject } from 'cloudflare:workers';
import type { RankedMatchState, RankedTier, StageId } from '../shared/types';
import { contractSeed, createRoomCode } from './rankedMatch';
import type { Env } from './worker';

const REQUIRED_PLAYERS = 4;
const BOT_FILL_AFTER_MS = 40_000;
const ENTRY_STALE_AFTER_MS = 20_000;
const MATCH_ASSIGNMENT_TTL_MS = 15 * 60_000;
const BASE_RATING_WINDOW = 150;
const EXPANDING_RATING_WINDOW = 50;
const MAX_RATING_WINDOW = 500;

export interface RankedQueuePlayer {
  accountId: string;
  nickname: string;
  rating: number;
  avatarUrl: string | null;
  tier: RankedTier;
  joinedAt: number;
  lastSeenAt: number;
}

export interface RankedQueueJoinInput {
  accountId: string;
  nickname: string;
  rating: number;
  avatarUrl: string | null;
  tier: RankedTier;
  testMode: boolean;
  ranked: RankedMatchState;
  stageId: StageId;
}

export interface RankedQueueStatus {
  status: 'waiting' | 'matched' | 'idle';
  elapsedSeconds: number;
  playerCount: number;
  requiredPlayers: number;
  ratingWindow: number;
  players: Array<Pick<RankedQueuePlayer, 'accountId' | 'nickname' | 'rating' | 'avatarUrl' | 'tier'>>;
  roomCode?: string;
  botCount?: number;
}

interface StoredEntry extends RankedQueuePlayer, Record<string, SqlStorageValue> {
  contractId: string;
  seasonId: string;
  contractNumber: number;
  modifier: RankedMatchState['modifier'];
  goldenTurretPolicy: RankedMatchState['goldenTurretPolicy'];
  supplyPolicy: RankedMatchState['supplyPolicy'];
  stageId: StageId;
  testMode: number;
}

interface MatchAssignment extends Record<string, SqlStorageValue> {
  account_id: string;
  room_code: string;
  matched_at: number;
  player_count: number;
  bot_count: number;
}

/**
 * One queue object coordinates one ranked contract. The contract scope keeps
 * matchmaking strongly consistent without turning every ranked season into a
 * single global bottleneck.
 */
export class RankedQueue extends DurableObject<Env> {
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ranked_queue_entries (
          account_id TEXT PRIMARY KEY,
          nickname TEXT NOT NULL,
          rating INTEGER NOT NULL,
          avatar_url TEXT NOT NULL DEFAULT '',
          tier TEXT NOT NULL DEFAULT 'bronze',
          joined_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          contract_id TEXT NOT NULL,
          season_id TEXT NOT NULL,
          contract_number INTEGER NOT NULL,
          modifier TEXT NOT NULL,
          golden_turret_policy TEXT NOT NULL,
          supply_policy TEXT NOT NULL,
          stage_id TEXT NOT NULL,
          test_mode INTEGER NOT NULL DEFAULT 0
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS ranked_queue_assignments (
          account_id TEXT PRIMARY KEY,
          room_code TEXT NOT NULL,
          matched_at INTEGER NOT NULL,
          player_count INTEGER NOT NULL,
          bot_count INTEGER NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(
        'CREATE INDEX IF NOT EXISTS idx_ranked_queue_entries_contract ON ranked_queue_entries(contract_id, joined_at)',
      );
      const entryColumns = this.ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(ranked_queue_entries)').toArray();
      if (!entryColumns.some((column) => column.name === 'avatar_url'))
        this.ctx.storage.sql.exec("ALTER TABLE ranked_queue_entries ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''");
      if (!entryColumns.some((column) => column.name === 'tier'))
        this.ctx.storage.sql.exec("ALTER TABLE ranked_queue_entries ADD COLUMN tier TEXT NOT NULL DEFAULT 'bronze'");
    });
  }

  async join(input: RankedQueueJoinInput): Promise<RankedQueueStatus> {
    await this.ready;
    const now = Date.now();
    this.prune(now);
    const assigned = this.assignmentFor(input.accountId);
    if (assigned) return this.assignmentStatus(assigned, now);
    const existing = this.entryFor(input.accountId);
    this.ctx.storage.sql.exec(
      `INSERT INTO ranked_queue_entries (
        account_id, nickname, rating, avatar_url, tier, joined_at, last_seen_at, contract_id,
        season_id, contract_number, modifier, golden_turret_policy,
        supply_policy, stage_id, test_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        nickname = excluded.nickname,
        rating = excluded.rating,
        avatar_url = excluded.avatar_url,
        tier = excluded.tier,
        last_seen_at = excluded.last_seen_at,
        contract_id = excluded.contract_id,
        season_id = excluded.season_id,
        contract_number = excluded.contract_number,
        modifier = excluded.modifier,
        golden_turret_policy = excluded.golden_turret_policy,
        supply_policy = excluded.supply_policy,
        stage_id = excluded.stage_id,
        test_mode = excluded.test_mode`,
      input.accountId,
      input.nickname.slice(0, 12),
      Math.max(0, Math.round(input.rating)),
      input.avatarUrl ?? '',
      input.tier,
      existing?.joinedAt ?? now,
      now,
      input.ranked.contractId,
      input.ranked.seasonId,
      input.ranked.contractNumber,
      input.ranked.modifier,
      input.ranked.goldenTurretPolicy,
      input.ranked.supplyPolicy,
      input.stageId,
      input.testMode ? 1 : 0,
    );
    await this.matchmake(now);
    await this.scheduleNextAlarm(now);
    return this.queueStatus(input.accountId);
  }

  async status(accountId: string): Promise<RankedQueueStatus> {
    await this.ready;
    const now = Date.now();
    this.prune(now);
    const entry = this.entryFor(accountId);
    if (entry) {
      this.ctx.storage.sql.exec(
        'UPDATE ranked_queue_entries SET last_seen_at = ? WHERE account_id = ?',
        now,
        accountId,
      );
    }
    await this.matchmake(now);
    await this.scheduleNextAlarm(now);
    return this.queueStatus(accountId);
  }

  async leave(accountId: string): Promise<{ left: boolean }> {
    await this.ready;
    const assignment = this.assignmentFor(accountId);
    if (assignment) return { left: false };
    this.ctx.storage.sql.exec('DELETE FROM ranked_queue_entries WHERE account_id = ?', accountId);
    await this.scheduleNextAlarm(Date.now());
    return { left: true };
  }

  override async alarm(): Promise<void> {
    await this.ready;
    const now = Date.now();
    try {
      this.prune(now);
      await this.matchmake(now);
    } catch (error) {
      console.error('Ranked queue alarm failed', error);
    } finally {
      await this.scheduleNextAlarm(Date.now());
    }
  }

  private queueStatus(accountId: string): RankedQueueStatus {
    const now = Date.now();
    const assignment = this.assignmentFor(accountId);
    if (assignment) return this.assignmentStatus(assignment, now);
    const entry = this.entryFor(accountId);
    if (!entry) {
      return {
        status: 'idle',
        elapsedSeconds: 0,
        playerCount: 0,
        requiredPlayers: REQUIRED_PLAYERS,
        ratingWindow: BASE_RATING_WINDOW,
        players: [],
      };
    }
    const compatible = this.compatibleEntries(entry, now);
    return {
      status: 'waiting',
      elapsedSeconds: Math.floor((now - entry.joinedAt) / 1_000),
      playerCount: compatible.length,
      requiredPlayers: REQUIRED_PLAYERS,
      ratingWindow: this.ratingWindowFor(entry, now),
      players: compatible.slice(0, REQUIRED_PLAYERS).map(({ accountId, nickname, rating, avatarUrl, tier }) => ({ accountId, nickname, rating, avatarUrl, tier })),
    };
  }

  private assignmentStatus(assignment: MatchAssignment, now: number): RankedQueueStatus {
    return {
      status: 'matched',
      elapsedSeconds: Math.floor((now - assignment.matched_at) / 1_000),
      playerCount: assignment.player_count,
      requiredPlayers: REQUIRED_PLAYERS,
      ratingWindow: BASE_RATING_WINDOW,
      players: [],
      roomCode: assignment.room_code,
      botCount: assignment.bot_count,
    };
  }

  private entries(): StoredEntry[] {
    return this.ctx.storage.sql.exec<StoredEntry>(
      `SELECT
        account_id as accountId, nickname, rating, avatar_url as avatarUrl, tier, joined_at as joinedAt,
        last_seen_at as lastSeenAt, contract_id as contractId,
        season_id as seasonId, contract_number as contractNumber,
        modifier, golden_turret_policy as goldenTurretPolicy,
        supply_policy as supplyPolicy, stage_id as stageId, test_mode as testMode
       FROM ranked_queue_entries
       ORDER BY joined_at ASC, account_id ASC`,
    ).toArray();
  }

  private entryFor(accountId: string): StoredEntry | undefined {
    return this.entries().find((entry) => entry.accountId === accountId);
  }

  private assignmentFor(accountId: string): MatchAssignment | undefined {
    return this.ctx.storage.sql.exec<MatchAssignment>(
      'SELECT account_id, room_code, matched_at, player_count, bot_count FROM ranked_queue_assignments WHERE account_id = ?',
      accountId,
    ).toArray()[0];
  }

  private compatibleEntries(anchor: StoredEntry, now: number): StoredEntry[] {
    const allowed = this.ratingWindowFor(anchor, now);
    return this.entries().filter((entry) =>
      entry.contractId === anchor.contractId &&
      Math.abs(entry.rating - anchor.rating) <= allowed,
    );
  }

  private ratingWindowFor(entry: StoredEntry, now: number): number {
    const growth = Math.floor(Math.max(0, now - entry.joinedAt) / 10_000) * EXPANDING_RATING_WINDOW;
    return Math.min(MAX_RATING_WINDOW, BASE_RATING_WINDOW + growth);
  }

  private async matchmake(now: number): Promise<void> {
    let candidates = this.entries();
    while (candidates.length > 0) {
      let selected: StoredEntry[] | null = null;
      let botCount = 0;
      for (const anchor of candidates) {
        const matching = candidates
          .filter((entry) =>
            entry.contractId === anchor.contractId &&
            Math.abs(entry.rating - anchor.rating) <= this.ratingWindowFor(anchor, now),
          )
          .slice(0, REQUIRED_PLAYERS);
        if (matching.length === REQUIRED_PLAYERS) {
          selected = matching;
          break;
        }
      }
      if (!selected) {
        const oldest = candidates[0];
        if (!oldest || now - oldest.joinedAt < BOT_FILL_AFTER_MS) break;
        selected = candidates
          .filter((entry) => entry.contractId === oldest.contractId)
          .sort((left, right) =>
            Math.abs(left.rating - oldest.rating) - Math.abs(right.rating - oldest.rating) ||
            left.joinedAt - right.joinedAt,
          )
          .slice(0, REQUIRED_PLAYERS);
        botCount = REQUIRED_PLAYERS - selected.length;
      }
      if (selected.length === 0) break;
      const created = await this.createMatch(selected, botCount);
      if (!created) break;
      const matchedIds = new Set(selected.map((entry) => entry.accountId));
      candidates = candidates.filter((entry) => !matchedIds.has(entry.accountId));
    }
  }

  private async createMatch(entries: StoredEntry[], botCount: number): Promise<boolean> {
    const anchor = entries[0];
    if (!anchor) return false;
    const roomCode = createRoomCode();
    for (const entry of entries) {
      this.ctx.storage.sql.exec('DELETE FROM ranked_queue_entries WHERE account_id = ?', entry.accountId);
      this.ctx.storage.sql.exec(
        `INSERT INTO ranked_queue_assignments (account_id, room_code, matched_at, player_count, bot_count)
         VALUES (?, ?, ?, ?, ?)`,
        entry.accountId,
        roomCode,
        Date.now(),
        entries.length,
        botCount,
      );
    }
    const ranked: RankedMatchState = {
      seasonId: anchor.seasonId,
      contractId: anchor.contractId,
      contractNumber: anchor.contractNumber,
      modifier: anchor.modifier,
      goldenTurretPolicy: anchor.goldenTurretPolicy,
      supplyPolicy: anchor.supplyPolicy,
    };
    try {
      const response = await this.env.GAME_ROOMS.getByName(roomCode).fetch('https://game-room.internal/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: roomCode,
          seed: contractSeed(ranked.contractId),
          testMode: Boolean(anchor.testMode),
          stageId: anchor.stageId,
          playMode: 'multiplayer',
          ranked,
          rankedQueue: {
            expectedAccountIds: entries.map((entry) => entry.accountId),
            botCount,
          },
        }),
      });
      if (!response.ok) throw new Error(`room init failed (${response.status})`);
      return true;
    } catch (error) {
      console.error('Failed to create ranked room', { roomCode, error: String(error) });
      for (const entry of entries) {
        this.ctx.storage.sql.exec('DELETE FROM ranked_queue_assignments WHERE account_id = ?', entry.accountId);
        this.ctx.storage.sql.exec(
          `INSERT INTO ranked_queue_entries (
            account_id, nickname, rating, avatar_url, tier, joined_at, last_seen_at, contract_id,
            season_id, contract_number, modifier, golden_turret_policy,
            supply_policy, stage_id, test_mode
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          entry.accountId,
          entry.nickname,
          entry.rating,
          entry.avatarUrl ?? '',
          entry.tier,
          entry.joinedAt,
          Date.now(),
          entry.contractId,
          entry.seasonId,
          entry.contractNumber,
          entry.modifier,
          entry.goldenTurretPolicy,
          entry.supplyPolicy,
          entry.stageId,
          entry.testMode,
        );
      }
      return false;
    }
  }

  private prune(now: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM ranked_queue_entries WHERE last_seen_at < ?',
      now - ENTRY_STALE_AFTER_MS,
    );
    this.ctx.storage.sql.exec(
      'DELETE FROM ranked_queue_assignments WHERE matched_at < ?',
      now - MATCH_ASSIGNMENT_TTL_MS,
    );
  }

  private async scheduleNextAlarm(now: number): Promise<void> {
    const oldest = this.ctx.storage.sql.exec<{ joinedAt: number }>(
      'SELECT MIN(joined_at) as joinedAt FROM ranked_queue_entries',
    ).toArray()[0];
    if (!oldest?.joinedAt) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(now + 250, oldest.joinedAt + BOT_FILL_AFTER_MS));
  }
}
