import { describe, expect, it } from 'vitest';
import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost } from '../src/shared/balance';
import { connectedWalkableCount, generateMap, isBuildTile, isWalkable, validateMap } from '../src/shared/map';
import { findPath } from '../src/shared/pathfinding';
import { getStage, higherRank, rankBadgeSymbol, rankBenefits, rankFromXp, RANK_VISUALS, STAGES } from '../src/shared/progression';
import { parseClientMessage } from '../src/shared/protocol';
import { SeededRandom } from '../src/shared/rng';
import { DRAW_COSTS, RANDOM_ITEMS } from '../src/shared/randomItems';
import { stageThemeFor } from '../src/shared/stageThemes';
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
  for (let index = 0; index < 400 && engine.snapshot().status === 'COUNTDOWN'; index += 1) engine.tick(0.1);
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

  it('assigns distinct code-native themes to every advanced stage tier', () => {
    expect(stageThemeFor('easy-1').id).toBe('hospital');
    expect(stageThemeFor('nightmare-1').id).toBe('forest');
    expect(stageThemeFor('hell-1').id).toBe('ice');
    expect(stageThemeFor('inferno-1').id).toBe('desert');
    expect(stageThemeFor('epic-1').id).toBe('junkyard');
    expect(stageThemeFor('mythic-1').id).toBe('occult');
    expect(stageThemeFor('legendary-1').id).toBe('void');
  });

  it('defines a badge and evolving hat identity for all six ranks', () => {
    const ranks = ['beginner', 'intermediate', 'expert', 'master', 'veteran', 'legend'] as const;
    expect(new Set(ranks.map((rank) => rankBadgeSymbol(rank))).size).toBe(ranks.length);
    expect(ranks.every((rank) => RANK_VISUALS[rank].hatLabel.length > 0)).toBe(true);
  });

  it('generates the same connected twelve-room variable map for a seed', () => {
    const first = generateMap(123_456);
    const second = generateMap(123_456);
    expect(first).toEqual(second);
    expect(validateMap(first)).toBe(true);
    expect(connectedWalkableCount(first)).toBe(first.walkable.length);
    expect(first.rooms).toHaveLength(12);
    expect(first.rooms.every((room) => room.floorTiles.length >= 10 && room.floorTiles.length <= 15)).toBe(true);
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

  it('routes every room through its only doorway instead of through walls', () => {
    const map = generateMap(4_204);
    for (const room of map.rooms) {
      const path = findPath(map, room.bed, map.playerSpawn);
      expect(path.some((tile) => tile.x === room.door.x && tile.y === room.door.y)).toBe(true);
    }
  });
});

