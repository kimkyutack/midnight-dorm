import {
  BALANCE,
  buildingStats,
  maxBuildingLevel,
  upgradeCost,
  upgradeRequirement,
} from '../shared/balance';
import { findPath } from '../shared/pathfinding';
import type { BuildingKind, GameSnapshot, MapDefinition, PlayerState, Tile } from '../shared/types';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** A stable bed reservation prevents unclaimed bots from changing course. */
export interface BotBedTarget {
  roomId: string;
  bedIndex: number;
}

export type BotIntent =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'interact' }
  | { type: 'build'; roomId: string; tile: Tile; kind: BuildingKind }
  | { type: 'move-building'; buildingId: string; tile: Tile }
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
  // A survivor can move more than half a tile between two decisions.  Do not
  // steer back to the just-passed A* node in that case: doing so creates the
  // visible forward/backward shuffle at a door.  Select the first upcoming
  // tile that is still meaningfully ahead of the bot instead.
  const waypoint = path.slice(1).find((tile) => distance(player.position, tile) > 0.42) ?? target;
  return movementToward(player, waypoint);
}

export function decideBotIntent(
  bot: PlayerState,
  snapshot: GameSnapshot,
  map: MapDefinition,
  difficulty: BotDifficulty,
  reservedBed: BotBedTarget | null = null,
): BotIntent {
  if (
    !bot.alive ||
    (snapshot.status !== 'COUNTDOWN' &&
      snapshot.status !== 'PLAYING' &&
      snapshot.status !== 'OVERTIME')
  ) return { type: 'idle' };

  if (!bot.roomId) {
    const roomCapacity = snapshot.playMode === 'multiplayer' ? 2 : 1;
    const available = map.rooms.flatMap((room) => {
      const roomState = snapshot.rooms.find((state) => state.id === room.id);
      return room.beds.map((bed, bedIndex) => ({ room, bed, bedIndex }))
        .filter(({ bedIndex }) =>
          (roomState?.ownerIds.length ?? 0) < roomCapacity &&
          !roomState?.ownerIds.some((ownerId) =>
            snapshot.players.some((player) => player.id === ownerId && player.bedIndex === bedIndex),
          ),
        );
    }).sort((a, b) => distance(bot.position, a.bed) - distance(bot.position, b.bed));
    // The engine reserves a target before calling this function.  Do not
    // derive a changing target from the live distance order here: as several
    // bots move, that order changes every tick and makes them reverse at doors.
    const availableTarget = reservedBed
      ? available.find(
          (candidate) =>
            candidate.room.id === reservedBed.roomId &&
            candidate.bedIndex === reservedBed.bedIndex,
        )
      : available[0];
    if (!availableTarget) return { type: 'idle' };
    // Match the server-side bed interaction rule. Otherwise a bot can stop
    // at an outside wall corner and repeatedly try to sleep through it.
    const standingOnTargetFloor = availableTarget.room.floorTiles.some(
      (tile) => distance(bot.position, tile) <= 0.68,
    );
    if (standingOnTargetFloor && distance(bot.position, availableTarget.bed) <= BALANCE.player.interactionRange)
      return { type: 'interact' };
    return movementAlongPath(bot, availableTarget.bed, map);
  }

  const room = snapshot.rooms.find((candidate) => candidate.id === bot.roomId);
  const mapRoom = map.rooms.find((candidate) => candidate.id === bot.roomId);
  if (!room || !mapRoom) return { type: 'idle' };

  const imperfectDelay = difficulty === 'easy' && Math.floor(snapshot.elapsed) % 7 < 2;
  if (imperfectDelay) return { type: 'idle' };

  const bedLevel = room.bedLevels[bot.bedIndex ?? 0] ?? 1;
  const owned = snapshot.buildings.filter((building) => building.roomId === room.id);
  const activeRank = snapshot.playMode === 'solo' ? bot.soloRank : bot.multiplayerRank;
  const pressure = snapshot.ghosts.some(
    (ghost) =>
      ghost.targetRoomId === room.id &&
      ghost.hp > 0 &&
      !ghost.retreating &&
      !ghost.healing,
  );
  const doorRatio = room.doorHp / Math.max(1, room.doorMaxHp);
  const stagePressure = Math.floor(snapshot.stageIndex / 40);
  const doorGoal = Math.min(
    maxBuildingLevel('reinforced-door'),
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 4 : 6) + stagePressure,
  );
  const bedGoal = Math.min(
    maxBuildingLevel('bed'),
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 3 : 4) +
      Math.floor(snapshot.stageIndex / 55),
  );
  const turretGoal = Math.min(
    maxBuildingLevel('basic-turret'),
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 4 : 6) +
      Math.floor(snapshot.stageIndex / 35),
  );
  const guardianTurrets = owned
    .filter((building) => building.kind === 'basic-turret')
    .sort((left, right) => right.level - left.level);
  const turret = guardianTurrets[0];
  const turretCountGoal = Math.min(
    difficulty === 'easy' ? 1 : difficulty === 'normal' ? 2 : 4,
    1 + Math.floor(snapshot.stageIndex / (difficulty === 'hard' ? 35 : 60)),
  );
  const repair = owned.find((building) => building.kind === 'repair-drone');
  const generator = owned.find(
    (building) => building.kind === 'generator' && building.ownerId === bot.id,
  );

  // A starter turret is useful only when it can cover the door. Skilled bots
  // move it once, rather than wasting gold on a duplicate in the back row.
  if (
    difficulty !== 'easy' &&
    turret?.ownerId === bot.id &&
    distance(turret.tile, mapRoom.door) > 2.35
  ) {
    const nearDoor = freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
    if (nearDoor && distance(nearDoor, mapRoom.door) + 0.25 < distance(turret.tile, mapRoom.door))
      return { type: 'move-building', buildingId: turret.id, tile: nearDoor };
  }

  const canUpgradeRoomTarget = (
    kind: 'bed' | 'reinforced-door',
    currentLevel: number,
  ): boolean => {
    if (currentLevel >= maxBuildingLevel(kind, activeRank)) return false;
    const requirement = upgradeRequirement(kind, currentLevel, {
      bedLevel,
      doorLevel: room.doorLevel,
    });
    if (requirement) return false;
    const cost = upgradeCost(kind, currentLevel + 1, activeRank);
    return bot.gold >= cost.gold && bot.power >= cost.power;
  };
  const canUpgradeBuilding = (building: (typeof owned)[number]): boolean => {
    if (building.level >= maxBuildingLevel(building.kind, activeRank)) return false;
    const requirement = upgradeRequirement(building.kind, building.level, {
      bedLevel,
      doorLevel: room.doorLevel,
    });
    if (requirement) return false;
    const cost = upgradeCost(building.kind, building.level + 1, activeRank);
    return bot.gold >= cost.gold && bot.power >= cost.power;
  };

  // Door pressure interrupts the normal economy plan. Normal and hard bots
  // establish firepower first, then repair and reinforce before greedier bed
  // or generator upgrades.
  if (pressure) {
    const pressureTurretGoal = difficulty === 'hard'
      ? Math.max(2, turretCountGoal)
      : Math.max(1, turretCountGoal);
    if (guardianTurrets.length < pressureTurretGoal) {
      const tile = freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
      if (tile && canBuild(bot, 'basic-turret'))
        return { type: 'build', roomId: room.id, tile, kind: 'basic-turret' };
    }
    if (
      room.doorLevel < doorGoal &&
      canUpgradeRoomTarget('reinforced-door', room.doorLevel)
    )
      return { type: 'upgrade', targetId: `door:${room.id}` };
    if (
      doorRatio < (difficulty === 'hard' ? 0.82 : 0.62) &&
      !repair &&
      canBuild(bot, 'repair-drone')
    ) {
      const tile = freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
      if (tile) return { type: 'build', roomId: room.id, tile, kind: 'repair-drone' };
    }
    if (turret && turret.level < turretGoal && canUpgradeBuilding(turret))
      return { type: 'upgrade', targetId: turret.id };
  }

  // Normal and hard bots establish at least one firing lane before spending a
  // large lump of gold on economy. This prevents a pressured bot from sitting
  // on 150 gold with no turret while saving for a generator.
  if (
    difficulty !== 'easy' &&
    guardianTurrets.length < 1 &&
    canBuild(bot, 'basic-turret')
  ) {
    const tile = freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
    if (tile) return { type: 'build', roomId: room.id, tile, kind: 'basic-turret' };
  }
  if (bedLevel < bedGoal && canUpgradeRoomTarget('bed', bedLevel))
    return { type: 'upgrade', targetId: `bed:${room.id}:${bot.bedIndex ?? 0}` };
  if (guardianTurrets.length < turretCountGoal && canBuild(bot, 'basic-turret')) {
    const tile = freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
    if (tile) return { type: 'build', roomId: room.id, tile, kind: 'basic-turret' };
  }
  if (!generator && canBuild(bot, 'generator')) {
    const tile = freeTileFarthest(snapshot, mapRoom.buildTiles, mapRoom.door);
    if (tile) return { type: 'build', roomId: room.id, tile, kind: 'generator' };
  }
  if (
    room.doorLevel < doorGoal &&
    canUpgradeRoomTarget('reinforced-door', room.doorLevel)
  )
    return { type: 'upgrade', targetId: `door:${room.id}` };
  if (turret && turret.level < turretGoal && canUpgradeBuilding(turret))
    return { type: 'upgrade', targetId: turret.id };

  const utilityPriority: BuildingKind[] =
    difficulty === 'hard'
      ? ['repair-drone', 'frost-turret', 'ghost-net', 'turret-enhancer', 'electric-coil', 'shield-device', 'gem-core']
      : difficulty === 'normal'
        ? ['frost-turret', 'repair-drone', 'electric-coil', 'shield-device', 'gem-core']
        : ['gem-core'];
  for (const kind of utilityPriority) {
    if (owned.some((building) => building.kind === kind)) continue;
    if (!canBuild(bot, kind)) continue;
    const tile =
      kind === 'repair-drone' || kind === 'frost-turret' || kind === 'ghost-net'
        ? freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door)
        : freeTile(snapshot, mapRoom.buildTiles);
    if (tile) return { type: 'build', roomId: room.id, tile, kind };
  }

  const upgradeable = owned
    .filter(canUpgradeBuilding)
    .sort((left, right) => {
      const priority = (kind: BuildingKind): number =>
        kind === 'basic-turret' ? 0
          : kind === 'generator' ? 1
            : kind === 'repair-drone' ? 2
              : 3;
      return priority(left.kind) - priority(right.kind) || left.level - right.level;
    })[0];
  return upgradeable ? { type: 'upgrade', targetId: upgradeable.id } : { type: 'idle' };
}

function canBuild(bot: PlayerState, kind: BuildingKind): boolean {
  const stats = buildingStats(kind, 1);
  return bot.gold >= stats.gold && bot.power >= stats.power;
}

function freeTile(snapshot: GameSnapshot, tiles: Tile[]): Tile | undefined {
  return tiles.find((tile) => !snapshot.buildings.some((building) => building.tile.x === tile.x && building.tile.y === tile.y));
}

function freeTileNearest(
  snapshot: GameSnapshot,
  tiles: Tile[],
  target: Tile,
): Tile | undefined {
  return [...tiles]
    .filter((tile) => !snapshot.buildings.some(
      (building) => building.tile.x === tile.x && building.tile.y === tile.y,
    ))
    .sort((left, right) => distance(left, target) - distance(right, target))[0];
}

function freeTileFarthest(
  snapshot: GameSnapshot,
  tiles: Tile[],
  target: Tile,
): Tile | undefined {
  return [...tiles]
    .filter((tile) => !snapshot.buildings.some(
      (building) => building.tile.x === tile.x && building.tile.y === tile.y,
    ))
    .sort((left, right) => distance(right, target) - distance(left, target))[0];
}
