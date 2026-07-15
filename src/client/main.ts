import Phaser from 'phaser';
import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost } from '../shared/balance';
import { DRAW_COSTS, getRandomItem } from '../shared/randomItems';
import { rankBenefits, rankLabel, stagesThrough } from '../shared/progression';
import type { AccountProfile, BuildingKind, GameEvent, GameSnapshot, MapDefinition, StageId, Tile, Vec2 } from '../shared/types';
import { SynthAudio } from './audio';
import { getAccount, loginAccount, logoutAccount, registerAccount } from './auth';
import { GameScene, type SceneSelection } from './game/GameScene';
import { GameNetwork } from './network';
import { loadProfile, saveProfile } from './storage';
import './styles.css';

declare global {
  interface Window {
    __DORM_TEST__?: {
      snapshot: GameSnapshot | null;
      map: MapDefinition | null;
      playerId: string;
      move: (dx: number, dy: number) => void;
      buildFirst: (kind: BuildingKind) => boolean;
      disconnect: () => void;
    };
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
if (!app) throw new Error('App root is missing');

const profile = loadProfile();
const audio = new SynthAudio();
audio.setVolume(profile.volume);
let network: GameNetwork | null = null;
let game: Phaser.Game | null = null;
let snapshot: GameSnapshot | null = null;
let mapData: MapDefinition | null = null;
let playerId = '';
let account: AccountProfile | null = null;
let selectedTile: Tile | null = null;
let selectedTarget: SceneSelection | null = null;
let currentView = '';
let inputSequence = 0;
let inputVector: Vec2 = { x: 0, y: 0 };
let ping = 0;
let resultRecorded = false;
let toastTimer = 0;
const e2eMode = new URLSearchParams(location.search).get('e2e') === '1';
const devMode = new URLSearchParams(location.search).get('dev') === '1';
const freshMode = new URLSearchParams(location.search).get('fresh') === '1';
const BUILD_KINDS: Exclude<BuildingKind, 'bed' | 'reinforced-door'>[] = [
  'basic-turret', 'rapid-turret', 'frost-turret', 'generator', 'repair-drone', 'electric-coil', 'floor-trap', 'shield-device', 'lucky-machine',
];

const escapeHtml = (value: string): string => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] as string);
const colorHex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const formatTime = (seconds: number): string => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function setContent(view: string, html: string): void {
  currentView = view;
  app.innerHTML = `${html}<button class="btn icon-btn" data-settings aria-label="설정">⚙</button><div class="toast" id="toast"></div>`;
  app.querySelector('[data-settings]')?.addEventListener('click', showSettings);
}

function loading(): void {
  setContent('loading', `<main class="screen"><section class="panel compact" style="text-align:center"><div class="title-mark">☾</div><div class="spinner"></div><h2>새벽 순찰 준비 중</h2><p class="subtitle">방어 장치와 복도를 점검하고 있습니다.</p></section></main>`);
}

function desktopNotice(): void {
  setContent('desktop', `<main class="screen"><section class="panel compact desktop-card"><div class="desktop-icon">📱</div><span class="eyebrow">MOBILE ONLY</span><h2>모바일 전용 게임입니다</h2><p class="subtitle">휴대폰 브라우저에서 이 주소를 열어 가로 모드로 플레이하세요. 개발 환경에서는 주소 끝에 <strong>?dev=1</strong>을 붙일 수 있습니다.</p></section></main>`);
}

function authScreen(mode: 'login' | 'register' = 'login'): void {
  const registering = mode === 'register';
  setContent('auth', `<main class="screen"><section class="panel auth-panel"><div class="auth-brand"><div class="title-mark">☾</div><div><span class="eyebrow">CLOUDFLARE D1 ACCOUNT</span><h1>심야 기숙사</h1><p class="subtitle">계정에 개인/멀티 등급과 스테이지 진행도를 안전하게 저장합니다.</p></div></div><div class="auth-tabs"><button class="btn ${!registering ? 'primary' : 'ghost'}" data-auth-tab="login">로그인</button><button class="btn ${registering ? 'primary' : 'ghost'}" data-auth-tab="register">새 계정</button></div><form id="auth-form"><div class="field"><label for="username">아이디</label><input id="username" type="text" minlength="4" maxlength="20" autocomplete="username" placeholder="영문 소문자·숫자 4~20자" /></div>${registering ? '<div class="field"><label for="nickname">게임 닉네임</label><input id="nickname" type="text" minlength="2" maxlength="12" autocomplete="nickname" placeholder="2~12자 닉네임" /></div>' : ''}<div class="field"><label for="password">비밀번호</label><input id="password" type="password" minlength="8" maxlength="72" autocomplete="${registering ? 'new-password' : 'current-password'}" placeholder="8자 이상" /></div><button class="btn gold" type="submit" style="width:100%">${registering ? '계정 만들고 시작' : '로그인하고 시작'}</button></form></section></main>`);
  app.querySelectorAll<HTMLElement>('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => authScreen(button.dataset.authTab === 'register' ? 'register' : 'login')));
  app.querySelector<HTMLFormElement>('#auth-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    audio.play('button');
    const username = app.querySelector<HTMLInputElement>('#username')?.value.trim() ?? '';
    const password = app.querySelector<HTMLInputElement>('#password')?.value ?? '';
    const nickname = app.querySelector<HTMLInputElement>('#nickname')?.value.trim() ?? '';
    connectionOverlay(registering ? '계정을 만드는 중…' : '계정에 로그인하는 중…');
    void (registering ? registerAccount(username, nickname, password) : loginAccount(username, password))
      .then((next) => {
        account = next;
        profile.nickname = next.nickname;
        saveProfile(profile);
        roomMenu();
      })
      .catch((error) => {
        authScreen(mode);
        toast(error instanceof Error ? error.message : '로그인할 수 없습니다.');
      });
  });
}

