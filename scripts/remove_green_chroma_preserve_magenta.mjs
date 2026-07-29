#!/usr/bin/env node
import path from 'node:path';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error(
    'usage: node scripts/remove_green_chroma_preserve_magenta.mjs <input> <output>',
  );
}

const { data, info } = await sharp(input)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const rgba = Buffer.alloc(info.width * info.height * 4);

for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  const source = pixel * 3;
  const target = pixel * 4;
  const red = data[source];
  const green = data[source + 1];
  const blue = data[source + 2];
  const greenDominance = green - Math.max(red, blue);
  const alpha = Math.max(0, Math.min(1, (205 - greenDominance) / 175));
  const easedAlpha = alpha * alpha * (3 - 2 * alpha);

  rgba[target] = red;
  rgba[target + 1] = Math.min(green, Math.max(red, blue) + 16);
  rgba[target + 2] = blue;
  rgba[target + 3] = easedAlpha < 0.025 ? 0 : Math.round(easedAlpha * 255);
}

// Contract only the transparent edge. Unlike the generic sprite helper, this
// intentionally does not suppress magenta because cyberpunk art uses it as a
// primary authored color.
const cleaned = Buffer.from(rgba);
for (let y = 1; y < info.height - 1; y += 1) {
  for (let x = 1; x < info.width - 1; x += 1) {
    const target = (y * info.width + x) * 4 + 3;
    if (rgba[target] === 255) continue;
    let alpha = 255;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const neighbor =
          ((y + offsetY) * info.width + x + offsetX) * 4 + 3;
        alpha = Math.min(alpha, rgba[neighbor]);
      }
    }
    cleaned[target] = alpha;
  }
}

await sharp(cleaned, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png()
  .toFile(path.resolve(output));
