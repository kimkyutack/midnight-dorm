import { describe, expect, it, vi } from 'vitest';
import { BALANCE, buildingStats, goldenTurretGoldPerShot, maxBuildingLevel, upgradeCost } from '../src/shared/balance';
import { appearanceAfterCosmeticEquip, BEACH_SAND_TILE_SKIN_ID, COSMETIC_CATALOG, cosmeticAvailable, cosmeticById, customizationReward, CYBERPUNK_LASER_TURRET_SKIN_ID, CYBERPUNK_NEON_TILE_SKIN_ID, DEFAULT_APPEARANCE, DEFAULT_TILE_SKIN_ID, defaultSkinForCharacter, LIFEGUARD_PARASOL_TURRET_SKIN_ID, normalizeAppearance, STARTER_COSMETICS, SURFER_WATER_TURRET_SKIN_ID, tileSkinTextureUrl, turretSkinAssetUrl, WAVE_TILE_SKIN_ID } from '../src/shared/customization';
import { bedGoldProductionForAppearance, CHARACTER_TRAITS, characterTrait, characterTraitForAppearance, drawLimitForCharacter } from '../src/shared/characterTraits';
import { TURRET_SKIN_TRAITS, turretSkinTrait } from '../src/shared/turretSkinTraits';
import { connectedWalkableCount, generateMap, isBuildTile, isPositionOnRoomFloor, isWalkable, isWalkableArea, moveInWalkableArea, validateMap } from '../src/shared/map';
import { findPath } from '../src/shared/pathfinding';
import { getStage, higherRank, rankBadgeSymbol, rankBenefits, rankFromXp, recommendedRankForStage, RANK_VISUALS, STAGES, TIME_ATTACK_EXPIRED_MESSAGE } from '../src/shared/progression';
import { parseClientMessage } from '../src/shared/protocol';
import { SeededRandom } from '../src/shared/rng';
import { DRAW_COSTS, RANDOM_ITEMS } from '../src/shared/randomItems';
import { SHOP_CONSUMABLES } from '../src/shared/shopConsumables';
import { stageThemeFor } from '../src/shared/stageThemes';
import { DOOR_VISUALS, doorVisualForLevel } from '../src/shared/doorVisuals';
import type { ClientMessage, GameSnapshot, GhostState, PlayerState, Tile } from '../src/shared/types';
import { GameEngine, type MatchConfig } from '../src/server/engine';
import { isPlayerUnderGhostAttack } from '../src/shared/combatPresentation';
import { rankedMatchmakingTier, rankedStageForTier } from '../src/server/rankedMatch';
import { dampFacingYaw, facingDeltaForMotion, movementFacingYaw, shortestAngleDelta } from '../src/client/game/avatarMath';
import { attackFrameAt, ghostSpriteDefinition, movementFrameAt, spriteFacingFromDelta, survivorSpriteDefinition, survivorSpriteId } from '../src/client/game/AtlasSpriteActor';
import { limitLocalPredictionLead } from '../src/client/game/ThreeGameView';
import { mobileViewportCompatibilityScale } from '../src/client/viewport';
import { cosmeticPreviewLayerUrl, cosmeticProductUrl } from '../src/client/game/CosmeticAssets';
import { baseConceptUrl, skinConceptUrl, skinMovementSheetUrl, skinSleepUrl } from '../src/client/game/SkinAssets';
import { buildingAssetUrl, randomItemAssetUrl } from '../src/client/game/BuildingAssets';
import { buildingCatalogAssetUrl } from '../src/client/game/CatalogThumbnail3D';
import { GameNetwork, mergeSnapshotFrame } from '../src/client/network';
import { APP_RELEASE_VERSION, compareAppVersions, isUpdateAvailable } from '../src/shared/appUpdates';
import { botStrategyFor, decideBotIntent } from '../src/server/bots';
import { compactRealtimeEvents } from '../src/shared/realtimeEvents';

const RANKED_OPENING: NonNullable<MatchConfig['ranked']> = {
  seasonId: 'S-test',
  contractId: 'opening-hunt',
  contractNumber: 1,
  modifier: 'none',
  goldenTurretPolicy: 'disabled',
  supplyPolicy: 'disabled',
  firstRankedMatch: false,
};

function setup(
  players = 1,
  testMode = true,
  config: MatchConfig = {},
): { engine: GameEngine; ids: string[]; tokens: string[] } {
  const map = generateMap(734_901);
  const engine = new GameEngine('TESTROOM', map, testMode, config);
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
  advanceFrozenIntros(engine);
  const beds = engine.map.rooms.flatMap((room) =>
    room.beds.map((bed) => ({ roomId: room.id, bed })),
  );
  for (const [index, player] of engine.snapshot().players.entries()) {
    const target = beds[index];
    if (!target) throw new Error('not enough test beds');
    const persisted = engine.serialize();
    const candidate = persisted.snapshot.players.find(
      (entry) => entry.id === player.id,
    );
    if (!candidate) throw new Error('missing test player');
    candidate.position = { ...target.bed };
    engine.restore(persisted);
    expect(engine.interact(player.id).ok).toBe(true);
  }
  for (let index = 0; index < 400 && engine.snapshot().status === 'COUNTDOWN'; index += 1) engine.tick(0.1);
  expect(engine.snapshot().status).toBe('PLAYING');
  return engine.snapshot();
}

function advanceFrozenIntros(engine: GameEngine): void {
  // 일반전은 이벤트/귀신 포스터를, 첫 랭크전은 전용 암전 안내를 거친다.
  // Setup fixtures wait through every server-authoritative frozen phase.
  for (
    let index = 0;
    index < 130 && ['RANKED_INTRO', 'GHOST_INTRO', 'EVENT_INTRO'].includes(engine.snapshot().status);
    index += 1
  ) engine.tick(0.1);
}

function assigned(engine: GameEngine, playerId: string): { roomId: string; tile: Tile } {
  const state = engine.snapshot();
  const player = state.players.find((candidate) => candidate.id === playerId);
  const roomId = player?.roomId;
  if (!roomId) throw new Error('player does not own a room');
  const room = engine.map.rooms.find((candidate) => candidate.id === roomId);
  const tile = room?.buildTiles.find((candidate) => !state.buildings.some(
    (building) => building.tile.x === candidate.x && building.tile.y === candidate.y,
  ));
  if (!tile) throw new Error('room has no build tile');
  return { roomId, tile };
}

describe('mobile viewport compatibility', () => {
  it('normalizes only touch portrait viewports forced to desktop width', () => {
    expect(mobileViewportCompatibilityScale({
      width: 980,
      height: 2394,
      coarsePointer: true,
      maxTouchPoints: 5,
    })).toBeCloseTo(980 / 390);
    expect(mobileViewportCompatibilityScale({
      width: 390,
      height: 844,
      coarsePointer: true,
      maxTouchPoints: 5,
    })).toBeNull();
    expect(mobileViewportCompatibilityScale({
      width: 980,
      height: 2394,
      coarsePointer: false,
      maxTouchPoints: 0,
    })).toBeNull();
    expect(mobileViewportCompatibilityScale({
      width: 2394,
      height: 980,
      coarsePointer: true,
      maxTouchPoints: 5,
    })).toBeNull();
  });
});

describe('app update versioning', () => {
  it('only prompts when D1 reports a newer deployed release', () => {
    expect(isUpdateAvailable(APP_RELEASE_VERSION, APP_RELEASE_VERSION)).toBe(false);
    expect(isUpdateAvailable(APP_RELEASE_VERSION, '2026.07.29.9')).toBe(true);
    expect(isUpdateAvailable(APP_RELEASE_VERSION, '2026.07.27.4')).toBe(false);
    expect(isUpdateAvailable(APP_RELEASE_VERSION, null)).toBe(false);
    expect(compareAppVersions('2026.07.28.10', '2026.07.28.9')).toBeGreaterThan(0);
  });
});

