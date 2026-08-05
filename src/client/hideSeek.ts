import {
  HIDE_SEEK_RULES,
  hideSeekRegionAt,
  resolveHideSeekMovement,
  type HideSeekClientMessage,
  type HideSeekKeyState,
  type HideSeekMap,
  type HideSeekPlayer,
  type HideSeekQuickChat,
  type HideSeekServerMessage,
  type HideSeekSnapshot,
} from '../shared/hideSeek';
import type { Tile } from '../shared/types';
import { rankBadgeImage, rankLabel } from '../shared/progression';
import { SKIN_CELL_SIZE, skinDirectionRow, skinFrameIndex, skinMovementSheetUrl } from './game/SkinAssets';
import { nativeWebSocketUrlSync } from './native/runtime';
import './hide-seek.css';

export interface HideSeekExperienceOptions {
  app: HTMLElement;
  code: string;
  deviceId: string;
  reconnectToken?: string;
  onReconnectToken: (token: string) => void;
  onExit: () => void;
  playSound?: () => void;
  openSettings: () => void;
  setBackgroundTrack: (track: 'main' | 'ingame') => void;
  setGhostFootstepLevel?: (level: number) => void;
  adFreeActive: boolean;
  prepareDoubleReward?: (matchId: string) => Promise<void>;
  claimReward: (matchId: string, multiplier: 1 | 2) => Promise<number>;
  initialNotice?: string;
}

export interface HideSeekExperienceHandle {
  destroy: () => void;
  wakeAfterSuspension: () => void;
  requestLeave: () => void;
}

const QUICK_CHAT: readonly HideSeekQuickChat[] = ['귀신 발견!', '열쇠 발견!', '탈출로 발견!', '도망쳐!'];
const FLOOR_TEXTURE = '/assets/hide-seek/map/floor-tile-v1.webp';
const WALL_TEXTURE = '/assets/hide-seek/map/wall-tile-v1.webp';
const HIDEOUT_ATLAS = '/assets/hide-seek/map/hideouts-v1.webp';
const CLINICAL_HIDEOUT_ATLAS = '/assets/hide-seek/map/hideouts-clinical-v1.webp';
const LANDMARK_ATLAS = '/assets/hide-seek/map/landmarks-v1.webp';
const OBJECTIVE_ATLAS = '/assets/hide-seek/map/objectives-v1.webp';
const LANTERN_GHOST = '/assets/hide-seek/lantern-ghost-v2.webp';
const LANTERN_GHOST_MOVEMENT = '/assets/hide-seek/lantern-ghost-movement-v1.webp';
const GHOST_SPRITE_CELL_SIZE = 512;
const MAX_RECONNECT_ATTEMPTS = 30;
const RECONNECT_HANDSHAKE_TIMEOUT_MS = 6_000;
const pointDistance = (a: Tile, b: Tile): number => Math.hypot(a.x - b.x, a.y - b.y);
const tileKey = (tile: Tile): string => `${Math.round(tile.x)},${Math.round(tile.y)}`;
const keyStatus = (key: HideSeekKeyState): HideSeekKeyState['status'] =>
  key.status ?? (key.collectedBy ? 'used' : 'ground');
const keyCarrierId = (key: HideSeekKeyState): string | null =>
  keyStatus(key) === 'carried' ? key.carrierId ?? key.collectedBy ?? null : null;
const unlockedLockCount = (snapshot: HideSeekSnapshot): number =>
  snapshot.unlockedLocks ?? snapshot.collectedKeys ?? 0;
const html = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
})[character] as string);
const formatClock = (seconds: number): string => {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};
const hideSeekActionIcon = (kind: 'run' | 'interact' | 'light'): string => kind === 'run'
  ? '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M38 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/><path d="m29 21 10 7 9-1M30 22l-8 12-11 4m19-5 9 7 10 13M26 36l-7 16H7"/></svg>'
  : kind === 'light'
    ? '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8a17 17 0 0 0-10 31v7h20v-7A17 17 0 0 0 32 8Z"/><path d="M25 53h14M32 2v-1M12 12l-5-5m45 5 5-5M7 31H1m62 0h-6"/></svg>'
  : '<svg class="game-action-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M9 43h46v10H9zM13 26h38c3 0 5 2 5 5v12H8V31c0-3 2-5 5-5z"/><path d="M13 26v-8h15c4 0 7 3 7 7v1M14 53v4m36-4v4"/><circle cx="19" cy="22" r="4"/></svg>';

interface RenderPoint extends Tile {
  initialized: boolean;
}

