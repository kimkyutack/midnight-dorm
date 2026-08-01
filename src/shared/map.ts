import { SeededRandom } from './rng';
import type { MapDefinition, MapRoom, PlayMode, Tile, Vec2 } from './types';

export const tileKey = (x: number, y: number): string => `${x},${y}`;

export const isPositionOnRoomFloor = (
  room: Pick<MapRoom, 'floorTiles'>,
  position: Vec2,
): boolean => {
  const positionKey = tileKey(Math.round(position.x), Math.round(position.y));
  return room.floorTiles.some((tile) => tileKey(tile.x, tile.y) === positionKey);
};

// Keep eight distinct rooms, but avoid the long empty-looking hallways of
// the 49×31 ward. Placement regions are arranged compactly while every room
// still receives its own width, depth, and silhouette.
const MAP_WIDTH = 39;
const MAP_HEIGHT = 25;
const DIRECTIONS = [
  { id: 'north', dx: 0, dy: -1 },
  { id: 'east', dx: 1, dy: 0 },
  { id: 'south', dx: 0, dy: 1 },
  { id: 'west', dx: -1, dy: 0 },
] as const;

type Cell = readonly [number, number];

interface RoomTemplate {
  id: string;
  label: string;
  cells: readonly Cell[];
}

interface RoomDraft {
  template: RoomTemplate;
  floorTiles: Tile[];
  wallTiles: Tile[];
  door: Tile;
  approach: Tile;
  bounds: MapRoom['bounds'];
  reservationKeys: Set<string>;
}

const rectangle = (width: number, height: number): Cell[] =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (__, x) => [x, y] as const),
  ).flat();

const withoutCells = (cells: readonly Cell[], removed: readonly Cell[]): Cell[] => {
  const removedKeys = new Set(removed.map(([x, y]) => tileKey(x, y)));
  return cells.filter(([x, y]) => !removedKeys.has(tileKey(x, y)));
};

const combineCells = (...groups: readonly Cell[][]): Cell[] => {
  const cells = new Map<string, Cell>();
  for (const group of groups)
    for (const cell of group) cells.set(tileKey(cell[0], cell[1]), cell);
  return [...cells.values()];
};

const ROOM_TEMPLATES: readonly RoomTemplate[] = [
  // Every ward contains eight silhouettes with different area and span.
  // The seven-tile straight room, chunky L/T rooms and small five-tile room
  // prevent the procedural 4×2 placement from reading as eight rectangles.
  { id: 'compact-five', label: '5칸 폭 소형 병실', cells: rectangle(5, 4) },
  { id: 'straight-seven', label: '7칸 일자 병실', cells: rectangle(7, 3) },
  {
    id: 'slim-seven',
    label: '긴 세로형 병실',
    cells: withoutCells(rectangle(4, 6), [[3, 0], [3, 5]]),
  },
  {
    id: 'corner-seven',
    label: '7칸 ㄱ자 병실',
    cells: combineCells(rectangle(3, 5), rectangle(7, 2).map(([x, y]) => [x, y + 3] as const)),
  },
  {
    id: 't-wing',
    label: 'T자 병실',
    cells: combineCells(rectangle(6, 3), rectangle(2, 6).map(([x, y]) => [x + 2, y] as const)),
  },
  { id: 'square', label: '정방형 병실', cells: rectangle(5, 5) },
  {
    id: 'stepped',
    label: '계단형 병실',
    cells: withoutCells(rectangle(6, 5), [[0, 0], [0, 1], [5, 3], [5, 4]]),
  },
  {
    id: 'u-suite',
    label: '알코브 병실',
    cells: withoutCells(rectangle(6, 5), [[2, 0], [3, 0], [2, 1]]),
  },
] as const;

const inside = (x: number, y: number, width: number, height: number): boolean =>
  x > 0 && x < width - 1 && y > 0 && y < height - 1;

const tileFromKey = (key: string): Tile => {
  const [x, y] = key.split(',').map(Number);
  return { x: x as number, y: y as number };
};