describe('cold realtime connection failures', () => {
  it('marks a first websocket handshake error as fatal instead of starting a retry loop', () => {
    class FailingWebSocket {
      static OPEN = 1;
      static instances: FailingWebSocket[] = [];
      readonly listeners = new Map<string, Array<() => void>>();
      readyState = 0;

      constructor(readonly url: string) {
        FailingWebSocket.instances.push(this);
      }

      addEventListener(type: string, listener: () => void): void {
        const registered = this.listeners.get(type) ?? [];
        registered.push(listener);
        this.listeners.set(type, registered);
      }

      send(): void {}
      close(): void { this.readyState = 3; }
      emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
    }

    vi.stubGlobal('location', { protocol: 'https:', host: 'midnight.test' });
    vi.stubGlobal('WebSocket', FailingWebSocket as unknown as typeof WebSocket);
    try {
      const network = new GameNetwork('TESTROOM', 'Tester', 'device-test');
      const errors: Array<{ message: string; fatal?: boolean }> = [];
      const connectionStates: string[] = [];
      network.on('error', (event) => errors.push(event));
      network.on('connection', (event) => connectionStates.push(event.state));
      network.connect();
      const socket = FailingWebSocket.instances[0];
      if (!socket) throw new Error('socket was not created');
      socket.emit('error');
      expect(errors).toEqual([
        { message: '실시간 서버에 연결하지 못했습니다.', fatal: true },
      ]);
      socket.emit('close');
      expect(connectionStates).toEqual(['connecting', 'closed']);
      expect(FailingWebSocket.instances).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('realtime snapshot frames', () => {
  it('reuses unchanged buildings and accepts a later building revision', () => {
    const full = setup().engine.snapshot();
    const { buildings, ...frame } = full;
    expect(mergeSnapshotFrame(null, frame)).toBeNull();

    const first = mergeSnapshotFrame(full, {
      ...frame,
      serverSeq: frame.serverSeq + 1,
      elapsed: frame.elapsed + 0.1,
    });
    expect(first?.buildings).toBe(full.buildings);
    expect(first?.serverSeq).toBe(frame.serverSeq + 1);

    const revisedBuildings = buildings.map((building, index) =>
      index === 0 ? { ...building, level: building.level + 1 } : building
    );
    const revised = mergeSnapshotFrame(first, {
      ...frame,
      serverSeq: frame.serverSeq + 2,
    }, revisedBuildings);
    expect(revised?.buildings).toBe(revisedBuildings);
  });

  it('keeps only the latest visual shot from each turret per network frame', () => {
    const compacted = compactRealtimeEvents([
      { kind: 'turret-fire', sourceId: 'turret-a', amount: 1 },
      { kind: 'door-hit', amount: 7 },
      { kind: 'turret-fire', sourceId: 'turret-b', amount: 2 },
      { kind: 'turret-fire', sourceId: 'turret-a', amount: 3 },
    ]);
    expect(compacted).toEqual([
      { kind: 'door-hit', amount: 7 },
      { kind: 'turret-fire', sourceId: 'turret-b', amount: 2 },
      { kind: 'turret-fire', sourceId: 'turret-a', amount: 3 },
    ]);
  });
});

describe('dense-match performance safety', () => {
  it('keeps a long high-level turret and multi-ghost simulation finite and bounded', () => {
    const { engine, ids } = setup(4);
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    const buildings = persisted.snapshot.rooms.flatMap((roomState) => {
      const ownerId = roomState.ownerIds[0];
      const room = engine.map.rooms.find(
        (candidate) => candidate.id === roomState.id,
      );
      if (!ownerId || !room) return [];
      return room.buildTiles.map((tile, index) => ({
        id: `stress-${room.id}-${index}`,
        kind: 'basic-turret' as const,
        roomId: room.id,
        ownerId,
        skinId: CYBERPUNK_LASER_TURRET_SKIN_ID,
        tile: { ...tile },
        level: 15,
        effectiveLevel: 15,
        cooldown: 0,
        hp: 100,
      }));
    });
    persisted.snapshot.buildings = buildings;
    for (const room of persisted.snapshot.rooms) {
      room.doorHp = 1_000_000_000;
      room.doorMaxHp = 1_000_000_000;
    }
    const primary = persisted.snapshot.ghost;
    const corridor = engine.map.corridorTiles;
    persisted.snapshot.ghosts = Array.from({ length: 24 }, (_, index) => ({
      ...primary,
      id: `stress-ghost-${index}`,
      position: {
        ...(corridor[index % Math.max(1, corridor.length)] ??
          primary.position),
      },
      hp: 1_000_000_000,
      maxHp: 1_000_000_000,
      targetRoomId: null,
      targetPlayerId: null,
      attackCooldown: 0,
      retreating: false,
      healing: false,
    }));
    persisted.snapshot.ghost = persisted.snapshot.ghosts[0] as GhostState;
    engine.restore(persisted);
    // Ignore countdown/economy events accumulated while preparing the
    // fixture. Measurements below model the 10 Hz realtime drain cadence.
    engine.drainEvents();

    const startedAt = performance.now();
    let largestCompactedBatch = 0;
    let largestBatchKinds: Record<string, number> = {};
    for (let tick = 0; tick < 2_400; tick += 1) {
      engine.tick(0.05);
      if (tick % 2 !== 1) continue;
      const compacted = compactRealtimeEvents(engine.drainEvents());
      if (compacted.length > largestCompactedBatch) {
        largestCompactedBatch = compacted.length;
        largestBatchKinds = compacted.reduce<Record<string, number>>(
          (counts, event) => {
            counts[event.kind] = (counts[event.kind] ?? 0) + 1;
            return counts;
          },
          {},
        );
      }
    }
    const duration = performance.now() - startedAt;
    const state = engine.snapshot();

    expect(duration).toBeLessThan(7_000);
    expect(state.status).toBe('PLAYING');
    expect(state.buildings).toHaveLength(buildings.length);
    expect(
      largestCompactedBatch,
      JSON.stringify(largestBatchKinds),
    ).toBeLessThanOrEqual(buildings.length + 96);
    expect(
      state.players.every(
        (player) =>
          Number.isFinite(player.position.x) &&
          Number.isFinite(player.position.y) &&
          Number.isFinite(player.gold) &&
          Number.isFinite(player.power),
      ),
    ).toBe(true);
    expect(
      state.ghosts.every(
        (ghost) =>
          Number.isFinite(ghost.position.x) &&
          Number.isFinite(ghost.position.y) &&
          Number.isFinite(ghost.hp) &&
          Number.isFinite(ghost.attackCooldown),
      ),
    ).toBe(true);
    expect(
      state.buildings.every(
        (building) =>
          Number.isFinite(building.cooldown) && Number.isFinite(building.hp),
      ),
    ).toBe(true);
  });
});

describe('combat presentation', () => {
  it('keeps a teammate HUD card red while an active ghost targets that player or room', () => {
    const player = {
      id: 'player-2',
      alive: true,
      roomId: 'room-2',
    } as PlayerState;
    const ghost = {
      hp: 100,
      retreating: false,
      healing: false,
      targetPlayerId: null,
      targetRoomId: 'room-2',
    } as GhostState;

    expect(isPlayerUnderGhostAttack(player, [ghost])).toBe(true);

    ghost.targetRoomId = null;
    ghost.targetPlayerId = player.id;
    expect(isPlayerUnderGhostAttack(player, [ghost])).toBe(true);

    ghost.retreating = true;
    expect(isPlayerUnderGhostAttack(player, [ghost])).toBe(false);

    ghost.retreating = false;
    ghost.targetPlayerId = null;
    ghost.targetRoomId = 'room-3';
    expect(isPlayerUnderGhostAttack(player, [ghost])).toBe(false);
  });
});

describe('deterministic shared world', () => {
  it('keeps predicting a held drag while a bot claim frame has not acknowledged its latest input', () => {
    const authoritative = { x: 5, y: 5 };
    const input = { x: 1, y: 0 };
    let rendered = { x: 7.55, y: 5 };
    for (let frame = 0; frame < 12; frame += 1) {
      const next = limitLocalPredictionLead(
        rendered,
        { x: rendered.x + 0.1, y: rendered.y },
        authoritative,
        input,
        2.6,
        8,
        7,
      );
      expect(next.x).toBeGreaterThan(rendered.x);
      rendered = next;
    }
    expect(rendered.x).toBeCloseTo(8.75);
  });

  it('does not freeze a held drag when an acknowledged bot-claim frame still trails the player', () => {
    const authoritative = { x: 5, y: 5 };
    const input = { x: 1, y: 0 };
    const rendered = { x: 7.55, y: 5 };
    const next = limitLocalPredictionLead(
      rendered,
      { x: rendered.x + 0.1, y: rendered.y },
      authoritative,
      input,
      2.6,
      8,
      8,
    );
    expect(next.x).toBeGreaterThan(rendered.x);
    expect(next.x).toBeCloseTo(7.65);
  });

  it('treats every rounded point inside a room floor tile as room interior', () => {
    const room = {
      floorTiles: [{ x: 5, y: 5 }],
    };
    expect(isPositionOnRoomFloor(room, { x: 5.49, y: 5.49 })).toBe(true);
    expect(isPositionOnRoomFloor(room, { x: 5.51, y: 5.49 })).toBe(false);
  });

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
    expect(stageThemeFor('calamity-1').id).toBe('void');
    expect(stageThemeFor('cataclysm-1').id).toBe('void');
    expect(stageThemeFor('ruin-1').id).toBe('void');
    expect(stageThemeFor('apocalypse-99').id).toBe('void');
    const assets = ['easy-1', 'nightmare-1', 'hell-1', 'inferno-1', 'epic-1', 'mythic-1', 'legendary-1']
      .map((stage) => {
        const theme = stageThemeFor(stage);
        return `${theme.corridorAsset}:${theme.roomAsset}:${theme.wallAsset}`;
      });
    expect(new Set(assets).size).toBe(assets.length);
  });

  it('defines a badge and evolving hat identity for all nine ranks', () => {
    const ranks = [
      'beginner',
      'intermediate',
      'expert',
      'master',
      'veteran',
      'legend',
      'transcendent',
      'immortal',
      'absolute',
    ] as const;
    expect(new Set(ranks.map((rank) => rankBadgeSymbol(rank))).size).toBe(ranks.length);
    expect(ranks.every((rank) => RANK_VISUALS[rank].hatLabel.length > 0)).toBe(true);
  });

  it('defines ten ordered door materials and holds the last material for future extension levels', () => {
    expect(DOOR_VISUALS.map((door) => door.label)).toEqual([
      '나무 문', '녹슨 강철문', '빛바랜 강철문', '빨간 강철문', '단단한 철창',
      '빛나는 철창', '강철 티타늄', '은빛 티타늄', '금빛 티타늄', '다이아 티타늄',
    ]);
    expect(doorVisualForLevel(11).label).toBe('다이아 티타늄');
  });

  it('generates the same seeded eight-room ward with eight recovery pads', () => {
    const first = generateMap(123_456);
    const second = generateMap(123_456);
    expect(first).toEqual(second);
    expect(validateMap(first)).toBe(true);
    expect(connectedWalkableCount(first)).toBe(first.walkable.length);
    expect(first.rooms).toHaveLength(8);
    expect(first.respawnZones).toHaveLength(8);
    expect(new Set(first.respawnZones.map((zone) => `${zone.x},${zone.y}`))).toHaveLength(8);
    expect(first.respawnZones.every((zone) =>
      zone.x === 0 || zone.y === 0 || zone.x === first.width - 1 || zone.y === first.height - 1,
    )).toBe(true);
    expect(new Set(first.respawnZones.map((zone) => `${zone.x},${zone.y}`))).toEqual(new Set([
      '1,0', `${Math.floor(first.width / 2)},0`, `${first.width - 2},0`,
      `${first.width - 1},${Math.floor(first.height / 2)}`,
      `${first.width - 2},${first.height - 1}`, `${Math.floor(first.width / 2)},${first.height - 1}`,
      `1,${first.height - 1}`, `0,${Math.floor(first.height / 2)}`,
    ]));
    expect([first.width, first.height]).toEqual([39, 25]);
    expect(first.rooms.every((room) => room.floorTiles.length >= 20 && room.floorTiles.length <= 30)).toBe(true);
    expect(new Set(first.rooms.map((room) => room.floorTiles.length))).toHaveLength(8);
    expect(first.rooms.every((room) => room.buildTiles.length === room.floorTiles.length - 1)).toBe(true);
    expect(new Set(first.rooms.map((room) => room.shape)).size).toBe(8);
    const placedTiles = [
      ...first.corridorTiles,
      ...first.rooms.flatMap((room) => room.floorTiles),
      ...first.walls,
    ];
    expect(new Set(placedTiles.map((tile) => `${tile.x},${tile.y}`))).toHaveLength(placedTiles.length);
    // Every non-room interior cell is an open corridor.  This keeps the map
    // free of isolated one-tile walls that interrupted touch movement.
    expect(placedTiles.length).toBe(first.width * first.height);
  });

  it('varies room silhouettes, positions and corridor routes across match seeds', () => {
    const maps = Array.from({ length: 16 }, (_, index) => generateMap(41_000 + index));
    const layouts = new Set(maps.map((map) => map.rooms
      .map((room) => `${room.shape}:${room.bounds.x},${room.bounds.y}:${room.door.x},${room.door.y}`)
      .join('|')));
    const corridorLayouts = new Set(maps.map((map) =>
      map.corridorTiles.map((tile) => `${tile.x},${tile.y}`).sort().join('|'),
    ));
    expect(layouts.size).toBeGreaterThan(12);
    expect(corridorLayouts.size).toBeGreaterThan(12);
    for (const map of maps) {
      expect(validateMap(map)).toBe(true);
      expect(new Set(map.rooms.map((room) => room.shape)).size).toBe(8);
      for (const room of map.rooms) {
        const path = findPath(map, map.playerSpawn, room.bed);
        expect(path.some(
          (tile) => tile.x === room.door.x && tile.y === room.door.y,
        )).toBe(true);
      }
    }
  }, 15_000);

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

  it('keeps collision-radius movement out of adjacent wall cells', () => {
    const map = generateMap(4_204);
    const wall = map.walls.find((candidate) =>
      isWalkable(map, candidate.x - 1, candidate.y) ||
      isWalkable(map, candidate.x + 1, candidate.y) ||
      isWalkable(map, candidate.x, candidate.y - 1) ||
      isWalkable(map, candidate.x, candidate.y + 1),
    );
    expect(wall).toBeDefined();
    expect(isWalkableArea(map, wall!.x, wall!.y, BALANCE.player.collisionRadius)).toBe(false);
    expect(isWalkableArea(map, wall!.x - 0.49, wall!.y, BALANCE.player.collisionRadius)).toBe(false);
  });

  it('substeps large movement deltas so players cannot tunnel through a wall', () => {
    const map = generateMap(4_204);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const candidate = map.walkable.flatMap((tile) => directions.map(([dx, dy]) => ({ tile, dx, dy })))
      .find(({ tile, dx, dy }) => map.walls.some((wall) => wall.x === tile.x + dx && wall.y === tile.y + dy));
    expect(candidate).toBeDefined();
    const start = candidate!.tile;
    const moved = moveInWalkableArea(map, start, {
      x: candidate!.dx * 2.2,
      y: candidate!.dy * 2.2,
    }, BALANCE.player.collisionRadius);
    expect(isWalkableArea(map, moved.x, moved.y, BALANCE.player.collisionRadius)).toBe(true);
    expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeLessThan(0.5);
  });

  it('creates eight varied multiplayer rooms with two beds each', () => {
    const map = generateMap(7_707, 'multiplayer');
    expect(validateMap(map)).toBe(true);
    expect(map.playMode).toBe('multiplayer');
    expect(map.rooms).toHaveLength(8);
    expect(map.rooms.every((room) => room.floorTiles.length >= 20 && room.floorTiles.length <= 30)).toBe(true);
    expect(map.rooms.every((room) => room.beds.length === 2 && room.buildTiles.length === room.floorTiles.length - 2)).toBe(true);
  });
});

describe('generated mobile game art', () => {
  it('maps every guardian turret level to its own crisp tile-safe image', () => {
    const assets = Array.from({ length: 15 }, (_, index) =>
      buildingAssetUrl('basic-turret', index + 1),
    );
    expect(assets.every((asset): asset is string => Boolean(asset))).toBe(true);
    expect(new Set(assets).size).toBe(15);
  });

  it('maps every surfer water turret level to its own authored image', () => {
    const assets = Array.from({ length: 15 }, (_, index) =>
      buildingAssetUrl(
        'basic-turret',
        index + 1,
        undefined,
        SURFER_WATER_TURRET_SKIN_ID,
      ),
    );
    expect(assets.every((asset): asset is string => Boolean(asset))).toBe(true);
    expect(new Set(assets).size).toBe(15);
    expect(turretSkinAssetUrl(SURFER_WATER_TURRET_SKIN_ID, 1)).toBe(
      '/assets/turret-skins/skin-surfer-water-blaster/level-01.png',
    );
    expect(turretSkinAssetUrl(SURFER_WATER_TURRET_SKIN_ID, 99)).toBe(
      '/assets/turret-skins/skin-surfer-water-blaster/level-15.png',
    );
  });

  it('maps the lifeguard parasol through 15 authored silhouettes', () => {
    const assets = Array.from({ length: 15 }, (_, index) =>
      buildingAssetUrl(
        'basic-turret',
        index + 1,
        undefined,
        LIFEGUARD_PARASOL_TURRET_SKIN_ID,
      ),
    );
    expect(assets.every((asset): asset is string => Boolean(asset))).toBe(true);
    expect(new Set(assets).size).toBe(15);
    expect(turretSkinAssetUrl(LIFEGUARD_PARASOL_TURRET_SKIN_ID, 1)).toBe(
      '/assets/turret-skins/skin-lifeguard-parasol/level-01.png',
    );
    expect(turretSkinAssetUrl(LIFEGUARD_PARASOL_TURRET_SKIN_ID, 15)).toBe(
      '/assets/turret-skins/skin-lifeguard-parasol/level-15.png',
    );
  });

  it('uses the equipped guardian skin in the in-game installation catalog', () => {
    expect(
      buildingCatalogAssetUrl('basic-turret', {
        'basic-turret': LIFEGUARD_PARASOL_TURRET_SKIN_ID,
        'rapid-turret': 'turret-rapid-firefly',
        'frost-turret': 'turret-frost-snow',
        'arc-turret': 'turret-arc-storm',
      }),
    ).toContain(
      '/assets/turret-skins/skin-lifeguard-parasol/level-01.png',
    );
  });

  it('maps every moonlight generator level to its own crisp tile-safe image', () => {
    const assets = Array.from({ length: 10 }, (_, index) =>
      buildingAssetUrl('generator', index + 1),
    );
    expect(assets.every((asset): asset is string => Boolean(asset))).toBe(true);
    expect(new Set(assets).size).toBe(10);
  });

  it('maps every golden judgment turret level to its own in-world image', () => {
    const assets = Array.from({ length: 10 }, (_, index) =>
      buildingAssetUrl('golden-turret', index + 1),
    );
    expect(assets.every((asset): asset is string => Boolean(asset))).toBe(true);
    expect(new Set(assets).size).toBe(10);
  });

  it('gives every random box result its own in-world image', () => {
    const assets = RANDOM_ITEMS.map((item) => randomItemAssetUrl(item.id));
    expect(assets.every((asset) => asset.includes('/assets/items/rewards/'))).toBe(true);
    expect(new Set(assets).size).toBe(RANDOM_ITEMS.length);
    expect(buildingAssetUrl('gem-core', 1, 'moon-gem-reward')).toBe(
      randomItemAssetUrl('moon-gem-reward'),
    );
  });

  it('uses the cute, tile-filling art set for every installable building family', () => {
    const kinds = [
      'basic-turret', 'generator', 'repair-drone', 'electric-coil',
      'shield-device', 'gem-core', 'range-amplifier',
      'frost-turret', 'lucky-machine', 'ghost-net', 'starter-grave',
    ] as const;
    expect(kinds.map((kind) => buildingAssetUrl(kind))).toEqual(
      expect.arrayContaining(
        kinds.map((kind) =>
          expect.stringContaining(`cute-${kind === 'frost-turret' ? 'frost-spray' : kind}`),
        ),
      ),
    );
  });

  it('maps each stage theme to distinct corridor, room, and wall material sets', () => {
    const stages = ['easy-1', 'nightmare-1', 'hell-1', 'inferno-1', 'epic-1', 'mythic-1', 'legendary-1'];
    const assets = stages.flatMap((stage) => {
      const definition = stageThemeFor(stage);
      return [definition.corridorAsset, definition.roomAsset, definition.wallAsset];
    });
    expect(new Set(assets).size).toBe(assets.length);
  });
});

describe('survivor customization rules', () => {
  it('uses neutral base atlases by default and complete atlases only for selected skins', () => {
    expect(skinMovementSheetUrl(DEFAULT_APPEARANCE))
      .toBe('/assets/paperdoll/bases/character-bunny/movement-sheet.png');
    expect(skinConceptUrl(DEFAULT_APPEARANCE.skin)).toBeUndefined();
    expect(skinSleepUrl(DEFAULT_APPEARANCE))
      .toBe('/assets/paperdoll/bases/character-bunny/sleep.png');

    const skinAppearance = { character: 'character-bunny', skin: 'skin-look-bunny-ward' };
    expect(skinMovementSheetUrl(skinAppearance))
      .toBe('/assets/sprites/survivors/character-bunny/movement-sheet.png');
    expect(skinConceptUrl(skinAppearance.skin))
      .toBe('/assets/sprites/survivors/character-bunny/concept.png');

    const surferAppearance = { character: 'character-puppy', skin: 'skin-look-puppy-surfer' };
    expect(skinMovementSheetUrl(surferAppearance))
      .toBe('/assets/sprites/skins/skin-surfer-mong/movement-sheet.png');
    expect(skinSleepUrl(surferAppearance))
      .toBe('/assets/sprites/skins/skin-surfer-mong/sleep.png');
    const lifeguardAppearance = { character: 'character-tiger', skin: 'skin-look-tiger-lifeguard' };
    expect(skinMovementSheetUrl(lifeguardAppearance))
      .toBe('/assets/sprites/skins/skin-lifeguard-raon/movement-sheet.png');
    expect(skinSleepUrl(lifeguardAppearance))
      .toBe('/assets/sprites/skins/skin-lifeguard-raon/sleep.png');
    const neonLuluAppearance = { character: 'character-cat', skin: 'skin-look-cat-neon-rider' };
    expect(skinMovementSheetUrl(neonLuluAppearance))
      .toBe('/assets/sprites/skins/skin-neon-rider-lulu/movement-sheet.png');
    expect(skinSleepUrl(neonLuluAppearance))
      .toBe('/assets/sprites/skins/skin-neon-rider-lulu/sleep.png');
    const cyberKongAppearance = { character: 'character-hamster', skin: 'skin-look-hamster-cyber-driver' };
    expect(skinMovementSheetUrl(cyberKongAppearance))
      .toBe('/assets/sprites/skins/skin-cyber-driver-kong/movement-sheet.png');
    expect(skinSleepUrl(cyberKongAppearance))
      .toBe('/assets/sprites/skins/skin-cyber-driver-kong/sleep.png');
  });

  it('selects the correct 2D atlas row and mirrored side for movement', () => {
    expect(spriteFacingFromDelta(0, 1)).toEqual({ direction: 'front', mirrored: false });
    expect(spriteFacingFromDelta(0, -1)).toEqual({ direction: 'back', mirrored: false });
    expect(spriteFacingFromDelta(1, 0)).toEqual({ direction: 'side', mirrored: false });
    expect(spriteFacingFromDelta(-1, 0)).toEqual({ direction: 'side', mirrored: true });
    expect(spriteFacingFromDelta(0, 0, { direction: 'side', mirrored: true })).toEqual({ direction: 'side', mirrored: true });
  });

  it('uses anchored footstep frames and three attack frames without invalid indices', () => {
    expect(movementFrameAt(0, false)).toBe(0);
    expect(movementFrameAt(0, true)).toBe(0);
    expect(movementFrameAt(260, true)).toBe(1);
    expect(movementFrameAt(780, true)).toBe(3);
    expect(attackFrameAt(0, 480)).toBe(0);
    expect(attackFrameAt(240, 480)).toBe(1);
    expect(attackFrameAt(480, 480)).toBe(2);
    expect(survivorSpriteId('unknown-character')).toBe('character-bunny');
  });

  it('keeps independently authored ghost movement and attack side rows facing their targets', () => {
    expect(ghostSpriteDefinition('wanderer').movementSideFacesLeft).toBe(true);
    expect(ghostSpriteDefinition('wanderer').attackSideFacesLeft).toBe(true);
    expect(ghostSpriteDefinition('brute').movementSideFacesLeft).toBe(true);
    expect(ghostSpriteDefinition('brute').attackSideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('twin-a').movementSideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('twin-a').attackSideFacesLeft).toBe(true);
    expect(ghostSpriteDefinition('twin-b').movementSideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('twin-b').attackSideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('caster').movementSideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('undead').movementSideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('swift').movementUrl)
      .toBe('/assets/sprites/ghosts/swift/movement-sheet.png?v=ghost-atlas-v5');
    expect(ghostSpriteDefinition('swift').attackUrl)
      .toBe('/assets/sprites/ghosts/swift/attack-sheet.png?v=ghost-atlas-v5');
    for (const variant of ['wanderer', 'swift', 'brute', 'caster', 'twin-a', 'twin-b', 'teleporter', 'undead', 'giant', 'demolisher', 'wallpaper'] as const) {
      expect(ghostSpriteDefinition(variant).attackUrl)
        .toBe(`/assets/sprites/ghosts/${variant}/attack-sheet.png?v=ghost-atlas-v5`);
    }
    expect(ghostSpriteDefinition('demolisher').skillPrepareUrl)
      .toBe('/assets/sprites/ghosts/demolisher/skill-prepare-sheet.png?v=ghost-atlas-v5');
    expect(ghostSpriteDefinition('demolisher').skillCastUrl)
      .toBe('/assets/sprites/ghosts/demolisher/skill-cast-sheet.png?v=ghost-atlas-v5');
    expect(ghostSpriteDefinition('wallpaper').skillPrepareUrl)
      .toBe('/assets/sprites/ghosts/wallpaper/skill-prepare-sheet.png?v=ghost-atlas-v5');
    expect(ghostSpriteDefinition('wallpaper').skillCastUrl)
      .toBe('/assets/sprites/ghosts/wallpaper/skill-cast-sheet.png?v=ghost-atlas-v5');
    expect(survivorSpriteDefinition(DEFAULT_APPEARANCE).sleepUrl).toBe('/assets/paperdoll/bases/character-bunny/sleep.png');
  });

  it('rotates the -Z-facing avatar toward movement instead of walking backward', () => {
    expect(movementFacingYaw(0, -1)).toBeCloseTo(0);
    expect(Math.abs(movementFacingYaw(0, 1))).toBeCloseTo(Math.PI);
    expect(movementFacingYaw(1, 0)).toBeCloseTo(-Math.PI / 2);
    expect(movementFacingYaw(-1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('keeps the visual facing on held input while an old snapshot corrects backwards', () => {
    expect(facingDeltaForMotion(-0.08, 0, { x: 1, y: 0 })).toEqual({ x: 1, z: 0 });
    expect(facingDeltaForMotion(0.12, -0.05)).toEqual({ x: 0.12, z: -0.05 });
  });

  it('keeps rotating in the same short direction across the 180-degree seam', () => {
    const clockwiseStart = Math.PI - 0.05;
    const clockwiseTarget = -Math.PI + 0.05;
    const clockwiseNext = dampFacingYaw(clockwiseStart, clockwiseTarget, 12, 1 / 60);
    expect(clockwiseNext).toBeGreaterThan(clockwiseStart);
    expect(Math.abs(shortestAngleDelta(clockwiseNext, clockwiseTarget)))
      .toBeLessThan(Math.abs(shortestAngleDelta(clockwiseStart, clockwiseTarget)));

    const counterClockwiseStart = -Math.PI + 0.05;
    const counterClockwiseTarget = Math.PI - 0.05;
    const counterClockwiseNext = dampFacingYaw(counterClockwiseStart, counterClockwiseTarget, 12, 1 / 60);
    expect(counterClockwiseNext).toBeLessThan(counterClockwiseStart);
    expect(Math.abs(shortestAngleDelta(counterClockwiseNext, counterClockwiseTarget)))
      .toBeLessThan(Math.abs(shortestAngleDelta(counterClockwiseStart, counterClockwiseTarget)));

    let continuousYaw = 0;
    for (let step = 1; step <= 48; step += 1) {
      const angle = (step / 48) * Math.PI * 2;
      const wrappedTarget = movementFacingYaw(-Math.sin(angle), -Math.cos(angle));
      const nextYaw = dampFacingYaw(continuousYaw, wrappedTarget, 12, 1 / 30);
      expect(nextYaw).toBeGreaterThan(continuousYaw);
      expect(nextYaw - continuousYaw).toBeLessThan(Math.PI / 2);
      continuousYaw = nextYaw;
    }
  });

  it('defines characters, complete skins, tile skins, and turret skins without equipment slots', () => {
    expect(COSMETIC_CATALOG).toHaveLength(47);
    expect(new Set(COSMETIC_CATALOG.map((item) => item.slot))).toEqual(
      new Set(['character', 'skin', 'tile', 'turret']),
    );
    expect(STARTER_COSMETICS).toContain(DEFAULT_APPEARANCE.character);
    expect(STARTER_COSMETICS).toContain(DEFAULT_TILE_SKIN_ID);
    expect(STARTER_COSMETICS).not.toContain(DEFAULT_APPEARANCE.skin);
    expect(COSMETIC_CATALOG.filter((item) => item.slot === 'skin')).toHaveLength(16);
    expect(COSMETIC_CATALOG.filter((item) => item.slot === 'tile')).toHaveLength(4);
    expect(defaultSkinForCharacter('character-fox')).toBe('skin-basic-fox');
  });

  it('resolves the wave floor tile as a standalone point cosmetic', () => {
    expect(cosmeticById(WAVE_TILE_SKIN_ID)).toMatchObject({
      slot: 'tile',
      label: '파도 타일',
      unlock: { kind: 'points', price: 1_000 },
    });
    expect(tileSkinTextureUrl(WAVE_TILE_SKIN_ID)).toBe('/assets/tiles/skin-wave/wave-tile.webp');
    expect(tileSkinTextureUrl(DEFAULT_TILE_SKIN_ID)).toBeUndefined();
  });

  it('sells the lifeguard beach tile with its own center-out transition asset', () => {
    expect(cosmeticById(BEACH_SAND_TILE_SKIN_ID)).toMatchObject({
      slot: 'tile',
      label: '모래사장 타일',
      unlock: { kind: 'points', price: 1_000 },
    });
    expect(tileSkinTextureUrl(BEACH_SAND_TILE_SKIN_ID)).toBe(
      '/assets/tiles/skin-beach-sand/sand-tile.webp',
    );
  });

  it('sells the cyberpunk tile with its own neon-collapse transition asset', () => {
    expect(cosmeticById(CYBERPUNK_NEON_TILE_SKIN_ID)).toMatchObject({
      slot: 'tile',
      label: '네온 회로 타일',
      unlock: { kind: 'points', price: 1_000 },
    });
    expect(tileSkinTextureUrl(CYBERPUNK_NEON_TILE_SKIN_ID)).toBe(
      '/assets/tiles/skin-cyberpunk-neon/neon-circuit-tile.webp',
    );
  });

  it('sells the surfer water turret as a neutral 1,500 point cosmetic', () => {
    expect(cosmeticById(SURFER_WATER_TURRET_SKIN_ID)).toMatchObject({
      slot: 'turret',
      turretKind: 'basic-turret',
      label: '서퍼 물총포',
      unlock: { kind: 'points', price: 1_500 },
    });
    expect(turretSkinTrait(SURFER_WATER_TURRET_SKIN_ID)).toMatchObject({
      turretKind: 'basic-turret',
      damageMultiplier: 1,
      rateMultiplier: 1,
      frostSlowStrengthMultiplier: 1,
    });
  });

  it('sells the lifeguard parasol turret as a neutral 1,500 point cosmetic', () => {
    expect(cosmeticById(LIFEGUARD_PARASOL_TURRET_SKIN_ID)).toMatchObject({
      slot: 'turret',
      turretKind: 'basic-turret',
      label: '파라솔 포탑',
      unlock: { kind: 'points', price: 1_500 },
    });
    expect(turretSkinTrait(LIFEGUARD_PARASOL_TURRET_SKIN_ID)).toMatchObject({
      turretKind: 'basic-turret',
      damageMultiplier: 1,
      rateMultiplier: 1,
      frostSlowStrengthMultiplier: 1,
    });
  });

  it('sells the cyberpunk laser turret as a neutral 15-level cosmetic', () => {
    expect(cosmeticById(CYBERPUNK_LASER_TURRET_SKIN_ID)).toMatchObject({
      slot: 'turret',
      turretKind: 'basic-turret',
      label: '네온 레이저포',
      unlock: { kind: 'points', price: 1_500 },
    });
    expect(turretSkinTrait(CYBERPUNK_LASER_TURRET_SKIN_ID)).toMatchObject({
      turretKind: 'basic-turret',
      damageMultiplier: 1,
      rateMultiplier: 1,
      frostSlowStrengthMultiplier: 1,
    });
    expect(turretSkinAssetUrl(CYBERPUNK_LASER_TURRET_SKIN_ID, 1)).toBe(
      '/assets/turret-skins/skin-cyberpunk-laser/level-01.png',
    );
    expect(turretSkinAssetUrl(CYBERPUNK_LASER_TURRET_SKIN_ID, 15)).toBe(
      '/assets/turret-skins/skin-cyberpunk-laser/level-15.png',
    );
  });

  it('uses base concept art for characters and complete art only for skin cards', () => {
    expect(baseConceptUrl('character-bunny')).toBe('/assets/paperdoll/bases/character-bunny/concept.png');
    expect(cosmeticProductUrl('skin-look-bunny-ward')).toBe('/assets/sprites/survivors/character-bunny/concept.png');
    expect(cosmeticProductUrl('skin-look-puppy-surfer')).toBe('/assets/sprites/skins/skin-surfer-mong/concept.png');
    expect(cosmeticProductUrl('skin-look-tiger-lifeguard')).toBe('/assets/sprites/skins/skin-lifeguard-raon/concept.png');
    expect(cosmeticProductUrl('skin-look-cat-neon-rider')).toBe('/assets/sprites/skins/skin-neon-rider-lulu/concept.png');
    expect(cosmeticProductUrl('skin-look-hamster-cyber-driver')).toBe('/assets/sprites/skins/skin-cyber-driver-kong/concept.png');
    expect(cosmeticPreviewLayerUrl('skin-look-bunny-ward')).toBe('/assets/sprites/survivors/character-bunny/concept.png');
    expect(cosmeticProductUrl('character-bunny')).toBeUndefined();
    expect(cosmeticProductUrl('hat-beanie')).toBeUndefined();
    expect(cosmeticProductUrl('missing-item')).toBeUndefined();
  });

  it('gives every non-default survivor exactly one distinct gameplay trait', () => {
    const characters = COSMETIC_CATALOG.filter((item) => item.slot === 'character');
    expect(characterTrait('character-bunny').id).toBe('none');
    const special = characters
      .filter((item) => item.id !== 'character-bunny')
      .map((item) => CHARACTER_TRAITS[item.id]);
    expect(special.every((trait) => trait && trait.id !== 'none')).toBe(true);
    expect(new Set(special.map((trait) => trait?.id)).size).toBe(special.length);
    expect(characterTrait('character-bear').turretDamageMultiplier).toBe(1.1);
    expect(characterTrait('character-cat').turretRateMultiplier).toBeCloseTo(1 / 1.15, 6);
    expect(characterTrait('character-puppy').goldPerSecond).toBe(1);
    expect(drawLimitForCharacter('character-fox')).toBe(5);
    expect(characterTrait('character-hamster').firstGuardianLevelBonus).toBe(1);
    expect(characterTrait('character-crocodile').turretDamageMultiplier).toBe(1.35);
    expect(characterTrait('character-duck').powerPerSecond).toBe(1);
    expect(characterTrait('character-tiger').turretRangeBonus).toBe(1);
    expect(characterTrait('character-dinosaur').turretRateMultiplier).toBeCloseTo(1 / 1.4, 6);
    expect(drawLimitForCharacter('character-monkey')).toBe(6);
    expect(characterTrait('character-gorilla').doorShieldRatio).toBe(0.5);
  });

  it('gives every purchased turret skin a matching server combat trait', () => {
    const turretSkins = COSMETIC_CATALOG.filter((item) => item.slot === 'turret');
    expect(turretSkins.every((item) => Boolean(TURRET_SKIN_TRAITS[item.id]))).toBe(true);
    expect(turretSkinTrait('turret-basic-ward').damageMultiplier).toBe(1);
    expect(turretSkinTrait('turret-basic-toy').damageMultiplier).toBe(1.08);
    expect(turretSkinTrait('turret-basic-pumpkin').damageMultiplier).toBe(1.18);
    expect(turretSkinTrait('turret-rapid-dragon').rateMultiplier).toBeCloseTo(1 / 1.22, 6);
    expect(turretSkinTrait('turret-frost-crystal').frostSlowStrengthMultiplier).toBe(1.5);
    expect(turretSkinTrait('turret-arc-crown').damageMultiplier).toBe(1.28);
  });

  it('separates starter, point-purchased, and rank-unlocked cosmetics', () => {
    const starter = cosmeticById('character-bunny');
    const pointItem = cosmeticById('character-cat');
    const rankItem = cosmeticById('character-bear');
    expect(starter && cosmeticAvailable(starter, 'beginner', [])).toBe(true);
    expect(pointItem && cosmeticAvailable(pointItem, 'legend', [])).toBe(false);
    expect(pointItem && cosmeticAvailable(pointItem, 'beginner', ['character-cat'])).toBe(true);
    expect(rankItem && cosmeticAvailable(rankItem, 'intermediate', [])).toBe(false);
    expect(rankItem && cosmeticAvailable(rankItem, 'expert', [])).toBe(true);
    const catSkin = cosmeticById('skin-look-cat-ward');
    expect(catSkin && cosmeticAvailable(catSkin, 'beginner', [])).toBe(false);
    expect(catSkin && cosmeticAvailable(catSkin, 'beginner', ['character-cat'])).toBe(false);
    expect(catSkin && cosmeticAvailable(catSkin, 'beginner', ['character-cat', 'skin-look-cat-ward'])).toBe(true);
    const explorerSkin = cosmeticById('skin-look-bunny-ward');
    expect(explorerSkin?.unlock).toEqual({ kind: 'points', price: 100 });
    const surferSkin = cosmeticById('skin-look-puppy-surfer');
    expect(surferSkin?.unlock).toEqual({ kind: 'points', price: 5_000 });
    const lifeguardSkin = cosmeticById('skin-look-tiger-lifeguard');
    expect(lifeguardSkin?.unlock).toEqual({ kind: 'points', price: 5_000 });
    const neonLuluSkin = cosmeticById('skin-look-cat-neon-rider');
    expect(neonLuluSkin?.unlock).toEqual({ kind: 'points', price: 5_000 });
    const cyberKongSkin = cosmeticById('skin-look-hamster-cyber-driver');
    expect(cyberKongSkin?.unlock).toEqual({ kind: 'points', price: 5_000 });
    expect(COSMETIC_CATALOG.filter((item) => item.slot === 'skin').every(
      (item) => item.unlock.kind === 'points' && (
        item.id === 'skin-look-bunny-ward'
        || item.id === 'skin-look-puppy-surfer'
        || item.id === 'skin-look-tiger-lifeguard'
        || item.id === 'skin-look-cat-neon-rider'
        || item.id === 'skin-look-hamster-cyber-driver'
        || item.unlock.price === 2_500
      ),
    )).toBe(true);
  });

  it('normalizes old equipment saves to their character base skin and scales clear rewards', () => {
    expect(normalizeAppearance({ character: 'hat-beanie', shoes: 'invalid' })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ character: 'character-bunny', outfit: 'outfit-raincoat' })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ character: 'character-cat', skin: 'skin-look-bunny-ward' }))
      .toEqual({ character: 'character-cat', skin: 'skin-basic-cat', tileSkin: DEFAULT_TILE_SKIN_ID });
    expect(normalizeAppearance({
      character: 'character-bunny',
      skin: 'skin-basic-bunny',
      tileSkin: WAVE_TILE_SKIN_ID,
    }).tileSkin).toBe(WAVE_TILE_SKIN_ID);
    expect(normalizeAppearance({
      character: 'character-bunny',
      skin: 'skin-basic-bunny',
      tileSkin: 'tile-missing',
    }).tileSkin).toBe(DEFAULT_TILE_SKIN_ID);
    expect(normalizeAppearance({ character: 'character-eagle' }).character).toBe('character-tiger');
    expect(customizationReward(0)).toBe(80);
    expect(customizationReward(5)).toBe(100);
    expect(customizationReward(105)).toBe(500);
    expect(customizationReward(999)).toBe(500);
  });

  it('equips a complete skin together with its required base character', () => {
    const catSkin = cosmeticById('skin-look-cat-ward');
    if (!catSkin) throw new Error('missing cat skin');
    expect(appearanceAfterCosmeticEquip(DEFAULT_APPEARANCE, catSkin)).toEqual({
      character: 'character-cat',
      skin: 'skin-look-cat-ward',
      tileSkin: DEFAULT_TILE_SKIN_ID,
    });
  });
});

describe('shop consumable rules', () => {
  it('keeps twelve combat tactical supplies separate from lamp rewards', () => {
    expect(SHOP_CONSUMABLES).toHaveLength(12);
    expect(new Set(SHOP_CONSUMABLES.map((item) => item.id)).size).toBe(SHOP_CONSUMABLES.length);
    expect(SHOP_CONSUMABLES.every((item) => !RANDOM_ITEMS.some((random) => random.id === item.id))).toBe(true);
    expect(SHOP_CONSUMABLES.filter((item) => item.category === 'assault')).toHaveLength(4);
    expect(SHOP_CONSUMABLES.filter((item) => item.category === 'defense')).toHaveLength(4);
    expect(SHOP_CONSUMABLES.filter((item) => item.category === 'engineering')).toHaveLength(4);
  });

  it('allows a selected supply once per match and retains the remaining account inventory', () => {
    const engine = new GameEngine('SUPPLYROOM', generateMap(9_078), true);
    const joined = engine.join({
      nickname: 'SupplyTester',
      deviceId: 'device-supply-tester',
      consumables: [{ itemId: 'scout-flare', quantity: 2 }],
    });
    expect(engine.handle(joined.player.id, envelope({ type: 'set-consumable-loadout', itemIds: ['scout-flare'] })).ok).toBe(true);
    expect(engine.start(joined.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);
    for (let index = 0; index < 400 && engine.snapshot().status === 'COUNTDOWN'; index += 1) engine.tick(0.1);
    expect(engine.snapshot().status).toBe('PLAYING');
    const playerPosition = engine.snapshot().players.find((candidate) => candidate.id === joined.player.id)?.position;
    const targetTile = engine.map.corridorTiles
      .slice()
      .sort((left, right) =>
        Math.hypot(left.x - (playerPosition?.x ?? 0), left.y - (playerPosition?.y ?? 0)) -
        Math.hypot(right.x - (playerPosition?.x ?? 0), right.y - (playerPosition?.y ?? 0)))[0]!;
    expect(engine.handle(joined.player.id, envelope({ type: 'use-consumable', itemId: 'scout-flare', tile: targetTile }, 2)).ok).toBe(true);
    const player = engine.snapshot().players.find((candidate) => candidate.id === joined.player.id);
    expect(player?.consumables).toEqual([{ itemId: 'scout-flare', quantity: 1 }]);
    expect(player?.usedConsumables).toEqual(['scout-flare']);
    expect(engine.handle(joined.player.id, envelope({ type: 'use-consumable', itemId: 'scout-flare', tile: targetTile }, 3)).ok).toBe(false);
  });
});

describe('authoritative game rules', () => {
  it('transfers lobby ownership on leave and destroys a room with no humans left', () => {
    const { engine, ids } = setup(2);
    const formerHost = ids[0] as string;
    const nextHost = ids[1] as string;
    const transfer = engine.leaveLobby(formerHost);
    expect(transfer).toMatchObject({ ok: true, removedPlayerId: formerHost, newHostId: nextHost, roomEmpty: false });
    expect(engine.snapshot().hostId).toBe(nextHost);
    expect(engine.snapshot().players.some((player) => player.id === formerHost)).toBe(false);

    expect(engine.addBot(nextHost, 'normal').ok).toBe(true);
    const close = engine.leaveLobby(nextHost);
    expect(close).toMatchObject({ ok: true, roomEmpty: true, newHostId: null });
    expect(engine.snapshot().players).toEqual([]);
  });

  it('lets only the lobby host remove bots and kick another human', () => {
    const { engine, ids } = setup(2);
    const host = ids[0] as string;
    const guest = ids[1] as string;
    expect(engine.addBot(host, 'normal').ok).toBe(true);
    const botId = engine.snapshot().players.find((player) => player.isBot)?.id as string;
    expect(engine.removeBot(guest, botId).ok).toBe(false);
    expect(engine.removeBot(host, botId).ok).toBe(true);
    expect(engine.kickPlayer(guest, host).ok).toBe(false);
    expect(engine.kickPlayer(host, guest)).toMatchObject({ ok: true, removedPlayerId: guest });
  });

  it('lets the ghost patrol corridors during the thirty-second blackout phase', () => {
    const { engine, ids } = setup(1, false, { ranked: RANKED_OPENING });
    const ghostSpawn = { ...engine.map.ghostSpawn };
    expect(engine.start(ids[0] as string).ok).toBe(true);
    expect(engine.snapshot().status).toBe('COUNTDOWN');
    expect(engine.snapshot().countdown).toBe(30);
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    expect(
      Math.hypot(
        engine.snapshot().ghost.position.x - ghostSpawn.x,
        engine.snapshot().ghost.position.y - ghostSpawn.y,
      ),
    ).toBeGreaterThan(0.05);
    for (let index = 0; index < 289; index += 1) engine.tick(0.1);
    expect(engine.snapshot().status).toBe('COUNTDOWN');
    const positionBeforeLightsOn = { ...engine.snapshot().ghost.position };
    engine.tick(0.1);
    expect(engine.snapshot().status).toBe('PLAYING');
    expect(
      Math.hypot(
        engine.snapshot().ghost.position.x - positionBeforeLightsOn.x,
        engine.snapshot().ghost.position.y - positionBeforeLightsOn.y,
      ),
    ).toBeLessThanOrEqual(BALANCE.player.speed * 0.11);
    expect(engine.drainEvents()).toContainEqual(
      expect.objectContaining({ kind: 'lights-on' }),
    );
  });

  it('chases only visible corridor survivors during blackout and loses them inside rooms', () => {
    const { engine, ids } = setup(1, true, { ranked: RANKED_OPENING });
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const room = engine.map.rooms[0];
    if (!room) throw new Error('missing blackout room fixture');
    const corridorPair = engine.map.corridorTiles
      .map((ghostTile) => ({
        ghostTile,
        playerTile: engine.map.corridorTiles.find(
          (candidate) =>
            Math.abs(candidate.x - ghostTile.x) +
              Math.abs(candidate.y - ghostTile.y) ===
            1,
        ),
      }))
      .find((candidate) => candidate.playerTile);
    if (!corridorPair?.playerTile)
      throw new Error('missing blackout corridor fixture');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !ghost) throw new Error('missing blackout actors');
    player.position = { ...corridorPair.playerTile };
    player.velocity = { x: 0, y: 0 };
    ghost.position = { ...corridorPair.ghostTile };
    ghost.targetPlayerId = null;
    ghost.targetRoomId = null;
    ghost.path = [];
    engine.restore(persisted);

    engine.tick(0.1);
    expect(engine.snapshot().ghost.targetPlayerId).toBe(playerId);
    expect(engine.snapshot().ghost.targetRoomId).toBeNull();

    const hidden = engine.serialize();
    const hiddenPlayer = hidden.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!hiddenPlayer) throw new Error('missing hidden survivor');
    hiddenPlayer.position = { ...(room.floorTiles[0] as Tile) };
    engine.restore(hidden);
    engine.tick(0.1);
    expect(engine.snapshot().ghost.targetPlayerId).toBeNull();
    expect(engine.snapshot().ghost.targetRoomId).toBeNull();
    expect(engine.snapshot().rooms[0]?.doorHp).toBe(
      engine.snapshot().rooms[0]?.doorMaxHp,
    );
  });

  it('eliminates an unclaimed survivor immediately on physical ghost contact', () => {
    const { engine, ids } = setup(1, true, { ranked: RANKED_OPENING });
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const contactTile = engine.map.corridorTiles[0];
    if (!contactTile) throw new Error('missing contact corridor fixture');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !ghost) throw new Error('missing contact actors');
    player.position = { ...contactTile };
    player.roomId = null;
    ghost.position = { ...contactTile };
    ghost.attackCooldown = 99;
    ghost.targetPlayerId = playerId;
    ghost.path = [];
    engine.restore(persisted);

    engine.tick(0.01);

    expect(
      engine.snapshot().players.find((candidate) => candidate.id === playerId)
        ?.alive,
    ).toBe(false);
    expect(engine.drainEvents()).toContainEqual(
      expect.objectContaining({ kind: 'death', playerId }),
    );
  });

  it('keeps an unclaimed survivor safe after entering a room floor when lights turn on', () => {
    const { engine, ids } = setup(1, true, { ranked: RANKED_OPENING });
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const room = engine.map.rooms[0];
    const roomTile = room?.floorTiles[0];
    const corridorTile = engine.map.corridorTiles[0];
    if (!room || !roomTile || !corridorTile)
      throw new Error('missing safe-room fixture');
    const persisted = engine.serialize();
    persisted.snapshot.status = 'PLAYING';
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !ghost) throw new Error('missing safe-room actors');
    player.position = { ...roomTile };
    player.roomId = null;
    ghost.position = { ...corridorTile };
    ghost.targetPlayerId = playerId;
    ghost.targetRoomId = null;
    ghost.path = [];
    engine.restore(persisted);

    engine.tick(0.1);

    const after = engine.snapshot();
    expect(
      after.players.find((candidate) => candidate.id === playerId)?.alive,
    ).toBe(true);
    expect(after.ghost.targetPlayerId).toBeNull();
  });

  it('gives wandering blackout twins separated patrol destinations', () => {
    const { engine, ids } = setup(1, true, { ranked: RANKED_OPENING });
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const roomTile = engine.map.rooms[0]?.floorTiles[0];
    const ghostTile = engine.map.corridorTiles[0];
    if (!roomTile || !ghostTile)
      throw new Error('missing blackout twin fixture');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    const twinA = persisted.snapshot.ghosts[0];
    if (!player || !twinA) throw new Error('missing blackout twin actors');
    player.position = { ...roomTile };
    player.roomId = null;
    twinA.variant = 'twin-a';
    twinA.position = { ...ghostTile };
    twinA.targetPlayerId = null;
    twinA.wanderTarget = null;
    twinA.path = [];
    const twinB: GhostState = {
      ...structuredClone(twinA),
      id: 'blackout-twin-b',
      variant: 'twin-b',
    };
    persisted.snapshot.ghosts = [twinA, twinB];
    engine.restore(persisted);

    engine.tick(0.1);

    const twins = engine.snapshot().ghosts;
    const firstTarget = twins[0]?.wanderTarget;
    const secondTarget = twins[1]?.wanderTarget;
    expect(firstTarget).toBeTruthy();
    expect(secondTarget).toBeTruthy();
    expect(
      Math.hypot(
        (firstTarget as Tile).x - (secondTarget as Tile).x,
        (firstTarget as Tile).y - (secondTarget as Tile).y,
      ),
    ).toBeGreaterThanOrEqual(4);
    expect(
      twins.every(
        (ghost) =>
          Math.hypot(
            ghost.position.x - ghostTile.x,
            ghost.position.y - ghostTile.y,
          ) > 0,
      ),
    ).toBe(true);
  });

  it('spawns both twins on distinct walkable corridor tiles and keeps both moving after lights turn on', () => {
    // Ranked setup does not consume the normal-mode Time Attack RNG roll, so
    // use a seed whose first ghost-variant roll is the twin pair.
    const map = generateMap(1);
    const engine = new GameEngine('X1', map, false, { ranked: RANKED_OPENING });
    const joined = engine.join({
      nickname: '쌍둥이 추적자',
      deviceId: 'twin-spawn-walkable-device',
    });
    const initial = engine.snapshot();
    expect(initial.ghosts.map((ghost) => ghost.variant)).toEqual([
      'twin-a',
      'twin-b',
    ]);
    expect(
      initial.ghosts.every((ghost) =>
        isWalkableArea(
          map,
          ghost.position.x,
          ghost.position.y,
          BALANCE.ghost.collisionRadius,
        ),
      ),
    ).toBe(true);
    expect(new Set(
      initial.ghosts.map(
        (ghost) => `${Math.round(ghost.position.x)},${Math.round(ghost.position.y)}`,
      ),
    ).size).toBe(2);

    expect(engine.start(joined.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);
    const beforeBlackout = engine.snapshot().ghosts.map((ghost) => ({
      id: ghost.id,
      position: { ...ghost.position },
    }));
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    const afterBlackout = engine.snapshot().ghosts;
    expect(afterBlackout.every((ghost) => {
      const before = beforeBlackout.find((candidate) => candidate.id === ghost.id);
      return Boolean(
        before &&
          Math.hypot(
            before.position.x - ghost.position.x,
            before.position.y - ghost.position.y,
          ) > 0.05,
      );
    })).toBe(true);

    const playingState = engine.serialize();
    playingState.snapshot.status = 'PLAYING';
    playingState.snapshot.players.forEach((player) => {
      player.position = { ...(map.rooms[0]?.floorTiles[0] as Tile) };
      player.roomId = null;
    });
    playingState.snapshot.ghosts.forEach((ghost) => {
      ghost.targetPlayerId = null;
      ghost.targetRoomId = null;
      ghost.wanderTarget = null;
      ghost.path = [];
    });
    engine.restore(playingState);
    const beforePlaying = engine.snapshot().ghosts.map((ghost) => ({
      id: ghost.id,
      position: { ...ghost.position },
    }));
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    const afterPlaying = engine.snapshot().ghosts;
    expect(afterPlaying.every((ghost) => {
      const before = beforePlaying.find((candidate) => candidate.id === ghost.id);
      return Boolean(
        before &&
          Math.hypot(
            before.position.x - ghost.position.x,
            before.position.y - ghost.position.y,
          ) > 0.05,
      );
    })).toBe(true);
  });

  it('seals a survivor inside the room reached before the countdown ends', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const room = engine.map.rooms.find((candidate) => {
      const floorKeys = new Set(candidate.floorTiles.map((tile) => `${tile.x},${tile.y}`));
      return candidate.floorTiles.some((tile) =>
        [
          { x: tile.x + 1, y: tile.y },
          { x: tile.x - 1, y: tile.y },
          { x: tile.x, y: tile.y + 1 },
          { x: tile.x, y: tile.y - 1 },
        ].some(
          (neighbor) =>
            engine.map.walkable.some(
              (walkable) => walkable.x === neighbor.x && walkable.y === neighbor.y,
            ) && !floorKeys.has(`${neighbor.x},${neighbor.y}`),
        ),
      );
    });
    if (!room) throw new Error('missing room with an exit');
    const floorKeys = new Set(room.floorTiles.map((tile) => `${tile.x},${tile.y}`));
    const exit = room.floorTiles.flatMap((tile) =>
      [
        { x: tile.x + 1, y: tile.y },
        { x: tile.x - 1, y: tile.y },
        { x: tile.x, y: tile.y + 1 },
        { x: tile.x, y: tile.y - 1 },
      ].map((neighbor) => ({ tile, neighbor })),
    ).find(({ neighbor }) =>
      engine.map.walkable.some(
        (walkable) => walkable.x === neighbor.x && walkable.y === neighbor.y,
      ) && !floorKeys.has(`${neighbor.x},${neighbor.y}`),
    );
    if (!exit) throw new Error('missing room exit edge');

    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing room-lock player');
    player.position = { ...exit.tile };
    player.velocity = { x: 0, y: 0 };
    persisted.snapshot.countdown = 0.01;
    engine.restore(persisted);
    engine.tick(0.1);
    expect(engine.snapshot().status).toBe('PLAYING');
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.lockedRoomId)
      .toBe(room.id);

    const dx = exit.neighbor.x - exit.tile.x;
    const dy = exit.neighbor.y - exit.tile.y;
    expect(engine.setMovement(playerId, dx, dy, 1).ok).toBe(true);
    for (let index = 0; index < 15; index += 1) engine.tick(0.1);
    const after = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    expect(after).toBeTruthy();
    expect(isPositionOnRoomFloor(room, after?.position as Tile)).toBe(true);
  });

  it('shows Time Attack before ranked countdown without revealing the ghost', () => {
    const { engine, ids } = setup(1, true, {
      ranked: { ...RANKED_OPENING, modifier: 'time-attack' },
    });
    const playerId = ids[0] as string;
    const prepared = engine.serialize();
    prepared.snapshot.difficulty.modifier = 'time-attack';
    prepared.snapshot.difficulty.timeAttackRemaining = 300;
    engine.restore(prepared);
    const initialPosition = { ...engine.snapshot().players[0]!.position };
    expect(engine.start(playerId).ok).toBe(true);
    expect(engine.snapshot().status).toBe('EVENT_INTRO');
    expect(engine.handle(playerId, envelope({ type: 'move', dx: 1, dy: 0, inputSequence: 1 })).ok).toBe(true);
    for (let index = 0; index < 20 && engine.snapshot().status === 'EVENT_INTRO'; index += 1) {
      engine.tick(0.1);
    }
    expect(engine.snapshot().status).toBe('COUNTDOWN');
    expect(engine.snapshot().players[0]?.position).toEqual(initialPosition);
    expect(engine.snapshot().players[0]?.velocity).toEqual({ x: 0, y: 0 });
  });

  it('shows the blackout lesson for five seconds before a first ranked match', () => {
    const { engine, ids } = setup(1, true, {
      ranked: { ...RANKED_OPENING, firstRankedMatch: true },
    });
    const playerId = ids[0] as string;
    const initialPosition = { ...engine.snapshot().players[0]!.position };

    expect(engine.start(playerId).ok).toBe(true);
    expect(engine.snapshot().status).toBe('RANKED_INTRO');
    expect(engine.handle(playerId, envelope({
      type: 'move',
      dx: 1,
      dy: 0,
      inputSequence: 1,
    })).ok).toBe(true);

    // Deterministic engine fixtures run at 4× simulation speed.
    for (let index = 0; index < 12; index += 1) engine.tick(0.1);
    expect(engine.snapshot().status).toBe('RANKED_INTRO');
    expect(engine.snapshot().players[0]?.position).toEqual(initialPosition);

    engine.tick(0.1);
    expect(engine.snapshot().status).toBe('COUNTDOWN');
  });

  it('reserves a separate guided room for the first-match tutorial', () => {
    const map = generateMap(91_001);
    const engine = new GameEngine('TUTORIAL', map, true, {
      stageId: 'tutorial-1',
      playMode: 'solo',
    });
    const joined = engine.join({
      nickname: '첫 생존자',
      deviceId: 'device-first-tutorial',
    });

    expect(engine.snapshot().tutorial).toEqual(expect.objectContaining({
      active: true,
      step: 'claim-bed',
    }));
    expect(engine.snapshot().tutorial?.reservedRoomId).toBeTruthy();
    expect(engine.snapshot().rooms.find(
      (room) => room.id === engine.snapshot().tutorial?.reservedRoomId,
    )).toBeDefined();
    expect(engine.start(joined.player.id).ok).toBe(true);
    expect(engine.snapshot().status).toBe('GHOST_INTRO');
  });

  it('announces the stronger ghost exactly when the five-minute Time Attack expires', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    persisted.snapshot.status = 'PLAYING';
    persisted.snapshot.difficulty.modifier = 'time-attack';
    persisted.snapshot.difficulty.timeAttackRemaining = 0.05;
    engine.restore(persisted);
    engine.drainEvents();

    engine.tick(0.1);

    expect(engine.snapshot().status).toBe('OVERTIME');
    expect(engine.drainEvents()).toContainEqual(
      expect.objectContaining({
        kind: 'ghost-skill',
        label: TIME_ATTACK_EXPIRED_MESSAGE,
      }),
    );
  });

  it('keeps explicitly claimed solo beds in distinct rooms', () => {
    const { engine, ids } = setup(4);
    const state = begin(engine, ids[0] as string);
    const occupied = state.players.map((player) => player.roomId);
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(state.rooms.filter((room) => room.ownerId).length).toBe(4);
  });

  it('applies the first occupant tile skin to the claimed room authoritatively', () => {
    const map = generateMap(88_124, 'multiplayer');
    const engine = new GameEngine('TILESKINROOM', map, true, { playMode: 'multiplayer' });
    const first = engine.join({
      nickname: 'WaveOwner',
      deviceId: 'wave-owner',
      appearance: {
        character: 'character-bunny',
        skin: 'skin-basic-bunny',
        tileSkin: WAVE_TILE_SKIN_ID,
      },
    });
    const second = engine.join({
      nickname: 'BasicRoommate',
      deviceId: 'basic-roommate',
      appearance: DEFAULT_APPEARANCE,
    });
    engine.handle(second.player.id, envelope({ type: 'ready', ready: true }, 2));
    expect(engine.start(first.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);

    const room = map.rooms[0];
    if (!room) throw new Error('missing tile-skin room');
    const persisted = engine.serialize();
    const firstPlayer = persisted.snapshot.players.find((player) => player.id === first.player.id);
    const secondPlayer = persisted.snapshot.players.find((player) => player.id === second.player.id);
    if (!firstPlayer || !secondPlayer) throw new Error('missing tile-skin players');
    firstPlayer.position = { ...(room.beds[0] as Tile) };
    secondPlayer.position = { ...(room.beds[1] as Tile) };
    engine.restore(persisted);

    expect(engine.interact(first.player.id).ok).toBe(true);
    const claimed = engine.snapshot().rooms.find((candidate) => candidate.id === room.id);
    expect(claimed?.tileSkinId).toBe(WAVE_TILE_SKIN_ID);
    expect(claimed?.tileSkinActivatedAt).toBeGreaterThanOrEqual(0);

    expect(engine.interact(second.player.id).ok).toBe(true);
    expect(engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.tileSkinId)
      .toBe(WAVE_TILE_SKIN_ID);
  });

  it('does not allow a solo survivor to enter a room already claimed by a bot', () => {
    const { engine, ids } = setup(1, false);
    const hostId = ids[0] as string;
    expect(engine.addBot(hostId, 'normal').ok).toBe(true);
    expect(engine.start(hostId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const bot = engine.snapshot().players.find((player) => player.isBot);
    const mapRoom = engine.map.rooms[0];
    const firstBed = mapRoom?.beds[0];
    const secondBed = mapRoom?.beds[1] ?? firstBed;
    if (!bot || !mapRoom || !firstBed || !secondBed)
      throw new Error('missing bot occupancy fixture');

    const persisted = engine.serialize();
    const host = persisted.snapshot.players.find((player) => player.id === hostId);
    const savedBot = persisted.snapshot.players.find((player) => player.id === bot.id);
    if (!host || !savedBot) throw new Error('missing players');
    savedBot.position = { ...firstBed };
    host.position = { ...secondBed };
    engine.restore(persisted);

    expect(engine.interact(bot.id).ok).toBe(true);
    const occupiedBot = engine.snapshot().players.find((player) => player.id === bot.id);
    expect(occupiedBot?.roomId).toBe(mapRoom.id);
    expect(occupiedBot?.bedIndex).toBe(0);
    expect(occupiedBot?.position).toEqual(firstBed);
    const result = engine.interact(hostId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('다른 생존자가 점유하지 않은 방');
    expect(engine.snapshot().players.find((player) => player.id === hostId)?.roomId).toBeNull();
  });

  it('never auto-occupies a bed and pursues an unoccupied survivor at accelerated speed', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    for (
      let index = 0;
      index < 400 && engine.snapshot().status === 'COUNTDOWN';
      index += 1
    ) engine.tick(0.1);
    const before = engine.snapshot();
    const player = before.players.find((candidate) => candidate.id === playerId);
    expect(before.status).toBe('PLAYING');
    expect(player?.roomId).toBeNull();
    expect(player?.position).toEqual(engine.map.playerSpawn);
    const ghostPosition = { ...before.ghost.position };
    engine.tick(0.1);
    const after = engine.snapshot();
    const moved = Math.hypot(
      after.ghost.position.x - ghostPosition.x,
      after.ghost.position.y - ghostPosition.y,
    );
    expect(after.ghost.targetPlayerId).toBe(playerId);
    expect(BALANCE.ghost.outsideTargetSpeedMultiplier).toBeCloseTo(1.35, 5);
    expect(BALANCE.ghost.retreatSpeedMultiplier).toBeCloseTo(1.3, 5);
    expect(moved).toBeGreaterThan(BALANCE.ghost.speed * 0.14);
  });

  it('lets two multiplayer survivors share one room while keeping income ownership personal', () => {
    const map = generateMap(73_401, 'multiplayer');
    const engine = new GameEngine('SHAREDROOM', map, true, { playMode: 'multiplayer' });
    const first = engine.join({ nickname: 'RoommateA', deviceId: 'shared-room-a' });
    const second = engine.join({ nickname: 'RoommateB', deviceId: 'shared-room-b' });
    engine.handle(second.player.id, envelope({ type: 'ready', ready: true }, 2));
    begin(engine, first.player.id);
    const initial = engine.snapshot();
    const firstPlayer = initial.players.find((player) => player.id === first.player.id);
    const secondPlayer = initial.players.find((player) => player.id === second.player.id);
    expect(firstPlayer?.roomId).toBe(secondPlayer?.roomId);
    expect(firstPlayer?.bedIndex).not.toBe(secondPlayer?.bedIndex);
    const roomId = firstPlayer?.roomId as string;
    const room = map.rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new Error('missing shared room');

    const persisted = engine.serialize();
    for (const player of persisted.snapshot.players) {
      player.gold = 10_000;
      player.power = 1_000;
      player.powerIncomeElapsed = 0;
    }
    engine.restore(persisted);
    expect(engine.build(first.player.id, roomId, room.buildTiles[0] as Tile, 'generator').ok).toBe(true);
    const before = engine.snapshot();
    const firstPower = before.players.find((player) => player.id === first.player.id)?.power ?? 0;
    const secondPower = before.players.find((player) => player.id === second.player.id)?.power ?? 0;
    for (let index = 0; index < 3; index += 1) engine.tick(0.1);
    expect((engine.snapshot().players.find((player) => player.id === first.player.id)?.power ?? 0) - firstPower).toBeGreaterThan(0);
    expect(engine.snapshot().players.find((player) => player.id === second.player.id)?.power).toBe(secondPower);

    expect(engine.build(first.player.id, roomId, room.buildTiles[1] as Tile, 'basic-turret').ok).toBe(true);
    const turret = engine.snapshot().buildings.find((building) => building.kind === 'basic-turret');
    if (!turret) throw new Error('missing shared turret');
    expect(engine.upgrade(second.player.id, turret.id).ok).toBe(true);
    expect(engine.snapshot().buildings.find((building) => building.id === turret.id)?.level).toBe(2);
    expect(engine.upgrade(second.player.id, `door:${roomId}`).ok).toBe(true);
    expect(engine.build(second.player.id, roomId, room.buildTiles[2] as Tile, 'generator').ok).toBe(true);
    expect(engine.snapshot().buildings.filter((building) => building.kind === 'generator').map((building) => building.ownerId).sort()).toEqual([first.player.id, second.player.id].sort());
    expect(engine.upgrade(second.player.id, `bed:${roomId}:${firstPlayer?.bedIndex ?? 0}`).ok).toBe(false);
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

  it('preserves partial movement input so server movement matches local prediction', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;

    expect(engine.setMovement(playerId, 0.25, 0, 1).ok).toBe(true);
    expect(
      engine.snapshot().players.find((player) => player.id === playerId)?.velocity,
    ).toEqual({ x: 0.25, y: 0 });

    expect(engine.setMovement(playerId, 1, 1, 2).ok).toBe(true);
    const diagonal = engine.snapshot().players.find(
      (player) => player.id === playerId,
    )?.velocity;
    expect(diagonal?.x).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal?.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('does not allow sleeping from a position outside the room floor', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const player = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    const mapRoom = engine.map.rooms[0];
    if (!player || !mapRoom) throw new Error('missing sleep boundary fixture');
    const persisted = engine.serialize();
    const candidate = persisted.snapshot.players.find((entry) => entry.id === playerId);
    if (!candidate) throw new Error('missing sleep boundary player');
    const bed = mapRoom.bed;
    const outside = engine.map.walls.find((tile) => Math.hypot(tile.x - bed.x, tile.y - bed.y) <= BALANCE.player.interactionRange);
    if (!outside) throw new Error('missing wall next to bed');
    candidate.position = { ...outside };
    candidate.velocity = { x: 1, y: 0 };
    engine.restore(persisted);
    expect(engine.interact(playerId).ok).toBe(false);
    expect(engine.snapshot().players.find((entry) => entry.id === playerId)?.velocity).toEqual({ x: 0, y: 0 });
  });

  it('accepts snapshot latency drift near a bed only while still on that room floor', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const roomWithGraceTile = engine.map.rooms
      .flatMap((room) => room.floorTiles.map((tile) => ({ room, tile })))
      .find(({ room, tile }) => {
        const distanceFromBed = Math.hypot(
          tile.x - room.bed.x,
          tile.y - room.bed.y,
        );
        return (
          distanceFromBed > BALANCE.player.interactionRange &&
          distanceFromBed <=
            BALANCE.player.interactionRange +
              BALANCE.player.interactionLatencyGrace
        );
      });
    if (!roomWithGraceTile)
      throw new Error('missing legal sleep latency-grace fixture');
    const persisted = engine.serialize();
    const candidate = persisted.snapshot.players.find(
      (entry) => entry.id === playerId,
    );
    if (!candidate) throw new Error('missing sleep latency-grace player');
    candidate.position = { ...roomWithGraceTile.tile };
    candidate.velocity = { x: 1, y: 0 };
    engine.restore(persisted);

    expect(engine.interact(playerId).ok).toBe(true);
    const claimed = engine
      .snapshot()
      .players.find((entry) => entry.id === playerId);
    expect(claimed?.roomId).toBe(roomWithGraceTile.room.id);
    expect(claimed?.position).toEqual(roomWithGraceTile.room.bed);
    expect(claimed?.velocity).toEqual({ x: 0, y: 0 });
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
    expect(engine.build(ids[0] as string, roomId, tile, 'frost-turret').error).toContain('사용 중');
  });

  it('enforces strategic building limits and arms their active effects server-side', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const room = engine.map.rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new Error('missing strategic room');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing strategic player');
    player.gold = 100_000;
    player.power = 100_000;
    engine.restore(persisted);
    const tiles = room.buildTiles.slice(0, 5);
    expect(engine.build(playerId, roomId, tiles[0] as Tile, 'basic-turret').ok).toBe(true);
    expect(engine.build(playerId, roomId, tiles[1] as Tile, 'overload-capacitor').ok).toBe(true);
    expect(engine.build(playerId, roomId, tiles[2] as Tile, 'overload-capacitor').ok).toBe(false);
    const charged = engine.serialize();
    const capacitor = charged.snapshot.buildings.find((building) => building.kind === 'overload-capacitor');
    if (!capacitor) throw new Error('missing capacitor');
    capacitor.overloadReadyAt = 0;
    engine.restore(charged);
    expect(engine.handle(playerId, envelope({ type: 'activate-building', buildingId: capacitor.id, action: 'use' }, 301)).ok).toBe(true);
    expect(engine.snapshot().buildings.find((building) => building.id === capacitor.id)?.overloadUntil).toBeGreaterThan(0);
    expect(engine.build(playerId, roomId, tiles[3] as Tile, 'soul-vial').ok).toBe(true);
    const vialState = engine.serialize();
    const vial = vialState.snapshot.buildings.find((building) => building.kind === 'soul-vial');
    const turret = vialState.snapshot.buildings.find((building) => building.kind === 'basic-turret');
    if (!vial || !turret) throw new Error('missing soul test buildings');
    vial.storedSoulDamage = 400;
    engine.restore(vialState);
    expect(engine.handle(playerId, envelope({ type: 'activate-building', buildingId: vial.id, action: 'soul-arm' }, 302)).ok).toBe(true);
    expect(engine.handle(playerId, envelope({ type: 'activate-building', buildingId: vial.id, action: 'soul-cancel' }, 303)).ok).toBe(true);
    expect(engine.snapshot().players.find((player) => player.id === playerId)?.armedSoulVialId).toBeNull();
    expect(engine.handle(playerId, envelope({ type: 'activate-building', buildingId: vial.id, action: 'soul-arm' }, 304)).ok).toBe(true);
    expect(engine.handle(playerId, envelope({ type: 'activate-building', buildingId: vial.id, action: 'soul-fire', targetId: turret.id }, 305)).ok).toBe(true);
    const chargedTurret = engine.snapshot().buildings.find((building) => building.id === turret.id);
    expect(chargedTurret?.soulChargeReadyAt).toBeGreaterThan(engine.snapshot().elapsed);
    expect(chargedTurret?.soulChargeDamage).toBe(140);
  });

  it('removes a building, returns exactly seventy percent of all invested resources and reopens the tile', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing refund player');
    player.gold = 1_000;
    player.power = 100;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const buildingId = engine.snapshot().buildings[0]?.id as string;
    expect(engine.upgrade(playerId, buildingId).ok).toBe(true);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBe(970);
    expect(engine.removeBuilding(playerId, buildingId).ok).toBe(true);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBe(991);
    expect(engine.snapshot().buildings).toHaveLength(0);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
  });

  it('moves an owned building to an empty tile and swaps it with another owned building', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const tiles = (engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? []).filter(
      (tile) => !engine.snapshot().buildings.some(
        (building) => building.tile.x === tile.x && building.tile.y === tile.y,
      ),
    );
    if (tiles.length < 3) throw new Error('missing move-building tiles');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing move-building owner');
    player.gold = 1_000;
    player.power = 1_000;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, tiles[0] as Tile, 'basic-turret').ok).toBe(true);
    expect(engine.build(playerId, roomId, tiles[1] as Tile, 'generator').ok).toBe(true);
    const turret = engine.snapshot().buildings.find((building) => building.kind === 'basic-turret');
    const generator = engine.snapshot().buildings.find((building) => building.kind === 'generator');
    if (!turret || !generator) throw new Error('missing move-building fixtures');
    expect(engine.moveBuilding(playerId, turret.id, tiles[2] as Tile).ok).toBe(true);
    expect(engine.snapshot().buildings.find((building) => building.id === turret.id)?.tile).toEqual({ x: (tiles[2] as Tile).x, y: (tiles[2] as Tile).y });
    expect(engine.moveBuilding(playerId, turret.id, tiles[1] as Tile).ok).toBe(true);
    expect(engine.snapshot().buildings.find((building) => building.id === turret.id)?.tile).toEqual({ x: (tiles[1] as Tile).x, y: (tiles[1] as Tile).y });
    expect(engine.snapshot().buildings.find((building) => building.id === generator.id)?.tile).toEqual({ x: (tiles[2] as Tile).x, y: (tiles[2] as Tile).y });
    expect(engine.moveBuilding(playerId, turret.id, { x: 0, y: 0 }).ok).toBe(false);
  });

  it('enhances all four cardinal turrets and immediately rebinds bonuses after a move', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const roomId = engine.snapshot().players.find(
      (player) => player.id === playerId,
    )?.roomId;
    const room = engine.map.rooms.find((candidate) => candidate.id === roomId);
    if (!roomId || !room) throw new Error('missing enhancer room');
    const occupied = new Set(
      engine.snapshot().buildings.map(
        (building) => `${building.tile.x}:${building.tile.y}`,
      ),
    );
    const available = new Map(
      room.buildTiles
        .filter((tile) => !occupied.has(`${tile.x}:${tile.y}`))
        .map((tile) => [`${tile.x}:${tile.y}`, tile] as const),
    );
    const center = [...available.values()].find((tile) => {
      const requiredTiles: Tile[] = [
        [tile.x - 1, tile.y],
        [tile.x + 1, tile.y],
        [tile.x, tile.y - 1],
        [tile.x, tile.y + 1],
        [tile.x + 2, tile.y],
      ].map(([x, y]) => ({ x: x as number, y: y as number }));
      return requiredTiles.every((candidate) =>
        available.has(`${candidate.x}:${candidate.y}`),
      );
    });
    if (!center) throw new Error('missing cardinal enhancer fixture');
    const left = available.get(`${center.x - 1}:${center.y}`) as Tile;
    const right = available.get(`${center.x + 1}:${center.y}`) as Tile;
    const up = available.get(`${center.x}:${center.y - 1}`) as Tile;
    const down = available.get(`${center.x}:${center.y + 1}`) as Tile;
    const farRight = available.get(`${center.x + 2}:${center.y}`) as Tile;
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player) throw new Error('missing enhancer owner');
    player.gold = 10_000;
    player.power = 10_000;
    engine.restore(persisted);

    expect(engine.build(playerId, roomId, center, 'turret-enhancer').ok).toBe(true);
    for (const tile of [left, right, up, down, farRight])
      expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);

    const firstState = engine.snapshot();
    const enhancer = firstState.buildings.find(
      (building) => building.kind === 'turret-enhancer',
    );
    const turretAt = (tile: Tile) =>
      engine.snapshot().buildings.find(
        (building) =>
          building.kind === 'basic-turret' &&
          building.tile.x === tile.x &&
          building.tile.y === tile.y,
      );
    if (!enhancer) throw new Error('missing enhancer');
    for (const tile of [left, right, up, down])
      expect(turretAt(tile)?.effectiveLevel).toBe(2);
    expect(turretAt(farRight)?.effectiveLevel).toBe(1);

    const levelState = engine.serialize();
    const leftTurret = levelState.snapshot.buildings.find(
      (building) =>
        building.kind === 'basic-turret' &&
        building.tile.x === left.x &&
        building.tile.y === left.y,
    );
    if (!leftTurret) throw new Error('missing max-level turret');
    leftTurret.level = 15;
    engine.restore(levelState);
    engine.tick(0.01);
    expect(turretAt(left)?.effectiveLevel).toBe(16);
    expect(buildingStats('basic-turret', 16).value)
      .toBeGreaterThan(buildingStats('basic-turret', 15).value);

    expect(engine.moveBuilding(playerId, enhancer.id, right).ok).toBe(true);
    expect(turretAt(left)?.effectiveLevel).toBe(15);
    expect(turretAt(up)?.effectiveLevel).toBe(1);
    expect(turretAt(down)?.effectiveLevel).toBe(1);
    expect(turretAt(farRight)?.effectiveLevel).toBe(2);
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

  it('keeps building IDs unique after restoring a legacy room without persisted counters', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const tiles = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? [];
    const funded = engine.serialize();
    const player = funded.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player || tiles.length < 2) throw new Error('missing reconnect ID fixture');
    player.gold = 1_000;
    player.power = 1_000;
    engine.restore(funded);
    expect(engine.build(playerId, roomId, tiles[0] as Tile, 'basic-turret').ok).toBe(true);

    const legacy = engine.serialize();
    delete legacy.buildCounter;
    delete legacy.lootCounter;
    const restored = new GameEngine('TESTROOM', engine.map, true);
    restored.restore(legacy);
    expect(restored.build(playerId, roomId, tiles[1] as Tile, 'generator').ok).toBe(true);

    const buildings = restored.snapshot().buildings.filter((building) => building.roomId === roomId);
    expect(buildings.map((building) => building.kind)).toEqual(['basic-turret', 'generator']);
    expect(new Set(buildings.map((building) => building.id)).size).toBe(buildings.length);
  });

  it('rejects purchases when resources are insufficient', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const playerId = ids[0] as string;
    const { roomId, tile: firstTile } = assigned(engine, playerId);
    const funded = engine.serialize();
    const fundedPlayer = funded.snapshot.players.find(
      (player) => player.id === playerId,
    );
    if (!fundedPlayer) throw new Error('missing insufficient-resource player');
    fundedPlayer.power = upgradeCost('electric-coil', 1).power;
    engine.restore(funded);
    const occupied = new Set(
      engine.snapshot().buildings.map(
        (building) => `${building.tile.x},${building.tile.y}`,
      ),
    );
    const secondTile = engine.map.rooms
      .find((room) => room.id === roomId)
      ?.buildTiles.find(
        (tile) =>
          !occupied.has(`${tile.x},${tile.y}`) &&
          (tile.x !== firstTile.x || tile.y !== firstTile.y),
      );
    if (!secondTile) throw new Error('missing second free build tile');
    expect(engine.build(playerId, roomId, firstTile, 'electric-coil').ok).toBe(true);
    engine.tick(0.1);
    const result = engine.build(playerId, roomId, secondTile, 'electric-coil');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('부족');
  });

  it('sells the door repair stand for gold while other support devices use power', () => {
    expect(upgradeCost('repair-drone', 1)).toEqual({ gold: 70, power: 0 });
    expect([1, 2, 3].map((level) => buildingStats('repair-drone', level).value))
      .toEqual([15, 30, 45]);
    expect(upgradeCost('electric-coil', 1)).toEqual({ gold: 0, power: 25 });
    expect(upgradeCost('shield-device', 1)).toEqual({ gold: 0, power: 30 });

    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing repair-stand player');
    player.gold = 70;
    player.power = 0;
    engine.restore(persisted);

    expect(engine.build(playerId, roomId, tile, 'repair-drone').ok).toBe(true);
    const updated = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    expect(updated?.gold).toBe(0);
    expect(updated?.power).toBe(0);
  });

  it('builds a seven-level power gem with doubled costs and doubled gold income', () => {
    const costs = [32, 64, 128, 256, 512, 1_024, 2_048];
    const income = [8, 16, 32, 64, 128, 256, 512];
    costs.forEach((power, index) => {
      expect(upgradeCost('gem-core', index + 1)).toEqual({ gold: 0, power });
      expect(buildingStats('gem-core', index + 1).value).toBe(income[index]);
    });
    expect(maxBuildingLevel('gem-core')).toBe(7);

    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing gem owner');
    player.gold = 0;
    player.power = 32;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, tile, 'gem-core').ok).toBe(true);
    engine.tick(0.1);
    engine.tick(0.1);
    engine.tick(0.05);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBeCloseTo(9, 5);
  });

  it('nets a low-health ghost at the door even after turret damage starts its retreat', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === roomId);
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !room || !mapRoom || !ghost) throw new Error('missing ghost-net fixture');
    player.power = 250;
    ghost.position = { ...mapRoom.door };
    ghost.targetRoomId = null;
    ghost.targetPlayerId = null;
    ghost.hp = ghost.maxHp * 0.2;
    ghost.retreating = true;
    ghost.healing = false;
    ghost.stunnedUntil = 0;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, tile, 'ghost-net').ok).toBe(true);
    engine.drainEvents();
    engine.tick(0.05);
    const netted = engine.snapshot().ghosts[0];
    expect(netted?.stunnedUntil).toBeCloseTo(engine.snapshot().elapsed + 1.5, 5);
    expect(engine.drainEvents().some((event) => event.kind === 'ghost-net')).toBe(true);
  });

  it('allows one four-level range amplifier per room and adds up to four turret tiles', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const tiles = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? [];
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player || tiles.length < 3) throw new Error('missing range amplifier fixture');
    player.gold = 100;
    player.power = 10_000;
    engine.restore(persisted);

    expect(engine.build(playerId, roomId, tiles[0] as Tile, 'range-amplifier').ok).toBe(true);
    expect(engine.build(playerId, roomId, tiles[1] as Tile, 'range-amplifier').error).toContain('하나');
    const amplifierId = engine.snapshot().buildings.find((building) => building.kind === 'range-amplifier')?.id;
    if (!amplifierId) throw new Error('missing range amplifier');
    for (let level = 2; level <= 4; level += 1) expect(engine.upgrade(playerId, amplifierId).ok).toBe(true);
    expect(engine.upgrade(playerId, amplifierId).ok).toBe(false);
    expect(engine.build(playerId, roomId, tiles[1] as Tile, 'basic-turret').ok).toBe(true);

    const turret = engine.snapshot().buildings.find((building) => building.kind === 'basic-turret');
    const rangedState = engine.serialize();
    const ghost = rangedState.snapshot.ghosts[0];
    if (!turret || !ghost) throw new Error('missing amplified turret fixture');
    ghost.position = { x: turret.tile.x + 7, y: turret.tile.y };
    ghost.hp = ghost.maxHp;
    ghost.healing = false;
    ghost.retreating = false;
    ghost.path = [];
    rangedState.snapshot.ghost = ghost;
    engine.restore(rangedState);
    engine.drainEvents();
    engine.tick(0.05);
    expect(engine.drainEvents().some((event) => event.kind === 'turret-fire')).toBe(true);
  });

  it('places one dormant starter structure in every live room and transfers the claimed one', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    const initial = engine.snapshot();
    expect(initial.buildings).toHaveLength(engine.map.rooms.length);
    expect(initial.buildings.every((building) => building.id.startsWith('starter:') && !building.ownerId)).toBe(true);
    expect(new Set(initial.buildings.map((building) => building.kind))).toEqual(
      new Set(['starter-grave', 'basic-turret', 'generator']),
    );

    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const room = engine.map.rooms[0];
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!room || !player) throw new Error('missing starter ownership fixture');
    player.position = { ...room.bed };
    engine.restore(persisted);
    expect(engine.interact(playerId).ok).toBe(true);
    expect(engine.snapshot().buildings.find((building) => building.roomId === room.id)?.ownerId).toBe(playerId);
    expect(engine.snapshot().buildings.filter((building) => building.roomId !== room.id).every((building) => !building.ownerId)).toBe(true);
  });

  it('rejects construction inside another player room', () => {
    const { engine, ids } = setup(2);
    begin(engine, ids[0] as string);
    const ownerRoom = assigned(engine, ids[0] as string);
    const result = engine.build(ids[1] as string, ownerRoom.roomId, ownerRoom.tile, 'basic-turret');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('머무는 방');
  });

  it('upgrades a bed and a placed building by one level', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const playerId = ids[0] as string;
    const { roomId, tile } = assigned(engine, playerId);
    const funded = engine.serialize();
    const player = funded.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing upgrade player');
    player.gold = 100;
    engine.restore(funded);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    const building = engine.snapshot().buildings[0];
    expect(building).toBeDefined();
    expect(engine.upgrade(playerId, (building as { id: string }).id).ok).toBe(true);
    const state = engine.snapshot();
    expect(state.rooms.find((room) => room.id === roomId)?.bedLevel).toBe(2);
    expect(state.buildings[0]?.level).toBe(2);
  });

  it('allows beds to reach level ten with exactly doubled gold production after matching door gates', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing player');
    // Door and bed upgrades now both double from 20 / 25 gold respectively.
    // Keep this fixture comfortably above the full 10-level cumulative cost.
    player.gold = 1_000_000;
    player.power = 100_000;
    engine.restore(persisted);
    for (let level = 2; level <= 15; level += 1) expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    for (let level = 2; level <= 10; level += 1) expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    expect(engine.snapshot().rooms.find((room) => room.id === roomId)?.bedLevel).toBe(10);
    expect(buildingStats('bed', 10).value).toBe(512);
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(false);
  });

  it('enforces bed, guardian turret, and power costs at their specified upgrade gates', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === roomId);
    if (!player || !room) throw new Error('missing gated-upgrade fixture');
    player.gold = 200_000;
    player.power = 200_000;
    engine.restore(persisted);

    expect(upgradeCost('bed', 2)).toEqual({ gold: 25, power: 0 });
    expect(upgradeCost('bed', 6)).toEqual({ gold: 400, power: 40 });
    expect(upgradeCost('reinforced-door', 2)).toEqual({ gold: 20, power: 0 });
    expect(upgradeCost('reinforced-door', 6)).toEqual({ gold: 320, power: 32 });
    expect(upgradeCost('generator', 1)).toEqual({ gold: 150, power: 0 });
    expect(upgradeCost('generator', 5)).toEqual({ gold: 2_400, power: 240 });

    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    expect(engine.upgrade(playerId, `bed:${roomId}`).error).toContain('문 Lv.3 필요');
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    expect(engine.upgrade(playerId, `door:${roomId}`).ok).toBe(true);
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);

    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const turretId = engine.snapshot().buildings.find((building) => building.kind === 'basic-turret')?.id;
    if (!turretId) throw new Error('missing guardian turret');
    for (let level = 2; level <= 5; level += 1) expect(engine.upgrade(playerId, turretId).ok).toBe(true);
    expect(engine.upgrade(playerId, turretId).error).toContain('침대 Lv.6 필요');
  });

  it('server turrets acquire and damage the ghost', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const playerId = ids[0] as string;
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player) throw new Error('missing turret skin fixture');
    player.turretSkins['basic-turret'] = SURFER_WATER_TURRET_SKIN_ID;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const initialHp = engine.snapshot().ghost.hp;
    for (let index = 0; index < 500 && engine.snapshot().ghost.hp === initialHp; index += 1) engine.tick(0.1);
    expect(engine.snapshot().ghost.hp).toBeLessThan(initialHp);
    const fire = engine.drainEvents().find((event) => event.kind === 'turret-fire');
    expect(fire?.targetPosition).toBeDefined();
    expect(fire?.buildingKind).toBe('basic-turret');
    expect(fire?.itemId).toBe(SURFER_WATER_TURRET_SKIN_ID);
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
    const prepared = engine.serialize();
    const defender = prepared.snapshot.players.find((player) => player.id === playerId);
    if (!defender) throw new Error('missing defense fixture owner');
    defender.gold = 1_000;
    engine.restore(prepared);
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
    expect(parseClientMessage(JSON.stringify({ type: 'build', sequence: 1, timestamp: 2, roomId: 'room-1', tile: { x: 1, y: 2 }, kind: 'hide-and-seek-doll' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'activate-building', sequence: 1, timestamp: 2, buildingId: 'building-1', action: 'hide-and-seek' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'kick-player', sequence: 2, timestamp: 2, playerId: 77 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'move-building', sequence: 3, timestamp: 2, buildingId: 'building-1', tile: { x: 2.4, y: 3 } })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'move-building', sequence: 3, timestamp: 2, buildingId: 'building-1', tile: { x: 2, y: 3 } })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'remove-building', sequence: 3, timestamp: 2, buildingId: 'building-1' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'leave-room', sequence: 4, timestamp: 2 })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'quick-chat', sequence: 5, timestamp: 2, phrase: '문 위험!' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'quick-chat', sequence: 6, timestamp: 2, phrase: '아무 말' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'game-chat', sequence: 7, timestamp: 2, message: '왼쪽 방 도와줘!' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'game-chat', sequence: 8, timestamp: 2, message: '   ' })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'game-chat', sequence: 9, timestamp: 2, message: '가'.repeat(81) })).ok).toBe(false);
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

