import { SeededRandom } from './rng';
import type { MapDefinition, MapRoom, Tile } from './types';

export const tileKey = (x: number, y: number): string => `${x},${y}`;

interface ShapeTemplate {
  name: string;
  cells: ReadonlyArray<readonly [number, number]>;
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);
const SHAPES: readonly ShapeTemplate[] = [
  { name: '작은 10칸방', cells: range(1, 5).flatMap((depth) => range(0, 1).map((dx) => [dx, depth] as const)) },
  { name: '세로 일자방', cells: range(1, 10).map((depth) => [0, depth] as const) },
  { name: '가로 일자방', cells: range(-4, 5).map((dx) => [dx, 1] as const) },
  { name: '넓은 15칸방', cells: range(1, 3).flatMap((depth) => range(-2, 2).map((dx) => [dx, depth] as const)) },
  { name: 'L자방', cells: [...range(1, 7).map((depth) => [0, depth] as const), ...range(1, 4).map((dx) => [dx, 7] as const)] },
  { name: 'T자방', cells: [...range(-3, 3).map((dx) => [dx, 1] as const), ...range(2, 6).map((depth) => [0, depth] as const)] },
  { name: 'U자방', cells: [...range(-2, 2).map((dx) => [dx, 1] as const), ...range(2, 5).flatMap((depth) => [[-2, depth] as const, [2, depth] as const])] },
  { name: '마름모방', cells: [[0, 1], [-1, 2], [0, 2], [1, 2], [-2, 3], [-1, 3], [0, 3], [1, 3], [2, 3], [-1, 4], [0, 4], [1, 4], [0, 5]] },
  { name: '번개방', cells: [[0, 1], [1, 1], [2, 1], [2, 2], [2, 3], [1, 3], [0, 3], [0, 4], [0, 5], [-1, 5], [-2, 5]] },
  { name: '십자방', cells: [[0, 1], [0, 2], [-1, 3], [0, 3], [1, 3], [-2, 3], [2, 3], [0, 4], [0, 5], [-1, 5], [1, 5]] },
  { name: '계단방', cells: [[0, 1], [1, 1], [0, 2], [1, 2], [1, 3], [2, 3], [1, 4], [2, 4], [2, 5], [3, 5], [2, 6], [3, 6]] },
  { name: '모래시계방', cells: [[0, 1], [-1, 2], [0, 2], [1, 2], [-2, 3], [-1, 3], [0, 3], [1, 3], [2, 3], [-1, 4], [0, 4], [1, 4], [0, 5]] },
] as const;

