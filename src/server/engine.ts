import {
  BALANCE,
  buildingStats,
  maxBuildingLevel,
  upgradeCost,
  upgradeRequirement,
} from "../shared/balance";
import {
  botAppearance,
  DEFAULT_APPEARANCE,
  DEFAULT_TURRET_SKINS,
  normalizeAppearance,
  normalizeTurretSkins,
} from "../shared/customization";
import {
  characterTraitForAppearance,
  drawLimitForAppearance,
} from "../shared/characterTraits";
import { turretSkinTrait } from "../shared/turretSkinTraits";
import { fullRoomFloorKeys, isBuildTile, moveInWalkableArea } from "../shared/map";
import { findPath } from "../shared/pathfinding";
import {
  combinedItemEffects,
  DRAW_COSTS,
  RANDOM_ITEMS,
} from "../shared/randomItems";
import {
  difficultyRuleForStage,
  getStage,
  higherRank,
  isEliteRank,
  rankBenefits,
  rankLabel,
  timeAttackChanceForStage,
  type StageDefinition,
} from "../shared/progression";
import { SeededRandom, hashString } from "../shared/rng";
import type {
  BuildingKind,
  BuildingState,
  ClientMessage,
  ConsumableId,
  GameEvent,
  GameSnapshot,
  GhostState,
  GhostVariant,
  JoinIdentity,
  MapDefinition,
  PlayMode,
  PlayerState,
  ProfileDisplayMode,
  RankId,
  RankedMatchState,
  RankedTier,
  RoomState,
  Tile,
  TurretKind,
  Vec2,
} from "../shared/types";
import { shopConsumableById } from "../shared/shopConsumables";
import {
  BOT_REACTION_SECONDS,
  decideBotIntent,
  type BotBedTarget,
  type BotDifficulty,
  type BotIntent,
} from "./bots";

const COLORS = [
  0x72e6ff, 0xffca62, 0xc68cff, 0x73ec9e, 0xff7597, 0x89a7ff,
] as const;
const RANKED_TIERS = new Set<RankedTier>(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'challenger']);

const normalizeProfileDisplayMode = (value: unknown): ProfileDisplayMode =>
  value === 'multiplayer' || value === 'ranked' ? value : 'solo';
const normalizeProfileRankedTier = (value: unknown): RankedTier =>
  typeof value === 'string' && RANKED_TIERS.has(value as RankedTier)
    ? value as RankedTier
    : 'bronze';
const normalizeProfileRankedRating = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1_000_000, Math.floor(value)))
    : 800;

const LIVE_BUILD_KINDS = new Set<BuildingKind>([
  'basic-turret',
  'golden-turret',
  'frost-turret',
  'generator',
  'repair-drone',
  'electric-coil',
  'shield-device',
  'lucky-machine',
  'gem-core',
  'ghost-net',
  'range-amplifier',
]);

const SUPPLY_SPEED_SECONDS: Partial<Record<ConsumableId, number>> = {
  'adrenal-shot': 4,
  'sprint-candy': 6,
};
const SUPPLY_STEALTH_SECONDS: Partial<Record<ConsumableId, number>> = {
  'quiet-slippers': 6,
  'mist-cape': 8,
};
const SUPPLY_BEDROLL_SECONDS: Partial<Record<ConsumableId, number>> = {
  'emergency-bedroll': 8,
  'rescue-whistle': 12,
};
const SUPPLY_DOOR_HEAL: Partial<Record<ConsumableId, number>> = {
  'quick-mortar': 70,
  'patch-paste': 120,
};
const SUPPLY_DOOR_BRACE_SECONDS: Partial<Record<ConsumableId, number>> = {
  'hinge-brace': 15,
  'steel-rivet': 20,
};
const SUPPLY_DOOR_WARD_SECONDS: Partial<Record<ConsumableId, number>> = {
  'ward-seal': 3,
  'ice-seal': 5,
};
const SUPPLY_REGEN_RESET = new Set<ConsumableId>(['repair-window', 'rewind-clock']);
const SUPPLY_BUILD_DISCOUNT: Partial<Record<ConsumableId, number>> = {
  'toolbelt-voucher': 0.35,
  'calibrator-key': 0.15,
  'turret-grease': 0.25,
  'pulse-solder': 0.3,
  'spare-gears': 0.32,
  'copper-coil': 0.38,
  'lens-kit': 0.4,
  'welding-gel': 0.45,
  'blueprint-chip': 0.5,
  'field-crane': 0.6,
};

interface ReconnectRecord {
  playerId: string;
  token: string;
  deviceId: string;
}

interface BotRuntime {
  difficulty: BotDifficulty;
  reaction: number;
  bedTarget: BotBedTarget | null;
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
  removedPlayerId?: string;
  newHostId?: string | null;
  roomEmpty?: boolean;
}

