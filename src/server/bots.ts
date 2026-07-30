import {
  BALANCE,
  buildingStats,
  maxBuildingLevel,
  upgradeCost,
  upgradeRequirement,
} from '../shared/balance';
import { isPositionOnRoomFloor } from '../shared/map';
import { findPath } from '../shared/pathfinding';
import type { BuildingKind, GameSnapshot, MapDefinition, PlayerState, Tile } from '../shared/types';

export type BotDifficulty = 'easy' | 'normal' | 'hard';
export type BotStrategy = 'guardian' | 'gunner' | 'controller';

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
  | {
      type: 'activate-building';
      buildingId: string;
      action: 'use' | 'attack' | 'defense' | 'production' | 'hide-and-seek';
    }
  | { type: 'idle' };

export const BOT_REACTION_SECONDS: Record<BotDifficulty, number> = {
  easy: 1.7,
  normal: 1.05,
  hard: 0.62,
};

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Stable roles make a bot team combine defence, firepower and control. */
export function botStrategyFor(bot: Pick<PlayerState, 'id' | 'nickname'>): BotStrategy {
  const nicknameIndex = Number(bot.nickname.match(/(\d+)$/)?.[1] ?? Number.NaN);
  const stableIndex = Number.isFinite(nicknameIndex)
    ? Math.max(0, nicknameIndex - 1)
    : [...bot.id].reduce((total, character) => total + character.charCodeAt(0), 0);
  return (['guardian', 'gunner', 'controller'] as const)[stableIndex % 3] ?? 'guardian';
}

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

