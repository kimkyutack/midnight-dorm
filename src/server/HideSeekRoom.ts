import { DurableObject } from 'cloudflare:workers';
import { normalizeAppearance } from '../shared/customization';
import {
  HIDE_SEEK_RULES,
  parseHideSeekClientMessage,
  type HideSeekServerMessage,
} from '../shared/hideSeek';
import { HideSeekEngine, type HideSeekActionResult, type PersistedHideSeekEngine } from './hideSeekEngine';
import { recordHideSeekMatchResults } from './auth';
import type { RankId } from '../shared/types';
import type { Env } from './worker';

interface HideSeekConnectionAttachment {
  playerId: string;
  reconnectToken: string;
  lastInputSequence: number;
  lastQuickChatAt: number;
  explorationRevision: number;
  spectatorTargetId?: string;
}

interface HideSeekInitPayload {
  code: string;
  seed: number;
}

const SNAPSHOT_RATE = 10;
const TICK_RATE = 20;
const MAX_BUFFER_BYTES = 96 * 1_024;
const ACTIVE_STATE_PERSIST_INTERVAL_SECONDS = 3;
const SLOW_PERSIST_THRESHOLD_MS = 250;
const SLOW_SERIALIZE_THRESHOLD_MS = 50;

function encodeExploration(mapWidth: number, mapHeight: number, keys: readonly string[]): string {
  const bytes = new Uint8Array(Math.ceil((mapWidth * mapHeight) / 8));
  for (const key of keys) {
    const [x, y] = key.split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0 || (x as number) >= mapWidth || (y as number) >= mapHeight) continue;
    const index = (y as number) * mapWidth + (x as number);
    bytes[Math.floor(index / 8)] = (bytes[Math.floor(index / 8)] as number) | (1 << (index % 8));
  }
  return btoa(String.fromCharCode(...bytes));
}