function roomMenu(): void {
  if (!account) { authScreen(); return; }
  const currentAccount = account;
  const benefits = rankBenefits(currentAccount.soloRank);
  const soloOptions = stagesThrough(currentAccount.soloStageIndex).map((stage) => `<option value="${stage.id}" ${stage.index === currentAccount.soloStageIndex ? 'selected' : ''}>${stage.label}</option>`).join('');
  const multiOptions = stagesThrough(currentAccount.multiplayerStageIndex).map((stage) => `<option value="${stage.id}" ${stage.index === currentAccount.multiplayerStageIndex ? 'selected' : ''}>${stage.label}</option>`).join('');
  const perk = `${benefits.speedMultiplier > 1 ? `이동속도 +${Math.round((benefits.speedMultiplier - 1) * 100)}%` : '기본 이동속도'} · 문 최대 Lv.${3 + benefits.doorLevelBonus} · 포탑 최대 Lv.${15 + benefits.turretLevelBonus}${benefits.rareTurretUnlocked ? ' · 희귀 천둥포 해금' : ''}`;
  setContent('room-menu', `<main class="screen"><section class="panel account-hub"><div class="account-head"><div><span class="eyebrow">WELCOME, ${escapeHtml(currentAccount.nickname)}</span><h2>어떤 새벽을 시작할까요?</h2></div><button class="btn ghost mini-btn" data-logout>로그아웃</button></div><div class="rank-summary"><div class="rank-emblem rank-${currentAccount.displayRank}">${rankLabel(currentAccount.displayRank)}</div><div><strong>게임 표시 등급 · ${rankLabel(currentAccount.displayRank)}</strong><span>개인 ${rankLabel(currentAccount.soloRank)} (${currentAccount.soloXp} XP) · 멀티 ${rankLabel(currentAccount.multiplayerRank)} (${currentAccount.multiplayerXp} XP)</span><small>${perk}</small></div></div><div class="mode-grid"><article class="mode-card"><span class="eyebrow">SOLO</span><h3>개인 플레이</h3><label>도전 스테이지<select data-solo-stage>${soloOptions}</select></label><button class="btn primary" data-solo>봇과 혼자 시작</button></article><article class="mode-card"><span class="eyebrow">MULTIPLAYER</span><h3>멀티 플레이</h3><label>도전 스테이지<select data-multi-stage>${multiOptions}</select></label><button class="btn primary" data-create data-testid="create-room">새 멀티 방</button></article></div><div class="join-strip"><div class="field"><label for="invite-code">8자리 초대 코드로 참가</label><input class="code-input" id="invite-code" type="text" maxlength="8" inputmode="text" value="${escapeHtml(profile.recentRoomCode)}" placeholder="A1B2C3D4" /></div><button class="btn gold" data-join data-testid="join-room">친구 방 참가</button></div></section></main>`);
  app.querySelector('[data-create]')?.addEventListener('click', () => void createRoom(false));
  app.querySelector('[data-solo]')?.addEventListener('click', () => void createRoom(true));
  app.querySelector('[data-join]')?.addEventListener('click', () => void joinRoom());
  app.querySelector('[data-logout]')?.addEventListener('click', () => void logoutAccount().then(() => {
    account = null;
    network?.close();
    network = null;
    authScreen();
  }));
  app.querySelector<HTMLInputElement>('#invite-code')?.addEventListener('input', (event) => {
    const input = event.currentTarget as HTMLInputElement; input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  });
}

