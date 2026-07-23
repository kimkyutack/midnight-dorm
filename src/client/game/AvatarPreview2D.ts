import type { AvatarAppearance, RankId } from '../../shared/types';
import { type SpriteDirection } from './AtlasSpriteActor';
import {
  SKIN_CELL_SIZE,
  skinDirectionRow,
  skinFrameIndex,
  skinMovementSheetUrl,
} from './SkinAssets';

export type AvatarSpriteView = SpriteDirection;
type MovementFrame = 'idle' | 'walk-1' | 'walk-2' | 'walk-3';

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load skin asset: ${url}`));
    image.src = url;
  });
  imageCache.set(url, pending);
  return pending;
}

/** Shared pre-rendered skin canvas for the home, store, and fitting room. */
export class AvatarPreview2D {
  private readonly host: HTMLElement;
  private readonly homePresentation: boolean;
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private appearance: AvatarAppearance;
  private direction: SpriteDirection = 'front';
  private animationFrame = 0;
  private homeStep = -1;
  private renderVersion = 0;
  private destroyed = false;

  constructor(host: HTMLElement, appearance: AvatarAppearance, _rank: RankId, _color = 0x78e4ef) {
    this.host = host;
    this.appearance = { ...appearance };
    this.homePresentation = host.classList.contains('home-avatar-model');
    this.root.className = this.homePresentation ? 'avatar-sprite-preview home-sprite-preview' : 'avatar-sprite-preview';
    this.canvas.className = this.homePresentation ? 'skin-preview-canvas home-skin-preview' : 'skin-preview-canvas';
    this.canvas.width = SKIN_CELL_SIZE;
    this.canvas.height = SKIN_CELL_SIZE;
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '선택한 캐릭터 외형 미리보기');
    this.canvas.dataset.previewKind = 'avatar';
    this.canvas.dataset.avatarView = this.direction;
    this.canvas.dataset.skinId = appearance.skin;
    const context = this.canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D paper-doll canvas is unavailable.');
    this.context = context;
    this.context.imageSmoothingEnabled = true;
    this.root.dataset.character = appearance.character;
    this.root.dataset.skin = appearance.skin;
    this.canvas.dataset.skinId = appearance.skin;
    this.root.appendChild(this.canvas);
    this.host.insertBefore(this.root, this.host.firstChild);
    this.render('idle');
    if (this.homePresentation) this.animationFrame = requestAnimationFrame(this.animateHome);
  }

  updateAppearance(appearance: AvatarAppearance, _rank: RankId, _color = 0x78e4ef): void {
    this.appearance = { ...appearance };
    this.root.dataset.character = appearance.character;
    this.root.dataset.skin = appearance.skin;
    this.canvas.dataset.skinId = appearance.skin;
    this.render(this.homePresentation ? this.homeFrame() : 'idle');
  }

  setView(view: AvatarSpriteView): void {
    this.direction = view;
    this.canvas.dataset.avatarView = view;
    this.render('idle');
  }

  getRotation(): number {
    return this.direction === 'front' ? 0 : this.direction === 'side' ? -Math.PI / 2 : Math.PI;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    this.root.remove();
  }

  private homeFrame(): MovementFrame {
    return this.homeStep === 1 ? 'walk-1' : this.homeStep === 3 ? 'walk-3' : 'idle';
  }

  private render(frame: MovementFrame): void {
    if (this.destroyed) return;
    const version = ++this.renderVersion;
    const direction = this.homePresentation ? 'front' : this.direction;
    void loadImage(skinMovementSheetUrl(this.appearance))
      .then((skin) => {
        if (this.destroyed || version !== this.renderVersion) return;
        this.context.clearRect(0, 0, SKIN_CELL_SIZE, SKIN_CELL_SIZE);
        this.drawAtlas(skin, direction, frame);
      })
      .catch((error) => {
        console.warn('Skin preview unavailable', error);
      });
  }

  private drawAtlas(image: HTMLImageElement, direction: SpriteDirection, frame: MovementFrame): void {
    const x = skinFrameIndex(frame) * SKIN_CELL_SIZE;
    const y = skinDirectionRow(direction) * SKIN_CELL_SIZE;
    this.context.drawImage(
      image,
      x,
      y,
      SKIN_CELL_SIZE,
      SKIN_CELL_SIZE,
      0,
      0,
      SKIN_CELL_SIZE,
      SKIN_CELL_SIZE,
    );
  }

  private readonly animateHome = (time: number): void => {
    if (this.destroyed) return;
    const step = Math.floor(time / 360) % 4;
    if (step !== this.homeStep) {
      this.homeStep = step;
      this.render(this.homeFrame());
    }
    this.animationFrame = requestAnimationFrame(this.animateHome);
  };
}
