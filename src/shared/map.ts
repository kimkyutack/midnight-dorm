import type { MapDefinition, MapRoom, PlayMode, RoomState, Tile, Vec2 } from './types';

export const tileKey = (x: number, y: number): string => `${x},${y}`;

const rectangle = (width: number, height: number): Array<readonly [number, number]> =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (__, x) => [x, y] as const),
  ).flat();

const COMPACT_ROOM_LABELS = [
  '북서 정방형 병실', '북부 정방형 병실', '북동 정방형 병실', '동쪽 정방형 병실',
  '남서 정방형 병실', '남부 정방형 병실', '남동 정방형 병실', '서쪽 정방형 병실',
] as const;

function createCandidate(seed: number, playMode: PlayMode): MapDefinition {
  // A broad 4×2 ward. Everything inside the exterior wall is a traversable
  // corridor unless it is a room floor or one of that room's one-tile walls.
  // It keeps the prior map's spacious routes without any black void gaps.
  const width = 63;
  const height = 35;
  const walkable = new Map<string, Tile>();
  const corridorTiles = new Map<string, Tile>();
  const walls = new Map<string, Tile>();
  const rooms: MapRoom[] = [];

  const addCorridor = (x: number, y: number): void => {
    const tile = { x, y };
    walkable.set(tileKey(x, y), tile);
    corridorTiles.set(tileKey(x, y), tile);
  };
  // Start with a full corridor floor, then cut rooms and their wall rings out.
  for (let x = 1; x < width - 1; x += 1)
    for (let y = 1; y < height - 1; y += 1) addCorridor(x, y);
  for (let x = 0; x < width; x += 1) {
    walls.set(tileKey(x, 0), { x, y: 0 });
    walls.set(tileKey(x, height - 1), { x, y: height - 1 });
  }
  for (let y = 1; y < height - 1; y += 1) {
    walls.set(tileKey(0, y), { x: 0, y });
    walls.set(tileKey(width - 1, y), { x: width - 1, y });
  }

  const roomOrigins = [
    { x: 7, y: 7 }, { x: 21, y: 7 }, { x: 35, y: 7 }, { x: 49, y: 7 },
    { x: 7, y: 23 }, { x: 21, y: 23 }, { x: 35, y: 23 }, { x: 49, y: 23 },
  ] as const;
  const roomCells = rectangle(5, 5);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const index = row * 4 + column;
      const roomId = `room-${index + 1}`;
      const origin = roomOrigins[index] as { x: number; y: number };
      const floorTiles = roomCells.map(([x, y]) => ({ x: origin.x + x, y: origin.y + y, roomId }));
      const entrance = floorTiles.find((tile) => tile.x === origin.x + 2 && tile.y === (row === 0 ? origin.y + 4 : origin.y)) as Tile;
      const door: Tile = {
        x: entrance.x,
        y: entrance.y + (row === 0 ? 1 : -1),
        roomId,
      };
      const bedCandidates = [...floorTiles].sort((a, b) => {
        const distanceA = Math.abs(a.x - door.x) + Math.abs(a.y - door.y);
        const distanceB = Math.abs(b.x - door.x) + Math.abs(b.y - door.y);
        return distanceB - distanceA || a.x - b.x || a.y - b.y;
      });
      const firstBed = bedCandidates[0] as Tile;
      const secondBed = bedCandidates
        .filter((tile) => tile.x !== firstBed.x || tile.y !== firstBed.y)
        .sort((a, b) => {
          const spacingA = Math.abs(a.x - firstBed.x) + Math.abs(a.y - firstBed.y);
          const spacingB = Math.abs(b.x - firstBed.x) + Math.abs(b.y - firstBed.y);
          return spacingB - spacingA;
        })[0] as Tile;
      const beds = playMode === 'multiplayer' ? [{ ...firstBed }, { ...secondBed }] : [{ ...firstBed }];
      const bedKeys = new Set(beds.map((bed) => tileKey(bed.x, bed.y)));
      const buildTiles = floorTiles.filter((tile) => !bedKeys.has(tileKey(tile.x, tile.y)));
      rooms.push({
        id: roomId,
        shape: COMPACT_ROOM_LABELS[index] as string,
        bounds: {
          x: origin.x - 1,
          y: origin.y - 1,
          width: 7,
          height: 7,
        },
        door,
        bed: { ...(beds[0] as Tile) },
        beds,
        floorTiles,
        buildTiles,
      });
    }
  }

  const doorKeys = new Set(rooms.map((room) => tileKey(room.door.x, room.door.y)));
  for (const room of rooms) {
    const roomFloorKeys = new Set(room.floorTiles.map((tile) => tileKey(tile.x, tile.y)));
    for (const tile of room.floorTiles) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        const key = tileKey(x, y);
        if (!roomFloorKeys.has(key) && !doorKeys.has(key)) walls.set(key, { x, y });
      }
    }
  }

  for (const wall of walls.values()) {
    walkable.delete(tileKey(wall.x, wall.y));
    corridorTiles.delete(tileKey(wall.x, wall.y));
  }
  for (const room of rooms) {
    for (const tile of room.floorTiles) {
      corridorTiles.delete(tileKey(tile.x, tile.y));
      walkable.set(tileKey(tile.x, tile.y), tile);
    }
    walkable.set(tileKey(room.door.x, room.door.y), room.door);
    corridorTiles.set(tileKey(room.door.x, room.door.y), room.door);
  }

  return {
    seed,
    playMode,
    width,
    height,
    corridor: { x: 1, y: 1, width: width - 2, height: height - 2 },
    corridorTiles: [...corridorTiles.values()],
    respawnZones: [
      { x: 1, y: 1, width: 1, height: 1 },
      { x: 31, y: 1, width: 1, height: 1 },
      { x: 61, y: 1, width: 1, height: 1 },
      { x: 1, y: 17, width: 1, height: 1 },
      { x: 61, y: 17, width: 1, height: 1 },
      { x: 1, y: 33, width: 1, height: 1 },
      { x: 31, y: 33, width: 1, height: 1 },
      { x: 61, y: 33, width: 1, height: 1 },
    ],
    playerSpawn: { x: 31, y: 17 },
    ghostSpawn: { x: 31, y: 1 },
    rooms,
    walls: [...walls.values()],
    walkable: [...walkable.values()],
  };
}

