export type GameStatus = 'LOBBY' | 'COUNTDOWN' | 'PLAYING' | 'VICTORY' | 'DEFEAT' | 'CLOSED';

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
  | 'floor-trap'
  | 'shield-device'
  | 'lucky-machine'
  | 'gem-core'
  | 'ghost-net'
  | 'range-amplifier'
  | 'starter-grave';

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

export interface PlayerState {
  id: string;
  accountId: string | null;
  nickname: string;
  soloRank: RankId;
  multiplayerRank: RankId;
  displayRank: RankId;
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
  bedIndex: number | null;
  turretSkins: TurretSkinLoadout;
  lastInputSeq: number;
  reconnectUntil: number;
  score: number;
  drawCount: number;
  /** The hamster passive applies only to the first guardian turret this player builds. */
  firstGuardianBuilt: boolean;
  items: OwnedItem[];
  consumables: OwnedConsumable[];
  consumableLoadout: ConsumableId[];
  usedConsumables: ConsumableId[];
  speedBoostUntil: number;
  stealthUntil: number;
  bedrollUntil: number;
  upgradeDiscountTargetId: string | null;
  upgradeDiscountRate: number;
}

export interface RoomState {
  id: string;
  ownerId: string | null;
  ownerIds: string[];
  doorHp: number;
  doorMaxHp: number;
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
  investedGold?: number;
  investedPower?: number;
  investmentByPlayer?: Record<string, { gold: number; power: number }>;
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
  /** 활성 감속 배율. 그림자 덫의 레벨별 감속 효과를 서버가 권한 있게 보존한다. */
  slowMultiplier: number;
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
  abilityCooldown: number;
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
  | 'minion';

export type RankId = 'beginner' | 'intermediate' | 'expert' | 'master' | 'veteran' | 'legend';
export type PlayMode = 'solo' | 'multiplayer';
export type StageId = `${string}-${number}`;

/**
 * Survivor visuals are deliberately whole skins.  Individual clothing parts
 * are no longer saved, purchased, or rendered independently.
 */
export type CosmeticSlot = 'character' | 'skin' | 'turret';

export interface AvatarAppearance {
  character: string;
  skin: string;
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
  victories: number;
  customPoints: number;
  ownedCosmetics: string[];
  appearance: AvatarAppearance;
  turretSkins: TurretSkinLoadout;
  consumables: OwnedConsumable[];
  createdAt: number;
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
  ghost: GhostState;
  ghosts: GhostState[];
  matchEvent: string;
  stageId: StageId;
  stageLabel: string;
  stageIndex: number;
  playMode: PlayMode;
  goldSuppressedUntil: number;
  repairSuppressedUntil: number;
  winner: 'survivors' | 'ghost' | null;
}

export type GameEventKind =
  | 'gold'
  | 'power'
  | 'build'
  | 'building-remove'
  | 'upgrade'
  | 'turret-fire'
  | 'ghost-hit'
  | 'door-hit'
  | 'player-hit'
  | 'death'
  | 'ghost-level-up'
  | 'ghost-retreat'
  | 'ghost-return'
  | 'ghost-skill'
  | 'ghost-net'
  | 'item-draw'
  | 'consumable-use'
  | 'elite-join'
  | 'victory'
  | 'defeat';

export interface GameEvent {
  kind: GameEventKind;
  position?: Vec2;
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
  | (BaseMessage & { type: 'move'; dx: number; dy: number; inputSequence: number })
  | (BaseMessage & { type: 'interact' })
  | (BaseMessage & { type: 'build'; roomId: string; tile: Tile; kind: BuildingKind })
  | (BaseMessage & { type: 'upgrade'; targetId: string })
  | (BaseMessage & { type: 'remove-building'; buildingId: string })
  | (BaseMessage & { type: 'draw-item'; machineId: string })
  | (BaseMessage & { type: 'set-consumable-loadout'; itemIds: ConsumableId[] })
  | (BaseMessage & { type: 'use-consumable'; itemId: ConsumableId; roomId?: string; targetId?: string; tile?: Tile })
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
  | (BaseMessage & { type: 'error'; code: string; message: string })
  | (BaseMessage & { type: 'pong'; clientTime: number; serverTime: number })
  | (BaseMessage & { type: 'room-exit'; reason: 'left' | 'kicked' | 'room-closed' })
  | (BaseMessage & { type: 'room-closed'; reason: string });

export interface JoinIdentity {
  nickname: string;
  deviceId: string;
  reconnectToken?: string;
  accountId?: string;
  soloRank?: RankId;
  multiplayerRank?: RankId;
  appearance?: AvatarAppearance;
  turretSkins?: TurretSkinLoadout;
  consumables?: OwnedConsumable[];
}
