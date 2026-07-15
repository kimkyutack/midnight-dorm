import * as THREE from 'three';
import { BALANCE } from '../../shared/balance';
import { isEliteRank, rankBenefits, rankLabel } from '../../shared/progression';
import type { BuildingKind, BuildingState, GameEvent, GameSnapshot, GhostState, MapDefinition, PlayerState, Tile, Vec2 } from '../../shared/types';

const CAMERA_OFFSET = new THREE.Vector3(4, 8, 5.2);
const CAMERA_TARGET_HEIGHT = 0.34;
const FLOOR_Y = 0;
const PLAYER_HEIGHT = 1.82;

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

interface PlayerRig {
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
}

interface PointerDrag {
  id: number;
  x: number;
  y: number;
  moved: boolean;
}

interface TimedEffect {
  object: THREE.Object3D;
  born: number;
  duration: number;
  from?: THREE.Vector3;
  to?: THREE.Vector3;
  rise?: number;
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

function createHuman(player: PlayerState, local: boolean): PlayerRig {
  const root = new THREE.Group();
  const avatar = new THREE.Group();
  root.add(avatar);

  const jacket = new THREE.Color(player.color);
  const skin = standardMaterial(0xd9a27f, { roughness: 0.72 });
  const hair = standardMaterial(0x17131b, { roughness: 1 });
  const cloth = standardMaterial(jacket, { roughness: 0.88 });
  const clothDark = standardMaterial(jacket.clone().multiplyScalar(0.54), { roughness: 0.92 });
  const pants = standardMaterial(0x242a39, { roughness: 0.96 });
  const shoe = standardMaterial(0x171923, { roughness: 0.96 });
  const eye = standardMaterial(0x17101a, { roughness: 0.4 });

  const torso = mesh(new THREE.CapsuleGeometry(0.24, 0.48, 4, 10), cloth, [0, 1.02, 0]);
  torso.scale.set(1, 1, 0.72);
  avatar.add(torso);
  avatar.add(mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.16, 10), skin, [0, 1.38, 0]));
  avatar.add(mesh(new THREE.SphereGeometry(0.29, 16, 12), skin, [0, 1.64, 0]));

  const hairCap = mesh(new THREE.SphereGeometry(0.31, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.61), hair, [0, 1.7, 0.015]);
  hairCap.rotation.x = -0.08;
  avatar.add(hairCap);
  const fringe = mesh(new THREE.BoxGeometry(0.42, 0.14, 0.1), hair, [0, 1.73, -0.235]);
  fringe.rotation.z = -0.08;
  avatar.add(fringe);
  avatar.add(mesh(new THREE.SphereGeometry(0.027, 8, 6), eye, [-0.095, 1.64, -0.271]));
  avatar.add(mesh(new THREE.SphereGeometry(0.027, 8, 6), eye, [0.095, 1.64, -0.271]));
  avatar.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), skin, [0, 1.58, -0.285]));

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(-0.31, 1.25, 0);
  rightArm.position.set(0.31, 1.25, 0);
  leftArm.add(mesh(new THREE.CapsuleGeometry(0.075, 0.43, 3, 8), cloth, [0, -0.25, 0]));
  rightArm.add(mesh(new THREE.CapsuleGeometry(0.075, 0.43, 3, 8), cloth, [0, -0.25, 0]));
  leftArm.add(mesh(new THREE.SphereGeometry(0.078, 8, 6), skin, [0, -0.53, 0]));
  rightArm.add(mesh(new THREE.SphereGeometry(0.078, 8, 6), skin, [0, -0.53, 0]));
  avatar.add(leftArm, rightArm);

  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.125, 0.76, 0);
  rightLeg.position.set(0.125, 0.76, 0);
  leftLeg.add(mesh(new THREE.CapsuleGeometry(0.09, 0.39, 3, 8), pants, [0, -0.25, 0]));
  rightLeg.add(mesh(new THREE.CapsuleGeometry(0.09, 0.39, 3, 8), pants, [0, -0.25, 0]));
  leftLeg.add(mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), shoe, [0, -0.52, -0.05]));
  rightLeg.add(mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), shoe, [0, -0.52, -0.05]));
  avatar.add(leftLeg, rightLeg);

  const collar = mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16, Math.PI), clothDark, [0, 1.31, -0.08]);
  collar.rotation.x = Math.PI / 2;
  avatar.add(collar);

  const groundRing = mesh(
    new THREE.RingGeometry(local ? 0.38 : 0.34, local ? 0.44 : 0.38, 36),
    new THREE.MeshBasicMaterial({ color: local ? 0x74e6ff : player.color, transparent: true, opacity: local ? 0.72 : 0.3, side: THREE.DoubleSide }),
    [0, 0.025, 0],
  );
  groundRing.rotation.x = -Math.PI / 2;
  root.add(groundRing);
  root.scale.setScalar(0.88);
  return { root, avatar, leftArm, rightArm, leftLeg, rightLeg };
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
  };
  const palette = palettes[ghost.variant];
  const robe = standardMaterial(palette.robe, { roughness: 1, side: THREE.DoubleSide, emissive: palette.robe, emissiveIntensity: 0.48 });
  const skin = standardMaterial(palette.skin, { roughness: 0.92 });
  const black = standardMaterial(0x050407, { roughness: 1 });
  const glow = standardMaterial(palette.glow, { emissive: palette.glow, emissiveIntensity: 3.4, roughness: 0.25 });

  const brute = ghost.variant === 'brute';
  const cone = mesh(new THREE.ConeGeometry(brute ? 0.7 : 0.5, brute ? 1.45 : 1.3, 7, 1, true), robe, [0, 0.68, 0]);
  cone.rotation.y = Math.PI / 7;
  body.add(cone);
  const head = mesh(new THREE.SphereGeometry(brute ? 0.39 : 0.31, 14, 10), skin, [0, brute ? 1.55 : 1.48, -0.02]);
  head.scale.z = 0.78;
  body.add(head);
  const hair = mesh(new THREE.SphereGeometry(brute ? 0.41 : 0.335, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.68), black, [0, brute ? 1.64 : 1.57, 0]);
  body.add(hair);
  for (const x of [-0.105, 0.105]) body.add(mesh(new THREE.SphereGeometry(brute ? 0.047 : 0.038, 8, 6), glow, [x, brute ? 1.56 : 1.49, -0.265]));
  const mouth = mesh(new THREE.BoxGeometry(brute ? 0.24 : 0.18, 0.045, 0.025), black, [0, brute ? 1.42 : 1.36, -0.27]);
  body.add(mouth);

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  leftArm.position.set(brute ? -0.48 : -0.34, 1.18, 0);
  rightArm.position.set(brute ? 0.48 : 0.34, 1.18, 0);
  leftArm.rotation.z = brute ? 0.55 : 0.88;
  rightArm.rotation.z = brute ? -0.55 : -0.88;
  leftArm.add(mesh(new THREE.CapsuleGeometry(brute ? 0.095 : 0.065, brute ? 0.72 : 0.62, 3, 7), skin, [0, -0.38, 0]));
  rightArm.add(mesh(new THREE.CapsuleGeometry(brute ? 0.095 : 0.065, brute ? 0.72 : 0.62, 3, 7), skin, [0, -0.38, 0]));
  body.add(leftArm, rightArm);

  if (ghost.variant === 'caster') {
    const halo = mesh(new THREE.TorusGeometry(0.52, 0.025, 8, 32), glow, [0, 1.48, 0]);
    halo.rotation.x = Math.PI / 2;
    body.add(halo);
  }
  if (ghost.variant.startsWith('twin')) body.scale.setScalar(0.78);
  if (brute) body.scale.set(1.12, 1.12, 1.12);
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

