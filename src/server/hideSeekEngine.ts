import { normalizeAppearance } from '../shared/customization';
import {
  HIDE_SEEK_RULES,
  generateHideSeekMap,
  hideSeekGhostLightSees,
  hideSeekHasLineOfSight,
  hideSeekLanternSees,
  hideSeekRegionAt,
  resolveHideSeekMovement,
  type HideSeekKeyState,
  type HideSeekMap,
  type HideSeekPlayer,
  type HideSeekRolePreference,
  type HideSeekSnapshot,
} from '../shared/hideSeek';
import { SeededRandom } from '../shared/rng';
import type { AvatarAppearance, RankId, Tile } from '../shared/types';

export interface HideSeekJoinIdentity {
  accountId?: string;
  nickname: string;
  deviceId: string;
  reconnectToken?: string;
  appearance?: AvatarAppearance;
  displayRank?: RankId;
}

export interface PersistedHideSeekEngine {
  schemaVersion?: 1 | 2;
  snapshot: HideSeekSnapshot;
  seed: number;
  botCounter: number;
  keySpawnIndex: number;
  inactiveSince: number;
  ghostExploredTileKeys?: string[];
  ghostExplorationRevision?: number;
}

interface LegacyHideSeekKeyState extends Omit<HideSeekKeyState, 'status' | 'carrierId'> {
  collectedBy?: string | null;
}

type LegacyHideSeekSnapshot = Omit<HideSeekSnapshot, 'keys' | 'unlockedLocks'> & {
  keys: LegacyHideSeekKeyState[];
  collectedKeys?: number;
  unlockedLocks?: number;
};

export interface HideSeekActionResult {
  ok: boolean;
  error?: string;
}

const pointDistance = (a: Tile, b: Tile): number => Math.hypot(a.x - b.x, a.y - b.y);
const tileKey = (tile: Tile): string => `${Math.round(tile.x)},${Math.round(tile.y)}`;

function segmentDistance(point: Tile, from: Tile, to: Tile): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) return pointDistance(point, from);
  const progress = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return pointDistance(point, { x: from.x + dx * progress, y: from.y + dy * progress });
}

export class HideSeekEngine {
  readonly map: HideSeekMap;
  private readonly walkableTileKeys: Set<string>;
  private readonly ghostRoomInteriorTileKeys: Set<string>;
  private readonly ghostRoomRestrictedTileKeys: Set<string>;
  private state: HideSeekSnapshot;
  private readonly seed: number;
  private botCounter = 0;
  private keySpawnIndex = 0;
  private inactiveSince = Date.now();
  private ghostExploredTileKeys: string[] = [];
  private ghostExplorationRevision = 0;
  private readonly botTargets = new Map<string, Tile>();
  private readonly botPaths = new Map<string, Tile[]>();
  private readonly botPathTargets = new Map<string, string>();

  constructor(code: string, seed: number) {
    this.seed = seed;
    this.map = generateHideSeekMap(seed);
    this.walkableTileKeys = new Set(this.map.walkable.map(tileKey));
    this.ghostRoomInteriorTileKeys = new Set(this.map.ghostRoom.interior.map(tileKey));
    this.ghostRoomRestrictedTileKeys = new Set([...this.map.ghostRoom.interior, this.map.ghostRoom.door].map(tileKey));
    const activeExit = this.map.exitCandidates[new SeededRandom(seed ^ 0x4f1bbcdc).int(0, this.map.exitCandidates.length - 1)] as Tile;
    this.state = {
      code,
      matchId: crypto.randomUUID(),
      hostId: null,
      phase: 'LOBBY',
      phaseRemaining: 0,
      elapsed: 0,
      serverSeq: 0,
      players: [],
      keys: [],
      keyHint: null,
      unlockedLocks: 0,
      activeExit: { ...activeExit },
      exitDiscovered: false,
      exitOpen: false,
      firstEscapeAt: null,
      winner: null,
      resultReason: null,
      exploredTileKeys: [],
      explorationRevision: 0,
    };
  }

  snapshot(): HideSeekSnapshot {
    const snapshot = structuredClone(this.state);
    // Keep already-installed native clients functional during the rolling
    // deployment. New clients use status/carrierId and unlockedLocks.
    snapshot.collectedKeys = snapshot.unlockedLocks;
    for (const key of snapshot.keys) {
      key.collectedBy = key.status === 'ground'
        ? null
        : key.carrierId ?? '__used__';
    }
    return snapshot;
  }

  /** Candidate exits are server-only so clients cannot inspect the active exit pool. */
  mapForClient(): HideSeekMap {
    return { ...this.map, exitCandidates: [] };
  }

  /**
   * Only send information that the requesting role is allowed to know.
   * Movement and collisions remain authoritative on the full private state.
   */
  snapshotFor(viewerId: string, perspectivePlayerId?: string): HideSeekSnapshot {
    const snapshot = this.snapshot();
    const viewer = this.player(viewerId);
    const hiddenPosition = { x: -999, y: -999 };
    if (!viewer || !viewer.role) {
      snapshot.keys = [];
      snapshot.keyHint = null;
      snapshot.activeExit = hiddenPosition;
      snapshot.exitDiscovered = false;
      return snapshot;
    }
    if (viewer.role === 'ghost') {
      snapshot.keys = [];
      snapshot.keyHint = null;
      snapshot.exploredTileKeys = [...this.ghostExploredTileKeys];
      snapshot.explorationRevision = this.ghostExplorationRevision;
      snapshot.activeExit = hiddenPosition;
      snapshot.exitDiscovered = false;
      for (const player of snapshot.players) {
        if (player.role !== 'survivor' || player.detected) continue;
        player.position = hiddenPosition;
        player.previousPosition = hiddenPosition;
        player.hiddenIn = null;
        player.proximityAlert = false;
        player.ghostFootstepLevel = 0;
      }
      return snapshot;
    }
    const explored = new Set(snapshot.exploredTileKeys);
    snapshot.keys = snapshot.keys.filter((key) =>
      key.status === 'carried' || (key.status === 'ground' && explored.has(tileKey(key.tile))),
    );
    const ghost = snapshot.players.find((player) => player.role === 'ghost');
    const requestedPerspective = perspectivePlayerId
      ? this.player(perspectivePlayerId)
      : null;
    const perspective = !viewer.alive
      && requestedPerspective?.role === 'survivor'
      && requestedPerspective.alive
      && !requestedPerspective.escaped
      ? requestedPerspective
      : viewer;
    const exitIsVisible = snapshot.phase !== 'ROLE_LOCK'
      && (snapshot.exitDiscovered || pointDistance(perspective.position, snapshot.activeExit) <= 3);
    if (!exitIsVisible) {
      snapshot.activeExit = hiddenPosition;
      snapshot.exitDiscovered = false;
    }
    const ghostIsNearby = ghost
      && pointDistance(perspective.position, ghost.position) <= HIDE_SEEK_RULES.lanternRange
      && hideSeekHasLineOfSight(this.map, perspective.position, ghost.position);
    const ghostLightIsNearby = ghost
      && snapshot.elapsed < ghost.lightUntil
      && pointDistance(perspective.position, ghost.position) <= HIDE_SEEK_RULES.ghostLightRange;
    if (ghost && !ghostIsNearby && !ghostLightIsNearby) {
      ghost.position = hiddenPosition;
      ghost.previousPosition = hiddenPosition;
    }
    return snapshot;
  }