export class HideSeekRoom extends DurableObject<Env> {
  private engine: HideSeekEngine | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotAccumulator = 0;
  private persistAccumulator = 0;
  private persistInFlight: Promise<void> | null = null;
  private persistQueued = false;
  private recordedMatchId: string | null = null;
  private recordingMatchId: string | null = null;
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS hide_seek_room_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          code TEXT NOT NULL,
          seed INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      const row = this.ctx.storage.sql.exec<{ code: string; seed: number }>(
        'SELECT code, seed FROM hide_seek_room_meta WHERE id = 1',
      ).toArray()[0];
      const persisted = await this.ctx.storage.get<PersistedHideSeekEngine>('engine');
      if (row) {
        this.engine = new HideSeekEngine(row.code, row.seed);
        if (persisted) this.engine.restore(persisted);
      }
      if (this.engine && this.ctx.getWebSockets().length > 0 && this.engine.snapshot().phase !== 'LOBBY') this.startTicking();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/init')) return this.initialize(request);
    if (url.pathname.endsWith('/status')) {
      if (!this.engine) return Response.json({ exists: false }, { status: 404 });
      const snapshot = this.engine.snapshot();
      const joinable = snapshot.phase === 'LOBBY'
        && (snapshot.players.length < HIDE_SEEK_RULES.maxPlayers || snapshot.players.some((player) => player.isBot));
      return Response.json({ exists: true, phase: snapshot.phase, players: snapshot.players.length, joinable });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 });
    if (!this.engine) return Response.json({ error: '존재하지 않는 술래잡기 초대 코드입니다.' }, { status: 404 });
    return this.acceptPlayer(request);
  }

  private async initialize(request: Request): Promise<Response> {
    if (this.engine) return Response.json({ error: 'room already exists' }, { status: 409 });
    const payload = await request.json<HideSeekInitPayload>().catch(() => null);
    if (!payload || !/^[A-Z2-9]{8}$/.test(payload.code) || !Number.isSafeInteger(payload.seed)) return Response.json({ error: 'invalid room metadata' }, { status: 400 });
    this.engine = new HideSeekEngine(payload.code, payload.seed);
    this.ctx.storage.sql.exec(
      'INSERT INTO hide_seek_room_meta (id, code, seed, created_at) VALUES (1, ?, ?, ?)',
      payload.code,
      payload.seed,
      Date.now(),
    );
    await this.persist();
    return Response.json({ code: payload.code, seed: payload.seed });
  }

  private acceptPlayer(request: Request): Response {
    const engine = this.engine as HideSeekEngine;
    const url = new URL(request.url);
    const accountId = request.headers.get('x-account-id') ?? undefined;
    const nickname = decodeURIComponent(request.headers.get('x-account-nickname') ?? '생존자');
    const requestedDisplayRank = request.headers.get('x-display-rank');
    const displayRank = (['beginner', 'intermediate', 'expert', 'master', 'veteran', 'legend', 'transcendent', 'immortal', 'absolute'].includes(requestedDisplayRank ?? '')
      ? requestedDisplayRank
      : 'beginner') as RankId;
    const deviceId = url.searchParams.get('deviceId') ?? '';
    const reconnectToken = url.searchParams.get('reconnectToken') ?? undefined;
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(deviceId)) return Response.json({ error: '기기 세션이 올바르지 않습니다.' }, { status: 400 });
    let appearance = normalizeAppearance(undefined);
    const appearanceHeader = request.headers.get('x-avatar-appearance');
    if (appearanceHeader) {
      try { appearance = normalizeAppearance(JSON.parse(decodeURIComponent(appearanceHeader))); } catch { appearance = normalizeAppearance(undefined); }
    }
    let joined;
    try {
      joined = engine.join({ accountId, nickname, deviceId, reconnectToken, appearance, displayRank });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '술래잡기 방에 참가할 수 없습니다.' }, { status: 409 });
    }
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as HideSeekConnectionAttachment | null;
      if (attachment?.playerId === joined.player.id) socket.close(4001, 'new connection replaced this session');
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const attachment: HideSeekConnectionAttachment = {
      playerId: joined.player.id,
      reconnectToken: joined.reconnectToken,
      lastInputSequence: -1,
      lastQuickChatAt: 0,
      explorationRevision: -1,
    };
    server.serializeAttachment(attachment);
    const phase = engine.snapshot().phase;
    if (phase !== 'LOBBY' && phase !== 'RESULT' && phase !== 'CLOSED') this.startTicking();
    const welcomeSnapshot = engine.snapshotFor(joined.player.id);
    const welcomeExploredBits = joined.player.role
      ? encodeExploration(engine.map.width, engine.map.height, welcomeSnapshot.exploredTileKeys)
      : undefined;
    welcomeSnapshot.exploredTileKeys = [];
    attachment.explorationRevision = welcomeSnapshot.explorationRevision;
    server.serializeAttachment(attachment);
    this.send(server, {
      type: 'welcome',
      playerId: joined.player.id,
      reconnectToken: joined.reconnectToken,
      map: engine.map,
      snapshot: welcomeSnapshot,
      exploredBits: welcomeExploredBits,
    });
    this.broadcastSnapshot();
    void this.persist();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const engine = this.engine;
    const attachment = socket.deserializeAttachment() as HideSeekConnectionAttachment | null;
    if (!engine || !attachment) return;
    const message = parseHideSeekClientMessage(raw);
    if (!message) {
      this.send(socket, { type: 'error', message: '올바르지 않은 술래잡기 요청입니다.' });
      return;
    }
    if (message.type === 'ping') {
      this.send(socket, { type: 'pong', clientTime: message.clientTime, serverTime: Date.now() });
      return;
    }
    if (message.type === 'move') {
      if (message.inputSequence <= attachment.lastInputSequence) return;
      attachment.lastInputSequence = message.inputSequence;
      socket.serializeAttachment(attachment);
      const result = engine.setMovement(attachment.playerId, message.dx, message.dy);
      if (!result.ok) this.send(socket, { type: 'error', message: result.error ?? '이동할 수 없습니다.' });
      return;
    }
    if (message.type === 'quick-chat' || message.type === 'chat') {
      const player = engine.snapshot().players.find((candidate) => candidate.id === attachment.playerId);
      const now = Date.now();
      if (!player || player.role !== 'survivor' || !player.alive || now - attachment.lastQuickChatAt < 1_000) {
        this.send(socket, { type: 'error', message: '지금은 팀 채팅을 보낼 수 없습니다.' });
        return;
      }
      attachment.lastQuickChatAt = now;
      socket.serializeAttachment(attachment);
      const outgoing: HideSeekServerMessage = message.type === 'quick-chat'
        ? { type: 'quick-chat', playerId: player.id, playerNumber: player.number ?? 1, phrase: message.phrase, position: { ...player.position } }
        : { type: 'chat', playerId: player.id, playerNumber: player.number ?? 1, text: message.text, position: { ...player.position } };
      for (const target of this.ctx.getWebSockets()) {
        const targetAttachment = target.deserializeAttachment() as HideSeekConnectionAttachment | null;
        const targetPlayer = engine.snapshot().players.find((candidate) => candidate.id === targetAttachment?.playerId);
        if (target.readyState === WebSocket.OPEN && targetPlayer?.role === 'survivor') this.send(target, outgoing);
      }
      return;
    }
    if (message.type === 'spectate') {
      const viewer = engine.snapshot().players.find((player) => player.id === attachment.playerId);
      const target = engine.snapshot().players.find((player) => player.id === message.playerId);
      if (viewer?.role !== 'survivor' || viewer.alive || target?.role !== 'survivor' || !target.alive || target.escaped) {
        this.send(socket, { type: 'error', message: '현재 관전할 수 없는 생존자입니다.' });
        return;
      }
      attachment.spectatorTargetId = target.id;
      socket.serializeAttachment(attachment);
      this.sendSnapshot(socket, attachment);
      return;
    }
    if (message.type === 'leave-room') {
      const result = engine.leave(attachment.playerId);
      this.send(socket, { type: 'room-exit', reason: result.roomEmpty ? 'room-closed' : 'left' });
      socket.close(1000, 'left room');
      if (result.roomEmpty) await this.destroyRoom();
      else {
        this.broadcastSnapshot();
        const resultRecording = engine.snapshot().phase === 'RESULT'
          ? this.recordOutcomeIfNeeded()
          : Promise.resolve();
        if (engine.snapshot().phase === 'RESULT') this.stopTicking();
        await Promise.all([this.persist(), resultRecording]);
      }
      return;
    }

    let result: HideSeekActionResult = { ok: true };
    if (message.type === 'ready') result = engine.setReady(attachment.playerId, message.ready);
    else if (message.type === 'set-preference') result = engine.setPreference(attachment.playerId, message.preference);
    else if (message.type === 'add-bot') result = engine.addBot(attachment.playerId, message.preference ?? 'any');
    else if (message.type === 'remove-bot') result = engine.removeBot(attachment.playerId, message.playerId);
    else if (message.type === 'start') result = engine.start(attachment.playerId);
    else if (message.type === 'sprint') result = engine.sprint(attachment.playerId);
    else if (message.type === 'ghost-light') result = engine.ghostLight(attachment.playerId);
    else if (message.type === 'interact') result = engine.interact(attachment.playerId);
    else if (message.type === 'stop-interact') engine.stopInteract(attachment.playerId);
    if (!result.ok) this.send(socket, { type: 'error', message: result.error ?? '요청이 거부되었습니다.' });
    else {
      if (message.type === 'start') this.startTicking();
      this.broadcastSnapshot();
      await this.persist();
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ready;
    const attachment = socket.deserializeAttachment() as HideSeekConnectionAttachment | null;
    if (attachment && this.engine) {
      const duplicate = this.ctx.getWebSockets().some((candidate) => {
        if (candidate === socket || candidate.readyState !== WebSocket.OPEN) return false;
        return (candidate.deserializeAttachment() as HideSeekConnectionAttachment | null)?.playerId === attachment.playerId;
      });
      if (!duplicate) this.engine.disconnect(attachment.playerId);
      await this.persist();
    }
    if (this.ctx.getWebSockets().length === 0) {
      this.stopTicking();
      await this.ctx.storage.setAlarm(Date.now() + 180_000);
    }
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  override async alarm(): Promise<void> {
    await this.ready;
    if (!this.engine) return;
    if (this.ctx.getWebSockets().length === 0 && this.engine.shouldCleanup()) await this.destroyRoom();
    else await this.ctx.storage.setAlarm(Date.now() + 180_000);
  }

  private startTicking(): void {
    if (this.tickTimer) return;
    let previous = Date.now();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.1, (now - previous) / 1_000);
      previous = now;
      this.engine?.tick(dt);
      this.snapshotAccumulator += dt;
      this.persistAccumulator += dt;
      if (this.snapshotAccumulator >= 1 / SNAPSHOT_RATE) {
        this.snapshotAccumulator -= 1 / SNAPSHOT_RATE;
        this.broadcastSnapshot();
      }
      if (this.persistAccumulator >= ACTIVE_STATE_PERSIST_INTERVAL_SECONDS) {
        this.persistAccumulator = 0;
        void this.persist();
      }
      if (this.engine?.snapshot().phase === 'RESULT') {
        this.broadcastSnapshot();
        this.stopTicking();
        this.ctx.waitUntil(Promise.all([this.persist(), this.recordOutcomeIfNeeded()]).then(() => undefined));
      }
    }, 1_000 / TICK_RATE);
  }

  private stopTicking(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private broadcastSnapshot(): void {
    if (!this.engine) return;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFER_BYTES) continue;
      const attachment = socket.deserializeAttachment() as HideSeekConnectionAttachment | null;
      if (!attachment) continue;
      this.sendSnapshot(socket, attachment);
    }
  }

  private sendSnapshot(socket: WebSocket, attachment: HideSeekConnectionAttachment): void {
    if (!this.engine || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFER_BYTES) return;
    const snapshot = this.engine.snapshotFor(attachment.playerId, attachment.spectatorTargetId);
    const player = snapshot.players.find((candidate) => candidate.id === attachment.playerId);
    const exploredBits = player?.role && attachment.explorationRevision !== snapshot.explorationRevision
      ? encodeExploration(this.engine.map.width, this.engine.map.height, snapshot.exploredTileKeys)
      : undefined;
    if (exploredBits !== undefined) {
      attachment.explorationRevision = snapshot.explorationRevision;
      socket.serializeAttachment(attachment);
    }
    snapshot.exploredTileKeys = [];
    this.send(socket, { type: 'snapshot', snapshot, exploredBits });
  }

  private send(socket: WebSocket, message: HideSeekServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private async persist(): Promise<void> {
    if (!this.engine) return;
    this.persistQueued = true;
    if (this.persistInFlight) return this.persistInFlight;
    this.persistInFlight = (async () => {
      while (this.persistQueued && this.engine) {
        this.persistQueued = false;
        const serializeStartedAt = performance.now();
        const serialized = this.engine.serialize();
        const serializeDurationMs = performance.now() - serializeStartedAt;
        const persistStartedAt = performance.now();
        await this.ctx.storage.put('engine', serialized);
        const persistDurationMs = performance.now() - persistStartedAt;
        if (
          serializeDurationMs >= SLOW_SERIALIZE_THRESHOLD_MS ||
          persistDurationMs >= SLOW_PERSIST_THRESHOLD_MS
        ) {
          console.warn(JSON.stringify({
            event: 'slow_hide_seek_room_persist',
            serializeDurationMs: Math.round(serializeDurationMs),
            persistDurationMs: Math.round(persistDurationMs),
            phase: serialized.snapshot.phase,
            players: serialized.snapshot.players.length,
          }));
        }
      }
    })().finally(() => { this.persistInFlight = null; });
    return this.persistInFlight;
  }

  private async destroyRoom(): Promise<void> {
    this.stopTicking();
    await this.persistInFlight;
    const code = this.engine?.snapshot().code;
    this.engine = null;
    await this.ctx.storage.deleteAlarm();
    this.ctx.storage.sql.exec('DELETE FROM hide_seek_room_meta WHERE id = 1');
    await this.ctx.storage.deleteAll();
    if (code) await this.env.DB.prepare('DELETE FROM hide_seek_room_registry WHERE code = ?').bind(code).run().catch(() => undefined);
  }

  private async recordOutcomeIfNeeded(): Promise<void> {
    if (!this.engine) return;
    const snapshot = this.engine.snapshot();
    if (snapshot.phase !== 'RESULT' || !snapshot.winner || this.recordedMatchId === snapshot.matchId || this.recordingMatchId === snapshot.matchId) return;
    this.recordingMatchId = snapshot.matchId;
    try {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await recordHideSeekMatchResults(this.env.DB, {
            matchId: snapshot.matchId,
            winner: snapshot.winner,
            resultReason: snapshot.resultReason,
            elapsed: snapshot.elapsed,
            players: snapshot.players,
          }, this.env.DATA_ENV === 'local-e2e');
          this.recordedMatchId = snapshot.matchId;
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise<void>((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
        }
      }
      console.error('Failed to record hide-and-seek result', lastError);
    } finally {
      this.recordingMatchId = null;
    }
  }
}
