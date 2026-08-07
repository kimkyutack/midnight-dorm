export type GameStatus = 'LOBBY' | 'RANKED_INTRO' | 'GHOST_INTRO' | 'EVENT_INTRO' | 'COUNTDOWN' | 'PLAYING' | 'OVERTIME' | 'VICTORY' | 'DEFEAT' | 'CLOSED';

/** Server-authoritative match modifier.  The client only renders this state. */
export type MatchModifier = 'none' | 'time-attack';

export interface DifficultyRuleState {
  modifier: MatchModifier;
  /** Seconds left in the frozen event banner. */
  introRemaining: number;
  /** Time Attack combat clock; null outside that event. */
  timeAttackRemaining: number | null;
  /** Number of one-minute overtime scaling ticks already applied. */
  overtimeStacks: number;
  /** High difficulty ghost mechanics chosen when the room is created. */
  controlAdaptation: boolean;
  barrierLayers: number;
  directionalShield: boolean;
}

export type RankedTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'master' | 'challenger';

export interface RankedProfile {
  seasonId: string;
  rating: number;
  tier: RankedTier;
  placementCompleted: number;
  eligible: boolean;
  contractsPlayed: number;
  bestContractScores: number[];
}

/** Exactly one season constraint is active for each ranked season. */
export type RankedSeasonConstraint =
  | { kind: 'turret-limit'; maxTurrets: number }
  | { kind: 'random-box-limit'; maxRandomBoxes: number }
  | { kind: 'slow-resistance'; slowResistance: number }
  | { kind: 'bind-resistance'; bindResistance: number };

export interface RankedSeasonRules {
  /** Server-authoritative single constraint selected for this season. */
  constraint: RankedSeasonConstraint;
}

