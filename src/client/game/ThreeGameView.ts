import * as THREE from 'three';
import { BALANCE, buildingStats, maxBuildingLevel, upgradeCost, upgradeRequirement } from '../../shared/balance';
import { isEliteRank, rankBadgeImage, rankBenefits, rankLabel, rankLabelGradient } from '../../shared/progression';
import { fullRoomFloorKeys, moveInWalkableArea, tileKey } from '../../shared/map';
import { findPath } from '../../shared/pathfinding';
import { combinedItemEffects } from '../../shared/randomItems';
import { characterTraitForAppearance } from '../../shared/characterTraits';
import { doorVisualForLevel } from '../../shared/doorVisuals';
import { stageThemeFor, type StageTheme } from '../../shared/stageThemes';
import type { AvatarAppearance, BuildingKind, BuildingState, GameEvent, GameSnapshot, GhostState, MapDefinition, PlayerState, RankId, Tile, TurretKind, Vec2 } from '../../shared/types';
import { AtlasSpriteActor, ghostAttackDuration, ghostSpriteDefinition, survivorSpriteDefinition } from './AtlasSpriteActor';
import { buildingAssetUrl } from './BuildingAssets';

const CAMERA_HEIGHT = 18;
const BASE_PORTRAIT_VIEW_WIDTH = 8.4;
const BASE_LANDSCAPE_VIEW_HEIGHT = 8.4;
const MIN_CAMERA_DISTANCE_SCALE = 2 / 3;
const MAX_CAMERA_DISTANCE_SCALE = 1.6;
const FLOOR_Y = 0;
const PLAYER_HEIGHT = 1.27;
const FRAME_DT_MAX = 1 / 15;
const TAP_GLOBAL_DEBOUNCE_MS = 300;
const TAP_SAME_TILE_DEBOUNCE_MS = 520;
const BUILDING_DRAG_HOLD_MS = 380;
const BUILDING_DRAG_CANCEL_DISTANCE = 10;
const LOCAL_SOFT_RECONCILE_DISTANCE = 0.9;
const LOCAL_HARD_RECONCILE_DISTANCE = 1.5;
const buildingTextureLoader = new THREE.TextureLoader();
const buildingTextureCache = new Map<string, THREE.Texture>();
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
  minion: 0x8dff64,
};

function cachedBuildingTexture(url: string): THREE.Texture {
  let texture = buildingTextureCache.get(url);
  if (texture) return texture;
  texture = buildingTextureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The generated PNGs have soft transparent edges. Premultiplying before
  // filtering prevents transparent black RGB values from forming a halo.
  texture.premultiplyAlpha = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  buildingTextureCache.set(url, texture);
  return texture;
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
  badgeRank: RankId;
  target: THREE.Vector3;
  lastPosition: THREE.Vector3;
  seed: number;
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
}

interface BuildingView {
  root: THREE.Group;
  barrel: THREE.Group | null;
  level: THREE.Sprite;
  upgrade: THREE.Sprite;
  modelLevel: number;
  skinId: string;
}

interface DoorView {
  root: THREE.Group;
  panel: THREE.Group;
  surface: THREE.Mesh;
  frame: THREE.Mesh;
  details: THREE.Group;
  hp: THREE.Sprite;
  label: THREE.Sprite;
  upgrade: THREE.Sprite;
  closedTarget: number;
  closedAmount: number;
  visualLevel: number;
}

interface BedView {
  root: THREE.Group;
  upgrade: THREE.Sprite;
  roomId: string;
  bedIndex: number;
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

const rankBadgeTextures = new Map<RankId, THREE.Texture>();

function rankBadgeTexture(rank: RankId): THREE.Texture {
  let texture = rankBadgeTextures.get(rank);
  if (!texture) {
    texture = new THREE.TextureLoader().load(rankBadgeImage(rank));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    rankBadgeTextures.set(rank, texture);
  }
  return texture;
}

function makeRankBadge(rank: RankId): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: rankBadgeTexture(rank),
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.scale.set(0.38, 0.38, 1);
  sprite.renderOrder = 10_030;
  return sprite;
}

function updateRankBadge(sprite: THREE.Sprite, rank: RankId): void {
  const material = sprite.material as THREE.SpriteMaterial;
  if (material.map === rankBadgeTexture(rank)) return;
  material.map = rankBadgeTexture(rank);
  material.needsUpdate = true;
}

function updateTextBillboard(
  sprite: THREE.Sprite,
  key: string,
  text: string,
  color = '#ffffff',
  background = 'rgba(5,8,17,.78)',
  gradient: readonly [string, string, string] | null = null,
): void {
  const data = sprite.userData.billboard as BillboardData;
  if (data.key === key) return;
  data.key = key;
  const { canvas, context } = data;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = background;
  context.beginPath();
  context.roundRect(10, 18, canvas.width - 20, canvas.height - 36, 38);
  context.fill();
  context.strokeStyle = 'rgba(210,232,255,.34)';
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = gradient
    ? (() => {
      const fill = context.createLinearGradient(82, 0, canvas.width - 82, 0);
      fill.addColorStop(0, gradient[0]);
      fill.addColorStop(0.5, gradient[1]);
      fill.addColorStop(1, gradient[2]);
      return fill;
    })()
    : color;
  context.font = '800 42px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(0,0,0,.8)';
  context.shadowBlur = 10;
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  data.texture.needsUpdate = true;
}