async function createRoom(solo: boolean): Promise<void> {
  const selector = app.querySelector(solo ? '[data-solo-stage]' : '[data-multi-stage]') as HTMLSelectElement | null;
  const stageId = (selector?.value ?? 'easy-1') as StageId;
  audio.play('button'); connectionOverlay('방을 만드는 중…');
  try {
    const response = await fetch('/api/rooms/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ testMode: e2eMode, stageId, playMode: solo ? 'solo' : 'multiplayer' }) });
    const data = await response.json() as { code?: string; error?: string };
    if (!response.ok || !data.code) throw new Error(data.error ?? '방을 만들지 못했습니다.');
    profile.recentRoomCode = data.code; saveProfile(profile);
    connectToRoom(data.code, solo);
  } catch (error) {
    roomMenu(); toast(error instanceof Error ? error.message : '서버에 연결할 수 없습니다.');
  }
}

async function joinRoom(): Promise<void> {
  const code = app.querySelector<HTMLInputElement>('#invite-code')?.value.trim().toUpperCase() ?? '';
  if (!/^[A-Z2-9]{8}$/.test(code)) { toast('초대 코드 8자리를 확인해주세요.'); return; }
  audio.play('button'); connectionOverlay('초대 코드를 확인하는 중…');
  try {
    const response = await fetch(`/api/rooms/${code}/status`);
    if (!response.ok) throw new Error('존재하지 않거나 종료된 방입니다.');
    profile.recentRoomCode = code; saveProfile(profile); connectToRoom(code, false);
  } catch (error) {
    roomMenu(); toast(error instanceof Error ? error.message : '방에 참가할 수 없습니다.');
  }
}

function connectToRoom(code: string, addSoloBots: boolean): void {
  network?.close();
  network = new GameNetwork(code, profile.nickname, profile.deviceId, profile.reconnectTokens[code]);
  let firstWelcome = true;
  network.on('welcome', ({ playerId: id, map, snapshot: initial }) => {
    playerId = id; mapData = map; snapshot = initial;
    profile.reconnectTokens[code] = network?.reconnectToken ?? ''; saveProfile(profile);
    if (firstWelcome) {
      firstWelcome = false;
      renderForSnapshot(initial, true);
      if (addSoloBots && initial.hostId === id) {
        network?.addBot('easy'); network?.addBot('normal'); network?.addBot('normal');
      }
    } else renderForSnapshot(initial, false);
    updateTestApi();
  });
  network.on('snapshot', ({ snapshot: next, events }) => {
    snapshot = next;
    renderForSnapshot(next, false);
    const scene = game?.scene.getScene('game') as GameScene | undefined;
    if (scene?.scene.isActive()) scene.updateSnapshot(next, events);
    playEvents(events);
    refreshSelectionPanel();
    updateTestApi();
  });
  network.on('connection', ({ state, attempt }) => updateConnection(state, attempt));
  network.on('error', ({ message }) => toast(message));
  network.on('ping', ({ milliseconds }) => { ping = milliseconds; updateHud(); });
  network.connect();
}

function lobbyScreen(state: GameSnapshot): void {
  destroyGame();
  setContent('lobby', `<main class="screen"><section class="panel"><span class="eyebrow">${state.playMode === 'solo' ? 'SOLO' : 'MULTIPLAYER'} · ${state.stageLabel}</span><h2>친구를 기다리는 중</h2><p class="subtitle">스테이지가 높을수록 귀신의 초기 HP·공격력·성장률과 특수 스킬이 강화됩니다.</p><div class="room-code"><span>8자리 초대 코드<br>눌러서 복사</span><strong data-copy data-testid="room-code">${state.roomCode}</strong></div><div class="players" id="players" data-testid="players"></div><div class="lobby-actions"><button class="btn ghost" data-ready>준비</button><button class="btn ghost" data-bot>봇 추가</button><button class="btn primary" data-start data-testid="start-game">20초 준비 시작</button></div></section></main>`);
  app.querySelector('[data-copy]')?.addEventListener('click', () => { void navigator.clipboard?.writeText(state.roomCode); toast('초대 코드를 복사했습니다.'); });
  app.querySelector('[data-ready]')?.addEventListener('click', () => {
    const me = snapshot?.players.find((player) => player.id === playerId); network?.ready(!me?.ready); audio.play('button');
  });
  app.querySelector('[data-bot]')?.addEventListener('click', () => { network?.addBot('normal'); audio.play('button'); });
  app.querySelector('[data-start]')?.addEventListener('click', () => { network?.start(); audio.play('button'); });
  updateLobby(state);
}

function updateLobby(state: GameSnapshot): void {
  const container = app.querySelector('#players');
  if (!container) return;
  container.innerHTML = state.players.map((player) => `<article class="player-card rank-border-${player.displayRank}" data-player-id="${player.id}"><i class="player-dot" style="color:${colorHex(player.color)};background:${colorHex(player.color)}"></i><div class="player-copy"><strong><em class="rank-tag rank-${player.displayRank}">${rankLabel(player.displayRank)}</em> ${escapeHtml(player.nickname)}${state.hostId === player.id ? ' ★' : ''}</strong><span>${player.isBot ? '서버 생존자 봇' : player.connected ? `개인 ${rankLabel(player.soloRank)} · 멀티 ${rankLabel(player.multiplayerRank)}` : '재접속 대기'}</span></div><b class="ready-badge">${player.ready || player.id === state.hostId ? 'READY' : 'WAIT'}</b></article>`).join('') + (state.players.length < 4 ? `<article class="player-card" style="opacity:.42"><i class="player-dot"></i><div class="player-copy"><strong>빈 침대</strong><span>친구 또는 봇</span></div></article>` : '');
  const me = state.players.find((player) => player.id === playerId);
  const ready = app.querySelector<HTMLButtonElement>('[data-ready]');
  if (ready) ready.textContent = me?.ready ? '준비 취소' : '준비';
  const host = state.hostId === playerId;
  const start = app.querySelector<HTMLButtonElement>('[data-start]');
  const bot = app.querySelector<HTMLButtonElement>('[data-bot]');
  if (start) { start.disabled = !host; start.textContent = host ? '20초 준비 시작' : '방장 대기 중'; }
  if (bot) bot.disabled = !host || state.players.length >= 4;
}

function gameScreen(state: GameSnapshot): void {
  const me = state.players.find((player) => player.id === playerId);
  setContent('game', `<main id="game-shell"><div id="game-root"></div><div class="hud"><div class="stage-chip"><span>${state.playMode === 'solo' ? '개인' : '멀티'} · ${state.stageLabel}</span><strong>${me ? `${rankLabel(me.displayRank)} ${escapeHtml(me.nickname)}` : '생존자'}</strong></div><div class="hud-group"><div class="stat"><i>♥</i><span>HP</span><strong data-hp>0</strong></div><div class="stat"><i>◆</i><span>골드</span><strong data-gold>0</strong></div><div class="stat"><i>⚡</i><span>전력</span><strong data-power>0</strong></div><div class="stat"><i>▣</i><span>문</span><strong data-door>—</strong></div></div><div class="hud-group"><div class="stat"><i>☾</i><span>귀신</span><strong data-ghost>Lv.1</strong></div><div class="stat"><i>🎁</i><span>뽑기</span><strong data-draw>0/4</strong></div><div class="stat"><i>◷</i><span>시간</span><strong data-time>00:00</strong></div></div><div class="network-pill" data-network data-testid="network">연결됨 · 0ms</div></div><div class="phase-banner" data-phase>준비 시간</div><div class="controls"><div class="joystick" data-joystick><div class="joystick-knob"></div></div><div class="action-stack"><button class="round-btn secondary" data-cancel>취소</button><button class="round-btn secondary" data-inventory>가방</button><button class="round-btn" data-interact data-testid="interact">점유 / 행동</button></div></div><aside class="build-panel hidden" data-build-panel></aside><div class="connection-overlay hidden" data-connection><div class="connection-card"><div class="spinner"></div><strong>연결을 복구하는 중</strong><p class="subtitle" data-reconnect-copy>30초 안에 기존 생존자로 돌아갑니다.</p></div></div></main>`);
  setupJoystick();
  app.querySelector('[data-interact]')?.addEventListener('click', () => { network?.interact(); audio.play('button'); });
  app.querySelector('[data-cancel]')?.addEventListener('click', () => closeBuildPanel());
  app.querySelector('[data-inventory]')?.addEventListener('click', showInventory);
  window.addEventListener('dorm:tile-selected', onTileSelected as EventListener);
  window.addEventListener('dorm:target-selected', onTargetSelected as EventListener);
  if (!mapData) return;
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    width: 960,
    height: 480,
    backgroundColor: '#090b1a',
    render: { antialias: true, pixelArt: false, roundPixels: true, powerPreference: 'high-performance' },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    fps: { target: 60, forceSetTimeOut: false },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [],
  });
  game.scene.add('game', GameScene, true, { map: mapData, playerId, snapshot: state });
  updateHud();
}

