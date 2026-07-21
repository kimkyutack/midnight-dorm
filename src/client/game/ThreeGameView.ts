import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import { isEliteRank, rankBadgeSymbol, rankBenefits, rankLabel } from '../../shared/progression';
import { isWalkableArea } from '../../shared/map';
import { stageThemeFor, type StageTheme } from '../../shared/stageThemes';
import type { AvatarAppearance, BuildingKind, BuildingState, GameEvent, GameSnapshot, GhostState, MapDefinition, PlayerState, RankId, Tile, TurretKind, Vec2 } from '../../shared/types';
import { movementFacingYaw } from './avatarMath';

const BASE_CAMERA_OFFSET = new THREE.Vector3(4, 8, 5.2);
const BASE_CAMERA_HORIZONTAL_DISTANCE = Math.hypot(BASE_CAMERA_OFFSET.x, BASE_CAMERA_OFFSET.z);
const MIN_CAMERA_DISTANCE_SCALE = 0.5;
const MAX_CAMERA_DISTANCE_SCALE = 2;
const CAMERA_TARGET_HEIGHT = 0.34;
const FLOOR_Y = 0;
const PLAYER_HEIGHT = 1.48;
const FRAME_DT_MAX = 1 / 30;
const TAP_DEBOUNCE_MS = 260;

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

interface PlayerView extends PlayerRig {
  label: THREE.Sprite;
  hp: THREE.Sprite;
  target: THREE.Vector3;
  lastPosition: THREE.Vector3;
  seed: number;
}

interface GhostView {
  root: THREE.Group;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  label: THREE.Sprite;
  hp: THREE.Sprite;
  target: THREE.Vector3;
  seed: number;
}

interface BuildingView {
  root: THREE.Group;
  barrel: THREE.Group | null;
  level: THREE.Sprite;
}

interface DoorView {
  root: THREE.Group;
  panel: THREE.Mesh;
  hp: THREE.Sprite;
  label: THREE.Sprite;
  closedTarget: number;
  closedAmount: number;
}

interface PointerDrag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
  mode: 'pan' | 'rotate';
}

