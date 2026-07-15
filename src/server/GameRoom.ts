import { DurableObject } from 'cloudflare:workers';
import { BALANCE } from '../shared/balance';
import { generateMap } from '../shared/map';
import { encodeMessage, parseClientMessage } from '../shared/protocol';
import type { ServerMessage } from '../shared/types';
import type { PlayMode, RankId, StageId } from '../shared/types';
import { recordMatchResult } from './auth';
import { GameEngine, type PersistedEngine } from './engine';
import type { Env } from './worker';

interface ConnectionAttachment {
  playerId: string;
  reconnectToken: string;
  lastSequence: number;
}

interface InitPayload {
  code: string;
  seed: number;
  testMode: boolean;
  stageId: StageId;
  playMode: PlayMode;
}

export class GameRoom extends DurableObject<Env> {
  private engine: GameEngine | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotAccumulator = 0;
  private persistAccumulator = 0;
  private recordedMatchId: string | null = null;
  private recordingMatchId: string | null = null;
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
      const row = this.ctx.storage.sql.exec<{ code: string; seed: number; test_mode: number }>(
        'SELECT code, seed, test_mode FROM room_meta WHERE id = 1',
      ).toArray()[0];
      if (row) {
        const map = generateMap(row.seed);
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
    const map = generateMap(payload.seed);
    this.engine = new GameEngine(payload.code, map, payload.testMode, { stageId: payload.stageId, playMode: payload.playMode });
    this.ctx.storage.sql.exec(
      'INSERT INTO room_meta (id, code, seed, test_mode, created_at) VALUES (1, ?, ?, ?, ?)',
      payload.code,
      payload.seed,
      payload.testMode ? 1 : 0,
      Date.now(),
    );
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
    const deviceId = url.searchParams.get('deviceId') ?? '';
    const reconnectToken = url.searchParams.get('reconnectToken') ?? undefined;
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(deviceId)) return Response.json({ error: '기기 세션이 올바르지 않습니다.' }, { status: 400 });
    let result;
    try {
      result = engine.join({ nickname, deviceId, reconnectToken, accountId, soloRank, multiplayerRank });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '참가할 수 없습니다.' }, { status: 409 });
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
    };
    server.serializeAttachment(attachment);
    this.startTicking();
    this.sendWelcome(server, attachment);
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
    const result = engine.handle(attachment.playerId, parsed.message);
    if (!result.ok) this.sendError(socket, 'ACTION_REJECTED', result.error ?? '요청이 거부되었습니다.');
    else this.broadcastSnapshot();
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
        this.snapshotAccumulator = 0;
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

  private broadcastSnapshot(): void {
    if (!this.engine) return;
    const message: ServerMessage = {
      type: 'snapshot',
      sequence: this.engine.snapshot().serverSeq,
      timestamp: Date.now(),
      snapshot: this.engine.snapshot(),
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

  private async recordOutcomeIfNeeded(): Promise<void> {
    if (!this.engine) return;
    const snapshot = this.engine.snapshot();
    if ((snapshot.status !== 'VICTORY' && snapshot.status !== 'DEFEAT') || this.recordedMatchId === snapshot.matchId || this.recordingMatchId === snapshot.matchId) return;
    this.recordingMatchId = snapshot.matchId;
    const victory = snapshot.status === 'VICTORY';
    try {
      await Promise.all(snapshot.players.filter((player) => !player.isBot && player.accountId).map((player) => recordMatchResult(this.env.DB, {
        matchId: snapshot.matchId,
        accountId: player.accountId as string,
        playMode: snapshot.playMode,
        stageIndex: snapshot.stageIndex,
        victory,
        elapsed: snapshot.elapsed,
      })));
      this.recordedMatchId = snapshot.matchId;
    } catch (error) {
      console.error('Failed to record match result', error);
    } finally {
      this.recordingMatchId = null;
    }
  }
}
