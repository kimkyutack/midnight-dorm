import sharp from 'sharp';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const asset = (...parts) => path.join(root, 'public', 'assets', ...parts);

async function removeMagenta(input, output, size = null) {
  const source = sharp(input).ensureAlpha();
  const { data, info } = await source.raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const magenta = Math.min(red, blue) - green;
    const brightness = Math.min(red, blue);
    if (magenta <= 22 || brightness <= 90) continue;
    const alpha = Math.max(0, Math.min(255, Math.round(255 - (magenta - 22) * 2.25)));
    data[index + 3] = Math.min(data[index + 3], alpha);
    if (alpha < 245) {
      const spill = (245 - alpha) / 245;
      data[index] = Math.round(red * (1 - spill * 0.45));
      data[index + 2] = Math.round(blue * (1 - spill * 0.45));
    }
  }
  let image = sharp(data, { raw: info });
  if (size) image = image.resize(size.width, size.height, { fit: 'contain' });
  await image.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);
}

async function centerAtlasCells(input, output, columns = 4, rows = 3, cellSize = 362, bottomPadding = 20) {
  const composites = [];
  const source = sharp(input).ensureAlpha();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const cell = source.clone().extract({
        left: column * cellSize,
        top: row * cellSize,
        width: cellSize,
        height: cellSize,
      });
      const { data, info } = await cell.clone().raw().toBuffer({ resolveWithObject: true });
      let minX = cellSize;
      let minY = cellSize;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < info.height; y += 1) {
        for (let x = 0; x < info.width; x += 1) {
          if (data[(y * info.width + x) * 4 + 3] <= 20) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      if (maxX < minX || maxY < minY) continue;
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const content = await cell.extract({ left: minX, top: minY, width, height }).png().toBuffer();
      composites.push({
        input: content,
        left: column * cellSize + Math.round((cellSize - width) / 2),
        // Every direction must share one visual ground line. Preserving each
        // source cell's original minY made the side/back feet float above the
        // front pose even though the runtime used identical sprite sizing.
        top: row * cellSize + Math.max(0, cellSize - bottomPadding - height),
      });
    }
  }
  await sharp({
    create: {
      width: columns * cellSize,
      height: rows * cellSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(output);
}

async function removeEdgeChecker(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const outside = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const isChecker = (pixel) => {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    return Math.min(red, green, blue) > 205 && Math.max(red, green, blue) - Math.min(red, green, blue) < 28;
  };
  const enqueue = (pixel) => {
    if (outside[pixel] || !isChecker(pixel)) return;
    outside[pixel] = 1;
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
    if (!outside[pixel]) continue;
    const offset = pixel * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  // Remove one neutral antialias fringe around the flood-filled checker while
  // leaving the enclosed silver mask and white muzzle untouched.
  for (let pass = 0; pass < 5; pass += 1) {
    const fringe = [];
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (outside[pixel]) continue;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      const touchesOutside = (x > 0 && outside[pixel - 1])
        || (x + 1 < info.width && outside[pixel + 1])
        || (y > 0 && outside[pixel - info.width])
        || (y + 1 < info.height && outside[pixel + info.width]);
      if (!touchesOutside) continue;
      const offset = pixel * 4;
      const channels = [data[offset], data[offset + 1], data[offset + 2]];
      if (Math.min(...channels) > 150 && Math.max(...channels) - Math.min(...channels) < 72) fringe.push(pixel);
    }
    if (!fringe.length) break;
    for (const pixel of fringe) {
      outside[pixel] = 1;
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function removeMagentaPose(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const removed = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < removed.length; pixel += 1) {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const keyed = red > 72
      && blue > 72
      && green < 165
      && Math.min(red, blue) - green > 18
      && Math.abs(red - blue) < 150;
    if (!keyed) continue;
    removed[pixel] = 1;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const fringe = [];
    for (let pixel = 0; pixel < removed.length; pixel += 1) {
      if (removed[pixel]) continue;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (!((x > 0 && removed[pixel - 1])
        || (x + 1 < info.width && removed[pixel + 1])
        || (y > 0 && removed[pixel - info.width])
        || (y + 1 < info.height && removed[pixel + info.width]))) continue;
      const offset = pixel * 4;
      const channels = [data[offset], data[offset + 1], data[offset + 2]];
      if (Math.max(...channels) - Math.min(...channels) < 45 && Math.min(...channels) > 120) fringe.push(pixel);
    }
    for (const pixel of fringe) {
      removed[pixel] = 1;
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function removeHotPinkPoseCell(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const removed = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < removed.length; pixel += 1) {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const pinkDominance = Math.min(red, blue) - green;
    if (red < 150 || blue < 120 || green > 155 || pinkDominance < 52) continue;
    removed[pixel] = 1;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  // Consume the hot-pink antialias fringe without erasing the fox's purple
  // cloth and jewels. Only neighbours still dominated by red/blue are keyed.
  for (let pass = 0; pass < 8; pass += 1) {
    const fringe = [];
    for (let pixel = 0; pixel < removed.length; pixel += 1) {
      if (removed[pixel]) continue;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (!((x > 0 && removed[pixel - 1])
        || (x + 1 < info.width && removed[pixel + 1])
        || (y > 0 && removed[pixel - info.width])
        || (y + 1 < info.height && removed[pixel + info.width]))) continue;
      const offset = pixel * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const high = Math.max(red, green, blue);
      const low = Math.min(red, green, blue);
      const pinkFringe = red > 100 && blue > 90 && Math.min(red, blue) - green > 18;
      const neutralCompressionBlock = low > 90 && high - low < 82;
      if (pinkFringe || neutralCompressionBlock) fringe.push(pixel);
    }
    for (const pixel of fringe) {
      removed[pixel] = 1;
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  // The generated chroma source can contain a 1-3px compressed halo. Erode
  // only the outside edge; the loss is sub-pixel after the 384px downscale and
  // prevents square matte fragments from flashing during the yawn animation.
  for (let pass = 0; pass < 6; pass += 1) {
    const edge = [];
    for (let pixel = 0; pixel < removed.length; pixel += 1) {
      if (removed[pixel]) continue;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if ((x > 0 && removed[pixel - 1])
        || (x + 1 < info.width && removed[pixel + 1])
        || (y > 0 && removed[pixel - info.width])
        || (y + 1 < info.height && removed[pixel + info.width])) edge.push(pixel);
    }
    for (const pixel of edge) {
      removed[pixel] = 1;
      const offset = pixel * 4;
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      data[offset + 3] = 0;
    }
  }
  for (let pixel = 0; pixel < removed.length; pixel += 1) {
    if (removed[pixel]) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (y >= info.height * .6 || (x >= info.width * .24 && x <= info.width * .76)) continue;
    const offset = pixel * 4;
    const channels = [data[offset], data[offset + 1], data[offset + 2]];
    const high = Math.max(...channels);
    const low = Math.min(...channels);
    if (low <= 95 || high - low >= 92) continue;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const skinDir = asset('sprites', 'skins', 'skin-moonlit-phantom-fox');
const turretDir = asset('turret-skins', 'skin-moonlit-foxfire');
const emoteDir = asset('emotes', 'moonlit-phantom-fox');
const orbShopDir = asset('ui', 'orb-shop');
await Promise.all([mkdir(skinDir, { recursive: true }), mkdir(turretDir, { recursive: true }), mkdir(emoteDir, { recursive: true }), mkdir(orbShopDir, { recursive: true })]);

const transparentMovement = path.join(skinDir, 'movement-sheet-transparent.png');
await removeMagenta(path.join(skinDir, 'source-movement-chroma.png'), transparentMovement);
await centerAtlasCells(transparentMovement, path.join(skinDir, 'movement-sheet.png'));
await rm(transparentMovement, { force: true });
await sharp(await removeMagentaPose(path.join(skinDir, 'source-sleep-chroma.png')))
  .resize(512, 512, { fit: 'contain' })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(path.join(skinDir, 'sleep.png'));
await removeMagenta(path.join(turretDir, 'source-master-chroma.png'), path.join(turretDir, 'master.png'), { width: 512, height: 512 });
await removeMagenta(
  asset('profile-images', 'moonlit-phantom-frame-chroma.png'),
  asset('profile-images', 'moonlit-phantom-frame.png'),
  { width: 512, height: 512 },
);
await removeMagenta(
  path.join(orbShopDir, 'menu-icon-chroma.png'),
  path.join(orbShopDir, 'menu-icon.png'),
  { width: 512, height: 512 },
);
await sharp(path.join(orbShopDir, 'menu-icon.png'))
  .resize(256, 256, { fit: 'contain' })
  .webp({ quality: 90, alphaQuality: 100, effort: 5 })
  .toFile(path.join(orbShopDir, 'menu-icon.webp'));

// The prestige fox needs its own seated/yawn strip. Without this row the home
// presenter correctly saved the prestige skin but visually fell back to the
// base fox. Use the six authored poses instead of stretching one still image,
// and keep every frame on an identical 384px canvas so the yawn never jumps.
const homePoseSource = path.join(skinDir, 'source-home-pose-chroma.png');
const homePoseSourceMetadata = await sharp(homePoseSource).metadata();
const homePoseCellWidth = Math.floor((homePoseSourceMetadata.width ?? 1536) / 3);
const homePoseCellHeight = Math.floor((homePoseSourceMetadata.height ?? 1024) / 2);
const homePoseCells = [];
for (let index = 0; index < 6; index += 1) {
  const inset = 4;
  const sourceCell = await sharp(homePoseSource)
    .extract({
      left: (index % 3) * homePoseCellWidth + inset,
      top: Math.floor(index / 3) * homePoseCellHeight + inset,
      width: homePoseCellWidth - inset * 2,
      height: homePoseCellHeight - inset * 2,
    })
    .png()
    .toBuffer();
  const transparentCell = await removeHotPinkPoseCell(sourceCell);
  homePoseCells.push(await sharp(transparentCell)
    .resize(384, 384, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer());
}
await sharp({
  create: {
    width: 384 * homePoseCells.length,
    // HomePoseAssets uses five-row atlases. Preserve that geometry even
    // though this prestige source only occupies row zero.
    height: 384 * 5,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
}).composite(homePoseCells.map((input, index) => ({ input, left: index * 384, top: 0 })))
  .webp({ quality: 90, alphaQuality: 100, effort: 6 })
  .toFile(asset('home-poses', 'home-pose-atlas-7.webp'));

await sharp(asset('profile-images', 'moonlit-phantom-fox.png'))
  .resize(512, 512, { fit: 'cover' })
  .webp({ quality: 88, effort: 5 })
  .toFile(asset('profile-images', 'moonlit-phantom-fox.webp'));

await sharp(asset('tiles', 'skin-moonlit-phantom', 'moonfire-tile-master.png'))
  .resize(512, 512, { fit: 'cover' })
  .webp({ quality: 88, effort: 5 })
  .toFile(asset('tiles', 'skin-moonlit-phantom', 'moonfire-tile.webp'));

const emoteSheet = asset('emotes', 'moonlit-phantom-fox', 'source-sheet.png');
const emoteNames = ['smug', 'shock', 'yawn', 'victory'];
for (let index = 0; index < emoteNames.length; index += 1) {
  const left = index % 2 === 0 ? 0 : 627;
  const top = index < 2 ? 0 : 627;
  await sharp(emoteSheet)
    .extract({ left, top, width: 627, height: 627 })
    .resize(256, 256, { fit: 'cover' })
    .webp({ quality: 86, effort: 5 })
    .toFile(path.join(emoteDir, `${emoteNames[index]}.webp`));
}

const master = sharp(path.join(turretDir, 'master.png'));
for (let level = 1; level <= 17; level += 1) {
  const scale = 0.72 + (level - 1) * (0.28 / 16);
  const dimension = Math.round(512 * scale);
  const art = await master.clone()
    .resize(dimension, dimension, { fit: 'contain' })
    .modulate({ saturation: 0.82 + level * 0.018, brightness: 0.82 + level * 0.012 })
    .png()
    .toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: art, left: Math.floor((512 - dimension) / 2), top: 512 - dimension }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(turretDir, `level-${String(level).padStart(2, '0')}.png`));
}

await sharp(asset('prestige', 'moonlit-phantom-fox', 'package-concept.png'))
  .resize(720, 720, { fit: 'cover' })
  .webp({ quality: 88, effort: 5 })
  .toFile(asset('prestige', 'moonlit-phantom-fox', 'package-concept.webp'));

const packageConcept = asset('prestige', 'moonlit-phantom-fox', 'package-concept.png');
const packageConceptMetadata = await sharp(packageConcept).metadata();
const packageQuadrant = Math.floor(Math.min(packageConceptMetadata.width ?? 1024, packageConceptMetadata.height ?? 1024) / 2);
await sharp(packageConcept)
  .extract({
    left: (packageConceptMetadata.width ?? packageQuadrant * 2) - packageQuadrant,
    top: (packageConceptMetadata.height ?? packageQuadrant * 2) - packageQuadrant,
    width: packageQuadrant,
    height: packageQuadrant,
  })
  .resize(720, 720, { fit: 'contain', background: { r: 3, g: 8, b: 20, alpha: 1 } })
  .webp({ quality: 92, effort: 5 })
  .toFile(asset('prestige', 'moonlit-phantom-fox', 'featured-package.webp'));
