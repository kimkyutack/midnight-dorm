import { SeededRandom } from './rng';
import type { AvatarAppearance, RankId, Tile } from './types';

export const HIDE_SEEK_RULES = {
  maxSurvivors: 6,
  maxPlayers: 7,
  roleLockSeconds: 5,
  hideSeconds: 20,
  huntSeconds: 450,
  lastEscapeSeconds: 30,
  requiredKeys: 5,
  keySpawnSeconds: [0, 50, 100, 150, 200] as const,
  baseSpeed: 6.24,
  collisionRadius: 0.32,
  lanternRange: 2,
  ghostLightRange: 7,
  ghostLightSeconds: 4,
  ghostLightCooldownSeconds: 100,
  detectionHoldRange: 4,
  proximityAlertRange: 6,
  detectionReleaseSeconds: 0.4,
  survivorSprintMultiplier: 1.2,
  survivorSprintSeconds: 4,
  survivorSprintCooldownSeconds: 24,
  ghostSprintMultiplier: 1.3,
  ghostSprintSeconds: 5,
  ghostSprintCooldownSeconds: 60,
  ghostSprintOpeningLockSeconds: 10,
  keyPickupSeconds: 0,
  hideoutSearchSeconds: 2,
  exitUnlockSeconds: 3,
  survivorVictoryPoints: 100,
  ghostVictoryPoints: 150,
} as const;

export type HideSeekPhase =
  | 'LOBBY'
  | 'ROLE_LOCK'
  | 'HIDE'
  | 'HUNT'
  | 'LAST_ESCAPE'
  | 'RESULT'
  | 'CLOSED';
export type HideSeekRole = 'ghost' | 'survivor';
export type HideSeekResultReason = 'ghost-abandoned' | 'last-survivor-abandoned' | null;
export type HideSeekRolePreference = 'ghost' | 'survivor' | 'any';
export type HideSeekQuickChat = '귀신 발견!' | '열쇠 발견!' | '탈출로 발견!' | '도망쳐!';
export type HideSeekRegionId = 'reception' | 'ward' | 'surgery' | 'nurses' | 'laundry' | 'records' | 'maintenance';