function renderForSnapshot(state: GameSnapshot, force: boolean): void {
  if (state.status === 'LOBBY') {
    if (force || currentView !== 'lobby') lobbyScreen(state); else updateLobby(state);
  } else if (state.status === 'COUNTDOWN' || state.status === 'PLAYING') {
    if (force || currentView !== 'game') gameScreen(state); else updateHud();
  } else if (state.status === 'VICTORY' || state.status === 'DEFEAT') {
    if (force || currentView !== 'result') resultScreen(state);
  }
}

function updateHud(): void {
  if (!snapshot || currentView !== 'game') return;
  const me = snapshot.players.find((player) => player.id === playerId);
  const room = snapshot.rooms.find((candidate) => candidate.id === me?.roomId);
  setText('[data-hp]', me ? `${Math.ceil(me.hp)}/${me.maxHp}` : '—');
  setText('[data-gold]', me ? Math.floor(me.gold).toString() : '0');
  setText('[data-power]', me ? Math.floor(me.power).toString() : '0');
  setText('[data-door]', room ? `${Math.ceil(room.doorHp)}` : '미점유');
  const aliveGhosts = snapshot.ghosts.filter((ghost) => ghost.hp > 0);
  const leadGhost = aliveGhosts[0] ?? snapshot.ghost;
  setText('[data-ghost]', `${aliveGhosts.length > 1 ? `${aliveGhosts.length}명 · ` : ''}Lv.${leadGhost.level} ${leadGhost.attackCount}/${leadGhost.attacksToNextLevel}`);
  setText('[data-draw]', `${me?.drawCount ?? 0}/4`);
  setText('[data-time]', formatTime(snapshot.elapsed));
  const retreating = snapshot.ghosts.some((ghost) => ghost.retreating || ghost.healing);
  const goldLocked = snapshot.goldSuppressedUntil > snapshot.elapsed;
  const repairLocked = snapshot.repairSuppressedUntil > snapshot.elapsed;
  const skillWarning = goldLocked ? `⚠ 골드 획득 봉인 ${Math.ceil(snapshot.goldSuppressedUntil - snapshot.elapsed)}초` : repairLocked ? `⚠ 문 수리 봉인 ${Math.ceil(snapshot.repairSuppressedUntil - snapshot.elapsed)}초` : null;
  setText('[data-phase]', snapshot.status === 'COUNTDOWN' ? `${snapshot.stageLabel} · 침대를 찾아 점유하세요 · ${Math.ceil(snapshot.countdown)}초` : skillWarning ?? (retreating ? '⚠ 귀신이 회복 구역으로 후퇴 중 — 지금 처치하세요!' : `${snapshot.stageLabel} · ${snapshot.matchEvent} · 문 타격으로 귀신이 성장합니다`));
  const net = app.querySelector<HTMLElement>('[data-network]');
  if (net) net.textContent = `연결됨 · ${Math.round(ping)}ms`;
}

