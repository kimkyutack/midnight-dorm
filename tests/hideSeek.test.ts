import { describe, expect, it } from 'vitest';
import { HIDE_SEEK_RULES, generateHideSeekMap, hideSeekGhostLightSees, hideSeekLanternSees, hideSeekVictoryPoints, parseHideSeekClientMessage, resolveHideSeekMovement, shouldReconcileHideSeekMovement } from '../src/shared/hideSeek';
import { HideSeekEngine } from '../src/server/hideSeekEngine';

function joinedEngine(players = 3): { engine: HideSeekEngine; ids: string[] } {
  const engine = new HideSeekEngine('HIDESEEK', 73_401);
  const ids: string[] = [];
  for (let index = 0; index < players; index += 1) {
    const result = engine.join({
      nickname: `Runner${index + 1}`,
      deviceId: `hide-seek-device-${index + 1}`,
    });
    ids.push(result.player.id);
    if (index > 0) engine.setReady(result.player.id, true);
  }
  engine.setPreference(ids[0] as string, 'ghost');
  return { engine, ids };
}

function advanceToHunt(engine: HideSeekEngine, hostId: string): void {
  expect(engine.start(hostId).ok).toBe(true);
  for (let index = 0; index < 260 && engine.snapshot().phase !== 'HUNT'; index += 1) engine.tick(0.1);
  expect(engine.snapshot().phase).toBe('HUNT');
}