export function validateMap(map: MapDefinition): boolean {
  if (map.rooms.length !== 8 || map.respawnZones.length !== 8) return false;
  const wallKeys = new Set(map.walls.map((tile) => tileKey(tile.x, tile.y)));
  const walkableKeys = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
  const corridorKeys = new Set(map.corridorTiles.map((tile) => tileKey(tile.x, tile.y)));
  const occupied = new Set<string>();
  for (const room of map.rooms) {
    const expectedBeds = map.playMode === 'multiplayer' ? 2 : 1;
    if (room.floorTiles.length < 20 || room.floorTiles.length > 25) return false;
    if (map.playMode === 'multiplayer' && room.floorTiles.length !== 25) return false;
    if (room.beds.length !== expectedBeds || room.buildTiles.length !== room.floorTiles.length - expectedBeds) return false;
    const doorKey = tileKey(room.door.x, room.door.y);
    if (wallKeys.has(doorKey) || occupied.has(doorKey) || !walkableKeys.has(doorKey) || !corridorKeys.has(doorKey)) return false;
    occupied.add(doorKey);
    for (const bed of room.beds) {
      const key = tileKey(bed.x, bed.y);
      if (!walkableKeys.has(key) || wallKeys.has(key)) return false;
    }
    for (const tile of room.floorTiles) {
      const key = tileKey(tile.x, tile.y);
      if (wallKeys.has(key) || occupied.has(key) || !walkableKeys.has(key)) return false;
      occupied.add(key);
    }
    const doorTouchesRoom = room.floorTiles.some((tile) => Math.abs(tile.x - room.door.x) + Math.abs(tile.y - room.door.y) === 1);
    if (!doorTouchesRoom) return false;
  }
  for (const zone of map.respawnZones) {
    for (let x = zone.x; x < zone.x + zone.width; x += 1)
      for (let y = zone.y; y < zone.y + zone.height; y += 1)
        if (!corridorKeys.has(tileKey(x, y))) return false;
  }
  return connectedWalkableCount(map) === map.walkable.length;
}