  serialize(): PersistedHideSeekEngine {
    return {
      schemaVersion: 2,
      snapshot: this.snapshot(),
      seed: this.seed,
      botCounter: this.botCounter,
      keySpawnIndex: this.keySpawnIndex,
      inactiveSince: this.inactiveSince,
      ghostExploredTileKeys: [...this.ghostExploredTileKeys],
      ghostExplorationRevision: this.ghostExplorationRevision,
    };
  }

  restore(data: PersistedHideSeekEngine): void {
    const rawSnapshot = structuredClone(data.snapshot) as HideSeekSnapshot | LegacyHideSeekSnapshot;
    let restored: HideSeekSnapshot;
    if (data.schemaVersion !== 2) {
      const legacy = rawSnapshot as LegacyHideSeekSnapshot;
      const livingCarrierIds = new Set(
        legacy.players.filter((player) => player.alive && !player.escaped).map((player) => player.id),
      );
      const assignedCarrierIds = new Set<string>();
      const keys = legacy.keys.map((key): HideSeekKeyState => {
        const carrierId = key.collectedBy ?? null;
        const legacyCarrier = carrierId
          ? legacy.players.find((player) => player.id === carrierId)
          : undefined;
        const canCarry = carrierId !== null
          && livingCarrierIds.has(carrierId)
          && !assignedCarrierIds.has(carrierId);
        if (canCarry) assignedCarrierIds.add(carrierId);
        const { collectedBy: _collectedBy, ...base } = key;
        const dropAtDeath = legacyCarrier && !legacyCarrier.alive && !legacyCarrier.escaped;
        const keyTile = dropAtDeath ? { ...legacyCarrier.position } : { ...base.tile };
        return {
          ...base,
          tile: keyTile,
          regionId: dropAtDeath ? hideSeekRegionAt(this.map, keyTile).id : base.regionId,
          status: canCarry ? 'carried' : 'ground',
          carrierId: canCarry ? carrierId : null,
        };
      });
      const { collectedKeys: _legacyCollectedKeys, keys: _legacyKeys, ...base } = legacy;
      restored = { ...base, keys, unlockedLocks: 0 } as HideSeekSnapshot;
    } else restored = rawSnapshot as HideSeekSnapshot;
    this.state = restored;
    this.state.unlockedLocks ??= 0;
    this.state.exitOpen = this.state.unlockedLocks >= HIDE_SEEK_RULES.requiredKeys;
    this.state.resultReason ??= null;
    let exitInteractionClaimed = false;
    for (const player of this.state.players) {
      player.displayRank ??= 'beginner';
      player.lightUntil ??= 0;
      player.lightReadyAt ??= 0;
      player.abandoned ??= false;
      player.proximityAlert ??= false;
      player.ghostFootstepLevel ??= 0;
      if (player.interactionTarget?.startsWith('exit:')) {
        if (!player.alive || player.escaped || exitInteractionClaimed) {
          player.interactionTarget = null;
          player.interactionProgress = 0;
        } else exitInteractionClaimed = true;
      }
    }
    if (
      this.state.exitOpen
      && this.state.phase !== 'LOBBY'
      && this.state.phase !== 'RESULT'
      && this.state.phase !== 'CLOSED'
    ) this.completeSurvivorVictory();
    this.botCounter = data.botCounter;
    this.keySpawnIndex = data.keySpawnIndex;
    this.inactiveSince = data.inactiveSince;
    this.ghostExploredTileKeys = [...(data.ghostExploredTileKeys ?? [])];
    this.ghostExplorationRevision = data.ghostExplorationRevision ?? 0;
    this.botTargets.clear();
    this.botPaths.clear();
    this.botPathTargets.clear();
  }

