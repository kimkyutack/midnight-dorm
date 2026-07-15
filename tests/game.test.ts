import { describe, expect, it } from 'vitest';
import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost } from '../src/shared/balance';
import { connectedWalkableCount, generateMap, isBuildTile, isWalkable, validateMap } from '../src/shared/map';
import { findPath } from '../src/shared/pathfinding';
import { parseClientMessage } from '../src/shared/protocol';
import { SeededRandom } from '../src/shared/rng';
import { DRAW_COSTS, RANDOM_ITEMS } from '../src/shared/randomItems';
import type { ClientMessage, GameSnapshot, Tile } from '../src/shared/types';
import { GameEngine } from '../src/server/engine';

function setup(players = 1, testMode = true): { engine: GameEngine; ids: string[]; tokens: string[] } {
  const map = generateMap(734_901);
  const engine = new GameEngine('TESTROOM', map, testMode);
  const ids: string[] = [];
  const tokens: string[] = [];
  for (let index = 0; index < players; index += 1) {
    const result = engine.join({ nickname: `Tester${index + 1}`, deviceId: `device-test-${index + 1}` });
    ids.push(result.player.id);
    tokens.push(result.reconnectToken);
    if (index > 0) engine.handle(result.player.id, envelope({ type: 'ready', ready: true }, index + 1));
  }
  return { engine, ids, tokens };
}

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'sequence' | 'timestamp'> : never;
type Intent = WithoutEnvelope<ClientMessage>;
function envelope(message: Intent, sequence = 1): ClientMessage {
  return { ...message, sequence, timestamp: 1_750_000_000_000 } as ClientMessage;
}

function begin(engine: GameEngine, hostId: string): GameSnapshot {
  expect(engine.start(hostId).ok).toBe(true);
  for (let index = 0; index < 240 && engine.snapshot().status === 'COUNTDOWN'; index += 1) engine.tick(0.1);
  expect(engine.snapshot().status).toBe('PLAYING');
  return engine.snapshot();
}

function assigned(engine: GameEngine, playerId: string): { roomId: string; tile: Tile } {
  const state = engine.snapshot();
  const player = state.players.find((candidate) => candidate.id === playerId);
  const roomId = player?.roomId;
  if (!roomId) throw new Error('player does not own a room');
  const room = engine.map.rooms.find((candidate) => candidate.id === roomId);
  const tile = room?.buildTiles[0];
  if (!tile) throw new Error('room has no build tile');
  return { roomId, tile };
}

describe('deterministic shared world', () => {
  it('replays a seeded random sequence exactly', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 20 }, () => first.next())).toEqual(Array.from({ length: 20 }, () => second.next()));
  });

  it('generates the same connected twelve-room variable map for a seed', () => {
    const first = generateMap(123_456);
    const second = generateMap(123_456);
    expect(first).toEqual(second);
    expect(validateMap(first)).toBe(true);
    expect(connectedWalkableCount(first)).toBe(first.walkable.length);
    expect(first.rooms).toHaveLength(12);
    expect(first.rooms.every((room) => room.floorTiles.length >= 9 && room.floorTiles.length <= 15)).toBe(true);
    expect(first.rooms.every((room) => room.buildTiles.length === room.floorTiles.length - 1)).toBe(true);
    expect(new Set(first.rooms.map((room) => room.shape)).size).toBeGreaterThanOrEqual(10);
  });

  it('finds a traversable A* route from spawn to every bed', () => {
    const map = generateMap(9001);
    for (const room of map.rooms) {
      const path = findPath(map, map.playerSpawn, room.bed);
      expect(path.length).toBeGreaterThan(0);
      expect(path.at(-1)).toMatchObject({ x: room.bed.x, y: room.bed.y });
    }
  });
});