class HideSeekExperience implements HideSeekExperienceHandle {
  private socket: WebSocket | null = null;
  private map: HideSeekMap | null = null;
  private snapshot: HideSeekSnapshot | null = null;
  private playerId = '';
  private inputSequence = 0;
  private destroyed = false;
  private intentionalClose = false;
  private exitCompleted = false;
  private reconnectAttempts = 0;
  private reconnectTimer = 0;
  private reconnectHandshakeTimer = 0;
  private reconnectToken = '';
  private backgroundTrack: 'main' | 'ingame' | null = null;
  private frame = 0;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private minimap: HTMLCanvasElement | null = null;
  private renderPositions = new Map<string, RenderPoint>();
  private imageCache = new Map<string, HTMLImageElement>();
  private readonly darknessCanvas = document.createElement('canvas');
  private readonly darknessContext = this.darknessCanvas.getContext('2d');
  private snapshotReceivedAt = performance.now();
  private lastRenderAt = performance.now();
  private walkableTiles = new Set<string>();
  private ghostRoomRestrictedTiles = new Set<string>();
  private ghostRoomInteriorTiles = new Set<string>();
  private initialNoticeShown = false;
  private spectatorTargetId: string | null = null;
  private preparedRewardMatchId: string | null = null;
  private claimingReward = false;
  private noticeQueue: string[] = [];
  private noticeTimer = 0;
  private pointerId: number | null = null;
  private pointerOrigin: Tile | null = null;
  private movement: Tile = { x: 0, y: 0 };
  private lastMoveSentAt = 0;
  private localRenderMoving = false;
  private localRenderStoppedAt = 0;
  private resizeObserver: ResizeObserver | null = null;
  private keyboard = new Set<string>();
  private readonly keyDown = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(event.key)) {
      this.keyboard.add(event.key.toLowerCase());
      this.syncKeyboardMovement();
      event.preventDefault();
    }
  };
  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keyboard.delete(event.key.toLowerCase());
    this.syncKeyboardMovement();
  };

  constructor(private readonly options: HideSeekExperienceOptions) {
    this.reconnectToken = options.reconnectToken ?? '';
    [FLOOR_TEXTURE, WALL_TEXTURE, HIDEOUT_ATLAS, CLINICAL_HIDEOUT_ATLAS, LANDMARK_ATLAS, OBJECTIVE_ATLAS, LANTERN_GHOST, LANTERN_GHOST_MOVEMENT]
      .forEach((url) => this.loadImage(url));
    this.renderConnecting('술래잡기 병동을 여는 중');
    this.connect();
  }

  requestLeave(): void {
    this.leave();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.intentionalClose = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.reconnectHandshakeTimer);
    window.clearTimeout(this.noticeTimer);
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    this.socket?.close(1000, 'client view closed');
    this.socket = null;
    this.options.setGhostFootstepLevel?.(0);
  }

  wakeAfterSuspension(): void {
    if (this.destroyed || this.intentionalClose) return;
    window.clearTimeout(this.reconnectTimer);
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.close(4002, 'resume realtime connection');
    }
    this.showReconnectOverlay();
    this.connect();
  }

  private connect(): void {
    if (this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN) return;
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.reconnectHandshakeTimer);
    const params = new URLSearchParams({ deviceId: this.options.deviceId });
    if (this.reconnectToken) params.set('reconnectToken', this.reconnectToken);
    let socket: WebSocket;
    try {
      socket = new WebSocket(nativeWebSocketUrlSync(`/api/hide-seek/rooms/${this.options.code}/ws`, params));
    } catch (error) {
      this.showFatal(error instanceof Error ? error.message : '술래잡기 서버 주소를 열지 못했습니다.');
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.reconnectHandshakeTimer = window.setTimeout(() => {
        if (this.socket !== socket) return;
        this.socket = null;
        socket.close(4003, 'welcome snapshot timeout');
        this.scheduleReconnect();
      }, RECONNECT_HANDSHAKE_TIMEOUT_MS);
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (this.destroyed || this.intentionalClose || this.socket !== socket) return;
      window.clearTimeout(this.reconnectHandshakeTimer);
      this.socket = null;
      if (event.code === 1000) return;
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.showFatal('실시간 연결을 복구하지 못했습니다. 홈에서 다시 입장해주세요.');
      return;
    }
    this.showReconnectOverlay();
    const delay = Math.min(4_000, 500 * 2 ** Math.min(3, this.reconnectAttempts - 1));
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private handleMessage(raw: unknown): void {
    let message: HideSeekServerMessage;
    try {
      message = JSON.parse(String(raw)) as HideSeekServerMessage;
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      window.clearTimeout(this.reconnectHandshakeTimer);
      this.reconnectAttempts = 0;
      this.reconnectToken = message.reconnectToken;
      this.options.app.querySelector('[data-hide-seek-reconnecting]')?.remove();
      this.playerId = message.playerId;
      this.spectatorTargetId = null;
      this.map = message.map;
      this.walkableTiles = new Set(message.map.walkable.map(tileKey));
      this.ghostRoomInteriorTiles = new Set(message.map.ghostRoom.interior.map(tileKey));
      this.ghostRoomRestrictedTiles = new Set([...message.map.ghostRoom.interior, message.map.ghostRoom.door].map(tileKey));
      this.snapshot = this.withExploration(message.snapshot, message.exploredBits);
      this.snapshotReceivedAt = performance.now();
      this.options.onReconnectToken(message.reconnectToken);
      this.renderForSnapshot(true);
      this.syncSpectatorState();
      if (this.options.initialNotice && !this.initialNoticeShown) {
        this.initialNoticeShown = true;
        window.setTimeout(() => this.toast(this.options.initialNotice as string), 80);
      }
      return;
    }
    if (message.type === 'snapshot') {
      const previousSnapshot = this.snapshot;
      const previousPhase = this.snapshot?.phase;
      const previousHostId = this.snapshot?.hostId;
      const previousKeyHintId = this.snapshot?.keyHint?.keyId;
      this.snapshot = this.withExploration(message.snapshot, message.exploredBits);
      this.snapshotReceivedAt = performance.now();
      this.renderForSnapshot(previousPhase !== message.snapshot.phase || previousHostId !== message.snapshot.hostId);
      this.handlePlayerDeaths(previousSnapshot, this.snapshot);
      this.handleLockUnlocks(previousSnapshot, this.snapshot);
      this.syncSpectatorState();
      const spawnedKeyHint = this.snapshot.keyHint?.keyId !== previousKeyHintId ? this.snapshot.keyHint : null;
      const me = this.snapshot.players.find((player) => player.id === this.playerId);
      if (spawnedKeyHint && me?.role === 'survivor' && this.map) {
        const region = this.map.regions.find((candidate) => candidate.id === spawnedKeyHint.regionId);
        this.toast(`${region?.label ?? '병동 어딘가'}에서 금속 소리가 들립니다.`);
      }
      return;
    }
    if (message.type === 'quick-chat' || message.type === 'chat') {
      this.showQuickChat(message.playerNumber, message.type === 'quick-chat' ? message.phrase : message.text);
      return;
    }
    if (message.type === 'error') this.toast(message.message);
    if (message.type === 'room-exit') {
      this.finishExit();
    }
  }

  private send(message: HideSeekClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private withExploration(snapshot: HideSeekSnapshot, exploredBits?: string): HideSeekSnapshot {
    if (!exploredBits) {
      snapshot.exploredTileKeys = this.snapshot?.exploredTileKeys ?? [];
      return snapshot;
    }
    try {
      const binary = atob(exploredBits);
      const keys: string[] = [];
      const width = this.map?.width ?? 0;
      const height = this.map?.height ?? 0;
      for (let index = 0; index < width * height; index += 1) {
        if ((binary.charCodeAt(Math.floor(index / 8)) & (1 << (index % 8))) !== 0) keys.push(`${index % width},${Math.floor(index / width)}`);
      }
      snapshot.exploredTileKeys = keys;
    } catch {
      snapshot.exploredTileKeys = this.snapshot?.exploredTileKeys ?? [];
    }
    return snapshot;
  }

  private renderForSnapshot(force: boolean): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    if (snapshot.phase === 'LOBBY') {
      this.options.setGhostFootstepLevel?.(0);
      this.useBackgroundTrack('main');
      if (force || !this.options.app.querySelector('.hide-seek-lobby')) this.renderLobby();
      else this.updateLobby();
      return;
    }
    this.useBackgroundTrack('ingame');
    if (force || !this.options.app.querySelector('.hide-seek-game')) this.renderGame();
    this.updateGameHud();
  }

  private useBackgroundTrack(track: 'main' | 'ingame'): void {
    if (this.backgroundTrack === track) return;
    this.backgroundTrack = track;
    this.options.setBackgroundTrack(track);
  }

  private renderConnecting(label: string): void {
    this.options.setGhostFootstepLevel?.(0);
    this.options.app.dataset.view = 'hide-seek';
    this.options.app.innerHTML = `<main class="hide-seek-connecting"><div class="hide-seek-moon">☾</div><span>NIGHT CHASE</span><h1>${html(label)}</h1><p>어두운 복도에서 발소리를 낮추세요.</p><i></i></main>`;
  }

  private showFatal(message: string): void {
    this.options.setGhostFootstepLevel?.(0);
    this.options.app.innerHTML = `<main class="hide-seek-connecting error"><div class="hide-seek-moon">!</div><span>CONNECTION LOST</span><h1>입장할 수 없습니다</h1><p>${html(message)}</p><button data-hide-seek-fatal-exit>홈으로</button></main>`;
    this.options.app.querySelector('[data-hide-seek-fatal-exit]')?.addEventListener('click', () => {
      this.destroy();
      this.options.onExit();
    });
  }

  private renderLobby(): void {
    const snapshot = this.snapshot as HideSeekSnapshot;
    const me = snapshot.players.find((player) => player.id === this.playerId);
    const isHost = snapshot.hostId === this.playerId;
    this.options.app.dataset.view = 'hide-seek-lobby';
    this.options.app.innerHTML = `<main class="hide-seek-lobby">
      <div class="hide-seek-lobby-art" aria-hidden="true"><img src="${LANTERN_GHOST}" alt=""/></div>
      <header><span class="hide-seek-lobby-emblem" aria-hidden="true">☾</span><div><small>NIGHT CHASE</small><h1>심야 술래잡기</h1></div><button class="hide-seek-code" data-hide-seek-copy><small>초대 코드</small><strong>${snapshot.code}</strong></button></header>
      <section class="hide-seek-rule-card"><span>최대 1 VS 6</span><h2>불이 꺼지면, 소리 없이 숨으세요</h2><p>20초 동안 숨고 열쇠로 자물쇠 5개를 해제하세요. 랜턴에 잡히면 추격이 시작됩니다.</p></section>
      <section class="hide-seek-role-picker"><small>희망 역할</small><div><button data-pref="survivor" class="${me?.preference === 'survivor' ? 'active' : ''}">생존자</button><button data-pref="any" class="${me?.preference === 'any' ? 'active' : ''}">상관없음</button><button data-pref="ghost" class="${me?.preference === 'ghost' ? 'active' : ''}">술래</button></div></section>
      <section class="hide-seek-roster"><header><strong>참가자 <b data-hide-seek-roster-count>${snapshot.players.length}/7</b></strong><small>귀신 1명 · 생존자 최대 6명</small></header><ol data-hide-seek-roster></ol></section>
      <footer><div class="hide-seek-lobby-tools"><button class="danger" data-hide-seek-leave>방 나가기</button>${isHost ? '<button data-hide-seek-add-bot>＋ 봇 추가</button><button data-hide-seek-fill-bots>빈자리 채우기</button>' : '<span>방장이 게임을 준비하고 있습니다.</span>'}</div><div class="hide-seek-lobby-actions"><button class="secondary" data-hide-seek-ready>${me?.ready ? '준비 취소' : '준비'}</button>${isHost ? '<button class="primary" data-hide-seek-start>추격 시작</button>' : ''}</div></footer>
      <div class="hide-seek-toast" data-hide-seek-toast></div>
    </main>`;
    this.bindLobby();
    this.updateLobby();
  }

  private bindLobby(): void {
    this.options.app.querySelector('[data-hide-seek-leave]')?.addEventListener('click', () => this.leave());
    this.options.app.querySelector('[data-hide-seek-copy]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.options.code).then(() => this.toast('초대 코드를 복사했습니다.'));
    });
    this.options.app.querySelectorAll<HTMLElement>('[data-pref]').forEach((button) => button.addEventListener('click', () => {
      this.options.playSound?.();
      this.send({ type: 'set-preference', preference: button.dataset.pref as 'ghost' | 'survivor' | 'any' });
    }));
    this.options.app.querySelector('[data-hide-seek-ready]')?.addEventListener('click', () => {
      const me = this.snapshot?.players.find((player) => player.id === this.playerId);
      this.send({ type: 'ready', ready: !me?.ready });
    });
    this.options.app.querySelector('[data-hide-seek-add-bot]')?.addEventListener('click', () => this.send({ type: 'add-bot', preference: 'any' }));
    this.options.app.querySelector('[data-hide-seek-fill-bots]')?.addEventListener('click', () => {
      const count = Math.max(0, HIDE_SEEK_RULES.maxPlayers - (this.snapshot?.players.length ?? 0));
      for (let index = 0; index < count; index += 1) window.setTimeout(() => this.send({ type: 'add-bot', preference: 'any' }), index * 70);
    });
    this.options.app.querySelector('[data-hide-seek-start]')?.addEventListener('click', () => this.send({ type: 'start' }));
  }

  private updateLobby(): void {
    const snapshot = this.snapshot;
    const list = this.options.app.querySelector<HTMLOListElement>('[data-hide-seek-roster]');
    if (!snapshot || !list) return;
    const count = this.options.app.querySelector<HTMLElement>('[data-hide-seek-roster-count]');
    if (count) count.textContent = `${snapshot.players.length}/7`;
    list.innerHTML = snapshot.players.map((player, index) => `<li class="${player.id === snapshot.hostId ? 'host' : ''}"><span class="hide-seek-member-badge"><img src="${rankBadgeImage(player.displayRank ?? 'beginner')}" alt="${rankLabel(player.displayRank ?? 'beginner')}"/><em>${player.isBot ? 'BOT' : String(index + 1).padStart(2, '0')}</em></span><div><strong>${html(player.nickname)}${player.id === snapshot.hostId ? ' ★' : ''}</strong><small>${rankLabel(player.displayRank ?? 'beginner')} · ${player.preference === 'ghost' ? '귀신 희망' : player.preference === 'survivor' ? '생존자 희망' : '역할 무관'}</small></div><b class="${player.ready || player.id === snapshot.hostId || player.isBot ? 'ready' : ''}">${player.ready || player.id === snapshot.hostId || player.isBot ? 'READY' : 'WAIT'}</b>${player.isBot && snapshot.hostId === this.playerId ? `<button class="delete-bot-button" data-remove-bot="${player.id}" aria-label="봇 제거">봇 제거</button>` : ''}</li>`).join('');
    list.querySelectorAll<HTMLElement>('[data-remove-bot]').forEach((button) => button.addEventListener('click', () => this.send({ type: 'remove-bot', playerId: button.dataset.removeBot ?? '' })));
    const me = snapshot.players.find((player) => player.id === this.playerId);
    const ready = this.options.app.querySelector<HTMLButtonElement>('[data-hide-seek-ready]');
    if (ready) ready.textContent = me?.ready ? '준비 취소' : '준비';
    this.options.app.querySelectorAll<HTMLElement>('[data-pref]').forEach((button) => button.classList.toggle('active', button.dataset.pref === me?.preference));
  }

  private renderGame(): void {
    const snapshot = this.snapshot as HideSeekSnapshot;
    const me = snapshot.players.find((player) => player.id === this.playerId);
    const roleCardMarkup = me?.role === 'ghost'
      ? '<p class="ghost-role-copy">당신은 <b>술래입니다.</b></p>'
      : `<small>YOUR NUMBER</small><strong>${me?.number ?? '?'}</strong><p>당신은 <b>${me?.number ?? '?'}</b>번입니다.</p>`;
    this.options.app.dataset.view = 'hide-seek-game';
    this.options.app.innerHTML = `<main class="hide-seek-game ${me?.role === 'ghost' ? 'is-ghost' : 'is-survivor'}">
      <canvas class="hide-seek-world" data-hide-seek-world></canvas>
      <header class="hide-seek-hud"><div class="hide-seek-objective"><small data-hide-seek-phase>추격 준비</small><strong data-hide-seek-objective>자물쇠 0/5</strong></div><time data-hide-seek-clock>${formatClock(snapshot.phaseRemaining)}</time><button class="btn icon-btn hide-seek-settings" data-hide-seek-settings aria-label="설정">⚙</button></header>
      <section class="hide-seek-number-card" data-hide-seek-role-card>${roleCardMarkup}</section>
      <aside class="hide-seek-minimap-shell"><canvas data-hide-seek-minimap></canvas><span data-hide-seek-minimap-label>공유 미니맵</span></aside>
      <div class="hide-seek-alert" data-hide-seek-alert><b>!</b><span>발견됨</span></div>
      <div class="controls" data-hide-seek-controls><div class="joystick" data-hide-seek-joystick aria-label="이동 조이스틱"><div class="joystick-knob"></div></div><div class="portrait-drag-hint"><i>↗</i><span>캐릭터를 누른 채<br/>움직일 방향으로 드래그</span></div><div class="action-stack"><button class="round-btn secondary" data-hide-seek-chat aria-label="팀 채팅">💬</button><button class="round-btn secondary hide-seek-light hidden" data-hide-seek-light aria-label="불켜기">${hideSeekActionIcon('light')}<small data-hide-seek-light-time>불켜기</small></button><button class="round-btn repair-action hide-seek-sprint" data-hide-seek-sprint aria-label="달리기">${hideSeekActionIcon('run')}<small data-hide-seek-sprint-time>달리기</small></button></div></div>
      <button type="button" class="sleep-nearby hide-seek-world-interact hide-seek-interact" data-hide-seek-interact hidden aria-label="주변 상호작용"><span aria-hidden="true">✦</span><strong>상호작용</strong></button>
      <nav class="hide-seek-spectator hidden" data-hide-seek-spectator aria-label="생존자 카메라 선택"><span>생존자 시점</span><div data-hide-seek-spectator-buttons></div></nav>
      <section class="quick-chat-picker hide-seek-chat-sheet" data-hide-seek-chat-sheet><header><strong>팀 채팅</strong><button type="button" class="quick-chat-close" data-hide-seek-chat-close aria-label="채팅 닫기">×</button></header><form class="game-chat-form" data-hide-seek-chat-form><input data-hide-seek-chat-input maxlength="80" autocomplete="off" enterkeyhint="send" placeholder="메시지를 입력하세요" aria-label="팀 채팅 메시지"/><button type="submit">전송</button></form><div class="quick-chat-options">${QUICK_CHAT.map((phrase) => `<button type="button" data-quick-chat="${phrase}">${phrase}</button>`).join('')}</div></section>
      <div class="hide-seek-chat-feed" data-hide-seek-chat-feed></div>
      <section class="hide-seek-result" data-hide-seek-result><div><small>CHASE RESULT</small><h2 data-hide-seek-result-title></h2><p data-hide-seek-result-copy></p><div class="hide-seek-result-reward hidden" data-hide-seek-result-reward><span>VICTORY REWARD</span><strong data-hide-seek-reward-points></strong><small data-hide-seek-reward-copy></small></div><div class="hide-seek-result-actions"><button data-hide-seek-result-exit>홈으로</button><button class="secondary hidden" data-hide-seek-claim="1">보상 수령</button><button class="hidden" data-hide-seek-claim="2">2배 수령</button></div></div></section>
      <div class="hide-seek-death-notice" data-hide-seek-death-notice role="status"></div>
      <div class="hide-seek-toast" data-hide-seek-toast></div>
    </main>`;
    this.canvas = this.options.app.querySelector('[data-hide-seek-world]');
    this.context = this.canvas?.getContext('2d') ?? null;
    this.minimap = this.options.app.querySelector('[data-hide-seek-minimap]');
    this.renderPositions.clear();
    this.lastRenderAt = performance.now();
    this.bindGame();
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvases());
    this.resizeObserver.observe(this.options.app);
    this.resizeCanvases();
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame((time) => this.draw(time));
  }

  private bindGame(): void {
    const canvas = this.canvas;
    this.options.app.querySelector('.hide-seek-game')?.addEventListener('contextmenu', (event) => event.preventDefault());
    if (canvas) {
      canvas.addEventListener('pointerdown', (event) => {
        if (this.pointerId !== null) return;
        this.pointerId = event.pointerId;
        this.pointerOrigin = { x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        this.updatePointerMovement(event);
      });
      canvas.addEventListener('pointermove', (event) => {
        if (event.pointerId === this.pointerId) this.updatePointerMovement(event);
      });
      const release = (event: PointerEvent): void => {
        if (event.pointerId !== this.pointerId) return;
        this.pointerId = null;
        this.pointerOrigin = null;
        this.movement = { x: 0, y: 0 };
        this.sendMovement(true);
        const knob = this.options.app.querySelector<HTMLElement>('[data-hide-seek-joystick] .joystick-knob');
        if (knob) knob.style.transform = 'translate(0, 0)';
      };
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
    }
    this.options.app.querySelector('[data-hide-seek-settings]')?.addEventListener('click', () => this.options.openSettings());
    this.bindInstantAction('[data-hide-seek-sprint]', () => this.send({ type: 'sprint' }));
    this.bindInstantAction('[data-hide-seek-light]', () => this.send({ type: 'ghost-light' }));
    const interact = this.options.app.querySelector<HTMLElement>('[data-hide-seek-interact]');
    const localRole = (): HideSeekPlayer['role'] => this.snapshot?.players.find((player) => player.id === this.playerId)?.role ?? null;
    interact?.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.send({ type: 'interact' });
    });
    interact?.addEventListener('pointerup', () => {
      if (localRole() !== 'ghost') this.send({ type: 'stop-interact' });
    });
    interact?.addEventListener('pointercancel', () => {
      if (localRole() !== 'ghost') this.send({ type: 'stop-interact' });
    });
    this.options.app.querySelector('[data-hide-seek-chat]')?.addEventListener('click', () => this.options.app.querySelector('[data-hide-seek-chat-sheet]')?.classList.add('visible'));
    this.options.app.querySelector('[data-hide-seek-chat-close]')?.addEventListener('click', () => this.options.app.querySelector('[data-hide-seek-chat-sheet]')?.classList.remove('visible'));
    this.options.app.querySelectorAll<HTMLElement>('[data-quick-chat]').forEach((button) => button.addEventListener('click', () => {
      this.send({ type: 'quick-chat', phrase: button.dataset.quickChat as HideSeekQuickChat });
      this.options.app.querySelector('[data-hide-seek-chat-sheet]')?.classList.remove('visible');
    }));
    this.options.app.querySelector<HTMLFormElement>('[data-hide-seek-chat-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = this.options.app.querySelector<HTMLInputElement>('[data-hide-seek-chat-input]');
      const text = input?.value.trim() ?? '';
      if (!text) return;
      this.send({ type: 'chat', text });
      if (input) input.value = '';
      this.options.app.querySelector('[data-hide-seek-chat-sheet]')?.classList.remove('visible');
    });
    this.options.app.querySelector('[data-hide-seek-result-exit]')?.addEventListener('click', () => this.leave());
    this.options.app.querySelectorAll<HTMLButtonElement>('[data-hide-seek-claim]').forEach((button) => {
      button.addEventListener('click', () => {
        const multiplier: 1 | 2 = button.dataset.hideSeekClaim === '2' ? 2 : 1;
        void this.claimVictoryReward(multiplier);
      });
    });
  }

  private bindInstantAction(selector: string, action: () => void): void {
    const button = this.options.app.querySelector<HTMLButtonElement>(selector);
    if (!button) return;
    // Mobile browsers do not consistently synthesize `click` for a secondary
    // finger while the first pointer is captured by the movement canvas.
    // Fire on pointerdown so sprint/light remain available during a drag.
    button.addEventListener('pointerdown', (event) => {
      if (button.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    // Keyboard activation produces a click with detail 0 and has no preceding
    // pointerdown, so keep that accessibility path without double firing taps.
    button.addEventListener('click', (event) => {
      if (event.detail !== 0 || button.disabled) return;
      action();
    });
  }

  private resizeCanvases(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    for (const canvas of [this.canvas, this.minimap]) {
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
    }
  }

  private updatePointerMovement(event: PointerEvent): void {
    if (!this.canControlLocalPlayer()) return;
    const origin = this.pointerOrigin;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const length = Math.hypot(dx, dy);
    const strength = Math.min(1, length / 46);
    this.movement = length < 5 ? { x: 0, y: 0 } : { x: (dx / length) * strength, y: (dy / length) * strength };
    const knob = this.options.app.querySelector<HTMLElement>('[data-hide-seek-joystick] .joystick-knob');
    if (knob) knob.style.transform = `translate(${this.movement.x * 28}px, ${this.movement.y * 28}px)`;
    this.sendMovement();
  }

  private syncKeyboardMovement(): void {
    if (!this.canControlLocalPlayer()) {
      this.movement = { x: 0, y: 0 };
      return;
    }
    const x = Number(this.keyboard.has('d') || this.keyboard.has('arrowright')) - Number(this.keyboard.has('a') || this.keyboard.has('arrowleft'));
    const y = Number(this.keyboard.has('s') || this.keyboard.has('arrowdown')) - Number(this.keyboard.has('w') || this.keyboard.has('arrowup'));
    const length = Math.max(1, Math.hypot(x, y));
    this.movement = { x: x / length, y: y / length };
    this.sendMovement(true);
  }

  private sendMovement(force = false): void {
    if (!this.canControlLocalPlayer()) {
      this.movement = { x: 0, y: 0 };
      return;
    }
    const now = performance.now();
    if (!force && now - this.lastMoveSentAt < 45) return;
    this.lastMoveSentAt = now;
    this.inputSequence += 1;
    this.send({ type: 'move', dx: this.movement.x, dy: this.movement.y, inputSequence: this.inputSequence });
  }

  private updateGameHud(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    const me = snapshot.players.find((player) => player.id === this.playerId);
    if (!me) return;
    this.updateSpectatorControls(me, snapshot);
    const phaseLabels: Record<HideSeekSnapshot['phase'], string> = {
      LOBBY: '대기 중', ROLE_LOCK: '역할 확인', HIDE: '숨을 시간', HUNT: '열쇠를 찾아 자물쇠 해제', LAST_ESCAPE: '마지막 해제', RESULT: '추격 종료', CLOSED: '방 종료',
    };
    const phase = this.options.app.querySelector<HTMLElement>('[data-hide-seek-phase]');
    const objective = this.options.app.querySelector<HTMLElement>('[data-hide-seek-objective]');
    const clock = this.options.app.querySelector<HTMLElement>('[data-hide-seek-clock]');
    if (phase) phase.textContent = phaseLabels[snapshot.phase];
    const carryingKey = snapshot.keys.some((key) => keyStatus(key) === 'carried' && keyCarrierId(key) === me.id);
    if (objective) objective.textContent = me.role === 'ghost'
      ? `생존자 ${snapshot.players.filter((player) => player.role === 'survivor' && player.alive).length}명 추적 중`
      : `자물쇠 ${unlockedLockCount(snapshot)}/${HIDE_SEEK_RULES.requiredKeys}${carryingKey ? ' · 열쇠 보유' : ''}`;
    if (clock) clock.textContent = formatClock(snapshot.phaseRemaining);
    const dangerAlert = this.options.app.querySelector<HTMLElement>('[data-hide-seek-alert]');
    const detected = me.alive && me.detected;
    const nearby = me.alive && !detected && me.proximityAlert;
    dangerAlert?.classList.toggle('visible', detected || nearby);
    dangerAlert?.classList.toggle('detected', detected);
    dangerAlert?.classList.toggle('nearby', nearby);
    const dangerLabel = dangerAlert?.querySelector<HTMLElement>('span');
    if (dangerLabel) dangerLabel.textContent = detected ? '발견됨' : '가까이에 기척!';
    const footstepLevel = (snapshot.phase === 'HUNT' || snapshot.phase === 'LAST_ESCAPE')
      && me.role === 'survivor'
      && me.alive
      ? me.ghostFootstepLevel
      : 0;
    this.options.setGhostFootstepLevel?.(footstepLevel);
    const minimapLabel = this.options.app.querySelector<HTMLElement>('[data-hide-seek-minimap-label]');
    if (minimapLabel) minimapLabel.textContent = me.role === 'ghost' ? '귀신 탐색 지도' : '생존자 공유 지도';
    this.options.app.querySelector('[data-hide-seek-chat]')?.classList.toggle('hidden', me.role === 'ghost');
    const action = this.interactionLabel(me, snapshot);
    const interact = this.options.app.querySelector<HTMLButtonElement>('[data-hide-seek-interact]');
    if (interact) {
      const label = interact.querySelector<HTMLElement>('strong');
      const searchingHideout = me.role === 'ghost' && me.interactionTarget?.startsWith('hideout:');
      const searchRemaining = Math.max(0, HIDE_SEEK_RULES.hideoutSearchSeconds - me.interactionProgress);
      if (label) label.textContent = searchingHideout ? `탐색 중 ${searchRemaining.toFixed(1)}초` : action;
      interact.hidden = action === '살펴보기';
      interact.disabled = Boolean(searchingHideout);
      interact.setAttribute('aria-busy', String(Boolean(searchingHideout)));
      const duration = me.interactionTarget?.startsWith('exit:')
        ? HIDE_SEEK_RULES.exitUnlockSeconds
        : me.interactionTarget?.startsWith('key:')
          ? HIDE_SEEK_RULES.keyPickupSeconds
          : me.interactionTarget?.startsWith('hideout:')
            ? HIDE_SEEK_RULES.hideoutSearchSeconds
            : 0;
      const progress = duration > 0 ? Math.min(1, me.interactionProgress / duration) : 0;
      interact.classList.toggle('holding', progress > 0);
      interact.style.setProperty('--hold-progress', `${progress * 360}deg`);
    }
    const cooldown = Math.max(0, me.sprintReadyAt - snapshot.elapsed);
    const sprint = this.options.app.querySelector<HTMLButtonElement>('[data-hide-seek-sprint]');
    const sprintTime = this.options.app.querySelector<HTMLElement>('[data-hide-seek-sprint-time]');
    if (sprint) sprint.disabled = cooldown > 0 || snapshot.phase === 'HIDE' || snapshot.phase === 'ROLE_LOCK';
    if (sprintTime) sprintTime.textContent = cooldown > 0 ? `${Math.ceil(cooldown)}초` : '달리기';
    const light = this.options.app.querySelector<HTMLButtonElement>('[data-hide-seek-light]');
    const lightTime = this.options.app.querySelector<HTMLElement>('[data-hide-seek-light-time]');
    const lightCooldown = Math.max(0, me.lightReadyAt - snapshot.elapsed);
    const lightActive = snapshot.elapsed < me.lightUntil;
    light?.classList.toggle('hidden', me.role !== 'ghost');
    light?.classList.toggle('active', lightActive);
    if (light) light.disabled = me.role !== 'ghost' || lightCooldown > 0 || snapshot.phase === 'HIDE' || snapshot.phase === 'ROLE_LOCK';
    if (lightTime) lightTime.textContent = lightActive ? '점등 중' : lightCooldown > 0 ? `${Math.ceil(lightCooldown)}초` : '불켜기';
    const roleCard = this.options.app.querySelector('[data-hide-seek-role-card]');
    if (roleCard) {
      roleCard.classList.toggle('visible', snapshot.phase === 'ROLE_LOCK');
      roleCard.classList.toggle('ghost', me.role === 'ghost');
    }
    const result = this.options.app.querySelector<HTMLElement>('[data-hide-seek-result]');
    if (result) {
      const visible = snapshot.phase === 'RESULT';
      result.classList.toggle('visible', visible);
      if (visible) {
        const title = result.querySelector<HTMLElement>('[data-hide-seek-result-title]');
        const copy = result.querySelector<HTMLElement>('[data-hide-seek-result-copy]');
        const won = snapshot.winner === me.role && !me.abandoned;
        if (snapshot.resultReason === 'ghost-abandoned') {
          if (title) title.textContent = '생존자 승리!';
          if (copy) copy.textContent = '술래가 게임을 탈주하였습니다.';
        } else if (snapshot.resultReason === 'last-survivor-abandoned') {
          if (title) title.textContent = '술래 승리!';
          if (copy) copy.textContent = '생존자가 게임을 탈주하였습니다.';
        } else if (snapshot.resultReason === 'timeout') {
          if (title) title.textContent = me.role === 'ghost' ? '술래 승리!' : '시간 초과';
          if (copy) copy.textContent = '제한시간 안에 자물쇠 5개를 모두 해제하지 못했습니다.';
        } else {
          if (title) title.textContent = won ? '추격 성공!' : '다음 밤을 노려보세요';
          if (copy) copy.textContent = snapshot.winner === 'survivor' ? '생존자 팀이 탈출로의 자물쇠 5개를 모두 해제했습니다.' : '술래가 병동의 모든 생존자를 찾아냈습니다.';
        }
        const reward = result.querySelector<HTMLElement>('[data-hide-seek-result-reward]');
        const rewardPoints = me.role === 'ghost' ? HIDE_SEEK_RULES.ghostVictoryPoints : HIDE_SEEK_RULES.survivorVictoryPoints;
        reward?.classList.toggle('hidden', !won);
        const points = result.querySelector<HTMLElement>('[data-hide-seek-reward-points]');
        const rewardCopy = result.querySelector<HTMLElement>('[data-hide-seek-reward-copy]');
        if (points) points.textContent = `+${rewardPoints.toLocaleString()} P`;
        if (rewardCopy) rewardCopy.textContent = this.options.adFreeActive ? '광고 없이 2배 보상을 받을 수 있습니다.' : '광고를 보면 승리 포인트를 2배로 받을 수 있습니다.';
        const exit = result.querySelector<HTMLButtonElement>('[data-hide-seek-result-exit]');
        const claimOne = result.querySelector<HTMLButtonElement>('[data-hide-seek-claim="1"]');
        const claimTwo = result.querySelector<HTMLButtonElement>('[data-hide-seek-claim="2"]');
        exit?.classList.toggle('hidden', won);
        claimOne?.classList.toggle('hidden', !won || this.options.adFreeActive);
        claimTwo?.classList.toggle('hidden', !won);
        if (claimTwo) claimTwo.textContent = this.options.adFreeActive ? `2배 보상 +${(rewardPoints * 2).toLocaleString()} P` : `광고 보고 2배 +${(rewardPoints * 2).toLocaleString()} P`;
        if (won && !this.options.adFreeActive && this.preparedRewardMatchId !== snapshot.matchId) {
          this.preparedRewardMatchId = snapshot.matchId;
          void this.options.prepareDoubleReward?.(snapshot.matchId).catch(() => undefined);
        }
      }
    }
  }

  private canControlLocalPlayer(): boolean {
    const player = this.snapshot?.players.find((candidate) => candidate.id === this.playerId);
    return Boolean(player?.alive && !player.escaped && this.snapshot?.phase !== 'RESULT' && this.snapshot?.phase !== 'CLOSED');
  }

  private handlePlayerDeaths(previous: HideSeekSnapshot | null, next: HideSeekSnapshot): void {
    if (!previous || previous.matchId !== next.matchId || previous.phase === 'LOBBY') return;
    const previouslyAlive = new Map(previous.players.map((player) => [player.id, player.alive]));
    const deaths = next.players.filter((player) => player.role === 'survivor'
      && previouslyAlive.get(player.id) === true
      && !player.alive
      && !player.escaped);
    if (deaths.length === 0) return;
    const me = next.players.find((player) => player.id === this.playerId);
    const localDeath = deaths.find((player) => player.id === this.playerId);
    if (localDeath) {
      this.keyboard.clear();
      this.pointerId = null;
      this.pointerOrigin = null;
      this.movement = { x: 0, y: 0 };
      this.enqueueCenterNotice('당신은 사망하였습니다', true);
    }
    if (me?.role === 'ghost') {
      for (const _player of deaths) this.enqueueCenterNotice('생존자를 잡았습니다');
      return;
    }
    for (const player of deaths) {
      if (player.id !== this.playerId) this.enqueueCenterNotice(`${player.number ?? '?'}번이 사망하였습니다`);
    }
  }

  private handleLockUnlocks(previous: HideSeekSnapshot | null, next: HideSeekSnapshot): void {
    if (!previous || previous.matchId !== next.matchId || previous.phase === 'LOBBY') return;
    const previousCount = unlockedLockCount(previous);
    const nextCount = unlockedLockCount(next);
    for (let lock = previousCount + 1; lock <= nextCount; lock += 1) {
      this.enqueueCenterNotice(`${lock}번째 자물쇠가 해제되었습니다.`);
    }
  }

  private enqueueCenterNotice(message: string, priority = false): void {
    if (priority) this.noticeQueue.unshift(message);
    else this.noticeQueue.push(message);
    if (!this.noticeTimer) this.showNextCenterNotice();
  }

  private showNextCenterNotice(): void {
    const notice = this.options.app.querySelector<HTMLElement>('[data-hide-seek-death-notice]');
    const message = this.noticeQueue.shift();
    if (!message) {
      this.noticeTimer = 0;
      return;
    }
    if (!notice) {
      this.noticeQueue.unshift(message);
      this.noticeTimer = window.setTimeout(() => this.showNextCenterNotice(), 100);
      return;
    }
    notice.textContent = message;
    notice.classList.add('visible');
    this.noticeTimer = window.setTimeout(() => {
      notice.classList.remove('visible');
      this.noticeTimer = window.setTimeout(() => this.showNextCenterNotice(), 120);
    }, 2_000);
  }

  private livingSpectatorTargets(snapshot = this.snapshot): HideSeekPlayer[] {
    return (snapshot?.players ?? [])
      .filter((player) => player.role === 'survivor' && player.alive && !player.escaped && !player.abandoned)
      .sort((left, right) => (left.number ?? 99) - (right.number ?? 99));
  }

  private syncSpectatorState(): void {
    const snapshot = this.snapshot;
    const me = snapshot?.players.find((player) => player.id === this.playerId);
    if (!snapshot || me?.role !== 'survivor' || me.alive || snapshot.phase === 'RESULT' || snapshot.phase === 'CLOSED') {
      this.spectatorTargetId = null;
      return;
    }
    const targets = this.livingSpectatorTargets(snapshot);
    const current = targets.find((player) => player.id === this.spectatorTargetId);
    if (!current && targets[0]) this.setSpectatorTarget(targets[0].id);
  }

  private setSpectatorTarget(playerId: string): void {
    const target = this.livingSpectatorTargets().find((player) => player.id === playerId);
    if (!target) return;
    this.spectatorTargetId = target.id;
    this.send({ type: 'spectate', playerId: target.id });
    this.updateGameHud();
  }

  private updateSpectatorControls(me: HideSeekPlayer, snapshot: HideSeekSnapshot): void {
    const deadSurvivor = me.role === 'survivor' && !me.alive && snapshot.phase !== 'RESULT' && snapshot.phase !== 'CLOSED';
    const game = this.options.app.querySelector('.hide-seek-game');
    game?.classList.toggle('is-spectating', deadSurvivor);
    this.options.app.querySelector('[data-hide-seek-controls]')?.classList.toggle('hidden', deadSurvivor);
    if (deadSurvivor) this.options.app.querySelector('[data-hide-seek-chat-sheet]')?.classList.remove('visible');
    const nav = this.options.app.querySelector<HTMLElement>('[data-hide-seek-spectator]');
    const buttons = nav?.querySelector<HTMLElement>('[data-hide-seek-spectator-buttons]');
    const targets = deadSurvivor ? this.livingSpectatorTargets(snapshot) : [];
    nav?.classList.toggle('hidden', !deadSurvivor || targets.length === 0);
    if (!buttons) return;
    const markup = targets.map((player) => `<button type="button" data-spectate-player="${player.id}" class="${player.id === this.spectatorTargetId ? 'active' : ''}">${player.number ?? '?'}번</button>`).join('');
    if (buttons.innerHTML === markup) return;
    buttons.innerHTML = markup;
    buttons.querySelectorAll<HTMLButtonElement>('[data-spectate-player]').forEach((button) => {
      button.addEventListener('click', () => this.setSpectatorTarget(button.dataset.spectatePlayer ?? ''));
    });
  }

  private async claimVictoryReward(multiplier: 1 | 2): Promise<void> {
    const snapshot = this.snapshot;
    const me = snapshot?.players.find((player) => player.id === this.playerId);
    if (!snapshot || snapshot.phase !== 'RESULT' || snapshot.winner !== me?.role || me.abandoned || this.claimingReward) return;
    this.claimingReward = true;
    const buttons = this.options.app.querySelectorAll<HTMLButtonElement>('[data-hide-seek-claim]');
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const awarded = await this.options.claimReward(snapshot.matchId, multiplier);
      this.toast(`✦ ${awarded.toLocaleString()} P를 받았습니다.`);
      window.setTimeout(() => this.leave(), 450);
    } catch (error) {
      this.claimingReward = false;
      buttons.forEach((button) => { button.disabled = false; });
      this.toast(error instanceof Error ? error.message : '승리 포인트를 지급하지 못했습니다.');
    }
  }

  private interactionLabel(me: HideSeekPlayer, snapshot: HideSeekSnapshot): string {
    if (me.role === 'ghost') return this.map?.hideouts.some((hideout) => pointDistance(hideout.tile, me.position) <= 0.85) ? '은신처 수색' : '살펴보기';
    if (me.hiddenIn) return '은신처 나가기';
    const carryingKey = snapshot.keys.some((key) => keyStatus(key) === 'carried' && keyCarrierId(key) === me.id);
    if (snapshot.activeExit.x >= 0 && pointDistance(snapshot.activeExit, me.position) <= 1) {
      if (snapshot.exitOpen) return '탈출';
      return carryingKey ? '자물쇠 해제' : '열쇠 필요';
    }
    if (!carryingKey && snapshot.keys.some((key) => keyStatus(key) === 'ground' && pointDistance(key.tile, me.position) <= 0.9)) return '열쇠 줍기';
    if (this.map?.hideouts.some((hideout) => pointDistance(hideout.tile, me.position) <= 0.85)) return '숨기';
    return '살펴보기';
  }

  private interactionTile(me: HideSeekPlayer, snapshot: HideSeekSnapshot): Tile | null {
    if (!this.map) return null;
    if (me.role === 'ghost') {
      return this.map.hideouts.find((hideout) => pointDistance(hideout.tile, me.position) <= 0.85)?.tile ?? null;
    }
    if (me.hiddenIn) return this.map.hideouts.find((hideout) => hideout.id === me.hiddenIn)?.tile ?? me.position;
    const carryingKey = snapshot.keys.some((key) => keyStatus(key) === 'carried' && keyCarrierId(key) === me.id);
    if (snapshot.activeExit.x >= 0 && pointDistance(snapshot.activeExit, me.position) <= 1) return snapshot.activeExit;
    const key = carryingKey
      ? null
      : snapshot.keys.find((candidate) => keyStatus(candidate) === 'ground' && pointDistance(candidate.tile, me.position) <= 0.9);
    if (key) return key.tile;
    const hideout = this.map.hideouts.find((candidate) => pointDistance(candidate.tile, me.position) <= 0.85);
    if (hideout) return hideout.tile;
    return null;
  }

  private draw(time: number): void {
    if (this.destroyed) return;
    const canvas = this.canvas;
    const context = this.context;
    const snapshot = this.snapshot;
    const map = this.map;
    const me = snapshot?.players.find((player) => player.id === this.playerId);
    if (canvas && context && snapshot && map && me) {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      this.drawWorld(context, width, height, time, map, snapshot, me);
      this.drawMinimap(map, snapshot, me);
    }
    this.frame = requestAnimationFrame((next) => this.draw(next));
  }

  private drawWorld(context: CanvasRenderingContext2D, width: number, height: number, time: number, map: HideSeekMap, snapshot: HideSeekSnapshot, me: HideSeekPlayer): void {
    const frameDelta = Math.max(1 / 120, Math.min(.05, (time - this.lastRenderAt) / 1_000));
    this.lastRenderAt = time;
    const renderedPositions = new Map<string, RenderPoint>();
    for (const player of snapshot.players) renderedPositions.set(player.id, this.renderPosition(player, time, frameDelta));
    const spectatorTarget = me.role === 'survivor' && !me.alive
      ? snapshot.players.find((player) => player.id === this.spectatorTargetId && player.alive && !player.escaped)
      : null;
    const targetPlayer = spectatorTarget ?? me;
    const target = renderedPositions.get(targetPlayer.id) ?? { ...targetPlayer.position, initialized: true };
    const tileSize = Math.max(27, Math.min(width / 11, height / 18));
    const toScreen = (tile: Tile): Tile => ({ x: width / 2 + (tile.x - target.x) * tileSize, y: height / 2 + (tile.y - target.y) * tileSize });
    const interaction = this.options.app.querySelector<HTMLElement>('[data-hide-seek-interact]');
    const interactionTile = me.alive && !me.escaped ? this.interactionTile(me, snapshot) : null;
    if (interaction && interactionTile) {
      const position = toScreen(interactionTile);
      interaction.style.left = `${position.x}px`;
      interaction.style.top = `${position.y - tileSize * 1.2}px`;
    }
    context.fillStyle = '#07101c';
    context.fillRect(0, 0, width, height);
    const minX = Math.max(0, Math.floor(target.x - width / tileSize / 2) - 2);
    const maxX = Math.min(map.width - 1, Math.ceil(target.x + width / tileSize / 2) + 2);
    const minY = Math.max(0, Math.floor(target.y - height / tileSize / 2) - 2);
    const maxY = Math.min(map.height - 1, Math.ceil(target.y + height / tileSize / 2) + 2);
    const walls = new Set(map.walls.map(tileKey));
    const floorTexture = this.loadImage(FLOOR_TEXTURE);
    const wallTexture = this.loadImage(WALL_TEXTURE);
    const hideoutAtlas = this.loadImage(HIDEOUT_ATLAS);
    const clinicalHideoutAtlas = this.loadImage(CLINICAL_HIDEOUT_ATLAS);
    const landmarkAtlas = this.loadImage(LANDMARK_ATLAS);
    const objectiveAtlas = this.loadImage(OBJECTIVE_ATLAS);
    const regionTints: Record<string, string> = {
      ward: 'rgba(70, 118, 154, .12)',
      laundry: 'rgba(75, 146, 137, .12)',
      nurses: 'rgba(85, 181, 194, .1)',
      reception: 'rgba(124, 104, 170, .1)',
      maintenance: 'rgba(143, 102, 73, .12)',
      surgery: 'rgba(119, 80, 126, .14)',
      records: 'rgba(94, 104, 137, .12)',
    };
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const screen = toScreen({ x, y });
      if (walls.has(`${x},${y}`)) {
        if (wallTexture.complete && wallTexture.naturalWidth > 0) context.drawImage(wallTexture, screen.x - tileSize * .54, screen.y - tileSize * .54, tileSize * 1.08, tileSize * 1.08);
        else {
          context.fillStyle = '#10192a';
          context.fillRect(screen.x - tileSize / 2, screen.y - tileSize / 2, tileSize + 1, tileSize + 1);
        }
      } else {
        if (floorTexture.complete && floorTexture.naturalWidth > 0) context.drawImage(floorTexture, screen.x - tileSize / 2, screen.y - tileSize / 2, tileSize + .6, tileSize + .6);
        else {
          context.fillStyle = (x + y) % 2 === 0 ? '#182734' : '#15232f';
          context.fillRect(screen.x - tileSize / 2, screen.y - tileSize / 2, tileSize + 1, tileSize + 1);
        }
        context.fillStyle = regionTints[hideSeekRegionAt(map, { x, y }).id] ?? 'transparent';
        context.fillRect(screen.x - tileSize / 2, screen.y - tileSize / 2, tileSize + .6, tileSize + .6);
      }
    }
    const landmarkLabels: Record<HideSeekMap['landmarks'][number]['kind'], string> = {
      'nurse-station': '병동 카운터',
      'operating-table': '수술실',
      'ward-room': '폐쇄 병실',
      'reception-desk': '접수실',
    };
    const landmarkIndexes: Record<HideSeekMap['landmarks'][number]['kind'], number> = {
      'nurse-station': 0,
      'operating-table': 1,
      'ward-room': 2,
      'reception-desk': 3,
    };
    for (const landmark of map.landmarks) {
      const position = toScreen(landmark.tile);
      const assetWidth = tileSize * landmark.footprint.width;
      const assetHeight = tileSize * landmark.footprint.height;
      if (position.x < -assetWidth || position.y < -assetHeight || position.x > width + assetWidth || position.y > height + assetHeight) continue;
      if (landmarkAtlas.complete && landmarkAtlas.naturalWidth > 0) {
        this.drawAtlasCell(context, landmarkAtlas, landmarkIndexes[landmark.kind], 4, position.x, position.y, assetWidth, assetHeight);
      }
      context.save();
      context.font = `1000 ${Math.max(9, tileSize * .3)}px system-ui`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const label = landmarkLabels[landmark.kind];
      const labelWidth = context.measureText(label).width + 14;
      context.fillStyle = 'rgba(4, 10, 22, .84)';
      context.fillRect(position.x - labelWidth / 2, position.y - assetHeight * .47, labelWidth, Math.max(16, tileSize * .48));
      context.fillStyle = '#9cecf4';
      context.fillText(label, position.x, position.y - assetHeight * .47 + Math.max(16, tileSize * .48) / 2);
      context.restore();
    }
    for (const hideout of map.hideouts) {
      const position = toScreen(hideout.tile);
      if (position.x < -tileSize || position.y < -tileSize || position.x > width + tileSize || position.y > height + tileSize) continue;
      const clinical = hideout.kind === 'double-locker' || hideout.kind === 'laundry-bin' || hideout.kind === 'privacy-screen';
      const atlas = clinical ? clinicalHideoutAtlas : hideoutAtlas;
      const atlasIndex = hideout.kind === 'locker' || hideout.kind === 'double-locker'
        ? 0
        : hideout.kind === 'cabinet' || hideout.kind === 'laundry-bin'
          ? 1
          : 2;
      const sizes: Record<HideSeekMap['hideouts'][number]['kind'], readonly [number, number]> = {
        locker: [1.05, 1.5], cabinet: [1.55, 1.12], bed: [1.05, 1.5],
        'double-locker': [1.15, 1.65], 'laundry-bin': [1.4, 1.3], 'privacy-screen': [1.65, 1.4],
      };
      const [widthScale, heightScale] = sizes[hideout.kind];
      const assetWidth = tileSize * widthScale;
      const assetHeight = tileSize * heightScale;
      if (atlas.complete && atlas.naturalWidth > 0) this.drawAtlasCell(context, atlas, atlasIndex, 3, position.x, position.y, assetWidth, assetHeight);
      else {
        context.fillStyle = '#344765';
        context.fillRect(position.x - assetWidth / 2, position.y - assetHeight / 2, assetWidth, assetHeight);
      }
    }
    const ghostDoor = toScreen(map.ghostRoom.door);
    const ghostDoorClosed = snapshot.phase === 'ROLE_LOCK' || snapshot.phase === 'HIDE';
    if (ghostDoor.x > -tileSize && ghostDoor.x < width + tileSize && ghostDoor.y > -tileSize && ghostDoor.y < height + tileSize) {
      context.save();
      if (ghostDoorClosed) {
        context.fillStyle = '#151e30';
        context.fillRect(ghostDoor.x - tileSize * .52, ghostDoor.y - tileSize * .52, tileSize * 1.04, tileSize * 1.04);
        context.strokeStyle = '#7b3348';
        context.lineWidth = Math.max(2, tileSize * .08);
        for (let offset = -.32; offset <= .32; offset += .16) {
          context.beginPath();
          context.moveTo(ghostDoor.x + tileSize * offset, ghostDoor.y - tileSize * .5);
          context.lineTo(ghostDoor.x + tileSize * offset, ghostDoor.y + tileSize * .5);
          context.stroke();
        }
      } else {
        context.strokeStyle = '#65d6df99';
        context.lineWidth = Math.max(1, tileSize * .05);
        context.strokeRect(ghostDoor.x - tileSize * .46, ghostDoor.y - tileSize * .46, tileSize * .92, tileSize * .92);
      }
      context.restore();
    }
    for (const key of snapshot.keys.filter((candidate) => keyStatus(candidate) === 'ground')) {
      const position = toScreen(key.tile);
      context.save();
      context.shadowColor = '#55e9ff';
      context.shadowBlur = 14;
      if (objectiveAtlas.complete && objectiveAtlas.naturalWidth > 0) this.drawAtlasCell(context, objectiveAtlas, 0, 3, position.x, position.y, tileSize * .82, tileSize * 1.16);
      else {
        context.fillStyle = '#ffd75f';
        context.fillRect(position.x - 4, position.y - 12, 8, 24);
      }
      context.restore();
    }
    if (snapshot.activeExit.x >= 0 && (snapshot.exitDiscovered || pointDistance(me.position, snapshot.activeExit) <= 3)) {
      const exit = toScreen(snapshot.activeExit);
      context.save();
      context.shadowColor = snapshot.exitOpen ? '#5dffdd' : '#ffce54';
      context.shadowBlur = 18;
      if (objectiveAtlas.complete && objectiveAtlas.naturalWidth > 0) this.drawAtlasCell(context, objectiveAtlas, snapshot.exitOpen ? 2 : 1, 3, exit.x, exit.y, tileSize * 1.56, tileSize * 1.42);
      else {
        context.fillStyle = snapshot.exitOpen ? '#54dca9' : '#78632d';
        context.fillRect(exit.x - tileSize * .5, exit.y - tileSize * .5, tileSize, tileSize);
      }
      context.restore();
    }
    const keyCarriers = new Set(snapshot.keys
      .map(keyCarrierId)
      .filter((carrierId): carrierId is string => Boolean(carrierId)));
    for (const player of snapshot.players) {
      if (player.position.x < 0 || player.escaped) continue;
      if (me.role === 'ghost' && player.id === me.id) continue;
      const render = renderedPositions.get(player.id) ?? { ...player.position, initialized: true };
      const position = toScreen(render);
      this.drawPlayer(context, player, position, tileSize, time, player.id === me.id);
      if (keyCarriers.has(player.id) && (!player.hiddenIn || player.id === me.id)) {
        const keyX = position.x + tileSize * .35;
        const keyY = position.y - tileSize * .72;
        context.save();
        context.shadowColor = '#55e9ff';
        context.shadowBlur = Math.max(4, tileSize * .18);
        if (objectiveAtlas.complete && objectiveAtlas.naturalWidth > 0) {
          this.drawAtlasCell(context, objectiveAtlas, 0, 3, keyX, keyY, tileSize * .3, tileSize * .44);
        } else {
          context.strokeStyle = '#ffd75f';
          context.lineWidth = Math.max(2, tileSize * .06);
          context.beginPath();
          context.arc(keyX, keyY - tileSize * .08, tileSize * .09, 0, Math.PI * 2);
          context.moveTo(keyX, keyY);
          context.lineTo(keyX, keyY + tileSize * .18);
          context.lineTo(keyX + tileSize * .1, keyY + tileSize * .18);
          context.stroke();
        }
        context.restore();
      }
    }
    const activeGhost = snapshot.players.find((player) => player.role === 'ghost' && player.position.x >= 0 && snapshot.elapsed < player.lightUntil);
    const activeGhostScreen = activeGhost
      ? toScreen(renderedPositions.get(activeGhost.id) ?? { ...activeGhost.position, initialized: true })
      : null;
    const hiddenHideout = me.hiddenIn
      ? map.hideouts.find((hideout) => hideout.id === me.hiddenIn)
      : null;
    this.drawDarkness(
      context,
      width,
      height,
      tileSize,
      me,
      snapshot,
      activeGhostScreen,
      hiddenHideout ? toScreen(hiddenHideout.front) : null,
      hiddenHideout ? toScreen(hiddenHideout.tile) : null,
    );
    if (me.role === 'ghost') this.drawPlayer(context, me, toScreen(target), tileSize, time, true);
    for (const player of snapshot.players) {
      if ((!player.detected && !player.proximityAlert) || player.position.x < 0 || player.escaped) continue;
      const position = toScreen(renderedPositions.get(player.id) ?? { ...player.position, initialized: true });
      const isDetected = player.detected;
      context.save();
      context.shadowColor = isDetected ? '#ff304f' : '#ffc928';
      context.shadowBlur = 16;
      context.fillStyle = isDetected ? '#ff405d' : '#ffd45c';
      context.font = `1000 ${tileSize * .72}px system-ui`;
      context.textAlign = 'center';
      context.fillText('!', position.x, position.y - tileSize * 1.05);
      context.restore();
    }
  }

  private renderPosition(player: HideSeekPlayer, time: number, frameDelta: number): RenderPoint {
    const snapshot = this.snapshot;
    const sinceSnapshot = Math.max(0, Math.min(.12, (time - this.snapshotReceivedAt) / 1_000));
    const canMove = snapshot && (snapshot.phase === 'HUNT' || snapshot.phase === 'LAST_ESCAPE' || snapshot.phase === 'HIDE');
    const input = player.id === this.playerId ? this.movement : player.movement;
    const magnitude = canMove && !player.hiddenIn && player.alive && !player.escaped ? Math.min(1, Math.hypot(input.x, input.y)) : 0;
    const canOccupy = (candidate: Tile): boolean => {
      const candidateKey = tileKey(candidate);
      if (!this.walkableTiles.has(candidateKey)) return false;
      if (player.role === 'survivor' && this.ghostRoomRestrictedTiles.has(candidateKey)) return false;
      if (player.role === 'ghost' && snapshot?.phase === 'HIDE' && !this.ghostRoomInteriorTiles.has(candidateKey)) return false;
      return true;
    };
    let render = this.renderPositions.get(player.id);
    if (!render || player.position.x < 0 || pointDistance(render, player.position) > 5) {
      render = { ...player.position, initialized: true };
      this.renderPositions.set(player.id, render);
      return render;
    }

    const estimatedElapsed = (snapshot?.elapsed ?? 0) + sinceSnapshot;
    const sprintMultiplier = estimatedElapsed < player.sprintUntil
      ? player.role === 'ghost' ? HIDE_SEEK_RULES.ghostSprintMultiplier : HIDE_SEEK_RULES.survivorSprintMultiplier
      : 1;

    if (player.id === this.playerId) {
      if (magnitude > .001) {
        this.localRenderMoving = true;
        const distance = HIDE_SEEK_RULES.baseSpeed * sprintMultiplier * magnitude * frameDelta;
        const moved = resolveHideSeekMovement(
          render,
          {
            x: (input.x / magnitude) * distance,
            y: (input.y / magnitude) * distance,
          },
          canOccupy,
        );
        render.x = moved.x;
        render.y = moved.y;

        // Authoritative snapshots arrive behind the currently rendered frame.
        // Correct only meaningful drift while moving; following every small
        // network offset makes the camera repeatedly step backwards.
        const error = pointDistance(render, player.position);
        if (error > .8) {
          const response = error > 2.5 ? 8 : 2.4;
          const alpha = 1 - Math.exp(-response * frameDelta);
          render.x += (player.position.x - render.x) * alpha;
          render.y += (player.position.y - render.y) * alpha;
        }
      } else {
        if (this.localRenderMoving) {
          this.localRenderMoving = false;
          this.localRenderStoppedAt = time;
        }
        // Give the server one snapshot interval to acknowledge the stop before
        // settling, avoiding a visible rollback at pointer release.
        if (time - this.localRenderStoppedAt > 150) {
          const alpha = 1 - Math.exp(-10 * frameDelta);
          render.x += (player.position.x - render.x) * alpha;
          render.y += (player.position.y - render.y) * alpha;
        }
      }
      return render;
    }

    let predicted = { ...player.position };
    if (magnitude > .001) {
      const distance = HIDE_SEEK_RULES.baseSpeed * sprintMultiplier * magnitude * sinceSnapshot;
      predicted = resolveHideSeekMovement(
        player.position,
        {
          x: (input.x / magnitude) * distance,
          y: (input.y / magnitude) * distance,
        },
        canOccupy,
      );
    }
    const alpha = 1 - Math.exp(-15 * frameDelta);
    render.x += (predicted.x - render.x) * alpha;
    render.y += (predicted.y - render.y) * alpha;
    return render;
  }

  private drawPlayer(context: CanvasRenderingContext2D, player: HideSeekPlayer, position: Tile, tileSize: number, time: number, isLocal: boolean): void {
    if (player.hiddenIn && !isLocal) return;
    const moving = Math.hypot(player.movement.x, player.movement.y) > .08;
    const url = player.role === 'ghost' ? LANTERN_GHOST_MOVEMENT : skinMovementSheetUrl(player.appearance);
    const image = this.loadImage(url);
    const size = tileSize * (player.role === 'ghost' ? 2.35 : 1.55);
    context.save();
    if (player.hiddenIn) context.globalAlpha = .48;
    if (!player.alive) context.globalAlpha = .35;
    if (image.complete && image.naturalWidth > 0) {
      if (player.role === 'ghost') {
        const frame = moving ? Math.floor(time / 155) % 4 : 0;
        const horizontal = Math.abs(player.direction.x) > Math.abs(player.direction.y);
        const row = horizontal ? player.direction.x < 0 ? 2 : 3 : player.direction.y < 0 ? 1 : 0;
        context.drawImage(
          image,
          frame * GHOST_SPRITE_CELL_SIZE,
          row * GHOST_SPRITE_CELL_SIZE,
          GHOST_SPRITE_CELL_SIZE,
          GHOST_SPRITE_CELL_SIZE,
          position.x - size / 2,
          position.y - size * .72,
          size,
          size,
        );
      } else {
        const frame = moving ? (Math.floor(time / 150) % 3) + 1 : 0;
        const horizontal = Math.abs(player.direction.x) > Math.abs(player.direction.y);
        const direction = horizontal ? 'side' : player.direction.y < 0 ? 'back' : 'front';
        const authoredSideFacesLeft = player.appearance.character === 'character-puppy';
        const flip = horizontal && ((player.direction.x < 0) !== authoredSideFacesLeft);
        if (flip) {
          context.translate(position.x, 0);
          context.scale(-1, 1);
          position = { x: 0, y: position.y };
        }
        context.drawImage(image, skinFrameIndex(frame === 1 ? 'walk-1' : frame === 2 ? 'walk-2' : frame === 3 ? 'walk-3' : 'idle') * SKIN_CELL_SIZE, skinDirectionRow(direction) * SKIN_CELL_SIZE, SKIN_CELL_SIZE, SKIN_CELL_SIZE, position.x - size / 2, position.y - size * .72, size, size);
      }
    } else {
      context.fillStyle = player.role === 'ghost' ? '#7ee7ef' : '#f3f5ff';
      context.beginPath();
      context.arc(position.x, position.y, size * .3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    if (player.role !== 'ghost') {
      context.save();
      context.textAlign = 'center';
      context.font = `1000 ${Math.max(13, tileSize * .38)}px system-ui`;
      context.strokeStyle = '#07101c';
      context.lineWidth = 4;
      context.strokeText(String(player.number ?? '?'), position.x, position.y - size * .62);
      context.fillStyle = '#dffaff';
      context.fillText(String(player.number ?? '?'), position.x, position.y - size * .62);
      context.restore();
    }
  }

  private drawAtlasCell(context: CanvasRenderingContext2D, image: HTMLImageElement, index: number, columns: number, x: number, y: number, width: number, height: number): void {
    const sourceWidth = image.naturalWidth / columns;
    context.drawImage(image, sourceWidth * index, 0, sourceWidth, image.naturalHeight, x - width / 2, y - height / 2, width, height);
  }

  private drawDarkness(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    tileSize: number,
    me: HideSeekPlayer,
    snapshot: HideSeekSnapshot,
    activeGhostScreen: Tile | null,
    hiddenFrontScreen: Tile | null,
    hiddenShelterScreen: Tile | null,
  ): void {
    const darkness = this.darknessContext;
    if (!darkness) return;
    const pixelWidth = Math.max(1, Math.ceil(width));
    const pixelHeight = Math.max(1, Math.ceil(height));
    if (this.darknessCanvas.width !== pixelWidth || this.darknessCanvas.height !== pixelHeight) {
      this.darknessCanvas.width = pixelWidth;
      this.darknessCanvas.height = pixelHeight;
    }
    darkness.setTransform(1, 0, 0, 1, 0, 0);
    darkness.globalCompositeOperation = 'source-over';
    darkness.clearRect(0, 0, pixelWidth, pixelHeight);
    // Navigation geometry remains faintly readable for both roles. The ghost
    // gets slightly more ambient map light because its hard reveal radius is
    // only two tiles; survivor entities are still omitted server-side until
    // detection, so this does not leak their positions through the darkness.
    const ghostConfined = me.role === 'ghost' && snapshot.phase === 'HIDE';
    const survivorHidden = me.role === 'survivor' && Boolean(me.hiddenIn);
    darkness.fillStyle = ghostConfined || survivorHidden ? 'rgba(0, 2, 9, .995)' : me.role === 'ghost' ? 'rgba(0, 2, 9, .82)' : 'rgba(0, 2, 9, .88)';
    darkness.fillRect(0, 0, pixelWidth, pixelHeight);
    const center = { x: width / 2, y: height / 2 };
    const carveLight = (position: Tile, radius: number, strength: number, clearUntil: number): void => {
      if (strength <= 0) return;
      darkness.globalCompositeOperation = 'destination-out';
      const gradient = darkness.createRadialGradient(position.x, position.y, 0, position.x, position.y, radius);
      gradient.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
      gradient.addColorStop(clearUntil, `rgba(0, 0, 0, ${strength})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      darkness.fillStyle = gradient;
      darkness.fillRect(position.x - radius, position.y - radius, radius * 2, radius * 2);
    };
    // The seeker remains physically confined to its start room during HIDE,
    // but its viewport must remain the normal follow camera. Revealing the
    // room bounds here made a moving rectangular "camera" around the ghost.
    // Keep the regular local light radius instead, so only visibility is
    // constrained and the camera never changes shape or origin.
    if (survivorHidden) {
      if (hiddenShelterScreen) carveLight(hiddenShelterScreen, tileSize * .9, 1, .68);
      if (hiddenFrontScreen) carveLight(hiddenFrontScreen, tileSize * .72, 1, .7);
    } else {
      carveLight(center, tileSize * (me.role === 'ghost' ? HIDE_SEEK_RULES.lanternRange + .25 : 4), 1, me.role === 'ghost' ? .86 : .5);
    }
    const estimatedElapsed = snapshot.elapsed + Math.max(0, performance.now() - this.snapshotReceivedAt) / 1_000;
    const activeGhost = snapshot.players.find((player) => player.role === 'ghost' && player.position.x >= 0 && estimatedElapsed < player.lightUntil);
    const lightStrength = activeGhost
      ? Math.min(1, Math.max(0, (activeGhost.lightUntil - estimatedElapsed) / HIDE_SEEK_RULES.ghostLightSeconds))
      : 0;
    if (!ghostConfined && !survivorHidden && activeGhostScreen && lightStrength > 0) {
      carveLight(activeGhostScreen, tileSize * HIDE_SEEK_RULES.ghostLightRange, lightStrength, .45);
    }
    darkness.globalCompositeOperation = 'source-over';
    context.save();
    context.drawImage(this.darknessCanvas, 0, 0, pixelWidth, pixelHeight, 0, 0, width, height);
    if (!ghostConfined && !survivorHidden && activeGhostScreen && lightStrength > 0) {
      const glowRadius = tileSize * HIDE_SEEK_RULES.ghostLightRange;
      const glow = context.createRadialGradient(activeGhostScreen.x, activeGhostScreen.y, 0, activeGhostScreen.x, activeGhostScreen.y, glowRadius);
      glow.addColorStop(0, `rgba(255, 207, 90, ${.16 * lightStrength})`);
      glow.addColorStop(.55, `rgba(104, 225, 244, ${.07 * lightStrength})`);
      glow.addColorStop(1, 'rgba(104, 225, 244, 0)');
      context.globalCompositeOperation = 'screen';
      context.fillStyle = glow;
      context.fillRect(activeGhostScreen.x - glowRadius, activeGhostScreen.y - glowRadius, glowRadius * 2, glowRadius * 2);
    }
    context.restore();
  }

  private drawMinimap(map: HideSeekMap, snapshot: HideSeekSnapshot, me: HideSeekPlayer): void {
    const canvas = this.minimap;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    const scale = Math.min(width / map.width, height / map.height);
    const offsetX = (width - map.width * scale) / 2;
    const offsetY = (height - map.height * scale) / 2;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(3, 9, 18, .92)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = me.role === 'ghost' ? '#324f58' : '#385168';
    for (const key of snapshot.exploredTileKeys) {
      const [x, y] = key.split(',').map(Number);
      context.fillRect(offsetX + (x as number) * scale, offsetY + (y as number) * scale, Math.max(1, scale), Math.max(1, scale));
    }
    if (me.role === 'survivor' && snapshot.exitDiscovered) {
      context.fillStyle = '#ffd25c';
      context.fillRect(offsetX + snapshot.activeExit.x * scale - 2, offsetY + snapshot.activeExit.y * scale - 2, 5, 5);
    }
    if (me.role === 'survivor') {
      context.fillStyle = '#68dce8';
      for (const key of snapshot.keys.filter((candidate) => keyStatus(candidate) === 'ground')) {
        const x = offsetX + key.tile.x * scale;
        const y = offsetY + key.tile.y * scale;
        context.save();
        context.translate(x, y);
        context.rotate(Math.PI / 4);
        context.fillRect(-1.8, -1.8, 3.6, 3.6);
        context.restore();
      }
    }
    const drawMarker = (player: HideSeekPlayer, color: string, radius: number): void => {
      context.beginPath();
      context.fillStyle = color;
      context.arc(offsetX + player.position.x * scale, offsetY + player.position.y * scale, radius, 0, Math.PI * 2);
      context.fill();
      if (player.role !== 'survivor') return;
      context.fillStyle = '#07101c';
      context.font = '800 6px system-ui';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(player.number ?? ''), offsetX + player.position.x * scale, offsetY + player.position.y * scale);
    };
    if (me.role === 'survivor') {
      for (const player of snapshot.players.filter((candidate) => candidate.role === 'survivor' && candidate.alive && !candidate.escaped)) {
        const highlighted = player.id === me.id || (!me.alive && player.id === this.spectatorTargetId);
        drawMarker(player, highlighted ? '#ffd35d' : '#6fe8ff', highlighted ? 3.3 : 2.6);
      }
      for (const player of snapshot.players.filter((candidate) => candidate.role === 'survivor' && !candidate.alive && !candidate.escaped && candidate.position.x >= 0)) {
        const x = offsetX + player.position.x * scale;
        const y = offsetY + player.position.y * scale;
        context.save();
        context.fillStyle = '#46515e';
        context.beginPath();
        context.arc(x, y, 3.3, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#d0d5dc';
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(x - 2, y - 2);
        context.lineTo(x + 2, y + 2);
        context.moveTo(x + 2, y - 2);
        context.lineTo(x - 2, y + 2);
        context.stroke();
        context.fillStyle = '#d0d5dc';
        context.font = '800 5px system-ui';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(String(player.number ?? ''), x + 4.3, y);
        context.restore();
      }
      const nearbyGhost = snapshot.players.find((candidate) => candidate.role === 'ghost' && candidate.position.x >= 0);
      if (nearbyGhost) drawMarker(nearbyGhost, '#ff405d', 3.4);
      return;
    }
    drawMarker(me, '#ffd35d', 3.4);
  }

  private loadImage(url: string): HTMLImageElement {
    let image = this.imageCache.get(url);
    if (!image) {
      image = new Image();
      image.decoding = 'async';
      image.src = url;
      this.imageCache.set(url, image);
    }
    return image;
  }

  private showQuickChat(number: number, phrase: string): void {
    const feed = this.options.app.querySelector<HTMLElement>('[data-hide-seek-chat-feed]');
    if (!feed) return;
    const message = document.createElement('p');
    message.innerHTML = `<b>${number}번</b><span>${html(phrase)}</span>`;
    feed.appendChild(message);
    window.setTimeout(() => message.remove(), 3_000);
  }

  private showReconnectOverlay(): void {
    if (this.options.app.querySelector('[data-hide-seek-reconnecting]')) return;
    const overlay = document.createElement('div');
    overlay.className = 'hide-seek-reconnecting';
    overlay.dataset.hideSeekReconnecting = '';
    overlay.innerHTML = '<i></i><strong>병동 연결 복구 중</strong><span>현재 위치를 안전하게 되찾고 있습니다.</span>';
    this.options.app.appendChild(overlay);
  }

  private toast(message: string): void {
    const toast = this.options.app.querySelector<HTMLElement>('[data-hide-seek-toast]');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    window.setTimeout(() => toast.classList.remove('visible'), 2_200);
  }

  private leave(): void {
    this.intentionalClose = true;
    this.send({ type: 'leave-room' });
    window.setTimeout(() => {
      this.finishExit();
    }, 120);
  }

  private finishExit(): void {
    if (this.exitCompleted) return;
    this.exitCompleted = true;
    this.destroy();
    this.options.onExit();
  }
}

export function mountHideSeekExperience(options: HideSeekExperienceOptions): HideSeekExperienceHandle {
  return new HideSeekExperience(options);
}