  join(identity: HideSeekJoinIdentity): { player: HideSeekPlayer; reconnectToken: string; reconnected: boolean } {
    const reconnect = identity.reconnectToken
      ? this.state.players.find((player) => !player.abandoned && player.reconnectToken === identity.reconnectToken && player.deviceId === identity.deviceId)
      : undefined;
    if (reconnect) {
      reconnect.connected = true;
      reconnect.botControlled = false;
      reconnect.nickname = identity.nickname.trim().slice(0, 12);
      reconnect.appearance = normalizeAppearance(identity.appearance);
      reconnect.displayRank = identity.displayRank ?? reconnect.displayRank ?? 'beginner';
      this.inactiveSince = Date.now();
      return { player: structuredClone(reconnect), reconnectToken: reconnect.reconnectToken, reconnected: true };
    }
    if (this.state.phase !== 'LOBBY') throw new Error('이미 시작한 술래잡기 방입니다.');
    if (this.state.players.length >= HIDE_SEEK_RULES.maxPlayers) {
      let replaceableBot = -1;
      for (let index = this.state.players.length - 1; index >= 0; index -= 1) {
        if (this.state.players[index]?.isBot) {
          replaceableBot = index;
          break;
        }
      }
      if (replaceableBot < 0) throw new Error('술래잡기 방이 가득 찼습니다.');
      this.state.players.splice(replaceableBot, 1);
    }
    const nickname = identity.nickname.trim().slice(0, 12);
    if (nickname.length < 2) throw new Error('닉네임은 2자 이상이어야 합니다.');
    const player: HideSeekPlayer = {
      id: crypto.randomUUID(),
      accountId: identity.accountId,
      nickname,
      deviceId: identity.deviceId,
      reconnectToken: crypto.randomUUID(),
      connected: true,
      isBot: false,
      botControlled: false,
      abandoned: false,
      ready: false,
      preference: 'any',
      role: null,
      number: null,
      position: { ...this.map.survivorSpawns[this.state.players.length % this.map.survivorSpawns.length] as Tile },
      previousPosition: { ...this.map.survivorSpawns[this.state.players.length % this.map.survivorSpawns.length] as Tile },
      direction: { x: 0, y: 1 },
      movement: { x: 0, y: 0 },
      alive: true,
      escaped: false,
      hiddenIn: null,
      detected: false,
      proximityAlert: false,
      ghostFootstepLevel: 0,
      detectionReleaseAt: 0,
      sprintUntil: 0,
      sprintReadyAt: 0,
      lightUntil: 0,
      lightReadyAt: 0,
      interactionTarget: null,
      interactionProgress: 0,
      displayRank: identity.displayRank ?? 'beginner',
      appearance: normalizeAppearance(identity.appearance),
    };
    this.state.players.push(player);
    this.state.hostId ??= player.id;
    this.inactiveSince = Date.now();
    return { player: structuredClone(player), reconnectToken: player.reconnectToken, reconnected: false };
  }

  disconnect(playerId: string): void {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (player) {
      player.connected = false;
      if (this.state.phase !== 'LOBBY' && this.state.phase !== 'RESULT') player.botControlled = true;
    }
    if (!this.state.players.some((candidate) => !candidate.isBot && candidate.connected)) this.inactiveSince = Date.now();
  }

  shouldCleanup(now = Date.now()): boolean {
    return !this.state.players.some((player) => !player.isBot && player.connected) && now - this.inactiveSince >= 180_000;
  }

  setReady(playerId: string, ready: boolean): HideSeekActionResult {
    if (this.state.phase !== 'LOBBY') return { ok: false, error: '대기실에서만 준비할 수 있습니다.' };
    const player = this.player(playerId);
    if (!player || player.isBot) return { ok: false, error: '참가자를 찾을 수 없습니다.' };
    player.ready = ready;
    return { ok: true };
  }

  setPreference(playerId: string, preference: HideSeekRolePreference): HideSeekActionResult {
    if (this.state.phase !== 'LOBBY') return { ok: false, error: '역할이 이미 확정되었습니다.' };
    const player = this.player(playerId);
    if (!player) return { ok: false, error: '참가자를 찾을 수 없습니다.' };
    player.preference = preference;
    return { ok: true };
  }

  addBot(hostId: string, preference: HideSeekRolePreference = 'any'): HideSeekActionResult {
    if (this.state.hostId !== hostId) return { ok: false, error: '방장만 봇을 추가할 수 있습니다.' };
    if (this.state.phase !== 'LOBBY') return { ok: false, error: '게임 시작 후에는 봇을 추가할 수 없습니다.' };
    if (this.state.players.length >= HIDE_SEEK_RULES.maxPlayers) return { ok: false, error: '최대 7명까지 참가할 수 있습니다.' };
    this.botCounter += 1;
    const spawn = this.map.survivorSpawns[this.state.players.length % this.map.survivorSpawns.length] as Tile;
    this.state.players.push({
      id: `hide-seek-bot-${this.botCounter}`,
      nickname: `야간봇 ${this.botCounter}`,
      deviceId: `bot-${this.botCounter}`,
      reconnectToken: `bot-${this.botCounter}`,
      connected: true,
      isBot: true,
      botControlled: true,
      abandoned: false,
      ready: true,
      preference,
      role: null,
      number: null,
      position: { ...spawn },
      previousPosition: { ...spawn },
      direction: { x: 0, y: 1 },
      movement: { x: 0, y: 0 },
      alive: true,
      escaped: false,
      hiddenIn: null,
      detected: false,
      proximityAlert: false,
      ghostFootstepLevel: 0,
      detectionReleaseAt: 0,
      sprintUntil: 0,
      sprintReadyAt: 0,
      lightUntil: 0,
      lightReadyAt: 0,
      interactionTarget: null,
      interactionProgress: 0,
      displayRank: this.botCounter >= 5 ? 'expert' : this.botCounter >= 3 ? 'intermediate' : 'beginner',
      appearance: normalizeAppearance(undefined),
    });
    return { ok: true };
  }

  removeBot(hostId: string, botId: string): HideSeekActionResult {
    if (this.state.hostId !== hostId) return { ok: false, error: '방장만 봇을 제거할 수 있습니다.' };
    if (this.state.phase !== 'LOBBY') return { ok: false, error: '게임 시작 후에는 봇을 제거할 수 없습니다.' };
    const index = this.state.players.findIndex((player) => player.id === botId && player.isBot);
    if (index < 0) return { ok: false, error: '봇을 찾을 수 없습니다.' };
    this.state.players.splice(index, 1);
    return { ok: true };
  }