describe('authoritative game rules', () => {
  it('never assigns the same room to two players', () => {
    const { engine, ids } = setup(4);
    const state = begin(engine, ids[0] as string);
    const occupied = state.players.map((player) => player.roomId);
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(state.rooms.filter((room) => room.ownerId).length).toBe(4);
  });

  it('accepts only declared build tiles and rejects duplicate occupancy', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const { roomId, tile } = assigned(engine, ids[0] as string);
    expect(isBuildTile(engine.map, roomId, tile)).toBe(true);
    expect(engine.build(ids[0] as string, roomId, { x: 0, y: 0 }, 'basic-turret').ok).toBe(false);
    expect(engine.build(ids[0] as string, roomId, tile, 'basic-turret').ok).toBe(true);
    engine.tick(0.1);
    expect(engine.build(ids[0] as string, roomId, tile, 'floor-trap').error).toContain('사용 중');
  });

  it('rejects purchases when resources are insufficient', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const { roomId } = assigned(engine, ids[0] as string);
    const tiles = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? [];
    expect(engine.build(ids[0] as string, roomId, tiles[0] as Tile, 'electric-coil').ok).toBe(true);
    engine.tick(0.1);
    const result = engine.build(ids[0] as string, roomId, tiles[1] as Tile, 'electric-coil');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('부족');
  });

  it('rejects construction inside another player room', () => {
    const { engine, ids } = setup(2);
    begin(engine, ids[0] as string);
    const ownerRoom = assigned(engine, ids[0] as string);
    const result = engine.build(ids[1] as string, ownerRoom.roomId, ownerRoom.tile, 'basic-turret');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('자신의 방');
  });

  it('upgrades a bed and a placed building by one level', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const playerId = ids[0] as string;
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    const building = engine.snapshot().buildings[0];
    expect(building).toBeDefined();
    for (let index = 0; index < 55; index += 1) engine.tick(0.1);
    expect(engine.upgrade(playerId, (building as { id: string }).id).ok).toBe(true);
    const state = engine.snapshot();
    expect(state.rooms.find((room) => room.id === roomId)?.bedLevel).toBe(2);
    expect(state.buildings[0]?.level).toBe(2);
  });

  it('server turrets acquire and damage the ghost', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const playerId = ids[0] as string;
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const initialHp = engine.snapshot().ghost.hp;
    for (let index = 0; index < 500 && engine.snapshot().ghost.hp === initialHp; index += 1) engine.tick(0.1);
    expect(engine.snapshot().ghost.hp).toBeLessThan(initialHp);
  });

  it('ghost attacks can destroy a door and produce a defeat', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    for (let index = 0; index < 1_200 && engine.snapshot().status === 'PLAYING'; index += 1) engine.tick(0.1);
    const state = engine.snapshot();
    expect(state.rooms.some((room) => room.ownerId && room.doorHp === 0)).toBe(true);
    expect(state.status).toBe('DEFEAT');
  });

  it('defenses can kill the ghost and produce a victory', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    const tiles = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? [];
    let nextTile = 0;
    for (let index = 0; index < 1_400 && engine.snapshot().status === 'PLAYING'; index += 1) {
      engine.tick(0.1);
      const player = engine.snapshot().players[0];
      if (player && player.gold >= 10 && nextTile < tiles.length) {
        const result = engine.build(playerId, roomId, tiles[nextTile] as Tile, 'basic-turret');
        if (result.ok) nextTile += 1;
      }
    }
    expect(engine.snapshot().status).toBe('VICTORY');
    expect(engine.snapshot().ghost.hp).toBe(0);
  });
});

describe('protocol and lifecycle', () => {
  it('rejects malformed and manipulated network messages without throwing', () => {
    expect(parseClientMessage('{bad json').ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'move', sequence: 1, timestamp: 2, dx: 99, dy: 0, inputSequence: 1 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'build', sequence: 1, timestamp: 2, roomId: 'room-1', tile: { x: 1.5, y: 2 }, kind: 'nuke' })).ok).toBe(false);
  });

  it('restores the same player with a valid 30-second reconnect token', () => {
    const { engine, ids, tokens } = setup();
    const now = 1_750_000_000_000;
    engine.disconnect(ids[0] as string, now);
    const result = engine.join({ nickname: 'Tester1', deviceId: 'device-test-1', reconnectToken: tokens[0] }, now + 29_000);
    expect(result.reconnected).toBe(true);
    expect(result.player.id).toBe(ids[0]);
  });

  it('marks an inactive room eligible for automatic cleanup', () => {
    const { engine, ids } = setup();
    const now = Date.now();
    engine.disconnect(ids[0] as string, now);
    expect(engine.shouldCleanup(now + BALANCE.inactiveCleanupMs - 1)).toBe(false);
    expect(engine.shouldCleanup(now + BALANCE.inactiveCleanupMs + 1)).toBe(true);
  });
});

describe('accelerated long simulation', () => {
  it('runs twelve server minutes without invalid resources or unreachable ghost state', () => {
    const { engine, ids } = setup(1, false);
    const host = ids[0] as string;
    expect(engine.addBot(host, 'easy').ok).toBe(true);
    expect(engine.addBot(host, 'normal').ok).toBe(true);
    expect(engine.addBot(host, 'hard').ok).toBe(true);
    begin(engine, host);
    for (let step = 0; step < 7_200; step += 1) {
      engine.tick(0.1);
      const state = engine.snapshot();
      for (const player of state.players) {
        expect(Number.isFinite(player.gold)).toBe(true);
        expect(Number.isFinite(player.power)).toBe(true);
        expect(player.gold).toBeGreaterThanOrEqual(0);
        expect(player.power).toBeGreaterThanOrEqual(0);
      }
      expect(isWalkable(engine.map, state.ghost.position.x, state.ghost.position.y)).toBe(true);
    }
    expect(['PLAYING', 'VICTORY', 'DEFEAT']).toContain(engine.snapshot().status);
  }, 20_000);
});

