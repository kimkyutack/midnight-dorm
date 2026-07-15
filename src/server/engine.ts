import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost } from '../shared/balance';
import { isBuildTile, isWalkable } from '../shared/map';
import { findPath } from '../shared/pathfinding';
import { combinedItemEffects, DRAW_COSTS, RANDOM_ITEMS } from '../shared/randomItems';
import { getStage, higherRank, isEliteRank, rankBenefits, rankLabel, type StageDefinition } from '../shared/progression';
import { SeededRandom, hashString } from '../shared/rng';
import type {
  BuildingKind,
  BuildingState,
  ClientMessage,
  GameEvent,
  GameSnapshot,
  GhostState,
  GhostVariant,
  JoinIdentity,
  MapDefinition,
  PlayMode,
  PlayerState,
  RankId,
  RoomState,
  Tile,
  Vec2,
} from '../shared/types';
import { BOT_REACTION_SECONDS, decideBotIntent, type BotDifficulty, type BotIntent } from './bots';

const COLORS = [0x72e6ff, 0xffca62, 0xc68cff, 0x73ec9e, 0xff7597, 0x89a7ff] as const;

interface ReconnectRecord {
  playerId: string;
  token: string;
  deviceId: string;
}

interface BotRuntime {
  difficulty: BotDifficulty;
  reaction: number;
}

export interface PersistedEngine {
  snapshot: GameSnapshot;
  reconnect: ReconnectRecord[];
  botRuntime: Array<[string, BotRuntime]>;
  testMode: boolean;
}

export interface JoinResult {
  player: PlayerState;
  reconnectToken: string;
  reconnected: boolean;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface MatchConfig {
  stageId?: string;
  playMode?: PlayMode;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, finite(value, min)));
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const normalize = (vector: Vec2): Vec2 => {
  const magnitude = Math.hypot(vector.x, vector.y);
  return magnitude > 1 ? { x: vector.x / magnitude, y: vector.y / magnitude } : vector;
};

export class GameEngine {
  readonly map: MapDefinition;
  readonly roomCode: string;
  readonly testMode: boolean;
  private readonly rng: SeededRandom;
  private readonly reconnect = new Map<string, ReconnectRecord>();
  private readonly botRuntime = new Map<string, BotRuntime>();
  private pendingEvents: GameEvent[] = [];
  private readonly retreatGuardUntil = new Map<string, number>();
  private serverSeq = 0;
  private buildCounter = 0;
  private turretSuppressedUntil = 0;
  private readonly stage: StageDefinition;
  private readonly playMode: PlayMode;
  private rematchVotes = new Set<string>();
  private state: GameSnapshot;
  lastHumanActivity = Date.now();

  constructor(roomCode: string, map: MapDefinition, testMode = false, config: MatchConfig = {}) {
    this.roomCode = roomCode;
    this.map = map;
    this.testMode = testMode;
    this.stage = getStage(config.stageId);
    this.playMode = config.playMode ?? 'multiplayer';
    this.rng = new SeededRandom(map.seed ^ hashString(roomCode));
    this.state = this.createInitialState();
  }

  private createInitialState(): GameSnapshot {
    const rooms: RoomState[] = this.map.rooms.map((room) => ({
      id: room.id,
      ownerId: null,
      doorHp: BALANCE.door.baseHp,
      doorMaxHp: BALANCE.door.baseHp,
      doorLevel: 1,
      bedLevel: 1,
      shieldUntil: 0,
    }));
    const eventRoll = this.testMode ? 0 : this.rng.next();
    const variants: GhostVariant[] = this.testMode
      ? ['wanderer']
      : eventRoll < 0.2
        ? ['twin-a', 'twin-b']
        : [eventRoll < 0.42 ? 'swift' : eventRoll < 0.64 ? 'caster' : eventRoll < 0.82 ? 'brute' : 'wanderer'];
    const ghosts = variants.map((variant, index) => this.makeGhost(variant, index));
    const eventNames: Record<GhostVariant, string> = {
      wanderer: '기본 악몽', swift: '질주하는 원혼', brute: '거구의 식귀', caster: '봉인술사',
      'twin-a': '쌍둥이 원혼', 'twin-b': '쌍둥이 원혼',
    };
    return {
      matchId: crypto.randomUUID(),
      roomCode: this.roomCode,
      status: 'LOBBY',
      hostId: null,
      seed: this.map.seed,
      serverSeq: 0,
      elapsed: 0,
      countdown: BALANCE.countdownSeconds,
      players: [],
      rooms,
      buildings: [],
      ghost: ghosts[0] as GhostState,
      ghosts,
      matchEvent: eventNames[variants[0] as GhostVariant],
      stageId: this.stage.id,
      stageLabel: this.stage.label,
      stageIndex: this.stage.index,
      playMode: this.playMode,
      goldSuppressedUntil: 0,
      repairSuppressedUntil: 0,
      winner: null,
    };
  }

  private makeGhost(variant: GhostVariant, index: number): GhostState {
    const labels: Record<GhostVariant, string> = {
      wanderer: '복도 순찰자', swift: '목 꺾인 질주귀', brute: '굶주린 거구', caster: '눈먼 봉인술사',
      'twin-a': '울보 쌍둥이', 'twin-b': '웃는 쌍둥이',
    };
    return {
      id: `nightmare-${variant}-${index + 1}`,
      position: { x: this.map.ghostSpawn.x + index * 0.8, y: this.map.ghostSpawn.y },
      hp: BALANCE.ghost.baseHp,
      maxHp: BALANCE.ghost.baseHp,
      level: 1,
      targetRoomId: null,
      attackCooldown: 0,
      slowUntil: 0,
      rage: false,
      phase: 1,
      path: [],
      displayName: labels[variant],
      variant,
      attackCount: 0,
      attacksToNextLevel: BALANCE.ghost.firstLevelAttacks,
      retreating: false,
      healing: false,
      healingElapsed: 0,
      healingStartHp: 0,
      retreatCount: 0,
      skillCooldown: variant === 'caster' ? 8 : 20,
    };
  }