export interface HideSeekRegion {
  id: HideSeekRegionId;
  label: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface HideSeekHideout {
  id: string;
  tile: Tile;
  /** Single corridor tile visible to a survivor while concealed. */
  front: Tile;
  kind: 'locker' | 'cabinet' | 'bed' | 'double-locker' | 'laundry-bin' | 'privacy-screen';
}

export interface HideSeekGhostRoom {
  interior: Tile[];
  door: Tile;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface HideSeekLandmark {
  id: string;
  tile: Tile;
  kind: 'nurse-station' | 'operating-table' | 'ward-room' | 'reception-desk';
  footprint: { width: number; height: number };
}

export interface HideSeekMap {
  seed: number;
  width: number;
  height: number;
  walkable: Tile[];
  walls: Tile[];
  survivorSpawns: Tile[];
  ghostSpawn: Tile;
  ghostRoom: HideSeekGhostRoom;
  hideouts: HideSeekHideout[];
  landmarks: HideSeekLandmark[];
  keySpawns: Tile[];
  exitCandidates: Tile[];
  regions: HideSeekRegion[];
}

export interface HideSeekPlayer {
  id: string;
  accountId?: string;
  nickname: string;
  deviceId: string;
  reconnectToken: string;
  connected: boolean;
  isBot: boolean;
  botControlled: boolean;
  /** Explicitly left before the result; unlike a dropped connection, this slot cannot earn rewards. */
  abandoned: boolean;
  ready: boolean;
  preference: HideSeekRolePreference;
  role: HideSeekRole | null;
  number: number | null;
  position: Tile;
  previousPosition: Tile;
  direction: Tile;
  movement: Tile;
  alive: boolean;
  escaped: boolean;
  hiddenIn: string | null;
  detected: boolean;
  /** Yellow warning shown when the opposing role is within six tiles. */
  proximityAlert: boolean;
  /** Survivor-only 0..1 ghost footstep loudness derived from proximity. */
  ghostFootstepLevel: number;
  detectionReleaseAt: number;
  sprintUntil: number;
  sprintReadyAt: number;
  lightUntil: number;
  lightReadyAt: number;
  interactionTarget: string | null;
  interactionProgress: number;
  displayRank: RankId;
  appearance: AvatarAppearance;
}

export interface HideSeekKeyState {
  id: string;
  tile: Tile;
  regionId: HideSeekRegionId;
  spawnedAt: number;
  status: 'ground' | 'carried' | 'used';
  carrierId: string | null;
  /** @deprecated Rolling-deploy compatibility for older web/native clients. */
  collectedBy?: string | null;
}

export interface HideSeekSnapshot {
  code: string;
  matchId: string;
  hostId: string | null;
  phase: HideSeekPhase;
  phaseRemaining: number;
  elapsed: number;
  serverSeq: number;
  players: HideSeekPlayer[];
  keys: HideSeekKeyState[];
  keyHint: { keyId: string; regionId: HideSeekRegionId } | null;
  /** Number of exit locks permanently opened by delivered keys. */
  unlockedLocks: number;
  /** @deprecated Alias for older clients; mirrors unlockedLocks. */
  collectedKeys?: number;
  activeExit: Tile;
  exitDiscovered: boolean;
  exitOpen: boolean;
  firstEscapeAt: number | null;
  winner: HideSeekRole | null;
  resultReason: HideSeekResultReason;
  exploredTileKeys: string[];
  explorationRevision: number;
}

export type HideSeekClientMessage =
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'add-bot'; preference?: HideSeekRolePreference }
  | { type: 'remove-bot'; playerId: string }
  | { type: 'set-preference'; preference: HideSeekRolePreference }
  | { type: 'move'; dx: number; dy: number; inputSequence: number }
  | { type: 'sprint' }
  | { type: 'ghost-light' }
  | { type: 'interact' }
  | { type: 'stop-interact' }
  | { type: 'quick-chat'; phrase: HideSeekQuickChat }
  | { type: 'chat'; text: string }
  | { type: 'spectate'; playerId: string }
  | { type: 'leave-room' }
  | { type: 'ping'; clientTime: number };

export type HideSeekServerMessage =
  | { type: 'welcome'; playerId: string; reconnectToken: string; map: HideSeekMap; snapshot: HideSeekSnapshot; exploredBits?: string }
  | { type: 'snapshot'; snapshot: HideSeekSnapshot; exploredBits?: string }
  | { type: 'quick-chat'; playerId: string; playerNumber: number; phrase: HideSeekQuickChat; position: Tile }
  | { type: 'chat'; playerId: string; playerNumber: number; text: string; position: Tile }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; message: string }
  | { type: 'room-exit'; reason: 'left' | 'kicked' | 'room-closed' };

export function hideSeekVictoryPoints(role: HideSeekRole | null, winner: HideSeekRole | null, abandoned = false): number {
  if (!role || role !== winner || abandoned) return 0;
  return role === 'ghost' ? HIDE_SEEK_RULES.ghostVictoryPoints : HIDE_SEEK_RULES.survivorVictoryPoints;
}

/** Keep the server and client on the same smooth wall-sliding rule. */
export function resolveHideSeekMovement(
  position: Tile,
  delta: Tile,
  canOccupy: (candidate: Tile) => boolean,
): Tile {
  const next = { x: position.x + delta.x, y: position.y + delta.y };
  if (canOccupy(next)) return next;
  const xOnly = { x: position.x + delta.x, y: position.y };
  if (canOccupy(xOnly)) return xOnly;
  const yOnly = { x: position.x, y: position.y + delta.y };
  if (canOccupy(yOnly)) return yOnly;
  return { ...position };
}

const tileKey = (tile: Tile): string => `${tile.x},${tile.y}`;
const wallKeyCache = new WeakMap<HideSeekMap, Set<string>>();

function regionForTile(regions: readonly HideSeekRegion[], tile: Tile): HideSeekRegion {
  return regions.find((region) =>
    tile.x >= region.minX && tile.x <= region.maxX && tile.y >= region.minY && tile.y <= region.maxY,
  ) ?? regions[0] as HideSeekRegion;
}