  start(hostId: string): HideSeekActionResult {
    if (this.state.hostId !== hostId) return { ok: false, error: '방장만 시작할 수 있습니다.' };
    if (this.state.phase !== 'LOBBY') return { ok: false, error: '이미 시작했습니다.' };
    if (this.state.players.length < 3) return { ok: false, error: '귀신 1명과 생존자 2명 이상이 필요합니다.' };
    const unready = this.state.players.find((player) => !player.isBot && player.id !== hostId && !player.ready);
    if (unready) return { ok: false, error: '모든 참가자가 준비해야 합니다.' };
    const ghost = this.pickGhost();
    if (!ghost) return { ok: false, error: '귀신 희망자를 선택하거나 귀신 봇을 추가해주세요.' };
    const survivors = this.state.players.filter((player) => player.id !== ghost.id).slice(0, HIDE_SEEK_RULES.maxSurvivors);
    if (survivors.length < 2) return { ok: false, error: '생존자 2명 이상이 필요합니다.' };
    this.state.players = [ghost, ...survivors];
    ghost.role = 'ghost';
    ghost.number = 0;
    ghost.position = { ...this.map.ghostSpawn };
    ghost.previousPosition = { ...ghost.position };
    ghost.movement = { x: 0, y: 0 };
    const numbers = new SeededRandom(this.seed ^ this.state.serverSeq ^ 0x8a31).shuffle([1, 2, 3, 4, 5, 6]);
    survivors.forEach((survivor, index) => {
      survivor.role = 'survivor';
      survivor.number = numbers[index] as number;
      survivor.position = { ...this.map.survivorSpawns[index] as Tile };
      survivor.previousPosition = { ...survivor.position };
      survivor.movement = { x: 0, y: 0 };
    });
    this.state.phase = 'ROLE_LOCK';
    this.state.phaseRemaining = HIDE_SEEK_RULES.roleLockSeconds;
    this.state.winner = null;
    this.state.resultReason = null;
    return { ok: true };
  }

  setMovement(playerId: string, dx: number, dy: number): HideSeekActionResult {
    const player = this.player(playerId);
    if (!player || !player.alive || player.escaped) return { ok: false, error: '이동할 수 없습니다.' };
    if (this.state.phase === 'ROLE_LOCK' || this.state.phase === 'LOBBY' || this.state.phase === 'RESULT') return { ok: false, error: '지금은 이동할 수 없습니다.' };
    const length = Math.hypot(dx, dy);
    player.movement = length > 1 ? { x: dx / length, y: dy / length } : { x: dx, y: dy };
    if (Math.hypot(player.movement.x, player.movement.y) > 0.05) {
      player.direction = { ...player.movement };
      player.hiddenIn = null;
      player.interactionTarget = null;
      player.interactionProgress = 0;
    }
    return { ok: true };
  }

  sprint(playerId: string): HideSeekActionResult {
    const player = this.player(playerId);
    if (!player?.alive || player.escaped || (this.state.phase !== 'HUNT' && this.state.phase !== 'LAST_ESCAPE')) return { ok: false, error: '지금은 달릴 수 없습니다.' };
    if (this.state.elapsed < player.sprintReadyAt) return { ok: false, error: '달리기 재사용 대기 중입니다.' };
    if (player.role === 'ghost' && this.huntElapsed() < HIDE_SEEK_RULES.ghostSprintOpeningLockSeconds) return { ok: false, error: '추격 시작 10초 후부터 달릴 수 있습니다.' };
    const ghost = player.role === 'ghost';
    player.sprintUntil = this.state.elapsed + (ghost ? HIDE_SEEK_RULES.ghostSprintSeconds : HIDE_SEEK_RULES.survivorSprintSeconds);
    player.sprintReadyAt = player.sprintUntil + (ghost ? HIDE_SEEK_RULES.ghostSprintCooldownSeconds : HIDE_SEEK_RULES.survivorSprintCooldownSeconds);
    return { ok: true };
  }

  ghostLight(playerId: string): HideSeekActionResult {
    const player = this.player(playerId);
    if (!player?.alive || player.escaped || player.role !== 'ghost' || (this.state.phase !== 'HUNT' && this.state.phase !== 'LAST_ESCAPE')) {
      return { ok: false, error: '지금은 불을 켤 수 없습니다.' };
    }
    if (this.state.elapsed < player.lightReadyAt) return { ok: false, error: '불켜기 재사용 대기 중입니다.' };
    player.lightUntil = this.state.elapsed + HIDE_SEEK_RULES.ghostLightSeconds;
    player.lightReadyAt = this.state.elapsed + HIDE_SEEK_RULES.ghostLightCooldownSeconds;
    return { ok: true };
  }

  interact(playerId: string): HideSeekActionResult {
    const player = this.player(playerId);
    if (!player?.alive || player.escaped) return { ok: false, error: '상호작용할 수 없습니다.' };
    if (this.state.phase === 'LOBBY' || this.state.phase === 'ROLE_LOCK' || this.state.phase === 'RESULT' || this.state.phase === 'CLOSED') {
      return { ok: false, error: '지금은 상호작용할 수 없습니다.' };
    }
    if (player.role === 'ghost') {
      const hideout = this.map.hideouts.find((candidate) => pointDistance(candidate.tile, player.position) <= 0.8);
      if (!hideout) return { ok: false, error: '수색할 은신처가 없습니다.' };
      const target = `hideout:${hideout.id}`;
      if (player.interactionTarget !== target) player.interactionProgress = 0;
      player.interactionTarget = target;
      player.movement = { x: 0, y: 0 };
      return { ok: true };
    }
    if (player.hiddenIn) {
      player.hiddenIn = null;
      return { ok: true };
    }
    const carriedKey = this.carriedKey(player.id);
    const nearExit = pointDistance(player.position, this.state.activeExit) <= 0.9;
    const shouldUseExit = nearExit && Boolean(carriedKey);
    const nearbyGroundKey = this.state.keys.find((candidate) =>
      candidate.status === 'ground' && pointDistance(candidate.tile, player.position) <= 0.85,
    );
    const key = shouldUseExit || carriedKey ? undefined : nearbyGroundKey;
    if (key) {
      key.status = 'carried';
      key.carrierId = player.id;
      player.interactionTarget = null;
      player.interactionProgress = 0;
      return { ok: true };
    }
    const hideout = shouldUseExit
      ? undefined
      : this.map.hideouts.find((candidate) => pointDistance(candidate.tile, player.position) <= 0.8);
    if (hideout && !this.state.players.some((candidate) => candidate.hiddenIn === hideout.id)) {
      player.hiddenIn = hideout.id;
      player.position = { ...hideout.tile };
      player.movement = { x: 0, y: 0 };
      return { ok: true };
    }
    if (!nearExit && carriedKey && nearbyGroundKey) return { ok: false, error: '열쇠는 한 개만 들 수 있습니다.' };
    if (nearExit) {
      this.state.exitDiscovered = true;
      if (!carriedKey) return { ok: false, error: '탈출로의 자물쇠를 풀 열쇠를 들고 있지 않습니다.' };
      if (this.activeExitUnlocker(player.id)) return { ok: false, error: '다른 생존자가 자물쇠를 해제 중입니다.' };
      const target = `exit:${carriedKey.id}`;
      if (player.interactionTarget !== target) player.interactionProgress = 0;
      player.interactionTarget = target;
      player.movement = { x: 0, y: 0 };
      return { ok: true };
    }
    return { ok: false, error: '가까이에서 사용할 수 있는 대상이 없습니다.' };
  }

