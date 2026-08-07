import path from 'node:path';
import sharp from 'sharp';

const options = new Map();
for (const argument of process.argv.slice(4)) {
  const [key, value] = argument.replace(/^--/, '').split('=');
  options.set(key, value ?? 'true');
}

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  throw new Error('Usage: node scripts/repack-green-screen-grid.mjs <input> <output> [--source-columns=4 --source-rows=3]');
}

const numberOption = (key, fallback) => Number(options.get(key) ?? fallback);
const sourceColumns = numberOption('source-columns', 4);
const sourceRows = numberOption('source-rows', 3);
const targetColumns = numberOption('target-columns', sourceColumns);
const targetRows = numberOption('target-rows', Math.ceil(sourceColumns * sourceRows / targetColumns));
const cellSize = numberOption('cell', 362);
const baseline = numberOption('baseline', cellSize - 22);
const maxWidth = numberOption('max-width', cellSize - 26);
const maxHeight = numberOption('max-height', cellSize - 32);
const webpOutput = options.get('webp-output');
const conceptOutput = options.get('concept-output');

function alphaBounds(data, info) {
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('A source cell became fully transparent');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function keyGreen(inputBuffer) {
  const { data, info } = await sharp(inputBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const dominance = green - Math.max(red, blue);
    const chroma = Math.max(0, Math.min(1, (dominance - 14) / 72));
    const strength = Math.max(0, Math.min(1, (green - 70) / 120));
    const key = chroma * strength;
    const alpha = Math.round(data[offset + 3] * (1 - key));
    data[offset + 3] = alpha < 9 ? 0 : alpha;
    if (key > 0) data[offset + 1] = Math.min(green, Math.max(red, blue) + 12);
    if (data[offset + 3] === 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
    }
  }
  // Image generators sometimes leave a neutral checker/matte immediately
  // outside an otherwise perfect green-screen silhouette. Remove only the
  // thin edge-connected matte so white fur, silver masks and internal stars
  // remain intact.
  const outside = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < outside.length; pixel += 1) {
    if (data[pixel * 4 + 3] === 0) outside[pixel] = 1;
  }
  for (let pass = 0; pass < 10; pass += 1) {
    const edge = [];
    for (let pixel = 0; pixel < outside.length; pixel += 1) {
      if (outside[pixel]) continue;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      const touchesOutside = (x > 0 && outside[pixel - 1])
        || (x + 1 < info.width && outside[pixel + 1])
        || (y > 0 && outside[pixel - info.width])
        || (y + 1 < info.height && outside[pixel + info.width]);
      if (!touchesOutside) continue;
      const offset = pixel * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const neutralMatte = low > 185 && high - low < 46;
      const greenFringe = green > 85 && green - Math.max(red, blue) > 3;
      if (neutralMatte || greenFringe) edge.push(pixel);
    }
    if (!edge.length) break;
    for (const pixel of edge) {
      outside[pixel] = 1;
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  return { data, info, bounds: alphaBounds(data, info) };
}

const source = sharp(input);
const metadata = await source.metadata();
const cells = [];
for (let row = 0; row < sourceRows; row += 1) {
  const top = Math.round(row * metadata.height / sourceRows);
  const bottom = Math.round((row + 1) * metadata.height / sourceRows);
  for (let column = 0; column < sourceColumns; column += 1) {
    const left = Math.round(column * metadata.width / sourceColumns);
    const right = Math.round((column + 1) * metadata.width / sourceColumns);
    const rawCell = await source.clone().extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
    cells.push(await keyGreen(rawCell));
  }
}

const largestWidth = Math.max(...cells.map((cell) => cell.bounds.width));
const largestHeight = Math.max(...cells.map((cell) => cell.bounds.height));
const scale = Math.min(maxWidth / largestWidth, maxHeight / largestHeight);
const composites = [];
const normalizedFrames = [];
for (const [index, cell] of cells.entries()) {
  const width = Math.max(1, Math.round(cell.bounds.width * scale));
  const height = Math.max(1, Math.round(cell.bounds.height * scale));
  const cropped = await sharp(cell.data, { raw: cell.info })
    .extract(cell.bounds)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const frame = await sharp({
    create: { width: cellSize, height: cellSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: cropped,
    left: Math.round((cellSize - width) / 2),
    top: Math.max(0, baseline - height + 1),
  }]).png().toBuffer();
  normalizedFrames.push(frame);
  composites.push({
    input: frame,
    left: (index % targetColumns) * cellSize,
    top: Math.floor(index / targetColumns) * cellSize,
  });
}

const atlas = await sharp({
  create: {
    width: targetColumns * cellSize,
    height: targetRows * cellSize,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
}).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();

await sharp(atlas).toFile(output);
if (webpOutput) await sharp(atlas).webp({ quality: 91, alphaQuality: 100, effort: 6 }).toFile(webpOutput);
if (conceptOutput) {
  await sharp(normalizedFrames[0]).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(conceptOutput);
  const conceptWebp = conceptOutput.replace(/\.png$/i, '.webp');
  await sharp(normalizedFrames[0]).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(conceptWebp);
}

console.log(`${path.basename(input)} -> ${path.basename(output)} (${cells.length} frames, scale ${scale.toFixed(4)})`);
