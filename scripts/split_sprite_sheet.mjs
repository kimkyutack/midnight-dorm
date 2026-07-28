#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const [input, outputDirectory, kind = 'movement'] = process.argv.slice(2);
if (!input || !outputDirectory || !['movement', 'attack'].includes(kind)) {
  throw new Error('usage: node scripts/split_sprite_sheet.mjs <input> <output-dir> <movement|attack>');
}

const directions = ['front', 'back', 'side'];
const actions = kind === 'movement'
  ? ['idle', 'walk-1', 'walk-2', 'walk-3']
  : ['attack-1', 'attack-2', 'attack-3'];
const image = sharp(input);
const metadata = await image.metadata();
if (!metadata.width || !metadata.height) throw new Error(`unable to read sprite sheet: ${input}`);
await mkdir(outputDirectory, { recursive: true });

for (const [row, direction] of directions.entries()) {
  const top = Math.round(row * metadata.height / directions.length);
  const bottom = Math.round((row + 1) * metadata.height / directions.length);
  for (const [column, action] of actions.entries()) {
    const left = Math.round(column * metadata.width / actions.length);
    const right = Math.round((column + 1) * metadata.width / actions.length);
    const width = right - left;
    const height = bottom - top;
    const borderGutter = kind === 'movement' ? Math.min(8, height - 1) : 0;
    await sharp(input)
      .extract({
        left,
        top: top + borderGutter,
        width,
        height: height - borderGutter * 2,
      })
      .extend({
        top: borderGutter,
        bottom: borderGutter,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(outputDirectory, `${direction}-${action}.png`));
  }
}
