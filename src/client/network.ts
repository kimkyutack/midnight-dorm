import { BALANCE } from '../shared/balance';
import type { BuildingKind, ClientMessage, ConsumableId, GameEvent, GameSnapshot, GameSnapshotFrame, MapDefinition, QuickChatPhrase, ServerMessage, Tile, Vec2 } from '../shared/types';
import { nativeWebSocketUrlSync } from './native/runtime';

export interface NetworkEvents {
  welcome: { playerId: string; map: MapDefinition; snapshot: GameSnapshot };
  snapshot: { snapshot: GameSnapshot; events: GameEvent[] };
  connection: { state: 'connecting' | 'connected' | 'reconnecting' | 'closed'; attempt: number };
  error: { message: string; fatal?: boolean };
  ping: { milliseconds: number };
  roomExit: { reason: 'left' | 'kicked' | 'room-closed' };
  quickChat: { playerId: string; phrase: QuickChatPhrase };
  gameChat: { playerId: string; message: string };
}

type Listener<K extends keyof NetworkEvents> = (value: NetworkEvents[K]) => void;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'sequence' | 'timestamp'> : never;
type ClientIntent = WithoutEnvelope<ClientMessage>;

const MAX_RECONNECT_ATTEMPTS = 30;
const RECONNECT_DELAY_CAP_MS = 5_000;
const MAX_CLIENT_MOVE_BUFFER_BYTES = 64 * 1_024;

type ParserWorkerResponse =
  | { id: number; generation: number; ok: true; message: ServerMessage }
  | { id: number; generation: number; ok: false };

export function mergeSnapshotFrame(
  previous: GameSnapshot | null,
  frame: GameSnapshotFrame,
  buildings?: GameSnapshot['buildings'],
): GameSnapshot | null {
  const nextBuildings = buildings ?? previous?.buildings;
  if (!nextBuildings) return null;
  return { ...frame, buildings: nextBuildings };
}

export class GameNetwork {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private lastServerSequence = -1;
  private stopped = false;
  private pingTimer: number | null = null;
  private lastBuildSentAt = -Infinity;
  private lastSnapshot: GameSnapshot | null = null;
  private parserWorker: Worker | null = null;
  private parserRequestId = 0;
  private readonly pendingParserRequests = new Map<
    number,
    { raw: string | ArrayBuffer; generation: number }
  >();
  private lastParserFailureAt = 0;
  private socketGeneration = 0;
  private leavePending = false;
  private leaveAttempts = 0;
  private leaveRetryTimer: number | null = null;
  private readonly listeners = new Map<keyof NetworkEvents, Set<(value: never) => void>>();
  reconnectToken = '';
  playerId = '';

  constructor(
    readonly code: string,
    private readonly nickname: string,
    private readonly deviceId: string,
    reconnectToken = '',
  ) {
    this.reconnectToken = reconnectToken;
  }