export interface RankedMatchState {
  seasonId: string;
  contractId: string;
  contractNumber: number;
  modifier: MatchModifier;
  goldenTurretPolicy: 'disabled' | 'loaned' | 'objective' | 'penalized';
  supplyPolicy: 'disabled' | 'loaned' | 'penalized';
  /** True only when every human entrant is playing a ranked match for the first time. */
  firstRankedMatch: boolean;
  /** Server-authoritative restrictions for this ranked season. */
  seasonRules: RankedSeasonRules;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Tile extends Vec2 {
  roomId?: string;
}

export interface MapRoom {
  id: string;
  shape: string;
  bounds: { x: number; y: number; width: number; height: number };
  door: Tile;
  bed: Tile;
  beds: Tile[];
  floorTiles: Tile[];
  buildTiles: Tile[];
}

export interface MapDefinition {
  seed: number;
  playMode: PlayMode;
  width: number;
  height: number;
  corridor: { x: number; y: number; width: number; height: number };
  corridorTiles: Tile[];
  /** Eight walkable ghost recovery pads: four corners and four edge centres. */
  respawnZones: Array<{ x: number; y: number; width: number; height: number }>;
  playerSpawn: Vec2;
  ghostSpawn: Vec2;
  rooms: MapRoom[];
  walls: Tile[];
  walkable: Tile[];
}

export type BuildingKind =
  | 'bed'
  | 'reinforced-door'
  | 'basic-turret'
  | 'rapid-turret'
  | 'frost-turret'
  | 'arc-turret'
  | 'golden-turret'
  | 'generator'
  | 'repair-drone'
  | 'electric-coil'
  | 'shield-device'
  | 'lucky-machine'
  | 'gem-core'
  | 'ghost-net'
  | 'range-amplifier'
  | 'overload-capacitor'
  | 'turret-enhancer'
  | 'door-anchor'
  | 'reflect-mirror'
  | 'power-panel'
  | 'cursed-contract'
  | 'soul-vial'
  | 'hide-and-seek-doll'
  | 'starter-grave'
  /** A drawn or countdown loot reward. It is placed like a small building. */
  | 'random-item';

export type TurretKind = 'basic-turret' | 'rapid-turret' | 'frost-turret' | 'arc-turret';
export type TurretSkinLoadout = Record<TurretKind, string>;

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type ConsumableId =
  | 'scout-flare'
  | 'path-chalk'
  | 'adrenal-shot'
  | 'quiet-slippers'
  | 'room-beacon'
  | 'quick-mortar'
  | 'hinge-brace'
  | 'ward-seal'
  | 'repair-window'
  | 'last-latch'
  | 'emergency-bedroll'
  | 'toolbelt-voucher'
  | 'echo-lens'
  | 'moon-compass'
  | 'sprint-candy'
  | 'mist-cape'
  | 'rescue-whistle'
  | 'patch-paste'
  | 'steel-rivet'
  | 'ice-seal'
  | 'rewind-clock'
  | 'calibrator-key'
  | 'turret-grease'
  | 'pulse-solder'
  | 'spare-gears'
  | 'copper-coil'
  | 'lens-kit'
  | 'welding-gel'
  | 'blueprint-chip'
  | 'field-crane';

export type ConsumableTarget = 'self' | 'tile' | 'room' | 'door' | 'building';

export interface OwnedConsumable {
  itemId: ConsumableId;
  quantity: number;
}

export interface OwnedItem {
  itemId: string;
  label: string;
  rarity: ItemRarity;
  count: number;
}

export type MatchMissionMetric =
  | 'build'
  | 'build-count'
  | 'upgrade-count'
  | 'reach-level'
  | 'spend-gold'
  | 'spend-power'
  | 'draw-item'
  | 'use-consumable'
  | 'free-repair'
  | 'soul-vial-use'
  | 'clear';

export interface MatchMissionProgress {
  id: string;
  title: string;
  description: string;
  metric: MatchMissionMetric;
  target: number;
  targetKind?: BuildingKind;
  rewardPoints: number;
  progress: number;
  completed: boolean;
}

export interface PlayerState {
  id: string;
  accountId: string | null;
  nickname: string;
  soloRank: RankId;
  multiplayerRank: RankId;
  displayRank: RankId;
  /** Public presentation only; gameplay always uses the real match mode. */
  profileDisplayMode: ProfileDisplayMode;
  /** Current season rank, present only when the player chooses the ranked label. */
  profileRankedSeasonId?: string;
  profileRankedTier: RankedTier;
  profileRankedRating: number;
  /** Public, versioned same-origin profile image URL when the player chose one. */
  profileAvatarUrl?: string | null;
  profileFrameId?: string | null;
  nameplateId?: string | null;
  equippedEmoteIds?: string[];
  appearance: AvatarAppearance;
  color: number;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  alive: boolean;
  spectator: boolean;
  position: Vec2;
  velocity: Vec2;
  hp: number;
  maxHp: number;
  gold: number;
  power: number;
  goldIncomeElapsed: number;
  powerIncomeElapsed: number;
  roomId: string | null;
  /** Room entered when the preparation countdown ended; its door is locked. */
  lockedRoomId?: string | null;
  bedIndex: number | null;
  turretSkins: TurretSkinLoadout;
  lastInputSeq: number;
  reconnectUntil: number;
  score: number;
  /** Server-authoritative inputs used for ranked contribution and RP settlement. */
  rankedContribution: {
    activeSeconds: number;
    turretDamage: number;
    defenseValue: number;
    controlSeconds: number;
    goldSpent: number;
    powerSpent: number;
    diedAt: number | null;
    abandonedAt: number | null;
  };
  drawCount: number;
  /** Account-wide daily random-box stock, consumed once for each successful draw. */
  randomBoxesRemaining: number;
  /** One countdown loot reward can be carried until the survivor claims a bed. */
  carriedLootId: string | null;
  /** The hamster passive applies only to the first guardian turret this player builds. */
  firstGuardianBuilt: boolean;
  items: OwnedItem[];
  consumables: OwnedConsumable[];
  consumableLoadout: ConsumableId[];
  usedConsumables: ConsumableId[];
  /** Optional per-match objectives. Rewards settle only with the final clear reward. */
  matchMissions: MatchMissionProgress[];
  speedBoostUntil: number;
  stealthUntil: number;
  bedrollUntil: number;
  upgradeDiscountTargetId: string | null;
  upgradeDiscountRate: number;
  /** A cursed contract can permanently improve this survivor's room production. */
  contractProductionMultiplier: number;
  /** The soul vial has been armed and is waiting for this survivor to select a turret. */
  armedSoulVialId: string | null;
  /** Hide-and-seek doll is a once-per-match installation, even after it is consumed. */
  hideAndSeekDollBuilt: boolean;
}

export interface RoomState {
  id: string;
  ownerId: string | null;
  ownerIds: string[];
  /** First occupant's equipped floor theme; empty means the stage room tile. */
  tileSkinId: string;
  /** Server elapsed time when the themed floor transition began. */
  tileSkinActivatedAt: number;
  doorHp: number;
  doorMaxHp: number;
  /** Gorilla double-door passive: temporary outer shield that takes door hits first. */
  doorShieldHp: number;
  doorShieldMaxHp: number;
  /** Prestige shield is granted once per match and never replenished by upgrades. */
  prestigeShieldGranted: boolean;
  prestigeShieldLayerHp: number;
  prestigeShieldLayersRemaining: number;
  doorLevel: number;
  bedLevel: number;
  bedLevels: number[];
  shieldUntil: number;
  beaconUntil: number;
  doorBraceUntil: number;
  doorWardUntil: number;
  lastLatchArmedBy: string | null;
  lastLatchUntil: number;
  lastDoorHitAt: number;
  doorRegenAccumulator: number;
  /** Manual repair heals 15 HP/s until this authoritative match time. */
  freeRepairUntil: number;
  /** Manual repair becomes available 60 seconds after the active repair ends. */
  freeRepairReadyAt: number;
  /** Player who started the current repair, used for ranked contribution credit. */
  freeRepairByPlayerId: string | null;
  /** Door anchor keeps the door at one HP until this server time. */
  doorAnchorUntil: number;
  /** Applied by a one-time cursed contract and retained through door upgrades. */
  doorMaxHpMultiplier: number;
  /** Tactical supplies can briefly turn one room into a focused firing lane. */
  supplyTurretDamageUntil: number;
  supplyTurretRateUntil: number;
  supplyTurretLevelUntil: number;
  /** Gold production is sealed only while a ghost is actively attacking this room's door. */
  goldSuppressedUntil: number;
  /** Ghost currently maintaining this room's gold seal. */
  goldSuppressedByGhostId: string | null;
}

export interface BuildingState {
  id: string;
  kind: BuildingKind;
  roomId: string;
  ownerId: string;
  skinId: string;
  tile: Tile;
  level: number;
  cooldown: number;
  hp: number;
  /** Present only for a placed random reward. */
  itemId?: string;
  investedGold?: number;
  investedPower?: number;
  investmentByPlayer?: Record<string, { gold: number; power: number }>;
  /** Temporary combat level from cardinally adjacent enhancers; may exceed the permanent art/upgrade cap. */
  effectiveLevel?: number;
  /** Overload capacitor finishes charging at this match time. */
  overloadReadyAt?: number;
  /** Overload window end time. */
  overloadUntil?: number;
  /** Soul damage accumulated from this owner's turret hits. */
  storedSoulDamage?: number;
  /** Permanent state granted by the berserk cursed contract. */
  berserk?: boolean;
  /** Two-second charge ends at this match time before one charged shot is fired. */
  soulChargeReadyAt?: number;
  /** Bonus damage dealt by the next charged turret shot. */
  soulChargeDamage?: number;
  /** Current selectable mode for the unique power panel. */
  powerPanelMode?: 'attack' | 'defense' | 'production';
  /** One armed shot and short-lived tuning effects supplied during a match. */
  supplyNextShotMultiplier?: number;
  supplyRateUntil?: number;
  supplyRangeUntil?: number;
}

/** A reward falling into a corridor during the preparation countdown. */
export interface LootDropState {
  id: string;
  itemId: string;
  tile: Tile;
  spawnedAt: number;
  landsAt: number;
  carriedBy: string | null;
}

export interface GhostState {
  id: string;
  position: Vec2;
  hp: number;
  maxHp: number;
  level: number;
  targetRoomId: string | null;
  /** 방을 점유하지 못한 생존자는 문보다 먼저 직접 추적한다. */
  targetPlayerId: string | null;
  attackCooldown: number;
  slowUntil: number;
  /** 그물 설비가 이동과 공격을 완전히 멈추는 서버 기준 시각. */
  stunnedUntil: number;
  /** 활성 감속 배율. 중첩된 서리 스프레이 효과를 서버가 권한 있게 보존한다. */
  slowMultiplier: number;
  /** Friends-mode prestige aura; separated from timed frost effects for clear rendering. */
  prestigeSlowMultiplier?: number;
  rage: boolean;
  phase: number;
  path: Tile[];
  displayName: string;
  variant: GhostVariant;
  attackCount: number;
  attacksToNextLevel: number;
  retreating: boolean;
  healing: boolean;
  healingElapsed: number;
  healingStartHp: number;
  retreatCount: number;
  skillCooldown: number;
  /** Gold lock waits here until this ghost's next legal door strike. */
  pendingStageSkill?: 'turret-jam' | 'gold-lock' | 'repair-lock' | 'door-crush' | null;
  abilityCooldown: number;
  /** High-difficulty control adaptation. It survives recovery retreats. */
  controlResolve: number;
  controlImmuneUntil: number;
  /** Last 25% resistance milestone announced to clients, preventing per-tick toast spam. */
  controlResistanceNoticeLevel: number;
  /** One net can trigger for each selected door-attack attempt. */
  netTriggeredTargetRoomId: string | null;
  barrierLayers: number;
  mistUntil: number;
  /** A short crossfire window used by directional-shield encounters. */
  shieldCrossfireUntil: number;
  shieldCrossfireRoomId: string | null;
  directionalShieldDisabledUntil: number;
  /** Mana-backed special actions stay server-authoritative and persist across reconnects. */
  mana: number;
  maxMana: number;
  abilityPhase: 'idle' | 'preparing' | 'casting';
  abilityStartedAt: number;
  abilityEndsAt: number;
  abilityTargetBuildingId: string | null;
  /** Wallpaper ghost contamination remains authoritative across reconnects. */
  contaminatedTiles: Tile[];
  contaminationEndsAt: number;
  /** A hide-and-seek doll briefly disorients the ghost before it follows a new route. */
  confusedUntil: number;
  /** When there is no alternative target, the ghost wanders corridors until this time. */
  wanderUntil: number;
  wanderTarget: Tile | null;
  /** Direct-combat supplies may expose a ghost to amplified turret damage. */
  vulnerableUntil: number;
  summonerId?: string;
}

export type GhostVariant =
  | 'wanderer'
  | 'swift'
  | 'brute'
  | 'caster'
  | 'twin-a'
  | 'twin-b'
  | 'teleporter'
  | 'undead'
  | 'giant'
  | 'demolisher'
  | 'wallpaper'
  | 'minion';

export type RankId =
  | 'beginner'
  | 'intermediate'
  | 'expert'
  | 'master'
  | 'veteran'
  | 'legend'
  | 'transcendent'
  | 'immortal'
  | 'absolute';
export type PlayMode = 'solo' | 'multiplayer';
/** The progression identity a player chooses to show on an in-game label. */
export type ProfileDisplayMode = PlayMode | 'ranked';
export type StageId = `${string}-${number}`;

/**
 * Survivor visuals are deliberately whole skins.  Individual clothing parts
 * are no longer saved, purchased, or rendered independently.
 */
export type CosmeticSlot = 'character' | 'skin' | 'tile' | 'turret';

export interface AvatarAppearance {
  character: string;
  skin: string;
  /** Room-floor theme applied when this survivor is the first bed occupant. */
  tileSkin?: string;
}

export type StorefrontThemeId = 'summer' | 'cyberpunk' | 'special-ops';
export type PromotionCampaignId = StorefrontThemeId | 'hide-seek-release';

export interface PromotionCampaignSetting {
  id: PromotionCampaignId;
  isVisible: boolean;
  sortOrder: number;
}

export interface StorefrontThemeSetting {
  id: StorefrontThemeId;
  isStoreVisible: boolean;
  sortOrder: number;
  cosmeticIds: string[];
}

export interface AccountProfile {
  id: string;
  username: string;
  nickname: string;
  soloRank: RankId;
  multiplayerRank: RankId;
  displayRank: RankId;
  soloXp: number;
  multiplayerXp: number;
  soloStageIndex: number;
  multiplayerStageIndex: number;
  selectedPlayMode: 'solo' | 'multiplayer' | 'ranked';
  /** Saved independently from selectedPlayMode to avoid changing match choice. */
  profileDisplayMode: ProfileDisplayMode;
  /** Small, server-served image selected from the device photo library. */
  profileAvatarUrl: string | null;
  /** Uploaded avatar remains stored even when a prestige preset is selected. */
  uploadedProfileAvatarUrl: string | null;
  prestige: {
    ghostOrbs: number;
    pityDrawCount: number;
    ownedPackageIds: string[];
    profileImageId: string | null;
    profileFrameId: string | null;
    nameplateId: string | null;
    homeBackgroundId: string | null;
    ownedAccessoryIds: string[];
    ownedEmoteIds: string[];
    equippedEmoteIds: string[];
  };
  ranked: RankedProfile;
  victories: number;
  /** Paid, server-authoritative currency. Store purchases only top up this wallet. */
  cash: number;
  /** Product IDs that already consumed their per-SKU first-purchase 20% bonus. */
  cashFirstPurchaseProductIds: string[];
  customPoints: number;
  /** Server-authoritative ad-removal entitlement used by reward and home UI. */
  adFree: {
    active: boolean;
    plan: 'monthly' | 'permanent' | null;
    expiresAt: number | null;
  };
  ownedCosmetics: string[];
  appearance: AvatarAppearance;
  turretSkins: TurretSkinLoadout;
  consumables: OwnedConsumable[];
  randomBoxes: {
    remaining: number;
    refillsClaimed: number;
    maxRefills: number;
    refillAmount: number;
    periodKey: string;
  };
  /** Launch campaigns the current account chose not to see again. */
  dismissedPromotionIds: string[];
  /** Server-managed launch popup visibility and display order. */
  promotionCampaigns: PromotionCampaignSetting[];
  /** Server-managed theme availability. This only filters the point shop. */
  storefrontThemes: StorefrontThemeSetting[];
  /** The first-match survival training remains active until its first victory. */
  tutorialCompleted: boolean;
  createdAt: number;
}

export type TutorialStep =
  | 'pickup-loot'
  | 'claim-bed'
  | 'upgrade-bed'
  | 'upgrade-door'
  | 'build-turret'
  | 'upgrade-turret'
  | 'build-generator'
  | 'build-net'
  | 'finish';

export interface TutorialState {
  active: boolean;
  step: TutorialStep;
  /** Bots never reserve this room, so the player always has a clear route. */
  reservedRoomId: string | null;
  /** The single corridor reward that begins the guided route. */
  guidedLootId: string | null;
  /** During the recovery lesson the whole simulation is deliberately paused. */
  pauseRemaining: number;
  retreatExplained: boolean;
  powerGranted: boolean;
  /** The final turret hit is lethal only after the tutorial net has fired. */
  netTriggered: boolean;
  /** Two-second camera reveal after the net is installed and before combat. */
  combatRevealRemaining: number;
  /** The training ghost stays frozen until the reveal has fully completed. */
  combatStarted: boolean;
}

export interface GameSnapshot {
  matchId: string;
  roomCode: string;
  status: GameStatus;
  hostId: string | null;
  seed: number;
  serverSeq: number;
  elapsed: number;
  countdown: number;
  players: PlayerState[];
  rooms: RoomState[];
  buildings: BuildingState[];
  lootDrops: LootDropState[];
  ghost: GhostState;
  ghosts: GhostState[];
  matchEvent: string;
  stageId: StageId;
  stageLabel: string;
  stageIndex: number;
  playMode: PlayMode;
  difficulty: DifficultyRuleState;
  /** A cursed contract is a match-wide, non-refundable one-time decision. */
  contractUsed: boolean;
  ranked: RankedMatchState | null;
  /** Present only in the mandatory first-victory training match. */
  tutorial: TutorialState | null;
  /** Deprecated aggregate retained for legacy snapshot compatibility. */
  goldSuppressedUntil: number;
  repairSuppressedUntil: number;
  winner: 'survivors' | 'ghost' | null;
}

/**
 * High-frequency realtime frame. Buildings are carried separately because
 * their visual state changes far less often than actors and match timers.
 */
export type GameSnapshotFrame = Omit<GameSnapshot, 'buildings'>;

export type GameEventKind =
  | 'gold'
  | 'power'
  | 'build'
  | 'building-remove'
  | 'upgrade'
  | 'turret-fire'
  | 'ghost-hit'
  | 'door-hit'
  | 'door-repair'
  | 'player-hit'
  | 'death'
  | 'ghost-level-up'
  | 'ghost-retreat'
  | 'ghost-return'
  | 'ghost-skill'
  | 'ghost-net'
  | 'item-draw'
  | 'item-drop'
  | 'item-pickup'
  | 'consumable-use'
  | 'elite-join'
  | 'auto-bed-claim'
  | 'lights-on'
  | 'victory'
  | 'defeat';

export interface GameEvent {
  kind: GameEventKind;
  /** Stable source identity lets clients coalesce visual-only rapid fire. */
  sourceId?: string;
  position?: Vec2;
  /** World position of the actor that produced the event, when it matters for replay. */
  sourcePosition?: Vec2;
  playerId?: string;
  roomId?: string;
  amount?: number;
  targetPosition?: Vec2;
  targetId?: string;
  buildingKind?: BuildingKind;
  itemId?: string;
  label?: string;
  rarity?: ItemRarity;
}

/** Deliberately limited in-game callouts keep mobile co-op readable. */
export type QuickChatPhrase = '문 위험!' | '포탑 강화해!' | '내가 끝낼게!' | '좋은 아이템 발견!';

export interface BaseMessage {
  type: string;
  sequence: number;
  timestamp: number;
}

export type ClientMessage =
  | (BaseMessage & { type: 'ready'; ready: boolean })
  | (BaseMessage & { type: 'start' })
  | (BaseMessage & { type: 'add-bot'; difficulty: 'easy' | 'normal' | 'hard' })
  | (BaseMessage & { type: 'remove-bot'; botId: string })
  | (BaseMessage & { type: 'leave-room' })
  | (BaseMessage & { type: 'kick-player'; playerId: string })
  | (BaseMessage & {
      type: 'move';
      dx: number;
      dy: number;
      inputSequence: number;
      /**
       * The locally rendered position captured only when a drag is released.
       * The server treats this as a bounded reconciliation hint, never as an
       * authoritative teleport destination.
       */
      releasePosition?: Vec2;
    })
  | (BaseMessage & { type: 'interact' })
  | (BaseMessage & { type: 'free-repair' })
  | (BaseMessage & { type: 'build'; roomId: string; tile: Tile; kind: BuildingKind })
  | (BaseMessage & { type: 'move-building'; buildingId: string; tile: Tile })
  | (BaseMessage & { type: 'upgrade'; targetId: string })
  | (BaseMessage & { type: 'remove-building'; buildingId: string })
  | (BaseMessage & { type: 'activate-building'; buildingId: string; action: 'use' | 'attack' | 'defense' | 'production' | 'berserk' | 'soul-arm' | 'soul-cancel' | 'soul-fire' | 'hide-and-seek' | 'install-golden-turret'; targetId?: string })
  | (BaseMessage & { type: 'draw-item'; machineId: string })
  | (BaseMessage & { type: 'pickup-loot'; lootId: string })
  | (BaseMessage & { type: 'set-consumable-loadout'; itemIds: ConsumableId[] })
  | (BaseMessage & { type: 'use-consumable'; itemId: ConsumableId; roomId?: string; targetId?: string; tile?: Tile })
  | (BaseMessage & { type: 'quick-chat'; phrase: QuickChatPhrase })
  | (BaseMessage & { type: 'game-chat'; message: string })
  | (BaseMessage & { type: 'game-emote'; emoteId: string })
  | (BaseMessage & { type: 'rematch' })
  | (BaseMessage & { type: 'ping'; clientTime: number })
  | (BaseMessage & { type: 'resync' });

export type ServerMessage =
  | (BaseMessage & {
      type: 'welcome';
      playerId: string;
      reconnectToken: string;
      reconnectDeadline: number;
      map: MapDefinition;
      snapshot: GameSnapshot;
    })
  | (BaseMessage & { type: 'snapshot'; snapshot: GameSnapshot; events: GameEvent[] })
  | (BaseMessage & {
      type: 'snapshot-frame';
      snapshot: GameSnapshotFrame;
      /** Omitted while the normalized building state has not changed. */
      buildings?: BuildingState[];
      events: GameEvent[];
    })
  | (BaseMessage & { type: 'error'; code: string; message: string })
  | (BaseMessage & { type: 'pong'; clientTime: number; serverTime: number })
  | (BaseMessage & { type: 'quick-chat'; playerId: string; phrase: QuickChatPhrase })
  | (BaseMessage & { type: 'game-chat'; playerId: string; message: string })
  | (BaseMessage & { type: 'game-emote'; playerId: string; emoteId: string })
  | (BaseMessage & { type: 'room-exit'; reason: 'left' | 'kicked' | 'room-closed' })
  | (BaseMessage & { type: 'room-closed'; reason: string });

export interface JoinIdentity {
  nickname: string;
  deviceId: string;
  reconnectToken?: string;
  accountId?: string;
  soloRank?: RankId;
  multiplayerRank?: RankId;
  profileDisplayMode?: ProfileDisplayMode;
  profileRankedSeasonId?: string;
  profileRankedTier?: RankedTier;
  profileRankedRating?: number;
  profileAvatarUrl?: string | null;
  profileFrameId?: string | null;
  nameplateId?: string | null;
  equippedEmoteIds?: string[];
  appearance?: AvatarAppearance;
  turretSkins?: TurretSkinLoadout;
  consumables?: OwnedConsumable[];
  randomBoxesRemaining?: number;
}
