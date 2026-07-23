import * as THREE from 'three';
import type { AvatarAppearance, GhostVariant } from '../../shared/types';
import { skinMovementSheetUrl, skinSleepUrl } from './SkinAssets';

export type SpriteDirection = 'front' | 'back' | 'side';
export type SpriteAtlasMode = 'movement' | 'attack' | 'sleep';

export interface SpriteFacing {
  direction: SpriteDirection;
  mirrored: boolean;
}

interface AtlasLayerDefinition {
  movementUrl: string;
  attackUrl?: string;
  sleepUrl?: string;
  tint?: THREE.ColorRepresentation;
}

export interface AtlasSpriteDefinition extends AtlasLayerDefinition {
  size: number;
  renderOrder: number;
  name: string;
  sideFacesLeft?: boolean;
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
  sleepUrl?: string;
  sleepTexture?: THREE.Texture;
  material: THREE.ShaderMaterial;
  mapUniform: THREE.IUniform<THREE.Texture>;
  scaleUniform: THREE.IUniform<THREE.Vector2>;
  offsetUniform: THREE.IUniform<THREE.Vector2>;
  opacityUniform: THREE.IUniform<number>;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  hideWhenSleeping: boolean;
}

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, TextureCacheEntry>();
const GHOST_ATLAS_VERSION = 'ghost-atlas-v2';
let fallbackGhostAtlas: THREE.CanvasTexture | null = null;

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
  };
}

export function ghostSpriteDefinition(variant: GhostVariant): AtlasSpriteDefinition {
  const safeVariant = GHOST_SPRITE_IDS.has(variant) ? variant : 'undead';
  return {
    // Versioning forces iOS Safari to discard an old, partially cached atlas
    // instead of keeping a transparent texture for the entire match.
    movementUrl: `/assets/sprites/ghosts/${safeVariant}/movement-sheet.png?v=${GHOST_ATLAS_VERSION}`,
    attackUrl: `/assets/sprites/ghosts/${safeVariant}/attack-sheet.png?v=${GHOST_ATLAS_VERSION}`,
    size: ghostSizes[variant],
    renderOrder: 5_100,
    name: variant,
    sideFacesLeft: variant === 'wanderer' || variant === 'swift' || variant === 'brute',
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
  private readonly sideFacesLeft: boolean;
  private disposed = false;

  constructor(definition: AtlasSpriteDefinition) {
    this.size = definition.size;
    this.sideFacesLeft = Boolean(definition.sideFacesLeft);
    this.object.name = `${definition.name}-sprite-actor`;
    this.object.userData.renderMode = 'atlas-2d';
    this.object.position.y = 0.24;
    this.object.scale.setScalar(this.size);
    this.addLayer(definition, definition.renderOrder, false);
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
  }

  setIdle(direction: SpriteDirection = this.facing.direction, mirrored = this.facing.mirrored): void {
    this.facing = { direction, mirrored };
    this.setFrame('movement', 0);
  }

  setSleep(mirrored = false): void {
    this.facing = { direction: 'side', mirrored };
    this.setFrame('sleep', 0);
  }

  setAttack(elapsed: number, duration: number): void {
    this.setFrame('attack', attackFrameAt(elapsed, duration));
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of this.layers) {
      releaseTexture(layer.movementUrl);
      if (layer.attackUrl) releaseTexture(layer.attackUrl);
      if (layer.sleepUrl) releaseTexture(layer.sleepUrl);
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    this.layers.length = 0;
  }

  private addLayer(definition: AtlasLayerDefinition, renderOrder: number, hideWhenSleeping: boolean): void {
    const movementTexture = acquireTexture(definition.movementUrl);
    const attackTexture = definition.attackUrl ? acquireTexture(definition.attackUrl) : undefined;
    const sleepTexture = definition.sleepUrl ? acquireTexture(definition.sleepUrl) : undefined;
    const mapUniform = new THREE.Uniform(movementTexture);
    const scaleUniform = new THREE.Uniform(new THREE.Vector2(0.25, 1 / 3));
    const offsetUniform = new THREE.Uniform(new THREE.Vector2(0, 2 / 3));
    const opacityUniform = new THREE.Uniform(1);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        atlasMap: mapUniform,
        atlasScale: scaleUniform,
        atlasOffset: offsetUniform,
        actorTint: new THREE.Uniform(new THREE.Color(definition.tint ?? 0xffffff)),
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
      sleepUrl: definition.sleepUrl,
      sleepTexture,
      material,
      mapUniform,
      scaleUniform,
      offsetUniform,
      opacityUniform,
      mesh: plane,
      hideWhenSleeping,
    });
  }

  private setFrame(mode: SpriteAtlasMode, frame: number): void {
    const row = this.facing.direction === 'front' ? 0 : this.facing.direction === 'back' ? 1 : 2;
    const columns = mode === 'sleep' ? 1 : mode === 'attack' ? 3 : 4;
    const safeFrame = Math.min(columns - 1, Math.max(0, frame));
    for (const layer of this.layers) {
      const useSleep = mode === 'sleep' && Boolean(layer.sleepTexture);
      const useAttack = !useSleep && mode === 'attack' && Boolean(layer.attackTexture);
      const activeColumns = useSleep ? 1 : useAttack ? 3 : 4;
      const activeFrame = useSleep ? 0 : useAttack ? safeFrame : Math.min(3, safeFrame);
      const mirrored = this.facing.mirrored !== (this.facing.direction === 'side' && this.sideFacesLeft && !useSleep);
      layer.mapUniform.value = useSleep
        ? layer.sleepTexture as THREE.Texture
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
      layer.mesh.userData.mode = useSleep ? 'sleep' : useAttack ? 'attack' : 'movement';
      layer.mesh.userData.frame = activeFrame;
      layer.mesh.visible = !(mode === 'sleep' && layer.hideWhenSleeping);
    }
  }
}