const dimensionsFor = (template: RoomTemplate): { width: number; height: number } => ({
  width: Math.max(...template.cells.map(([x]) => x)) + 1,
  height: Math.max(...template.cells.map(([, y]) => y)) + 1,
});

const rotateTemplate = (template: RoomTemplate, turns: number): RoomTemplate => {
  let cells = [...template.cells] as Cell[];
  for (let turn = 0; turn < turns; turn += 1) {
    const height = Math.max(...cells.map(([, y]) => y)) + 1;
    cells = cells.map(([x, y]) => [height - y - 1, x] as const);
  }
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return {
    ...template,
    cells: cells.map(([x, y]) => [x - minX, y - minY] as const),
  };
};

const centerDistance = (a: Tile, b: Tile): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function roomDraft(
  template: RoomTemplate,
  origin: Tile,
  width: number,
  height: number,
  rng: SeededRandom,
): RoomDraft | null {
  const floorTiles = template.cells.map(([x, y]) => ({ x: origin.x + x, y: origin.y + y }));
  const floorKeys = new Set(floorTiles.map((tile) => tileKey(tile.x, tile.y)));
  const walls = new Map<string, Tile>();
  const candidates: Array<{ door: Tile; approach: Tile }> = [];

  for (const floor of floorTiles) {
    for (const direction of DIRECTIONS) {
      const x = floor.x + direction.dx;
      const y = floor.y + direction.dy;
      const key = tileKey(x, y);
      if (floorKeys.has(key)) continue;
      if (inside(x, y, width, height)) walls.set(key, { x, y });
      const approach = { x: x + direction.dx, y: y + direction.dy };
      const neighbouringFloorCount = DIRECTIONS.filter((candidate) =>
        floorKeys.has(tileKey(x + candidate.dx, y + candidate.dy)),
      ).length;
      const approachTouchesFloor = DIRECTIONS.some((candidate) =>
        floorKeys.has(tileKey(approach.x + candidate.dx, approach.y + candidate.dy)),
      );
      if (
        inside(x, y, width, height) &&
        inside(approach.x, approach.y, width, height) &&
        neighbouringFloorCount === 1 &&
        !approachTouchesFloor
      ) {
        candidates.push({ door: { x, y }, approach });
      }
    }
  }
  if (candidates.length === 0) return null;
  const selected = rng.pick(rng.shuffle(candidates));
  const doorKey = tileKey(selected.door.x, selected.door.y);
  const wallTiles = [...walls.values()].filter((tile) => tileKey(tile.x, tile.y) !== doorKey);
  const minX = Math.min(...floorTiles.map((tile) => tile.x));
  const maxX = Math.max(...floorTiles.map((tile) => tile.x));
  const minY = Math.min(...floorTiles.map((tile) => tile.y));
  const maxY = Math.max(...floorTiles.map((tile) => tile.y));
  const reservationKeys = new Set([
    ...floorTiles.map((tile) => tileKey(tile.x, tile.y)),
    ...wallTiles.map((tile) => tileKey(tile.x, tile.y)),
    doorKey,
    tileKey(selected.approach.x, selected.approach.y),
  ]);
  return {
    template,
    floorTiles,
    wallTiles,
    door: { ...selected.door },
    approach: { ...selected.approach },
    bounds: { x: minX - 1, y: minY - 1, width: maxX - minX + 3, height: maxY - minY + 3 },
    reservationKeys,
  };
}