describe('nine primary ghost variants', () => {
  it('teleports to a different occupied room on its own cooldown', () => {
    const { engine, ids } = setup(2);
    begin(engine, ids[0] as string);
    const state = engine.serialize();
    const ghost = state.snapshot.ghosts[0];
    const rooms = state.snapshot.players.map((player) => player.roomId).filter((roomId): roomId is string => Boolean(roomId));
    if (!ghost || rooms.length < 2) throw new Error('missing teleport test setup');
    ghost.variant = 'teleporter';
    ghost.targetRoomId = rooms[0] as string;
    ghost.abilityCooldown = 0;
    state.snapshot.ghost = ghost;
    engine.restore(state);
    engine.tick(0.1);
    const targetRoomId = rooms[1] as string;
    const targetRoom = engine.map.rooms.find((room) => room.id === targetRoomId);
    const expectedApproach = targetRoom
      ? engine.map.corridorTiles.find(
          (tile) =>
            (tile.x !== targetRoom.door.x || tile.y !== targetRoom.door.y) &&
            Math.abs(tile.x - targetRoom.door.x) + Math.abs(tile.y - targetRoom.door.y) === 1,
        )
      : undefined;
    expect(engine.snapshot().ghost.targetRoomId).toBe(targetRoomId);
    expect(engine.snapshot().ghost.position).toEqual(expectedApproach);
    const events = engine.drainEvents();
    expect(events.some((event) => event.kind === 'ghost-skill' && event.label?.includes('순간이동'))).toBe(true);
    expect(events.some((event) => event.kind === 'door-hit')).toBe(false);
  });

  it('summons level-scaled low-HP minions that never retreat', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const state = engine.serialize();
    const ghost = state.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing undead test setup');
    ghost.variant = 'undead';
    ghost.level = 5;
    ghost.abilityCooldown = 0;
    state.snapshot.ghost = ghost;
    engine.restore(state);
    engine.tick(0.1);
    const minions = engine.snapshot().ghosts.filter((candidate) => candidate.variant === 'minion');
    expect(minions).toHaveLength(3);
    expect(minions.every((minion) => minion.maxHp === buildingStats('basic-turret', 1).value * 3.5)).toBe(true);
    const afterSummon = engine.serialize();
    for (const minion of afterSummon.snapshot.ghosts.filter((candidate) => candidate.variant === 'minion')) minion.hp = 1;
    engine.restore(afterSummon);
    engine.tick(0.1);
    expect(engine.snapshot().ghosts.filter((candidate) => candidate.variant === 'minion').every((minion) => !minion.retreating)).toBe(true);
  });

  it('gives the giant 2.5x damage and only thirty percent attack speed', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const state = engine.serialize();
    const ghost = state.snapshot.ghosts[0];
    const roomId = state.snapshot.players[0]?.roomId;
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    if (!ghost || !roomId || !mapRoom) throw new Error('missing giant test setup');
    ghost.variant = 'giant';
    ghost.targetRoomId = roomId;
    ghost.position = { ...mapRoom.door };
    ghost.attackCooldown = 0;
    ghost.abilityCooldown = 20;
    state.snapshot.ghost = ghost;
    engine.restore(state);
    engine.tick(0.1);
    const hit = engine.drainEvents().find((event) => event.kind === 'door-hit' && event.targetId === ghost.id);
    expect(hit?.amount).toBeCloseTo(BALANCE.ghost.baseDamage * 2.5, 5);
    expect(hit?.sourcePosition).toEqual(mapRoom.door);
    expect(engine.snapshot().ghost.attackCooldown).toBeCloseTo(BALANCE.ghost.attackInterval / 0.3, 5);
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
  it('maps ranked brackets to increasingly difficult non-normal stages', () => {
    expect([
      rankedStageForTier('bronze'),
      rankedStageForTier('silver'),
      rankedStageForTier('gold'),
      rankedStageForTier('platinum'),
      rankedStageForTier('diamond'),
      rankedStageForTier('master'),
      rankedStageForTier('challenger'),
    ]).toEqual([
      'nightmare-1',
      'hell-1',
      'inferno-1',
      'epic-1',
      'mythic-1',
      'legendary-1',
      'legendary-15',
    ]);
    expect(rankedMatchmakingTier('silver', false)).toBe('bronze');
    expect(rankedMatchmakingTier('silver', true)).toBe('silver');
  });

  it('routes three bots through doorways and claims distinct beds before countdown ends', () => {
    const engine = new GameEngine('BOTPATH1', generateMap(42_424), false);
    const host = engine.join({ nickname: '사람생존자', deviceId: 'device-human-path' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);
    for (let index = 0; index < 190 && engine.snapshot().players.filter((player) => player.isBot && player.roomId).length < 3; index += 1) engine.tick(0.1);
    const state = engine.snapshot();
    const bots = state.players.filter((player) => player.isBot);
    expect(bots.every((bot) => bot.roomId)).toBe(true);
    expect(new Set(bots.map((bot) => bot.roomId)).size).toBe(3);
    expect(state.status).toBe('COUNTDOWN');
    expect(state.countdown).toBeGreaterThan(0);
    expect(bots.every((bot) => bot.velocity.x === 0 && bot.velocity.y === 0)).toBe(true);
  });

  it('does not displace a moving corridor player when bots claim rooms', () => {
    const engine = new GameEngine('BOTCLAIMMOVE', generateMap(42_425), false);
    const host = engine.join({ nickname: '이동생존자', deviceId: 'device-human-moving' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);

    const roomFloors = new Set(
      engine.map.rooms.flatMap((room) =>
        room.floorTiles.map((tile) => `${tile.x},${tile.y}`),
      ),
    );
    const doors = new Set(
      engine.map.rooms.map((room) => `${room.door.x},${room.door.y}`),
    );
    const pair = engine.map.corridorTiles
      .filter((tile) => !doors.has(`${tile.x},${tile.y}`))
      .map((first) => ({
        first,
        second: engine.map.corridorTiles.find(
          (candidate) =>
            candidate.x === first.x + 1 &&
            candidate.y === first.y &&
            !doors.has(`${candidate.x},${candidate.y}`) &&
            !roomFloors.has(`${candidate.x},${candidate.y}`),
        ),
      }))
      .find(({ first, second }) =>
        Boolean(second) && !roomFloors.has(`${first.x},${first.y}`),
      );
    if (!pair?.second) throw new Error('missing safe corridor movement fixture');

    const persisted = engine.serialize();
    const human = persisted.snapshot.players.find(
      (player) => player.id === host.player.id,
    );
    if (!human) throw new Error('missing moving human fixture');
    human.position = { ...pair.first };
    human.roomId = null;
    human.bedIndex = null;
    human.velocity = { x: 0, y: 0 };
    // This scenario isolates authoritative movement from bot claim snapshots.
    // A separate contact test covers blackout deaths.
    persisted.snapshot.ghosts.forEach((ghost) => {
      ghost.stunnedUntil = 1_000;
    });
    engine.restore(persisted);

    let target = pair.second;
    let previous = { ...pair.first };
    let claimedTransitions = 0;
    let previousClaimed = 0;
    for (let index = 0; index < 400 && previousClaimed < 3; index += 1) {
      const current = engine.snapshot().players.find(
        (player) => player.id === host.player.id,
      );
      if (!current) throw new Error('moving human disappeared');
      if (Math.hypot(target.x - current.position.x, target.y - current.position.y) < 0.16) {
        target = target === pair.second ? pair.first : pair.second;
      }
      const dx = target.x - current.position.x;
      const dy = target.y - current.position.y;
      const magnitude = Math.max(0.0001, Math.hypot(dx, dy));
      expect(engine.setMovement(host.player.id, dx / magnitude, dy / magnitude, index + 1).ok).toBe(true);
      engine.tick(0.1);
      const after = engine.snapshot();
      const moved = after.players.find((player) => player.id === host.player.id);
      if (!moved) throw new Error('moving human disappeared after tick');
      expect(Math.hypot(moved.position.x - previous.x, moved.position.y - previous.y))
        .toBeLessThanOrEqual(BALANCE.player.speed * 0.1 + 0.03);
      previous = { ...moved.position };
      const claimed = after.players.filter((player) => player.isBot && player.roomId).length;
      if (claimed > previousClaimed) claimedTransitions += claimed - previousClaimed;
      previousClaimed = claimed;
    }
    // Three-bot occupancy is covered by the dedicated BOTPATH1 case above.
    // This fixture only needs repeated claim snapshots while the human keeps
    // moving; two independent room claims exercise that regression fully.
    expect(claimedTransitions).toBeGreaterThanOrEqual(2);
  });

  it('keeps movement continuous in room A when a bot claims separate room B', () => {
    const engine = new GameEngine('BOTCLAIMSEPARATE', generateMap(64_281), false);
    const host = engine.join({ nickname: '이동생존자', deviceId: 'device-separate-room' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);

    const playerRoom = engine.map.rooms[0];
    const botRoom = engine.map.rooms[1];
    const bot = engine.snapshot().players.find((player) => player.isBot);
    const botBed = botRoom?.beds[0];
    const pair = playerRoom?.floorTiles
      .map((first) => ({
        first,
        second: playerRoom.floorTiles.find(
          (candidate) =>
            Math.abs(candidate.x - first.x) + Math.abs(candidate.y - first.y) === 1,
        ),
      }))
      .find(({ second }) => Boolean(second));
    if (!playerRoom || !botRoom || !bot || !botBed || !pair?.second) {
      throw new Error('missing separate-room claim fixture');
    }

    const persisted = engine.serialize();
    const humanState = persisted.snapshot.players.find(
      (player) => player.id === host.player.id,
    );
    const botState = persisted.snapshot.players.find(
      (player) => player.id === bot.id,
    );
    if (!humanState || !botState) throw new Error('missing crossing players');
    humanState.position = { ...pair.first };
    humanState.roomId = null;
    humanState.bedIndex = null;
    humanState.velocity = { x: 0, y: 0 };
    botState.position = { ...botBed };
    botState.roomId = null;
    botState.bedIndex = null;
    botState.velocity = { x: 0, y: 0 };
    engine.restore(persisted);

    const dx = pair.second.x - pair.first.x;
    const dy = pair.second.y - pair.first.y;
    expect(engine.setMovement(host.player.id, dx, dy, 1).ok).toBe(true);
    expect(engine.interact(bot.id).ok).toBe(true);
    engine.tick(0.1);

    const after = engine.snapshot();
    const moved = after.players.find((player) => player.id === host.player.id);
    const claimedBot = after.players.find((player) => player.id === bot.id);
    expect(claimedBot?.roomId).toBe(botRoom.id);
    expect(claimedBot?.roomId).not.toBe(playerRoom.id);
    expect(moved?.roomId).toBeNull();
    expect(moved?.velocity).toEqual({ x: dx, y: dy });
    expect(
      playerRoom.floorTiles.some(
        (tile) =>
          tile.x === Math.round(moved?.position.x ?? Number.NaN) &&
          tile.y === Math.round(moved?.position.y ?? Number.NaN),
      ),
    ).toBe(true);
    expect(
      Math.hypot(
        (moved?.position.x ?? pair.first.x) - pair.first.x,
        (moved?.position.y ?? pair.first.y) - pair.first.y,
      ),
    ).toBeGreaterThan(0.2);
  });

  it('keeps sleep interaction available at a legal room-tile corner after another bot claims', () => {
    const engine = new GameEngine('BOTCLAIMSLEEP', generateMap(71_904), false);
    const host = engine.join({ nickname: '침대접근자', deviceId: 'device-room-corner' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);

    const playerRoom = engine.map.rooms[0];
    const botRoom = engine.map.rooms[1];
    const playerBed = playerRoom?.beds[0];
    const botBed = botRoom?.beds[0];
    const bot = engine.snapshot().players.find((player) => player.isBot);
    if (!playerRoom || !botRoom || !playerBed || !botBed || !bot) {
      throw new Error('missing room-corner claim fixture');
    }

    const persisted = engine.serialize();
    const humanState = persisted.snapshot.players.find(
      (player) => player.id === host.player.id,
    );
    const botState = persisted.snapshot.players.find(
      (player) => player.id === bot.id,
    );
    if (!humanState || !botState) throw new Error('missing room-corner players');
    humanState.position = { x: playerBed.x + 0.49, y: playerBed.y + 0.49 };
    humanState.roomId = null;
    humanState.bedIndex = null;
    botState.position = { ...botBed };
    botState.roomId = null;
    botState.bedIndex = null;
    engine.restore(persisted);

    expect(isPositionOnRoomFloor(playerRoom, humanState.position)).toBe(true);
    expect(
      Math.hypot(
        humanState.position.x - playerBed.x,
        humanState.position.y - playerBed.y,
      ),
    ).toBeGreaterThan(0.68);
    expect(engine.interact(bot.id).ok).toBe(true);
    expect(engine.interact(host.player.id).ok).toBe(true);

    const after = engine.snapshot();
    expect(after.players.find((player) => player.id === bot.id)?.roomId).toBe(botRoom.id);
    expect(after.players.find((player) => player.id === host.player.id)?.roomId)
      .toBe(playerRoom.id);
  });

  it('retargets an undead and its minions when a minion defeats the last survivor in a room', () => {
    const { engine, ids } = setup(2);
    begin(engine, ids[0] as string);
    const beforeSummon = engine.serialize();
    const undead = beforeSummon.snapshot.ghosts[0];
    if (!undead) throw new Error('missing undead fixture');
    undead.variant = 'undead';
    undead.abilityCooldown = 0;
    beforeSummon.snapshot.ghost = undead;
    engine.restore(beforeSummon);
    engine.tick(0.1);

    const persisted = engine.serialize();
    const victim = persisted.snapshot.players.find(
      (player) => player.id === ids[0],
    );
    const survivor = persisted.snapshot.players.find(
      (player) => player.id === ids[1],
    );
    const parent = persisted.snapshot.ghosts.find(
      (ghost) => ghost.variant === 'undead',
    );
    const minion = persisted.snapshot.ghosts.find(
      (ghost) => ghost.variant === 'minion',
    );
    const victimRoom = engine.map.rooms.find(
      (room) => room.id === victim?.roomId,
    );
    const victimRoomState = persisted.snapshot.rooms.find(
      (room) => room.id === victim?.roomId,
    );
    if (
      !victim ||
      !survivor?.roomId ||
      !parent ||
      !minion ||
      !victimRoom ||
      !victimRoomState
    ) {
      throw new Error('incomplete undead retarget fixture');
    }

    victimRoomState.doorHp = 0;
    parent.position = { ...victim.position };
    parent.targetRoomId = victim.roomId;
    parent.targetPlayerId = null;
    parent.attackCooldown = 100;
    parent.abilityCooldown = 100;
    parent.path = [];
    minion.position = { ...victim.position };
    minion.targetRoomId = victim.roomId;
    minion.targetPlayerId = null;
    minion.attackCooldown = 0;
    minion.path = [];
    persisted.snapshot.ghost = parent;
    engine.restore(persisted);

    engine.tick(0.1);
    const afterDefeat = engine.snapshot();
    expect(
      afterDefeat.players.find((player) => player.id === victim.id)?.alive,
    ).toBe(false);
    expect(
      afterDefeat.ghosts
        .filter((ghost) => ghost.variant === 'undead' || ghost.variant === 'minion')
        .every(
          (ghost) =>
            ghost.targetRoomId !== victim.roomId &&
            ghost.targetPlayerId !== victim.id,
        ),
    ).toBe(true);

    const parentAtDefeat = afterDefeat.ghosts.find(
      (ghost) => ghost.id === parent.id,
    );
    for (let index = 0; index < 8; index += 1) engine.tick(0.1);
    const retargeted = engine.snapshot().ghosts.find(
      (ghost) => ghost.id === parent.id,
    );
    expect(retargeted?.targetRoomId).toBe(survivor.roomId);
    expect(
      Math.hypot(
        (retargeted?.position.x ?? 0) - (parentAtDefeat?.position.x ?? 0),
        (retargeted?.position.y ?? 0) - (parentAtDefeat?.position.y ?? 0),
      ),
    ).toBeGreaterThan(0.05);
  });

  it('keeps each unclaimed bot on its reserved bed instead of re-ranking targets every tick', () => {
    const engine = new GameEngine('BOTRESERVE', generateMap(79_113), false);
    const host = engine.join({ nickname: '예약 확인', deviceId: 'device-bot-reserve' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);
    engine.tick(0.1);
    const initialTargets = new Map(
      engine.serialize().botRuntime
        .filter(([, runtime]) => runtime.bedTarget)
        .map(([botId, runtime]) => [botId, `${runtime.bedTarget?.roomId}:${runtime.bedTarget?.bedIndex}`]),
    );
    expect(initialTargets.size).toBe(3);
    expect(new Set(initialTargets.values()).size).toBe(3);
    const previousDirections = new Map<string, { x: number; y: number }>();
    for (let index = 0; index < 15; index += 1) {
      engine.tick(0.1);
      const state = engine.snapshot();
      for (const bot of state.players.filter((player) => player.isBot && !player.roomId)) {
        const target = engine.serialize().botRuntime.find(([botId]) => botId === bot.id)?.[1].bedTarget;
        expect(`${target?.roomId}:${target?.bedIndex}`).toBe(initialTargets.get(bot.id));
        const previous = previousDirections.get(bot.id);
        if (previous) {
          const dot = previous.x * bot.velocity.x + previous.y * bot.velocity.y;
          expect(dot).toBeGreaterThanOrEqual(-0.05);
        }
        previousDirections.set(bot.id, bot.velocity);
      }
    }
  });

  it('keeps the original bot base speed while applying rank scaling', () => {
    const engine = new GameEngine('BOTSPEED', generateMap(65_042), false);
    const host = engine.join({ nickname: '속도 확인', deviceId: 'device-bot-speed' });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);
    const persisted = engine.serialize();
    const human = persisted.snapshot.players.find((player) => player.id === host.player.id);
    const bot = persisted.snapshot.players.find((player) => player.isBot);
    if (!human || !bot) throw new Error('missing speed fixture');
    const corridorStart = engine.map.corridorTiles.find((tile) =>
      isWalkableArea(
        engine.map,
        tile.x + 1,
        tile.y,
        BALANCE.player.collisionRadius,
      ),
    );
    if (!corridorStart) throw new Error('missing open corridor fixture');
    for (const player of [human, bot]) {
      player.soloRank = 'expert';
      player.multiplayerRank = 'expert';
      player.position = { ...corridorStart };
      player.velocity = { x: 1, y: 0 };
    }
    engine.restore(persisted);
    engine.tick(0.1);
    const after = engine.snapshot();
    const movedHuman = after.players.find((player) => player.id === human.id);
    const movedBot = after.players.find((player) => player.id === bot.id);
    const humanDistance = (movedHuman?.position.x ?? 0) - corridorStart.x;
    const botDistance = (movedBot?.position.x ?? 0) - corridorStart.x;
    const rankMultiplier = rankBenefits('expert').speedMultiplier;
    expect(botDistance).toBeCloseTo(
      4.8 * rankMultiplier * characterTraitForAppearance(bot.appearance).unclaimedMoveSpeedMultiplier * 0.1,
      5,
    );
    expect(humanDistance).toBeCloseTo(
      BALANCE.player.speed * rankMultiplier * characterTraitForAppearance(human.appearance).unclaimedMoveSpeedMultiplier * 0.1,
      5,
    );
    expect(humanDistance).toBeGreaterThan(botDistance);
  });

  it('makes a hard bot answer door pressure with a nearby turret before economy', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const snapshot = engine.snapshot();
    const bot = snapshot.players[0];
    const room = snapshot.rooms.find((candidate) => candidate.id === bot?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === room?.id);
    const ghost = snapshot.ghosts[0];
    if (!bot || !room || !mapRoom || !ghost) throw new Error('missing bot pressure fixture');
    bot.isBot = true;
    bot.gold = 1_000;
    bot.power = 1_000;
    snapshot.buildings = snapshot.buildings.filter((building) => building.roomId !== room.id);
    ghost.targetRoomId = room.id;
    ghost.retreating = false;
    ghost.healing = false;
    const intent = decideBotIntent(bot, snapshot, engine.map, 'hard');
    expect(intent).toMatchObject({
      type: 'build',
      roomId: room.id,
      kind: 'basic-turret',
    });
    if (intent.type !== 'build') throw new Error('hard bot did not build a turret');
    const nearestDistance = Math.min(
      ...mapRoom.buildTiles.map((tile) =>
        Math.hypot(tile.x - mapRoom.door.x, tile.y - mapRoom.door.y),
      ),
    );
    expect(
      Math.hypot(intent.tile.x - mapRoom.door.x, intent.tile.y - mapRoom.door.y),
    ).toBeCloseTo(nearestDistance);
  });

  it('makes even an easy bot establish firepower instead of deliberately idling', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const snapshot = engine.snapshot();
    const bot = snapshot.players[0];
    const room = snapshot.rooms.find((candidate) => candidate.id === bot?.roomId);
    if (!bot || !room) throw new Error('missing easy bot fixture');
    bot.isBot = true;
    bot.nickname = '새벽봇 1';
    bot.gold = 1_000;
    bot.power = 1_000;
    snapshot.buildings = snapshot.buildings.filter(
      (building) => building.roomId !== room.id,
    );
    const intent = decideBotIntent(bot, snapshot, engine.map, 'easy');
    expect(intent).toMatchObject({
      type: 'build',
      roomId: room.id,
      kind: 'basic-turret',
    });
  });

  it('gives the three stable bot roles distinct power-panel strategies', () => {
    expect(botStrategyFor({ id: 'bot-a', nickname: '새벽봇 1' })).toBe('guardian');
    expect(botStrategyFor({ id: 'bot-b', nickname: '새벽봇 2' })).toBe('gunner');
    expect(botStrategyFor({ id: 'bot-c', nickname: '새벽봇 3' })).toBe('controller');

    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const snapshot = engine.snapshot();
    const bot = snapshot.players[0];
    const room = snapshot.rooms.find((candidate) => candidate.id === bot?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === room?.id);
    if (!bot || !room || !mapRoom) throw new Error('missing role strategy fixture');
    bot.isBot = true;
    bot.nickname = '새벽봇 3';
    bot.gold = 1_000;
    bot.power = 1_000;
    const tile = mapRoom.buildTiles[0];
    if (!tile) throw new Error('missing role strategy tile');
    snapshot.buildings = [{
      id: 'controller-panel',
      kind: 'power-panel',
      roomId: room.id,
      ownerId: bot.id,
      skinId: '',
      tile: { ...tile, roomId: room.id },
      level: 1,
      cooldown: 0,
      hp: 100,
      investedGold: 1_000,
      investedPower: 0,
      investmentByPlayer: {},
      powerPanelMode: 'attack',
    }];
    const intent = decideBotIntent(bot, snapshot, engine.map, 'hard');
    expect(intent).toEqual({
      type: 'activate-building',
      buildingId: 'controller-panel',
      action: 'production',
    });
  });

  it('moves a distant starter turret toward the door before buying another building', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const snapshot = engine.snapshot();
    const bot = snapshot.players[0];
    const room = snapshot.rooms.find((candidate) => candidate.id === bot?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === room?.id);
    if (!bot || !room || !mapRoom) throw new Error('missing bot relocation fixture');
    bot.isBot = true;
    bot.gold = 1_000;
    bot.power = 1_000;
    const farTile = [...mapRoom.buildTiles].sort(
      (left, right) =>
        Math.hypot(right.x - mapRoom.door.x, right.y - mapRoom.door.y) -
        Math.hypot(left.x - mapRoom.door.x, left.y - mapRoom.door.y),
    )[0];
    if (!farTile) throw new Error('missing distant turret tile');
    snapshot.buildings = [{
      id: 'bot-starter-turret',
      kind: 'basic-turret',
      roomId: room.id,
      ownerId: bot.id,
      skinId: '',
      tile: { ...farTile, roomId: room.id },
      level: 1,
      cooldown: 0,
      hp: 100,
      investedGold: 0,
      investedPower: 0,
      investmentByPlayer: {},
    }];
    const intent = decideBotIntent(bot, snapshot, engine.map, 'hard');
    expect(intent).toMatchObject({
      type: 'move-building',
      buildingId: 'bot-starter-turret',
    });
    if (intent.type !== 'move-building') throw new Error('hard bot did not move its starter turret');
    expect(
      Math.hypot(intent.tile.x - mapRoom.door.x, intent.tile.y - mapRoom.door.y),
    ).toBeLessThan(
      Math.hypot(farTile.x - mapRoom.door.x, farTile.y - mapRoom.door.y),
    );
  });

  it('reaches a randomly selected occupied door across the expanded map', () => {
    const engine = new GameEngine('GHOSTPATH', generateMap(51_515), false);
    const player = engine.join({ nickname: '문지기', deviceId: 'device-ghost-path' });
    begin(engine, player.player.id);
    engine.drainEvents();
    const startedAt = engine.snapshot().elapsed;
    let hit = false;
    for (let index = 0; index < 300 && !hit; index += 1) {
      engine.tick(0.1);
      hit = engine.drainEvents().some((event) => event.kind === 'door-hit');
    }
    expect(hit).toBe(true);
    expect(engine.snapshot().elapsed - startedAt).toBeLessThanOrEqual(30);
  });

  it('chases an unclaimed survivor at least 1.5x faster after preparation', () => {
    const engine = new GameEngine('OUTSIDECHASE', generateMap(51_516), false);
    const joined = engine.join({
      nickname: '복도생존자',
      deviceId: 'device-outside-chase',
      soloRank: 'beginner',
      multiplayerRank: 'beginner',
    });
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === joined.player.id,
    );
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !ghost) throw new Error('missing outside chase fixture');

    const corridorByRow = new Map<number, Tile[]>();
    for (const tile of engine.map.corridorTiles) {
      const row = corridorByRow.get(tile.y) ?? [];
      row.push(tile);
      corridorByRow.set(tile.y, row);
    }
    const straight = [...corridorByRow.values()]
      .map((row) => row.sort((a, b) => a.x - b.x))
      .flatMap((row) =>
        row.flatMap((start, index) => {
          const end = row[index + 5];
          if (!end || end.x - start.x !== 5) return [];
          return [{ start, end }];
        }),
      )[0];
    if (!straight) throw new Error('missing straight corridor chase fixture');

    persisted.snapshot.status = 'PLAYING';
    persisted.snapshot.countdown = 0;
    player.position = { ...straight.end };
    player.roomId = null;
    player.velocity = { x: 0, y: 0 };
    ghost.position = { ...straight.start };
    ghost.variant = 'brute';
    ghost.path = [];
    ghost.targetRoomId = null;
    ghost.targetPlayerId = null;
    ghost.skillCooldown = 999;
    ghost.abilityCooldown = 999;
    ghost.slowUntil = 999;
    ghost.slowMultiplier = 0.35;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);

    const before = { ...engine.snapshot().ghost.position };
    engine.tick(0.1);
    const after = engine.snapshot().ghost.position;
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    expect(moved).toBeGreaterThanOrEqual(
      BALANCE.player.speed *
        BALANCE.ghost.outsideTargetMinimumPlayerMultiplier *
        0.1 -
        0.001,
    );
  });

  it('ejects a ghost from a sealed room before it can hit the door from behind', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const player = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === player?.roomId);
    const roomState = engine.snapshot().rooms.find((room) => room.id === player?.roomId);
    if (!player || !mapRoom || !roomState) throw new Error('missing sealed-room fixture');
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing ghost fixture');
    ghost.position = { ...(mapRoom.floorTiles[0] as Tile) };
    ghost.targetRoomId = mapRoom.id;
    ghost.targetPlayerId = playerId;
    ghost.attackCooldown = 0;
    ghost.skillCooldown = 999;
    ghost.abilityCooldown = 999;
    engine.restore(persisted);
    engine.drainEvents();
    engine.tick(0.1);
    const after = engine.snapshot();
    const recoveredGhost = after.ghosts[0];
    const afterRoom = after.rooms.find((room) => room.id === mapRoom.id);
    expect(afterRoom?.doorHp).toBe(roomState.doorHp);
    expect(
      mapRoom.floorTiles.some(
        (tile) =>
          tile.x === Math.round(recoveredGhost?.position.x ?? -1) &&
          tile.y === Math.round(recoveredGhost?.position.y ?? -1),
      ),
    ).toBe(false);
    expect(
      engine.map.corridorTiles.some(
        (tile) =>
          tile.x === Math.round(recoveredGhost?.position.x ?? -1) &&
          tile.y === Math.round(recoveredGhost?.position.y ?? -1),
      ),
    ).toBe(true);
    expect(engine.drainEvents().some((event) => event.kind === 'door-hit')).toBe(false);
  });

  it('pays bed income once per second and doubles the paid amount by level', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const persistedPlayer = persisted.snapshot.players.find((player) => player.id === playerId);
    if (!persistedPlayer) throw new Error('missing bed income player');
    persistedPlayer.gold = 100;
    persistedPlayer.goldIncomeElapsed = 0;
    engine.restore(persisted);
    engine.drainEvents();
    const before = engine.snapshot().players[0]?.gold ?? 0;
    for (let index = 0; index < 4; index += 1) engine.tick(0.05);
    expect(engine.snapshot().players[0]?.gold).toBeCloseTo(before, 5);
    expect(engine.drainEvents().some((event) => event.kind === 'gold')).toBe(false);
    engine.tick(0.05);
    expect(engine.snapshot().players[0]?.gold).toBeCloseTo(before + 1, 5);
    expect(engine.drainEvents().some((event) => event.kind === 'gold' && event.amount === 1)).toBe(true);
    const roomId = engine.snapshot().players[0]?.roomId as string;
    expect(engine.upgrade(playerId, `bed:${roomId}`).ok).toBe(true);
    expect(
      engine.drainEvents().some(
        (event) => event.kind === 'upgrade' && event.label === '꿈결 침대 Lv.2',
      ),
    ).toBe(true);
    const upgraded = engine.snapshot().players[0]?.gold ?? 0;
    for (let index = 0; index < 4; index += 1) engine.tick(0.05);
    expect(engine.snapshot().players[0]?.gold).toBeCloseTo(upgraded, 5);
    expect(engine.drainEvents().some((event) => event.kind === 'gold')).toBe(false);
    engine.tick(0.05);
    expect(engine.snapshot().players[0]?.gold).toBeCloseTo(upgraded + 2, 5);
    expect(engine.drainEvents().some((event) => event.kind === 'gold' && event.amount === 2)).toBe(true);
  });

  it('emits combined bed-trait income at the bed while keeping item and building income separate', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const generatorSetup = engine.serialize();
    const generatorOwner = generatorSetup.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!generatorOwner) throw new Error('missing generator owner');
    generatorOwner.gold = 200;
    engine.restore(generatorSetup);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
    const gemTile = mapRoom?.buildTiles.find((candidate) => candidate.x !== tile.x || candidate.y !== tile.y);
    if (!gemTile) throw new Error('missing gem tile');
    engine.drainEvents();
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing income player');
    player.power = 125;
    player.appearance = { character: 'character-puppy', skin: 'skin-look-puppy-surfer' };
    player.items = [{ itemId: 'gold-frog', label: '황금 두꺼비', rarity: 'epic', count: 1 }];
    player.goldIncomeElapsed = 0;
    player.powerIncomeElapsed = 0;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, gemTile, 'gem-core').ok).toBe(true);
    engine.drainEvents();
    for (let index = 0; index < 4; index += 1) engine.tick(0.05);
    expect(engine.drainEvents().some((event) => event.kind === 'power')).toBe(false);
    engine.tick(0.05);
    const events = engine.drainEvents();
    expect(events.some((event) => event.kind === 'gold' && event.amount === 6 && event.position?.x === mapRoom?.bed.x && event.position?.y === mapRoom?.bed.y)).toBe(true);
    expect(events.some((event) => event.kind === 'gold' && event.label === '특성')).toBe(false);
    expect(events.some((event) => event.kind === 'gold' && event.label === '보관 아이템' && event.amount === 5)).toBe(true);
    expect(events.some((event) => event.kind === 'gold' && event.amount === 8 && event.position?.x === gemTile.x && event.position?.y === gemTile.y)).toBe(true);
    expect(events.some((event) => event.kind === 'power' && event.amount === 1 && event.position?.x === tile.x && event.position?.y === tile.y)).toBe(true);
  });

  it('keeps generator upgrades on one-second payouts while doubling the power amount through level ten', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const generatorSetup = engine.serialize();
    const generatorOwner = generatorSetup.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!generatorOwner) throw new Error('missing generator owner');
    generatorOwner.gold = 200;
    engine.restore(generatorSetup);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
    const generatorId = engine.snapshot().buildings.find((building) => building.kind === 'generator')?.id;
    if (!generatorId) throw new Error('missing generator');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing generator owner');
    player.gold = 400_000;
    player.power = 100_000;
    player.powerIncomeElapsed = 0;
    engine.restore(persisted);
    for (let level = 2; level <= 10; level += 1) expect(engine.upgrade(playerId, generatorId).ok).toBe(true);
    expect(maxBuildingLevel('generator')).toBe(10);
    expect(buildingStats('generator', 10).value).toBe(512);
    const before = engine.snapshot().players.find((candidate) => candidate.id === playerId)?.power ?? 0;
    engine.drainEvents();
    for (let index = 0; index < 4; index += 1) engine.tick(0.05);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.power).toBeCloseTo(before, 5);
    engine.tick(0.05);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.power).toBeCloseTo(before + 512, 5);
    expect(engine.drainEvents().some((event) => event.kind === 'power' && event.amount === 512)).toBe(true);
  });

  it('starts bed gold income while the ghost patrols during countdown', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
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
    expect(
      engine.map.corridorTiles.some(
        (tile) =>
          tile.x === Math.round(state.ghost.position.x) &&
          tile.y === Math.round(state.ghost.position.y),
      ),
    ).toBe(true);
  });

  it('starts with twenty gold and pays no bed income before a bed is occupied', () => {
    const { engine, ids } = setup(1, true);
    const playerId = ids[0] as string;
    expect(engine.snapshot().players.find((player) => player.id === playerId)?.gold).toBe(20);
    expect(engine.start(playerId).ok).toBe(true);
    advanceFrozenIntros(engine);
    engine.drainEvents();
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    expect(engine.snapshot().players.find((player) => player.id === playerId)?.gold).toBe(20);
    expect(engine.drainEvents().some((event) => event.kind === 'gold')).toBe(false);
  });

  it('keeps the guardian turret as the sole live attack turret and makes frost spray a power-only utility', () => {
    expect(buildingStats('basic-turret', 1)).toMatchObject({ gold: 10, power: 0, range: 4 });
    expect(maxBuildingLevel('basic-turret')).toBe(15);
    expect(upgradeCost('basic-turret', 2)).toEqual({ gold: 20, power: 0 });
    expect(upgradeCost('basic-turret', 3)).toEqual({ gold: 40, power: 0 });
    expect(upgradeCost('basic-turret', 4)).toEqual({ gold: 80, power: 0 });

    expect(buildingStats('frost-turret', 1)).toMatchObject({ gold: 0, power: 200, value: 0.16, range: 5 });
    expect(maxBuildingLevel('frost-turret')).toBe(1);
  });

  it('rejects legacy multi-turret construction while allowing guardian and frost spray', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const state = engine.serialize();
    const player = state.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing live-build owner');
    player.gold = 1_000;
    player.power = 1_000;
    engine.restore(state);

    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const nextTile = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles.find(
      (candidate) => !engine.snapshot().buildings.some(
        (building) => building.tile.x === candidate.x && building.tile.y === candidate.y,
      ),
    );
    if (!nextTile) throw new Error('missing legacy-build tile');
    expect(engine.build(playerId, roomId, nextTile, 'rapid-turret').error).toContain('수호 포탑');
    expect(engine.build(playerId, roomId, nextTile, 'arc-turret').error).toContain('수호 포탑');
    expect(engine.build(playerId, roomId, nextTile, 'golden-turret').error).toContain('수호 포탑');
    expect(engine.build(playerId, roomId, nextTile, 'frost-turret').ok).toBe(true);
  });

  it('unlocks one golden turret installation for each golden ticket', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const state = engine.serialize();
    const player = state.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing golden ticket owner');
    player.items.push({
      itemId: 'golden-ticket',
      label: '황금 티켓',
      rarity: 'legendary',
      count: 1,
    });
    engine.restore(state);

    expect(engine.build(playerId, roomId, tile, 'golden-turret').ok).toBe(true);
  });

  it('converts a lucky-machine golden ticket in place instead of unlocking the install catalog', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'lucky-machine').ok).toBe(true);
    const prepared = engine.serialize();
    const ticket = prepared.snapshot.buildings.find((building) => building.kind === 'lucky-machine');
    const player = prepared.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!ticket || !player) throw new Error('missing placed golden ticket');
    ticket.kind = 'random-item';
    ticket.itemId = 'golden-ticket';
    player.items = [];
    engine.restore(prepared);

    expect(engine.handle(playerId, envelope({
      type: 'activate-building',
      buildingId: ticket.id,
      action: 'install-golden-turret',
    }, 902)).ok).toBe(true);
    const converted = engine.snapshot().buildings.find((building) => building.id === ticket.id);
    expect(converted).toMatchObject({ kind: 'golden-turret' });
    expect(converted).not.toHaveProperty('itemId');
  });

  it('makes the golden turret fire twice as fast and pay a doubling gold bounty per hit', () => {
    for (let level = 1; level <= 10; level += 1) {
      expect(buildingStats('golden-turret', level).rate).toBeCloseTo(
        buildingStats('basic-turret', level).rate / 2,
        2,
      );
    }
    expect([1, 2, 3, 10].map(goldenTurretGoldPerShot)).toEqual([8, 16, 32, 4096]);

    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const prepared = engine.serialize();
    const player = prepared.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing golden bounty owner');
    player.items.push({ itemId: 'golden-ticket', label: '황금 티켓', rarity: 'legendary', count: 1 });
    engine.restore(prepared);
    expect(engine.build(playerId, roomId, tile, 'golden-turret').ok).toBe(true);

    const armed = engine.serialize();
    const owner = armed.snapshot.players.find((candidate) => candidate.id === playerId);
    const ghost = armed.snapshot.ghosts[0];
    const turret = armed.snapshot.buildings.find((building) => building.kind === 'golden-turret');
    if (!owner || !ghost || !turret) throw new Error('missing golden bounty fixture');
    const goldBefore = owner.gold;
    ghost.position = { ...turret.tile };
    ghost.hp = ghost.maxHp = 10_000;
    ghost.retreating = false;
    ghost.healing = false;
    turret.cooldown = 0;
    engine.restore(armed);
    engine.drainEvents();
    engine.tick(0.01);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBe(goldBefore + 8);
    expect(engine.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'gold', amount: 8, position: turret.tile }),
    ]));
  });

  it('authoritatively prevents base turret fire beyond four tiles', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);

    const distantTile = engine.map.walkable.find((candidate) => {
      const distanceToTurret = Math.hypot(candidate.x - tile.x, candidate.y - tile.y);
      return distanceToTurret > 4.1 && distanceToTurret < 6;
    });
    if (!distantTile) throw new Error('missing distant turret fixture');

    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing distant ghost fixture');
    ghost.position = { ...distantTile };
    ghost.hp = ghost.maxHp;
    ghost.healing = false;
    ghost.retreating = false;
    ghost.path = [];
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    engine.drainEvents();

    engine.tick(0.1);
    expect(engine.drainEvents().some((event) => event.kind === 'turret-fire')).toBe(false);
  });

  it('lets the long-scope random item extend authoritative turret range by two tiles', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);

    const distantTile = engine.map.walkable.find((candidate) => {
      const distanceToTurret = Math.hypot(candidate.x - tile.x, candidate.y - tile.y);
      return distanceToTurret > 4.1 && distanceToTurret < 6;
    });
    const scope = RANDOM_ITEMS.find((item) => item.id === 'long-scope');
    if (!distantTile || !scope) throw new Error('missing long-scope range fixture');

    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !ghost) throw new Error('missing long-scope player fixture');
    player.items = [{ itemId: scope.id, label: scope.label, rarity: scope.rarity, count: 1 }];
    ghost.position = { ...distantTile };
    ghost.hp = ghost.maxHp;
    ghost.healing = false;
    ghost.retreating = false;
    ghost.path = [];
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    engine.drainEvents();

    engine.tick(0.1);
    expect(engine.drainEvents().some((event) => event.kind === 'turret-fire')).toBe(true);
  });

  it('lets an authoritative turret reach level 15 but never level 16', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === roomId);
    if (!player || !room) throw new Error('missing player');
    player.gold = 500_000;
    player.power = 99_999;
    room.bedLevels = room.bedLevels.map(() => 15);
    room.bedLevel = 15;
    room.doorLevel = 15;
    room.doorMaxHp = buildingStats('reinforced-door', 15).value;
    room.doorHp = room.doorMaxHp;
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
    expect(upgraded?.doorMaxHp).toBe(150);
    expect(upgraded?.doorHp).toBe(150);
  });

  it('upgrades an intact door through fifteen levels but never level sixteen', () => {
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
    expect(door?.doorMaxHp).toBe(4_360);
    expect(engine.upgrade(playerId, `door:${player.roomId}`).ok).toBe(false);
  });

  it('regenerates five door HP after five quiet seconds and then every second', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === player?.roomId);
    const ghost = persisted.snapshot.ghosts[0];
    if (!room || !ghost) throw new Error('missing passive door repair fixture');
    room.doorHp = room.doorMaxHp - 30;
    room.lastDoorHitAt = persisted.snapshot.elapsed;
    room.doorRegenAccumulator = -1;
    ghost.healing = true;
    ghost.retreating = false;
    ghost.healingElapsed = 0;
    ghost.healingStartHp = ghost.hp;
    ghost.position = { ...engine.map.ghostSpawn };
    engine.restore(persisted);

    for (let index = 0; index < 49; index += 1) engine.tick(0.1);
    expect(engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp).toBe(room.doorMaxHp - 30);
    engine.tick(0.1);
    expect(engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp).toBe(room.doorMaxHp - 25);
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    expect(engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp).toBe(room.doorMaxHp - 20);
  });

  it('lets three level-one basic turrets protect a level-two door through the first retreat', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const funded = engine.serialize();
    const player = funded.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing four-turret owner');
    player.gold = 1_000;
    engine.restore(funded);
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

  it('forces a level-one ghost to retreat before a level-one door breaks with a four-turret defense', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const funded = engine.serialize();
    const player = funded.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing door-defense owner');
    player.gold = 1_000;
    engine.restore(funded);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const tiles = [...(mapRoom?.buildTiles ?? [])].sort((a, b) =>
      Math.hypot(a.x - (mapRoom?.door.x ?? 0), a.y - (mapRoom?.door.y ?? 0))
      - Math.hypot(b.x - (mapRoom?.door.x ?? 0), b.y - (mapRoom?.door.y ?? 0)),
    );
    for (const tile of tiles.slice(0, 4))
      expect(engine.build(playerId, roomId, tile as Tile, 'basic-turret').ok).toBe(true);
    const secondTurret = engine.snapshot().buildings
      .filter((building) => building.roomId === roomId && building.kind === 'basic-turret')
      .at(-1);
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

  it('lets four basic turrets within door range keep at least half of a level-two door through the first retreat', () => {
    const { engine, ids } = setup(1, false);
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId } = assigned(engine, playerId);
    const funded = engine.serialize();
    const player = funded.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing level-two door owner');
    player.gold = 1_000;
    engine.restore(funded);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const tiles = [...(mapRoom?.buildTiles ?? [])].sort((a, b) => Math.hypot(a.x - (mapRoom?.door.x ?? 0), a.y - (mapRoom?.door.y ?? 0)) - Math.hypot(b.x - (mapRoom?.door.x ?? 0), b.y - (mapRoom?.door.y ?? 0)));
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
      tile: mapRoom.buildTiles[0] as Tile, level: 3, cooldown: 0, hp: 100, skinId: 'drone-heart',
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

  it('allows crossing a full solo room but keeps its bed unavailable', () => {
    const { engine, ids } = setup(2);
    const hostId = ids[0] as string;
    const intruderId = ids[1] as string;
    expect(engine.start(hostId).ok).toBe(true);
    advanceFrozenIntros(engine);
    const mapRoom = engine.map.rooms[0];
    if (!mapRoom) throw new Error('missing room fixture');
    const entrance = mapRoom.floorTiles.find(
      (tile) => Math.abs(tile.x - mapRoom.door.x) + Math.abs(tile.y - mapRoom.door.y) === 1,
    );
    if (!entrance) throw new Error('missing room entrance fixture');
    const persisted = engine.serialize();
    const owner = persisted.snapshot.players.find((player) => player.id === hostId);
    const intruder = persisted.snapshot.players.find((player) => player.id === intruderId);
    if (!owner || !intruder) throw new Error('missing survivor fixture');
    owner.position = { ...(mapRoom.beds[0] as Tile) };
    intruder.position = { ...mapRoom.door };
    engine.restore(persisted);
    expect(engine.interact(hostId).ok).toBe(true);
    expect(
      engine.setMovement(
        intruderId,
        entrance.x - mapRoom.door.x,
        entrance.y - mapRoom.door.y,
        1,
      ).ok,
    ).toBe(true);
    for (let index = 0; index < 8; index += 1) engine.tick(0.1);
    const after = engine.snapshot().players.find((player) => player.id === intruderId);
    expect(after?.roomId).toBeNull();
    expect(
      mapRoom.floorTiles.some(
        (tile) => tile.x === Math.round(after?.position.x ?? Number.NaN) && tile.y === Math.round(after?.position.y ?? Number.NaN),
      ),
    ).toBe(true);

    const crossingState = engine.serialize();
    const crossingIntruder = crossingState.snapshot.players.find(
      (player) => player.id === intruderId,
    );
    if (!crossingIntruder) throw new Error('missing crossing intruder');
    crossingIntruder.position = { ...(mapRoom.beds[0] as Tile) };
    engine.restore(crossingState);
    const denied = engine.interact(intruderId);
    expect(denied.ok).toBe(false);
  });

  it('does not allow a breached ghost to strike through a room wall', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    const room = persisted.snapshot.rooms.find((candidate) => candidate.id === player?.roomId);
    const mapRoom = engine.map.rooms.find((candidate) => candidate.id === player?.roomId);
    const ghost = persisted.snapshot.ghosts[0];
    if (!player || !room || !mapRoom || !ghost) throw new Error('missing wall-strike fixture');
    const entrance = mapRoom.floorTiles.find(
      (tile) => Math.abs(tile.x - mapRoom.door.x) + Math.abs(tile.y - mapRoom.door.y) === 1,
    );
    if (!entrance) throw new Error('missing entrance fixture');
    mapRoom.bed = { ...entrance };
    mapRoom.beds[0] = { ...entrance };
    room.doorHp = 0;
    player.position = { ...entrance };
    ghost.position = {
      x: mapRoom.door.x + (entrance.x - mapRoom.door.x) * 0.4,
      y: mapRoom.door.y + (entrance.y - mapRoom.door.y) * 0.4,
    };
    ghost.targetRoomId = room.id;
    ghost.attackCooldown = 0;
    ghost.retreating = false;
    ghost.healing = false;
    persisted.snapshot.ghost = ghost;
    engine.restore(persisted);
    engine.drainEvents();
    engine.tick(0.01);
    const after = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    const events = engine.drainEvents();
    expect(after?.alive).toBe(true);
    expect(events.some((event) => event.kind === 'player-hit' && event.playerId === playerId)).toBe(false);
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

  it('reduces the first ghost growth threshold by stage and then grows it in fixed steps', () => {
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
    expect(initialRequired).toBe(21);
    for (let index = 0; index < 200 && engine.snapshot().ghost.level === 1; index += 1) engine.tick(0.1);
    const grownGhost = engine.snapshot().ghost;
    expect(grownGhost.level).toBe(2);
    expect(grownGhost.maxHp).toBeGreaterThan(BALANCE.ghost.baseHp * .34);
    expect(grownGhost.attacksToNextLevel).toBe(24);
  });

  it('caps the first ghost growth threshold at fifteen hits from hard one onward', () => {
    const stages = [
      ['easy-1', 21],
      ['normal-1', 20],
      ['normal-2', 19],
      ['hard-1', 15],
      ['nightmare-1', 15],
      ['apocalypse-99', 15],
    ] as const;
    for (const [stageId, expected] of stages) {
      const engine = new GameEngine(`GROWTH-${stageId}`, generateMap(93_000 + expected), true, { stageId });
      expect(engine.snapshot().ghost.attacksToNextLevel).toBe(expected);
    }
  });

  it('lets a max-level door repair stand sustain a repaired and shielded level-five door', () => {
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
      { id: 'max-repair', kind: 'repair-drone', roomId: room.id, ownerId: playerId, tile: defensiveTiles[0] as Tile, level: 3, cooldown: 0, hp: 100, skinId: 'drone-heart' },
      { id: 'max-shield', kind: 'shield-device', roomId: room.id, ownerId: playerId, tile: defensiveTiles[1] as Tile, level: 3, cooldown: 0, hp: 100, skinId: 'shield-default' },
    );
    engine.restore(persisted);
    let hitCount = 0;
    for (let index = 0; index < 2_000 && engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp; index += 1) {
      engine.tick(0.05);
      hitCount += engine.drainEvents().filter((event) => event.kind === 'door-hit' && event.roomId === room.id).length;
    }
    expect(engine.snapshot().rooms.find((candidate) => candidate.id === room.id)?.doorHp).toBe(400);
    expect(hitCount).toBeGreaterThan(0);
    expect(buildingStats('repair-drone', 3).value).toBe(45);
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
    expect(after).not.toBe(before);
    expect(retreater?.path.length).toBeGreaterThan(0);
  });

  it('stacks frost spray slow while a low-HP ghost retreats to its nearest recovery pad', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing frost retreat fixture');
    ghost.position = { ...tile };
    ghost.hp = ghost.maxHp * .19;
    ghost.retreating = false;
    ghost.healing = false;
    ghost.retreatCount = 0;
    persisted.snapshot.ghost = ghost;
    persisted.snapshot.buildings.push({ id: 'frost-retreat', kind: 'frost-turret', roomId, ownerId: playerId, tile: { ...tile }, level: 1, cooldown: 0, hp: 100, skinId: 'turret-frost-snow' });
    engine.restore(persisted);
    const nearestPad = engine.map.respawnZones
      .map((zone) => ({ x: zone.x + 1, y: zone.y + 1 }))
      .sort((a, b) => Math.hypot(tile.x - a.x, tile.y - a.y) - Math.hypot(tile.x - b.x, tile.y - b.y))[0];
    if (!nearestPad) throw new Error('missing recovery pad');
    const before = Math.hypot(tile.x - nearestPad.x, tile.y - nearestPad.y);
    engine.drainEvents();
    engine.tick(0.1);
    const retreater = engine.snapshot().ghosts[0];
    const after = retreater ? Math.hypot(retreater.position.x - nearestPad.x, retreater.position.y - nearestPad.y) : before;
    const events = engine.drainEvents();
    expect(retreater?.hp).toBeGreaterThan(0);
    expect(retreater?.retreating).toBe(true);
    expect(retreater?.slowMultiplier).toBeCloseTo(0.84, 5);
    expect(retreater?.slowUntil).toBeGreaterThan(engine.snapshot().elapsed);
    expect(after).not.toBe(before);
    expect(retreater?.path.length).toBeGreaterThan(0);
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

  it('offers integer-valued weighted rewards with only two blanks and turns a draw into a placed reward', () => {
    expect(RANDOM_ITEMS).toHaveLength(36);
    expect(RANDOM_ITEMS.filter((item) => Object.keys(item.effect).length === 0)).toHaveLength(2);
    expect(RANDOM_ITEMS.filter((item) => Object.keys(item.effect).length === 0).map((item) => item.id).sort()).toEqual(['cracked-mirror', 'wet-socks']);
    expect(RANDOM_ITEMS.find((item) => item.id === 'mythic-ark')?.effect).toMatchObject({ goldPerSecond: 500 });
    expect(RANDOM_ITEMS.find((item) => item.id === 'mythic-ark')?.rarity).toBe('mythic');
    expect(RANDOM_ITEMS.find((item) => item.id === 'golden-ticket')?.effect.goldenTurretTickets).toBe(1);
    expect(RANDOM_ITEMS.find((item) => item.id === 'void-cat')?.effect.turretRateMultiplier).toBe(.7);
    expect(RANDOM_ITEMS.find((item) => item.id === 'hundred-robot')?.effect.powerPerSecond).toBe(100);
    expect(RANDOM_ITEMS.find((item) => item.id === 'copper-pig')?.effect.goldPerSecond).toBe(1);
    expect(RANDOM_ITEMS.find((item) => item.id === 'royal-money-tree')?.effect.goldPerSecond).toBe(100);
    expect(RANDOM_ITEMS.find((item) => item.id === 'moon-gem-reward')?.effect.moonGem).toBe(true);
    expect(RANDOM_ITEMS.filter((item) => item.effect.goldPerSecond).map((item) => item.effect.goldPerSecond ?? 0).sort((a, b) => a - b)).toEqual([1, 2, 5, 10, 20, 50, 100, 500]);
    expect(RANDOM_ITEMS.every((item) => Number.isInteger(item.effect.goldPerSecond ?? 0))).toBe(true);
    expect(RANDOM_ITEMS.find((item) => item.id === 'turret-overhaul-kit')?.effect.turretLevelIncrease).toBe(1);
    expect(RANDOM_ITEMS.some((item) => item.id === 'runner-shoes' || item.id === 'escape-scarf')).toBe(false);
    expect(RANDOM_ITEMS.find((item) => item.id === 'mythic-ark')?.weight).toBeLessThan(RANDOM_ITEMS.find((item) => item.id === 'cracked-mirror')?.weight ?? 0);
    expect(DRAW_COSTS).toEqual([{ gold: 40, power: 0 }, { gold: 60, power: 0 }, { gold: 120, power: 0 }, { gold: 200, power: 0 }, { gold: 300, power: 0 }, { gold: 420, power: 0 }]);

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
    expect(engine.drawItem(playerId, machineId).ok).toBe(true);
    expect(engine.snapshot().players[0]?.drawCount).toBe(1);
    expect(engine.snapshot().players[0]?.gold).toBe(960);
    expect(engine.snapshot().players[0]?.power).toBe(1_000);
    expect(engine.snapshot().buildings.find((building) => building.id === machineId)?.kind).toBe('random-item');
    expect(engine.drawItem(playerId, machineId).ok).toBe(false);
  });

  it('turns a moon gem reward into an upgradeable gem with a rolled starting level', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'lucky-machine').ok).toBe(true);
    const prepared = engine.serialize();
    const player = prepared.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing moon gem owner');
    player.gold = 1_000;
    player.power = 1_000;
    engine.restore(prepared);
    const totalWeight = RANDOM_ITEMS.reduce((sum, item) => sum + item.weight, 0);
    const gemIndex = RANDOM_ITEMS.findIndex((item) => item.id === 'moon-gem-reward');
    if (gemIndex < 0) throw new Error('missing moon gem reward');
    const precedingWeight = RANDOM_ITEMS.slice(0, gemIndex).reduce((sum, item) => sum + item.weight, 0);
    const random = vi.spyOn(SeededRandom.prototype, 'next')
      .mockReturnValueOnce((precedingWeight + 0.01) / totalWeight)
      .mockReturnValueOnce(.95);
    try {
      const machineId = engine.snapshot().buildings.find((building) => building.kind === 'lucky-machine')?.id;
      if (!machineId) throw new Error('missing lucky machine');
      expect(engine.drawItem(playerId, machineId).ok).toBe(true);
      const gem = engine.snapshot().buildings.find((building) => building.id === machineId);
      expect(gem).toMatchObject({ kind: 'gem-core', itemId: 'moon-gem-reward', level: 4 });
      expect(engine.upgrade(playerId, machineId).ok).toBe(true);
      expect(engine.snapshot().buildings.find((building) => building.id === machineId)?.level).toBe(5);
    } finally {
      random.mockRestore();
    }
  });

  it('raises every already-installed turret by one when the overhaul kit is drawn', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    const machineTile = mapRoom?.buildTiles.find((candidate) => candidate.x !== tile.x || candidate.y !== tile.y);
    if (!machineTile) throw new Error('missing lucky-machine tile');
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
    expect(engine.build(playerId, roomId, machineTile, 'lucky-machine').ok).toBe(true);
    const prepared = engine.serialize();
    const player = prepared.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing turret owner');
    player.gold = 1_000;
    player.power = 1_000;
    engine.restore(prepared);
    const totalWeight = RANDOM_ITEMS.reduce((sum, item) => sum + item.weight, 0);
    const kitIndex = RANDOM_ITEMS.findIndex((item) => item.id === 'turret-overhaul-kit');
    if (kitIndex < 0) throw new Error('missing turret overhaul kit');
    const precedingWeight = RANDOM_ITEMS.slice(0, kitIndex).reduce((sum, item) => sum + item.weight, 0);
    const random = vi.spyOn(SeededRandom.prototype, 'next').mockReturnValueOnce((precedingWeight + 0.01) / totalWeight);
    const machineId = engine.snapshot().buildings.find((building) => building.kind === 'lucky-machine')?.id;
    if (!machineId) throw new Error('missing lucky machine');
    expect(engine.drawItem(playerId, machineId).ok).toBe(true);
    expect(engine.snapshot().buildings.find((building) => building.kind === 'basic-turret')?.level).toBe(2);
    random.mockRestore();
  });

  it('drops a carryable reward into the corridor and installs it after a bed is claimed', () => {
    // Constructor rolls time-attack and ghost variant first; the third roll
    // is the optional opening cargo event.
    const map = generateMap(92_234);
    const random = vi.spyOn(SeededRandom.prototype, 'next')
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.01)
      .mockReturnValue(0.25);
    try {
      const engine = new GameEngine('LOOTDROP', map, false);
      const joined = engine.join({ nickname: '보상 운반자', deviceId: 'device-loot-drop' });
      expect(engine.start(joined.player.id).ok).toBe(true);
      // All modes keep the frozen ghost poster. The cargo starts falling only
      // after that card clears and the bright non-ranked countdown begins.
      expect(engine.snapshot().lootDrops).toHaveLength(0);
      advanceFrozenIntros(engine);
      const firstDrop = engine.snapshot().lootDrops[0];
      expect(firstDrop).toBeDefined();
      expect(engine.map.corridorTiles).toContainEqual(expect.objectContaining(firstDrop?.tile ?? {}));

      const carriedState = engine.serialize();
      const carrier = carriedState.snapshot.players.find((player) => player.id === joined.player.id);
      if (!carrier || !firstDrop) throw new Error('missing opening loot fixture');
      carrier.position = { ...firstDrop.tile };
      engine.restore(carriedState);
      // Corridor cargo has a visible three-second fall before it can be picked up.
      for (let index = 0; index < 30; index += 1) engine.tick(0.1);
      expect(engine.handle(joined.player.id, envelope({ type: 'pickup-loot', lootId: firstDrop.id })).ok).toBe(true);
      expect(engine.snapshot().players.find((player) => player.id === joined.player.id)?.carriedLootId).toBe(firstDrop.id);

      const room = engine.map.rooms[0];
      const bed = room?.beds[0];
      if (!room || !bed) throw new Error('missing bed for opening loot fixture');
      const occupancyState = engine.serialize();
      const occupant = occupancyState.snapshot.players.find((player) => player.id === joined.player.id);
      if (!occupant) throw new Error('missing opening loot carrier');
      occupant.position = { ...bed };
      engine.restore(occupancyState);
      expect(engine.interact(joined.player.id).ok).toBe(true);
      expect(engine.snapshot().lootDrops.some((drop) => drop.id === firstDrop.id)).toBe(false);
      expect(engine.snapshot().buildings.some((building) =>
        building.kind === 'random-item' && building.ownerId === joined.player.id && building.itemId === firstDrop.itemId,
      )).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it('applies survivor economy, turret damage, fire-rate, and extra-draw traits on the server', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);

    const puppyState = engine.serialize();
    const puppy = puppyState.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!puppy) throw new Error('missing trait owner');
    puppy.appearance = { ...puppy.appearance, character: 'character-puppy' };
    const goldBefore = puppy.gold;
    engine.restore(puppyState);
    engine.tick(0.1);
    engine.tick(0.1);
    engine.tick(0.05);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBeCloseTo(goldBefore + 2, 5);

    const bearState = engine.serialize();
    const bear = bearState.snapshot.players.find((candidate) => candidate.id === playerId);
    const ghost = bearState.snapshot.ghosts[0];
    const turret = bearState.snapshot.buildings.find((building) => building.kind === 'basic-turret');
    if (!bear || !ghost || !turret) throw new Error('missing turret trait fixture');
    bear.appearance = { ...bear.appearance, character: 'character-bear' };
    ghost.position = { ...turret.tile };
    ghost.hp = ghost.maxHp = 10_000;
    ghost.retreating = false;
    ghost.healing = false;
    turret.cooldown = 0;
    bearState.snapshot.ghost = ghost;
    engine.restore(bearState);
    engine.tick(0.01);
    const bearFire = engine.drainEvents().find((event) => event.kind === 'turret-fire');
    expect(bearFire?.amount).toBeCloseTo(buildingStats('basic-turret', 1).value * 1.1, 5);

    const catState = engine.serialize();
    const cat = catState.snapshot.players.find((candidate) => candidate.id === playerId);
    const catGhost = catState.snapshot.ghosts[0];
    const catTurret = catState.snapshot.buildings.find((building) => building.kind === 'basic-turret');
    if (!cat || !catGhost || !catTurret) throw new Error('missing fire-rate trait fixture');
    cat.appearance = { ...cat.appearance, character: 'character-cat' };
    catGhost.position = { ...catTurret.tile };
    catGhost.hp = catGhost.maxHp = 10_000;
    catGhost.retreating = false;
    catGhost.healing = false;
    catTurret.cooldown = 0;
    catState.snapshot.ghost = catGhost;
    engine.restore(catState);
    engine.tick(0.01);
    expect(engine.snapshot().buildings.find((building) => building.id === catTurret.id)?.cooldown)
      .toBeCloseTo(buildingStats('basic-turret', 1).rate / 1.15, 5);

    const tiles = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles ?? [];
    const machineTile = tiles.find((candidate) => candidate.x !== tile.x || candidate.y !== tile.y);
    if (!machineTile) throw new Error('missing lucky machine tile');
    const foxState = engine.serialize();
    const fox = foxState.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!fox) throw new Error('missing fox trait owner');
    fox.appearance = { ...fox.appearance, character: 'character-fox' };
    fox.gold = 10_000;
    fox.power = 10_000;
    engine.restore(foxState);
    expect(engine.build(playerId, roomId, machineTile, 'lucky-machine').ok).toBe(true);
    const machine = engine.snapshot().buildings.find(
      (building) => building.kind === 'lucky-machine' && building.tile.x === machineTile.x && building.tile.y === machineTile.y,
    );
    if (!machine) throw new Error('missing initial lucky machine');
    const openMachine = (): string => {
      const placement = tiles.find((candidate) => !engine.snapshot().buildings.some(
        (building) => building.tile.x === candidate.x && building.tile.y === candidate.y,
      ));
      if (!placement) throw new Error('missing spare lucky-machine tile');
      expect(engine.build(playerId, roomId, placement, 'lucky-machine').ok).toBe(true);
      const machine = engine.snapshot().buildings.find(
        (building) => building.kind === 'lucky-machine' && building.tile.x === placement.x && building.tile.y === placement.y,
      );
      if (!machine) throw new Error('missing lucky machine');
      return machine.id;
    };
    for (let index = 0; index < 5; index += 1) {
      const machineId = index === 0 ? machine.id : openMachine();
      expect(engine.drawItem(playerId, machineId).ok).toBe(true);
    }
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.drawCount).toBe(5);
  });

  it('applies generic skin boosts and authored skin passives on the server', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const configured = engine.serialize();
    const owner = configured.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!owner) throw new Error('missing skin-trait owner');
    owner.gold = 10_000;
    owner.power = 10_000;
    owner.appearance = { character: 'character-bear', skin: 'skin-look-bear-ward' };
    engine.restore(configured);
    expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);

    const skinnedState = engine.serialize();
    const guardian = skinnedState.snapshot.buildings.find((building) => building.kind === 'basic-turret');
    const ghost = skinnedState.snapshot.ghosts[0];
    if (!guardian || !ghost) throw new Error('missing skinned guardian fixture');
    ghost.position = { ...guardian.tile };
    ghost.hp = ghost.maxHp = 10_000;
    ghost.retreating = false;
    ghost.healing = false;
    guardian.cooldown = 0;
    skinnedState.snapshot.ghost = ghost;
    engine.restore(skinnedState);
    engine.tick(0.01);
    const fire = engine.drainEvents().find((event) => event.kind === 'turret-fire');
    expect(fire?.amount).toBeCloseTo(buildingStats('basic-turret', 1).value * 1.15, 5);
    expect(characterTraitForAppearance({ character: 'character-cat', skin: 'skin-look-cat-ward' }).turretRateMultiplier)
      .toBeCloseTo(1 / 1.225, 6);
    expect(characterTraitForAppearance({ character: 'character-puppy', skin: 'skin-look-puppy-ward' }).goldPerSecond)
      .toBe(1.5);
    expect(characterTraitForAppearance({ character: 'character-puppy', skin: 'skin-look-puppy-surfer' }).goldPerSecond)
      .toBe(5);
    expect(bedGoldProductionForAppearance(
      { character: 'character-puppy', skin: 'skin-basic-puppy' },
      1,
    )).toBe(2);
    expect(bedGoldProductionForAppearance(
      { character: 'character-puppy', skin: 'skin-look-puppy-surfer' },
      1,
    )).toBe(6);
    expect(characterTraitForAppearance({ character: 'character-tiger', skin: 'skin-look-tiger-lifeguard' }).turretRangeBonus)
      .toBe(2);
    expect(characterTraitForAppearance({ character: 'character-tiger', skin: 'skin-look-tiger-lifeguard' }).turretRateMultiplier)
      .toBeCloseTo(1 / 1.2, 6);
    expect(characterTraitForAppearance({ character: 'character-tiger', skin: 'skin-look-tiger-ward' }).turretRateMultiplier)
      .toBeCloseTo(1 / 1.05, 6);
    expect(characterTraitForAppearance({ character: 'character-cat', skin: 'skin-look-cat-neon-rider' }).turretRateMultiplier)
      .toBe(0.5);
    expect(characterTraitForAppearance({ character: 'character-hamster', skin: 'skin-look-hamster-cyber-driver' }).turretStartingLevel)
      .toBe(5);
    expect(characterTraitForAppearance({ character: 'character-duck', skin: 'skin-look-duck-ward' }).powerPerSecond)
      .toBe(1.5);
    expect(characterTraitForAppearance({ character: 'character-bunny', skin: 'skin-look-bunny-ward' }).unclaimedMoveSpeedMultiplier)
      .toBe(1.5);
    expect(characterTraitForAppearance({ character: 'character-hamster', skin: 'skin-basic-hamster' }).firstGuardianLevelBonus)
      .toBe(1);
    expect(characterTraitForAppearance({ character: 'character-hamster', skin: 'skin-look-hamster-ward' }).firstGuardianLevelBonus)
      .toBe(2);
    expect(characterTraitForAppearance({ character: 'character-gorilla', skin: 'skin-basic-gorilla' }).doorShieldRatio)
      .toBe(0.5);
    expect(characterTraitForAppearance({ character: 'character-gorilla', skin: 'skin-look-gorilla-ward' }).doorShieldRatio)
      .toBe(0.75);
  });

  it('starts the hamster guardian once, while cyber Kong starts every turret at Lv.5', () => {
    const verifyInitialGuardian = (
      appearance: { character: string; skin: string },
      expectedLevels: readonly number[],
    ): void => {
      const { engine, ids } = setup();
      const playerId = ids[0] as string;
      begin(engine, playerId);
      const { roomId, tile } = assigned(engine, playerId);
      const configured = engine.serialize();
      const owner = configured.snapshot.players.find((candidate) => candidate.id === playerId);
      if (!owner) throw new Error('missing hamster owner');
      owner.appearance = appearance;
      owner.gold = 10_000;
      engine.restore(configured);

      expect(engine.build(playerId, roomId, tile, 'basic-turret').ok).toBe(true);
      const secondTile = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles
        .find((candidate) => candidate.x !== tile.x || candidate.y !== tile.y);
      if (!secondTile) throw new Error('missing second build tile');
      expect(engine.build(playerId, roomId, secondTile, 'basic-turret').ok).toBe(true);
      const guardians = engine.snapshot().buildings.filter((building) => building.kind === 'basic-turret');
      expect(guardians.map((building) => building.level)).toEqual(expectedLevels);
    };

    verifyInitialGuardian(
      { character: 'character-hamster', skin: 'skin-basic-hamster' },
      [2, 1],
    );
    verifyInitialGuardian(
      { character: 'character-hamster', skin: 'skin-look-hamster-ward' },
      [3, 1],
    );
    verifyInitialGuardian(
      { character: 'character-hamster', skin: 'skin-look-hamster-cyber-driver' },
      [5, 5],
    );
  });

  it('gives the gorilla door a 50%, or skinned 75%, shield that takes damage first', () => {
    const verifyDoorShield = (appearance: { character: string; skin: string }, expectedRatio: number): void => {
      const { engine, ids } = setup();
      const playerId = ids[0] as string;
      expect(engine.start(playerId).ok).toBe(true);
      advanceFrozenIntros(engine);
      const mapRoom = engine.map.rooms[0];
      if (!mapRoom) throw new Error('missing room');
      const configured = engine.serialize();
      const player = configured.snapshot.players.find((candidate) => candidate.id === playerId);
      if (!player) throw new Error('missing gorilla owner');
      player.appearance = appearance;
      player.position = { ...(mapRoom.beds[0] as Tile) };
      engine.restore(configured);
      expect(engine.interact(playerId).ok).toBe(true);
      const occupiedRoom = engine.snapshot().rooms.find((room) => room.id === mapRoom.id);
      expect(occupiedRoom?.doorLevel).toBe(1);
      expect(occupiedRoom?.doorShieldMaxHp).toBe(Math.floor((occupiedRoom?.doorMaxHp ?? 0) * expectedRatio));
      expect(occupiedRoom?.doorShieldHp).toBe(occupiedRoom?.doorShieldMaxHp);

      const combat = engine.serialize();
      const ghost = combat.snapshot.ghosts[0];
      const room = combat.snapshot.rooms.find((candidate) => candidate.id === mapRoom.id);
      if (!ghost || !room) throw new Error('missing gorilla shield combat fixture');
      const approach = engine.map.corridorTiles.find(
        (tile) =>
          Math.abs(tile.x - mapRoom.door.x) +
            Math.abs(tile.y - mapRoom.door.y) ===
          1,
      );
      if (!approach) throw new Error('missing gorilla door approach');
      combat.snapshot.status = 'PLAYING';
      combat.snapshot.countdown = 0;
      ghost.position = { ...approach };
      ghost.targetRoomId = mapRoom.id;
      ghost.targetPlayerId = null;
      ghost.attackCooldown = 0;
      ghost.path = [];
      const beforeDoorHp = room.doorHp;
      const beforeShieldHp = room.doorShieldHp;
      engine.restore(combat);
      for (let index = 0; index < 40; index += 1) {
        engine.tick(0.05);
        const currentRoom = engine.snapshot().rooms.find((candidate) => candidate.id === mapRoom.id);
        if ((currentRoom?.doorShieldHp ?? beforeShieldHp) < beforeShieldHp) break;
      }
      const struckRoom = engine.snapshot().rooms.find((candidate) => candidate.id === mapRoom.id);
      expect(struckRoom?.doorHp).toBe(beforeDoorHp);
      expect(struckRoom?.doorShieldHp).toBeLessThan(beforeShieldHp);
    };

    verifyDoorShield({ character: 'character-gorilla', skin: 'skin-basic-gorilla' }, 0.5);
    verifyDoorShield({ character: 'character-gorilla', skin: 'skin-look-gorilla-ward' }, 0.75);
  });

  it('can create all eleven primary ghost variants as match events', () => {
    const variants = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const engine = new GameEngine(`EVENT${index}`, generateMap(30_000 + index), false);
      const state = engine.snapshot();
      for (const ghost of state.ghosts) variants.add(ghost.variant);
    }
    expect(variants).toEqual(new Set([
      'wanderer', 'swift', 'brute', 'caster', 'twin-a', 'twin-b', 'teleporter', 'undead', 'giant',
      'demolisher', 'wallpaper',
    ]));
  }, 15_000);

  it('charges the demolisher slowly, telegraphs for three seconds, then removes one owned building without refund', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    if (!mapRoom) throw new Error('missing demolisher target room');
    const approach = engine.map.corridorTiles.find(
      (candidate) =>
        Math.abs(candidate.x - mapRoom.door.x) +
          Math.abs(candidate.y - mapRoom.door.y) ===
        1,
    );
    if (!approach) throw new Error('missing corridor approach');
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0] as GhostState;
    ghost.variant = 'demolisher';
    ghost.displayName = '웃는 해체귀';
    ghost.position = { ...approach };
    ghost.targetRoomId = roomId;
    ghost.targetPlayerId = null;
    ghost.attackCooldown = 0;
    ghost.path = [];
    ghost.mana = 0;
    ghost.maxMana = 100;
    ghost.abilityPhase = 'idle';
    ghost.abilityStartedAt = -1;
    ghost.abilityEndsAt = -1;
    ghost.abilityTargetBuildingId = null;
    const targetId = 'demolisher-target';
    persisted.snapshot.buildings.push({
      id: targetId,
      kind: 'generator',
      roomId,
      ownerId: playerId,
      skinId: '',
      tile: { ...tile, roomId },
      level: 1,
      cooldown: 0,
      hp: 100,
      investedGold: 200,
      investedPower: 0,
      investmentByPlayer: {
        [playerId]: { gold: 200, power: 0 },
      },
    });
    const player = persisted.snapshot.players.find(
      (candidate) => candidate.id === playerId,
    );
    if (!player) throw new Error('missing demolisher target owner');
    engine.restore(persisted);

    engine.tick(0.05);
    expect(engine.snapshot().ghosts[0]?.mana).toBeCloseTo(1.25, 5);
    expect(engine.snapshot().ghosts[0]?.abilityPhase).toBe('idle');

    const charged = engine.serialize();
    const chargedGhost = charged.snapshot.ghosts[0] as GhostState;
    chargedGhost.mana = 100;
    chargedGhost.attackCooldown = 0;
    engine.restore(charged);
    engine.drainEvents();
    engine.tick(0.05);
    expect(engine.snapshot().ghosts[0]?.abilityPhase).toBe('preparing');
    expect(engine.snapshot().buildings.some((building) => building.id === targetId)).toBe(true);
    expect(engine.drainEvents().some(
      (event) => event.kind === 'ghost-skill' && event.itemId === 'demolition-prepare',
    )).toBe(true);

    for (let index = 0; index < 7; index += 1) engine.tick(0.1);
    expect(engine.snapshot().buildings.some((building) => building.id === targetId)).toBe(true);
    engine.tick(0.1);
    expect(engine.snapshot().buildings.some((building) => building.id === targetId)).toBe(false);
    expect(engine.drainEvents().some(
      (event) =>
        event.kind === 'building-remove' &&
        event.itemId === 'demolition-cast' &&
        event.amount === 0,
    )).toBe(true);
  });

  it('charges the wallpaper ghost slowly, telegraphs, then disables three nearby room tiles without removing buildings', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    if (!mapRoom) throw new Error('missing wallpaper target room');
    const approach = engine.map.corridorTiles.find(
      (candidate) =>
        Math.abs(candidate.x - mapRoom.door.x) +
          Math.abs(candidate.y - mapRoom.door.y) ===
        1,
    );
    if (!approach) throw new Error('missing wallpaper corridor approach');
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0] as GhostState;
    ghost.variant = 'wallpaper';
    ghost.displayName = '오염 도배귀';
    ghost.position = { ...approach };
    ghost.targetRoomId = roomId;
    ghost.targetPlayerId = null;
    ghost.attackCooldown = 0;
    ghost.path = [];
    ghost.mana = 100;
    ghost.maxMana = 100;
    ghost.abilityPhase = 'idle';
    ghost.abilityStartedAt = -1;
    ghost.abilityEndsAt = -1;
    ghost.abilityTargetBuildingId = null;
    ghost.contaminatedTiles = [];
    ghost.contaminationEndsAt = -1;
    const targetId = 'wallpaper-target';
    persisted.snapshot.buildings.push({
      id: targetId,
      kind: 'generator',
      roomId,
      ownerId: playerId,
      skinId: '',
      tile: { ...tile, roomId },
      level: 1,
      cooldown: 0,
      hp: 100,
      investedGold: 150,
      investedPower: 0,
      investmentByPlayer: {
        [playerId]: { gold: 150, power: 0 },
      },
    });
    engine.restore(persisted);
    engine.drainEvents();
    engine.tick(0.05);
    expect(engine.snapshot().ghosts[0]?.abilityPhase).toBe('preparing');
    expect(engine.drainEvents().some(
      (event) => event.kind === 'ghost-skill' && event.itemId === 'wallpaper-prepare',
    )).toBe(true);

    for (let index = 0; index < 8; index += 1) engine.tick(0.1);
    const contaminated = engine.snapshot().ghosts[0];
    expect(contaminated?.contaminatedTiles).toHaveLength(3);
    expect(contaminated?.contaminatedTiles).toContainEqual({ ...tile, roomId });
    expect(engine.snapshot().buildings.some((building) => building.id === targetId)).toBe(true);
    expect(engine.drainEvents().some(
      (event) => event.kind === 'ghost-skill' && event.itemId === 'wallpaper-cast',
    )).toBe(true);
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

  it('sends twin ghosts toward different occupied rooms when alternatives exist', () => {
    let engine: GameEngine | null = null;
    for (let index = 0; index < 120; index += 1) {
      const candidate = new GameEngine(`TWINROUTE${index}`, generateMap(90_000 + index, 'multiplayer'), false, { playMode: 'multiplayer' });
      if (candidate.snapshot().ghosts.length === 2) {
        engine = candidate;
        break;
      }
    }
    if (!engine) throw new Error('missing twin route fixture');
    const players = Array.from({ length: 4 }, (_, index) => engine?.join({ nickname: `TwinRoom${index}`, deviceId: `twin-room-${index}` }));
    const host = players[0]?.player.id;
    if (!host) throw new Error('missing twin route host');
    for (let index = 1; index < players.length; index += 1) {
      engine.handle(players[index]?.player.id as string, envelope({ type: 'ready', ready: true }, index + 2));
    }
    begin(engine, host);
    engine.tick(0.1);
    const targets = engine.snapshot().ghosts.map((ghost) => ghost.targetRoomId);
    expect(targets.every(Boolean)).toBe(true);
    expect(new Set(targets).size).toBe(2);
  });
});

