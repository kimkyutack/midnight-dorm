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
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const rgba = Buffer.from(data);
const pixelCount = info.width * info.height;
const visited = new Uint8Array(pixelCount);
const queue = new Uint32Array(pixelCount);
let head = 0;
let tail = 0;

const isBackground = (pixel) => {
  const offset = pixel * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  if (alpha < 24) return true;
  const greenDominance = green - Math.max(red, blue);
  return green > 25 && greenDominance > 10;
};

const enqueue = (pixel) => {
  if (visited[pixel] || !isBackground(pixel)) return;
  visited[pixel] = 1;
  queue[tail++] = pixel;
};

for (let x = 0; x < info.width; x += 1) {
  enqueue(x);
  enqueue((info.height - 1) * info.width + x);
}
for (let y = 0; y < info.height; y += 1) {
  enqueue(y * info.width);
  enqueue(y * info.width + info.width - 1);
}

while (head < tail) {
  const pixel = queue[head++];
  const x = pixel % info.width;
  const y = Math.floor(pixel / info.width);
  if (x > 0) enqueue(pixel - 1);
  if (x + 1 < info.width) enqueue(pixel + 1);
  if (y > 0) enqueue(pixel - info.width);
  if (y + 1 < info.height) enqueue(pixel + info.width);
}

for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const target = pixel * 4;
  const greenDominance = rgba[target + 1] - Math.max(rgba[target], rgba[target + 2]);
  // Enclosed holes (for example the inside of a profile frame) cannot be
  // reached by the edge flood. They still use the authored chroma green, so
  // remove only strongly green pixels globally after the conservative flood.
  if (visited[pixel] || (rgba[target + 1] > 25 && greenDominance > 10)) {
    rgba[target] = 0;
    rgba[target + 1] = 0;
    rgba[target + 2] = 0;
    rgba[target + 3] = 0;
    continue;
  }
  // Remove the remaining green spill only from antialiased subject edges.
  if (rgba[target + 3] < 250) {
    rgba[target + 1] = Math.min(
      rgba[target + 1],
      Math.max(rgba[target], rgba[target + 2]) + 10,
    );
  }
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

for (let pixel = 0; pixel < pixelCount; pixel += 1) {
  const target = pixel * 4;
  if (cleaned[target + 3] !== 0) continue;
  cleaned[target] = 0;
  cleaned[target + 1] = 0;
  cleaned[target + 2] = 0;
}

const pipeline = sharp(cleaned, {
  raw: { width: info.width, height: info.height, channels: 4 },
});
const extension = path.extname(output).toLowerCase();
if (extension === '.webp') {
  await pipeline
    .webp({ quality: 94, alphaQuality: 100, effort: 6 })
    .toFile(path.resolve(output));
} else {
  await pipeline
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.resolve(output));
}