describe('authoritative game rules', () => {
  it('keeps the ghost at spawn for a thirty-second preparation phase', () => {
    const { engine, ids } = setup(1, false);
    const ghostSpawn = { ...engine.map.ghostSpawn };
    expect(engine.start(ids[0] as string).ok).toBe(true);
    expect(engine.snapshot().countdown).toBe(30);
    for (let index = 0; index < 299; index += 1) engine.tick(0.1);
    expect(engine.snapshot().status).toBe('COUNTDOWN');
    expect(engine.snapshot().ghost.position).toEqual(ghostSpawn);
    engine.tick(0.1);
    expect(engine.snapshot().status).toBe('PLAYING');
  });

  it('never assigns the same room to two players', () => {
    const { engine, ids } = setup(4);
    const state = begin(engine, ids[0] as string);
    const occupied = state.players.map((player) => player.roomId);
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(state.rooms.filter((room) => room.ownerId).length).toBe(4);
  });

  it('keeps an occupied player lying at the exact bed position', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    const state = begin(engine, playerId);
    const player = state.players.find((candidate) => candidate.id === playerId);
    const bed = engine.map.rooms.find((room) => room.id === player?.roomId)?.bed;
    expect(player?.position).toEqual(bed);
    expect(engine.setMovement(playerId, 1, 1, 99).ok).toBe(true);
    engine.tick(0.1);
    const fixed = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    expect(fixed?.position).toEqual(bed);
    expect(fixed?.velocity).toEqual({ x: 0, y: 0 });
  });

  it('makes ten basic turret hits visibly damage a level-one easy ghost in solo and four-player games', () => {
    const tenHits = buildingStats('basic-turret', 1).value * 10;
    const soloRatio = tenHits / BALANCE.ghost.baseHp;
    const multiplayerRatio = tenHits / (BALANCE.ghost.baseHp * (1 + BALANCE.ghost.hpPerPlayer * 3));
    expect(soloRatio).toBeGreaterThanOrEqual(0.17);
    expect(soloRatio).toBeLessThanOrEqual(0.18);
    expect(multiplayerRatio).toBeGreaterThanOrEqual(0.13);
    expect(multiplayerRatio).toBeLessThanOrEqual(0.14);
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

  it('installs several identical generators on different tiles without substituting another building', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing repeat-build player');
    player.gold = 1_000;
    player.power = 100;
    engine.restore(persisted);
    const tiles = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? [];
    for (const tile of tiles.slice(0, 4)) expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
    const generators = engine.snapshot().buildings.filter((building) => building.roomId === roomId);
    expect(generators).toHaveLength(4);
    expect(generators.every((building) => building.kind === 'generator')).toBe(true);
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
    expect(engine.upgrade(playerId, (building as { id: string }).id).ok).toBe(true);
    const state = engine.snapshot();
    expect(state.rooms.find((room) => room.id === roomId)?.bedLevel).toBe(2);
    expect(state.buildings[0]?.level).toBe(2);
  });

  it('allows beds to reach level ten with exactly doubled gold production', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing player');
    player.gold = 100_000;
    player.power = 100_000;
    engine.restore(persisted);
    for (let level = 2; level <= 10; level += 1) expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    expect(engine.snapshot().rooms.find((room) => room.id === roomId)?.bedLevel).toBe(10);
    expect(buildingStats('bed', 10).value).toBe(512);
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(false);
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
    const fire = engine.drainEvents().find((event) => event.kind === 'turret-fire');
    expect(fire?.targetPosition).toBeDefined();
    expect(fire?.buildingKind).toBe('basic-turret');
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
  it('routes three bots through doorways and claims distinct beds before countdown ends', () => {
    const engine = new GameEngine('BOTPATH1', generateMap(42_424), false);
    const host = engine.join({ nickname: '사람생존자', deviceId: 'device-human-path' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    for (let index = 0; index < 190 && engine.snapshot().players.filter((player) => player.isBot && player.roomId).length < 3; index += 1) engine.tick(0.1);
    const state = engine.snapshot();
    const bots = state.players.filter((player) => player.isBot);
    expect(bots.every((bot) => bot.roomId)).toBe(true);
    expect(new Set(bots.map((bot) => bot.roomId)).size).toBe(3);
    expect(state.status).toBe('COUNTDOWN');
    expect(state.countdown).toBeGreaterThan(0);
    expect(bots.every((bot) => bot.velocity.x === 0 && bot.velocity.y === 0)).toBe(true);
  });

  it('reaches the nearest occupied door and attacks it within six seconds', () => {
    const engine = new GameEngine('GHOSTPATH', generateMap(51_515), false);
    const player = engine.join({ nickname: '문지기', deviceId: 'device-ghost-path' });
    begin(engine, player.player.id);
    engine.drainEvents();
    const startedAt = engine.snapshot().elapsed;
    let hit = false;
    for (let index = 0; index < 60 && !hit; index += 1) {
      engine.tick(0.1);
      hit = engine.drainEvents().some((event) => event.kind === 'door-hit');
    }
    expect(hit).toBe(true);
    expect(engine.snapshot().elapsed - startedAt).toBeLessThanOrEqual(6);
  });

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

  it('emits integer gold and power income at the producing bed and generator', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
    engine.drainEvents();
    for (let index = 0; index < 6; index += 1) engine.tick(0.05);
    const events = engine.drainEvents();
    expect(events.some((event) => event.kind === 'gold' && event.amount === 1 && event.position?.x === mapRoom?.bed.x && event.position?.y === mapRoom?.bed.y)).toBe(true);
    expect(events.some((event) => event.kind === 'power' && event.amount === 1 && event.position?.x === tile.x && event.position?.y === tile.y)).toBe(true);
  });

  it('starts bed gold income during countdown before the ghost moves', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = engine.map.rooms[0];
    if (!player || !room) throw new Error('missing countdown income fixture');
    player.position = { ...room.bed };
    engine.restore(persisted);
    expect(engine.interact(playerId).ok).toBe(true);
    const before = engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold ?? 0;
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    const state = engine.snapshot();
    expect(state.status).toBe('COUNTDOWN');
    expect(state.players.find((candidate) => candidate.id === playerId)?.gold).toBeCloseTo(before + 1, 5);
    expect(state.ghost.position).toEqual(engine.map.ghostSpawn);
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

  it('lets an authoritative turret reach level 15 but never level 16', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing player');
    player.gold = 99_999;
    engine.restore(persisted);
    const buildingId = engine.snapshot().buildings[0]?.id as string;
    for (let level = 2; level <= 15; level += 1) expect(engine.upgrade(playerId, buildingId).ok).toBe(true);
    expect(engine.snapshot().buildings[0]?.level).toBe(15);
    expect(engine.upgrade(playerId, buildingId).ok).toBe(false);
  });

  it('raises door HP only when its level is upgraded', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const roomId = engine.snapshot().players[0]?.roomId as string;
    const initial = engine.snapshot().rooms.find((room) => room.id === roomId);
    expect(initial?.doorMaxHp).toBe(80);
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    const upgraded = engine.snapshot().rooms.find((room) => room.id === roomId);
    expect(upgraded?.doorLevel).toBe(2);
    expect(upgraded?.doorMaxHp).toBe(230);
    expect(upgraded?.doorHp).toBe(230);
  });

  it('upgrades an intact door through level 15 but never level 16', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player?.roomId) throw new Error('missing max-door player');
    player.gold = 999_999;
    player.power = 999_999;
    engine.restore(persisted);
    for (let level = 2; level <= 15; level += 1) expect(engine.upgrade(playerId, `door:${player.roomId}`).ok).toBe(true);
    const door = engine.snapshot().rooms.find((room) => room.id === player.roomId);
    expect(door?.doorLevel).toBe(15);
    expect(door?.doorMaxHp).toBe(5_320);
    expect(engine.upgrade(playerId, `door:${player.roomId}`).ok).toBe(false);
  });

  it('lets three level-one basic turrets protect a level-two door through the first retreat', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const tiles = [...(mapRoom?.buildTiles ?? [])].sort((a, b) => Math.hypot(a.x - (mapRoom?.door.x ?? 0), a.y - (mapRoom?.door.y ?? 0)) - Math.hypot(b.x - (mapRoom?.door.x ?? 0), b.y - (mapRoom?.door.y ?? 0)));
    for (const tile of tiles.slice(0, 3)) expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    let shots = 0;
    let doorHits = 0;
    let retreats = 0;
    for (let index = 0; index < 3_000 && engine.snapshot().status === 'PLAYING' && retreats === 0; index += 1) {
      engine.tick(0.1);
      const events = engine.drainEvents();
      shots += events.filter((event) => event.kind === 'turret-fire').length;
      doorHits += events.filter((event) => event.kind === 'door-hit').length;
      retreats += events.filter((event) => event.kind === 'ghost-retreat').length;
    }
    const result = engine.snapshot();
    const room = result.rooms.find((candidate) => candidate.id === roomId);
    expect(result.status, JSON.stringify({ elapsed: result.elapsed, doorHp: room?.doorHp, ghostHp: result.ghost.hp, ghostLevel: result.ghost.level, attackCount: result.ghost.attackCount, retreating: result.ghost.retreating, healing: result.ghost.healing, shots, doorHits, retreats })).toBe('PLAYING');
    expect(retreats).toBe(1);
    expect(result.ghost.level).toBe(1);
    expect(room?.doorHp).toBeGreaterThan(0);
  });

  it('forces a level-one ghost to retreat before a level-one door breaks with one L1 and one L2 turret', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const tiles = [...(mapRoom?.buildTiles ?? [])].sort((a, b) =>
      Math.hypot(a.x - (mapRoom?.door.x ?? 0), a.y - (mapRoom?.door.y ?? 0))
      - Math.hypot(b.x - (mapRoom?.door.x ?? 0), b.y - (mapRoom?.door.y ?? 0)),
    );
    expect(engine.build(playerId, roomId, tiles[0] as Tile, 'basic-turret').ok).toBe(true);
    expect(engine.build(playerId, roomId, tiles[1] as Tile, 'basic-turret').ok).toBe(true);
    const secondTurret = engine.snapshot().buildings[1];
    expect(secondTurret).toBeDefined();
    expect(engine.upgrade(playerId, secondTurret?.id ?? '').ok).toBe(true);

    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing balance ghost');
    ghost.variant = 'wanderer';
    ghost.level = 1;
    ghost.maxHp = BALANCE.ghost.baseHp;
    ghost.hp = ghost.maxHp;
    persisted.snapshot.ghosts = [ghost];
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);

    let retreatSeen = false;
    for (let index = 0; index < 1_200 && !retreatSeen; index += 1) {
      engine.tick(0.1);
      retreatSeen = engine.drainEvents().some((event) => event.kind === 'ghost-retreat');
    }
    const door = engine.snapshot().rooms.find((room) => room.id === roomId);
    expect(retreatSeen).toBe(true);
    expect(door?.doorLevel).toBe(1);
    expect(door?.doorHp).toBeGreaterThan(0);
  });

  it('lets four basic turrets placed across the room keep at least half of a level-two door through the first retreat', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const tiles = [...(mapRoom?.buildTiles ?? [])].sort((a, b) => Math.hypot(b.x - (mapRoom?.door.x ?? 0), b.y - (mapRoom?.door.y ?? 0)) - Math.hypot(a.x - (mapRoom?.door.x ?? 0), a.y - (mapRoom?.door.y ?? 0)));
    for (const tile of tiles.slice(0, 4)) expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    let retreatSeen = false;
    for (let index = 0; index < 3_000 && engine.snapshot().status === 'PLAYING' && !retreatSeen; index += 1) {
      engine.tick(0.1);
      retreatSeen = engine.drainEvents().some((event) => event.kind === 'ghost-retreat');
    }
    const result = engine.snapshot();
    const door = result.rooms.find((room) => room.id === roomId);
    expect(result.status).toBe('PLAYING');
    expect(retreatSeen).toBe(true);
    expect(result.ghost.level).toBe(1);
    expect(door?.doorHp).toBeGreaterThanOrEqual((door?.doorMaxHp ?? 0) * 0.5);
  });

  it('never revives a destroyed door through upgrades or repair effects', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === player?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === player?.roomId);
    if (!player || !room || !mapRoom) throw new Error('missing destroyed-door fixture');
    room.doorHp = 0;
    player.gold = 99_999;
    player.power = 99_999;
    player.items.push({ itemId: 'repair-spider', label: '수리 거미', rarity: 'rare', count: 1 });
    persisted.snapshot.buildings.push({
      id: 'destroyed-door-repair', kind: 'repair-drone', roomId: room.id, ownerId: playerId,
      tile: mapRoom.buildTiles[0] as Tile, level: 3, cooldown: 0, hp: 100,
    });
    engine.restore(persisted);
    const levelBefore = room.doorLevel;
    const result = engine.upgrade(playerId, `door:${room.id}`);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('파괴된 문');
    for (let index = 0; index < 20; index += 1) engine.tick(0.1);
    const destroyed = engine.snapshot().rooms.find((candidate) => candidate.id === room.id);
    expect(destroyed?.doorLevel).toBe(levelBefore);
    expect(destroyed?.doorHp).toBe(0);
  });

  it('has a breached ghost attack the player instead of the door and kill in one hit', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === player?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === player?.roomId);
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !room || !mapRoom || !ghost) throw new Error('missing breach fixture');
    room.doorHp = 0;
    player.hp = player.maxHp;
    player.position = { ...mapRoom.bed };
    ghost.position = { ...mapRoom.bed };
    ghost.targetRoomId = room.id;
    ghost.attackCooldown = 0;
    ghost.retreating = false;
    ghost.healing = false;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    engine.drainEvents();
    engine.tick(0.05);
    const after = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    const events = engine.drainEvents();
    expect(after?.hp).toBe(0);
    expect(after?.alive).toBe(false);
    expect(events.some((event) => event.kind === 'player-hit' && event.playerId === playerId)).toBe(true);
    expect(events.some((event) => event.kind === 'death' && event.playerId === playerId)).toBe(true);
    expect(events.some((event) => event.kind === 'door-hit' && event.roomId === room.id)).toBe(false);
  });

  it('requires thirty door hits for the first growth and raises the next requirement sharply', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players[0];
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === player?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === player?.roomId);
    const fixtureGhost = persisted.snapshot.ghosts[0];
    if (!room || !mapRoom || !fixtureGhost) throw new Error('missing growth fixture');
    room.doorHp = 10_000;
    room.doorMaxHp = 10_000;
    fixtureGhost.position = { ...mapRoom.door };
    fixtureGhost.targetRoomId = room.id;
    fixtureGhost.attackCooldown = 0;
    persisted.snapshot.ghost = fixtureGhost;
    engine.restore(persisted);
    const initialRequired = engine.snapshot().ghost.attacksToNextLevel;
    expect(initialRequired).toBe(30);
    for (let index = 0; index < 200 && engine.snapshot().ghost.level === 1; index += 1) engine.tick(0.1);
    const grownGhost = engine.snapshot().ghost;
    expect(grownGhost.level).toBe(2);
    expect(grownGhost.maxHp).toBeGreaterThan(BALANCE.ghost.baseHp * .34);
    expect(grownGhost.attacksToNextLevel).toBe(46);
  });

  it('lets a level-five ghost break a repaired and shielded level-five door in under one hundred hits', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === player?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === player?.roomId);
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !room || !mapRoom || !ghost) throw new Error('missing door fixture');
    room.doorLevel = 5;
    room.doorMaxHp = 400;
    room.doorHp = 400;
    ghost.position = { ...mapRoom.door };
    ghost.targetRoomId = room.id;
    ghost.level = 5;
    ghost.phase = 5;
    ghost.attackCount = 0;
    ghost.attacksToNextLevel = 1_000;
    ghost.attackCooldown = 0;
    persisted.snapshot.ghost = ghost;
    const defensiveTiles = [...mapRoom.buildTiles].sort((a, b) => Math.hypot(a.x - mapRoom.door.x, a.y - mapRoom.door.y) - Math.hypot(b.x - mapRoom.door.x, b.y - mapRoom.door.y));
    persisted.snapshot.buildings.push(
      { id: 'max-repair', kind: 'repair-drone', roomId: room.id, ownerId: playerId, tile: defensiveTiles[0] as Tile, level: 3, cooldown: 0, hp: 100 },
      { id: 'max-shield', kind: 'shield-device', roomId: room.id, ownerId: playerId, tile: defensiveTiles[1] as Tile, level: 3, cooldown: 0, hp: 100 },
    );
    engine.restore(persisted);
    let hitCount = 0;
    for (let index = 0; index < 2_000 && engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp; index += 1) {
      engine.tick(0.05);
      hitCount += engine.drainEvents().filter((event) => event.kind === 'door-hit' && event.roomId === room.id).length;
    }
    expect(engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp).toBe(0);
    expect(hitCount).toBeLessThan(100);
    expect(buildingStats('repair-drone', 3).value).toBe(6);
  });

  it('retreats toward the respawn area below twenty percent HP', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    expect(ghost).toBeDefined();
    if (!ghost) return;
    ghost.position = { ...engine.map.playerSpawn };
    ghost.hp = ghost.maxHp * .19;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    const before = Math.hypot(ghost.position.x - engine.map.ghostSpawn.x, ghost.position.y - engine.map.ghostSpawn.y);
    engine.tick(0.1);
    const retreater = engine.snapshot().ghosts[0] as NonNullable<typeof ghost>;
    const after = Math.hypot(retreater.position.x - engine.map.ghostSpawn.x, retreater.position.y - engine.map.ghostSpawn.y);
    expect(retreater.retreating).toBe(true);
    expect(after).toBeLessThan(before);
  });

  it('lets a frost-hit ghost cross the retreat line alive and keep moving toward recovery', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing frost retreat fixture');
    ghost.position = { ...tile };
    ghost.hp = ghost.maxHp * .205;
    ghost.retreating = false;
    ghost.healing = false;
    ghost.retreatCount = 0;
    persisted.snapshot.ghost = ghost;
    persisted.snapshot.buildings.push({ id: 'frost-retreat', kind: 'frost-turret', roomId, ownerId: playerId, tile: { ...tile }, level: 1, cooldown: 0, hp: 100 });
    engine.restore(persisted);
    const before = Math.hypot(tile.x - engine.map.ghostSpawn.x, tile.y - engine.map.ghostSpawn.y);
    engine.drainEvents();
    engine.tick(0.05);
    const retreater = engine.snapshot().ghosts[0];
    const after = retreater ? Math.hypot(retreater.position.x - engine.map.ghostSpawn.x, retreater.position.y - engine.map.ghostSpawn.y) : before;
    const events = engine.drainEvents();
    expect(retreater?.hp).toBeGreaterThan(0);
    expect(retreater?.retreating).toBe(true);
    expect(retreater?.slowUntil).toBeGreaterThan(engine.snapshot().elapsed);
    expect(after).toBeLessThan(before);
    expect(events.filter((event) => event.kind === 'ghost-retreat')).toHaveLength(1);
  });

  it('heals completely for seven seconds at respawn and repeats the retreat cycle', () => {
    const { engine, ids } = setup(1, false);
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing recovery ghost');
    ghost.position = { ...engine.map.ghostSpawn };
    ghost.hp = ghost.maxHp * 0.2;
    ghost.retreating = false;
    ghost.healing = true;
    ghost.healingElapsed = 0;
    ghost.healingStartHp = ghost.hp;
    ghost.retreatCount = 1;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);

    for (let index = 0; index < 35; index += 1) engine.tick(0.1);
    const halfway = engine.snapshot().ghosts[0];
    expect(halfway?.healing).toBe(true);
    expect((halfway?.hp ?? 0) / (halfway?.maxHp ?? 1)).toBeCloseTo(0.6, 1);
    for (let index = 0; index < 34; index += 1) engine.tick(0.1);
    expect(engine.snapshot().ghosts[0]?.healing).toBe(true);
    engine.tick(0.1);
    const returned = engine.snapshot().ghosts[0];
    expect(returned?.healing).toBe(false);
    expect(returned?.hp).toBe(returned?.maxHp);

    const secondCycle = engine.serialize();
    const recurringGhost = secondCycle.snapshot.ghosts[0];
    if (!recurringGhost) throw new Error('missing recurring ghost');
    recurringGhost.position = { ...engine.map.playerSpawn };
    recurringGhost.hp = recurringGhost.maxHp * 0.2;
    recurringGhost.retreating = false;
    recurringGhost.healing = false;
    recurringGhost.targetRoomId = null;
    secondCycle.snapshot.ghost = recurringGhost;
    engine.restore(secondCycle);
    engine.tick(0.1);
    expect(engine.snapshot().ghosts[0]?.retreating).toBe(true);
    expect(engine.snapshot().ghosts[0]?.retreatCount).toBe(2);
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

  it('splits twin damage so both ghosts together equal one standard ghost attack', () => {
    let engine: GameEngine | null = null;
    for (let index = 0; index < 120; index += 1) {
      const candidate = new GameEngine(`TWIN${index}`, generateMap(70_000 + index), false);
      if (candidate.snapshot().ghosts.length === 2) {
        engine = candidate;
        break;
      }
    }
    if (!engine) throw new Error('missing deterministic twin event');
    const joined = engine.join({ nickname: 'TwinTarget', deviceId: 'twin-target-device' });
    const playerId = joined.player.id;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const door = engine.map.rooms.find((room) => room.id === roomId)?.door;
    if (!door) throw new Error('missing target door');
    const persisted = engine.serialize();
    for (const ghost of persisted.snapshot.ghosts) {
      ghost.position = { ...door };
      ghost.targetRoomId = roomId;
      ghost.attackCooldown = 0;
      ghost.path = [];
    }
    engine.restore(persisted);
    const before = engine.snapshot().rooms.find((room) => room.id === roomId)?.doorHp ?? 0;
    engine.tick(0.05);
    const after = engine.snapshot().rooms.find((room) => room.id === roomId)?.doorHp ?? 0;
    expect(before - after).toBeCloseTo(BALANCE.ghost.baseDamage, 5);
    expect(engine.drainEvents().filter((event) => event.kind === 'door-hit')).toHaveLength(2);
  });
});

