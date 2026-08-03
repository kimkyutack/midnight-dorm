import { describe, expect, it } from 'vitest';
import {
  cosmeticsForSlot,
  defaultSkinForCharacter,
} from '../src/shared/customization';
import { homePoseAsset } from '../src/client/game/HomePoseAssets';

describe('home seated and yawn pose assets', () => {
  it('maps every base character to a valid two-frame atlas row', () => {
    for (const character of cosmeticsForSlot('character')) {
      const asset = homePoseAsset({
        character: character.id,
        skin: defaultSkinForCharacter(character.id),
      });
      expect(asset.atlasUrl).toMatch(/home-pose-atlas-[1-6]\.webp/);
      expect(asset.row).toBeGreaterThanOrEqual(0);
      expect(asset.row).toBeLessThan(5);
      expect(asset.cellAspectRatio).toBeGreaterThan(0);
    }
  });

  it('maps every catalog skin without falling back to the base bunny atlas row', () => {
    for (const skin of cosmeticsForSlot('skin')) {
      if (!skin.characterId) continue;
      const asset = homePoseAsset({ character: skin.characterId, skin: skin.id });
      const bunnyFallback = homePoseAsset({
        character: 'character-bunny',
        skin: defaultSkinForCharacter('character-bunny'),
      });
      expect(`${asset.atlasUrl}:${asset.row}`).not.toBe(
        `${bunnyFallback.atlasUrl}:${bunnyFallback.row}`,
      );
    }
  });
});