function resultScreen(state: GameSnapshot): void {
  destroyGame();
  const victory = state.status === 'VICTORY';
  if (!resultRecorded) {
    resultRecorded = true;
    profile.bestSurvivalSeconds = Math.max(profile.bestSurvivalSeconds, state.elapsed);
    profile.bestGhostLevel = Math.max(profile.bestGhostLevel, state.ghost.level);
    if (victory) { profile.victories += 1; profile.ghostKills += 1; }
    saveProfile(profile);
  }
  audio.play(victory ? 'victory' : 'defeat');
  setContent('result', `<main class="screen"><section class="panel compact" style="text-align:center"><div class="title-mark">${victory ? '✦' : '☁'}</div><span class="eyebrow">${state.stageLabel} · ${victory ? 'DAWN SURVIVED' : 'NIGHT CONSUMED'}</span><h1>${victory ? '새벽을 지켜냈습니다' : '기숙사가 잠식되었습니다'}</h1><p class="subtitle">생존 시간 ${formatTime(state.elapsed)} · 악몽 레벨 ${state.ghost.level}<br>${victory ? '승리 XP와 다음 스테이지가 계정에 저장됩니다.' : '도전 XP가 계정에 저장됩니다.'}</p><div class="button-row"><button class="btn primary" data-rematch data-testid="rematch">같은 팀으로 재대결</button><button class="btn ghost" data-leave>메뉴로 나가기</button></div></section></main>`);
  app.querySelector('[data-rematch]')?.addEventListener('click', () => { resultRecorded = false; network?.rematch(); audio.play('button'); });
  app.querySelector('[data-leave]')?.addEventListener('click', () => {
    network?.close(); network = null; loading();
    void getAccount().then((next) => { account = next; roomMenu(); }).catch(() => roomMenu());
  });
}

function onTileSelected(event: CustomEvent<Tile>): void {
  selectedTarget = null;
  selectedTile = event.detail;
  renderBuildPanel(event.detail);
}

function onTargetSelected(event: CustomEvent<SceneSelection>): void {
  selectedTile = null;
  selectedTarget = event.detail;
  renderTargetPanel(event.detail);
}

function renderBuildPanel(tile: Tile): void {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  if (!me?.roomId || tile.roomId !== me.roomId) { toast('자신이 점유한 방의 타일만 사용할 수 있습니다.'); return; }
  const panel = app.querySelector<HTMLElement>('[data-build-panel]');
  if (!panel) return;
  const occupied = snapshot.buildings.find((building) => building.tile.x === tile.x && building.tile.y === tile.y);
  if (occupied) {
    selectedTarget = { type: 'building', targetId: occupied.id, buildingId: occupied.id, roomId: occupied.roomId };
    selectedTile = null;
    renderTargetPanel(selectedTarget);
    return;
  }
  const benefits = rankBenefits(me.soloRank);
  const availableKinds = benefits.rareTurretUnlocked ? [...BUILD_KINDS, 'arc-turret' as const] : BUILD_KINDS;
  panel.innerHTML = `<h3>빈 타일에 설비 설치</h3><p>${tile.x}, ${tile.y} · 보유 ◆ ${Math.floor(me.gold)} / ⚡ ${Math.floor(me.power)}</p><div class="build-grid">${availableKinds.map((kind) => { const definition = BALANCE.buildings[kind]; const cost = upgradeCost(kind, 1, me.soloRank); return `<button class="build-card ${kind === 'arc-turret' ? 'rare-build' : ''}" data-build="${kind}"><strong>${definition.label}</strong><span>설치 비용 ◆ ${cost.gold} · ⚡ ${cost.power}</span><small>${definition.description}</small></button>`; }).join('')}</div>${!benefits.rareTurretUnlocked ? '<small class="odds-note">희귀 천둥포는 개인 등급 베테랑부터 해금됩니다.</small>' : ''}`;
  panel.classList.remove('hidden');
  panel.querySelectorAll<HTMLElement>('[data-build]').forEach((button) => button.addEventListener('click', () => {
    if (selectedTile && me.roomId) network?.build(me.roomId, selectedTile, button.dataset.build as BuildingKind);
  }));
}

