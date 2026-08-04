import { defaultSkinForCharacter, isDefaultSkinForCharacter } from '../../shared/customization';
import type { AvatarAppearance } from '../../shared/types';

export interface HomePoseAsset {
  atlasUrl: string;
  row: number;
  cellAspectRatio: number;
  frameColumns: number;
}

// Every sheet is repacked into exact 384px square cells. All six frames share
// one optical centre and baseline, so a yawn never shifts the character or
// samples a neighbouring row on fractional mobile pixels.
const atlas = (index: number, row: number): HomePoseAsset => ({
  atlasUrl: `/assets/home-poses/home-pose-atlas-${index}.webp?v=2026.08.04.2`,
  row,
  cellAspectRatio: 1,
  frameColumns: 6,
});

const HOME_POSE_ASSETS: Readonly<Record<string, HomePoseAsset>> = {
  'character-bunny': atlas(1, 0),
  'character-cat': atlas(1, 1),
  'character-puppy': atlas(1, 2),
  'character-bear': atlas(1, 3),
  'character-fox': atlas(1, 4),
  'character-hamster': atlas(2, 0),
  'character-crocodile': atlas(2, 1),
  'character-duck': atlas(2, 2),
  'character-tiger': atlas(2, 3),
  'character-dinosaur': atlas(2, 4),
  'character-monkey': atlas(3, 0),
  'character-gorilla': atlas(3, 1),
  'skin-look-bunny-ward': atlas(3, 2),
  'skin-look-cat-ward': atlas(3, 3),
  'skin-look-puppy-ward': atlas(3, 4),
  'skin-look-bear-ward': atlas(4, 0),
  'skin-look-fox-ward': atlas(4, 1),
  'skin-look-hamster-ward': atlas(4, 2),
  'skin-look-crocodile-ward': atlas(4, 3),
  'skin-look-duck-ward': atlas(4, 4),
  'skin-look-tiger-ward': atlas(5, 0),
  'skin-look-dinosaur-ward': atlas(5, 1),
  'skin-look-monkey-ward': atlas(5, 2),
  'skin-look-gorilla-ward': atlas(5, 3),
  'skin-look-puppy-surfer': atlas(5, 4),
  'skin-look-tiger-lifeguard': atlas(6, 0),
  'skin-look-cat-neon-rider': atlas(6, 1),
  'skin-look-hamster-cyber-driver': atlas(6, 2),
  'skin-look-crocodile-police-enforcer': atlas(6, 3),
  'skin-look-monkey-secret-agent': atlas(6, 4),
};

/** Selects the authored seated/yawn frames for the currently equipped full appearance. */
export function homePoseAsset(appearance: AvatarAppearance): HomePoseAsset {
  const key = isDefaultSkinForCharacter(appearance.skin, appearance.character)
    ? appearance.character
    : appearance.skin;
  return HOME_POSE_ASSETS[key]
    ?? HOME_POSE_ASSETS[appearance.character]
    ?? HOME_POSE_ASSETS['character-bunny']!;
}

export function homePoseKey(appearance: AvatarAppearance): string {
  return isDefaultSkinForCharacter(appearance.skin, appearance.character)
    ? defaultSkinForCharacter(appearance.character)
    : appearance.skin;
}
