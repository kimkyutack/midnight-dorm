import type { BuildingKind, ClientMessage, GameEvent, GameSnapshot, MapDefinition, ServerMessage, Tile } from '../shared/types';

export interface NetworkEvents {
  welcome: { playerId: string; map: MapDefinition; snapshot: GameSnapshot };
  snapshot: { snapshot: GameSnapshot; events: GameEvent[] };
  connection: { state: 'connecting' | 'connected' | 'reconnecting' | 'closed'; attempt: number };
  error: { message: string };
  ping: { milliseconds: number };
}

type Listener<K extends keyof NetworkEvents> = (value: NetworkEvents[K]) => void;
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'sequence' | 'timestamp'> : never;
type ClientIntent = WithoutEnvelope<ClientMessage>;

export class GameNetwork {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private reconnectAttempts = 0;
  private stopped = false;
  private pingTimer: number | null = null;
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
    this.stopped = false;
    this.emit('connection', { state: this.reconnectAttempts ? 'reconnecting' : 'connecting', attempt: this.reconnectAttempts });
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ nickname: this.nickname, deviceId: this.deviceId });
    if (this.reconnectToken) params.set('reconnectToken', this.reconnectToken);
    this.socket = new WebSocket(`${protocol}//${location.host}/api/rooms/${this.code}/ws?${params}`);
    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.emit('connection', { state: 'connected', attempt: 0 });
      this.startHeartbeat();
    });
    this.socket.addEventListener('message', (event) => this.receive(String(event.data)));
    this.socket.addEventListener('close', () => {
      this.stopHeartbeat();
      if (!this.stopped && this.reconnectAttempts < 8) {
        this.reconnectAttempts += 1;
        this.emit('connection', { state: 'reconnecting', attempt: this.reconnectAttempts });
        window.setTimeout(() => this.connect(), Math.min(4_000, 350 * 2 ** this.reconnectAttempts));
      } else this.emit('connection', { state: 'closed', attempt: this.reconnectAttempts });
    });
    this.socket.addEventListener('error', () => this.emit('error', { message: '실시간 서버에 연결하지 못했습니다.' }));
  }

  close(): void {
    this.stopped = true;
    this.stopHeartbeat();
    this.socket?.close(1000, 'client left');
  }

  send(message: ClientIntent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ ...message, sequence: ++this.sequence, timestamp: Date.now() }));
  }

  ready(ready: boolean): void { this.send({ type: 'ready', ready }); }
  start(): void { this.send({ type: 'start' }); }
  addBot(difficulty: 'easy' | 'normal' | 'hard' = 'normal'): void { this.send({ type: 'add-bot', difficulty }); }
  move(dx: number, dy: number, inputSequence: number): void { this.send({ type: 'move', dx, dy, inputSequence }); }
  interact(): void { this.send({ type: 'interact' }); }
  build(roomId: string, tile: Tile, kind: BuildingKind): void { this.send({ type: 'build', roomId, tile, kind }); }
  upgrade(targetId: string): void { this.send({ type: 'upgrade', targetId }); }
  rematch(): void { this.send({ type: 'rematch' }); }
  resync(): void { this.send({ type: 'resync' }); }

  private receive(raw: string): void {
    let message: ServerMessage;
    try { message = JSON.parse(raw) as ServerMessage; }
    catch { this.emit('error', { message: '서버 메시지를 읽지 못했습니다.' }); return; }
    if (message.type === 'welcome') {
      this.playerId = message.playerId;
      this.reconnectToken = message.reconnectToken;
      this.emit('welcome', { playerId: message.playerId, map: message.map, snapshot: message.snapshot });
    } else if (message.type === 'snapshot') this.emit('snapshot', { snapshot: message.snapshot, events: message.events });
    else if (message.type === 'error') this.emit('error', { message: message.message });
    else if (message.type === 'pong') this.emit('ping', { milliseconds: Math.max(0, Date.now() - message.clientTime) });
    else if (message.type === 'room-closed') this.emit('error', { message: message.reason });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = window.setInterval(() => this.send({ type: 'ping', clientTime: Date.now() }), 2_000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