function renderTargetPanel(selection: SceneSelection): void {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  const panel = app.querySelector<HTMLElement>('[data-build-panel]');
  if (!me || !panel) return;
  if (selection.roomId !== me.roomId) { toast('자신이 점유한 방의 설비만 조작할 수 있습니다.'); return; }
  const room = snapshot.rooms.find((candidate) => candidate.id === selection.roomId);
  const building = selection.buildingId ? snapshot.buildings.find((candidate) => candidate.id === selection.buildingId) : undefined;
  const kind: BuildingKind = selection.type === 'bed' ? 'bed' : selection.type === 'door' ? 'reinforced-door' : building?.kind ?? 'basic-turret';
  const currentLevel = selection.type === 'bed' ? room?.bedLevel ?? 1 : selection.type === 'door' ? room?.doorLevel ?? 1 : building?.level ?? 1;
  const definition = BALANCE.buildings[kind];
  if (kind === 'lucky-machine' && building) {
    const cost = DRAW_COSTS[me.drawCount];
    const owned = me.items.map((item) => `${escapeHtml(item.label)}${item.count > 1 ? ` ×${item.count}` : ''}`).join(' · ') || '아직 획득한 아이템이 없습니다.';
    panel.innerHTML = `<h3>🎁 ${definition.label}</h3><p>${definition.description}</p><div class="target-level"><strong>${me.drawCount}/4회 사용</strong><span>${owned}</span></div>${cost ? `<button class="btn gold" data-draw style="width:100%">${me.drawCount + 1}번째 뽑기 · ◆ ${cost.gold} + ⚡ ${cost.power}</button>` : '<button class="btn ghost" disabled style="width:100%">이번 판 4회 완료</button>'}<small class="odds-note">전설 아이템은 매우 낮은 확률로 등장하며, 장식품은 아무 효과가 없습니다.</small>`;
    panel.classList.remove('hidden');
    panel.querySelector('[data-draw]')?.addEventListener('click', () => network?.drawItem(building.id));
    return;
  }
  const maxLevel = maxBuildingLevel(kind, me.soloRank);
  const nextLevel = currentLevel + 1;
  const current = buildingStats(kind, currentLevel);
  const cost = currentLevel < maxLevel ? upgradeCost(kind, nextLevel, me.soloRank) : null;
  const effectLabel = kind === 'bed' ? `초당 골드 ${current.value}` : kind === 'reinforced-door' ? `최대 HP ${current.value}` : ['basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret'].includes(kind) ? `공격력 ${current.value} · 사거리 ${current.range}` : `효과 수치 ${current.value}`;
  panel.innerHTML = `<h3>${definition.label}</h3><p>${definition.description}</p><div class="target-level"><strong>Lv.${currentLevel} / ${maxLevel}</strong><span>${effectLabel}</span></div>${cost ? `<button class="btn primary" data-upgrade="${selection.targetId}" style="width:100%">Lv.${nextLevel} 업그레이드 · ◆ ${cost.gold} + ⚡ ${cost.power}</button>` : '<button class="btn ghost" disabled style="width:100%">최고 레벨 달성</button>'}`;
  panel.classList.remove('hidden');
  panel.querySelector<HTMLElement>('[data-upgrade]')?.addEventListener('click', () => attemptUpgrade(selection, currentLevel, cost));
}

function attemptUpgrade(selection: SceneSelection, currentLevel: number, cost: { gold: number; power: number } | null): void {
  if (!snapshot || !cost) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  if (!me || me.gold < cost.gold || me.power < cost.power) { toast(`업그레이드 비용이 부족합니다. ◆ ${cost.gold} / ⚡ ${cost.power}`); return; }
  me.gold -= cost.gold;
  me.power -= cost.power;
  const room = snapshot.rooms.find((candidate) => candidate.id === selection.roomId);
  if (selection.type === 'bed' && room) room.bedLevel = currentLevel + 1;
  else if (selection.type === 'door' && room) {
    const next = buildingStats('reinforced-door', currentLevel + 1);
    room.doorLevel = currentLevel + 1;
    room.doorMaxHp = next.value;
    room.doorHp = Math.max(room.doorHp, next.value);
  }
  else {
    const building = snapshot.buildings.find((candidate) => candidate.id === selection.buildingId);
    if (building) building.level = currentLevel + 1;
  }
  network?.upgrade(selection.targetId);
  renderTargetPanel(selection);
  updateHud();
}