function directPath(
  start: Tile,
  goalKeys: ReadonlySet<string>,
  width: number,
  height: number,
  blocked: ReadonlySet<string>,
  rng: SeededRandom,
): Tile[] {
  const startKey = tileKey(start.x, start.y);
  if (goalKeys.has(startKey)) return [{ ...start }];
  const queue: Tile[] = [{ ...start }];
  const parents = new Map<string, string>();
  const seen = new Set([startKey]);
  const directionOrder = rng.shuffle(DIRECTIONS);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor] as Tile;
    const currentKey = tileKey(current.x, current.y);
    for (const direction of directionOrder) {
      const next = { x: current.x + direction.dx, y: current.y + direction.dy };
      const nextKey = tileKey(next.x, next.y);
      if (!inside(next.x, next.y, width, height) || seen.has(nextKey) || blocked.has(nextKey)) continue;
      parents.set(nextKey, currentKey);
      if (goalKeys.has(nextKey)) {
        const path: Tile[] = [next];
        let key = nextKey;
        while (parents.has(key)) {
          key = parents.get(key) as string;
          path.push(tileFromKey(key));
        }
        return path.reverse();
      }
      seen.add(nextKey);
      queue.push(next);
    }
  }
  return [];
}

function addCorridorPath(
  corridor: Set<string>,
  path: readonly Tile[],
  width: number,
  height: number,
  blocked: ReadonlySet<string>,
  rng: SeededRandom,
): void {
  const add = (tile: Tile): void => {
    const key = tileKey(tile.x, tile.y);
    if (inside(tile.x, tile.y, width, height) && !blocked.has(key)) corridor.add(key);
  };
  path.forEach(add);
  for (let index = 0; index < path.length; index += 1) {
    const current = path[index] as Tile;
    const previous = path[Math.max(0, index - 1)] as Tile;
    const next = path[Math.min(path.length - 1, index + 1)] as Tile;
    const horizontal = Math.abs(next.x - previous.x) >= Math.abs(next.y - previous.y);
    const offsets = horizontal ? [{ x: 0, y: 1 }, { x: 0, y: -1 }] : [{ x: 1, y: 0 }, { x: -1, y: 0 }];
    // Most links are two tiles wide, while a few retain a narrow branch so
    // the resulting ward has long halls, bends and occasional bottlenecks.
    if (index === 0 || index === path.length - 1 || rng.next() > 0.16) {
      const offset = rng.pick(offsets);
      add({ x: current.x + offset.x, y: current.y + offset.y });
    }
    if (index > 0 && index < path.length - 1 && rng.next() < 0.08) {
      for (const offset of offsets) add({ x: current.x + offset.x, y: current.y + offset.y });
    }
  }
}

function randomOpenTile(
  width: number,
  height: number,
  blocked: ReadonlySet<string>,
  rng: SeededRandom,
): Tile | null {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tile = { x: rng.int(2, width - 3), y: rng.int(2, height - 3) };
    if (!blocked.has(tileKey(tile.x, tile.y))) return tile;
  }
  return null;
}

function nearestOpenTile(
  origin: Tile,
  width: number,
  height: number,
  blocked: ReadonlySet<string>,
): Tile | null {
  const candidates: Tile[] = [];
  for (let radius = 0; radius < Math.max(width, height); radius += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      for (const y of [origin.y - radius, origin.y + radius]) {
        if (inside(x, y, width, height) && !blocked.has(tileKey(x, y))) candidates.push({ x, y });
      }
    }
    for (let y = origin.y - radius + 1; y < origin.y + radius; y += 1) {
      for (const x of [origin.x - radius, origin.x + radius]) {
        if (inside(x, y, width, height) && !blocked.has(tileKey(x, y))) candidates.push({ x, y });
      }
    }
    if (candidates.length > 0) return candidates[0] as Tile;
  }
  return null;
}

