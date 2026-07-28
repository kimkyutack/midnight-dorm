#!/usr/bin/env node
import path from 'node:path';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('usage: node scripts/remove_sprite_chroma.mjs <input> <output>');
}

const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const key = [data[0], data[1], data[2]];
const transparentDistance = 18;
const opaqueDistance = 155;
const keyExcess = Math.max(1, Math.min(key[0], key[2]) - key[1]);
const rgba = Buffer.alloc(info.width * info.height * 4);

for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  const source = pixel * 3;
  const target = pixel * 4;
  const red = data[source];
  const green = data[source + 1];
  const blue = data[source + 2];
  const distance = Math.hypot(red - key[0], green - key[1], blue - key[2]);
  const distanceAlpha = Math.max(0, Math.min(1, (distance - transparentDistance) / (opaqueDistance - transparentDistance)));
  const magentaExcess = Math.max(0, Math.min(red, blue) - green);
  const excessAlpha = 1 - Math.max(0, Math.min(1, magentaExcess / keyExcess));
  let alpha = Math.min(distanceAlpha, excessAlpha);
  alpha = alpha * alpha * (3 - 2 * alpha);
  if (alpha < 0.025) alpha = 0;

  const recover = (value, keyValue) => alpha <= 0
    ? 0
    : Math.max(0, Math.min(255, Math.round((value - keyValue * (1 - alpha)) / alpha)));
  let outputRed = recover(red, key[0]);
  const outputGreen = recover(green, key[1]);
  let outputBlue = recover(blue, key[2]);
  if (Math.min(outputRed, outputBlue) - outputGreen > 10) {
    if (outputRed > outputBlue + 10) outputBlue = Math.min(outputBlue, outputGreen + 6);
    else if (outputBlue > outputRed + 10) outputRed = Math.min(outputRed, outputGreen + 6);
    else {
      outputRed = Math.min(outputRed, outputGreen + 6);
      outputBlue = Math.min(outputBlue, outputGreen + 6);
    }
  }
  rgba[target] = outputRed;
  rgba[target + 1] = outputGreen;
  rgba[target + 2] = outputBlue;
  rgba[target + 3] = Math.round(alpha * 255);
}

// Contract the matte by one pixel. This removes the generated chroma fringe
// and isolated one-pixel guide/shadow artifacts without blurring the artwork.
const cleaned = Buffer.from(rgba);
for (let y = 1; y < info.height - 1; y += 1) {
  for (let x = 1; x < info.width - 1; x += 1) {
    let alpha = 255;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const neighbor = ((y + offsetY) * info.width + x + offsetX) * 4 + 3;
        alpha = Math.min(alpha, rgba[neighbor]);
      }
    }
    cleaned[(y * info.width + x) * 4 + 3] = alpha;
  }
}

await sharp(cleaned, {
  raw: { width: info.width, height: info.height, channels: 4 },
}).png().toFile(path.resolve(output));
