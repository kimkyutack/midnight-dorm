import { readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const rankDirectory = path.resolve('public/assets/ranks');
const canvasSize = 512;
const artworkSize = 460;
const alphaFloor = 12;

const files = (await readdir(rankDirectory))
  .filter((file) => file.endsWith('.png') && !file.startsWith('crown-'))
  .sort();

for (const file of files) {
  const filePath = path.join(rankDirectory, file);
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] ?? 0;
    const cleanedAlpha = alpha <= alphaFloor
      ? 0
      : Math.round(((alpha - alphaFloor) * 255) / (255 - alphaFloor));
    data[offset + 3] = cleanedAlpha;
    if (cleanedAlpha === 0) continue;
    const pixel = offset / 4;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }

  if (right < left || bottom < top) {
    throw new Error(`${file} contains no visible badge artwork`);
  }

  const visibleWidth = right - left + 1;
  const visibleHeight = bottom - top + 1;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  if (
    Math.max(visibleWidth, visibleHeight) === artworkSize &&
    Math.abs(centerX - (canvasSize - 1) / 2) <= 1.5 &&
    Math.abs(centerY - (canvasSize - 1) / 2) <= 1.5
  ) {
    console.log(`${file}: already normalized`);
    continue;
  }

  const trimmed = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract({
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
    })
    .resize(artworkSize, artworkSize, {
      fit: 'inside',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  const normalized = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: trimmed.data,
      left: Math.floor((canvasSize - trimmed.info.width) / 2),
      top: Math.floor((canvasSize - trimmed.info.height) / 2),
    }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  await sharp(normalized).toFile(filePath);
  console.log(`${file}: ${trimmed.info.width}x${trimmed.info.height} artwork centered on ${canvasSize}x${canvasSize}`);
}
