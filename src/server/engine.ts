import {
  BALANCE,
  buildingStats,
  goldenTurretGoldPerShot,
  maxBuildingLevel,
  upgradeCost,
  upgradeRequirement,
} from "../shared/balance";
import {
  botAppearance,
  DEFAULT_APPEARANCE,
  DEFAULT_TILE_SKIN_ID,
  DEFAULT_TURRET_SKINS,
  normalizeAppearance,
  normalizeTurretSkins,
} from "../shared/customization";
import {
  bedGoldProductionForMatch,
  characterTraitForMatch,
  drawLimitForMatch,
} from "../shared/characterTraits";
import { turretSkinTrait } from "../shared/turretSkinTraits";
import {
  isBuildTile,
  isPositionOnRoomFloor,
  moveInWalkableArea,
  tileKey,
} from "../shared/map";
import { tutorialGuidedBuildTile } from "../shared/tutorial";
import { findPath } from "../shared/pathfinding";
import {
  combinedItemEffects,
  DRAW_COSTS,
  getRandomItem,
  randomItemForRoll,
  RANDOM_ITEMS,
} from "../shared/randomItems";
import {
  difficultyRuleForStage,
  getStage,
  higherRank,
  isEliteRank,
  rankBenefits,
  rankLabel,
  recommendedRankForStage,
  TIME_ATTACK_EXPIRED_MESSAGE,
  timeAttackChanceForStage,
  type GhostStageSkill,
  type StageDefinition,
} from "../shared/progression";
import { SeededRandom, hashString } from "../shared/rng";
import {
  isRankedTurretKind,
  normalizeRankedSeasonRules,
} from "../shared/rankedRules";
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
  botStrategyFor,
  decideBotIntent,
  type BotBedTarget,
  type BotDifficulty,
  type BotIntent,
  type BotStrategy,
} from "./bots";
import { rankedBotNickname } from "./botNames";

const COLORS = [
  0x72e6ff, 0xffca62, 0xc68cff, 0x73ec9e, 0xff7597, 0x89a7ff,
] as const;
// Human survivors are intentionally faster, but bots retain the original
// baseline so their established pacing and difficulty do not change.
const BOT_BASE_SPEED = 4.8;
const BLACKOUT_REVEAL_RADIUS_TILES = 2;
const BLACKOUT_GHOST_SPEED_MULTIPLIER = 1.01;
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
const normalizeProfileRankedSeasonId = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(value)
    ? value
    : 'S1';

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
  'overload-capacitor',
  'turret-enhancer',
  'door-anchor',
  'reflect-mirror',
  'power-panel',
  'cursed-contract',
  'soul-vial',
  'hide-and-seek-doll',
]);
const OFFENSIVE_BUILD_KINDS = new Set<BuildingKind>([
  'basic-turret',
  'golden-turret',
  'electric-coil',
]);
const BOT_SUPPORT_BUILD_KINDS = new Set<BuildingKind>([
  'repair-drone',
  'frost-turret',
  'ghost-net',
  'turret-enhancer',
  'shield-device',
  'overload-capacitor',
  'door-anchor',
  'reflect-mirror',
  'power-panel',
  'soul-vial',
  'hide-and-seek-doll',
]);

const SUPPLY_DOOR_HEAL: Partial<Record<ConsumableId, number>> = {
  'quick-mortar': 160,
};
const SUPPLY_DOOR_BRACE_SECONDS: Partial<Record<ConsumableId, number>> = {
  'hinge-brace': 15,
};
const SUPPLY_DOOR_WARD_SECONDS: Partial<Record<ConsumableId, number>> = {
  'ward-seal': 4,
};
const SUPPLY_TARGET_RADIUS = 4;
const SUPPLY_TURRET_KINDS = new Set<BuildingKind>([
  'basic-turret',
  'golden-turret',
  'electric-coil',
]);

interface ReconnectRecord {
  playerId: string;
  token: string;
  deviceId: string;
}

interface BotRuntime {
  difficulty: BotDifficulty;
  reaction: number;
  bedTarget: BotBedTarget | null;
  /** Keeps a newly calculated route from visibly snapping 180 degrees. */
  lastMove: { x: number; y: number } | null;
  diagnostic: BotMatchDiagnostic;
  lastFailedIntent: string | null;
  repeatedFailureCount: number;
  idleWithResourcesSince: number | null;
  idleWarningRecorded: boolean;
}

export interface BotMatchDiagnostic {
  botId: string;
  strategy: BotStrategy;
  rank: RankId;
  claimedAt: number | null;
  firstTurretAt: number | null;
  firstDoorUpgradeAt: number | null;
  supportBuildingActions: number;
  diedAt: number | null;
  idleWithResourcesWarnings: number;
  repeatedFailureWarnings: number;
}

interface BuildingTickIndex {
  roomsById: Map<string, RoomState>;
  ownersById: Map<string, PlayerState>;
  buildingsByOwner: Map<string, BuildingState[]>;
  adjacentEnhancersByTurret: Map<string, number>;
}

