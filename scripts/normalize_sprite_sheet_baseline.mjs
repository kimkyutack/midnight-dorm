#!/usr/bin/env node
import path from 'node:path';
import sharp from 'sharp';

const [input, output, requestedBottom = '12'] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('usage: node scripts/normalize_sprite_sheet_baseline.mjs <input> <output> [bottom-padding]');
}

const columns = 4;
const rows = 3;
const { data, info } = await sharp(input)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.width % columns !== 0 || info.height % rows !== 0) {
  throw new Error(`sprite sheet must be a 4x3 grid: ${info.width}x${info.height}`);
}

const cellWidth = info.width / columns;
const cellHeight = info.height / rows;
const frames = [];
let maximumSafeBottom = Number.POSITIVE_INFINITY;

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    let minimumX = cellWidth;
    let maximumX = -1;
    let minimumY = cellHeight;
    let maximumY = -1;
    for (let y = 0; y < cellHeight; y += 1) {
      for (let x = 0; x < cellWidth; x += 1) {
        const offset = (((row * cellHeight + y) * info.width) + column * cellWidth + x) * 4;
        if (data[offset + 3] > 24) {
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
          minimumY = Math.min(minimumY, y);
          maximumY = y;
        }
      }
    }
    const bottom = maximumY < 0 ? 0 : cellHeight - 1 - maximumY;
    const centerX = maximumX < 0 ? (cellWidth - 1) / 2 : (minimumX + maximumX) / 2;
    frames.push({ row, column, bottom, centerX });
    maximumSafeBottom = Math.min(maximumSafeBottom, bottom + minimumY);
  }
}

const targetBottom = Math.max(0, Math.min(Number(requestedBottom) || 0, maximumSafeBottom));

const normalized = Buffer.alloc(data.length);
for (const frame of frames) {
  // Positive offsets move into existing bottom padding; negative offsets use
  // verified top padding. Every prestige skin therefore shares one 12px foot
  // baseline without cropping ears, helmets, or effects.
  const offsetY = frame.bottom - targetBottom;
  // Every authored pose has a different amount of transparent padding. Align
  // the visible alpha bounds, not the source canvas, so preview animations do
  // not appear to walk sideways while their canvas remains stationary.
  const offsetX = Math.round(((cellWidth - 1) / 2) - frame.centerX);
  for (let y = 0; y < cellHeight; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= cellHeight) continue;
    for (let x = 0; x < cellWidth; x += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= cellWidth) continue;
      const sourceOffset = (((frame.row * cellHeight + y) * info.width) + frame.column * cellWidth + x) * 4;
      const targetOffset = (((frame.row * cellHeight + targetY) * info.width) + frame.column * cellWidth + targetX) * 4;
      data.copy(normalized, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

let pipeline = sharp(normalized, {
  raw: { width: info.width, height: info.height, channels: 4 },
});
if (path.extname(output).toLowerCase() === '.webp') {
  // Lossless alpha avoids 8x8 color blocks around dark prestige armor on
  // WebKit/Android decoders while keeping the authored sprite resolution.
  pipeline = pipeline.webp({ lossless: true, effort: 6 });
} else {
  pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
}
await pipeline.toFile(path.resolve(output));

console.log(`normalized ${frames.length} frames to a centered axis and ${targetBottom}px bottom padding`);