  restore(data: PersistedEngine): void {
    this.state = structuredClone(data.snapshot);
    this.retreatGuardUntil.clear();
    this.state.ghosts ??= [this.state.ghost];
    this.state.matchEvent ??= '기본 악몽';
    this.state.matchId ??= crypto.randomUUID();
    this.state.stageId ??= this.stage.id;
    this.state.stageLabel ??= this.stage.label;
    this.state.stageIndex ??= this.stage.index;
    this.state.playMode ??= this.playMode;
    this.state.goldSuppressedUntil ??= 0;
    this.state.repairSuppressedUntil ??= 0;
    for (const ghost of this.state.ghosts) {
      ghost.displayName ??= '복도 순찰자';
      ghost.variant ??= 'wanderer';
      ghost.attackCount ??= 0;
      ghost.attacksToNextLevel ??= BALANCE.ghost.firstLevelAttacks;
      ghost.retreating ??= false;
      ghost.healing ??= false;
      ghost.healingElapsed ??= 0;
      ghost.healingStartHp ??= ghost.hp;
      ghost.retreatCount ??= 0;
      ghost.skillCooldown ??= 20;
    }
    for (const player of this.state.players) {
      player.accountId ??= null;
      player.soloRank ??= 'beginner';
      player.multiplayerRank ??= 'beginner';
      player.displayRank ??= higherRank(player.soloRank, player.multiplayerRank);
      player.drawCount ??= 0;
      player.items ??= [];
    }
    this.serverSeq = this.state.serverSeq;
    this.reconnect.clear();
    for (const record of data.reconnect) this.reconnect.set(record.token, record);
    this.botRuntime.clear();
    for (const [id, runtime] of data.botRuntime) this.botRuntime.set(id, runtime);
  }

  serialize(): PersistedEngine {
    return {
      snapshot: this.snapshot(),
      reconnect: [...this.reconnect.values()],
      botRuntime: [...this.botRuntime.entries()],
      testMode: this.testMode,
    };
  }

  snapshot(): GameSnapshot {
    return structuredClone({ ...this.state, serverSeq: this.serverSeq });
  }

  shouldCleanup(now = Date.now()): boolean {
    return this.state.players.every((player) => player.isBot || !player.connected)
      && now - this.lastHumanActivity >= BALANCE.inactiveCleanupMs;
  }

  drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  join(identity: JoinIdentity, now = Date.now()): JoinResult {
    const nickname = identity.nickname.trim().slice(0, 12);
    if (nickname.length < 2) throw new Error('닉네임은 2자 이상이어야 합니다.');
    if (identity.reconnectToken) {
      const record = this.reconnect.get(identity.reconnectToken);
      const player = record ? this.state.players.find((candidate) => candidate.id === record.playerId) : undefined;
      if (record && player && record.deviceId === identity.deviceId && (player.connected || player.reconnectUntil >= now)) {
        player.connected = true;
        player.reconnectUntil = 0;
        player.nickname = nickname;
        player.accountId = identity.accountId ?? player.accountId;
        player.soloRank = identity.soloRank ?? player.soloRank;
        player.multiplayerRank = identity.multiplayerRank ?? player.multiplayerRank;
        player.displayRank = higherRank(player.soloRank, player.multiplayerRank);
        this.lastHumanActivity = now;
        return { player, reconnectToken: record.token, reconnected: true };
      }
    }
    const humans = this.state.players.filter((player) => !player.isBot);
    if (humans.length >= BALANCE.maxHumanPlayers) throw new Error('이 방은 실제 플레이어 4명으로 가득 찼습니다.');
    if (this.state.status !== 'LOBBY' && this.state.status !== 'COUNTDOWN') throw new Error('진행 중인 게임에는 새로 참가할 수 없습니다.');
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const player = this.makePlayer(id, nickname, false, identity.accountId ?? null, identity.soloRank ?? 'beginner', identity.multiplayerRank ?? 'beginner');
    this.state.players.push(player);
    if (isEliteRank(player.displayRank)) {
      this.pendingEvents.push({ kind: 'elite-join', playerId: player.id, label: `${rankLabel(player.displayRank)} ${player.nickname}님이 입장했습니다!` });
    }
    this.reconnect.set(token, { playerId: id, token, deviceId: identity.deviceId });
    this.state.hostId ??= id;
    this.lastHumanActivity = now;
    return { player, reconnectToken: token, reconnected: false };
  }

