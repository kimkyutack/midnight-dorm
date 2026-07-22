import { SeededRandom } from './rng';
import type { MapDefinition, MapRoom, PlayMode, Tile, Vec2 } from './types';

export const tileKey = (x: number, y: number): string => `${x},${y}`;

interface ShapeTemplate {
  name: string;
  cells: ReadonlyArray<readonly [number, number]>;
}

type DoorSide = 'top' | 'right' | 'bottom' | 'left';

const rectangle = (width: number, height: number): Array<readonly [number, number]> =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (__, x) => [x, y] as const),
  ).flat();

const without = (
  cells: ReadonlyArray<readonly [number, number]>,
  removed: ReadonlyArray<readonly [number, number]>,
): Array<readonly [number, number]> => {
  const keys = new Set(removed.map(([x, y]) => tileKey(x, y)));
  return cells.filter(([x, y]) => !keys.has(tileKey(x, y)));
};

const SOLO_SHAPES: readonly ShapeTemplate[] = [
  { name: '20칸 직사각방', cells: rectangle(5, 4) },
  { name: '20칸 세로방', cells: rectangle(4, 5) },
  { name: '25칸 광장방', cells: rectangle(5, 5) },
  { name: '24칸 가로방', cells: rectangle(6, 4) },
  { name: '22칸 모서리방', cells: without(rectangle(6, 4), [[0, 0], [5, 3]]) },
  { name: '21칸 안쪽방', cells: without(rectangle(5, 5), [[4, 0], [4, 1], [4, 2], [3, 0]]) },
  { name: '21칸 둥근방', cells: without(rectangle(5, 5), [[0, 0], [4, 0], [0, 4], [4, 4]]) },
  { name: '23칸 꺾인방', cells: without(rectangle(6, 4), [[0, 0]]) },
] as const;

const MULTIPLAYER_SHAPES: readonly ShapeTemplate[] = [
  { name: '25칸 공유 광장', cells: rectangle(5, 5) },
  { name: '25칸 공유 가로방', cells: without(rectangle(7, 4), [[0, 0], [6, 0], [0, 3]]) },
  { name: '25칸 공유 L방', cells: without(rectangle(6, 5), [[5, 0], [5, 1], [5, 2], [4, 0], [4, 1]]) },
  { name: '25칸 공유 계단방', cells: without(rectangle(5, 6), [[0, 0], [0, 1], [4, 4], [4, 5], [3, 5]]) },
] as const;

function shapeSize(cells: ReadonlyArray<readonly [number, number]>): { width: number; height: number } {
  return {
    width: Math.max(...cells.map(([x]) => x)) + 1,
    height: Math.max(...cells.map(([, y]) => y)) + 1,
  };
}

