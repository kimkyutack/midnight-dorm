import { tileKey } from './map';
import type { MapDefinition, Tile, Vec2 } from './types';

interface NodeRecord {
  tile: Tile;
  g: number;
  f: number;
}

const distance = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function findPath(map: MapDefinition, from: Vec2, to: Vec2): Tile[] {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const goal = { x: Math.round(to.x), y: Math.round(to.y) };
  const walkable = new Set(map.walkable.map((tile) => tileKey(tile.x, tile.y)));
  if (!walkable.has(tileKey(start.x, start.y)) || !walkable.has(tileKey(goal.x, goal.y))) return [];

  const open = new Map<string, NodeRecord>();
  const parents = new Map<string, string>();
  const scores = new Map<string, number>();
  const startKey = tileKey(start.x, start.y);
  open.set(startKey, { tile: start, g: 0, f: distance(start, goal) });
  scores.set(startKey, 0);

  while (open.size > 0) {
    const currentEntry = [...open.entries()].sort((a, b) => a[1].f - b[1].f)[0];
    if (!currentEntry) break;
    const [currentKey, current] = currentEntry;
    open.delete(currentKey);
    if (current.tile.x === goal.x && current.tile.y === goal.y) {
      const path: Tile[] = [goal];
      let key = currentKey;
      while (parents.has(key)) {
        key = parents.get(key) as string;
        const [x, y] = key.split(',').map(Number);
        path.push({ x: x as number, y: y as number });
      }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: current.tile.x + dx, y: current.tile.y + dy };
      const nextKey = tileKey(next.x, next.y);
      if (!walkable.has(nextKey)) continue;
      const nextG = current.g + 1;
      if (nextG >= (scores.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      parents.set(nextKey, currentKey);
      scores.set(nextKey, nextG);
      open.set(nextKey, { tile: next, g: nextG, f: nextG + distance(next, goal) });
    }
  }
  return [];
}