describe('hide-and-seek map', () => {
  it('does not pull an aligned local prediction back to a trailing snapshot', () => {
    expect(shouldReconcileHideSeekMovement(
      { x: 12, y: 8 },
      { x: 10.5, y: 8 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
    )).toBe(false);
  });

  it('reconciles after the player changes direction ahead of the server', () => {
    expect(shouldReconcileHideSeekMovement(
      { x: 12, y: 8 },
      { x: 10.5, y: 8 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    )).toBe(true);
  });

  it('slides along a wall instead of freezing diagonal movement', () => {
    const blocked = new Set(['2,1']);
    const canOccupy = (tile: { x: number; y: number }): boolean => !blocked.has(`${Math.round(tile.x)},${Math.round(tile.y)}`);
    expect(resolveHideSeekMovement(
      { x: 1, y: 1 },
      { x: 0.6, y: 0.4 },
      canOccupy,
    )).toEqual({ x: 1, y: 1.4 });
  });

  it('is deterministic, connected, large, and supplies enough hiding choices', () => {
    const map = generateHideSeekMap(91_337);
    expect(generateHideSeekMap(91_337)).toEqual(map);
    expect(map.width).toBe(84);
    expect(map.height).toBe(60);
    expect(map.hideouts.length).toBeGreaterThanOrEqual(40);
    expect(map.landmarks).toHaveLength(4);
    expect(map.keySpawns.length).toBeGreaterThanOrEqual(18);
    expect(map.exitCandidates).toHaveLength(4);
    const walkable = new Set(map.walkable.map((tile) => `${tile.x},${tile.y}`));
    const first = map.walkable[0];
    if (!first) throw new Error('hide-and-seek map has no walkable tile');
    const visited = new Set([`${first.x},${first.y}`]);
    const queue = [first];
    for (let index = 0; index < queue.length; index += 1) {
      const tile = queue[index];
      if (!tile) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = `${tile.x + dx},${tile.y + dy}`;
        if (!walkable.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push({ x: tile.x + dx, y: tile.y + dy });
      }
    }
    expect(visited.size).toBe(walkable.size);
  });

  it('keeps every exit candidate in the authoritative map only', () => {
    const engine = new HideSeekEngine('PRIVATE1', 91_337);
    expect(engine.map.exitCandidates).toHaveLength(4);
    expect(engine.mapForClient().exitCandidates).toEqual([]);
  });

  it('uses a wall-blocked 360-degree lantern radius and ignores hidden survivors', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const state = engine.serialize();
    const ghost = state.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = state.snapshot.players.find((player) => player.role === 'survivor');
    if (!ghost || !survivor) throw new Error('missing assigned roles');
    const openMap = { ...engine.map, walls: [] };
    ghost.position = { x: 10, y: 10 };
    ghost.direction = { x: 1, y: 0 };
    survivor.position = { x: 11.8, y: 10 };
    expect(hideSeekLanternSees(openMap, ghost, survivor)).toBe(true);
    survivor.position = { x: 10, y: 11.8 };
    expect(hideSeekLanternSees(openMap, ghost, survivor)).toBe(true);
    survivor.position = { x: 8.2, y: 10 };
    expect(hideSeekLanternSees(openMap, ghost, survivor)).toBe(true);
    survivor.position = { x: 7.8, y: 10 };
    expect(hideSeekLanternSees(openMap, ghost, survivor)).toBe(false);
    survivor.position = { x: 11.5, y: 10 };
    survivor.hiddenIn = 'hideout-test';
    expect(hideSeekLanternSees(openMap, ghost, survivor)).toBe(false);
  });
});

describe('hide-and-seek authoritative rules', () => {
  it('assigns one ghost as number 0 and unique survivor numbers', () => {
    const { engine, ids } = joinedEngine(7);
    expect(engine.start(ids[0] as string).ok).toBe(true);
    const state = engine.snapshot();
    expect(state.phase).toBe('ROLE_LOCK');
    expect(state.players.filter((player) => player.role === 'ghost')).toHaveLength(1);
    expect(state.players.find((player) => player.role === 'ghost')?.number).toBe(0);
    const survivorNumbers = state.players.filter((player) => player.role === 'survivor').map((player) => player.number);
    expect(new Set(survivorNumbers).size).toBe(6);
    expect(survivorNumbers.every((number) => number !== null && number >= 1 && number <= 6)).toBe(true);
  });

  it('lets the ghost move inside a closed holding room for 20 seconds, then opens the hunt', () => {
    const { engine, ids } = joinedEngine();
    expect(engine.start(ids[0] as string).ok).toBe(true);
    for (let index = 0; index < 51; index += 1) engine.tick(0.1);
    expect(engine.snapshot().phase).toBe('HIDE');
    const ghost = engine.snapshot().players.find((player) => player.role === 'ghost');
    if (!ghost) throw new Error('missing holding-room ghost');
    expect(engine.setMovement(ghost.id, 1, 0).ok).toBe(true);
    for (let index = 0; index < 5; index += 1) engine.tick(0.1);
    const confinedGhost = engine.snapshot().players.find((player) => player.id === ghost.id);
    expect(confinedGhost && engine.map.ghostRoom.interior.some((tile) => `${tile.x},${tile.y}` === `${Math.round(confinedGhost.position.x)},${Math.round(confinedGhost.position.y)}`)).toBe(true);
    for (let index = 0; index < 201; index += 1) engine.tick(0.1);
    expect(engine.snapshot().phase).toBe('HUNT');
    expect(engine.snapshot().keys).toHaveLength(1);

    const persisted = engine.serialize();
    persisted.snapshot.phaseRemaining = HIDE_SEEK_RULES.huntSeconds - 201;
    engine.restore(persisted);
    engine.tick(0.1);
    expect(engine.snapshot().keys).toHaveLength(5);
    expect(new Set(engine.snapshot().keys.map((key) => key.regionId)).size).toBeGreaterThan(1);
  });

  it('never lets survivors enter the ghost holding room', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const survivor = persisted.snapshot.players.find((player) => player.role === 'survivor');
    if (!survivor) throw new Error('missing survivor');
    survivor.position = { x: engine.map.ghostRoom.door.x, y: engine.map.ghostRoom.door.y + 1 };
    survivor.previousPosition = { ...survivor.position };
    engine.restore(persisted);
    expect(engine.setMovement(survivor.id, 0, -1).ok).toBe(true);
    for (let index = 0; index < 10; index += 1) engine.tick(0.1);
    const moved = engine.snapshot().players.find((player) => player.id === survivor.id);
    expect(Math.round(moved?.position.y ?? -1)).toBeGreaterThanOrEqual(engine.map.ghostRoom.door.y + 1);
  });

  it('keeps detection for four tiles and catches a survivor across a fast movement segment', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = persisted.snapshot.players.find((player) => player.role === 'survivor');
    if (!ghost || !survivor) throw new Error('missing roles');
    ghost.position = { x: 10, y: 10 };
    ghost.previousPosition = { x: 10, y: 10 };
    ghost.direction = { x: 1, y: 0 };
    survivor.position = { x: 11.5, y: 10 };
    survivor.previousPosition = { ...survivor.position };
    engine.restore(persisted);
    engine.tick(0.05);
    expect(engine.snapshot().players.find((player) => player.id === survivor.id)?.detected).toBe(true);

    const crossing = engine.serialize();
    const crossingGhost = crossing.snapshot.players.find((player) => player.id === ghost.id);
    const crossingSurvivor = crossing.snapshot.players.find((player) => player.id === survivor.id);
    if (!crossingGhost || !crossingSurvivor) throw new Error('missing crossing roles');
    crossingGhost.position = { x: 20, y: 20 };
    crossingGhost.previousPosition = { x: 18, y: 20 };
    crossingSurvivor.position = { x: 19, y: 20 };
    crossingSurvivor.previousPosition = { x: 19, y: 20 };
    engine.restore(crossing);
    engine.tick(0.01);
    expect(engine.snapshot().players.find((player) => player.id === survivor.id)?.alive).toBe(false);
  });

  it('warns both roles within six tiles and increases survivor footstep volume with proximity', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const arrange = (distance: number, hidden = false): { ghostId: string; survivorId: string } => {
      const persisted = engine.serialize();
      const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
      const survivors = persisted.snapshot.players.filter((player) => player.role === 'survivor');
      const survivor = survivors[0];
      if (!ghost || !survivor) throw new Error('missing proximity roles');
      ghost.position = { x: 10, y: 10 };
      ghost.previousPosition = { ...ghost.position };
      ghost.movement = { x: 0, y: 0 };
      survivor.position = { x: 10 + distance, y: 10 };
      survivor.previousPosition = { ...survivor.position };
      survivor.movement = { x: 0, y: 0 };
      survivor.hiddenIn = hidden ? 'hideout-test' : null;
      for (const other of survivors.slice(1)) {
        other.position = { x: 70, y: 50 };
        other.previousPosition = { ...other.position };
      }
      engine.restore(persisted);
      engine.tick(.01);
      return { ghostId: ghost.id, survivorId: survivor.id };
    };

    const far = arrange(5.9);
    const farSnapshot = engine.snapshot();
    const farLevel = farSnapshot.players.find((player) => player.id === far.survivorId)?.ghostFootstepLevel ?? 0;
    expect(farSnapshot.players.find((player) => player.id === far.survivorId)?.proximityAlert).toBe(true);
    expect(farSnapshot.players.find((player) => player.id === far.ghostId)?.proximityAlert).toBe(true);
    expect(farLevel).toBeGreaterThan(0);

    const close = arrange(2.5);
    const closeLevel = engine.snapshot().players.find((player) => player.id === close.survivorId)?.ghostFootstepLevel ?? 0;
    expect(closeLevel).toBeGreaterThan(farLevel);

    const hidden = arrange(5, true);
    const hiddenSnapshot = engine.snapshot();
    expect(hiddenSnapshot.players.find((player) => player.id === hidden.survivorId)?.proximityAlert).toBe(true);
    expect(hiddenSnapshot.players.find((player) => player.id === hidden.ghostId)?.proximityAlert).toBe(false);
    const ghostView = engine.snapshotFor(hidden.ghostId);
    expect(ghostView.players.find((player) => player.id === hidden.survivorId)).toMatchObject({
      position: { x: -999, y: -999 },
      proximityAlert: false,
      ghostFootstepLevel: 0,
    });

    const distant = arrange(6.1);
    const distantSnapshot = engine.snapshot();
    expect(distantSnapshot.players.find((player) => player.id === distant.survivorId)).toMatchObject({
      proximityAlert: false,
      ghostFootstepLevel: 0,
    });
  });

  it('keeps survivor team exploration private while giving the ghost its own explored map', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = persisted.snapshot.players.find((player) => player.role === 'survivor');
    if (!ghost || !survivor) throw new Error('missing roles');
    ghost.position = { x: 5, y: 5 };
    survivor.position = { x: 20, y: 20 };
    survivor.detected = false;
    persisted.snapshot.exploredTileKeys = ['20,20'];
    engine.restore(persisted);
    const ghostView = engine.snapshotFor(ghost.id);
    expect(ghostView.keys).toEqual([]);
    expect(ghostView.exploredTileKeys.length).toBeGreaterThan(0);
    expect(ghostView.exploredTileKeys).not.toContain('20,20');
    expect(ghostView.players.find((player) => player.id === survivor.id)?.position).toEqual({ x: -999, y: -999 });
    const survivorView = engine.snapshotFor(survivor.id);
    expect(survivorView.players.find((player) => player.id === ghost.id)?.position).toEqual({ x: -999, y: -999 });
  });

  it('never exposes the active exit to the ghost before, during, or after the hunt', () => {
    const { engine, ids } = joinedEngine();
    expect(engine.start(ids[0] as string).ok).toBe(true);
    const roleLocked = engine.snapshot();
    const ghost = roleLocked.players.find((player) => player.role === 'ghost');
    if (!ghost) throw new Error('missing ghost role');
    const authoritativeExit = roleLocked.activeExit;
    expect(authoritativeExit.x).toBeGreaterThanOrEqual(0);
    expect(engine.snapshotFor(ghost.id)).toMatchObject({
      activeExit: { x: -999, y: -999 },
      exitDiscovered: false,
    });

    for (let index = 0; index < 260 && engine.snapshot().phase !== 'HUNT'; index += 1) engine.tick(0.1);
    const discovered = engine.serialize();
    discovered.snapshot.exitDiscovered = true;
    engine.restore(discovered);
    expect(engine.snapshotFor(ghost.id)).toMatchObject({
      activeExit: { x: -999, y: -999 },
      exitDiscovered: false,
    });

    const finished = engine.serialize();
    finished.snapshot.phase = 'RESULT';
    finished.snapshot.winner = 'ghost';
    engine.restore(finished);
    expect(engine.snapshotFor(ghost.id)).toMatchObject({
      activeExit: { x: -999, y: -999 },
      exitDiscovered: false,
    });
    expect(engine.snapshot().activeExit).toEqual(authoritativeExit);
  });

  it('carries a nearby key without unlocking a lock and rejects a second key for the same survivor', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const keyState = engine.serialize();
    keyState.snapshot.phaseRemaining = HIDE_SEEK_RULES.huntSeconds - 201;
    const ghost = keyState.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = keyState.snapshot.players.find((player) => player.role === 'survivor');
    const safeGhostTile = engine.map.walkable.find((tile) => Math.hypot(tile.x - keyState.snapshot.activeExit.x, tile.y - keyState.snapshot.activeExit.y) > 20);
    if (!ghost || !survivor || !safeGhostTile) throw new Error('missing key carrying fixtures');
    ghost.position = { ...safeGhostTile };
    ghost.previousPosition = { ...safeGhostTile };
    engine.restore(keyState);
    engine.tick(0.1);
    const firstState = engine.serialize();
    const [firstKey, secondKey] = firstState.snapshot.keys.filter((key) => key.status === 'ground');
    const firstSurvivor = firstState.snapshot.players.find((player) => player.id === survivor.id);
    if (!firstKey || !secondKey || !firstSurvivor) throw new Error('missing spawned key fixtures');
    firstSurvivor.position = { ...firstKey.tile };
    firstSurvivor.previousPosition = { ...firstKey.tile };
    firstSurvivor.movement = { x: 0, y: 0 };
    engine.restore(firstState);
    expect(engine.interact(survivor.id).ok).toBe(true);
    expect(engine.snapshot().unlockedLocks).toBe(0);
    expect(engine.snapshot().keys.find((key) => key.id === firstKey.id)).toMatchObject({
      status: 'carried',
      carrierId: survivor.id,
      collectedBy: survivor.id,
    });
    expect(engine.snapshot().collectedKeys).toBe(0);

    const secondState = engine.serialize();
    const secondSurvivor = secondState.snapshot.players.find((player) => player.id === survivor.id);
    if (!secondSurvivor) throw new Error('missing second pickup survivor');
    secondSurvivor.position = { ...secondKey.tile };
    secondSurvivor.previousPosition = { ...secondKey.tile };
    secondSurvivor.movement = { x: 0, y: 0 };
    engine.restore(secondState);
    expect(engine.interact(survivor.id)).toEqual({ ok: false, error: '열쇠는 한 개만 들 수 있습니다.' });
    expect(engine.snapshot().keys.find((key) => key.id === secondKey.id)).toMatchObject({
      status: 'ground',
      carrierId: null,
    });
    expect(engine.snapshot().keys.filter((key) => key.carrierId === survivor.id)).toHaveLength(1);
    expect(engine.snapshot().unlockedLocks).toBe(0);
  });

  it('consumes one carried key per three-second delivery and ends with a survivor victory on the fifth lock', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const seeded = engine.serialize();
    seeded.snapshot.phaseRemaining = HIDE_SEEK_RULES.huntSeconds - 201;
    const ghost = seeded.snapshot.players.find((player) => player.role === 'ghost');
    const survivors = seeded.snapshot.players.filter((player) => player.role === 'survivor');
    const carrier = survivors[0];
    const inactiveSurvivor = survivors[1];
    const safeGhostTile = engine.map.walkable.find((tile) => Math.hypot(tile.x - seeded.snapshot.activeExit.x, tile.y - seeded.snapshot.activeExit.y) > 20);
    if (!ghost || !carrier || !inactiveSurvivor || !safeGhostTile) throw new Error('missing delivery fixtures');
    ghost.position = { ...safeGhostTile };
    ghost.previousPosition = { ...safeGhostTile };
    ghost.movement = { x: 0, y: 0 };
    inactiveSurvivor.movement = { x: 0, y: 0 };
    engine.restore(seeded);
    engine.tick(0.1);
    expect(engine.snapshot().keys.filter((key) => key.status === 'ground')).toHaveLength(HIDE_SEEK_RULES.requiredKeys);

    for (let delivery = 1; delivery <= HIDE_SEEK_RULES.requiredKeys; delivery += 1) {
      const pickupState = engine.serialize();
      const key = pickupState.snapshot.keys.find((candidate) => candidate.status === 'ground');
      const pickupCarrier = pickupState.snapshot.players.find((player) => player.id === carrier.id);
      if (!key || !pickupCarrier) throw new Error(`missing key for delivery ${delivery}`);
      pickupCarrier.position = { ...key.tile };
      pickupCarrier.previousPosition = { ...key.tile };
      pickupCarrier.movement = { x: 0, y: 0 };
      engine.restore(pickupState);
      expect(engine.interact(carrier.id).ok).toBe(true);
      expect(engine.snapshot().unlockedLocks).toBe(delivery - 1);

      const exitState = engine.serialize();
      const exitCarrier = exitState.snapshot.players.find((player) => player.id === carrier.id);
      if (!exitCarrier) throw new Error('missing exit carrier');
      exitCarrier.position = { ...exitState.snapshot.activeExit };
      exitCarrier.previousPosition = { ...exitState.snapshot.activeExit };
      exitCarrier.movement = { x: 0, y: 0 };
      exitState.snapshot.exitDiscovered = true;
      engine.restore(exitState);
      expect(engine.interact(carrier.id).ok).toBe(true);
      for (let tick = 0; tick < 10; tick += 1) engine.tick(0.1);
      const progressBeforeRepeat = engine.snapshot().players.find((player) => player.id === carrier.id)?.interactionProgress ?? 0;
      expect(progressBeforeRepeat).toBeGreaterThan(0.9);
      expect(engine.interact(carrier.id).ok).toBe(true);
      expect(engine.snapshot().players.find((player) => player.id === carrier.id)?.interactionProgress).toBeCloseTo(progressBeforeRepeat, 5);
      for (let tick = 0; tick < 22; tick += 1) engine.tick(0.1);

      const delivered = engine.snapshot();
      expect(delivered.keys.find((candidate) => candidate.id === key.id)).toMatchObject({
        status: 'used',
        carrierId: null,
      });
      expect(delivered.unlockedLocks).toBe(delivery);
      expect(delivered.exitOpen).toBe(delivery === HIDE_SEEK_RULES.requiredKeys);
      const deliveredCarrier = delivered.players.find((player) => player.id === carrier.id);
      if (delivery < HIDE_SEEK_RULES.requiredKeys) {
        expect(deliveredCarrier).toMatchObject({ alive: true, escaped: false });
        expect(delivered.phase).toBe('HUNT');
      } else {
        expect(deliveredCarrier).toMatchObject({ alive: true, escaped: false });
        expect(delivered.players.find((player) => player.id === inactiveSurvivor.id)).toMatchObject({ alive: true, escaped: false });
        expect(delivered).toMatchObject({ phase: 'RESULT', winner: 'survivor' });
      }
    }
  });

  it('keeps a carrier bot still at the exit until the fifth lock ends the match', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivors = persisted.snapshot.players.filter((player) => player.role === 'survivor');
    const carrierBot = survivors[0];
    const eliminated = survivors[1];
    const key = persisted.snapshot.keys.find((candidate) => candidate.status === 'ground');
    const safeGhostTile = engine.map.walkable.find((tile) =>
      Math.hypot(tile.x - persisted.snapshot.activeExit.x, tile.y - persisted.snapshot.activeExit.y) > 20,
    );
    if (!ghost || !carrierBot || !eliminated || !key || !safeGhostTile) throw new Error('missing bot delivery fixtures');
    ghost.position = { ...safeGhostTile };
    ghost.previousPosition = { ...safeGhostTile };
    ghost.movement = { x: 0, y: 0 };
    carrierBot.botControlled = true;
    carrierBot.position = { ...persisted.snapshot.activeExit };
    carrierBot.previousPosition = { ...persisted.snapshot.activeExit };
    carrierBot.movement = { x: 1, y: 0 };
    eliminated.alive = false;
    eliminated.movement = { x: 0, y: 0 };
    key.status = 'carried';
    key.carrierId = carrierBot.id;
    persisted.snapshot.unlockedLocks = HIDE_SEEK_RULES.requiredKeys - 1;
    persisted.snapshot.exitDiscovered = true;
    engine.restore(persisted);

    for (let tick = 0; tick < Math.ceil(HIDE_SEEK_RULES.exitUnlockSeconds * 10) + 2; tick += 1) engine.tick(0.1);

    expect(engine.snapshot().keys.find((candidate) => candidate.id === key.id)).toMatchObject({
      status: 'used',
      carrierId: null,
    });
    expect(engine.snapshot()).toMatchObject({
      unlockedLocks: HIDE_SEEK_RULES.requiredKeys,
      exitOpen: true,
      phase: 'RESULT',
      winner: 'survivor',
    });
    expect(engine.snapshot().players.find((player) => player.id === carrierBot.id)).toMatchObject({
      alive: true,
      escaped: false,
      movement: { x: 0, y: 0 },
    });
  });

  it('serializes exit unlocking so two carriers cannot open locks at the same time', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    persisted.snapshot.phaseRemaining = HIDE_SEEK_RULES.huntSeconds - 201;
    engine.restore(persisted);
    engine.tick(0.1);
    const deliveryState = engine.serialize();
    const carriers = deliveryState.snapshot.players.filter((player) => player.role === 'survivor');
    const keys = deliveryState.snapshot.keys.filter((key) => key.status === 'ground');
    const firstCarrier = carriers[0];
    const secondCarrier = carriers[1];
    const firstKey = keys[0];
    const secondKey = keys[1];
    if (!firstCarrier || !secondCarrier || !firstKey || !secondKey) throw new Error('missing serialized unlock fixtures');
    for (const carrier of [firstCarrier, secondCarrier]) {
      carrier.position = { ...deliveryState.snapshot.activeExit };
      carrier.previousPosition = { ...deliveryState.snapshot.activeExit };
      carrier.movement = { x: 0, y: 0 };
    }
    firstKey.status = 'carried';
    firstKey.carrierId = firstCarrier.id;
    secondKey.status = 'carried';
    secondKey.carrierId = secondCarrier.id;
    deliveryState.snapshot.exitDiscovered = true;
    engine.restore(deliveryState);

    expect(engine.interact(firstCarrier.id).ok).toBe(true);
    expect(engine.interact(secondCarrier.id)).toEqual({
      ok: false,
      error: '다른 생존자가 자물쇠를 해제 중입니다.',
    });
    expect(engine.snapshot().players.find((player) => player.id === secondCarrier.id)?.interactionTarget).toBeNull();
    expect(engine.snapshot().unlockedLocks).toBe(0);
  });

  it('drops a carried key at the preserved death position after direct ghost contact', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const pickupState = engine.serialize();
    const key = pickupState.snapshot.keys.find((candidate) => candidate.status === 'ground');
    const ghost = pickupState.snapshot.players.find((player) => player.role === 'ghost');
    const survivors = pickupState.snapshot.players.filter((player) => player.role === 'survivor');
    const victim = survivors[0];
    const witness = survivors[1];
    if (!key || !ghost || !victim || !witness) throw new Error('missing contact death fixtures');
    victim.position = { ...key.tile };
    victim.previousPosition = { ...key.tile };
    victim.movement = { x: 0, y: 0 };
    engine.restore(pickupState);
    expect(engine.interact(victim.id).ok).toBe(true);

    const deathState = engine.serialize();
    const deathGhost = deathState.snapshot.players.find((player) => player.id === ghost.id);
    const deathVictim = deathState.snapshot.players.find((player) => player.id === victim.id);
    const deathWitness = deathState.snapshot.players.find((player) => player.id === witness.id);
    const deathTile = engine.map.walkable.find((tile) => Math.hypot(tile.x - witness.position.x, tile.y - witness.position.y) > 10);
    if (!deathGhost || !deathVictim || !deathWitness || !deathTile) throw new Error('missing direct death positions');
    deathGhost.position = { ...deathTile };
    deathGhost.previousPosition = { ...deathTile };
    deathGhost.movement = { x: 0, y: 0 };
    deathVictim.position = { ...deathTile };
    deathVictim.previousPosition = { ...deathTile };
    deathVictim.movement = { x: 0, y: 0 };
    deathWitness.movement = { x: 0, y: 0 };
    engine.restore(deathState);
    engine.tick(0.01);

    const deadSnapshot = engine.snapshot();
    expect(deadSnapshot.players.find((player) => player.id === victim.id)).toMatchObject({
      alive: false,
      position: deathTile,
    });
    expect(deadSnapshot.keys.find((candidate) => candidate.id === key.id)).toMatchObject({
      status: 'ground',
      carrierId: null,
      tile: deathTile,
    });
    expect(engine.snapshotFor(witness.id).players.find((player) => player.id === victim.id)?.position).toEqual(deathTile);
  });

  it('drops a carried key at the hideout when the ghost search eliminates its carrier', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const pickupState = engine.serialize();
    const key = pickupState.snapshot.keys.find((candidate) => candidate.status === 'ground');
    const ghost = pickupState.snapshot.players.find((player) => player.role === 'ghost');
    const survivors = pickupState.snapshot.players.filter((player) => player.role === 'survivor');
    const victim = survivors[0];
    const witness = survivors[1];
    const hideout = engine.map.hideouts[0];
    if (!key || !ghost || !victim || !witness || !hideout) throw new Error('missing hideout death fixtures');
    victim.position = { ...key.tile };
    victim.previousPosition = { ...key.tile };
    victim.movement = { x: 0, y: 0 };
    engine.restore(pickupState);
    expect(engine.interact(victim.id).ok).toBe(true);

    const hiddenState = engine.serialize();
    const searchGhost = hiddenState.snapshot.players.find((player) => player.id === ghost.id);
    const hiddenVictim = hiddenState.snapshot.players.find((player) => player.id === victim.id);
    const hiddenWitness = hiddenState.snapshot.players.find((player) => player.id === witness.id);
    if (!searchGhost || !hiddenVictim || !hiddenWitness) throw new Error('missing hidden survivor state');
    searchGhost.position = { ...hideout.tile };
    searchGhost.previousPosition = { ...hideout.tile };
    searchGhost.movement = { x: 0, y: 0 };
    hiddenVictim.position = { ...hideout.tile };
    hiddenVictim.previousPosition = { ...hideout.tile };
    hiddenVictim.movement = { x: 0, y: 0 };
    hiddenVictim.hiddenIn = hideout.id;
    hiddenWitness.movement = { x: 0, y: 0 };
    engine.restore(hiddenState);
    expect(engine.interact(searchGhost.id).ok).toBe(true);
    for (let tick = 0; tick <= Math.ceil(HIDE_SEEK_RULES.hideoutSearchSeconds * 10); tick += 1) engine.tick(0.1);

    const searched = engine.snapshot();
    expect(searched.players.find((player) => player.id === victim.id)).toMatchObject({
      alive: false,
      hiddenIn: null,
      position: hideout.tile,
    });
    expect(searched.keys.find((candidate) => candidate.id === key.id)).toMatchObject({
      status: 'ground',
      carrierId: null,
      tile: hideout.tile,
    });
    expect(engine.snapshotFor(witness.id).players.find((player) => player.id === victim.id)?.position).toEqual(hideout.tile);
  });

  it('migrates legacy team-collected keys into at most one carried key per living survivor and zero unlocked locks', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const current = engine.serialize();
    current.snapshot.phaseRemaining = HIDE_SEEK_RULES.huntSeconds - 201;
    engine.restore(current);
    engine.tick(0.1);
    const allKeysState = engine.serialize();
    const survivors = allKeysState.snapshot.players.filter((player) => player.role === 'survivor');
    const livingCarrier = survivors[0];
    const deadLegacyCarrier = survivors[1];
    if (!livingCarrier || !deadLegacyCarrier || allKeysState.snapshot.keys.length !== HIDE_SEEK_RULES.requiredKeys) throw new Error('missing legacy fixtures');
    deadLegacyCarrier.alive = false;
    const { unlockedLocks: _unlockedLocks, keys: currentKeys, ...snapshotWithoutNewKeyState } = allKeysState.snapshot;
    const legacyKeys = currentKeys.map(({ status: _status, carrierId: _carrierId, ...key }, index) => ({
      ...key,
      collectedBy: index < 2 ? livingCarrier.id : index === 2 ? deadLegacyCarrier.id : null,
    }));
    const legacy = {
      ...allKeysState,
      schemaVersion: 1 as const,
      snapshot: {
        ...snapshotWithoutNewKeyState,
        keys: legacyKeys,
        collectedKeys: HIDE_SEEK_RULES.requiredKeys,
      },
    } as unknown as Parameters<HideSeekEngine['restore']>[0];
    engine.restore(legacy);

    const migrated = engine.snapshot();
    expect(migrated.unlockedLocks).toBe(0);
    expect(migrated.exitOpen).toBe(false);
    expect(migrated.keys.filter((key) => key.status === 'carried' && key.carrierId === livingCarrier.id)).toHaveLength(1);
    expect(migrated.keys.filter((key) => key.status === 'carried' && key.carrierId === deadLegacyCarrier.id)).toHaveLength(0);
    expect(migrated.keys.filter((key) => key.status === 'ground')).toHaveLength(HIDE_SEEK_RULES.requiredKeys - 1);
  });

  it('reveals the ghost to a survivor minimap only within two tiles and line of sight', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = persisted.snapshot.players.find((player) => player.role === 'survivor');
    if (!ghost || !survivor) throw new Error('missing proximity fixtures');
    ghost.position = { x: 10, y: 10 };
    ghost.previousPosition = { ...ghost.position };
    survivor.position = { x: 11.8, y: 10 };
    survivor.previousPosition = { ...survivor.position };
    survivor.detected = false;
    engine.restore(persisted);
    expect(engine.snapshotFor(survivor.id).players.find((player) => player.id === ghost.id)?.position.x).toBeGreaterThan(0);
    const far = engine.serialize();
    const farSurvivor = far.snapshot.players.find((player) => player.id === survivor.id);
    if (!farSurvivor) throw new Error('missing far survivor');
    farSurvivor.position = { x: 15, y: 10 };
    farSurvivor.previousPosition = { ...farSurvivor.position };
    engine.restore(far);
    expect(engine.snapshotFor(survivor.id).players.find((player) => player.id === ghost.id)?.position).toEqual({ x: -999, y: -999 });
  });

  it('reveals a survivor behind the ghost inside the circular lantern radius', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = persisted.snapshot.players.find((player) => player.role === 'survivor');
    if (!ghost || !survivor) throw new Error('missing rear-vision fixtures');
    const walkable = new Set(engine.map.walkable.map((tile) => `${tile.x},${tile.y}`));
    const rearPair = engine.map.walkable.find((tile) => walkable.has(`${tile.x - 1},${tile.y}`));
    if (!rearPair) throw new Error('missing rear walkable pair');
    ghost.position = { ...rearPair };
    ghost.previousPosition = { ...ghost.position };
    ghost.direction = { x: 1, y: 0 };
    survivor.position = { x: rearPair.x - 1, y: rearPair.y };
    survivor.previousPosition = { ...survivor.position };
    survivor.detected = false;
    engine.restore(persisted);
    expect(hideSeekLanternSees(engine.map, ghost, survivor)).toBe(true);
    engine.tick(0.01);
    expect(engine.snapshotFor(ghost.id).players.find((player) => player.id === survivor.id)?.position.x).toBeGreaterThan(0);
  });

  it('lights seven tiles for four seconds and enforces the 100-second ghost cooldown', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivor = persisted.snapshot.players.find((player) => player.role === 'survivor');
    if (!ghost || !survivor) throw new Error('missing light fixtures');
    const openMap = { ...engine.map, walls: [] };
    ghost.position = { x: 10, y: 10 };
    survivor.position = { x: 16.5, y: 10 };
    engine.restore(persisted);
    expect(hideSeekLanternSees(openMap, ghost, survivor)).toBe(false);
    expect(engine.ghostLight(ghost.id)).toEqual({ ok: true });
    const litGhost = engine.snapshot().players.find((player) => player.id === ghost.id);
    const litSurvivor = engine.snapshot().players.find((player) => player.id === survivor.id);
    if (!litGhost || !litSurvivor) throw new Error('missing active light fixtures');
    expect(litGhost.lightUntil - engine.snapshot().elapsed).toBeCloseTo(4, 5);
    expect(litGhost.lightReadyAt - engine.snapshot().elapsed).toBeCloseTo(100, 5);
    expect(hideSeekGhostLightSees(openMap, litGhost, litSurvivor, engine.snapshot().elapsed)).toBe(true);
    expect(engine.ghostLight(ghost.id).ok).toBe(false);
    for (let index = 0; index < 41; index += 1) engine.tick(0.1);
    const fadedGhost = engine.snapshot().players.find((player) => player.id === ghost.id);
    const fadedSurvivor = engine.snapshot().players.find((player) => player.id === survivor.id);
    if (!fadedGhost || !fadedSurvivor) throw new Error('missing faded light fixtures');
    expect(hideSeekGhostLightSees(openMap, fadedGhost, fadedSurvivor, engine.snapshot().elapsed)).toBe(false);
  });

  it('hands an in-progress role to a bot instead of removing the player slot', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const before = engine.snapshot().players.length;
    expect(engine.leave(ids[1] as string)).toEqual({ ok: true, roomEmpty: false });
    const replacement = engine.snapshot().players.find((player) => player.id === ids[1]);
    expect(engine.snapshot().players).toHaveLength(before);
    expect(replacement?.connected).toBe(false);
    expect(replacement?.botControlled).toBe(true);
    expect(replacement?.abandoned).toBe(true);
  });

  it('restores the same in-progress player with the latest reconnect token', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const before = engine.snapshot().players.find((player) => player.id === ids[1]);
    if (!before) throw new Error('missing reconnect player');
    engine.disconnect(before.id);
    expect(engine.snapshot().players.find((player) => player.id === before.id)?.botControlled).toBe(true);
    const restored = engine.join({
      nickname: 'RunnerRestored',
      deviceId: before.deviceId,
      reconnectToken: before.reconnectToken,
    });
    expect(restored.reconnected).toBe(true);
    expect(restored.player.id).toBe(before.id);
    expect(restored.player.connected).toBe(true);
    expect(restored.player.botControlled).toBe(false);
  });

  it('uses the selected living survivor as a dead player spectator perspective', () => {
    const { engine, ids } = joinedEngine(3);
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    const ghost = persisted.snapshot.players.find((player) => player.role === 'ghost');
    const survivors = persisted.snapshot.players.filter((player) => player.role === 'survivor');
    const viewer = survivors[0];
    const target = survivors[1];
    if (!ghost || !viewer || !target) throw new Error('missing spectator fixtures');
    const walkable = new Set(engine.map.walkable.map((tile) => `${tile.x},${tile.y}`));
    const ghostTile = engine.map.walkable.find((tile) => walkable.has(`${tile.x + 1},${tile.y}`));
    const farTile = engine.map.walkable.find((tile) => ghostTile && Math.hypot(tile.x - ghostTile.x, tile.y - ghostTile.y) > 12);
    if (!ghostTile || !farTile) throw new Error('missing spectator map fixtures');
    ghost.position = { ...ghostTile };
    ghost.previousPosition = { ...ghostTile };
    ghost.lightUntil = 0;
    target.position = { x: ghostTile.x + 1, y: ghostTile.y };
    target.previousPosition = { ...target.position };
    viewer.position = { ...farTile };
    viewer.previousPosition = { ...farTile };
    viewer.alive = false;
    engine.restore(persisted);
    expect(engine.snapshotFor(viewer.id).players.find((player) => player.id === ghost.id)?.position).toEqual({ x: -999, y: -999 });
    expect(engine.snapshotFor(viewer.id, target.id).players.find((player) => player.id === ghost.id)?.position.x).toBeGreaterThan(0);
  });

  it('ends the match when the ghost or the final active survivor explicitly abandons', () => {
    const ghostMatch = joinedEngine();
    advanceToHunt(ghostMatch.engine, ghostMatch.ids[0] as string);
    const ghost = ghostMatch.engine.snapshot().players.find((player) => player.role === 'ghost');
    if (!ghost) throw new Error('missing abandoning ghost');
    expect(ghostMatch.engine.leave(ghost.id).ok).toBe(true);
    expect(ghostMatch.engine.snapshot()).toMatchObject({
      phase: 'RESULT',
      winner: 'survivor',
      resultReason: 'ghost-abandoned',
    });

    const survivorMatch = joinedEngine();
    advanceToHunt(survivorMatch.engine, survivorMatch.ids[0] as string);
    const persisted = survivorMatch.engine.serialize();
    const survivors = persisted.snapshot.players.filter((player) => player.role === 'survivor');
    const finalSurvivor = survivors[0];
    const eliminatedSurvivor = survivors[1];
    if (!finalSurvivor || !eliminatedSurvivor) throw new Error('missing abandoning survivor fixtures');
    eliminatedSurvivor.alive = false;
    survivorMatch.engine.restore(persisted);
    expect(survivorMatch.engine.leave(finalSurvivor.id).ok).toBe(true);
    expect(survivorMatch.engine.snapshot()).toMatchObject({
      phase: 'RESULT',
      winner: 'ghost',
      resultReason: 'last-survivor-abandoned',
    });
  });

  it('awards the ghost victory when time expires before all five locks are opened', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const persisted = engine.serialize();
    persisted.snapshot.unlockedLocks = HIDE_SEEK_RULES.requiredKeys - 1;
    persisted.snapshot.phaseRemaining = 0.05;
    engine.restore(persisted);
    engine.tick(0.1);
    expect(engine.snapshot()).toMatchObject({
      phase: 'RESULT',
      winner: 'ghost',
      resultReason: 'timeout',
      unlockedLocks: HIDE_SEEK_RULES.requiredKeys - 1,
    });
  });

  it('replaces a lobby bot when a human joins a bot-filled room', () => {
    const engine = new HideSeekEngine('QUICKBOT', 86_204);
    const host = engine.join({ nickname: 'Host', deviceId: 'quick-host-device' }).player;
    for (let index = 0; index < 6; index += 1) expect(engine.addBot(host.id).ok).toBe(true);
    expect(engine.snapshot().players).toHaveLength(7);
    const joined = engine.join({ nickname: 'QuickJoiner', deviceId: 'quick-join-device' }).player;
    expect(engine.snapshot().players).toHaveLength(7);
    expect(engine.snapshot().players.some((player) => player.id === joined.id)).toBe(true);
    expect(engine.snapshot().players.filter((player) => player.isBot)).toHaveLength(5);
  });

  it('validates the dedicated websocket message surface', () => {
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'sprint' }))).toEqual({ type: 'sprint' });
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'ghost-light' }))).toEqual({ type: 'ghost-light' });
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'move', dx: 1, dy: 0, inputSequence: 3 }))).toEqual({ type: 'move', dx: 1, dy: 0, inputSequence: 3 });
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'quick-chat', phrase: '귀신 발견!' }))).toEqual({ type: 'quick-chat', phrase: '귀신 발견!' });
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'quick-chat', phrase: '문 위험!' }))).toBeNull();
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'chat', text: '  3번 쪽 탈출로 발견!  ' }))).toEqual({ type: 'chat', text: '3번 쪽 탈출로 발견!' });
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'chat', text: '   ' }))).toBeNull();
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'spectate', playerId: 'survivor-2' }))).toEqual({ type: 'spectate', playerId: 'survivor-2' });
    expect(parseHideSeekClientMessage(JSON.stringify({ type: 'spectate', playerId: '' }))).toBeNull();
  });

  it('awards only completed non-abandoned winners by role', () => {
    expect(hideSeekVictoryPoints('survivor', 'survivor')).toBe(100);
    expect(hideSeekVictoryPoints('ghost', 'ghost')).toBe(150);
    expect(hideSeekVictoryPoints('survivor', 'ghost')).toBe(0);
    expect(hideSeekVictoryPoints('ghost', 'ghost', true)).toBe(0);
  });

  it('keeps the account rank identity in the lobby roster', () => {
    const engine = new HideSeekEngine('RANKROOM', 19_931);
    const joined = engine.join({
      nickname: 'LegendRunner',
      deviceId: 'ranked-hide-seek-device',
      displayRank: 'legend',
    });
    expect(joined.player.displayRank).toBe('legend');
    expect(engine.snapshot().players[0]?.displayRank).toBe('legend');
  });
});