function createBuildingModel(building: BuildingState): { root: THREE.Group; barrel: THREE.Group | null } {
  const root = new THREE.Group();
  const color = buildingColor(building.kind);
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

export class ThreeGameView {
  private readonly host: HTMLElement;
  private readonly mapData: MapDefinition;
  private readonly playerId: string;
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
  private localInput: Vec2 = { x: 0, y: 0 };
  private drag: PointerDrag | null = null;
  private followingPlayer = true;
  private focusedRoomId: string | null = null;
  private lastFrame = performance.now();
  private paused = false;
  private destroyed = false;

  constructor(host: HTMLElement, payload: ViewPayload) {
    this.host = host;
    this.mapData = payload.map;
    this.playerId = payload.playerId;
    this.snapshotData = payload.snapshot;
    this.scene.background = new THREE.Color(0x050812);
    this.scene.fog = new THREE.Fog(0x050812, 10, 34);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.55));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.dataset.renderer = 'three-3d';
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
    const dt = Math.min(0.05, Math.max(0.001, (time - this.lastFrame) / 1_000));
    this.lastFrame = time;
    this.animatePlayers(time, dt);
    this.animateGhosts(time, dt);
    this.animateTurrets();
    this.animateEffects(time);
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private createLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0x8fb8d5, 0x0a0714, 2.05));
    const moon = new THREE.DirectionalLight(0xb9dbf4, 3.65);
    moon.position.set(12, 18, 9);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 45;
    moon.shadow.camera.left = -14;
    moon.shadow.camera.right = 14;
    moon.shadow.camera.top = 14;
    moon.shadow.camera.bottom = -14;
    this.scene.add(moon);
    for (let x = 8; x < this.mapData.width; x += 14) {
      const light = new THREE.PointLight(x % 28 === 8 ? 0x72d9e8 : 0x8887df, 4.8, 8, 1.8);
      light.position.set(x, 2.4, this.mapData.corridor.y + this.mapData.corridor.height / 2 - 0.5);
      this.scene.add(light);
    }
  }

  private createWorld(): void {
    const corridorTiles = this.mapData.walkable.filter((tile) => tile.y >= this.mapData.corridor.y && tile.y < this.mapData.corridor.y + this.mapData.corridor.height);
    const roomTiles = this.mapData.walkable.filter((tile) => !corridorTiles.includes(tile));
    this.addTileInstances(corridorTiles, standardMaterial(0x1c2b3b, { roughness: 0.96 }), 0);
    this.addTileInstances(roomTiles, standardMaterial(0x243654, { roughness: 0.94 }), 0.003);

    const buildTiles = this.mapData.rooms.flatMap((room) => room.buildTiles);
    const markerGeometry = new THREE.PlaneGeometry(0.62, 0.62);
    markerGeometry.rotateX(-Math.PI / 2);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x5dc9df, transparent: true, opacity: 0.09, depthWrite: false });
    const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, buildTiles.length);
    const matrix = new THREE.Matrix4();
    buildTiles.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 0.025, tile.y);
      markers.setMatrixAt(index, matrix);
    });
    this.scene.add(markers);

    const wallGeometry = new THREE.BoxGeometry(0.98, 1.24, 0.98);
    const wallMaterial = standardMaterial(0x25374b, { roughness: 0.86 });
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, this.mapData.walls.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.mapData.walls.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 0.62, tile.y);
      walls.setMatrixAt(index, matrix);
    });
    this.scene.add(walls);
    const capGeometry = new THREE.BoxGeometry(1, 0.12, 1);
    const caps = new THREE.InstancedMesh(capGeometry, standardMaterial(0x4b687b, { roughness: 0.72 }), this.mapData.walls.length);
    this.mapData.walls.forEach((tile, index) => {
      matrix.makeTranslation(tile.x, 1.27, tile.y);
      caps.setMatrixAt(index, matrix);
    });
    this.scene.add(caps);

    const zone = this.mapData.respawnZone;
    const respawn = mesh(
      new THREE.PlaneGeometry(zone.width - 0.2, zone.height - 0.2),
      new THREE.MeshBasicMaterial({ color: 0x9b204d, transparent: true, opacity: 0.24, side: THREE.DoubleSide }),
      [zone.x + (zone.width - 1) / 2, 0.035, zone.y + (zone.height - 1) / 2],
    );
    respawn.rotation.x = -Math.PI / 2;
    this.scene.add(respawn);

    for (const room of this.mapData.rooms) this.createRoomFurniture(room.id);
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
    const bed = new THREE.Group();
    bed.position.copy(worldPoint(room.bed));
    const frame = standardMaterial(0x25314c, { metalness: 0.28, roughness: 0.65 });
    const blanket = standardMaterial(0x3e7890, { roughness: 0.95 });
    const pillow = standardMaterial(0xd7e2e8, { roughness: 1 });
    bed.add(mesh(new THREE.BoxGeometry(0.88, 0.18, 0.7), frame, [0, 0.13, 0]));
    bed.add(mesh(new THREE.BoxGeometry(0.82, 0.14, 0.64), blanket, [0, 0.29, 0]));
    bed.add(mesh(new THREE.BoxGeometry(0.35, 0.11, 0.54), pillow, [-0.2, 0.4, 0]));
    this.scene.add(bed);
  }

  private syncPlayers(players: PlayerState[]): void {
    const active = new Set(players.map((player) => player.id));
    for (const player of players) {
      let view = this.playerViews.get(player.id);
      if (!view) {
        const rig = createHuman(player, player.id === this.playerId);
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
      updateTextBillboard(view.label, `${player.displayRank}:${player.nickname}`, `${rankLabel(player.displayRank)} ${player.nickname}`, elite ? '#ecc9ff' : '#ffffff');
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
        label.scale.set(2.5, 0.62, 1);
        label.position.y = 2.22;
        const hp = makeBillboard();
        hp.scale.set(1.9, 0.46, 1);
        hp.position.y = 1.96;
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
        view = { root, panel, hp, label };
        this.doorViews.set(room.id, view);
      }
      const intact = state.doorHp > 0;
      const ratio = state.doorHp / Math.max(1, state.doorMaxHp);
      view.panel.visible = intact;
      updateTextBillboard(view.label, `${state.doorLevel}`, `문 Lv.${state.doorLevel}`, '#d8f8ff');
      updateBarBillboard(view.hp, `${Math.ceil(state.doorHp)}:${Math.ceil(state.doorMaxHp)}:${intact}`, ratio, intact ? `${Math.ceil(state.doorHp)} / ${Math.ceil(state.doorMaxHp)}` : '파괴됨', ratio > 0.5 ? '#55dfa0' : ratio > 0.22 ? '#ffc85f' : '#ff5578');
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
        view.root.position.x += this.localInput.x * localSpeed * dt;
        view.root.position.z += this.localInput.y * localSpeed * dt;
      }
      view.root.position.lerp(view.target, 1 - Math.exp(-(id === this.playerId ? 5.5 : 9) * dt));
      const dx = view.root.position.x - view.lastPosition.x;
      const dz = view.root.position.z - view.lastPosition.z;
      const moving = Math.hypot(dx, dz) > 0.0015;
      if (moving && !lying) view.avatar.rotation.y = damp(view.avatar.rotation.y, Math.atan2(dx, dz), 12, dt);
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
      if (Math.hypot(dx, dz) > 0.001) view.body.rotation.y = damp(view.body.rotation.y, Math.atan2(dx, dz), 9, dt);
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
      effect.object.scale.setScalar(1 + progress * 1.4);
      setObjectOpacity(effect.object, 1 - progress);
      if (progress < 1) continue;
      this.scene.remove(effect.object);
      this.effects.splice(index, 1);
    }
  }

  private playEvent(event: GameEvent): void {
    if ((event.kind === 'gold' || event.kind === 'power') && event.position && (event.amount ?? 0) > 0) {
      const popup = makeBillboard();
      popup.scale.set(1.15, 0.36, 1);
      updateTextBillboard(popup, `${event.kind}:${event.amount}:${performance.now()}`, `${event.kind === 'gold' ? '◆' : '⚡'} +${Math.max(1, Math.round(event.amount ?? 0))}`, event.kind === 'gold' ? '#ffd36f' : '#75e8ff', 'rgba(5,8,16,.72)');
      popup.position.copy(worldPoint(event.position, 1.35));
      this.scene.add(popup);
      this.effects.push({ object: popup, born: performance.now(), duration: 850, rise: 0.018 });
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
    if (!event.position || !['ghost-hit', 'door-hit', 'player-hit', 'death', 'build', 'ghost-level-up', 'ghost-skill'].includes(event.kind)) return;
    const color = event.kind === 'build' ? 0x68efa4 : event.kind === 'ghost-skill' ? 0xc27bff : 0xff5578;
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
    this.cameraTarget.lerp(this.desiredCameraTarget, 1 - Math.exp(-7.5 * dt));
    this.camera.position.copy(this.cameraTarget).add(CAMERA_OFFSET);
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
  }

  private unbindInput(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const local = this.snapshotData.players.find((player) => player.id === this.playerId);
    if (!local?.roomId) return;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    if (Math.hypot(dx, dy) > 7) this.drag.moved = true;
    if (!this.drag.moved) return;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.setY(0).normalize();
    this.desiredCameraTarget.addScaledVector(right, -dx * 0.015);
    this.desiredCameraTarget.addScaledVector(forward, dy * 0.015);
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (!moved) this.selectAt(event.clientX, event.clientY);
  };

  private selectAt(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.selectionSurface, false)[0];
    if (!hit) return;
    const tile = { x: Math.round(hit.point.x), y: Math.round(hit.point.z) };
    const building = this.snapshotData.buildings.find((candidate) => candidate.tile.x === tile.x && candidate.tile.y === tile.y);
    if (building) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'building', targetId: building.id, buildingId: building.id, roomId: building.roomId } }));
      return;
    }
    const bedRoom = this.mapData.rooms.find((room) => room.bed.x === tile.x && room.bed.y === tile.y);
    if (bedRoom) {
      this.highlight(tile);
      window.dispatchEvent(new CustomEvent<SceneSelection>('dorm:target-selected', { detail: { type: 'bed', targetId: `bed:${bedRoom.id}`, roomId: bedRoom.id } }));
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