describe('persistent account progression', () => {
  it('creates the complete 345-stage ladder through apocalypse', () => {
    expect(STAGES).toHaveLength(345);
    expect(STAGES[0]).toMatchObject({ id: 'easy-1', label: '쉬움 1', index: 0 });
    expect(STAGES[1]).toMatchObject({ id: 'normal-1', label: '노말 1' });
    expect(STAGES[5]).toMatchObject({ id: 'normal-5', label: '노말 5' });
    expect(STAGES[6]).toMatchObject({ id: 'hard-1', label: '어려움 1' });
    expect(STAGES[11]).toMatchObject({ id: 'nightmare-1', label: '악몽 1' });
    expect(STAGES[91]).toMatchObject({ id: 'legendary-1', label: '레전더리 1' });
    expect(STAGES[121]).toMatchObject({ id: 'calamity-1', label: '재앙 1' });
    expect(STAGES[156]).toMatchObject({ id: 'cataclysm-1', label: '대재앙 1' });
    expect(STAGES[196]).toMatchObject({ id: 'ruin-1', label: '파멸 1' });
    expect(STAGES.at(-1)).toMatchObject({ id: 'apocalypse-99', label: '종말 99', index: 344 });
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
    expect(getStage('easy-1').levelHpGrowth).toBe(0.16);
    expect(getStage('easy-1').levelDamageGrowth).toBe(0.11);
    expect(getStage('apocalypse-99').levelHpGrowth).toBe(0.38);
    expect(getStage('apocalypse-99').levelDamageGrowth).toBe(0.3);
  });

  it('calculates separate ranks and always displays the higher rank', () => {
    expect(rankFromXp(0)).toBe('beginner');
    expect(rankFromXp(250)).toBe('intermediate');
    expect(rankFromXp(800)).toBe('expert');
    expect(rankFromXp(2_000)).toBe('master');
    expect(rankFromXp(5_000)).toBe('veteran');
    expect(rankFromXp(10_000)).toBe('legend');
    expect(rankFromXp(20_000)).toBe('transcendent');
    expect(rankFromXp(50_000)).toBe('immortal');
    expect(rankFromXp(100_000)).toBe('absolute');
    expect(higherRank('expert', 'veteran')).toBe('veteran');
    expect(higherRank('absolute', 'immortal')).toBe('absolute');
  });

  it('maps every stage to its documented recommended challenge rank', () => {
    expect(recommendedRankForStage(getStage('easy-1'))).toBe('beginner');
    expect(recommendedRankForStage(getStage('hard-5'))).toBe('beginner');
    expect(recommendedRankForStage(getStage('nightmare-1'))).toBe('intermediate');
    expect(recommendedRankForStage(getStage('hell-1'))).toBe('expert');
    expect(recommendedRankForStage(getStage('inferno-1'))).toBe('master');
    expect(recommendedRankForStage(getStage('epic-1'))).toBe('veteran');
    expect(recommendedRankForStage(getStage('mythic-1'))).toBe('legend');
    expect(recommendedRankForStage(getStage('calamity-1'))).toBe('transcendent');
    expect(recommendedRankForStage(getStage('cataclysm-1'))).toBe('immortal');
    expect(recommendedRankForStage(getStage('apocalypse-1'))).toBe('absolute');
  });

  it('assigns bots the recommended rank without emitting elite arrival events', () => {
    const engine = new GameEngine(
      'BOTRANK',
      generateMap(81_283),
      true,
      { stageId: 'inferno-1', playMode: 'solo' },
    );
    const host = engine.join({
      nickname: '실제 생존자',
      deviceId: 'device-bot-rank',
    });
    engine.drainEvents();
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    const bot = engine.snapshot().players.find((player) => player.isBot);
    expect(bot?.soloRank).toBe('master');
    expect(bot?.multiplayerRank).toBe('master');
    expect(bot?.displayRank).toBe('master');
    expect(
      engine.drainEvents().some((event) => event.kind === 'elite-join'),
    ).toBe(false);
  });

  it('records three-bot role, occupancy, construction, and AI warning diagnostics', () => {
    const engine = new GameEngine(
      'BOTDIAGNOSTICS',
      generateMap(81_286),
      true,
      { stageId: 'hard-5', playMode: 'solo' },
    );
    const host = engine.join({
      nickname: '봇 진단 호스트',
      deviceId: 'device-bot-diagnostics',
    });
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.addBot(host.player.id, 'normal').ok).toBe(true);
    expect(engine.start(host.player.id).ok).toBe(true);
    advanceFrozenIntros(engine);
    const prepared = engine.serialize();
    const bots = prepared.snapshot.players.filter((player) => player.isBot);
    bots.forEach((bot, index) => {
      const bed = engine.map.rooms[index]?.beds[0];
      if (!bed) throw new Error('missing diagnostic bot bed');
      bot.position = { ...bed };
      const runtime = prepared.botRuntime.find(([botId]) => botId === bot.id)?.[1];
      if (runtime)
        runtime.bedTarget = {
          roomId: engine.map.rooms[index]?.id ?? '',
          bedIndex: 0,
        };
    });
    engine.restore(prepared);
    for (let index = 0; index < 40; index += 1) engine.tick(0.1);

    const diagnostics = engine.botMatchDiagnostics();
    expect(diagnostics.map((entry) => entry.strategy).sort()).toEqual(
      ['controller', 'guardian', 'gunner'],
    );
    expect(diagnostics.every((entry) => entry.rank === 'beginner')).toBe(true);
    expect(
      diagnostics.every((entry) => entry.claimedAt !== null),
      JSON.stringify(diagnostics),
    ).toBe(true);
    expect(diagnostics.every((entry) => entry.firstTurretAt !== null)).toBe(true);
    expect(
      diagnostics.every(
        (entry) =>
          entry.idleWithResourcesWarnings === 0 &&
          entry.repeatedFailureWarnings === 0,
      ),
    ).toBe(true);
  });

  it('does not let a recommended bot rank increase human ghost rank pressure', () => {
    const ghostHpWithBotRank = (botRank: PlayerState['soloRank']): number => {
      const engine = new GameEngine(
        'BOTRANKPRESSURE',
        generateMap(81_284),
        false,
        { stageId: 'easy-1', playMode: 'solo' },
      );
      const host = engine.join({
        nickname: '등급 압박 확인',
        deviceId: `device-rank-pressure-${botRank}`,
        soloRank: 'beginner',
        multiplayerRank: 'beginner',
      });
      expect(engine.addBot(host.player.id, 'hard').ok).toBe(true);
      const persisted = engine.serialize();
      const bot = persisted.snapshot.players.find((player) => player.isBot);
      if (!bot) throw new Error('missing rank pressure bot');
      bot.soloRank = botRank;
      bot.multiplayerRank = botRank;
      bot.displayRank = botRank;
      engine.restore(persisted);
      begin(engine, host.player.id);
      return engine.snapshot().ghost.maxHp;
    };

    expect(ghostHpWithBotRank('absolute')).toBeCloseTo(
      ghostHpWithBotRank('beginner'),
      5,
    );
  });

  it('applies solo-rank benefits while construction ceilings stay fixed', () => {
    expect(rankBenefits('beginner').speedMultiplier).toBe(1);
    expect(rankBenefits('beginner').bedGoldMultiplier).toBe(1);
    expect(rankBenefits('intermediate').bedGoldMultiplier).toBe(1.1);
    expect(rankBenefits('legend').bedGoldMultiplier).toBe(1.5);
    expect(rankBenefits('legend').ghostDifficultyMultiplier).toBe(1.25);
    expect(maxBuildingLevel('reinforced-door', 'expert')).toBe(15);
    expect(maxBuildingLevel('basic-turret', 'master')).toBe(15);
    expect(maxBuildingLevel('basic-turret', 'legend')).toBe(15);
    expect(upgradeCost('arc-turret', 1, 'legend').gold).toBe(250);
  });

  it('keeps elite join effects while legacy turret construction stays disabled for every rank', () => {
    const map = generateMap(81_281);
    const beginnerEngine = new GameEngine('BEGINNER', map, true);
    const beginner = beginnerEngine.join({ nickname: '초보생존자', deviceId: 'device-beginner', soloRank: 'beginner', multiplayerRank: 'beginner' });
    begin(beginnerEngine, beginner.player.id);
    const beginnerRoom = assigned(beginnerEngine, beginner.player.id);
    expect(beginnerEngine.build(beginner.player.id, beginnerRoom.roomId, beginnerRoom.tile, 'arc-turret').error).toContain('수호 포탑');

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
    expect(veteranEngine.build(veteran.player.id, veteranRoom.roomId, veteranRoom.tile, 'arc-turret').error).toContain('수호 포탑');
    expect(veteranEngine.build(veteran.player.id, veteranRoom.roomId, veteranRoom.tile, 'basic-turret').ok).toBe(true);
  });

  it('starts the last stage with substantially stronger ghosts and active skills', () => {
    const easy = new GameEngine('EASYSTAGE', generateMap(19_001), false, { stageId: 'easy-1', playMode: 'solo' });
    const easyPlayer = easy.join({ nickname: '쉬움도전자', deviceId: 'device-easy' });
    begin(easy, easyPlayer.player.id);

    const legendary = new GameEngine('LASTSTAGE', generateMap(19_002), false, { stageId: 'apocalypse-99', playMode: 'solo' });
    const legendaryPlayer = legendary.join({ nickname: '신화도전자', deviceId: 'device-legendary' });
    begin(legendary, legendaryPlayer.player.id);
    expect(legendary.snapshot().ghost.maxHp).toBeGreaterThan(easy.snapshot().ghost.maxHp * 5);
    expect(legendary.snapshot().stageLabel).toBe('종말 99');

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