function createCandidate(seed: number, playMode: PlayMode): MapDefinition {
  const rng = new SeededRandom(seed);
  const width = 75;
  const height = 58;
  const laneWidth = 3;
  const verticalBands = [2, 19, 36, 53, 70] as const;
  const horizontalBands = [2, 19, 36, 53] as const;
  const firstVerticalBand = verticalBands[0] as number;
  const lastVerticalBand = verticalBands[verticalBands.length - 1] as number;
  const firstHorizontalBand = horizontalBands[0] as number;
  const lastHorizontalBand = horizontalBands[horizontalBands.length - 1] as number;
  const walkable = new Map<string, Tile>();
  const corridorTiles = new Map<string, Tile>();
  const walls = new Map<string, Tile>();
  const rooms: MapRoom[] = [];

  const addCorridor = (x: number, y: number): void => {
    const tile = { x, y };
    walkable.set(tileKey(x, y), tile);
    corridorTiles.set(tileKey(x, y), tile);
  };
  for (const bandX of verticalBands) {
    for (let x = bandX; x < bandX + laneWidth; x += 1) {
      for (let y = firstHorizontalBand; y < lastHorizontalBand + laneWidth; y += 1) addCorridor(x, y);
    }
  }
  for (const bandY of horizontalBands) {
    for (let y = bandY; y < bandY + laneWidth; y += 1) {
      for (let x = firstVerticalBand; x < lastVerticalBand + laneWidth; x += 1) addCorridor(x, y);
    }
  }

  const templates = rng.shuffle([...(playMode === 'multiplayer' ? MULTIPLAYER_SHAPES : SOLO_SHAPES)]);
  const sides = rng.shuffle<DoorSide>(['top', 'right', 'bottom', 'left']);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const index = row * 4 + column;
      const roomId = `room-${index + 1}`;
      const template = templates[index % templates.length] as ShapeTemplate;
      const side = sides[(index + rng.int(0, 3)) % sides.length] as DoorSide;
      const size = shapeSize(template.cells);
      const cell = {
        minX: (verticalBands[column] as number) + laneWidth + 1,
        maxX: (verticalBands[column + 1] as number) - 2,
        minY: (horizontalBands[row] as number) + laneWidth + 1,
        maxY: (horizontalBands[row + 1] as number) - 2,
      };
      let originX = rng.int(cell.minX, cell.maxX - size.width + 1);
      let originY = rng.int(cell.minY, cell.maxY - size.height + 1);
      if (side === 'left') originX = cell.minX;
      if (side === 'right') originX = cell.maxX - size.width + 1;
      if (side === 'top') originY = cell.minY;
      if (side === 'bottom') originY = cell.maxY - size.height + 1;

      const floorTiles = template.cells.map(([x, y]) => ({ x: originX + x, y: originY + y, roomId }));
      const edgeValue = side === 'left'
        ? Math.min(...floorTiles.map((tile) => tile.x))
        : side === 'right'
          ? Math.max(...floorTiles.map((tile) => tile.x))
          : side === 'top'
            ? Math.min(...floorTiles.map((tile) => tile.y))
            : Math.max(...floorTiles.map((tile) => tile.y));
      const edgeTiles = floorTiles.filter((tile) =>
        side === 'left' || side === 'right' ? tile.x === edgeValue : tile.y === edgeValue,
      ).sort((a, b) => side === 'left' || side === 'right' ? a.y - b.y : a.x - b.x);
      const entrance = edgeTiles[Math.floor(edgeTiles.length / 2)] as Tile;
      const door: Tile = {
        x: entrance.x + (side === 'left' ? -1 : side === 'right' ? 1 : 0),
        y: entrance.y + (side === 'top' ? -1 : side === 'bottom' ? 1 : 0),
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
        bed: { ...(beds[0] as Tile) },
        beds,
        floorTiles,
        buildTiles,
      });
      walkable.set(tileKey(door.x, door.y), door);
      corridorTiles.set(tileKey(door.x, door.y), door);
      for (const tile of floorTiles) walkable.set(tileKey(tile.x, tile.y), tile);
    }
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
    playMode,
    width,
    height,
    corridor: { x: firstVerticalBand, y: firstHorizontalBand, width: lastVerticalBand - firstVerticalBand + laneWidth, height: laneWidth },
    corridorTiles: [...corridorTiles.values()],
    respawnZone: { x: 2, y: 2, width: 3, height: 3 },
    playerSpawn: { x: 37, y: 37 },
    ghostSpawn: { x: 3, y: 3 },
    rooms,
    walls: [...walls.values()],
    walkable: [...walkable.values()],
  };
}

export function validateMap(map: MapDefinition): boolean {
  if (map.rooms.length < 10) return false;
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

export function isWalkableArea(map: MapDefinition, x: number, y: number, radius: number): boolean {
  const keys = walkableKeysFor(map);
  const samples = [
    [x, y],
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x - radius, y + radius],
    [x + radius, y + radius],
  ] as const;
  return samples.every(([sampleX, sampleY]) => keys.has(tileKey(Math.round(sampleX), Math.round(sampleY))));
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
    if (isWalkableArea(map, nextX, y, radius)) x = nextX;
    const nextY = y + stepY;
    if (isWalkableArea(map, x, nextY, radius)) y = nextY;
  }
  return { x, y };
}

export function isBuildTile(map: MapDefinition, roomId: string, tile: Tile): boolean {
  const room = map.rooms.find((candidate) => candidate.id === roomId);
  return Boolean(room?.buildTiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y));
}