  stopInteract(playerId: string): void {
    const player = this.player(playerId);
    if (!player) return;
    player.interactionTarget = null;
    player.interactionProgress = 0;
  }

  leave(playerId: string): { ok: boolean; roomEmpty: boolean } {
    if (this.state.phase !== 'LOBBY' && this.state.phase !== 'RESULT' && this.state.phase !== 'CLOSED') {
      const player = this.player(playerId);
      if (!player) return { ok: false, roomEmpty: false };
      const isActiveSurvivor = player.role === 'survivor' && player.alive && !player.escaped;
      const remainingActiveSurvivors = this.state.players.filter((candidate) =>
        candidate.id !== player.id && candidate.role === 'survivor' && candidate.alive && !candidate.escaped,
      );
      if (player.role === 'ghost' || (isActiveSurvivor && remainingActiveSurvivors.length === 0)) {
        player.connected = false;
        player.movement = { x: 0, y: 0 };
        player.botControlled = false;
        player.abandoned = true;
        this.state.phase = 'RESULT';
        this.state.phaseRemaining = 0;
        this.state.winner = player.role === 'ghost' ? 'survivor' : 'ghost';
        this.state.resultReason = player.role === 'ghost' ? 'ghost-abandoned' : 'last-survivor-abandoned';
        return { ok: true, roomEmpty: false };
      }
      player.connected = false;
      player.botControlled = true;
      player.abandoned = true;
      player.movement = { x: 0, y: 0 };
      return { ok: true, roomEmpty: false };
    }
    const index = this.state.players.findIndex((player) => player.id === playerId);
    if (index < 0) return { ok: false, roomEmpty: false };
    this.state.players.splice(index, 1);
    if (this.state.hostId === playerId) this.state.hostId = this.state.players.find((player) => !player.isBot)?.id ?? null;
    const roomEmpty = !this.state.players.some((player) => !player.isBot);
    if (roomEmpty) this.state.phase = 'CLOSED';
    return { ok: true, roomEmpty };
  }

  tick(realDt: number): void {
    const dt = Math.max(0, Math.min(0.1, realDt));
    this.state.serverSeq += 1;
    if (this.state.phase === 'LOBBY' || this.state.phase === 'RESULT' || this.state.phase === 'CLOSED') return;
    this.state.elapsed += dt;
    this.state.phaseRemaining = Math.max(0, this.state.phaseRemaining - dt);
    if (this.state.phase === 'ROLE_LOCK' && this.state.phaseRemaining <= 0) {
      this.state.phase = 'HIDE';
      this.state.phaseRemaining = HIDE_SEEK_RULES.hideSeconds;
    } else if (this.state.phase === 'HIDE' && this.state.phaseRemaining <= 0) {
      this.state.phase = 'HUNT';
      this.state.phaseRemaining = HIDE_SEEK_RULES.huntSeconds;
      this.spawnDueKeys();
    }
    if (this.state.phase === 'ROLE_LOCK') return;
    this.updateBots();
    for (const player of this.state.players) this.movePlayer(player, dt);
    this.revealExploration();
    if (this.state.phase !== 'HUNT' && this.state.phase !== 'LAST_ESCAPE') {
      this.clearProximityAlerts();
      return;
    }
    this.spawnDueKeys();
    this.updateInteractions(dt);
    if (this.state.winner) return;
    this.updateDetection();
    this.resolveGhostContacts();
    this.updateProximityAlerts();
    this.resolveOutcome();
  }

  private pickGhost(): HideSeekPlayer | undefined {
    const rng = new SeededRandom(this.seed ^ this.state.serverSeq ^ this.state.players.length);
    const volunteers = this.state.players.filter((player) => player.preference === 'ghost');
    if (volunteers.length) return rng.pick(volunteers);
    const flexible = this.state.players.filter((player) => player.preference === 'any');
    if (flexible.length) return rng.pick(flexible);
    return this.state.players.find((player) => player.isBot);
  }

  private player(playerId: string): HideSeekPlayer | undefined {
    return this.state.players.find((player) => player.id === playerId);
  }

  private movePlayer(player: HideSeekPlayer, dt: number): void {
    if (!player.alive || player.escaped || player.hiddenIn || this.state.phase === 'ROLE_LOCK') return;
    const magnitude = Math.min(1, Math.hypot(player.movement.x, player.movement.y));
    if (magnitude <= 0.001) return;
    const sprintMultiplier = this.state.elapsed < player.sprintUntil
      ? player.role === 'ghost' ? HIDE_SEEK_RULES.ghostSprintMultiplier : HIDE_SEEK_RULES.survivorSprintMultiplier
      : 1;
    const distance = HIDE_SEEK_RULES.baseSpeed * sprintMultiplier * magnitude * dt;
    player.previousPosition = { ...player.position };
    const dx = (player.movement.x / magnitude) * distance;
    const dy = (player.movement.y / magnitude) * distance;
    const moved = resolveHideSeekMovement(
      player.position,
      { x: dx, y: dy },
      (candidate) => this.canOccupy(player, candidate),
    );
    if (moved.x === player.position.x && moved.y === player.position.y && player.isBot) this.botTargets.delete(player.id);
    player.position = moved;
    if (pointDistance(player.position, this.state.activeExit) <= 2 && player.role === 'survivor') this.state.exitDiscovered = true;
  }