function createCandidate(seed: number, playMode: PlayMode): MapDefinition | null {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  const rng = new SeededRandom(seed);
  // 귀신 회복 패드는 일반 복도 한가운데가 아니라 외벽을 한 칸 뚫은
  // 출입구에 둔다. 네 모서리 쪽과 각 변의 중앙, 총 여덟 구멍을 통로로
  // 연결해 귀신이 밖으로 빠져나가 회복한 뒤 다시 들어오는 형태가 된다.
  const respawnCenters: Tile[] = [
    { x: 1, y: 0 },
    { x: Math.floor(width / 2), y: 0 },
    { x: width - 2, y: 0 },
    { x: width - 1, y: Math.floor(height / 2) },
    { x: width - 2, y: height - 1 },
    { x: Math.floor(width / 2), y: height - 1 },
    { x: 1, y: height - 1 },
    { x: 0, y: Math.floor(height / 2) },
  ];
  const reserved = new Set<string>();
  for (const center of respawnCenters) {
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dy = -1; dy <= 1; dy += 1)
        if (inside(center.x + dx, center.y + dy, width, height))
          reserved.add(tileKey(center.x + dx, center.y + dy));
  }

  // Give every room a stable slot in a 4-column × 2-row placement grid before adding its seeded
  // offset. This keeps layouts varied without allowing all rooms to cluster
  // along one edge and leave an empty half-map of corridor behind.
  const slotEdgesX = Array.from({ length: 5 }, (_, index) =>
    2 + Math.floor((index * (width - 4)) / 4),
  );
  const slotEdgesY = Array.from({ length: 3 }, (_, index) =>
    2 + Math.floor((index * (height - 4)) / 2),
  );
  const slots = rng.shuffle(
    Array.from({ length: 8 }, (_, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      return {
        left: slotEdgesX[column] as number,
        right: slotEdgesX[column + 1] as number,
        top: slotEdgesY[row] as number,
        bottom: slotEdgesY[row + 1] as number,
      };
    }),
  );
  const drafts: RoomDraft[] = [];
  for (const [templateIndex, baseTemplate] of rng.shuffle(ROOM_TEMPLATES).entries()) {
    const template = rotateTemplate(baseTemplate, rng.int(0, 3));
    const dimensions = dimensionsFor(template);
    const slot = slots[templateIndex];
    if (!slot) return null;
    // A room may use the complete slot. Its generated perimeter still keeps
    // the floor separated from neighbouring rooms, and collision validation
    // rejects the occasional seeded overlap. This is what allows real
    // seven-tile horizontal rooms inside the compact map.
    const minX = slot.left;
    const maxX = slot.right - dimensions.width;
    const minY = slot.top;
    const maxY = slot.bottom - dimensions.height;
    if (maxX < minX || maxY < minY) return null;
    let placement: RoomDraft | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const origin = {
        x: rng.int(minX, maxX),
        y: rng.int(minY, maxY),
      };
      const candidate = roomDraft(template, origin, width, height, rng);
      if (!candidate || [...candidate.reservationKeys].some((key) => reserved.has(key))) continue;
      placement = candidate;
      for (const key of candidate.reservationKeys) reserved.add(key);
      break;
    }
    if (!placement) return null;
    drafts.push(placement);
  }

  const blocked = new Set(drafts.flatMap((draft) => draft.wallTiles.map((tile) => tileKey(tile.x, tile.y))));
  for (const draft of drafts) {
    for (const tile of draft.floorTiles) blocked.add(tileKey(tile.x, tile.y));
  }
  const seedPoint = nearestOpenTile(
    { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    width,
    height,
    blocked,
  );
  if (!seedPoint) return null;
  const corridor = new Set<string>([tileKey(seedPoint.x, seedPoint.y)]);
  const connectors = rng.shuffle([
    ...drafts.map((draft) => ({ ...draft.approach })),
    ...respawnCenters.map((center) => ({ ...center })),
  ]);
  for (const connector of connectors) {
    const connectorKey = tileKey(connector.x, connector.y);
    if (corridor.has(connectorKey)) continue;
    const targets = [...corridor].map(tileFromKey);
    const target = rng.pick(targets);
    const direct = directPath(connector, new Set([tileKey(target.x, target.y)]), width, height, blocked, rng);
    if (direct.length === 0) return null;
    let route = direct;
    // A deliberately off-axis waypoint produces the long and zigzag halls of
    // a ward rather than eight identical shortest straight connections.
    if (rng.next() < 0.62) {
      const waypoint = randomOpenTile(width, height, blocked, rng);
      if (waypoint) {
        const first = directPath(connector, new Set([tileKey(waypoint.x, waypoint.y)]), width, height, blocked, rng);
        const second = directPath(waypoint, new Set([tileKey(target.x, target.y)]), width, height, blocked, rng);
        const via = first.length > 0 && second.length > 0 ? [...first, ...second.slice(1)] : [];
        if (via.length > 0 && via.length <= direct.length * 2 + 8) route = via;
      }
    }
    addCorridorPath(corridor, route, width, height, blocked, rng);
  }
  // `addCorridorPath` intentionally refuses the outer border so ordinary
  // corridors never erase map walls. Recovery pads are the exception: each
  // one is a one-tile doorway cut into that border and must remain walkable.
  for (const center of respawnCenters) corridor.add(tileKey(center.x, center.y));
  for (const draft of drafts) {
    corridor.add(tileKey(draft.door.x, draft.door.y));
    corridor.add(tileKey(draft.approach.x, draft.approach.y));
  }

  // The earlier route-only layout left isolated one-tile wall islands across
  // otherwise empty space.  They added no tactical choice and repeatedly
  // blocked touch movement.  Keep only room outlines and the map boundary as
  // walls; every other interior cell is a usable corridor.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const key = tileKey(x, y);
      if (!blocked.has(key)) corridor.add(key);
    }
  }

  const rooms: MapRoom[] = drafts.map((draft, index) => {
    const roomId = `room-${index + 1}`;
    const floorTiles = draft.floorTiles.map((tile) => ({ ...tile, roomId }));
    const bedCandidates = [...floorTiles].sort((a, b) =>
      centerDistance(b, draft.door) - centerDistance(a, draft.door) || a.y - b.y || a.x - b.x,
    );
    const firstBed = bedCandidates[0] as Tile;
    const secondBed = [...bedCandidates]
      .filter((tile) => tile.x !== firstBed.x || tile.y !== firstBed.y)
      .sort((a, b) =>
        centerDistance(b, firstBed) - centerDistance(a, firstBed) ||
        centerDistance(b, draft.door) - centerDistance(a, draft.door),
      )[0] as Tile;
    const beds = playMode === 'multiplayer' ? [{ ...firstBed }, { ...secondBed }] : [{ ...firstBed }];
    const bedKeys = new Set(beds.map((bed) => tileKey(bed.x, bed.y)));
    return {
      id: roomId,
      shape: draft.template.label,
      bounds: { ...draft.bounds },
      door: { ...draft.door, roomId },
      bed: { ...(beds[0] as Tile) },
      beds,
      floorTiles,
      buildTiles: floorTiles.filter((tile) => !bedKeys.has(tileKey(tile.x, tile.y))),
    };
  });

  const walkable = new Map<string, Tile>();
  for (const key of corridor) walkable.set(key, tileFromKey(key));
  for (const room of rooms)
    for (const tile of room.floorTiles) walkable.set(tileKey(tile.x, tile.y), { ...tile });

  const walls = new Map<string, Tile>();
  for (let x = 0; x < width; x += 1) {
    walls.set(tileKey(x, 0), { x, y: 0 });
    walls.set(tileKey(x, height - 1), { x, y: height - 1 });
  }
  for (let y = 1; y < height - 1; y += 1) {
    walls.set(tileKey(0, y), { x: 0, y });
    walls.set(tileKey(width - 1, y), { x: width - 1, y });
  }
  for (const key of blocked) walls.set(key, tileFromKey(key));
  for (const tile of walkable.values()) {
    for (const direction of DIRECTIONS) {
      const x = tile.x + direction.dx;
      const y = tile.y + direction.dy;
      const key = tileKey(x, y);
      if (inside(x, y, width, height) && !walkable.has(key)) walls.set(key, { x, y });
    }
  }
  for (const key of walkable.keys()) walls.delete(key);

  const playerSpawn = nearestOpenTile(
    { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    width,
    height,
    new Set([...blocked, ...walls.keys()].filter((key) => !corridor.has(key))),
  );
  const spawn = playerSpawn && corridor.has(tileKey(playerSpawn.x, playerSpawn.y))
    ? playerSpawn
    : [...corridor].map(tileFromKey).sort((a, b) =>
      centerDistance(a, { x: Math.floor(width / 2), y: Math.floor(height / 2) })
      - centerDistance(b, { x: Math.floor(width / 2), y: Math.floor(height / 2) }),
    )[0];
  if (!spawn) return null;

  return {
    seed,
    playMode,
    width,
    height,
    corridor: { x: 1, y: 1, width: width - 2, height: height - 2 },
    corridorTiles: [...corridor].map(tileFromKey),
    respawnZones: respawnCenters.map((center) => ({ x: center.x, y: center.y, width: 1, height: 1 })),
    playerSpawn: { ...spawn },
    ghostSpawn: { ...(respawnCenters[1] as Tile) },
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
  if (
    wallKeys.size !== map.walls.length ||
    walkableKeys.size !== map.walkable.length ||
    corridorKeys.size !== map.corridorTiles.length ||
    [...wallKeys].some((key) => walkableKeys.has(key))
  ) return false;
  const occupied = new Set<string>();
  const shapes = new Set<string>();
  for (const room of map.rooms) {
    const expectedBeds = map.playMode === 'multiplayer' ? 2 : 1;
    if (room.floorTiles.length < 20 || room.floorTiles.length > 30) return false;
    if (room.beds.length !== expectedBeds || room.buildTiles.length !== room.floorTiles.length - expectedBeds) return false;
    shapes.add(room.shape);
    const doorKey = tileKey(room.door.x, room.door.y);
    if (wallKeys.has(doorKey) || occupied.has(doorKey) || !walkableKeys.has(doorKey) || !corridorKeys.has(doorKey)) return false;
    occupied.add(doorKey);
    if (!room.beds.every((bed) => walkableKeys.has(tileKey(bed.x, bed.y)) && !wallKeys.has(tileKey(bed.x, bed.y)))) return false;
    for (const tile of room.floorTiles) {
      const key = tileKey(tile.x, tile.y);
      if (wallKeys.has(key) || occupied.has(key) || !walkableKeys.has(key) || corridorKeys.has(key)) return false;
      occupied.add(key);
    }
    const doorTouchesRoom = room.floorTiles.filter(
      (tile) => Math.abs(tile.x - room.door.x) + Math.abs(tile.y - room.door.y) === 1,
    ).length === 1;
    const doorTouchesCorridor = DIRECTIONS.some((direction) => {
      const key = tileKey(room.door.x + direction.dx, room.door.y + direction.dy);
      return key !== doorKey && corridorKeys.has(key);
    });
    if (!doorTouchesRoom || !doorTouchesCorridor) return false;
  }
  if (shapes.size !== map.rooms.length) return false;
  for (const zone of map.respawnZones) {
    for (let x = zone.x; x < zone.x + zone.width; x += 1)
      for (let y = zone.y; y < zone.y + zone.height; y += 1)
        if (!corridorKeys.has(tileKey(x, y))) return false;
  }
  return (
    corridorKeys.has(tileKey(Math.round(map.playerSpawn.x), Math.round(map.playerSpawn.y))) &&
    corridorKeys.has(tileKey(Math.round(map.ghostSpawn.x), Math.round(map.ghostSpawn.y))) &&
    connectedWalkableCount(map) === map.walkable.length
  );
}

export function connectedWalkableCount(map: MapDefinition): number {
  const walkable = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
  const first = map.walkable[0];
  if (!first) return 0;
  const queue: Tile[] = [first];
  const seen = new Set([tileKey(first.x, first.y)]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor] as Tile;
    for (const direction of DIRECTIONS) {
      const next = { x: current.x + direction.dx, y: current.y + direction.dy };
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
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const candidateSeed = (seed + Math.imul(attempt, 2_654_435_761)) >>> 0;
    const candidate = createCandidate(candidateSeed, playMode);
    if (candidate && validateMap(candidate)) return candidate;
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
