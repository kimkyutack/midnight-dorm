import { describe, expect, it } from 'vitest';
import { HIDE_SEEK_RULES, generateHideSeekMap, hideSeekGhostLightSees, hideSeekLanternSees, hideSeekVictoryPoints, parseHideSeekClientMessage } from '../src/shared/hideSeek';
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

  it('requires a held key pickup and completes a one-tap two-second ghost hideout search', () => {
    const { engine, ids } = joinedEngine();
    advanceToHunt(engine, ids[0] as string);
    const keyState = engine.serialize();
    const key = keyState.snapshot.keys[0];
    const survivor = keyState.snapshot.players.find((player) => player.role === 'survivor');
    const ghost = keyState.snapshot.players.find((player) => player.role === 'ghost');
    if (!key || !survivor || !ghost) throw new Error('missing interaction fixtures');
    survivor.position = { ...key.tile };
    ghost.position = { x: 60, y: 40 };
    engine.restore(keyState);
    expect(engine.interact(survivor.id).ok).toBe(true);
    for (let index = 0; index < 5; index += 1) engine.tick(0.1);
    expect(engine.snapshot().collectedKeys).toBe(0);
    for (let index = 0; index < 2; index += 1) engine.tick(0.1);
    expect(engine.snapshot().collectedKeys).toBe(1);

    const searchState = engine.serialize();
    const searchGhost = searchState.snapshot.players.find((player) => player.id === ghost.id);
    const hidden = searchState.snapshot.players.find((player) => player.id === survivor.id);
    const hideout = engine.map.hideouts[0];
    if (!searchGhost || !hidden || !hideout) throw new Error('missing hideout fixtures');
    searchGhost.position = { ...hideout.tile };
    hidden.position = { ...hideout.tile };
    hidden.hiddenIn = hideout.id;
    engine.restore(searchState);
    expect(engine.interact(searchGhost.id).ok).toBe(true);
    for (let index = 0; index < Math.ceil(HIDE_SEEK_RULES.hideoutSearchSeconds * 10) - 1; index += 1) engine.tick(0.1);
    expect(engine.snapshot().players.find((player) => player.id === hidden.id)?.alive).toBe(true);
    for (let index = 0; index < 2; index += 1) engine.tick(0.1);
    expect(engine.snapshot().players.find((player) => player.id === hidden.id)?.alive).toBe(false);
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