describe('persistent account progression', () => {
  it('creates the complete 185-stage ladder in the requested order', () => {
    expect(STAGES).toHaveLength(185);
    expect(STAGES[0]).toMatchObject({ id: 'easy-1', label: '쉬움 1', index: 0 });
    expect(STAGES[1]).toMatchObject({ id: 'normal-1', label: '노말 1' });
    expect(STAGES[5]).toMatchObject({ id: 'normal-5', label: '노말 5' });
    expect(STAGES[6]).toMatchObject({ id: 'nightmare-1', label: '악몽 1' });
    expect(STAGES.at(-1)).toMatchObject({ id: 'legendary-99', label: '레전더리 99', index: 184 });
  });

  it('raises every core pressure curve and unlocks ghost skills by stage', () => {
    for (let index = 1; index < STAGES.length; index += 1) {
      const previous = STAGES[index - 1];
      const current = STAGES[index];
      expect(current?.hpMultiplier).toBeGreaterThan(previous?.hpMultiplier ?? 0);
      expect(current?.damageMultiplier).toBeGreaterThan(previous?.damageMultiplier ?? 0);
      expect(current?.speedMultiplier).toBeGreaterThanOrEqual(previous?.speedMultiplier ?? 0);
      expect(current?.victoryXp).toBeGreaterThan(previous?.victoryXp ?? 0);
    }
    expect(getStage('normal-5').skills).toEqual([]);
    expect(getStage('nightmare-1').skills).toContain('turret-jam');
    expect(getStage('hell-1').skills).toContain('gold-lock');
    expect(getStage('inferno-1').skills).toContain('repair-lock');
    expect(getStage('epic-1').skills).toContain('door-crush');
  });

  it('calculates separate ranks and always displays the higher rank', () => {
    expect(rankFromXp(0)).toBe('beginner');
    expect(rankFromXp(250)).toBe('intermediate');
    expect(rankFromXp(800)).toBe('expert');
    expect(rankFromXp(2_000)).toBe('master');
    expect(rankFromXp(5_000)).toBe('veteran');
    expect(rankFromXp(10_000)).toBe('legend');
    expect(higherRank('expert', 'veteran')).toBe('veteran');
    expect(higherRank('legend', 'master')).toBe('legend');
  });

  it('applies solo-rank benefits to movement, limits and the rare turret', () => {
    expect(rankBenefits('beginner').speedMultiplier).toBe(1);
    expect(rankBenefits('veteran').rareTurretUnlocked).toBe(true);
    expect(maxBuildingLevel('reinforced-door', 'expert')).toBe(15);
    expect(maxBuildingLevel('basic-turret', 'master')).toBe(16);
    expect(maxBuildingLevel('basic-turret', 'legend')).toBe(17);
    expect(upgradeCost('arc-turret', 1, 'legend').gold).toBe(175);
  });

  it('authorizes rare construction and elite join effects from server rank data', () => {
    const map = generateMap(81_281);
    const beginnerEngine = new GameEngine('BEGINNER', map, true);
    const beginner = beginnerEngine.join({ nickname: '초보생존자', deviceId: 'device-beginner', soloRank: 'beginner', multiplayerRank: 'beginner' });
    begin(beginnerEngine, beginner.player.id);
    const beginnerRoom = assigned(beginnerEngine, beginner.player.id);
    expect(beginnerEngine.build(beginner.player.id, beginnerRoom.roomId, beginnerRoom.tile, 'arc-turret').error).toContain('베테랑');

    const veteranEngine = new GameEngine('VETERAN', generateMap(81_282), true);
    const veteran = veteranEngine.join({ nickname: '고참생존자', deviceId: 'device-veteran', soloRank: 'veteran', multiplayerRank: 'master' });
    const eliteEvent = veteranEngine.drainEvents().find((event) => event.kind === 'elite-join');
    expect(eliteEvent?.label).toBe('베테랑 고참생존자님이 입장했습니다!');
    begin(veteranEngine, veteran.player.id);
    const veteranRoom = assigned(veteranEngine, veteran.player.id);
    const persisted = veteranEngine.serialize();
    const persistedPlayer = persisted.snapshot.players.find((player) => player.id === veteran.player.id);
    if (!persistedPlayer) throw new Error('missing veteran');
    persistedPlayer.gold = 1_000;
    persistedPlayer.power = 100;
    veteranEngine.restore(persisted);
    expect(veteranEngine.build(veteran.player.id, veteranRoom.roomId, veteranRoom.tile, 'arc-turret').ok).toBe(true);
  });

  it('starts the last stage with substantially stronger ghosts and active skills', () => {
    const easy = new GameEngine('EASYSTAGE', generateMap(19_001), false, { stageId: 'easy-1', playMode: 'solo' });
    const easyPlayer = easy.join({ nickname: '쉬움도전자', deviceId: 'device-easy' });
    begin(easy, easyPlayer.player.id);

    const legendary = new GameEngine('LASTSTAGE', generateMap(19_002), false, { stageId: 'legendary-99', playMode: 'solo' });
    const legendaryPlayer = legendary.join({ nickname: '신화도전자', deviceId: 'device-legendary' });
    begin(legendary, legendaryPlayer.player.id);
    expect(legendary.snapshot().ghost.maxHp).toBeGreaterThan(easy.snapshot().ghost.maxHp * 5);
    expect(legendary.snapshot().stageLabel).toBe('레전더리 99');

    const persisted = legendary.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing legendary ghost');
    ghost.skillCooldown = 0;
    persisted.snapshot.ghost = ghost;
    legendary.restore(persisted);
    legendary.tick(0.1);
    expect(legendary.drainEvents().some((event) => event.kind === 'ghost-skill')).toBe(true);
  });
});
