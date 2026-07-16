import { BALANCE, buildingStats, maxBuildingLevel } from '../shared/balance';
import { findPath } from '../shared/pathfinding';
import type { BuildingKind, GameSnapshot, MapDefinition, PlayerState, Tile } from '../shared/types';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

export type BotIntent =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'interact' }
  | { type: 'build'; roomId: string; tile: Tile; kind: BuildingKind }
  | { type: 'upgrade'; targetId: string }
  | { type: 'idle' };

export const BOT_REACTION_SECONDS: Record<BotDifficulty, number> = {
  easy: 1.7,
  normal: 1.05,
  hard: 0.62,
};

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function movementToward(player: PlayerState, target: { x: number; y: number }): BotIntent {
  const dx = target.x - player.position.x;
  const dy = target.y - player.position.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  return { type: 'move', dx: dx / magnitude, dy: dy / magnitude };
}

function movementAlongPath(player: PlayerState, target: { x: number; y: number }, map: MapDefinition): BotIntent {
  const path = findPath(map, player.position, target);
  const waypoint = path[1] ?? target;
  return movementToward(player, waypoint);
}

export function decideBotIntent(
  bot: PlayerState,
  snapshot: GameSnapshot,
  map: MapDefinition,
  difficulty: BotDifficulty,
): BotIntent {
  if (!bot.alive || (snapshot.status !== 'COUNTDOWN' && snapshot.status !== 'PLAYING')) return { type: 'idle' };

  if (!bot.roomId) {
    const available = map.rooms.flatMap((room) => {
      const roomState = snapshot.rooms.find((state) => state.id === room.id);
      return room.beds.map((bed, bedIndex) => ({ room, bed, bedIndex }))
        .filter(({ bedIndex }) => !roomState?.ownerIds.some((ownerId) =>
          snapshot.players.some((player) => player.id === ownerId && player.bedIndex === bedIndex),
        ));
    }).sort((a, b) => distance(bot.position, a.bed) - distance(bot.position, b.bed))[0];
    if (!available) return { type: 'idle' };
    if (distance(bot.position, available.bed) <= BALANCE.player.interactionRange) return { type: 'interact' };
    return movementAlongPath(bot, available.bed, map);
  }

  const room = snapshot.rooms.find((candidate) => candidate.id === bot.roomId);
  const mapRoom = map.rooms.find((candidate) => candidate.id === bot.roomId);
  if (!room || !mapRoom) return { type: 'idle' };

  const imperfectDelay = difficulty === 'easy' && Math.floor(snapshot.elapsed) % 7 < 2;
  if (imperfectDelay) return { type: 'idle' };
  if (room.doorHp / room.doorMaxHp < 0.48) {
    const repair = snapshot.buildings.find((building) => building.roomId === room.id && building.kind === 'repair-drone');
    if (!repair && bot.gold >= buildingStats('repair-drone', 1).gold) {
      const tile = freeTile(snapshot, mapRoom.buildTiles);
      if (tile) return { type: 'build', roomId: room.id, tile, kind: 'repair-drone' };
    }
    if (room.doorLevel < 3) return { type: 'upgrade', targetId: `door:${room.id}` };
  }
  const bedLevel = room.bedLevels[bot.bedIndex ?? 0] ?? 1;
  if (bedLevel < 3) return { type: 'upgrade', targetId: `bed:${room.id}:${bot.bedIndex ?? 0}` };
  if (room.doorLevel < 3) return { type: 'upgrade', targetId: `door:${room.id}` };

  const owned = snapshot.buildings.filter((building) => building.roomId === room.id);
  const priority: BuildingKind[] = ['generator', 'basic-turret', 'rapid-turret', 'frost-turret', 'electric-coil', 'shield-device', 'floor-trap'];
  for (const kind of priority) {
    if (owned.some((building) => building.kind === kind && (kind !== 'generator' || building.ownerId === bot.id))) continue;
    const stats = buildingStats(kind, 1);
    if (bot.gold >= stats.gold && bot.power >= stats.power) {
      const tile = freeTile(snapshot, mapRoom.buildTiles);
      if (tile) return { type: 'build', roomId: room.id, tile, kind };
    }
  }

  const upgradeable = owned.find((building) => building.level < maxBuildingLevel(building.kind));
  return upgradeable ? { type: 'upgrade', targetId: upgradeable.id } : { type: 'idle' };
}

function freeTile(snapshot: GameSnapshot, tiles: Tile[]): Tile | undefined {
  return tiles.find((tile) => !snapshot.buildings.some((building) => building.tile.x === tile.x && building.tile.y === tile.y));
}