interface MultiTouchGesture {
  distance: number;
  angle: number;
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

function updateTextBillboard(sprite: THREE.Sprite, key: string, text: string, color = '#ffffff', background = 'rgba(5,8,17,.78)'): void {
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
  context.fillStyle = color;
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

function setObjectOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Sprite) && !(child instanceof THREE.Line)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = opacity < 1 || material.transparent;
      material.opacity = opacity;
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
  };
  const outfitColors: Record<string, number> = {
    'outfit-pajamas': 0x6879aa,
    'outfit-raincoat': 0xe0b33b,
    'outfit-campus': 0x477b6b,
    'outfit-medic': 0xd8e5e4,
    'outfit-commander': 0x3f334f,
    'outfit-starlight': 0x5364b2,
    'outfit-frog': 0x74b96a,
    'outfit-bakery': 0xd6a36c,
    'outfit-detective': 0x8b7658,
    'outfit-puffer': 0x4e89a8,
    'outfit-astronaut': 0xd9e4ed,
    'outfit-vampire': 0x641f42,
  };
  const shoeColors: Record<string, number> = {
    'shoes-slippers': 0xaabcc2,
    'shoes-sneakers': 0x5ab5a2,
    'shoes-boots': 0x6c577f,
    'shoes-moon': 0xb8cdeb,
    'shoes-neon': 0x43d9ca,
    'shoes-bunny': 0xefbfc7,
    'shoes-duck': 0xe4c84d,
    'shoes-roller': 0xd77eac,
    'shoes-cloud': 0xd6edf2,
    'shoes-armor': 0xaeb8c3,
  };
  const fur = new THREE.MeshPhysicalMaterial({
    color: furColors[animal] ?? 0xe6c2b7,
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.72,
  });
  const innerEar = standardMaterial(animal === 'fox' ? 0x5a2c2b : 0xc9858a, { roughness: 0.9 });
  const clothColor = new THREE.Color(outfitColors[appearance.outfit] ?? color);
  const cloth = standardMaterial(clothColor, {
    roughness: 0.88,
    emissive: appearance.outfit === 'outfit-starlight' ? 0x17214f : 0x000000,
    emissiveIntensity: appearance.outfit === 'outfit-starlight' ? 0.6 : 0,
  });
  const shoe = standardMaterial(shoeColors[appearance.shoes] ?? 0x20242d, {
    roughness: 0.82,
    emissive: appearance.shoes === 'shoes-neon' ? 0x176b64 : 0x000000,
    emissiveIntensity: appearance.shoes === 'shoes-neon' ? 0.9 : 0,
  });
  const eye = new THREE.MeshPhysicalMaterial({ color: 0x17151d, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });
  const white = standardMaterial(0xf8f2e8, { roughness: 0.82 });
  const cheek = standardMaterial(0xe58f94, { roughness: 0.9, transparent: true, opacity: 0.64 });

  const torso = mesh(new THREE.SphereGeometry(0.34, 22, 16), cloth, [0, 0.68, 0]);
  torso.scale.set(0.98, 1.28, 0.84);
  avatar.add(torso);
  const tummy = mesh(new THREE.SphereGeometry(0.235, 18, 12), cloth.clone(), [0, 0.67, -0.185]);
  tummy.scale.set(1, 1.08, 0.3);
  (tummy.material as THREE.MeshStandardMaterial).color.offsetHSL(0, -0.08, 0.08);
  avatar.add(tummy);
  avatar.add(createOutfitDetails(appearance.outfit, clothColor));
  const head = mesh(new THREE.SphereGeometry(0.42, 28, 20), fur, [0, 1.18, -0.015]);
  head.scale.set(1.06, 0.98, 0.98);
  avatar.add(head);
  avatar.add(createAnimalEars(animal, fur, innerEar));
  avatar.add(mesh(new THREE.SphereGeometry(0.066, 16, 12), eye, [-0.145, 1.205, -0.37]));
  avatar.add(mesh(new THREE.SphereGeometry(0.066, 16, 12), eye, [0.145, 1.205, -0.37]));
  avatar.add(mesh(new THREE.SphereGeometry(0.019, 8, 6), white, [-0.164, 1.227, -0.426]));
  avatar.add(mesh(new THREE.SphereGeometry(0.019, 8, 6), white, [0.126, 1.227, -0.426]));
  const muzzle = mesh(new THREE.SphereGeometry(0.13, 18, 12), white, [0, 1.065, -0.39]);
  muzzle.scale.set(1.22, 0.7, 0.62);
  avatar.add(muzzle);
  avatar.add(mesh(new THREE.SphereGeometry(0.039, 12, 8), standardMaterial(0x684348, { roughness: 0.32 }), [0, 1.105, -0.47]));
  const smile = mesh(new THREE.TorusGeometry(0.052, 0.01, 5, 18, Math.PI), standardMaterial(0x71464d, { roughness: 0.4 }), [0, 1.02, -0.467]);
  smile.rotation.z = Math.PI;
  avatar.add(smile);
  const leftCheek = mesh(new THREE.SphereGeometry(0.053, 10, 8), cheek, [-0.255, 1.09, -0.34]);
  const rightCheek = mesh(new THREE.SphereGeometry(0.053, 10, 8), cheek, [0.255, 1.09, -0.34]);
  leftCheek.scale.y = rightCheek.scale.y = 0.52;
  avatar.add(leftCheek, rightCheek);
  avatar.add(createAvatarHat(appearance.hat, displayRank));
  avatar.add(createAvatarAccessory(appearance.accessory));
  avatar.add(createAnimalTail(animal, fur));

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-0.285, 0.84, 0);
  rightArm.position.set(0.285, 0.84, 0);
  leftArm.rotation.z = -0.08;
  rightArm.rotation.z = 0.08;
  leftArm.add(mesh(new THREE.SphereGeometry(0.105, 12, 9), cloth, [0, -0.015, 0]));
  rightArm.add(mesh(new THREE.SphereGeometry(0.105, 12, 9), cloth, [0, -0.015, 0]));
  leftArm.add(mesh(new THREE.CapsuleGeometry(0.082, 0.2, 5, 10), cloth, [0, -0.17, 0]));
  rightArm.add(mesh(new THREE.CapsuleGeometry(0.082, 0.2, 5, 10), cloth, [0, -0.17, 0]));
  leftArm.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), fur, [0, -0.34, 0]));
  rightArm.add(mesh(new THREE.SphereGeometry(0.075, 8, 6), fur, [0, -0.34, 0]));
  avatar.add(leftArm, rightArm);

  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.135, 0.4, 0);
  rightLeg.position.set(0.135, 0.4, 0);
  leftLeg.add(mesh(new THREE.CapsuleGeometry(0.09, 0.17, 3, 8), cloth, [0, -0.12, 0]));
  rightLeg.add(mesh(new THREE.CapsuleGeometry(0.09, 0.17, 3, 8), cloth, [0, -0.12, 0]));
  const leftShoe = mesh(new THREE.SphereGeometry(0.14, 14, 9), shoe, [0, -0.28, -0.055]);
  const rightShoe = mesh(new THREE.SphereGeometry(0.14, 14, 9), shoe, [0, -0.28, -0.055]);
  leftShoe.scale.set(0.9, 0.62, 1.25);
  rightShoe.scale.copy(leftShoe.scale);
  leftLeg.add(leftShoe);
  rightLeg.add(rightShoe);
  decorateShoes(appearance.shoes, leftLeg, rightLeg);
  avatar.add(leftLeg, rightLeg);

  const groundRing = mesh(
    new THREE.RingGeometry(local ? 0.34 : 0.31, local ? 0.4 : 0.35, 36),
    new THREE.MeshBasicMaterial({ color: local ? 0x74e6ff : color, transparent: true, opacity: local ? 0.72 : 0.3, side: THREE.DoubleSide }),
    [0, 0.025, 0],
  );
  groundRing.rotation.x = -Math.PI / 2;
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
  } else {
    const radius = animal === 'fox' ? 0.085 : animal === 'puppy' ? 0.068 : 0.058;
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
  }
  return tail;
}