  private isWalkable(position: Tile): boolean {
    return this.walkableTileKeys.has(tileKey(position));
  }

  private canOccupy(player: HideSeekPlayer, position: Tile): boolean {
    if (!this.isWalkable(position)) return false;
    const key = tileKey(position);
    if (player.role === 'survivor' && this.ghostRoomRestrictedTileKeys.has(key)) return false;
    if (player.role === 'ghost' && this.state.phase === 'HIDE') {
      return this.ghostRoomInteriorTileKeys.has(key);
    }
    return true;
  }

  private spawnDueKeys(): void {
    const huntElapsed = this.huntElapsed();
    while (this.keySpawnIndex < HIDE_SEEK_RULES.keySpawnSeconds.length && huntElapsed >= (HIDE_SEEK_RULES.keySpawnSeconds[this.keySpawnIndex] as number)) {
      const previousRegion = this.state.keys.at(-1)?.regionId;
      const ghost = this.state.players.find((player) => player.role === 'ghost');
      const occupied = new Set(this.state.keys.map((key) => tileKey(key.tile)));
      const candidates = this.map.keySpawns.filter((tile) => {
        const region = hideSeekRegionAt(this.map, tile);
        return !occupied.has(tileKey(tile)) && region.id !== previousRegion && (!ghost || pointDistance(tile, ghost.position) >= 6);
      });
      const rng = new SeededRandom(this.seed ^ (this.keySpawnIndex + 1) * 7919);
      const tile = { ...(candidates.length ? rng.pick(candidates) : rng.pick(this.map.keySpawns)) };
      const region = hideSeekRegionAt(this.map, tile);
      const keyId = `key-${this.keySpawnIndex + 1}`;
      this.state.keys.push({ id: keyId, tile, regionId: region.id, spawnedAt: this.state.elapsed, status: 'ground', carrierId: null });
      this.state.keyHint = { keyId, regionId: region.id };
      this.keySpawnIndex += 1;
    }
  }

  private huntElapsed(): number {
    return Math.max(0, HIDE_SEEK_RULES.huntSeconds - (this.state.phase === 'HUNT' ? this.state.phaseRemaining : 0));
  }

  private updateDetection(): void {
    const ghost = this.state.players.find((player) => player.role === 'ghost' && player.alive);
    if (!ghost) return;
    let anyDetected = false;
    for (const survivor of this.state.players.filter((player) => player.role === 'survivor')) {
      const visible = hideSeekLanternSees(this.map, ghost, survivor)
        || hideSeekGhostLightSees(this.map, ghost, survivor, this.state.elapsed);
      const nearby = pointDistance(ghost.position, survivor.position) <= HIDE_SEEK_RULES.detectionHoldRange;
      if (visible) {
        survivor.detected = true;
        survivor.detectionReleaseAt = this.state.elapsed + HIDE_SEEK_RULES.detectionReleaseSeconds;
      } else if (survivor.detected && (!nearby && this.state.elapsed >= survivor.detectionReleaseAt)) survivor.detected = false;
      anyDetected ||= survivor.detected;
    }
    ghost.detected = anyDetected;
  }

  private resolveGhostContacts(): void {
    const ghost = this.state.players.find((player) => player.role === 'ghost' && player.alive);
    if (!ghost) return;
    for (const survivor of this.state.players.filter((player) => player.role === 'survivor' && player.alive && !player.escaped && !player.hiddenIn)) {
      const crossed = segmentDistance(ghost.position, survivor.previousPosition, survivor.position) <= HIDE_SEEK_RULES.collisionRadius * 2
        || segmentDistance(survivor.position, ghost.previousPosition, ghost.position) <= HIDE_SEEK_RULES.collisionRadius * 2;
      if (!crossed) continue;
      this.eliminateSurvivor(survivor);
    }
  }

  private clearProximityAlerts(): void {
    for (const player of this.state.players) {
      player.proximityAlert = false;
      player.ghostFootstepLevel = 0;
    }
  }

  private updateProximityAlerts(): void {
    this.clearProximityAlerts();
    const ghost = this.state.players.find((player) => player.role === 'ghost' && player.alive && !player.escaped);
    if (!ghost) return;
    for (const survivor of this.state.players.filter((player) => player.role === 'survivor' && player.alive && !player.escaped)) {
      const distance = pointDistance(ghost.position, survivor.position);
      if (distance > HIDE_SEEK_RULES.proximityAlertRange) continue;
      survivor.proximityAlert = true;
      survivor.ghostFootstepLevel = Math.max(.12, Math.min(1, 1 - distance / HIDE_SEEK_RULES.proximityAlertRange));
      // A hidden survivor still hears the ghost, but the ghost must not get a proximity oracle for occupied hideouts.
      if (!survivor.hiddenIn) ghost.proximityAlert = true;
    }
  }