function updateBarBillboard(sprite: THREE.Sprite, key: string, ratio: number, label: string, color: string): void {
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
  context.font = '900 34px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = '#000';
  context.shadowBlur = 8;
  context.fillText(label, canvas.width / 2, 65);
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
    'starter-grave': 0x8b97a5,
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

export function createBuildingModel(building: BuildingState): { root: THREE.Group; barrel: THREE.Group | null } {
  const root = new THREE.Group();
  const imageAsset = buildingAssetUrl(building.kind, building.level);
  if (imageAsset) {
    // A room can contain many copies of the same building. Reusing the GPU
    // texture avoids a new decode/upload for every installation and removes
    // the frame drops that appeared once a room was built out.
    const texture = cachedBuildingTexture(imageAsset);
    const art = mesh(
      // The art itself now uses a tight silhouette. Let it almost fill one
      // tile so a turret, repair stand, or generator is identifiable without
      // opening its detail panel.
      new THREE.PlaneGeometry(1.2, 1.2),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        premultipliedAlpha: false,
        alphaTest: 0.025,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      [0, 0.105, 0],
    );
    // Guardian art is authored with the single barrel pointing toward the
    // bottom of the tile. Its circular base lets this pivot visibly track a
    // target while the tile anchor and HUD remain fixed.
    const artPivot = new THREE.Group();
    art.rotation.x = -Math.PI / 2;
    art.renderOrder = 5;
    artPivot.add(art);
    root.add(artPivot);
    root.userData.renderMode = 'building-image';
    root.userData.imageAsset = imageAsset;
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
  private readonly sleepButton: HTMLButtonElement;
  private readonly onSleep: () => void;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionSurface: THREE.Mesh;
  private readonly playerViews = new Map<string, PlayerView>();
  private readonly ghostViews = new Map<string, GhostView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly doorViews = new Map<string, DoorView>();
  private readonly bedViews = new Map<string, BedView>();
  private readonly effects: TimedEffect[] = [];
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly selectionMarker: THREE.Mesh;
  private readonly buildTileMarkers = new Map<string, THREE.Group>();
  private readonly environmentTextures: THREE.Texture[] = [];
  private readonly pointerPositions = new Map<number, { x: number; y: number }>();
  private localInput: Vec2 = { x: 0, y: 0 };
  private drag: PointerDrag | null = null;
  private gesture: MultiTouchGesture | null = null;
  private portraitMovementDrag: PortraitMovementDrag | null = null;
  private buildingDragCandidate: BuildingDragCandidate | null = null;
  private buildingDrag: BuildingDrag | null = null;
  private buildingDragTimer: number | null = null;
  private followingPlayer = true;
  private focusedRoomId: string | null = null;
  private cameraDistanceScale = 1;
  private portraitLayout = false;
  private lastFrame = performance.now();
  private lastSelectionAt = 0;
  private lastSelectionKey = '';
  private selectionBlockedUntil = 0;
  private paused = false;
  private destroyed = false;

  constructor(host: HTMLElement, payload: ViewPayload) {
    this.host = host;
    this.mapData = payload.map;
    this.playerId = payload.playerId;
    this.snapshotData = payload.snapshot;
    this.onSleep = payload.onSleep ?? (() => undefined);
    this.portraitLayout = host.clientHeight > host.clientWidth;
    this.theme = stageThemeFor(payload.snapshot.stageId);
    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.Fog(this.theme.fog, this.theme.fogNear, this.theme.fogFar);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    // 1.2x was being upscaled heavily on high-DPR Android screens, turning
    // tile textures and the building PNGs into a soft, low-resolution image.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.dataset.renderer = 'orthographic-2d';
    this.renderer.domElement.dataset.actorRenderer = 'atlas-sprites';
    this.renderer.domElement.dataset.surfaceRenderer = 'image-textures';
    this.renderer.domElement.dataset.theme = this.theme.id;
    this.renderer.domElement.style.touchAction = 'none';
    this.host.appendChild(this.renderer.domElement);
    this.sleepButton = document.createElement('button');
    this.sleepButton.type = 'button';
    this.sleepButton.className = 'sleep-nearby';
    this.sleepButton.innerHTML = '<span aria-hidden="true">☾</span> 잠자기';
    this.sleepButton.setAttribute('aria-label', '가까운 침대에서 잠자기');
    this.sleepButton.hidden = true;
    this.sleepButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onSleep();
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

  setLocalInput(input: Vec2): void { this.localInput = input; }

  getCameraMode(): 'follow' | 'free' { return this.followingPlayer ? 'follow' : 'free'; }

  getCameraZoom(): number { return Math.round((1 / this.cameraDistanceScale) * 100) / 100; }

  /** 수직 2D 카메라는 북쪽 고정이며 테스트 API에는 0으로 노출한다. */
  getCameraYaw(): number { return 0; }

  focusLocalPlayer(): void {
    this.focusPlayer(this.playerId);
  }

  focusPlayer(playerId: string): void {
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

  zoomBy(magnificationFactor: number): void {
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
    this.syncPlayers(snapshot.players);
    this.syncGhosts(snapshot.ghosts ?? [snapshot.ghost]);
    this.syncBeds(snapshot);
    this.syncBuildings(snapshot);
    this.syncDoors(snapshot);
    this.syncBuildableTiles(performance.now());
    for (const event of events) this.playEvent(event);

    const local = snapshot.players.find((player) => player.id === this.playerId);
    if (!local?.alive) {
      // 사망 뒤에는 관전 상태이므로 마지막 위치에 카메라를 고정하지 않는다.
      this.followingPlayer = false;
      this.focusedRoomId = null;
    } else if (!local.roomId) {
      this.followingPlayer = true;
      this.focusedRoomId = null;
    } else if (local.roomId) {
      const roomChanged = this.focusedRoomId !== local.roomId;
      this.followingPlayer = false;
      if (roomChanged) {
        this.desiredCameraTarget.copy(worldPoint(local.position));
        this.cameraTarget.copy(this.desiredCameraTarget);
      }
      this.focusedRoomId = local.roomId;
    }
    this.updateSleepPrompt();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.cancelBuildingDrag();
    this.unbindInput();
    for (const view of this.playerViews.values()) view.actor.dispose();
    for (const view of this.ghostViews.values()) view.actor.dispose();
    this.playerViews.clear();
    this.ghostViews.clear();
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
    for (const texture of this.environmentTextures) texture.dispose();
    this.environmentTextures.length = 0;
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.sleepButton.remove();
  }

  private readonly animate = (time: number): void => {
    if (this.destroyed || this.paused) return;
    const dt = Math.min(FRAME_DT_MAX, Math.max(0.001, (time - this.lastFrame) / 1_000));
    this.lastFrame = time;
    this.animatePlayers(time, dt);
    this.animateGhosts(time, dt);
    this.animateTurrets(dt);
    this.animateDoors(dt);
    this.animateEffects(time);
    this.syncBuildableTiles(time);
    this.updateCamera(dt);
    this.updateSleepPrompt();
    this.renderer.render(this.scene, this.camera);
  };

  private updateSleepPrompt(): void {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    if (
      !local?.alive ||
      local.roomId ||
      (this.snapshotData.status !== 'COUNTDOWN' && this.snapshotData.status !== 'PLAYING')
    ) {
      this.sleepButton.hidden = true;
      return;
    }
    const roomCapacity = this.snapshotData.playMode === 'multiplayer' ? 2 : 1;
    const nearest = this.mapData.rooms
      .flatMap((mapRoom) => {
        const room = this.snapshotData.rooms.find((candidate) => candidate.id === mapRoom.id);
        if (!room || room.ownerIds.length >= roomCapacity) return [];
        return mapRoom.beds
          .map((bed, bedIndex) => ({ bed, bedIndex, room }))
          .filter(({ bedIndex, room }) =>
            !room.ownerIds.some((ownerId) =>
              this.snapshotData.players.some(
                (player) => player.id === ownerId && player.bedIndex === bedIndex,
              ),
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
      .filter((candidate) => candidate.distance <= BALANCE.player.interactionRange)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!nearest) {
      this.sleepButton.hidden = true;
      return;
    }
    const screen = worldPoint(nearest.bed, 0.35).project(this.camera);
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const x = (screen.x * 0.5 + 0.5) * width;
    const y = (-screen.y * 0.5 + 0.5) * height;
    this.sleepButton.style.left = `${clamp(x + 52, 64, width - 64)}px`;
    this.sleepButton.style.top = `${clamp(y - 24, 76, height - 58)}px`;
    this.sleepButton.hidden = false;
  }

  private createLighting(): void {
    this.scene.add(new THREE.HemisphereLight(this.theme.hemisphereSky, this.theme.hemisphereGround, 2.05));
    const moon = new THREE.DirectionalLight(this.theme.moon, 3.65);
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
    this.addTileInstances(roomTiles, roomTexture, 0.003);

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
    const texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.environmentTextures.push(texture);
    return texture;
  }

  private addTileInstances(
    tiles: Tile[],
    texture: THREE.Texture,
    y: number,
  ): void {
    // Room and corridor each have authored art. Keep it at its source color
    // on every device; no theme-specific colour fallback or lighting tint.
    const geometry = new THREE.BoxGeometry(0.98, 0.08, 0.98);
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
  }

  private syncBuildableTiles(time: number): void {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
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
    const pulse = 0.5 + Math.sin(time * 0.006) * 0.5;
    for (const [key, marker] of this.buildTileMarkers) {
      const active = available.has(key);
      marker.visible = active;
      if (!active) continue;
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
      bed.add(upgrade);
      this.scene.add(bed);
      this.bedViews.set(`${room.id}:${index}`, { root: bed, upgrade, roomId: room.id, bedIndex: index });
    });
  }

  private syncBeds(snapshot: GameSnapshot): void {
    const local = snapshot.players.find((player) => player.id === this.playerId);
    const rank = snapshot.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
    for (const view of this.bedViews.values()) {
      const room = snapshot.rooms.find((candidate) => candidate.id === view.roomId);
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

  private syncPlayers(players: PlayerState[]): void {
    const active = new Set(players.map((player) => player.id));
    for (const player of players) {
      let view = this.playerViews.get(player.id);
      const appearanceKey = [player.appearance.character, player.appearance.skin].join('|');
      if (view && view.appearanceKey !== appearanceKey) {
        this.scene.remove(view.root);
        view.actor.dispose();
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
        const label = makeBillboard();
        label.scale.set(2.16, 0.59, 1);
        label.position.set(0.1, PLAYER_HEIGHT + 0.36, -0.72);
        const badge = makeRankBadge(player.displayRank);
        badge.position.set(-1.02, PLAYER_HEIGHT + 0.36, -0.75);
        root.add(label, badge);
        this.scene.add(root);
        view = {
          root,
          actor,
          characterId: player.appearance.character,
          appearanceKey,
          label,
          badge,
          badgeRank: player.displayRank,
          target: worldPoint(player.position),
          lastPosition: worldPoint(player.position),
          seed: player.id.length * 0.71,
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
      const elite = isEliteRank(player.displayRank);
      if (view.badgeRank !== player.displayRank) {
        updateRankBadge(view.badge, player.displayRank);
        view.badgeRank = player.displayRank;
      }
      updateTextBillboard(
        view.label,
        `${player.displayRank}:${player.nickname}`,
        `${rankLabel(player.displayRank)} · ${player.nickname}`,
        elite ? '#ecc9ff' : '#ffffff',
        'rgba(5,8,17,.78)',
        rankLabelGradient(player.displayRank),
      );
      setObjectOpacity(view.root, player.alive ? (player.connected ? 1 : 0.52) : 0.2);
    }
    for (const [id, view] of this.playerViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      view.actor.dispose();
      this.playerViews.delete(id);
    }
  }

  private syncGhosts(ghosts: GhostState[]): void {
    const active = new Set(ghosts.map((ghost) => ghost.id));
    for (const ghost of ghosts) {
      let view = this.ghostViews.get(ghost.id);
      if (view && view.variant !== ghost.variant) {
        this.scene.remove(view.root);
        view.actor.dispose();
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
        root.add(label, hp);
        const light = new THREE.PointLight(GHOST_GLOW_COLORS[ghost.variant], ghost.variant === 'giant' ? 1.7 : 0.9, ghost.variant === 'giant' ? 5.2 : 3.2, 2);
        light.position.y = 1.2;
        root.add(light);
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
        };
        this.ghostViews.set(ghost.id, view);
      }
      view.target.copy(worldPoint(ghost.position));
      const netted = this.snapshotData.elapsed < ghost.stunnedUntil;
      updateTextBillboard(view.label, `${ghost.displayName}:${ghost.level}:${netted}`, `${ghost.displayName} · Lv.${ghost.level}${netted ? ' · 그물' : ''}`, netted ? '#fff0a5' : '#ffb4c2', 'rgba(25,4,12,.84)');
      const ratio = ghost.hp / Math.max(1, ghost.maxHp);
      updateBarBillboard(view.hp, `${Math.ceil(ghost.hp)}:${Math.ceil(ghost.maxHp)}:${ghost.retreating}`, ratio, `${Math.ceil(ghost.hp)} / ${Math.ceil(ghost.maxHp)}`, ghost.retreating ? '#8494bb' : '#ff315f');
      setObjectOpacity(view.root, ghost.hp > 0 ? (ghost.healing ? 0.62 : 1) : 0.08);
    }
    for (const [id, view] of this.ghostViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      view.actor.dispose();
      this.ghostViews.delete(id);
    }
  }

  private syncBuildings(snapshot: GameSnapshot): void {
    const buildings = snapshot.buildings;
    const local = snapshot.players.find((player) => player.id === this.playerId);
    const rank = snapshot.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
    const active = new Set(buildings.map((building) => building.id));
    for (const building of buildings) {
      let view = this.buildingViews.get(building.id);
      if (
        view &&
        (view.modelLevel !== building.level || view.skinId !== building.skinId)
      ) {
        this.scene.remove(view.root);
        this.buildingViews.delete(building.id);
        view = undefined;
      }
      if (!view) {
        const model = createBuildingModel(building);
        model.root.position.copy(worldPoint(building.tile));
        const level = makeBillboard();
        level.scale.set(0.8, 0.28, 1);
        level.position.set(0.35, 0.9, 0.34);
        const upgrade = makeBillboard(192, 192);
        // 탑다운 화면에서는 건물 위쪽으로 빼면 화살표가 옆 타일로 밀려 보인다.
        // 작은 오버레이로 건물 중앙에 겹쳐 두어, 유령기숙사처럼 즉시 알아볼 수 있게 한다.
        upgrade.scale.set(0.42, 0.42, 1);
        upgrade.position.set(0, 0.48, 0);
        model.root.add(level, upgrade);
        this.scene.add(model.root);
        view = {
          root: model.root,
          barrel: model.barrel,
          level,
          upgrade,
          modelLevel: building.level,
          skinId: building.skinId,
        };
        this.buildingViews.set(building.id, view);
      }
      // Building movement and swaps are authoritative on the server. Updating
      // existing view roots here lets the next snapshot move both sides of a
      // swap without rebuilding their models or textures.
      if (this.buildingDrag?.buildingId !== building.id) {
        view.root.position.copy(worldPoint(building.tile));
      }
      updateTextBillboard(view.level, `${building.level}`, `Lv.${building.level}`, '#ffffff', 'rgba(8,12,24,.9)');
      const nextCost =
        building.level < maxBuildingLevel(building.kind, rank ?? 'beginner')
          ? upgradeCost(building.kind, building.level + 1, rank ?? 'beginner')
          : null;
      const room = snapshot.rooms.find((candidate) => candidate.id === building.roomId);
      const requirement = upgradeRequirement(building.kind, building.level, {
        bedLevel: room?.bedLevels[local?.bedIndex ?? 0] ?? 1,
        doorLevel: room?.doorLevel ?? 1,
      });
      const isUpgradeable = Boolean(
        nextCost && !requirement && local?.alive && local.roomId === building.roomId,
      );
      const canAffordUpgrade = Boolean(
        nextCost &&
          local &&
          local.gold >= nextCost.gold &&
          local.power >= nextCost.power,
      );
      const canUpgrade = isUpgradeable && canAffordUpgrade;
      view.upgrade.visible = canUpgrade;
      if (canUpgrade) {
        updateUpgradeBillboard(view.upgrade, `${building.level}:ready`, true);
      }
    }
    for (const [id, view] of this.buildingViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      this.buildingViews.delete(id);
    }
  }

  private syncDoors(snapshot: GameSnapshot): void {
    for (const state of snapshot.rooms) {
      const room = this.mapData.rooms.find((candidate) => candidate.id === state.id);
      if (!room) continue;
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
        const hp = makeBillboard();
        hp.scale.set(1.72, 0.42, 1);
        hp.position.set(0, 0.82, -0.62);
        hp.renderOrder = 11_100;
        const label = makeBillboard();
        label.scale.set(1.4, 0.38, 1);
        label.position.set(0, 0.92, -1.16);
        label.renderOrder = 11_110;
        const upgrade = makeBillboard(192, 192);
        upgrade.scale.set(0.42, 0.42, 1);
        upgrade.position.set(0, 0.48, 0);
        upgrade.renderOrder = 11_200;
        upgrade.visible = false;
        hud.add(hp, label, upgrade);
        root.add(hud);
        this.scene.add(root);
        const closed = state.ownerIds.length > 0 ? 1 : 0;
        panel.scale.x = 0.18 + closed * 0.82;
        view = {
          root,
          panel,
          surface,
          frame,
          details,
          hp,
          label,
          upgrade,
          closedTarget: closed,
          closedAmount: closed,
          visualLevel: 0,
        };
        applyDoorVisual(view, state.doorLevel);
        this.doorViews.set(room.id, view);
      }
      const intact = state.doorHp > 0;
      const ratio = state.doorHp / Math.max(1, state.doorMaxHp);
      view.closedTarget = state.ownerIds.length > 0 ? 1 : 0;
      view.panel.visible = intact;
      if (view.visualLevel !== state.doorLevel) applyDoorVisual(view, state.doorLevel);
      updateTextBillboard(view.label, `${state.doorLevel}`, `문 Lv.${state.doorLevel} · ${doorVisualForLevel(state.doorLevel).label}`, '#d8f8ff');
      updateBarBillboard(view.hp, `${Math.ceil(state.doorHp)}:${Math.ceil(state.doorMaxHp)}:${intact}`, ratio, intact ? `${Math.ceil(state.doorHp)} / ${Math.ceil(state.doorMaxHp)}` : '파괴됨', ratio > 0.5 ? '#55dfa0' : ratio > 0.22 ? '#ffc85f' : '#ff5578');
      const local = snapshot.players.find((player) => player.id === this.playerId);
      const rank = snapshot.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
      const nextCost = intact && state.doorLevel < maxBuildingLevel('reinforced-door', rank ?? 'beginner')
        ? upgradeCost('reinforced-door', state.doorLevel + 1, rank ?? 'beginner')
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
    for (const view of this.doorViews.values()) {
      view.closedAmount = damp(view.closedAmount, view.closedTarget, 8.5, dt);
      view.panel.scale.x = 0.18 + view.closedAmount * 0.82;
      view.panel.position.x = (1 - view.closedAmount) * 0.34;
    }
  }

  private animatePlayers(time: number, dt: number): void {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    const localRank = this.snapshotData.playMode === 'solo' ? local?.soloRank : local?.multiplayerRank;
    const localSpeed = BALANCE.player.speed
      * rankBenefits(localRank ?? 'beginner').speedMultiplier
      * combinedItemEffects(local?.items ?? []).moveSpeedMultiplier
      * characterTraitForAppearance(local?.appearance ?? { character: 'character-bunny', skin: 'skin-basic-bunny' }).unclaimedMoveSpeedMultiplier
      * (this.snapshotData.elapsed < (local?.speedBoostUntil ?? 0) ? 1.45 : 1);
    // The authoritative worker blocks full-room floor tiles for unclaimed
    // survivors.  Applying the exact same boundary to prediction prevents the
    // doorway rubber-banding that occurred while a player pressed into a room
    // already occupied by a bot or another survivor.
    const blockedRoomFloorTiles = fullRoomFloorKeys(
      this.mapData,
      this.snapshotData.rooms,
      this.snapshotData.playMode === 'multiplayer' ? 2 : 1,
    );
    for (const [id, view] of this.playerViews) {
      const player = this.snapshotData.players.find((candidate) => candidate.id === id);
      if (!player) continue;
      const lying = Boolean(player.alive && player.roomId);
      const defeated = !player.alive;
      const isLocal = id === this.playerId;
      const shouldSnapOutOfFullRoom =
        isLocal &&
        !lying &&
        blockedRoomFloorTiles.has(
          tileKey(Math.round(view.root.position.x), Math.round(view.root.position.z)),
        ) &&
        !blockedRoomFloorTiles.has(
          tileKey(Math.round(view.target.x), Math.round(view.target.z)),
        );
      const hasLocalInput = isLocal && !lying && Boolean(this.localInput.x || this.localInput.y);
      if (shouldSnapOutOfFullRoom) {
        // The server ejects an intruder that lost a room race to the outside
        // door.  A regular collision-aware correction cannot start from a
        // newly blocked floor tile, so sync this one authoritative transition
        // directly instead of visibly stuttering against the doorway wall.
        view.root.position.copy(view.target);
      } else if (hasLocalInput) {
        const predicted = moveInWalkableArea(this.mapData, {
          x: view.root.position.x,
          y: view.root.position.z,
        }, {
          x: this.localInput.x * localSpeed * dt,
          y: this.localInput.y * localSpeed * dt,
        }, BALANCE.player.collisionRadius, 0.12, blockedRoomFloorTiles);
        view.root.position.set(predicted.x, FLOOR_Y, predicted.y);
        const serverError = Math.hypot(view.target.x - predicted.x, view.target.z - predicted.y);
        if (serverError > LOCAL_HARD_RECONCILE_DISTANCE) {
          this.reconcilePlayerPosition(view, 16, dt, blockedRoomFloorTiles);
        } else if (serverError > LOCAL_SOFT_RECONCILE_DISTANCE) {
          this.reconcilePlayerPosition(view, 1.4, dt, blockedRoomFloorTiles);
        }
      } else {
        this.reconcilePlayerPosition(
          view,
          isLocal ? 13 : 10.5,
          dt,
          isLocal && !lying ? blockedRoomFloorTiles : undefined,
        );
      }
      const dx = view.root.position.x - view.lastPosition.x;
      const dz = view.root.position.z - view.lastPosition.z;
      const moving = Math.hypot(dx, dz) > 0.0015;
      const bedIndex = player.bedIndex ?? 0;
      const lyingOnReversedBed = bedIndex % 2 === 1;
      if (lying) view.actor.setSleep(lyingOnReversedBed);
      else view.actor.setMovement(dx, dz, moving && !defeated, time, view.seed);
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

  private reconcilePlayerPosition(
    view: PlayerView,
    speed: number,
    dt: number,
    blockedTileKeys?: ReadonlySet<string>,
  ): void {
    const amount = 1 - Math.exp(-speed * dt);
    const corrected = moveInWalkableArea(this.mapData, {
      x: view.root.position.x,
      y: view.root.position.z,
    }, {
      x: (view.target.x - view.root.position.x) * amount,
      y: (view.target.z - view.root.position.z) * amount,
    }, BALANCE.player.collisionRadius, 0.12, blockedTileKeys);
    view.root.position.x = corrected.x;
    view.root.position.z = corrected.y;
  }

  private animateGhosts(time: number, dt: number): void {
    for (const [id, view] of this.ghostViews) {
      const ghost = this.snapshotData.ghosts.find((candidate) => candidate.id === id);
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
      const dx = view.root.position.x - beforeX;
      const dz = view.root.position.z - beforeZ;
      const moving = Math.hypot(dx, dz) > 0.001;
      const attackDuration = ghostAttackDuration(ghost.variant);
      const attackElapsed = time - view.attackStartedAt;
      const netted = this.snapshotData.elapsed < ghost.stunnedUntil;
      if (!netted && attackElapsed >= 0 && attackElapsed < attackDuration) {
        view.actor.setAttack(attackElapsed, attackDuration);
      } else {
        view.actor.setMovement(dx, dz, moving && !netted, time, view.seed);
      }
      view.actor.setScreenRotation(0);
      view.actor.setScale(view.actor.size);
      view.actor.object.position.z = moving && !netted
        ? -Math.abs(Math.sin(time * 0.008 + view.seed)) * 0.045
        : 0;
    }
  }

  private animateTurrets(dt: number): void {
    for (const [id, view] of this.buildingViews) {
      if (!view.barrel) continue;
      const building = this.snapshotData.buildings.find((candidate) => candidate.id === id);
      if (!building) continue;
      const owner = this.snapshotData.players.find((player) => player.id === building.ownerId);
      const rangeBonus = this.snapshotData.buildings.find((candidate) =>
        candidate.ownerId === building.ownerId && candidate.kind === 'range-amplifier'
      )?.level ?? 0;
      const range = buildingStats('basic-turret', building.level).range
        + (owner ? characterTraitForAppearance(owner.appearance).turretRangeBonus + combinedItemEffects(owner.items).turretRangeBonus : 0)
        + rangeBonus;
      const nearest = this.snapshotData.ghosts.filter((ghost) =>
        ghost.hp > 0 && !ghost.healing
          && Math.hypot(ghost.position.x - building.tile.x, ghost.position.y - building.tile.y) <= range,
      )
        .sort((a, b) => Math.hypot(a.position.x - building.tile.x, a.position.y - building.tile.y) - Math.hypot(b.position.x - building.tile.x, b.position.y - building.tile.y))[0];
      const door = this.mapData.rooms.find((room) => room.id === building.roomId)?.door;
      const target = nearest?.position ?? door;
      if (!target) continue;
      const desired = Math.atan2(target.x - building.tile.x, target.y - building.tile.y);
      view.barrel.rotation.y = dampAngle(view.barrel.rotation.y, desired, 15, dt);
    }
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
      setObjectOpacity(effect.object, 1 - progress);
      if (progress < 1) continue;
      this.scene.remove(effect.object);
      this.effects.splice(index, 1);
    }
  }

  private playEvent(event: GameEvent): void {
    if (event.kind === 'door-hit' && event.targetId && event.position) {
      const attacker = this.ghostViews.get(event.targetId);
      // A blink/sprint snapshot can arrive alongside an older door-hit. The
      // actor's own recorded strike origin is the reliable anchor: it allows
      // legitimate door attacks from the corridor approach, while rejecting
      // attacks whose ghost has already moved somewhere else.
      const origin = event.sourcePosition ?? event.position;
      const maximumDrift = event.sourcePosition ? 0.72 : 1.2;
      if (!attacker || attacker.target.distanceToSquared(worldPoint(origin)) > maximumDrift * maximumDrift) return;
      // Start close to frame zero so short mobile attack sheets are visible
      // instead of immediately advancing to their middle frame.
      attacker.attackStartedAt = performance.now() - 70;
    }
    if (event.kind === 'ghost-net' && event.position) {
      const net = mesh(
        new THREE.RingGeometry(0.28, 0.72, 12),
        new THREE.MeshBasicMaterial({ color: 0xffdf65, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthTest: false }),
        [event.position.x, 0.82, event.position.y],
      );
      net.rotation.x = -Math.PI / 2;
      net.renderOrder = 9_500;
      this.scene.add(net);
      this.effects.push({ object: net, born: performance.now(), duration: 1_500, baseScale: net.scale.clone(), scaleGrowth: 0.18 });
      const popup = makeBillboard();
      popup.scale.set(1.8, 0.45, 1);
      popup.position.copy(worldPoint(event.position, 1.9));
      popup.position.z -= 0.82;
      updateTextBillboard(popup, `net:${event.targetId}:${performance.now()}`, '그물 봉쇄 · 1.5초', '#fff0a5', 'rgba(42, 31, 6, .92)');
      this.scene.add(popup);
      this.effects.push({ object: popup, born: performance.now(), duration: 1_500, baseScale: popup.scale.clone(), scaleGrowth: 0.04 });
      return;
    }
    if ((event.kind === 'gold' || event.kind === 'power') && event.position && (event.amount ?? 0) > 0) {
      const popup = makeBillboard();
      // 512×128 캔버스와 동일한 4:1 비율을 유지한다. 애니메이션에서도
      // baseScale을 보존해야 모바일 원근 카메라에서 글자가 눌리지 않는다.
      popup.scale.set(1.5, 0.375, 1);
      updateTextBillboard(popup, `${event.kind}:${event.amount}:${performance.now()}`, `${event.kind === 'gold' ? '◆' : '⚡'} +${Math.max(1, Math.round(event.amount ?? 0))}`, event.kind === 'gold' ? '#ffd36f' : '#75e8ff', 'rgba(5,8,16,.72)');
      // The orthographic game camera looks down from high above. Keeping this
      // close to its producer makes each once-per-second income tick readable
      // instead of placing the billboard beyond the portrait viewport.
      popup.position.copy(worldPoint(event.position, 0.72));
      popup.position.z -= 0.28;
      this.scene.add(popup);
      this.effects.push({
        object: popup,
        born: performance.now(),
        duration: 1_250,
        rise: 0.11,
        baseScale: popup.scale.clone(),
        scaleGrowth: 0.06,
      });
      return;
    }
    if (event.kind === 'consumable-use' && event.position) {
      const duration = event.itemId === 'echo-lens'
        ? 10_000
        : event.itemId === 'scout-flare'
          ? 8_000
          : event.itemId === 'moon-compass'
            ? 18_000
            : event.itemId === 'path-chalk'
              ? 12_000
              : 720;
      const color = event.itemId === 'ward-seal' || event.itemId === 'last-latch'
        ? 0xb99aff
        : event.itemId === 'quick-mortar' || event.itemId === 'repair-window'
          ? 0x76f0b0
          : 0x74ecf2;
      const ring = mesh(
        new THREE.RingGeometry(0.2, event.itemId === 'scout-flare' || event.itemId === 'echo-lens' ? 1.25 : 0.48, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
        [event.position.x, 0.06, event.position.y],
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(ring);
      this.effects.push({ object: ring, born: performance.now(), duration, baseScale: ring.scale.clone(), scaleGrowth: event.itemId === 'scout-flare' || event.itemId === 'echo-lens' ? 0.4 : 0.14 });

      if ((event.itemId === 'path-chalk' || event.itemId === 'moon-compass') && event.playerId && this.snapshotData) {
        const player = this.snapshotData.players.find((candidate) => candidate.id === event.playerId);
        const occupiedRooms = new Set(this.snapshotData.rooms.filter((room) => room.ownerIds.length > 0).map((room) => room.id));
        const target = this.mapData.rooms.find((room) => !occupiedRooms.has(room.id));
        if (player && target) {
          const path = findPath(this.mapData, player.position, target.bed);
          if (path.length > 1) {
            const route = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(path.map((tile) => worldPoint(tile, 0.06))),
              new THREE.LineBasicMaterial({ color: 0x93ffbd, transparent: true, opacity: 0.78 }),
            );
            this.scene.add(route);
            this.effects.push({ object: route, born: performance.now(), duration, baseScale: route.scale.clone(), scaleGrowth: 0 });
          }
        }
      }
      return;
    }
    if (event.kind === 'turret-fire' && event.position && event.targetPosition) {
      const from = worldPoint(event.position, 0.58);
      const to = worldPoint(event.targetPosition, 0.9);
      if (event.buildingKind === 'frost-turret' || event.buildingKind === 'arc-turret' || event.buildingKind === 'electric-coil') {
        const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
        const color = event.buildingKind === 'frost-turret' ? 0x91efff : 0xcf79ff;
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
        this.scene.add(line);
        this.effects.push({ object: line, born: performance.now(), duration: 190 });
      } else {
        const projectile = mesh(new THREE.SphereGeometry(event.buildingKind === 'rapid-turret' ? 0.06 : 0.1, 8, 6), standardMaterial(event.buildingKind === 'rapid-turret' ? 0x75e8ff : 0xffd36f, { emissive: event.buildingKind === 'rapid-turret' ? 0x75e8ff : 0xff8c35, emissiveIntensity: 3 }), [from.x, from.y, from.z]);
        this.scene.add(projectile);
        this.effects.push({ object: projectile, born: performance.now(), duration: event.buildingKind === 'rapid-turret' ? 120 : 210, from, to });
      }
      return;
    }
    if (!event.position || !['ghost-hit', 'door-hit', 'player-hit', 'death', 'build', 'building-remove', 'ghost-level-up', 'ghost-skill'].includes(event.kind)) return;
    const color = event.kind === 'build' ? 0x68efa4 : event.kind === 'building-remove' ? 0xffa067 : event.kind === 'ghost-skill' ? 0xc27bff : 0xff5578;
    const ring = mesh(new THREE.RingGeometry(0.14, 0.22, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }), [event.position.x, 0.7, event.position.y]);
    ring.lookAt(this.camera.position);
    this.scene.add(ring);
    this.effects.push({ object: ring, born: performance.now(), duration: 340 });
  }

  private updateCamera(dt: number): void {
    if (this.followingPlayer) {
      const view = this.playerViews.get(this.playerId);
      if (view) this.desiredCameraTarget.set(view.root.position.x, 0, view.root.position.z);
    }
    this.desiredCameraTarget.x = clamp(this.desiredCameraTarget.x, 2.5, this.mapData.width - 3.5);
    this.desiredCameraTarget.z = clamp(this.desiredCameraTarget.z, 2.5, this.mapData.height - 3.5);
    this.cameraTarget.lerp(this.desiredCameraTarget, 1 - Math.exp(-10 * dt));
    this.camera.position.set(
      this.cameraTarget.x,
      CAMERA_HEIGHT,
      this.cameraTarget.z,
    );
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(this.cameraTarget.x, FLOOR_Y, this.cameraTarget.z);

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

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.portraitLayout = height > width;
    this.updateCameraProjection(width, height);
    this.renderer.setSize(width, height, false);
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
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    if (
      this.portraitLayout &&
      local?.alive &&
      !local.roomId &&
      this.pointerNearLocalPlayer(event.clientX, event.clientY)
    ) {
      event.preventDefault();
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.portraitMovementDrag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
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
      building.roomId === local.roomId &&
      building.ownerId === local.id
    ) {
      this.armBuildingDrag(event.pointerId, building, tile, event.clientX, event.clientY);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.portraitMovementDrag?.id === event.pointerId) {
      event.preventDefault();
      const rect = this.renderer.domElement.getBoundingClientRect();
      const radius = clamp(Math.min(rect.width, rect.height) * 0.22, 54, 92);
      let dx = event.clientX - this.portraitMovementDrag.startX;
      let dy = event.clientY - this.portraitMovementDrag.startY;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude > radius) {
        dx = (dx / magnitude) * radius;
        dy = (dy / magnitude) * radius;
      }
      if (magnitude < 6) this.dispatchPortraitMovement(0, 0);
      else this.dispatchPortraitMovement(dx / radius, dy / radius);
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

  private pointerNearLocalPlayer(clientX: number, clientY: number): boolean {
    const view = this.playerViews.get(this.playerId);
    if (!view) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const screen = view.root.position.clone().add(new THREE.Vector3(0, 0.76, 0)).project(this.camera);
    const x = rect.left + (screen.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-screen.y * 0.5 + 0.5) * rect.height;
    const hitRadius = clamp(rect.width * 0.13, 46, 72);
    return Math.hypot(clientX - x, clientY - y) <= hitRadius;
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
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'building', targetId: building.id, buildingId: building.id, roomId: building.roomId } }));
      return;
    }
    const bedTarget = this.mapData.rooms.flatMap((room) => room.beds.map((bed, bedIndex) => ({ room, bed, bedIndex })))
      .find(({ bed }) => bed.x === tile.x && bed.y === tile.y);
    if (bedTarget) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'bed', targetId: `bed:${bedTarget.room.id}:${bedTarget.bedIndex}`, roomId: bedTarget.room.id } }));
      return;
    }
    const doorRoom = this.mapData.rooms.find((room) => room.door.x === tile.x && room.door.y === tile.y);
    if (doorRoom) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'door', targetId: `door:${doorRoom.id}`, roomId: doorRoom.id } }));
      return;
    }
    const room = this.mapData.rooms.find((candidate) => candidate.buildTiles.some((buildTile) => buildTile.x === tile.x && buildTile.y === tile.y));
    if (!room) return;
    const selectedTile: Tile = { ...tile, roomId: room.id };
    this.highlight(tile);
    window.dispatchEvent(new CustomEvent<Tile>('dorm:tile-selected', { detail: selectedTile }));
  }

  private highlight(tile: Vec2): void {
    this.selectionMarker.position.set(tile.x, 0.06, tile.y);
    this.selectionMarker.visible = true;
  }
}
