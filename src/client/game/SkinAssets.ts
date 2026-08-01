import { cosmeticById, defaultSkinForCharacter, isDefaultSkinForCharacter } from '../../shared/customization';
import type { AvatarAppearance } from '../../shared/types';

export const SKIN_CELL_SIZE = 362;

const SKIN_ASSET_VERSIONS = new Map<string, string>([
  ['skin-look-crocodile-police-enforcer', 'special-ops-v3'],
  ['skin-look-monkey-secret-agent', 'special-ops-v3'],
]);

const SURVIVOR_IDS = new Set([
  'character-bunny', 'character-cat', 'character-puppy', 'character-bear',
  'character-fox', 'character-hamster', 'character-crocodile',
  'character-duck', 'character-tiger', 'character-dinosaur',
  'character-monkey', 'character-gorilla',
]);

const safeSurvivorId = (characterId: string): string =>
  SURVIVOR_IDS.has(characterId) ? characterId : 'character-bunny';

function skinDirectory(skinId: string, characterId: string): string {
  const safeCharacter = safeSurvivorId(characterId);
  if (isDefaultSkinForCharacter(skinId, safeCharacter)) {
    return `/assets/paperdoll/bases/${safeCharacter}`;
  }
  const skin = cosmeticById(skinId);
  return skin?.slot === 'skin' && skin.characterId === safeCharacter && skin.assetDirectory
    ? `/assets/sprites/skins/${skin.assetDirectory}`
    : `/assets/sprites/survivors/${safeCharacter}`;
}

function skinAssetVersion(skinId: string): string {
  const version = SKIN_ASSET_VERSIONS.get(skinId);
  return version ? `?v=${version}` : '';
}

/** A valid appearance always points to one fully rendered atlas, never layers. */
export function skinAssetDirectory(appearance: AvatarAppearance): string {
  const skin = cosmeticById(appearance.skin);
  const characterId = isDefaultSkinForCharacter(appearance.skin, appearance.character) || (skin?.slot === 'skin' && skin.characterId === appearance.character)
    ? appearance.character
    : 'character-bunny';
  return skinDirectory(appearance.skin, characterId);
}

export function skinMovementSheetUrl(appearance: AvatarAppearance): string {
  return `${skinAssetDirectory(appearance)}/movement-sheet.png${skinAssetVersion(appearance.skin)}`;
}

export function skinConceptUrl(skinId: string): string | undefined {
  const skin = cosmeticById(skinId);
  if (skin?.slot !== 'skin' || !skin.characterId) return undefined;
  return `${skinDirectory(skinId, skin.characterId)}/concept.png${skinAssetVersion(skinId)}`;
}

export function baseConceptUrl(characterId: string): string {
  const safeCharacter = safeSurvivorId(characterId);
  return `${skinDirectory(defaultSkinForCharacter(safeCharacter), safeCharacter)}/concept.png`;
}

export function skinSleepUrl(appearance: AvatarAppearance): string {
  return `${skinAssetDirectory(appearance)}/sleep.png${skinAssetVersion(appearance.skin)}`;
}

export function skinFrameIndex(frame: 'idle' | 'walk-1' | 'walk-2' | 'walk-3'): number {
  return frame === 'walk-1' ? 1 : frame === 'walk-2' ? 2 : frame === 'walk-3' ? 3 : 0;
}

export function skinDirectionRow(direction: 'front' | 'back' | 'side'): number {
  return direction === 'front' ? 0 : direction === 'back' ? 1 : 2;
}