function refreshSelectionPanel(): void {
  if (currentView !== 'game' || app.querySelector('[data-build-panel]')?.classList.contains('hidden')) return;
  if (selectedTarget) renderTargetPanel(selectedTarget);
  else if (selectedTile) renderBuildPanel(selectedTile);
}

function closeBuildPanel(): void {
  selectedTile = null;
  selectedTarget = null;
  app.querySelector('[data-build-panel]')?.classList.add('hidden');
}

function setupJoystick(): void {
  const base = app.querySelector<HTMLElement>('[data-joystick]');
  const knob = base?.querySelector<HTMLElement>('.joystick-knob');
  if (!base || !knob) return;
  let pointerId = -1;
  const update = (event: PointerEvent): void => {
    const rect = base.getBoundingClientRect();
    const radius = rect.width * .32;
    let dx = event.clientX - (rect.left + rect.width / 2);
    let dy = event.clientY - (rect.top + rect.height / 2);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > radius) { dx = dx / magnitude * radius; dy = dy / magnitude * radius; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    inputVector = { x: dx / radius, y: dy / radius };
    sendMovement();
  };
  base.addEventListener('pointerdown', (event) => { pointerId = event.pointerId; base.setPointerCapture(pointerId); update(event); });
  base.addEventListener('pointermove', (event) => { if (event.pointerId === pointerId) update(event); });
  const release = (event: PointerEvent): void => { if (event.pointerId !== pointerId) return; pointerId = -1; knob.style.transform = ''; inputVector = { x: 0, y: 0 }; sendMovement(); };
  base.addEventListener('pointerup', release); base.addEventListener('pointercancel', release);
}

function sendMovement(): void {
  network?.move(inputVector.x, inputVector.y, ++inputSequence);
  const scene = game?.scene.getScene('game') as GameScene | undefined;
  scene?.setLocalInput(inputVector);
}

function playEvents(events: GameEvent[]): void {
  const interesting = events.find((event) => ['build', 'upgrade', 'turret-fire', 'door-hit', 'player-hit', 'ghost-level-up', 'ghost-retreat', 'ghost-return', 'ghost-skill', 'item-draw', 'elite-join', 'victory', 'defeat'].includes(event.kind));
  if (interesting) audio.play(interesting.kind);
  const elite = events.find((event) => event.kind === 'elite-join');
  if (elite?.label) showEliteEntrance(elite.label);
  const draw = events.find((event) => event.kind === 'item-draw' && event.playerId === playerId);
  if (draw?.itemId) showItemReveal(draw.itemId);
  const levelUp = events.find((event) => event.kind === 'ghost-level-up');
  if (levelUp) toast(`귀신이 문을 충분히 공격해 Lv.${levelUp.amount ?? '?'}로 성장했습니다!`);
  if (profile.vibration && events.some((event) => event.kind === 'door-hit' || event.kind === 'player-hit')) navigator.vibrate?.(35);
}

function showEliteEntrance(label: string): void {
  const existing = app.querySelector('.elite-entrance');
  existing?.remove();
  const entrance = document.createElement('div');
  entrance.className = 'elite-entrance';
  entrance.innerHTML = `<i>✦</i><strong>${escapeHtml(label)}</strong><span>ELITE SURVIVOR</span>`;
  app.appendChild(entrance);
  window.setTimeout(() => entrance.classList.add('leaving'), 2_500);
  window.setTimeout(() => entrance.remove(), 3_200);
}

function showInventory(): void {
  if (!snapshot) return;
  const me = snapshot.players.find((player) => player.id === playerId);
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  const cards = me?.items.length ? me.items.map((owned) => {
    const item = getRandomItem(owned.itemId);
    return `<article class="item-card rarity-${owned.rarity}"><strong>${escapeHtml(owned.label)}${owned.count > 1 ? ` ×${owned.count}` : ''}</strong><span>${escapeHtml(item?.description ?? '')}</span><small>${owned.rarity.toUpperCase()}</small></article>`;
  }).join('') : '<p class="subtitle">랜덤 상자를 설치하고 아이템을 뽑아보세요.</p>';
  modal.innerHTML = `<section class="panel inventory-panel"><span class="eyebrow">MATCH ITEMS · ${me?.drawCount ?? 0}/4</span><h2>이번 판 가방</h2><div class="item-grid">${cards}</div><button class="btn primary" style="width:100%" data-close>닫기</button></section>`;
  app.appendChild(modal);
  modal.querySelector('[data-close]')?.addEventListener('click', () => modal.remove());
}

function showItemReveal(itemId: string): void {
  const item = getRandomItem(itemId);
  if (!item) return;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop item-reveal';
  modal.innerHTML = `<section class="panel compact rarity-${item.rarity}" style="text-align:center"><div class="reveal-orb">🎁</div><span class="eyebrow">${item.rarity.toUpperCase()} DROP</span><h2>${escapeHtml(item.label)}</h2><p class="subtitle">${escapeHtml(item.description)}</p><button class="btn gold" style="width:100%" data-close>가방에 넣기</button></section>`;
  app.appendChild(modal);
  modal.querySelector('[data-close]')?.addEventListener('click', () => modal.remove());
}