/** Deterministic large hospital used only by the hide-and-seek mode. */
export function generateHideSeekMap(seed: number): HideSeekMap {
  const rng = new SeededRandom(seed);
  const width = 84;
  const height = 60;
  const walls = new Set<string>();
  const addWall = (x: number, y: number): void => { walls.add(`${x},${y}`); };
  for (let x = 0; x < width; x += 1) {
    addWall(x, 0);
    addWall(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    addWall(0, y);
    addWall(width - 1, y);
  }

  // Four hospital wings are connected by several broad doors so the larger
  // map remains navigable without turning one doorway into a camp point.
  for (const x of [21, 42, 63]) {
    for (let y = 2; y < height - 2; y += 1) {
      if ([8, 23, 38, 52].some((gate) => Math.abs(y - gate) <= 1)) continue;
      addWall(x, y);
    }
  }
  for (const y of [15, 30, 45]) {
    for (let x = 2; x < width - 2; x += 1) {
      if ([10, 31, 53, 74].some((gate) => Math.abs(x - gate) <= 1)) continue;
      addWall(x, y);
    }
  }

  const addRoom = (x: number, y: number, roomWidth: number, roomHeight: number, door: Tile): void => {
    for (let dx = 0; dx < roomWidth; dx += 1) for (let dy = 0; dy < roomHeight; dy += 1) {
      if (dx !== 0 && dy !== 0 && dx !== roomWidth - 1 && dy !== roomHeight - 1) continue;
      const wall = { x: x + dx, y: y + dy };
      if (Math.hypot(wall.x - door.x, wall.y - door.y) <= 1) continue;
      addWall(wall.x, wall.y);
    }
  };
  // Recognizable patient rooms, an operating theatre and records rooms.
  addRoom(3, 3, 15, 10, { x: 10, y: 12 });
  addRoom(3, 18, 15, 10, { x: 17, y: 23 });
  addRoom(66, 3, 15, 11, { x: 73, y: 13 });
  addRoom(66, 18, 15, 10, { x: 66, y: 23 });
  addRoom(66, 33, 15, 10, { x: 73, y: 33 });
  addRoom(66, 48, 15, 9, { x: 66, y: 52 });
  addRoom(24, 3, 15, 10, { x: 31, y: 12 });
  addRoom(45, 47, 15, 10, { x: 52, y: 47 });

  const landmarks: HideSeekLandmark[] = [
    { id: 'landmark-nurses', kind: 'nurse-station', tile: { x: 31, y: 8 }, footprint: { width: 5, height: 3 } },
    { id: 'landmark-surgery', kind: 'operating-table', tile: { x: 73, y: 8 }, footprint: { width: 3, height: 5 } },
    { id: 'landmark-ward', kind: 'ward-room', tile: { x: 10, y: 7 }, footprint: { width: 5, height: 4 } },
    { id: 'landmark-reception', kind: 'reception-desk', tile: { x: 34, y: 23 }, footprint: { width: 5, height: 3 } },
  ];
  for (const landmark of landmarks) {
    const halfWidth = Math.floor(landmark.footprint.width / 2);
    const halfHeight = Math.floor(landmark.footprint.height / 2);
    for (let dx = -halfWidth; dx <= halfWidth; dx += 1) for (let dy = -halfHeight; dy <= halfHeight; dy += 1) {
      addWall(landmark.tile.x + dx, landmark.tile.y + dy);
    }
  }

  // A private holding room keeps the ghost out of the survivor route during
  // the hiding countdown. The doorway is walkable in the shared map, while
  // the authoritative engine applies role/phase-specific access rules.
  const ghostRoomBounds = { minX: 46, maxX: 52, minY: 34, maxY: 40 };
  const ghostRoomDoor = { x: 49, y: 40 };
  for (let y = ghostRoomBounds.minY; y <= ghostRoomBounds.maxY; y += 1) {
    for (let x = ghostRoomBounds.minX; x <= ghostRoomBounds.maxX; x += 1) {
      const perimeter = x === ghostRoomBounds.minX || x === ghostRoomBounds.maxX
        || y === ghostRoomBounds.minY || y === ghostRoomBounds.maxY;
      const key = `${x},${y}`;
      if (perimeter && key !== tileKey(ghostRoomDoor)) walls.add(key);
      else walls.delete(key);
    }
  }
  const ghostRoomInterior: Tile[] = [];
  for (let y = ghostRoomBounds.minY + 1; y < ghostRoomBounds.maxY; y += 1) {
    for (let x = ghostRoomBounds.minX + 1; x < ghostRoomBounds.maxX; x += 1) {
      ghostRoomInterior.push({ x, y });
    }
  }

  const wallTiles = [...walls].map((value) => {
    const [x, y] = value.split(',').map(Number);
    return { x: x as number, y: y as number };
  });
  const walkable: Tile[] = [];
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    if (!walls.has(`${x},${y}`)) walkable.push({ x, y });
  }
  const walkableSet = new Set(walkable.map(tileKey));
  const ghostRoomTileKeys = new Set([...ghostRoomInterior, ghostRoomDoor].map(tileKey));
  const candidatesBesideWalls = walkable.filter((tile) =>
    !ghostRoomTileKeys.has(tileKey(tile))
    && landmarks.every((landmark) => Math.hypot(tile.x - landmark.tile.x, tile.y - landmark.tile.y) >= 4)
    && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walls.has(`${tile.x + (dx as number)},${tile.y + (dy as number)}`)),
  );
  const spreadPick = (source: readonly Tile[], count: number, minimumDistance: number): Tile[] => {
    const pool = rng.shuffle(source);
    const selected: Tile[] = [];
    for (const tile of pool) {
      if (selected.every((other) => Math.hypot(tile.x - other.x, tile.y - other.y) >= minimumDistance)) selected.push(tile);
      if (selected.length >= count) break;
    }
    return selected;
  };
  const hideoutTiles = spreadPick(candidatesBesideWalls, 48, 3);
  const hideouts: HideSeekHideout[] = hideoutTiles.map((tile, index) => {
    const front = ([
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y - 1 },
    ] as Tile[]).find((candidate) => walkableSet.has(tileKey(candidate)) && tileKey(candidate) !== tileKey(tile)) ?? tile;
    return {
      id: `hideout-${index + 1}`,
      tile,
      front,
      kind: (['locker', 'cabinet', 'bed', 'double-locker', 'laundry-bin', 'privacy-screen'] as const)[index % 6] as HideSeekHideout['kind'],
    };
  });
  const keySpawns = spreadPick(
    walkable.filter((tile) => !ghostRoomTileKeys.has(tileKey(tile)) && tile.x > 4 && tile.x < width - 5 && tile.y > 3 && tile.y < height - 4),
    32,
    7,
  );
  const nearestWalkable = (target: Tile): Tile => walkable
    .reduce((best, tile) => Math.hypot(tile.x - target.x, tile.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y) ? tile : best, walkable[0] as Tile);
  const survivorSpawns = [
    { x: 5, y: 5 }, { x: 8, y: 53 }, { x: 27, y: 18 },
    { x: 56, y: 40 }, { x: 76, y: 17 }, { x: 78, y: 52 },
  ].map((tile) => walkableSet.has(tileKey(tile)) ? tile : nearestWalkable(tile));
  const exitCandidates = [{ x: 1, y: 8 }, { x: 82, y: 20 }, { x: 1, y: 52 }, { x: 82, y: 52 }]
    .map((tile) => walkableSet.has(tileKey(tile)) ? tile : nearestWalkable(tile));
  const regions: HideSeekRegion[] = [
    { id: 'ward', label: '폐쇄 병동', minX: 1, maxX: 20, minY: 1, maxY: 29 },
    { id: 'laundry', label: '세탁·격리실', minX: 1, maxX: 20, minY: 30, maxY: 58 },
    { id: 'nurses', label: '병동 카운터', minX: 22, maxX: 62, minY: 1, maxY: 14 },
    { id: 'reception', label: '중앙 접수 구역', minX: 22, maxX: 62, minY: 16, maxY: 44 },
    { id: 'maintenance', label: '지하 정비 구역', minX: 22, maxX: 62, minY: 46, maxY: 58 },
    { id: 'surgery', label: '수술실', minX: 64, maxX: 82, minY: 1, maxY: 29 },
    { id: 'records', label: '의무기록 보관실', minX: 64, maxX: 82, minY: 30, maxY: 58 },
  ];
  return {
    seed,
    width,
    height,
    walkable,
    walls: wallTiles,
    survivorSpawns,
    ghostSpawn: { x: 49, y: 37 },
    ghostRoom: {
      interior: ghostRoomInterior,
      door: ghostRoomDoor,
      bounds: ghostRoomBounds,
    },
    hideouts,
    landmarks,
    keySpawns,
    exitCandidates,
    regions,
  };
}

