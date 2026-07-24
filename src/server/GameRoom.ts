import { DurableObject } from 'cloudflare:workers';
import { BALANCE } from '../shared/balance';
import { normalizeAppearance, normalizeTurretSkins } from '../shared/customization';
import { generateMap } from '../shared/map';
import { encodeMessage, parseClientMessage } from '../shared/protocol';
import type { ConsumableId, OwnedConsumable, PlayMode, ProfileDisplayMode, RankedMatchState, RankedTier, RankId, ServerMessage, StageId } from '../shared/types';
import { consumeMatchConsumable, recordMatchResult, recordRankedMatchResult } from './auth';
import { shopConsumableById } from '../shared/shopConsumables';
import { GameEngine, type PersistedEngine } from './engine';
import type { Env } from './worker';

interface ConnectionAttachment {
  playerId: string;
  reconnectToken: string;
  lastSequence: number;
  lastBuildAt: number;
}

interface InitPayload {
  code: string;
  seed: number;
  testMode: boolean;
  stageId: StageId;
  playMode: PlayMode;
  ranked?: RankedMatchState | null;
  rankedQueue?: RankedQueueRoomConfig | null;
}

interface RankedQueueRoomConfig {
  expectedAccountIds: string[];
  botCount: number;
}

const RANKED_LOANED_SUPPLIES: readonly ConsumableId[] = [
  'scout-flare',
  'quick-mortar',
  'toolbelt-voucher',
];

const RANKED_TIERS = new Set<RankedTier>(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'challenger']);

function profileDisplayModeFromHeader(value: string | null): ProfileDisplayMode {
  return value === 'multiplayer' || value === 'ranked' ? value : 'solo';
}

function rankedTierFromHeader(value: string | null): RankedTier {
  return value && RANKED_TIERS.has(value as RankedTier) ? value as RankedTier : 'bronze';
}

