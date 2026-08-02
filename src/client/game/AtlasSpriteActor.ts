import * as THREE from 'three';
import type { AvatarAppearance, GhostVariant } from '../../shared/types';
import { skinMovementSheetUrl, skinSleepUrl } from './SkinAssets';

export type SpriteDirection = 'front' | 'back' | 'side';
export type SpriteAtlasMode =
  | 'movement'
  | 'attack'
  | 'skill-prepare'
  | 'skill-cast'
  | 'sleep';

export interface SpriteFacing {
  direction: SpriteDirection;
  mirrored: boolean;
}

interface AtlasLayerDefinition {
  movementUrl: string;
  attackUrl?: string;
  skillPrepareUrl?: string;
  skillCastUrl?: string;
  sleepUrl?: string;
  tint?: THREE.ColorRepresentation;
}

export interface AtlasSpriteDefinition extends AtlasLayerDefinition {
  size: number;
  renderOrder: number;
  name: string;
  /** Direction authored into the side row of the four-frame walk sheet. */
  movementSideFacesLeft?: boolean;
  /** Direction authored into the side row of the three-frame attack/skill sheet. */
  attackSideFacesLeft?: boolean;
  /** Some early concept sheets exported front/back rows in reverse order. */
  frontBackSwapped?: boolean;
}

interface TextureCacheEntry {
  texture: THREE.Texture;
  references: number;
}

interface AtlasLayer {
  movementUrl: string;
  movementTexture: THREE.Texture;
  attackUrl?: string;
  attackTexture?: THREE.Texture;
  skillPrepareUrl?: string;
  skillPrepareTexture?: THREE.Texture;
  skillCastUrl?: string;
  skillCastTexture?: THREE.Texture;
  sleepUrl?: string;
  sleepTexture?: THREE.Texture;
  material: THREE.ShaderMaterial;
  mapUniform: THREE.IUniform<THREE.Texture>;
  scaleUniform: THREE.IUniform<THREE.Vector2>;
  offsetUniform: THREE.IUniform<THREE.Vector2>;
  opacityUniform: THREE.IUniform<number>;
  tintUniform: THREE.IUniform<THREE.Color>;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  hideWhenSleeping: boolean;
}

type SpecialOpsMotionKind = 'croco-stomp' | 'monkey-dash';

interface SpecialOpsMotionEffect {
  kind: SpecialOpsMotionKind;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  material: THREE.MeshBasicMaterial;
}

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, TextureCacheEntry>();
const GHOST_ATLAS_VERSION = 'ghost-atlas-v5';
let fallbackGhostAtlas: THREE.CanvasTexture | null = null;
const specialOpsEffectTextures = new Map<SpecialOpsMotionKind, THREE.Texture>();

