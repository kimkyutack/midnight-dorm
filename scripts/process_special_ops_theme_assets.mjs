import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}

const turretMaster = argumentsByName.get('--turret-master');
const tileMaster = argumentsByName.get('--tile-master');
if (!turretMaster || !tileMaster) {
  throw new Error('Usage: node scripts/process_special_ops_theme_assets.mjs --turret-master <png> --tile-master <png>');
}

const projectRoot = process.cwd();
const turretOutputDirectory = path.join(
  projectRoot,
  'public/assets/turret-skins/skin-special-ops-tracker',
);
const tileOutputDirectory = path.join(
  projectRoot,
  'public/assets/tiles/skin-special-ops-headquarters',
);

await fs.mkdir(turretOutputDirectory, { recursive: true });
await fs.mkdir(tileOutputDirectory, { recursive: true });

const { data: source, info } = await sharp(turretMaster)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const rgba = Buffer.from(source);
const opaque = new Uint8Array(info.width * info.height);

for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
  const offset = pixel * 4;
  const red = rgba[offset] ?? 0;
  const green = rgba[offset + 1] ?? 0;
  const blue = rgba[offset + 2] ?? 0;
  const dominance = green - Math.max(red, blue);
  let alpha = 255;
  if (green > 105 && dominance >= 78) alpha = 0;
  else if (green > 105 && dominance > 22) {
    alpha = Math.round(255 * (78 - dominance) / 56);
  }
  if (alpha > 0 && dominance > 4) {
    rgba[offset + 1] = Math.min(green, Math.max(red, blue) + 4);
  }
  rgba[offset + 3] = alpha;
  opaque[pixel] = alpha >= 48 ? 1 : 0;
}

function occupiedBands(length, occupancy, minimumCount, mergeGap = 8) {
  const rawBands = [];
  let start = -1;
  for (let index = 0; index < length; index += 1) {
    if (occupancy[index] >= minimumCount && start < 0) start = index;
    const closing = occupancy[index] < minimumCount || index === length - 1;
    if (start >= 0 && closing) {
      rawBands.push([start, occupancy[index] >= minimumCount ? index : index - 1]);
      start = -1;
    }
  }
  const merged = [];
  for (const band of rawBands) {
    const previous = merged.at(-1);
    if (previous && band[0] - previous[1] <= mergeGap) previous[1] = band[1];
    else merged.push([...band]);
  }
  return merged;
}

const rowOccupancy = new Uint32Array(info.height);
for (let y = 0; y < info.height; y += 1) {
  for (let x = 0; x < info.width; x += 1) {
    rowOccupancy[y] += opaque[y * info.width + x] ?? 0;
  }
}
const rows = occupiedBands(info.height, rowOccupancy, 8, 20);
const boxes = [];
for (const [top, bottom] of rows) {
  const columnOccupancy = new Uint32Array(info.width);
  for (let x = 0; x < info.width; x += 1) {
    for (let y = top; y <= bottom; y += 1) {
      columnOccupancy[x] += opaque[y * info.width + x] ?? 0;
    }
  }
  for (const [left, right] of occupiedBands(info.width, columnOccupancy, 5, 12)) {
    let objectTop = bottom;
    let objectBottom = top;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (!opaque[y * info.width + x]) continue;
        objectTop = Math.min(objectTop, y);
        objectBottom = Math.max(objectBottom, y);
      }
    }
    boxes.push({
      left: Math.max(0, left - 6),
      top: Math.max(0, objectTop - 6),
      width: Math.min(info.width - left + 6, right - left + 13),
      height: Math.min(info.height - objectTop + 6, objectBottom - objectTop + 13),
    });
  }
}

if (boxes.length !== 15) {
  throw new Error(`Expected 15 isolated turret silhouettes, found ${boxes.length}.`);
}

const maximumWidth = Math.max(...boxes.map((box) => box.width));
const maximumHeight = Math.max(...boxes.map((box) => box.height));
const commonScale = Math.min(450 / maximumWidth, 450 / maximumHeight);

for (const [index, box] of boxes.entries()) {
  const width = Math.max(1, Math.round(box.width * commonScale));
  const height = Math.max(1, Math.round(box.height * commonScale));
  const extracted = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .extract(box)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const left = Math.round((512 - width) / 2);
  const top = Math.round((512 - height) / 2);
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: extracted, left, top }])
    .png({ compressionLevel: 9, palette: true, quality: 100 })
    .toFile(path.join(turretOutputDirectory, `level-${String(index + 1).padStart(2, '0')}.png`));
}

await sharp(tileMaster)
  .resize(512, 512, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .webp({ quality: 92, effort: 6 })
  .toFile(path.join(tileOutputDirectory, 'investigation-floor.webp'));

console.log(JSON.stringify({ rows, turretLevels: boxes.length, tile: '512x512' }));
