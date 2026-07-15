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
  floorTiles: Tile[];
  buildTiles: Tile[];
}

export interface MapDefinition {
  seed: number;
  width: number;
  height: number;
  corridor: { x: number; y: number; width: number; height: number };
  respawnZone: { x: number; y: number; width: number; height: number };
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
  | 'generator'
  | 'repair-drone'
  | 'electric-coil'
  | 'floor-trap'
  | 'shield-device'
  | 'lucky-machine';

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

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
  roomId: string | null;
  lastInputSeq: number;
  reconnectUntil: number;
  score: number;
  drawCount: number;
  items: OwnedItem[];
}

export interface RoomState {
  id: string;
  ownerId: string | null;
  doorHp: number;
  doorMaxHp: number;
  doorLevel: number;
  bedLevel: number;
  shieldUntil: number;
}

export interface BuildingState {
  id: string;
  kind: BuildingKind;
  roomId: string;
  ownerId: string;
  tile: Tile;
  level: number;
  cooldown: number;
  hp: number;
}

export interface GhostState {
  id: string;
  position: Vec2;
  hp: number;
  maxHp: number;
  level: number;
  targetRoomId: string | null;
  attackCooldown: number;
  slowUntil: number;
  rage: boolean;
  phase: number;
  path: Tile[];
  displayName: string;
  variant: GhostVariant;
  attackCount: number;
  attacksToNextLevel: number;
  retreating: boolean;
  healing: boolean;
  retreatCount: number;
  skillCooldown: number;
}

export type GhostVariant = 'wanderer' | 'swift' | 'brute' | 'caster' | 'twin-a' | 'twin-b';

export type RankId = 'beginner' | 'intermediate' | 'expert' | 'master' | 'veteran' | 'legend';
export type PlayMode = 'solo' | 'multiplayer';
export type StageId = `${string}-${number}`;

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
  | 'item-draw'
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
  | (BaseMessage & { type: 'move'; dx: number; dy: number; inputSequence: number })
  | (BaseMessage & { type: 'interact' })
  | (BaseMessage & { type: 'build'; roomId: string; tile: Tile; kind: BuildingKind })
  | (BaseMessage & { type: 'upgrade'; targetId: string })
  | (BaseMessage & { type: 'draw-item'; machineId: string })
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
  | (BaseMessage & { type: 'room-closed'; reason: string });

export interface JoinIdentity {
  nickname: string;
  deviceId: string;
  reconnectToken?: string;
  accountId?: string;
  soloRank?: RankId;
  multiplayerRank?: RankId;
}