function specialOpsEffectTexture(kind: SpecialOpsMotionKind): THREE.Texture {
  const cached = specialOpsEffectTextures.get(kind);
  if (cached) return cached;
  if (kind === 'croco-stomp') {
    const texture = textureLoader.load('/assets/effects/croco-ground-impact.png?v=special-ops-v4');
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    specialOpsEffectTextures.set(kind, texture);
    return texture;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create special-ops movement effect');
  context.clearRect(0, 0, canvas.width, canvas.height);
  {
    const trail = context.createLinearGradient(18, 64, 226, 64);
    trail.addColorStop(0, 'rgba(185, 239, 255, 0)');
    trail.addColorStop(0.35, 'rgba(151, 218, 255, .2)');
    trail.addColorStop(0.72, 'rgba(239, 250, 255, .82)');
    trail.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.strokeStyle = trail;
    context.lineCap = 'round';
    for (let index = 0; index < 5; index += 1) {
      context.lineWidth = 7 - index;
      context.beginPath();
      context.moveTo(20 + index * 9, 34 + index * 14);
      context.bezierCurveTo(76, 20 + index * 13, 145, 48 + index * 7, 225, 44 + index * 9);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  specialOpsEffectTextures.set(kind, texture);
  return texture;
}

/**
 * Network/cache failures must never make a boss effectively invisible.  The
 * normal atlas remains the primary art; this is only swapped in by the image
 * loader error callback and mirrors the same 4×3 atlas layout.
 */
function ghostAtlasFallback(): THREE.CanvasTexture {
  if (fallbackGhostAtlas) return fallbackGhostAtlas;
  const cell = 96;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 4;
  canvas.height = cell * 3;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create ghost fallback atlas');
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const x = column * cell;
      const y = row * cell;
      const glow = context.createRadialGradient(x + cell / 2, y + cell / 2, 5, x + cell / 2, y + cell / 2, 39);
      glow.addColorStop(0, 'rgba(255, 115, 70, .95)');
      glow.addColorStop(0.55, 'rgba(130, 18, 38, .86)');
      glow.addColorStop(1, 'rgba(20, 2, 10, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x + cell / 2, y + cell / 2, 40, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#250612';
      context.beginPath();
      context.arc(x + cell / 2, y + 40, 23, Math.PI, 0);
      context.lineTo(x + cell / 2 + 27, y + 70);
      context.lineTo(x + cell / 2 - 27, y + 70);
      context.closePath();
      context.fill();
      context.fillStyle = '#ffcf5a';
      for (const eyeX of [x + cell / 2 - 9, x + cell / 2 + 9]) {
        context.beginPath();
        context.arc(eyeX, y + 47, 4, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
  fallbackGhostAtlas = new THREE.CanvasTexture(canvas);
  fallbackGhostAtlas.colorSpace = THREE.SRGBColorSpace;
  fallbackGhostAtlas.minFilter = THREE.LinearFilter;
  fallbackGhostAtlas.magFilter = THREE.LinearFilter;
  return fallbackGhostAtlas;
}

const SURVIVOR_IDS = new Set([
  'character-bunny',
  'character-cat',
  'character-puppy',
  'character-bear',
  'character-fox',
  'character-hamster',
  'character-crocodile',
  'character-duck',
  'character-tiger',
  'character-dinosaur',
  'character-monkey',
  'character-gorilla',
]);

const GHOST_SPRITE_IDS = new Set<GhostVariant>([
  'wanderer',
  'swift',
  'brute',
  'caster',
  'twin-a',
  'twin-b',
  'teleporter',
  'undead',
  'giant',
  'demolisher',
  'wallpaper',
]);

const ghostSizes: Record<GhostVariant, number> = {
  wanderer: 1.5,
  swift: 1.5,
  brute: 1.68,
  caster: 1.56,
  'twin-a': 1.36,
  'twin-b': 1.36,
  teleporter: 1.54,
  undead: 1.5,
  giant: 2.22,
  demolisher: 1.62,
  wallpaper: 1.58,
  minion: 0.76,
};

function acquireTexture(url: string): THREE.Texture {
  const cached = textureCache.get(url);
  if (cached) {
    cached.references += 1;
    return cached.texture;
  }
  const texture = textureLoader.load(
    url,
    undefined,
    undefined,
    () => {
      // iOS can retain a failed image response in a prior page cache.  Keep
      // the actor present while the next app load refetches the versioned URL.
      const fallback = ghostAtlasFallback();
      // TextureLoader is declared with HTMLImageElement even though WebGL
      // accepts a canvas source as well.
      texture.image = fallback.image as unknown as HTMLImageElement;
      texture.needsUpdate = true;
    },
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  textureCache.set(url, { texture, references: 1 });
  return texture;
}

function releaseTexture(url: string): void {
  const cached = textureCache.get(url);
  if (!cached) return;
  cached.references -= 1;
  if (cached.references > 0) return;
  cached.texture.dispose();
  textureCache.delete(url);
}

export function spriteFacingFromDelta(
  dx: number,
  dz: number,
  current: SpriteFacing = { direction: 'front', mirrored: false },
): SpriteFacing {
  if (Math.hypot(dx, dz) < 0.0001) return current;
  if (Math.abs(dx) > Math.abs(dz)) {
    return { direction: 'side', mirrored: dx < 0 };
  }
  return { direction: dz < 0 ? 'back' : 'front', mirrored: false };
}

export function movementFrameAt(time: number, moving: boolean, seed = 0): number {
  if (!moving) return 0;
  // Keep the torso anchored: idle frames between the two footfalls avoid the
  // side-to-side, running-like sway that a 1→2→3 loop produced.
  const phase = Math.floor((time + seed * 137) / 260) % 4;
  return phase === 1 ? 1 : phase === 3 ? 3 : 0;
}

export interface CrocoStompState {
  visible: boolean;
  opacity: number;
  expansion: number;
  footOffsetX: number;
}

/** Keeps each ground impact on the footfall between the two lifted-leg frames. */
export function crocoStompStateAt(time: number, seed = 0): CrocoStompState {
  const seededTime = time + seed * 137;
  const cycleTime = ((seededTime % 1_040) + 1_040) % 1_040;
  const step = Math.floor(cycleTime / 260);
  const landingElapsed = cycleTime % 260;
  const progress = Math.min(1, landingElapsed / 185);
  const landing = step === 0 || step === 2;
  const opacity = landing ? Math.pow(1 - progress, 1.35) * 0.86 : 0;
  return {
    visible: opacity > 0.035,
    opacity,
    expansion: progress,
    footOffsetX: step === 0 ? 0.15 : -0.15,
  };
}

export function attackFrameAt(elapsed: number, duration: number): number {
  if (duration <= 0) return 2;
  return Math.min(2, Math.max(0, Math.floor((elapsed / duration) * 3)));
}

export function survivorSpriteId(characterId: string): string {
  return SURVIVOR_IDS.has(characterId) ? characterId : 'character-bunny';
}

export function survivorSpriteDefinition(appearance: AvatarAppearance): AtlasSpriteDefinition {
  return {
    movementUrl: skinMovementSheetUrl(appearance),
    sleepUrl: skinSleepUrl(appearance),
    size: 1.2,
    renderOrder: 5_200,
    name: appearance.skin,
    // Every current paperdoll sheet follows front/back/side row order.
    // The old puppy-only swap made 몽 visibly walk backwards.
    frontBackSwapped: false,
    // 몽's source side artwork faces left, unlike the other survivor sheets.
    movementSideFacesLeft: appearance.character === 'character-puppy',
  };
}

export function ghostSpriteDefinition(variant: GhostVariant): AtlasSpriteDefinition {
  const safeVariant = GHOST_SPRITE_IDS.has(variant) ? variant : 'undead';
  return {
    // Versioning forces iOS Safari to discard an old, partially cached atlas
    // instead of keeping a transparent texture for the entire match.
    movementUrl: `/assets/sprites/ghosts/${safeVariant}/movement-sheet.png?v=${GHOST_ATLAS_VERSION}`,
    attackUrl: `/assets/sprites/ghosts/${safeVariant}/attack-sheet.png?v=${GHOST_ATLAS_VERSION}`,
    skillPrepareUrl: safeVariant === 'demolisher' || safeVariant === 'wallpaper'
      ? `/assets/sprites/ghosts/${safeVariant}/skill-prepare-sheet.png?v=${GHOST_ATLAS_VERSION}`
      : undefined,
    skillCastUrl: safeVariant === 'demolisher' || safeVariant === 'wallpaper'
      ? `/assets/sprites/ghosts/${safeVariant}/skill-cast-sheet.png?v=${GHOST_ATLAS_VERSION}`
      : undefined,
    size: ghostSizes[variant],
    renderOrder: 5_100,
    name: variant,
    // Movement and attack atlases were authored independently. In particular,
    // twin-a walks to the right in its movement row but strikes to the left in
    // its attack row. One shared flag made the walk face backwards whenever
    // the horizontal attack was corrected.
    movementSideFacesLeft:
      variant === 'wanderer' ||
      variant === 'swift' ||
      variant === 'brute' ||
      // 오염 도배귀의 이동 시트는 좌측을 바라보는 측면 원본이다.
      // 이 플래그가 없으면 왼쪽 이동에서 한 번 더 반전되어 뒤로 걷는다.
      variant === 'wallpaper',
    // Every side attack source was visually audited against its weapon, arms,
    // hair trail and forward foot. Twin-a and undead are the only current
    // attack sheets authored facing left; the movement direction can differ.
    attackSideFacesLeft:
      variant === 'twin-a' ||
      variant === 'undead',
  };
}

export function ghostAttackDuration(variant: GhostVariant): number {
  return variant === 'giant' ? 900 : variant === 'brute' ? 620 : 480;
}

export class AtlasSpriteActor {
  readonly object = new THREE.Group();
  readonly size: number;
  private readonly layers: AtlasLayer[] = [];
  private facing: SpriteFacing = { direction: 'front', mirrored: false };
  private readonly movementSideFacesLeft: boolean;
  private readonly attackSideFacesLeft: boolean;
  private readonly frontBackSwapped: boolean;
  private readonly movementEffect: SpecialOpsMotionEffect | null;
  private disposed = false;

  constructor(definition: AtlasSpriteDefinition) {
    this.size = definition.size;
    this.movementSideFacesLeft = Boolean(definition.movementSideFacesLeft);
    this.attackSideFacesLeft = Boolean(definition.attackSideFacesLeft);
    this.frontBackSwapped = Boolean(definition.frontBackSwapped);
    this.object.name = `${definition.name}-sprite-actor`;
    this.object.userData.renderMode = 'atlas-2d';
    this.object.position.y = 0.24;
    this.object.scale.setScalar(this.size);
    this.addLayer(definition, definition.renderOrder, false);
    this.movementEffect = this.createMovementEffect(definition.name, definition.renderOrder - 1);
    this.setFrame('movement', 0);
  }

  /**
   * Cosmetic atlases use the same twelve-cell grid as the neutral body and
   * stay independently reusable across every compatible character.
   */
  addCosmeticLayer(definition: AtlasLayerDefinition, renderOrder = 5_200 + this.layers.length): void {
    this.addLayer(definition, renderOrder, true);
    this.setFrame('movement', 0);
  }

  setMovement(dx: number, dz: number, moving: boolean, time: number, seed = 0): void {
    if (moving) this.facing = spriteFacingFromDelta(dx, dz, this.facing);
    this.setFrame('movement', movementFrameAt(time, moving, seed));
    this.updateMovementEffect(dx, dz, moving, time, seed);
  }

  setIdle(direction: SpriteDirection = this.facing.direction, mirrored = this.facing.mirrored): void {
    this.facing = { direction, mirrored };
    this.setFrame('movement', 0);
    if (this.movementEffect) this.movementEffect.mesh.visible = false;
  }

  setFacingFromDelta(dx: number, dz: number): void {
    this.facing = spriteFacingFromDelta(dx, dz, this.facing);
  }

  setSleep(mirrored = false): void {
    this.facing = { direction: 'side', mirrored };
    this.setFrame('sleep', 0);
    if (this.movementEffect) this.movementEffect.mesh.visible = false;
  }

  setAttack(elapsed: number, duration: number): void {
    this.setFrame('attack', attackFrameAt(elapsed, duration));
    if (this.movementEffect) this.movementEffect.mesh.visible = false;
  }

  setSkillPrepare(elapsed: number, duration: number): void {
    this.setFrame('skill-prepare', attackFrameAt(elapsed, duration));
  }

  setSkillCast(elapsed: number, duration: number): void {
    this.setFrame('skill-cast', attackFrameAt(elapsed, duration));
  }

  setScreenRotation(radians: number): void {
    this.object.rotation.y = radians;
  }

  setScale(scale: number): void {
    this.object.scale.setScalar(scale);
  }

  setOpacity(opacity: number): void {
    for (const layer of this.layers) layer.opacityUniform.value = opacity;
  }

  setTint(color: THREE.ColorRepresentation): void {
    for (const layer of this.layers) layer.tintUniform.value.set(color);
  }

  setVisualScale(width = 1, height = 1): void {
    this.object.scale.set(this.size * width, this.size, this.size * height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of this.layers) {
      releaseTexture(layer.movementUrl);
      if (layer.attackUrl) releaseTexture(layer.attackUrl);
      if (layer.skillPrepareUrl) releaseTexture(layer.skillPrepareUrl);
      if (layer.skillCastUrl) releaseTexture(layer.skillCastUrl);
      if (layer.sleepUrl) releaseTexture(layer.sleepUrl);
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    if (this.movementEffect) {
      this.movementEffect.mesh.geometry.dispose();
      this.movementEffect.material.dispose();
    }
    this.layers.length = 0;
  }

  private createMovementEffect(name: string, renderOrder: number): SpecialOpsMotionEffect | null {
    const kind: SpecialOpsMotionKind | null = name === 'skin-look-crocodile-police-enforcer'
      ? 'croco-stomp'
      : name === 'skin-look-monkey-secret-agent'
        ? 'monkey-dash'
        : null;
    if (!kind) return null;
    const material = new THREE.MeshBasicMaterial({
      map: specialOpsEffectTexture(kind),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, -0.012, kind === 'croco-stomp' ? 0.23 : 0.2);
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    mesh.name = `${name}-${kind}-effect`;
    this.object.add(mesh);
    return { kind, mesh, material };
  }

  private updateMovementEffect(dx: number, dz: number, moving: boolean, time: number, seed: number): void {
    const effect = this.movementEffect;
    if (!effect) return;
    effect.mesh.visible = moving;
    if (!moving) return;
    const seededTime = time + seed * 137;
    if (effect.kind === 'croco-stomp') {
      const stomp = crocoStompStateAt(time, seed);
      effect.mesh.visible = stomp.visible;
      effect.material.opacity = stomp.opacity;
      const scale = 0.78 + stomp.expansion * 0.34;
      effect.mesh.scale.set(scale, scale, scale);
      effect.mesh.position.x = this.facing.direction === 'side'
        ? this.facing.mirrored ? -0.21 : 0.21
        : stomp.footOffsetX * (this.facing.direction === 'back' ? -1 : 1);
      effect.mesh.position.z = this.facing.direction === 'back' ? 0.19 : 0.23;
      effect.mesh.rotation.y = 0;
      return;
    }
    const pulse = 0.72 + Math.sin(seededTime * 0.018) * 0.18;
    effect.material.opacity = pulse;
    effect.mesh.scale.set(1.05 + pulse * 0.28, 0.82 + pulse * 0.12, 1);
    effect.mesh.position.x = -Math.sign(dx || 1) * 0.22;
    effect.mesh.position.z = 0.2 + Math.sign(dz) * 0.08;
    effect.mesh.rotation.y = Math.atan2(dx, dz || 0.0001);
  }

  private addLayer(definition: AtlasLayerDefinition, renderOrder: number, hideWhenSleeping: boolean): void {
    const movementTexture = acquireTexture(definition.movementUrl);
    const attackTexture = definition.attackUrl ? acquireTexture(definition.attackUrl) : undefined;
    const skillPrepareTexture = definition.skillPrepareUrl
      ? acquireTexture(definition.skillPrepareUrl)
      : undefined;
    const skillCastTexture = definition.skillCastUrl
      ? acquireTexture(definition.skillCastUrl)
      : undefined;
    const sleepTexture = definition.sleepUrl ? acquireTexture(definition.sleepUrl) : undefined;
    const mapUniform = new THREE.Uniform(movementTexture);
    const scaleUniform = new THREE.Uniform(new THREE.Vector2(0.25, 1 / 3));
    const offsetUniform = new THREE.Uniform(new THREE.Vector2(0, 2 / 3));
    const opacityUniform = new THREE.Uniform(1);
    const tintUniform = new THREE.Uniform(new THREE.Color(definition.tint ?? 0xffffff));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        atlasMap: mapUniform,
        atlasScale: scaleUniform,
        atlasOffset: offsetUniform,
        actorTint: tintUniform,
        actorOpacity: opacityUniform,
      },
      vertexShader: `
        varying vec2 actorUv;
        void main() {
          actorUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D atlasMap;
        uniform vec2 atlasScale;
        uniform vec2 atlasOffset;
        uniform vec3 actorTint;
        uniform float actorOpacity;
        varying vec2 actorUv;
        void main() {
          vec4 texel = texture2D(atlasMap, actorUv * atlasScale + atlasOffset);
          float alpha = texel.a * actorOpacity;
          if (alpha < 0.025) discard;
          gl_FragColor = vec4(texel.rgb * actorTint, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.userData.actorOpacity = opacityUniform;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = renderOrder;
    plane.name = `${this.object.name}-layer-${this.layers.length}`;
    plane.userData.spriteActor = true;
    this.object.add(plane);
    this.layers.push({
      movementUrl: definition.movementUrl,
      movementTexture,
      attackUrl: definition.attackUrl,
      attackTexture,
      skillPrepareUrl: definition.skillPrepareUrl,
      skillPrepareTexture,
      skillCastUrl: definition.skillCastUrl,
      skillCastTexture,
      sleepUrl: definition.sleepUrl,
      sleepTexture,
      material,
      mapUniform,
      scaleUniform,
      offsetUniform,
      opacityUniform,
      tintUniform,
      mesh: plane,
      hideWhenSleeping,
    });
  }

  private setFrame(mode: SpriteAtlasMode, frame: number): void {
    const direction = mode !== 'sleep' && this.frontBackSwapped
      ? this.facing.direction === 'front'
        ? 'back'
        : this.facing.direction === 'back'
          ? 'front'
          : this.facing.direction
      : this.facing.direction;
    const row = direction === 'front' ? 0 : direction === 'back' ? 1 : 2;
    const skillMode = mode === 'skill-prepare' || mode === 'skill-cast';
    const columns = mode === 'sleep' ? 1 : mode === 'attack' || skillMode ? 3 : 4;
    const safeFrame = Math.min(columns - 1, Math.max(0, frame));
    for (const layer of this.layers) {
      const useSleep = mode === 'sleep' && Boolean(layer.sleepTexture);
      const useAttack = !useSleep && mode === 'attack' && Boolean(layer.attackTexture);
      const useSkillPrepare =
        !useSleep && mode === 'skill-prepare' && Boolean(layer.skillPrepareTexture);
      const useSkillCast =
        !useSleep && mode === 'skill-cast' && Boolean(layer.skillCastTexture);
      const usesThreeColumns = useAttack || useSkillPrepare || useSkillCast;
      const activeColumns = useSleep ? 1 : usesThreeColumns ? 3 : 4;
      const activeFrame = useSleep ? 0 : usesThreeColumns ? safeFrame : Math.min(3, safeFrame);
      const authoredSideFacesLeft =
        useAttack || useSkillPrepare || useSkillCast
          ? this.attackSideFacesLeft
          : this.movementSideFacesLeft;
      const mirrored =
        this.facing.mirrored !==
        (this.facing.direction === 'side' &&
          authoredSideFacesLeft &&
          !useSleep);
      layer.mapUniform.value = useSleep
        ? layer.sleepTexture as THREE.Texture
        : useSkillPrepare
          ? layer.skillPrepareTexture as THREE.Texture
          : useSkillCast
            ? layer.skillCastTexture as THREE.Texture
        : useAttack
          ? layer.attackTexture as THREE.Texture
          : layer.movementTexture;
      layer.scaleUniform.value.set(mirrored ? -1 / activeColumns : 1 / activeColumns, useSleep ? 1 : 1 / 3);
      layer.offsetUniform.value.set(
        mirrored ? (activeFrame + 1) / activeColumns : activeFrame / activeColumns,
        useSleep ? 0 : (2 - row) / 3,
      );
      layer.mesh.userData.direction = this.facing.direction;
      layer.mesh.userData.mirrored = mirrored;
      layer.mesh.userData.mode = useSleep
        ? 'sleep'
        : useSkillPrepare
          ? 'skill-prepare'
          : useSkillCast
            ? 'skill-cast'
            : useAttack
              ? 'attack'
              : 'movement';
      layer.mesh.userData.frame = activeFrame;
      layer.mesh.visible = !(mode === 'sleep' && layer.hideWhenSleeping);
    }
  }
}
