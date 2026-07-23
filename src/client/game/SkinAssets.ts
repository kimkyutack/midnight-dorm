import { cosmeticById } from '../../shared/customization';
import type { AvatarAppearance } from '../../shared/types';

export const SKIN_CELL_SIZE = 362;

const SURVIVOR_IDS = new Set([
  'character-bunny', 'character-cat', 'character-puppy', 'character-bear',
  'character-fox', 'character-hamster', 'character-crocodile',
  'character-duck', 'character-tiger', 'character-dinosaur',
  'character-monkey', 'character-gorilla',
]);

const safeSurvivorId = (characterId: string): string =>
  SURVIVOR_IDS.has(characterId) ? characterId : 'character-bunny';

/** Add only complete concept, movement, and sleep PNG sets to this registry. */
const BAKED_SKIN_DIRECTORIES: Readonly<Record<string, string>> = {};

function skinDirectory(skinId: string, characterId: string): string {
  return BAKED_SKIN_DIRECTORIES[skinId] ?? `/assets/sprites/survivors/${safeSurvivorId(characterId)}`;
}

/** A valid appearance always points to one fully rendered atlas, never layers. */
export function skinAssetDirectory(appearance: AvatarAppearance): string {
  const skin = cosmeticById(appearance.skin);
  const characterId = skin?.slot === 'skin' && skin.characterId === appearance.character
    ? appearance.character
    : 'character-bunny';
  return skinDirectory(appearance.skin, characterId);
}

export function skinMovementSheetUrl(appearance: AvatarAppearance): string {
  return `${skinAssetDirectory(appearance)}/movement-sheet.png`;
}

export function skinConceptUrl(skinId: string): string | undefined {
  const skin = cosmeticById(skinId);
  if (skin?.slot !== 'skin' || !skin.characterId) return undefined;
  return `${skinDirectory(skinId, skin.characterId)}/concept.png`;
}

export function skinSleepUrl(appearance: AvatarAppearance): string {
  return `${skinAssetDirectory(appearance)}/sleep.png`;
}

export function skinFrameIndex(frame: 'idle' | 'walk-1' | 'walk-2' | 'walk-3'): number {
  return frame === 'walk-1' ? 1 : frame === 'walk-2' ? 2 : frame === 'walk-3' ? 3 : 0;
}

export function skinDirectionRow(direction: 'front' | 'back' | 'side'): number {
  return direction === 'front' ? 0 : direction === 'back' ? 1 : 2;
}
