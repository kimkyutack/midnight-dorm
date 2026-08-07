import * as THREE from 'three';
import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost, upgradeRequirement } from '../../shared/balance';
import { badgeArtworkViewport, isEliteRank, rankBadgeArtworkLayout, rankBadgeImage, rankBenefits, rankedBadgeArtworkLayout, rankedBadgeImage, RANKED_TIER_LABEL, rankLabel, rankLabelGradient } from '../../shared/progression';
import { isPositionOnRoomFloor, moveInWalkableArea } from '../../shared/map';
import { combinedItemEffects, getRandomItem, isGoldProducingBuilding } from '../../shared/randomItems';
import { characterTraitForMatch, upgradeCostForTrait } from '../../shared/characterTraits';
import {
  BEACH_SAND_TILE_SKIN_ID,
  cosmeticById,
  CYBERPUNK_LASER_TURRET_SKIN_ID,
  CYBERPUNK_NEON_TILE_SKIN_ID,
  LIFEGUARD_PARASOL_TURRET_SKIN_ID,
  MOONLIT_PHANTOM_TILE_SKIN_ID,
  MOONLIT_FOXFIRE_TURRET_SKIN_ID,
  SPECIAL_OPS_HEADQUARTERS_TILE_SKIN_ID,
  SPECIAL_OPS_TRACKER_TURRET_SKIN_ID,
  SURFER_WATER_TURRET_SKIN_ID,
  tileSkinTextureUrl,
} from '../../shared/customization';
import { ABYSSAL_KNIGHT_GORILLA_TILE_ID, prestigeAccessoryById, STARLIT_CLOUD_RABBIT_TILE_ID } from '../../shared/prestige';
import { presentationById, type NameplatePalette } from '../../shared/presentation';
import { doorVisualForLevel } from '../../shared/doorVisuals';
import { stageThemeFor, type StageTheme } from '../../shared/stageThemes';
import { tutorialGuidedBuildTile } from '../../shared/tutorial';
import type { AvatarAppearance, BuildingKind, BuildingState, GameEvent, GameSnapshot, GhostState, MapDefinition, PlayerState, RankId, RankedTier, RoomState, Tile, TurretKind, Vec2 } from '../../shared/types';
import { AtlasSpriteActor, ghostAttackDuration, ghostSpriteDefinition, survivorSpriteDefinition } from './AtlasSpriteActor';
import { facingDeltaForMotion } from './avatarMath';
import { buildingAssetUrl } from './BuildingAssets';

const CAMERA_HEIGHT = 18;
const BASE_PORTRAIT_VIEW_WIDTH = 8.4;
const BASE_LANDSCAPE_VIEW_HEIGHT = 8.4;
const MIN_CAMERA_DISTANCE_SCALE = 2 / 3;
const MAX_CAMERA_DISTANCE_SCALE = 1.6;
const DEFAULT_CAMERA_DISTANCE_SCALE = 1 / Math.SQRT2;
const FLOOR_Y = 0;
const PLAYER_HEIGHT = 1.27;
const FRAME_DT_MAX = 1 / 15;
const TAP_GLOBAL_DEBOUNCE_MS = 300;
const TAP_SAME_TILE_DEBOUNCE_MS = 520;
const BUILDING_DRAG_HOLD_MS = 380;
const BUILDING_DRAG_CANCEL_DISTANCE = 10;
const LOCAL_SOFT_RECONCILE_DISTANCE = 0.9;
const LOCAL_HARD_RECONCILE_DISTANCE = 1.5;
// Match the server's bounded release correction so a missed drag packet can
// never place the rendered survivor beyond the authoritative interaction area.
const LOCAL_MAX_PREDICTION_LEAD = 1.35;
const LOCAL_INPUT_RELEASE_ACK_TIMEOUT_MS = 1_500;
const MAX_RECONCILE_STEP = 0.18;
const FLOOR_TILE_HEIGHT = 0.08;
const ROOM_FLOOR_OFFSET_Y = 0.003;
const ROOM_FLOOR_CENTER_Y = ROOM_FLOOR_OFFSET_Y + FLOOR_TILE_HEIGHT / 2;
const MAX_TRANSIENT_EFFECTS = 72;
const MAX_RAPID_EFFECTS_PER_POOL = 32;
const TURRET_VISUAL_INTERVAL_MS = 55;
const INTERACTION_SCAN_INTERVAL_MS = 100;
const QUALITY_SAMPLE_INTERVAL_MS = 2_000;
const MAX_IDLE_BUILDING_TEXTURES = 12;
const MAX_HUD_MESSAGES = 24;
const RESOURCE_HUD_COMPACT_SCALE = 0.85;
const BLACKOUT_REVEAL_RADIUS_TILES = 2;
const CYBER_LASER_FORWARD = new THREE.Vector3(0, 0, 1);
type EffectQuality = 'high' | 'balanced' | 'low';
const ACTIVE_BUILDING_MOTION_KINDS = new Set<BuildingKind>([
  'generator',
  'repair-drone',
  'electric-coil',
  'shield-device',
  'overload-capacitor',
  'soul-vial',
]);
const buildingTextureLoader = new THREE.TextureLoader();
interface BuildingTextureCacheEntry {
  texture: THREE.Texture;
  references: number;
  lastUsedAt: number;
}
const buildingTextureCache = new Map<string, BuildingTextureCacheEntry>();

export function snapCameraCoordinate(
  value: number,
  worldUnitsPerPhysicalPixel: number,
): number {
  if (!Number.isFinite(worldUnitsPerPhysicalPixel) || worldUnitsPerPhysicalPixel <= 0)
    return value;
  return Math.round(value / worldUnitsPerPhysicalPixel) * worldUnitsPerPhysicalPixel;
}

export function snapHudCoordinate(value: number, physicalPixelRatio: number): number {
  if (!Number.isFinite(physicalPixelRatio) || physicalPixelRatio <= 0)
    return value;
  return Math.round(value * physicalPixelRatio) / physicalPixelRatio;
}

export function limitLocalPredictionLead(
  current: Vec2,
  predicted: Vec2,
  authoritative: Vec2,
  input: Vec2,
  maximumLead = LOCAL_MAX_PREDICTION_LEAD,
  localInputSequence?: number,
  authoritativeInputSequence?: number,
  acknowledgedInput?: Vec2,
): Vec2 {
  const offsetX = authoritative.x - predicted.x;
  const offsetY = authoritative.y - predicted.y;
  const predictedError = Math.hypot(offsetX, offsetY);
  if (predictedError <= maximumLead) return predicted;

  const inputLength = Math.hypot(input.x, input.y);
  const acknowledgedInputLength = Math.hypot(
    acknowledgedInput?.x ?? 0,
    acknowledgedInput?.y ?? 0,
  );
  const acknowledgedInputAlignment =
    inputLength > 0.001 && acknowledgedInputLength > 0.001
      ? (
          input.x * (acknowledgedInput?.x ?? 0) +
          input.y * (acknowledgedInput?.y ?? 0)
        ) / (inputLength * acknowledgedInputLength)
      : -1;
  const acknowledgedCurrentInput = inputLength > 0.001 && (
    (
      Number.isSafeInteger(localInputSequence) &&
      (authoritativeInputSequence ?? -1) >= (localInputSequence ?? 0)
    ) || acknowledgedInputAlignment >= 0.94
  );
  if (acknowledgedCurrentInput) {
    const normalizedInputX = input.x / inputLength;
    const normalizedInputY = input.y / inputLength;
    const predictionLeadX = predicted.x - authoritative.x;
    const predictionLeadY = predicted.y - authoritative.y;
    const forwardLead =
      predictionLeadX * normalizedInputX +
      predictionLeadY * normalizedInputY;
    const lateralLead = Math.abs(
      predictionLeadX * -normalizedInputY +
      predictionLeadY * normalizedInputX,
    );
    // Pointer drags and keepalives issue newer sequence numbers continuously.
    // A snapshot that acknowledged an earlier, still-aligned input proves that
    // the server is already moving in this direction; requiring the very
    // latest sequence made prediction stop every time network latency grew.
    // Both sides use moveInWalkableArea, so keep predicting forward while
    // retaining the leash for lateral divergence.
    if (forwardLead >= -0.025 && lateralLead <= maximumLead) return predicted;
  }

  const currentError = Math.hypot(
    authoritative.x - current.x,
    authoritative.y - current.y,
  );
  // Never pull the rendered survivor backwards against a held drag after the
  // authoritative frame has acknowledged that input.
  if (currentError >= maximumLead) return current;

  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const middle = (low + high) / 2;
    const x = current.x + (predicted.x - current.x) * middle;
    const y = current.y + (predicted.y - current.y) * middle;
    if (Math.hypot(authoritative.x - x, authoritative.y - y) <= maximumLead)
      low = middle;
    else high = middle;
  }
  return {
    x: current.x + (predicted.x - current.x) * low,
    y: current.y + (predicted.y - current.y) * low,
  };
}

export function shouldHoldReleasedPrediction(
  releaseInputSequence: number | null,
  authoritativeInputSequence: number | undefined,
  now: number,
  timeoutAt: number,
  rendered: Vec2,
  authoritative: Vec2,
  lastInput: Vec2,
): boolean {
  if (releaseInputSequence === null || now >= timeoutAt) return false;
  if ((authoritativeInputSequence ?? 0) < releaseInputSequence) return true;
  const offsetX = authoritative.x - rendered.x;
  const offsetY = authoritative.y - rendered.y;
  if (Math.hypot(offsetX, offsetY) <= 0.04) return false;
  // The release packet can be acknowledged by a snapshot whose position was
  // sampled just before the packet's forward correction was applied. Pulling
  // to that acknowledged-but-still-trailing point produces the visible
  // one/two-step rewind after lifting a finger. Keep the rendered survivor at
  // the release point until the following authoritative frame catches up.
  return offsetX * lastInput.x + offsetY * lastInput.y < -0.025;
}

export function cameraZoomLockedForSnapshot(
  snapshot: GameSnapshot | null | undefined,
  playerId: string,
): boolean {
  const local = snapshot?.players.find((player) => player.id === playerId);
  return Boolean(snapshot?.tutorial?.active || (local?.alive && !local.roomId));
}

export function doorHudMetricsForCameraScale(
  cameraDistanceScale: number,
  shielded: boolean,
): { width: number; height: number; compact: boolean } {
  const safeDistance = Number.isFinite(cameraDistanceScale)
    ? Math.max(MIN_CAMERA_DISTANCE_SCALE, cameraDistanceScale)
    : DEFAULT_CAMERA_DISTANCE_SCALE;
  const relativeScale = Math.max(
    0.64,
    Math.min(1, DEFAULT_CAMERA_DISTANCE_SCALE / safeDistance),
  );
  const width = Math.round(92 * relativeScale);
  const compact = width < 74;
  return {
    width,
    height: shielded
      ? Math.max(compact ? 24 : 28, Math.round(34 * relativeScale))
      : Math.max(compact ? 18 : 22, Math.round(26 * relativeScale)),
    compact,
  };
}

export function resourceHudPresentationForCameraScale(
  cameraDistanceScale: number,
): { duration: number; rise: number; opacity: number; backgroundAlpha: number } {
  const zoomedOut = Number.isFinite(cameraDistanceScale)
    && cameraDistanceScale > RESOURCE_HUD_COMPACT_SCALE;
  return zoomedOut
    ? { duration: 800, rise: 0.28, opacity: 0.78, backgroundAlpha: 0.46 }
    : { duration: 1_250, rise: 0.75, opacity: 1, backgroundAlpha: 0.72 };
}

export interface TurretFireVisualProfile {
  tier: 0 | 1 | 2 | 3;
  projectileColor: number;
  impactColor: number;
  projectileScale: number;
  durationMultiplier: number;
  impactGrowth: number;
}

const turretFireVisualProfileCache = new Map<string, TurretFireVisualProfile>();

export function turretFireVisualProfile(
  skinId: string | undefined,
  kind: BuildingKind | undefined,
  level: number,
): TurretFireVisualProfile {
  const cosmetic = skinId ? cosmeticById(skinId) : undefined;
  const safeLevel = Math.max(1, Math.min(cosmetic?.prestige ? 17 : 15, Math.floor(level || 1)));
  const tier: 0 | 1 | 2 | 3 = safeLevel >= 15
    ? 3
    : safeLevel >= 10
      ? 2
      : safeLevel >= 5
        ? 1
        : 0;
  const cacheKey = `${skinId ?? ''}:${kind ?? ''}:${tier}`;
  const cached = turretFireVisualProfileCache.get(cacheKey);
  if (cached) return cached;
  const fallbackColor = kind === 'rapid-turret'
    ? 0x75e8ff
    : kind === 'frost-turret'
      ? 0x91efff
      : kind === 'arc-turret' || kind === 'electric-coil'
        ? 0xcf79ff
        : 0xffd36f;
  const specialColors: Record<string, [number, number]> = {
    [SURFER_WATER_TURRET_SKIN_ID]: [0x62ddff, 0xd8fbff],
    [LIFEGUARD_PARASOL_TURRET_SKIN_ID]: [0xff655c, 0xffd36f],
    [CYBERPUNK_LASER_TURRET_SKIN_ID]: [0xff4fd8, 0x9ff8ff],
    [SPECIAL_OPS_TRACKER_TURRET_SKIN_ID]: [0xf4fbff, 0x55bfff],
    [MOONLIT_FOXFIRE_TURRET_SKIN_ID]: [0x4deaff, 0x8b63ff],
    ['turret-basic-starlit-cloud']: [0x9df7ff, 0xffffff],
    ['turret-basic-abyssal-knight']: [0xff5366, 0xffa44c],
  };
  const swatchColor = cosmetic?.slot === 'turret' && /^#[0-9a-f]{6}$/i.test(cosmetic.swatch)
    ? Number.parseInt(cosmetic.swatch.slice(1), 16)
    : fallbackColor;
  const [baseColor, baseImpactColor] = skinId && specialColors[skinId]
    ? specialColors[skinId]
    : [swatchColor, swatchColor];
  const brighten = [0, 0.08, 0.16, 0.25][tier] ?? 0;
  const brightenColor = (color: number): number => {
    const source = new THREE.Color(color);
    source.lerp(new THREE.Color(0xffffff), brighten);
    return source.getHex();
  };
  const profile: TurretFireVisualProfile = {
    tier,
    projectileColor: brightenColor(baseColor),
    impactColor: brightenColor(baseImpactColor),
    projectileScale: [1, 1.12, 1.25, 1.4][tier] ?? 1,
    durationMultiplier: [1, 0.96, 0.91, 0.86][tier] ?? 1,
    impactGrowth: [0.42, 0.58, 0.78, 1.02][tier] ?? 0.42,
  };
  turretFireVisualProfileCache.set(cacheKey, profile);
  return profile;
}

export function goldSealIndicatorVisibleForBuilding(
  snapshot: GameSnapshot,
  building: BuildingState,
): boolean {
  const room = snapshot.rooms.find((candidate) => candidate.id === building.roomId);
  return Boolean(
    room &&
      room.goldSuppressedUntil > snapshot.elapsed &&
      isGoldProducingBuilding(building),
  );
}

export function goldSealIndicatorVisibleForBed(
  snapshot: GameSnapshot,
  roomId: string,
  bedIndex: number,
): boolean {
  const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
  return Boolean(
    room &&
      room.goldSuppressedUntil > snapshot.elapsed &&
      snapshot.players.some(
        (player) =>
          player.alive &&
          player.roomId === roomId &&
          player.bedIndex === bedIndex,
      ),
  );
}

const GHOST_GLOW_COLORS: Record<GhostState['variant'], number> = {
  wanderer: 0xff315f,
  swift: 0xff7438,
  brute: 0xff4a2f,
  caster: 0xb965ff,
  'twin-a': 0x53ddff,
  'twin-b': 0xff4f78,
  teleporter: 0x42dfff,
  undead: 0x8dff64,
  giant: 0x58e9ff,
  demolisher: 0xff3f4f,
  wallpaper: 0xb856ff,
  minion: 0x8dff64,
};

function trimBuildingTextureCache(): void {
  const idle = [...buildingTextureCache.entries()]
    .filter(([, entry]) => entry.references === 0)
    .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
  while (idle.length > MAX_IDLE_BUILDING_TEXTURES) {
    const oldest = idle.shift();
    if (!oldest) break;
    const [url, entry] = oldest;
    if (entry.references !== 0 || buildingTextureCache.get(url) !== entry)
      continue;
    entry.texture.dispose();
    buildingTextureCache.delete(url);
  }
}

function acquireBuildingTexture(url: string): THREE.Texture {
  const cached = buildingTextureCache.get(url);
  if (cached) {
    cached.references += 1;
    cached.lastUsedAt = performance.now();
    return cached.texture;
  }
  const texture = buildingTextureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The generated PNGs have soft transparent edges. Premultiplying before
  // filtering prevents transparent black RGB values from forming a halo.
  texture.premultiplyAlpha = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  buildingTextureCache.set(url, {
    texture,
    references: 1,
    lastUsedAt: performance.now(),
  });
  return texture;
}

function releaseBuildingTexture(url: string): void {
  const cached = buildingTextureCache.get(url);
  if (!cached) return;
  cached.references = Math.max(0, cached.references - 1);
  cached.lastUsedAt = performance.now();
  trimBuildingTextureCache();
}

export interface SceneSelection {
  type: 'bed' | 'door' | 'building';
  targetId: string;
  roomId: string;
  buildingId?: string;
}

interface ViewPayload {
  map: MapDefinition;
  playerId: string;
  snapshot: GameSnapshot;
  onSleep?: () => void;
  onPickupLoot?: (lootId: string) => void;
}

interface BillboardData {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  key: string;
}

export interface PlayerRig {
  root: THREE.Group;
  avatar: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
}

interface PlayerView {
  root: THREE.Group;
  actor: AtlasSpriteActor;
  characterId: string;
  appearanceKey: string;
  label: THREE.Sprite;
  badge: THREE.Sprite;
  badgeKey: string;
  target: THREE.Vector3;
  lastPosition: THREE.Vector3;
  seed: number;
  prestigeTheme: PrestigeMotionTheme | null;
  prestigeTrailTexture: PrestigeTrailTexture | null;
  lastPrestigeTrailTile: Vec2;
  prestigeTrail: Array<{ effect: THREE.Group; tileKey: string }>;
}

interface GhostView {
  root: THREE.Group;
  actor: AtlasSpriteActor;
  variant: GhostState['variant'];
  label: THREE.Sprite;
  hp: THREE.Sprite;
  target: THREE.Vector3;
  seed: number;
  attackStartedAt: number;
  hitFlashUntil: number;
  hitSquashUntil: number;
  telegraph: THREE.Mesh;
  targetMarker: THREE.Mesh;
  confused: THREE.Sprite;
  goldLock: THREE.Sprite;
  slowAura: THREE.Mesh;
  slowNotice: THREE.Sprite;
}

interface BuildingView {
  root: THREE.Group;
  barrel: THREE.Group | null;
  upgrade: THREE.Sprite;
  goldLock: THREE.Sprite;
  modelLevel: number;
  skinId: string;
  kind: BuildingKind;
  itemId?: string;
  barrelRestZ: number;
  recoil: number;
  pulseStartedAt: number;
  statusScale: number;
  levelLabel: string;
  levelColor: string;
  levelBackground: string;
  upgradeVisible: boolean;
}

interface LootView {
  root: THREE.Group;
  itemId: string;
}

interface DoorView {
  root: THREE.Group;
  panel: THREE.Group;
  surface: THREE.Mesh;
  frame: THREE.Mesh;
  details: THREE.Group;
  hp: THREE.Sprite;
  shield: THREE.Sprite;
  label: THREE.Sprite;
  upgrade: THREE.Sprite;
  closedTarget: number;
  closedAmount: number;
  visualLevel: number;
  impactUntil: number;
}

interface DoorHudCard {
  state: RoomState;
  x: number;
  y: number;
  width: number;
  height: number;
  compact: boolean;
}

interface BedView {
  root: THREE.Group;
  upgrade: THREE.Sprite;
  goldLock: THREE.Sprite;
  roomId: string;
  bedIndex: number;
}

interface RoomTileSkinView {
  skinId: string;
  transition: 'wave' | 'sand-vortex' | 'neon-collapse' | 'investigation-scan' | 'moonfire';
  root: THREE.Group;
  baseFloor: THREE.InstancedMesh;
  settledFloor: THREE.InstancedMesh;
  /**
   * Prestige room shells are deliberately kept as one instanced draw call.
   * The base map wall stays in place underneath, so a cosmetic swap never
   * affects collision or the door's authoritative state.
   */
  themedWalls?: THREE.InstancedMesh;
  wallDecorations?: THREE.Group;
  tiles: Array<{
    mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
    delay: number;
  }>;
  effect: THREE.Group;
  startedAt: number;
  duration: number;
  minX: number;
  maxX: number;
  centerX: number;
  centerY: number;
  complete: boolean;
}

export interface GamePerformanceStats {
  pixelRatio: number;
  minimumPixelRatio: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  transientEffects: number;
  hudMessages: number;
  cachedBuildingTextures: number;
  effectQuality: EffectQuality;
  roomSkinDrawables: number;
  buildingViews: number;
}

interface PointerDrag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
}

interface MultiTouchGesture {
  distance: number;
}

interface PortraitMovementDrag {
  id: number;
  startX: number;
  startY: number;
  outputX: number;
  outputY: number;
  active: boolean;
}

interface BuildingDragCandidate {
  pointerId: number;
  buildingId: string;
  roomId: string;
  sourceTile: Tile;
  startX: number;
  startY: number;
}

interface BuildingDrag extends BuildingDragCandidate {
  targetTile: Tile;
}

interface TimedEffect {
  object: THREE.Object3D;
  born: number;
  duration: number;
  from?: THREE.Vector3;
  to?: THREE.Vector3;
  rise?: number;
  baseScale?: THREE.Vector3;
  scaleGrowth?: number;
  fade?: boolean;
  release?: (object: THREE.Object3D) => void;
}

interface HudMessage {
  key: string;
  text: string;
  color: string;
  background: string;
  position: Vec2;
  born: number;
  duration: number;
  rise: number;
  peakOpacity?: number;
}

interface TurretVisualProfile {
  building: BuildingState;
  range: number;
  door?: Vec2;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const damp = (current: number, target: number, speed: number, dt: number): number => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * dt));
const dampAngle = (current: number, target: number, speed: number, dt: number): number => {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-speed * dt));
};
const worldPoint = (point: Vec2, y = FLOOR_Y): THREE.Vector3 => new THREE.Vector3(point.x, y, point.y);

function standardMaterial(color: THREE.ColorRepresentation, options: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.06, ...options });
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function effectMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const result = mesh(geometry, material, position);
  result.castShadow = false;
  result.receiveShadow = false;
  return result;
}

type PrestigeMotionTheme = 'moonlit' | 'starlit' | 'abyssal';
interface PrestigeTrailTexture {
  texture: THREE.Texture;
  packedAlpha: boolean;
}

// The authored loops stay shared per theme: every tile samples one video
// texture rather than creating a decoder for each of the four to six trails.
const PRESTIGE_MOTION_VIDEO_EFFECT_ASSETS: Record<PrestigeMotionTheme, string> = {
  moonlit: '/assets/prestige/moonlit-phantom-fox/effects/moonfire-trail.webm?revision=2',
  starlit: '/assets/prestige/starlit-cloud-rabbit/effects/starlight-trail.webm?revision=2',
  abyssal: '/assets/prestige/abyssal-knight-gorilla/effects/abyssal-fire-trail.webm?revision=1',
};

function prestigeMotionTheme(skinId: string): PrestigeMotionTheme | null {
  if (skinId === 'skin-look-fox-moonlit-phantom') return 'moonlit';
  if (skinId === 'skin-look-bunny-starlit-cloud') return 'starlit';
  if (skinId === 'skin-look-gorilla-abyssal-knight') return 'abyssal';
  return null;
}