function updateConnection(state: 'connecting' | 'connected' | 'reconnecting' | 'closed', attempt: number): void {
  const overlay = app.querySelector<HTMLElement>('[data-connection]');
  const pill = app.querySelector<HTMLElement>('[data-network]');
  if (state === 'connected') { overlay?.classList.add('hidden'); pill?.classList.remove('bad'); }
  else if (currentView === 'game') {
    overlay?.classList.remove('hidden');
    setText('[data-reconnect-copy]', state === 'reconnecting' ? `재접속 시도 ${attempt}/8 · 기존 캐릭터를 보존합니다.` : '연결이 종료되었습니다.');
    pill?.classList.add('bad');
  }
}

function connectionOverlay(text: string): void {
  setContent('connecting', `<main class="screen"><section class="panel compact" style="text-align:center"><div class="spinner"></div><h2>${escapeHtml(text)}</h2><p class="subtitle">실시간 기숙사 서버에 연결하고 있습니다.</p></section></main>`);
}

function showSettings(): void {
  audio.play('button');
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<section class="panel compact"><span class="eyebrow">SETTINGS</span><h2>게임 설정</h2><label class="setting-row"><span>효과음 음량</span><input type="range" min="0" max="1" step="0.05" value="${profile.volume}" data-volume></label><label class="setting-row"><span>진동 피드백</span><input class="toggle" type="checkbox" ${profile.vibration ? 'checked' : ''} data-vibration></label><p class="subtitle" style="margin-top:14px">실제 기기 식별 정보는 수집하지 않습니다. 브라우저에 생성한 임의 UUID만 재접속에 사용합니다.</p><button class="btn primary" style="width:100%" data-close>완료</button></section>`;
  app.appendChild(modal);
  modal.querySelector<HTMLInputElement>('[data-volume]')?.addEventListener('input', (event) => { profile.volume = Number((event.currentTarget as HTMLInputElement).value); audio.setVolume(profile.volume); saveProfile(profile); });
  modal.querySelector<HTMLInputElement>('[data-vibration]')?.addEventListener('change', (event) => { profile.vibration = (event.currentTarget as HTMLInputElement).checked; saveProfile(profile); });
  modal.querySelector('[data-close]')?.addEventListener('click', () => { audio.play('button'); modal.remove(); });
}

function toast(message: string): void {
  const element = app.querySelector<HTMLElement>('#toast');
  if (!element) return;
  element.textContent = message; element.classList.add('show');
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => element.classList.remove('show'), 2_300);
}

function setText(selector: string, value: string): void {
  const element = app.querySelector<HTMLElement>(selector); if (element) element.textContent = value;
}

function destroyGame(): void {
  window.removeEventListener('dorm:tile-selected', onTileSelected as EventListener);
  window.removeEventListener('dorm:target-selected', onTargetSelected as EventListener);
  game?.destroy(true); game = null;
}

function updateTestApi(): void {
  window.__DORM_TEST__ = {
    snapshot,
    map: mapData,
    playerId,
    move: (dx, dy) => { inputVector = { x: dx, y: dy }; sendMovement(); },
    buildFirst: (kind) => {
      if (!snapshot || !mapData || !network) return false;
      const me = snapshot.players.find((player) => player.id === playerId);
      const room = mapData.rooms.find((candidate) => candidate.id === me?.roomId);
      const tile = room?.buildTiles.find((candidate) => !snapshot?.buildings.some((building) => building.tile.x === candidate.x && building.tile.y === candidate.y));
      if (!me?.roomId || !tile) return false;
      network.build(me.roomId, tile, kind); return true;
    },
    disconnect: () => network?.close(),
  };
}

document.addEventListener('pointerdown', () => audio.unlock(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) game.loop.sleep();
  else { game.loop.wake(); network?.resync(); }
});
if ('serviceWorker' in navigator && !devMode) window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));

loading();
window.setTimeout(() => {
  const mobile = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!devMode && !mobile) desktopNotice(); else void resumeOrEnter();
}, 350);

async function resumeOrEnter(): Promise<void> {
  try {
    account = await getAccount();
    profile.nickname = account.nickname;
    saveProfile(profile);
  } catch {
    authScreen();
    return;
  }
  const code = profile.recentRoomCode;
  if (freshMode || !/^[A-Z2-9]{8}$/.test(code) || !profile.reconnectTokens[code]) {
    roomMenu();
    return;
  }
  try {
    const response = await fetch(`/api/rooms/${code}/status`);
    if (!response.ok) throw new Error('expired');
    connectToRoom(code, false);
  } catch {
    delete profile.reconnectTokens[code];
    saveProfile(profile);
    roomMenu();
  }
}
