import { describe, expect, it } from 'vitest';
import path from 'node:path';
import sharp from 'sharp';
import {
  cosmeticsForSlot,
  defaultSkinForCharacter,
} from '../src/shared/customization';
import { homePoseAsset } from '../src/client/game/HomePoseAssets';

describe('home seated and yawn pose assets', () => {
  it('maps every base character to a valid six-frame atlas row', () => {
    for (const character of cosmeticsForSlot('character')) {
      const asset = homePoseAsset({
        character: character.id,
        skin: defaultSkinForCharacter(character.id),
      });
      expect(asset.atlasUrl).toMatch(/home-pose-atlas-[1-6]\.webp/);
      expect(asset.row).toBeGreaterThanOrEqual(0);
      expect(asset.row).toBeLessThan(5);
      expect(asset.cellAspectRatio).toBeGreaterThan(0);
      expect(asset.frameColumns).toBe(6);
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

  it('keeps all 180 frames inside their own square cell with a safe transparent edge', async () => {
    const cell = 384;
    const columns = 6;
    const rows = 5;
    const safeEdge = 12;
    for (let atlas = 1; atlas <= 6; atlas += 1) {
      const decoded = await sharp(path.join(
        process.cwd(),
        `public/assets/home-poses/home-pose-atlas-${atlas}.webp`,
      )).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width).toBe(cell * columns);
      expect(decoded.info.height).toBe(cell * rows);
      for (let row = 0; row < rows; row += 1) {
        const frameWidths: number[] = [];
        const frameHeights: number[] = [];
        const frameBottoms: number[] = [];
        for (let column = 0; column < columns; column += 1) {
          let visiblePixels = 0;
          let edgePixels = 0;
          let left = cell;
          let right = -1;
          let top = cell;
          let bottom = -1;
          for (let y = 0; y < cell; y += 1) {
            for (let x = 0; x < cell; x += 1) {
              const sourceX = column * cell + x;
              const sourceY = row * cell + y;
              const alpha = decoded.data[
                (sourceY * decoded.info.width + sourceX) * 4 + 3
              ] ?? 0;
              if (alpha <= 18) continue;
              visiblePixels += 1;
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
              if (
                x < safeEdge || x >= cell - safeEdge ||
                y < safeEdge || y >= cell - safeEdge
              ) edgePixels += 1;
            }
          }
          expect(visiblePixels).toBeGreaterThan(1_000);
          expect(edgePixels).toBe(0);
          frameWidths.push(right - left + 1);
          frameHeights.push(bottom - top + 1);
          frameBottoms.push(bottom);
        }
        expect(Math.max(...frameWidths) - Math.min(...frameWidths)).toBeLessThanOrEqual(1);
        expect(Math.max(...frameHeights) - Math.min(...frameHeights)).toBeLessThanOrEqual(1);
        expect(Math.max(...frameBottoms) - Math.min(...frameBottoms)).toBeLessThanOrEqual(1);
      }
    }
  }, 20_000);
});
