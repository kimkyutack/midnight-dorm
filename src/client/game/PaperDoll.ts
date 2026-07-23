import { cosmeticById } from '../../shared/customization';
import type { AvatarAppearance } from '../../shared/types';
import { survivorSpriteId } from './AtlasSpriteActor';

export const PAPER_DOLL_CELL_SIZE = 362;

type PaperDollProfile = 'slim' | 'standard' | 'broad';

const profileByCharacter: Record<string, PaperDollProfile> = {
  'character-cat': 'slim',
  'character-puppy': 'broad',
  'character-hamster': 'broad',
  'character-gorilla': 'broad',
};

export interface PaperDollLayer {
  id: string;
  url: string;
  renderOrder: number;
}

export function paperDollCharacterId(characterId: string): string {
  return survivorSpriteId(characterId);
}

export function paperDollBaseMovementUrl(characterId: string): string {
  return `/assets/paperdoll/bases/${paperDollCharacterId(characterId)}/movement-sheet.png`;
}

export function paperDollBaseFrameUrl(characterId: string, direction: 'front' | 'back' | 'side', frame: string): string {
  return `/assets/paperdoll/bases/${paperDollCharacterId(characterId)}/frames/${direction}-${frame}.png`;
}

export function paperDollFaceOverlayUrl(characterId: string): string {
  return `/assets/paperdoll/bases/${paperDollCharacterId(characterId)}/face-overlay-sheet.png`;
}

export function paperDollProfile(characterId: string): PaperDollProfile {
  return profileByCharacter[paperDollCharacterId(characterId)] ?? 'standard';
}

export function paperDollLayerUrl(characterId: string, cosmeticId: string): string | undefined {
  const item = cosmeticById(cosmeticId);
  if (!item || item.slot === 'character' || item.slot === 'turret' || cosmeticId === 'accessory-none') return undefined;
  const safeCharacter = paperDollCharacterId(characterId);
  if (item.slot === 'hat') return `/assets/paperdoll/layers/hats/${safeCharacter}/${cosmeticId}.png`;
  return `/assets/paperdoll/layers/profiles/${paperDollProfile(safeCharacter)}/${cosmeticId}.png`;
}

/** One stable order for preview canvases and the in-game sprite actor. */
export function paperDollLayers(appearance: AvatarAppearance): PaperDollLayer[] {
  const entries: Array<[string, number]> = [
    [appearance.accessory, appearance.accessory === 'accessory-backpack' ? 5_190 : 5_205],
    [appearance.outfit, 5_201],
    [appearance.shoes, 5_202],
    ['paperdoll-face-overlay', 5_203],
    [appearance.hat, 5_204],
  ];
  const unique = new Set<string>();
  const result: PaperDollLayer[] = [];
  for (const [id, renderOrder] of entries) {
    if (unique.has(id)) continue;
    unique.add(id);
    const url = id === 'paperdoll-face-overlay'
      ? paperDollFaceOverlayUrl(appearance.character)
      : paperDollLayerUrl(appearance.character, id);
    if (url) result.push({ id, url, renderOrder });
  }
  return result.sort((left, right) => left.renderOrder - right.renderOrder);
}

export function paperDollFrameIndex(frame: 'idle' | 'walk-1' | 'walk-2' | 'walk-3'): number {
  return frame === 'walk-1' ? 1 : frame === 'walk-2' ? 2 : frame === 'walk-3' ? 3 : 0;
}

export function paperDollDirectionRow(direction: 'front' | 'back' | 'side'): number {
  return direction === 'front' ? 0 : direction === 'back' ? 1 : 2;
}