function makePrestigeTrailEffect(
  theme: PrestigeMotionTheme,
  trailTexture: PrestigeTrailTexture,
): THREE.Group {
  const root = new THREE.Group();
  // Draw after the opaque floor but before the survivor plane.  The room tile
  // top is roughly y=.083, so keeping this effect above .10 prevents the
  // prestige fire from disappearing inside a skinned floor tile.
  root.renderOrder = 5_100;
  const initialOpacity = theme === 'starlit' ? 0.96 : 0.9;
  // WebM alpha is decoded inconsistently on mobile Safari. Each authored
  // clip therefore packs RGB on the left and its grayscale alpha mask on the
  // right; this shader reconstructs true transparency from one shared video
  // decoder per prestige theme.
  const material = trailTexture.packedAlpha
    ? new THREE.ShaderMaterial({
        uniforms: {
          map: { value: trailTexture.texture },
          opacity: { value: initialOpacity },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv; uniform sampler2D map; uniform float opacity; void main() { vec4 color = texture2D(map, vec2(vUv.x * 0.5, vUv.y)); float alpha = texture2D(map, vec2(0.5 + vUv.x * 0.5, vUv.y)).r * opacity; if (alpha < 0.015) discard; gl_FragColor = vec4(color.rgb, alpha); }`,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshBasicMaterial({
        map: trailTexture.texture,
        color: 0xffffff,
        transparent: true,
        opacity: initialOpacity,
        alphaTest: 0.015,
        blending: THREE.NormalBlending,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        side: THREE.DoubleSide,
      });
  const width = theme === 'abyssal' ? 1.22 : theme === 'starlit' ? 1.12 : 1.08;
  const depth = theme === 'abyssal' ? 0.74 : theme === 'starlit' ? 0.72 : 0.7;
  const image = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  image.rotation.x = -Math.PI / 2;
  image.renderOrder = 5_100;
  root.add(image);
  root.userData.prestigeTrailMaterials = [material];
  root.position.y = ROOM_FLOOR_CENTER_Y + FLOOR_TILE_HEIGHT / 2 + 0.025;
  return root;
}

function setPrestigeTrailOpacity(effect: THREE.Group, opacity: number): void {
  const materials = effect.userData.prestigeTrailMaterials as Array<THREE.MeshBasicMaterial | THREE.ShaderMaterial> | undefined;
  materials?.forEach((material) => {
    if (material instanceof THREE.ShaderMaterial) {
      const opacityUniform = material.uniforms.opacity;
      if (opacityUniform) opacityUniform.value = opacity;
    } else material.opacity = opacity;
  });
}

function makeBillboard(width = 512, height = 128): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.renderOrder = 10_000;
  sprite.userData.billboard = { canvas, context, texture, key: '' } satisfies BillboardData;
  return sprite;
}

function makeDoorLabelBillboard(): THREE.Sprite {
  return makeBillboard(768, 160);
}

function makeDoorBarBillboard(): THREE.Sprite {
  return makeBillboard(768, 160);
}

const rankBadgeTextures = new Map<RankId, THREE.Texture>();
const rankedBadgeTextures = new Map<RankedTier, THREE.Texture>();

function normalizeBadgeTexture(
  texture: THREE.Texture,
  layout: ReturnType<typeof rankBadgeArtworkLayout>,
): void {
  const viewport = badgeArtworkViewport(layout);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(viewport.textureRepeat, viewport.textureRepeat);
  texture.offset.set(viewport.textureOffsetX, viewport.textureOffsetY);
}

function rankBadgeTexture(rank: RankId): THREE.Texture {
  let texture = rankBadgeTextures.get(rank);
  if (!texture) {
    texture = new THREE.TextureLoader().load(rankBadgeImage(rank));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    normalizeBadgeTexture(texture, rankBadgeArtworkLayout(rank));
    rankBadgeTextures.set(rank, texture);
  }
  return texture;
}

function rankedBadgeTexture(tier: RankedTier): THREE.Texture {
  let texture = rankedBadgeTextures.get(tier);
  if (!texture) {
    texture = new THREE.TextureLoader().load(rankedBadgeImage(tier));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    normalizeBadgeTexture(texture, rankedBadgeArtworkLayout(tier));
    rankedBadgeTextures.set(tier, texture);
  }
  return texture;
}

interface PlayerProfileDisplay {
  badgeKey: string;
  badgeTexture: THREE.Texture;
  label: string;
  rank: RankId | null;
}

function playerProfileDisplay(player: PlayerState): PlayerProfileDisplay {
  if (player.profileDisplayMode === 'ranked') {
    return {
      badgeKey: `ranked:${player.profileRankedSeasonId ?? 'S1'}:${player.profileRankedTier}`,
      badgeTexture: rankedBadgeTexture(player.profileRankedTier),
      label: `${player.profileRankedSeasonId ?? 'S1'} ${RANKED_TIER_LABEL[player.profileRankedTier]}`,
      rank: null,
    };
  }
  const rank = player.profileDisplayMode === 'multiplayer'
    ? player.multiplayerRank
    : player.soloRank;
  return {
    badgeKey: `normal:${rank}`,
    badgeTexture: rankBadgeTexture(rank),
    label: rankLabel(rank),
    rank,
  };
}

function makeProfileBadge(player: PlayerState): THREE.Sprite {
  const display = playerProfileDisplay(player);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: display.badgeTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.scale.set(0.46, 0.46, 1);
  sprite.renderOrder = 10_030;
  return sprite;
}

function updateProfileBadge(sprite: THREE.Sprite, player: PlayerState): string {
  const display = playerProfileDisplay(player);
  const material = sprite.material as THREE.SpriteMaterial;
  if (material.map !== display.badgeTexture) {
    material.map = display.badgeTexture;
    material.needsUpdate = true;
  }
  return display.badgeKey;
}

type InGameNameplateTheme = string | null;

interface InGameNameplateAsset {
  image: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
}

const inGameNameplateAssets = new Map<string, InGameNameplateAsset>();
let inGameNameplateAssetRevision = 0;

function inGameNameplateAssetUrl(nameplateId: string): string | null {
  const regular = presentationById(nameplateId);
  if (regular?.category === 'nameplate') return regular.imageUrl;
  const prestige = prestigeAccessoryById(nameplateId);
  return prestige?.category === 'nameplate' ? prestige.imageUrl : null;
}

function inGameNameplateImage(nameplateId: string): HTMLImageElement | null {
  const assetUrl = inGameNameplateAssetUrl(nameplateId);
  if (!assetUrl) return null;
  let cached = inGameNameplateAssets.get(assetUrl);
  if (!cached) {
    const image = new Image();
    cached = { image, loaded: false, failed: false };
    inGameNameplateAssets.set(assetUrl, cached);
    image.decoding = 'async';
    image.addEventListener('load', () => {
      cached!.loaded = true;
      inGameNameplateAssetRevision += 1;
    }, { once: true });
    image.addEventListener('error', () => {
      cached!.failed = true;
      inGameNameplateAssetRevision += 1;
    }, { once: true });
    image.src = `${assetUrl}${assetUrl.includes('?') ? '&' : '?'}v=2026.08.07.2`;
  }
  return cached.loaded && !cached.failed ? cached.image : null;
}

function inGameNameplateTheme(nameplateId?: string | null): InGameNameplateTheme {
  if (!nameplateId) return null;
  const prestige = prestigeAccessoryById(nameplateId);
  if (prestige?.category === 'nameplate') return prestige.id;
  const presentation = presentationById(nameplateId);
  if (presentation?.category === 'nameplate') return presentation.id;
  return null;
}

function drawPrestigeNameplate(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: Exclude<InGameNameplateTheme, null>,
): void {
  const authoredImage = inGameNameplateImage(theme);
  if (authoredImage) {
    context.drawImage(authoredImage, 0, 0, width, height);
    return;
  }
  const prestigePalettes = {
    'nameplate-moonlit-phantom': { colors: ['#06152f', '#143d79', '#75eaff', '#d8f8ff'], motif: 'crescent' },
    'nameplate-starlit-cloud': { colors: ['#172351', '#4966ba', '#ffe7a4', '#f7fbff'], motif: 'star' },
    'nameplate-abyssal-knight': { colors: ['#170919', '#491333', '#ff704c', '#f1b4ff'], motif: 'crown' },
  } as const;
  const regular = presentationById(theme);
  const resolved = regular?.category === 'nameplate' && regular.nameplate
    ? { colors: [regular.nameplate.fill, regular.nameplate.center, regular.nameplate.edge, regular.nameplate.text] as const, motif: regular.nameplate.motif }
    : prestigePalettes[theme as keyof typeof prestigePalettes] ?? prestigePalettes['nameplate-moonlit-phantom'];
  const [deep, mid, accent, shine] = resolved.colors;
  const motif: NameplatePalette['motif'] | 'crescent' | 'crown' = resolved.motif;
  const body = context.createLinearGradient(0, 0, width, height);
  body.addColorStop(0, deep);
  body.addColorStop(0.5, mid);
  body.addColorStop(1, deep);
  context.fillStyle = body;
  context.beginPath();
  context.roundRect(8, 13, width - 16, height - 26, 38);
  context.fill();
  context.strokeStyle = accent;
  context.lineWidth = 5;
  context.stroke();
  context.strokeStyle = `${shine}88`;
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(16, 21, width - 32, height - 42, 29);
  context.stroke();

  context.save();
  context.fillStyle = accent;
  context.shadowColor = accent;
  context.shadowBlur = 13;
  if (motif === 'crescent') {
    for (const x of [35, width - 35]) {
      context.beginPath();
      context.arc(x, height / 2, 18, 0.45 * Math.PI, 1.55 * Math.PI);
      context.arc(x + (x < width / 2 ? 8 : -8), height / 2, 14, 1.55 * Math.PI, 0.45 * Math.PI, true);
      context.fill();
    }
  } else if (motif === 'star') {
    for (const x of [36, width - 36]) {
      context.beginPath();
      context.moveTo(x, height / 2 - 19);
      context.lineTo(x + 6, height / 2 - 6);
      context.lineTo(x + 19, height / 2);
      context.lineTo(x + 6, height / 2 + 6);
      context.lineTo(x, height / 2 + 19);
      context.lineTo(x - 6, height / 2 + 6);
      context.lineTo(x - 19, height / 2);
      context.lineTo(x - 6, height / 2 - 6);
      context.closePath();
      context.fill();
    }
  } else {
    for (const x of [36, width - 36]) {
      context.beginPath();
      context.moveTo(x, height / 2 - 22);
      context.lineTo(x + 18, height / 2);
      context.lineTo(x, height / 2 + 22);
      context.lineTo(x - 18, height / 2);
      context.closePath();
      context.fill();
      context.fillStyle = deep;
      context.beginPath();
      context.moveTo(x, height / 2 - 10);
      context.lineTo(x + 8, height / 2);
      context.lineTo(x, height / 2 + 10);
      context.lineTo(x - 8, height / 2);
      context.closePath();
      context.fill();
      context.fillStyle = accent;
    }
  }
  context.restore();
}

function updateTextBillboard(
  sprite: THREE.Sprite,
  key: string,
  text: string,
  color = '#ffffff',
  background = 'rgba(5,8,17,.78)',
  gradient: readonly [string, string, string] | null = null,
  fitToText = false,
  fontSize = 42,
  nameplateTheme: InGameNameplateTheme = null,
): void {
  const data = sprite.userData.billboard as BillboardData;
  if (data.key === key) return;
  data.key = key;
  const { canvas } = data;
  let context = data.context;
  if (fitToText) {
    context.font = `900 ${fontSize}px sans-serif`;
    const requiredWidth = Math.min(960, Math.max(512, Math.ceil(context.measureText(text).width + 112)));
    if (canvas.width !== requiredWidth) {
      canvas.width = requiredWidth;
      const nextContext = canvas.getContext('2d');
      if (!nextContext) throw new Error('Canvas 2D context is unavailable');
      context = nextContext;
      data.context = nextContext;
    }
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (nameplateTheme) {
    drawPrestigeNameplate(context, canvas.width, canvas.height, nameplateTheme);
  } else {
    context.fillStyle = background;
    context.beginPath();
    context.roundRect(10, 18, canvas.width - 20, canvas.height - 36, Math.min(42, canvas.height / 3));
    context.fill();
    context.strokeStyle = 'rgba(210,232,255,.34)';
    context.lineWidth = 4;
    context.stroke();
  }
  context.fillStyle = gradient
    ? (() => {
      const fill = context.createLinearGradient(82, 0, canvas.width - 82, 0);
      fill.addColorStop(0, gradient[0]);
      fill.addColorStop(0.5, gradient[1]);
      fill.addColorStop(1, gradient[2]);
      return fill;
    })()
    : color;
  context.font = `900 ${fontSize}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0,0,0,.8)';
  context.shadowBlur = 10;
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2, canvas.width - 44);
  data.texture.needsUpdate = true;
}

function updateBarBillboard(
  sprite: THREE.Sprite,
  key: string,
  ratio: number,
  label: string,
  color: string,
  fontSize = 34,
): void {
  const data = sprite.userData.billboard as BillboardData;
  if (data.key === key) return;
  data.key = key;
  const { canvas, context } = data;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(3,5,12,.9)';
  context.beginPath();
  context.roundRect(12, 28, canvas.width - 24, 72, 30);
  context.fill();
  context.fillStyle = color;
  context.beginPath();
  context.roundRect(20, 36, (canvas.width - 40) * clamp(ratio, 0, 1), 56, 24);
  context.fill();
  context.fillStyle = '#fff';
  context.font = `900 ${fontSize}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = '#000';
  context.shadowBlur = 8;
  context.fillText(label, canvas.width / 2, 65, canvas.width - 44);
  data.texture.needsUpdate = true;
}

function updateUpgradeBillboard(sprite: THREE.Sprite, key: string, affordable: boolean): void {
  const data = sprite.userData.billboard as BillboardData;
  if (data.key === key) return;
  data.key = key;
  const { canvas, context } = data;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const accent = affordable ? '#ffd94f' : '#9aa8bd';
  context.shadowColor = affordable ? 'rgba(255, 194, 36, .9)' : 'rgba(0, 0, 0, .7)';
  context.shadowBlur = affordable ? 22 : 10;
  context.fillStyle = 'rgba(8, 13, 25, .94)';
  context.beginPath();
  context.arc(centerX, centerY, canvas.width * 0.39, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 12;
  context.strokeStyle = accent;
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = accent;
  context.beginPath();
  context.moveTo(centerX, canvas.height * 0.19);
  context.lineTo(canvas.width * 0.73, canvas.height * 0.46);
  context.lineTo(canvas.width * 0.6, canvas.height * 0.46);
  context.lineTo(canvas.width * 0.6, canvas.height * 0.75);
  context.lineTo(canvas.width * 0.4, canvas.height * 0.75);
  context.lineTo(canvas.width * 0.4, canvas.height * 0.46);
  context.lineTo(canvas.width * 0.27, canvas.height * 0.46);
  context.closePath();
  context.fill();
  data.texture.needsUpdate = true;
}

function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Sprite) && !(child instanceof THREE.Line)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = opacity < 1 || material.transparent;
      material.opacity = opacity;
      const actorOpacity = material.userData.actorOpacity as THREE.IUniform<number> | undefined;
      if (actorOpacity) actorOpacity.value = opacity;
    }
  });
}

function disposeBillboards(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Sprite)) return;
    const data = child.userData.billboard as BillboardData | undefined;
    if (!data) return;
    data.texture.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) material.dispose();
  });
}

export function releaseBuildingModelTextures(object: THREE.Object3D): void {
  object.traverse((candidate) => {
    const textureUrl = candidate.userData.buildingTextureUrl as
      | string
      | undefined;
    if (
      !textureUrl ||
      candidate.userData.buildingTextureReleased === true
    )
      return;
    candidate.userData.buildingTextureReleased = true;
    releaseBuildingTexture(textureUrl);
  });
}

function disposeBuildingRoot(object: THREE.Object3D): void {
  releaseBuildingModelTextures(object);
  object.traverse((child) => {
    if (
      !(child instanceof THREE.Mesh) &&
      !(child instanceof THREE.Line) &&
      !(child instanceof THREE.Sprite)
    )
      return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (
        material instanceof THREE.SpriteMaterial &&
        material.map instanceof THREE.CanvasTexture
      )
        material.map.dispose();
      material.dispose();
    }
  });
}

function disposeTransientObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (
      !(child instanceof THREE.Mesh) &&
      !(child instanceof THREE.Line) &&
      !(child instanceof THREE.Sprite)
    )
      return;
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of childMaterials) {
      materials.add(material);
      if (
        (material instanceof THREE.SpriteMaterial ||
          material instanceof THREE.MeshBasicMaterial ||
          material instanceof THREE.MeshStandardMaterial) &&
        material.map instanceof THREE.Texture
      ) {
        if (!material.map.userData.sharedEnvironmentTexture) {
          textures.add(material.map);
        }
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export function createPlayerRig(
  appearance: AvatarAppearance,
  displayRank: RankId,
  color: number,
  local = false,
): PlayerRig {
  const root = new THREE.Group();
  const avatar = new THREE.Group();
  root.add(avatar);

  const animal = appearance.character.replace('character-', '');
  const furColors: Record<string, number> = {
    bunny: 0xe6c2b7,
    cat: 0xaeb9ce,
    puppy: 0xc99264,
    bear: 0x8f6248,
    fox: 0xcf6843,
    hamster: 0xcfaa75,
    crocodile: 0x5f9c61,
    duck: 0xf2d66a,
    tiger: 0xe29a4d,
    dinosaur: 0x72b45a,
    monkey: 0x8d5b3f,
    gorilla: 0x56616d,
  };
  const fur = new THREE.MeshPhysicalMaterial({
    color: furColors[animal] ?? 0xe6c2b7,
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.72,
  });
  const innerEar = standardMaterial(animal === 'fox' ? 0x5a2c2b : 0xc9858a, { roughness: 0.9 });
  const clothColor = new THREE.Color(color);
  const cloth = standardMaterial(clothColor, {
    roughness: 0.88,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const shoe = standardMaterial(0x20242d, {
    roughness: 0.82,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const eye = new THREE.MeshPhysicalMaterial({ color: 0x17151d, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });
  const white = standardMaterial(0xf8f2e8, { roughness: 0.82 });
  const cheek = standardMaterial(0xe58f94, { roughness: 0.9, transparent: true, opacity: 0.64 });
  const palm = fur.clone();
  palm.color.offsetHSL(0, -0.08, 0.12);

  const torso = mesh(new THREE.SphereGeometry(0.34, 22, 16), cloth, [0, 0.51, 0]);
  torso.scale.set(1.02, 0.78, 0.86);
  avatar.add(torso);
  const tummy = mesh(new THREE.SphereGeometry(0.235, 18, 12), cloth.clone(), [0, 0.5, -0.185]);
  tummy.scale.set(1.03, 0.68, 0.3);
  (tummy.material as THREE.MeshStandardMaterial).color.offsetHSL(0, -0.08, 0.08);
  avatar.add(tummy);
  const outfitDetails = createOutfitDetails('outfit-pajamas', clothColor);
  outfitDetails.scale.y = 0.7;
  outfitDetails.position.y = 0.01;
  avatar.add(outfitDetails);
  const head = mesh(new THREE.SphereGeometry(0.42, 28, 20), fur, [0, 0.96, -0.015]);
  const headScale: Record<string, [number, number, number]> = {
    crocodile: [1.26, 0.8, 1.08],
    duck: [0.98, 1.02, 0.97],
    tiger: [1.08, 1, 1],
    dinosaur: [1.18, 0.9, 1.04],
    monkey: [1.04, 0.98, 0.98],
    gorilla: [1.24, 0.94, 1.04],
  };
  head.scale.set(...(headScale[animal] ?? [1.06, 0.98, 0.98]));
  avatar.add(head);
  const ears = createAnimalEars(animal, fur, innerEar);
  ears.position.y = -0.22;
  avatar.add(ears);
  const eyeLayout = animal === 'crocodile'
    ? { x: 0.225, y: 1.08, z: -0.405, radius: 0.055, highlight: 0.016 }
    : animal === 'gorilla'
      ? { x: 0.17, y: 1.005, z: -0.405, radius: 0.061, highlight: 0.018 }
      : { x: 0.145, y: 0.985, z: -0.37, radius: 0.066, highlight: 0.019 };
  for (const x of [-eyeLayout.x, eyeLayout.x]) {
    avatar.add(mesh(new THREE.SphereGeometry(eyeLayout.radius, 16, 12), eye, [x, eyeLayout.y, eyeLayout.z]));
    avatar.add(mesh(new THREE.SphereGeometry(eyeLayout.highlight, 8, 6), white, [x - 0.018, eyeLayout.y + 0.022, eyeLayout.z - 0.056]));
  }
  const detailedAnimalFace = ['crocodile', 'duck', 'tiger', 'dinosaur', 'monkey', 'gorilla'].includes(animal);
  if (!detailedAnimalFace) {
    const muzzle = mesh(new THREE.SphereGeometry(0.13, 18, 12), white, [0, 0.845, -0.39]);
    muzzle.scale.set(1.22, 0.7, 0.62);
    avatar.add(muzzle);
    avatar.add(mesh(new THREE.SphereGeometry(0.039, 12, 8), standardMaterial(0x684348, { roughness: 0.32 }), [0, 0.885, -0.47]));
    const smile = mesh(new THREE.TorusGeometry(0.052, 0.01, 5, 18, Math.PI), standardMaterial(0x71464d, { roughness: 0.4 }), [0, 0.8, -0.467]);
    smile.rotation.z = Math.PI;
    avatar.add(smile);
  }
  avatar.add(createAnimalFaceDetails(animal));
  if (!detailedAnimalFace) {
    const leftCheek = mesh(new THREE.SphereGeometry(0.053, 10, 8), cheek, [-0.255, 0.87, -0.34]);
    const rightCheek = mesh(new THREE.SphereGeometry(0.053, 10, 8), cheek, [0.255, 0.87, -0.34]);
    leftCheek.scale.y = rightCheek.scale.y = 0.52;
    avatar.add(leftCheek, rightCheek);
  }
  const hat = createAvatarHat('hat-rank', displayRank);
  hat.position.y = -0.22;
  avatar.add(hat);
  const accessory = createAvatarAccessory('accessory-none');
  accessory.scale.y = 0.72;
  avatar.add(accessory);
  const tail = createAnimalTail(animal, fur);
  tail.scale.y = 0.72;
  avatar.add(tail);
  avatar.add(createAnimalBodyDetails(animal));

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-0.285, 0.57, 0);
  rightArm.position.set(0.285, 0.57, 0);
  if (animal === 'gorilla') {
    leftArm.position.x = -0.38;
    rightArm.position.x = 0.38;
    leftArm.scale.set(1.34, 1.42, 1.18);
    rightArm.scale.copy(leftArm.scale);
  }
  leftArm.rotation.z = -0.08;
  rightArm.rotation.z = 0.08;
  const armMaterial = animal === 'gorilla' ? fur : cloth;
  leftArm.add(mesh(new THREE.SphereGeometry(0.105, 12, 9), armMaterial, [0, -0.015, 0]));
  rightArm.add(mesh(new THREE.SphereGeometry(0.105, 12, 9), armMaterial, [0, -0.015, 0]));
  leftArm.add(mesh(new THREE.CapsuleGeometry(0.082, 0.08, 5, 10), armMaterial, [0, -0.1, 0]));
  rightArm.add(mesh(new THREE.CapsuleGeometry(0.082, 0.08, 5, 10), armMaterial, [0, -0.1, 0]));
  leftArm.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), fur, [0, -0.21, 0]));
  rightArm.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), fur, [0, -0.21, 0]));
  const leftPalm = mesh(new THREE.SphereGeometry(0.058, 10, 7), palm, [0, -0.21, 0.065]);
  const rightPalm = mesh(new THREE.SphereGeometry(0.058, 10, 7), palm, [0, -0.21, 0.065]);
  leftPalm.scale.set(0.78, 0.34, 0.18);
  rightPalm.scale.copy(leftPalm.scale);
  leftArm.add(leftPalm);
  rightArm.add(rightPalm);
  avatar.add(leftArm, rightArm);

  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.135, 0.32, 0);
  rightLeg.position.set(0.135, 0.32, 0);
  leftLeg.add(mesh(new THREE.CapsuleGeometry(0.09, 0.1, 3, 8), cloth, [0, -0.08, 0]));
  rightLeg.add(mesh(new THREE.CapsuleGeometry(0.09, 0.1, 3, 8), cloth, [0, -0.08, 0]));
  const leftShoe = mesh(new THREE.SphereGeometry(0.14, 14, 9), shoe, [0, -0.2, -0.055]);
  const rightShoe = mesh(new THREE.SphereGeometry(0.14, 14, 9), shoe, [0, -0.2, -0.055]);
  leftShoe.scale.set(0.9, 0.62, 1.25);
  rightShoe.scale.copy(leftShoe.scale);
  leftLeg.add(leftShoe);
  rightLeg.add(rightShoe);
  decorateShoes('shoes-slippers', leftLeg, rightLeg);
  avatar.add(leftLeg, rightLeg);

  const groundRing = mesh(
    new THREE.RingGeometry(local ? 0.34 : 0.31, local ? 0.4 : 0.35, 36),
    new THREE.MeshBasicMaterial({ color: local ? 0x74e6ff : color, transparent: true, opacity: local ? 0.72 : 0.3, side: THREE.DoubleSide }),
    [0, 0.025, 0],
  );
  groundRing.rotation.x = -Math.PI / 2;
  groundRing.name = 'avatar-ground-ring';
  root.add(groundRing);
  root.scale.setScalar(0.92);
  return { root, avatar, leftArm, rightArm, leftLeg, rightLeg };
}

function createOutfitDetails(outfitId: string, clothColor: THREE.Color): THREE.Group {
  const details = new THREE.Group();
  const light = standardMaterial(clothColor.clone().offsetHSL(0, -0.08, 0.2), { roughness: 0.82 });
  const dark = standardMaterial(clothColor.clone().offsetHSL(0, 0.06, -0.22), { roughness: 0.86 });
  const cream = standardMaterial(0xf0e5cf, { roughness: 0.9 });
  const gold = standardMaterial(0xf4c461, { metalness: 0.42, roughness: 0.38 });
  const red = standardMaterial(0xd95062, { roughness: 0.72 });
  const addButtons = (material: THREE.Material, count: number, startY = 0.82): void => {
    for (let index = 0; index < count; index += 1) {
      details.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), material, [0, startY - index * 0.12, -0.31]));
    }
  };
  const collar = (material: THREE.Material, radius = 0.23): void => {
    const ring = mesh(new THREE.TorusGeometry(radius, 0.035, 7, 22), material, [0, 0.97, 0]);
    ring.rotation.x = Math.PI / 2;
    details.add(ring);
  };

  if (outfitId === 'outfit-pajamas') {
    addButtons(light, 3);
    const moon = mesh(new THREE.TorusGeometry(0.075, 0.018, 7, 18, Math.PI * 1.45), gold, [-0.1, 0.63, -0.305]);
    moon.rotation.z = -0.55;
    details.add(moon);
  } else if (outfitId === 'outfit-raincoat') {
    collar(dark, 0.25);
    details.add(mesh(new THREE.BoxGeometry(0.13, 0.52, 0.035), light, [0, 0.65, -0.31]));
    addButtons(dark, 3, 0.82);
    const hood = mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 22, Math.PI * 1.25), dark, [0, 1.12, 0.08]);
    hood.rotation.z = -Math.PI * 0.12;
    details.add(hood);
  } else if (outfitId === 'outfit-campus') {
    for (const x of [-0.1, 0.1]) {
      const lapel = mesh(new THREE.BoxGeometry(0.11, 0.34, 0.035), cream, [x, 0.81, -0.3]);
      lapel.rotation.z = x < 0 ? -0.38 : 0.38;
      details.add(lapel);
    }
    details.add(mesh(new THREE.BoxGeometry(0.028, 0.5, 0.04), gold, [0, 0.65, -0.32]));
    details.add(mesh(new THREE.BoxGeometry(0.2, 0.11, 0.04), dark, [0, 0.49, -0.31]));
  } else if (outfitId === 'outfit-medic') {
    collar(light);
    for (const x of [-0.16, 0.16]) {
      const tail = mesh(new THREE.BoxGeometry(0.25, 0.44, 0.12), cream, [x, 0.43, 0.03]);
      tail.rotation.z = x < 0 ? 0.08 : -0.08;
      details.add(tail);
    }
    details.add(mesh(new THREE.BoxGeometry(0.055, 0.2, 0.04), red, [0.13, 0.72, -0.32]));
    details.add(mesh(new THREE.BoxGeometry(0.18, 0.055, 0.04), red, [0.13, 0.72, -0.325]));
  } else if (outfitId === 'outfit-commander') {
    collar(gold);
    for (const x of [-0.25, 0.25]) details.add(mesh(new THREE.BoxGeometry(0.19, 0.06, 0.18), gold, [x, 0.91, 0]));
    addButtons(gold, 3);
    details.add(mesh(new THREE.BoxGeometry(0.53, 0.07, 0.12), gold, [0, 0.52, -0.03]));
    for (const x of [-0.14, 0.14]) {
      const tail = mesh(new THREE.BoxGeometry(0.24, 0.42, 0.08), dark, [x, 0.4, 0.18]);
      tail.rotation.z = x < 0 ? 0.13 : -0.13;
      details.add(tail);
    }
  } else if (outfitId === 'outfit-starlight') {
    collar(light, 0.245);
    const cape = mesh(new THREE.ConeGeometry(0.39, 0.78, 9, 1, true), dark, [0, 0.58, 0.18]);
    cape.rotation.y = Math.PI / 9;
    details.add(cape);
    for (const point of [[-0.13, 0.7], [0.1, 0.55], [0.02, 0.82]] as const) {
      const star = mesh(new THREE.OctahedronGeometry(0.035), light, [point[0], point[1], -0.32]);
      star.scale.z = 0.35;
      details.add(star);
    }
  } else if (outfitId === 'outfit-frog') {
    const belly = mesh(new THREE.SphereGeometry(0.2, 14, 10), light, [0, 0.64, -0.23]);
    belly.scale.set(1, 1.2, 0.35);
    details.add(belly);
    for (const x of [-0.18, 0.18]) details.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), dark, [x, 0.88, -0.25]));
    details.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 16), gold, [0.11, 0.62, -0.33]));
  } else if (outfitId === 'outfit-bakery') {
    collar(cream);
    details.add(mesh(new THREE.BoxGeometry(0.38, 0.48, 0.035), cream, [0, 0.63, -0.31]));
    details.add(mesh(new THREE.BoxGeometry(0.22, 0.13, 0.04), dark, [0, 0.5, -0.34]));
    addButtons(gold, 2, 0.83);
    for (const x of [-0.21, 0.21]) {
      const strap = mesh(new THREE.BoxGeometry(0.045, 0.46, 0.035), dark, [x, 0.72, -0.29]);
      strap.rotation.z = x < 0 ? -0.12 : 0.12;
      details.add(strap);
    }
  } else if (outfitId === 'outfit-detective') {
    for (const x of [-0.11, 0.11]) {
      const lapel = mesh(new THREE.BoxGeometry(0.14, 0.4, 0.045), light, [x, 0.77, -0.31]);
      lapel.rotation.z = x < 0 ? -0.34 : 0.34;
      details.add(lapel);
    }
    details.add(mesh(new THREE.BoxGeometry(0.56, 0.075, 0.12), dark, [0, 0.55, -0.01]));
    details.add(mesh(new THREE.BoxGeometry(0.48, 0.34, 0.08), dark, [0, 0.38, 0.16]));
    addButtons(gold, 2, 0.7);
  } else if (outfitId === 'outfit-puffer') {
    collar(cream, 0.26);
    for (const y of [0.49, 0.64, 0.79]) {
      const quilt = mesh(new THREE.TorusGeometry(0.29, 0.032, 6, 22), light, [0, y, 0]);
      quilt.rotation.x = Math.PI / 2;
      quilt.scale.z = 0.82;
      details.add(quilt);
    }
    details.add(mesh(new THREE.BoxGeometry(0.035, 0.48, 0.04), gold, [0, 0.65, -0.32]));
  } else if (outfitId === 'outfit-astronaut') {
    collar(dark, 0.26);
    details.add(mesh(new THREE.BoxGeometry(0.32, 0.2, 0.06), dark, [0, 0.7, -0.31]));
    for (const [x, color] of [[-0.09, red], [0, gold], [0.09, light]] as const) {
      details.add(mesh(new THREE.SphereGeometry(0.026, 8, 6), color, [x, 0.72, -0.35]));
    }
    details.add(mesh(new THREE.BoxGeometry(0.46, 0.5, 0.18), dark, [0, 0.7, 0.24]));
    for (const x of [-0.29, 0.29]) {
      const shoulder = mesh(new THREE.TorusGeometry(0.11, 0.035, 7, 18), gold, [x, 0.84, 0]);
      shoulder.rotation.x = Math.PI / 2;
      details.add(shoulder);
    }
  } else if (outfitId === 'outfit-vampire') {
    const cape = mesh(new THREE.ConeGeometry(0.44, 0.92, 8, 1, true), dark, [0, 0.56, 0.2]);
    cape.rotation.y = Math.PI / 8;
    details.add(cape);
    for (const x of [-0.19, 0.19]) {
      const collarWing = mesh(new THREE.ConeGeometry(0.13, 0.36, 4), red, [x, 1.02, 0.06]);
      collarWing.rotation.z = x < 0 ? -0.55 : 0.55;
      details.add(collarWing);
    }
    details.add(mesh(new THREE.OctahedronGeometry(0.07), gold, [0, 0.86, -0.34]));
    addButtons(gold, 2, 0.7);
  }
  return details;
}

function decorateShoes(shoeId: string, leftLeg: THREE.Group, rightLeg: THREE.Group): void {
  const white = standardMaterial(0xf2f0e9, { roughness: 0.86 });
  const dark = standardMaterial(0x28303b, { roughness: 0.76 });
  const gold = standardMaterial(0xf0b74f, { metalness: 0.38, roughness: 0.42 });
  const pink = standardMaterial(0xe78fa7, { roughness: 0.82 });
  const cyan = standardMaterial(0x6fe8e0, { emissive: 0x1a7774, emissiveIntensity: 1.1, roughness: 0.36 });
  for (const leg of [leftLeg, rightLeg]) {
    if (shoeId === 'shoes-slippers') {
      leg.add(mesh(new THREE.BoxGeometry(0.2, 0.045, 0.13), white, [0, -0.25, -0.16]));
    } else if (shoeId === 'shoes-sneakers') {
      leg.add(mesh(new THREE.BoxGeometry(0.23, 0.045, 0.32), white, [0, -0.36, -0.07]));
      for (const x of [-0.045, 0.045]) leg.add(mesh(new THREE.BoxGeometry(0.018, 0.018, 0.17), dark, [x, -0.25, -0.13]));
    } else if (shoeId === 'shoes-boots') {
      leg.add(mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.23, 12), dark, [0, -0.18, 0]));
      const cuff = mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 18), gold, [0, -0.08, 0]);
      cuff.rotation.x = Math.PI / 2;
      leg.add(cuff);
    } else if (shoeId === 'shoes-moon') {
      const crescent = mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 16, Math.PI * 1.45), cyan, [0.08, -0.27, -0.17]);
      crescent.rotation.z = -0.55;
      leg.add(crescent, mesh(new THREE.ConeGeometry(0.05, 0.18, 4), white, [0.15, -0.27, 0.02]));
    } else if (shoeId === 'shoes-neon') {
      leg.add(mesh(new THREE.BoxGeometry(0.23, 0.035, 0.34), cyan, [0, -0.36, -0.07]));
      leg.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), cyan, [0, -0.28, 0.08]));
    } else if (shoeId === 'shoes-bunny') {
      for (const x of [-0.045, 0.045]) leg.add(mesh(new THREE.CapsuleGeometry(0.022, 0.09, 3, 7), pink, [x, -0.22, -0.18]));
      for (const x of [-0.04, 0.04]) leg.add(mesh(new THREE.SphereGeometry(0.012, 6, 5), dark, [x, -0.29, -0.205]));
    } else if (shoeId === 'shoes-duck') {
      const bill = mesh(new THREE.SphereGeometry(0.12, 12, 8), gold, [0, -0.31, -0.18]);
      bill.scale.set(0.9, 0.35, 1.25);
      leg.add(bill, mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.22, 12), dark, [0, -0.18, 0]));
    } else if (shoeId === 'shoes-roller') {
      leg.add(mesh(new THREE.BoxGeometry(0.23, 0.05, 0.34), white, [0, -0.36, -0.06]));
      for (const z of [-0.16, 0.03]) {
        const wheel = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.25, 10), pink, [0, -0.42, z]);
        wheel.rotation.z = Math.PI / 2;
        leg.add(wheel);
      }
    } else if (shoeId === 'shoes-cloud') {
      for (const x of [-0.07, 0.02, 0.09]) leg.add(mesh(new THREE.SphereGeometry(0.085, 10, 7), white, [x, -0.33, -0.08 - Math.abs(x) * 0.35]));
    } else if (shoeId === 'shoes-armor') {
      leg.add(mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.25, 8), dark, [0, -0.17, 0]));
      const toe = mesh(new THREE.SphereGeometry(0.14, 10, 8), white, [0, -0.3, -0.09]);
      toe.scale.set(0.9, 0.5, 1.35);
      leg.add(toe, mesh(new THREE.BoxGeometry(0.24, 0.04, 0.08), gold, [0, -0.29, -0.2]));
    }
  }
}

function createAnimalTail(animal: string, fur: THREE.Material): THREE.Group {
  const tail = new THREE.Group();
  if (animal === 'bunny') {
    tail.add(mesh(new THREE.SphereGeometry(0.15, 14, 10), fur, [0, 0.68, 0.28]));
  } else if (animal === 'bear' || animal === 'hamster') {
    tail.add(mesh(new THREE.SphereGeometry(animal === 'hamster' ? 0.1 : 0.085, 12, 8), fur, [0, 0.7, 0.27]));
  } else if (animal === 'crocodile' || animal === 'dinosaur') {
    const length = animal === 'crocodile' ? 0.66 : 0.74;
    const tailMesh = mesh(new THREE.ConeGeometry(0.13, length, 10), fur, [0, 0.65, 0.34]);
    tailMesh.rotation.x = Math.PI / 2.45;
    tail.add(tailMesh);
    if (animal === 'dinosaur') {
      const spike = standardMaterial(0xe4dcae, { roughness: 0.8 });
      for (const [x, y, z] of [[0, 0.82, 0.26], [0, 0.73, 0.43], [0, 0.61, 0.58]] as Array<[number, number, number]>) {
        const horn = mesh(new THREE.ConeGeometry(0.045, 0.13, 5), spike, [x, y, z]);
        horn.rotation.x = Math.PI / 2.4;
        tail.add(horn);
      }
    }
  } else if (animal === 'duck') {
    const feather = standardMaterial(0xf6f0c9, { roughness: 0.82 });
    for (const x of [-0.07, 0.07]) {
      const plume = mesh(new THREE.ConeGeometry(0.075, 0.28, 6), feather, [x, 0.67, 0.29]);
      plume.rotation.x = Math.PI / 2.1;
      plume.rotation.z = x * 1.4;
      tail.add(plume);
    }
  } else if (animal === 'monkey') {
    const points = [[0.15, 0.61, 0.24], [0.29, 0.73, 0.3], [0.34, 0.92, 0.26], [0.24, 1.07, 0.19]]
      .map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index] as THREE.Vector3;
      const to = points[index + 1] as THREE.Vector3;
      const direction = to.clone().sub(from);
      const segment = mesh(new THREE.CapsuleGeometry(0.048, Math.max(0.015, direction.length() - 0.075), 5, 10), fur);
      segment.position.copy(from).lerp(to, 0.5);
      segment.quaternion.setFromUnitVectors(up, direction.normalize());
      tail.add(segment);
    }
  } else {
    const radius = animal === 'tiger' ? 0.082 : animal === 'fox' ? 0.085 : animal === 'puppy' ? 0.068 : 0.058;
    const points = (animal === 'puppy'
      ? [[0.17, 0.63, 0.23], [0.27, 0.71, 0.26], [0.25, 0.82, 0.27]]
      : [[0.16, 0.57, 0.22], [0.27, 0.66, 0.25], [0.32, 0.8, 0.27], [0.27, 0.94, 0.26]])
      .map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index] as THREE.Vector3;
      const to = points[index + 1] as THREE.Vector3;
      const direction = to.clone().sub(from);
      const length = direction.length();
      const segment = mesh(
        new THREE.CapsuleGeometry(radius * (1 - index * 0.08), Math.max(0.015, length - radius * 1.6), 5, 10),
        fur,
        [0, 0, 0],
      );
      segment.position.copy(from).lerp(to, 0.5);
      segment.quaternion.setFromUnitVectors(up, direction.normalize());
      tail.add(segment);
    }
    tail.add(mesh(
      new THREE.SphereGeometry(radius * 0.78, 12, 9),
      fur,
      (points[points.length - 1] as THREE.Vector3).toArray() as [number, number, number],
    ));
    if (animal === 'tiger') {
      const stripe = standardMaterial(0x342024, { roughness: 0.72 });
      for (const point of points.slice(1)) {
        const band = mesh(new THREE.BoxGeometry(0.18, 0.035, 0.052), stripe, point.toArray() as [number, number, number]);
        band.rotation.z = -0.48;
        tail.add(band);
      }
    }
  }
  return tail;
}

function createAnimalEars(animal: string, fur: THREE.Material, inner: THREE.Material): THREE.Group {
  const ears = new THREE.Group();
  if (animal === 'crocodile') {
    const eyeBump = standardMaterial(0x8cc676, { roughness: 0.76 });
    for (const x of [-0.22, 0.22]) ears.add(mesh(new THREE.SphereGeometry(0.105, 10, 8), eyeBump, [x, 1.37, -0.2]));
  } else if (animal === 'dinosaur') {
    const horn = standardMaterial(0xe6deae, { roughness: 0.8 });
    for (const x of [-0.18, 0.18]) {
      const spike = mesh(new THREE.ConeGeometry(0.075, 0.24, 5), horn, [x, 1.43, 0.02]);
      spike.rotation.z = x < 0 ? 0.2 : -0.2;
      ears.add(spike);
    }
  } else if (animal === 'duck') {
    const feather = standardMaterial(0xfbedd1, { roughness: 0.84 });
    for (const x of [-0.12, 0.12]) {
      const tuft = mesh(new THREE.ConeGeometry(0.075, 0.17, 5), feather, [x, 1.44, 0.03]);
      tuft.rotation.z = x < 0 ? 0.25 : -0.25;
      ears.add(tuft);
    }
  } else if (animal === 'cat' || animal === 'fox' || animal === 'tiger') {
    for (const x of [-0.24, 0.24]) {
      const ear = mesh(new THREE.ConeGeometry(0.15, animal === 'fox' ? 0.36 : animal === 'tiger' ? 0.34 : 0.29, 4), fur, [x, 1.53, 0]);
      ear.rotation.z = x < 0 ? 0.14 : -0.14;
      ears.add(ear);
      if (animal === 'tiger') {
        const inset = mesh(new THREE.ConeGeometry(0.068, 0.2, 4), inner, [x, 1.535, -0.065]);
        inset.rotation.z = ear.rotation.z;
        ears.add(inset);
      }
    }
  } else if (animal === 'puppy') {
    for (const x of [-0.32, 0.32]) {
      const ear = mesh(new THREE.CapsuleGeometry(0.1, 0.28, 4, 8), fur, [x, 1.36, 0]);
      ear.rotation.z = x < 0 ? -0.42 : 0.42;
      ears.add(ear);
    }
  } else if (animal === 'monkey') {
    const peach = standardMaterial(0xf0bd90, { roughness: 0.82 });
    for (const x of [-0.35, 0.35]) {
      ears.add(mesh(new THREE.SphereGeometry(0.23, 12, 9), fur, [x, 1.4, 0]));
      const innerEar = mesh(new THREE.SphereGeometry(0.135, 10, 8), peach, [x, 1.4, -0.15]);
      innerEar.scale.set(0.95, 1.06, 0.3);
      ears.add(innerEar);
    }
    const tuft = standardMaterial(0x603829, { roughness: 0.8 });
    for (const [x, y] of [[-0.12, 1.49], [0, 1.56], [0.12, 1.49]] as Array<[number, number]>) {
      const hair = mesh(new THREE.ConeGeometry(0.075, 0.2, 5), tuft, [x, y, -0.035]);
      hair.rotation.z = x * -1.5;
      ears.add(hair);
    }
  } else if (animal === 'gorilla') {
    const gorillaInner = standardMaterial(0x7f8995, { roughness: 0.82 });
    for (const x of [-0.32, 0.32]) {
      ears.add(mesh(new THREE.SphereGeometry(0.15, 10, 8), fur, [x, 1.38, 0]));
      ears.add(mesh(new THREE.SphereGeometry(0.085, 8, 6), gorillaInner, [x, 1.38, -0.105]));
    }
    const crest = mesh(new THREE.SphereGeometry(0.17, 12, 8), fur, [0, 1.43, 0.06]);
    crest.scale.set(1.28, 0.8, 0.7);
    ears.add(crest);
  } else if (animal === 'bear' || animal === 'hamster') {
    for (const x of [-0.27, 0.27]) {
      const radius = animal === 'hamster' ? 0.14 : 0.16;
      ears.add(mesh(new THREE.SphereGeometry(radius, 10, 8), fur, [x, 1.44, 0]));
      ears.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), inner, [x, 1.44, -0.11]));
    }
  } else {
    for (const x of [-0.17, 0.17]) {
      const ear = mesh(new THREE.CapsuleGeometry(0.1, 0.46, 5, 9), fur, [x, 1.65, 0.02]);
      ear.rotation.z = x < 0 ? -0.08 : 0.08;
      ears.add(ear);
      const inset = mesh(new THREE.CapsuleGeometry(0.045, 0.28, 4, 8), inner, [x, 1.65, -0.085]);
      inset.rotation.z = ear.rotation.z;
      ears.add(inset);
    }
  }
  return ears;
}

function createAnimalFaceDetails(animal: string): THREE.Group {
  const details = new THREE.Group();
  const dark = standardMaterial(0x1d1b21, { roughness: 0.45 });
  const cream = standardMaterial(0xf5e9c8, { roughness: 0.82 });
  const orange = standardMaterial(0xf09238, { roughness: 0.72 });
  if (animal === 'duck') {
    const bill = mesh(new THREE.SphereGeometry(0.15, 16, 10), orange, [0, 0.84, -0.51]);
    bill.scale.set(1.5, 0.5, 0.62);
    details.add(bill);
    for (const x of [-0.052, 0.052]) details.add(mesh(new THREE.SphereGeometry(0.012, 8, 6), dark, [x, 0.855, -0.574]));
    const wingMaterial = standardMaterial(0xf4eac5, { roughness: 0.82 });
    for (const x of [-0.34, 0.34]) {
      const wing = mesh(new THREE.SphereGeometry(0.17, 14, 10), wingMaterial, [x, 0.56, 0.02]);
      wing.scale.set(0.62, 1.05, 0.56);
      wing.rotation.z = x < 0 ? -0.24 : 0.24;
      details.add(wing);
    }
  } else if (animal === 'tiger') {
    const muzzle = mesh(new THREE.SphereGeometry(0.17, 18, 12), cream, [0, 0.84, -0.47]);
    muzzle.scale.set(1.36, 0.58, 0.6);
    details.add(muzzle, mesh(new THREE.SphereGeometry(0.043, 12, 8), dark, [0, 0.89, -0.57]));
    // 눈가에는 선을 두지 않는다. 작은 화면에서 줄무늬가 눈/수염으로 겹쳐 보이는 것을 막는다.
    for (const [x, y, width, rotation] of [[0, 1.28, 0.09, 0], [-0.22, 1.2, 0.13, -0.62], [0.22, 1.2, 0.13, 0.62]] as Array<[number, number, number, number]>) {
      const stripe = mesh(new THREE.BoxGeometry(width, 0.04, 0.035), dark, [x, y, -0.43]);
      stripe.rotation.z = rotation;
      details.add(stripe);
    }
  } else if (animal === 'crocodile') {
    const snout = mesh(new THREE.SphereGeometry(0.22, 18, 12), standardMaterial(0x83bc72, { roughness: 0.8 }), [0, 0.76, -0.54]);
    snout.scale.set(1.62, 0.38, 0.85);
    details.add(snout);
    for (const x of [-0.2, -0.07, 0.07, 0.2]) {
      const tooth = mesh(new THREE.ConeGeometry(0.026, 0.07, 5), cream, [x, 0.69, -0.605]);
      tooth.rotation.x = Math.PI;
      details.add(tooth);
    }
    for (const x of [-0.15, 0.15]) details.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), dark, [x, 0.79, -0.66]));
  } else if (animal === 'dinosaur') {
    const horn = standardMaterial(0xf0ddae, { roughness: 0.8 });
    const muzzle = mesh(new THREE.SphereGeometry(0.16, 16, 10), standardMaterial(0xb7d68a, { roughness: 0.76 }), [0, 0.84, -0.47]);
    muzzle.scale.set(1.35, 0.62, 0.65);
    details.add(muzzle);
    for (const x of [-0.06, 0.06]) details.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), dark, [x, 0.88, -0.57]));
    for (const x of [-0.18, 0.18]) {
      const cheekHorn = mesh(new THREE.ConeGeometry(0.036, 0.12, 5), horn, [x, 0.88, -0.43]);
      cheekHorn.rotation.x = -Math.PI / 2.25;
      details.add(cheekHorn);
    }
  } else if (animal === 'monkey') {
    const face = mesh(new THREE.SphereGeometry(0.28, 18, 12), standardMaterial(0xf0bd90, { roughness: 0.82 }), [0, 0.9, -0.35]);
    face.scale.set(1.18, 0.94, 0.35);
    const muzzle = mesh(new THREE.SphereGeometry(0.16, 16, 10), standardMaterial(0xf7cf9f, { roughness: 0.8 }), [0, 0.79, -0.48]);
    muzzle.scale.set(1.28, 0.58, 0.58);
    details.add(face, muzzle, mesh(new THREE.SphereGeometry(0.04, 12, 8), dark, [0, 0.84, -0.58]));
  } else if (animal === 'gorilla') {
    const muzzle = mesh(new THREE.SphereGeometry(0.22, 16, 10), standardMaterial(0x9faab1, { roughness: 0.78 }), [0, 0.82, -0.5]);
    muzzle.scale.set(1.35, 0.7, 0.64);
    details.add(muzzle, mesh(new THREE.SphereGeometry(0.047, 12, 8), dark, [0, 0.88, -0.62]));
    for (const x of [-0.18, 0.18]) {
      const brow = mesh(new THREE.BoxGeometry(0.19, 0.065, 0.055), dark, [x, 1.12, -0.45]);
      brow.rotation.z = x < 0 ? 0.11 : -0.11;
      details.add(brow);
    }
  }
  return details;
}

function createAnimalBodyDetails(animal: string): THREE.Group {
  const details = new THREE.Group();
  const dark = standardMaterial(0x30232a, { roughness: 0.76 });
  const cream = standardMaterial(0xf3e4bf, { roughness: 0.82 });
  if (animal === 'crocodile' || animal === 'dinosaur') {
    const plate = animal === 'crocodile'
      ? standardMaterial(0x3f7b4c, { roughness: 0.78 })
      : standardMaterial(0xf0ddae, { roughness: 0.8 });
    for (const [y, z, size] of [[0.77, 0.19, 0.09], [0.62, 0.23, 0.1], [0.48, 0.24, 0.08]] as Array<[number, number, number]>) {
      const spike = mesh(new THREE.ConeGeometry(size, size * 2.2, 5), plate, [0, y, z]);
      spike.rotation.x = -0.16;
      details.add(spike);
    }
  } else if (animal === 'tiger') {
    for (const [y, width] of [[0.64, 0.34], [0.49, 0.28], [0.39, 0.22]] as Array<[number, number]>) {
      details.add(mesh(new THREE.BoxGeometry(width, 0.045, 0.035), dark, [0, y, -0.3]));
    }
  } else if (animal === 'monkey') {
    const belly = mesh(new THREE.SphereGeometry(0.2, 14, 10), standardMaterial(0xd9ad87, { roughness: 0.82 }), [0, 0.5, -0.27]);
    belly.scale.set(1.06, 0.78, 0.28);
    const banana = standardMaterial(0xf4cc45, { roughness: 0.78 });
    const bananaTip = standardMaterial(0x69412d, { roughness: 0.82 });
    const bananaArc = mesh(new THREE.TorusGeometry(0.13, 0.035, 7, 18, Math.PI * 1.15), banana, [0.22, 0.53, -0.37]);
    bananaArc.rotation.z = -0.55;
    details.add(belly, bananaArc, mesh(new THREE.SphereGeometry(0.035, 8, 6), bananaTip, [0.31, 0.44, -0.39]));
  } else if (animal === 'gorilla') {
    const shoulder = standardMaterial(0x424c5a, { roughness: 0.78 });
    for (const x of [-0.36, 0.36]) {
      const armMass = mesh(new THREE.SphereGeometry(0.18, 12, 9), shoulder, [x, 0.65, 0.02]);
      armMass.scale.set(1.42, 0.92, 0.98);
      details.add(armMass);
    }
    const chest = mesh(new THREE.SphereGeometry(0.24, 14, 10), cream, [0, 0.53, -0.3]);
    chest.scale.set(1.34, 0.78, 0.3);
    const chestLine = mesh(new THREE.BoxGeometry(0.03, 0.25, 0.04), dark, [0, 0.53, -0.39]);
    details.add(chest, chestLine);
  }
  return details;
}

function createRankHat(rank: RankId): THREE.Group {
  const hat = new THREE.Group();
  hat.position.y = 1.87;
  const dark = standardMaterial(0x161321, { roughness: 0.82 });
  const straw = standardMaterial(0xd9ae62, { roughness: 0.96 });
  const blue = standardMaterial(0x3979a8, { roughness: 0.78 });
  const violet = standardMaterial(0x6647a6, { roughness: 0.68 });
  const silver = standardMaterial(0xc7d6e1, { metalness: 0.72, roughness: 0.3 });
  const gold = standardMaterial(0xf0b847, { metalness: 0.78, roughness: 0.25, emissive: 0x5c3000, emissiveIntensity: 0.32 });
  const legend = standardMaterial(0xff5ca8, { metalness: 0.68, roughness: 0.2, emissive: 0x7b123f, emissiveIntensity: 0.78 });

  if (rank === 'beginner') {
    hat.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.045, 22), straw));
    hat.add(mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.22, 18), straw, [0, 0.12, 0]));
    const band = mesh(new THREE.TorusGeometry(0.245, 0.025, 6, 20), dark, [0, 0.055, 0]);
    band.rotation.x = Math.PI / 2;
    hat.add(band);
  } else if (rank === 'intermediate') {
    const cap = mesh(new THREE.SphereGeometry(0.3, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2), blue, [0, 0.02, 0.02]);
    cap.scale.y = 0.78;
    hat.add(cap, mesh(new THREE.BoxGeometry(0.38, 0.045, 0.27), blue, [0, 0.015, -0.28]));
  } else if (rank === 'expert') {
    hat.add(mesh(new THREE.CylinderGeometry(0.25, 0.29, 0.22, 7), dark, [0, 0.11, 0]));
    hat.add(mesh(new THREE.BoxGeometry(0.47, 0.055, 0.3), violet, [0, 0.02, -0.3]));
    hat.add(mesh(new THREE.BoxGeometry(0.06, 0.19, 0.3), violet, [0, 0.13, -0.19]));
  } else {
    const material = rank === 'master' ? silver : rank === 'veteran' ? gold : legend;
    const radius = rank === 'master' ? 0.27 : 0.3;
    hat.add(mesh(new THREE.CylinderGeometry(radius, radius + 0.02, 0.12, 14), material, [0, 0.06, 0]));
    const spikeCount = rank === 'master' ? 4 : rank === 'veteran' ? 5 : 6;
    for (let index = 0; index < spikeCount; index += 1) {
      const angle = (index / spikeCount) * Math.PI * 2;
      const spike = mesh(
        new THREE.ConeGeometry(rank === 'legend' ? 0.07 : 0.06, rank === 'legend' ? 0.34 : 0.27, 5),
        material,
        [Math.cos(angle) * radius * 0.72, rank === 'legend' ? 0.27 : 0.23, Math.sin(angle) * radius * 0.72],
      );
      hat.add(spike);
    }
    if (rank === 'legend') {
      const halo = mesh(new THREE.TorusGeometry(0.39, 0.025, 8, 28), legend, [0, 0.47, 0]);
      halo.rotation.x = Math.PI / 2;
      hat.add(halo);
    }
  }
  hat.userData.rankHat = rank;
  return hat;
}

function createAvatarHat(hatId: string, rank: RankId): THREE.Group {
  const hat = new THREE.Group();
  const midnight = standardMaterial(0x243049, { roughness: 0.82 });
  const cyan = standardMaterial(0x66d7dc, { roughness: 0.66, emissive: 0x143e4a, emissiveIntensity: 0.42 });
  const cream = standardMaterial(0xe7d7bd, { roughness: 0.92 });
  const silver = standardMaterial(0xc9dce7, { metalness: 0.72, roughness: 0.28 });
  const gold = standardMaterial(0xf2bd52, { metalness: 0.76, roughness: 0.24, emissive: 0x4f2900, emissiveIntensity: 0.28 });

  if (hatId === 'hat-rank') {
    const rankHat = createRankHat(rank);
    rankHat.position.y = 1.49;
    rankHat.scale.setScalar(0.82);
    hat.add(rankHat);
  } else if (hatId === 'hat-beanie') {
    const crown = mesh(new THREE.SphereGeometry(0.31, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), midnight, [0, 1.44, 0.015]);
    crown.scale.y = 0.8;
    hat.add(crown);
    hat.add(mesh(new THREE.TorusGeometry(0.285, 0.055, 7, 24), cyan, [0, 1.45, 0.01]));
    const pompom = mesh(new THREE.SphereGeometry(0.085, 10, 8), cyan, [0, 1.72, 0.02]);
    hat.add(pompom);
  } else if (hatId === 'hat-moon-cap') {
    const crown = mesh(new THREE.SphereGeometry(0.32, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2), midnight, [0, 1.44, 0.02]);
    crown.scale.y = 0.72;
    hat.add(crown);
    const brim = mesh(new THREE.BoxGeometry(0.38, 0.045, 0.27), midnight, [0, 1.44, -0.29]);
    brim.rotation.x = -0.08;
    hat.add(brim);
    const moon = mesh(new THREE.TorusGeometry(0.064, 0.018, 7, 18, Math.PI * 1.45), cream, [0, 1.56, -0.294]);
    moon.rotation.z = -0.55;
    hat.add(moon);
  } else if (hatId === 'hat-headlamp') {
    const band = mesh(new THREE.TorusGeometry(0.325, 0.035, 7, 24), midnight, [0, 1.43, 0]);
    band.rotation.x = Math.PI / 2;
    hat.add(band);
    const lamp = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.065, 14), cyan, [0, 1.48, -0.342]);
    lamp.rotation.x = Math.PI / 2;
    hat.add(lamp);
    const light = new THREE.PointLight(0x74f4ff, 0.65, 2.2);
    light.position.set(0, 1.48, -0.48);
    hat.add(light);
  } else if (hatId === 'hat-silver-crown' || hatId === 'hat-gold-crown') {
    const material = hatId === 'hat-silver-crown' ? silver : gold;
    hat.add(mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.11, 14), material, [0, 1.48, 0.02]));
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      hat.add(mesh(
        new THREE.ConeGeometry(0.055, 0.26, 5),
        material,
        [Math.cos(angle) * 0.2, 1.64, Math.sin(angle) * 0.2 + 0.02],
      ));
    }
  } else if (hatId === 'hat-halo') {
    const halo = mesh(
      new THREE.TorusGeometry(0.34, 0.025, 8, 28),
      standardMaterial(0xffd9f1, { emissive: 0xff4baa, emissiveIntensity: 1.8, roughness: 0.2 }),
      [0, 1.75, 0.02],
    );
    halo.rotation.x = Math.PI / 2;
    hat.add(halo);
  }

  return hat;
}

function createAvatarAccessory(accessoryId: string): THREE.Group {
  const accessory = new THREE.Group();
  const cyan = standardMaterial(0x5fd6d4, { roughness: 0.72, emissive: 0x113d42, emissiveIntensity: 0.36 });
  const amber = standardMaterial(0xf1b85c, { roughness: 0.56, emissive: 0x6f3400, emissiveIntensity: 0.42 });
  const violet = standardMaterial(0x8a74d6, { roughness: 0.74 });

  if (accessoryId === 'accessory-scarf') {
    const collar = mesh(new THREE.TorusGeometry(0.24, 0.055, 7, 22), cyan, [0, 0.94, 0]);
    collar.rotation.x = Math.PI / 2;
    accessory.add(collar);
    const tail = mesh(new THREE.BoxGeometry(0.11, 0.36, 0.055), cyan, [0.18, 0.73, 0.23]);
    tail.rotation.z = -0.22;
    accessory.add(tail);
  } else if (accessoryId === 'accessory-backpack') {
    const pack = mesh(new THREE.BoxGeometry(0.44, 0.5, 0.2), violet, [0, 0.7, 0.25]);
    pack.geometry.translate(0, 0, 0.08);
    accessory.add(pack);
    accessory.add(mesh(new THREE.BoxGeometry(0.22, 0.18, 0.06), amber, [0, 0.65, 0.42]));
  } else if (accessoryId === 'accessory-star') {
    const star = mesh(
      new THREE.OctahedronGeometry(0.12, 0),
      standardMaterial(0xe4f6ff, { emissive: 0x66dbff, emissiveIntensity: 1.45, roughness: 0.25 }),
      [0, 0.76, -0.29],
    );
    star.scale.set(1, 1.28, 0.42);
    accessory.add(star);
  } else if (accessoryId === 'accessory-lantern') {
    const handle = mesh(new THREE.TorusGeometry(0.105, 0.018, 6, 18, Math.PI), amber, [0.43, 0.74, -0.02]);
    handle.rotation.z = Math.PI;
    accessory.add(handle);
    accessory.add(mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.2, 10), amber, [0.43, 0.57, -0.02]));
    const glow = mesh(
      new THREE.SphereGeometry(0.057, 9, 7),
      standardMaterial(0xfff0a1, { emissive: 0xffaa33, emissiveIntensity: 2.4, roughness: 0.24 }),
      [0.43, 0.59, -0.105],
    );
    accessory.add(glow);
    const light = new THREE.PointLight(0xffb85e, 0.7, 2.1);
    light.position.copy(glow.position);
    accessory.add(light);
  }

  return accessory;
}

interface GhostPreviewModel {
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
}

function createGhostModel(variant: GhostState['variant']): GhostPreviewModel {
  const body = new THREE.Group();
  const palettes: Record<GhostState['variant'], { robe: number; skin: number; glow: number }> = {
    wanderer: { robe: 0x9a9ca1, skin: 0xd8d2cc, glow: 0xff173f },
    swift: { robe: 0x250d16, skin: 0xcbb8af, glow: 0xff9c35 },
    brute: { robe: 0x201811, skin: 0x918b78, glow: 0xff3124 },
    caster: { robe: 0x100c29, skin: 0x9995b1, glow: 0xc866ff },
    'twin-a': { robe: 0x171526, skin: 0xc5c0cc, glow: 0x5be1ff },
    'twin-b': { robe: 0x27101e, skin: 0xc7b1b9, glow: 0xff4b7b },
    teleporter: { robe: 0x071b28, skin: 0x98aeb4, glow: 0x25e4ff },
    undead: { robe: 0x182315, skin: 0x879b7d, glow: 0x8dff64 },
    giant: { robe: 0x1b1010, skin: 0x79695f, glow: 0xff6a32 },
    demolisher: { robe: 0x161116, skin: 0xc0b7b2, glow: 0xff3f4f },
    wallpaper: { robe: 0x24132e, skin: 0xc5b4c7, glow: 0xb856ff },
    minion: { robe: 0x27321f, skin: 0xa4b98d, glow: 0xb2ff75 },
  };
  const palette = palettes[variant];
  const robe = standardMaterial(palette.robe, {
    roughness: 1,
    side: THREE.DoubleSide,
    emissive: palette.robe,
    emissiveIntensity: variant === 'wanderer' ? 0.08 : 0.48,
  });
  const skin = standardMaterial(palette.skin, { roughness: 0.92 });
  const black = standardMaterial(0x050407, { roughness: 1 });
  const glow = standardMaterial(palette.glow, { emissive: palette.glow, emissiveIntensity: 3.4, roughness: 0.25 });

  const brute = variant === 'brute';
  const giant = variant === 'giant';
  const minion = variant === 'minion';
  const broad = brute || giant;
  const cone = mesh(new THREE.ConeGeometry(broad ? 0.7 : 0.5, broad ? 1.45 : 1.3, 7, 1, true), robe, [0, 0.68, 0]);
  cone.rotation.y = Math.PI / 7;
  body.add(cone);
  const head = mesh(new THREE.SphereGeometry(broad ? 0.39 : 0.31, 14, 10), skin, [0, broad ? 1.55 : 1.48, -0.02]);
  head.scale.z = 0.78;
  body.add(head);
  const hair = mesh(new THREE.SphereGeometry(broad ? 0.41 : 0.335, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.68), black, [0, broad ? 1.64 : 1.57, 0]);
  body.add(hair);
  if (variant === 'wanderer') {
    // 긴 머리 처녀귀신: 창백한 얼굴 앞까지 내려오는 머리카락과 비대칭 앞머리,
    // 깊게 꺼진 눈·벌어진 입을 작은 홈 프리뷰에서도 읽히게 만든다.
    const backHair = mesh(new THREE.CapsuleGeometry(0.29, 0.94, 5, 10), black, [0, 1.02, 0.11]);
    backHair.scale.set(1.05, 1, 0.48);
    body.add(backHair);
    for (const [x, tilt, length] of [[-0.28, -0.11, 0.76], [0.28, 0.08, 0.9]] as const) {
      const lock = mesh(new THREE.CapsuleGeometry(0.075, length, 4, 8), black, [x, 1.18, -0.235]);
      lock.rotation.z = tilt;
      lock.scale.z = 0.55;
      body.add(lock);
    }
    const faceMask = mesh(new THREE.SphereGeometry(0.22, 14, 9), skin, [0, 1.47, -0.3]);
    faceMask.scale.set(0.9, 1.12, 0.22);
    faceMask.rotation.z = 0.08;
    body.add(faceMask);
    for (const [x, y, tilt] of [[-0.18, 1.55, -0.2], [0.18, 1.55, 0.23]] as const) {
      const bang = mesh(new THREE.CapsuleGeometry(0.05, 0.34, 3, 7), black, [x, y, -0.358]);
      bang.rotation.z = tilt;
      bang.scale.z = 0.5;
      body.add(bang);
    }
    for (const x of [-0.085, 0.085]) {
      const socket = mesh(new THREE.SphereGeometry(0.066, 10, 7), black, [x, 1.49, -0.354]);
      socket.scale.y = 1.18;
      body.add(socket);
      body.add(mesh(new THREE.SphereGeometry(0.024, 8, 6), glow, [x, 1.49, -0.408]));
    }
    const mouth = mesh(new THREE.SphereGeometry(0.07, 9, 7), black, [0.018, 1.345, -0.362]);
    mouth.scale.set(0.7, 1.65, 0.34);
    mouth.rotation.z = -0.12;
    body.add(mouth);
    const crack = mesh(new THREE.BoxGeometry(0.012, 0.17, 0.012), black, [-0.15, 1.39, -0.377]);
    crack.rotation.z = -0.48;
    body.add(crack);
    const driedBlood = standardMaterial(0x52000d, { roughness: 0.96, emissive: 0x260006, emissiveIntensity: 0.3 });
    for (const [x, y, size] of [[-0.12, 0.82, 0.075], [0.16, 1.02, 0.055], [0.02, 0.56, 0.045]] as const) {
      const stain = mesh(new THREE.SphereGeometry(size, 8, 6), driedBlood, [x, y, -0.38]);
      stain.scale.set(1, 1.5, 0.18);
      body.add(stain);
    }
    head.rotation.z = 0.09;
  } else {
    for (const x of [-0.105, 0.105]) body.add(mesh(new THREE.SphereGeometry(broad ? 0.047 : 0.038, 8, 6), glow, [x, broad ? 1.56 : 1.49, -0.265]));
    const mouth = mesh(new THREE.BoxGeometry(broad ? 0.24 : 0.18, 0.045, 0.025), black, [0, broad ? 1.42 : 1.36, -0.27]);
    body.add(mouth);
  }

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(broad ? -0.48 : -0.34, 1.18, 0);
  rightArm.position.set(broad ? 0.48 : 0.34, 1.18, 0);
  leftArm.rotation.z = broad ? 0.55 : 0.88;
  rightArm.rotation.z = broad ? -0.55 : -0.88;
  leftArm.add(mesh(new THREE.CapsuleGeometry(broad ? 0.095 : 0.065, broad ? 0.72 : 0.62, 3, 7), skin, [0, -0.38, 0]));
  rightArm.add(mesh(new THREE.CapsuleGeometry(broad ? 0.095 : 0.065, broad ? 0.72 : 0.62, 3, 7), skin, [0, -0.38, 0]));
  body.add(leftArm, rightArm);

  if (variant === 'caster') {
    const halo = mesh(new THREE.TorusGeometry(0.52, 0.025, 8, 32), glow, [0, 1.48, 0]);
    halo.rotation.x = Math.PI / 2;
    body.add(halo);
  }
  if (variant === 'teleporter') {
    const portal = mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 36), glow, [0, 0.9, 0.18]);
    portal.rotation.x = Math.PI / 2;
    body.add(portal);
  }
  if (variant === 'undead') {
    for (const x of [-0.24, 0, 0.24]) body.add(mesh(new THREE.BoxGeometry(0.055, 0.34, 0.055), skin, [x, 1.02, -0.35]));
  }
  if (giant) {
    const chain = mesh(new THREE.TorusGeometry(0.47, 0.055, 7, 24), standardMaterial(0x514844, { metalness: 0.75, roughness: 0.5 }), [0, 1.12, -0.2]);
    chain.rotation.x = Math.PI / 2;
    body.add(chain);
  }
  if (variant.startsWith('twin')) body.scale.setScalar(0.78);
  if (brute) body.scale.set(1.12, 1.12, 1.12);
  if (giant) body.scale.set(1.58, 1.72, 1.58);
  if (minion) body.scale.setScalar(0.42);
  return { body, leftArm, rightArm };
}

/** 홈 추격 연출과 인게임이 동일한 귀신 지오메트리를 공유한다. */
export function createGhostPreviewModel(variant: GhostState['variant'] = 'wanderer'): {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
} {
  const model = createGhostModel(variant);
  const root = new THREE.Group();
  root.add(model.body);
  return { root, ...model };
}

function buildingColor(kind: BuildingKind): number {
  const colors: Record<BuildingKind, number> = {
    bed: 0x6ed9e8,
    'reinforced-door': 0x769bc2,
    'basic-turret': 0x62d7ff,
    'rapid-turret': 0xffc85f,
    'frost-turret': 0x91efff,
    'arc-turret': 0xcf79ff,
    'golden-turret': 0xffd15c,
    generator: 0x68efa4,
    'repair-drone': 0xff7ca7,
    'electric-coil': 0xbd80ff,
    'shield-device': 0x879eff,
    'lucky-machine': 0xff6eaa,
    'gem-core': 0x69e7ff,
    'ghost-net': 0xf4d36d,
    'range-amplifier': 0x8bafff,
    'overload-capacitor': 0x74d8ff,
    'turret-enhancer': 0x89f0c8,
    'door-anchor': 0xf1a46b,
    'reflect-mirror': 0xa7e9ff,
    'power-panel': 0xffd66f,
    'cursed-contract': 0xe688bd,
    'soul-vial': 0x9beaff,
    'hide-and-seek-doll': 0xc6a2ff,
    'starter-grave': 0x8b97a5,
    'random-item': 0xffca62,
  };
  return colors[kind];
}

function turretSkinColor(building: BuildingState): number {
  const skin = building.skinId ?? '';
  if (skin.includes('toy')) return 0xf1b86b;
  if (skin.includes('pumpkin')) return 0xe87942;
  if (skin.includes('candy')) return 0xed86b5;
  if (skin.includes('dragon')) return 0x8ccf72;
  if (skin.includes('globe')) return 0xc4f4ff;
  if (skin.includes('crystal')) return 0x7fc8ff;
  if (skin.includes('idol')) return 0xb69cf2;
  if (skin.includes('crown')) return 0xf0bd63;
  return buildingColor(building.kind);
}

/** A shared reward illustration still reads as distinct loot by its tier tint. */
function randomRewardTint(itemId?: string): number {
  const effect = itemId ? getRandomItem(itemId)?.effect : undefined;
  const gold = effect?.goldPerSecond ?? 0;
  if (gold >= 500) return 0xf5a4ff;
  if (gold >= 100) return 0xffe8a0;
  if (gold >= 50) return 0xffba65;
  if (gold >= 20) return 0xffd66d;
  if (gold > 0) return 0xfff1c4;
  if ((effect?.powerPerSecond ?? 0) > 0) return 0xa8f8ff;
  return 0xffffff;
}

export function createBuildingModel(building: BuildingState): { root: THREE.Group; barrel: THREE.Group | null } {
  const root = new THREE.Group();
  const visualLevel = building.effectiveLevel ?? building.level;
  // Prestige guardians legitimately exceed the ordinary Lv.15 cap.  Keep the
  // visual level in lockstep with the authoritative level so the authored
  // Lv.16 and Lv.17 art is never silently replaced by the Lv.15 texture.
  const artLevel = building.kind === 'basic-turret' && building.skinId
    ? Math.min(17, visualLevel)
    : Math.min(visualLevel, maxBuildingLevel(building.kind));
  const imageAsset = buildingAssetUrl(
    building.kind,
    artLevel,
    building.itemId,
    building.skinId,
  );
  if (imageAsset) {
    // A room can contain many copies of the same building. Reusing the GPU
    // texture avoids a new decode/upload for every installation and removes
    // the frame drops that appeared once a room was built out.
    const texture = acquireBuildingTexture(imageAsset);
    const artMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      color: building.kind === 'random-item' ? randomRewardTint(building.itemId) : 0xffffff,
      transparent: true,
      premultipliedAlpha: false,
      alphaTest: 0.025,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    artMaterial.userData.sharedBuildingTexture = true;
    const art = mesh(
      // The art itself now uses a tight silhouette. Let it almost fill one
      // tile so a turret, repair stand, or generator is identifiable without
      // opening its detail panel.
      new THREE.PlaneGeometry(1.2, 1.2),
      artMaterial,
      [0, 0.105, 0],
    );
    art.castShadow = false;
    art.receiveShadow = false;
    // Guardian art is authored with the single barrel pointing toward the
    // bottom of the tile. Its circular base lets this pivot visibly track a
    // target while the tile anchor and HUD remain fixed.
    const artPivot = new THREE.Group();
    // Every authored turret follows the shared image rule: one muzzle, facing
    // straight down in the source square. Runtime aiming therefore shares one
    // zero offset across normal and prestige skins.
    artPivot.userData.aimOffset = 0;
    art.rotation.x = -Math.PI / 2;
    art.renderOrder = 5;
    artPivot.add(art);
    root.add(artPivot);
    root.userData.renderMode = 'building-image';
    root.userData.imageAsset = imageAsset;
    root.userData.buildingTextureUrl = imageAsset;
    root.userData.buildingTextureReleased = false;
    return { root, barrel: building.kind === 'basic-turret' ? artPivot : null };
  }
  const turret = ['basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret', 'golden-turret'].includes(building.kind);
  const turretTier = turret ? Math.min(4, Math.floor((Math.max(1, building.level) - 1) / 3)) : 0;
  const color = turretSkinColor(building);
  const baseMaterial = standardMaterial(0x172235, { metalness: 0.52, roughness: 0.42 });
  const accent = standardMaterial(color, { emissive: color, emissiveIntensity: 0.85 + turretTier * 0.18, metalness: 0.35, roughness: 0.28 });
  const dark = standardMaterial(0x080b13, { metalness: 0.6, roughness: 0.34 });
  const baseRadius = turret ? 0.36 + turretTier * 0.025 : 0.36;
  root.add(mesh(new THREE.CylinderGeometry(baseRadius, baseRadius + 0.06, 0.18 + turretTier * 0.012, 12), baseMaterial, [0, 0.1, 0]));
  root.add(mesh(new THREE.CylinderGeometry(0.27 + turretTier * 0.018, 0.32 + turretTier * 0.018, 0.28 + turretTier * 0.025, 12), accent, [0, 0.29, 0]));

  let barrel: THREE.Group | null = null;
  if (turret) {
    barrel = new THREE.Group();
    barrel.position.y = 0.52 + turretTier * 0.035;
    const barrelLength = (building.kind === 'golden-turret' ? 0.9 : building.kind === 'rapid-turret' ? 0.62 : 0.72) + turretTier * 0.045;
    const barrelMesh = mesh(new THREE.CylinderGeometry(building.kind === 'golden-turret' ? 0.07 : 0.055, building.kind === 'golden-turret' ? 0.09 : 0.075, barrelLength, 9), accent, [0, 0, -barrelLength * 0.44]);
    barrelMesh.rotation.x = Math.PI / 2;
    barrel.add(barrelMesh);
    barrel.add(mesh(new THREE.SphereGeometry(0.17, 12, 8), dark, [0, 0, 0]));
    root.add(barrel);
    if (turretTier >= 1) {
      const armorRing = mesh(new THREE.TorusGeometry(0.39 + turretTier * 0.025, 0.045, 8, 24), dark, [0, 0.5, 0]);
      armorRing.rotation.x = Math.PI / 2;
      root.add(armorRing);
    }
    if (turretTier >= 2) {
      for (const x of [-0.31, 0.31]) {
        root.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.26, 8), accent, [x, 0.42, 0]));
        root.add(mesh(new THREE.SphereGeometry(0.065, 8, 6), dark, [x, 0.57, 0]));
      }
    }
    if (turretTier >= 3) {
      for (const x of [-0.13, 0.13]) {
        const sideBarrel = mesh(new THREE.CylinderGeometry(0.04, 0.055, barrelLength * 0.9, 8), accent, [x, 0, -barrelLength * 0.41]);
        sideBarrel.rotation.x = Math.PI / 2;
        barrel.add(sideBarrel);
      }
      for (const x of [-0.3, 0.3]) root.add(mesh(new THREE.ConeGeometry(0.09, 0.28, 5), dark, [x, 0.58, 0.13]));
    }
    if (turretTier >= 4) {
      root.add(mesh(new THREE.OctahedronGeometry(0.18), accent, [0, 0.86, 0]));
      const apexHalo = mesh(new THREE.TorusGeometry(0.5, 0.035, 8, 28), accent, [0, 0.88, 0]);
      apexHalo.rotation.x = Math.PI / 2;
      root.add(apexHalo);
    }
    if (building.kind === 'golden-turret') {
      const crown = new THREE.Group();
      crown.position.y = 0.68;
      for (const x of [-0.18, 0, 0.18]) crown.add(mesh(new THREE.ConeGeometry(0.075, 0.28, 5), accent, [x, 0.13, 0]));
      const halo = mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 28), accent, [0, 0.12, 0]);
      halo.rotation.x = Math.PI / 2;
      crown.add(halo);
      root.add(crown);
    } else if (building.skinId.includes('pumpkin')) {
      root.add(mesh(new THREE.SphereGeometry(0.24, 12, 9), accent, [0, 0.48, 0]));
      root.add(mesh(new THREE.ConeGeometry(0.055, 0.18, 7), standardMaterial(0x68a054), [0, 0.76, 0]));
    } else if (building.skinId.includes('toy') || building.skinId.includes('candy')) {
      const ring = mesh(new THREE.TorusGeometry(0.22, 0.04, 7, 18), accent, [0, 0.48, 0]);
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
    } else if (building.skinId.includes('dragon')) {
      root.add(mesh(new THREE.ConeGeometry(0.075, 0.2, 5), accent, [-0.14, 0.77, 0]));
      root.add(mesh(new THREE.ConeGeometry(0.075, 0.2, 5), accent, [0.14, 0.77, 0]));
    } else if (building.skinId.includes('globe')) {
      root.add(mesh(new THREE.SphereGeometry(0.31, 16, 12), new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.3, roughness: 0.12 }), [0, 0.5, 0]));
    } else if (building.skinId.includes('crystal')) {
      root.add(mesh(new THREE.OctahedronGeometry(0.24), accent, [0, 0.59, 0]));
    } else if (building.skinId.includes('idol')) {
      const ring = mesh(new THREE.TorusGeometry(0.29, 0.055, 8, 22), accent, [0, 0.52, 0]);
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
    } else if (building.skinId.includes('crown')) {
      for (const x of [-0.16, 0, 0.16]) root.add(mesh(new THREE.ConeGeometry(0.07, 0.22, 5), accent, [x, 0.78, 0]));
    }
  } else if (building.kind === 'generator') {
    const coil = mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 24), accent, [0, 0.58, 0]);
    coil.rotation.x = Math.PI / 2;
    root.add(coil, mesh(new THREE.BoxGeometry(0.12, 0.58, 0.12), accent, [0, 0.52, 0]));
  } else if (building.kind === 'shield-device') {
    const shield = mesh(new THREE.SphereGeometry(0.36, 16, 10), new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.26, transmission: 0.12, roughness: 0.12 }), [0, 0.46, 0]);
    root.add(shield);
  } else if (building.kind === 'lucky-machine') {
    root.add(mesh(new THREE.BoxGeometry(0.5, 0.68, 0.45), baseMaterial, [0, 0.48, 0]));
    root.add(mesh(new THREE.BoxGeometry(0.34, 0.28, 0.05), accent, [0, 0.56, -0.25]));
  } else if (building.kind === 'gem-core') {
    const gem = mesh(new THREE.OctahedronGeometry(0.31), accent, [0, 0.62, 0]);
    gem.scale.y = 1.35;
    const ring = mesh(new THREE.TorusGeometry(0.37, 0.035, 8, 28), accent, [0, 0.45, 0]);
    ring.rotation.x = Math.PI / 2;
    root.add(gem, ring);
  } else if (building.kind === 'ghost-net') {
    const reel = mesh(new THREE.TorusGeometry(0.24, 0.055, 8, 24), accent, [0, 0.55, 0]);
    reel.rotation.x = Math.PI / 2;
    root.add(reel);
    for (const angle of [-0.7, 0, 0.7]) {
      const strand = mesh(new THREE.BoxGeometry(0.045, 0.58, 0.045), accent, [Math.sin(angle) * 0.16, 0.55, 0]);
      strand.rotation.z = angle;
      root.add(strand);
    }
  } else if (building.kind === 'range-amplifier') {
    root.add(mesh(new THREE.BoxGeometry(0.1, 0.74, 0.1), accent, [0, 0.58, 0]));
    for (const radius of [0.18, 0.3]) {
      const signal = mesh(new THREE.TorusGeometry(radius, 0.035, 8, 26, Math.PI), accent, [0, 0.78, -0.03]);
      signal.rotation.z = Math.PI / 2;
      root.add(signal);
    }
  } else if (building.kind === 'starter-grave') {
    root.add(mesh(new THREE.BoxGeometry(0.48, 0.56, 0.18), accent, [0, 0.46, 0]));
    root.add(mesh(new THREE.SphereGeometry(0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent, [0, 0.74, 0]));
    root.add(mesh(new THREE.BoxGeometry(0.07, 0.3, 0.04), dark, [0, 0.58, -0.11]));
    root.add(mesh(new THREE.BoxGeometry(0.25, 0.07, 0.04), dark, [0, 0.63, -0.11]));
  } else {
    root.add(mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 20), accent, [0, 0.54, 0]));
  }
  return { root, barrel };
}

function applyDoorVisual(view: DoorView, level: number): void {
  const style = doorVisualForLevel(level);
  const panelMaterial = view.surface.material as THREE.MeshStandardMaterial;
  const frameMaterial = view.frame.material as THREE.MeshStandardMaterial;
  panelMaterial.color.setHex(style.panelColor);
  panelMaterial.emissive.setHex(style.emissiveColor);
  panelMaterial.emissiveIntensity = style.style === 'luminous-bars' || style.style === 'diamond-titanium' ? 1.05 : 0.5;
  panelMaterial.metalness = style.metalness;
  panelMaterial.roughness = style.roughness;
  frameMaterial.color.setHex(style.frameColor);
  frameMaterial.emissive.setHex(style.emissiveColor);
  frameMaterial.emissiveIntensity = style.style === 'diamond-titanium' ? 0.44 : 0.14;
  frameMaterial.metalness = Math.min(0.95, style.metalness + 0.08);
  frameMaterial.roughness = Math.min(0.9, style.roughness + 0.08);

  view.details.clear();
  const accent = standardMaterial(style.accentColor, {
    emissive: style.emissiveColor,
    emissiveIntensity: style.style === 'luminous-bars' || style.style === 'diamond-titanium' ? 1.3 : 0.34,
    metalness: Math.min(0.95, style.metalness + 0.08),
    roughness: Math.max(0.12, style.roughness - 0.1),
  });
  const dark = standardMaterial(style.frameColor, { metalness: 0.72, roughness: 0.42 });
  const add = (geometry: THREE.BufferGeometry, position: [number, number, number], material = accent, rotationY = 0): void => {
    const detail = mesh(geometry, material, position);
    detail.rotation.y = rotationY;
    view.details.add(detail);
  };
  const addRivets = (): void => {
    for (const x of [-0.3, 0.3]) for (const z of [-0.09, 0.09]) add(new THREE.SphereGeometry(0.035, 7, 5), [x, 0.055, z]);
  };

  switch (style.style) {
    case 'wood':
      for (const z of [-0.09, 0, 0.09]) add(new THREE.BoxGeometry(0.74, 0.025, 0.026), [0, 0.05, z]);
      add(new THREE.BoxGeometry(0.045, 0.026, 0.25), [0.26, 0.05, 0], dark);
      break;
    case 'rusted-steel':
      add(new THREE.BoxGeometry(0.7, 0.025, 0.04), [0, 0.05, -0.09]);
      add(new THREE.BoxGeometry(0.7, 0.025, 0.04), [0, 0.05, 0.09]);
      add(new THREE.BoxGeometry(0.055, 0.026, 0.25), [0, 0.05, 0], dark);
      addRivets();
      break;
    case 'weathered-steel':
      for (const x of [-0.24, 0, 0.24]) add(new THREE.BoxGeometry(0.045, 0.026, 0.245), [x, 0.05, 0]);
      add(new THREE.BoxGeometry(0.73, 0.025, 0.032), [0, 0.05, 0], dark);
      break;
    case 'red-steel':
      add(new THREE.BoxGeometry(0.72, 0.028, 0.04), [0, 0.05, -0.09], dark);
      add(new THREE.BoxGeometry(0.72, 0.028, 0.04), [0, 0.05, 0.09], dark);
      add(new THREE.BoxGeometry(0.05, 0.03, 0.25), [0, 0.05, 0]);
      addRivets();
      break;
    case 'iron-bars':
    case 'luminous-bars':
      for (const x of [-0.27, -0.09, 0.09, 0.27]) add(new THREE.BoxGeometry(0.045, 0.035, 0.27), [x, 0.06, 0]);
      add(new THREE.BoxGeometry(0.75, 0.03, 0.04), [0, 0.055, -0.1], dark);
      add(new THREE.BoxGeometry(0.75, 0.03, 0.04), [0, 0.055, 0.1], dark);
      break;
    case 'steel-titanium':
      add(new THREE.BoxGeometry(0.75, 0.026, 0.04), [0, 0.055, 0], dark, Math.PI / 6);
      add(new THREE.BoxGeometry(0.75, 0.026, 0.04), [0, 0.055, 0], dark, -Math.PI / 6);
      addRivets();
      break;
    case 'silver-titanium':
      add(new THREE.BoxGeometry(0.74, 0.026, 0.035), [0, 0.055, -0.085]);
      add(new THREE.BoxGeometry(0.74, 0.026, 0.035), [0, 0.055, 0.085]);
      add(new THREE.BoxGeometry(0.05, 0.028, 0.25), [0, 0.055, 0]);
      addRivets();
      break;
    case 'gold-titanium':
      add(new THREE.TorusGeometry(0.22, 0.032, 8, 22), [0, 0.06, 0]);
      add(new THREE.BoxGeometry(0.72, 0.026, 0.035), [0, 0.055, 0]);
      addRivets();
      break;
    case 'diamond-titanium':
      for (const x of [-0.24, 0, 0.24]) add(new THREE.OctahedronGeometry(0.11), [x, 0.075, 0]);
      add(new THREE.BoxGeometry(0.75, 0.026, 0.032), [0, 0.055, -0.1]);
      add(new THREE.BoxGeometry(0.75, 0.026, 0.032), [0, 0.055, 0.1]);
      break;
  }
  view.visualLevel = level;
}

export function createTurretPreviewModel(kind: TurretKind, skinId: string): THREE.Group {
  const model = createBuildingModel({
    id: `preview:${kind}`,
    kind,
    roomId: 'preview',
    ownerId: 'preview',
    skinId,
    tile: { x: 0, y: 0 },
    level: 1,
    cooldown: 0,
    hp: 100,
  });
  model.root.userData.previewKind = kind;
  model.root.userData.skinId = skinId;
  return model.root;
}

export class ThreeGameView {
  private readonly host: HTMLElement;
  private readonly mapData: MapDefinition;
  private readonly playerId: string;
  private readonly theme: StageTheme;
  private snapshotData: GameSnapshot;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly hudCanvas: HTMLCanvasElement;
  private readonly hudContext: CanvasRenderingContext2D;
  private readonly doorHudCanvas: HTMLCanvasElement;
  private readonly doorHudContext: CanvasRenderingContext2D;
  private readonly sleepButton: HTMLButtonElement;
  private readonly onSleep: () => void;
  private readonly onPickupLoot: (lootId: string) => void;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionSurface: THREE.Mesh;
  private readonly playerViews = new Map<string, PlayerView>();
  private readonly ghostViews = new Map<string, GhostView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly lootViews = new Map<string, LootView>();
  private readonly doorViews = new Map<string, DoorView>();
  private readonly bedViews = new Map<string, BedView>();
  private readonly effects: TimedEffect[] = [];
  private readonly hudMessages: HudMessage[] = [];
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private tutorialCameraFocus: Vec2 | null = null;
  private tutorialCameraDistanceScale: number | null = null;
  private readonly blackoutProjectionA = new THREE.Vector3();
  private readonly blackoutProjectionB = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly blackoutLayer: HTMLDivElement;
  private readonly blackoutSvg: SVGSVGElement;
  private readonly blackoutMaskBase: SVGRectElement;
  private readonly blackoutCover: SVGRectElement;
  private readonly blackoutMaskCircle: SVGCircleElement;
  private readonly blackoutLightMask: SVGGElement;
  private blackoutExtraLightCircles: SVGCircleElement[] = [];
  private readonly blackoutRoomMask: SVGGElement;
  private blackoutRoomRects: SVGRectElement[] = [];
  private blackoutRoomId: string | null = null;
  private readonly blackoutUiMask: SVGGElement;
  private blackoutUiRects: SVGRectElement[] = [];
  private readonly selectionMarker: THREE.Mesh;
  private readonly tutorialBedMarker: THREE.Group;
  private readonly tutorialBedMarkerLabel: THREE.Sprite;
  private readonly buildTileMarkers = new Map<string, THREE.Group>();
  private readonly baseRoomFloors = new Map<string, THREE.InstancedMesh>();
  private readonly roomTileSkinViews = new Map<string, RoomTileSkinView>();
  private readonly contaminationViews = new Map<string, THREE.Group>();
  private readonly environmentTextures = new Map<string, THREE.Texture>();
  private readonly prestigeTrailVideos = new Map<PrestigeMotionTheme, {
    video: HTMLVideoElement;
    texture: THREE.VideoTexture;
  }>();
  private readonly playerStateById = new Map<string, PlayerState>();
  private readonly ghostStateById = new Map<string, GhostState>();
  private readonly buildingStateById = new Map<string, BuildingState>();
  private readonly buildingsByOwner = new Map<string, BuildingState[]>();
  private readonly rangeBonusByOwner = new Map<string, number>();
  private readonly rewardEffectsByOwner = new Map<
    string,
    ReturnType<typeof combinedItemEffects>
  >();
  private readonly roomStateById = new Map<string, RoomState>();
  private readonly mapRoomById = new Map<string, MapDefinition['rooms'][number]>();
  private readonly roomExitBlockTiles = new Map<string, ReadonlySet<string>>();
  private readonly turretVisualProfiles = new Map<string, TurretVisualProfile>();
  private activeGhostStates: GhostState[] = [];
  private readonly normalProjectilePool: THREE.Mesh[] = [];
  private readonly waterProjectilePool: THREE.Group[] = [];
  private readonly waterSplashPool: THREE.Group[] = [];
  private readonly cyberLaserPool: THREE.Group[] = [];
  private readonly beamPool: THREE.Line[] = [];
  private readonly impactRingPool: THREE.Mesh[] = [];
  private readonly dustPool: THREE.Group[] = [];
  private readonly effectPoolCreated = new Map<string, number>();
  private readonly lastTurretVisualAt = new Map<string, number>();
  private activeBuildTileMarkers: THREE.Group[] = [];
  private lastBuildMarkerBuildings: GameSnapshot['buildings'] | null = null;
  private lastBuildMarkerRoomId: string | null = null;
  private lastSyncedBuildings: GameSnapshot['buildings'] | null = null;
  private lastIndexedBuildings: GameSnapshot['buildings'] | null = null;
  private visualProfileSignature = '';
  private roomSkinSyncInitialized = false;
  private readonly pointerPositions = new Map<number, { x: number; y: number }>();
  private localInput: Vec2 = { x: 0, y: 0 };
  private localInputSequence = 0;
  private readonly localInputHistory = new Map<number, Vec2>();
  private lastNonZeroLocalInput: Vec2 = { x: 0, y: 0 };
  private localInputReleaseSequence: number | null = null;
  private localInputReleaseAckTimeoutAt = 0;
  private drag: PointerDrag | null = null;
  private gesture: MultiTouchGesture | null = null;
  private portraitMovementDrag: PortraitMovementDrag | null = null;
  private buildingDragCandidate: BuildingDragCandidate | null = null;
  private buildingDrag: BuildingDrag | null = null;
  private buildingDragTimer: number | null = null;
  private followingPlayer = true;
  private focusedRoomId: string | null = null;
  // One zoom step closer than the historical default. The opening hunt starts
  // focused on the survivor and unlocks manual zoom only after claim/death.
  private cameraDistanceScale = DEFAULT_CAMERA_DISTANCE_SCALE;
  private portraitLayout = false;
  private lastFrame = performance.now();
  private lastSelectionAt = 0;
  private lastSelectionKey = '';
  private selectionBlockedUntil = 0;
  private paused = false;
  private destroyed = false;
  private nearbyLootId: string | null = null;
  private sleepRequestPending = false;
  private sleepRequestStartedAt = 0;
  private nextInteractionScanAt = 0;
  private renderPixelRatio = 1;
  private minRenderPixelRatio = 1;
  private maxRenderPixelRatio = 2;
  private frameTimeEma = 16.7;
  private nextQualitySampleAt = 0;
  private effectHeadroomSamples = 0;
  private effectQuality: EffectQuality = 'high';
  private moonLight: THREE.DirectionalLight | null = null;

  constructor(host: HTMLElement, payload: ViewPayload) {
    this.host = host;
    this.mapData = payload.map;
    this.playerId = payload.playerId;
    this.snapshotData = payload.snapshot;
    this.onSleep = payload.onSleep ?? (() => undefined);
    this.onPickupLoot = payload.onPickupLoot ?? (() => undefined);
    this.portraitLayout = host.clientHeight > host.clientWidth;
    for (const room of this.mapData.rooms) this.mapRoomById.set(room.id, room);
    this.theme = stageThemeFor(payload.snapshot.stageId);
    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.Fog(this.theme.fog, this.theme.fogNear, this.theme.fogFar);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    // 1.2x was being upscaled heavily on high-DPR Android screens, turning
    // tile textures and the building PNGs into a soft, low-resolution image.
    this.maxRenderPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    // Never lower the render resolution during combat. Temporary effects and
    // network work are bounded instead, so authored tile/building art remains
    // at the same physical resolution from match start to finish.
    this.minRenderPixelRatio = this.maxRenderPixelRatio;
    this.renderPixelRatio = this.maxRenderPixelRatio;
    this.renderer.setPixelRatio(this.renderPixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    const touchDevice =
      navigator.maxTouchPoints > 0 ||
      window.matchMedia?.('(pointer: coarse)').matches === true;
    // The game is a flat top-down scene with baked lighting in its authored
    // textures. A second shadow render pass costs heavily on mobile while
    // adding almost no readable depth.
    this.renderer.shadowMap.enabled = !touchDevice;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.dataset.renderer = 'orthographic-2d';
    this.renderer.domElement.dataset.actorRenderer = 'atlas-sprites';
    this.renderer.domElement.dataset.surfaceRenderer = 'image-textures';
    this.renderer.domElement.dataset.theme = this.theme.id;
    this.renderer.domElement.dataset.pixelRatio = this.renderPixelRatio.toFixed(2);
    this.renderer.domElement.dataset.shadows = this.renderer.shadowMap.enabled ? 'on' : 'off';
    this.renderer.domElement.style.touchAction = 'none';
    this.host.appendChild(this.renderer.domElement);
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.className = 'game-transient-hud';
    this.hudCanvas.setAttribute('aria-hidden', 'true');
    this.hudCanvas.style.position = 'absolute';
    this.hudCanvas.style.inset = '0';
    this.hudCanvas.style.width = '100%';
    this.hudCanvas.style.height = '100%';
    this.hudCanvas.style.pointerEvents = 'none';
    // Resource/level HUD is a semantic overlay, not scenery. It is placed
    // above the blackout and filtered below by the same fog visibility rules.
    this.hudCanvas.style.zIndex = '6';
    const hudContext = this.hudCanvas.getContext('2d');
    if (!hudContext) throw new Error('Canvas 2D context is unavailable');
    this.hudContext = hudContext;
    this.host.appendChild(this.hudCanvas);
    this.doorHudCanvas = document.createElement('canvas');
    this.doorHudCanvas.className = 'game-door-hud';
    this.doorHudCanvas.setAttribute('aria-hidden', 'true');
    this.doorHudCanvas.style.position = 'absolute';
    this.doorHudCanvas.style.inset = '0';
    this.doorHudCanvas.style.width = '100%';
    this.doorHudCanvas.style.height = '100%';
    this.doorHudCanvas.style.pointerEvents = 'none';
    // Door information must stay above buildings while following the camera
    // every frame. Keeping it separate avoids repainting the heavier HUD layer.
    this.doorHudCanvas.style.zIndex = '7';
    const doorHudContext = this.doorHudCanvas.getContext('2d');
    if (!doorHudContext) throw new Error('Canvas 2D context is unavailable');
    this.doorHudContext = doorHudContext;
    this.host.appendChild(this.doorHudCanvas);
    const blackoutId = `game-blackout-${crypto.randomUUID().replaceAll('-', '')}`;
    this.blackoutLayer = document.createElement('div');
    this.blackoutLayer.className = 'game-blackout';
    this.blackoutLayer.setAttribute('aria-hidden', 'true');
    this.blackoutLayer.setAttribute('data-testid', 'game-blackout');
    this.blackoutLayer.innerHTML = `
      <svg aria-hidden="true" preserveAspectRatio="none">
        <defs>
          <radialGradient id="${blackoutId}-spot">
            <stop offset="0%" stop-color="#000"/>
            <stop offset="72%" stop-color="#000"/>
            <stop offset="90%" stop-color="#555"/>
            <stop offset="100%" stop-color="#fff"/>
          </radialGradient>
          <radialGradient id="${blackoutId}-cover" cx="50%" cy="46%" r="78%">
            <stop offset="0%" stop-color="#07101a"/>
            <stop offset="64%" stop-color="#02060d"/>
            <stop offset="100%" stop-color="#000105"/>
          </radialGradient>
          <mask id="${blackoutId}-mask" maskUnits="userSpaceOnUse" mask-type="luminance">
            <rect data-blackout-mask-base fill="#fff"/>
            <g data-blackout-light-mask>
              <circle data-blackout-mask-circle data-blackout-light-source fill="url(#${blackoutId}-spot)"/>
            </g>
            <g data-blackout-room-mask></g>
            <g data-blackout-ui-mask></g>
          </mask>
        </defs>
        <rect data-blackout-cover fill="url(#${blackoutId}-cover)" fill-opacity=".86" mask="url(#${blackoutId}-mask)"/>
      </svg>
      <div class="game-blackout-vignette"></div>
    `;
    const blackoutSvg = this.blackoutLayer.querySelector('svg');
    const blackoutMaskCircle = this.blackoutLayer.querySelector(
      '[data-blackout-mask-circle]',
    );
    const blackoutMaskBase = this.blackoutLayer.querySelector(
      '[data-blackout-mask-base]',
    );
    const blackoutCover = this.blackoutLayer.querySelector(
      '[data-blackout-cover]',
    );
    const blackoutLightMask = this.blackoutLayer.querySelector(
      '[data-blackout-light-mask]',
    );
    const blackoutRoomMask = this.blackoutLayer.querySelector(
      '[data-blackout-room-mask]',
    );
    const blackoutUiMask = this.blackoutLayer.querySelector(
      '[data-blackout-ui-mask]',
    );
    if (
      !(blackoutSvg instanceof SVGSVGElement) ||
      !(blackoutMaskBase instanceof SVGRectElement) ||
      !(blackoutCover instanceof SVGRectElement) ||
      !(blackoutMaskCircle instanceof SVGCircleElement) ||
      !(blackoutLightMask instanceof SVGGElement) ||
      !(blackoutRoomMask instanceof SVGGElement) ||
      !(blackoutUiMask instanceof SVGGElement)
    )
      throw new Error('Blackout mask could not be created');
    this.blackoutSvg = blackoutSvg;
    this.blackoutMaskBase = blackoutMaskBase;
    this.blackoutCover = blackoutCover;
    this.blackoutMaskCircle = blackoutMaskCircle;
    this.blackoutLightMask = blackoutLightMask;
    this.blackoutRoomMask = blackoutRoomMask;
    this.blackoutUiMask = blackoutUiMask;
    this.host.appendChild(this.blackoutLayer);
    this.sleepButton = document.createElement('button');
    this.sleepButton.type = 'button';
    this.sleepButton.className = 'sleep-nearby';
    this.sleepButton.innerHTML = '<span aria-hidden="true">☾</span> 잠자기';
    this.sleepButton.setAttribute('aria-label', '가까운 침대에서 잠자기');
    this.sleepButton.hidden = true;
    this.sleepButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.nearbyLootId) this.onPickupLoot(this.nearbyLootId);
      else {
        if (this.sleepRequestPending) return;
        // The movement canvas can still own the first touch while a second
        // finger presses the sleep button. Release that capture before the
        // authoritative stop + interact messages are sent, otherwise the
        // survivor can keep walking between the prompt snapshot and interact.
        this.cancelPortraitMovement(false);
        this.sleepRequestPending = true;
        this.sleepRequestStartedAt = performance.now();
        this.sleepButton.disabled = true;
        this.sleepButton.innerHTML = '<span aria-hidden="true">☾</span> 점유 중…';
        this.sleepButton.setAttribute('aria-label', '침대 점유 처리 중');
        this.onSleep();
      }
    });
    this.host.appendChild(this.sleepButton);

    const invisible = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
    this.selectionSurface = new THREE.Mesh(new THREE.PlaneGeometry(this.mapData.width, this.mapData.height), invisible);
    this.selectionSurface.rotation.x = -Math.PI / 2;
    this.selectionSurface.position.set((this.mapData.width - 1) / 2, 0.015, (this.mapData.height - 1) / 2);
    this.scene.add(this.selectionSurface);

    this.selectionMarker = mesh(
      new THREE.RingGeometry(0.39, 0.49, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd36f, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
    );
    this.selectionMarker.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
    this.selectionMarker.position.y = 0.06;
    this.selectionMarker.visible = false;
    this.selectionMarker.renderOrder = 9_000;
    this.scene.add(this.selectionMarker);

    this.tutorialBedMarker = new THREE.Group();
    const tutorialBedRing = mesh(
      new THREE.RingGeometry(0.32, 0.48, 32),
      new THREE.MeshBasicMaterial({
        color: 0x79e8ff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    tutorialBedRing.rotation.x = -Math.PI / 2;
    tutorialBedRing.renderOrder = 11_250;
    this.tutorialBedMarkerLabel = makeBillboard(256, 96);
    this.tutorialBedMarkerLabel.scale.set(1.38, 0.52, 1);
    this.tutorialBedMarkerLabel.position.set(0, 0.66, 0);
    this.tutorialBedMarkerLabel.renderOrder = 11_260;
    updateTextBillboard(
      this.tutorialBedMarkerLabel,
      "tutorial-bed-target",
      "안내 침대",
      "#dffcff",
      "rgba(4,20,35,.94)",
      null,
      false,
      42,
    );
    this.tutorialBedMarker.add(
      tutorialBedRing,
      this.tutorialBedMarkerLabel,
    );
    this.tutorialBedMarker.visible = false;
    this.scene.add(this.tutorialBedMarker);

    this.createLighting();
    this.createWorld();
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.updateSnapshot(payload.snapshot, []);
    const local = payload.snapshot.players.find((player) => player.id === this.playerId);
    const start = worldPoint(local?.position ?? payload.map.playerSpawn);
    this.cameraTarget.copy(start);
    this.desiredCameraTarget.copy(start);
    this.updateCamera(1);
    this.updateSleepPrompt();
    this.renderer.setAnimationLoop(this.animate);
  }

  setLocalInput(input: Vec2, inputSequence?: number): void {
    const isMoving = Math.hypot(input.x, input.y) > 0.001;
    if (isMoving) {
      this.lastNonZeroLocalInput = input;
      this.localInputReleaseSequence = null;
      this.localInputReleaseAckTimeoutAt = 0;
    }
    this.localInput = input;
    if (inputSequence !== undefined) {
      this.localInputSequence = Math.max(
        this.localInputSequence,
        inputSequence,
      );
      this.localInputHistory.set(inputSequence, { ...input });
      while (this.localInputHistory.size > 64) {
        const oldest = this.localInputHistory.keys().next().value;
        if (oldest === undefined) break;
        this.localInputHistory.delete(oldest);
      }
      // sendMovement() updates the visual input once before assigning the
      // packet sequence, so always record the sequenced zero as the release.
      if (!isMoving) {
        this.localInputReleaseSequence = inputSequence;
        this.localInputReleaseAckTimeoutAt =
          performance.now() + LOCAL_INPUT_RELEASE_ACK_TIMEOUT_MS;
      }
    }
  }

  getCameraMode(): 'follow' | 'free' { return this.followingPlayer ? 'follow' : 'free'; }

  getCameraZoom(): number { return Math.round((1 / this.cameraDistanceScale) * 100) / 100; }

  isCameraZoomLocked(): boolean {
    return cameraZoomLockedForSnapshot(this.snapshotData, this.playerId);
  }

  getPerformanceStats(): GamePerformanceStats {
    let roomSkinDrawables = 0;
    for (const view of this.roomTileSkinViews.values()) {
      roomSkinDrawables += view.complete ? 1 : view.tiles.length;
    }
    return {
      pixelRatio: this.renderPixelRatio,
      minimumPixelRatio: this.minRenderPixelRatio,
      frameMs: this.frameTimeEma,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      transientEffects: this.effects.length,
      hudMessages: this.hudMessages.length,
      cachedBuildingTextures: buildingTextureCache.size,
      effectQuality: this.effectQuality,
      roomSkinDrawables,
      buildingViews: this.buildingViews.size,
    };
  }

  /**
   * Injects a disconnected, visual-only worst-case scene for browser
   * automation. This never runs in ordinary play and deliberately uses the
   * authored full-resolution turret skins so performance tests catch render
   * regressions without lowering image quality.
   */
  injectVisualStressScenario(): number {
    const local =
      this.snapshotData.players.find((player) => player.id === this.playerId) ??
      this.snapshotData.players[0];
    if (!local) return 0;
    const skins = [
      SURFER_WATER_TURRET_SKIN_ID,
      LIFEGUARD_PARASOL_TURRET_SKIN_ID,
      CYBERPUNK_LASER_TURRET_SKIN_ID,
      SPECIAL_OPS_TRACKER_TURRET_SKIN_ID,
      MOONLIT_FOXFIRE_TURRET_SKIN_ID,
    ];
    const buildings: BuildingState[] = this.mapData.rooms
      .flatMap((room) =>
        room.buildTiles.map((tile) => ({ roomId: room.id, tile })),
      )
      .slice(0, 96)
      .map(({ roomId, tile }, index) => ({
        id: `visual-stress-${index}`,
        kind: 'basic-turret',
        roomId,
        ownerId: local.id,
        skinId: skins[index % skins.length] as string,
        tile: { ...tile },
        level: 15,
        effectiveLevel: 15,
        cooldown: 0,
        hp: 100,
      }));
    const target =
      this.snapshotData.ghosts[0]?.position ??
      this.snapshotData.ghost.position ??
      this.mapData.ghostSpawn;
    const events: GameEvent[] = buildings.slice(0, MAX_TRANSIENT_EFFECTS).map(
      (building) => ({
        kind: 'turret-fire',
        sourceId: building.id,
        sourcePosition: { ...building.tile },
        position: { ...building.tile },
        targetPosition: { ...target },
        buildingKind: 'basic-turret',
      }),
    );
    this.updateSnapshot(
      {
        ...this.snapshotData,
        buildings,
      },
      events,
    );
    return buildings.length;
  }

  /** 수직 2D 카메라는 북쪽 고정이며 테스트 API에는 0으로 노출한다. */
  getCameraYaw(): number { return 0; }

  getLocalRenderedPosition(): Vec2 | null {
    const position = this.playerViews.get(this.playerId)?.root.position;
    return position ? { x: position.x, y: position.z } : null;
  }

  focusLocalPlayer(): void {
    this.focusPlayer(this.playerId);
  }

  focusPlayer(playerId: string): void {
    if (this.snapshotData.tutorial?.active) return;
    const view = this.playerViews.get(playerId);
    if (!view) return;

    // 침대를 점유한 뒤에는 동료 초상화로 카메라를 자유롭게 옮길 수 있다.
    // 점유 전에는 기존 규칙대로 내 캐릭터 추적을 유지한다.
    const localPlayer = this.snapshotData?.players.find((player) => player.id === this.playerId);
    if (playerId !== this.playerId && localPlayer?.roomId) {
      this.followingPlayer = false;
    }
    this.desiredCameraTarget.set(view.root.position.x, 0, view.root.position.z);
  }

  suppressSelections(milliseconds = 650): void {
    const duration = Math.max(0, milliseconds);
    this.selectionBlockedUntil = Math.max(
      this.selectionBlockedUntil,
      performance.now() + duration,
    );
    this.lastSelectionAt = performance.now();
    this.lastSelectionKey = '';
  }

  resetTransientInteraction(): void {
    this.cancelBuildingDrag();
    this.cancelPortraitMovement(false);
    this.resetSleepInteraction();
    this.selectionMarker.visible = false;
    this.nearbyLootId = null;
    this.suppressSelections(450);
  }

  resetSleepInteraction(): void {
    this.sleepRequestPending = false;
    this.sleepRequestStartedAt = 0;
    this.sleepButton.disabled = false;
    this.nextInteractionScanAt = 0;
    this.updateSleepPrompt(true);
  }

  zoomBy(magnificationFactor: number): void {
    if (this.isCameraZoomLocked()) return;
    if (!Number.isFinite(magnificationFactor) || magnificationFactor <= 0) return;
    this.cameraDistanceScale = clamp(
      this.cameraDistanceScale / magnificationFactor,
      MIN_CAMERA_DISTANCE_SCALE,
      MAX_CAMERA_DISTANCE_SCALE,
    );
    this.updateCameraProjection();
  }

  pause(): void {
    this.paused = true;
    this.renderer.setAnimationLoop(null);
  }

  resume(): void {
    if (this.destroyed || !this.paused) return;
    this.paused = false;
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(this.animate);
  }

  updateSnapshot(snapshot: GameSnapshot, events: GameEvent[]): void {
    this.snapshotData = snapshot;
    this.rebuildSnapshotIndexes(snapshot);
    this.syncPlayers(snapshot.players);
    this.syncGhosts(snapshot.ghosts ?? [snapshot.ghost]);
    this.syncContamination(snapshot.ghosts ?? [snapshot.ghost]);
    this.syncBeds(snapshot);
    this.syncTutorialGuide(snapshot);
    this.syncBuildings(snapshot);
    this.syncLootDrops(snapshot);
    this.syncDoors(snapshot);
    this.syncRoomTileSkins(snapshot);
    this.refreshBuildableTiles();
    for (const event of events) this.playEvent(event);

    const local = snapshot.players.find((player) => player.id === this.playerId);
    if (!local?.alive) {
      this.cancelPortraitMovement(false);
      this.sleepRequestPending = false;
      this.sleepRequestStartedAt = 0;
      // 사망 뒤에는 관전 상태이므로 마지막 위치에 카메라를 고정하지 않는다.
      this.followingPlayer = false;
      this.focusedRoomId = null;
    } else if (!local.roomId) {
      this.followingPlayer = true;
      this.focusedRoomId = null;
    } else if (local.roomId) {
      this.cancelPortraitMovement(false);
      this.sleepRequestPending = false;
      this.sleepRequestStartedAt = 0;
      this.sleepButton.disabled = false;
      const roomChanged = this.focusedRoomId !== local.roomId;
      this.followingPlayer = false;
      if (roomChanged) {
        this.desiredCameraTarget.copy(worldPoint(local.position));
        this.cameraTarget.copy(this.desiredCameraTarget);
      }
      this.focusedRoomId = local.roomId;
    }
    this.updateBlackoutMask();
    this.updateSleepPrompt(true);
  }

  private rebuildSnapshotIndexes(snapshot: GameSnapshot): void {
    this.playerStateById.clear();
    for (const player of snapshot.players) this.playerStateById.set(player.id, player);
    this.ghostStateById.clear();
    this.activeGhostStates = [];
    for (const ghost of snapshot.ghosts ?? [snapshot.ghost]) {
      this.ghostStateById.set(ghost.id, ghost);
      if (ghost.hp > 0 && !ghost.healing) this.activeGhostStates.push(ghost);
    }
    const buildingsChanged = this.lastIndexedBuildings !== snapshot.buildings;
    if (buildingsChanged) {
      this.lastIndexedBuildings = snapshot.buildings;
      this.buildingStateById.clear();
      this.buildingsByOwner.clear();
      this.rangeBonusByOwner.clear();
      for (const building of snapshot.buildings) {
        this.buildingStateById.set(building.id, building);
        const owned = this.buildingsByOwner.get(building.ownerId);
        if (owned) owned.push(building);
        else this.buildingsByOwner.set(building.ownerId, [building]);
        if (building.kind === 'range-amplifier') {
          this.rangeBonusByOwner.set(
            building.ownerId,
            Math.max(
              this.rangeBonusByOwner.get(building.ownerId) ?? 0,
              building.level,
            ),
          );
        }
      }
    }
    this.roomStateById.clear();
    for (const room of snapshot.rooms) this.roomStateById.set(room.id, room);

    const profileSignature = snapshot.players
      .map((player) =>
        `${player.id}:${JSON.stringify(player.appearance)}:${JSON.stringify(player.items)}`,
      )
      .join('|');
    if (buildingsChanged || profileSignature !== this.visualProfileSignature) {
      this.visualProfileSignature = profileSignature;
      this.rewardEffectsByOwner.clear();
      for (const player of snapshot.players) {
        const placedRewards = (this.buildingsByOwner.get(player.id) ?? [])
          .filter(
            (building) =>
              building.kind === 'random-item' && building.itemId,
          )
          .map((building) => ({
            itemId: building.itemId as string,
            count: 1,
          }));
        this.rewardEffectsByOwner.set(
          player.id,
          combinedItemEffects([...player.items, ...placedRewards]),
        );
      }
      this.turretVisualProfiles.clear();
      for (const building of snapshot.buildings) {
        if (
          building.kind !== 'basic-turret' &&
          building.kind !== 'golden-turret'
        )
          continue;
        const owner = this.playerStateById.get(building.ownerId);
        const rewardEffects = this.rewardEffectsByOwner.get(building.ownerId);
        const range =
          buildingStats(
            building.kind,
            building.effectiveLevel ?? building.level,
          ).range +
          (owner
            ? characterTraitForMatch(owner.appearance, Boolean(snapshot.ranked)).turretRangeBonus
            : 0) +
          (rewardEffects?.turretRangeBonus ?? 0) +
          (this.rangeBonusByOwner.get(building.ownerId) ?? 0);
        this.turretVisualProfiles.set(building.id, {
          building,
          range,
          door: this.mapRoomById.get(building.roomId)?.door,
        });
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.cancelBuildingDrag();
    this.unbindInput();
    for (const view of this.playerViews.values()) {
      view.actor.dispose();
      for (const trail of view.prestigeTrail) disposeTransientObject(trail.effect);
    }
    for (const view of this.ghostViews.values()) view.actor.dispose();
    this.playerViews.clear();
    this.ghostViews.clear();
    for (const view of this.buildingViews.values()) {
      this.scene.remove(view.root);
      disposeBuildingRoot(view.root);
    }
    this.buildingViews.clear();
    for (const pool of [
      this.normalProjectilePool,
      this.waterProjectilePool,
      this.waterSplashPool,
      this.cyberLaserPool,
      this.beamPool,
      this.impactRingPool,
      this.dustPool,
    ])
      for (const object of pool) disposeTransientObject(object);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
          material.dispose();
        }
      }
    });
    for (const texture of this.environmentTextures.values()) texture.dispose();
    this.environmentTextures.clear();
    for (const { video, texture } of this.prestigeTrailVideos.values()) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      texture.dispose();
    }
    this.prestigeTrailVideos.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hudCanvas.remove();
    this.doorHudCanvas.remove();
    this.blackoutLayer.remove();
    this.sleepButton.remove();
  }

  private readonly animate = (time: number): void => {
    if (this.destroyed || this.paused) return;
    const rawFrameMs = Math.max(1, time - this.lastFrame);
    const dt = Math.min(FRAME_DT_MAX, Math.max(0.001, rawFrameMs / 1_000));
    this.lastFrame = time;
    this.animatePlayers(time, dt);
    this.animateGhosts(time, dt);
    this.animateLoot();
    this.animateTurrets(dt);
    this.animateDoors(dt);
    this.animateBuildings(time);
    this.animateAmbient(time);
    this.animateEffects(time);
    this.animateRoomTileSkins(time);
    this.animateBuildableTiles(time);
    this.animateTutorialBedMarker(time);
    this.updateCamera(dt);
    this.updateBlackoutMask();
    this.updateSleepPrompt();
    this.renderer.render(this.scene, this.camera);
    this.renderHudMessages(time);
    this.renderDoorOverlay();
    this.updateAdaptiveRendering(time, rawFrameMs);
  };

  private updateAdaptiveRendering(time: number, frameMs: number): void {
    this.frameTimeEma += (frameMs - this.frameTimeEma) * 0.08;
    if (time < this.nextQualitySampleAt) return;
    this.nextQualitySampleAt = time + QUALITY_SAMPLE_INTERVAL_MS;
    this.renderer.domElement.dataset.frameMs = this.frameTimeEma.toFixed(1);
    this.renderer.domElement.dataset.drawCalls = String(this.renderer.info.render.calls);
    this.renderer.domElement.dataset.effects = String(this.effects.length);

    if (this.frameTimeEma > 25) {
      this.effectQuality = 'low';
      this.effectHeadroomSamples = 0;
    } else if (this.frameTimeEma > 18.5) {
      this.effectQuality = 'balanced';
      this.effectHeadroomSamples = 0;
    } else if (this.frameTimeEma < 16.5) {
      this.effectHeadroomSamples += 1;
      if (this.effectHeadroomSamples >= 3) {
        this.effectQuality = 'high';
        this.effectHeadroomSamples = 0;
      }
    } else {
      this.effectHeadroomSamples = 0;
    }
    this.renderer.domElement.dataset.effectQuality = this.effectQuality;
  }

  private updateSleepPrompt(force = false): void {
    const now = performance.now();
    if (!force && now < this.nextInteractionScanAt) return;
    this.nextInteractionScanAt = now + INTERACTION_SCAN_INTERVAL_MS;
    const local = this.playerStateById.get(this.playerId);
    if (
      !local?.alive ||
      local.roomId ||
      (this.snapshotData.status !== 'COUNTDOWN' && this.snapshotData.status !== 'PLAYING')
    ) {
      this.nearbyLootId = null;
      this.sleepButton.hidden = true;
      return;
    }
    if (this.sleepRequestPending) {
      if (now - this.sleepRequestStartedAt < 1_800) {
        this.nearbyLootId = null;
        this.sleepButton.disabled = true;
        this.sleepButton.innerHTML = '<span aria-hidden="true">☾</span> 점유 중…';
        this.sleepButton.setAttribute('aria-label', '침대 점유 처리 중');
        this.sleepButton.hidden = false;
        return;
      }
      // A rejected/lost request must not leave the only interaction control
      // permanently disabled. Server errors also clear this immediately.
      this.sleepRequestPending = false;
      this.sleepRequestStartedAt = 0;
    }
    this.sleepButton.disabled = false;
    const clock = this.snapshotData.status === 'COUNTDOWN'
      ? Math.max(0, BALANCE.countdownSeconds - this.snapshotData.countdown)
      : BALANCE.countdownSeconds + this.snapshotData.elapsed;
    const nearbyLoot = !local.carriedLootId
      ? this.snapshotData.lootDrops
          .filter((drop) => !drop.carriedBy && clock >= drop.landsAt)
          .map((drop) => ({
            drop,
            distance: Math.hypot(drop.tile.x - local.position.x, drop.tile.y - local.position.y),
          }))
          .filter((candidate) => candidate.distance <= BALANCE.player.interactionRange)
          .sort((left, right) => left.distance - right.distance)[0]
      : undefined;
    if (nearbyLoot) {
      const item = getRandomItem(nearbyLoot.drop.itemId);
      this.nearbyLootId = nearbyLoot.drop.id;
      this.sleepButton.innerHTML = '<span aria-hidden="true">✦</span> 줍기';
      this.sleepButton.setAttribute('aria-label', `${item?.label ?? '랜덤 보상'} 줍기`);
      this.positionInteractionButton(nearbyLoot.drop.tile);
      this.sleepButton.hidden = false;
      return;
    }
    this.nearbyLootId = null;
    const roomCapacity = this.snapshotData.playMode === 'multiplayer' ? 2 : 1;
    const nearest = this.mapData.rooms
      .flatMap((mapRoom) => {
        const room = this.roomStateById.get(mapRoom.id);
        if (!room || room.ownerIds.length >= roomCapacity) return [];
        return mapRoom.beds
          .map((bed, bedIndex) => ({ bed, bedIndex, room, mapRoom }))
          .filter(({ bedIndex, room }) =>
            !room.ownerIds.some((ownerId) =>
              this.playerStateById.get(ownerId)?.bedIndex === bedIndex,
            ),
          );
      })
      .map((candidate) => ({
        ...candidate,
        distance: Math.hypot(
          candidate.bed.x - local.position.x,
          candidate.bed.y - local.position.y,
        ),
      }))
      .filter((candidate) =>
        candidate.distance <= BALANCE.player.interactionRange &&
        isPositionOnRoomFloor(candidate.mapRoom, local.position),
      )
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) {
      this.sleepButton.hidden = true;
      return;
    }
    this.sleepButton.innerHTML = '<span aria-hidden="true">☾</span> 잠자기';
    this.sleepButton.setAttribute('aria-label', '가까운 침대에서 잠자기');
    this.positionInteractionButton(nearest.bed);
    this.sleepButton.hidden = false;
  }

  private positionInteractionButton(tile: Vec2): void {
    const screen = worldPoint(tile, 0.35).project(this.camera);
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const x = (screen.x * 0.5 + 0.5) * width;
    const y = (-screen.y * 0.5 + 0.5) * height;
    this.sleepButton.style.left = `${clamp(x + 52, 64, width - 64)}px`;
    this.sleepButton.style.top = `${clamp(y - 24, 76, height - 58)}px`;
  }

  private syncLootDrops(snapshot: GameSnapshot): void {
    const active = new Set(snapshot.lootDrops.map((drop) => drop.id));
    for (const drop of snapshot.lootDrops) {
      let view = this.lootViews.get(drop.id);
      if (view && view.itemId !== drop.itemId) {
        this.scene.remove(view.root);
        this.lootViews.delete(drop.id);
        view = undefined;
      }
      if (!view) {
        const model = createBuildingModel({
          id: `drop:${drop.id}`,
          kind: 'random-item',
          itemId: drop.itemId,
          roomId: '',
          ownerId: '',
          skinId: '',
          tile: drop.tile,
          level: 1,
          cooldown: 0,
          hp: 100,
        });
        model.root.scale.setScalar(0.78);
        model.root.renderOrder = 5_250;
        this.scene.add(model.root);
        view = { root: model.root, itemId: drop.itemId };
        this.lootViews.set(drop.id, view);
      }
    }
    for (const [id, view] of this.lootViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      this.lootViews.delete(id);
    }
    this.animateLoot();
  }

  private animateLoot(): void {
    const clock = this.snapshotData.status === 'COUNTDOWN'
      ? Math.max(0, BALANCE.countdownSeconds - this.snapshotData.countdown)
      : BALANCE.countdownSeconds + this.snapshotData.elapsed;
    for (const drop of this.snapshotData.lootDrops) {
      const view = this.lootViews.get(drop.id);
      if (!view) continue;
      const carrier = drop.carriedBy ? this.playerViews.get(drop.carriedBy) : undefined;
      if (carrier) {
        view.root.position.set(carrier.root.position.x, PLAYER_HEIGHT + 0.68, carrier.root.position.z);
        view.root.rotation.y += 0.02;
        continue;
      }
      const progress = clamp((clock - drop.spawnedAt) / Math.max(0.1, drop.landsAt - drop.spawnedAt), 0, 1);
      // Three full seconds make the preparation rewards visibly fall from
      // above instead of appearing as a nearly instantaneous pop-in.
      const eased = 1 - (1 - progress) * (1 - progress);
      view.root.position.set(drop.tile.x, 0.1 + (1 - eased) * 5.8, drop.tile.y);
      view.root.rotation.y += 0.012 + (1 - progress) * 0.045;
    }
  }

  private createLighting(): void {
    this.scene.add(new THREE.HemisphereLight(this.theme.hemisphereSky, this.theme.hemisphereGround, 2.05));
    const moon = new THREE.DirectionalLight(this.theme.moon, 3.65);
    this.moonLight = moon;
    moon.position.set(12, 18, 9);
    moon.castShadow = true;
    moon.shadow.mapSize.set(512, 512);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 45;
    moon.shadow.camera.left = -14;
    moon.shadow.camera.right = 14;
    moon.shadow.camera.top = 14;
    moon.shadow.camera.bottom = -14;
    this.scene.add(moon);
    const lightTiles = this.mapData.corridorTiles.filter((_, index) => index % Math.max(1, Math.floor(this.mapData.corridorTiles.length / 12)) === 0).slice(0, 12);
    lightTiles.forEach((tile, index) => {
      const light = new THREE.PointLight(index % 2 === 0 ? this.theme.lightA : this.theme.lightB, 4.8, 9, 1.8);
      light.position.set(tile.x, 2.2, tile.y);
      this.scene.add(light);
    });
  }

  private createWorld(): void {
    const corridorKeys = new Set(this.mapData.corridorTiles.map((tile) => `${tile.x},${tile.y}`));
    const corridorTiles = this.mapData.corridorTiles;
    const roomTiles = this.mapData.walkable.filter((tile) => !corridorKeys.has(`${tile.x},${tile.y}`));
    const corridorTexture = this.loadEnvironmentTexture(this.theme.corridorAsset);
    const roomTexture = this.loadEnvironmentTexture(this.theme.roomAsset);
    const wallTexture = this.loadEnvironmentTexture(this.theme.wallAsset);
    this.addTileInstances(corridorTiles, corridorTexture, 0);
    const assignedRoomTileKeys = new Set(
      this.mapData.rooms.flatMap((room) =>
        room.floorTiles.map((tile) => `${tile.x},${tile.y}`),
      ),
    );
    const unassignedRoomTiles = roomTiles.filter(
      (tile) => !assignedRoomTileKeys.has(`${tile.x},${tile.y}`),
    );
    if (unassignedRoomTiles.length > 0) {
      this.addTileInstances(unassignedRoomTiles, roomTexture, ROOM_FLOOR_OFFSET_Y);
    }
    for (const room of this.mapData.rooms) {
      if (room.floorTiles.length === 0) continue;
      this.baseRoomFloors.set(
        room.id,
        this.addTileInstances(room.floorTiles, roomTexture, ROOM_FLOOR_OFFSET_Y),
      );
    }

    const buildTiles = this.mapData.rooms.flatMap((room) => room.buildTiles);
    const horizontalPlusGeometry = new THREE.BoxGeometry(0.18, 0.022, 0.042);
    const verticalPlusGeometry = new THREE.BoxGeometry(0.042, 0.022, 0.18);
    const plusColor = new THREE.Color(this.theme.marker).lerp(new THREE.Color(0xffffff), 0.3);
    const plusMaterial = standardMaterial(plusColor, {
      emissive: plusColor,
      emissiveIntensity: 0.16,
      roughness: 0.42,
      metalness: 0.08,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    for (const tile of buildTiles) {
      const marker = new THREE.Group();
      const horizontal = new THREE.Mesh(horizontalPlusGeometry, plusMaterial);
      const vertical = new THREE.Mesh(verticalPlusGeometry, plusMaterial);
      horizontal.castShadow = true;
      vertical.castShadow = true;
      horizontal.renderOrder = 2_200;
      vertical.renderOrder = 2_200;
      marker.add(horizontal, vertical);
      marker.position.set(tile.x, 0.095, tile.y);
      marker.visible = false;
      marker.userData.plusMaterial = plusMaterial;
      this.buildTileMarkers.set(`${tile.x},${tile.y}`, marker);
      this.scene.add(marker);
    }
    const matrix = new THREE.Matrix4();

    // Walls use a dedicated raised-block texture. A basic material avoids
    // device-specific lighting precision turning the top face black.
    const wallGeometry = new THREE.BoxGeometry(0.98, 0.58, 0.98);
    const wallMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: wallTexture,
      fog: true,
    });
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, this.mapData.walls.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.mapData.walls.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 0.29, tile.y);
      walls.setMatrixAt(index, matrix);
    });
    this.scene.add(walls);

    for (const zone of this.mapData.respawnZones) {
      const respawn = mesh(
        new THREE.PlaneGeometry(zone.width - 0.2, zone.height - 0.2),
        new THREE.MeshBasicMaterial({ color: this.theme.respawn, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
        [zone.x + (zone.width - 1) / 2, 0.04, zone.y + (zone.height - 1) / 2],
      );
      respawn.rotation.x = -Math.PI / 2;
      this.scene.add(respawn);
    }

    for (const room of this.mapData.rooms) this.createRoomFurniture(room.id);
    this.createThemeDecorations();
  }

  private disposeRoomTileSkinView(view: RoomTileSkinView): void {
    this.scene.remove(view.root);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    view.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of objectMaterials) materials.add(material);
    });
    // Environment textures are cached per URL for the lifetime of this view.
    // Dispose only per-room geometry/material state here.
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  private syncRoomTileSkins(snapshot: GameSnapshot): void {
    const now = performance.now();
    const activeRoomIds = new Set<string>();
    for (const room of snapshot.rooms) {
      const textureUrl = tileSkinTextureUrl(room.tileSkinId);
      if (!textureUrl) {
        const previous = this.roomTileSkinViews.get(room.id);
        if (previous) {
          previous.baseFloor.visible = true;
          this.disposeRoomTileSkinView(previous);
          this.roomTileSkinViews.delete(room.id);
        }
        continue;
      }
      activeRoomIds.add(room.id);
      const previous = this.roomTileSkinViews.get(room.id);
      if (previous?.skinId === room.tileSkinId) continue;
      if (previous) {
        previous.baseFloor.visible = true;
        this.disposeRoomTileSkinView(previous);
        this.roomTileSkinViews.delete(room.id);
      }
      const mapRoom = this.mapData.rooms.find((candidate) => candidate.id === room.id);
      const baseFloor = this.baseRoomFloors.get(room.id);
      if (!mapRoom?.floorTiles.length || !baseFloor) continue;
      // A room skin replaces the authored room floor. It must not be an
      // elevated overlay because that hides build markers and building art.
      baseFloor.visible = false;
      const texture = this.loadEnvironmentTexture(textureUrl);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: texture,
        fog: true,
      });
      const geometry = new THREE.BoxGeometry(0.98, FLOOR_TILE_HEIGHT, 0.98);
      const minX = Math.min(...mapRoom.floorTiles.map((tile) => tile.x));
      const maxX = Math.max(...mapRoom.floorTiles.map((tile) => tile.x));
      const minY = Math.min(...mapRoom.floorTiles.map((tile) => tile.y));
      const maxY = Math.max(...mapRoom.floorTiles.map((tile) => tile.y));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const transition =
        room.tileSkinId === BEACH_SAND_TILE_SKIN_ID
          ? 'sand-vortex'
          : room.tileSkinId === CYBERPUNK_NEON_TILE_SKIN_ID
            ? 'neon-collapse'
            : room.tileSkinId === SPECIAL_OPS_HEADQUARTERS_TILE_SKIN_ID
              ? 'investigation-scan'
              : room.tileSkinId === MOONLIT_PHANTOM_TILE_SKIN_ID
                ? 'moonfire'
            : 'wave';
      const root = new THREE.Group();
      root.name = `room-tile-skin:${room.id}:${room.tileSkinId}`;
      const settledFloor = new THREE.InstancedMesh(
        geometry,
        material,
        mapRoom.floorTiles.length,
      );
      settledFloor.name = `room-tile-skin-settled:${room.id}`;
      settledFloor.castShadow = false;
      settledFloor.receiveShadow = false;
      settledFloor.visible = false;
      const settledMatrix = new THREE.Matrix4();
      mapRoom.floorTiles.forEach((tile, index) => {
        settledMatrix.makeTranslation(tile.x, ROOM_FLOOR_CENTER_Y, tile.y);
        settledFloor.setMatrixAt(index, settledMatrix);
      });
      settledFloor.instanceMatrix.needsUpdate = true;
      root.add(settledFloor);
      const prestigeRoomTheme = room.tileSkinId === MOONLIT_PHANTOM_TILE_SKIN_ID
        ? { key: 'moonfire', wall: '/assets/prestige/moonlit-phantom-fox/room-theme/moonfire-wall.webp', ornament: '/assets/prestige/moonlit-phantom-fox/room-theme/moonfire-ornament.webp' }
        : room.tileSkinId === STARLIT_CLOUD_RABBIT_TILE_ID
          ? { key: 'starlit', wall: '/assets/prestige/starlit-cloud-rabbit/room-theme/starlit-wall.webp', ornament: '/assets/prestige/starlit-cloud-rabbit/room-theme/starlit-ornament.webp' }
          : room.tileSkinId === ABYSSAL_KNIGHT_GORILLA_TILE_ID
            ? { key: 'abyssal', wall: '/assets/prestige/abyssal-knight-gorilla/room-theme/abyssal-wall.webp', ornament: '/assets/prestige/abyssal-knight-gorilla/room-theme/abyssal-ornament.webp' }
            : null;
      let themedWalls: THREE.InstancedMesh | undefined;
      let wallDecorations: THREE.Group | undefined;
      if (prestigeRoomTheme) {
        const roomFloorKeys = new Set(
          mapRoom.floorTiles.map((tile) => `${tile.x},${tile.y}`),
        );
        const themedWallTiles = this.mapData.walls.filter((wall) =>
          [
            `${wall.x - 1},${wall.y}`,
            `${wall.x + 1},${wall.y}`,
            `${wall.x},${wall.y - 1}`,
            `${wall.x},${wall.y + 1}`,
          ].some((key) => roomFloorKeys.has(key)),
        );
        if (themedWallTiles.length > 0) {
          // The wall texture is 512px and shared by every room.  Instancing
          // keeps a prestige room at one extra draw call rather than one per
          // wall, even on a fully occupied multiplayer map.
          themedWalls = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.982, 0.604, 0.982),
            new THREE.MeshBasicMaterial({
              color: 0xffffff,
              map: this.loadEnvironmentTexture(prestigeRoomTheme.wall),
              fog: true,
            }),
            themedWallTiles.length,
          );
          themedWalls.name = `room-${prestigeRoomTheme.key}-walls:${room.id}`;
          themedWalls.castShadow = true;
          themedWalls.receiveShadow = true;
          const wallMatrix = new THREE.Matrix4();
          themedWallTiles.forEach((wall, index) => {
            wallMatrix.makeTranslation(wall.x, 0.305, wall.y);
            themedWalls?.setMatrixAt(index, wallMatrix);
          });
          themedWalls.instanceMatrix.needsUpdate = true;
          root.add(themedWalls);

          // Authored ornament images replace the old procedural cones.  Four
          // capped planes keep the premium room readable without adding a
          // particle system or per-frame texture allocation.
          wallDecorations = new THREE.Group();
          wallDecorations.name = `room-${prestigeRoomTheme.key}-decorations:${room.id}`;
          const ornamentTexture = this.loadEnvironmentTexture(prestigeRoomTheme.ornament);
          const stride = Math.max(1, Math.floor(themedWallTiles.length / 4));
          themedWallTiles
            .filter((_, index) => index % stride === 0)
            .slice(0, 4)
            .forEach((wall, index) => {
              const ornament = new THREE.Mesh(
                new THREE.PlaneGeometry(0.72, 0.72),
                new THREE.MeshBasicMaterial({
                  map: ornamentTexture,
                  transparent: true,
                  alphaTest: 0.035,
                  depthWrite: false,
                  side: THREE.DoubleSide,
                }),
              );
              ornament.name = 'prestige-wall-ornament';
              ornament.rotation.x = -Math.PI / 2;
              ornament.rotation.z = index % 2 === 0 ? 0 : Math.PI;
              ornament.position.set(wall.x, 0.625, wall.y);
              ornament.renderOrder = 7;
              wallDecorations?.add(ornament);
            });
          root.add(wallDecorations);
        }
      }
      if (room.tileSkinId === MOONLIT_PHANTOM_TILE_SKIN_ID) {
        const ownTiles = new Set(mapRoom.floorTiles.map((tile) => `${tile.x},${tile.y}`));
        const otherRoomTiles = this.mapData.rooms
          .filter((candidate) => candidate.id !== room.id)
          .flatMap((candidate) => candidate.floorTiles);
        const haloTiles = this.mapData.walkable.filter((tile) => {
          if (ownTiles.has(`${tile.x},${tile.y}`)) return false;
          const nearOwnRoom = mapRoom.floorTiles.some((floor) =>
            Math.max(Math.abs(floor.x - tile.x), Math.abs(floor.y - tile.y)) <= 2,
          );
          if (!nearOwnRoom) return false;
          return !otherRoomTiles.some((other) =>
            Math.max(Math.abs(other.x - tile.x), Math.abs(other.y - tile.y)) <= 1,
          );
        });
        if (haloTiles.length > 0) {
          const halo = new THREE.InstancedMesh(
            new THREE.PlaneGeometry(0.96, 0.96),
            new THREE.MeshBasicMaterial({
              color: 0x36dff5,
              transparent: true,
              opacity: 0.16,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
            haloTiles.length,
          );
          const haloMatrix = new THREE.Matrix4();
          const haloRotation = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
          haloTiles.forEach((tile, index) => {
            haloMatrix.makeTranslation(tile.x, 0.035, tile.y).multiply(haloRotation);
            halo.setMatrixAt(index, haloMatrix);
          });
          halo.instanceMatrix.needsUpdate = true;
          halo.renderOrder = 2_420;
          root.add(halo);
        }
      }

      const tiles = mapRoom.floorTiles.map((tile) => {
        const floor = new THREE.Mesh(geometry, material);
        floor.position.set(tile.x, ROOM_FLOOR_CENTER_Y, tile.y);
        floor.castShadow = false;
        floor.receiveShadow = false;
        root.add(floor);
        return {
          mesh: floor,
          delay:
            transition === 'sand-vortex'
              ? Math.hypot(tile.x - centerX, tile.y - centerY) * 105
              : transition === 'neon-collapse'
                ? 560 + Math.hypot(tile.x - centerX, tile.y - centerY) * 78
                : transition === 'investigation-scan'
                  ? 360 + Math.hypot(tile.x - centerX, tile.y - centerY) * 90
                  : transition === 'moonfire'
                    ? 500 + Math.hypot(tile.x - centerX, tile.y - centerY) * 72
              : Math.max(0, tile.x - minX) * 115,
        };
      });

      const effect = new THREE.Group();
      if (transition === 'wave') {
        const roomDepth = Math.max(1, maxY - minY + 1);
        const waveMaterial = new THREE.MeshBasicMaterial({
          color: 0x72edff,
          map: texture,
          transparent: true,
          opacity: 0.62,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const waveBody = new THREE.Mesh(
          new THREE.PlaneGeometry(1.45, roomDepth + 0.7),
          waveMaterial,
        );
        waveBody.rotation.x = -Math.PI / 2;
        waveBody.renderOrder = 2_500;
        effect.add(waveBody);
        for (const offset of [-0.32, 0.34]) {
          const foam = new THREE.Mesh(
            new THREE.PlaneGeometry(0.13, roomDepth + 0.9),
            new THREE.MeshBasicMaterial({
              color: offset < 0 ? 0xdfffff : 0xffffff,
              transparent: true,
              opacity: offset < 0 ? 0.58 : 0.84,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          foam.rotation.x = -Math.PI / 2;
          foam.position.x = offset;
          foam.position.y = 0.035;
          foam.renderOrder = 2_501;
          effect.add(foam);
        }
        effect.position.set(minX - 1.1, 0.23, centerY);
      } else if (transition === 'sand-vortex') {
        const maxRadius = Math.max(1.25, Math.hypot(maxX - minX, maxY - minY) * 0.34);
        for (const [index, radiusScale] of [0.34, 0.63, 1].entries()) {
          const swirlMaterial = new THREE.MeshBasicMaterial({
            color: index === 1 ? 0xf4d899 : 0xd99b4f,
            transparent: true,
            opacity: 0.78 - index * 0.13,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(
              maxRadius * radiusScale * 0.72,
              maxRadius * radiusScale,
              44,
              1,
              index * 0.78,
              Math.PI * 1.55,
            ),
            swirlMaterial,
          );
          ring.rotation.x = -Math.PI / 2;
          ring.rotation.z = index * 1.8;
          ring.position.y = 0.02 + index * 0.012;
          ring.renderOrder = 2_500 + index;
          effect.add(ring);
        }
        effect.position.set(centerX, 0.22, centerY);
      } else if (transition === 'neon-collapse') {
        const city = new THREE.Group();
        city.name = 'neon-city';
        const buildingMaterial = new THREE.MeshBasicMaterial({
          color: 0x2a174e,
          transparent: true,
          opacity: 0.96,
        });
        const cyanMaterial = new THREE.MeshBasicMaterial({
          color: 0x4eeaff,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const pinkMaterial = new THREE.MeshBasicMaterial({
          color: 0xff4fd8,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const towers: Array<[number, number, number, number]> = [
          [0, 0, 0.72, 1.75],
          [-0.48, 0.08, 0.42, 1.05],
          [0.46, 0.12, 0.46, 1.28],
          [-0.2, -0.42, 0.36, 0.84],
          [0.25, -0.4, 0.34, 0.72],
        ];
        for (const [index, [x, z, width, height]] of towers.entries()) {
          const tower = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, width),
            buildingMaterial,
          );
          tower.position.set(x, height / 2, z);
          city.add(tower);
          const cap = new THREE.Mesh(
            new THREE.BoxGeometry(width * 0.76, 0.045, width * 0.76),
            index % 2 === 0 ? cyanMaterial : pinkMaterial,
          );
          cap.position.set(x, height + 0.025, z);
          city.add(cap);
        }
        city.scale.set(0.72, 0.001, 0.72);
        effect.add(city);
        for (const [index, color] of [0x50eaff, 0xff4fd8].entries()) {
          const pulse = new THREE.Mesh(
            new THREE.RingGeometry(
              0.55 + index * 0.22,
              0.61 + index * 0.22,
              36,
            ),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.76 - index * 0.12,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          pulse.name = 'neon-collapse-pulse';
          pulse.rotation.x = -Math.PI / 2;
          pulse.position.y = 0.025 + index * 0.012;
          pulse.scale.setScalar(0.001);
          effect.add(pulse);
        }
        effect.position.set(centerX, 0.22, centerY);
      } else if (transition === 'moonfire') {
        const maxRadius = Math.max(1.5, Math.hypot(maxX - minX + 1, maxY - minY + 1) * 0.58);
        for (let index = 0; index < 3; index += 1) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.42 + index * 0.18, 0.5 + index * 0.18, 40),
            new THREE.MeshBasicMaterial({
              color: index === 1 ? 0x7657ff : 0x42eaff,
              transparent: true,
              opacity: 0.82 - index * 0.14,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          ring.name = 'moonfire-ring';
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.04 + index * 0.012;
          ring.userData.maxScale = maxRadius / (0.5 + index * 0.18);
          ring.scale.setScalar(0.001);
          effect.add(ring);
        }
        const foxSigil = new THREE.Mesh(
          new THREE.CircleGeometry(0.42, 6),
          new THREE.MeshBasicMaterial({ color: 0xc9f9ff, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        foxSigil.name = 'moonfire-fox-sigil';
        foxSigil.rotation.x = -Math.PI / 2;
        foxSigil.position.y = 0.075;
        effect.add(foxSigil);
        effect.position.set(centerX, 0.22, centerY);
      } else {
        const maxRadius = Math.max(
          1.4,
          Math.hypot(maxX - minX + 1, maxY - minY + 1) * 0.62,
        );
        const badgeMaterial = new THREE.MeshBasicMaterial({
          color: 0xf2c85b,
          transparent: true,
          opacity: 0.94,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const badge = new THREE.Mesh(
          new THREE.CircleGeometry(0.34, 6),
          badgeMaterial,
        );
        badge.name = 'investigation-badge';
        badge.rotation.x = -Math.PI / 2;
        badge.position.y = 0.04;
        badge.scale.setScalar(0.001);
        badge.renderOrder = 2_503;
        effect.add(badge);

        for (const [name, color, radius] of [
          ['investigation-scan-red', 0xff4f5f, 0.46],
          ['investigation-scan-blue', 0x55bfff, 0.58],
        ] as const) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius, radius + 0.055, 40),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.72,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          ring.name = name;
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = name.endsWith('red') ? 0.025 : 0.033;
          ring.scale.setScalar(0.001);
          ring.userData.maxScale = maxRadius / radius;
          ring.renderOrder = 2_501;
          effect.add(ring);
        }

        const controlLine = new THREE.Mesh(
          new THREE.PlaneGeometry(maxX - minX + 1.15, 0.07),
          new THREE.MeshBasicMaterial({
            color: 0xf4d468,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        controlLine.name = 'investigation-control-line';
        controlLine.rotation.x = -Math.PI / 2;
        controlLine.position.set(0, 0.02, -(maxY - minY + 1) / 2);
        controlLine.userData.depth = maxY - minY + 1;
        controlLine.renderOrder = 2_502;
        effect.add(controlLine);
        effect.position.set(centerX, 0.22, centerY);
      }
      root.add(effect);
      this.scene.add(root);

      const transitionDuration =
        transition === 'sand-vortex'
          ? 1_250 + Math.max(...tiles.map((tile) => tile.delay), 0)
          : transition === 'neon-collapse'
            ? 1_180 + Math.max(...tiles.map((tile) => tile.delay), 0)
            : transition === 'investigation-scan'
              ? 1_080 + Math.max(...tiles.map((tile) => tile.delay), 0)
              : transition === 'moonfire'
                ? 1_280 + Math.max(...tiles.map((tile) => tile.delay), 0)
          : 820 + Math.max(0, maxX - minX) * 115;
      const serverProgressMs = Math.max(
        0,
        (snapshot.elapsed - Math.max(0, room.tileSkinActivatedAt)) * 1_000,
      );
      const shouldAnimate =
        this.roomSkinSyncInitialized &&
        room.tileSkinActivatedAt >= 0 &&
        serverProgressMs < transitionDuration + 600;
      const view: RoomTileSkinView = {
        skinId: room.tileSkinId,
        transition,
        root,
        baseFloor,
        settledFloor,
        themedWalls,
        wallDecorations,
        tiles,
        effect,
        startedAt: shouldAnimate ? now - serverProgressMs : now - transitionDuration,
        duration: transitionDuration,
        minX,
        maxX,
        centerX,
        centerY,
        complete: !shouldAnimate,
      };
      if (!shouldAnimate) {
        effect.visible = false;
        settledFloor.visible = true;
        for (const tile of tiles) {
          tile.mesh.visible = false;
          tile.mesh.scale.x = 1;
          tile.mesh.scale.z = 1;
          tile.mesh.rotation.z = 0;
          tile.mesh.rotation.y = 0;
          root.remove(tile.mesh);
        }
        if (transition === 'neon-collapse' || transition === 'investigation-scan' || transition === 'moonfire') {
          root.remove(effect);
          disposeTransientObject(effect);
        }
      } else {
        settledFloor.visible = false;
        for (const tile of tiles) {
          tile.mesh.visible = true;
          tile.mesh.scale.x = 0.001;
          if (transition !== 'wave') tile.mesh.scale.z = 0.001;
        }
      }
      this.roomTileSkinViews.set(room.id, view);
    }
    for (const [roomId, view] of this.roomTileSkinViews) {
      if (activeRoomIds.has(roomId)) continue;
      view.baseFloor.visible = true;
      this.disposeRoomTileSkinView(view);
      this.roomTileSkinViews.delete(roomId);
    }
    this.roomSkinSyncInitialized = true;
  }

  private animateRoomTileSkins(time: number): void {
    for (const view of this.roomTileSkinViews.values()) {
      // A tiny pulse keeps the authored ornament alive without particles.
      if (view.wallDecorations) {
        view.wallDecorations.children.forEach((ornament, index) => {
          const pulse = 0.9 + Math.sin(time * 0.006 + index * 1.7) * 0.1;
          ornament.scale.setScalar(pulse);
        });
      }
      if (view.complete) continue;
      const elapsed = Math.max(0, time - view.startedAt);
      const sweep = clamp(elapsed / view.duration, 0, 1);
      const easedSweep = 1 - (1 - sweep) ** 3;
      if (view.transition === 'wave') {
        view.effect.position.x =
          view.minX - 1.1 + (view.maxX - view.minX + 2.2) * easedSweep;
      } else if (view.transition === 'sand-vortex') {
        view.effect.rotation.y = elapsed * 0.0045;
        const vortexScale = 0.68 + Math.sin(Math.PI * sweep) * 0.48;
        view.effect.scale.setScalar(vortexScale);
      } else if (view.transition === 'neon-collapse') {
        const city = view.effect.getObjectByName('neon-city');
        const rise = clamp(sweep / 0.32, 0, 1);
        const collapse = clamp((sweep - 0.34) / 0.28, 0, 1);
        if (city) {
          const riseEased = 1 - (1 - rise) ** 3;
          city.scale.set(
            0.72 + riseEased * 0.28 + collapse * 0.2,
            Math.max(0.001, riseEased * (1 - collapse)),
            0.72 + riseEased * 0.28 + collapse * 0.2,
          );
          city.rotation.z = collapse * 1.15;
          city.position.y =
            Math.sin(Math.PI * rise) * 0.12 - collapse * 0.12;
        }
        for (const pulse of view.effect.children.filter(
          (child) => child.name === 'neon-collapse-pulse',
        )) {
          const pulseProgress = clamp((sweep - 0.38) / 0.42, 0, 1);
          pulse.scale.setScalar(Math.max(0.001, pulseProgress * 4.2));
          pulse.rotation.z += 0.025;
        }
      } else if (view.transition === 'moonfire') {
        const flip = view.effect.getObjectByName('moonfire-fox-sigil');
        if (flip) {
          const flipProgress = clamp(sweep / 0.42, 0, 1);
          flip.rotation.z = flipProgress * Math.PI * 2;
          flip.position.y = 0.075 + Math.sin(flipProgress * Math.PI) * 0.72;
          flip.scale.setScalar(0.72 + Math.sin(flipProgress * Math.PI) * 0.48);
        }
        const fireProgress = clamp((sweep - 0.2) / 0.62, 0, 1);
        for (const ring of view.effect.children.filter((child) => child.name === 'moonfire-ring')) {
          ring.scale.setScalar(Math.max(0.001, fireProgress * Number(ring.userData.maxScale ?? 1)));
          ring.rotation.z += 0.028;
        }
      } else {
        const badge = view.effect.getObjectByName('investigation-badge');
        if (badge) {
          const badgeProgress = clamp(sweep / 0.24, 0, 1);
          const badgeScale = (1 - (1 - badgeProgress) ** 3) *
            (1 + Math.sin(Math.PI * badgeProgress) * 0.22);
          badge.scale.setScalar(Math.max(0.001, badgeScale));
          badge.rotation.z = elapsed * 0.0012;
        }
        const scanProgress = clamp((sweep - 0.08) / 0.58, 0, 1);
        for (const name of ['investigation-scan-red', 'investigation-scan-blue']) {
          const ring = view.effect.getObjectByName(name);
          if (!ring) continue;
          const maxScale = Number(ring.userData.maxScale ?? 1);
          ring.scale.setScalar(Math.max(0.001, scanProgress * maxScale));
          ring.rotation.z += name.endsWith('red') ? 0.018 : -0.014;
        }
        const controlLine = view.effect.getObjectByName('investigation-control-line');
        if (controlLine) {
          const depth = Math.max(1, Number(controlLine.userData.depth ?? 1));
          controlLine.position.z = -depth / 2 + depth * clamp((sweep - 0.18) / 0.54, 0, 1);
        }
      }
      const effectOpacity =
        view.transition === 'sand-vortex'
          ? Math.sin(Math.PI * Math.min(1, sweep * 1.08))
          : view.transition === 'neon-collapse'
            ? Math.sin(Math.PI * Math.min(1, sweep / 0.82))
            : view.transition === 'investigation-scan'
              ? Math.sin(Math.PI * Math.min(1, sweep / 0.84))
              : view.transition === 'moonfire'
                ? Math.sin(Math.PI * Math.min(1, sweep / 0.9))
          : Math.sin(Math.PI * sweep);
      view.effect.visible =
        view.transition === 'neon-collapse' || view.transition === 'investigation-scan' || view.transition === 'moonfire'
          ? sweep < 0.88
          : sweep < 1;
      view.effect.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshBasicMaterial) {
            const baseOpacity = Number(material.userData.baseOpacity ?? material.opacity);
            material.userData.baseOpacity ??= baseOpacity;
            material.opacity = baseOpacity * Math.max(0, effectOpacity);
          }
        }
      });
      for (const tile of view.tiles) {
        const progress = clamp((elapsed - tile.delay) / 520, 0, 1);
        const eased = 1 - (1 - progress) ** 3;
        tile.mesh.scale.x = Math.max(0.001, eased);
        if (view.transition === 'sand-vortex') {
          tile.mesh.scale.z = Math.max(0.001, eased);
          tile.mesh.rotation.y = (1 - eased) * Math.PI * 0.72;
          tile.mesh.position.y =
            ROOM_FLOOR_CENTER_Y + Math.sin(progress * Math.PI) * 0.24;
        } else if (view.transition === 'neon-collapse') {
          tile.mesh.scale.z = Math.max(0.001, eased);
          tile.mesh.rotation.y = (1 - eased) * Math.PI;
          tile.mesh.position.y =
            ROOM_FLOOR_CENTER_Y + Math.sin(progress * Math.PI) * 0.2;
        } else if (view.transition === 'investigation-scan' || view.transition === 'moonfire') {
          tile.mesh.scale.z = Math.max(0.001, eased);
          tile.mesh.rotation.y = (1 - eased) * Math.PI;
          tile.mesh.position.y =
            ROOM_FLOOR_CENTER_Y + Math.sin(progress * Math.PI) * 0.18;
        } else {
          tile.mesh.rotation.z = (1 - eased) * (Math.PI / 2);
          tile.mesh.position.y =
            ROOM_FLOOR_CENTER_Y + Math.sin(progress * Math.PI) * 0.16;
        }
      }
      if (sweep >= 1 && view.tiles.every((tile) => elapsed >= tile.delay + 520)) {
        view.complete = true;
        view.effect.visible = false;
        view.settledFloor.visible = true;
        if (
          view.transition === 'neon-collapse' ||
          view.transition === 'investigation-scan' ||
          view.transition === 'moonfire'
        ) {
          view.root.remove(view.effect);
          disposeTransientObject(view.effect);
        }
        for (const tile of view.tiles) {
          tile.mesh.visible = false;
          tile.mesh.scale.x = 1;
          tile.mesh.scale.z = 1;
          tile.mesh.rotation.z = 0;
          tile.mesh.rotation.y = 0;
          tile.mesh.position.y = ROOM_FLOOR_CENTER_Y;
          view.root.remove(tile.mesh);
        }
      }
    }
  }

  private createThemeDecorations(): void {
    const sampleStep = Math.max(1, Math.floor(this.mapData.walls.length / 14));
    const samples = this.mapData.walls.filter((_, index) => index % sampleStep === 0).slice(0, 14);
    samples.forEach((tile, index) => {
      const prop = new THREE.Group();
      prop.position.set(tile.x, 0.58, tile.y);
      prop.rotation.y = (index * 1.71) % (Math.PI * 2);
      const accent = standardMaterial(this.theme.marker, { emissive: this.theme.marker, emissiveIntensity: 0.28, roughness: 0.55 });
      const base = standardMaterial(this.theme.wallCap, { roughness: 0.9, metalness: this.theme.decor === 'hospital' ? 0.5 : 0.08 });
      if (this.theme.decor === 'hospital') {
        prop.add(mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.85, 8), base, [0, 0.43, 0]));
        prop.add(mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 14), accent, [0, 0.87, 0]));
      } else if (this.theme.decor === 'forest') {
        prop.add(mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.65, 8), standardMaterial(0x3f2b21), [0, 0.32, 0]));
        prop.add(mesh(new THREE.ConeGeometry(0.43, 0.82, 8), accent, [0, 0.9, 0]));
      } else if (this.theme.decor === 'ice') {
        prop.add(mesh(new THREE.ConeGeometry(0.18, 0.76, 5), accent, [0, 0.38, 0]));
        prop.add(mesh(new THREE.ConeGeometry(0.12, 0.52, 5), accent, [0.22, 0.26, 0.08]));
      } else if (this.theme.decor === 'desert') {
        prop.add(mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.72, 7), base, [0, 0.36, 0]));
        prop.add(mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.16, 7), accent, [0, 0.79, 0]));
      } else if (this.theme.decor === 'junkyard') {
        prop.add(mesh(new THREE.BoxGeometry(0.5, 0.34, 0.46), base, [0, 0.17, 0]));
        const barrel = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.48, 10), accent, [0.25, 0.3, 0.12]);
        barrel.rotation.z = 0.12;
        prop.add(barrel);
      } else {
        prop.add(mesh(new THREE.ConeGeometry(0.2, 0.88, this.theme.decor === 'void' ? 4 : 6), base, [0, 0.44, 0]));
        const rune = mesh(new THREE.TorusGeometry(0.24, 0.022, 6, 20), accent, [0, 0.62, -0.08]);
        rune.rotation.x = Math.PI / 2;
        prop.add(rune);
      }
      prop.scale.setScalar(0.72 + (index % 3) * 0.08);
      this.scene.add(prop);
    });
  }

  private loadEnvironmentTexture(url: string): THREE.Texture {
    const cached = this.environmentTextures.get(url);
    if (cached) return cached;
    const texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    texture.userData.sharedEnvironmentTexture = true;
    this.environmentTextures.set(url, texture);
    return texture;
  }

  private loadPrestigeTrailTexture(theme: PrestigeMotionTheme): PrestigeTrailTexture {
    const cached = this.prestigeTrailVideos.get(theme);
    if (cached) return { texture: cached.texture, packedAlpha: true };

    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = 'auto';
    video.src = PRESTIGE_MOTION_VIDEO_EFFECT_ASSETS[theme];

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this.prestigeTrailVideos.set(theme, { video, texture });

    const start = () => {
      void video.play().catch(() => {
        // Muted inline media normally starts automatically. If a browser keeps
        // the decoder paused until the first gesture, the static fallback is
        // still available and the next game input retries playback.
        this.renderer.domElement.addEventListener('pointerdown', start, {
          once: true,
          passive: true,
        });
      });
    };
    video.addEventListener('canplay', start, { once: true });
    video.addEventListener('error', () => {
      texture.dispose();
      this.prestigeTrailVideos.delete(theme);
    }, { once: true });
    video.load();
    start();
    return { texture, packedAlpha: true };
  }

  private addTileInstances(
    tiles: Tile[],
    texture: THREE.Texture,
    y: number,
  ): THREE.InstancedMesh {
    // Room and corridor each have authored art. Keep it at its source color
    // on every device; no theme-specific colour fallback or lighting tint.
    const geometry = new THREE.BoxGeometry(0.98, FLOOR_TILE_HEIGHT, 0.98);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: texture,
      fog: true,
    });
    const floors = new THREE.InstancedMesh(
      geometry,
      material,
      tiles.length,
    );
    floors.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    tiles.forEach((tile, index) => {
      position.set(tile.x, y + 0.04, tile.y);
      matrix.makeTranslation(position.x, position.y, position.z);
      floors.setMatrixAt(index, matrix);
    });
    this.scene.add(floors);
    return floors;
  }

  private refreshBuildableTiles(): void {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    const localRoomId = local?.roomId ?? null;
    if (
      this.lastBuildMarkerBuildings === this.snapshotData.buildings &&
      this.lastBuildMarkerRoomId === localRoomId
    )
      return;
    this.lastBuildMarkerBuildings = this.snapshotData.buildings;
    this.lastBuildMarkerRoomId = localRoomId;
    const room = local?.roomId
      ? this.mapData.rooms.find((candidate) => candidate.id === local.roomId)
      : undefined;
    const occupied = new Set(
      this.snapshotData.buildings
        .filter((building) => building.roomId === room?.id)
        .map((building) => `${building.tile.x},${building.tile.y}`),
    );
    const available = new Set(
      room
        ? room.buildTiles
            .filter((tile) => !occupied.has(`${tile.x},${tile.y}`))
            .map((tile) => `${tile.x},${tile.y}`)
        : [],
    );
    this.activeBuildTileMarkers = [];
    for (const [key, marker] of this.buildTileMarkers) {
      const active = available.has(key);
      marker.visible = active;
      if (active) this.activeBuildTileMarkers.push(marker);
    }
  }

  private animateBuildableTiles(time: number): void {
    if (this.activeBuildTileMarkers.length === 0) return;
    const pulse = 0.5 + Math.sin(time * 0.006) * 0.5;
    for (const marker of this.activeBuildTileMarkers) {
      const material = marker.userData.plusMaterial as THREE.MeshStandardMaterial;
      material.opacity = 0.16 + pulse * 0.14;
      material.emissiveIntensity = 0.12 + pulse * 0.22;
      marker.position.y = 0.095 + pulse * 0.006;
      const scale = 0.94 + pulse * 0.06;
      marker.scale.set(scale, 1, scale);
    }
  }

  private createRoomFurniture(roomId: string): void {
    const room = this.mapData.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return;
    const frame = standardMaterial(this.theme.bedFrame, { metalness: 0.28, roughness: 0.65 });
    const blanket = standardMaterial(this.theme.bedBlanket, { roughness: 0.95 });
    const pillow = standardMaterial(0xd7e2e8, { roughness: 1 });
    room.beds.forEach((bedTile, index) => {
      const bed = new THREE.Group();
      bed.position.copy(worldPoint(bedTile));
      bed.rotation.y = index % 2 === 0 ? 0 : Math.PI;
      bed.add(mesh(new THREE.BoxGeometry(0.88, 0.18, 0.7), frame, [0, 0.13, 0]));
      bed.add(mesh(new THREE.BoxGeometry(0.82, 0.14, 0.64), blanket, [0, 0.29, 0]));
      bed.add(mesh(new THREE.BoxGeometry(0.35, 0.11, 0.54), pillow, [-0.2, 0.4, 0]));
      const upgrade = makeBillboard(192, 192);
      upgrade.scale.set(0.42, 0.42, 1);
      upgrade.position.set(0, 0.54, 0);
      upgrade.renderOrder = 11_200;
      upgrade.visible = false;
      const goldLock = makeBillboard(192, 192);
      goldLock.scale.set(0.5, 0.5, 1);
      goldLock.position.set(0, 0.7, -0.06);
      goldLock.renderOrder = 11_340;
      goldLock.visible = false;
      updateTextBillboard(
        goldLock,
        'gold-lock',
        '🔒',
        '#ffe48a',
        'rgba(65,18,88,.94)',
        null,
        false,
        72,
      );
      bed.add(upgrade, goldLock);
      this.scene.add(bed);
      this.bedViews.set(`${room.id}:${index}`, {
        root: bed,
        upgrade,
        goldLock,
        roomId: room.id,
        bedIndex: index,
      });
    });
  }

  private syncBeds(snapshot: GameSnapshot): void {
    const local = snapshot.players.find((player) => player.id === this.playerId);
    const rank = snapshot.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
    for (const view of this.bedViews.values()) {
      const room = snapshot.rooms.find((candidate) => candidate.id === view.roomId);
      const roomGoldLocked = goldSealIndicatorVisibleForBed(
        snapshot,
        view.roomId,
        view.bedIndex,
      );
      view.goldLock.visible = roomGoldLocked;
      if (roomGoldLocked) {
        const pulse =
          1 + Math.sin(snapshot.elapsed * 10 + view.bedIndex) * 0.08;
        view.goldLock.scale.set(0.5 * pulse, 0.5 * pulse, 1);
      }
      const level = room?.bedLevels[view.bedIndex] ?? 1;
      const nextCost = level < maxBuildingLevel('bed', rank ?? 'beginner')
        ? upgradeCost('bed', level + 1, rank ?? 'beginner')
        : null;
      const ownsThisBed = local?.alive && local.roomId === view.roomId && local.bedIndex === view.bedIndex;
      const requirement = upgradeRequirement('bed', level, {
        bedLevel: level,
        doorLevel: room?.doorLevel ?? 1,
      });
      const canUpgrade = Boolean(nextCost && !requirement && ownsThisBed && local
        && local.gold >= nextCost.gold && local.power >= nextCost.power);
      view.upgrade.visible = canUpgrade;
      if (canUpgrade) updateUpgradeBillboard(view.upgrade, `bed:${level}`, true);
    }
  }

  private tutorialTargetForSnapshot(
    snapshot: GameSnapshot,
  ): { tile: Tile; label: string } | null {
    const tutorial = snapshot.tutorial;
    const local = snapshot.players.find(
      (player) => player.id === this.playerId,
    );
    const room = tutorial?.reservedRoomId
      ? this.mapRoomById.get(tutorial.reservedRoomId)
      : undefined;
    if (!tutorial?.active || !local?.alive || !room) return null;
    if (tutorial.step === "pickup-loot") {
      const loot = snapshot.lootDrops.find(
        (drop) => drop.id === tutorial.guidedLootId && !drop.carriedBy,
      );
      if (loot) return { tile: { ...loot.tile }, label: "↓ 아이템 줍기" };
    }
    if (tutorial.step === "claim-bed")
      return { tile: { ...room.bed, roomId: room.id }, label: "↓ 안내 침대" };
    if (tutorial.step === "upgrade-bed")
      return { tile: { ...room.bed, roomId: room.id }, label: "↓ 침대 클릭" };
    if (tutorial.step === "upgrade-door")
      return { tile: { ...room.door, roomId: room.id }, label: "↓ 문 클릭" };
    if (
      tutorial.step === "build-turret" ||
      tutorial.step === "build-generator" ||
      tutorial.step === "build-net"
    ) {
      const tile = tutorialGuidedBuildTile(
        this.mapData,
        snapshot.buildings,
        room.id,
        tutorial.step,
        local.id,
      );
      if (!tile) return null;
      const label =
        tutorial.step === "build-turret"
          ? "↓ 포탑 설치"
          : tutorial.step === "build-generator"
            ? "↓ 발전기 설치"
            : "↓ 그물 설치";
      return { tile, label };
    }
    if (tutorial.step === "upgrade-turret") {
      const turret = snapshot.buildings.find(
        (building) =>
          building.ownerId === local.id &&
          building.roomId === room.id &&
          building.kind === "basic-turret",
      );
      if (turret)
        return {
          tile: { ...turret.tile, roomId: room.id },
          label: "↓ 포탑 클릭",
        };
    }
    return null;
  }

  private syncTutorialGuide(snapshot: GameSnapshot): void {
    const tutorial = snapshot.tutorial;
    const local = snapshot.players.find(
      (player) => player.id === this.playerId,
    );
    const room = tutorial?.reservedRoomId
      ? this.mapRoomById.get(tutorial.reservedRoomId)
      : undefined;
    const target = this.tutorialTargetForSnapshot(snapshot);
    this.tutorialBedMarker.visible = Boolean(target);
    if (target) {
      this.tutorialBedMarker.position.copy(worldPoint(target.tile));
      this.tutorialBedMarker.position.y = 0.075;
      updateTextBillboard(
        this.tutorialBedMarkerLabel,
        `tutorial-target:${tutorial?.step}:${target.label}`,
        target.label,
        "#fff4a8",
        "rgba(4,20,35,.96)",
        null,
        false,
        38,
      );
    }

    if (!tutorial?.active || !local?.alive) {
      this.tutorialCameraFocus = null;
      this.tutorialCameraDistanceScale = null;
      return;
    }
    if ((tutorial.step === "pickup-loot" || tutorial.step === "claim-bed") && target) {
      const dx = target.tile.x - local.position.x;
      const dy = target.tile.y - local.position.y;
      this.tutorialCameraFocus = {
        x: local.position.x + dx * 0.5,
        y: local.position.y + dy * 0.5,
      };
      // Keep the initial route framing stable while the player walks. Recomputing
      // this from the remaining distance on every snapshot caused repeated zooms.
      if (this.tutorialCameraDistanceScale === null) {
        this.tutorialCameraDistanceScale = clamp(
          Math.max(Math.abs(dx), Math.abs(dy)) / 6.2,
          1 / Math.SQRT2,
          1.25,
        );
      }
      return;
    }
    if (
      tutorial.step === "finish" &&
      tutorial.combatRevealRemaining > 0
    ) {
      const ghost = (snapshot.ghosts ?? [snapshot.ghost]).find(
        (candidate) => candidate.variant !== "minion" && candidate.hp > 0,
      );
      this.tutorialCameraFocus = ghost ? { ...ghost.position } : null;
      this.tutorialCameraDistanceScale = 1 / Math.SQRT2;
      return;
    }
    if (tutorial.step === "finish" && room) {
      const turret = snapshot.buildings.find(
        (building) =>
          building.ownerId === local.id &&
          building.roomId === room.id &&
          building.kind === "basic-turret",
      );
      const anchor = turret?.tile ?? room.bed;
      this.tutorialCameraFocus = {
        x: (room.door.x + anchor.x) * 0.5,
        y: (room.door.y + anchor.y) * 0.5,
      };
      this.tutorialCameraDistanceScale = 1;
      return;
    }
    this.tutorialCameraFocus = target ? { ...target.tile } : { ...local.position };
    this.tutorialCameraDistanceScale = 1 / Math.SQRT2;
  }

  private animateTutorialBedMarker(time: number): void {
    if (!this.tutorialBedMarker.visible) return;
    const pulse = 1 + Math.sin(time * 0.006) * 0.08;
    this.tutorialBedMarker.scale.set(pulse, pulse, pulse);
    this.tutorialBedMarkerLabel.position.y =
      0.66 + Math.sin(time * 0.0045) * 0.06;
  }

  private syncPlayers(players: PlayerState[]): void {
    const active = new Set(players.map((player) => player.id));
    for (const player of players) {
      let view = this.playerViews.get(player.id);
      const appearanceKey = [player.appearance.character, player.appearance.skin].join('|');
      if (view && view.appearanceKey !== appearanceKey) {
        this.scene.remove(view.root);
        for (const trail of view.prestigeTrail) {
          this.scene.remove(trail.effect);
          disposeTransientObject(trail.effect);
        }
        view.actor.dispose();
        disposeBillboards(view.root);
        this.playerViews.delete(player.id);
        view = undefined;
      }
      if (!view) {
        const root = new THREE.Group();
        root.position.copy(worldPoint(player.position));
        root.userData.renderMode = 'atlas-2d';
        root.userData.appearance = { ...player.appearance };
        const actor = new AtlasSpriteActor(survivorSpriteDefinition(player.appearance));
        root.add(actor.object);
        const prestigeTheme = prestigeMotionTheme(player.appearance.skin);
        const prestigeTrailTexture = prestigeTheme
          ? this.loadPrestigeTrailTexture(prestigeTheme)
          : null;
        const label = makeBillboard();
        label.scale.set(2.48, 0.66, 1);
        label.position.set(0.1, PLAYER_HEIGHT + 0.42, -0.72);
        const profileDisplay = playerProfileDisplay(player);
        const badge = makeProfileBadge(player);
        badge.position.set(-1.1, PLAYER_HEIGHT + 0.42, -0.75);
        root.add(label, badge);
        this.scene.add(root);
        view = {
          root,
          actor,
          characterId: player.appearance.character,
          appearanceKey,
          label,
          badge,
          badgeKey: profileDisplay.badgeKey,
          target: worldPoint(player.position),
          lastPosition: worldPoint(player.position),
          seed: player.id.length * 0.71,
          prestigeTheme,
          prestigeTrailTexture,
          lastPrestigeTrailTile: {
            x: Math.round(player.position.x),
            y: Math.round(player.position.y),
          },
          prestigeTrail: [],
        };
        this.playerViews.set(player.id, view);
      }
      view.target.copy(worldPoint(player.position));
      // 점유 순간에는 서버가 침대 좌표로 이동시키므로, 벽 충돌을 거치는
      // 일반 보간을 사용하면 복도에 남은 채 누워 보일 수 있다. 점유자는
      // 항상 침대 좌표로 즉시 맞춰 렌더링 상태와 서버 점유 상태를 일치시킨다.
      if (
        player.alive &&
        player.roomId &&
        view.root.position.distanceToSquared(view.target) > 0.0001
      ) {
        view.root.position.copy(view.target);
        view.lastPosition.copy(view.target);
      }
      const profileDisplay = playerProfileDisplay(player);
      const elite = profileDisplay.rank ? isEliteRank(profileDisplay.rank) : false;
      if (view.badgeKey !== profileDisplay.badgeKey) {
        view.badgeKey = updateProfileBadge(view.badge, player);
      }
      updateTextBillboard(
        view.label,
        `${profileDisplay.badgeKey}:${profileDisplay.label}:${player.nickname}:${player.nameplateId ?? 'basic'}:${inGameNameplateAssetRevision}`,
        `${profileDisplay.label} · ${player.nickname}`,
        elite ? '#ecc9ff' : '#ffffff',
        'rgba(5,8,17,.78)',
        profileDisplay.rank ? rankLabelGradient(profileDisplay.rank) : null,
        true,
        42,
        inGameNameplateTheme(player.nameplateId),
      );
      const labelWidth = (view.label.userData.billboard as BillboardData).canvas.width;
      const labelScaleX = 2.48 * (labelWidth / 512);
      view.label.scale.set(labelScaleX, 0.66, 1);
      // Preserve an extra 2px-equivalent clear gap between the badge and the
      // dynamically sized nameplate.
      view.badge.position.x = 0.1 - labelScaleX / 2 - 0.065;
      setObjectOpacity(view.root, player.alive ? (player.connected ? 1 : 0.52) : 0.2);
    }
    for (const [id, view] of this.playerViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      for (const trail of view.prestigeTrail) {
        this.scene.remove(trail.effect);
        disposeTransientObject(trail.effect);
      }
      view.actor.dispose();
      disposeBillboards(view.root);
      this.playerViews.delete(id);
    }
  }

  private syncGhosts(ghosts: GhostState[]): void {
    const active = new Set(ghosts.map((ghost) => ghost.id));
    for (const ghost of ghosts) {
      let view = this.ghostViews.get(ghost.id);
      if (view && view.variant !== ghost.variant) {
        this.scene.remove(view.root);
        this.scene.remove(view.targetMarker);
        disposeTransientObject(view.targetMarker);
        view.actor.dispose();
        disposeBillboards(view.root);
        this.ghostViews.delete(ghost.id);
        view = undefined;
      }
      if (!view) {
        const root = new THREE.Group();
        root.position.copy(worldPoint(ghost.position));
        root.userData.renderMode = 'atlas-2d';
        root.userData.ghostVariant = ghost.variant;
        const actor = new AtlasSpriteActor(ghostSpriteDefinition(ghost.variant));
        root.add(actor.object);
        const label = makeBillboard();
        label.scale.set(ghost.variant === 'minion' ? 1.7 : 2.5, ghost.variant === 'minion' ? 0.46 : 0.62, 1);
        label.position.set(0, ghost.variant === 'giant' ? 3.15 : ghost.variant === 'minion' ? 1.02 : 2.22, ghost.variant === 'giant' ? -1.05 : ghost.variant === 'minion' ? -0.42 : -0.82);
        const hp = makeBillboard();
        hp.scale.set(ghost.variant === 'minion' ? 1.2 : 1.9, ghost.variant === 'minion' ? 0.34 : 0.46, 1);
        hp.position.set(0, ghost.variant === 'giant' ? 2.85 : ghost.variant === 'minion' ? 0.84 : 1.96, ghost.variant === 'giant' ? -0.66 : ghost.variant === 'minion' ? -0.16 : -0.45);
        const confused = makeBillboard();
        confused.scale.set(0.72, 0.5, 1);
        confused.position.set(0, ghost.variant === 'giant' ? 3.72 : ghost.variant === 'minion' ? 1.47 : 2.72, ghost.variant === 'giant' ? -1.26 : ghost.variant === 'minion' ? -0.54 : -1.05);
        confused.visible = false;
        const goldLock = makeBillboard(768, 160);
        goldLock.scale.set(
          ghost.variant === 'minion' ? 1.8 : 2.9,
          ghost.variant === 'minion' ? 0.48 : 0.68,
          1,
        );
        goldLock.position.set(
          0,
          ghost.variant === 'giant'
            ? 3.82
            : ghost.variant === 'minion'
              ? 1.52
              : 2.82,
          ghost.variant === 'giant'
            ? -1.34
            : ghost.variant === 'minion'
              ? -0.58
              : -1.1,
        );
        goldLock.renderOrder = 11_350;
        goldLock.visible = false;
        updateTextBillboard(
          goldLock,
          'gold-lock',
          '🔒 골드 획득 봉인',
          '#ffe48a',
          'rgba(65,18,88,.94)',
          null,
          false,
          44,
        );
        const slowAura = effectMesh(
          new THREE.RingGeometry(0.58, 0.82, 28),
          new THREE.MeshBasicMaterial({
            color: 0x49ddff,
            transparent: true,
            opacity: 0.62,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
          [0, 0.1, 0],
        );
        slowAura.rotation.x = -Math.PI / 2;
        slowAura.renderOrder = 8_610;
        slowAura.visible = false;
        const slowNotice = makeBillboard(640, 144);
        slowNotice.scale.set(2.25, 0.5, 1);
        slowNotice.position.set(0, ghost.variant === 'giant' ? 4.15 : 3.1, -1.15);
        slowNotice.renderOrder = 11_360;
        slowNotice.visible = false;
        updateTextBillboard(slowNotice, 'slow', '❄ 이동속도 감소', '#9af3ff', 'rgba(8,30,72,.9)', null, false, 40);
        const abilityColor =
          ghost.variant === 'wallpaper' ? 0xb856ff : 0xff304f;
        const telegraph = effectMesh(
          new THREE.RingGeometry(0.54, 0.69, 32),
          new THREE.MeshBasicMaterial({
            color: abilityColor,
            transparent: true,
            opacity: 0.78,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
          [0, 0.08, 0],
        );
        telegraph.rotation.x = -Math.PI / 2;
        telegraph.renderOrder = 8_600;
        telegraph.visible = false;
        const targetMarker = effectMesh(
          new THREE.RingGeometry(0.3, 0.47, 4),
          new THREE.MeshBasicMaterial({
            color: abilityColor,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        targetMarker.rotation.x = -Math.PI / 2;
        targetMarker.renderOrder = 8_590;
        targetMarker.visible = false;
        root.add(label, hp, confused, goldLock, slowAura, slowNotice, telegraph);
        this.scene.add(targetMarker);
        // Minion waves can contain twelve actors. A dynamic point light for
        // every minion multiplies the fragment-lighting cost while adding
        // little at their small on-screen size, so only full ghosts emit one.
        if (ghost.variant !== 'minion') {
          const light = new THREE.PointLight(
            GHOST_GLOW_COLORS[ghost.variant],
            ghost.variant === 'giant' ? 1.7 : 0.9,
            ghost.variant === 'giant' ? 5.2 : 3.2,
            2,
          );
          light.position.y = 1.2;
          root.add(light);
        }
        this.scene.add(root);
        view = {
          root,
          actor,
          variant: ghost.variant,
          label,
          hp,
          target: worldPoint(ghost.position),
          seed: ghost.id.length * 1.19,
          attackStartedAt: Number.NEGATIVE_INFINITY,
          hitFlashUntil: Number.NEGATIVE_INFINITY,
          hitSquashUntil: Number.NEGATIVE_INFINITY,
          telegraph,
          targetMarker,
          confused,
          goldLock,
          slowAura,
          slowNotice,
        };
        this.ghostViews.set(ghost.id, view);
      }
      view.target.copy(worldPoint(ghost.position));
      const netted = this.snapshotData.elapsed < ghost.stunnedUntil;
      const manaLabel =
        ghost.variant === 'demolisher' || ghost.variant === 'wallpaper'
        ? ` · 마나 ${Math.floor((ghost.mana / Math.max(1, ghost.maxMana)) * 100)}%`
        : '';
      updateTextBillboard(view.label, `${ghost.displayName}:${ghost.level}:${netted}:${manaLabel}`, `${ghost.displayName} · Lv.${ghost.level}${manaLabel}${netted ? ' · 그물' : ''}`, netted ? '#fff0a5' : '#ffb4c2', 'rgba(25,4,12,.84)');
      const confused = this.snapshotData.elapsed < ghost.confusedUntil;
      view.confused.visible = confused;
      if (confused) {
        updateTextBillboard(view.confused, `dizzy:${Math.ceil(ghost.confusedUntil - this.snapshotData.elapsed)}`, '💫', '#fff0b4', 'rgba(44,20,78,.86)');
        view.confused.position.x = Math.sin(performance.now() * 0.012 + view.seed) * 0.12;
      }
      const goldLockActive = this.snapshotData.rooms.some(
        (room) =>
          room.goldSuppressedUntil > this.snapshotData.elapsed &&
          room.goldSuppressedByGhostId === ghost.id,
      );
      view.goldLock.visible = goldLockActive;
      if (goldLockActive) {
        const pulse = 1 + Math.sin(this.snapshotData.elapsed * 11) * 0.045;
        view.goldLock.scale.set(
          (ghost.variant === 'minion' ? 1.8 : 2.9) * pulse,
          (ghost.variant === 'minion' ? 0.48 : 0.68) * pulse,
          1,
        );
      }
      const timedSlow = this.snapshotData.elapsed < ghost.slowUntil;
      const prestigeSlow = (ghost.prestigeSlowMultiplier ?? 1) < 0.999;
      const slowed = timedSlow || prestigeSlow;
      view.slowAura.visible = slowed;
      view.slowNotice.visible = slowed;
      if (slowed) {
        const pulse = 1 + Math.sin(this.snapshotData.elapsed * 6 + view.seed) * 0.12;
        view.slowAura.scale.setScalar(pulse);
        const material = view.slowAura.material as THREE.MeshBasicMaterial;
        material.color.setHex(prestigeSlow ? 0x45e8ff : 0xa7f5ff);
        material.opacity = 0.5 + Math.sin(this.snapshotData.elapsed * 7) * 0.12;
      }
      const ratio = ghost.hp / Math.max(1, ghost.maxHp);
      updateBarBillboard(view.hp, `${Math.ceil(ghost.hp)}:${Math.ceil(ghost.maxHp)}:${ghost.retreating}`, ratio, `${Math.ceil(ghost.hp)} / ${Math.ceil(ghost.maxHp)}`, ghost.retreating ? '#8494bb' : '#ff315f');
      const telegraphActive =
        (ghost.variant === 'demolisher' ||
          ghost.variant === 'wallpaper') &&
        ghost.abilityPhase !== 'idle';
      view.telegraph.visible = telegraphActive;
      const targetBuilding = ghost.abilityTargetBuildingId
        ? this.buildingStateById.get(ghost.abilityTargetBuildingId)
        : undefined;
      view.targetMarker.visible = telegraphActive && Boolean(targetBuilding);
      if (targetBuilding)
        view.targetMarker.position.set(
          targetBuilding.tile.x,
          0.12,
          targetBuilding.tile.y,
        );
      setObjectOpacity(view.root, ghost.hp > 0 ? (ghost.healing ? 0.62 : 1) : 0.08);
    }
    for (const [id, view] of this.ghostViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      this.scene.remove(view.targetMarker);
      disposeTransientObject(view.targetMarker);
      view.actor.dispose();
      disposeBillboards(view.root);
      this.ghostViews.delete(id);
    }
  }

  private syncContamination(ghosts: GhostState[]): void {
    const active = new Set<string>();
    for (const ghost of ghosts) {
      if (
        ghost.variant !== 'wallpaper' ||
        ghost.hp <= 0 ||
        this.snapshotData.elapsed >= ghost.contaminationEndsAt
      )
        continue;
      for (const tile of ghost.contaminatedTiles) {
        const key = `${ghost.id}:${tile.roomId ?? ''}:${tile.x}:${tile.y}`;
        active.add(key);
        if (this.contaminationViews.has(key)) continue;
        const root = new THREE.Group();
        root.position.set(tile.x, 0.115, tile.y);
        root.renderOrder = 4_950;
        const stain = effectMesh(
          new THREE.BoxGeometry(0.9, 0.025, 0.9),
          new THREE.MeshBasicMaterial({
            color: 0x61216f,
            transparent: true,
            opacity: 0.58,
            depthWrite: false,
          }),
        );
        root.add(stain);
        const lineMaterial = new THREE.MeshBasicMaterial({
          color: 0xb8ff72,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        });
        for (const offset of [-0.24, 0, 0.24]) {
          const strip = effectMesh(
            new THREE.BoxGeometry(0.06, 0.03, 0.76),
            lineMaterial,
            [offset, 0.02, 0],
          );
          strip.rotation.y = 0.28 + offset * 0.7;
          root.add(strip);
        }
        root.userData.phase = key.length * 0.73;
        this.scene.add(root);
        this.contaminationViews.set(key, root);
      }
    }
    for (const [key, view] of this.contaminationViews) {
      if (active.has(key)) continue;
      this.scene.remove(view);
      disposeTransientObject(view);
      this.contaminationViews.delete(key);
    }
  }

  private syncBuildings(snapshot: GameSnapshot): void {
    const buildings = snapshot.buildings;
    const structureChanged = this.lastSyncedBuildings !== buildings;
    this.lastSyncedBuildings = buildings;
    const local = snapshot.players.find((player) => player.id === this.playerId);
    const rank = snapshot.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
    const active = structureChanged
      ? new Set(buildings.map((building) => building.id))
      : null;
    const overloadUntilByOwner = new Map<string, number>();
    for (const building of buildings) {
      if (
        building.kind !== 'overload-capacitor' ||
        (building.overloadUntil ?? 0) <= snapshot.elapsed
      )
        continue;
      overloadUntilByOwner.set(
        building.ownerId,
        Math.max(
          overloadUntilByOwner.get(building.ownerId) ?? 0,
          building.overloadUntil ?? 0,
        ),
      );
    }
    for (const building of buildings) {
      let view = this.buildingViews.get(building.id);
      const visualLevel = building.effectiveLevel ?? building.level;
      if (
        structureChanged &&
        view &&
        (view.modelLevel !== visualLevel || view.skinId !== building.skinId || view.kind !== building.kind || view.itemId !== building.itemId)
      ) {
        this.scene.remove(view.root);
        disposeBuildingRoot(view.root);
        this.buildingViews.delete(building.id);
        view = undefined;
      }
      if (!view && structureChanged) {
        const model = createBuildingModel(building);
        model.root.position.copy(worldPoint(building.tile));
        const upgrade = makeBillboard(192, 192);
        upgrade.scale.set(0.42, 0.42, 1);
        upgrade.position.set(0, 0.48, 0);
        upgrade.renderOrder = 11_200;
        upgrade.visible = false;
        const goldLock = makeBillboard(192, 192);
        goldLock.scale.set(0.5, 0.5, 1);
        goldLock.position.set(0, 0.72, -0.06);
        goldLock.renderOrder = 11_340;
        goldLock.visible = false;
        updateTextBillboard(
          goldLock,
          'gold-lock',
          '🔒',
          '#ffe48a',
          'rgba(65,18,88,.94)',
          null,
          false,
          72,
        );
        model.root.add(upgrade, goldLock);
        this.scene.add(model.root);
        view = {
          root: model.root,
          barrel: model.barrel,
          upgrade,
          goldLock,
          modelLevel: visualLevel,
          skinId: building.skinId,
          kind: building.kind,
          itemId: building.itemId,
          barrelRestZ: model.barrel?.position.z ?? 0,
          recoil: 0,
          pulseStartedAt: performance.now(),
          statusScale: 1,
          levelLabel: `Lv.${building.level}`,
          levelColor: '#ffffff',
          levelBackground: 'rgba(8,12,24,.9)',
          upgradeVisible: false,
        };
        this.buildingViews.set(building.id, view);
      }
      if (!view) continue;
      // Building movement and swaps are authoritative on the server. Updating
      // existing view roots here lets the next snapshot move both sides of a
      // swap without rebuilding their models or textures.
      if (this.buildingDrag?.buildingId !== building.id) {
        view.root.position.copy(worldPoint(building.tile));
      }
      const roomGoldLocked = goldSealIndicatorVisibleForBuilding(
        snapshot,
        building,
      );
      view.goldLock.visible = roomGoldLocked;
      if (roomGoldLocked) {
        const pulse = 1 + Math.sin(snapshot.elapsed * 10 + building.id.length) * 0.08;
        view.goldLock.scale.set(0.5 * pulse, 0.5 * pulse, 1);
      }
      const overloadUntil =
        overloadUntilByOwner.get(building.ownerId) ?? 0;
      const overloadActive = building.kind === 'basic-turret' && overloadUntil > snapshot.elapsed;
      const chargeRemaining = Math.max(0, (building.soulChargeReadyAt ?? 0) - snapshot.elapsed);
      const soulCharging = chargeRemaining > 0;
      const levelLabel = soulCharging
        ? `충전 ${chargeRemaining.toFixed(1)}s`
        : overloadActive
        ? `폭주 ${Math.max(0, overloadUntil - snapshot.elapsed).toFixed(1)}s`
        : building.effectiveLevel && building.effectiveLevel > building.level
          ? `Lv.${building.level} +${building.effectiveLevel - building.level}`
          : `Lv.${building.level}`;
      view.levelLabel = levelLabel;
      view.levelColor = soulCharging
        ? '#b9f4ff'
        : overloadActive
          ? '#ffe57a'
          : '#ffffff';
      view.levelBackground = soulCharging
        ? 'rgba(15,81,125,.94)'
        : overloadActive
          ? 'rgba(99,30,10,.92)'
          : 'rgba(8,12,24,.9)';
      view.statusScale = soulCharging
        ? 1 + Math.sin(snapshot.elapsed * 20) * 0.08
        : overloadActive ? 1 + Math.sin(snapshot.elapsed * 18) * 0.055 : 1;
      // Upgrade hints are local-room UI. Avoid recalculating costs and
      // requirements for every remote building on every 10 Hz snapshot.
      if (!local?.alive || local.roomId !== building.roomId) {
        view.upgradeVisible = false;
      } else {
        const traitMaximum = characterTraitForMatch(local.appearance, Boolean(snapshot.ranked)).basicTurretMaxLevel;
        const nextCost =
          building.level < maxBuildingLevel(building.kind, rank ?? 'beginner', traitMaximum)
            ? upgradeCost(
                building.kind,
                building.level + 1,
                rank ?? 'beginner',
                traitMaximum,
              )
            : null;
        const room = this.roomStateById.get(building.roomId);
        const requirement = upgradeRequirement(building.kind, building.level, {
          bedLevel: room?.bedLevels[local.bedIndex ?? 0] ?? 1,
          doorLevel: room?.doorLevel ?? 1,
        });
        view.upgradeVisible = Boolean(
          nextCost &&
            !requirement &&
            local.gold >= nextCost.gold &&
            local.power >= nextCost.power,
        );
      }
      view.upgrade.visible = view.upgradeVisible;
      if (view.upgradeVisible) {
        updateUpgradeBillboard(
          view.upgrade,
          `building:${building.id}:${building.level}`,
          true,
        );
      }
    }
    if (active) {
      for (const [id, view] of this.buildingViews) {
        if (active.has(id)) continue;
        this.scene.remove(view.root);
        disposeBuildingRoot(view.root);
        this.buildingViews.delete(id);
      }
    }
  }

  private syncDoors(snapshot: GameSnapshot): void {
    for (const state of snapshot.rooms) {
      const room = this.mapData.rooms.find((candidate) => candidate.id === state.id);
      if (!room) continue;
      const exploringPlayers = snapshot.players.filter(
        (player) =>
          player.alive &&
          !player.roomId &&
          isPositionOnRoomFloor(room, player.position),
      );
      const explorerAtInsideHandle = exploringPlayers.some(
        (player) =>
          Math.hypot(
            player.position.x - room.door.x,
            player.position.y - room.door.y,
          ) <= 1.35,
      );
      const shouldCloseForSearch =
        exploringPlayers.length > 0 && !explorerAtInsideHandle;
      let view = this.doorViews.get(room.id);
      if (!view) {
        const root = new THREE.Group();
        root.position.copy(worldPoint(room.door));
        const leftRightDistance = Math.min(
          Math.abs(room.door.x - room.bounds.x),
          Math.abs(room.door.x - (room.bounds.x + room.bounds.width - 1)),
        );
        const topBottomDistance = Math.min(
          Math.abs(room.door.y - room.bounds.y),
          Math.abs(room.door.y - (room.bounds.y + room.bounds.height - 1)),
        );
        if (leftRightDistance <= topBottomDistance) root.rotation.y = Math.PI / 2;
        const frameMaterial = standardMaterial(0x25374d, { metalness: 0.5, roughness: 0.5 });
        const panelMaterial = standardMaterial(0x5bcbd5, { emissive: 0x185b66, emissiveIntensity: 0.85, metalness: 0.28, roughness: 0.42 });
        // A door occupies exactly one grid tile. The former narrow strip made
        // the doorway look undersized next to 1×1 floor/building tiles.
        const frame = mesh(new THREE.BoxGeometry(1.02, 0.08, 0.94), frameMaterial, [0, 0.08, 0]);
        root.add(frame);
        const panel = new THREE.Group();
        panel.position.set(0, 0.15, 0);
        const surface = mesh(new THREE.BoxGeometry(0.9, 0.07, 0.78), panelMaterial);
        const details = new THREE.Group();
        // Door details were authored for the earlier narrow strip. Scale the
        // same decoration with the tile-sized panel so every door level keeps
        // its intended silhouette without requiring duplicate geometry.
        details.scale.set(1.18, 1, 2.7);
        panel.add(surface, details);
        root.add(panel);
        // Door orientation must not rotate the HUD: keeping this group camera
        // aligned gives horizontal and vertical doors the same label/HP order.
        const hud = new THREE.Group();
        hud.rotation.y = -root.rotation.y;
        const hp = makeDoorBarBillboard();
        hp.scale.set(2.08, 0.48, 1);
        hp.position.set(0, 0.84, -0.62);
        hp.renderOrder = 11_100;
        const shield = makeDoorBarBillboard();
        shield.scale.set(2.08, 0.42, 1);
        shield.position.set(0, 0.8, -0.2);
        shield.renderOrder = 11_105;
        shield.visible = false;
        const label = makeDoorLabelBillboard();
        label.scale.set(2.36, 0.52, 1);
        label.position.set(0, 0.98, -1.16);
        label.renderOrder = 11_110;
        const upgrade = makeBillboard(192, 192);
        upgrade.scale.set(0.42, 0.42, 1);
        upgrade.position.set(0, 0.48, 0);
        upgrade.renderOrder = 11_200;
        upgrade.visible = false;
        hud.add(hp, shield, label, upgrade);
        root.add(hud);
        this.scene.add(root);
        const closed =
          state.ownerIds.length > 0 || shouldCloseForSearch ? 1 : 0;
        panel.scale.x = 0.18 + closed * 0.82;
        view = {
          root,
          panel,
          surface,
          frame,
          details,
          hp,
          shield,
          label,
          upgrade,
          closedTarget: closed,
          closedAmount: closed,
          visualLevel: 0,
          impactUntil: Number.NEGATIVE_INFINITY,
        };
        applyDoorVisual(view, state.doorLevel);
        this.doorViews.set(room.id, view);
      }
      const intact = state.doorHp > 0;
      view.closedTarget =
        intact && (state.ownerIds.length > 0 || shouldCloseForSearch) ? 1 : 0;
      view.panel.visible = intact;
      if (view.visualLevel !== state.doorLevel) applyDoorVisual(view, state.doorLevel);
      // Building labels and resource popups live on the 2D HUD canvas, which
      // always composites above WebGL sprites. Door information therefore
      // moves to that same canvas and is drawn last so dense construction can
      // never cover its name or HP.
      view.label.visible = false;
      view.hp.visible = false;
      view.shield.visible = false;
      const local = snapshot.players.find((player) => player.id === this.playerId);
      const rank = snapshot.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
      const localTrait = characterTraitForMatch(
        local?.appearance ?? { character: 'character-bunny', skin: 'skin-basic-bunny' },
        Boolean(snapshot.ranked),
      );
      const nextCost = intact && state.doorLevel < maxBuildingLevel('reinforced-door', rank ?? 'beginner')
        ? upgradeCostForTrait(
            'reinforced-door',
            upgradeCost('reinforced-door', state.doorLevel + 1, rank ?? 'beginner'),
            localTrait,
          )
        : null;
      const requirement = upgradeRequirement('reinforced-door', state.doorLevel, {
        bedLevel: state.bedLevels[local?.bedIndex ?? 0] ?? 1,
        doorLevel: state.doorLevel,
      });
      const canUpgrade = Boolean(nextCost && !requirement && local?.alive && local.roomId === state.id
        && local.gold >= nextCost.gold && local.power >= nextCost.power);
      view.upgrade.visible = canUpgrade;
      if (canUpgrade) updateUpgradeBillboard(view.upgrade, `door:${state.doorLevel}`, true);
    }
  }

  private animateDoors(dt: number): void {
    const now = performance.now();
    for (const view of this.doorViews.values()) {
      view.closedAmount = damp(view.closedAmount, view.closedTarget, 8.5, dt);
      view.panel.scale.x = 0.18 + view.closedAmount * 0.82;
      const impact = clamp((view.impactUntil - now) / 170, 0, 1);
      view.panel.position.x =
        (1 - view.closedAmount) * 0.34 +
        Math.sin(now * 0.075) * impact * 0.045;
      view.panel.rotation.z = Math.sin(now * 0.09) * impact * 0.025;
    }
  }

  private animatePlayers(time: number, dt: number): void {
    const local = this.playerStateById.get(this.playerId);
    const localRank = this.snapshotData.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
    const localSpeed = BALANCE.player.speed
      * rankBenefits(localRank ?? 'beginner').speedMultiplier
      * characterTraitForMatch(
        local?.appearance ?? { character: 'character-bunny', skin: 'skin-basic-bunny' },
        Boolean(this.snapshotData.ranked),
      ).unclaimedMoveSpeedMultiplier
      * (this.snapshotData.elapsed < (local?.speedBoostUntil ?? 0) ? 1.45 : 1);
    for (const [id, view] of this.playerViews) {
      const player = this.playerStateById.get(id);
      if (!player) continue;
      const lying = Boolean(player.alive && player.roomId);
      const defeated = !player.alive;
      const isLocal = id === this.playerId;
      const hasLocalInput = isLocal && !lying && Boolean(this.localInput.x || this.localInput.y);
      const lockedRoomBlocks = player.lockedRoomId
        ? this.roomExitBlockTilesFor(player.lockedRoomId)
        : undefined;
      if (hasLocalInput) {
        const acknowledgedInput = this.acknowledgedLocalInput(player.lastInputSeq);
        const currentPosition = {
          x: view.root.position.x,
          y: view.root.position.z,
        };
        const rawPredicted = moveInWalkableArea(this.mapData, currentPosition, {
          x: this.localInput.x * localSpeed * dt,
          y: this.localInput.y * localSpeed * dt,
        }, BALANCE.player.collisionRadius, 0.12, lockedRoomBlocks);
        const predicted = limitLocalPredictionLead(
          currentPosition,
          rawPredicted,
          { x: view.target.x, y: view.target.z },
          this.localInput,
          LOCAL_MAX_PREDICTION_LEAD,
          this.localInputSequence,
          player.lastInputSeq,
          acknowledgedInput,
        );
        view.root.position.set(predicted.x, FLOOR_Y, predicted.y);
        const targetOffsetX = view.target.x - predicted.x;
        const targetOffsetZ = view.target.z - predicted.y;
        const serverError = Math.hypot(targetOffsetX, targetOffsetZ);
        // A 10Hz snapshot naturally describes where the survivor was a short
        // time ago. Pulling the predicted actor backwards toward that old
        // position on every packet caused a visible stop/turn/stop rhythm on
        // mobile networks. Ignore ordinary trailing snapshots while an input
        // is held; an actual collision or desync still exceeds the hard cap.
        const targetTrailsInput =
          targetOffsetX * this.localInput.x + targetOffsetZ * this.localInput.y < -0.025;
        if (serverError > LOCAL_HARD_RECONCILE_DISTANCE && !targetTrailsInput) {
          this.reconcilePlayerPosition(view, 16, dt, lockedRoomBlocks);
        } else if (serverError > LOCAL_SOFT_RECONCILE_DISTANCE && !targetTrailsInput) {
          this.reconcilePlayerPosition(view, 1.4, dt, lockedRoomBlocks);
        }
      } else {
        const now = performance.now();
        const holdReleasedPrediction =
          isLocal &&
          !lying &&
          shouldHoldReleasedPrediction(
            this.localInputReleaseSequence,
            player.lastInputSeq,
            now,
            this.localInputReleaseAckTimeoutAt,
            { x: view.root.position.x, y: view.root.position.z },
            { x: view.target.x, y: view.target.z },
            this.lastNonZeroLocalInput,
          );
        if (
          isLocal &&
          this.localInputReleaseSequence !== null &&
          !holdReleasedPrediction
        ) {
          this.localInputReleaseSequence = null;
          this.localInputReleaseAckTimeoutAt = 0;
        }
        if (!holdReleasedPrediction) {
          this.reconcilePlayerPosition(
            view,
            isLocal ? 13 : 10.5,
            dt,
            lockedRoomBlocks,
          );
        }
      }
      const dx = view.root.position.x - view.lastPosition.x;
      const dz = view.root.position.z - view.lastPosition.z;
      const moving = Math.hypot(dx, dz) > 0.0015;
      if (lying && view.prestigeTrail.length > 0) {
        for (const trail of view.prestigeTrail) {
          this.scene.remove(trail.effect);
          disposeTransientObject(trail.effect);
        }
        view.prestigeTrail.length = 0;
      }
      if (view.prestigeTheme && !lying) {
        const tile = {
          x: Math.round(view.root.position.x),
          y: Math.round(view.root.position.z),
        };
        if (moving && view.prestigeTrailTexture) {
          const previous = view.lastPrestigeTrailTile;
          const tileKey = `${previous.x},${previous.y}`;
          if (previous.x !== tile.x || previous.y !== tile.y) {
            const effect = makePrestigeTrailEffect(
              view.prestigeTheme,
              view.prestigeTrailTexture,
            );
            // The current tile deliberately remains clean. The loop is left on
            // the tile the survivor has already crossed, never under their feet.
            effect.position.x = previous.x;
            effect.position.z = previous.y;
            this.scene.add(effect);
            view.prestigeTrail.push({ effect, tileKey });
            const trailLimit = view.prestigeTheme === 'moonlit' ? 4 : view.prestigeTheme === 'abyssal' ? 5 : 6;
            while (view.prestigeTrail.length > trailLimit) {
              const expired = view.prestigeTrail.shift();
              if (expired) {
                this.scene.remove(expired.effect);
                disposeTransientObject(expired.effect);
              }
            }
          }
        }
        view.lastPrestigeTrailTile = tile;
        view.prestigeTrail.forEach((trail, index) => {
          const progress = (index + 1) / Math.max(1, view.prestigeTrail.length);
          trail.effect.scale.setScalar(0.72 + progress * 0.48 + Math.sin(time * 0.006 + index) * 0.07);
          trail.effect.rotation.y = Math.sin(time * 0.002 + index) * 0.12;
          setPrestigeTrailOpacity(trail.effect, 0.2 + progress * 0.72);
        });
      }
      const bedIndex = player.bedIndex ?? 0;
      const lyingOnReversedBed = bedIndex % 2 === 1;
      if (lying) view.actor.setSleep(lyingOnReversedBed);
      else {
        const movementIntent = isLocal && hasLocalInput
          ? this.localInput
          : player.velocity;
        const facing = facingDeltaForMotion(dx, dz, movementIntent);
        view.actor.setMovement(facing.x, facing.z, moving && !defeated, time, view.seed);
      }
      const lieRotation = lying
        ? (lyingOnReversedBed ? Math.PI : 0)
        : (defeated ? Math.PI / 2 : 0);
      // Bed pillows sit at the head end of the frame.  Offset and orient the
      // full-size sleeping pose per bed direction so its head rests on that pillow,
      // rather than rotating around the middle of the mattress.
      const lieOffsetX = lying ? (lyingOnReversedBed ? 0.13 : -0.13) : 0;
      view.actor.setScreenRotation(damp(view.actor.object.rotation.y, lieRotation, 9, dt));
      view.actor.object.position.x = damp(view.actor.object.position.x, lieOffsetX, 12, dt);
      view.actor.object.position.z = damp(
        view.actor.object.position.z,
        moving && !lying && !defeated ? -Math.abs(Math.sin(time * 0.018 + view.seed)) * 0.035 : 0,
        12,
        dt,
      );
      view.actor.object.position.y = damp(view.actor.object.position.y, lying ? 0.5 : 0.24, 10, dt);
      view.actor.setScale(damp(
        view.actor.object.scale.x,
        view.actor.size * (lying ? 0.96 : defeated ? 0.86 : 1),
        9,
        dt,
      ));
      view.lastPosition.copy(view.root.position);
    }
  }

  private acknowledgedLocalInput(sequence: number | undefined): Vec2 | undefined {
    if (!Number.isSafeInteger(sequence)) return undefined;
    let acknowledgedSequence = -1;
    let acknowledged: Vec2 | undefined;
    for (const [candidateSequence, input] of this.localInputHistory) {
      if (candidateSequence <= (sequence ?? -1) && candidateSequence > acknowledgedSequence) {
        acknowledgedSequence = candidateSequence;
        acknowledged = input;
      }
    }
    if (acknowledgedSequence >= 0) {
      for (const candidateSequence of this.localInputHistory.keys()) {
        if (candidateSequence < acknowledgedSequence - 4)
          this.localInputHistory.delete(candidateSequence);
      }
    }
    return acknowledged;
  }

  private reconcilePlayerPosition(
    view: PlayerView,
    speed: number,
    dt: number,
    blockedTileKeys?: ReadonlySet<string>,
  ): void {
    const amount = 1 - Math.exp(-speed * dt);
    let correctionX = (view.target.x - view.root.position.x) * amount;
    let correctionY = (view.target.z - view.root.position.z) * amount;
    const correctionDistance = Math.hypot(correctionX, correctionY);
    if (correctionDistance > MAX_RECONCILE_STEP) {
      const scale = MAX_RECONCILE_STEP / correctionDistance;
      correctionX *= scale;
      correctionY *= scale;
    }
    const corrected = moveInWalkableArea(this.mapData, {
      x: view.root.position.x,
      y: view.root.position.z,
    }, {
      x: correctionX,
      y: correctionY,
    }, BALANCE.player.collisionRadius, 0.12, blockedTileKeys);
    view.root.position.x = corrected.x;
    view.root.position.z = corrected.y;
  }

  private roomExitBlockTilesFor(roomId: string): ReadonlySet<string> | undefined {
    const cached = this.roomExitBlockTiles.get(roomId);
    if (cached) return cached;
    const room = this.mapRoomById.get(roomId);
    if (!room) return undefined;
    const inside = new Set(room.floorTiles.map((tile) => `${tile.x},${tile.y}`));
    const blocked = new Set(
      this.mapData.walkable
        .filter((tile) => !inside.has(`${tile.x},${tile.y}`))
        .map((tile) => `${tile.x},${tile.y}`),
    );
    this.roomExitBlockTiles.set(roomId, blocked);
    return blocked;
  }

  private animateGhosts(time: number, dt: number): void {
    for (const [id, view] of this.ghostViews) {
      const ghost = this.ghostStateById.get(id);
      if (!ghost) continue;
      const beforeX = view.root.position.x;
      const beforeZ = view.root.position.z;
      // Only the teleporter is allowed to make an intentional hard jump. The
      // other variants receive snapshots at 10Hz, so a larger snap threshold
      // plus a slightly faster interpolation keeps pursuit smooth on mobile
      // instead of stepping one tile at a time under modest latency.
      const intentionalTeleport = ghost.variant === 'teleporter';
      const amount = 1 - Math.exp(-(intentionalTeleport ? 8 : 12) * dt);
      const targetDistance = Math.hypot(view.target.x - beforeX, view.target.z - beforeZ);
      // Ghost positions are server-authoritative.  Running them through the
      // survivor collision prediction made fast movers get caught at a wall
      // corner after a state jump, so the actual ghost could remain offscreen
      // while it was already attacking at its latest server position.
      if (targetDistance > (intentionalTeleport ? 1.1 : 2.4)) {
        view.root.position.x = view.target.x;
        view.root.position.z = view.target.z;
      } else {
        view.root.position.x += (view.target.x - beforeX) * amount;
        view.root.position.z += (view.target.z - beforeZ) * amount;
      }
      view.root.visible = ghost.hp > 0;
      // Time Attack enlargement happens once on the server at overtime entry;
      // this visual scale mirrors that authoritative state without growing on
      // every render frame.
      const overtimeScale = this.snapshotData.status === 'OVERTIME' && ghost.variant !== 'minion' ? 2 : 1;
      view.root.scale.setScalar(overtimeScale);
      const dx = view.root.position.x - beforeX;
      const dz = view.root.position.z - beforeZ;
      const moving = Math.hypot(dx, dz) > 0.001;
      const attackDuration = ghostAttackDuration(ghost.variant);
      const attackElapsed = time - view.attackStartedAt;
      const netted = this.snapshotData.elapsed < ghost.stunnedUntil;
      const skillElapsed = Math.max(
        0,
        (this.snapshotData.elapsed - ghost.abilityStartedAt) * 1_000,
      );
      if (
        !netted &&
        (ghost.variant === 'demolisher' ||
          ghost.variant === 'wallpaper') &&
        ghost.abilityPhase === 'preparing'
      ) {
        view.actor.setSkillPrepare(skillElapsed, 3_000);
      } else if (
        !netted &&
        (ghost.variant === 'demolisher' ||
          ghost.variant === 'wallpaper') &&
        ghost.abilityPhase === 'casting'
      ) {
        view.actor.setSkillCast(
          skillElapsed,
          ghost.variant === 'wallpaper' ? 800 : 650,
        );
      } else if (!netted && attackElapsed >= 0 && attackElapsed < attackDuration) {
        view.actor.setAttack(attackElapsed, attackDuration);
      } else {
        view.actor.setMovement(dx, dz, moving && !netted, time, view.seed);
      }
      view.actor.setScreenRotation(0);
      const hitProgress = clamp((view.hitSquashUntil - time) / 140, 0, 1);
      view.actor.setVisualScale(1 + hitProgress * 0.08, 1 - hitProgress * 0.1);
      view.actor.setTint(time < view.hitFlashUntil ? 0xffc9c9 : 0xffffff);
      if (view.telegraph.visible) {
        const pulse = 1 + Math.sin(time * 0.012) * 0.16;
        view.telegraph.scale.setScalar(pulse);
        view.targetMarker.scale.setScalar(0.92 + Math.sin(time * 0.014) * 0.12);
        const telegraphMaterial = view.telegraph.material as THREE.MeshBasicMaterial;
        telegraphMaterial.opacity = ghost.abilityPhase === 'casting' ? 0.96 : 0.68;
      }
      view.actor.object.position.z = moving && !netted
        ? -Math.abs(Math.sin(time * 0.008 + view.seed)) * 0.045
        : 0;
    }
    for (const view of this.contaminationViews.values()) {
      const phase = Number(view.userData.phase ?? 0);
      const pulse = 0.96 + Math.sin(time * 0.004 + phase) * 0.035;
      view.scale.setScalar(pulse);
    }
  }

  private animateTurrets(dt: number): void {
    for (const [id, view] of this.buildingViews) {
      if (!view.barrel) continue;
      const profile = this.turretVisualProfiles.get(id);
      if (!profile) continue;
      const { building, range, door } = profile;
      if (!this.isEffectVisible(building.tile, 1.5)) continue;
      const rangeSquared = range * range;
      let nearest: GhostState | undefined;
      let nearestDistanceSquared = Number.POSITIVE_INFINITY;
      for (const ghost of this.activeGhostStates) {
        const dx = ghost.position.x - building.tile.x;
        const dy = ghost.position.y - building.tile.y;
        const candidateDistanceSquared = dx * dx + dy * dy;
        if (
          candidateDistanceSquared > rangeSquared ||
          candidateDistanceSquared >= nearestDistanceSquared
        )
          continue;
        nearest = ghost;
        nearestDistanceSquared = candidateDistanceSquared;
      }
      const target = nearest?.position ?? door;
      if (!target) continue;
      const desired = Math.atan2(target.x - building.tile.x, target.y - building.tile.y)
        + Number(view.barrel.userData.aimOffset ?? 0);
      view.barrel.rotation.y = dampAngle(view.barrel.rotation.y, desired, 15, dt);
      view.recoil = damp(view.recoil, 0, 18, dt);
      view.barrel.position.z = view.barrelRestZ + view.recoil * 0.11;
    }
  }

  private effectLimit(): number {
    return this.effectQuality === 'high'
      ? MAX_TRANSIENT_EFFECTS
      : this.effectQuality === 'balanced'
        ? 40
        : 20;
  }

  private turretVisualInterval(): number {
    return this.effectQuality === 'high'
      ? TURRET_VISUAL_INTERVAL_MS
      : this.effectQuality === 'balanced'
        ? 95
        : 150;
  }

  private isEffectVisible(position: Vec2, margin = 2.5): boolean {
    const local = this.playerStateById.get(this.playerId);
    const blackoutActive =
      Boolean(this.snapshotData.ranked) &&
      (this.snapshotData.status === 'RANKED_INTRO' ||
        this.snapshotData.status === 'EVENT_INTRO' ||
        this.snapshotData.status === 'GHOST_INTRO' ||
        this.snapshotData.status === 'COUNTDOWN') &&
      Boolean(local?.alive);
    if (blackoutActive && local?.roomId) {
      const room = this.mapRoomById.get(local.roomId);
      if (
        room &&
        ![...room.floorTiles, room.door].some(
          (tile) => tile.x === position.x && tile.y === position.y,
        )
      )
        return false;
    }
    const halfWidth = Math.abs(this.camera.right - this.camera.left) / 2;
    const halfHeight = Math.abs(this.camera.top - this.camera.bottom) / 2;
    return (
      Math.abs(position.x - this.cameraTarget.x) <= halfWidth + margin &&
      Math.abs(position.y - this.cameraTarget.z) <= halfHeight + margin
    );
  }

  private animateBuildings(time: number): void {
    for (const [id, view] of this.buildingViews) {
      const building = this.buildingStateById.get(id);
      if (!building) continue;
      const pulseProgress = clamp((time - view.pulseStartedAt) / 360, 0, 1);
      const enterScale =
        pulseProgress < 1
          ? 0.82 + Math.sin((pulseProgress * Math.PI) / 2) * 0.18
          : 1;
      const activePulse =
        this.effectQuality !== 'low' &&
        ACTIVE_BUILDING_MOTION_KINDS.has(building.kind) &&
        this.isEffectVisible(building.tile, 1)
          ? 1 + Math.sin(time * 0.0035 + building.tile.x * 0.7) * 0.014
          : 1;
      const nextScale = view.statusScale * enterScale * activePulse;
      if (Math.abs(view.root.scale.x - nextScale) > 0.0005)
        view.root.scale.setScalar(nextScale);
    }
  }

  private animateAmbient(time: number): void {
    if (!this.moonLight) return;
    this.moonLight.intensity =
      this.effectQuality === 'low'
        ? 3.65
        : 3.65 + Math.sin(time * 0.00045) * 0.09;
  }

  private animateEffects(time: number): void {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index] as TimedEffect;
      const progress = clamp((time - effect.born) / effect.duration, 0, 1);
      if (effect.from && effect.to) effect.object.position.lerpVectors(effect.from, effect.to, progress);
      if (effect.rise) effect.object.position.y += effect.rise * 0.016;
      if (effect.baseScale) {
        effect.object.scale.copy(effect.baseScale).multiplyScalar(1 + progress * (effect.scaleGrowth ?? 0));
      } else {
        effect.object.scale.setScalar(1 + progress * 1.4);
      }
      if (effect.fade !== false) setObjectOpacity(effect.object, 1 - progress);
      if (progress < 1) continue;
      this.scene.remove(effect.object);
      if (effect.release) effect.release(effect.object);
      else disposeTransientObject(effect.object);
      this.effects.splice(index, 1);
    }
  }

  private acquirePooledObject<T extends THREE.Object3D>(
    key: string,
    pool: T[],
    factory: () => T,
    maximum = MAX_RAPID_EFFECTS_PER_POOL,
  ): T | null {
    const pooled = pool.pop();
    if (pooled) {
      pooled.visible = true;
      pooled.scale.setScalar(1);
      pooled.rotation.set(0, 0, 0);
      return pooled;
    }
    const created = this.effectPoolCreated.get(key) ?? 0;
    if (created >= maximum) return null;
    const object = factory();
    this.effectPoolCreated.set(key, created + 1);
    return object;
  }

  private queuePooledEffect<T extends THREE.Object3D>(
    object: T,
    pool: T[],
    effect: Omit<TimedEffect, 'object' | 'release'>,
  ): void {
    this.scene.add(object);
    this.effects.push({
      ...effect,
      object,
      fade: false,
      release: (released) => {
        released.visible = false;
        pool.push(released as T);
      },
    });
  }

  private acquireNormalProjectile(
    kind: BuildingKind | undefined,
    color: number,
    levelScale: number,
  ): THREE.Mesh | null {
    const projectile = this.acquirePooledObject(
      'normal-projectile',
      this.normalProjectilePool,
      () => effectMesh(
        new THREE.SphereGeometry(0.1, 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffd36f,
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
        }),
      ),
    );
    if (!projectile) return null;
    const rapid = kind === 'rapid-turret';
    const material = projectile.material as THREE.MeshBasicMaterial;
    material.color.setHex(color);
    projectile.scale.setScalar((rapid ? 0.62 : 1) * levelScale);
    return projectile;
  }

  private acquireWaterProjectile(): THREE.Group | null {
    return this.acquirePooledObject(
      'water-projectile',
      this.waterProjectilePool,
      () => {
        const droplets = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({
          color: 0x62ddff,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        for (let index = 0; index < 5; index += 1) {
          const droplet = effectMesh(
            new THREE.SphereGeometry(index === 0 ? 0.13 : 0.065, 10, 7),
            material,
            [
              (index % 2 === 0 ? 1 : -1) * index * 0.035,
              (index % 3) * 0.025,
              index * 0.1,
            ],
          );
          droplet.scale.set(1, 0.8, 1.35);
          droplets.add(droplet);
        }
        droplets.renderOrder = 8_200;
        return droplets;
      },
      24,
    );
  }

  private acquireWaterSplash(): THREE.Group | null {
    return this.acquirePooledObject(
      'water-splash',
      this.waterSplashPool,
      () => {
        const splash = new THREE.Group();
        const ring = effectMesh(
          new THREE.RingGeometry(0.12, 0.27, 20),
          new THREE.MeshBasicMaterial({
            color: 0xd8fbff,
            transparent: true,
            opacity: 0.88,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        splash.add(ring);
        const cyan = new THREE.MeshBasicMaterial({
          color: 0x82e9ff,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
        const white = cyan.clone();
        white.color.setHex(0xffffff);
        for (let index = 0; index < 6; index += 1) {
          const angle = (index / 6) * Math.PI * 2;
          splash.add(effectMesh(
            new THREE.SphereGeometry(0.045, 8, 6),
            index % 2 === 0 ? cyan : white,
            [
              Math.cos(angle) * 0.3,
              0.04 + (index % 2) * 0.04,
              Math.sin(angle) * 0.3,
            ],
          ));
        }
        splash.renderOrder = 8_210;
        return splash;
      },
      24,
    );
  }

  private acquireCyberLaser(
    glowColor: number,
    coreColor: number,
  ): THREE.Group | null {
    const laser = this.acquirePooledObject(
      'cyber-laser',
      this.cyberLaserPool,
      () => {
        const beam = new THREE.Group();
        const glow = effectMesh(
          new THREE.CylinderGeometry(0.44, 0.44, 1, 8),
          new THREE.MeshBasicMaterial({
            color: 0xff4fd8,
            transparent: true,
            opacity: 0.28,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        glow.name = 'cyber-laser-glow';
        glow.rotation.x = Math.PI / 2;
        beam.add(glow);
        const core = effectMesh(
          new THREE.CylinderGeometry(0.17, 0.17, 1, 8),
          new THREE.MeshBasicMaterial({
            color: 0x9ff8ff,
            transparent: true,
            opacity: 0.98,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        core.name = 'cyber-laser-core';
        core.rotation.x = Math.PI / 2;
        beam.add(core);
        beam.renderOrder = 8_220;
        return beam;
      },
      16,
    );
    const glow = laser?.getObjectByName('cyber-laser-glow');
    if (glow) {
      glow.visible = this.effectQuality === 'high';
      ((glow as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(glowColor);
    }
    const core = laser?.getObjectByName('cyber-laser-core');
    if (core)
      ((core as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(coreColor);
    return laser;
  }

  private acquireBeam(color: number): THREE.Line | null {
    const line = this.acquirePooledObject(
      'turret-beam',
      this.beamPool,
      () => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(6), 3),
        );
        const created = new THREE.Line(
          geometry,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
          }),
        );
        created.castShadow = false;
        created.receiveShadow = false;
        return created;
      },
      24,
    );
    if (line) (line.material as THREE.LineBasicMaterial).color.setHex(color);
    return line;
  }

  private acquireImpactRing(color: number): THREE.Mesh | null {
    const ring = this.acquirePooledObject(
      'impact-ring',
      this.impactRingPool,
      () => effectMesh(
        new THREE.RingGeometry(0.14, 0.22, 24),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    if (ring) (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    return ring;
  }

  private acquireDoorDust(): THREE.Group | null {
    return this.acquirePooledObject(
      'door-dust',
      this.dustPool,
      () => {
        const cloud = new THREE.Group();
        const material = new THREE.MeshBasicMaterial({
          color: 0xa6a19a,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        });
        for (let index = 0; index < 4; index += 1) {
          const puff = effectMesh(
            new THREE.CircleGeometry(0.07 + index * 0.012, 8),
            material,
            [
              (index - 1.5) * 0.11,
              (index % 2) * 0.04,
              (index % 3 - 1) * 0.07,
            ],
          );
          puff.lookAt(this.camera.position);
          cloud.add(puff);
        }
        cloud.renderOrder = 8_100;
        return cloud;
      },
      12,
    );
  }

  private queueHudMessage(message: Omit<HudMessage, 'born'>): void {
    const now = performance.now();
    const duplicate = this.hudMessages.findIndex(
      (entry) => entry.key === message.key && now - entry.born < 220,
    );
    if (duplicate >= 0) this.hudMessages.splice(duplicate, 1);
    this.hudMessages.push({ ...message, born: now });
    if (this.hudMessages.length > MAX_HUD_MESSAGES) {
      this.hudMessages.splice(0, this.hudMessages.length - MAX_HUD_MESSAGES);
    }
  }

  private renderHudMessages(time: number): void {
    // This canvas follows the same moving camera as WebGL. Throttling it to
    // 20~30fps leaves labels at the previous camera position for several
    // frames, so levels and resource gains visibly shake over their buildings.
    // Redraw the lightweight semantic HUD on every rendered camera frame.
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const context = this.hudContext;
    context.clearRect(0, 0, width, height);
    const doorCards = this.visibleDoorHudCards(width, height);
    this.renderBuildingHud(context, width, height, doorCards);

    const projected = new THREE.Vector3();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    for (let index = this.hudMessages.length - 1; index >= 0; index -= 1) {
      const message = this.hudMessages[index];
      if (!message) continue;
      const progress = (time - message.born) / message.duration;
      if (progress >= 1) {
        this.hudMessages.splice(index, 1);
        continue;
      }
      projected
        .set(message.position.x, 0.72, message.position.y)
        .project(this.camera);
      if (
        projected.z < -1 ||
        projected.z > 1 ||
        projected.x < -1.2 ||
        projected.x > 1.2 ||
        projected.y < -1.2 ||
        projected.y > 1.2
      )
        continue;
      const x = snapHudCoordinate(
        (projected.x * 0.5 + 0.5) * width,
        this.renderPixelRatio,
      );
      const y = snapHudCoordinate(
        (-projected.y * 0.5 + 0.5) * height -
        18 -
        message.rise * Math.min(1, progress) * 48,
        this.renderPixelRatio,
      );
      const opacity = progress < 0.72 ? 1 : 1 - (progress - 0.72) / 0.28;
      const textWidth = context.measureText(message.text).width;
      const boxWidth = Math.min(width * 0.78, textWidth + 20);
      const boxHeight = 24;
      if (doorCards.some((card) =>
        x + boxWidth / 2 >= card.x - card.width / 2 &&
        x - boxWidth / 2 <= card.x + card.width / 2 &&
        y + boxHeight / 2 >= card.y - card.height / 2 &&
        y - boxHeight / 2 <= card.y + card.height / 2
      )) continue;
      context.save();
      context.globalAlpha = clamp(opacity * (message.peakOpacity ?? 1), 0, 1);
      context.fillStyle = message.background;
      context.beginPath();
      context.roundRect(
        x - boxWidth / 2,
        y - boxHeight / 2,
        boxWidth,
        boxHeight,
        8,
      );
      context.fill();
      context.fillStyle = message.color;
      context.fillText(message.text, x, y, boxWidth - 12);
      context.restore();
    }
  }

  private renderDoorOverlay(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const context = this.doorHudContext;
    context.clearRect(0, 0, width, height);
    this.renderDoorHud(context, this.visibleDoorHudCards(width, height));
  }

  private visibleDoorHudCards(width: number, height: number): DoorHudCard[] {
    const projected = new THREE.Vector3();
    const cards: DoorHudCard[] = [];
    for (const [roomId, view] of this.doorViews) {
      const state = this.roomStateById.get(roomId);
      if (!state) continue;
      projected
        .set(view.root.position.x, 0.94, view.root.position.z - 0.88)
        .project(this.camera);
      if (
        projected.z < -1 || projected.z > 1 ||
        projected.x < -1.12 || projected.x > 1.12 ||
        projected.y < -1.12 || projected.y > 1.12
      ) continue;
      const metrics = doorHudMetricsForCameraScale(
        this.cameraDistanceScale,
        state.doorShieldMaxHp > 0,
      );
      cards.push({
        state,
        x: snapHudCoordinate(
          (projected.x * 0.5 + 0.5) * width,
          this.renderPixelRatio,
        ),
        y: snapHudCoordinate(
          (-projected.y * 0.5 + 0.5) * height,
          this.renderPixelRatio,
        ),
        ...metrics,
      });
    }
    return cards;
  }

  private renderDoorHud(
    context: CanvasRenderingContext2D,
    cards: readonly DoorHudCard[],
  ): void {
    for (const card of cards) {
      const { state } = card;
      const left = card.x - card.width / 2;
      const top = card.y - card.height / 2;
      const padding = card.compact ? 4 : 5;
      const titleY = top + (card.compact ? 5.5 : 7);
      const barTop = top + (card.compact ? 10 : 13);
      const barHeight = card.compact ? 3 : 4;
      const intact = state.doorHp > 0;
      const hpRatio = clamp(state.doorHp / Math.max(1, state.doorMaxHp), 0, 1);
      const hpColor = !intact
        ? '#566173'
        : hpRatio > 0.5 ? '#55dfa0' : hpRatio > 0.22 ? '#ffc85f' : '#ff5578';
      context.save();
      context.fillStyle = 'rgba(5,8,17,.94)';
      context.strokeStyle = intact ? 'rgba(133,221,236,.7)' : 'rgba(255,85,120,.72)';
      context.lineWidth = 1;
      context.beginPath();
      context.roundRect(left, top, card.width, card.height, card.compact ? 4 : 5);
      context.fill();
      context.stroke();

      context.textBaseline = 'middle';
      context.font = `800 ${card.compact ? 5.5 : 6.7}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      context.textAlign = 'left';
      context.fillStyle = '#d8f8ff';
      context.fillText(
        card.compact
          ? `문 Lv.${state.doorLevel}`
          : `문 Lv.${state.doorLevel} · ${doorVisualForLevel(state.doorLevel).label}`,
        left + padding,
        titleY,
        card.width - (card.compact ? 25 : 37),
      );
      context.textAlign = 'right';
      context.fillStyle = intact ? '#f5fbff' : '#ff7892';
      context.fillText(
        intact
          ? card.compact
            ? `${Math.ceil(state.doorHp)}`
            : `${Math.ceil(state.doorHp)}/${Math.ceil(state.doorMaxHp)}`
          : '파괴됨',
        left + card.width - padding,
        titleY,
        card.compact ? 21 : 34,
      );

      const barLeft = left + padding;
      const barWidth = card.width - padding * 2;
      context.fillStyle = 'rgba(255,255,255,.12)';
      context.fillRect(barLeft, barTop, barWidth, barHeight);
      context.fillStyle = hpColor;
      context.fillRect(barLeft, barTop, barWidth * hpRatio, barHeight);

      if (state.doorShieldMaxHp > 0) {
        const shieldRatio = clamp(
          state.doorShieldHp / Math.max(1, state.doorShieldMaxHp),
          0,
          1,
        );
        const shieldTop = card.compact ? top + 17 : top + 22;
        const shieldLabelWidth = card.compact ? 0 : 23;
        if (!card.compact) {
          context.textAlign = 'left';
          context.font = '750 5.8px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
          context.fillStyle = '#b7eeff';
          context.fillText('방어막', barLeft, shieldTop + 1.5);
        }
        context.fillStyle = 'rgba(255,255,255,.12)';
        context.fillRect(barLeft + shieldLabelWidth, shieldTop, barWidth - shieldLabelWidth, barHeight);
        context.fillStyle = shieldRatio > 0 ? '#72dfff' : '#566173';
        context.fillRect(
          barLeft + shieldLabelWidth,
          shieldTop,
          (barWidth - shieldLabelWidth) * shieldRatio,
          barHeight,
        );
      }
      context.restore();
    }
  }

  private renderBuildingHud(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    doorCards: readonly DoorHudCard[],
  ): void {
    if (this.buildingViews.size === 0) return;
    const projected = new THREE.Vector3();
    const project = (x: number, y: number, z: number): [number, number] | null => {
      projected.set(x, y, z).project(this.camera);
      if (
        projected.z < -1 ||
        projected.z > 1 ||
        projected.x < -1.08 ||
        projected.x > 1.08 ||
        projected.y < -1.08 ||
        projected.y > 1.08
      )
        return null;
      return [
        snapHudCoordinate(
          (projected.x * 0.5 + 0.5) * width,
          this.renderPixelRatio,
        ),
        snapHudCoordinate(
          (-projected.y * 0.5 + 0.5) * height,
          this.renderPixelRatio,
        ),
      ];
    };

    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (const [id, view] of this.buildingViews) {
      const building = this.buildingStateById.get(id);
      if (!building || !this.isEffectVisible(building.tile, 0.6)) continue;
      const labelPoint = project(
        view.root.position.x + 0.28,
        0.9,
        view.root.position.z + 0.34,
      );
      if (labelPoint) {
        context.save();
        context.font =
          '800 9px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
        const labelWidth = Math.max(
          28,
          Math.min(86, context.measureText(view.levelLabel).width + 10),
        );
        if (doorCards.some((card) =>
          labelPoint[0] + labelWidth / 2 >= card.x - card.width / 2 &&
          labelPoint[0] - labelWidth / 2 <= card.x + card.width / 2 &&
          labelPoint[1] + 7 >= card.y - card.height / 2 &&
          labelPoint[1] - 7 <= card.y + card.height / 2
        )) {
          context.restore();
          continue;
        }
        context.fillStyle = view.levelBackground;
        context.beginPath();
        context.roundRect(
          labelPoint[0] - labelWidth / 2,
          labelPoint[1] - 7,
          labelWidth,
          14,
          5,
        );
        context.fill();
        context.fillStyle = view.levelColor;
        context.fillText(
          view.levelLabel,
          labelPoint[0],
          labelPoint[1],
          labelWidth - 6,
        );
        context.restore();
      }
    }
  }

  private playEvent(event: GameEvent): void {
    const now = performance.now();
    if (
      event.kind === 'ghost-skill' &&
      event.itemId === 'gold-lock' &&
      event.label === '골드 획득 봉인 5초' &&
      event.targetId
    ) {
      const caster = this.ghostViews.get(event.targetId);
      if (caster) {
        const casterPosition = {
          x: caster.target.x,
          y: caster.target.z,
        };
        this.queueHudMessage({
          key: `gold-lock-caster:${event.targetId}:${now}`,
          text: '🔒 골드 획득 봉인',
          color: '#ffe48a',
          background: 'rgba(65,18,88,.94)',
          position: casterPosition,
          duration: 1_800,
          rise: 0.55,
        });
        if (
          this.effects.length < this.effectLimit() &&
          this.isEffectVisible(casterPosition)
        ) {
          const casterRing = this.acquireImpactRing(0xd984ff);
          if (casterRing) {
            casterRing.position.set(casterPosition.x, 1.05, casterPosition.y);
            casterRing.lookAt(this.camera.position);
            this.queuePooledEffect(casterRing, this.impactRingPool, {
              born: now,
              duration: 520,
              baseScale: casterRing.scale.clone(),
              scaleGrowth: 1.8,
            });
          }
        }
      }
    }
    if (event.kind === 'ghost-hit' && event.targetId) {
      const target = this.ghostViews.get(event.targetId);
      if (target) {
        target.hitFlashUntil = now + 90;
        target.hitSquashUntil = now + 140;
      }
    }
    if (event.kind === 'door-hit' && event.roomId) {
      const door = this.doorViews.get(event.roomId);
      if (door) door.impactUntil = now + 170;
      if (
        event.position &&
        this.effectQuality !== 'low' &&
        this.isEffectVisible(event.position, 1)
      ) {
        const dust = this.acquireDoorDust();
        if (dust) {
          dust.position.copy(worldPoint(event.position, 0.18));
          this.queuePooledEffect(dust, this.dustPool, {
            born: now,
            duration: 320,
            rise: 0.3,
            baseScale: dust.scale.clone(),
            scaleGrowth: 0.65,
          });
        }
      }
    }
    if (event.kind === 'turret-fire' && event.sourceId) {
      const turret = this.buildingViews.get(event.sourceId);
      if (turret) turret.recoil = 1;
    }
    if (
      (event.kind === 'build' || event.kind === 'upgrade') &&
      event.position
    ) {
      for (const [id, building] of this.buildingStateById) {
        if (
          building.tile.x !== event.position.x ||
          building.tile.y !== event.position.y
        )
          continue;
        const view = this.buildingViews.get(id);
        if (view) view.pulseStartedAt = now;
      }
    }
    if (event.kind === 'door-hit' && event.targetId && event.position) {
      const attacker = this.ghostViews.get(event.targetId);
      // A blink/sprint snapshot can arrive alongside an older door-hit. The
      // actor's own recorded strike origin is the reliable anchor: it allows
      // legitimate door attacks from the corridor approach, while rejecting
      // attacks whose ghost has already moved somewhere else.
      const origin = event.sourcePosition ?? event.position;
      const maximumDrift = event.sourcePosition ? 0.72 : 1.2;
      if (!attacker || attacker.target.distanceToSquared(worldPoint(origin)) > maximumDrift * maximumDrift) return;
      // A door strike must face the door itself, not the last pathfinding
      // waypoint. Otherwise every ghost can reuse a stale vertical facing
      // while attacking a door to its left or right.
      attacker.actor.setFacingFromDelta(
        event.position.x - origin.x,
        event.position.y - origin.y,
      );
      // Start close to frame zero so short mobile attack sheets are visible
      // instead of immediately advancing to their middle frame.
      attacker.attackStartedAt = performance.now() - 70;
    }
    if (event.kind === 'ghost-net' && event.position) {
      const net = effectMesh(
        new THREE.RingGeometry(0.28, 0.72, 12),
        new THREE.MeshBasicMaterial({ color: 0xffdf65, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthTest: false }),
        [event.position.x, 0.82, event.position.y],
      );
      net.rotation.x = -Math.PI / 2;
      net.renderOrder = 9_500;
      this.scene.add(net);
      this.effects.push({ object: net, born: performance.now(), duration: 1_500, baseScale: net.scale.clone(), scaleGrowth: 0.18 });
      this.queueHudMessage({
        key: `net:${event.targetId ?? ''}`,
        text: '그물 봉쇄 · 1.5초',
        color: '#fff0a5',
        background: 'rgba(42,31,6,.92)',
        position: event.position,
        duration: 1_500,
        rise: 0.45,
      });
      return;
    }
    if ((event.kind === 'gold' || event.kind === 'power') && event.position && (event.amount ?? 0) > 0) {
      const presentation = resourceHudPresentationForCameraScale(
        this.cameraDistanceScale,
      );
      this.queueHudMessage({
        key: `${event.kind}:${event.label ?? ''}:${event.position.x}:${event.position.y}`,
        text: `${event.kind === 'gold' ? '◆' : '⚡'} +${Math.max(1, Math.round(event.amount ?? 0))}`,
        color: event.kind === 'gold' ? '#ffd36f' : '#75e8ff',
        background: `rgba(5,8,16,${presentation.backgroundAlpha})`,
        position: event.position,
        duration: presentation.duration,
        rise: presentation.rise,
        peakOpacity: presentation.opacity,
      });
      return;
    }
    if (event.kind === 'consumable-use' && event.position) {
      const duration =
        event.itemId === 'scout-flare' || event.itemId === 'path-chalk'
          ? 900
          : 720;
      const color = event.itemId === 'ward-seal' || event.itemId === 'last-latch'
        ? 0xb99aff
        : event.itemId === 'quick-mortar'
          ? 0x76f0b0
          : 0x74ecf2;
      const ring = effectMesh(
        new THREE.RingGeometry(0.2, event.itemId === 'scout-flare' || event.itemId === 'path-chalk' ? 1.25 : 0.48, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
        [event.position.x, 0.06, event.position.y],
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.effects.push({
        object: ring,
        born: performance.now(),
        duration,
        baseScale: ring.scale.clone(),
        scaleGrowth:
          event.itemId === 'scout-flare' || event.itemId === 'path-chalk'
            ? 0.4
            : 0.14,
      });
      return;
    }
    if (event.kind === 'turret-fire' && event.position && event.targetPosition) {
      const born = now;
      const sourceKey = event.sourceId ??
        `${event.position.x}:${event.position.y}:${event.buildingKind ?? ''}`;
      const lastVisualAt = this.lastTurretVisualAt.get(sourceKey) ?? -Infinity;
      if (
        born - lastVisualAt < this.turretVisualInterval() ||
        this.effects.length >= this.effectLimit() ||
        !this.isEffectVisible(event.position)
      )
        return;
      this.lastTurretVisualAt.set(sourceKey, born);
      const from = worldPoint(event.position, 0.58);
      const to = worldPoint(event.targetPosition, 0.9);
      const sourceBuilding = event.sourceId
        ? this.buildingStateById.get(event.sourceId)
        : undefined;
      const skinId = event.itemId || sourceBuilding?.skinId || undefined;
      const visualLevel = sourceBuilding?.effectiveLevel ?? sourceBuilding?.level ?? 1;
      const profile = turretFireVisualProfile(
        skinId,
        event.buildingKind,
        visualLevel,
      );
      const showLevelAccent = this.effectQuality === 'high'
        ? profile.tier >= 1
        : this.effectQuality === 'balanced'
          ? profile.tier >= 2
          : false;
      const showLevelTrail = this.effectQuality === 'high'
        ? profile.tier >= 2
        : this.effectQuality === 'balanced'
          ? profile.tier >= 3
          : false;
      if (skinId === MOONLIT_FOXFIRE_TURRET_SKIN_ID) {
        const direction = to.clone().sub(from);
        const length = direction.length();
        if (length > 0.001) {
          direction.normalize();
          const beam = this.acquireCyberLaser(profile.projectileColor, profile.impactColor);
          if (beam) {
            beam.position.lerpVectors(from, to, 0.5);
            beam.quaternion.setFromUnitVectors(CYBER_LASER_FORWARD, direction);
            beam.scale.set(0.36 * profile.projectileScale, 0.36 * profile.projectileScale, length);
            this.queuePooledEffect(beam, this.cyberLaserPool, {
              born,
              duration: 190 * profile.durationMultiplier,
              baseScale: beam.scale.clone(),
              scaleGrowth: 0,
            });
          }
          const rings = this.effectQuality === 'low' ? 1 : this.effectQuality === 'balanced' ? 2 : 3;
          for (let index = 0; index < rings; index += 1) {
            const impact = this.acquireImpactRing(index % 2 === 0 ? profile.impactColor : profile.projectileColor);
            if (!impact) continue;
            impact.position.copy(to);
            impact.position.y += index * 0.035;
            impact.rotation.x = -Math.PI / 2;
            impact.rotation.z = index * Math.PI / 3;
            impact.scale.setScalar(profile.projectileScale * (0.8 + index * 0.25));
            this.queuePooledEffect(impact, this.impactRingPool, {
              born: born + index * 24,
              duration: 220 + index * 45,
              baseScale: impact.scale.clone(),
              scaleGrowth: profile.impactGrowth * (1.15 + index * 0.2),
            });
          }
        }
      } else if (skinId === SPECIAL_OPS_TRACKER_TURRET_SKIN_ID) {
        const line = this.acquireBeam(profile.projectileColor);
        if (line) {
          const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
          positions.setXYZ(0, from.x, from.y, from.z);
          positions.setXYZ(1, to.x, to.y, to.z);
          positions.needsUpdate = true;
          line.geometry.computeBoundingSphere();
          this.queuePooledEffect(line, this.beamPool, {
            born,
            duration: 125 * profile.durationMultiplier,
            baseScale: line.scale.clone(),
            scaleGrowth: 0,
          });
        }
        if (this.effectQuality !== 'low') {
          const impact = this.acquireImpactRing(profile.impactColor);
          if (impact) {
            impact.position.copy(to);
            impact.rotation.x = -Math.PI / 2;
            impact.scale.setScalar(profile.projectileScale);
            this.queuePooledEffect(impact, this.impactRingPool, {
              born,
              duration: 150,
              baseScale: impact.scale.clone(),
              scaleGrowth: profile.impactGrowth,
            });
          }
        }
      } else if (skinId === CYBERPUNK_LASER_TURRET_SKIN_ID) {
        const direction = to.clone().sub(from);
        const length = direction.length();
        if (length > 0.001) {
          direction.normalize();
          const laser = this.acquireCyberLaser(
            profile.projectileColor,
            profile.impactColor,
          );
          if (laser) {
            laser.position.lerpVectors(from, to, 0.5);
            laser.quaternion.setFromUnitVectors(
              CYBER_LASER_FORWARD,
              direction,
            );
            laser.scale.set(
              0.28 * profile.projectileScale,
              0.28 * profile.projectileScale,
              length,
            );
            this.queuePooledEffect(laser, this.cyberLaserPool, {
              born,
              duration: 135 * profile.durationMultiplier,
              baseScale: laser.scale.clone(),
              scaleGrowth: 0,
            });
          }
          if (this.effectQuality === 'high') {
            const impact = this.acquireImpactRing(profile.projectileColor);
            if (impact) {
              impact.position.copy(to);
              impact.rotation.x = -Math.PI / 2;
              impact.scale.setScalar(profile.projectileScale);
              this.queuePooledEffect(impact, this.impactRingPool, {
                born,
                duration: 180,
                baseScale: impact.scale.clone(),
                scaleGrowth: profile.impactGrowth,
              });
            }
          }
        }
      } else if (skinId === SURFER_WATER_TURRET_SKIN_ID) {
        const direction = to.clone().sub(from).normalize();
        const droplets = this.acquireWaterProjectile();
        if (droplets) {
          droplets.position.copy(from);
          droplets.rotation.y = Math.atan2(direction.x, direction.z);
          droplets.scale.setScalar(profile.projectileScale);
          this.queuePooledEffect(droplets, this.waterProjectilePool, {
            born,
            duration: 235 * profile.durationMultiplier,
            from,
            to,
            baseScale: droplets.scale.clone(),
            scaleGrowth: 0.08,
          });
        }

        if (this.effectQuality !== 'low') {
          const splash = this.acquireWaterSplash();
          if (splash) {
            splash.position.copy(to);
            splash.scale.setScalar(profile.projectileScale);
            this.queuePooledEffect(splash, this.waterSplashPool, {
              born,
              duration: 310,
              baseScale: splash.scale.clone(),
              scaleGrowth: profile.impactGrowth + 0.4,
            });
          }
        }
      } else if (event.buildingKind === 'frost-turret' || event.buildingKind === 'arc-turret' || event.buildingKind === 'electric-coil') {
        const line = this.acquireBeam(profile.projectileColor);
        if (line) {
          const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
          positions.setXYZ(0, from.x, from.y, from.z);
          positions.setXYZ(1, to.x, to.y, to.z);
          positions.needsUpdate = true;
          line.geometry.computeBoundingSphere();
          this.queuePooledEffect(line, this.beamPool, {
            born,
            duration: 190 * profile.durationMultiplier,
            baseScale: line.scale.clone(),
            scaleGrowth: 0,
          });
        }
        if (showLevelAccent) {
          const impact = this.acquireImpactRing(profile.impactColor);
          if (impact) {
            impact.position.copy(to);
            impact.rotation.x = -Math.PI / 2;
            impact.scale.setScalar(profile.projectileScale);
            this.queuePooledEffect(impact, this.impactRingPool, {
              born,
              duration: 150,
              baseScale: impact.scale.clone(),
              scaleGrowth: profile.impactGrowth,
            });
          }
        }
      } else {
        const projectile = this.acquireNormalProjectile(
          event.buildingKind,
          profile.projectileColor,
          profile.projectileScale,
        );
        if (projectile) {
          projectile.position.copy(from);
          this.queuePooledEffect(projectile, this.normalProjectilePool, {
            born,
            duration:
              (event.buildingKind === 'rapid-turret' ? 120 : 210) *
              profile.durationMultiplier,
            from,
            to,
            baseScale: projectile.scale.clone(),
            scaleGrowth: 0.08,
          });
        }
        if (showLevelTrail) {
          const trail = this.acquireBeam(profile.projectileColor);
          if (trail) {
            const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
            positions.setXYZ(0, from.x, from.y, from.z);
            positions.setXYZ(1, to.x, to.y, to.z);
            positions.needsUpdate = true;
            trail.geometry.computeBoundingSphere();
            this.queuePooledEffect(trail, this.beamPool, {
              born,
              duration: 70,
              baseScale: trail.scale.clone(),
              scaleGrowth: 0,
            });
          }
        }
        if (showLevelAccent) {
          const impact = this.acquireImpactRing(profile.impactColor);
          if (impact) {
            impact.position.copy(to);
            impact.rotation.x = -Math.PI / 2;
            impact.scale.setScalar(profile.projectileScale);
            this.queuePooledEffect(impact, this.impactRingPool, {
              born,
              duration: 140,
              baseScale: impact.scale.clone(),
              scaleGrowth: profile.impactGrowth,
            });
          }
        }
      }
      return;
    }
    if (!event.position || !['ghost-hit', 'door-hit', 'player-hit', 'death', 'build', 'upgrade', 'building-remove', 'ghost-level-up', 'ghost-skill'].includes(event.kind)) return;
    const color = event.kind === 'build' ? 0x68efa4 : event.kind === 'building-remove' ? 0xffa067 : event.kind === 'ghost-skill' ? 0xc27bff : 0xff5578;
    if (
      this.effects.length >= this.effectLimit() ||
      !this.isEffectVisible(event.position)
    )
      return;
    const ring = this.acquireImpactRing(color);
    if (!ring) return;
    ring.position.set(event.position.x, 0.7, event.position.y);
    ring.lookAt(this.camera.position);
    this.queuePooledEffect(ring, this.impactRingPool, {
      born: now,
      duration: 340,
      baseScale: ring.scale.clone(),
      scaleGrowth: 1.4,
    });
  }

  private updateCamera(dt: number): void {
    if (this.tutorialCameraFocus) {
      this.desiredCameraTarget.set(
        this.tutorialCameraFocus.x,
        0,
        this.tutorialCameraFocus.y,
      );
      if (
        this.tutorialCameraDistanceScale !== null &&
        Math.abs(
          this.cameraDistanceScale - this.tutorialCameraDistanceScale,
        ) > 0.001
      ) {
        this.cameraDistanceScale = this.tutorialCameraDistanceScale;
        this.updateCameraProjection();
      }
    } else if (this.followingPlayer) {
      const view = this.playerViews.get(this.playerId);
      if (view) this.desiredCameraTarget.set(view.root.position.x, 0, view.root.position.z);
    }
    this.desiredCameraTarget.x = clamp(this.desiredCameraTarget.x, 2.5, this.mapData.width - 3.5);
    this.desiredCameraTarget.z = clamp(this.desiredCameraTarget.z, 2.5, this.mapData.height - 3.5);
    this.cameraTarget.lerp(this.desiredCameraTarget, 1 - Math.exp(-10 * dt));
    // The WebGL world, door HUD and blackout canvas are separate raster
    // layers. Sub-pixel camera positions make each layer choose a different
    // physical pixel on every frame, which looks like the whole scene shakes.
    // Keep the smooth logical target, but render every layer from the same
    // physical-pixel-aligned camera position.
    const renderWidth = Math.max(1, this.host.clientWidth * this.renderPixelRatio);
    const renderHeight = Math.max(1, this.host.clientHeight * this.renderPixelRatio);
    const snappedX = snapCameraCoordinate(
      this.cameraTarget.x,
      Math.abs(this.camera.right - this.camera.left) / renderWidth,
    );
    const snappedZ = snapCameraCoordinate(
      this.cameraTarget.z,
      Math.abs(this.camera.top - this.camera.bottom) / renderHeight,
    );
    this.camera.position.set(
      snappedX,
      CAMERA_HEIGHT,
      snappedZ,
    );
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(snappedX, FLOOR_Y, snappedZ);

    // 카메라만 멀어지고 안개 거리는 고정이면 축소할수록 타일이 안개색에
    // 잠겨 급격히 어두워진다. 조명을 증폭하지 않고 가시거리만 비례해
    // 넓혀 가까운 화면의 명암과 최대 축소 화면의 판독성을 함께 지킨다.
    if (this.scene.fog instanceof THREE.Fog) {
      const hospitalVisibilityBoost = this.theme.id === 'hospital' ? 8 : 0;
      this.scene.fog.near = this.theme.fogNear + CAMERA_HEIGHT - 10 + hospitalVisibilityBoost * 0.45;
      this.scene.fog.far = this.theme.fogFar + CAMERA_HEIGHT - 10 + hospitalVisibilityBoost +
        14 * Math.max(0, this.cameraDistanceScale - 1);
    }
  }

  private projectBlackoutPoint(
    worldX: number,
    worldY: number,
    width: number,
    height: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    target.set(worldX, 0.12, worldY).project(this.camera);
    target.x = (target.x * 0.5 + 0.5) * width;
    target.y = (-target.y * 0.5 + 0.5) * height;
    return target;
  }

  private syncBlackoutRoomRects(roomId: string | null): void {
    if (this.blackoutRoomId === roomId) return;
    this.blackoutRoomId = roomId;
    this.blackoutRoomMask.replaceChildren();
    this.blackoutRoomRects = [];
    if (!roomId) return;
    const room = this.mapRoomById.get(roomId);
    if (!room) return;
    const namespace = 'http://www.w3.org/2000/svg';
    for (const _tile of [...room.floorTiles, room.door]) {
      const rect = document.createElementNS(namespace, 'rect');
      // Keep a small amount of atmospheric tint over the claimed room so it
      // brightens gently instead of becoming a harsh cut-out in a black map.
      rect.setAttribute('fill', '#222');
      rect.setAttribute('rx', '2');
      this.blackoutRoomMask.appendChild(rect);
      this.blackoutRoomRects.push(rect);
    }
  }

  private syncBlackoutLightCircles(count: number): SVGCircleElement[] {
    const neededExtras = Math.max(0, count - 1);
    while (this.blackoutExtraLightCircles.length < neededExtras) {
      const circle = this.blackoutMaskCircle.cloneNode(false);
      if (!(circle instanceof SVGCircleElement)) break;
      circle.removeAttribute('data-blackout-mask-circle');
      circle.setAttribute('data-blackout-light-source', '');
      this.blackoutLightMask.appendChild(circle);
      this.blackoutExtraLightCircles.push(circle);
    }
    while (this.blackoutExtraLightCircles.length > neededExtras) {
      this.blackoutExtraLightCircles.pop()?.remove();
    }
    const circles = [
      this.blackoutMaskCircle,
      ...this.blackoutExtraLightCircles,
    ];
    for (let index = count; index < circles.length; index += 1)
      circles[index]?.setAttribute('r', '0');
    return circles.slice(0, count);
  }

  private syncBlackoutUiRects(count: number): SVGRectElement[] {
    const namespace = 'http://www.w3.org/2000/svg';
    while (this.blackoutUiRects.length < count) {
      const rect = document.createElementNS(namespace, 'rect');
      // Black in the luminance mask means no blackout is painted over this
      // small semantic UI window. It prevents labels from being half-clipped
      // while keeping the surrounding world in darkness.
      rect.setAttribute('fill', '#000');
      rect.setAttribute('rx', '5');
      this.blackoutUiMask.appendChild(rect);
      this.blackoutUiRects.push(rect);
    }
    while (this.blackoutUiRects.length > count) {
      this.blackoutUiRects.pop()?.remove();
    }
    return this.blackoutUiRects;
  }

  private projectBlackoutWorldPoint(
    worldX: number,
    worldY: number,
    worldZ: number,
    width: number,
    height: number,
    target: THREE.Vector3,
  ): THREE.Vector3 {
    target.set(worldX, worldY, worldZ).project(this.camera);
    target.x = (target.x * 0.5 + 0.5) * width;
    target.y = (-target.y * 0.5 + 0.5) * height;
    return target;
  }

  private updateBlackoutSemanticUi(
    roomId: string | null,
    width: number,
    height: number,
  ): void {
    if (!roomId) {
      this.syncBlackoutUiRects(0);
      return;
    }
    const room = this.mapRoomById.get(roomId);
    const local = this.playerStateById.get(this.playerId);
    if (!room || !local) {
      this.syncBlackoutUiRects(0);
      return;
    }
    const windows: Array<{ x: number; y: number; width: number; height: number }> = [];
    const addWindow = (
      x: number,
      y: number,
      z: number,
      windowWidth: number,
      windowHeight: number,
    ) => {
      const point = this.projectBlackoutWorldPoint(
        x,
        y,
        z,
        width,
        height,
        this.blackoutProjectionA,
      );
      windows.push({
        x: point.x - windowWidth / 2,
        y: point.y - windowHeight / 2,
        width: windowWidth,
        height: windowHeight,
      });
    };

    // Preserve the existing door label/HP coordinates exactly; reveal a small
    // window behind them rather than relocating either label.
    const door = this.doorViews.get(roomId);
    const doorState = this.roomStateById.get(roomId);
    if (door && doorState) {
      const metrics = doorHudMetricsForCameraScale(
        this.cameraDistanceScale,
        doorState.doorShieldMaxHp > 0,
      );
      addWindow(
        door.root.position.x,
        0.9,
        door.root.position.z,
        metrics.width + 12,
        metrics.height + 10,
      );
    }
    const localView = this.playerViews.get(local.id);
    if (localView)
      addWindow(
        localView.root.position.x,
        PLAYER_HEIGHT + 0.54,
        localView.root.position.z,
        132,
        34,
      );
    for (const building of this.buildingStateById.values()) {
      if (building.roomId !== roomId) continue;
      const view = this.buildingViews.get(building.id);
      if (view)
        addWindow(view.root.position.x + 0.28, 0.9, view.root.position.z + 0.34, 74, 22);
    }
    const rects = this.syncBlackoutUiRects(windows.length);
    windows.forEach((window, index) => {
      const rect = rects[index];
      if (!rect) return;
      rect.setAttribute('x', window.x.toFixed(2));
      rect.setAttribute('y', window.y.toFixed(2));
      rect.setAttribute('width', window.width.toFixed(2));
      rect.setAttribute('height', window.height.toFixed(2));
    });
  }

  private updateBlackoutMask(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const local = this.playerStateById.get(this.playerId);
    const active = Boolean(
      this.snapshotData.ranked &&
      (
        this.snapshotData.status === 'RANKED_INTRO' ||
        this.snapshotData.status === 'EVENT_INTRO' ||
        this.snapshotData.status === 'GHOST_INTRO' ||
        this.snapshotData.status === 'COUNTDOWN'
      ) && local?.alive,
    );
    const zoomLocked = this.isCameraZoomLocked();
    this.blackoutLayer.classList.toggle('is-active', active);
    this.blackoutLayer.classList.toggle(
      'is-room-lit',
      active && Boolean(local?.roomId),
    );
    this.renderer.domElement.dataset.blackout = active ? 'on' : 'off';
    this.renderer.domElement.dataset.cameraZoomLocked = zoomLocked
      ? 'true'
      : 'false';
    if (!active || !local) {
      this.syncBlackoutRoomRects(null);
      this.syncBlackoutLightCircles(0);
      this.syncBlackoutUiRects(0);
      return;
    }

    this.blackoutSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const rect of [this.blackoutMaskBase, this.blackoutCover]) {
      rect.setAttribute('x', '0');
      rect.setAttribute('y', '0');
      rect.setAttribute('width', String(width));
      rect.setAttribute('height', String(height));
    }

    if (!local.roomId) {
      this.syncBlackoutRoomRects(null);
      this.syncBlackoutUiRects(0);
      const lightPlayers = this.snapshotData.players
        .filter(
          (player) =>
            player.alive &&
            (player.connected || player.isBot) &&
            !player.roomId,
        )
        .sort((left, right) => {
          if (left.id === this.playerId) return -1;
          if (right.id === this.playerId) return 1;
          return left.id.localeCompare(right.id);
        });
      const circles = this.syncBlackoutLightCircles(lightPlayers.length);
      lightPlayers.forEach((player, index) => {
        const circle = circles[index];
        if (!circle) return;
        const rendered = this.playerViews.get(player.id)?.root.position;
        const x = rendered?.x ?? player.position.x;
        const y = rendered?.z ?? player.position.y;
        const center = this.projectBlackoutPoint(
          x,
          y,
          width,
          height,
          this.blackoutProjectionA,
        );
        const edge = this.projectBlackoutPoint(
          x + BLACKOUT_REVEAL_RADIUS_TILES,
          y,
          width,
          height,
          this.blackoutProjectionB,
        );
        circle.setAttribute('cx', center.x.toFixed(2));
        circle.setAttribute('cy', center.y.toFixed(2));
        circle.setAttribute(
          'r',
          Math.max(
            24,
            Math.hypot(edge.x - center.x, edge.y - center.y),
          ).toFixed(2),
        );
      });
      return;
    }

    this.syncBlackoutLightCircles(0);
    this.syncBlackoutRoomRects(local.roomId);
    this.updateBlackoutSemanticUi(local.roomId, width, height);
    const room = this.mapRoomById.get(local.roomId);
    if (!room) return;
    [...room.floorTiles, room.door].forEach((tile, index) => {
      const rect = this.blackoutRoomRects[index];
      if (!rect) return;
      const topLeft = this.projectBlackoutPoint(
        tile.x - 0.54,
        tile.y - 0.54,
        width,
        height,
        this.blackoutProjectionA,
      );
      const bottomRight = this.projectBlackoutPoint(
        tile.x + 0.54,
        tile.y + 0.54,
        width,
        height,
        this.blackoutProjectionB,
      );
      const left = Math.min(topLeft.x, bottomRight.x);
      const top = Math.min(topLeft.y, bottomRight.y);
      rect.setAttribute('x', left.toFixed(2));
      rect.setAttribute('y', top.toFixed(2));
      rect.setAttribute(
        'width',
        Math.abs(bottomRight.x - topLeft.x).toFixed(2),
      );
      rect.setAttribute(
        'height',
        Math.abs(bottomRight.y - topLeft.y).toFixed(2),
      );
    });
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.portraitLayout = height > width;
    this.updateCameraProjection(width, height);
    this.renderer.setSize(width, height, false);
    // All raster layers must share one physical-pixel grid. The old 1.5 DPR
    // HUD over a 2 DPR WebGL scene could never land on the same camera pixels.
    const hudRatio = this.renderPixelRatio;
    this.hudCanvas.width = Math.max(1, Math.round(width * hudRatio));
    this.hudCanvas.height = Math.max(1, Math.round(height * hudRatio));
    this.hudContext.setTransform(hudRatio, 0, 0, hudRatio, 0, 0);
    this.doorHudCanvas.width = Math.max(1, Math.round(width * hudRatio));
    this.doorHudCanvas.height = Math.max(1, Math.round(height * hudRatio));
    this.doorHudContext.setTransform(hudRatio, 0, 0, hudRatio, 0, 0);
    this.updateBlackoutMask();
  }

  private updateCameraProjection(
    width = Math.max(1, this.host.clientWidth),
    height = Math.max(1, this.host.clientHeight),
  ): void {
    const aspect = width / height;
    const portrait = height > width;
    const halfWidth = portrait
      ? (BASE_PORTRAIT_VIEW_WIDTH * this.cameraDistanceScale) / 2
      : (BASE_LANDSCAPE_VIEW_HEIGHT * aspect * this.cameraDistanceScale) / 2;
    const halfHeight = portrait
      ? halfWidth / aspect
      : (BASE_LANDSCAPE_VIEW_HEIGHT * this.cameraDistanceScale) / 2;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private bindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onInputInterrupted);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private unbindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onInputInterrupted);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private cancelPortraitMovement(dispatchStop: boolean): void {
    const activePointerId = this.portraitMovementDrag?.id;
    this.portraitMovementDrag = null;
    this.localInput = { x: 0, y: 0 };
    if (
      activePointerId !== undefined &&
      this.renderer.domElement.hasPointerCapture(activePointerId)
    ) {
      this.renderer.domElement.releasePointerCapture(activePointerId);
    }
    if (dispatchStop) this.dispatchPortraitMovement(0, 0);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    if (
      this.portraitLayout &&
      local?.alive &&
      !local.roomId
    ) {
      if (!event.isPrimary || this.portraitMovementDrag) return;
      event.preventDefault();
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.portraitMovementDrag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        outputX: 0,
        outputY: 0,
        active: false,
      };
      this.dispatchPortraitMovement(0, 0);
      return;
    }
    // 점유 전의 생존자는 카메라가 본인을 추적한다. 사망 뒤에는 관전용으로
    // 드래그/핀치 카메라를 열어 둔다.
    if (!local || (local.alive && !local.roomId)) return;
    event.preventDefault();
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointerPositions.size >= 2) {
      this.cancelBuildingDrag();
      this.drag = null;
      this.gesture = this.currentGesture();
      return;
    }
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    const tile = this.tileAt(event.clientX, event.clientY);
    const building = tile
      ? this.snapshotData.buildings.find(
          (candidate) => candidate.tile.x === tile.x && candidate.tile.y === tile.y,
        )
      : undefined;
    if (
      building &&
      tile &&
      !this.snapshotData.tutorial?.active &&
      building.roomId === local.roomId &&
      building.ownerId === local.id
    ) {
      this.armBuildingDrag(event.pointerId, building, tile, event.clientX, event.clientY);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.portraitMovementDrag?.id === event.pointerId) {
      event.preventDefault();
      const coalesced = event.getCoalescedEvents?.() ?? [];
      const pointer = coalesced[coalesced.length - 1] ?? event;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const radius = clamp(Math.min(rect.width, rect.height) * 0.22, 54, 92);
      let dx = pointer.clientX - this.portraitMovementDrag.startX;
      let dy = pointer.clientY - this.portraitMovementDrag.startY;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude > radius) {
        dx = (dx / magnitude) * radius;
        dy = (dy / magnitude) * radius;
      }
      const drag = this.portraitMovementDrag;
      const deadZone = drag.active ? 4 : 7;
      if (magnitude < deadZone) {
        drag.active = false;
        drag.outputX = 0;
        drag.outputY = 0;
        this.dispatchPortraitMovement(0, 0);
      } else {
        const desiredX = dx / radius;
        const desiredY = dy / radius;
        // Sparse iOS pointer events made the smoothing retain the previous
        // direction after a quick reversal. The avatar then briefly moved
        // opposite to the finger. Use the freshest coalesced sample directly;
        // local/server reconciliation already smooths the rendered motion.
        drag.outputX = desiredX;
        drag.outputY = desiredY;
        drag.active = true;
        this.dispatchPortraitMovement(drag.outputX, drag.outputY);
      }
      return;
    }
    if (!this.pointerPositions.has(event.pointerId)) return;
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointerPositions.size >= 2) {
      this.cancelBuildingDrag();
      const next = this.currentGesture();
      if (next && this.gesture) {
        if (this.gesture.distance > 0) this.zoomBy(next.distance / this.gesture.distance);
      }
      this.gesture = next;
      return;
    }
    const candidate = this.buildingDragCandidate;
    if (
      candidate?.pointerId === event.pointerId &&
      Math.hypot(event.clientX - candidate.startX, event.clientY - candidate.startY) > BUILDING_DRAG_CANCEL_DISTANCE
    ) {
      this.cancelBuildingDragHold();
    }
    if (this.buildingDrag?.pointerId === event.pointerId) {
      const tile = this.tileAt(event.clientX, event.clientY);
      if (tile) this.previewBuildingDrag(tile);
      return;
    }
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 7) this.drag.moved = true;
    if (!this.drag.moved) return;
    if (this.snapshotData.tutorial?.active) return;
    const panScale = 0.015 * this.cameraDistanceScale;
    this.desiredCameraTarget.x -= dx * panScale;
    this.desiredCameraTarget.z -= dy * panScale;
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.portraitMovementDrag?.id === event.pointerId) {
      event.preventDefault();
      this.portraitMovementDrag = null;
      this.dispatchPortraitMovement(0, 0);
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (!this.pointerPositions.has(event.pointerId)) return;
    event.preventDefault();
    const activeBuildingDrag = this.buildingDrag?.pointerId === event.pointerId
      ? this.buildingDrag
      : null;
    this.cancelBuildingDragHold();
    const wasGesture = this.pointerPositions.size > 1 || this.gesture !== null;
    const moved = this.drag?.id === event.pointerId ? this.drag.moved : wasGesture;
    this.pointerPositions.delete(event.pointerId);
    this.gesture = this.pointerPositions.size >= 2 ? this.currentGesture() : null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const remaining = this.pointerPositions.entries().next().value as [number, { x: number; y: number }] | undefined;
    this.drag = remaining
      ? { id: remaining[0], x: remaining[1].x, y: remaining[1].y, moved: true }
      : null;
    if (activeBuildingDrag) {
      this.finishBuildingDrag(activeBuildingDrag, event.type !== 'pointercancel');
      return;
    }
    if (!moved && !wasGesture && event.button !== 2) this.selectAt(event.clientX, event.clientY);
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    if (this.portraitMovementDrag?.id === event.pointerId) {
      this.cancelPortraitMovement(true);
    }
  };

  private readonly onInputInterrupted = (): void => {
    this.cancelPortraitMovement(true);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') this.cancelPortraitMovement(true);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private tileAt(clientX: number, clientY: number): Tile | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.selectionSurface, false)[0];
    return hit ? { x: Math.round(hit.point.x), y: Math.round(hit.point.z) } : null;
  }

  private armBuildingDrag(
    pointerId: number,
    building: BuildingState,
    sourceTile: Tile,
    startX: number,
    startY: number,
  ): void {
    this.cancelBuildingDrag();
    const candidate: BuildingDragCandidate = {
      pointerId,
      buildingId: building.id,
      roomId: building.roomId,
      sourceTile: { ...sourceTile },
      startX,
      startY,
    };
    this.buildingDragCandidate = candidate;
    this.buildingDragTimer = window.setTimeout(() => {
      if (this.buildingDragCandidate !== candidate || !this.pointerPositions.has(pointerId) || this.gesture) return;
      const local = this.snapshotData.players.find((player) => player.id === this.playerId);
      const current = this.snapshotData.buildings.find((entry) => entry.id === building.id);
      if (!local?.alive || local.roomId !== candidate.roomId || current?.ownerId !== local.id) {
        this.cancelBuildingDragHold();
        return;
      }
      this.buildingDragTimer = null;
      this.buildingDragCandidate = null;
      this.buildingDrag = { ...candidate, targetTile: { ...candidate.sourceTile } };
      if (this.drag?.id === pointerId) this.drag.moved = true;
      this.highlight(candidate.sourceTile);
      window.dispatchEvent(new CustomEvent('dorm:building-drag-start'));
    }, BUILDING_DRAG_HOLD_MS);
  }

  private cancelBuildingDragHold(): void {
    if (this.buildingDragTimer !== null) window.clearTimeout(this.buildingDragTimer);
    this.buildingDragTimer = null;
    this.buildingDragCandidate = null;
  }

  private cancelBuildingDrag(): void {
    this.cancelBuildingDragHold();
    if (this.buildingDrag) {
      const view = this.buildingViews.get(this.buildingDrag.buildingId);
      if (view) view.root.position.copy(worldPoint(this.buildingDrag.sourceTile));
    }
    this.buildingDrag = null;
    this.selectionMarker.visible = false;
  }

  private previewBuildingDrag(tile: Tile): void {
    const active = this.buildingDrag;
    const room = active
      ? this.mapData.rooms.find((candidate) => candidate.id === active.roomId)
      : undefined;
    if (!active || !room || !room.buildTiles.some((buildTile) => buildTile.x === tile.x && buildTile.y === tile.y)) return;
    active.targetTile = { x: tile.x, y: tile.y };
    const view = this.buildingViews.get(active.buildingId);
    if (view) view.root.position.copy(worldPoint(active.targetTile));
    this.highlight(active.targetTile);
  }

  private finishBuildingDrag(active: BuildingDrag, commit: boolean): void {
    const view = this.buildingViews.get(active.buildingId);
    if (view) view.root.position.copy(worldPoint(active.sourceTile));
    this.buildingDrag = null;
    this.selectionMarker.visible = false;
    if (
      !commit ||
      (active.sourceTile.x === active.targetTile.x && active.sourceTile.y === active.targetTile.y)
    )
      return;
    window.dispatchEvent(
      new CustomEvent('dorm:building-move', {
        detail: {
          buildingId: active.buildingId,
          roomId: active.roomId,
          tile: active.targetTile,
        },
      }),
    );
  }

  private currentGesture(): MultiTouchGesture | null {
    const points = [...this.pointerPositions.values()];
    const first = points[0];
    const second = points[1];
    if (!first || !second) return null;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return { distance: Math.hypot(dx, dy) };
  }

  private dispatchPortraitMovement(screenX: number, screenY: number): void {
    if (!screenX && !screenY) {
      window.dispatchEvent(new CustomEvent<Vec2>('dorm:portrait-move', { detail: { x: 0, y: 0 } }));
      return;
    }
    const magnitude = Math.hypot(screenX, screenY);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    window.dispatchEvent(new CustomEvent<Vec2>('dorm:portrait-move', {
      detail: { x: screenX * scale, y: screenY * scale },
    }));
  }

  private selectAt(clientX: number, clientY: number): void {
    const now = performance.now();
    if (now < this.selectionBlockedUntil) return;
    if (now - this.lastSelectionAt < TAP_GLOBAL_DEBOUNCE_MS) return;
    const tile = this.tileAt(clientX, clientY);
    if (!tile) return;
    const selectionKey = `${tile.x}:${tile.y}`;
    if (selectionKey === this.lastSelectionKey && now - this.lastSelectionAt < TAP_SAME_TILE_DEBOUNCE_MS) return;
    this.lastSelectionKey = selectionKey;
    this.lastSelectionAt = now;
    const building = this.snapshotData.buildings.find((candidate) => candidate.tile.x === tile.x && candidate.tile.y === tile.y);
    if (building) {
      if (
        this.snapshotData.tutorial?.active &&
        !(
          this.snapshotData.tutorial.step === "upgrade-turret" &&
          building.kind === "basic-turret" &&
          building.ownerId === this.playerId
        )
      )
        return;
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'building', targetId: building.id, buildingId: building.id, roomId: building.roomId } }));
      return;
    }
    const bedTarget = this.mapData.rooms.flatMap((room) => room.beds.map((bed, bedIndex) => ({ room, bed, bedIndex })))
      .find(({ bed }) => bed.x === tile.x && bed.y === tile.y);
    if (bedTarget) {
      if (
        this.snapshotData.tutorial?.active &&
        this.snapshotData.tutorial.step !== "upgrade-bed"
      )
        return;
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'bed', targetId: `bed:${bedTarget.room.id}:${bedTarget.bedIndex}`, roomId: bedTarget.room.id } }));
      return;
    }
    const doorRoom = this.mapData.rooms.find((room) => room.door.x === tile.x && room.door.y === tile.y);
    if (doorRoom) {
      if (
        this.snapshotData.tutorial?.active &&
        this.snapshotData.tutorial.step !== "upgrade-door"
      )
        return;
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'door', targetId: `door:${doorRoom.id}`, roomId: doorRoom.id } }));
      return;
    }
    const room = this.mapData.rooms.find((candidate) => candidate.buildTiles.some((buildTile) => buildTile.x === tile.x && buildTile.y === tile.y));
    if (!room) {
      if (this.mapData.corridorTiles.some((candidate) => candidate.x === tile.x && candidate.y === tile.y)) {
        window.dispatchEvent(new CustomEvent<Tile>('dorm:ground-tile-selected', { detail: { ...tile } }));
      }
      return;
    }
    const selectedTile: Tile = { ...tile, roomId: room.id };
    if (this.snapshotData.tutorial?.active) {
      const local = this.snapshotData.players.find(
        (player) => player.id === this.playerId,
      );
      const guided =
        local &&
        tutorialGuidedBuildTile(
          this.mapData,
          this.snapshotData.buildings,
          room.id,
          this.snapshotData.tutorial.step,
          local.id,
        );
      if (!guided || guided.x !== tile.x || guided.y !== tile.y) return;
    }
    this.highlight(tile);
    window.dispatchEvent(new CustomEvent<Tile>('dorm:tile-selected', { detail: selectedTile }));
  }

  private highlight(tile: Vec2): void {
    this.selectionMarker.position.set(tile.x, 0.06, tile.y);
    this.selectionMarker.visible = true;
  }
}