export class GameRoom extends DurableObject<Env> {
  private engine: GameEngine | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotAccumulator = 0;
  private persistAccumulator = 0;
  private recordedMatchId: string | null = null;
  private recordingMatchId: string | null = null;
  private rankedQueue: RankedQueueRoomConfig | null = null;
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          code TEXT NOT NULL,
          seed INTEGER NOT NULL,
          test_mode INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      const persisted = await this.ctx.storage.get<PersistedEngine>('engine');
      this.rankedQueue = await this.ctx.storage.get<RankedQueueRoomConfig>('ranked-queue') ?? null;
      const row = this.ctx.storage.sql.exec<{ code: string; seed: number; test_mode: number }>(
        'SELECT code, seed, test_mode FROM room_meta WHERE id = 1',
      ).toArray()[0];
      if (row) {
        const map = generateMap(row.seed, persisted?.snapshot.playMode ?? 'multiplayer');
        this.engine = new GameEngine(row.code, map, Boolean(row.test_mode), {
          stageId: persisted?.snapshot.stageId,
          playMode: persisted?.snapshot.playMode,
        });
        if (persisted) this.engine.restore(persisted);
      }
      if (this.engine && this.ctx.getWebSockets().length > 0) this.startTicking();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/init')) return this.initialize(request);
    if (url.pathname.endsWith('/status')) {
      return this.engine
        ? Response.json({ exists: true, status: this.engine.snapshot().status, players: this.engine.snapshot().players.length })
        : Response.json({ exists: false }, { status: 404 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    if (!this.engine) return Response.json({ error: '존재하지 않는 초대 코드입니다.' }, { status: 404 });
    return this.acceptPlayer(request);
  }

  private async initialize(request: Request): Promise<Response> {
    if (this.engine) return Response.json({ error: 'room already exists' }, { status: 409 });
    let payload: InitPayload;
    try {
      payload = await request.json<InitPayload>();
    } catch {
      return Response.json({ error: 'invalid initialization payload' }, { status: 400 });
    }
    if (!/^[A-Z2-9]{8}$/.test(payload.code) || !Number.isSafeInteger(payload.seed)) {
      return Response.json({ error: 'invalid room metadata' }, { status: 400 });
    }
    const map = generateMap(payload.seed, payload.playMode);
    this.engine = new GameEngine(payload.code, map, payload.testMode, { stageId: payload.stageId, playMode: payload.playMode, ranked: payload.ranked ?? null });
    this.rankedQueue = payload.rankedQueue && payload.ranked
      ? {
          expectedAccountIds: [...new Set(payload.rankedQueue.expectedAccountIds)].slice(0, 4),
          botCount: Math.max(0, Math.min(4, Math.floor(payload.rankedQueue.botCount))),
        }
      : null;
    this.ctx.storage.sql.exec(
      'INSERT INTO room_meta (id, code, seed, test_mode, created_at) VALUES (1, ?, ?, ?, ?)',
      payload.code,
      payload.seed,
      payload.testMode ? 1 : 0,
      Date.now(),
    );
    if (this.rankedQueue) await this.ctx.storage.put('ranked-queue', this.rankedQueue);
    await this.persist();
    return Response.json({ code: payload.code, seed: payload.seed });
  }

  private acceptPlayer(request: Request): Response {
    const engine = this.engine as GameEngine;
    const url = new URL(request.url);
    const nickname = decodeURIComponent(request.headers.get('x-account-nickname') ?? url.searchParams.get('nickname') ?? '');
    const accountId = request.headers.get('x-account-id') ?? undefined;
    const soloRank = (request.headers.get('x-solo-rank') ?? 'beginner') as RankId;
    const multiplayerRank = (request.headers.get('x-multiplayer-rank') ?? 'beginner') as RankId;
    const profileDisplayMode = profileDisplayModeFromHeader(request.headers.get('x-profile-display-mode'));
    const profileRankedTier = rankedTierFromHeader(request.headers.get('x-profile-ranked-tier'));
    const requestedRankedRating = Number(request.headers.get('x-profile-ranked-rating'));
    const profileRankedRating = Number.isFinite(requestedRankedRating)
      ? Math.max(0, Math.min(1_000_000, Math.floor(requestedRankedRating)))
      : 800;
    const profileAvatarUrl = request.headers.get('x-profile-avatar-url') || null;
    const appearanceHeader = request.headers.get('x-avatar-appearance');
    const turretSkinsHeader = request.headers.get('x-turret-skins');
    const consumablesHeader = request.headers.get('x-consumable-inventory');
    let appearance = normalizeAppearance(undefined);
    if (appearanceHeader) {
      try { appearance = normalizeAppearance(JSON.parse(decodeURIComponent(appearanceHeader))); } catch { appearance = normalizeAppearance(undefined); }
    }
    let turretSkins = normalizeTurretSkins(undefined);
    if (turretSkinsHeader) {
      try { turretSkins = normalizeTurretSkins(JSON.parse(decodeURIComponent(turretSkinsHeader))); } catch { turretSkins = normalizeTurretSkins(undefined); }
    }
    let consumables: OwnedConsumable[] = [];
    if (consumablesHeader) {
      try {
        const parsed = JSON.parse(decodeURIComponent(consumablesHeader));
        if (Array.isArray(parsed)) {
          consumables = parsed
            .filter((item): item is { itemId: string; quantity: number } =>
              Boolean(item) && typeof item.itemId === 'string' && Number.isInteger(item.quantity),
            )
            .filter((item) => shopConsumableById(item.itemId) && item.quantity > 0)
            .map((item) => ({ itemId: item.itemId as ConsumableId, quantity: item.quantity }));
        }
      } catch { consumables = []; }
    }
    const deviceId = url.searchParams.get('deviceId') ?? '';
    const reconnectToken = url.searchParams.get('reconnectToken') ?? undefined;
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(deviceId)) return Response.json({ error: '기기 세션이 올바르지 않습니다.' }, { status: 400 });
    if (this.rankedQueue && (!accountId || !this.rankedQueue.expectedAccountIds.includes(accountId))) {
      return Response.json({ error: '이 랭크 매치에 배정된 참가자만 입장할 수 있습니다.' }, { status: 403 });
    }
    let result;
    try {
      result = engine.join({
        nickname,
        deviceId,
        reconnectToken,
        accountId,
        soloRank,
        multiplayerRank,
        profileDisplayMode,
        profileRankedTier,
        profileRankedRating,
        profileAvatarUrl,
        appearance,
        turretSkins,
        consumables,
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '참가할 수 없습니다.' }, { status: 409 });
    }
    if (!result.reconnected && engine.snapshot().ranked?.supplyPolicy === 'loaned') {
      engine.grantRankedLoanedSupplies(result.player.id, [...RANKED_LOANED_SUPPLIES]);
    }

    for (const oldSocket of this.ctx.getWebSockets()) {
      const attachment = oldSocket.deserializeAttachment() as ConnectionAttachment | null;
      if (attachment?.playerId === result.player.id) oldSocket.close(4001, 'new connection replaced this session');
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const attachment: ConnectionAttachment = {
      playerId: result.player.id,
      reconnectToken: result.reconnectToken,
      lastSequence: -1,
      lastBuildAt: 0,
    };
    server.serializeAttachment(attachment);
    const autoStarted = this.maybeStartRankedQueueMatch();
    this.startTicking();
    this.sendWelcome(server, attachment);
    if (autoStarted) this.broadcastSnapshot();
    void this.persist();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const engine = this.engine;
    if (!engine) return;
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) return;
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      this.sendError(socket, 'INVALID_MESSAGE', parsed.error);
      return;
    }
    if (parsed.message.sequence <= attachment.lastSequence) {
      this.sendError(socket, 'STALE_SEQUENCE', '이미 처리된 요청입니다.');
      return;
    }
    attachment.lastSequence = parsed.message.sequence;
    if (parsed.message.type === 'build') {
      const now = Date.now();
      if (now - (attachment.lastBuildAt ?? 0) < BALANCE.buildInputCooldownMs) {
        socket.serializeAttachment(attachment);
        this.sendError(socket, 'ACTION_THROTTLED', '설치 입력이 너무 빠릅니다. 잠시 후 다시 눌러주세요.');
        return;
      }
      attachment.lastBuildAt = now;
    }
    socket.serializeAttachment(attachment);
    if (parsed.message.type === 'ping') {
      this.send(socket, {
        type: 'pong',
        sequence: engine.snapshot().serverSeq,
        timestamp: Date.now(),
        clientTime: parsed.message.clientTime,
        serverTime: Date.now(),
      });
      return;
    }
    if (parsed.message.type === 'resync') {
      this.sendWelcome(socket, attachment);
      return;
    }
    if (
      this.rankedQueue &&
      (parsed.message.type === 'ready' ||
        parsed.message.type === 'start' ||
        parsed.message.type === 'add-bot' ||
        parsed.message.type === 'remove-bot' ||
        parsed.message.type === 'kick-player')
    ) {
      this.sendError(socket, 'ACTION_REJECTED', '랭크전은 대기열 배정 후 자동으로 시작됩니다.');
      return;
    }
    if (parsed.message.type === 'use-consumable') {
      const player = engine.snapshot().players.find((candidate) => candidate.id === attachment.playerId);
      const definition = shopConsumableById(parsed.message.itemId);
      const validation = engine.validateConsumableUse(attachment.playerId, parsed.message);
      if (!player?.accountId || !definition || !validation.ok) {
        this.sendError(socket, 'ACTION_REJECTED', validation.error ?? '전술 보급을 사용할 수 없습니다.');
        return;
      }
      const usesLoanedSupply = engine.snapshot().ranked?.supplyPolicy === 'loaned';
      if (!usesLoanedSupply) {
        const consumed = await consumeMatchConsumable(this.env.DB, {
          matchId: engine.snapshot().matchId,
          accountId: player.accountId,
          itemId: definition.id,
          target: { roomId: parsed.message.roomId, targetId: parsed.message.targetId, tile: parsed.message.tile },
        }, this.env.DATA_ENV === 'local-e2e');
        if (!consumed.ok) {
          this.sendError(socket, 'ACTION_REJECTED', consumed.error);
          return;
        }
      }
      const result = engine.useConsumable(attachment.playerId, parsed.message);
      if (!result.ok) {
        this.sendError(socket, 'ACTION_REJECTED', result.error ?? '전술 보급 효과를 적용하지 못했습니다.');
        return;
      }
      this.broadcastSnapshot();
      await this.persist();
      return;
    }
    if (parsed.message.type === 'leave-room') {
      const result = engine.leaveLobby(attachment.playerId);
      if (!result.ok) {
        this.sendError(socket, 'ACTION_REJECTED', result.error ?? '방을 나갈 수 없습니다.');
        return;
      }
      this.send(socket, {
        type: 'room-exit', sequence: engine.snapshot().serverSeq, timestamp: Date.now(), reason: result.roomEmpty ? 'room-closed' : 'left',
      });
      socket.close(1000, 'left room');
      if (result.roomEmpty) await this.destroyRoom();
      else {
        this.broadcastSnapshot();
        await this.persist();
      }
      return;
    }
    if (parsed.message.type === 'kick-player') {
      const result = engine.kickPlayer(attachment.playerId, parsed.message.playerId);
      if (!result.ok) {
        this.sendError(socket, 'ACTION_REJECTED', result.error ?? '플레이어를 추방할 수 없습니다.');
        return;
      }
      for (const targetSocket of this.ctx.getWebSockets()) {
        const targetAttachment = targetSocket.deserializeAttachment() as ConnectionAttachment | null;
        if (targetAttachment?.playerId !== result.removedPlayerId) continue;
        this.send(targetSocket, {
          type: 'room-exit', sequence: engine.snapshot().serverSeq, timestamp: Date.now(), reason: 'kicked',
        });
        targetSocket.close(4003, 'kicked by room host');
      }
      this.broadcastSnapshot();
      await this.persist();
      return;
    }
    const result = engine.handle(attachment.playerId, parsed.message);
    if (!result.ok) this.sendError(socket, 'ACTION_REJECTED', result.error ?? '요청이 거부되었습니다.');
    else if (parsed.message.type !== 'move') this.broadcastSnapshot();
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ready;
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (attachment && this.engine) {
      const stillConnected = this.ctx.getWebSockets().some((candidate) => {
        if (candidate === socket || candidate.readyState !== WebSocket.OPEN) return false;
        const other = candidate.deserializeAttachment() as ConnectionAttachment | null;
        return other?.playerId === attachment.playerId;
      });
      if (!stillConnected) this.engine.disconnect(attachment.playerId);
      await this.persist();
    }
    if (this.ctx.getWebSockets().length === 0) {
      this.stopTicking();
      await this.ctx.storage.setAlarm(Date.now() + BALANCE.inactiveCleanupMs);
    }
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  override async alarm(): Promise<void> {
    await this.ready;
    if (!this.engine) return;
    if (this.ctx.getWebSockets().length === 0 && this.engine.shouldCleanup()) {
      for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'room expired');
      this.stopTicking();
      await this.ctx.storage.deleteAll();
      this.engine = null;
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + BALANCE.inactiveCleanupMs);
  }

