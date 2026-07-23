import { describe, expect, it } from 'vitest';
import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost } from '../src/shared/balance';
import { COSMETIC_CATALOG, cosmeticAvailable, cosmeticById, customizationReward, DEFAULT_APPEARANCE, defaultSkinForCharacter, normalizeAppearance, STARTER_COSMETICS } from '../src/shared/customization';
import { CHARACTER_TRAITS, characterTrait, characterTraitForAppearance, drawLimitForCharacter } from '../src/shared/characterTraits';
import { TURRET_SKIN_TRAITS, turretSkinTrait } from '../src/shared/turretSkinTraits';
import { connectedWalkableCount, fullRoomFloorKeys, generateMap, isBuildTile, isWalkable, isWalkableArea, moveInWalkableArea, validateMap } from '../src/shared/map';
import { findPath } from '../src/shared/pathfinding';
import { getStage, higherRank, rankBadgeSymbol, rankBenefits, rankFromXp, RANK_VISUALS, STAGES } from '../src/shared/progression';
import { parseClientMessage } from '../src/shared/protocol';
import { SeededRandom } from '../src/shared/rng';
import { DRAW_COSTS, RANDOM_ITEMS } from '../src/shared/randomItems';
import { SHOP_CONSUMABLES } from '../src/shared/shopConsumables';
import { stageThemeFor } from '../src/shared/stageThemes';
import { DOOR_VISUALS, doorVisualForLevel } from '../src/shared/doorVisuals';
import type { ClientMessage, GameSnapshot, Tile } from '../src/shared/types';
import { GameEngine } from '../src/server/engine';
import { dampFacingYaw, movementFacingYaw, shortestAngleDelta } from '../src/client/game/avatarMath';
import { attackFrameAt, ghostSpriteDefinition, movementFrameAt, spriteFacingFromDelta, survivorSpriteDefinition, survivorSpriteId } from '../src/client/game/AtlasSpriteActor';
import { mobileViewportCompatibilityScale } from '../src/client/viewport';
import { cosmeticPreviewLayerUrl, cosmeticProductUrl } from '../src/client/game/CosmeticAssets';
import { baseConceptUrl, skinConceptUrl, skinMovementSheetUrl, skinSleepUrl } from '../src/client/game/SkinAssets';

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

  it('defines ten ordered door materials and holds the last material for future extension levels', () => {
    expect(DOOR_VISUALS.map((door) => door.label)).toEqual([
      '나무 문', '녹슨 강철문', '빛바랜 강철문', '빨간 강철문', '단단한 철창',
      '빛나는 철창', '강철 티타늄', '은빛 티타늄', '금빛 티타늄', '다이아 티타늄',
    ]);
    expect(doorVisualForLevel(11).label).toBe('다이아 티타늄');
  });

  it('generates the same compact eight-room map with eight recovery pads for a seed', () => {
    const first = generateMap(123_456);
    const second = generateMap(123_456);
    expect(first).toEqual(second);
    expect(validateMap(first)).toBe(true);
    expect(connectedWalkableCount(first)).toBe(first.walkable.length);
    expect(first.rooms).toHaveLength(8);
    expect(first.respawnZones).toHaveLength(8);
    expect(new Set(first.respawnZones.map((zone) => `${zone.x},${zone.y}`))).toHaveLength(8);
    expect(first.rooms.every((room) => room.floorTiles.length >= 20 && room.floorTiles.length <= 25)).toBe(true);
    expect(first.rooms.every((room) => room.buildTiles.length === room.floorTiles.length - 1)).toBe(true);
    expect(new Set(first.rooms.map((room) => room.shape)).size).toBeGreaterThanOrEqual(6);
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

  it('keeps a full room floor closed while leaving its doorway reachable', () => {
    const map = generateMap(4_204);
    const room = map.rooms[0];
    if (!room) throw new Error('missing room fixture');
    const blocked = fullRoomFloorKeys(map, [{ id: room.id, ownerIds: ['owner'] }], 1);
    const floor = room.floorTiles[0];
    expect(floor).toBeDefined();
    expect(blocked.has(`${floor?.x},${floor?.y}`)).toBe(true);
    expect(blocked.has(`${room.door.x},${room.door.y}`)).toBe(false);
  });

  it('creates eight twenty-five-tile multiplayer rooms with two beds each', () => {
    const map = generateMap(7_707, 'multiplayer');
    expect(validateMap(map)).toBe(true);
    expect(map.playMode).toBe('multiplayer');
    expect(map.rooms).toHaveLength(8);
    expect(map.rooms.every((room) => room.floorTiles.length === 25)).toBe(true);
    expect(map.rooms.every((room) => room.beds.length === 2 && room.buildTiles.length === 23)).toBe(true);
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

  it('mirrors only the ghost side sheets that were illustrated facing left', () => {
    expect(ghostSpriteDefinition('wanderer').sideFacesLeft).toBe(true);
    expect(ghostSpriteDefinition('brute').sideFacesLeft).toBe(true);
    expect(ghostSpriteDefinition('caster').sideFacesLeft).toBe(false);
    expect(ghostSpriteDefinition('undead').sideFacesLeft).toBe(false);
    expect(survivorSpriteDefinition(DEFAULT_APPEARANCE).sleepUrl).toBe('/assets/paperdoll/bases/character-bunny/sleep.png');
  });

  it('rotates the -Z-facing avatar toward movement instead of walking backward', () => {
    expect(movementFacingYaw(0, -1)).toBeCloseTo(0);
    expect(Math.abs(movementFacingYaw(0, 1))).toBeCloseTo(Math.PI);
    expect(movementFacingYaw(1, 0)).toBeCloseTo(-Math.PI / 2);
    expect(movementFacingYaw(-1, 0)).toBeCloseTo(Math.PI / 2);
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

  it('defines characters, complete skins, and turret skins without equipment slots', () => {
    expect(COSMETIC_CATALOG).toHaveLength(36);
    expect(new Set(COSMETIC_CATALOG.map((item) => item.slot))).toEqual(
      new Set(['character', 'skin', 'turret']),
    );
    expect(STARTER_COSMETICS).toContain(DEFAULT_APPEARANCE.character);
    expect(STARTER_COSMETICS).not.toContain(DEFAULT_APPEARANCE.skin);
    expect(COSMETIC_CATALOG.filter((item) => item.slot === 'skin')).toHaveLength(12);
    expect(defaultSkinForCharacter('character-fox')).toBe('skin-basic-fox');
  });

  it('uses base concept art for characters and complete art only for skin cards', () => {
    expect(baseConceptUrl('character-bunny')).toBe('/assets/paperdoll/bases/character-bunny/concept.png');
    expect(cosmeticProductUrl('skin-look-bunny-ward')).toBe('/assets/sprites/survivors/character-bunny/concept.png');
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
    expect(characterTrait('character-duck').goldPerSecond).toBe(3);
    expect(characterTrait('character-tiger').turretRangeBonus).toBe(1);
    expect(characterTrait('character-dinosaur').turretRateMultiplier).toBeCloseTo(1 / 1.4, 6);
    expect(drawLimitForCharacter('character-monkey')).toBe(6);
    expect(characterTrait('character-gorilla').occupiedDoorLevelBonus).toBe(1);
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
    expect(COSMETIC_CATALOG.filter((item) => item.slot === 'skin').every(
      (item) => item.unlock.kind === 'points' && (item.id === 'skin-look-bunny-ward' || item.unlock.price === 2_500),
    )).toBe(true);
  });

  it('normalizes old equipment saves to their character base skin and scales clear rewards', () => {
    expect(normalizeAppearance({ character: 'hat-beanie', shoes: 'invalid' })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ character: 'character-bunny', outfit: 'outfit-raincoat' })).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ character: 'character-cat', skin: 'skin-look-bunny-ward' }))
      .toEqual({ character: 'character-cat', skin: 'skin-basic-cat' });
    expect(normalizeAppearance({ character: 'character-eagle' }).character).toBe('character-tiger');
    expect(customizationReward(0)).toBe(80);
    expect(customizationReward(5)).toBe(100);
    expect(customizationReward(105)).toBe(500);
    expect(customizationReward(999)).toBe(500);
  });
});