export function hideSeekRegionAt(map: HideSeekMap, tile: Tile): HideSeekRegion {
  return regionForTile(map.regions, tile);
}

export function hideSeekHasLineOfSight(map: HideSeekMap, from: Tile, to: Tile): boolean {
  let walls = wallKeyCache.get(map);
  if (!walls) {
    walls = new Set(map.walls.map(tileKey));
    wallKeyCache.set(map, walls);
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) * 5));
  for (let index = 1; index < steps; index += 1) {
    const progress = index / steps;
    const x = Math.round(from.x + (to.x - from.x) * progress);
    const y = Math.round(from.y + (to.y - from.y) * progress);
    if (walls.has(`${x},${y}`)) return false;
  }
  return true;
}

export function hideSeekLanternSees(map: HideSeekMap, ghost: HideSeekPlayer, survivor: HideSeekPlayer): boolean {
  if (!survivor.alive || survivor.escaped || survivor.hiddenIn) return false;
  if (Math.hypot(survivor.position.x - ghost.position.x, survivor.position.y - ghost.position.y) > HIDE_SEEK_RULES.lanternRange) return false;
  return hideSeekHasLineOfSight(map, ghost.position, survivor.position);
}

export function hideSeekGhostLightSees(map: HideSeekMap, ghost: HideSeekPlayer, survivor: HideSeekPlayer, elapsed: number): boolean {
  if (elapsed >= ghost.lightUntil || !survivor.alive || survivor.escaped || survivor.hiddenIn) return false;
  if (Math.hypot(survivor.position.x - ghost.position.x, survivor.position.y - ghost.position.y) > HIDE_SEEK_RULES.ghostLightRange) return false;
  return hideSeekHasLineOfSight(map, ghost.position, survivor.position);
}