  on<K extends keyof NetworkEvents>(name: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener as (value: never) => void);
    this.listeners.set(name, set);
    return () => set.delete(listener as (value: never) => void);
  }

  private emit<K extends keyof NetworkEvents>(name: K, value: NetworkEvents[K]): void {
    for (const listener of this.listeners.get(name) ?? []) listener(value as never);
  }

  connect(): void {
    const existingSocket = this.socket;
    if (existingSocket && (
      existingSocket.readyState === WebSocket.CONNECTING ||
      existingSocket.readyState === WebSocket.OPEN
    )) {
      if (existingSocket.readyState === WebSocket.OPEN && this.leavePending)
        this.flushPendingLeave();
      return;
    }
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopped = false;
    this.emit('connection', { state: this.reconnectAttempts ? 'reconnecting' : 'connecting', attempt: this.reconnectAttempts });
    const params = new URLSearchParams({
      nickname: this.nickname,
      deviceId: this.deviceId,
      snapshotFrames: '1',
    });
    if (this.reconnectToken) params.set('reconnectToken', this.reconnectToken);
    const socket = new WebSocket(nativeWebSocketUrlSync(`/api/rooms/${this.code}/ws`, params));
    socket.binaryType = 'arraybuffer';
    const generation = ++this.socketGeneration;
    this.ensureParserWorker();
    let opened = false;
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      opened = true;
      this.reconnectAttempts = 0;
      this.emit('connection', { state: 'connected', attempt: 0 });
      this.startHeartbeat();
      if (this.leavePending) this.flushPendingLeave();
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      const raw = event.data as string | ArrayBuffer | Blob;
      if (raw instanceof Blob) {
        void raw.arrayBuffer().then((buffer) => {
          if (this.socket === socket && generation === this.socketGeneration)
            this.parseIncoming(buffer, generation);
        }).catch(() => this.handleParserFailure());
        return;
      }
      this.parseIncoming(raw, generation);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      if (this.leavePending && !this.stopped) {
        this.reconnectAttempts += 1;
        this.emit('connection', { state: 'reconnecting', attempt: this.reconnectAttempts });
        this.reconnectTimer = window.setTimeout(() => this.connect(), 120);
      } else if (!this.stopped && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts += 1;
        this.emit('connection', { state: 'reconnecting', attempt: this.reconnectAttempts });
        const baseDelay = Math.min(
          RECONNECT_DELAY_CAP_MS,
          450 * 2 ** Math.min(this.reconnectAttempts, 4),
        );
        // Spread simultaneous mobile reconnects after a brief network stall.
        const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
        this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
      } else this.emit('connection', { state: 'closed', attempt: this.reconnectAttempts });
    });
    socket.addEventListener('error', () => {
      if (this.socket !== socket || opened) return;
      // A fresh page has not received a welcome snapshot yet. Retrying a
      // stale deployment/room handshake leaves the app permanently on the
      // loading screen, so let the caller invalidate that saved session.
      this.stopped = true;
      this.emit('error', {
        message: '실시간 서버에 연결하지 못했습니다.',
        fatal: true,
      });
    });
  }

  close(): void {
    this.stopped = true;
    this.clearPendingLeave();
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.socket?.close(1000, 'client left');
    this.socket = null;
    this.parserWorker?.terminate();
    this.parserWorker = null;
    this.pendingParserRequests.clear();
  }

  send(message: ClientIntent): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    if (
      message.type === 'move' &&
      this.socket.bufferedAmount > MAX_CLIENT_MOVE_BUFFER_BYTES
    )
      return false;
    this.socket.send(JSON.stringify({ ...message, sequence: ++this.sequence, timestamp: Date.now() }));
    return true;
  }

  ready(ready: boolean): void { this.send({ type: 'ready', ready }); }
  start(): void { this.send({ type: 'start' }); }
  addBot(difficulty: 'easy' | 'normal' | 'hard' = 'normal'): void { this.send({ type: 'add-bot', difficulty }); }
  removeBot(botId: string): void { this.send({ type: 'remove-bot', botId }); }
  leaveRoom(): void {
    this.leavePending = true;
    this.leaveAttempts = 0;
    this.stopped = false;
    this.flushPendingLeave();
  }
  kickPlayer(playerId: string): void { this.send({ type: 'kick-player', playerId }); }
  move(
    dx: number,
    dy: number,
    inputSequence: number,
    releasePosition?: Vec2,
  ): void {
    this.send({
      type: 'move',
      dx,
      dy,
      inputSequence,
      ...(releasePosition ? { releasePosition } : {}),
    });
  }
  interact(): void { this.send({ type: 'interact' }); }
  freeRepair(): void { this.send({ type: 'free-repair' }); }
  build(roomId: string, tile: Tile, kind: BuildingKind): void {
    const now = performance.now();
    if (now - this.lastBuildSentAt < BALANCE.buildInputCooldownMs) return;
    this.lastBuildSentAt = now;
    this.send({ type: 'build', roomId, tile, kind });
  }
  moveBuilding(buildingId: string, tile: Tile): void { this.send({ type: 'move-building', buildingId, tile }); }
  upgrade(targetId: string): void { this.send({ type: 'upgrade', targetId }); }
  removeBuilding(buildingId: string): void { this.send({ type: 'remove-building', buildingId }); }
  activateBuilding(
    buildingId: string,
    action: 'use' | 'attack' | 'defense' | 'production' | 'berserk' | 'soul-arm' | 'soul-cancel' | 'soul-fire' | 'hide-and-seek' | 'install-golden-turret',
    targetId?: string,
  ): void { this.send({ type: 'activate-building', buildingId, action, targetId }); }
  drawItem(machineId: string): void { this.send({ type: 'draw-item', machineId }); }
  pickupLoot(lootId: string): void { this.send({ type: 'pickup-loot', lootId }); }
  setConsumableLoadout(itemIds: ConsumableId[]): void { this.send({ type: 'set-consumable-loadout', itemIds }); }
  useConsumable(itemId: ConsumableId, target: { roomId?: string; targetId?: string; tile?: Tile } = {}): void {
    this.send({ type: 'use-consumable', itemId, ...target });
  }
  quickChat(phrase: QuickChatPhrase): void { this.send({ type: 'quick-chat', phrase }); }
  gameChat(message: string): void { this.send({ type: 'game-chat', message }); }
  rematch(): void { this.send({ type: 'rematch' }); }
  resync(): void { this.send({ type: 'resync' }); }

  private ensureParserWorker(): void {
    if (this.parserWorker || typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(
        new URL('./network.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.addEventListener(
        'message',
        (event: MessageEvent<ParserWorkerResponse>) => {
          const response = event.data;
          const pending = this.pendingParserRequests.get(response.id);
          this.pendingParserRequests.delete(response.id);
          if (response.generation !== this.socketGeneration) return;
          if (!response.ok) {
            if (pending) this.parseIncomingOnMain(pending.raw, pending.generation);
            else this.handleParserFailure();
            return;
          }
          this.receive(response.message);
        },
      );
      const disableWorker = (): void => this.disableParserWorker();
      worker.addEventListener('error', disableWorker);
      worker.addEventListener('messageerror', disableWorker);
      this.parserWorker = worker;
    } catch {
      this.parserWorker = null;
    }
  }

  private parseIncoming(
    raw: string | ArrayBuffer,
    generation: number,
  ): void {
    if (this.parserWorker) {
      const request = {
        id: ++this.parserRequestId,
        generation,
        raw,
      };
      // Mobile Safari can abort a module worker while decoding a large frame.
      // Keep the original payload so the exact snapshot can be parsed on the
      // main thread instead of being lost as a detached ArrayBuffer.
      this.pendingParserRequests.set(request.id, { raw, generation });
      this.parserWorker.postMessage(request);
      return;
    }
    this.parseIncomingOnMain(raw, generation);
  }

  private parseIncomingOnMain(
    raw: string | ArrayBuffer,
    generation: number,
  ): void {
    if (generation !== this.socketGeneration) return;
    try {
      const text =
        typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      this.receive(JSON.parse(text) as ServerMessage);
    } catch {
      this.handleParserFailure();
    }
  }

  private disableParserWorker(): void {
    const pending = [...this.pendingParserRequests.values()];
    this.pendingParserRequests.clear();
    this.parserWorker?.terminate();
    this.parserWorker = null;
    for (const request of pending)
      this.parseIncomingOnMain(request.raw, request.generation);
  }

  private handleParserFailure(): void {
    const now = performance.now();
    if (now - this.lastParserFailureAt < 1_000) return;
    this.lastParserFailureAt = now;
    this.resync();
    this.emit('error', { message: '화면 동기화를 다시 맞추고 있습니다.' });
  }

  private receive(message: ServerMessage): void {
    if ((message.type === 'snapshot' || message.type === 'snapshot-frame') && message.sequence < this.lastServerSequence) return;
    if (message.type === 'welcome' || message.type === 'snapshot' || message.type === 'snapshot-frame') {
      this.lastServerSequence = message.sequence;
    }
    if (message.type === 'welcome') {
      this.playerId = message.playerId;
      this.reconnectToken = message.reconnectToken;
      this.lastSnapshot = message.snapshot;
      this.emit('welcome', { playerId: message.playerId, map: message.map, snapshot: message.snapshot });
    } else if (message.type === 'snapshot') {
      this.lastSnapshot = message.snapshot;
      this.emit('snapshot', { snapshot: message.snapshot, events: message.events });
    } else if (message.type === 'snapshot-frame') {
      const snapshot = mergeSnapshotFrame(this.lastSnapshot, message.snapshot, message.buildings);
      if (!snapshot) {
        this.resync();
        return;
      }
      this.lastSnapshot = snapshot;
      this.emit('snapshot', { snapshot, events: message.events });
    }
    else if (message.type === 'error') this.emit('error', { message: message.message });
    else if (message.type === 'pong') this.emit('ping', { milliseconds: Math.max(0, Date.now() - message.clientTime) });
    else if (message.type === 'quick-chat') this.emit('quickChat', { playerId: message.playerId, phrase: message.phrase });
    else if (message.type === 'game-chat') this.emit('gameChat', { playerId: message.playerId, message: message.message });
    else if (message.type === 'room-exit') {
      this.clearPendingLeave();
      this.stopped = true;
      this.stopHeartbeat();
      this.emit('roomExit', { reason: message.reason });
    }
    else if (message.type === 'room-closed') this.emit('error', { message: message.reason });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping', clientTime: Date.now() }), 4_000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private flushPendingLeave(): void {
    if (!this.leavePending || this.stopped) return;
    if (this.leaveRetryTimer !== null)
      window.clearTimeout(this.leaveRetryTimer);
    this.leaveRetryTimer = null;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.connect();
      return;
    }
    this.send({ type: 'leave-room' });
    this.leaveAttempts += 1;
    this.leaveRetryTimer = window.setTimeout(() => {
      this.leaveRetryTimer = null;
      if (!this.leavePending || this.stopped) return;
      if (this.leaveAttempts >= 3 && this.socket?.readyState === WebSocket.OPEN) {
        // A suspended mobile WebSocket may still report OPEN while the peer is
        // gone. Reconnect once so the queued leave intent reaches the room.
        this.socket.close(4001, 'retry room leave');
        return;
      }
      this.flushPendingLeave();
    }, 900);
  }

  private clearPendingLeave(): void {
    this.leavePending = false;
    this.leaveAttempts = 0;
    if (this.leaveRetryTimer !== null)
      window.clearTimeout(this.leaveRetryTimer);
    this.leaveRetryTimer = null;
  }
}