function createAnimalEars(animal: string, fur: THREE.Material, inner: THREE.Material): THREE.Group {
  const ears = new THREE.Group();
  if (animal === 'cat' || animal === 'fox') {
    for (const x of [-0.24, 0.24]) {
      const ear = mesh(new THREE.ConeGeometry(0.15, animal === 'fox' ? 0.36 : 0.29, 4), fur, [x, 1.53, 0]);
      ear.rotation.z = x < 0 ? 0.14 : -0.14;
      ears.add(ear);
    }
  } else if (animal === 'puppy') {
    for (const x of [-0.32, 0.32]) {
      const ear = mesh(new THREE.CapsuleGeometry(0.1, 0.28, 4, 8), fur, [x, 1.36, 0]);
      ear.rotation.z = x < 0 ? -0.42 : 0.42;
      ears.add(ear);
    }
  } else if (animal === 'bear' || animal === 'hamster') {
    for (const x of [-0.27, 0.27]) {
      ears.add(mesh(new THREE.SphereGeometry(animal === 'hamster' ? 0.14 : 0.16, 10, 8), fur, [x, 1.44, 0]));
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

function createGhostModel(ghost: GhostState): Pick<GhostView, 'body' | 'leftArm' | 'rightArm'> {
  const body = new THREE.Group();
  const palettes: Record<GhostState['variant'], { robe: number; skin: number; glow: number }> = {
    wanderer: { robe: 0x17111d, skin: 0xbab1aa, glow: 0xff274f },
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
  const palette = palettes[ghost.variant];
  const robe = standardMaterial(palette.robe, { roughness: 1, side: THREE.DoubleSide, emissive: palette.robe, emissiveIntensity: 0.48 });
  const skin = standardMaterial(palette.skin, { roughness: 0.92 });
  const black = standardMaterial(0x050407, { roughness: 1 });
  const glow = standardMaterial(palette.glow, { emissive: palette.glow, emissiveIntensity: 3.4, roughness: 0.25 });

  const brute = ghost.variant === 'brute';
  const giant = ghost.variant === 'giant';
  const minion = ghost.variant === 'minion';
  const broad = brute || giant;
  const cone = mesh(new THREE.ConeGeometry(broad ? 0.7 : 0.5, broad ? 1.45 : 1.3, 7, 1, true), robe, [0, 0.68, 0]);
  cone.rotation.y = Math.PI / 7;
  body.add(cone);
  const head = mesh(new THREE.SphereGeometry(broad ? 0.39 : 0.31, 14, 10), skin, [0, broad ? 1.55 : 1.48, -0.02]);
  head.scale.z = 0.78;
  body.add(head);
  const hair = mesh(new THREE.SphereGeometry(broad ? 0.41 : 0.335, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.68), black, [0, broad ? 1.64 : 1.57, 0]);
  body.add(hair);
  for (const x of [-0.105, 0.105]) body.add(mesh(new THREE.SphereGeometry(broad ? 0.047 : 0.038, 8, 6), glow, [x, broad ? 1.56 : 1.49, -0.265]));
  const mouth = mesh(new THREE.BoxGeometry(broad ? 0.24 : 0.18, 0.045, 0.025), black, [0, broad ? 1.42 : 1.36, -0.27]);
  body.add(mouth);

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(broad ? -0.48 : -0.34, 1.18, 0);
  rightArm.position.set(broad ? 0.48 : 0.34, 1.18, 0);
  leftArm.rotation.z = broad ? 0.55 : 0.88;
  rightArm.rotation.z = broad ? -0.55 : -0.88;
  leftArm.add(mesh(new THREE.CapsuleGeometry(broad ? 0.095 : 0.065, broad ? 0.72 : 0.62, 3, 7), skin, [0, -0.38, 0]));
  rightArm.add(mesh(new THREE.CapsuleGeometry(broad ? 0.095 : 0.065, broad ? 0.72 : 0.62, 3, 7), skin, [0, -0.38, 0]));
  body.add(leftArm, rightArm);

  if (ghost.variant === 'caster') {
    const halo = mesh(new THREE.TorusGeometry(0.52, 0.025, 8, 32), glow, [0, 1.48, 0]);
    halo.rotation.x = Math.PI / 2;
    body.add(halo);
  }
  if (ghost.variant === 'teleporter') {
    const portal = mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 36), glow, [0, 0.9, 0.18]);
    portal.rotation.x = Math.PI / 2;
    body.add(portal);
  }
  if (ghost.variant === 'undead') {
    for (const x of [-0.24, 0, 0.24]) body.add(mesh(new THREE.BoxGeometry(0.055, 0.34, 0.055), skin, [x, 1.02, -0.35]));
  }
  if (giant) {
    const chain = mesh(new THREE.TorusGeometry(0.47, 0.055, 7, 24), standardMaterial(0x514844, { metalness: 0.75, roughness: 0.5 }), [0, 1.12, -0.2]);
    chain.rotation.x = Math.PI / 2;
    body.add(chain);
  }
  if (ghost.variant.startsWith('twin')) body.scale.setScalar(0.78);
  if (brute) body.scale.set(1.12, 1.12, 1.12);
  if (giant) body.scale.set(1.58, 1.72, 1.58);
  if (minion) body.scale.setScalar(0.42);
  return { body, leftArm, rightArm };
}

function buildingColor(kind: BuildingKind): number {
  const colors: Record<BuildingKind, number> = {
    bed: 0x6ed9e8,
    'reinforced-door': 0x769bc2,
    'basic-turret': 0x62d7ff,
    'rapid-turret': 0xffc85f,
    'frost-turret': 0x91efff,
    'arc-turret': 0xcf79ff,
    generator: 0x68efa4,
    'repair-drone': 0xff7ca7,
    'electric-coil': 0xbd80ff,
    'floor-trap': 0xe56870,
    'shield-device': 0x879eff,
    'lucky-machine': 0xff6eaa,
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
  const color = turretSkinColor(building);
  const baseMaterial = standardMaterial(0x172235, { metalness: 0.52, roughness: 0.42 });
  const accent = standardMaterial(color, { emissive: color, emissiveIntensity: 0.85, metalness: 0.35, roughness: 0.28 });
  const dark = standardMaterial(0x080b13, { metalness: 0.6, roughness: 0.34 });
  root.add(mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.18, 12), baseMaterial, [0, 0.1, 0]));
  root.add(mesh(new THREE.CylinderGeometry(0.27, 0.32, 0.28, 12), accent, [0, 0.29, 0]));

  const turret = ['basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret'].includes(building.kind);
  let barrel: THREE.Group | null = null;
  if (turret) {
    barrel = new THREE.Group();
    barrel.position.y = 0.52;
    const barrelMesh = mesh(new THREE.CylinderGeometry(0.055, 0.075, building.kind === 'rapid-turret' ? 0.62 : 0.72, 9), accent, [0, 0, -0.31]);
    barrelMesh.rotation.x = Math.PI / 2;
    barrel.add(barrelMesh);
    barrel.add(mesh(new THREE.SphereGeometry(0.17, 12, 8), dark, [0, 0, 0]));
    root.add(barrel);
    if (building.skinId.includes('pumpkin')) {
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
  } else if (building.kind === 'floor-trap') {
    root.scale.y = 0.42;
    for (const x of [-0.22, 0, 0.22]) root.add(mesh(new THREE.ConeGeometry(0.08, 0.42, 5), accent, [x, 0.42, 0]));
  } else if (building.kind === 'shield-device') {
    const shield = mesh(new THREE.SphereGeometry(0.36, 16, 10), new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.26, transmission: 0.12, roughness: 0.12 }), [0, 0.46, 0]);
    root.add(shield);
  } else if (building.kind === 'lucky-machine') {
    root.add(mesh(new THREE.BoxGeometry(0.5, 0.68, 0.45), baseMaterial, [0, 0.48, 0]));
    root.add(mesh(new THREE.BoxGeometry(0.34, 0.28, 0.05), accent, [0, 0.56, -0.25]));
  } else {
    root.add(mesh(new THREE.TorusGeometry(0.24, 0.06, 8, 20), accent, [0, 0.54, 0]));
  }
  return { root, barrel };
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
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly selectionSurface: THREE.Mesh;
  private readonly playerViews = new Map<string, PlayerView>();
  private readonly ghostViews = new Map<string, GhostView>();
  private readonly buildingViews = new Map<string, BuildingView>();
  private readonly doorViews = new Map<string, DoorView>();
  private readonly effects: TimedEffect[] = [];
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCameraTarget = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly selectionMarker: THREE.Mesh;
  private readonly pointerPositions = new Map<number, { x: number; y: number }>();
  private localInput: Vec2 = { x: 0, y: 0 };
  private drag: PointerDrag | null = null;
  private gesture: MultiTouchGesture | null = null;
  private followingPlayer = true;
  private focusedRoomId: string | null = null;
  private cameraDistanceScale = 1;
  private cameraYaw = Math.atan2(BASE_CAMERA_OFFSET.x, BASE_CAMERA_OFFSET.z);
  private lastFrame = performance.now();
  private lastSelectionAt = 0;
  private lastSelectionKey = '';
  private paused = false;
  private destroyed = false;

  constructor(host: HTMLElement, payload: ViewPayload) {
    this.host = host;
    this.mapData = payload.map;
    this.playerId = payload.playerId;
    this.snapshotData = payload.snapshot;
    this.theme = stageThemeFor(payload.snapshot.stageId);
    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.Fog(this.theme.fog, this.theme.fogNear, this.theme.fogFar);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.dataset.renderer = 'three-3d';
    this.renderer.domElement.dataset.theme = this.theme.id;
    this.renderer.domElement.style.touchAction = 'none';
    this.host.appendChild(this.renderer.domElement);

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
    this.selectionMarker.position.y = 0.07;
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
    this.renderer.setAnimationLoop(this.animate);
  }

  setLocalInput(input: Vec2): void { this.localInput = input; }

  getCameraMode(): 'follow' | 'free' { return this.followingPlayer ? 'follow' : 'free'; }

  getCameraZoom(): number { return Math.round((1 / this.cameraDistanceScale) * 100) / 100; }

  getCameraYaw(): number { return this.cameraYaw; }

  zoomBy(magnificationFactor: number): void {
    if (!Number.isFinite(magnificationFactor) || magnificationFactor <= 0) return;
    this.cameraDistanceScale = clamp(
      this.cameraDistanceScale / magnificationFactor,
      MIN_CAMERA_DISTANCE_SCALE,
      MAX_CAMERA_DISTANCE_SCALE,
    );
  }

  rotateBy(radians: number): void {
    if (!Number.isFinite(radians)) return;
    this.cameraYaw = Math.atan2(Math.sin(this.cameraYaw + radians), Math.cos(this.cameraYaw + radians));
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
    this.syncBuildings(snapshot.buildings);
    this.syncDoors(snapshot);
    for (const event of events) this.playEvent(event);

    const local = snapshot.players.find((player) => player.id === this.playerId);
    if (local && !local.roomId) {
      this.followingPlayer = true;
      this.focusedRoomId = null;
    } else if (local?.roomId) {
      const roomChanged = this.focusedRoomId !== local.roomId;
      this.followingPlayer = false;
      if (roomChanged) {
        this.desiredCameraTarget.copy(worldPoint(local.position));
        this.cameraTarget.copy(this.desiredCameraTarget);
      }
      this.focusedRoomId = local.roomId;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.unbindInput();
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly animate = (time: number): void => {
    if (this.destroyed || this.paused) return;
    const dt = Math.min(FRAME_DT_MAX, Math.max(0.001, (time - this.lastFrame) / 1_000));
    this.lastFrame = time;
    this.animatePlayers(time, dt);
    this.animateGhosts(time, dt);
    this.animateTurrets();
    this.animateDoors(dt);
    this.animateEffects(time);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

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
    const lightTiles = this.mapData.corridorTiles.filter((_, index) => index % Math.max(1, Math.floor(this.mapData.corridorTiles.length / 22)) === 0).slice(0, 22);
    lightTiles.forEach((tile, index) => {
      const light = new THREE.PointLight(index % 2 === 0 ? this.theme.lightA : this.theme.lightB, 3.8, 7.5, 1.8);
      light.position.set(tile.x, 2.2, tile.y);
      this.scene.add(light);
    });
  }

  private createWorld(): void {
    const corridorKeys = new Set(this.mapData.corridorTiles.map((tile) => `${tile.x},${tile.y}`));
    const corridorTiles = this.mapData.corridorTiles;
    const roomTiles = this.mapData.walkable.filter((tile) => !corridorKeys.has(`${tile.x},${tile.y}`));
    this.addTileInstances(corridorTiles, standardMaterial(this.theme.corridor, { roughness: 0.96 }), 0);
    this.addTileInstances(roomTiles, standardMaterial(this.theme.room, { roughness: 0.94 }), 0.003);

    const buildTiles = this.mapData.rooms.flatMap((room) => room.buildTiles);
    const markerGeometry = new THREE.PlaneGeometry(0.62, 0.62);
    markerGeometry.rotateX(-Math.PI / 2);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: this.theme.marker, transparent: true, opacity: 0.11, depthWrite: false });
    const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, buildTiles.length);
    const matrix = new THREE.Matrix4();
    buildTiles.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 0.025, tile.y);
      markers.setMatrixAt(index, matrix);
    });
    this.scene.add(markers);

    const wallGeometry = new THREE.BoxGeometry(0.98, 0.68, 0.98);
    const wallMaterial = standardMaterial(this.theme.wall, { roughness: 0.86 });
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, this.mapData.walls.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.mapData.walls.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 0.34, tile.y);
      walls.setMatrixAt(index, matrix);
    });
    this.scene.add(walls);
    const capGeometry = new THREE.BoxGeometry(1, 0.12, 1);
    const caps = new THREE.InstancedMesh(capGeometry, standardMaterial(this.theme.wallCap, { roughness: 0.72 }), this.mapData.walls.length);
    this.mapData.walls.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 0.73, tile.y);
      caps.setMatrixAt(index, matrix);
    });
    this.scene.add(caps);

    const zone = this.mapData.respawnZone;
    const respawn = mesh(
      new THREE.PlaneGeometry(zone.width - 0.2, zone.height - 0.2),
      new THREE.MeshBasicMaterial({ color: this.theme.respawn, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
      [zone.x + (zone.width - 1) / 2, 0.035, zone.y + (zone.height - 1) / 2],
    );
    respawn.rotation.x = -Math.PI / 2;
    this.scene.add(respawn);

    for (const room of this.mapData.rooms) this.createRoomFurniture(room.id);
    this.createThemeDecorations();
  }

  private createThemeDecorations(): void {
    const sampleStep = Math.max(1, Math.floor(this.mapData.walls.length / 14));
    const samples = this.mapData.walls.filter((_, index) => index % sampleStep === 0).slice(0, 14);
    samples.forEach((tile, index) => {
      const prop = new THREE.Group();
      prop.position.set(tile.x, 0.78, tile.y);
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

  private addTileInstances(tiles: Tile[], material: THREE.Material, y: number): void {
    const geometry = new THREE.PlaneGeometry(0.96, 0.96);
    geometry.rotateX(-Math.PI / 2);
    const floors = new THREE.InstancedMesh(geometry, material, tiles.length);
    floors.receiveShadow = true;
    const matrix = new THREE.Matrix4();
    tiles.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, y, tile.y);
      floors.setMatrixAt(index, matrix);
    });
    this.scene.add(floors);
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
      this.scene.add(bed);
    });
  }

  private syncPlayers(players: PlayerState[]): void {
    const active = new Set(players.map((player) => player.id));
    for (const player of players) {
      let view = this.playerViews.get(player.id);
      if (!view) {
        const rig = createPlayerRig(player.appearance, player.displayRank, player.color, player.id === this.playerId);
        rig.root.position.copy(worldPoint(player.position));
        const label = makeBillboard();
        label.scale.set(2.35, 0.59, 1);
        label.position.y = PLAYER_HEIGHT + 0.36;
        const hp = makeBillboard();
        hp.scale.set(1.55, 0.39, 1);
        hp.position.y = PLAYER_HEIGHT + 0.02;
        rig.root.add(label, hp);
        this.scene.add(rig.root);
        view = { ...rig, label, hp, target: worldPoint(player.position), lastPosition: worldPoint(player.position), seed: player.id.length * 0.71 };
        this.playerViews.set(player.id, view);
      }
      view.target.copy(worldPoint(player.position));
      const elite = isEliteRank(player.displayRank);
      updateTextBillboard(view.label, `${player.displayRank}:${player.nickname}`, `${rankBadgeSymbol(player.displayRank)} ${rankLabel(player.displayRank)} · ${player.nickname}`, elite ? '#ecc9ff' : '#ffffff');
      updateBarBillboard(view.hp, `${Math.ceil(player.hp)}:${player.maxHp}`, player.hp / Math.max(1, player.maxHp), `${Math.ceil(player.hp)} / ${player.maxHp}`, player.hp / player.maxHp > 0.35 ? '#55dfa0' : '#ff5578');
      setObjectOpacity(view.root, player.alive ? (player.connected ? 1 : 0.52) : 0.2);
    }
    for (const [id, view] of this.playerViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      this.playerViews.delete(id);
    }
  }

  private syncGhosts(ghosts: GhostState[]): void {
    const active = new Set(ghosts.map((ghost) => ghost.id));
    for (const ghost of ghosts) {
      let view = this.ghostViews.get(ghost.id);
      if (!view) {
        const root = new THREE.Group();
        root.position.copy(worldPoint(ghost.position));
        const model = createGhostModel(ghost);
        root.add(model.body);
        const label = makeBillboard();
        label.scale.set(ghost.variant === 'minion' ? 1.7 : 2.5, ghost.variant === 'minion' ? 0.46 : 0.62, 1);
        label.position.y = ghost.variant === 'giant' ? 3.15 : ghost.variant === 'minion' ? 1.02 : 2.22;
        const hp = makeBillboard();
        hp.scale.set(ghost.variant === 'minion' ? 1.2 : 1.9, ghost.variant === 'minion' ? 0.34 : 0.46, 1);
        hp.position.y = ghost.variant === 'giant' ? 2.85 : ghost.variant === 'minion' ? 0.84 : 1.96;
        root.add(label, hp);
        const light = new THREE.PointLight(ghost.variant === 'caster' ? 0xb965ff : 0xff284f, 2.8, 4.5, 2);
        light.position.y = 1.2;
        root.add(light);
        this.scene.add(root);
        view = { root, body: model.body, leftArm: model.leftArm, rightArm: model.rightArm, label, hp, target: worldPoint(ghost.position), seed: ghost.id.length * 1.19 };
        this.ghostViews.set(ghost.id, view);
      }
      view.target.copy(worldPoint(ghost.position));
      updateTextBillboard(view.label, `${ghost.displayName}:${ghost.level}`, `${ghost.displayName} · Lv.${ghost.level}`, '#ffb4c2', 'rgba(25,4,12,.84)');
      const ratio = ghost.hp / Math.max(1, ghost.maxHp);
      updateBarBillboard(view.hp, `${Math.ceil(ghost.hp)}:${Math.ceil(ghost.maxHp)}:${ghost.retreating}`, ratio, `${Math.ceil(ghost.hp)} / ${Math.ceil(ghost.maxHp)}`, ghost.retreating ? '#8494bb' : '#ff315f');
      setObjectOpacity(view.root, ghost.hp > 0 ? (ghost.healing ? 0.62 : 1) : 0.08);
    }
    for (const [id, view] of this.ghostViews) {
      if (active.has(id)) continue;
      this.scene.remove(view.root);
      this.ghostViews.delete(id);
    }
  }

  private syncBuildings(buildings: BuildingState[]): void {
    const active = new Set(buildings.map((building) => building.id));
    for (const building of buildings) {
      let view = this.buildingViews.get(building.id);
      if (!view) {
        const model = createBuildingModel(building);
        model.root.position.copy(worldPoint(building.tile));
        const level = makeBillboard();
        level.scale.set(0.8, 0.28, 1);
        level.position.set(0.35, 0.9, 0);
        model.root.add(level);
        this.scene.add(model.root);
        view = { root: model.root, barrel: model.barrel, level };
        this.buildingViews.set(building.id, view);
      }
      updateTextBillboard(view.level, `${building.level}`, `Lv.${building.level}`, '#ffffff', 'rgba(8,12,24,.9)');
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
        const frameMaterial = standardMaterial(0x314258, { metalness: 0.5, roughness: 0.5 });
        const panelMaterial = standardMaterial(0x436d78, { emissive: 0x173d48, emissiveIntensity: 0.55, metalness: 0.32, roughness: 0.48 });
        root.add(mesh(new THREE.BoxGeometry(1.08, 1.34, 0.18), frameMaterial, [0, 0.67, 0]));
        const panel = mesh(new THREE.BoxGeometry(0.82, 1.12, 0.2), panelMaterial, [0, 0.6, -0.02]);
        root.add(panel);
        const hp = makeBillboard();
        hp.scale.set(1.72, 0.42, 1);
        hp.position.y = 1.63;
        const label = makeBillboard();
        label.scale.set(1.4, 0.38, 1);
        label.position.y = 1.9;
        root.add(hp, label);
        this.scene.add(root);
        const closed = state.ownerIds.length > 0 ? 1 : 0;
        panel.rotation.y = (1 - closed) * Math.PI / 2;
        view = { root, panel, hp, label, closedTarget: closed, closedAmount: closed };
        this.doorViews.set(room.id, view);
      }
      const intact = state.doorHp > 0;
      const ratio = state.doorHp / Math.max(1, state.doorMaxHp);
      view.closedTarget = state.ownerIds.length > 0 ? 1 : 0;
      view.panel.visible = intact;
      updateTextBillboard(view.label, `${state.doorLevel}`, `문 Lv.${state.doorLevel}`, '#d8f8ff');
      updateBarBillboard(view.hp, `${Math.ceil(state.doorHp)}:${Math.ceil(state.doorMaxHp)}:${intact}`, ratio, intact ? `${Math.ceil(state.doorHp)} / ${Math.ceil(state.doorMaxHp)}` : '파괴됨', ratio > 0.5 ? '#55dfa0' : ratio > 0.22 ? '#ffc85f' : '#ff5578');
    }
  }

  private animateDoors(dt: number): void {
    for (const view of this.doorViews.values()) {
      view.closedAmount = damp(view.closedAmount, view.closedTarget, 8.5, dt);
      view.panel.rotation.y = (1 - view.closedAmount) * Math.PI / 2;
      view.panel.position.x = (1 - view.closedAmount) * 0.34;
    }
  }

  private animatePlayers(time: number, dt: number): void {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    const localSpeed = BALANCE.player.speed * rankBenefits(local?.soloRank ?? 'beginner').speedMultiplier;
    for (const [id, view] of this.playerViews) {
      const player = this.snapshotData.players.find((candidate) => candidate.id === id);
      if (!player) continue;
      const lying = Boolean(player.alive && player.roomId);
      if (id === this.playerId && !lying && (this.localInput.x || this.localInput.y)) {
        const nextX = view.root.position.x + this.localInput.x * localSpeed * dt;
        const nextZ = view.root.position.z + this.localInput.y * localSpeed * dt;
        if (isWalkableArea(this.mapData, nextX, view.root.position.z, BALANCE.player.collisionRadius)) view.root.position.x = nextX;
        if (isWalkableArea(this.mapData, view.root.position.x, nextZ, BALANCE.player.collisionRadius)) view.root.position.z = nextZ;
      }
      view.root.position.lerp(view.target, 1 - Math.exp(-(id === this.playerId ? 8.5 : 10.5) * dt));
      const dx = view.root.position.x - view.lastPosition.x;
      const dz = view.root.position.z - view.lastPosition.z;
      const moving = Math.hypot(dx, dz) > 0.0015;
      if (moving && !lying) view.avatar.rotation.y = damp(view.avatar.rotation.y, movementFacingYaw(dx, dz), 12, dt);
      const stride = moving && !lying ? Math.sin(time * 0.011 + view.seed) * 0.68 : 0;
      view.leftArm.rotation.x = damp(view.leftArm.rotation.x, stride, 12, dt);
      view.rightArm.rotation.x = damp(view.rightArm.rotation.x, -stride, 12, dt);
      view.leftLeg.rotation.x = damp(view.leftLeg.rotation.x, -stride, 12, dt);
      view.rightLeg.rotation.x = damp(view.rightLeg.rotation.x, stride, 12, dt);
      view.avatar.rotation.z = damp(view.avatar.rotation.z, lying ? Math.PI / 2 : 0, 9, dt);
      view.avatar.position.y = damp(view.avatar.position.y, lying ? 0.48 : (moving ? Math.abs(Math.sin(time * 0.011 + view.seed)) * 0.035 : 0), 10, dt);
      view.avatar.scale.setScalar(damp(view.avatar.scale.x, lying ? 0.52 : 1, 9, dt));
      view.lastPosition.copy(view.root.position);
    }
  }

  private animateGhosts(time: number, dt: number): void {
    for (const [id, view] of this.ghostViews) {
      const ghost = this.snapshotData.ghosts.find((candidate) => candidate.id === id);
      if (!ghost) continue;
      const beforeX = view.root.position.x;
      const beforeZ = view.root.position.z;
      view.root.position.lerp(view.target, 1 - Math.exp(-8 * dt));
      const dx = view.root.position.x - beforeX;
      const dz = view.root.position.z - beforeZ;
      if (Math.hypot(dx, dz) > 0.001) view.body.rotation.y = damp(view.body.rotation.y, movementFacingYaw(dx, dz), 9, dt);
      view.body.position.y = Math.sin(time * 0.0048 + view.seed) * 0.1 + 0.08;
      view.body.rotation.z = Math.sin(time * 0.0026 + view.seed) * 0.045;
      const reach = Math.sin(time * 0.006 + view.seed) * 0.22;
      view.leftArm.rotation.x = reach;
      view.rightArm.rotation.x = -reach;
    }
  }

  private animateTurrets(): void {
    for (const [id, view] of this.buildingViews) {
      if (!view.barrel) continue;
      const building = this.snapshotData.buildings.find((candidate) => candidate.id === id);
      if (!building) continue;
      const nearest = this.snapshotData.ghosts.filter((ghost) => ghost.hp > 0)
        .sort((a, b) => Math.hypot(a.position.x - building.tile.x, a.position.y - building.tile.y) - Math.hypot(b.position.x - building.tile.x, b.position.y - building.tile.y))[0];
      if (nearest) view.barrel.rotation.y = Math.atan2(nearest.position.x - building.tile.x, nearest.position.y - building.tile.y);
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
    if ((event.kind === 'gold' || event.kind === 'power') && event.position && (event.amount ?? 0) > 0) {
      const popup = makeBillboard();
      // 512×128 캔버스와 동일한 4:1 비율을 유지한다. 애니메이션에서도
      // baseScale을 보존해야 모바일 원근 카메라에서 글자가 눌리지 않는다.
      popup.scale.set(2.08, 0.52, 1);
      updateTextBillboard(popup, `${event.kind}:${event.amount}:${performance.now()}`, `${event.kind === 'gold' ? '◆' : '⚡'} +${Math.max(1, Math.round(event.amount ?? 0))}`, event.kind === 'gold' ? '#ffd36f' : '#75e8ff', 'rgba(5,8,16,.72)');
      popup.position.copy(worldPoint(event.position, 1.9));
      this.scene.add(popup);
      this.effects.push({
        object: popup,
        born: performance.now(),
        duration: 1_050,
        rise: 0.024,
        baseScale: popup.scale.clone(),
        scaleGrowth: 0.06,
      });
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
    const horizontalDistance = BASE_CAMERA_HORIZONTAL_DISTANCE * this.cameraDistanceScale;
    this.camera.position.set(
      this.cameraTarget.x + Math.sin(this.cameraYaw) * horizontalDistance,
      this.cameraTarget.y + BASE_CAMERA_OFFSET.y * this.cameraDistanceScale,
      this.cameraTarget.z + Math.cos(this.cameraYaw) * horizontalDistance,
    );
    this.camera.lookAt(this.cameraTarget.x, CAMERA_TARGET_HEIGHT, this.cameraTarget.z);
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
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
    if (!local?.roomId) return;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointerPositions.size >= 2) {
      this.drag = null;
      this.gesture = this.currentGesture();
      return;
    }
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      mode: event.button === 2 ? 'rotate' : 'pan',
    };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerPositions.has(event.pointerId)) return;
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointerPositions.size >= 2) {
      const next = this.currentGesture();
      if (next && this.gesture) {
        if (this.gesture.distance > 0) this.zoomBy(next.distance / this.gesture.distance);
        const angleDelta = Math.atan2(
          Math.sin(next.angle - this.gesture.angle),
          Math.cos(next.angle - this.gesture.angle),
        );
        this.rotateBy(angleDelta);
      }
      this.gesture = next;
      return;
    }
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 7) this.drag.moved = true;
    if (!this.drag.moved) return;
    if (this.drag.mode === 'rotate') this.rotateBy(-dx * 0.008);
    else {
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
      const forward = new THREE.Vector3();
      this.camera.getWorldDirection(forward);
      forward.setY(0).normalize();
      const panScale = 0.015 * this.cameraDistanceScale;
      this.desiredCameraTarget.addScaledVector(right, -dx * panScale);
      this.desiredCameraTarget.addScaledVector(forward, dy * panScale);
    }
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerPositions.has(event.pointerId)) return;
    const wasGesture = this.pointerPositions.size > 1 || this.gesture !== null;
    const moved = this.drag?.id === event.pointerId ? this.drag.moved : wasGesture;
    this.pointerPositions.delete(event.pointerId);
    this.gesture = this.pointerPositions.size >= 2 ? this.currentGesture() : null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    const remaining = this.pointerPositions.entries().next().value as [number, { x: number; y: number }] | undefined;
    this.drag = remaining
      ? { id: remaining[0], x: remaining[1].x, y: remaining[1].y, moved: true, mode: 'pan' }
      : null;
    if (!moved && !wasGesture && event.button !== 2) this.selectAt(event.clientX, event.clientY);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private currentGesture(): MultiTouchGesture | null {
    const points = [...this.pointerPositions.values()];
    const first = points[0];
    const second = points[1];
    if (!first || !second) return null;
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  }

  private selectAt(clientX: number, clientY: number): void {
    const now = performance.now();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.selectionSurface, false)[0];
    if (!hit) return;
    const tile = { x: Math.round(hit.point.x), y: Math.round(hit.point.z) };
    const selectionKey = `${tile.x}:${tile.y}`;
    if (selectionKey === this.lastSelectionKey && now - this.lastSelectionAt < TAP_DEBOUNCE_MS) return;
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
    this.selectionMarker.position.set(tile.x, 0.07, tile.y);
    this.selectionMarker.visible = true;
  }
}