  private updateInteractions(dt: number): void {
    for (const player of this.state.players.filter((candidate) => candidate.alive && !candidate.escaped && candidate.interactionTarget)) {
      const target = player.interactionTarget as string;
      if (Math.hypot(player.movement.x, player.movement.y) > 0.05) {
        player.interactionTarget = null;
        player.interactionProgress = 0;
        continue;
      }
      if (target.startsWith('key:')) {
        const key = this.state.keys.find((candidate) => candidate.id === target.slice(4) && candidate.status === 'ground');
        if (!key || pointDistance(player.position, key.tile) > 0.9) {
          player.interactionTarget = null;
          player.interactionProgress = 0;
          continue;
        }
        player.interactionProgress += dt;
        if (player.interactionProgress < HIDE_SEEK_RULES.keyPickupSeconds) continue;
        if (this.carriedKey(player.id)) {
          player.interactionTarget = null;
          player.interactionProgress = 0;
          continue;
        }
        key.status = 'carried';
        key.carrierId = player.id;
        player.interactionTarget = null;
        player.interactionProgress = 0;
        continue;
      }
      if (target.startsWith('hideout:') && player.role === 'ghost') {
        const hideout = this.map.hideouts.find((candidate) => candidate.id === target.slice(8));
        if (!hideout || pointDistance(player.position, hideout.tile) > 0.85) {
          player.interactionTarget = null;
          player.interactionProgress = 0;
          continue;
        }
        player.interactionProgress += dt;
        if (player.interactionProgress < HIDE_SEEK_RULES.hideoutSearchSeconds) continue;
        const survivor = this.state.players.find((candidate) => candidate.hiddenIn === hideout.id && candidate.alive);
        if (survivor) {
          survivor.position = { ...hideout.tile };
          this.eliminateSurvivor(survivor);
        }
        player.interactionTarget = null;
        player.interactionProgress = 0;
        continue;
      }
      if (!target.startsWith('exit:') || player.role !== 'survivor') continue;
      if (pointDistance(player.position, this.state.activeExit) > 0.95) {
        player.interactionTarget = null;
        player.interactionProgress = 0;
        continue;
      }
      const key = this.state.keys.find((candidate) =>
        candidate.id === target.slice(5)
        && candidate.status === 'carried'
        && candidate.carrierId === player.id,
      );
      if (!key || this.state.exitOpen) {
        player.interactionTarget = null;
        player.interactionProgress = 0;
        continue;
      }
      player.interactionProgress += dt;
      if (player.interactionProgress < HIDE_SEEK_RULES.exitUnlockSeconds) continue;
      key.status = 'used';
      key.carrierId = null;
      this.state.unlockedLocks = Math.min(HIDE_SEEK_RULES.requiredKeys, this.state.unlockedLocks + 1);
      player.interactionTarget = null;
      player.interactionProgress = 0;
      if (this.state.unlockedLocks >= HIDE_SEEK_RULES.requiredKeys) {
        this.completeSurvivorVictory();
      }
    }
  }

  private completeSurvivorVictory(): void {
    this.state.exitOpen = true;
    this.state.phase = 'RESULT';
    this.state.phaseRemaining = 0;
    this.state.winner = 'survivor';
    this.state.resultReason = null;
    for (const player of this.state.players) {
      player.movement = { x: 0, y: 0 };
      player.interactionTarget = null;
      player.interactionProgress = 0;
    }
  }

  private carriedKey(playerId: string): HideSeekKeyState | undefined {
    return this.state.keys.find((key) => key.status === 'carried' && key.carrierId === playerId);
  }

  private activeExitUnlocker(excludePlayerId?: string): HideSeekPlayer | undefined {
    return this.state.players.find((player) =>
      player.id !== excludePlayerId
      && player.alive
      && !player.escaped
      && player.interactionTarget?.startsWith('exit:'),
    );
  }

  private eliminateSurvivor(player: HideSeekPlayer): void {
    if (!player.alive || player.role !== 'survivor') return;
    const key = this.carriedKey(player.id);
    if (key) {
      key.status = 'ground';
      key.carrierId = null;
      key.tile = { ...player.position };
      key.regionId = hideSeekRegionAt(this.map, key.tile).id;
    }
    player.alive = false;
    player.hiddenIn = null;
    player.detected = false;
    player.proximityAlert = false;
    player.ghostFootstepLevel = 0;
    player.movement = { x: 0, y: 0 };
    player.interactionTarget = null;
    player.interactionProgress = 0;
  }

  private revealExploration(): void {
    const explored = new Set(this.state.exploredTileKeys);
    for (const survivor of this.state.players.filter((player) => player.role === 'survivor' && player.alive && !player.escaped)) {
      for (const tile of this.map.walkable) if (pointDistance(tile, survivor.position) <= 2.2) explored.add(tileKey(tile));
    }
    if (explored.size !== this.state.exploredTileKeys.length) {
      this.state.exploredTileKeys = [...explored];
      this.state.explorationRevision += 1;
    }
    const ghost = this.state.players.find((player) => player.role === 'ghost' && player.alive);
    if (!ghost) return;
    const ghostExplored = new Set(this.ghostExploredTileKeys);
    for (const tile of this.map.walkable) if (pointDistance(tile, ghost.position) <= 2.2) ghostExplored.add(tileKey(tile));
    if (ghostExplored.size !== this.ghostExploredTileKeys.length) {
      this.ghostExploredTileKeys = [...ghostExplored];
      this.ghostExplorationRevision += 1;
    }
  }

  private resolveOutcome(): void {
    const survivors = this.state.players.filter((player) => player.role === 'survivor');
    const active = survivors.filter((player) => player.alive && !player.escaped);
    if (active.length === 0) {
      this.state.phase = 'RESULT';
      this.state.phaseRemaining = 0;
      this.state.winner = survivors.some((player) => player.escaped) ? 'survivor' : 'ghost';
      this.state.resultReason = null;
      return;
    }
    if (this.state.phaseRemaining <= 0) {
      this.state.phase = 'RESULT';
      this.state.winner = this.state.unlockedLocks >= HIDE_SEEK_RULES.requiredKeys ? 'survivor' : 'ghost';
      this.state.resultReason = this.state.winner === 'ghost' ? 'timeout' : null;
    }
  }