function createCandidate(seed: number): MapDefinition {
  const rng = new SeededRandom(seed);
  const width = 88;
  const height = 30;
  const corridor = { x: 0, y: 13, width, height: 4 };
  const respawnZone = { x: 1, y: 13, width: 5, height: 4 };
  const walkable = new Map<string, Tile>();
  const walls = new Map<string, Tile>();
  const rooms: MapRoom[] = [];

  for (let y = corridor.y; y < corridor.y + corridor.height; y += 1) {
    for (let x = corridor.x; x < corridor.x + corridor.width; x += 1) walkable.set(tileKey(x, y), { x, y });
  }

  const shuffledShapes = rng.shuffle([...SHAPES]);
  const centers = [9, 23, 37, 51, 65, 79];
  for (let index = 0; index < 12; index += 1) {
    const top = index < 6;
    const roomId = `room-${index + 1}`;
    const centerX = centers[index % 6] as number;
    const doorY = top ? corridor.y - 1 : corridor.y + corridor.height;
    const direction = top ? -1 : 1;
    const template = shuffledShapes[index] as ShapeTemplate;
    const flip = rng.next() < 0.5 ? -1 : 1;
    const door: Tile = { x: centerX, y: doorY, roomId };
    const floorTiles = template.cells.map(([rawDx, depth]) => ({
      x: centerX + rawDx * flip,
      y: doorY + depth * direction,
      roomId,
    }));
    const bed = [...floorTiles].sort((a, b) => {
      const distanceA = Math.abs(a.x - door.x) + Math.abs(a.y - door.y);
      const distanceB = Math.abs(b.x - door.x) + Math.abs(b.y - door.y);
      return distanceB - distanceA || a.x - b.x;
    })[0] as Tile;
    const buildTiles = floorTiles.filter((tile) => tile.x !== bed.x || tile.y !== bed.y);
    const allRoomTiles = [...floorTiles, door];
    const xs = allRoomTiles.map((tile) => tile.x);
    const ys = allRoomTiles.map((tile) => tile.y);
    rooms.push({
      id: roomId,
      shape: template.name,
      bounds: {
        x: Math.min(...xs) - 1,
        y: Math.min(...ys) - 1,
        width: Math.max(...xs) - Math.min(...xs) + 3,
        height: Math.max(...ys) - Math.min(...ys) + 3,
      },
      door,
      bed: { ...bed },
      floorTiles,
      buildTiles,
    });
    walkable.set(tileKey(door.x, door.y), door);
    for (const tile of floorTiles) walkable.set(tileKey(tile.x, tile.y), tile);
  }

  for (const room of rooms) {
    for (const tile of [...room.floorTiles, room.door]) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        const key = tileKey(x, y);
        if (!walkable.has(key) && x >= 0 && x < width && y >= 0 && y < height) walls.set(key, { x, y });
      }
    }
  }

  return {
    seed,
    width,
    height,
    corridor,
    respawnZone,
    playerSpawn: { x: 44, y: 15 },
    ghostSpawn: { x: 3, y: 14 },
    rooms,
    walls: [...walls.values()],
    walkable: [...walkable.values()],
  };
}

export function validateMap(map: MapDefinition): boolean {
  if (map.rooms.length < 10) return false;
  const wallKeys = new Set(map.walls.map((tile) => tileKey(tile.x, tile.y)));
  const walkableKeys = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
  const occupied = new Set<string>();
  for (const room of map.rooms) {
    if (room.floorTiles.length < 10 || room.floorTiles.length > 15 || room.buildTiles.length !== room.floorTiles.length - 1) return false;
    const bedKey = tileKey(room.bed.x, room.bed.y);
    const doorKey = tileKey(room.door.x, room.door.y);
    if (wallKeys.has(bedKey) || wallKeys.has(doorKey) || occupied.has(bedKey) || occupied.has(doorKey)) return false;
    if (!walkableKeys.has(bedKey) || !walkableKeys.has(doorKey)) return false;
    occupied.add(doorKey);
    for (const tile of room.floorTiles) {
      const key = tileKey(tile.x, tile.y);
      if (wallKeys.has(key) || occupied.has(key)) return false;
      occupied.add(key);
    }
    const corridorY = room.door.y < map.corridor.y ? room.door.y + 1 : room.door.y - 1;
    const interiorY = room.door.y < map.corridor.y ? room.door.y - 1 : room.door.y + 1;
    if (!walkableKeys.has(tileKey(room.door.x, corridorY)) || !walkableKeys.has(tileKey(room.door.x, interiorY))) return false;
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

export function generateMap(seed: number): MapDefinition {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const candidate = createCandidate((seed + Math.imul(attempt, 2654435761)) >>> 0);
    if (validateMap(candidate)) return candidate;
  }
  throw new Error('Unable to generate a connected dormitory map');
}

const walkableCache = new WeakMap<MapDefinition, Set<string>>();
export function isWalkable(map: MapDefinition, x: number, y: number): boolean {
  let keys = walkableCache.get(map);
  if (!keys) {
    keys = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
    walkableCache.set(map, keys);
  }
  return keys.has(tileKey(Math.round(x), Math.round(y)));
}

export function isBuildTile(map: MapDefinition, roomId: string, tile: Tile): boolean {
  const room = map.rooms.find((candidate) => candidate.id === roomId);
  return Boolean(room?.buildTiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y));
}