  private startTicking(): void {
    if (this.tickTimer) return;
    const interval = 1_000 / BALANCE.tickRate;
    let previous = Date.now();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - previous) / 1_000);
      previous = now;
      this.engine?.tick(dt, now);
      void this.recordOutcomeIfNeeded();
      this.snapshotAccumulator += dt;
      this.persistAccumulator += dt;
      if (this.snapshotAccumulator >= 1 / BALANCE.snapshotRate) {
        this.snapshotAccumulator -= 1 / BALANCE.snapshotRate;
        this.broadcastSnapshot();
      }
      if (this.persistAccumulator >= 1) {
        this.persistAccumulator = 0;
        void this.persist();
      }
    }, interval);
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  /** Starts a ranked lobby only after every queued human has connected. */
  private maybeStartRankedQueueMatch(): boolean {
    const engine = this.engine;
    const queue = this.rankedQueue;
    if (!engine || !queue || engine.snapshot().status !== 'LOBBY') return false;
    const expected = new Set(queue.expectedAccountIds);
    const joined = new Set(
      engine.snapshot().players
        .filter((player) => !player.isBot && player.accountId && expected.has(player.accountId))
        .map((player) => player.accountId as string),
    );
    if (joined.size !== expected.size || expected.size === 0) return false;
    const hostId = engine.snapshot().hostId;
    if (!hostId) return false;
    for (let index = 0; index < queue.botCount; index += 1) {
      const bot = engine.addBot(hostId, 'normal');
      if (!bot.ok) return false;
    }
    return engine.start(hostId, true).ok;
  }

  private broadcastSnapshot(): void {
    if (!this.engine) return;
    const snapshot = this.engine.snapshot();
    const message: ServerMessage = {
      type: 'snapshot',
      sequence: snapshot.serverSeq,
      timestamp: Date.now(),
      snapshot,
      events: this.engine.drainEvents(),
    };
    const encoded = encodeMessage(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
    }
  }

  private sendWelcome(socket: WebSocket, attachment: ConnectionAttachment): void {
    if (!this.engine) return;
    this.send(socket, {
      type: 'welcome',
      sequence: this.engine.snapshot().serverSeq,
      timestamp: Date.now(),
      playerId: attachment.playerId,
      reconnectToken: attachment.reconnectToken,
      reconnectDeadline: Date.now() + BALANCE.reconnectMs,
      map: this.engine.map,
      snapshot: this.engine.snapshot(),
    });
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, {
      type: 'error',
      sequence: this.engine?.snapshot().serverSeq ?? 0,
      timestamp: Date.now(),
      code,
      message,
    });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
  }

  private async persist(): Promise<void> {
    if (this.engine) await this.ctx.storage.put('engine', this.engine.serialize());
  }

  private async destroyRoom(): Promise<void> {
    this.stopTicking();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.engine = null;
  }

  private async recordOutcomeIfNeeded(): Promise<void> {
    if (!this.engine) return;
    const snapshot = this.engine.snapshot();
    if ((snapshot.status !== 'VICTORY' && snapshot.status !== 'DEFEAT') || this.recordedMatchId === snapshot.matchId || this.recordingMatchId === snapshot.matchId) return;
    this.recordingMatchId = snapshot.matchId;
    const victory = snapshot.status === 'VICTORY';
    try {
      await Promise.all(snapshot.players.filter((player) => !player.isBot && player.accountId).map(async (player) => {
        await recordMatchResult(this.env.DB, {
          matchId: snapshot.matchId,
          accountId: player.accountId as string,
          playMode: snapshot.playMode,
          stageIndex: snapshot.stageIndex,
          victory,
          elapsed: snapshot.elapsed,
          timeAttack: snapshot.difficulty.modifier === 'time-attack',
        }, this.env.DATA_ENV === 'local-e2e');
        if (!snapshot.ranked) return;
        const ownedRooms = snapshot.rooms.filter((room) => room.ownerIds.includes(player.id));
        const doorHpRatio = ownedRooms.length > 0
          ? ownedRooms.reduce((total, room) => total + room.doorHp / Math.max(1, room.doorMaxHp), 0) / ownedRooms.length
          : 0;
        await recordRankedMatchResult(this.env.DB, {
          matchId: snapshot.matchId,
          accountId: player.accountId as string,
          seasonId: snapshot.ranked.seasonId,
          contractId: snapshot.ranked.contractId,
          contractNumber: snapshot.ranked.contractNumber,
          victory,
          elapsed: snapshot.elapsed,
          doorHpRatio,
          suppliesUsed: snapshot.ranked.supplyPolicy === 'penalized' ? player.usedConsumables.length : 0,
        }, this.env.DATA_ENV === 'local-e2e');
      }));
      this.recordedMatchId = snapshot.matchId;
    } catch (error) {
      console.error('Failed to record match result', error);
    } finally {
      this.recordingMatchId = null;
    }
  }
}