export interface PersistedEngine {
  snapshot: GameSnapshot;
  reconnect: ReconnectRecord[];
  botRuntime: Array<[string, BotRuntime]>;
  testMode: boolean;
  /** Optional for compatibility with rooms saved before counters were persisted. */
  buildCounter?: number;
  /** Optional for compatibility with rooms saved before counters were persisted. */
  lootCounter?: number;
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
  private readonly blackoutNavigationMap: MapDefinition;
  private readonly rng: SeededRandom;
  private readonly reconnect = new Map<string, ReconnectRecord>();
  private readonly botRuntime = new Map<string, BotRuntime>();
  /** Cached collision masks used after a survivor is sealed inside a room. */
  private readonly roomExitBlockTiles = new Map<string, ReadonlySet<string>>();
  private pendingEvents: GameEvent[] = [];
  private readonly retreatGuardUntil = new Map<string, number>();
  private serverSeq = 0;
  private buildCounter = 0;
  private lootCounter = 0;
  /** Rolled once at the beginning of every match; released with the countdown. */
  private countdownLootPending = false;
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
    // The opening hunt is restricted to corridors. Keeping a dedicated
    // navigation map prevents a shortest path from cutting through a room
    // while a survivor is hiding inside it.
    this.blackoutNavigationMap = {
      ...map,
      walkable: map.corridorTiles.map((tile) => ({ ...tile })),
    };
    this.testMode = testMode;
    this.stage = getStage(config.stageId);
    this.playMode = config.playMode ?? map.playMode;
    this.ranked = config.ranked
      ? {
          ...config.ranked,
          seasonRules: normalizeRankedSeasonRules(
            config.ranked.seasonId,
            config.ranked.seasonRules,
          ),
        }
      : null;
    this.rng = new SeededRandom(map.seed ^ hashString(roomCode));
    this.state = this.createInitialState();
  }

  private createInitialState(): GameSnapshot {
    const rooms: RoomState[] = this.map.rooms.map((room) => ({
      id: room.id,
      ownerId: null,
      ownerIds: [],
      tileSkinId: '',
      tileSkinActivatedAt: -1,
      doorHp: BALANCE.door.baseHp,
      doorMaxHp: BALANCE.door.baseHp,
      doorShieldHp: 0,
      doorShieldMaxHp: 0,
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
      freeRepairUntil: 0,
      freeRepairReadyAt: 0,
      freeRepairByPlayerId: null,
      doorAnchorUntil: 0,
      doorMaxHpMultiplier: 1,
      supplyTurretDamageUntil: 0,
      supplyTurretRateUntil: 0,
      supplyTurretLevelUntil: 0,
      goldSuppressedUntil: 0,
      goldSuppressedByGhostId: null,
    }));
    const timeAttack = this.ranked
      ? this.ranked.modifier === 'time-attack'
      : !this.testMode && this.rng.next() < timeAttackChanceForStage(this.stage);
    const difficulty = difficultyRuleForStage(this.stage, timeAttack);
    const eventRoll = this.testMode ? 0 : this.rng.next();
    const variants: GhostVariant[] = this.stage.id === 'tutorial-1'
      ? ['wanderer']
      : this.testMode
      ? ["wanderer"]
      : eventRoll < 0.13
        ? ["twin-a", "twin-b"]
        : [
            eventRoll < 0.24
              ? "swift"
              : eventRoll < 0.34
                ? "caster"
                : eventRoll < 0.44
                  ? "brute"
                  : eventRoll < 0.57
                    ? "teleporter"
                    : eventRoll < 0.70
                      ? "undead"
                      : eventRoll < 0.79
                        ? "giant"
                        : eventRoll < 0.88
                          ? "demolisher"
                          : eventRoll < 0.96
                            ? "wallpaper"
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
    const starterBuildings: BuildingState[] = this.testMode || this.stage.id === 'tutorial-1'
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
      demolisher: "건물을 지우는 해체귀",
      wallpaper: "방을 오염시키는 도배귀",
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
      lootDrops: [],
      ghost: ghosts[0] as GhostState,
      ghosts,
      matchEvent: eventNames[variants[0] as GhostVariant],
      stageId: this.stage.id,
      stageLabel: this.stage.label,
      stageIndex: this.stage.index,
      playMode: this.playMode,
      difficulty,
      contractUsed: false,
      ranked: this.ranked,
      tutorial: this.stage.id === 'tutorial-1'
        ? {
            active: true,
            step: 'pickup-loot',
            reservedRoomId: null,
            guidedLootId: null,
            pauseRemaining: 0,
            retreatExplained: false,
            powerGranted: false,
            netTriggered: false,
            combatRevealRemaining: 0,
            combatStarted: false,
          }
        : null,
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
      demolisher: "웃는 해체귀",
      wallpaper: "오염 도배귀",
      minion: "썩은 미니미",
    };
    return {
      id: `nightmare-${variant}-${index + 1}`,
      position: this.initialGhostPosition(index),
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
      attacksToNextLevel: this.attacksForNextGhostLevel(1, variant),
      retreating: false,
      healing: false,
      healingElapsed: 0,
      healingStartHp: 0,
      retreatCount: 0,
      skillCooldown: variant === "caster" ? 8 : 20,
      pendingStageSkill: null,
      abilityCooldown:
        variant === "teleporter" ? 12 : variant === "undead" ? 10 : 20,
      controlResolve: 0,
      controlImmuneUntil: 0,
      controlResistanceNoticeLevel: 0,
      netTriggeredTargetRoomId: null,
      barrierLayers: 0,
      mistUntil: 0,
      shieldCrossfireUntil: 0,
      shieldCrossfireRoomId: null,
      directionalShieldDisabledUntil: 0,
      mana: 0,
      maxMana: 100,
      abilityPhase: "idle",
      abilityStartedAt: -1,
      abilityEndsAt: -1,
      abilityTargetBuildingId: null,
      contaminatedTiles: [],
      contaminationEndsAt: -1,
      confusedUntil: -1,
      wanderUntil: -1,
      wanderTarget: null,
      vulnerableUntil: -1,
    };
  }

  /**
   * Every ghost must start on the centre of a real corridor tile. Offsetting
   * the second twin by a fractional x value could round it into the boundary
   * wall beside a respawn opening; pathfinding then had no valid first node,
   * leaving that twin frozen during both blackout and normal play.
   */
  private initialGhostPosition(index: number): Vec2 {
    if (index <= 0) return { ...this.map.ghostSpawn };
    const candidates = this.map.corridorTiles
      .filter(
        (tile) =>
          distance(tile, this.map.ghostSpawn) >= 0.9,
      )
      .sort((left, right) => {
        const distanceDelta =
          distance(left, this.map.ghostSpawn) -
          distance(right, this.map.ghostSpawn);
        if (Math.abs(distanceDelta) > 1e-9) return distanceDelta;
        return left.y - right.y || left.x - right.x;
      });
    const selected =
      candidates[(index - 1) % Math.max(1, candidates.length)] ??
      this.map.ghostSpawn;
    return { ...selected };
  }

  /** The first growth accelerates by stage, then each later ghost level needs more door pressure. */
  private firstGhostLevelAttacks(): number {
    return Math.max(15, BALANCE.ghost.firstLevelAttacks - this.stage.index);
  }

  private ghostAttackSpeedMultiplier(variant: GhostVariant): number {
    return variant === "giant" ? 0.3 : 1;
  }

  private attacksForNextGhostLevel(
    currentLevel: number,
    variant: GhostVariant = "wanderer",
  ): number {
    const first = this.firstGhostLevelAttacks();
    const baseAttacks =
      currentLevel <= 1
        ? first
        : currentLevel === 2
          ? first + BALANCE.ghost.firstLevelFollowupAttacks
          : first +
            BALANCE.ghost.firstLevelFollowupAttacks +
            (currentLevel - 2) * BALANCE.ghost.attacksAddedPerLevel;
    // Slow attackers otherwise need several times longer real-world combat
    // time to grow. Scale hit counts by their base attack-speed multiplier so
    // every variant reaches the next level after comparable door pressure.
    return Math.max(
      1,
      Math.ceil(
        baseAttacks * this.ghostAttackSpeedMultiplier(variant),
      ),
    );
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
    if (this.state.ranked) {
      this.state.ranked.seasonRules = normalizeRankedSeasonRules(
        this.state.ranked.seasonId,
        this.state.ranked.seasonRules,
      );
    }
    // Legacy snapshots stored one global lock. Never restore it into every
    // room: that was the source of unrelated survivors losing all income.
    this.state.goldSuppressedUntil = 0;
    this.state.repairSuppressedUntil = Math.min(
      this.state.elapsed + 5,
      Math.max(0, finite(this.state.repairSuppressedUntil, 0)),
    );
    this.state.lootDrops ??= [];
    this.state.contractUsed ??= false;
    if (this.state.tutorial?.active) {
      this.state.tutorial.netTriggered ??= false;
      this.state.tutorial.pauseRemaining ??= 0;
      this.state.tutorial.retreatExplained ??= false;
      this.state.tutorial.powerGranted ??= false;
      this.state.tutorial.combatRevealRemaining ??= 0;
      this.state.tutorial.combatStarted ??=
        this.state.tutorial.step === "finish";
    }
    for (const ghost of this.state.ghosts) {
      ghost.displayName ??= "복도 순찰자";
      ghost.variant ??= "wanderer";
      ghost.targetPlayerId ??= null;
      ghost.slowMultiplier ??= 1;
      ghost.stunnedUntil ??= 0;
      ghost.attackCount ??= 0;
      const scaledAttacksToNextLevel = this.attacksForNextGhostLevel(
        ghost.level ?? 1,
        ghost.variant,
      );
      ghost.attacksToNextLevel ??= scaledAttacksToNextLevel;
      if (
        this.ghostAttackSpeedMultiplier(ghost.variant) < 1 &&
        ghost.attacksToNextLevel > scaledAttacksToNextLevel
      ) {
        ghost.attacksToNextLevel = scaledAttacksToNextLevel;
      }
      ghost.retreating ??= false;
      ghost.healing ??= false;
      ghost.healingElapsed ??= 0;
      ghost.healingStartHp ??= ghost.hp;
      ghost.retreatCount ??= 0;
      ghost.skillCooldown ??= 20;
      if (
        ghost.pendingStageSkill !== 'turret-jam' &&
        ghost.pendingStageSkill !== 'gold-lock' &&
        ghost.pendingStageSkill !== 'repair-lock' &&
        ghost.pendingStageSkill !== 'door-crush'
      ) ghost.pendingStageSkill = null;
      ghost.abilityCooldown ??=
        ghost.variant === "teleporter"
          ? 12
          : ghost.variant === "undead"
            ? 10
            : 20;
      ghost.controlResolve ??= 0;
      ghost.controlImmuneUntil ??= 0;
      ghost.controlResistanceNoticeLevel ??= Math.floor(ghost.controlResolve / 25);
      ghost.netTriggeredTargetRoomId ??= null;
      ghost.barrierLayers ??= this.state.difficulty.barrierLayers;
      ghost.mistUntil ??= 0;
      ghost.shieldCrossfireUntil ??= 0;
      ghost.shieldCrossfireRoomId ??= null;
      ghost.directionalShieldDisabledUntil ??= 0;
      ghost.mana ??= 0;
      ghost.maxMana ??= 100;
      ghost.abilityPhase ??= "idle";
      ghost.abilityStartedAt ??= -1;
      ghost.abilityEndsAt ??= -1;
      ghost.abilityTargetBuildingId ??= null;
      ghost.contaminatedTiles ??= [];
      ghost.contaminationEndsAt ??= -1;
      ghost.confusedUntil ??= -1;
      ghost.wanderUntil ??= -1;
      ghost.wanderTarget ??= null;
      ghost.vulnerableUntil ??= -1;
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
      player.profileRankedSeasonId = normalizeProfileRankedSeasonId(player.profileRankedSeasonId);
      player.profileRankedTier = normalizeProfileRankedTier(player.profileRankedTier);
      player.profileRankedRating = normalizeProfileRankedRating(player.profileRankedRating);
      player.appearance = normalizeAppearance(player.appearance);
      player.turretSkins = normalizeTurretSkins(player.turretSkins);
      player.bedIndex ??= null;
      player.lockedRoomId ??= null;
      player.goldIncomeElapsed = Math.max(0, finite(player.goldIncomeElapsed, 0));
      player.powerIncomeElapsed = Math.max(0, finite(player.powerIncomeElapsed, 0));
      player.rankedContribution ??= {
        activeSeconds: 0,
        turretDamage: 0,
        defenseValue: 0,
        controlSeconds: 0,
        goldSpent: 0,
        powerSpent: 0,
        diedAt: null,
        abandonedAt: null,
      };
      player.rankedContribution.activeSeconds = Math.max(
        0,
        finite(player.rankedContribution.activeSeconds, 0),
      );
      player.rankedContribution.turretDamage = Math.max(
        0,
        finite(player.rankedContribution.turretDamage, 0),
      );
      player.rankedContribution.defenseValue = Math.max(
        0,
        finite(player.rankedContribution.defenseValue, 0),
      );
      player.rankedContribution.controlSeconds = Math.max(
        0,
        finite(player.rankedContribution.controlSeconds, 0),
      );
      player.rankedContribution.goldSpent = Math.max(
        0,
        finite(player.rankedContribution.goldSpent, 0),
      );
      player.rankedContribution.powerSpent = Math.max(
        0,
        finite(player.rankedContribution.powerSpent, 0),
      );
      player.rankedContribution.diedAt ??= null;
      player.rankedContribution.abandonedAt ??= null;
      player.drawCount ??= 0;
      player.carriedLootId ??= null;
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
      player.contractProductionMultiplier ??= 1;
      player.armedSoulVialId ??= null;
      player.hideAndSeekDollBuilt ??= false;
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
      room.tileSkinId ??= '';
      room.tileSkinActivatedAt = finite(room.tileSkinActivatedAt, -1);
      room.beaconUntil ??= 0;
      room.doorBraceUntil ??= 0;
      room.doorWardUntil ??= 0;
      room.supplyTurretDamageUntil ??= 0;
      room.supplyTurretRateUntil ??= 0;
      room.supplyTurretLevelUntil ??= 0;
      room.goldSuppressedUntil = Math.min(
        this.state.elapsed + 5,
        Math.max(0, finite(room.goldSuppressedUntil, 0)),
      );
      room.goldSuppressedByGhostId ??= null;
      room.lastLatchArmedBy ??= null;
      room.lastLatchUntil ??= 0;
      room.lastDoorHitAt = finite(room.lastDoorHitAt, -1_000_000);
      room.doorRegenAccumulator = finite(room.doorRegenAccumulator, -1);
      room.freeRepairUntil = finite(room.freeRepairUntil, 0);
      room.freeRepairReadyAt = finite(room.freeRepairReadyAt, 0);
      room.freeRepairByPlayerId ??= null;
      room.doorAnchorUntil ??= 0;
      room.doorMaxHpMultiplier ??= 1;
      room.doorShieldMaxHp ??= 0;
      room.doorShieldHp ??= 0;
      this.refreshDoorShield(room, false);
    }
    this.syncGoldSuppressionState();
    for (const building of this.state.buildings) {
      building.skinId ??=
        DEFAULT_TURRET_SKINS[
          building.kind as keyof typeof DEFAULT_TURRET_SKINS
        ] ?? "";
      building.supplyNextShotMultiplier ??= 1;
      building.supplyRateUntil ??= 0;
      building.supplyRangeUntil ??= 0;
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
      building.effectiveLevel ??= building.level;
      building.overloadReadyAt ??= 0;
      building.overloadUntil ??= 0;
      building.storedSoulDamage ??= 0;
      building.berserk ??= false;
      building.soulChargeReadyAt ??= 0;
      building.soulChargeDamage ??= 0;
      building.powerPanelMode ??= 'attack';
    }
    // A Durable Object restart recreates the engine instance. Restoring the
    // objects without restoring these counters reused IDs such as
    // `building-1`, causing client render maps and detail lookup to point at
    // different buildings after reconnect. Derive counters for legacy rooms
    // and persist them for all new snapshots.
    const restoredBuildCounter = this.state.buildings.reduce((maximum, building) => {
      const match = /^(?:building-|loot-item:)(\d+)$/.exec(building.id);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    const restoredLootCounter = this.state.lootDrops.reduce((maximum, drop) => {
      const match = /^loot:(\d+)$/.exec(drop.id);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0);
    this.buildCounter = Math.max(0, data.buildCounter ?? 0, restoredBuildCounter);
    this.lootCounter = Math.max(0, data.lootCounter ?? 0, restoredLootCounter);
    this.serverSeq = this.state.serverSeq;
    this.reconnect.clear();
    for (const record of data.reconnect)
      this.reconnect.set(record.token, record);
    this.botRuntime.clear();
    for (const [id, runtime] of data.botRuntime)
      this.botRuntime.set(id, {
        ...runtime,
        bedTarget: runtime.bedTarget ?? null,
        lastMove: runtime.lastMove ?? null,
        diagnostic:
          runtime.diagnostic ??
          this.makeBotDiagnostic(
            this.state.players.find((player) => player.id === id),
          ),
        lastFailedIntent: runtime.lastFailedIntent ?? null,
        repeatedFailureCount: runtime.repeatedFailureCount ?? 0,
        idleWithResourcesSince: runtime.idleWithResourcesSince ?? null,
        idleWarningRecorded: runtime.idleWarningRecorded ?? false,
      });
  }

  serialize(): PersistedEngine {
    return {
      snapshot: this.snapshot(),
      reconnect: [...this.reconnect.values()],
      botRuntime: [...this.botRuntime.entries()],
      testMode: this.testMode,
      buildCounter: this.buildCounter,
      lootCounter: this.lootCounter,
    };
  }

  snapshot(): GameSnapshot {
    return structuredClone({ ...this.state, serverSeq: this.serverSeq });
  }

  botMatchDiagnostics(): BotMatchDiagnostic[] {
    return [...this.botRuntime.values()].map((runtime) =>
      structuredClone(runtime.diagnostic),
    );
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
        player.profileRankedSeasonId = normalizeProfileRankedSeasonId(identity.profileRankedSeasonId);
        player.profileRankedTier = normalizeProfileRankedTier(identity.profileRankedTier);
        player.profileRankedRating = normalizeProfileRankedRating(identity.profileRankedRating);
        player.profileAvatarUrl = identity.profileAvatarUrl ?? null;
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
      identity.profileAvatarUrl,
      identity.profileRankedSeasonId,
    );
    this.state.players.push(player);
    if (this.state.tutorial?.active && !player.isBot && !this.state.tutorial.reservedRoomId) {
      const nearbyRooms = this.map.rooms
        .flatMap((room) => room.beds.map((bed) => ({ room, bed })))
        .sort((left, right) =>
          distance(player.position, left.bed) - distance(player.position, right.bed),
        )
        .slice(0, 3);
      const reserved = nearbyRooms.length > 0
        ? nearbyRooms[this.rng.int(0, nearbyRooms.length - 1)]?.room
        : undefined;
      this.state.tutorial.reservedRoomId = reserved?.id ?? this.map.rooms[0]?.id ?? null;
      this.spawnTutorialLoot(this.state.tutorial.reservedRoomId);
    }
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
    const recommendedRank = recommendedRankForStage(this.stage);
    const nickname = this.state.ranked
      ? rankedBotNickname(
          this.rng,
          this.state.players.map((player) => player.nickname),
        )
      : `새벽봇 ${botIndex + 1}`;
    const bot = this.makePlayer(
      id,
      nickname,
      true,
      null,
      recommendedRank,
      recommendedRank,
      botAppearance(botIndex),
    );
    bot.profileDisplayMode = this.playMode === "multiplayer" ? "multiplayer" : "solo";
    bot.ready = true;
    this.state.players.push(bot);
    // Elite arrival presentation is reserved for real players. Bots can carry
    // a high recommended rank without flooding the lobby with join notices.
    // Let a newly spawned bot choose a bed immediately; random first-think
    // delays made the whole survivor line freeze at the beginning of a match.
    this.botRuntime.set(id, {
      difficulty,
      reaction: 0,
      bedTarget: null,
      lastMove: null,
      diagnostic: this.makeBotDiagnostic(bot),
      lastFailedIntent: null,
      repeatedFailureCount: 0,
      idleWithResourcesSince: null,
      idleWarningRecorded: false,
    });
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

  leaveRoom(playerId: string): ActionResult {
    if (this.state.status === "LOBBY") return this.leaveLobby(playerId);
    if (!this.state.ranked)
      return { ok: false, error: "진행 중인 일반 게임은 설정에서 종료해주세요." };
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId && !candidate.isBot,
    );
    if (!player) return { ok: false, error: "플레이어를 찾을 수 없습니다." };
    player.rankedContribution.abandonedAt ??= this.state.elapsed;
    player.alive = false;
    player.spectator = true;
    player.connected = false;
    player.reconnectUntil = 0;
    player.velocity = { x: 0, y: 0 };
    this.evaluateOutcome();
    return { ok: true, roomEmpty: false };
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
        return this.leaveRoom(playerId);
      case "kick-player":
        return this.kickPlayer(playerId, message.playerId);
      case "quick-chat":
        // GameRoom validates and broadcasts these short callouts before this
        // method is reached. Keep the engine switch exhaustive for tests and
        // reconnect replay safety.
        return { ok: true };
      case "game-chat":
        // Free-form team chat is validated, throttled and broadcast by the
        // room transport. It never mutates the authoritative simulation.
        return { ok: true };
      case "move":
        return this.setMovement(
          playerId,
          message.dx,
          message.dy,
          message.inputSequence,
          message.releasePosition,
        );
      case "interact":
        return this.interact(playerId);
      case "free-repair":
        return this.startFreeRepair(playerId);
      case "build":
        return this.build(playerId, message.roomId, message.tile, message.kind);
      case "move-building":
        return this.moveBuilding(playerId, message.buildingId, message.tile);
      case "upgrade":
        return this.upgrade(playerId, message.targetId);
      case "remove-building":
        return this.removeBuilding(playerId, message.buildingId);
      case "activate-building":
        return this.activateBuilding(playerId, message);
      case "draw-item":
        return this.drawItem(playerId, message.machineId);
      case "pickup-loot":
        if (this.state.tutorial?.active) {
          if (
            this.state.tutorial.step !== 'pickup-loot' ||
            message.lootId !== this.state.tutorial.guidedLootId
          )
            return { ok: false, error: "훈련 안내에 표시된 아이템부터 주워보세요." };
          const result = this.pickupLoot(playerId, message.lootId);
          if (result.ok) this.state.tutorial.step = 'claim-bed';
          return result;
        }
        return this.pickupLoot(playerId, message.lootId);
      case "set-consumable-loadout":
        return this.setConsumableLoadout(playerId, message.itemIds);
      case "use-consumable":
        if (this.state.tutorial?.active)
          return { ok: false, error: "훈련 중에는 전술 보급품을 사용할 수 없습니다." };
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
    // Ranked contracts never reveal the selected ghost. First-time ranked
    // entrants receive a dedicated blackout rules card before the shared
    // event/countdown sequence.
    this.state.status = this.state.tutorial?.active
      ? "PLAYING"
      : this.state.ranked?.firstRankedMatch
      ? 'RANKED_INTRO'
      : this.state.difficulty.modifier === 'time-attack'
        ? 'EVENT_INTRO'
        : this.state.ranked
          ? 'COUNTDOWN'
          : 'GHOST_INTRO';
    this.state.countdown = this.state.tutorial?.active
      ? 0
      : this.countdownSecondsForMatch();
    this.state.difficulty.introRemaining =
      this.state.status === 'RANKED_INTRO'
        ? 5
        : this.state.status === 'EVENT_INTRO'
          ? BALANCE.timeAttackIntroSeconds
        : this.state.status === 'GHOST_INTRO'
          ? BALANCE.ghostIntroSeconds
          : 0;
    // Countdown cargo is a short, optional opening event.  It is absent from
    // deterministic test matches so existing simulation fixtures stay stable.
    this.countdownLootPending = !this.testMode && this.rng.next() < 0.5;
    if (this.state.status === 'COUNTDOWN') this.releaseCountdownLoot();
    return { ok: true };
  }

  /**
   * Browser automation advances simulation time at 4× speed. Give every
   * automated match a deterministic 30-second wall-clock preparation window
   * so multi-client routing and bot-claim races are exercised before combat
   * can kill a test survivor. Production matches keep the authored countdown.
   */
  private countdownSecondsForMatch(): number {
    return this.testMode ? 120 : BALANCE.countdownSeconds;
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
    if (!SUPPLY_TURRET_KINDS.has(building.kind)) {
      return { ok: false, error: '같은 방의 포탑을 선택하세요.' };
    }
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

    if (item.id === 'scout-flare' && message.tile) {
      for (const ghost of this.state.ghosts) {
        if (
          ghost.hp <= 0 ||
          ghost.healing ||
          distance(ghost.position, message.tile) > SUPPLY_TARGET_RADIUS
        ) continue;
        this.applyGhostDamage(
          ghost,
          180,
          room?.id ?? ghost.targetRoomId ?? undefined,
          'basic-turret',
        );
        ghost.stunnedUntil = Math.max(
          ghost.stunnedUntil,
          this.state.elapsed + 1.5,
        );
        ghost.path = [];
      }
    } else if (item.id === 'path-chalk' && message.tile) {
      for (const ghost of this.state.ghosts) {
        if (
          ghost.hp <= 0 ||
          ghost.healing ||
          distance(ghost.position, message.tile) > SUPPLY_TARGET_RADIUS
        ) continue;
        ghost.vulnerableUntil = Math.max(
          ghost.vulnerableUntil,
          this.state.elapsed + 8,
        );
      }
    } else if (item.id === 'adrenal-shot' && room) {
      room.supplyTurretRateUntil = this.state.elapsed + 10;
    } else if (item.id === 'room-beacon' && room) {
      room.supplyTurretDamageUntil = this.state.elapsed + 10;
    } else if (SUPPLY_DOOR_HEAL[item.id] && room) {
      room.doorHp = Math.min(room.doorMaxHp, room.doorHp + (SUPPLY_DOOR_HEAL[item.id] as number));
    } else if (SUPPLY_DOOR_BRACE_SECONDS[item.id] && room) {
      room.doorBraceUntil = this.state.elapsed + (SUPPLY_DOOR_BRACE_SECONDS[item.id] as number);
    } else if (SUPPLY_DOOR_WARD_SECONDS[item.id] && room) {
      room.doorWardUntil = this.state.elapsed + (SUPPLY_DOOR_WARD_SECONDS[item.id] as number);
    } else if (item.id === 'last-latch' && room) {
      if (room.lastLatchArmedBy) return { ok: false, error: '이 문의 최후의 걸쇠는 이미 장착되어 있습니다.' };
      room.lastLatchArmedBy = player.id;
    } else if (item.target === 'building') {
      const building = this.state.buildings.find((candidate) => candidate.id === message.targetId);
      if (!building || !SUPPLY_TURRET_KINDS.has(building.kind)) {
        return { ok: false, error: '포탑을 찾을 수 없습니다.' };
      }
      if (item.id === 'toolbelt-voucher') {
        building.supplyNextShotMultiplier = Math.max(
          building.supplyNextShotMultiplier ?? 1,
          3,
        );
      } else if (item.id === 'turret-grease') {
        building.supplyRateUntil = this.state.elapsed + 12;
      } else if (item.id === 'lens-kit') {
        building.supplyRangeUntil = this.state.elapsed + 12;
      }
    } else if (item.id === 'field-crane' && room) {
      room.supplyTurretLevelUntil = this.state.elapsed + 12;
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
    releasePosition?: Vec2,
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
    if (
      this.state.status === "RANKED_INTRO" ||
      this.state.status === "GHOST_INTRO" ||
      this.state.status === "EVENT_INTRO"
    ) {
      player.velocity = { x: 0, y: 0 };
      player.lastInputSeq = inputSequence;
      return { ok: true };
    }
    if (player.roomId) {
      player.velocity = { x: 0, y: 0 };
      player.lastInputSeq = inputSequence;
      return { ok: true };
    }
    const previousVelocity = { ...player.velocity };
    const magnitude = Math.hypot(dx, dy);
    if (
      magnitude <= 0.001 &&
      releasePosition &&
      Number.isFinite(releasePosition.x) &&
      Number.isFinite(releasePosition.y)
    ) {
      const velocityMagnitude = Math.hypot(
        previousVelocity.x,
        previousVelocity.y,
      );
      const offset = {
        x: releasePosition.x - player.position.x,
        y: releasePosition.y - player.position.y,
      };
      const offsetDistance = Math.hypot(offset.x, offset.y);
      const forwardDistance =
        velocityMagnitude > 0.001
          ? (offset.x * previousVelocity.x + offset.y * previousVelocity.y) /
            velocityMagnitude
          : -1;
      // A release packet can close only the ordinary one-way-latency gap and
      // only in the direction the server was already moving. Mobile Safari
      // may deliver the release after a short render stall, so clamp the
      // correction instead of rejecting the whole position and visibly
      // rewinding the survivor toward the room entrance.
      if (
        velocityMagnitude > 0.001 &&
        offsetDistance > 0.001 &&
        forwardDistance >= -0.02
      ) {
        const correctionDistance = Math.min(offsetDistance, 1.35);
        const correctionScale = correctionDistance / offsetDistance;
        const lockedRoom = player.lockedRoomId
          ? this.map.rooms.find((room) => room.id === player.lockedRoomId)
          : undefined;
        player.position = moveInWalkableArea(
          this.map,
          player.position,
          {
            x: offset.x * correctionScale,
            y: offset.y * correctionScale,
          },
          BALANCE.player.collisionRadius,
          0.12,
          lockedRoom
            ? this.roomExitBlockTilesFor(lockedRoom.id)
            : undefined,
        );
      }
    }
    // Keep the analogue input magnitude sent by the client. Normalizing every
    // non-zero vector made the authoritative player run at full speed while
    // local prediction used the shorter touch vector, so each snapshot pulled
    // the rendered survivor forward in visible teleport-like corrections.
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    player.velocity = {
      x: dx * scale,
      y: dy * scale,
    };
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
    // A sleep press is also an explicit request to stop. This protects older
    // cached clients and a lost final movement packet from continuing to move
    // the survivor while the interaction is being resolved.
    player.velocity = { x: 0, y: 0 };
    const roomCapacity = this.playMode === "multiplayer" ? 2 : 1;
    const candidate = this.map.rooms
      .flatMap((mapRoom) => {
        const room = this.state.rooms.find((state) => state.id === mapRoom.id);
        if (!room) return [];
        return mapRoom.beds
          .map((bed, bedIndex) => ({ mapRoom, room, bed, bedIndex }))
          .filter(
            ({ mapRoom: candidateMapRoom, room: roomState, bedIndex }) =>
              roomState.ownerIds.length < roomCapacity &&
              (!player.isBot ||
                !this.roomContainsUnclaimedHuman(candidateMapRoom)) &&
              !roomState.ownerIds.some((ownerId) => {
                const owner = this.state.players.find(
                  (candidatePlayer) => candidatePlayer.id === ownerId,
                );
                return owner?.bedIndex === bedIndex;
              }),
          );
      })
      .filter(
        ({ mapRoom, bed }) =>
          (!this.state.tutorial?.reservedRoomId ||
            mapRoom.id === this.state.tutorial.reservedRoomId) &&
          // A bed is interactable only from its actual room floor.  Distance
          // alone allowed a survivor standing in the outside corner beside a
          // wall to claim the bed through that wall.
          isPositionOnRoomFloor(mapRoom, player.position) &&
          distance(player.position, bed) <=
          (this.state.elapsed < player.bedrollUntil
            ? 1.5
            : BALANCE.player.interactionRange +
              BALANCE.player.interactionLatencyGrace),
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
    const occupancyTrait = this.characterTraitForPlayer(player);
    const grantedDoorLevel = Math.min(
      maxBuildingLevel('reinforced-door'),
      1 + occupancyTrait.occupiedDoorLevelBonus,
    );
    if (grantedDoorLevel > candidate.room.doorLevel) {
      candidate.room.doorLevel = grantedDoorLevel;
      this.applyDoorMaxHp(candidate.room);
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
    // The gorilla passive is a real outer door layer, not another door-level
    // shortcut. A stronger second occupant can increase the layer, while the
    // existing damage remains preserved.
    this.refreshDoorShield(candidate.room, true);
    if (firstOccupant) {
      candidate.room.tileSkinId =
        player.appearance.tileSkin &&
        player.appearance.tileSkin !== DEFAULT_TILE_SKIN_ID
          ? player.appearance.tileSkin
          : '';
      candidate.room.tileSkinActivatedAt = this.state.elapsed;
      for (const building of this.state.buildings) {
        if (building.roomId === candidate.room.id && !building.ownerId) {
          building.ownerId = player.id;
        }
      }
    }
    this.placeCarriedLoot(player, candidate.room);
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
    if (this.state.tutorial?.active) {
      // Building actions can arrive between simulation ticks. Resolve the
      // preceding tutorial objective now so a generator acknowledgement is
      // never followed by a rejected ghost-net request from the same client.
      this.updateTutorialProgress();
      const guidedKind: Partial<Record<typeof this.state.tutorial.step, BuildingKind>> = {
        'build-turret': 'basic-turret',
        'build-generator': 'generator',
        'build-net': 'ghost-net',
      };
      if (guidedKind[this.state.tutorial.step] !== kind) {
        return { ok: false, error: "훈련 안내에 표시된 설비부터 설치하세요." };
      }
      const guidedTile = tutorialGuidedBuildTile(
        this.map,
        this.state.buildings,
        roomId,
        this.state.tutorial.step,
        playerId,
      );
      if (
        !guidedTile ||
        guidedTile.x !== tile.x ||
        guidedTile.y !== tile.y
      ) {
        return { ok: false, error: "빛나는 안내 타일에 설비를 설치하세요." };
      }
    }
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
    const ownedBuildings = this.state.buildings.filter(
      (building) => building.ownerId === playerId,
    );
    const rankedRules = this.state.ranked?.seasonRules;
    if (
      rankedRules?.constraint.kind === "turret-limit" &&
      isRankedTurretKind(kind) &&
      ownedBuildings.filter((building) => isRankedTurretKind(building.kind))
        .length >= rankedRules.constraint.maxTurrets
    )
      return {
        ok: false,
        error: `이번 시즌 공격 포탑은 최대 ${rankedRules.constraint.maxTurrets}개까지 설치할 수 있습니다.`,
      };
    const randomBoxLimit =
      rankedRules?.constraint.kind === "random-box-limit"
        ? rankedRules.constraint.maxRandomBoxes
        : 1;
    if (
      kind === "lucky-machine" &&
      ownedBuildings.filter((building) => building.kind === kind).length >=
        randomBoxLimit
    )
      return {
        ok: false,
        error: rankedRules?.constraint.kind === "random-box-limit"
          ? `이번 시즌 랜덤 상자는 최대 ${randomBoxLimit}개까지 설치할 수 있습니다.`
          : "랜덤 상자는 방마다 하나만 설치할 수 있습니다.",
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
    if (
      ["overload-capacitor", "reflect-mirror", "power-panel", "soul-vial"].includes(kind) &&
      this.state.buildings.some(
        (building) => building.ownerId === playerId && building.kind === kind,
      )
    )
      return { ok: false, error: `${BALANCE.buildings[kind].label}는 한 개만 설치할 수 있습니다.` };
    if (
      kind === "door-anchor" &&
      this.state.buildings.some(
        (building) => building.roomId === roomId && building.kind === kind,
      )
    )
      return { ok: false, error: "도어 앵커는 방마다 한 개만 설치할 수 있습니다." };
    if (
      kind === "cursed-contract" &&
      (this.state.contractUsed || this.state.buildings.some((building) => building.kind === kind))
    )
      return { ok: false, error: "저주 계약서는 이번 게임에서 이미 사용했습니다." };
    if (kind === "hide-and-seek-doll" && player.hideAndSeekDollBuilt)
      return { ok: false, error: "숨바꼭질 인형은 이번 게임에서 이미 설치했습니다." };
    const activeRank =
      this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
    if (kind === "golden-turret") {
      // Only persistent tickets unlock the catalog card. A ticket placed by a
      // lucky machine converts itself in place through activateBuilding().
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
    const trait = this.characterTraitForPlayer(player);
    const isFirstGuardian = kind === 'basic-turret' && !player.firstGuardianBuilt;
    const isLevelledTurret =
      kind === 'basic-turret'
      || kind === 'rapid-turret'
      || kind === 'arc-turret'
      || kind === 'golden-turret';
    const traitStartingLevel = isLevelledTurret
      ? trait.turretStartingLevel
      : 1;
    const firstGuardianLevel = isFirstGuardian
      ? 1 + trait.firstGuardianLevelBonus
      : 1;
    const initialLevel = Math.min(
      maxBuildingLevel(kind, activeRank),
      Math.max(1, traitStartingLevel, firstGuardianLevel),
    );
    player.gold -= buildCost.gold;
    player.power -= buildCost.power;
    player.rankedContribution.goldSpent += buildCost.gold;
    player.rankedContribution.powerSpent += buildCost.power;
    let buildingId: string;
    do {
      buildingId = `building-${++this.buildCounter}`;
    } while (this.state.buildings.some((candidate) => candidate.id === buildingId));
    const building: BuildingState = {
      id: buildingId,
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
      effectiveLevel: initialLevel,
      overloadReadyAt: kind === "overload-capacitor" ? this.state.elapsed + 60 : 0,
      overloadUntil: 0,
      storedSoulDamage: 0,
      berserk: false,
      soulChargeReadyAt: 0,
      soulChargeDamage: 0,
      powerPanelMode: "attack",
    };
    this.state.buildings.push(building);
    if (kind === "hide-and-seek-doll") player.hideAndSeekDollBuilt = true;
    if (isFirstGuardian) player.firstGuardianBuilt = true;
    if (kind === "basic-turret" || kind === "turret-enhancer")
      this.syncDynamicTurretLevels(this.createBuildingTickIndex());
    this.pendingEvents.push({ kind: "build", position: tile, playerId });
    return { ok: true };
  }

  private activateBuilding(
    playerId: string,
    message: Extract<ClientMessage, { type: "activate-building" }>,
  ): ActionResult {
    if (this.state.tutorial?.active)
      return { ok: false, error: "훈련 중에는 안내되지 않은 설비 기능을 사용할 수 없습니다." };
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const building = this.state.buildings.find((candidate) => candidate.id === message.buildingId);
    const room = building
      ? this.state.rooms.find((candidate) => candidate.id === building.roomId)
      : undefined;
    if (!player || !player.alive || !building || !room || player.roomId !== room.id || building.ownerId !== playerId)
      return { ok: false, error: "같은 방의 내 설비만 사용할 수 있습니다." };

    if (building.kind === "random-item" && building.itemId === "golden-ticket" && message.action === "install-golden-turret") {
      if (this.state.ranked?.goldenTurretPolicy === "disabled")
        return { ok: false, error: "이 랭크 계약에서는 황금 심판 포탑을 사용할 수 없습니다." };
      const activeRank = this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
      const trait = this.characterTraitForPlayer(player);
      building.kind = "golden-turret";
      building.skinId = "";
      building.level = Math.min(
        maxBuildingLevel("golden-turret", activeRank),
        Math.max(1, trait.turretStartingLevel),
      );
      building.effectiveLevel = building.level;
      building.cooldown = 0;
      building.hp = 100;
      building.investedGold = 0;
      building.investedPower = 0;
      building.investmentByPlayer = {};
      building.overloadReadyAt = 0;
      building.overloadUntil = 0;
      building.storedSoulDamage = 0;
      building.berserk = false;
      building.soulChargeReadyAt = 0;
      building.soulChargeDamage = 0;
      delete building.itemId;
      this.pendingEvents.push({
        kind: "build",
        roomId: room.id,
        playerId,
        position: { ...building.tile },
        buildingKind: "golden-turret",
        label: "황금 티켓 · 심판 포탑 설치",
      });
      return { ok: true };
    }

    if (building.kind === "overload-capacitor" && message.action === "use") {
      if (this.state.elapsed < (building.overloadReadyAt ?? 0))
        return { ok: false, error: "과부하 축전기가 아직 충전 중입니다." };
      building.overloadUntil = this.state.elapsed + buildingStats(building.kind, building.level).rate;
      building.overloadReadyAt = this.state.elapsed + buildingStats(building.kind, building.level).value;
      this.pendingEvents.push({
        kind: "ghost-skill",
        roomId: room.id,
        playerId,
        position: { ...building.tile },
        label: "포탑 폭주 · 8초",
      });
      return { ok: true };
    }

    if (
      building.kind === "power-panel" &&
      (message.action === "attack" || message.action === "defense" || message.action === "production")
    ) {
      building.powerPanelMode = message.action;
      const label = message.action === "attack" ? "공격" : message.action === "defense" ? "방어" : "생산";
      this.pendingEvents.push({
        kind: "upgrade",
        roomId: room.id,
        playerId,
        position: { ...building.tile },
        label: `배전 제어판 · ${label} 모드`,
      });
      return { ok: true };
    }

    if (building.kind === "cursed-contract" && (message.action === "berserk" || message.action === "production")) {
      if (this.state.contractUsed) return { ok: false, error: "이번 게임에서 저주 계약은 이미 끝났습니다." };
      if (message.action === "berserk") {
        const target = this.state.buildings
          .filter(
            (candidate) =>
              candidate.ownerId === playerId &&
              (candidate.kind === "basic-turret" || candidate.kind === "golden-turret"),
          )
          .sort((left, right) => (right.effectiveLevel ?? right.level) - (left.effectiveLevel ?? left.level))[0];
        if (!target) return { ok: false, error: "폭주시킬 수호 포탑이 없습니다." };
        target.berserk = true;
        room.doorMaxHpMultiplier *= 0.65;
      } else {
        player.contractProductionMultiplier *= 1.5;
        room.doorMaxHpMultiplier *= 0.5;
      }
      this.applyDoorMaxHp(room);
      this.state.contractUsed = true;
      this.consumeBuilding(building.id);
      this.pendingEvents.push({
        kind: "ghost-skill",
        roomId: room.id,
        playerId,
        position: { ...(this.map.rooms.find((candidate) => candidate.id === room.id)?.door ?? building.tile) },
        label: message.action === "berserk" ? "저주 계약 · 폭주 포탑" : "저주 계약 · 생산 증폭",
      });
      return { ok: true };
    }

    if (building.kind === "soul-vial" && message.action === "soul-arm") {
      if ((building.storedSoulDamage ?? 0) <= 0)
        return { ok: false, error: "영혼 저장병에 아직 저장된 피해가 없습니다." };
      player.armedSoulVialId = building.id;
      return { ok: true };
    }
    if (building.kind === "soul-vial" && message.action === "soul-cancel") {
      if (player.armedSoulVialId === building.id) player.armedSoulVialId = null;
      return { ok: true };
    }
    if (building.kind === "soul-vial" && message.action === "soul-fire") {
      if (player.armedSoulVialId !== building.id)
        return { ok: false, error: "먼저 영혼 저장병을 사용하세요." };
      const target = this.state.buildings.find(
        (candidate) =>
          candidate.id === message.targetId &&
          candidate.ownerId === playerId &&
          candidate.roomId === room.id &&
          (candidate.kind === "basic-turret" || candidate.kind === "golden-turret"),
      );
      if (!target) return { ok: false, error: "충전할 내 포탑을 선택하세요." };
      const storedDamage = Math.max(1, building.storedSoulDamage ?? 0);
      target.soulChargeReadyAt = this.state.elapsed + 2;
      target.soulChargeDamage = Math.max(1, Math.round(storedDamage * buildingStats(building.kind, building.level).value));
      target.cooldown = Math.max(target.cooldown, 2);
      player.armedSoulVialId = null;
      this.consumeBuilding(building.id);
      this.pendingEvents.push({
        kind: "upgrade",
        roomId: room.id,
        playerId,
        position: { ...target.tile },
        label: "영혼 레이저 충전 · 2초",
      });
      return { ok: true };
    }
    if (building.kind === "hide-and-seek-doll" && message.action === "hide-and-seek") {
      this.useHideAndSeekDoll(player, building);
      return { ok: true };
    }
    return { ok: false, error: "이 설비는 지금 사용할 수 없습니다." };
  }

  private useHideAndSeekDoll(player: PlayerState, building: BuildingState): void {
    const currentTargets = this.state.ghosts.filter(
      (ghost) => ghost.hp > 0 && !ghost.retreating && !ghost.healing,
    );
    for (const ghost of currentTargets) {
      const alternatives = this.state.rooms.filter(
        (room) =>
          room.id !== ghost.targetRoomId &&
          room.ownerIds.some((ownerId) =>
            this.state.players.some(
              (candidate) => candidate.id === ownerId && candidate.alive,
            ),
          ),
      );
      ghost.confusedUntil = this.state.elapsed + 2;
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.35);
      ghost.path = [];
      if (alternatives.length > 0) {
        const target = alternatives[this.rng.int(0, alternatives.length - 1)];
        if (target) {
          ghost.targetRoomId = target.id;
          ghost.targetPlayerId = null;
          ghost.wanderUntil = -1;
          ghost.wanderTarget = null;
        }
      } else {
        ghost.targetRoomId = null;
        ghost.targetPlayerId = null;
        ghost.wanderUntil = this.state.elapsed + 3;
        ghost.wanderTarget = this.randomCorridorTile();
      }
      this.pendingEvents.push({
        kind: "ghost-skill",
        sourceId: player.id,
        targetId: ghost.id,
        position: { ...ghost.position },
        itemId: "hide-and-seek-doll",
        label: alternatives.length > 0 ? "헤롱헤롱 · 목표 변경" : "헤롱헤롱 · 복도 방황",
      });
    }
    this.consumeBuilding(building.id);
  }

  private randomCorridorTile(): Tile | null {
    const candidates = this.map.corridorTiles;
    if (candidates.length === 0) return null;
    const tile = candidates[this.rng.int(0, candidates.length - 1)];
    return tile ? { ...tile } : null;
  }

  private consumeBuilding(buildingId: string): void {
    this.state.buildings = this.state.buildings.filter((candidate) => candidate.id !== buildingId);
  }

  private applyDoorMaxHp(room: RoomState): void {
    const baseHp = BALANCE.door.upgradeHp[room.doorLevel - 1] as number;
    room.doorMaxHp = Math.max(1, Math.floor(baseHp * room.doorMaxHpMultiplier));
    room.doorHp = Math.min(room.doorHp, room.doorMaxHp);
    this.refreshDoorShield(room, true);
  }

  private refreshDoorShield(room: RoomState, grantNewCapacity: boolean): void {
    const previousMax = Math.max(0, room.doorShieldMaxHp ?? 0);
    const ratio = room.ownerIds.reduce((maximum, ownerId) => {
      const owner = this.state.players.find((player) => player.id === ownerId);
      return owner
        ? Math.max(
            maximum,
            this.characterTraitForPlayer(owner).doorShieldRatio,
          )
        : maximum;
    }, 0);
    const nextMax = Math.max(0, Math.floor(room.doorMaxHp * ratio));
    const current = Math.max(0, room.doorShieldHp ?? 0);
    room.doorShieldMaxHp = nextMax;
    room.doorShieldHp = grantNewCapacity
      ? Math.min(nextMax, current + Math.max(0, nextMax - previousMax))
      : Math.min(nextMax, current);
  }

  upgrade(playerId: string, targetId: string): ActionResult {
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player || !player.alive || !player.roomId)
      return { ok: false, error: "업그레이드할 수 없습니다." };
    if (this.state.tutorial?.active) {
      const step = this.state.tutorial.step;
      const allowed =
        (step === 'upgrade-bed' && targetId.startsWith(`bed:${player.roomId}:`)) ||
        (step === 'upgrade-door' && targetId === `door:${player.roomId}`) ||
        (step === 'upgrade-turret' && this.state.buildings.some(
          (building) =>
            building.id === targetId &&
            building.ownerId === playerId &&
            building.kind === 'basic-turret',
        ));
      if (!allowed) {
        return { ok: false, error: "훈련 안내에 표시된 설비부터 강화하세요." };
      }
    }
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
      player.rankedContribution.goldSpent += cost.gold;
      player.rankedContribution.powerSpent += cost.power;
      if (kind === "bed") {
        room.bedLevels[bedIndex] = level + 1;
        room.bedLevel = room.bedLevels[0] ?? 1;
      } else {
        room.doorLevel += 1;
        this.applyDoorMaxHp(room);
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
    player.rankedContribution.goldSpent += cost.gold;
    player.rankedContribution.powerSpent += cost.power;
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
    if (this.state.tutorial?.active)
      return { ok: false, error: "훈련 중에는 설치한 설비를 철거할 수 없습니다." };
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
    if (building.kind === "basic-turret" || building.kind === "turret-enhancer")
      this.syncDynamicTurretLevels(this.createBuildingTickIndex());
    if (player.armedSoulVialId === buildingId) player.armedSoulVialId = null;
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
    if (this.state.tutorial?.active)
      return { ok: false, error: "훈련 중에는 설치한 설비를 이동할 수 없습니다." };
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
    if (
      building.kind === "basic-turret" ||
      building.kind === "turret-enhancer" ||
      destination?.kind === "basic-turret" ||
      destination?.kind === "turret-enhancer"
    )
      this.syncDynamicTurretLevels(this.createBuildingTickIndex());
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
    if (this.state.tutorial?.active)
      return { ok: false, error: "훈련 중에는 랜덤 상자를 사용할 수 없습니다." };
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
    // A claimed room may use its random chest throughout preparation too.
    // Waiting for PLAYING made a ready room needlessly unresponsive while the
    // countdown was still visible.
    if (this.state.status !== "COUNTDOWN" && this.state.status !== "PLAYING" && this.state.status !== 'OVERTIME')
      return { ok: false, error: "게임 준비 또는 전투 중에만 뽑을 수 있습니다." };
    const drawLimit = drawLimitForMatch(player.appearance, Boolean(this.state.ranked));
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
    const item = randomItemForRoll(
      this.rng.next(),
      characterTraitForMatch(
        player.appearance,
        Boolean(this.state.ranked),
      ).highRarityChanceBonus,
    );
    if (!item)
      return { ok: false, error: "아이템 목록을 불러오지 못했습니다." };
    // A draw is no longer an invisible bag bonus.  The machine itself turns
    // into a removable reward object, so every buff has an obvious physical
    // source in the claimed room.
    const rewardKind = this.rewardBuildingKind(item.id);
    machine.kind = rewardKind;
    machine.itemId = item.id;
    machine.skinId = '';
    machine.level = rewardKind === 'gem-core' ? this.rollMoonGemLevel() : 1;
    machine.cooldown = 0;
    machine.hp = 100;
    machine.investedGold = 0;
    machine.investedPower = 0;
    machine.investmentByPlayer = {};
    if (rewardKind === 'random-item') this.activateRandomItem(player, item.id, machine.roomId);
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

  private rewardBuildingKind(itemId: string): BuildingKind {
    return getRandomItem(itemId)?.effect.moonGem ? 'gem-core' : 'random-item';
  }

  /** Economic moon gems mostly start low, but a lucky draw can skip ahead. */
  private rollMoonGemLevel(): number {
    const roll = this.rng.next();
    if (roll < 0.52) return 1;
    if (roll < 0.77) return 2;
    if (roll < 0.90) return 3;
    if (roll < 0.97) return 4;
    if (roll < 0.992) return 5;
    if (roll < 0.999) return 6;
    return 7;
  }

  /** Returns the effects from old saved inventory plus visible placed rewards. */
  private itemEffectsFor(player: PlayerState) {
    const placed = this.state.buildings
      .filter((building) => building.ownerId === player.id && building.kind === 'random-item' && building.itemId)
      .map((building) => ({ itemId: building.itemId as string, count: 1 }));
    return combinedItemEffects([...player.items, ...placed]);
  }

  private activateRandomItem(player: PlayerState, itemId: string, roomId: string): void {
    const item = getRandomItem(itemId);
    if (!item) return;
    if (item.effect.turretLevelIncrease) {
      const amount = Math.max(0, Math.floor(item.effect.turretLevelIncrease));
      for (const building of this.state.buildings) {
        if (building.ownerId !== player.id || !['basic-turret', 'rapid-turret', 'arc-turret', 'golden-turret'].includes(building.kind)) continue;
        building.level = Math.min(maxBuildingLevel(building.kind), building.level + amount);
      }
    }
    if (item.effect.doorHpMultiplier) {
      const room = this.state.rooms.find((candidate) => candidate.id === roomId);
      if (!room) return;
      const gained = room.doorMaxHp * (item.effect.doorHpMultiplier - 1);
      room.doorMaxHp += gained;
      if (room.doorHp > 0) room.doorHp += gained;
    }
  }

  private releaseCountdownLoot(): void {
    if (!this.countdownLootPending || this.state.lootDrops.length > 0) return;
    this.countdownLootPending = false;
    const candidates = [...this.map.corridorTiles]
      .filter((tile) => distance(tile, this.map.playerSpawn) > 3)
      .sort(() => this.rng.next() - 0.5);
    const count = Math.min(candidates.length, 5 + Math.floor(this.rng.next() * 3));
    for (let index = 0; index < count; index += 1) {
      const tile = candidates[index];
      if (!tile) continue;
      // Countdown loot is deliberately an early economic catch-up.  Gold and
      // power producers account for most drops, while combat utility remains
      // possible but uncommon.
      const countdownPool = RANDOM_ITEMS.filter((item) =>
        item.effect.goldPerSecond || item.effect.powerPerSecond || item.effect.moonGem
          ? true
          : this.rng.next() < 0.18,
      );
      const pool = countdownPool.length > 0 ? countdownPool : RANDOM_ITEMS;
      const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
      let roll = this.rng.next() * totalWeight;
      const item = pool.find((candidate) => (roll -= candidate.weight) <= 0) ?? pool[pool.length - 1];
      if (!item) continue;
      const now = this.matchClock();
      let lootId: string;
      do {
        lootId = `loot:${++this.lootCounter}`;
      } while (this.state.lootDrops.some((candidate) => candidate.id === lootId));
      const drop = {
        id: lootId,
        itemId: item.id,
        tile: { ...tile },
        spawnedAt: now,
        landsAt: now + 3,
        carriedBy: null,
      };
      this.state.lootDrops.push(drop);
      this.pendingEvents.push({ kind: 'item-drop', itemId: item.id, label: item.label, rarity: item.rarity, position: { ...tile } });
    }
  }

  private pickupLoot(playerId: string, lootId: string): ActionResult {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const drop = this.state.lootDrops.find((candidate) => candidate.id === lootId);
    if (!player || !player.alive || player.roomId || player.carriedLootId || !drop || drop.carriedBy || this.matchClock() < drop.landsAt) {
      return { ok: false, error: '지금은 이 보상을 주울 수 없습니다.' };
    }
    if (distance(player.position, drop.tile) > BALANCE.player.interactionRange) {
      return { ok: false, error: '보상 가까이로 이동하세요.' };
    }
    drop.carriedBy = player.id;
    player.carriedLootId = drop.id;
    const item = getRandomItem(drop.itemId);
    this.pendingEvents.push({ kind: 'item-pickup', playerId, itemId: drop.itemId, label: item?.label ?? '랜덤 보상', rarity: item?.rarity, position: { ...drop.tile } });
    return { ok: true };
  }

  private spawnTutorialLoot(roomId: string | null): void {
    const tutorial = this.state.tutorial;
    if (!tutorial?.active || tutorial.guidedLootId || !roomId) return;
    const room = this.map.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    const respawnKeys = new Set(
      this.map.respawnZones.map((zone) => tileKey(zone.x, zone.y)),
    );
    const candidates = this.map.corridorTiles
      .filter((tile) => {
        const fromDoor = Math.abs(tile.x - room.door.x) + Math.abs(tile.y - room.door.y);
        return fromDoor >= 2 && fromDoor <= 5 && !respawnKeys.has(tileKey(tile.x, tile.y));
      })
      .sort((left, right) => {
        const leftRoute = distance(this.map.playerSpawn, left) + distance(left, room.door);
        const rightRoute = distance(this.map.playerSpawn, right) + distance(right, room.door);
        return leftRoute - rightRoute;
      });
    const tile = candidates[0] ?? this.map.corridorTiles
      .filter((candidate) => tileKey(candidate.x, candidate.y) !== tileKey(room.door.x, room.door.y))
      .sort((left, right) => distance(left, room.door) - distance(right, room.door))[0];
    if (!tile) return;
    let lootId: string;
    do {
      lootId = `tutorial-loot:${++this.lootCounter}`;
    } while (this.state.lootDrops.some((candidate) => candidate.id === lootId));
    this.state.lootDrops = [{
      id: lootId,
      itemId: 'copper-pig',
      tile: { ...tile },
      spawnedAt: 0,
      landsAt: 0,
      carriedBy: null,
    }];
    tutorial.guidedLootId = lootId;
  }

  private placeCarriedLoot(player: PlayerState, room: RoomState): void {
    if (!player.carriedLootId) return;
    const drop = this.state.lootDrops.find((candidate) => candidate.id === player.carriedLootId && candidate.carriedBy === player.id);
    const mapRoom = this.map.rooms.find((candidate) => candidate.id === room.id);
    const tile = mapRoom?.buildTiles
      .filter((candidate) => !this.state.buildings.some((building) => building.tile.x === candidate.x && building.tile.y === candidate.y))
      .sort(() => this.rng.next() - 0.5)[0];
    if (!drop || !tile) return;
    const rewardKind = this.rewardBuildingKind(drop.itemId);
    let buildingId: string;
    do {
      buildingId = `loot-item:${++this.buildCounter}`;
    } while (this.state.buildings.some((candidate) => candidate.id === buildingId));
    const building: BuildingState = {
      id: buildingId,
      kind: rewardKind,
      itemId: drop.itemId,
      roomId: room.id,
      ownerId: player.id,
      skinId: '',
      tile: { ...tile, roomId: room.id },
      level: rewardKind === 'gem-core' ? this.rollMoonGemLevel() : 1,
      cooldown: 0,
      hp: 100,
      investedGold: 0,
      investedPower: 0,
      investmentByPlayer: {},
    };
    this.state.buildings.push(building);
    this.state.lootDrops = this.state.lootDrops.filter((candidate) => candidate.id !== drop.id);
    player.carriedLootId = null;
    if (rewardKind === 'random-item') this.activateRandomItem(player, drop.itemId, room.id);
    const item = getRandomItem(drop.itemId);
    this.pendingEvents.push({ kind: 'build', playerId: player.id, roomId: room.id, buildingKind: rewardKind, itemId: drop.itemId, label: item?.label ?? '랜덤 보상', position: { ...tile } });
  }

  private matchClock(): number {
    if (this.state.status === 'COUNTDOWN')
      return Math.max(0, BALANCE.countdownSeconds - this.state.countdown);
    if (this.state.status === 'PLAYING' || this.state.status === 'OVERTIME')
      return BALANCE.countdownSeconds + this.state.elapsed;
    return 0;
  }

  private grantTutorialResource(
    player: PlayerState,
    resource: 'gold' | 'power',
    minimum: number,
  ): void {
    const granted = Math.max(0, minimum - player[resource]);
    if (granted <= 0) return;
    player[resource] += granted;
    this.pendingEvents.push({
      kind: resource,
      playerId: player.id,
      amount: granted,
      position: { ...player.position },
      label: '훈련 지원',
    });
  }

  /**
   * The first match is an authoritative lesson, not a client-only checklist.
   * Each completed action unlocks exactly one next action and enough training
   * resources to perform it without waiting or accidentally skipping ahead.
   */
  private updateTutorialProgress(): void {
    const tutorial = this.state.tutorial;
    if (!tutorial?.active) return;
    const player = this.state.players.find((candidate) => !candidate.isBot);
    if (!player) return;
    const room = player.roomId
      ? this.state.rooms.find((candidate) => candidate.id === player.roomId)
      : undefined;
    const buildings = room
      ? this.state.buildings.filter(
          (building) => building.roomId === room.id && building.ownerId === player.id,
        )
      : [];
    const turret = buildings.find((building) => building.kind === 'basic-turret');

    if (tutorial.step === 'claim-bed' && room) {
      tutorial.step = 'upgrade-bed';
      this.grantTutorialResource(player, 'gold', upgradeCost('bed', 2, player.soloRank).gold);
    }
    if (
      tutorial.step === 'upgrade-bed' &&
      room &&
      (room.bedLevels[player.bedIndex ?? 0] ?? 1) >= 2
    ) {
      tutorial.step = 'upgrade-door';
      this.grantTutorialResource(player, 'gold', upgradeCost('reinforced-door', 2, player.soloRank).gold);
    }
    if (tutorial.step === 'upgrade-door' && room && room.doorLevel >= 2) {
      tutorial.step = 'build-turret';
      this.grantTutorialResource(player, 'gold', upgradeCost('basic-turret', 1, player.soloRank).gold);
    }
    if (tutorial.step === 'build-turret' && turret) {
      tutorial.step = 'upgrade-turret';
      this.grantTutorialResource(player, 'gold', upgradeCost('basic-turret', 2, player.soloRank).gold);
    }
    if (tutorial.step === 'upgrade-turret' && turret && turret.level >= 2) {
      tutorial.step = 'build-generator';
      this.grantTutorialResource(player, 'gold', upgradeCost('generator', 1, player.soloRank).gold);
    }

    const primaryGhost = this.state.ghosts.find((ghost) => ghost.variant !== 'minion');
    if (
      tutorial.step === 'build-generator' &&
      buildings.some((building) => building.kind === 'generator')
    ) {
      tutorial.step = 'build-net';
    }
    if (
      tutorial.step === 'build-net' &&
      buildings.some((building) => building.kind === 'ghost-net')
    ) {
      tutorial.step = 'finish';
      tutorial.netTriggered = false;
      tutorial.combatRevealRemaining = 2;
      tutorial.combatStarted = false;
    }
    if (
      tutorial.step === 'finish' &&
      tutorial.combatStarted &&
      primaryGhost &&
      primaryGhost.hp > 0 &&
      turret
    ) {
      primaryGhost.retreating = false;
      primaryGhost.healing = false;
      primaryGhost.targetRoomId = room?.id ?? null;
      primaryGhost.targetPlayerId = null;
      primaryGhost.path = [];
    }
  }

  tick(realDt: number, now = Date.now()): void {
    const dt = clamp(realDt, 0, 0.1) * (this.testMode ? 4 : 1);
    this.serverSeq += 1;
    this.expireDisconnected(now);
    if (this.state.tutorial?.active && this.state.tutorial.pauseRemaining > 0) {
      this.state.tutorial.pauseRemaining = Math.max(
        0,
        this.state.tutorial.pauseRemaining - dt,
      );
      for (const player of this.state.players) player.velocity = { x: 0, y: 0 };
      this.updateTutorialProgress();
      this.sanitizeResources();
      return;
    }
    this.updatePlayers(dt);
    this.updateBots(dt);
    if (this.state.status === 'RANKED_INTRO') {
      this.state.difficulty.introRemaining = Math.max(0, this.state.difficulty.introRemaining - dt);
      if (this.state.difficulty.introRemaining <= 0) {
        if (this.state.difficulty.modifier === 'time-attack') {
          this.state.status = 'EVENT_INTRO';
          this.state.difficulty.introRemaining = BALANCE.timeAttackIntroSeconds;
        } else {
          this.state.status = 'COUNTDOWN';
          this.state.countdown = this.countdownSecondsForMatch();
          this.releaseCountdownLoot();
        }
      }
    } else if (this.state.status === 'GHOST_INTRO') {
      // Ghost warning posters freeze survivor, bot and combat simulation.
      // The client keeps the card opaque for two seconds, then fades it over
      // the remaining two seconds before the countdown begins.
      this.state.difficulty.introRemaining = Math.max(0, this.state.difficulty.introRemaining - dt);
      if (this.state.difficulty.introRemaining <= 0) {
        this.state.status = 'COUNTDOWN';
        this.state.countdown = this.countdownSecondsForMatch();
        this.releaseCountdownLoot();
      }
    } else if (this.state.status === 'EVENT_INTRO') {
      // Time Attack is shown first, then the normal per-ghost warning poster.
      this.state.difficulty.introRemaining = Math.max(0, this.state.difficulty.introRemaining - dt);
      if (this.state.difficulty.introRemaining <= 0) {
        if (this.state.ranked) {
          this.state.status = 'COUNTDOWN';
          this.state.countdown = this.countdownSecondsForMatch();
          this.releaseCountdownLoot();
        } else {
          this.state.status = 'GHOST_INTRO';
          this.state.difficulty.introRemaining = BALANCE.ghostIntroSeconds;
        }
      }
    } else if (this.state.status === "COUNTDOWN") {
      this.updateTutorialProgress();
      this.updateEconomy(dt);
      // Only ranked matches use the blackout pursuit. In normal modes the
      // ghost remains idle until the countdown reaches zero.
      if (this.state.ranked) this.updateBlackoutGhosts(dt);
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown <= 0) this.beginPlaying();
    } else if (this.state.status === "PLAYING" || this.state.status === 'OVERTIME') {
      this.state.elapsed += dt;
      const tutorial = this.state.tutorial;
      if (
        tutorial?.active &&
        tutorial.step === "finish" &&
        !tutorial.combatStarted
      ) {
        tutorial.combatRevealRemaining = Math.max(
          0,
          tutorial.combatRevealRemaining - dt,
        );
        if (tutorial.combatRevealRemaining <= 0) {
          tutorial.combatStarted = true;
          this.beginTutorialGhostCombat();
          this.pendingEvents.push({
            kind: "lights-on",
            label: "귀신이 움직입니다",
          });
        }
      }
      if (this.state.ranked) {
        for (const player of this.state.players) {
          if (player.alive && player.connected)
            player.rankedContribution.activeSeconds += dt;
        }
      }
      if (this.state.status === 'PLAYING' && this.state.difficulty.timeAttackRemaining !== null) {
        this.state.difficulty.timeAttackRemaining = Math.max(0, this.state.difficulty.timeAttackRemaining - dt);
        if (this.state.difficulty.timeAttackRemaining <= 0) this.beginOvertime();
      }
      if (this.state.status === 'OVERTIME') this.updateOvertime(dt);
      const buildingIndex = this.createBuildingTickIndex();
      this.syncDynamicTurretLevels(buildingIndex);
      this.updateEconomy(dt);
      this.updateBuildings(dt, buildingIndex);
      this.updateFreeDoorRepairs(dt);
      this.updateTutorialProgress();
      if ((this.state.tutorial?.pauseRemaining ?? 0) > 0) {
        this.sanitizeResources();
        return;
      }
      this.updateGhosts(dt);
      this.updateTutorialProgress();
      this.updateDoorRegeneration(dt);
      this.evaluateOutcome();
    }
    this.sanitizeResources();
  }

  private createBuildingTickIndex(): BuildingTickIndex {
    const roomsById = new Map(
      this.state.rooms.map((room) => [room.id, room] as const),
    );
    const ownersById = new Map(
      this.state.players.map((player) => [player.id, player] as const),
    );
    const buildingsByOwner = new Map<string, BuildingState[]>();
    const adjacentEnhancersByTurret = new Map<string, number>();
    for (const building of this.state.buildings) {
      const owned = buildingsByOwner.get(building.ownerId);
      if (owned) owned.push(building);
      else buildingsByOwner.set(building.ownerId, [building]);
      if (building.kind !== "turret-enhancer") continue;
      const adjacentTiles = [
        { x: building.tile.x - 1, y: building.tile.y },
        { x: building.tile.x + 1, y: building.tile.y },
        { x: building.tile.x, y: building.tile.y - 1 },
        { x: building.tile.x, y: building.tile.y + 1 },
      ];
      for (const tile of adjacentTiles) {
        const key = `${building.ownerId}:${building.roomId}:${tile.x}:${tile.y}`;
        adjacentEnhancersByTurret.set(
          key,
          (adjacentEnhancersByTurret.get(key) ?? 0) + 1,
        );
      }
    }
    return {
      roomsById,
      ownersById,
      buildingsByOwner,
      adjacentEnhancersByTurret,
    };
  }

  private syncDynamicTurretLevels(index: BuildingTickIndex): void {
    for (const turret of this.state.buildings) {
      if (turret.kind !== "basic-turret") continue;
      const adjacentEnhancers = index.adjacentEnhancersByTurret.get(
        `${turret.ownerId}:${turret.roomId}:${turret.tile.x}:${turret.tile.y}`,
      ) ?? 0;
      turret.effectiveLevel = turret.level + adjacentEnhancers;
    }
  }

  private beginPlaying(): void {
    this.state.status = "PLAYING";
    for (const player of this.state.players) {
      if (!player.alive) continue;
      const enteredRoom = this.map.rooms.find((room) =>
        isPositionOnRoomFloor(room, player.position),
      );
      // The countdown ending closes the door only for survivors who already
      // reached a room. Survivors still in a corridor retain the existing
      // last-chance route to an unoccupied bed.
      player.lockedRoomId = player.roomId ?? enteredRoom?.id ?? null;
    }
    const combatants = Math.max(
      1,
      this.state.players.filter((player) => player.alive).length,
    );
    const maxHp =
      BALANCE.ghost.baseHp * (1 + BALANCE.ghost.hpPerPlayer * (combatants - 1));
    const rankPressure = this.humanRankPressure();
    for (const ghost of this.state.ghosts) {
      const variantHp =
        ghost.variant === "brute"
          ? 1.45
          : ghost.variant.startsWith("twin")
            ? 0.68
            : ghost.variant === "swift"
              ? 0.84
              : 1;
      ghost.maxHp = this.state.tutorial?.active
        // A Lv.2 tutorial turret visibly removes about one tenth per shot.
        // Before the net lesson it cannot land a lethal hit; the net then
        // prepares the final, one-shot finish.
        ? Math.ceil(buildingStats('basic-turret', 2).value * 10)
        : (this.testMode ? maxHp * 0.34 : maxHp) *
          variantHp *
          this.stage.hpMultiplier *
          rankPressure;
      ghost.hp = ghost.maxHp;
      // Keep the position reached during the blackout hunt. Reset only the
      // scouting target so the normal room/door combat selector takes over.
      ghost.targetPlayerId = null;
      ghost.targetRoomId = null;
      ghost.wanderTarget = null;
      ghost.wanderUntil = -1;
      ghost.path = [];
    }
    // 점유는 interact()만 허용한다. 준비 시간이 끝났다고 빈 침대를
    // 강제 배정하지 않아, 미점유 생존자는 복도에서 빈 방을 직접 찾아야 한다.
    this.syncPrimaryGhost();
    this.pendingEvents.push({
      kind: "lights-on",
      label: "복도 불이 켜졌습니다. 귀신의 공격이 시작됩니다!",
    });
  }

  /**
   * Tutorial matches enter PLAYING immediately, so the regular countdown
   * initialisation never runs. Reset the practice ghost at the exact moment
   * the final lesson releases it instead of leaving it with stage HP.
   */
  private beginTutorialGhostCombat(): void {
    if (!this.state.tutorial?.active) return;
    const maxHp = Math.ceil(buildingStats("basic-turret", 2).value * 10);
    for (const ghost of this.state.ghosts) {
      if (ghost.variant === "minion") continue;
      ghost.maxHp = maxHp;
      ghost.hp = maxHp;
      ghost.retreating = false;
      ghost.healing = false;
      ghost.path = [];
      ghost.attackCooldown = 0;
    }
  }

  private beginOvertime(): void {
    if (this.state.status === 'OVERTIME') return;
    this.state.status = 'OVERTIME';
    this.state.difficulty.overtimeStacks = 0;
    this.applyOvertimeGrowth();
    this.pendingEvents.push({
      kind: 'ghost-skill',
      position: { ...this.state.ghost.position },
      targetId: this.state.ghost.id,
      label: TIME_ATTACK_EXPIRED_MESSAGE,
    });
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
    for (const player of this.state.players) {
      if (!player.alive) continue;
      if (player.roomId) {
        const bed = this.map.rooms.find((room) => room.id === player.roomId)
          ?.beds[player.bedIndex ?? 0];
        if (bed) player.position = { ...bed };
        player.velocity = { x: 0, y: 0 };
        continue;
      }
      const speed = this.unclaimedPlayerSpeed(player);
      const lockedRoom = player.lockedRoomId
        ? this.map.rooms.find((room) => room.id === player.lockedRoomId)
        : undefined;
      player.position = moveInWalkableArea(
        this.map,
        player.position,
        {
          x: player.velocity.x * speed * dt,
          y: player.velocity.y * speed * dt,
        },
        BALANCE.player.collisionRadius,
        0.12,
        lockedRoom ? this.roomExitBlockTilesFor(lockedRoom.id) : undefined,
      );
    }
  }

  /**
   * The countdown door lock must be authoritative. Blocking every walkable
   * tile outside the entered room keeps the shared movement solver from
   * leaking a survivor through the doorway on a large or delayed input.
   */
  private roomExitBlockTilesFor(roomId: string): ReadonlySet<string> {
    const cached = this.roomExitBlockTiles.get(roomId);
    if (cached) return cached;
    const room = this.map.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return new Set<string>();
    const inside = new Set(room.floorTiles.map((tile) => `${tile.x},${tile.y}`));
    const blocked = new Set(
      this.map.walkable
        .filter((tile) => !inside.has(`${tile.x},${tile.y}`))
        .map((tile) => `${tile.x},${tile.y}`),
    );
    this.roomExitBlockTiles.set(roomId, blocked);
    return blocked;
  }

  private characterTraitForPlayer(player: PlayerState) {
    return characterTraitForMatch(player.appearance, Boolean(this.state.ranked));
  }

  private unclaimedPlayerSpeed(player: PlayerState): number {
    const rank =
      this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
    const baseSpeed = player.isBot ? BOT_BASE_SPEED : BALANCE.player.speed;
    return (
      baseSpeed *
      rankBenefits(rank).speedMultiplier *
      this.characterTraitForPlayer(player)
        .unclaimedMoveSpeedMultiplier *
      (this.state.elapsed < player.speedBoostUntil ? 1.45 : 1)
    );
  }

  private updateBots(dt: number): void {
    if (this.state.status !== 'COUNTDOWN' && this.state.status !== 'PLAYING' && this.state.status !== 'OVERTIME') return;
    for (const bot of this.state.players.filter((player) => player.isBot)) {
      const runtime = this.botRuntime.get(bot.id);
      if (!runtime) continue;
      const difficulty = this.effectiveBotDifficulty(runtime.difficulty);
      if (!bot.roomId) {
        if (!this.isAvailableBotBedTarget(runtime.bedTarget))
          runtime.bedTarget = this.reserveBedForBot(bot);
        // Repathing on every simulation tick makes a bot flip between two
        // rounded A* waypoints right at a doorway.  Keep the chosen vector for
        // a short, fixed window: it is smooth on the client and still reacts
        // before it can overshoot a tile.
        runtime.reaction -= dt;
        if (runtime.reaction > 0) continue;
        const intent = decideBotIntent(
          bot,
          this.state,
          this.map,
          difficulty,
          runtime.bedTarget,
        );
        this.applyBotIntent(
          bot.id,
          intent,
        );
        // Human survivors are 30% faster, so refresh a
        // corridor waypoint every simulation step so bots do not overshoot
        // it, reverse, and visibly stutter at a room entrance.
        runtime.reaction = intent.type === 'move' ? 0.1 : 0.28;
        if (bot.roomId) {
          runtime.bedTarget = null;
          runtime.reaction = 0;
        }
        continue;
      }
      runtime.reaction -= dt;
      if (runtime.reaction > 0) continue;
      runtime.reaction =
        BOT_REACTION_SECONDS[difficulty] *
        (0.8 + this.rng.next() * 0.45);
      const intent = decideBotIntent(
        bot,
        this.state,
        this.map,
        difficulty,
      );
      this.applyBotIntent(bot.id, intent);
    }
  }

  /**
   * Early stages leave deliberately imperfect bots intact. From 어려움 onward
   * even an easy fill bot understands the basic economy/defence loop, and from
   * 지옥 onward every fill bot uses the full pressure-response policy. This
   * keeps bot intelligence aligned with the encounter instead of only with the
   * lobby button that originally created it.
   */
  private effectiveBotDifficulty(base: BotDifficulty): BotDifficulty {
    if (this.stage.index >= 21) return 'hard';
    if (this.stage.index >= 6 && base === 'easy') return 'normal';
    return base;
  }

  private makeBotDiagnostic(player?: PlayerState): BotMatchDiagnostic {
    const identity = player ?? {
      id: 'unknown-bot',
      nickname: '새벽봇',
    };
    return {
      botId: identity.id,
      strategy: botStrategyFor(identity),
      rank: player
        ? this.playMode === 'solo'
          ? player.soloRank
          : player.multiplayerRank
        : 'beginner',
      claimedAt: player?.roomId ? this.state.elapsed : null,
      firstTurretAt: null,
      firstDoorUpgradeAt: null,
      supportBuildingActions: 0,
      diedAt: player && !player.alive ? this.state.elapsed : null,
      idleWithResourcesWarnings: 0,
      repeatedFailureWarnings: 0,
    };
  }

  private isAvailableBotBedTarget(target: BotBedTarget | null): target is BotBedTarget {
    if (!target) return false;
    const mapRoom = this.map.rooms.find((room) => room.id === target.roomId);
    const room = this.state.rooms.find((candidate) => candidate.id === target.roomId);
    if (!mapRoom || !room || !mapRoom.beds[target.bedIndex]) return false;
    // Entering a room is the human's claim intent. A bot that reserved the bed
    // a moment earlier must yield instead of closing that room around the
    // survivor and making the sleep prompt disappear.
    if (this.roomContainsUnclaimedHuman(mapRoom)) return false;
    const roomCapacity = this.playMode === 'multiplayer' ? 2 : 1;
    if (room.ownerIds.length >= roomCapacity) return false;
    return !room.ownerIds.some((ownerId) =>
      this.state.players.find((player) => player.id === ownerId)?.bedIndex === target.bedIndex,
    );
  }

  private roomContainsUnclaimedHuman(
    room: MapDefinition['rooms'][number],
  ): boolean {
    return this.state.players.some(
      (player) =>
        player.alive &&
        !player.isBot &&
        !player.roomId &&
        isPositionOnRoomFloor(room, player.position),
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
    const runtime = this.botRuntime.get(botId);
    const botBefore = this.state.players.find((player) => player.id === botId);
    const roomBefore = botBefore?.roomId ?? null;
    let result: ActionResult | null = null;
    if (intent.type === "move") {
      let dx = intent.dx;
      let dy = intent.dy;
      const previous = runtime?.lastMove;
      // A fresh path can select the prior grid node after a high-speed bot
      // crossed its centre. Ease a sharp reversal through the current
      // heading instead of showing a one-frame backward step.
      if (previous && previous.x * dx + previous.y * dy < -0.05) {
        const easedX = previous.x * 0.78 + dx * 0.22;
        const easedY = previous.y * 0.78 + dy * 0.22;
        const magnitude = Math.hypot(easedX, easedY);
        if (magnitude > 0.001) {
          dx = easedX / magnitude;
          dy = easedY / magnitude;
        }
      }
      result = this.setMovement(botId, dx, dy, this.serverSeq);
      if (runtime) runtime.lastMove = { x: dx, y: dy };
    }
    else {
      const bot = this.state.players.find((player) => player.id === botId);
      if (bot) bot.velocity = { x: 0, y: 0 };
      if (runtime) runtime.lastMove = null;
      if (intent.type === "interact") result = this.interact(botId);
      else if (intent.type === "build")
        result = this.build(botId, intent.roomId, intent.tile, intent.kind);
      else if (intent.type === "move-building")
        result = this.moveBuilding(botId, intent.buildingId, intent.tile);
      else if (intent.type === "upgrade")
        result = this.upgrade(botId, intent.targetId);
      else if (intent.type === "activate-building")
        result = this.activateBuilding(botId, {
          type: "activate-building",
          buildingId: intent.buildingId,
          action: intent.action,
          sequence: this.serverSeq,
          timestamp: Date.now(),
        });
    }
    this.recordBotIntentOutcome(botId, intent, result, roomBefore);
  }

  private recordBotIntentOutcome(
    botId: string,
    intent: BotIntent,
    result: ActionResult | null,
    roomBefore: string | null,
  ): void {
    const runtime = this.botRuntime.get(botId);
    const bot = this.state.players.find((player) => player.id === botId);
    if (!runtime || !bot) return;
    const diagnostic = runtime.diagnostic;
    if (intent.type === 'interact' && result?.ok && !roomBefore && bot.roomId)
      diagnostic.claimedAt ??= this.state.elapsed;
    if (
      intent.type === 'build' &&
      result?.ok &&
      (intent.kind === 'basic-turret' || intent.kind === 'golden-turret')
    )
      diagnostic.firstTurretAt ??= this.state.elapsed;
    if (
      intent.type === 'upgrade' &&
      result?.ok &&
      intent.targetId.startsWith('door:')
    )
      diagnostic.firstDoorUpgradeAt ??= this.state.elapsed;
    if (
      (intent.type === 'build' &&
        result?.ok &&
        BOT_SUPPORT_BUILD_KINDS.has(intent.kind)) ||
      (intent.type === 'activate-building' && result?.ok)
    )
      diagnostic.supportBuildingActions += 1;

    const hasSpendableResources =
      Boolean(bot.roomId) && (bot.gold >= 10 || bot.power >= 32);
    if (intent.type === 'idle' && hasSpendableResources) {
      runtime.idleWithResourcesSince ??= this.state.elapsed;
      if (
        !runtime.idleWarningRecorded &&
        this.state.elapsed - runtime.idleWithResourcesSince >= 5
      ) {
        diagnostic.idleWithResourcesWarnings += 1;
        runtime.idleWarningRecorded = true;
      }
    } else {
      runtime.idleWithResourcesSince = null;
      runtime.idleWarningRecorded = false;
    }

    if (result && !result.ok) {
      const signature = JSON.stringify(intent);
      runtime.repeatedFailureCount =
        runtime.lastFailedIntent === signature
          ? runtime.repeatedFailureCount + 1
          : 1;
      runtime.lastFailedIntent = signature;
      if (runtime.repeatedFailureCount === 3)
        diagnostic.repeatedFailureWarnings += 1;
    } else if (result?.ok) {
      runtime.lastFailedIntent = null;
      runtime.repeatedFailureCount = 0;
    }
  }

  /**
   * Recommended-rank bots receive their own rank economy, but they must not
   * silently raise enemy stats for the human party. Only living humans define
   * the rank-pressure multiplier.
   */
  private humanRankPressure(): number {
    return Math.max(
      1,
      ...this.state.players
        .filter((player) => player.alive && !player.isBot)
        .map(
          (player) =>
            rankBenefits(
              this.playMode === "solo"
                ? player.soloRank
                : player.multiplayerRank,
            ).ghostDifficultyMultiplier,
        ),
    );
  }

  private updateEconomy(dt: number): void {
    this.syncGoldSuppressionState();
    for (const player of this.state.players) {
      if (!player.alive || !player.roomId) continue;
      const room = this.state.rooms.find(
        (candidate) => candidate.id === player.roomId,
      );
      if (!room) continue;
      const mapRoom = this.map.rooms.find(
        (candidate) => candidate.id === player.roomId,
      );
      const effects = this.itemEffectsFor(player);
      const inventoryEffects = combinedItemEffects(player.items);
      const placedItemBuildings = this.state.buildings.filter(
        (building) =>
          building.ownerId === player.id &&
          building.kind === 'random-item' &&
          building.itemId &&
          !this.isBuildingContaminated(building),
      );
      const activeRank =
        this.playMode === "solo" ? player.soloRank : player.multiplayerRank;
      const panelMode = this.state.buildings.find(
        (building) => building.ownerId === player.id && building.kind === "power-panel",
      )?.powerPanelMode;
      const panelProductionMultiplier = panelMode === "production" ? 1.25 : panelMode === "defense" ? 0.85 : 1;
      const productionMultiplier = player.contractProductionMultiplier * panelProductionMultiplier;
      const bedLevel = room.bedLevels[player.bedIndex ?? 0] ?? 1;
      const goldBuildings = this.state.buildings.filter(
        (building) =>
          building.ownerId === player.id &&
          (building.kind === "gem-core" || building.kind === "starter-grave") &&
          !this.isBuildingContaminated(building),
      );
      // Keep the bed's floating income to the bed's own production. Random
      // item income stays separate; economy traits are intentionally part of
      // the occupied bed's output.
      const bedGoldPerSecond =
        buildingStats("bed", bedLevel).value *
        rankBenefits(activeRank).bedGoldMultiplier * productionMultiplier;
      const placedItemGoldPerSecond = placedItemBuildings.reduce(
        (total, building) => total + (getRandomItem(building.itemId ?? '')?.effect.goldPerSecond ?? 0) * productionMultiplier,
        0,
      );
      const inventoryGoldPerSecond = inventoryEffects.goldPerSecond * productionMultiplier;
      // The selected skin trait replaces the base character trait, then that
      // single trait is added to bed production. Surfer Mong therefore pays
      // 1 bed + 2 skin gold without adding Mong's original +1 again.
      const effectiveBedGoldPerSecond =
        bedGoldProductionForMatch(
          player.appearance,
          bedGoldPerSecond,
          productionMultiplier,
          Boolean(this.state.ranked),
        );
      const buildingGoldPerSecond = goldBuildings.reduce(
        (total, building) =>
          total + buildingStats(building.kind, building.level).value * productionMultiplier,
        0,
      );
      const playerBed = mapRoom?.beds[player.bedIndex ?? 0] ?? mapRoom?.bed;
      // 침대 수입은 레벨과 무관하게 매초 한 번만 지급한다. 레벨이 오르면
      // 지급 간격이 짧아지는 대신, 같은 1초 주기에 지급 금액이 2배가 된다.
      player.goldIncomeElapsed += dt;
      while (player.goldIncomeElapsed + 1e-9 >= 1) {
        player.goldIncomeElapsed -= 1;
        if (this.state.elapsed < room.goldSuppressedUntil) continue;
        player.gold += effectiveBedGoldPerSecond + placedItemGoldPerSecond + inventoryGoldPerSecond + buildingGoldPerSecond;
        // 침대 수입과 생산 건물 수입을 한 덩어리로 합치면 무덤 위에
        // 전체 금액이 표시돼 어떤 건물이 벌어들였는지 알 수 없다.
        // 실제 생산 위치마다 별도 이벤트를 보내서 침대와 무덤(보석)의
        // 수입을 각각 읽을 수 있게 한다.
        if (effectiveBedGoldPerSecond > 0 && playerBed)
          this.pendingEvents.push({
            kind: "gold",
            playerId: player.id,
            amount: effectiveBedGoldPerSecond,
            position: { ...playerBed },
            label: '침대',
          });
        if (inventoryGoldPerSecond > 0)
          this.pendingEvents.push({
            kind: "gold",
            playerId: player.id,
            amount: inventoryGoldPerSecond,
            position: { ...player.position },
            label: "보관 아이템",
          });
        for (const building of placedItemBuildings) {
          const item = getRandomItem(building.itemId ?? '');
          const amount = (item?.effect.goldPerSecond ?? 0) * productionMultiplier;
          if (amount <= 0) continue;
          this.pendingEvents.push({
            kind: 'gold',
            playerId: player.id,
            amount,
            position: { ...building.tile },
            label: item?.label ?? '랜덤 보상',
          });
        }
        for (const building of goldBuildings) {
          const buildingIncome = buildingStats(building.kind, building.level).value * productionMultiplier;
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
          building.ownerId === player.id &&
          building.kind === "generator" &&
          !this.isBuildingContaminated(building),
      );
      // 발전기와 전력 아이템도 침대 골드처럼 매초 한 번만 지급한다.
      // 강화 단계는 지급 주기를 줄이지 않고, 한 번에 주는 전력만 2배로 키운다.
      player.powerIncomeElapsed += dt;
      while (player.powerIncomeElapsed + 1e-9 >= 1) {
        player.powerIncomeElapsed -= 1;
        const placedItemPowerPerSecond = placedItemBuildings.reduce(
          (total, building) => total + (getRandomItem(building.itemId ?? '')?.effect.powerPerSecond ?? 0) * productionMultiplier,
          0,
        );
        const traitPowerPerSecond =
          this.characterTraitForPlayer(player).powerPerSecond *
          productionMultiplier;
        const powerPerSecond = generators.reduce(
          (total, generator) => total + buildingStats("generator", generator.level).value * productionMultiplier,
          inventoryEffects.powerPerSecond * productionMultiplier +
            placedItemPowerPerSecond +
            traitPowerPerSecond,
        );
        player.power += powerPerSecond;
        if (traitPowerPerSecond > 0)
          this.pendingEvents.push({
            kind: "power",
            playerId: player.id,
            amount: traitPowerPerSecond,
            position: playerBed ? { ...playerBed } : { ...player.position },
            label: this.characterTraitForPlayer(player).label,
          });
        if (inventoryEffects.powerPerSecond > 0)
          this.pendingEvents.push({
            kind: "power",
            playerId: player.id,
            amount: inventoryEffects.powerPerSecond * productionMultiplier,
            position: { ...player.position },
            label: '보관 아이템',
          });
        for (const generator of generators) {
          const amount = buildingStats('generator', generator.level).value * productionMultiplier;
          if (amount <= 0) continue;
          this.pendingEvents.push({ kind: 'power', playerId: player.id, amount, position: { ...generator.tile }, label: '달빛 발전기' });
        }
        for (const building of placedItemBuildings) {
          const item = getRandomItem(building.itemId ?? '');
          const amount = (item?.effect.powerPerSecond ?? 0) * productionMultiplier;
          if (amount <= 0) continue;
          this.pendingEvents.push({ kind: 'power', playerId: player.id, amount, position: { ...building.tile }, label: item?.label ?? '랜덤 보상' });
        }
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

  private updateBuildings(dt: number, index: BuildingTickIndex): void {
    const { roomsById, ownersById, buildingsByOwner } = index;
    const effectsByOwner = new Map(
      this.state.players.map((player) => {
        const placed = (buildingsByOwner.get(player.id) ?? [])
          .filter(
            (building) =>
              building.kind === 'random-item' && Boolean(building.itemId),
          )
          .map((building) => ({
            itemId: building.itemId as string,
            count: 1,
          }));
        return [
          player.id,
          combinedItemEffects([...player.items, ...placed]),
        ] as const;
      }),
    );
    const traitsByOwner = new Map(
      this.state.players.map(
        (player) =>
          [player.id, this.characterTraitForPlayer(player)] as const,
      ),
    );
    const panelModeByOwner = new Map<string, BuildingState['powerPanelMode']>();
    const overloadUntilByOwner = new Map<string, number>();
    const rangeBonusByOwner = new Map<string, number>();
    const soulVialsByOwner = new Map<string, BuildingState[]>();
    for (const [ownerId, buildings] of buildingsByOwner) {
      panelModeByOwner.set(
        ownerId,
        buildings.find((building) => building.kind === 'power-panel')
          ?.powerPanelMode,
      );
      overloadUntilByOwner.set(
        ownerId,
        buildings.reduce(
          (latest, building) =>
            building.kind === 'overload-capacitor' &&
            (building.overloadUntil ?? 0) > this.state.elapsed
              ? Math.max(latest, building.overloadUntil ?? 0)
              : latest,
          0,
        ),
      );
      rangeBonusByOwner.set(
        ownerId,
        buildings.find((building) => building.kind === 'range-amplifier')
          ?.level ?? 0,
      );
      soulVialsByOwner.set(
        ownerId,
        buildings.filter((building) => building.kind === 'soul-vial'),
      );
    }
    const targetedRoomIds = new Set(
      this.state.ghosts
        .filter((ghost) => ghost.hp > 0)
        .flatMap((ghost) => ghost.targetRoomId ? [ghost.targetRoomId] : []),
    );
    const frostBuildings = this.state.buildings.filter(
      (building) => building.kind === 'frost-turret',
    );
    const frostSourcesByGhost = new Map<
      string,
      { ids: Set<string>; firstId: string }
    >();
    for (const ghost of this.state.ghosts) {
      if (ghost.hp <= 0 || ghost.healing) continue;
      const ids = new Set<string>();
      let firstId = '';
      for (const building of frostBuildings) {
        if (
          distance(building.tile, ghost.position) >
          buildingStats(building.kind, building.level).range
        )
          continue;
        if (!firstId) firstId = building.id;
        ids.add(building.id);
      }
      if (ids.size > 0) {
        frostSourcesByGhost.set(ghost.id, {
          ids,
          firstId,
        });
      }
    }
    const nearestActiveGhost = (tile: Tile): GhostState | undefined => {
      let nearest: GhostState | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const ghost of this.state.ghosts) {
        if (ghost.hp <= 0 || ghost.healing) continue;
        const candidateDistance = distance(ghost.position, tile);
        if (candidateDistance >= nearestDistance) continue;
        nearest = ghost;
        nearestDistance = candidateDistance;
      }
      return nearest;
    };

    for (const building of this.state.buildings) {
      building.cooldown -= dt;
      const room = roomsById.get(building.roomId);
      const supplyLevelBonus =
        room && room.supplyTurretLevelUntil > this.state.elapsed ? 1 : 0;
      const visualLevel = Math.min(
        15,
        (building.effectiveLevel ?? building.level) + supplyLevelBonus,
      );
      const stats = buildingStats(building.kind, visualLevel);
      const owner = ownersById.get(building.ownerId);
      // 아직 점유되지 않은 방의 기본 설비는 보이기만 하고 생산·공격하지 않는다.
      if (!owner) continue;
      if (this.isBuildingContaminated(building)) continue;
      const effects = effectsByOwner.get(owner.id) ??
        combinedItemEffects([]);
      if (
        building.kind === "repair-drone" &&
        room &&
        room.doorHp > 0 &&
        this.state.elapsed >= this.state.repairSuppressedUntil
      ) {
        const beforeRepair = room.doorHp;
        room.doorHp = Math.min(room.doorMaxHp, room.doorHp + stats.value * dt);
        owner.rankedContribution.defenseValue += Math.max(
          0,
          room.doorHp - beforeRepair,
        );
      }
      const offensive = OFFENSIVE_BUILD_KINDS.has(building.kind);
      const nearest =
        offensive || building.kind === 'shield-device'
          ? nearestActiveGhost(building.tile)
          : undefined;
      if (
        building.kind === "shield-device" &&
        room &&
        targetedRoomIds.has(room.id) &&
        nearest &&
        distance(nearest.position, building.tile) < 7 &&
        building.cooldown <= 0
      ) {
        room.shieldUntil = this.state.elapsed + stats.rate;
        building.cooldown = stats.rate + 8;
      }
      if (building.kind === "frost-turret") {
        for (const ghost of this.state.ghosts) {
          if (ghost.hp <= 0 || ghost.healing) continue;
          const frostSources = frostSourcesByGhost.get(ghost.id);
          if (!frostSources?.ids.has(building.id)) continue;
          const stacks = frostSources.ids.size;
          // Each upgraded spray adds 16% slow, capped so the ghost remains
          // visible and can eventually retreat instead of becoming frozen.
          this.applyGhostSlow(
            ghost,
            stats.rate + 0.12,
            Math.max(0.35, 1 - stats.value * stacks),
          );
          owner.rankedContribution.controlSeconds += dt;
          // Count adaptation exactly once per ghost/tick, regardless of how
          // many overlapping spray objects happen to be iterated first.
          if (frostSources.firstId === building.id)
            this.applyControlAdaptation(ghost, stacks, dt);
        }
      }
      if (!offensive) continue;
      const trait = traitsByOwner.get(owner.id) ??
        characterTraitForMatch(DEFAULT_APPEARANCE, Boolean(this.state.ranked));
      const skinTrait = turretSkinTrait(
        building.skinId,
        building.kind === 'basic-turret'
          ? building.kind
          : undefined,
      );
      const panelMode = panelModeByOwner.get(building.ownerId);
      const panelAttack = panelMode === "attack";
      const panelTurretDamageMultiplier = panelMode === "defense" || panelMode === "production" ? 0.85 : 1;
      const overloadActive =
        (building.kind === "basic-turret" || building.kind === "golden-turret") &&
        (overloadUntilByOwner.get(building.ownerId) ?? 0) >
          this.state.elapsed;
      // 일반 포탑은 4칸 기본 사거리이며, 황금 심판 포탑과 사거리 아이템만
      // 이 서버 권한 타깃 사거리에 예외 보정을 더한다.
      const roomRangeBonus = building.kind === "electric-coil"
        ? 0
        : (rangeBonusByOwner.get(building.ownerId) ?? 0);
      const supplyRangeBonus =
        (building.supplyRangeUntil ?? 0) > this.state.elapsed ? 2 : 0;
      const range =
        stats.range +
        effects.turretRangeBonus +
        trait.turretRangeBonus +
        roomRangeBonus +
        supplyRangeBonus;
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
      if (panelAttack) building.cooldown *= 0.82;
      if (overloadActive) building.cooldown *= 0.42;
      if (building.berserk) building.cooldown *= 0.72;
      if (room && room.supplyTurretRateUntil > this.state.elapsed)
        building.cooldown *= 0.5;
      if ((building.supplyRateUntil ?? 0) > this.state.elapsed)
        building.cooldown *= 0.55;
      let damage =
        stats.value *
        effects.turretDamageMultiplier *
        trait.turretDamageMultiplier *
        skinTrait.damageMultiplier;
      if (panelAttack) damage *= 1.25;
      damage *= panelTurretDamageMultiplier;
      if (overloadActive) damage *= 1.5;
      if (building.berserk) damage *= 1.65;
      if (room && room.supplyTurretDamageUntil > this.state.elapsed)
        damage *= 1.35;
      const nextShotMultiplier = Math.max(
        1,
        building.supplyNextShotMultiplier ?? 1,
      );
      damage *= nextShotMultiplier;
      if (nextShotMultiplier > 1) building.supplyNextShotMultiplier = 1;
      const soulReady =
        (building.soulChargeReadyAt ?? 0) > 0 &&
        this.state.elapsed >= (building.soulChargeReadyAt ?? 0);
      if (soulReady) {
        damage += building.soulChargeDamage ?? 0;
        building.soulChargeReadyAt = 0;
        building.soulChargeDamage = 0;
      }
      const appliedDamage = this.applyGhostDamage(nearest, damage, building.roomId, building.kind);
      if (appliedDamage > 0) {
        owner.rankedContribution.turretDamage += appliedDamage;
        if (building.kind === 'golden-turret') {
          const goldReward = goldenTurretGoldPerShot(building.level);
          owner.gold += goldReward;
          this.pendingEvents.push({
            kind: 'gold',
            playerId: owner.id,
            amount: goldReward,
            position: { ...building.tile },
          });
        }
        for (const vial of soulVialsByOwner.get(building.ownerId) ?? []) {
          vial.storedSoulDamage = Math.min(
            1_000_000,
            (vial.storedSoulDamage ?? 0) + appliedDamage * 0.1,
          );
        }
      }
      this.pendingEvents.push({
        kind: "turret-fire",
        sourceId: building.id,
        position: building.tile,
        targetPosition: { ...nearest.position },
        targetId: nearest.id,
        buildingKind: building.kind,
        itemId: building.skinId || undefined,
        amount: appliedDamage,
        label: soulReady ? "영혼 충전 레이저" : undefined,
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
      const baseDuration =
        resolveAfter >= 100 ? 0.45 : resolveAfter >= 70 ? 0.9 : stats.value;
      const bindResistance = clamp(
        this.state.ranked?.seasonRules.constraint.kind === "bind-resistance"
          ? this.state.ranked.seasonRules.constraint.bindResistance
          : 0,
        0,
        0.9,
      );
      const duration = Math.max(0.2, baseDuration * (1 - bindResistance));
      target.controlResolve = resolveAfter >= 100 ? 50 : resolveAfter;
      this.announceControlResistance(
        target,
        "bind",
        resolveAfter,
      );
      target.stunnedUntil = Math.max(target.stunnedUntil, this.state.elapsed + duration);
      owner.rankedContribution.controlSeconds += duration;
      if (resolveAfter >= 100) target.controlImmuneUntil = target.stunnedUntil + 2.5;
      target.netTriggeredTargetRoomId = room.id;
      target.path = [];
      if (
        this.state.tutorial?.active &&
        this.state.tutorial.step === "finish" &&
        target.variant !== "minion"
      ) {
        this.state.tutorial.netTriggered = true;
        target.retreating = false;
        target.healing = false;
        target.targetRoomId = room.id;
        target.hp = Math.min(
          target.hp,
          Math.max(1, buildingStats("basic-turret", 2).value * 0.8),
        );
      }
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
    const slowResistance = clamp(
        this.state.ranked?.seasonRules.constraint.kind === "slow-resistance"
          ? this.state.ranked.seasonRules.constraint.slowResistance
          : 0,
      0,
      0.9,
    );
    const resistedMultiplier =
      1 - (1 - normalizedMultiplier) * (1 - slowResistance);
    if (this.state.elapsed >= ghost.slowUntil)
      ghost.slowMultiplier = resistedMultiplier;
    else
      ghost.slowMultiplier = Math.min(
        ghost.slowMultiplier ?? 1,
        resistedMultiplier,
      );
    ghost.slowUntil = Math.max(ghost.slowUntil, this.state.elapsed + duration);
  }

  private applyControlAdaptation(ghost: GhostState, stacks: number, dt: number): void {
    if (!this.state.difficulty.controlAdaptation || this.state.elapsed < ghost.controlImmuneUntil) return;
    const perSecond = stacks >= 3 ? 54 : stacks === 2 ? 30 : 12;
    const resolveAfter = Math.min(
      100,
      ghost.controlResolve + perSecond * dt,
    );
    ghost.controlResolve = resolveAfter;
    this.announceControlResistance(ghost, "slow", resolveAfter);
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

  private announceControlResistance(
    ghost: GhostState,
    control: "slow" | "bind",
    resolve: number,
  ): void {
    const milestone = Math.min(4, Math.floor(resolve / 25));
    if (milestone <= ghost.controlResistanceNoticeLevel) return;
    ghost.controlResistanceNoticeLevel = milestone;
    this.pendingEvents.push({
      kind: "ghost-skill",
      position: { ...ghost.position },
      targetId: ghost.id,
      itemId:
        control === "slow" ? "slow-resistance" : "bind-resistance",
      label: `${control === "slow" ? "이속감소" : "속박"} 저항 ${milestone * 25}%`,
    });
  }

  private startFreeRepair(playerId: string): ActionResult {
    if (this.state.status !== "PLAYING" && this.state.status !== "OVERTIME")
      return { ok: false, error: "지금은 문을 수리할 수 없습니다." };
    const player = this.state.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player?.alive || !player.roomId)
      return { ok: false, error: "점유한 방에서만 문을 수리할 수 있습니다." };
    const room = this.state.rooms.find(
      (candidate) => candidate.id === player.roomId,
    );
    if (!room || !room.ownerIds.includes(playerId))
      return { ok: false, error: "내 방의 문만 수리할 수 있습니다." };
    if (room.doorHp <= 0)
      return { ok: false, error: "파괴된 문은 수리할 수 없습니다." };
    if (room.doorHp >= room.doorMaxHp)
      return { ok: false, error: "문 HP가 이미 최대입니다." };
    if (this.state.elapsed < this.state.repairSuppressedUntil)
      return { ok: false, error: "현재 문 수리가 봉인되어 있습니다." };
    if (this.state.elapsed < room.freeRepairUntil)
      return { ok: false, error: "문을 수리하고 있습니다." };
    if (this.state.elapsed < room.freeRepairReadyAt)
      return {
        ok: false,
        error: `무료 수리는 ${Math.ceil(room.freeRepairReadyAt - this.state.elapsed)}초 후 다시 사용할 수 있습니다.`,
      };
    room.freeRepairUntil = this.state.elapsed + 5;
    room.freeRepairReadyAt = room.freeRepairUntil + 60;
    room.freeRepairByPlayerId = playerId;
    this.pendingEvents.push({
      kind: "door-repair",
      playerId,
      roomId: room.id,
      amount: 15,
      label: "무료 문 수리 시작",
    });
    return { ok: true };
  }

  private updateFreeDoorRepairs(dt: number): void {
    const tickStart = this.state.elapsed - dt;
    for (const room of this.state.rooms) {
      if (
        room.freeRepairUntil <= tickStart ||
        room.doorHp <= 0 ||
        room.doorHp >= room.doorMaxHp ||
        this.state.elapsed < this.state.repairSuppressedUntil
      )
        continue;
      const activeDuration = Math.max(
        0,
        Math.min(dt, room.freeRepairUntil - tickStart),
      );
      if (activeDuration <= 0) continue;
      const before = room.doorHp;
      room.doorHp = Math.min(
        room.doorMaxHp,
        room.doorHp + 15 * activeDuration,
      );
      const repairer = this.state.players.find(
        (candidate) => candidate.id === room.freeRepairByPlayerId,
      );
      if (repairer)
        repairer.rankedContribution.defenseValue += Math.max(
          0,
          room.doorHp - before,
        );
    }
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
    const vulnerabilityMultiplier =
      ghost.vulnerableUntil > this.state.elapsed ? 1.35 : 1;
    const appliedDamage =
      damage *
      directionalMultiplier *
      vulnerabilityMultiplier *
      (ghost.retreating ? BALANCE.ghost.retreatDamageMultiplier : 1);
    let next = Math.max(0, before - appliedDamage);
    const tutorialAwaitingNet =
      this.state.tutorial?.active &&
      ghost.variant !== "minion" &&
      !this.state.tutorial.netTriggered;
    if (tutorialAwaitingNet) {
      next = Math.max(Math.ceil(ghost.maxHp * 0.1), next);
    }
    if (next <= 0 && ghost.barrierLayers > 0) {
      if (ghost.variant === "demolisher")
        this.resetDemolisherAbility(ghost, false);
      if (ghost.variant === "wallpaper")
        this.resetWallpaperAbility(ghost, false);
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
      if (ghost.variant === "demolisher")
        this.resetDemolisherAbility(ghost, false);
      if (ghost.variant === "wallpaper")
        this.resetWallpaperAbility(ghost, false);
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

  private isPlayerHiddenInRoom(player: PlayerState): boolean {
    return this.map.rooms.some((room) =>
      isPositionOnRoomFloor(room, player.position),
    );
  }

  private ghostPlayerContactRadius(ghost: GhostState): number {
    const ghostRadius =
      ghost.variant === "giant"
        ? 0.38
        : ghost.variant === "minion"
          ? 0.16
          : BALANCE.ghost.collisionRadius;
    return BALANCE.player.collisionRadius + ghostRadius;
  }

  /**
   * An unclaimed survivor dies on physical contact. This is independent from
   * the door-attack cooldown: tying contact to that timer left overlapping
   * sprites alive for several seconds. A survivor standing on a room floor is
   * excluded because entering the room is the opening hunt's safe boundary.
   */
  private eliminateContactingOutsidePlayer(ghost: GhostState): boolean {
    const contactRadius = this.ghostPlayerContactRadius(ghost);
    const target = this.state.players
      .filter(
        (player) =>
          player.alive &&
          (player.connected || player.isBot) &&
          !player.roomId &&
          !this.isPlayerHiddenInRoom(player) &&
          distance(ghost.position, player.position) <= contactRadius,
      )
      .sort(
        (left, right) =>
          distance(ghost.position, left.position) -
          distance(ghost.position, right.position),
      )[0];
    if (!target) return false;
    this.eliminatePlayer(ghost, target);
    return true;
  }

  private blackoutGhostSpeed(): number {
    const survivorSpeeds = this.state.players
      .filter((player) => player.alive)
      .map((player) => this.unclaimedPlayerSpeed(player));
    const slowestSpeed =
      survivorSpeeds.length > 0
        ? Math.min(...survivorSpeeds)
        : BALANCE.player.speed;
    return slowestSpeed * BLACKOUT_GHOST_SPEED_MULTIPLIER;
  }

  private randomBlackoutCorridorTile(ghost: GhostState): Tile | null {
    const candidates = this.map.corridorTiles;
    if (candidates.length === 0) return null;
    if (!ghost.variant.startsWith("twin")) {
      const tile = candidates[this.rng.int(0, candidates.length - 1)];
      return tile ? { ...tile } : null;
    }
    const otherTwinTargets = this.state.ghosts
      .filter(
        (candidate) =>
          candidate.id !== ghost.id &&
          candidate.variant.startsWith("twin") &&
          candidate.wanderTarget,
      )
      .map((candidate) => candidate.wanderTarget as Tile);
    const separated = candidates.filter((tile) =>
      otherTwinTargets.every(
        (target) =>
          distance(tile, target) >= BLACKOUT_REVEAL_RADIUS_TILES * 2,
      ),
    );
    const pool = separated.length > 0 ? separated : candidates;
    const tile = pool[this.rng.int(0, pool.length - 1)];
    return tile ? { ...tile } : null;
  }

  private moveBlackoutGhostToward(
    ghost: GhostState,
    destination: Vec2,
    dt: number,
    speed: number,
  ): void {
    if (ghost.path.length === 0 || this.serverSeq % 20 === 0) {
      ghost.path = findPath(
        this.blackoutNavigationMap,
        ghost.position,
        destination,
      );
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
    ghost.position = moveInWalkableArea(
      this.blackoutNavigationMap,
      ghost.position,
      {
        x: direction.x * speed * dt,
        y: direction.y * speed * dt,
      },
      BALANCE.ghost.collisionRadius,
      0.12,
    );
  }

  /**
   * Opening hunt: ghosts patrol only corridors and can detect only a survivor
   * whose two-tile light currently contains them. Entering any room floor
   * immediately breaks pursuit; doors and occupants cannot be attacked before
   * the preparation timer ends.
   */
  private updateBlackoutGhosts(dt: number): void {
    const speed = this.blackoutGhostSpeed();
    for (const ghost of this.state.ghosts) {
      if (ghost.hp <= 0) continue;
      ghost.targetRoomId = null;
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.25);
      if (this.eliminateContactingOutsidePlayer(ghost)) continue;

      const currentTarget = ghost.targetPlayerId
        ? this.state.players.find(
            (player) =>
              player.id === ghost.targetPlayerId &&
              player.alive &&
              (player.connected || player.isBot) &&
              !player.roomId &&
              !this.isPlayerHiddenInRoom(player),
          )
        : undefined;
      const targetStillVisible = Boolean(
        currentTarget &&
          distance(ghost.position, currentTarget.position) <=
            BLACKOUT_REVEAL_RADIUS_TILES,
      );

      if (!targetStillVisible) {
        ghost.targetPlayerId = null;
        ghost.path = [];
      }

      if (!ghost.targetPlayerId) {
        const visiblePlayers = this.state.players
          .filter(
            (player) =>
              player.alive &&
              (player.connected || player.isBot) &&
              !player.roomId &&
              !this.isPlayerHiddenInRoom(player) &&
              distance(ghost.position, player.position) <=
                BLACKOUT_REVEAL_RADIUS_TILES,
          )
          .sort(
            (left, right) =>
              distance(ghost.position, left.position) -
              distance(ghost.position, right.position),
          );
        const otherTwinPlayerTargets = ghost.variant.startsWith("twin")
          ? new Set(
              this.state.ghosts
                .filter(
                  (candidate) =>
                    candidate.id !== ghost.id &&
                    candidate.variant.startsWith("twin"),
                )
                .map((candidate) => candidate.targetPlayerId)
                .filter((id): id is string => Boolean(id)),
            )
          : new Set<string>();
        const diversified =
          visiblePlayers.length > 1
            ? visiblePlayers.filter(
                (player) => !otherTwinPlayerTargets.has(player.id),
              )
            : visiblePlayers;
        const spotted = (diversified.length > 0
          ? diversified
          : visiblePlayers)[0];
        if (spotted) {
          ghost.targetPlayerId = spotted.id;
          ghost.wanderTarget = null;
          ghost.path = [];
        }
      }

      const chaseTarget = ghost.targetPlayerId
        ? this.state.players.find(
            (player) => player.id === ghost.targetPlayerId,
          )
        : undefined;
      if (chaseTarget) {
        this.moveBlackoutGhostToward(
          ghost,
          chaseTarget.position,
          dt,
          speed,
        );
        this.eliminateContactingOutsidePlayer(ghost);
        continue;
      }

      if (
        !ghost.wanderTarget ||
        distance(ghost.position, ghost.wanderTarget) < 0.42
      ) {
        ghost.wanderTarget = this.randomBlackoutCorridorTile(ghost);
        ghost.path = [];
      }
      if (ghost.wanderTarget) {
        this.moveBlackoutGhostToward(
          ghost,
          ghost.wanderTarget,
          dt,
          speed,
        );
        this.eliminateContactingOutsidePlayer(ghost);
      }
    }
    this.syncPrimaryGhost();
  }

  private demolisherManaPerDoorHit(level: number): number {
    // The first cast takes roughly eighty successful door strikes at Lv.1.
    // Level growth matters, but the cap prevents late-game cast spam.
    return Math.min(2.6, 1.25 + Math.max(0, level - 1) * 0.15);
  }

  private demolisherTargets(roomId: string): BuildingState[] {
    const room = this.state.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return [];
    return this.state.buildings.filter(
      (building) =>
        building.roomId === roomId &&
        Boolean(building.ownerId) &&
        room.ownerIds.includes(building.ownerId),
    );
  }

  private resetDemolisherAbility(ghost: GhostState, consumeMana: boolean): void {
    if (consumeMana) ghost.mana = 0;
    ghost.abilityPhase = "idle";
    ghost.abilityStartedAt = -1;
    ghost.abilityEndsAt = -1;
    ghost.abilityTargetBuildingId = null;
  }

  private wallpaperManaPerDoorHit(level: number): number {
    // About sixty-seven clean hits at Lv.1. Growth makes the threat visible in
    // long matches, but the cap prevents repeated room shutdowns.
    return Math.min(2.8, 1.5 + Math.max(0, level - 1) * 0.16);
  }

  private wallpaperTargets(roomId: string): BuildingState[] {
    const room = this.state.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return [];
    return this.state.buildings.filter(
      (building) =>
        building.roomId === roomId &&
        Boolean(building.ownerId) &&
        room.ownerIds.includes(building.ownerId),
    );
  }

  private wallpaperContaminationTiles(roomId: string, origin: Tile): Tile[] {
    const mapRoom = this.map.rooms.find((room) => room.id === roomId);
    if (!mapRoom) return [];
    return [...mapRoom.buildTiles]
      .sort((left, right) => {
        const leftDistance =
          Math.abs(left.x - origin.x) + Math.abs(left.y - origin.y);
        const rightDistance =
          Math.abs(right.x - origin.x) + Math.abs(right.y - origin.y);
        return (
          leftDistance - rightDistance ||
          left.y - right.y ||
          left.x - right.x
        );
      })
      .slice(0, 3)
      .map((tile) => ({ ...tile, roomId }));
  }

  private resetWallpaperAbility(
    ghost: GhostState,
    consumeMana: boolean,
  ): void {
    if (consumeMana) ghost.mana = 0;
    ghost.abilityPhase = "idle";
    ghost.abilityStartedAt = -1;
    ghost.abilityEndsAt = -1;
    ghost.abilityTargetBuildingId = null;
  }

  private startWallpaperAbility(ghost: GhostState, roomId: string): boolean {
    if (
      ghost.variant !== "wallpaper" ||
      ghost.abilityPhase !== "idle" ||
      ghost.mana < ghost.maxMana
    )
      return false;
    const candidates = this.wallpaperTargets(roomId);
    const target =
      candidates.length > 0
        ? candidates[this.rng.int(0, candidates.length - 1)]
        : undefined;
    if (!target) return false;
    ghost.abilityPhase = "preparing";
    ghost.abilityStartedAt = this.state.elapsed;
    ghost.abilityEndsAt = this.state.elapsed + 3;
    ghost.abilityTargetBuildingId = target.id;
    ghost.attackCooldown = Math.max(ghost.attackCooldown, 3.8);
    ghost.path = [];
    this.pendingEvents.push({
      kind: "ghost-skill",
      sourceId: ghost.id,
      position: { ...ghost.position },
      targetId: ghost.id,
      targetPosition: { ...target.tile },
      itemId: "wallpaper-prepare",
      label: "오염 도배 준비 · 3초",
    });
    return true;
  }

  /** Returns true while the wallpaper ghost blocks its ordinary actions. */
  private updateWallpaperAbility(ghost: GhostState): boolean {
    if (ghost.variant !== "wallpaper") return false;
    if (
      ghost.contaminatedTiles.length > 0 &&
      this.state.elapsed >= ghost.contaminationEndsAt
    ) {
      ghost.contaminatedTiles = [];
      ghost.contaminationEndsAt = -1;
    }
    if (ghost.abilityPhase === "idle") return false;
    if (ghost.abilityPhase === "preparing") {
      if (this.state.elapsed < ghost.abilityEndsAt) return true;
      const candidates = ghost.targetRoomId
        ? this.wallpaperTargets(ghost.targetRoomId)
        : [];
      const selected =
        candidates.find(
          (building) => building.id === ghost.abilityTargetBuildingId,
        ) ??
        (candidates.length > 0
          ? candidates[this.rng.int(0, candidates.length - 1)]
          : undefined);
      if (!selected) {
        this.resetWallpaperAbility(ghost, true);
        return false;
      }
      ghost.contaminatedTiles = this.wallpaperContaminationTiles(
        selected.roomId,
        selected.tile,
      );
      ghost.contaminationEndsAt =
        this.state.elapsed + Math.min(18, 12 + (ghost.level - 1) * 0.5);
      ghost.abilityPhase = "casting";
      ghost.abilityStartedAt = this.state.elapsed;
      ghost.abilityEndsAt = this.state.elapsed + 0.8;
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.8);
      this.pendingEvents.push({
        kind: "ghost-skill",
        sourceId: ghost.id,
        position: { ...ghost.position },
        targetId: ghost.id,
        targetPosition: { ...selected.tile },
        roomId: selected.roomId,
        itemId: "wallpaper-cast",
        label: "오염 도배 · 설비 정지",
      });
      return true;
    }
    if (this.state.elapsed < ghost.abilityEndsAt) return true;
    this.resetWallpaperAbility(ghost, true);
    return false;
  }

  private isBuildingContaminated(building: BuildingState): boolean {
    return this.state.ghosts.some(
      (ghost) =>
        ghost.variant === "wallpaper" &&
        ghost.hp > 0 &&
        this.state.elapsed < ghost.contaminationEndsAt &&
        ghost.contaminatedTiles.some(
          (tile) =>
            tile.x === building.tile.x &&
            tile.y === building.tile.y &&
            tile.roomId === building.roomId,
        ),
    );
  }

  private startDemolisherAbility(ghost: GhostState, roomId: string): boolean {
    if (
      ghost.variant !== "demolisher" ||
      ghost.abilityPhase !== "idle" ||
      ghost.mana < ghost.maxMana
    )
      return false;
    const candidates = this.demolisherTargets(roomId);
    const target = candidates.length > 0
      ? candidates[this.rng.int(0, candidates.length - 1)]
      : undefined;
    if (!target) return false;
    ghost.abilityPhase = "preparing";
    ghost.abilityStartedAt = this.state.elapsed;
    ghost.abilityEndsAt = this.state.elapsed + 3;
    ghost.abilityTargetBuildingId = target.id;
    ghost.attackCooldown = Math.max(ghost.attackCooldown, 3.6);
    ghost.path = [];
    this.pendingEvents.push({
      kind: "ghost-skill",
      sourceId: ghost.id,
      position: { ...ghost.position },
      targetId: ghost.id,
      targetPosition: { ...target.tile },
      itemId: "demolition-prepare",
      label: "철거 주문 준비 · 3초",
    });
    return true;
  }

  /** Returns true while the special action blocks ordinary movement and attacks. */
  private updateDemolisherAbility(ghost: GhostState): boolean {
    if (ghost.variant !== "demolisher" || ghost.abilityPhase === "idle")
      return false;
    if (ghost.abilityPhase === "preparing") {
      if (this.state.elapsed < ghost.abilityEndsAt) return true;
      const candidates = ghost.targetRoomId
        ? this.demolisherTargets(ghost.targetRoomId)
        : [];
      const selected =
        candidates.find(
          (building) => building.id === ghost.abilityTargetBuildingId,
        ) ?? (candidates.length > 0
          ? candidates[this.rng.int(0, candidates.length - 1)]
          : undefined);
      if (!selected) {
        this.resetDemolisherAbility(ghost, true);
        return false;
      }
      this.state.buildings = this.state.buildings.filter(
        (building) => building.id !== selected.id,
      );
      for (const player of this.state.players) {
        if (player.armedSoulVialId === selected.id)
          player.armedSoulVialId = null;
      }
      if (
        selected.kind === "basic-turret" ||
        selected.kind === "turret-enhancer"
      )
        this.syncDynamicTurretLevels(this.createBuildingTickIndex());
      ghost.abilityPhase = "casting";
      ghost.abilityStartedAt = this.state.elapsed;
      ghost.abilityEndsAt = this.state.elapsed + 0.65;
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.65);
      this.pendingEvents.push({
        kind: "ghost-skill",
        sourceId: ghost.id,
        position: { ...ghost.position },
        targetId: ghost.id,
        targetPosition: { ...selected.tile },
        itemId: "demolition-cast",
        label: "강제 철거",
      });
      this.pendingEvents.push({
        kind: "building-remove",
        sourceId: ghost.id,
        position: { ...selected.tile },
        targetId: selected.id,
        playerId: selected.ownerId,
        roomId: selected.roomId,
        buildingKind: selected.kind,
        itemId: "demolition-cast",
        label: "해체귀에게 철거됨",
        amount: 0,
      });
      return true;
    }
    if (this.state.elapsed < ghost.abilityEndsAt) return true;
    this.resetDemolisherAbility(ghost, true);
    return false;
  }

  private updateGhost(ghost: GhostState, dt: number): void {
    if (ghost.hp <= 0) {
      if (ghost.variant === "wallpaper") {
        ghost.contaminatedTiles = [];
        ghost.contaminationEndsAt = -1;
      }
      return;
    }
    // The training ghost is a final-step target, not an early-game hazard.
    // Keep it completely idle until the player has installed the net so the
    // eight server-authoritative lessons cannot be interrupted by combat.
    if (
      this.state.tutorial?.active &&
      (
        this.state.tutorial.step !== "finish" ||
        !this.state.tutorial.combatStarted
      ) &&
      ghost.variant !== "minion"
    ) {
      ghost.targetRoomId = null;
      ghost.targetPlayerId = null;
      ghost.path = [];
      ghost.attackCooldown = Math.max(ghost.attackCooldown, 0.2);
      return;
    }
    ghost.phase = ghost.level;
    ghost.rage =
      ghost.variant !== "minion" &&
      (ghost.level >= 5 || ghost.hp / ghost.maxHp <= 0.3);
    ghost.skillCooldown -= dt;
    ghost.abilityCooldown -= dt;

    if (this.state.elapsed < ghost.stunnedUntil) {
      if (
        (ghost.variant === "demolisher" ||
          ghost.variant === "wallpaper") &&
        ghost.abilityPhase !== "idle"
      )
        ghost.abilityEndsAt += dt;
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
      if (ghost.variant === "demolisher")
        this.resetDemolisherAbility(ghost, false);
      if (ghost.variant === "wallpaper")
        this.resetWallpaperAbility(ghost, false);
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

    if (this.eliminateContactingOutsidePlayer(ghost)) return;

    if (this.updateDemolisherAbility(ghost)) return;
    if (this.updateWallpaperAbility(ghost)) return;

    // The doll deliberately clears the attack target. While no other
    // survivor room exists, keep the ghost visibly wandering in corridors
    // instead of immediately reselecting the same door on the next tick.
    if (this.state.elapsed < ghost.wanderUntil) {
      if (!ghost.wanderTarget || distance(ghost.position, ghost.wanderTarget) < 0.45) {
        ghost.wanderTarget = this.randomCorridorTile();
        ghost.path = [];
      }
      if (ghost.wanderTarget) {
        this.moveGhostToward(ghost, ghost.wanderTarget, dt, 0.82);
        this.eliminateContactingOutsidePlayer(ghost);
      }
      return;
    }
    if (ghost.wanderUntil >= 0) {
      ghost.wanderUntil = -1;
      ghost.wanderTarget = null;
      ghost.path = [];
      ghost.targetRoomId = this.selectGhostTarget(ghost);
    }

    if (ghost.abilityCooldown <= 0) {
      if (ghost.variant === "teleporter") this.teleportToAnotherDoor(ghost);
      else if (ghost.variant === "undead") this.summonMinions(ghost);
      else ghost.abilityCooldown = 20;
    }

    if (ghost.skillCooldown <= 0) {
      if (ghost.variant === "minion") ghost.skillCooldown = 20;
      else if (this.stage.skills.length > 0) {
        ghost.pendingStageSkill ??=
          this.stage.skills[this.rng.int(0, this.stage.skills.length - 1)] ?? null;
        // Gold lock is not a remote/global cast. Hold the selected skill until
        // this same ghost performs a legal hit against its target door.
        if (ghost.pendingStageSkill && ghost.pendingStageSkill !== 'gold-lock') {
          this.useStageSkill(ghost, ghost.pendingStageSkill);
          ghost.pendingStageSkill = null;
        }
      }
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
        ghost.wanderTarget = null;
        ghost.path = [];
      }
      if (
        distance(ghost.position, outsideTarget.position) >
        this.ghostPlayerContactRadius(ghost)
      ) {
        this.moveGhostToward(
          ghost,
          outsideTarget.position,
          dt,
          BALANCE.ghost.outsideTargetSpeedMultiplier,
          this.unclaimedPlayerSpeed(outsideTarget) *
            BALANCE.ghost.outsideTargetMinimumPlayerMultiplier,
        );
        this.eliminateContactingOutsidePlayer(ghost);
        return;
      }
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
      if (
        !ghost.wanderTarget ||
        distance(ghost.position, ghost.wanderTarget) < 0.45
      ) {
        ghost.wanderTarget = this.randomCorridorTile();
        ghost.path = [];
      }
      if (ghost.wanderTarget) {
        this.moveGhostToward(ghost, ghost.wanderTarget, dt, 0.72);
        this.eliminateContactingOutsidePlayer(ghost);
      }
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
    // Room ownership is retained for result/economy bookkeeping after a
    // survivor dies. Never keep chasing that stale room record: an undead
    // parent could otherwise remain parked on the defeated survivor's bed
    // when one of its minions dealt the finishing blow.
    if (!targetPlayer) {
      ghost.targetRoomId = null;
      ghost.targetPlayerId = null;
      ghost.path = [];
      return;
    }
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
    if (
      room.doorHp > 0 &&
      canStrikeDoor &&
      ghost.pendingStageSkill === 'gold-lock'
    ) {
      this.useStageSkill(ghost, 'gold-lock');
      ghost.pendingStageSkill = null;
    }
    const combatants = Math.max(
      1,
      this.state.players.filter((player) => player.alive).length,
    );
    const rankPressure = this.humanRankPressure();
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
    const attackSpeed = this.ghostAttackSpeedMultiplier(ghost.variant);
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
      const panelMode = this.state.buildings.find(
        (building) =>
          building.roomId === room.id &&
          room.ownerIds.includes(building.ownerId ?? "") &&
          building.kind === "power-panel",
      )?.powerPanelMode;
      const panelDoorDamageMultiplier = panelMode === "defense" ? 0.75 : panelMode === "attack" ? 1.25 : panelMode === "production" ? 1.15 : 1;
      const damage =
        BALANCE.ghost.baseDamage * damageScale * (1 - shieldReduction) *
        (this.state.elapsed < room.doorBraceUntil ? 0.65 : 1) *
        panelDoorDamageMultiplier;
      const shieldAbsorbed = Math.min(
        Math.max(0, room.doorShieldHp),
        damage,
      );
      if (shieldAbsorbed > 0)
        room.doorShieldHp = Math.max(
          0,
          room.doorShieldHp - shieldAbsorbed,
        );
      if (shieldAbsorbed > 0 && room.ownerIds.length > 0) {
        const credit = shieldAbsorbed / room.ownerIds.length;
        for (const ownerId of room.ownerIds) {
          const roomOwner = this.state.players.find(
            (candidate) => candidate.id === ownerId,
          );
          if (roomOwner)
            roomOwner.rankedContribution.defenseValue += credit;
        }
      }
      const doorDamage = Math.max(0, damage - shieldAbsorbed);
      const nextDoorHp = Math.max(0, room.doorHp - doorDamage);
      const triggersLastLatch = Boolean(
        doorDamage > 0 &&
        room.lastLatchArmedBy &&
        room.doorHp / room.doorMaxHp > 0.15 &&
        nextDoorHp / room.doorMaxHp <= 0.15,
      );
      const activeAnchor = this.state.elapsed < room.doorAnchorUntil;
      const anchor = this.state.buildings.find(
        (building) => building.roomId === room.id && building.kind === "door-anchor",
      );
      if (activeAnchor) {
        room.doorHp = Math.max(1, nextDoorHp);
      } else if (triggersLastLatch) {
        room.lastLatchUntil = this.state.elapsed + 4;
        room.lastLatchArmedBy = null;
        room.doorHp = Math.max(1, nextDoorHp);
        this.pendingEvents.push({
          kind: 'consumable-use',
          position: mapRoom.door,
          roomId: room.id,
          label: '최후의 걸쇠 발동 · 4초 보호',
        });
      } else if (nextDoorHp <= 0 && anchor) {
        room.doorAnchorUntil = this.state.elapsed + buildingStats(anchor.kind, anchor.level).value;
        room.doorHp = 1;
        this.consumeBuilding(anchor.id);
        this.pendingEvents.push({
          kind: "consumable-use",
          position: mapRoom.door,
          roomId: room.id,
          label: "도어 앵커 발동 · 4초 보호",
        });
      } else room.doorHp = nextDoorHp;
      const mirror = this.state.buildings.find(
        (building) => building.roomId === room.id && building.kind === "reflect-mirror",
      );
      if (mirror) {
        const reflected = this.applyGhostDamage(
          ghost,
          damage * buildingStats(mirror.kind, mirror.level).value,
          room.id,
          mirror.kind,
        );
        if (reflected > 0)
          this.pendingEvents.push({
            kind: "ghost-hit",
            position: { ...ghost.position },
            targetId: ghost.id,
            buildingKind: mirror.kind,
            amount: reflected,
            label: "반사 피해",
          });
      }
      room.lastDoorHitAt = this.state.elapsed;
      room.doorRegenAccumulator = -1;
      if (ghost.variant !== "minion") ghost.attackCount += 1;
      if (ghost.variant === "demolisher") {
        ghost.mana = Math.min(
          ghost.maxMana,
          ghost.mana + this.demolisherManaPerDoorHit(ghost.level),
        );
      }
      if (ghost.variant === "wallpaper") {
        ghost.mana = Math.min(
          ghost.maxMana,
          ghost.mana + this.wallpaperManaPerDoorHit(ghost.level),
        );
      }
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
        label:
          shieldAbsorbed > 0
            ? `이중문 방어막 -${Math.ceil(shieldAbsorbed)}`
            : undefined,
      });
      if (ghost.variant === "demolisher")
        this.startDemolisherAbility(ghost, room.id);
      if (ghost.variant === "wallpaper")
        this.startWallpaperAbility(ghost, room.id);
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
    player.rankedContribution.diedAt ??= this.state.elapsed;
    player.velocity = { x: 0, y: 0 };
    const botDiagnostic = this.botRuntime.get(player.id)?.diagnostic;
    if (botDiagnostic) botDiagnostic.diedAt ??= this.state.elapsed;
    this.pendingEvents.push({
      kind: "death",
      position: player.position,
      playerId: player.id,
    });
    ghost.targetRoomId = null;
    ghost.targetPlayerId = null;
    ghost.path = [];
    // A minion can deal the finishing blow while its undead summoner and other
    // minions still target the same room. Clear every stale target, not only
    // the killer's, so all ghosts immediately search for a living survivor and
    // path back out through the already-breached doorway.
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
        for (const candidate of this.state.ghosts) {
          const insideDefeatedRoom = mapRoom.floorTiles.some(
            (tile) =>
              tile.x === Math.round(candidate.position.x) &&
              tile.y === Math.round(candidate.position.y),
          );
          if (
            candidate.targetRoomId !== defeatedRoomId &&
            candidate.targetPlayerId !== player.id &&
            !insideDefeatedRoom
          )
            continue;
          candidate.targetRoomId = null;
          candidate.targetPlayerId = null;
          candidate.path = [];
          candidate.attackCooldown = Math.max(candidate.attackCooldown, 0.35);
        }
      }
    }
  }

  private levelUpGhost(ghost: GhostState): void {
    const previousMax = ghost.maxHp;
    ghost.level += 1;
    ghost.phase = ghost.level;
    ghost.attackCount = 0;
    ghost.attacksToNextLevel = this.attacksForNextGhostLevel(
      ghost.level,
      ghost.variant,
    );
    ghost.maxHp = Math.round(ghost.maxHp * (1 + this.stage.levelHpGrowth));
    ghost.hp += ghost.maxHp - previousMax;
    this.pendingEvents.push({
      kind: "ghost-level-up",
      position: { ...ghost.position },
      targetId: ghost.id,
      amount: ghost.level,
    });
  }

  private useStageSkill(ghost: GhostState, skill: GhostStageSkill): void {
    let label = "";
    let eventPosition = { ...ghost.position };
    let eventRoomId: string | undefined;
    if (skill === "turret-jam") {
      this.turretSuppressedUntil = this.state.elapsed + 3;
      label = "포탑 무효화 3초";
    } else if (skill === "gold-lock") {
      const room = this.state.rooms.find(
        (candidate) => candidate.id === ghost.targetRoomId,
      );
      const mapRoom = this.map.rooms.find(
        (candidate) => candidate.id === ghost.targetRoomId,
      );
      if (room && mapRoom && room.doorHp > 0 && this.canGhostStrikeDoor(ghost, mapRoom)) {
        eventPosition = { ...mapRoom.door };
        eventRoomId = room.id;
      }
      if (room && eventRoomId && this.state.elapsed >= room.goldSuppressedUntil) {
        room.goldSuppressedUntil = this.state.elapsed + 5;
        room.goldSuppressedByGhostId = ghost.id;
        label = "골드 획득 봉인 5초";
      } else {
        // Twin ghosts may strike in adjacent ticks. An already active room
        // lock must never keep being pushed forward indefinitely.
        label = "골드 획득 봉인 연장 무효";
      }
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
      position: eventPosition,
      roomId: eventRoomId,
      targetId: ghost.id,
      itemId: skill,
      label,
    });
  }

  /**
   * A room lock is valid only while its attacker is still positioned to hit
   * that intact door. Retreat, recovery, stun, target changes, displacement,
   * and a broken door all release income immediately on the next economy tick.
   */
  private syncGoldSuppressionState(): void {
    for (const room of this.state.rooms) {
      if (room.goldSuppressedUntil <= this.state.elapsed) {
        room.goldSuppressedUntil = 0;
        room.goldSuppressedByGhostId = null;
        continue;
      }
      const mapRoom = this.map.rooms.find((candidate) => candidate.id === room.id);
      const sealingGhost = room.goldSuppressedByGhostId
        ? this.state.ghosts.find(
            (ghost) => ghost.id === room.goldSuppressedByGhostId,
          )
        : undefined;
      const activelyAttacked = Boolean(
        room.doorHp > 0 &&
        mapRoom &&
        sealingGhost &&
        sealingGhost.hp > 0 &&
        !sealingGhost.retreating &&
        !sealingGhost.healing &&
        this.state.elapsed >= sealingGhost.stunnedUntil &&
        sealingGhost.targetRoomId === room.id &&
        this.canGhostStrikeDoor(sealingGhost, mapRoom),
      );
      if (!activelyAttacked) {
        room.goldSuppressedUntil = 0;
        room.goldSuppressedByGhostId = null;
      }
    }
    this.state.goldSuppressedUntil = Math.max(
      0,
      ...this.state.rooms.map((room) => room.goldSuppressedUntil),
    );
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
    minimumSpeed = 0,
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
    speed = Math.max(speed, minimumSpeed);
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
    if (this.state.tutorial?.active) {
      const playerRoom = candidates.find((room) =>
        room.ownerIds.some((ownerId) =>
          this.state.players.some(
            (player) => player.id === ownerId && !player.isBot && player.alive,
          ),
        ),
      );
      if (playerRoom) return playerRoom.id;
    }
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
            (player.connected || player.isBot) &&
            !player.roomId &&
            !this.isPlayerHiddenInRoom(player) &&
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
        player.profileAvatarUrl,
        player.profileRankedSeasonId,
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
      return;
    }
    if (!this.state.ranked) return;
    for (const player of this.state.players) {
      if (
        player.isBot ||
        player.connected ||
        player.reconnectUntil <= 0 ||
        player.reconnectUntil >= now ||
        player.rankedContribution.abandonedAt !== null
      )
        continue;
      player.rankedContribution.abandonedAt = this.state.elapsed;
      player.alive = false;
      player.spectator = true;
      player.reconnectUntil = 0;
      player.velocity = { x: 0, y: 0 };
    }
    this.evaluateOutcome();
  }

  private sanitizeResources(): void {
    for (const player of this.state.players) {
      player.gold = clamp(player.gold, 0, BALANCE.resource.maxStored);
      player.power = clamp(player.power, 0, BALANCE.resource.maxStored);
      player.hp = clamp(player.hp, 0, player.maxHp);
    }
    for (const room of this.state.rooms) {
      room.doorHp = clamp(room.doorHp, 0, room.doorMaxHp);
      room.doorShieldHp = clamp(
        room.doorShieldHp,
        0,
        room.doorShieldMaxHp,
      );
    }
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
    profileAvatarUrl: string | null = null,
    profileRankedSeasonId = 'S1',
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
      profileRankedSeasonId: normalizeProfileRankedSeasonId(profileRankedSeasonId),
      profileRankedTier: normalizeProfileRankedTier(profileRankedTier),
      profileRankedRating: normalizeProfileRankedRating(profileRankedRating),
      profileAvatarUrl,
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
      power:
        this.stage.id === "tutorial-1" && !isBot
          ? 240
          : BALANCE.player.startingPower + benefits.startingPowerBonus,
      goldIncomeElapsed: 0,
      powerIncomeElapsed: 0,
      roomId: null,
      lockedRoomId: null,
      bedIndex: null,
      lastInputSeq: 0,
      reconnectUntil: 0,
      score: 0,
      rankedContribution: {
        activeSeconds: 0,
        turretDamage: 0,
        defenseValue: 0,
        controlSeconds: 0,
        goldSpent: 0,
        powerSpent: 0,
        diedAt: null,
        abandonedAt: null,
      },
      drawCount: 0,
      carriedLootId: null,
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
      contractProductionMultiplier: 1,
      armedSoulVialId: null,
      hideAndSeekDollBuilt: false,
    };
  }
}