export function parseHideSeekClientMessage(raw: string | ArrayBuffer): HideSeekClientMessage | null {
  try {
    const value = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) as Record<string, unknown>;
    if (value.type === 'ready' && typeof value.ready === 'boolean') return { type: 'ready', ready: value.ready };
    if (value.type === 'start' || value.type === 'interact' || value.type === 'stop-interact' || value.type === 'sprint' || value.type === 'ghost-light' || value.type === 'leave-room') return { type: value.type } as HideSeekClientMessage;
    if (value.type === 'set-preference' && ['ghost', 'survivor', 'any'].includes(String(value.preference))) return { type: 'set-preference', preference: value.preference as HideSeekRolePreference };
    if (value.type === 'add-bot' && (value.preference === undefined || ['ghost', 'survivor', 'any'].includes(String(value.preference)))) return { type: 'add-bot', preference: (value.preference ?? 'any') as HideSeekRolePreference };
    if (value.type === 'remove-bot' && typeof value.playerId === 'string') return { type: 'remove-bot', playerId: value.playerId };
    if (value.type === 'spectate' && typeof value.playerId === 'string' && value.playerId.length > 0 && value.playerId.length <= 80) return { type: 'spectate', playerId: value.playerId };
    if (value.type === 'move' && typeof value.dx === 'number' && typeof value.dy === 'number' && Number.isInteger(value.inputSequence)) return { type: 'move', dx: value.dx, dy: value.dy, inputSequence: value.inputSequence as number };
    if (value.type === 'quick-chat' && ['귀신 발견!', '열쇠 발견!', '탈출로 발견!', '도망쳐!'].includes(String(value.phrase))) return { type: 'quick-chat', phrase: value.phrase as HideSeekQuickChat };
    if (value.type === 'chat' && typeof value.text === 'string') {
      const text = value.text.trim().slice(0, 80);
      if (text) return { type: 'chat', text };
    }
    if (value.type === 'ping' && typeof value.clientTime === 'number') return { type: 'ping', clientTime: value.clientTime };
  } catch {
    return null;
  }
  return null;
}