  disconnect(playerId: string, now = Date.now()): void {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player || player.isBot) return;
    player.connected = false;
    player.velocity = { x: 0, y: 0 };
    player.reconnectUntil = now + BALANCE.reconnectMs;
    this.lastHumanActivity = now;
    if (this.state.hostId === playerId) {
      this.state.hostId = this.state.players.find((candidate) => !candidate.isBot && candidate.connected && candidate.id !== playerId)?.id ?? null;
    }
  }

  addBot(requesterId: string, difficulty: BotDifficulty): ActionResult {
    if (requesterId !== this.state.hostId) return { ok: false, error: '방장만 봇을 추가할 수 있습니다.' };
    if (this.state.status !== 'LOBBY') return { ok: false, error: '대기실에서만 봇을 추가할 수 있습니다.' };
    if (this.state.players.length >= BALANCE.maxPlayersWithBots) return { ok: false, error: '생존자는 최대 4명입니다.' };
    const id = `bot-${crypto.randomUUID()}`;
    const bot = this.makePlayer(id, `새벽봇 ${this.state.players.filter((player) => player.isBot).length + 1}`, true, null, 'beginner', 'beginner');
    bot.ready = true;
    this.state.players.push(bot);
    this.botRuntime.set(id, { difficulty, reaction: this.rng.next() });
    return { ok: true };
  }

  removeBot(requesterId: string, botId: string): ActionResult {
    if (requesterId !== this.state.hostId) return { ok: false, error: '방장만 봇을 제거할 수 있습니다.' };
    if (this.state.status !== 'LOBBY') return { ok: false, error: '대기실에서만 봇을 제거할 수 있습니다.' };
    const player = this.state.players.find((candidate) => candidate.id === botId && candidate.isBot);
    if (!player) return { ok: false, error: '봇을 찾을 수 없습니다.' };
    this.state.players = this.state.players.filter((candidate) => candidate.id !== botId);
    this.botRuntime.delete(botId);
    return { ok: true };
  }

  handle(playerId: string, message: ClientMessage): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) return { ok: false, error: '플레이어를 찾을 수 없습니다.' };
    if (!player.isBot) this.lastHumanActivity = Date.now();
    switch (message.type) {
      case 'ready':
        if (this.state.status !== 'LOBBY') return { ok: false, error: '준비 상태를 바꿀 수 없습니다.' };
        player.ready = message.ready;
        return { ok: true };
      case 'start':
        return this.start(playerId);
      case 'add-bot':
        return this.addBot(playerId, message.difficulty);
      case 'remove-bot':
        return this.removeBot(playerId, message.botId);
      case 'move':
        return this.setMovement(playerId, message.dx, message.dy, message.inputSequence);
      case 'interact':
        return this.interact(playerId);
      case 'build':
        return this.build(playerId, message.roomId, message.tile, message.kind);
      case 'upgrade':
        return this.upgrade(playerId, message.targetId);
      case 'draw-item':
        return this.drawItem(playerId, message.machineId);
      case 'rematch':
        return this.voteRematch(playerId);
      case 'ping':
      case 'resync':
        return { ok: true };
    }
  }

  start(playerId: string): ActionResult {
    if (this.state.hostId !== playerId) return { ok: false, error: '방장만 게임을 시작할 수 있습니다.' };
    if (this.state.status !== 'LOBBY') return { ok: false, error: '이미 게임이 시작되었습니다.' };
    if (this.state.players.length < 1) return { ok: false, error: '플레이어가 필요합니다.' };
    const unreadyHuman = this.state.players.find((player) => !player.isBot && player.id !== playerId && !player.ready);
    if (unreadyHuman) return { ok: false, error: '모든 참가자가 준비해야 합니다.' };
    this.state.status = 'COUNTDOWN';
    this.state.countdown = this.testMode ? 1.2 : BALANCE.countdownSeconds;
    return { ok: true };
  }

  setMovement(playerId: string, dx: number, dy: number, inputSequence: number): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.alive) return { ok: false, error: '이동할 수 없습니다.' };
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return { ok: false, error: '비정상 이동 입력입니다.' };
    if (inputSequence <= player.lastInputSeq) return { ok: true };
    if (player.roomId) {
      player.velocity = { x: 0, y: 0 };
      player.lastInputSeq = inputSequence;
      return { ok: true };
    }
    player.velocity = normalize({ x: dx, y: dy });
    player.lastInputSeq = inputSequence;
    return { ok: true };
  }

  interact(playerId: string): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.alive) return { ok: false, error: '상호작용할 수 없습니다.' };
    if (player.roomId) return { ok: false, error: '이미 침대를 점유했습니다.' };
    if (this.state.status !== 'COUNTDOWN' && this.state.status !== 'PLAYING') return { ok: false, error: '준비 시간이 시작된 뒤 침대를 점유할 수 있습니다.' };
    const candidate = this.map.rooms
      .filter((room) => distance(player.position, room.bed) <= BALANCE.player.interactionRange)
      .sort((a, b) => distance(player.position, a.bed) - distance(player.position, b.bed))[0];
    if (!candidate) return { ok: false, error: '침대에 더 가까이 가세요.' };
    const room = this.state.rooms.find((state) => state.id === candidate.id);
    if (!room || room.ownerId) return { ok: false, error: '이미 점유된 방입니다.' };
    room.ownerId = player.id;
    player.roomId = room.id;
    player.position = { ...candidate.bed };
    player.velocity = { x: 0, y: 0 };
    return { ok: true };
  }

  build(playerId: string, roomId: string, tile: Tile, kind: BuildingKind): ActionResult {
    if (kind === 'bed' || kind === 'reinforced-door') return { ok: false, error: '침대와 문은 기존 설비를 업그레이드하세요.' };
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const room = this.state.rooms.find((candidate) => candidate.id === roomId);
    if (!player || !player.alive || !room) return { ok: false, error: '건설할 수 없습니다.' };
    if (this.state.status !== 'COUNTDOWN' && this.state.status !== 'PLAYING') return { ok: false, error: '게임 중에만 건설할 수 있습니다.' };
    if (room.ownerId !== playerId || player.roomId !== roomId) return { ok: false, error: '자신의 방에만 건설할 수 있습니다.' };
    if (!isBuildTile(this.map, roomId, tile)) return { ok: false, error: '건설 가능한 타일이 아닙니다.' };
    if (this.state.buildings.some((building) => building.tile.x === tile.x && building.tile.y === tile.y)) return { ok: false, error: '이미 사용 중인 타일입니다.' };
    if (kind === 'lucky-machine' && this.state.buildings.some((building) => building.ownerId === playerId && building.kind === kind)) return { ok: false, error: '랜덤 상자는 방마다 하나만 설치할 수 있습니다.' };
    const benefits = rankBenefits(player.soloRank);
    if (kind === 'arc-turret' && !benefits.rareTurretUnlocked) return { ok: false, error: '희귀 천둥포는 개인 등급 베테랑부터 설치할 수 있습니다.' };
    const buildCost = upgradeCost(kind, 1, player.soloRank);
    if (player.gold < buildCost.gold || player.power < buildCost.power) return { ok: false, error: '골드 또는 전력이 부족합니다.' };
    player.gold -= buildCost.gold;
    player.power -= buildCost.power;
    const building: BuildingState = {
      id: `building-${++this.buildCounter}`,
      kind,
      roomId,
      ownerId: playerId,
      tile: { x: tile.x, y: tile.y, roomId },
      level: 1,
      cooldown: 0,
      hp: 100,
    };
    this.state.buildings.push(building);
    this.pendingEvents.push({ kind: 'build', position: tile, playerId });
    return { ok: true };
  }

  upgrade(playerId: string, targetId: string): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.alive || !player.roomId) return { ok: false, error: '업그레이드할 수 없습니다.' };
    if (targetId.startsWith('bed:') || targetId.startsWith('door:')) {
      const [target, roomId] = targetId.split(':');
      const room = this.state.rooms.find((candidate) => candidate.id === roomId);
      if (!room || room.ownerId !== playerId || room.id !== player.roomId) return { ok: false, error: '자신의 설비만 업그레이드할 수 있습니다.' };
      const kind: BuildingKind = target === 'bed' ? 'bed' : 'reinforced-door';
      const level = kind === 'bed' ? room.bedLevel : room.doorLevel;
      if (kind === 'reinforced-door' && room.doorHp <= 0) return { ok: false, error: '파괴된 문은 업그레이드할 수 없습니다.' };
      if (level >= maxBuildingLevel(kind, player.soloRank)) return { ok: false, error: '이미 최고 단계입니다.' };
      const cost = upgradeCost(kind, level + 1, player.soloRank);
      if (player.gold < cost.gold || player.power < cost.power) return { ok: false, error: '골드 또는 전력이 부족합니다.' };
      player.gold -= cost.gold;
      player.power -= cost.power;
      if (kind === 'bed') room.bedLevel += 1;
      else {
        room.doorLevel += 1;
        room.doorMaxHp = BALANCE.door.upgradeHp[room.doorLevel - 1] as number;
        room.doorHp = room.doorMaxHp;
      }
      this.pendingEvents.push({ kind: 'upgrade', roomId: room.id, playerId });
      return { ok: true };
    }
    const building = this.state.buildings.find((candidate) => candidate.id === targetId);
    if (!building || building.ownerId !== playerId || building.roomId !== player.roomId) return { ok: false, error: '자신의 건물만 업그레이드할 수 있습니다.' };
    if (building.level >= maxBuildingLevel(building.kind, player.soloRank)) return { ok: false, error: '이미 최고 단계입니다.' };
    const cost = upgradeCost(building.kind, building.level + 1, player.soloRank);
    if (player.gold < cost.gold || player.power < cost.power) return { ok: false, error: '골드 또는 전력이 부족합니다.' };
    player.gold -= cost.gold;
    player.power -= cost.power;
    building.level += 1;
    this.pendingEvents.push({ kind: 'upgrade', position: building.tile, playerId });
    return { ok: true };
  }

  drawItem(playerId: string, machineId: string): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const machine = this.state.buildings.find((candidate) => candidate.id === machineId && candidate.kind === 'lucky-machine');
    if (!player || !player.alive || !machine || machine.ownerId !== playerId || machine.roomId !== player.roomId) return { ok: false, error: '자신의 랜덤 상자를 선택하세요.' };
    if (this.state.status !== 'PLAYING') return { ok: false, error: '게임이 시작된 뒤 뽑을 수 있습니다.' };
    const cost = DRAW_COSTS[player.drawCount];
    if (!cost) return { ok: false, error: '이번 판의 랜덤 뽑기 4회를 모두 사용했습니다.' };
    if (player.gold < cost.gold || player.power < cost.power) return { ok: false, error: `뽑기 비용이 부족합니다. 골드 ${cost.gold}, 전력 ${cost.power}` };
    player.gold -= cost.gold;
    player.power -= cost.power;
    player.drawCount += 1;
    const totalWeight = RANDOM_ITEMS.reduce((sum, item) => sum + item.weight, 0);
    let roll = this.rng.next() * totalWeight;
    const item = RANDOM_ITEMS.find((candidate) => (roll -= candidate.weight) <= 0) ?? RANDOM_ITEMS[RANDOM_ITEMS.length - 1];
    if (!item) return { ok: false, error: '아이템 목록을 불러오지 못했습니다.' };
    const owned = player.items.find((candidate) => candidate.itemId === item.id);
    if (owned) owned.count += 1;
    else player.items.push({ itemId: item.id, label: item.label, rarity: item.rarity, count: 1 });
    if (item.effect.doorHpMultiplier && player.roomId) {
      const room = this.state.rooms.find((candidate) => candidate.id === player.roomId);
      if (room) {
        const gained = room.doorMaxHp * (item.effect.doorHpMultiplier - 1);
        room.doorMaxHp += gained;
        if (room.doorHp > 0) room.doorHp += gained;
      }
    }
    this.pendingEvents.push({ kind: 'item-draw', playerId, itemId: item.id, label: item.label, rarity: item.rarity, position: machine.tile });
    return { ok: true };
  }

  tick(realDt: number, now = Date.now()): void {
    const dt = clamp(realDt, 0, 0.1) * (this.testMode ? 4 : 1);
    this.serverSeq += 1;
    this.expireDisconnected(now);
    this.updatePlayers(dt);
    this.updateBots(dt);
    if (this.state.status === 'COUNTDOWN') {
      this.updateEconomy(dt);
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown <= 0) this.beginPlaying();
    } else if (this.state.status === 'PLAYING') {
      this.state.elapsed += dt;
      this.updateEconomy(dt);
      this.updateBuildings(dt);
      this.updateGhosts(dt);
      this.evaluateOutcome();
    }
    this.sanitizeResources();
  }

  private beginPlaying(): void {
    this.state.status = 'PLAYING';
    const combatants = Math.max(1, this.state.players.filter((player) => player.alive).length);
    const maxHp = BALANCE.ghost.baseHp * (1 + BALANCE.ghost.hpPerPlayer * (combatants - 1));
    for (const ghost of this.state.ghosts) {
      const variantHp = ghost.variant === 'brute' ? 1.45 : ghost.variant.startsWith('twin') ? 0.68 : ghost.variant === 'swift' ? 0.84 : 1;
      ghost.maxHp = (this.testMode ? maxHp * 0.34 : maxHp) * variantHp * this.stage.hpMultiplier;
      ghost.hp = ghost.maxHp;
      ghost.position = { ...this.map.ghostSpawn };
    }
    this.syncPrimaryGhost();
    for (const player of this.state.players.filter((candidate) => !candidate.roomId)) {
      const available = this.state.rooms.find((room) => !room.ownerId);
      if (available) {
        available.ownerId = player.id;
        player.roomId = available.id;
        const mapRoom = this.map.rooms.find((room) => room.id === available.id);
        if (mapRoom) player.position = { ...mapRoom.bed };
      }
    }
  }

  private updatePlayers(dt: number): void {
    if (this.state.status !== 'COUNTDOWN' && this.state.status !== 'PLAYING') return;
    for (const player of this.state.players) {
      if (!player.alive) continue;
      if (player.roomId) {
        const bed = this.map.rooms.find((room) => room.id === player.roomId)?.bed;
        if (bed) player.position = { ...bed };
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      const speed = BALANCE.player.speed * rankBenefits(player.soloRank).speedMultiplier * combinedItemEffects(player.items).moveSpeedMultiplier;
      const nextX = player.position.x + player.velocity.x * speed * dt;
      const nextY = player.position.y + player.velocity.y * speed * dt;
      if (isWalkable(this.map, nextX, player.position.y)) player.position.x = nextX;
      if (isWalkable(this.map, player.position.x, nextY)) player.position.y = nextY;
    }
  }

  private updateBots(dt: number): void {
    for (const bot of this.state.players.filter((player) => player.isBot)) {
      const runtime = this.botRuntime.get(bot.id);
      if (!runtime) continue;
      if (!bot.roomId) {
        this.applyBotIntent(bot.id, decideBotIntent(bot, this.state, this.map, runtime.difficulty));
        continue;
      }
      runtime.reaction -= dt;
      if (runtime.reaction > 0) continue;
      runtime.reaction = BOT_REACTION_SECONDS[runtime.difficulty] * (0.8 + this.rng.next() * 0.45);
      const intent = decideBotIntent(bot, this.state, this.map, runtime.difficulty);
      this.applyBotIntent(bot.id, intent);
    }
  }

  private applyBotIntent(botId: string, intent: BotIntent): void {
    if (intent.type === 'move') this.setMovement(botId, intent.dx, intent.dy, this.serverSeq);
    else {
      const bot = this.state.players.find((player) => player.id === botId);
      if (bot) bot.velocity = { x: 0, y: 0 };
      if (intent.type === 'interact') this.interact(botId);
      else if (intent.type === 'build') this.build(botId, intent.roomId, intent.tile, intent.kind);
      else if (intent.type === 'upgrade') this.upgrade(botId, intent.targetId);
    }
  }

  private updateEconomy(dt: number): void {
    for (const player of this.state.players) {
      if (!player.alive || !player.roomId) continue;
      const room = this.state.rooms.find((candidate) => candidate.id === player.roomId);
      if (!room) continue;
      const mapRoom = this.map.rooms.find((candidate) => candidate.id === player.roomId);
      const effects = combinedItemEffects(player.items);
      const goldBefore = player.gold;
      const income = this.state.elapsed < this.state.goldSuppressedUntil ? 0 : (buildingStats('bed', room.bedLevel).value + effects.goldPerSecond) * dt;
      player.gold += income;
      const goldGained = Math.floor(player.gold) - Math.floor(goldBefore);
      if (goldGained > 0) this.pendingEvents.push({ kind: 'gold', playerId: player.id, amount: goldGained, position: mapRoom ? { ...mapRoom.bed } : undefined });
      const generators = this.state.buildings.filter((building) => building.ownerId === player.id && building.kind === 'generator');
      const powerBefore = player.power;
      for (const generator of generators) {
        player.power += buildingStats('generator', generator.level).value * dt;
      }
      player.power += effects.powerPerSecond * dt;
      const powerGained = Math.floor(player.power) - Math.floor(powerBefore);
      if (powerGained > 0) this.pendingEvents.push({
        kind: 'power', playerId: player.id, amount: powerGained,
        position: generators[0] ? { ...generators[0].tile } : mapRoom ? { ...mapRoom.bed } : undefined,
      });
      if (room.doorHp > 0 && this.state.elapsed >= this.state.repairSuppressedUntil) room.doorHp = Math.min(room.doorMaxHp, room.doorHp + effects.doorRepairPerSecond * dt);
    }
  }

  private updateBuildings(dt: number): void {
    for (const building of this.state.buildings) {
      building.cooldown -= dt;
      const stats = buildingStats(building.kind, building.level);
      const room = this.state.rooms.find((candidate) => candidate.id === building.roomId);
      const owner = this.state.players.find((candidate) => candidate.id === building.ownerId);
      const effects = combinedItemEffects(owner?.items ?? []);
      if (building.kind === 'repair-drone' && room && room.doorHp > 0 && this.state.elapsed >= this.state.repairSuppressedUntil) room.doorHp = Math.min(room.doorMaxHp, room.doorHp + stats.value * dt);
      const nearest = this.state.ghosts
        .filter((ghost) => ghost.hp > 0 && !ghost.healing)
        .sort((a, b) => distance(a.position, building.tile) - distance(b.position, building.tile))[0];
      if (building.kind === 'shield-device' && room && this.state.ghosts.some((ghost) => ghost.targetRoomId === room.id) && nearest && distance(nearest.position, building.tile) < 7 && building.cooldown <= 0) {
        room.shieldUntil = this.state.elapsed + stats.rate;
        building.cooldown = stats.rate + 8;
      }
      if (building.kind === 'floor-trap') {
        for (const ghost of this.state.ghosts.filter((candidate) => candidate.hp > 0 && distance(candidate.position, building.tile) <= stats.range)) {
          ghost.slowUntil = Math.max(ghost.slowUntil, this.state.elapsed + 0.5);
        }
      }
      const offensive = ['basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret', 'electric-coil'].includes(building.kind);
      const range = stats.range + effects.turretRangeBonus;
      if (!offensive || !nearest || distance(nearest.position, building.tile) > range || building.cooldown > 0) continue;
      const suppression = this.state.elapsed < this.turretSuppressedUntil ? 1.65 : 1;
      building.cooldown = stats.rate * suppression * effects.turretRateMultiplier;
      const damage = stats.value * effects.turretDamageMultiplier;
      const appliedDamage = this.applyGhostDamage(nearest, damage);
      if (building.kind === 'frost-turret') nearest.slowUntil = Math.max(nearest.slowUntil, this.state.elapsed + 1);
      this.pendingEvents.push({
        kind: 'turret-fire', position: building.tile, targetPosition: { ...nearest.position }, targetId: nearest.id,
        buildingKind: building.kind, amount: appliedDamage,
      });
      if (appliedDamage > 0) this.pendingEvents.push({ kind: 'ghost-hit', position: { ...nearest.position }, targetId: nearest.id, amount: appliedDamage });
    }
  }

  private applyGhostDamage(ghost: GhostState, damage: number): number {
    // 리스폰 지점의 7초 회복은 보장한다. 후퇴 중에는 계속 포탑 피해를 받아 처치될 수 있다.
    if (ghost.healing) return 0;
    if (this.state.elapsed < (this.retreatGuardUntil.get(ghost.id) ?? 0)) return 0;
    const before = ghost.hp;
    // 도망치는 동안은 방어선의 집중 사격에 노출되어, 충분한 화력이 있으면 회복 전에 처치할 수 있다.
    const appliedDamage = damage * (ghost.retreating ? BALANCE.ghost.retreatDamageMultiplier : 1);
    const next = Math.max(0, before - appliedDamage);
    const crossesRetreatLine = !ghost.retreating && !ghost.healing
      && before / ghost.maxHp > BALANCE.ghost.retreatThreshold
      && next / ghost.maxHp <= BALANCE.ghost.retreatThreshold;
    if (crossesRetreatLine) {
      ghost.hp = Math.max(1, next);
      ghost.retreating = true;
      ghost.retreatCount += 1;
      ghost.targetRoomId = null;
      ghost.path = [];
      this.retreatGuardUntil.set(ghost.id, this.state.elapsed + 0.35);
      this.pendingEvents.push({ kind: 'ghost-retreat', position: { ...ghost.position }, targetId: ghost.id });
    } else ghost.hp = next;
    return Math.max(0, before - ghost.hp);
  }

  private updateGhosts(dt: number): void {
    for (const ghost of this.state.ghosts) this.updateGhost(ghost, dt);
    this.syncPrimaryGhost();
  }

  private updateGhost(ghost: GhostState, dt: number): void {
    if (ghost.hp <= 0) return;
    ghost.phase = ghost.level;
    ghost.rage = ghost.level >= 5 || ghost.hp / ghost.maxHp <= 0.3;
    ghost.skillCooldown -= dt;

    if (!ghost.retreating && !ghost.healing && ghost.hp / ghost.maxHp <= BALANCE.ghost.retreatThreshold) {
      ghost.retreating = true;
      ghost.retreatCount += 1;
      ghost.targetRoomId = null;
      ghost.path = [];
      this.pendingEvents.push({ kind: 'ghost-retreat', position: { ...ghost.position }, targetId: ghost.id });
    }
    if (ghost.retreating) {
      if (distance(ghost.position, this.map.ghostSpawn) > 0.5) this.moveGhostToward(ghost, this.map.ghostSpawn, dt);
      else {
        ghost.retreating = false;
        ghost.healing = true;
        ghost.healingElapsed = 0;
        ghost.healingStartHp = ghost.hp;
        ghost.path = [];
      }
      return;
    }
    if (ghost.healing) {
      ghost.healingElapsed = Math.min(BALANCE.ghost.healDurationSeconds, ghost.healingElapsed + dt);
      const recoveryProgress = ghost.healingElapsed / BALANCE.ghost.healDurationSeconds;
      ghost.hp = ghost.healingStartHp + (ghost.maxHp - ghost.healingStartHp) * recoveryProgress;
      if (recoveryProgress >= 1 - 1e-9) {
        ghost.hp = ghost.maxHp;
        ghost.healing = false;
        ghost.healingElapsed = 0;
        ghost.healingStartHp = ghost.hp;
        ghost.targetRoomId = this.selectGhostTarget(ghost);
        this.pendingEvents.push({ kind: 'ghost-return', position: { ...ghost.position }, targetId: ghost.id });
      }
      return;
    }

    if (ghost.skillCooldown <= 0) {
      if (this.stage.skills.length > 0) this.useStageSkill(ghost);
      else if (ghost.variant === 'caster') {
        this.turretSuppressedUntil = this.state.elapsed + 5;
        ghost.skillCooldown = Math.max(12, 25 - ghost.level);
        this.pendingEvents.push({ kind: 'ghost-skill', position: { ...ghost.position }, targetId: ghost.id, label: '포탑 침묵 5초' });
      } else ghost.skillCooldown = 20;
    }
    if (!ghost.targetRoomId) {
      ghost.targetRoomId = this.selectGhostTarget(ghost);
      ghost.path = [];
    }
    const room = this.state.rooms.find((candidate) => candidate.id === ghost.targetRoomId);
    const mapRoom = this.map.rooms.find((candidate) => candidate.id === ghost.targetRoomId);
    if (!room || !mapRoom) {
      ghost.targetRoomId = null;
      return;
    }
    const targetPlayer = this.state.players.find((player) => player.id === room.ownerId && player.alive);
    const destination = room.doorHp > 0 ? mapRoom.door : targetPlayer?.position ?? mapRoom.bed;
    if (distance(ghost.position, destination) > 0.72) {
      this.moveGhostToward(ghost, destination, dt);
      return;
    }
    ghost.attackCooldown -= dt;
    if (ghost.attackCooldown > 0) return;
    const combatants = Math.max(1, this.state.players.filter((player) => player.alive).length);
    // 쌍둥이 둘의 합산 문 피해가 일반 귀신 한 마리와 같도록 정확히 절반씩 나눈다.
    const variantDamage = ghost.variant === 'brute' ? 1.3 : ghost.variant.startsWith('twin') ? 0.5 : 1;
    const damageScale = (1 + BALANCE.ghost.damagePerPlayer * (combatants - 1)
      + (ghost.level - 1) * (BALANCE.ghost.damageGrowthPerLevel + this.stage.levelDamageGrowth))
      * variantDamage * this.stage.damageMultiplier;
    ghost.attackCooldown = BALANCE.ghost.attackInterval / (ghost.rage ? 1.5 : 1);
    if (room.doorHp > 0) {
      const rawShieldReduction = this.state.elapsed < room.shieldUntil
        ? this.state.buildings.filter((building) => building.roomId === room.id && building.kind === 'shield-device')
            .reduce((best, building) => Math.max(best, buildingStats(building.kind, building.level).value), 0)
        : 0;
      const shieldReduction = rawShieldReduction * Math.max(0.15, 1 - (ghost.level - 1) * BALANCE.ghost.shieldPenetrationPerLevel);
      const damage = BALANCE.ghost.baseDamage * damageScale * (1 - shieldReduction);
      room.doorHp = Math.max(0, room.doorHp - damage);
      ghost.attackCount += 1;
      this.pendingEvents.push({ kind: 'door-hit', position: mapRoom.door, roomId: room.id, targetId: ghost.id, amount: damage });
      if (ghost.attackCount >= ghost.attacksToNextLevel) this.levelUpGhost(ghost);
    } else if (targetPlayer) {
      const damage = targetPlayer.hp;
      targetPlayer.hp = 0;
      this.pendingEvents.push({ kind: 'player-hit', position: targetPlayer.position, playerId: targetPlayer.id, targetId: ghost.id, amount: damage });
      targetPlayer.alive = false;
      targetPlayer.spectator = true;
      targetPlayer.velocity = { x: 0, y: 0 };
      this.pendingEvents.push({ kind: 'death', position: targetPlayer.position, playerId: targetPlayer.id });
      ghost.targetRoomId = null;
    }
  }

  private levelUpGhost(ghost: GhostState): void {
    const previousMax = ghost.maxHp;
    ghost.level += 1;
    ghost.phase = ghost.level;
    ghost.attackCount = 0;
    ghost.attacksToNextLevel += BALANCE.ghost.attacksAddedPerLevel + ghost.level - 1;
    ghost.maxHp = Math.round(ghost.maxHp * (1 + this.stage.levelHpGrowth));
    ghost.hp += ghost.maxHp - previousMax;
    this.pendingEvents.push({ kind: 'ghost-level-up', position: { ...ghost.position }, targetId: ghost.id, amount: ghost.level });
  }

  private useStageSkill(ghost: GhostState): void {
    const skill = this.stage.skills[this.rng.int(0, this.stage.skills.length - 1)];
    let label = '';
    if (skill === 'turret-jam') {
      this.turretSuppressedUntil = this.state.elapsed + 3;
      label = '포탑 무효화 3초';
    } else if (skill === 'gold-lock') {
      this.state.goldSuppressedUntil = this.state.elapsed + 5;
      label = '골드 획득 봉인 5초';
    } else if (skill === 'repair-lock') {
      this.state.repairSuppressedUntil = this.state.elapsed + 5;
      label = '문 수리 봉인 5초';
    } else if (skill === 'door-crush') {
      const room = this.state.rooms.find((candidate) => candidate.id === ghost.targetRoomId);
      if (room?.doorHp) room.doorHp = Math.max(0, room.doorHp - room.doorMaxHp * 0.08);
      label = '문 내구도 8% 파쇄';
    }
    ghost.skillCooldown = Math.max(7, this.stage.skillInterval - Math.min(5, ghost.level));
    this.pendingEvents.push({ kind: 'ghost-skill', position: { ...ghost.position }, targetId: ghost.id, label });
  }

  private moveGhostToward(ghost: GhostState, destination: Vec2, dt: number): void {
    if (ghost.path.length === 0 || this.serverSeq % 20 === 0) {
      ghost.path = findPath(this.map, ghost.position, destination);
      const start = ghost.path[0];
      if (start && start.x === Math.round(ghost.position.x) && start.y === Math.round(ghost.position.y)) ghost.path.shift();
    }
    while (ghost.path.length > 0 && distance(ghost.position, ghost.path[0] as Tile) < 0.3) ghost.path.shift();
    const next = ghost.path[0] ?? destination;
    const direction = normalize({ x: next.x - ghost.position.x, y: next.y - ghost.position.y });
    const variantSpeed = ghost.variant === 'swift' ? 1.65 : ghost.variant === 'brute' ? 0.78 : ghost.variant.startsWith('twin') ? 1.15 : 1;
    const slowed = this.state.elapsed < ghost.slowUntil;
    const slowMultiplier = slowed ? (ghost.retreating ? 0.9 : 0.76) : 1;
    let speed = BALANCE.ghost.speed * this.stage.speedMultiplier * variantSpeed * (ghost.rage ? 1.32 : 1) * slowMultiplier;
    if (ghost.retreating) speed *= 1.12;
    const nextPosition = { x: ghost.position.x + direction.x * speed * dt, y: ghost.position.y + direction.y * speed * dt };
    if (isWalkable(this.map, nextPosition.x, ghost.position.y)) ghost.position.x = nextPosition.x;
    if (isWalkable(this.map, ghost.position.x, nextPosition.y)) ghost.position.y = nextPosition.y;
  }

  private selectGhostTarget(ghost: GhostState): string | null {
    const candidates = this.state.rooms.filter((room) => {
      const owner = this.state.players.find((player) => player.id === room.ownerId);
      return owner?.alive;
    });
    if (candidates.length === 0) return null;
    const scored = candidates.map((room) => {
      const owner = this.state.players.find((player) => player.id === room.ownerId) as PlayerState;
      const mapRoom = this.map.rooms.find((candidate) => candidate.id === room.id);
      const doorWeakness = 1 - room.doorHp / Math.max(1, room.doorMaxHp);
      const growth = owner.gold / 500 + this.state.buildings.filter((building) => building.roomId === room.id).length * 0.25;
      const routeLength = mapRoom ? findPath(this.map, ghost.position, mapRoom.door).length : Number.POSITIVE_INFINITY;
      const score = -routeLength * 0.24 + doorWeakness * 2 + growth * 0.2 + this.rng.next() * 0.2;
      return { id: room.id, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.id ?? null;
  }

  private syncPrimaryGhost(): void {
    this.state.ghost = this.state.ghosts.find((ghost) => ghost.hp > 0) ?? this.state.ghosts[0] as GhostState;
  }

  private evaluateOutcome(): void {
    if (this.state.ghosts.every((ghost) => ghost.hp <= 0)) {
      this.state.status = 'VICTORY';
      this.state.winner = 'survivors';
      this.pendingEvents.push({ kind: 'victory', position: this.state.ghosts[0]?.position ?? this.map.ghostSpawn });
      return;
    }
    if (this.state.players.length > 0 && this.state.players.every((player) => !player.alive)) {
      this.state.status = 'DEFEAT';
      this.state.winner = 'ghost';
      this.pendingEvents.push({ kind: 'defeat', position: this.state.ghost.position });
    }
  }

  private voteRematch(playerId: string): ActionResult {
    if (this.state.status !== 'VICTORY' && this.state.status !== 'DEFEAT') return { ok: false, error: '결과 화면에서만 재대결할 수 있습니다.' };
    this.rematchVotes.add(playerId);
    const humans = this.state.players.filter((player) => !player.isBot && player.connected);
    if (humans.every((player) => this.rematchVotes.has(player.id))) this.resetForRematch();
    return { ok: true };
  }

  private resetForRematch(): void {
    const hostId = this.state.hostId;
    const players = this.state.players.map((player) => ({
      ...this.makePlayer(player.id, player.nickname, player.isBot, player.accountId, player.soloRank, player.multiplayerRank),
      connected: player.connected,
      ready: player.isBot,
    }));
    this.state = this.createInitialState();
    this.state.players = players;
    this.state.hostId = hostId;
    this.rematchVotes.clear();
  }

  private expireDisconnected(now: number): void {
    if (this.state.status === 'LOBBY') {
      const expired = this.state.players.filter((player) => !player.isBot && !player.connected && player.reconnectUntil > 0 && player.reconnectUntil < now);
      for (const player of expired) {
        this.state.players = this.state.players.filter((candidate) => candidate.id !== player.id);
        if (this.state.hostId === player.id) this.state.hostId = this.state.players.find((candidate) => !candidate.isBot && candidate.connected)?.id ?? null;
      }
    }
  }

  private sanitizeResources(): void {
    for (const player of this.state.players) {
      player.gold = clamp(player.gold, 0, 999_999);
      player.power = clamp(player.power, 0, 999_999);
      player.hp = clamp(player.hp, 0, player.maxHp);
    }
    for (const room of this.state.rooms) room.doorHp = clamp(room.doorHp, 0, room.doorMaxHp);
    for (const ghost of this.state.ghosts) ghost.hp = clamp(ghost.hp, 0, ghost.maxHp);
    this.syncPrimaryGhost();
  }

  private makePlayer(id: string, nickname: string, isBot: boolean, accountId: string | null, soloRank: RankId, multiplayerRank: RankId): PlayerState {
    const benefits = rankBenefits(soloRank);
    return {
      id,
      accountId,
      nickname,
      soloRank,
      multiplayerRank,
      displayRank: higherRank(soloRank, multiplayerRank),
      color: COLORS[this.state.players.length % COLORS.length] as number,
      isBot,
      connected: true,
      ready: isBot,
      alive: true,
      spectator: false,
      position: { ...this.map.playerSpawn },
      velocity: { x: 0, y: 0 },
      hp: BALANCE.player.maxHp,
      maxHp: BALANCE.player.maxHp,
      gold: BALANCE.player.startingGold + benefits.startingGoldBonus,
      power: BALANCE.player.startingPower + benefits.startingPowerBonus,
      roomId: null,
      lastInputSeq: 0,
      reconnectUntil: 0,
      score: 0,
      drawCount: 0,
      items: [],
    };
  }
}
