import { cosmeticById, defaultSkinForCharacter, isDefaultSkinForCharacter } from '../../shared/customization';
import type { AvatarAppearance } from '../../shared/types';

export const SKIN_CELL_SIZE = 362;

const SKIN_ASSET_VERSIONS = new Map<string, string>([
  ['skin-look-crocodile-police-enforcer', 'special-ops-v7'],
  ['skin-look-monkey-secret-agent', 'special-ops-v5'],
  ['skin-look-fox-moonlit-phantom', 'moonlit-prestige-v10'],
  ['skin-look-bunny-starlit-cloud', 'starlit-prestige-v7'],
  ['skin-look-gorilla-abyssal-knight', 'abyssal-prestige-v7'],
]);

// These prestige atlases are WebP on web and native. Unlike legacy PNG skin
// sheets they keep alpha while avoiding a multi-megabyte room-entry download.
const WEBP_SKIN_IDS = new Set([
  'skin-look-fox-moonlit-phantom',
  'skin-look-bunny-starlit-cloud',
  'skin-look-gorilla-abyssal-knight',
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

function skinAssetExtension(skinId: string): 'png' | 'webp' {
  // The production/native bundle is image-optimized after Vite finishes: PNG
  // files are replaced by WebP files.  Do not rely on that post-build script
  // rewriting a dynamically assembled URL; otherwise a cached production
  // chunk can request a now-removed PNG and leave the avatar canvas empty.
  // Local Vite keeps the authoring PNGs for quick iteration, while the two
  // prestige atlases are authored as WebP in both environments.
  return !import.meta.env.DEV || WEBP_SKIN_IDS.has(skinId) ? 'webp' : 'png';
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
  return `${skinAssetDirectory(appearance)}/movement-sheet.${skinAssetExtension(appearance.skin)}${skinAssetVersion(appearance.skin)}`;
}

export function skinConceptUrl(skinId: string): string | undefined {
  const skin = cosmeticById(skinId);
  if (skin?.slot !== 'skin' || !skin.characterId) return undefined;
  // Legacy/standard skins intentionally reuse the base survivor artwork. Do
  // not manufacture a skin-directory URL for them: those images do not exist
  // in the deployed asset bundle and would leave the gacha result card broken.
  if (!skin.assetDirectory) return baseConceptUrl(skin.characterId);
  return `${skinDirectory(skinId, skin.characterId)}/concept.${skinAssetExtension(skinId)}${skinAssetVersion(skinId)}`;
}

export function baseConceptUrl(characterId: string): string {
  const safeCharacter = safeSurvivorId(characterId);
  return `${skinDirectory(defaultSkinForCharacter(safeCharacter), safeCharacter)}/concept.png`;
}

export function skinSleepUrl(appearance: AvatarAppearance): string {
  return `${skinAssetDirectory(appearance)}/sleep.${skinAssetExtension(appearance.skin)}${skinAssetVersion(appearance.skin)}`;
}

export function skinFrameIndex(frame: 'idle' | 'walk-1' | 'walk-2' | 'walk-3'): number {
  return frame === 'walk-1' ? 1 : frame === 'walk-2' ? 2 : frame === 'walk-3' ? 3 : 0;
}

export function skinDirectionRow(direction: 'front' | 'back' | 'side'): number {
  return direction === 'front' ? 0 : direction === 'back' ? 1 : 2;
}