describe('shop consumable rules', () => {
  it('keeps thirty tactical supplies separate from lamp rewards', () => {
    expect(SHOP_CONSUMABLES).toHaveLength(30);
    expect(new Set(SHOP_CONSUMABLES.map((item) => item.id)).size).toBe(SHOP_CONSUMABLES.length);
    expect(SHOP_CONSUMABLES.every((item) => !RANDOM_ITEMS.some((random) => random.id === item.id))).toBe(true);
    expect(SHOP_CONSUMABLES.filter((item) => item.category === 'scout')).toHaveLength(10);
    expect(SHOP_CONSUMABLES.filter((item) => item.category === 'survival')).toHaveLength(10);
    expect(SHOP_CONSUMABLES.filter((item) => item.category === 'construction')).toHaveLength(10);
  });

  it('allows a selected supply once per match and retains the remaining account inventory', () => {
    const engine = new GameEngine('SUPPLYROOM', generateMap(9_078), true);
    const joined = engine.join({
      nickname: 'SupplyTester',
      deviceId: 'device-supply-tester',
      consumables: [{ itemId: 'adrenal-shot', quantity: 2 }],
    });
    expect(engine.handle(joined.player.id, envelope({ type: 'set-consumable-loadout', itemIds: ['adrenal-shot'] })).ok).toBe(true);
    expect(engine.start(joined.player.id).ok).toBe(true);
    for (let index = 0; index < 400 && engine.snapshot().status === 'COUNTDOWN'; index += 1) engine.tick(0.1);
    expect(engine.snapshot().status).toBe('PLAYING');
    expect(engine.handle(joined.player.id, envelope({ type: 'use-consumable', itemId: 'adrenal-shot' }, 2)).ok).toBe(true);
    const player = engine.snapshot().players.find((candidate) => candidate.id === joined.player.id);
    expect(player?.consumables).toEqual([{ itemId: 'adrenal-shot', quantity: 1 }]);
    expect(player?.usedConsumables).toEqual(['adrenal-shot']);
    expect(player?.speedBoostUntil).toBeGreaterThan(engine.snapshot().elapsed);
    expect(engine.handle(joined.player.id, envelope({ type: 'use-consumable', itemId: 'adrenal-shot' }, 3)).ok).toBe(false);
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

  it('keeps explicitly claimed solo beds in distinct rooms', () => {
    const { engine, ids } = setup(4);
    const state = begin(engine, ids[0] as string);
    const occupied = state.players.map((player) => player.roomId);
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(state.rooms.filter((room) => room.ownerId).length).toBe(4);
  });

  it('does not allow a solo survivor to enter a room already claimed by a bot', () => {
    const { engine, ids } = setup(1, false);
    const hostId = ids[0] as string;
    expect(engine.addBot(hostId, 'normal').ok).toBe(true);
    expect(engine.start(hostId).ok).toBe(true);
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

  it('never auto-occupies a bed and pursues an unoccupied survivor at 3x speed', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    expect(engine.start(playerId).ok).toBe(true);
    for (let index = 0; index < 12; index += 1) engine.tick(0.1);
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
    expect(BALANCE.ghost.outsideTargetSpeedMultiplier).toBe(3);
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
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBe(950);
    expect(engine.removeBuilding(playerId, buildingId).ok).toBe(true);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBe(985);
    expect(engine.snapshot().buildings).toHaveLength(0);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
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

  it('sells support devices for power only and deducts no gold', () => {
    expect(upgradeCost('repair-drone', 1)).toEqual({ gold: 0, power: 6 });
    expect(upgradeCost('electric-coil', 1)).toEqual({ gold: 0, power: 12 });
    expect(upgradeCost('floor-trap', 1)).toEqual({ gold: 0, power: 4 });
    expect(upgradeCost('shield-device', 1)).toEqual({ gold: 0, power: 9 });

    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing power-only player');
    player.gold = 0;
    player.power = 18;
    engine.restore(persisted);

    expect(engine.build(playerId, roomId, tile, 'repair-drone').ok).toBe(true);
    const updated = engine.snapshot().players.find((candidate) => candidate.id === playerId);
    expect(updated?.gold).toBe(0);
    expect(updated?.power).toBe(12);
  });

  it('builds a five-level power gem with doubled costs and doubled gold income', () => {
    const costs = [125, 250, 500, 1_000, 2_000];
    const income = [8, 16, 32, 64, 128];
    costs.forEach((power, index) => {
      expect(upgradeCost('gem-core', index + 1)).toEqual({ gold: 0, power });
      expect(buildingStats('gem-core', index + 1).value).toBe(income[index]);
    });
    expect(maxBuildingLevel('gem-core')).toBe(5);

    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing gem owner');
    player.gold = 0;
    player.power = 125;
    engine.restore(persisted);
    expect(engine.build(playerId, roomId, tile, 'gem-core').ok).toBe(true);
    engine.tick(0.1);
    engine.tick(0.1);
    engine.tick(0.05);
    expect(engine.snapshot().players.find((candidate) => candidate.id === playerId)?.gold).toBeCloseTo(9, 5);
  });

  it('nets only a low-health ghost attacking the owning room door for 1.5 seconds', () => {
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
    ghost.targetRoomId = roomId;
    ghost.targetPlayerId = null;
    ghost.hp = ghost.maxHp * 0.3;
    ghost.retreating = false;
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
    expect(parseClientMessage(JSON.stringify({ type: 'kick-player', sequence: 2, timestamp: 2, playerId: 77 })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: 'remove-building', sequence: 3, timestamp: 2, buildingId: 'building-1' })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: 'leave-room', sequence: 4, timestamp: 2 })).ok).toBe(true);
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
    expect(engine.snapshot().ghost.targetRoomId).toBe(rooms[1]);
    expect(engine.drainEvents().some((event) => event.kind === 'ghost-skill' && event.label?.includes('순간이동'))).toBe(true);
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

  it('emits gold and power income once per second at the producing bed and generator', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const mapRoom = engine.map.rooms.find((room) => room.id === roomId);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
    engine.drainEvents();
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing income player');
    player.goldIncomeElapsed = 0;
    player.powerIncomeElapsed = 0;
    engine.restore(persisted);
    for (let index = 0; index < 4; index += 1) engine.tick(0.05);
    expect(engine.drainEvents().some((event) => event.kind === 'power')).toBe(false);
    engine.tick(0.05);
    const events = engine.drainEvents();
    expect(events.some((event) => event.kind === 'gold' && event.amount === 1 && event.position?.x === mapRoom?.bed.x && event.position?.y === mapRoom?.bed.y)).toBe(true);
    expect(events.some((event) => event.kind === 'power' && event.amount === 1 && event.position?.x === tile.x && event.position?.y === tile.y)).toBe(true);
  });

  it('keeps generator upgrades on one-second payouts while doubling the power amount through level ten', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    expect(engine.build(playerId, roomId, tile, 'generator').ok).toBe(true);
    const generatorId = engine.snapshot().buildings.find((building) => building.kind === 'generator')?.id;
    if (!generatorId) throw new Error('missing generator');
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('missing generator owner');
    player.gold = 100_000;
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

  it('keeps the guardian turret as the sole live attack turret and makes frost spray a power-only utility', () => {
    expect(buildingStats('basic-turret', 1)).toMatchObject({ gold: 10, power: 0, range: 4 });
    expect(maxBuildingLevel('basic-turret')).toBe(15);
    expect(upgradeCost('basic-turret', 2)).toEqual({ gold: 40, power: 0 });

    expect(buildingStats('frost-turret', 1)).toMatchObject({ gold: 0, power: 200, value: 0.12, range: 4.5 });
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
    const nextTile = engine.map.rooms.find((room) => room.id === roomId)?.buildTiles[1];
    if (!nextTile) throw new Error('missing legacy-build tile');
    expect(engine.build(playerId, roomId, nextTile, 'rapid-turret').error).toContain('수호 포탑');
    expect(engine.build(playerId, roomId, nextTile, 'arc-turret').error).toContain('수호 포탑');
    expect(engine.build(playerId, roomId, nextTile, 'golden-turret').error).toContain('수호 포탑');
    expect(engine.build(playerId, roomId, nextTile, 'frost-turret').ok).toBe(true);
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

  it('upgrades an intact door through its ten visual tiers but never level eleven', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const persisted = engine.serialize();
    const player = persisted.snapshot.players.find((candidate) => candidate.id === playerId);
    if (!player?.roomId) throw new Error('missing max-door player');
    player.gold = 999_999;
    player.power = 999_999;
    engine.restore(persisted);
    for (let level = 2; level <= 10; level += 1) expect(engine.upgrade(playerId, `door:${player.roomId}`).ok).toBe(true);
    const door = engine.snapshot().rooms.find((room) => room.id === player.roomId);
    expect(door?.doorLevel).toBe(10);
    expect(door?.doorMaxHp).toBe(2_840);
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

  it('keeps an unclaimed survivor out of a full solo room', () => {
    const { engine, ids } = setup(2);
    const hostId = ids[0] as string;
    const intruderId = ids[1] as string;
    expect(engine.start(hostId).ok).toBe(true);
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
    ).toBe(false);
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
      { id: 'max-repair', kind: 'repair-drone', roomId: room.id, ownerId: playerId, tile: defensiveTiles[0] as Tile, level: 3, cooldown: 0, hp: 100, skinId: 'drone-heart' },
      { id: 'max-shield', kind: 'shield-device', roomId: room.id, ownerId: playerId, tile: defensiveTiles[1] as Tile, level: 3, cooldown: 0, hp: 100, skinId: 'shield-default' },
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

  it('retreats toward the respawn area below twenty-three percent HP', () => {
    const { engine, ids } = setup();
    begin(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    expect(ghost).toBeDefined();
    if (!ghost) return;
    ghost.position = { ...engine.map.playerSpawn };
    ghost.hp = ghost.maxHp * .22;
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
    ghost.hp = ghost.maxHp * .22;
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
    expect(retreater?.slowMultiplier).toBeCloseTo(0.88, 5);
    expect(retreater?.slowUntil).toBeGreaterThan(engine.snapshot().elapsed);
    expect(after).not.toBe(before);
    expect(retreater?.path.length).toBeGreaterThan(0);
    expect(events.filter((event) => event.kind === 'ghost-retreat')).toHaveLength(1);
  });

  it('applies each shadow trap level\'s full slow strength while a ghost retreats', () => {
    const { engine, ids } = setup();
    const playerId = ids[0] as string;
    begin(engine, playerId);
    const { roomId, tile } = assigned(engine, playerId);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.ghosts[0];
    if (!ghost) throw new Error('missing shadow trap ghost');
    ghost.position = { ...tile };
    ghost.hp = ghost.maxHp * 0.22;
    ghost.retreating = false;
    ghost.healing = false;
    persisted.snapshot.ghost = ghost;
    persisted.snapshot.buildings.push({
      id: 'shadow-trap-max', kind: 'floor-trap', roomId, ownerId: playerId,
      tile: { ...tile }, level: 3, cooldown: 0, hp: 100, skinId: '',
    });
    engine.restore(persisted);
    engine.tick(0.1);
    const retreater = engine.snapshot().ghosts[0];
    expect(retreater?.retreating).toBe(true);
    expect(retreater?.slowMultiplier).toBeCloseTo(0.55, 5);
    expect(retreater?.slowUntil).toBeGreaterThan(engine.snapshot().elapsed);
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

  it('offers thirty weighted items with only two blanks and keeps the fifth draw fox-exclusive', () => {
    expect(RANDOM_ITEMS).toHaveLength(30);
    expect(RANDOM_ITEMS.filter((item) => Object.keys(item.effect).length === 0)).toHaveLength(2);
    expect(RANDOM_ITEMS.filter((item) => Object.keys(item.effect).length === 0).map((item) => item.id).sort()).toEqual(['cracked-mirror', 'wet-socks']);
    expect(RANDOM_ITEMS.find((item) => item.id === 'mythic-ark')?.effect).toMatchObject({ goldPerSecond: 500, powerPerSecond: 150 });
    expect(RANDOM_ITEMS.find((item) => item.id === 'mythic-ark')?.rarity).toBe('mythic');
    expect(RANDOM_ITEMS.find((item) => item.id === 'golden-ticket')?.effect.goldenTurretTickets).toBe(1);
    expect(RANDOM_ITEMS.find((item) => item.id === 'void-cat')?.effect.goldPerSecond).toBe(20);
    expect(RANDOM_ITEMS.find((item) => item.id === 'hundred-robot')?.effect.powerPerSecond).toBe(100);
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
    for (let index = 0; index < 4; index += 1) expect(engine.drawItem(playerId, machineId).ok).toBe(true);
    expect(engine.snapshot().players[0]?.drawCount).toBe(4);
    expect(engine.snapshot().players[0]?.gold).toBe(580);
    expect(engine.snapshot().players[0]?.power).toBe(1_000);
    expect(engine.drawItem(playerId, machineId).ok).toBe(false);
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
    const machine = engine.snapshot().buildings.find((building) => building.kind === 'lucky-machine');
    if (!machine) throw new Error('missing lucky machine');
    for (let index = 0; index < 5; index += 1) expect(engine.drawItem(playerId, machine.id).ok).toBe(true);
    expect(engine.drawItem(playerId, machine.id).ok).toBe(false);
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
    expect(characterTraitForAppearance({ character: 'character-bunny', skin: 'skin-look-bunny-ward' }).unclaimedMoveSpeedMultiplier)
      .toBe(1.5);
    expect(characterTraitForAppearance({ character: 'character-hamster', skin: 'skin-basic-hamster' }).firstGuardianLevelBonus)
      .toBe(1);
    expect(characterTraitForAppearance({ character: 'character-hamster', skin: 'skin-look-hamster-ward' }).firstGuardianLevelBonus)
      .toBe(2);
    expect(characterTraitForAppearance({ character: 'character-gorilla', skin: 'skin-basic-gorilla' }).occupiedDoorLevelBonus)
      .toBe(1);
    expect(characterTraitForAppearance({ character: 'character-gorilla', skin: 'skin-look-gorilla-ward' }).occupiedDoorLevelBonus)
      .toBe(2);
  });

  it('starts the hamster guardian turret at Lv.2, or Lv.3 with its skin, only once', () => {
    const verifyInitialGuardian = (appearance: { character: string; skin: string }, expectedLevel: number): void => {
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
      expect(guardians.map((building) => building.level)).toEqual([expectedLevel, 1]);
    };

    verifyInitialGuardian({ character: 'character-hamster', skin: 'skin-basic-hamster' }, 2);
    verifyInitialGuardian({ character: 'character-hamster', skin: 'skin-look-hamster-ward' }, 3);
  });

  it('raises the gorilla room door to Lv.2, or Lv.3 with its skin, on occupancy', () => {
    const verifyDoorLevel = (appearance: { character: string; skin: string }, expectedLevel: number): void => {
      const { engine, ids } = setup();
      const playerId = ids[0] as string;
      expect(engine.start(playerId).ok).toBe(true);
      const mapRoom = engine.map.rooms[0];
      if (!mapRoom) throw new Error('missing room');
      const configured = engine.serialize();
      const player = configured.snapshot.players.find((candidate) => candidate.id === playerId);
      if (!player) throw new Error('missing gorilla owner');
      player.appearance = appearance;
      player.position = { ...(mapRoom.beds[0] as Tile) };
      engine.restore(configured);
      expect(engine.interact(playerId).ok).toBe(true);
      expect(engine.snapshot().rooms.find((room) => room.id === mapRoom.id)?.doorLevel).toBe(expectedLevel);
    };

    verifyDoorLevel({ character: 'character-gorilla', skin: 'skin-basic-gorilla' }, 2);
    verifyDoorLevel({ character: 'character-gorilla', skin: 'skin-look-gorilla-ward' }, 3);
  });

  it('can create all nine primary ghost variants as match events', () => {
    const variants = new Set<string>();
    for (let index = 0; index < 120; index += 1) {
      const engine = new GameEngine(`EVENT${index}`, generateMap(30_000 + index), false);
      const state = engine.snapshot();
      for (const ghost of state.ghosts) variants.add(ghost.variant);
    }
    expect(variants).toEqual(new Set([
      'wanderer', 'swift', 'brute', 'caster', 'twin-a', 'twin-b', 'teleporter', 'undead', 'giant',
    ]));
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
    expect(rankBenefits('beginner').bedGoldMultiplier).toBe(1);
    expect(rankBenefits('intermediate').bedGoldMultiplier).toBe(1.1);
    expect(rankBenefits('legend').bedGoldMultiplier).toBe(1.5);
    expect(rankBenefits('legend').ghostDifficultyMultiplier).toBe(1.25);
    expect(rankBenefits('veteran').rareTurretUnlocked).toBe(true);
    expect(maxBuildingLevel('reinforced-door', 'expert')).toBe(10);
    expect(maxBuildingLevel('basic-turret', 'master')).toBe(16);
    expect(maxBuildingLevel('basic-turret', 'legend')).toBe(17);
    expect(upgradeCost('arc-turret', 1, 'legend').gold).toBe(175);
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