describe('requested progression and event rules', () => {
  it('produces one gold per second and doubles bed income by level', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const before = engine.snapshot().players[0]?.gold ?? 0;
    for (let index = 0; index < 5; index += 1) engine.tick(0.05);
    expect(engine.snapshot().players[0]?.gold).toBeCloseTo(before + 1, 5);
    const roomId = engine.snapshot().players[0]?.roomId as string;
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    const upgraded = engine.snapshot().players[0]?.gold ?? 0;
    for (let index = 0; index < 5; index += 1) engine.tick(0.05);
    expect(engine.snapshot().players[0]?.gold).toBeCloseTo(upgraded + 2, 5);
  });

  it('starts every turret at 10 gold and uses square prices through level 15', () => {
    for (const kind of ['basic-turret', 'rapid-turret', 'frost-turret'] as const) {
      expect(buildingStats(kind, 1).gold).toBe(10);
      expect(maxBuildingLevel(kind)).toBe(15);
      expect(upgradeCost(kind, 2).gold).toBe(40);
      expect(upgradeCost(kind, 7).gold).toBe(490);
      expect(upgradeCost(kind, 15).gold).toBe(2_250);
    }
  });

  it('raises door HP only when its level is upgraded', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const roomId = engine.snapshot().players[0]?.roomId as string;
    const initial = engine.snapshot().rooms.find((room) => room.id === roomId);
    expect(initial?.doorMaxHp).toBe(100);
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    const upgraded = engine.snapshot().rooms.find((room) => room.id === roomId);
    expect(upgraded?.doorLevel).toBe(2);
    expect(upgraded?.doorMaxHp).toBe(180);
    expect(upgraded?.doorHp).toBe(180);
  });

  it('levels a ghost from successful door attack counts and raises the next requirement', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const initialRequired = engine.snapshot().ghost.attacksToNextLevel;
    for (let index = 0; index < 900 && engine.snapshot().ghost.level === 1; index += 1) engine.tick(0.1);
    const ghost = engine.snapshot().ghost;
    expect(ghost.level).toBeGreaterThan(1);
    expect(ghost.maxHp).toBeGreaterThan(BALANCE.ghost.baseHp * .34);
    expect(ghost.attacksToNextLevel).toBeGreaterThan(initialRequired);
  });

  it('retreats toward the respawn area below ten percent HP', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    expect(ghost).toBeDefined();
    if (!ghost) return;
    ghost.position = { ...engine.map.playerSpawn };
    ghost.hp = ghost.maxHp * .09;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    const before = Math.hypot(ghost.position.x - engine.map.ghostSpawn.x, ghost.position.y - engine.map.ghostSpawn.y);
    engine.tick(0.1);
    const retreater = engine.snapshot().ghosts[0] as NonNullable<typeof ghost>;
    const after = Math.hypot(retreater.position.x - engine.map.ghostSpawn.x, retreater.position.y - engine.map.ghostSpawn.y);
    expect(retreater.retreating).toBe(true);
    expect(after).toBeLessThan(before);
  });

  it('offers exactly thirty weighted items and enforces the four draw costs', () => {
    expect(RANDOM_ITEMS).toHaveLength(30);
    expect(RANDOM_ITEMS.find((item) => item.id === 'void-cat')?.effect.goldPerSecond).toBe(20);
    expect(RANDOM_ITEMS.find((item) => item.id === 'hundred-robot')?.effect.powerPerSecond).toBe(100);
    expect(RANDOM_ITEMS.find((item) => item.id === 'void-cat')?.weight).toBeLessThan(RANDOM_ITEMS.find((item) => item.id === 'paper-crown')?.weight ?? 0);
    expect(DRAW_COSTS).toEqual([{ gold: 40, power: 0 }, { gold: 60, power: 10 }, { gold: 120, power: 20 }, { gold: 200, power: 40 }]);

    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'lucky-machine').ok).toBe(true);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing player');
    player.gold = 1_000;
    player.power = 1_000;
    engine.restore(persisted);
    const machineId = engine.snapshot().buildings.find((building) => building.kind === 'lucky-machine')?.id as string;
    for (let index = 0; index < 4; index += 1) expect(engine.drawItem(playerId, machineId).ok).toBe(true);
    expect(engine.snapshot().players[0]?.drawCount).toBe(4);
    expect(engine.snapshot().players[0]?.gold).toBe(580);
    expect(engine.snapshot().players[0]?.power).toBe(930);
    expect(engine.drawItem(playerId, machineId).ok).toBe(false);
  });

  it('can create fast, brute, caster, and twin match events', () => {
    const variants = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const engine = new GameEngine(`EVENT${index}`, generateMap(30_000 + index), false);
      const state = engine.snapshot();
      for (const ghost of state.ghosts) variants.add(ghost.variant);
    }
    expect(variants).toEqual(new Set(['wanderer', 'swift', 'brute', 'caster', 'twin-a', 'twin-b']));
  });
});