export function connectedWalkableCount(map: MapDefinition): number {
  const walkable = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
  const first = map.walkable[0];
  if (!first) return 0;
  const queue: Tile[] = [first];
  const seen = new Set([tileKey(first.x, first.y)]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor] as Tile;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = tileKey(next.x, next.y);
      if (walkable.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return seen.size;
}

export function generateMap(seed: number, playMode: PlayMode = 'solo'): MapDefinition {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = createCandidate((seed + Math.imul(attempt, 2654435761)) >>> 0, playMode);
    if (validateMap(candidate)) return candidate;
  }
  throw new Error('Unable to generate a connected dormitory map');
}

const walkableCache = new WeakMap<MapDefinition, Set<string>>();
function walkableKeysFor(map: MapDefinition): Set<string> {
  let keys = walkableCache.get(map);
  if (!keys) {
    keys = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
    walkableCache.set(map, keys);
  }
  return keys;
}

export function isWalkable(map: MapDefinition, x: number, y: number): boolean {
  return walkableKeysFor(map).has(tileKey(Math.round(x), Math.round(y)));
}

/**
 * Returns the floor tiles that cannot be entered by an unclaimed survivor.
 * Doors intentionally remain walkable: a player may reach a full room's door,
 * but can never cross its threshold or become an invalid intruder inside it.
 */
export function fullRoomFloorKeys(
  map: MapDefinition,
  rooms: ReadonlyArray<Pick<RoomState, 'id' | 'ownerIds'>>,
  capacity: number,
): Set<string> {
  const fullRoomIds = new Set(
    rooms
      .filter((room) => room.ownerIds.length >= capacity)
      .map((room) => room.id),
  );
  return new Set(
    map.rooms
      .filter((room) => fullRoomIds.has(room.id))
      .flatMap((room) => room.floorTiles.map((tile) => tileKey(tile.x, tile.y))),
  );
}

export function isWalkableArea(
  map: MapDefinition,
  x: number,
  y: number,
  radius: number,
  blockedTileKeys?: ReadonlySet<string>,
): boolean {
  const keys = walkableKeysFor(map);
  const samples = [
    [x, y],
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x - radius, y + radius],
    [x + radius, y + radius],
  ] as const;
  return samples.every(([sampleX, sampleY]) => {
    const key = tileKey(Math.round(sampleX), Math.round(sampleY));
    return keys.has(key) && !blockedTileKeys?.has(key);
  });
}

/**
 * Moves a circular actor through the tile map without tunnelling through a wall.
 * Splitting large frame deltas into short axis-separated steps keeps the client
 * prediction and the authoritative server simulation on the exact same path.
 */
export function moveInWalkableArea(
  map: MapDefinition,
  position: Vec2,
  delta: Vec2,
  radius: number,
  maxStep = 0.12,
  blockedTileKeys?: ReadonlySet<string>,
): Vec2 {
  if (![position.x, position.y, delta.x, delta.y, radius, maxStep].every(Number.isFinite)) return { ...position };
  const distance = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(0.05, maxStep)));
  const stepX = delta.x / steps;
  const stepY = delta.y / steps;
  let x = position.x;
  let y = position.y;
  for (let step = 0; step < steps; step += 1) {
    const nextX = x + stepX;
    if (isWalkableArea(map, nextX, y, radius, blockedTileKeys)) x = nextX;
    const nextY = y + stepY;
    if (isWalkableArea(map, x, nextY, radius, blockedTileKeys)) y = nextY;
  }
  return { x, y };
}

export function isBuildTile(map: MapDefinition, roomId: string, tile: Tile): boolean {
  const room = map.rooms.find((candidate) => candidate.id === roomId);
  return Boolean(room?.buildTiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y));
}