  private updateBots(): void {
    const explored = new Set(this.state.exploredTileKeys);
    for (const bot of this.state.players.filter((player) => (player.isBot || player.botControlled) && player.alive && !player.escaped)) {
      if (bot.role === 'ghost' && this.state.phase === 'HIDE') {
        bot.movement = { x: 0, y: 0 };
        continue;
      }
      const ghost = this.state.players.find((player) => player.role === 'ghost' && player.alive);
      if (bot.role === 'survivor' && bot.hiddenIn) {
        if (!ghost || pointDistance(bot.position, ghost.position) > 5.5) bot.hiddenIn = null;
        else {
          bot.movement = { x: 0, y: 0 };
          continue;
        }
      }
      let target = this.botTargets.get(bot.id);
      if (bot.role === 'ghost') {
        const detected = this.state.players.filter((player) => player.role === 'survivor' && player.alive && player.detected)
          .sort((a, b) => pointDistance(bot.position, a.position) - pointDistance(bot.position, b.position))[0];
        if (!detected && this.huntElapsed() >= 5 && this.state.elapsed >= bot.lightReadyAt) this.ghostLight(bot.id);
        if (detected) {
          target = { ...detected.position };
          this.botTargets.set(bot.id, target);
          if (pointDistance(bot.position, detected.position) >= 2 && pointDistance(bot.position, detected.position) <= 4 && this.state.elapsed >= bot.sprintReadyAt) this.sprint(bot.id);
        }
      } else {
        const carriedKey = this.carriedKey(bot.id);
        if (bot.interactionTarget?.startsWith('exit:')) {
          bot.movement = { x: 0, y: 0 };
          continue;
        }
        const threatened = ghost && (bot.detected || (pointDistance(bot.position, ghost.position) <= 2.8 && hideSeekHasLineOfSight(this.map, bot.position, ghost.position)));
        if (carriedKey && this.state.exitDiscovered) {
          target = { ...this.state.activeExit };
          this.botTargets.set(bot.id, target);
        } else if (threatened && ghost) {
          if (!target || pointDistance(bot.position, target) < 1 || pointDistance(target, ghost.position) < 6) {
            target = this.fleeTarget(bot.position, ghost.position);
            this.botTargets.set(bot.id, target);
          }
          if (this.state.elapsed >= bot.sprintReadyAt) this.sprint(bot.id);
          const nearbyHideout = this.map.hideouts.find((hideout) => pointDistance(hideout.tile, bot.position) <= 0.8 && !this.state.players.some((player) => player.hiddenIn === hideout.id));
          if (nearbyHideout && pointDistance(ghost.position, bot.position) > 2.2) {
            this.interact(bot.id);
            continue;
          }
        } else {
          const visibleKey = carriedKey
            ? undefined
            : this.state.keys.find((key) => key.status === 'ground' && explored.has(tileKey(key.tile)));
          if (visibleKey) {
            target = { ...visibleKey.tile };
            this.botTargets.set(bot.id, target);
          } else if (!target || pointDistance(bot.position, target) < 0.7) {
            const unexplored = this.map.walkable.filter((tile) => !explored.has(tileKey(tile)));
            const rng = new SeededRandom(this.seed ^ this.state.serverSeq ^ bot.id.length * 3571);
            target = rng.pick(unexplored.length ? unexplored : this.map.walkable);
            this.botTargets.set(bot.id, { ...target });
          }
        }
      }
      if (bot.role === 'survivor') {
        const carriedKey = this.carriedKey(bot.id);
        const nearbyKey = carriedKey
          ? undefined
          : this.state.keys.find((candidate) => candidate.status === 'ground' && pointDistance(candidate.tile, bot.position) <= 0.8);
        if (nearbyKey) {
          this.interact(bot.id);
          bot.movement = { x: 0, y: 0 };
          this.botTargets.delete(bot.id);
          this.botPaths.delete(bot.id);
          this.botPathTargets.delete(bot.id);
          continue;
        }
        if (pointDistance(bot.position, this.state.activeExit) <= 0.8 && carriedKey) {
          if (this.activeExitUnlocker(bot.id)) {
            bot.movement = { x: 0, y: 0 };
            continue;
          }
          const result = this.interact(bot.id);
          if (result.ok) {
            bot.movement = { x: 0, y: 0 };
            continue;
          }
        }
      }
      if (!target || pointDistance(bot.position, target) < 0.7) {
        const rng = new SeededRandom(this.seed ^ this.state.serverSeq ^ bot.id.length * 3571);
        target = rng.pick(this.map.walkable);
        this.botTargets.set(bot.id, { ...target });
      }
      const waypoint = this.botWaypoint(bot.id, bot.position, target);
      const dx = waypoint.x - bot.position.x;
      const dy = waypoint.y - bot.position.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      bot.movement = { x: dx / length, y: dy / length };
      bot.direction = { ...bot.movement };
    }
  }

  private fleeTarget(position: Tile, danger: Tile): Tile {
    const candidates = this.map.walkable.filter((tile) => {
      const travel = pointDistance(position, tile);
      return travel >= 5 && travel <= 10;
    });
    return { ...(candidates.sort((a, b) => pointDistance(b, danger) - pointDistance(a, danger))[0] ?? position) };
  }

  private botWaypoint(botId: string, position: Tile, target: Tile): Tile {
    const targetKey = tileKey(target);
    let path = this.botPaths.get(botId);
    if (!path || !path.length || this.botPathTargets.get(botId) !== targetKey) {
      path = this.findPath(position, target);
      this.botPaths.set(botId, path);
      this.botPathTargets.set(botId, targetKey);
    }
    while (path.length > 1 && pointDistance(position, path[0] as Tile) < 0.3) path.shift();
    return path[0] ?? target;
  }

  private findPath(from: Tile, to: Tile): Tile[] {
    const start = { x: Math.round(from.x), y: Math.round(from.y) };
    const goal = { x: Math.round(to.x), y: Math.round(to.y) };
    const startKey = tileKey(start);
    const goalKey = tileKey(goal);
    if (startKey === goalKey) return [goal];
    const queue: Tile[] = [start];
    const parent = new Map<string, string | null>([[startKey, null]]);
    for (let index = 0; index < queue.length && index < this.map.walkable.length; index += 1) {
      const current = queue[index] as Tile;
      const currentKey = tileKey(current);
      if (currentKey === goalKey) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = { x: current.x + dx, y: current.y + dy };
        const nextKey = tileKey(next);
        if (!this.walkableTileKeys.has(nextKey) || parent.has(nextKey)) continue;
        parent.set(nextKey, currentKey);
        queue.push(next);
      }
    }
    if (!parent.has(goalKey)) return [goal];
    const reversed: Tile[] = [];
    let cursor: string | null = goalKey;
    while (cursor && cursor !== startKey) {
      const [x, y] = cursor.split(',').map(Number);
      reversed.push({ x: x as number, y: y as number });
      cursor = parent.get(cursor) ?? null;
    }
    return reversed.reverse();
  }
}