export interface MatchConfig {
  stageId?: string;
  playMode?: PlayMode;
  /** Ranked contracts provide a deterministic modifier and shared loadout rules. */
  ranked?: RankedMatchState | null;
}

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, finite(value, min)));
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const normalize = (vector: Vec2): Vec2 => {
  const magnitude = Math.hypot(vector.x, vector.y);
  return magnitude > 1
    ? { x: vector.x / magnitude, y: vector.y / magnitude }
    : vector;
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
  private readonly ranked: RankedMatchState | null;
  private rematchVotes = new Set<string>();
  private state: GameSnapshot;
  lastHumanActivity = Date.now();

  constructor(
    roomCode: string,
    map: MapDefinition,
    testMode = false,
    config: MatchConfig = {},
  ) {
    this.roomCode = roomCode;
    this.map = map;
    this.testMode = testMode;
    this.stage = getStage(config.stageId);
    this.playMode = config.playMode ?? map.playMode;
    this.ranked = config.ranked ?? null;
    this.rng = new SeededRandom(map.seed ^ hashString(roomCode));
    this.state = this.createInitialState();
  }

  private createInitialState(): GameSnapshot {
    const rooms: RoomState[] = this.map.rooms.map((room) => ({
      id: room.id,
      ownerId: null,
      ownerIds: [],
      doorHp: BALANCE.door.baseHp,
      doorMaxHp: BALANCE.door.baseHp,
      doorLevel: 1,
      bedLevel: 1,
      bedLevels: room.beds.map(() => 1),
      shieldUntil: 0,
      beaconUntil: 0,
      doorBraceUntil: 0,
      doorWardUntil: 0,
      lastLatchArmedBy: null,
      lastLatchUntil: 0,
      lastDoorHitAt: -1_000_000,
      doorRegenAccumulator: -1,
    }));
    const timeAttack = this.ranked
      ? this.ranked.modifier === 'time-attack'
      : !this.testMode && this.rng.next() < timeAttackChanceForStage(this.stage);
    const difficulty = difficultyRuleForStage(this.stage, timeAttack);
    const eventRoll = this.testMode ? 0 : this.rng.next();
    const variants: GhostVariant[] = this.testMode
      ? ["wanderer"]
      : eventRoll < 0.14
        ? ["twin-a", "twin-b"]
        : [
            eventRoll < 0.28
              ? "swift"
              : eventRoll < 0.4
                ? "caster"
                : eventRoll < 0.52
                  ? "brute"
                  : eventRoll < 0.68
                    ? "teleporter"
                    : eventRoll < 0.84
                      ? "undead"
                      : eventRoll < 0.94
                        ? "giant"
                        : "wanderer",
          ];
    const ghosts = variants.map((variant, index) =>
      this.makeGhost(variant, index),
    );
    for (const ghost of ghosts) ghost.barrierLayers = difficulty.barrierLayers;
    const starterKinds: readonly BuildingKind[] = [
      "generator",
      "starter-grave",
      "basic-turret",
    ];
    // 시뮬레이션 회귀 테스트는 기존 빈 방 전제를 유지한다. 실제 매치에서는
    // 각 방에 하나씩 휴면 설비를 배치하고 첫 점유 전까지 작동시키지 않는다.
    const starterBuildings: BuildingState[] = this.testMode
      ? []
      : this.map.rooms.flatMap((room, index) => {
          const tile = [...room.buildTiles].sort(
            (a, b) => distance(b, room.door) - distance(a, room.door),
          )[0];
          const kind = starterKinds[index % starterKinds.length] as BuildingKind;
          return tile
            ? [{
                id: `starter:${room.id}`,
                kind,
                roomId: room.id,
                ownerId: "",
                skinId: "",
                tile: { ...tile, roomId: room.id },
                level: 1,
                cooldown: 0,
                hp: 100,
                investedGold: 0,
                investedPower: 0,
                investmentByPlayer: {},
              }]
            : [];
        });
    const eventNames: Record<GhostVariant, string> = {
      wanderer: "기본 악몽",
      swift: "질주하는 원혼",
      brute: "거구의 식귀",
      caster: "봉인술사",
      "twin-a": "쌍둥이 원혼",
      "twin-b": "쌍둥이 원혼",
      teleporter: "문을 바꾸는 도약귀",
      undead: "미니미를 부르는 언데드",
      giant: "묵직한 거대 귀신",
      minion: "언데드 미니미",
    };
    return {
      matchId: crypto.randomUUID(),
      roomCode: this.roomCode,
      status: "LOBBY",
      hostId: null,
      seed: this.map.seed,
      serverSeq: 0,
      elapsed: 0,
      countdown: BALANCE.countdownSeconds,
      players: [],
      rooms,
      buildings: starterBuildings,
      ghost: ghosts[0] as GhostState,
      ghosts,
      matchEvent: eventNames[variants[0] as GhostVariant],
      stageId: this.stage.id,
      stageLabel: this.stage.label,
      stageIndex: this.stage.index,
      playMode: this.playMode,
      difficulty,
      ranked: this.ranked,
      goldSuppressedUntil: 0,
      repairSuppressedUntil: 0,
      winner: null,
    };
  }

  private makeGhost(variant: GhostVariant, index: number): GhostState {
    const labels: Record<GhostVariant, string> = {
      wanderer: "복도 순찰자",
      swift: "목 꺾인 질주귀",
      brute: "굶주린 거구",
      caster: "눈먼 봉인술사",
      "twin-a": "울보 쌍둥이",
      "twin-b": "웃는 쌍둥이",
      teleporter: "문틈 도약귀",
      undead: "무덤의 산모",
      giant: "천장 닿는 거인",
      minion: "썩은 미니미",
    };
    return {
      id: `nightmare-${variant}-${index + 1}`,
      position: {
        x: this.map.ghostSpawn.x + index * 0.8,
        y: this.map.ghostSpawn.y,
      },
      hp: BALANCE.ghost.baseHp,
      maxHp: BALANCE.ghost.baseHp,
      level: 1,
      targetRoomId: null,
      targetPlayerId: null,
      attackCooldown: 0,
      slowUntil: 0,
      stunnedUntil: 0,
      slowMultiplier: 1,
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
      skillCooldown: variant === "caster" ? 8 : 20,
      abilityCooldown:
        variant === "teleporter" ? 12 : variant === "undead" ? 10 : 20,
      controlResolve: 0,
      controlImmuneUntil: 0,
      netTriggeredTargetRoomId: null,
      barrierLayers: 0,
      mistUntil: 0,
      shieldCrossfireUntil: 0,
      shieldCrossfireRoomId: null,
      directionalShieldDisabledUntil: 0,
    };
  }

  restore(data: PersistedEngine): void {
    this.state = structuredClone(data.snapshot);
    this.retreatGuardUntil.clear();
    this.state.ghosts ??= [this.state.ghost];
    this.state.matchEvent ??= "기본 악몽";
    this.state.matchId ??= crypto.randomUUID();
    this.state.stageId ??= this.stage.id;
    this.state.stageLabel ??= this.stage.label;
    this.state.stageIndex ??= this.stage.index;
    this.state.playMode ??= this.playMode;
    this.state.difficulty ??= difficultyRuleForStage(this.stage, false);
    this.state.ranked ??= this.ranked;
    this.state.goldSuppressedUntil ??= 0;
    this.state.repairSuppressedUntil ??= 0;
    for (const ghost of this.state.ghosts) {
      ghost.displayName ??= "복도 순찰자";
      ghost.variant ??= "wanderer";
      ghost.targetPlayerId ??= null;
      ghost.slowMultiplier ??= 1;
      ghost.stunnedUntil ??= 0;
      ghost.attackCount ??= 0;
      ghost.attacksToNextLevel ??= BALANCE.ghost.firstLevelAttacks;
      ghost.retreating ??= false;
      ghost.healing ??= false;
      ghost.healingElapsed ??= 0;
      ghost.healingStartHp ??= ghost.hp;
      ghost.retreatCount ??= 0;
      ghost.skillCooldown ??= 20;
      ghost.abilityCooldown ??=
        ghost.variant === "teleporter"
          ? 12
          : ghost.variant === "undead"
            ? 10
            : 20;
      ghost.controlResolve ??= 0;
      ghost.controlImmuneUntil ??= 0;
      ghost.netTriggeredTargetRoomId ??= null;
      ghost.barrierLayers ??= this.state.difficulty.barrierLayers;
      ghost.mistUntil ??= 0;
      ghost.shieldCrossfireUntil ??= 0;
      ghost.shieldCrossfireRoomId ??= null;
      ghost.directionalShieldDisabledUntil ??= 0;
    }
    for (const player of this.state.players) {
      player.accountId ??= null;
      player.soloRank ??= "beginner";
      player.multiplayerRank ??= "beginner";
      player.displayRank ??= higherRank(
        player.soloRank,
        player.multiplayerRank,
      );
      player.profileDisplayMode = normalizeProfileDisplayMode(player.profileDisplayMode);
      player.profileRankedTier = normalizeProfileRankedTier(player.profileRankedTier);
      player.profileRankedRating = normalizeProfileRankedRating(player.profileRankedRating);
      player.appearance = normalizeAppearance(player.appearance);
      player.turretSkins = normalizeTurretSkins(player.turretSkins);
      player.bedIndex ??= null;
      player.goldIncomeElapsed = Math.max(0, finite(player.goldIncomeElapsed, 0));
      player.powerIncomeElapsed = Math.max(0, finite(player.powerIncomeElapsed, 0));
      player.drawCount ??= 0;
      player.firstGuardianBuilt ??= false;
      player.items ??= [];
      player.consumables ??= [];
      player.consumableLoadout ??= [];
      player.usedConsumables ??= [];
      player.speedBoostUntil ??= 0;
      player.stealthUntil ??= 0;
      player.bedrollUntil ??= 0;
      player.upgradeDiscountTargetId ??= null;
      player.upgradeDiscountRate ??= 0;
    }
    for (const room of this.state.rooms) {
      room.ownerIds ??= room.ownerId ? [room.ownerId] : [];
      const mapRoom = this.map.rooms.find(
        (candidate) => candidate.id === room.id,
      );
      room.bedLevels ??= (mapRoom?.beds ?? [mapRoom?.bed])
        .filter(Boolean)
        .map((_, index) => (index === 0 ? room.bedLevel : 1));
      room.bedLevel = room.bedLevels[0] ?? room.bedLevel ?? 1;
      room.ownerId = room.ownerIds[0] ?? room.ownerId ?? null;
      room.beaconUntil ??= 0;
      room.doorBraceUntil ??= 0;
      room.doorWardUntil ??= 0;
      room.lastLatchArmedBy ??= null;
      room.lastLatchUntil ??= 0;
      room.lastDoorHitAt = finite(room.lastDoorHitAt, -1_000_000);
      room.doorRegenAccumulator = finite(room.doorRegenAccumulator, -1);
    }
    for (const building of this.state.buildings) {
      building.skinId ??=
        DEFAULT_TURRET_SKINS[
          building.kind as keyof typeof DEFAULT_TURRET_SKINS
        ] ?? "";
      const owner = this.state.players.find(
        (player) => player.id === building.ownerId,
      );
      const activeRank =
        this.playMode === "solo" ? owner?.soloRank : owner?.multiplayerRank;
      const fallback = this.investmentThroughLevel(
        building.kind,
        building.level,
        activeRank ?? "beginner",
      );
      building.investedGold ??= fallback.gold;
      building.investedPower ??= fallback.power;
      building.investmentByPlayer ??= {
        [building.ownerId]: {
          gold: building.investedGold,
          power: building.investedPower,
        },
      };
    }
    this.serverSeq = this.state.serverSeq;
    this.reconnect.clear();
    for (const record of data.reconnect)
      this.reconnect.set(record.token, record);
    this.botRuntime.clear();
    for (const [id, runtime] of data.botRuntime)
      this.botRuntime.set(id, { ...runtime, bedTarget: runtime.bedTarget ?? null });
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
    return (
      this.state.players.every((player) => player.isBot || !player.connected) &&
      now - this.lastHumanActivity >= BALANCE.inactiveCleanupMs
    );
  }

  drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  join(identity: JoinIdentity, now = Date.now()): JoinResult {
    const nickname = identity.nickname.trim().slice(0, 12);
    if (nickname.length < 2) throw new Error("닉네임은 2자 이상이어야 합니다.");
    if (identity.reconnectToken) {
      const record = this.reconnect.get(identity.reconnectToken);
      const player = record
        ? this.state.players.find(
            (candidate) => candidate.id === record.playerId,
          )
        : undefined;
      if (
        record &&
        player &&
        record.deviceId === identity.deviceId &&
        (player.connected || player.reconnectUntil >= now)
      ) {
        player.connected = true;
        player.reconnectUntil = 0;
        player.nickname = nickname;
        player.accountId = identity.accountId ?? player.accountId;
        player.soloRank = identity.soloRank ?? player.soloRank;
        player.multiplayerRank =
          identity.multiplayerRank ?? player.multiplayerRank;
        player.displayRank = higherRank(
          player.soloRank,
          player.multiplayerRank,
        );
        player.profileDisplayMode = normalizeProfileDisplayMode(identity.profileDisplayMode);
        player.profileRankedTier = normalizeProfileRankedTier(identity.profileRankedTier);
        player.profileRankedRating = normalizeProfileRankedRating(identity.profileRankedRating);
        player.appearance = normalizeAppearance(
          identity.appearance ?? player.appearance,
        );
        player.turretSkins = normalizeTurretSkins(
          identity.turretSkins ?? player.turretSkins,
        );
        // Loaned ranked supplies are room-owned.  A reconnect must never
        // replace the remaining loaned stack with the account's inventory.
        if (this.state.ranked?.supplyPolicy !== 'loaned') {
          player.consumables = (identity.consumables ?? player.consumables)
            .filter((item) => shopConsumableById(item.itemId) && Number.isInteger(item.quantity) && item.quantity > 0)
            .map((item) => ({ itemId: item.itemId, quantity: item.quantity }));
          player.consumableLoadout = player.consumableLoadout.filter((itemId) =>
            player.consumables.some((owned) => owned.itemId === itemId && owned.quantity > 0),
          );
        }
        this.lastHumanActivity = now;
        return { player, reconnectToken: record.token, reconnected: true };
      }
    }
    const humans = this.state.players.filter((player) => !player.isBot);
    if (humans.length >= BALANCE.maxHumanPlayers)
      throw new Error("이 방은 실제 플레이어 4명으로 가득 찼습니다.");
    if (this.state.status !== "LOBBY" && this.state.status !== "COUNTDOWN")
      throw new Error("진행 중인 게임에는 새로 참가할 수 없습니다.");
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const player = this.makePlayer(
      id,
      nickname,
      false,
      identity.accountId ?? null,
      identity.soloRank ?? "beginner",
      identity.multiplayerRank ?? "beginner",
      identity.appearance,
      identity.turretSkins,
      identity.consumables,
      identity.profileDisplayMode,
      identity.profileRankedTier,
      identity.profileRankedRating,
    );
    this.state.players.push(player);
    if (isEliteRank(player.displayRank)) {
      this.pendingEvents.push({
        kind: "elite-join",
        playerId: player.id,
        label: `${rankLabel(player.displayRank)} ${player.nickname}님이 입장했습니다!`,
      });
    }
    this.reconnect.set(token, {
      playerId: id,
      token,
      deviceId: identity.deviceId,
    });
    this.state.hostId ??= id;
    this.lastHumanActivity = now;
    return { player, reconnectToken: token, reconnected: false };
  }

  /** Gives every participant the same room-scoped supplies for a loan contract. */
  grantRankedLoanedSupplies(playerId: string, itemIds: ConsumableId[]): void {
    if (this.state.ranked?.supplyPolicy !== 'loaned' || this.state.status !== 'LOBBY') return;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) return;
    const loadout = [...new Set(itemIds)]
      .filter((itemId) => Boolean(shopConsumableById(itemId)))
      .slice(0, 3);
    player.consumables = loadout.map((itemId) => ({ itemId, quantity: 1 }));
    player.consumableLoadout = [...loadout];
  }

  disconnect(playerId: string, now = Date.now()): void {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player || player.isBot) return;
    player.connected = false;
    player.velocity = { x: 0, y: 0 };
    player.reconnectUntil = now + BALANCE.reconnectMs;
    this.lastHumanActivity = now;
    if (this.state.hostId === playerId) {
      this.state.hostId =
        this.state.players.find(
          (candidate) =>
            !candidate.isBot &&
            candidate.connected &&
            candidate.id !== playerId,
        )?.id ?? null;
    }
  }

  addBot(requesterId: string, difficulty: BotDifficulty): ActionResult {
    if (requesterId !== this.state.hostId)
      return { ok: false, error: "방장만 봇을 추가할 수 있습니다." };
    if (this.state.status !== "LOBBY")
      return { ok: false, error: "대기실에서만 봇을 추가할 수 있습니다." };
    if (this.state.players.length >= BALANCE.maxPlayersWithBots)
      return { ok: false, error: "생존자는 최대 4명입니다." };
    const id = `bot-${crypto.randomUUID()}`;
    const botIndex = this.state.players.filter((player) => player.isBot).length;
    const bot = this.makePlayer(
      id,
      `새벽봇 ${botIndex + 1}`,
      true,
      null,
      "beginner",
      "beginner",
      botAppearance(botIndex),
    );
    bot.ready = true;
    this.state.players.push(bot);
    this.botRuntime.set(id, { difficulty, reaction: this.rng.next(), bedTarget: null });
    return { ok: true };
  }

  removeBot(requesterId: string, botId: string): ActionResult {
    if (requesterId !== this.state.hostId)
      return { ok: false, error: "방장만 봇을 제거할 수 있습니다." };
    if (this.state.status !== "LOBBY")
      return { ok: false, error: "대기실에서만 봇을 제거할 수 있습니다." };
    const player = this.state.players.find(
      (candidate) => candidate.id === botId && candidate.isBot,
    );
    if (!player) return { ok: false, error: "봇을 찾을 수 없습니다." };
    this.state.players = this.state.players.filter(
      (candidate) => candidate.id !== botId,
    );
    this.botRuntime.delete(botId);
    return { ok: true };
  }

  leaveLobby(playerId: string): ActionResult {
    if (this.state.status !== "LOBBY")
      return { ok: false, error: "대기실에서만 방을 나갈 수 있습니다." };
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId && !candidate.isBot,
    );
    if (!player) return { ok: false, error: "플레이어를 찾을 수 없습니다." };
    return this.removeLobbyPlayer(playerId);
  }

  kickPlayer(requesterId: string, targetId: string): ActionResult {
    if (requesterId !== this.state.hostId)
      return { ok: false, error: "방장만 플레이어를 추방할 수 있습니다." };
    if (this.state.status !== "LOBBY")
      return {
        ok: false,
        error: "대기실에서만 플레이어를 추방할 수 있습니다.",
      };
    if (requesterId === targetId)
      return { ok: false, error: "자신은 방 나가기를 이용하세요." };
    const target = this.state.players.find(
      (candidate) => candidate.id === targetId && !candidate.isBot,
    );
    if (!target)
      return { ok: false, error: "추방할 플레이어를 찾을 수 없습니다." };
    return this.removeLobbyPlayer(targetId);
  }

  private removeLobbyPlayer(playerId: string): ActionResult {
    this.state.players = this.state.players.filter(
      (candidate) => candidate.id !== playerId,
    );
    for (const [token, record] of this.reconnect) {
      if (record.playerId === playerId) this.reconnect.delete(token);
    }
    for (const room of this.state.rooms) {
      room.ownerIds = room.ownerIds.filter((ownerId) => ownerId !== playerId);
      room.ownerId = room.ownerIds[0] ?? null;
    }
    const humans = this.state.players.filter((candidate) => !candidate.isBot);
    if (humans.length === 0) {
      this.state.players = [];
      this.state.hostId = null;
      this.botRuntime.clear();
      return {
        ok: true,
        removedPlayerId: playerId,
        newHostId: null,
        roomEmpty: true,
      };
    }
    if (
      this.state.hostId === playerId ||
      !this.state.players.some(
        (candidate) => candidate.id === this.state.hostId,
      )
    ) {
      this.state.hostId =
        humans.find((candidate) => candidate.connected)?.id ??
        humans[0]?.id ??
        null;
    }
    this.lastHumanActivity = Date.now();
    return {
      ok: true,
      removedPlayerId: playerId,
      newHostId: this.state.hostId,
      roomEmpty: false,
    };
  }

  handle(playerId: string, message: ClientMessage): ActionResult {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player) return { ok: false, error: "플레이어를 찾을 수 없습니다." };
    if (!player.isBot) this.lastHumanActivity = Date.now();
    switch (message.type) {
      case "ready":
        if (this.state.status !== "LOBBY")
          return { ok: false, error: "준비 상태를 바꿀 수 없습니다." };
        player.ready = message.ready;
        return { ok: true };
      case "start":
        return this.start(playerId);
      case "add-bot":
        return this.addBot(playerId, message.difficulty);
      case "remove-bot":
        return this.removeBot(playerId, message.botId);
      case "leave-room":
        return this.leaveLobby(playerId);
      case "kick-player":
        return this.kickPlayer(playerId, message.playerId);
      case "move":
        return this.setMovement(
          playerId,
          message.dx,
          message.dy,
          message.inputSequence,
        );
      case "interact":
        return this.interact(playerId);
      case "build":
        return this.build(playerId, message.roomId, message.tile, message.kind);
      case "move-building":
        return this.moveBuilding(playerId, message.buildingId, message.tile);
      case "upgrade":
        return this.upgrade(playerId, message.targetId);
      case "remove-building":
        return this.removeBuilding(playerId, message.buildingId);
      case "draw-item":
        return this.drawItem(playerId, message.machineId);
      case "set-consumable-loadout":
        return this.setConsumableLoadout(playerId, message.itemIds);
      case "use-consumable":
        return this.useConsumable(playerId, message);
      case "rematch":
        return this.voteRematch(playerId);
      case "ping":
      case "resync":
        return { ok: true };
    }
  }

  start(playerId: string, bypassReadyCheck = false): ActionResult {
    if (this.state.hostId !== playerId)
      return { ok: false, error: "방장만 게임을 시작할 수 있습니다." };
    if (this.state.status !== "LOBBY")
      return { ok: false, error: "이미 게임이 시작되었습니다." };
    if (this.state.players.length < 1)
      return { ok: false, error: "플레이어가 필요합니다." };
    const unreadyHuman = this.state.players.find(
      (player) => !player.isBot && player.id !== playerId && !player.ready,
    );
    if (unreadyHuman && !bypassReadyCheck)
      return { ok: false, error: "모든 참가자가 준비해야 합니다." };
    this.state.status = this.state.difficulty.modifier === 'time-attack'
      ? 'EVENT_INTRO'
      : 'COUNTDOWN';
    this.state.countdown = this.countdownSecondsForMatch();
    this.state.difficulty.introRemaining = this.state.status === 'EVENT_INTRO' ? 2 : 0;
    return { ok: true };
  }

  /**
   * Browser E2E matches normally compress a no-bot preparation phase so the
   * suite can reach combat quickly.  A solo match is different: the bots must
   * visibly traverse the same corridors and claim beds before combat starts.
   * Keep its simulated 30-second preparation phase while preserving the
   * accelerated no-bot fixture used by the rest of the test suite.
   */
  private countdownSecondsForMatch(): number {
    return this.testMode && this.botRuntime.size === 0
      ? 1.2
      : BALANCE.countdownSeconds;
  }

  setConsumableLoadout(playerId: string, itemIds: ConsumableId[]): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (!player) return { ok: false, error: '플레이어를 찾을 수 없습니다.' };
    if (this.state.status !== 'LOBBY') return { ok: false, error: '보급품은 대기실에서만 선택할 수 있습니다.' };
    const unique = [...new Set(itemIds)];
    if (unique.length !== itemIds.length || unique.length > 3) return { ok: false, error: '서로 다른 보급품을 최대 3종 선택할 수 있습니다.' };
    if (!unique.every((itemId) => player.consumables.some((owned) => owned.itemId === itemId && owned.quantity > 0))) {
      return { ok: false, error: '보유하지 않은 보급품은 장착할 수 없습니다.' };
    }
    player.consumableLoadout = unique;
    return { ok: true };
  }

  validateConsumableUse(
    playerId: string,
    message: Extract<ClientMessage, { type: 'use-consumable' }>,
  ): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const item = shopConsumableById(message.itemId);
    if (!player || !item || !player.alive) return { ok: false, error: '전술 보급을 사용할 수 없습니다.' };
    if (this.state.ranked?.supplyPolicy === 'disabled') return { ok: false, error: '이 랭크 계약에서는 개인 전투 보급품을 사용할 수 없습니다.' };
    if (this.state.status !== 'PLAYING' && this.state.status !== 'OVERTIME') return { ok: false, error: '전술 보급은 귀신이 움직인 뒤 사용할 수 있습니다.' };
    if (!player.consumableLoadout.includes(item.id)) return { ok: false, error: '대기실에서 선택한 보급품만 사용할 수 있습니다.' };
    if (player.usedConsumables.includes(item.id)) return { ok: false, error: '이 보급품은 이번 판에 이미 사용했습니다.' };
    if (!player.consumables.some((owned) => owned.itemId === item.id && owned.quantity > 0)) return { ok: false, error: '보급 재고가 없습니다.' };

    const ownedRoom = player.roomId
      ? this.state.rooms.find((room) => room.id === player.roomId)
      : undefined;
    if (item.target === 'self') {
      const outsideOnly = Boolean(
        SUPPLY_SPEED_SECONDS[item.id] ||
        SUPPLY_STEALTH_SECONDS[item.id] ||
        SUPPLY_BEDROLL_SECONDS[item.id],
      );
      if (outsideOnly && player.roomId) {
        return { ok: false, error: '복도에 있을 때만 사용할 수 있습니다.' };
      }
      return { ok: true };
    }
    if (item.target === 'tile') {
      const tile = message.tile;
      const corridor = tile && this.map.corridorTiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y);
      if (!tile || !corridor || distance(player.position, tile) > 8) return { ok: false, error: '8칸 안의 복도 타일을 선택하세요.' };
      return { ok: true };
    }
    if (!ownedRoom) return { ok: false, error: '방을 점유한 뒤 사용할 수 있습니다.' };
    if (item.target === 'room' || item.target === 'door') {
      if (message.roomId && message.roomId !== ownedRoom.id) return { ok: false, error: '자신이 점유한 방에만 사용할 수 있습니다.' };
      if (item.target === 'door' && ownedRoom.doorHp <= 0) return { ok: false, error: '파괴된 문에는 사용할 수 없습니다.' };
      if (item.id === 'last-latch' && ownedRoom.lastLatchArmedBy) return { ok: false, error: '이 문의 최후의 걸쇠는 이미 장착되어 있습니다.' };
      return { ok: true };
    }
    const building = this.state.buildings.find((candidate) => candidate.id === message.targetId);
    if (!building || building.roomId !== ownedRoom.id) return { ok: false, error: '같은 방의 설비를 선택하세요.' };
    return { ok: true };
  }

  useConsumable(
    playerId: string,
    message: Extract<ClientMessage, { type: 'use-consumable' }>,
  ): ActionResult {
    const validation = this.validateConsumableUse(playerId, message);
    if (!validation.ok) return validation;
    const player = this.state.players.find((candidate) => candidate.id === playerId) as PlayerState;
    const item = shopConsumableById(message.itemId)!;
    const owned = player.consumables.find((candidate) => candidate.itemId === item.id)!;
    const room = player.roomId ? this.state.rooms.find((candidate) => candidate.id === player.roomId) : undefined;

    if (item.id === 'scout-flare' || item.id === 'echo-lens') {
      // 귀신 위치는 서버 스냅샷으로 이미 동기화한다. 효과 시간은 클라이언트가
      // 이 이벤트를 받아 강조 링과 이동 경로 힌트를 그리는 데 사용한다.
    } else if (item.id === 'path-chalk' || item.id === 'moon-compass') {
      // 현재 맵·빈 침대 정보는 스냅샷에 있으므로 클라이언트가 즉시 경로를 표시한다.
    } else if (SUPPLY_SPEED_SECONDS[item.id]) {
      if (player.roomId) return { ok: false, error: '침대를 점유한 뒤에는 사용할 수 없습니다.' };
      player.speedBoostUntil = this.state.elapsed + (SUPPLY_SPEED_SECONDS[item.id] as number);
    } else if (SUPPLY_STEALTH_SECONDS[item.id]) {
      if (player.roomId) return { ok: false, error: '복도에 있을 때만 사용할 수 있습니다.' };
      player.stealthUntil = this.state.elapsed + (SUPPLY_STEALTH_SECONDS[item.id] as number);
    } else if (item.id === 'room-beacon' && room) {
      room.beaconUntil = this.state.elapsed + 10;
    } else if (SUPPLY_DOOR_HEAL[item.id] && room) {
      room.doorHp = Math.min(room.doorMaxHp, room.doorHp + (SUPPLY_DOOR_HEAL[item.id] as number));
    } else if (SUPPLY_DOOR_BRACE_SECONDS[item.id] && room) {
      room.doorBraceUntil = this.state.elapsed + (SUPPLY_DOOR_BRACE_SECONDS[item.id] as number);
    } else if (SUPPLY_DOOR_WARD_SECONDS[item.id] && room) {
      room.doorWardUntil = this.state.elapsed + (SUPPLY_DOOR_WARD_SECONDS[item.id] as number);
    } else if (SUPPLY_REGEN_RESET.has(item.id) && room) {
      room.lastDoorHitAt = this.state.elapsed - BALANCE.door.passiveRegenDelaySeconds;
      room.doorRegenAccumulator = -1;
    } else if (item.id === 'last-latch' && room) {
      if (room.lastLatchArmedBy) return { ok: false, error: '이 문의 최후의 걸쇠는 이미 장착되어 있습니다.' };
      room.lastLatchArmedBy = player.id;
    } else if (SUPPLY_BEDROLL_SECONDS[item.id]) {
      if (player.roomId) return { ok: false, error: '침대를 점유한 뒤에는 사용할 수 없습니다.' };
      player.bedrollUntil = this.state.elapsed + (SUPPLY_BEDROLL_SECONDS[item.id] as number);
    } else if (SUPPLY_BUILD_DISCOUNT[item.id]) {
      const building = this.state.buildings.find((candidate) => candidate.id === message.targetId);
      if (!building) return { ok: false, error: '설비를 찾을 수 없습니다.' };
      player.upgradeDiscountTargetId = building.id;
      player.upgradeDiscountRate = SUPPLY_BUILD_DISCOUNT[item.id] as number;
    }

    owned.quantity -= 1;
    if (owned.quantity <= 0) player.consumables = player.consumables.filter((candidate) => candidate !== owned);
    player.usedConsumables.push(item.id);
    this.pendingEvents.push({
      kind: 'consumable-use',
      playerId,
      roomId: room?.id,
      itemId: item.id,
      label: item.label,
      position: message.tile ?? (room ? this.map.rooms.find((candidate) => candidate.id === room.id)?.door : player.position),
    });
    return { ok: true };
  }

  setMovement(
    playerId: string,
    dx: number,
    dy: number,
    inputSequence: number,
  ): ActionResult {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player || !player.alive)
      return { ok: false, error: "이동할 수 없습니다." };
    if (
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      Math.abs(dx) > 1 ||
      Math.abs(dy) > 1
    )
      return { ok: false, error: "비정상 이동 입력입니다." };
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
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player || !player.alive)
      return { ok: false, error: "상호작용할 수 없습니다." };
    if (player.roomId) return { ok: false, error: "이미 침대를 점유했습니다." };
    if (this.state.status !== "COUNTDOWN" && this.state.status !== "PLAYING" && this.state.status !== 'OVERTIME')
      return {
        ok: false,
        error: "준비 시간이 시작된 뒤 침대를 점유할 수 있습니다.",
      };
    const roomCapacity = this.playMode === "multiplayer" ? 2 : 1;
    const candidate = this.map.rooms
      .flatMap((mapRoom) => {
        const room = this.state.rooms.find((state) => state.id === mapRoom.id);
        if (!room) return [];
        return mapRoom.beds
          .map((bed, bedIndex) => ({ mapRoom, room, bed, bedIndex }))
          .filter(
            ({ room: roomState, bedIndex }) =>
              roomState.ownerIds.length < roomCapacity &&
              !roomState.ownerIds.some((ownerId) => {
                const owner = this.state.players.find(
                  (candidatePlayer) => candidatePlayer.id === ownerId,
                );
                return owner?.bedIndex === bedIndex;
              }),
          );
      })
      .filter(
        ({ bed }) =>
          distance(player.position, bed) <=
          (this.state.elapsed < player.bedrollUntil
            ? 1.5
            : BALANCE.player.interactionRange),
      )
      .sort(
        (a, b) =>
          distance(player.position, a.bed) - distance(player.position, b.bed),
      )[0];
    if (!candidate)
      return {
        ok: false,
        error:
          this.playMode === "multiplayer"
            ? "비어 있는 2인 방의 침대에 더 가까이 가세요."
            : "다른 생존자가 점유하지 않은 방의 침대에 더 가까이 가세요.",
      };
    const firstOccupant = candidate.room.ownerIds.length === 0;
    candidate.room.ownerIds.push(player.id);
    candidate.room.ownerId ??= player.id;
    player.roomId = candidate.room.id;
    player.bedIndex = candidate.bedIndex;
    player.goldIncomeElapsed = 0;
    player.powerIncomeElapsed = 0;
    player.position = { ...candidate.bed };
    player.velocity = { x: 0, y: 0 };
    const occupancyTrait = characterTraitForAppearance(player.appearance);
    const grantedDoorLevel = Math.min(
      maxBuildingLevel('reinforced-door'),
      1 + occupancyTrait.occupiedDoorLevelBonus,
    );
    if (grantedDoorLevel > candidate.room.doorLevel) {
      candidate.room.doorLevel = grantedDoorLevel;
      candidate.room.doorMaxHp = BALANCE.door.upgradeHp[grantedDoorLevel - 1] as number;
      candidate.room.doorHp = candidate.room.doorMaxHp;
      const occupiedMapRoom = this.map.rooms.find(
        (room) => room.id === candidate.room.id,
      );
      this.pendingEvents.push({
        kind: 'upgrade',
        roomId: candidate.room.id,
        playerId,
        position: occupiedMapRoom?.door,
        label: `${BALANCE.buildings['reinforced-door'].label} Lv.${grantedDoorLevel}`,
      });
    }
    if (firstOccupant) {
      for (const building of this.state.buildings) {
        if (building.roomId === candidate.room.id && !building.ownerId) {
          building.ownerId = player.id;
        }
      }
    }
    return { ok: true };
  }

  build(
    playerId: string,
    roomId: string,
    tile: Tile,
    kind: BuildingKind,
  ): ActionResult {
    if (kind === "starter-grave")
      return { ok: false, error: "잠든 무덤은 방 기본 설비로만 배치됩니다." };
    if (kind === "bed" || kind === "reinforced-door")
      return { ok: false, error: "침대와 문은 기존 설비를 업그레이드하세요." };
    if (!LIVE_BUILD_KINDS.has(kind))
      return { ok: false, error: "현재는 수호 포탑과 방어 설비만 설치할 수 있습니다." };
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    const room = this.state.rooms.find((candidate) => candidate.id === roomId);
    if (!player || !player.alive || !room)
      return { ok: false, error: "건설할 수 없습니다." };
    if (this.state.status !== "COUNTDOWN" && this.state.status !== "PLAYING" && this.state.status !== 'OVERTIME')
      return { ok: false, error: "게임 중에만 건설할 수 있습니다." };
    if (!room.ownerIds.includes(playerId) || player.roomId !== roomId)
      return { ok: false, error: "자신이 머무는 방에만 건설할 수 있습니다." };
    if (!isBuildTile(this.map, roomId, tile))
      return { ok: false, error: "건설 가능한 타일이 아닙니다." };
    if (
      this.state.buildings.some(
        (building) => building.tile.x === tile.x && building.tile.y === tile.y,
      )
    )
      return { ok: false, error: "이미 사용 중인 타일입니다." };
    if (
      kind === "lucky-machine" &&
      this.state.buildings.some(
        (building) => building.ownerId === playerId && building.kind === kind,
      )
    )
      return {
        ok: false,
        error: "랜덤 상자는 방마다 하나만 설치할 수 있습니다.",
      };
    if (
      kind === "range-amplifier" &&
      this.state.buildings.some(
        (building) => building.ownerId === playerId && building.kind === kind,
      )
    )
      return {
        ok: false,
        error: "사거리 증폭기는 철거 전까지 하나만 설치할 수 있습니다.",
      };
    if (
      kind === "ghost-net" &&
      this.state.buildings.some(
        (building) => building.roomId === roomId && building.kind === kind,
      )
    )
      return {
        ok: false,
        error: "봉쇄 그물 발사기는 방마다 하나만 설치할 수 있습니다.",
      };
    const activeRank =
      this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
    if (kind === "golden-turret") {
      const ticketCount = combinedItemEffects(player.items).goldenTurretTickets;
      const installedCount = this.state.buildings.filter(
        (building) =>
          building.ownerId === playerId && building.kind === "golden-turret",
      ).length;
      const rankedPolicy = this.state.ranked?.goldenTurretPolicy;
      if (rankedPolicy === 'disabled')
        return { ok: false, error: '이 랭크 계약에서는 황금 심판 포탑을 사용할 수 없습니다.' };
      const allowedCount = rankedPolicy === 'loaned' ? 1 : ticketCount;
      if (installedCount >= allowedCount && rankedPolicy !== 'loaned') {
        return {
          ok: false,
          error: '수호 포탑 외 공격 포탑인 황금 심판 포탑은 황금 티켓 1장당 한 대만 설치할 수 있습니다.',
        };
      }
      if (installedCount >= allowedCount)
        return {
          ok: false,
          error: rankedPolicy === 'loaned'
            ? '이 계약에서는 대여 황금 심판 포탑을 한 대만 설치할 수 있습니다.'
            : "황금 티켓 1장당 황금 심판 포탑은 한 대만 설치할 수 있습니다.",
        };
    }
    const buildCost = upgradeCost(kind, 1, activeRank);
    if (player.gold < buildCost.gold || player.power < buildCost.power)
      return { ok: false, error: "골드 또는 전력이 부족합니다." };
    const trait = characterTraitForAppearance(player.appearance);
    const isFirstGuardian = kind === 'basic-turret' && !player.firstGuardianBuilt;
    const initialLevel = isFirstGuardian
      ? Math.min(
          maxBuildingLevel(kind, activeRank),
          1 + trait.firstGuardianLevelBonus,
        )
      : 1;
    player.gold -= buildCost.gold;
    player.power -= buildCost.power;
    const building: BuildingState = {
      id: `building-${++this.buildCounter}`,
      kind,
      roomId,
      ownerId: playerId,
      skinId: DEFAULT_TURRET_SKINS[kind as TurretKind]
        ? player.turretSkins[kind as TurretKind]
        : "",
      tile: { x: tile.x, y: tile.y, roomId },
      level: initialLevel,
      cooldown: 0,
      hp: 100,
      investedGold: buildCost.gold,
      investedPower: buildCost.power,
      investmentByPlayer: {
        [playerId]: { gold: buildCost.gold, power: buildCost.power },
      },
    };
    this.state.buildings.push(building);
    if (isFirstGuardian) player.firstGuardianBuilt = true;
    this.pendingEvents.push({ kind: "build", position: tile, playerId });
    return { ok: true };
  }

  upgrade(playerId: string, targetId: string): ActionResult {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player || !player.alive || !player.roomId)
      return { ok: false, error: "업그레이드할 수 없습니다." };
    if (targetId.startsWith("bed:") || targetId.startsWith("door:")) {
      const [target, roomId, rawBedIndex] = targetId.split(":");
      const room = this.state.rooms.find(
        (candidate) => candidate.id === roomId,
      );
      if (
        !room ||
        !room.ownerIds.includes(playerId) ||
        room.id !== player.roomId
      )
        return {
          ok: false,
          error: "같은 방의 설비만 업그레이드할 수 있습니다.",
        };
      const kind: BuildingKind = target === "bed" ? "bed" : "reinforced-door";
      const bedIndex =
        kind === "bed" ? Number(rawBedIndex ?? player.bedIndex ?? 0) : 0;
      if (
        kind === "bed" &&
        (!Number.isInteger(bedIndex) || bedIndex !== player.bedIndex)
      )
        return { ok: false, error: "자신이 점유한 침대만 강화할 수 있습니다." };
      const level =
        kind === "bed" ? (room.bedLevels[bedIndex] ?? 1) : room.doorLevel;
      if (kind === "reinforced-door" && room.doorHp <= 0)
        return { ok: false, error: "파괴된 문은 업그레이드할 수 없습니다." };
      const activeRank =
        this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
      if (level >= maxBuildingLevel(kind, activeRank))
        return { ok: false, error: "이미 최고 단계입니다." };
      const requirement = upgradeRequirement(kind, level, {
        bedLevel: room.bedLevels[player.bedIndex ?? 0] ?? 1,
        doorLevel: room.doorLevel,
      });
      if (requirement) return { ok: false, error: requirement };
      const cost = upgradeCost(kind, level + 1, activeRank);
      if (player.gold < cost.gold || player.power < cost.power)
        return { ok: false, error: "골드 또는 전력이 부족합니다." };
      player.gold -= cost.gold;
      player.power -= cost.power;
      if (kind === "bed") {
        room.bedLevels[bedIndex] = level + 1;
        room.bedLevel = room.bedLevels[0] ?? 1;
      } else {
        room.doorLevel += 1;
        room.doorMaxHp = BALANCE.door.upgradeHp[room.doorLevel - 1] as number;
        room.doorHp = room.doorMaxHp;
      }
      const mapRoom = this.map.rooms.find((candidate) => candidate.id === room.id);
      this.pendingEvents.push({
        kind: "upgrade",
        roomId: room.id,
        playerId,
        position:
          kind === "bed"
            ? mapRoom?.beds[bedIndex]
            : mapRoom?.door,
        label: `${BALANCE.buildings[kind].label} Lv.${level + 1}`,
      });
      return { ok: true };
    }
    const building = this.state.buildings.find(
      (candidate) => candidate.id === targetId,
    );
    const buildingRoom = building
      ? this.state.rooms.find((candidate) => candidate.id === building.roomId)
      : undefined;
    if (
      !building ||
      !buildingRoom?.ownerIds.includes(playerId) ||
      building.roomId !== player.roomId
    )
      return { ok: false, error: "같은 방의 건물만 업그레이드할 수 있습니다." };
    const activeRank =
      this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
    if (building.level >= maxBuildingLevel(building.kind, activeRank))
      return { ok: false, error: "이미 최고 단계입니다." };
    const requirement = upgradeRequirement(building.kind, building.level, {
      bedLevel: buildingRoom.bedLevels[player.bedIndex ?? 0] ?? 1,
      doorLevel: buildingRoom.doorLevel,
    });
    if (requirement) return { ok: false, error: requirement };
    const baseCost = upgradeCost(building.kind, building.level + 1, activeRank);
    const discounted = player.upgradeDiscountTargetId === building.id;
    const discountRate = discounted
      ? clamp(player.upgradeDiscountRate || 0.35, 0.05, 0.8)
      : 0;
    const cost = discounted
      ? { gold: Math.ceil(baseCost.gold * (1 - discountRate)), power: baseCost.power }
      : baseCost;
    if (player.gold < cost.gold || player.power < cost.power)
      return { ok: false, error: "골드 또는 전력이 부족합니다." };
    player.gold -= cost.gold;
    player.power -= cost.power;
    building.level += 1;
    this.addBuildingInvestment(building, playerId, cost);
    if (discounted) {
      player.upgradeDiscountTargetId = null;
      player.upgradeDiscountRate = 0;
    }
    this.pendingEvents.push({
      kind: "upgrade",
      position: building.tile,
      playerId,
      label: `${BALANCE.buildings[building.kind].label} Lv.${building.level}`,
    });
    return { ok: true };
  }

  removeBuilding(playerId: string, buildingId: string): ActionResult {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    const building = this.state.buildings.find(
      (candidate) => candidate.id === buildingId,
    );
    const room = building
      ? this.state.rooms.find((candidate) => candidate.id === building.roomId)
      : undefined;
    if (!player || !player.alive || !player.roomId || !building || !room)
      return { ok: false, error: "철거할 설비를 찾을 수 없습니다." };
    if (
      (this.state.status !== "COUNTDOWN" && this.state.status !== "PLAYING" && this.state.status !== 'OVERTIME') ||
      player.roomId !== building.roomId ||
      !room.ownerIds.includes(playerId)
    ) {
      return { ok: false, error: "같은 방의 설비만 철거할 수 있습니다." };
    }
    const fallback = this.investmentThroughLevel(
      building.kind,
      building.level,
      this.playMode === "solo" ? player.soloRank : player.multiplayerRank,
    );
    const contributions = building.investmentByPlayer ?? {
      [building.ownerId]: {
        gold: building.investedGold ?? fallback.gold,
        power: building.investedPower ?? fallback.power,
      },
    };
    this.refundBuildingContributions(contributions, "gold");
    this.refundBuildingContributions(contributions, "power");
    this.state.buildings = this.state.buildings.filter(
      (candidate) => candidate.id !== buildingId,
    );
    this.pendingEvents.push({
      kind: "building-remove",
      position: building.tile,
      playerId,
      buildingKind: building.kind,
      amount: Math.floor((building.investedGold ?? fallback.gold) * 0.7),
    });
    return { ok: true };
  }

  moveBuilding(playerId: string, buildingId: string, tile: Tile): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const building = this.state.buildings.find((candidate) => candidate.id === buildingId);
    const room = building
      ? this.state.rooms.find((candidate) => candidate.id === building.roomId)
      : undefined;
    if (!player || !building || !room || !player.alive || !player.roomId)
      return { ok: false, error: '이동할 설비를 찾을 수 없습니다.' };
    if (
      (this.state.status !== 'COUNTDOWN' && this.state.status !== 'PLAYING' && this.state.status !== 'OVERTIME') ||
      player.roomId !== building.roomId ||
      !room.ownerIds.includes(playerId) ||
      building.ownerId !== playerId
    ) {
      return { ok: false, error: '자신이 설치한 같은 방의 설비만 옮길 수 있습니다.' };
    }
    if (!isBuildTile(this.map, building.roomId, tile))
      return { ok: false, error: '건설 가능한 타일로만 설비를 옮길 수 있습니다.' };
    if (building.tile.x === tile.x && building.tile.y === tile.y) return { ok: true };
    const destination = this.state.buildings.find(
      (candidate) => candidate.tile.x === tile.x && candidate.tile.y === tile.y,
    );
    if (destination && (destination.roomId !== building.roomId || destination.ownerId !== playerId)) {
      return { ok: false, error: '내 설비가 있는 타일과만 위치를 교환할 수 있습니다.' };
    }
    const previousTile = { ...building.tile };
    building.tile = { x: tile.x, y: tile.y };
    if (destination) destination.tile = previousTile;
    this.pendingEvents.push({
      kind: 'build',
      position: { ...building.tile },
      playerId,
      buildingKind: building.kind,
      label: destination ? '설비 위치 교환' : '설비 위치 변경',
    });
    return { ok: true };
  }

  private addBuildingInvestment(
    building: BuildingState,
    playerId: string,
    cost: { gold: number; power: number },
  ): void {
    building.investedGold = (building.investedGold ?? 0) + cost.gold;
    building.investedPower = (building.investedPower ?? 0) + cost.power;
    building.investmentByPlayer ??= {};
    const contribution = building.investmentByPlayer[playerId] ?? {
      gold: 0,
      power: 0,
    };
    contribution.gold += cost.gold;
    contribution.power += cost.power;
    building.investmentByPlayer[playerId] = contribution;
  }

  private investmentThroughLevel(
    kind: BuildingKind,
    level: number,
    rank: RankId,
  ): { gold: number; power: number } {
    let gold = 0;
    let power = 0;
    for (let targetLevel = 1; targetLevel <= level; targetLevel += 1) {
      const cost = upgradeCost(kind, targetLevel, rank);
      gold += cost.gold;
      power += cost.power;
    }
    return { gold, power };
  }

  private refundBuildingContributions(
    contributions: Record<string, { gold: number; power: number }>,
    resource: "gold" | "power",
  ): void {
    const rows = Object.entries(contributions)
      .map(([contributorId, contribution]) => ({
        contributorId,
        exact: Math.max(0, contribution[resource]) * 0.7,
      }))
      .filter((row) => row.exact > 0);
    const targetRefund = Math.floor(
      rows.reduce((total, row) => total + row.exact, 0),
    );
    const refunds = rows.map((row) => ({
      ...row,
      amount: Math.floor(row.exact),
    }));
    let remainder =
      targetRefund - refunds.reduce((total, row) => total + row.amount, 0);
    refunds.sort(
      (a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)),
    );
    for (const refund of refunds) {
      if (remainder <= 0) break;
      refund.amount += 1;
      remainder -= 1;
    }
    for (const refund of refunds) {
      const contributor = this.state.players.find(
        (candidate) => candidate.id === refund.contributorId,
      );
      if (contributor) contributor[resource] += refund.amount;
    }
  }

  drawItem(playerId: string, machineId: string): ActionResult {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    const machine = this.state.buildings.find(
      (candidate) =>
        candidate.id === machineId && candidate.kind === "lucky-machine",
    );
    if (
      !player ||
      !player.alive ||
      !machine ||
      machine.ownerId !== playerId ||
      machine.roomId !== player.roomId
    )
      return { ok: false, error: "자신의 랜덤 상자를 선택하세요." };
    if (this.state.status !== "PLAYING" && this.state.status !== 'OVERTIME')
      return { ok: false, error: "게임이 시작된 뒤 뽑을 수 있습니다." };
    const drawLimit = drawLimitForAppearance(player.appearance);
    const cost = DRAW_COSTS[player.drawCount];
    if (player.drawCount >= drawLimit || !cost)
      return {
        ok: false,
        error: `이번 판의 랜덤 뽑기 ${drawLimit}회를 모두 사용했습니다.`,
      };
    if (player.gold < cost.gold || player.power < cost.power)
      return {
        ok: false,
        error: `뽑기 비용이 부족합니다. 골드 ${cost.gold}, 전력 ${cost.power}`,
      };
    player.gold -= cost.gold;
    player.power -= cost.power;
    player.drawCount += 1;
    const totalWeight = RANDOM_ITEMS.reduce(
      (sum, item) => sum + item.weight,
      0,
    );
    let roll = this.rng.next() * totalWeight;
    const item =
      RANDOM_ITEMS.find((candidate) => (roll -= candidate.weight) <= 0) ??
      RANDOM_ITEMS[RANDOM_ITEMS.length - 1];
    if (!item)
      return { ok: false, error: "아이템 목록을 불러오지 못했습니다." };
    const owned = player.items.find(
      (candidate) => candidate.itemId === item.id,
    );
    if (owned) owned.count += 1;
    else
      player.items.push({
        itemId: item.id,
        label: item.label,
        rarity: item.rarity,
        count: 1,
      });
    if (item.effect.doorHpMultiplier && player.roomId) {
      const room = this.state.rooms.find(
        (candidate) => candidate.id === player.roomId,
      );
      if (room) {
        const gained = room.doorMaxHp * (item.effect.doorHpMultiplier - 1);
        room.doorMaxHp += gained;
        if (room.doorHp > 0) room.doorHp += gained;
      }
    }
    this.pendingEvents.push({
      kind: "item-draw",
      playerId,
      itemId: item.id,
      label: item.label,
      rarity: item.rarity,
      position: machine.tile,
    });
    return { ok: true };
  }

  tick(realDt: number, now = Date.now()): void {
    const dt = clamp(realDt, 0, 0.1) * (this.testMode ? 4 : 1);
    this.serverSeq += 1;
    this.expireDisconnected(now);
    this.updatePlayers(dt);
    this.updateBots(dt);
    if (this.state.status === 'EVENT_INTRO') {
      // Time Attack announcement deliberately freezes every simulation system.
      this.state.difficulty.introRemaining = Math.max(0, this.state.difficulty.introRemaining - dt);
      if (this.state.difficulty.introRemaining <= 0) {
        this.state.status = 'COUNTDOWN';
        this.state.countdown = this.countdownSecondsForMatch();
      }
    } else if (this.state.status === "COUNTDOWN") {
      this.updateEconomy(dt);
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown <= 0) this.beginPlaying();
    } else if (this.state.status === "PLAYING" || this.state.status === 'OVERTIME') {
      this.state.elapsed += dt;
      if (this.state.status === 'PLAYING' && this.state.difficulty.timeAttackRemaining !== null) {
        this.state.difficulty.timeAttackRemaining = Math.max(0, this.state.difficulty.timeAttackRemaining - dt);
        if (this.state.difficulty.timeAttackRemaining <= 0) this.beginOvertime();
      }
      if (this.state.status === 'OVERTIME') this.updateOvertime(dt);
      this.updateEconomy(dt);
      this.updateBuildings(dt);
      this.updateGhosts(dt);
      this.updateDoorRegeneration(dt);
      this.evaluateOutcome();
    }
    this.sanitizeResources();
  }

  private beginPlaying(): void {
    this.state.status = "PLAYING";
    const combatants = Math.max(
      1,
      this.state.players.filter((player) => player.alive).length,
    );
    const maxHp =
      BALANCE.ghost.baseHp * (1 + BALANCE.ghost.hpPerPlayer * (combatants - 1));
    const rankPressure = Math.max(
      1,
      ...this.state.players
        .filter((player) => player.alive)
        .map(
          (player) =>
            rankBenefits(
              this.playMode === "solo"
                ? player.soloRank
                : player.multiplayerRank,
            ).ghostDifficultyMultiplier,
        ),
    );
    for (const ghost of this.state.ghosts) {
      const variantHp =
        ghost.variant === "brute"
          ? 1.45
          : ghost.variant.startsWith("twin")
            ? 0.68
            : ghost.variant === "swift"
              ? 0.84
              : 1;
      ghost.maxHp =
        (this.testMode ? maxHp * 0.34 : maxHp) *
        variantHp *
        this.stage.hpMultiplier *
        rankPressure;
      ghost.hp = ghost.maxHp;
      ghost.position = { ...this.map.ghostSpawn };
    }
    // 점유는 interact()만 허용한다. 준비 시간이 끝났다고 빈 침대를
    // 강제 배정하지 않아, 미점유 생존자는 복도에서 빈 방을 직접 찾아야 한다.
    this.syncPrimaryGhost();
  }

  private beginOvertime(): void {
    if (this.state.status === 'OVERTIME') return;
    this.state.status = 'OVERTIME';
    this.state.difficulty.overtimeStacks = 0;
    this.applyOvertimeGrowth();
    this.pendingEvents.push({ kind: 'ghost-skill', position: { ...this.state.ghost.position }, targetId: this.state.ghost.id, label: 'TIME ATTACK 초과 · 귀신 각성' });
  }

  private updateOvertime(dt: number): void {
    if (this.state.difficulty.timeAttackRemaining === null) return;
    this.state.difficulty.timeAttackRemaining -= dt;
    const stacks = 1 + Math.max(0, Math.floor(Math.abs(this.state.difficulty.timeAttackRemaining) / 60));
    while (this.state.difficulty.overtimeStacks < stacks) this.applyOvertimeGrowth();
  }

  private applyOvertimeGrowth(): void {
    this.state.difficulty.overtimeStacks += 1;
    for (const ghost of this.state.ghosts) {
      const hpRatio = ghost.maxHp > 0 ? ghost.hp / ghost.maxHp : 1;
      ghost.maxHp *= 2;
      ghost.hp = Math.max(1, ghost.maxHp * hpRatio);
    }
  }

  private updatePlayers(dt: number): void {
    if (this.state.status !== "COUNTDOWN" && this.state.status !== "PLAYING" && this.state.status !== 'OVERTIME')
      return;
    const roomCapacity = this.playMode === "multiplayer" ? 2 : 1;
    const blockedRoomFloorTiles = fullRoomFloorKeys(
      this.map,
      this.state.rooms,
      roomCapacity,
    );
    for (const player of this.state.players) {
      if (!player.alive) continue;
      if (player.roomId) {
        const bed = this.map.rooms.find((room) => room.id === player.roomId)
          ?.beds[player.bedIndex ?? 0];
        if (bed) player.position = { ...bed };
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      // A room may become full while another survivor is already walking
      // across its floor.  Put that intruder just outside the entrance instead
      // of trapping it against the new boundary; the next bot/human input can
      // then continue toward an actually available room.
      const fullRoomContainingPlayer = this.map.rooms.find((mapRoom) => {
        const room = this.state.rooms.find((candidate) => candidate.id === mapRoom.id);
        return Boolean(
          room &&
          room.ownerIds.length >= roomCapacity &&
          mapRoom.floorTiles.some(
            (tile) =>
              tile.x === Math.round(player.position.x) &&
              tile.y === Math.round(player.position.y),
          ),
        );
      });
      if (fullRoomContainingPlayer) {
        const entrance = fullRoomContainingPlayer.floorTiles.find(
          (tile) =>
            Math.abs(tile.x - fullRoomContainingPlayer.door.x) +
              Math.abs(tile.y - fullRoomContainingPlayer.door.y) ===
            1,
        );
        const exit = entrance
          ? {
              x:
                fullRoomContainingPlayer.door.x +
                (fullRoomContainingPlayer.door.x - entrance.x),
              y:
                fullRoomContainingPlayer.door.y +
                (fullRoomContainingPlayer.door.y - entrance.y),
            }
          : fullRoomContainingPlayer.door;
        const hasExit = this.map.corridorTiles.some(
          (tile) => tile.x === exit.x && tile.y === exit.y,
        );
        player.position = hasExit
          ? { ...exit }
          : { ...fullRoomContainingPlayer.door };
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      const rank =
        this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
      const speed =
        BALANCE.player.speed *
        rankBenefits(rank).speedMultiplier *
        combinedItemEffects(player.items).moveSpeedMultiplier *
        characterTraitForAppearance(player.appearance)
          .unclaimedMoveSpeedMultiplier *
        (this.state.elapsed < player.speedBoostUntil ? 1.45 : 1);
      player.position = moveInWalkableArea(
        this.map,
        player.position,
        {
          x: player.velocity.x * speed * dt,
          y: player.velocity.y * speed * dt,
        },
        BALANCE.player.collisionRadius,
        0.12,
        blockedRoomFloorTiles,
      );
    }
  }

  private updateBots(dt: number): void {
    if (this.state.status !== 'COUNTDOWN' && this.state.status !== 'PLAYING' && this.state.status !== 'OVERTIME') return;
    for (const bot of this.state.players.filter((player) => player.isBot)) {
      const runtime = this.botRuntime.get(bot.id);
      if (!runtime) continue;
      if (!bot.roomId) {
        if (!this.isAvailableBotBedTarget(runtime.bedTarget))
          runtime.bedTarget = this.reserveBedForBot(bot);
        this.applyBotIntent(
          bot.id,
          decideBotIntent(
            bot,
            this.state,
            this.map,
            runtime.difficulty,
            runtime.bedTarget,
          ),
        );
        if (bot.roomId) runtime.bedTarget = null;
        continue;
      }
      runtime.reaction -= dt;
      if (runtime.reaction > 0) continue;
      runtime.reaction =
        BOT_REACTION_SECONDS[runtime.difficulty] *
        (0.8 + this.rng.next() * 0.45);
      const intent = decideBotIntent(
        bot,
        this.state,
        this.map,
        runtime.difficulty,
      );
      this.applyBotIntent(bot.id, intent);
    }
  }

  private isAvailableBotBedTarget(target: BotBedTarget | null): target is BotBedTarget {
    if (!target) return false;
    const mapRoom = this.map.rooms.find((room) => room.id === target.roomId);
    const room = this.state.rooms.find((candidate) => candidate.id === target.roomId);
    if (!mapRoom || !room || !mapRoom.beds[target.bedIndex]) return false;
    const roomCapacity = this.playMode === 'multiplayer' ? 2 : 1;
    if (room.ownerIds.length >= roomCapacity) return false;
    return !room.ownerIds.some((ownerId) =>
      this.state.players.find((player) => player.id === ownerId)?.bedIndex === target.bedIndex,
    );
  }

  private reserveBedForBot(bot: PlayerState): BotBedTarget | null {
    const reserved = new Set(
      [...this.botRuntime.entries()]
        .filter(([botId, runtime]) => botId !== bot.id && this.isAvailableBotBedTarget(runtime.bedTarget))
        .map(([, runtime]) => `${runtime.bedTarget?.roomId}:${runtime.bedTarget?.bedIndex}`),
    );
    const candidates = this.map.rooms.flatMap((room) =>
      room.beds.map((bed, bedIndex) => ({ room, bed, bedIndex })),
    ).filter((candidate) => {
      const target = { roomId: candidate.room.id, bedIndex: candidate.bedIndex };
      return this.isAvailableBotBedTarget(target) && !reserved.has(`${target.roomId}:${target.bedIndex}`);
    }).sort((left, right) =>
      Math.hypot(bot.position.x - left.bed.x, bot.position.y - left.bed.y) -
        Math.hypot(bot.position.x - right.bed.x, bot.position.y - right.bed.y) ||
      left.room.id.localeCompare(right.room.id) ||
      left.bedIndex - right.bedIndex,
    );
    const target = candidates[0];
    return target ? { roomId: target.room.id, bedIndex: target.bedIndex } : null;
  }

  private applyBotIntent(botId: string, intent: BotIntent): void {
    if (intent.type === "move")
      this.setMovement(botId, intent.dx, intent.dy, this.serverSeq);
    else {
      const bot = this.state.players.find((player) => player.id === botId);
      if (bot) bot.velocity = { x: 0, y: 0 };
      if (intent.type === "interact") this.interact(botId);
      else if (intent.type === "build")
        this.build(botId, intent.roomId, intent.tile, intent.kind);
      else if (intent.type === "upgrade") this.upgrade(botId, intent.targetId);
    }
  }

  private updateEconomy(dt: number): void {
    for (const player of this.state.players) {
      if (!player.alive || !player.roomId) continue;
      const room = this.state.rooms.find(
        (candidate) => candidate.id === player.roomId,
      );
      if (!room) continue;
      const mapRoom = this.map.rooms.find(
        (candidate) => candidate.id === player.roomId,
      );
      const effects = combinedItemEffects(player.items);
      const trait = characterTraitForAppearance(player.appearance);
      const activeRank =
        this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
      const bedLevel = room.bedLevels[player.bedIndex ?? 0] ?? 1;
      const goldBuildings = this.state.buildings.filter(
        (building) =>
          building.ownerId === player.id &&
          (building.kind === "gem-core" || building.kind === "starter-grave"),
      );
      const bedGoldPerSecond =
        buildingStats("bed", bedLevel).value *
          rankBenefits(activeRank).bedGoldMultiplier +
        effects.goldPerSecond +
        trait.goldPerSecond;
      const buildingGoldPerSecond = goldBuildings.reduce(
        (total, building) =>
          total + buildingStats(building.kind, building.level).value,
        0,
      );
      const playerBed = mapRoom?.beds[player.bedIndex ?? 0] ?? mapRoom?.bed;
      // 침대 수입은 레벨과 무관하게 매초 한 번만 지급한다. 레벨이 오르면
      // 지급 간격이 짧아지는 대신, 같은 1초 주기에 지급 금액이 2배가 된다.
      player.goldIncomeElapsed += dt;
      while (player.goldIncomeElapsed + 1e-9 >= 1) {
        player.goldIncomeElapsed -= 1;
        if (this.state.elapsed < this.state.goldSuppressedUntil) continue;
        player.gold += bedGoldPerSecond + buildingGoldPerSecond;
        // 침대 수입과 생산 건물 수입을 한 덩어리로 합치면 무덤 위에
        // 전체 금액이 표시돼 어떤 건물이 벌어들였는지 알 수 없다.
        // 실제 생산 위치마다 별도 이벤트를 보내서 침대와 무덤(보석)의
        // 수입을 각각 읽을 수 있게 한다.
        if (bedGoldPerSecond > 0 && playerBed)
          this.pendingEvents.push({
            kind: "gold",
            playerId: player.id,
            amount: bedGoldPerSecond,
            position: { ...playerBed },
          });
        for (const building of goldBuildings) {
          const buildingIncome = buildingStats(building.kind, building.level).value;
          if (buildingIncome <= 0) continue;
          this.pendingEvents.push({
            kind: "gold",
            playerId: player.id,
            amount: buildingIncome,
            position: { ...building.tile },
          });
        }
      }
      const generators = this.state.buildings.filter(
        (building) =>
          building.ownerId === player.id && building.kind === "generator",
      );
      // 발전기와 전력 아이템도 침대 골드처럼 매초 한 번만 지급한다.
      // 강화 단계는 지급 주기를 줄이지 않고, 한 번에 주는 전력만 2배로 키운다.
      player.powerIncomeElapsed += dt;
      while (player.powerIncomeElapsed + 1e-9 >= 1) {
        player.powerIncomeElapsed -= 1;
        const powerBefore = player.power;
        const powerPerSecond = generators.reduce(
          (total, generator) => total + buildingStats("generator", generator.level).value,
          effects.powerPerSecond,
        );
        player.power += powerPerSecond;
        const powerGained = Math.floor(player.power) - Math.floor(powerBefore);
        if (powerGained > 0)
          this.pendingEvents.push({
            kind: "power",
            playerId: player.id,
            amount: powerGained,
            position: generators[0]
              ? { ...generators[0].tile }
              : playerBed
                ? { ...playerBed }
                : undefined,
          });
      }
      if (
        room.doorHp > 0 &&
        this.state.elapsed >= this.state.repairSuppressedUntil
      )
        room.doorHp = Math.min(
          room.doorMaxHp,
          room.doorHp + effects.doorRepairPerSecond * dt,
        );
    }
  }

  private updateBuildings(dt: number): void {
    for (const building of this.state.buildings) {
      building.cooldown -= dt;
      const stats = buildingStats(building.kind, building.level);
      const room = this.state.rooms.find(
        (candidate) => candidate.id === building.roomId,
      );
      const owner = this.state.players.find(
        (candidate) => candidate.id === building.ownerId,
      );
      // 아직 점유되지 않은 방의 기본 설비는 보이기만 하고 생산·공격하지 않는다.
      if (!owner) continue;
      const effects = combinedItemEffects(owner?.items ?? []);
      if (
        building.kind === "repair-drone" &&
        room &&
        room.doorHp > 0 &&
        this.state.elapsed >= this.state.repairSuppressedUntil
      )
        room.doorHp = Math.min(room.doorMaxHp, room.doorHp + stats.value * dt);
      const nearest = this.state.ghosts
        .filter((ghost) => ghost.hp > 0 && !ghost.healing)
        .sort(
          (a, b) =>
            distance(a.position, building.tile) -
            distance(b.position, building.tile),
        )[0];
      if (
        building.kind === "shield-device" &&
        room &&
        this.state.ghosts.some((ghost) => ghost.targetRoomId === room.id) &&
        nearest &&
        distance(nearest.position, building.tile) < 7 &&
        building.cooldown <= 0
      ) {
        room.shieldUntil = this.state.elapsed + stats.rate;
        building.cooldown = stats.rate + 8;
      }
      if (building.kind === "frost-turret") {
        for (const ghost of this.state.ghosts.filter(
          (candidate) =>
            candidate.hp > 0 &&
            !candidate.healing &&
            distance(candidate.position, building.tile) <= stats.range,
        )) {
          const frostSources = this.state.buildings.filter(
            (candidate) =>
              candidate.kind === "frost-turret" &&
              distance(candidate.tile, ghost.position) <=
                buildingStats(candidate.kind, candidate.level).range,
          );
          const stacks = frostSources.length;
          // Each upgraded spray adds 16% slow, capped so the ghost remains
          // visible and can eventually retreat instead of becoming frozen.
          this.applyGhostSlow(
            ghost,
            stats.rate + 0.12,
            Math.max(0.35, 1 - stats.value * stacks),
          );
          // Count adaptation exactly once per ghost/tick, regardless of how
          // many overlapping spray objects happen to be iterated first.
          if (frostSources[0]?.id === building.id)
            this.applyControlAdaptation(ghost, stacks, dt);
        }
      }
      const offensive = [
        "basic-turret",
        "golden-turret",
        "electric-coil",
      ].includes(building.kind);
      const trait = owner
        ? characterTraitForAppearance(owner.appearance)
        : characterTraitForAppearance(DEFAULT_APPEARANCE);
      const skinTrait = turretSkinTrait(
        building.skinId,
        building.kind === 'basic-turret'
          ? building.kind
          : undefined,
      );
      // 일반 포탑은 4칸 기본 사거리이며, 황금 심판 포탑과 사거리 아이템만
      // 이 서버 권한 타깃 사거리에 예외 보정을 더한다.
      const roomRangeBonus = building.kind === "electric-coil"
        ? 0
        : (this.state.buildings.find(
            (candidate) =>
              candidate.ownerId === building.ownerId &&
              candidate.kind === "range-amplifier" &&
              Boolean(candidate.ownerId),
          )?.level ?? 0);
      const range = stats.range + effects.turretRangeBonus + trait.turretRangeBonus + roomRangeBonus;
      if (
        !offensive ||
        !nearest ||
        distance(nearest.position, building.tile) > range ||
        building.cooldown > 0
      )
        continue;
      const suppression =
        this.state.elapsed < this.turretSuppressedUntil ? 1.65 : 1;
      building.cooldown =
        stats.rate * suppression * effects.turretRateMultiplier;
      building.cooldown *= trait.turretRateMultiplier;
      building.cooldown *= skinTrait.rateMultiplier;
      const damage =
        stats.value *
        effects.turretDamageMultiplier *
        trait.turretDamageMultiplier *
        skinTrait.damageMultiplier;
      const appliedDamage = this.applyGhostDamage(nearest, damage, building.roomId, building.kind);
      this.pendingEvents.push({
        kind: "turret-fire",
        position: building.tile,
        targetPosition: { ...nearest.position },
        targetId: nearest.id,
        buildingKind: building.kind,
        amount: appliedDamage,
      });
      if (appliedDamage > 0)
        this.pendingEvents.push({
          kind: "ghost-hit",
          position: { ...nearest.position },
          targetId: nearest.id,
          amount: appliedDamage,
        });
    }
    // 포탑 피해로 HP가 20% 아래로 내려가면 applyGhostDamage()가 같은 틱에
    // 퇴각 상태를 표시한다. 그물은 그 직후에도 아직 문을 공격하던 위치에
    // 있는 귀신을 1.5초 묶어야 하므로, 모든 공격 설비를 처리한 뒤 별도
    // 단계로 판정한다. 설치 순서에 따라 그물이 먼저 검사되는 문제도 막는다.
    this.updateGhostNets();
  }

  private updateGhostNets(): void {
    for (const building of this.state.buildings) {
      if (building.kind !== "ghost-net" || building.cooldown > 0) continue;
      const room = this.state.rooms.find(
        (candidate) => candidate.id === building.roomId,
      );
      const owner = this.state.players.find(
        (candidate) => candidate.id === building.ownerId,
      );
      const mapRoom = room
        ? this.map.rooms.find((candidate) => candidate.id === room.id)
        : undefined;
      if (!owner || !mapRoom || !room) continue;
      const stats = buildingStats(building.kind, building.level);
      const target = this.state.ghosts
        .filter((ghost) => {
          // A turret can push HP below 20% in this same frame and set the
          // retreat flag before the net pass runs. If the ghost is still on
          // this door's legal attack tile, that is the same door attack
          // attempt and the net must still fire exactly once.
          const wasJustForcedToRetreatAtThisDoor =
            ghost.retreating && this.canGhostStrikeDoor(ghost, mapRoom);
          return ghost.hp > 0 &&
            !ghost.healing &&
            ghost.hp / Math.max(1, ghost.maxHp) <= BALANCE.ghost.retreatThreshold &&
            (ghost.targetRoomId === room.id || wasJustForcedToRetreatAtThisDoor) &&
            ghost.netTriggeredTargetRoomId !== room.id &&
            this.canGhostStrikeDoor(ghost, mapRoom);
        })
        .sort(
          (left, right) =>
            distance(left.position, building.tile) -
            distance(right.position, building.tile),
        )[0];
      if (!target) continue;
      const resolveAfter = this.state.difficulty.controlAdaptation
        ? Math.min(100, target.controlResolve + 60)
        : 0;
      const duration = resolveAfter >= 100 ? 0.45 : resolveAfter >= 70 ? 0.9 : stats.value;
      target.controlResolve = resolveAfter >= 100 ? 50 : resolveAfter;
      target.stunnedUntil = Math.max(target.stunnedUntil, this.state.elapsed + duration);
      if (resolveAfter >= 100) target.controlImmuneUntil = target.stunnedUntil + 2.5;
      target.netTriggeredTargetRoomId = room.id;
      target.path = [];
      building.cooldown = stats.rate;
      this.pendingEvents.push({
        kind: "ghost-net",
        position: { ...target.position },
        targetId: target.id,
        buildingKind: building.kind,
        amount: duration,
      });
    }
  }

  private applyGhostSlow(
    ghost: GhostState,
    duration: number,
    multiplier: number,
  ): void {
    if (this.state.elapsed < ghost.controlImmuneUntil) return;
    const normalizedMultiplier = clamp(multiplier, 0.35, 1);
    if (this.state.elapsed >= ghost.slowUntil)
      ghost.slowMultiplier = normalizedMultiplier;
    else
      ghost.slowMultiplier = Math.min(
        ghost.slowMultiplier ?? 1,
        normalizedMultiplier,
      );
    ghost.slowUntil = Math.max(ghost.slowUntil, this.state.elapsed + duration);
  }

  private applyControlAdaptation(ghost: GhostState, stacks: number, dt: number): void {
    if (!this.state.difficulty.controlAdaptation || this.state.elapsed < ghost.controlImmuneUntil) return;
    const perSecond = stacks >= 3 ? 54 : stacks === 2 ? 30 : 12;
    ghost.controlResolve = Math.min(100, ghost.controlResolve + perSecond * dt);
    if (ghost.controlResolve < 100) return;
    ghost.controlResolve = 50;
    ghost.controlImmuneUntil = this.state.elapsed + 2.5;
    ghost.slowUntil = this.state.elapsed;
    ghost.slowMultiplier = 1;
    this.pendingEvents.push({
      kind: 'ghost-skill',
      position: { ...ghost.position },
      targetId: ghost.id,
      label: '제어 적응 · 2.5초 면역',
    });
  }

  private updateDoorRegeneration(dt: number): void {
    for (const room of this.state.rooms) {
      const canRegenerate =
        room.ownerIds.length > 0 &&
        room.doorHp > 0 &&
        room.doorHp < room.doorMaxHp &&
        this.state.elapsed >= this.state.repairSuppressedUntil &&
        this.state.elapsed - room.lastDoorHitAt + 1e-6 >=
          BALANCE.door.passiveRegenDelaySeconds;
      if (!canRegenerate) {
        room.doorRegenAccumulator = -1;
        continue;
      }
      if (room.doorRegenAccumulator < 0) {
        room.doorHp = Math.min(
          room.doorMaxHp,
          room.doorHp + BALANCE.door.passiveRegenAmount,
        );
        room.doorRegenAccumulator = 0;
        continue;
      }
      room.doorRegenAccumulator += dt;
      const ticks = Math.floor(
        (room.doorRegenAccumulator + 1e-6) /
          BALANCE.door.passiveRegenIntervalSeconds,
      );
      if (ticks <= 0) continue;
      room.doorRegenAccumulator -=
        ticks * BALANCE.door.passiveRegenIntervalSeconds;
      room.doorHp = Math.min(
        room.doorMaxHp,
        room.doorHp + ticks * BALANCE.door.passiveRegenAmount,
      );
      if (room.doorHp >= room.doorMaxHp) room.doorRegenAccumulator = -1;
    }
  }

  private applyGhostDamage(
    ghost: GhostState,
    damage: number,
    sourceRoomId?: string,
    buildingKind?: BuildingKind,
  ): number {
    // 리스폰 지점의 7초 회복은 보장한다. 후퇴 중에는 계속 포탑 피해를 받아 처치될 수 있다.
    if (ghost.healing || this.state.elapsed < ghost.mistUntil) return 0;
    if (this.state.elapsed < (this.retreatGuardUntil.get(ghost.id) ?? 0))
      return 0;
    const before = ghost.hp;
    let directionalMultiplier = 1;
    if (this.state.difficulty.directionalShield && sourceRoomId) {
      if (
        ghost.shieldCrossfireRoomId &&
        ghost.shieldCrossfireRoomId !== sourceRoomId &&
        this.state.elapsed < ghost.shieldCrossfireUntil
      ) {
        ghost.directionalShieldDisabledUntil = this.state.elapsed + 6;
        ghost.shieldCrossfireUntil = 0;
        ghost.shieldCrossfireRoomId = null;
        this.pendingEvents.push({
          kind: 'ghost-skill',
          position: { ...ghost.position },
          targetId: ghost.id,
          label: '교차 사격 · 방향 보호막 해제',
        });
      } else {
        ghost.shieldCrossfireRoomId = sourceRoomId;
        ghost.shieldCrossfireUntil = this.state.elapsed + 3;
      }
      const attackingRoomShielded = ghost.targetRoomId === sourceRoomId &&
        this.state.elapsed >= ghost.directionalShieldDisabledUntil;
      if (attackingRoomShielded) {
        // Golden turret ignores half of the 65% directional mitigation.
        directionalMultiplier = buildingKind === 'golden-turret' ? 0.675 : 0.35;
      }
    }
    // 도망치는 동안은 방어선의 집중 사격에 노출되어, 충분한 화력이 있으면 회복 전에 처치할 수 있다.
    const appliedDamage =
      damage * directionalMultiplier * (ghost.retreating ? BALANCE.ghost.retreatDamageMultiplier : 1);
    const next = Math.max(0, before - appliedDamage);
    if (next <= 0 && ghost.barrierLayers > 0) {
      ghost.barrierLayers -= 1;
      ghost.hp = 1;
      ghost.retreating = true;
      ghost.retreatCount += 1;
      ghost.targetRoomId = null;
      ghost.targetPlayerId = null;
      ghost.path = [];
      ghost.stunnedUntil = this.state.elapsed;
      ghost.slowUntil = this.state.elapsed;
      ghost.slowMultiplier = 1;
      ghost.controlImmuneUntil = this.state.elapsed + 0.8;
      ghost.mistUntil = this.state.elapsed + 0.8;
      this.retreatGuardUntil.set(ghost.id, this.state.elapsed + 0.8);
      this.pendingEvents.push({
        kind: 'ghost-skill',
        position: { ...ghost.position },
        targetId: ghost.id,
        label: `방어막 파괴 · ${ghost.barrierLayers}겹 남음`,
      });
      return Math.max(0, before - ghost.hp);
    }
    const crossesRetreatLine =
      ghost.variant !== "minion" &&
      !ghost.retreating &&
      !ghost.healing &&
      before / ghost.maxHp > BALANCE.ghost.retreatThreshold &&
      next / ghost.maxHp <= BALANCE.ghost.retreatThreshold;
    if (crossesRetreatLine) {
      ghost.hp = Math.max(1, next);
      ghost.retreating = true;
      ghost.retreatCount += 1;
      ghost.targetRoomId = null;
      ghost.targetPlayerId = null;
      ghost.path = [];
      this.retreatGuardUntil.set(ghost.id, this.state.elapsed + 0.35);
      this.pendingEvents.push({
        kind: "ghost-retreat",
        position: { ...ghost.position },
        targetId: ghost.id,
      });
    } else ghost.hp = next;
    return Math.max(0, before - ghost.hp);
  }

  private updateGhosts(dt: number): void {
    for (const ghost of this.state.ghosts) this.updateGhost(ghost, dt);
    const deadMinions = this.state.ghosts.filter(
      (ghost) => ghost.variant === "minion" && ghost.hp <= 0,
    );
    if (deadMinions.length > 0) {
      for (const minion of deadMinions)
        this.retreatGuardUntil.delete(minion.id);
      this.state.ghosts = this.state.ghosts.filter(
        (ghost) => ghost.variant !== "minion" || ghost.hp > 0,
      );
    }
    this.syncPrimaryGhost();
  }

  private updateGhost(ghost: GhostState, dt: number): void {
    if (ghost.hp <= 0) return;
    ghost.phase = ghost.level;
    ghost.rage =
      ghost.variant !== "minion" &&
      (ghost.level >= 5 || ghost.hp / ghost.maxHp <= 0.3);
    ghost.skillCooldown -= dt;
    ghost.abilityCooldown -= dt;

    if (this.state.elapsed < ghost.stunnedUntil) {
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.2);
      return;
    }

    // A teleport, a target swap, or an old saved path can leave a ghost on an
    // occupied room floor even though its door is still intact.  A closed door
    // is a hard boundary: recover to the corridor side before it can choose an
    // attack target or play an attack animation.
    const aboutToRetreat =
      ghost.variant !== "minion" &&
      ghost.hp / ghost.maxHp <= BALANCE.ghost.retreatThreshold;
    if (
      !ghost.retreating &&
      !ghost.healing &&
      !aboutToRetreat &&
      this.recoverGhostFromLockedRoom(ghost)
    )
      return;

    if (
      ghost.variant !== "minion" &&
      !ghost.retreating &&
      !ghost.healing &&
      ghost.hp / ghost.maxHp <= BALANCE.ghost.retreatThreshold
    ) {
      ghost.retreating = true;
      ghost.retreatCount += 1;
      ghost.targetRoomId = null;
      ghost.targetPlayerId = null;
      ghost.path = [];
      this.pendingEvents.push({
        kind: "ghost-retreat",
        position: { ...ghost.position },
        targetId: ghost.id,
      });
    }
    if (ghost.retreating) {
      const respawnTarget = this.closestRespawnPoint(ghost.position);
      if (distance(ghost.position, respawnTarget) > 0.5)
        this.moveGhostToward(ghost, respawnTarget, dt);
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
      ghost.healingElapsed = Math.min(
        BALANCE.ghost.healDurationSeconds,
        ghost.healingElapsed + dt,
      );
      const recoveryProgress =
        ghost.healingElapsed / BALANCE.ghost.healDurationSeconds;
      ghost.hp =
        ghost.healingStartHp +
        (ghost.maxHp - ghost.healingStartHp) * recoveryProgress;
      if (recoveryProgress >= 1 - 1e-9) {
        ghost.hp = ghost.maxHp;
        ghost.healing = false;
        ghost.healingElapsed = 0;
        ghost.healingStartHp = ghost.hp;
        ghost.targetPlayerId = null;
        ghost.targetRoomId = this.selectGhostTarget(ghost);
        ghost.netTriggeredTargetRoomId = null;
        this.pendingEvents.push({
          kind: "ghost-return",
          position: { ...ghost.position },
          targetId: ghost.id,
        });
      }
      return;
    }

    if (ghost.abilityCooldown <= 0) {
      if (ghost.variant === "teleporter") this.teleportToAnotherDoor(ghost);
      else if (ghost.variant === "undead") this.summonMinions(ghost);
      else ghost.abilityCooldown = 20;
    }

    if (ghost.skillCooldown <= 0) {
      if (ghost.variant === "minion") ghost.skillCooldown = 20;
      else if (this.stage.skills.length > 0) this.useStageSkill(ghost);
      else if (ghost.variant === "caster") {
        this.turretSuppressedUntil = this.state.elapsed + 5;
        ghost.skillCooldown = Math.max(12, 25 - ghost.level);
        this.pendingEvents.push({
          kind: "ghost-skill",
          position: { ...ghost.position },
          targetId: ghost.id,
          label: "포탑 침묵 5초",
        });
      } else ghost.skillCooldown = 20;
    }
    const outsideTarget = this.selectOutsideTarget(ghost);
    if (outsideTarget) {
      if (ghost.targetPlayerId !== outsideTarget.id) {
        ghost.targetPlayerId = outsideTarget.id;
        ghost.targetRoomId = null;
        ghost.path = [];
      }
      if (distance(ghost.position, outsideTarget.position) > 0.52) {
        this.moveGhostToward(
          ghost,
          outsideTarget.position,
          dt,
          BALANCE.ghost.outsideTargetSpeedMultiplier,
        );
        return;
      }
      ghost.attackCooldown -= dt;
      if (ghost.attackCooldown > 0) return;
      const attackSpeed = ghost.variant === "giant" ? 0.3 : 1;
      ghost.attackCooldown =
        Math.max(0.2, BALANCE.ghost.attackInterval /
        (attackSpeed * (ghost.rage ? 1.5 : 1) * 2 ** this.state.difficulty.overtimeStacks));
      this.eliminatePlayer(ghost, outsideTarget);
      return;
    }
    ghost.targetPlayerId = null;
    if (!ghost.targetRoomId) {
      ghost.targetRoomId = this.selectGhostTarget(ghost);
      ghost.path = [];
    }
    const room = this.state.rooms.find(
      (candidate) => candidate.id === ghost.targetRoomId,
    );
    const mapRoom = this.map.rooms.find(
      (candidate) => candidate.id === ghost.targetRoomId,
    );
    if (!room || !mapRoom) {
      ghost.targetRoomId = null;
      return;
    }
    const targetPlayer = room.ownerIds
      .map((ownerId) =>
        this.state.players.find(
          (player) => player.id === ownerId && player.alive,
        ),
      )
      .filter((player): player is PlayerState => Boolean(player))
      .sort(
        (a, b) =>
          distance(ghost.position, a.position) -
          distance(ghost.position, b.position),
      )[0];
    // A sealed-room ghost must stop one corridor tile outside the doorway.
    // Targeting the door tile itself let a teleporter materialize directly on
    // the door and emit a hit in the same snapshot, which looked like an
    // off-screen attack after the next teleport snapshot arrived.
    const destination = room.doorHp > 0
      ? this.corridorApproachForRoom(mapRoom)
      : (targetPlayer?.position ?? mapRoom.bed);
    const canStrikePlayer = Boolean(
      room.doorHp <= 0 &&
      targetPlayer &&
      this.canGhostStrikePlayerInRoom(ghost, targetPlayer, mapRoom.floorTiles),
    );
    // A breached door opens a path, not a through-wall melee range.  The ghost
    // must first place its collision center on a room floor tile and reach the
    // survivor through a one-step path inside the room.
    const canStrikeDoor = room.doorHp > 0 && this.canGhostStrikeDoor(ghost, mapRoom);
    if ((room.doorHp > 0 && !canStrikeDoor) || (room.doorHp <= 0 && !canStrikePlayer)) {
      this.moveGhostToward(ghost, destination, dt);
      return;
    }
    ghost.attackCooldown -= dt;
    if (ghost.attackCooldown > 0) return;
    const combatants = Math.max(
      1,
      this.state.players.filter((player) => player.alive).length,
    );
    const rankPressure = Math.max(
      1,
      ...this.state.players
        .filter((player) => player.alive)
        .map(
          (player) =>
            rankBenefits(
              this.playMode === "solo"
                ? player.soloRank
                : player.multiplayerRank,
            ).ghostDifficultyMultiplier,
        ),
    );
    // 쌍둥이 둘의 합산 문 피해가 일반 귀신 한 마리와 같도록 정확히 절반씩 나눈다.
    const variantDamage =
      ghost.variant === "giant"
        ? 2.5
        : ghost.variant === "minion"
          ? 0.3
          : ghost.variant === "brute"
            ? 1.3
            : ghost.variant.startsWith("twin")
              ? 0.5
              : 1;
    const damageScale =
      (1 +
        BALANCE.ghost.damagePerPlayer * (combatants - 1) +
        (ghost.level - 1) *
          (BALANCE.ghost.damageGrowthPerLevel + this.stage.levelDamageGrowth)) *
      variantDamage *
      this.stage.damageMultiplier *
      rankPressure *
      2 ** this.state.difficulty.overtimeStacks;
    const attackSpeed = ghost.variant === "giant" ? 0.3 : 1;
    ghost.attackCooldown =
      Math.max(0.2, BALANCE.ghost.attackInterval / (attackSpeed * (ghost.rage ? 1.5 : 1) * 2 ** this.state.difficulty.overtimeStacks));
    if (room.doorHp > 0 && canStrikeDoor) {
      const rawShieldReduction =
        this.state.elapsed < room.shieldUntil
          ? this.state.buildings
              .filter(
                (building) =>
                  building.roomId === room.id &&
                  building.kind === "shield-device",
              )
              .reduce(
                (best, building) =>
                  Math.max(
                    best,
                    buildingStats(building.kind, building.level).value,
                  ),
                0,
              )
          : 0;
      const shieldReduction =
        rawShieldReduction *
        Math.max(
          0.15,
          1 - (ghost.level - 1) * BALANCE.ghost.shieldPenetrationPerLevel,
        );
      if (this.state.elapsed < room.doorWardUntil || this.state.elapsed < room.lastLatchUntil) {
        this.pendingEvents.push({
          kind: 'consumable-use',
          position: mapRoom.door,
          roomId: room.id,
          targetId: ghost.id,
          label: this.state.elapsed < room.doorWardUntil ? '결계가 공격을 막았습니다' : '최후의 걸쇠가 버티고 있습니다',
        });
        return;
      }
      const damage =
        BALANCE.ghost.baseDamage * damageScale * (1 - shieldReduction) *
        (this.state.elapsed < room.doorBraceUntil ? 0.75 : 1);
      const nextDoorHp = Math.max(0, room.doorHp - damage);
      const triggersLastLatch = Boolean(
        room.lastLatchArmedBy &&
        room.doorHp / room.doorMaxHp > 0.15 &&
        nextDoorHp / room.doorMaxHp <= 0.15,
      );
      if (triggersLastLatch) {
        room.lastLatchUntil = this.state.elapsed + 4;
        room.lastLatchArmedBy = null;
        room.doorHp = Math.max(1, nextDoorHp);
        this.pendingEvents.push({
          kind: 'consumable-use',
          position: mapRoom.door,
          roomId: room.id,
          label: '최후의 걸쇠 발동 · 4초 보호',
        });
      } else room.doorHp = nextDoorHp;
      room.lastDoorHitAt = this.state.elapsed;
      room.doorRegenAccumulator = -1;
      if (ghost.variant !== "minion") ghost.attackCount += 1;
      this.pendingEvents.push({
        kind: "door-hit",
        position: mapRoom.door,
        // Keep the strike origin so clients can replay the attack only at the
        // position where it actually happened. A later blink/sprint snapshot
        // must not either hide a valid hit or animate it at the new location.
        sourcePosition: { ...ghost.position },
        roomId: room.id,
        targetId: ghost.id,
        amount: damage,
      });
      if (
        ghost.variant !== "minion" &&
        ghost.attackCount >= ghost.attacksToNextLevel
      )
        this.levelUpGhost(ghost);
    } else if (targetPlayer && canStrikePlayer)
      this.eliminatePlayer(ghost, targetPlayer);
  }

  private canGhostStrikePlayerInRoom(
    ghost: GhostState,
    player: PlayerState,
    floorTiles: readonly Tile[],
  ): boolean {
    const ghostTileX = Math.round(ghost.position.x);
    const ghostTileY = Math.round(ghost.position.y);
    if (
      !floorTiles.some(
        (tile) => tile.x === ghostTileX && tile.y === ghostTileY,
      )
    )
      return false;
    if (distance(ghost.position, player.position) > 0.72) return false;
    // Euclidean distance alone can be short across a wall corner.  A direct
    // in-room route of at most one tile is required for a melee elimination.
    const route = findPath(this.map, ghost.position, player.position);
    return route.length > 0 && route.length <= 2;
  }

  private canGhostStrikeDoor(
    ghost: GhostState,
    room: MapDefinition['rooms'][number],
  ): boolean {
    const approach = this.corridorApproachForRoom(room);
    // A legacy snapshot may still have a ghost centered on the door tile, but
    // all new routes (including teleport) stop one tile outside it. Neither
    // state can attack through the room wall or from an unrelated corridor.
    const atDoor = distance(ghost.position, room.door) <= 0.34;
    const atApproach = distance(ghost.position, approach) <= 0.34;
    if (!atDoor && !atApproach) return false;
    const ghostX = Math.round(ghost.position.x);
    const ghostY = Math.round(ghost.position.y);
    // A door may only be attacked from its corridor tile.  Without this guard,
    // a stale path that placed a ghost just inside a room could still satisfy
    // the distance and one-step route checks and damage the door from behind.
    if (
      !this.map.corridorTiles.some(
        (tile) => tile.x === ghostX && tile.y === ghostY,
      )
    )
      return false;
    // Distance alone can be short across a corner or wall. Require a direct
    // corridor route no longer than one tile before a door can take damage.
    const route = findPath(this.map, ghost.position, room.door);
    return route.length > 0 && route.length <= 2;
  }

  private corridorApproachForRoom(room: MapDefinition["rooms"][number]): Tile {
    const directOutside = this.map.corridorTiles.find(
      (tile) =>
        (tile.x !== room.door.x || tile.y !== room.door.y) &&
        Math.abs(tile.x - room.door.x) + Math.abs(tile.y - room.door.y) === 1,
    );
    if (directOutside) return directOutside;
    return (
      this.map.corridorTiles
        .filter(
          (tile) => tile.x !== room.door.x || tile.y !== room.door.y,
        )
        .sort(
          (a, b) => distance(a, room.door) - distance(b, room.door),
        )[0] ?? room.door
    );
  }

  private recoverGhostFromLockedRoom(ghost: GhostState): boolean {
    const containingRoom = this.map.rooms.find((room) =>
      room.floorTiles.some(
        (tile) =>
          tile.x === Math.round(ghost.position.x) &&
          tile.y === Math.round(ghost.position.y),
      ),
    );
    if (!containingRoom) return false;
    const roomState = this.state.rooms.find(
      (room) => room.id === containingRoom.id,
    );
    if (!roomState || roomState.doorHp <= 0) return false;
    const approach = this.corridorApproachForRoom(containingRoom);
    ghost.position = { x: approach.x, y: approach.y };
    ghost.targetPlayerId = null;
    ghost.targetRoomId = null;
    ghost.path = [];
    ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.35);
    return true;
  }

  private eliminatePlayer(ghost: GhostState, player: PlayerState): void {
    const damage = player.hp;
    player.hp = 0;
    this.pendingEvents.push({
      kind: "player-hit",
      position: player.position,
      playerId: player.id,
      targetId: ghost.id,
      amount: damage,
    });
    const defeatedRoomId = player.roomId;
    player.alive = false;
    player.spectator = true;
    player.velocity = { x: 0, y: 0 };
    this.pendingEvents.push({
      kind: "death",
      position: player.position,
      playerId: player.id,
    });
    ghost.targetRoomId = null;
    ghost.targetPlayerId = null;
    ghost.path = [];
    // Once the last survivor in a sealed room is gone, the ghost must leave by
    // the doorway.  This prevents an undead that eliminated a bot on a bed
    // from remaining trapped on that bed until its next respawn movement.
    if (defeatedRoomId) {
      const remainingOwner = this.state.players.some(
        (candidate) =>
          candidate.alive &&
          candidate.roomId === defeatedRoomId,
      );
      const mapRoom = this.map.rooms.find(
        (room) => room.id === defeatedRoomId,
      );
      if (!remainingOwner && mapRoom) {
        const approach = this.corridorApproachForRoom(mapRoom);
        ghost.position = { x: approach.x, y: approach.y };
        ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.35);
      }
    }
  }

  private levelUpGhost(ghost: GhostState): void {
    const previousMax = ghost.maxHp;
    ghost.level += 1;
    ghost.phase = ghost.level;
    ghost.attackCount = 0;
    ghost.attacksToNextLevel +=
      BALANCE.ghost.attacksAddedPerLevel + ghost.level - 1;
    ghost.maxHp = Math.round(ghost.maxHp * (1 + this.stage.levelHpGrowth));
    ghost.hp += ghost.maxHp - previousMax;
    this.pendingEvents.push({
      kind: "ghost-level-up",
      position: { ...ghost.position },
      targetId: ghost.id,
      amount: ghost.level,
    });
  }

  private useStageSkill(ghost: GhostState): void {
    const skill =
      this.stage.skills[this.rng.int(0, this.stage.skills.length - 1)];
    let label = "";
    if (skill === "turret-jam") {
      this.turretSuppressedUntil = this.state.elapsed + 3;
      label = "포탑 무효화 3초";
    } else if (skill === "gold-lock") {
      this.state.goldSuppressedUntil = this.state.elapsed + 5;
      label = "골드 획득 봉인 5초";
    } else if (skill === "repair-lock") {
      this.state.repairSuppressedUntil = this.state.elapsed + 5;
      label = "문 수리 봉인 5초";
    } else if (skill === "door-crush") {
      const room = this.state.rooms.find(
        (candidate) => candidate.id === ghost.targetRoomId,
      );
      if (room?.doorHp) {
        room.doorHp = Math.max(0, room.doorHp - room.doorMaxHp * 0.08);
        room.lastDoorHitAt = this.state.elapsed;
        room.doorRegenAccumulator = -1;
      }
      label = "문 내구도 8% 파쇄";
    }
    ghost.skillCooldown = Math.max(
      7,
      this.stage.skillInterval - Math.min(5, ghost.level),
    );
    this.pendingEvents.push({
      kind: "ghost-skill",
      position: { ...ghost.position },
      targetId: ghost.id,
      label,
    });
  }

  private teleportToAnotherDoor(ghost: GhostState): void {
    const occupied = this.state.rooms.filter((room) =>
      room.ownerIds.some((ownerId) =>
        this.state.players.some(
          (player) => player.id === ownerId && player.alive,
        ),
      ),
    );
    const alternatives = occupied.filter(
      (room) => room.id !== ghost.targetRoomId,
    );
    const pool = alternatives.length > 0 ? alternatives : occupied;
    if (pool.length === 0) {
      ghost.abilityCooldown = 6;
      return;
    }
    const target = pool[this.rng.int(0, pool.length - 1)];
    const mapRoom = target
      ? this.map.rooms.find((room) => room.id === target.id)
      : undefined;
    if (target && mapRoom) {
      const approach = this.corridorApproachForRoom(mapRoom);
      ghost.position = { x: approach.x, y: approach.y };
      ghost.targetRoomId = target.id;
      ghost.targetPlayerId = null;
      ghost.path = [];
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.6);
      this.pendingEvents.push({
        kind: "ghost-skill",
        position: { ...ghost.position },
        targetId: ghost.id,
        roomId: target.id,
        label: "다른 방문으로 순간이동",
      });
    }
    ghost.abilityCooldown = Math.max(7, 14 - Math.min(4, ghost.level * 0.5));
  }

  private summonMinions(ghost: GhostState): void {
    const livingMinions = this.state.ghosts.filter(
      (candidate) => candidate.variant === "minion" && candidate.hp > 0,
    );
    const requested = Math.min(6, Math.max(1, Math.ceil(ghost.level / 2)));
    const count = Math.min(requested, Math.max(0, 12 - livingMinions.length));
    for (let index = 0; index < count; index += 1) {
      const minion = this.makeGhost("minion", this.state.ghosts.length + index);
      minion.id = `nightmare-minion-${crypto.randomUUID()}`;
      minion.position = {
        x: ghost.position.x + ((index % 3) - 1) * 0.34,
        y: ghost.position.y + Math.floor(index / 3) * 0.34,
      };
      minion.level = ghost.level;
      minion.phase = ghost.level;
      minion.maxHp = buildingStats("basic-turret", 1).value * 3.5;
      minion.hp = minion.maxHp;
      minion.targetRoomId = this.selectGhostTarget(minion);
      minion.summonerId = ghost.id;
      minion.attackCooldown = 0.35 + index * 0.12;
      this.state.ghosts.push(minion);
    }
    ghost.abilityCooldown = Math.max(7, 13 - Math.min(4, ghost.level * 0.45));
    if (count > 0)
      this.pendingEvents.push({
        kind: "ghost-skill",
        position: { ...ghost.position },
        targetId: ghost.id,
        amount: count,
        label: `미니미 ${count}마리 소환`,
      });
  }

  private moveGhostToward(
    ghost: GhostState,
    destination: Vec2,
    dt: number,
    speedMultiplier = 1,
  ): void {
    if (ghost.path.length === 0 || this.serverSeq % 20 === 0) {
      ghost.path = findPath(this.map, ghost.position, destination);
      const start = ghost.path[0];
      if (
        start &&
        start.x === Math.round(ghost.position.x) &&
        start.y === Math.round(ghost.position.y)
      )
        ghost.path.shift();
    }
    while (
      ghost.path.length > 0 &&
      distance(ghost.position, ghost.path[0] as Tile) < 0.3
    )
      ghost.path.shift();
    const next = ghost.path[0] ?? destination;
    const direction = normalize({
      x: next.x - ghost.position.x,
      y: next.y - ghost.position.y,
    });
    const variantSpeed =
      ghost.variant === "swift"
        ? 1.65
        : ghost.variant === "brute"
          ? 0.78
          : ghost.variant === "minion"
            ? 1.22
            : ghost.variant.startsWith("twin")
              ? 1.15
              : 1;
    const slowed = this.state.elapsed < ghost.slowUntil;
    const slowMultiplier = slowed ? clamp(ghost.slowMultiplier ?? 0.76, 0.35, 1) : 1;
    let speed =
      BALANCE.ghost.speed *
      this.stage.speedMultiplier *
      variantSpeed *
      speedMultiplier *
      (ghost.rage ? 1.32 : 1) *
      slowMultiplier;
    if (ghost.retreating) speed *= BALANCE.ghost.retreatSpeedMultiplier;
    const radius =
      ghost.variant === "giant"
        ? 0.38
        : ghost.variant === "minion"
          ? 0.16
          : BALANCE.ghost.collisionRadius;
    ghost.position = moveInWalkableArea(
      this.map,
      ghost.position,
      {
        x: direction.x * speed * dt,
        y: direction.y * speed * dt,
      },
      radius,
    );
  }

  private closestRespawnPoint(position: Vec2): Vec2 {
    const zones = this.map.respawnZones;
    if (zones.length === 0) return { ...this.map.ghostSpawn };
    return zones
      .map((zone) => ({
        x: zone.x + (zone.width - 1) / 2,
        y: zone.y + (zone.height - 1) / 2,
      }))
      .sort((a, b) => distance(position, a) - distance(position, b))[0] as Vec2;
  }

  private selectGhostTarget(ghost: GhostState): string | null {
    const occupied = this.state.rooms.filter((room) => {
      return room.ownerIds.some((ownerId) =>
        this.state.players.some(
          (player) => player.id === ownerId && player.alive,
        ),
      );
    });
    const candidates = occupied.filter((room) => room.beaconUntil <= this.state.elapsed);
    if (candidates.length === 0) return null;
    const otherTwinTargets = ghost.variant.startsWith("twin")
      ? new Set(
          this.state.ghosts
            .filter(
              (candidate) =>
                candidate.id !== ghost.id &&
                candidate.variant.startsWith("twin"),
            )
            .map((candidate) => candidate.targetRoomId)
            .filter(Boolean),
        )
      : new Set<string>();
    const diversified =
      candidates.length > 1
        ? candidates.filter((room) => !otherTwinTargets.has(room.id))
        : candidates;
    const pool = diversified.length > 0 ? diversified : candidates;
    return pool[this.rng.int(0, pool.length - 1)]?.id ?? null;
  }

  private selectOutsideTarget(ghost: GhostState): PlayerState | null {
    return (
      this.state.players
        .filter(
          (player) =>
            player.alive &&
            player.connected &&
            !player.roomId &&
            player.stealthUntil <= this.state.elapsed,
        )
        .sort((first, second) => {
          // 실제 생존자가 복도에 있다면 서버 봇보다 먼저 추적한다.
          if (first.isBot !== second.isBot)
            return Number(first.isBot) - Number(second.isBot);
          return (
            distance(ghost.position, first.position) -
            distance(ghost.position, second.position)
          );
        })[0] ?? null
    );
  }

  private syncPrimaryGhost(): void {
    this.state.ghost =
      this.state.ghosts.find(
        (ghost) => ghost.variant !== "minion" && ghost.hp > 0,
      ) ??
      this.state.ghosts.find((ghost) => ghost.hp > 0) ??
      (this.state.ghosts[0] as GhostState);
  }

  private evaluateOutcome(): void {
    if (this.state.ghosts.every((ghost) => ghost.hp <= 0)) {
      this.state.status = "VICTORY";
      this.state.winner = "survivors";
      this.pendingEvents.push({
        kind: "victory",
        position: this.state.ghosts[0]?.position ?? this.map.ghostSpawn,
      });
      return;
    }
    if (
      this.state.players.length > 0 &&
      this.state.players.every((player) => !player.alive)
    ) {
      this.state.status = "DEFEAT";
      this.state.winner = "ghost";
      this.pendingEvents.push({
        kind: "defeat",
        position: this.state.ghost.position,
      });
    }
  }

  private voteRematch(playerId: string): ActionResult {
    if (this.state.status !== "VICTORY" && this.state.status !== "DEFEAT")
      return { ok: false, error: "결과 화면에서만 재대결할 수 있습니다." };
    this.rematchVotes.add(playerId);
    const humans = this.state.players.filter(
      (player) => !player.isBot && player.connected,
    );
    if (humans.every((player) => this.rematchVotes.has(player.id)))
      this.resetForRematch();
    return { ok: true };
  }

  private resetForRematch(): void {
    const hostId = this.state.hostId;
    const players = this.state.players.map((player) => {
      const next = this.makePlayer(
        player.id,
        player.nickname,
        player.isBot,
        player.accountId,
        player.soloRank,
        player.multiplayerRank,
        player.appearance,
        player.turretSkins,
        player.consumables,
        player.profileDisplayMode,
        player.profileRankedTier,
        player.profileRankedRating,
      );
      next.consumableLoadout = [...player.consumableLoadout];
      return { ...next, connected: player.connected, ready: player.isBot };
    });
    this.state = this.createInitialState();
    this.state.players = players;
    this.state.hostId = hostId;
    this.rematchVotes.clear();
  }

  private expireDisconnected(now: number): void {
    if (this.state.status === "LOBBY") {
      const expired = this.state.players.filter(
        (player) =>
          !player.isBot &&
          !player.connected &&
          player.reconnectUntil > 0 &&
          player.reconnectUntil < now,
      );
      for (const player of expired) {
        this.state.players = this.state.players.filter(
          (candidate) => candidate.id !== player.id,
        );
        if (this.state.hostId === player.id)
          this.state.hostId =
            this.state.players.find(
              (candidate) => !candidate.isBot && candidate.connected,
            )?.id ?? null;
      }
    }
  }

  private sanitizeResources(): void {
    for (const player of this.state.players) {
      player.gold = clamp(player.gold, 0, 999_999);
      player.power = clamp(player.power, 0, 999_999);
      player.hp = clamp(player.hp, 0, player.maxHp);
    }
    for (const room of this.state.rooms)
      room.doorHp = clamp(room.doorHp, 0, room.doorMaxHp);
    for (const ghost of this.state.ghosts)
      ghost.hp = clamp(ghost.hp, 0, ghost.maxHp);
    this.syncPrimaryGhost();
  }

  private makePlayer(
    id: string,
    nickname: string,
    isBot: boolean,
    accountId: string | null,
    soloRank: RankId,
    multiplayerRank: RankId,
    appearance = DEFAULT_APPEARANCE,
    turretSkins = DEFAULT_TURRET_SKINS,
    consumables: PlayerState['consumables'] = [],
    profileDisplayMode: ProfileDisplayMode = 'solo',
    profileRankedTier: RankedTier = 'bronze',
    profileRankedRating = 800,
  ): PlayerState {
    const benefits = rankBenefits(
      this.playMode === "solo" ? soloRank : multiplayerRank,
    );
    return {
      id,
      accountId,
      nickname,
      soloRank,
      multiplayerRank,
      displayRank: higherRank(soloRank, multiplayerRank),
      profileDisplayMode: normalizeProfileDisplayMode(profileDisplayMode),
      profileRankedTier: normalizeProfileRankedTier(profileRankedTier),
      profileRankedRating: normalizeProfileRankedRating(profileRankedRating),
      appearance: normalizeAppearance(appearance),
      turretSkins: normalizeTurretSkins(turretSkins),
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
      goldIncomeElapsed: 0,
      powerIncomeElapsed: 0,
      roomId: null,
      bedIndex: null,
      lastInputSeq: 0,
      reconnectUntil: 0,
      score: 0,
      drawCount: 0,
      firstGuardianBuilt: false,
      items: [],
      consumables: consumables
        .filter((item) => shopConsumableById(item.itemId) && Number.isInteger(item.quantity) && item.quantity > 0)
        .map((item) => ({ itemId: item.itemId, quantity: item.quantity })),
      consumableLoadout: [],
      usedConsumables: [],
      speedBoostUntil: 0,
      stealthUntil: 0,
      bedrollUntil: 0,
      upgradeDiscountTargetId: null,
      upgradeDiscountRate: 0,
    };
  }
}