function roomContainsUnclaimedHuman(
  room: MapDefinition['rooms'][number],
  snapshot: GameSnapshot,
): boolean {
  return snapshot.players.some(
    (player) =>
      player.alive &&
      !player.isBot &&
      !player.roomId &&
      isPositionOnRoomFloor(room, player.position),
  );
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
    const roomsWithoutHuman = map.rooms.filter(
      (room) => !roomContainsUnclaimedHuman(room, snapshot),
    );
    const eligibleRooms = roomsWithoutHuman.filter(
      (room) =>
        room.id !== snapshot.tutorial?.reservedRoomId,
    );
    const candidateRooms =
      eligibleRooms.length > 0 ? eligibleRooms : roomsWithoutHuman;
    const available = candidateRooms.flatMap((room) => {
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
    const standingOnTargetFloor = isPositionOnRoomFloor(
      availableTarget.room,
      bot.position,
    );
    if (standingOnTargetFloor && distance(bot.position, availableTarget.bed) <= BALANCE.player.interactionRange)
      return { type: 'interact' };
    return movementAlongPath(bot, availableTarget.bed, map);
  }

  // Training bots demonstrate room claiming but never consume the beginner's
  // guided resources or obscure the required build sequence.
  if (snapshot.tutorial?.active) return { type: 'idle' };

  const room = snapshot.rooms.find((candidate) => candidate.id === bot.roomId);
  const mapRoom = map.rooms.find((candidate) => candidate.id === bot.roomId);
  if (!room || !mapRoom) return { type: 'idle' };

  const bedLevel = room.bedLevels[bot.bedIndex ?? 0] ?? 1;
  const owned = snapshot.buildings.filter((building) => building.roomId === room.id);
  const activeRank = snapshot.playMode === 'solo' ? bot.soloRank : bot.multiplayerRank;
  const strategy = botStrategyFor(bot);
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
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 4 : 6) +
      stagePressure +
      (strategy === 'guardian' ? 1 : 0),
  );
  const bedGoal = Math.min(
    maxBuildingLevel('bed'),
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 3 : 4) +
      Math.floor(snapshot.stageIndex / 55),
  );
  const turretGoal = Math.min(
    maxBuildingLevel('basic-turret'),
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 4 : 6) +
      Math.floor(snapshot.stageIndex / 35) +
      (strategy === 'gunner' ? 1 : 0),
  );
  const guardianTurrets = owned
    .filter((building) => building.kind === 'basic-turret')
    .sort((left, right) => right.level - left.level);
  const turret = guardianTurrets[0];
  const turretCountGoal = Math.min(
    difficulty === 'easy' ? 1 : difficulty === 'normal' ? 3 : 5,
    1 +
      Math.floor(snapshot.stageIndex / (difficulty === 'hard' ? 35 : 60)) +
      (strategy === 'gunner' ? 1 : 0),
  );
  const repair = owned.find((building) => building.kind === 'repair-drone');
  const generator = owned.find(
    (building) => building.kind === 'generator' && building.ownerId === bot.id,
  );
  const overload = owned.find(
    (building) => building.kind === 'overload-capacitor' && building.ownerId === bot.id,
  );
  const hideAndSeek = owned.find(
    (building) => building.kind === 'hide-and-seek-doll' && building.ownerId === bot.id,
  );
  const powerPanel = owned.find(
    (building) => building.kind === 'power-panel' && building.ownerId === bot.id,
  );

  if (
    pressure &&
    hideAndSeek &&
    doorRatio <= 0.24
  ) {
    return {
      type: 'activate-building',
      buildingId: hideAndSeek.id,
      action: 'hide-and-seek',
    };
  }
  if (
    pressure &&
    overload &&
    snapshot.elapsed >= (overload.overloadReadyAt ?? Number.POSITIVE_INFINITY)
  ) {
    return {
      type: 'activate-building',
      buildingId: overload.id,
      action: 'use',
    };
  }
  if (powerPanel) {
    const desiredMode =
      strategy === 'guardian' || (pressure && doorRatio < 0.55)
        ? 'defense'
        : strategy === 'controller' && !pressure
          ? 'production'
          : 'attack';
    if (powerPanel.powerPanelMode !== desiredMode) {
      return {
        type: 'activate-building',
        buildingId: powerPanel.id,
        action: desiredMode,
      };
    }
  }

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
    const emergencySupport: BuildingKind[] =
      strategy === 'controller'
        ? ['frost-turret', 'ghost-net', 'electric-coil']
        : strategy === 'guardian'
          ? ['shield-device', 'reflect-mirror']
          : ['turret-enhancer', 'electric-coil'];
    for (const kind of emergencySupport) {
      if (owned.some((building) => building.kind === kind)) continue;
      if (!canBuild(bot, kind)) continue;
      const tile = kind === 'turret-enhancer' && turret
        ? freeTileAdjacentTo(snapshot, mapRoom.buildTiles, turret.tile)
        : freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
      if (tile) return { type: 'build', roomId: room.id, tile, kind };
    }
    if (turret && turret.level < turretGoal && canUpgradeBuilding(turret))
      return { type: 'upgrade', targetId: turret.id };
  }

  // Every bot establishes a firing lane before spending on economy. The old
  // easy policy deliberately idled and upgraded the bed first, which made the
  // whole team collapse before it participated in combat.
  if (
    guardianTurrets.length < 1 &&
    canBuild(bot, 'basic-turret')
  ) {
    const tile = freeTileNearest(snapshot, mapRoom.buildTiles, mapRoom.door);
    if (tile) return { type: 'build', roomId: room.id, tile, kind: 'basic-turret' };
  }
  const openingDoorGoal = Math.min(
    doorGoal,
    (difficulty === 'easy' ? 2 : difficulty === 'normal' ? 3 : 4) +
      (strategy === 'guardian' ? 1 : 0),
  );
  if (
    room.doorLevel < openingDoorGoal &&
    canUpgradeRoomTarget('reinforced-door', room.doorLevel)
  )
    return { type: 'upgrade', targetId: `door:${room.id}` };
  if (
    difficulty !== 'easy' &&
    guardianTurrets.length < Math.min(2, turretCountGoal) &&
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

  const strategicPriority: Record<BotStrategy, BuildingKind[]> = {
    guardian: ['repair-drone', 'shield-device', 'reflect-mirror', 'door-anchor', 'power-panel', 'gem-core'],
    gunner: ['turret-enhancer', 'electric-coil', 'overload-capacitor', 'power-panel', 'gem-core'],
    controller: ['frost-turret', 'ghost-net', 'electric-coil', 'hide-and-seek-doll', 'power-panel', 'gem-core'],
  };
  const utilityPriority: BuildingKind[] =
    difficulty === 'easy'
      ? strategy === 'guardian'
        ? ['repair-drone', 'gem-core']
        : strategy === 'gunner'
          ? ['turret-enhancer', 'gem-core']
          : ['frost-turret', 'gem-core']
      : strategicPriority[strategy];
  for (const kind of utilityPriority) {
    if (owned.some((building) => building.kind === kind)) continue;
    if (!canBuild(bot, kind)) continue;
    const tile = kind === 'turret-enhancer' && turret
      ? freeTileAdjacentTo(snapshot, mapRoom.buildTiles, turret.tile)
      : kind === 'repair-drone' ||
          kind === 'frost-turret' ||
          kind === 'ghost-net' ||
          kind === 'shield-device' ||
          kind === 'reflect-mirror' ||
          kind === 'door-anchor'
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

function freeTileAdjacentTo(
  snapshot: GameSnapshot,
  tiles: Tile[],
  target: Tile,
): Tile | undefined {
  return [...tiles]
    .filter(
      (tile) =>
        Math.abs(tile.x - target.x) + Math.abs(tile.y - target.y) === 1 &&
        !snapshot.buildings.some(
          (building) =>
            building.tile.x === tile.x && building.tile.y === tile.y,
        ),
    )
    .sort((left, right) => distance(left, target) - distance(right, target))[0];
}
