import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const ASSET_DIR = path.join(ROOT, 'public/assets/home-poses');
const CELL = 384;
const ROWS = 5;
const COLUMNS = 6;
const CONTENT_WIDTH = CELL - 68;
const CONTENT_HEIGHT = CELL - 48;
const BASELINE = CELL - 22;

const isEdgeBackground = (data, offset) => {
  const alpha = data[offset + 3];
  const darkest = Math.max(data[offset], data[offset + 1], data[offset + 2]);
  return alpha <= 18 || darkest <= 15;
};

/**
 * Some early generated sheets retained an opaque near-black matte. Only
 * remove pixels connected to a cell edge so black clothes and outlines inside
 * the character remain intact.
 */
function clearConnectedMatte(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (index) => {
    if (visited[index]) return;
    const offset = index * 4;
    if (!isEdgeBackground(data, offset)) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    data[index * 4 + 3] = 0;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
}

function clearSmallAlphaComponents(data, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || data[start * 4 + 3] <= 18) continue;
    let head = 0;
    let tail = 0;
    visited[start] = 1;
    queue[tail++] = start;
    const pixels = [];
    while (head < tail) {
      const index = queue[head++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      for (const neighbor of [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]) {
        if (
          neighbor < 0 ||
          visited[neighbor] ||
          data[neighbor * 4 + 3] <= 18
        ) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    components.push(pixels);
  }
  const largest = Math.max(0, ...components.map((component) => component.length));
  const minimum = Math.max(36, Math.round(largest * 0.015));
  for (const component of components) {
    if (component.length >= minimum) continue;
    for (const index of component) data[index * 4 + 3] = 0;
  }
}

function alphaBounds(data, width, height) {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= 18) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('empty home pose cell');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function rowBands(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || data[start * 4 + 3] <= 18) continue;
    let head = 0;
    let tail = 0;
    let top = height;
    let bottom = -1;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (const neighbor of [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]) {
        if (
          neighbor < 0 ||
          visited[neighbor] ||
          data[neighbor * 4 + 3] <= 18
        ) continue;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      }
    }
    if (tail >= 100) components.push({ top, bottom, area: tail });
  }
  const meaningful = components
    .sort((left, right) => right.area - left.area)
    .slice(0, ROWS)
    .sort((left, right) => left.top - right.top)
    .map((component) => ({
      top: Math.max(0, component.top - 2),
      height: Math.min(height - 1, component.bottom + 2) - Math.max(0, component.top - 2) + 1,
    }));
  if (meaningful.length !== ROWS) {
    throw new Error(
      `expected ${ROWS} pose rows, found ${meaningful.length}: ${JSON.stringify(components.slice(0, 10))}`,
    );
  }
  return meaningful;
}

async function readColumn(data, sourceWidth, sourceHeight, left, width) {
  const extracted = await sharp(data, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 4 },
  })
    .extract({ left, top: 0, width, height: sourceHeight })
    .raw()
    .toBuffer();
  const pixels = Buffer.from(extracted);
  clearConnectedMatte(pixels, width, sourceHeight);
  return { pixels, width, height: sourceHeight, bands: rowBands(pixels, width, sourceHeight) };
}

async function readPose(column, band) {
  const bandPixels = await sharp(column.pixels, {
    raw: { width: column.width, height: column.height, channels: 4 },
  })
    .extract({ left: 0, top: band.top, width: column.width, height: band.height })
    .raw()
    .toBuffer();
  const pixels = Buffer.from(bandPixels);
  clearSmallAlphaComponents(pixels, column.width, band.height);
  const bounds = alphaBounds(pixels, column.width, band.height);
  const content = await sharp(pixels, {
    raw: { width: column.width, height: band.height, channels: 4 },
  })
    .extract(bounds)
    .png()
    .toBuffer();
  return { content, bounds };
}

async function normalizedFrame(pose, width, height) {
  return {
    input: await sharp(pose.content)
      .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer(),
    width,
    height,
  };
}

async function blendedFrame(from, to, amount) {
  const [fromRaw, toRaw] = await Promise.all(
    [from.input, to.input].map((input) =>
      sharp(input).ensureAlpha().raw().toBuffer(),
    ),
  );
  const output = Buffer.alloc(fromRaw.length);
  const inverse = 1 - amount;
  for (let offset = 0; offset < output.length; offset += 4) {
    const fromAlpha = (fromRaw[offset + 3] ?? 0) / 255;
    const toAlpha = (toRaw[offset + 3] ?? 0) / 255;
    const alpha = fromAlpha * inverse + toAlpha * amount;
    for (let channel = 0; channel < 3; channel += 1) {
      const premultiplied =
        (fromRaw[offset + channel] ?? 0) * fromAlpha * inverse +
        (toRaw[offset + channel] ?? 0) * toAlpha * amount;
      output[offset + channel] = alpha > 0 ? Math.round(premultiplied / alpha) : 0;
    }
    output[offset + 3] = Math.round(alpha * 255);
  }
  return {
    input: await sharp(output, {
      raw: { width: from.width, height: from.height, channels: 4 },
    }).png().toBuffer(),
    width: from.width,
    height: from.height,
  };
}

async function normalizeAtlas(index) {
  const input = path.join(ASSET_DIR, `home-pose-atlas-${index}.webp`);
  const decoded = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = decoded.info;
  if (channels !== 4) throw new Error(`${input} did not decode as RGBA`);
  const source = Buffer.from(decoded.data);
  const alreadyNormalized =
    width % COLUMNS === 0 &&
    height % ROWS === 0 &&
    width / COLUMNS === height / ROWS;
  const sourceColumns = alreadyNormalized ? COLUMNS : 2;
  const sittingColumn = 0;
  const yawningColumn = alreadyNormalized ? 3 : 1;
  const sittingLeft = Math.round((sittingColumn * width) / sourceColumns);
  const sittingRight = Math.round(((sittingColumn + 1) * width) / sourceColumns);
  const yawningLeft = Math.round((yawningColumn * width) / sourceColumns);
  const yawningRight = Math.round(((yawningColumn + 1) * width) / sourceColumns);
  const sittingColumnData = await readColumn(
    source,
    width,
    height,
    sittingLeft,
    sittingRight - sittingLeft,
  );
  const yawningColumnData = await readColumn(
    source,
    width,
    height,
    yawningLeft,
    yawningRight - yawningLeft,
  );
  const composites = [];

  for (let row = 0; row < ROWS; row += 1) {
    const sitting = await readPose(sittingColumnData, sittingColumnData.bands[row]);
    const yawning = await readPose(yawningColumnData, yawningColumnData.bands[row]);
    const largestWidth = Math.max(sitting.bounds.width, yawning.bounds.width);
    const largestHeight = Math.max(sitting.bounds.height, yawning.bounds.height);
    const scale = Math.min(CONTENT_WIDTH / largestWidth, CONTENT_HEIGHT / largestHeight);
    // The old sheet scaled every transition independently. On some skins the
    // sitting and yawning source bounds differed by more than 10%, making the
    // home character visibly pulse. Fit both endpoints into one exact box and
    // create the in-between motion by cross-fading only; centre, baseline and
    // silhouette dimensions now remain invariant across all six frames.
    const targetWidth = Math.max(1, Math.round(largestWidth * scale));
    const targetHeight = Math.max(1, Math.round(largestHeight * scale));
    const sittingFrame = await normalizedFrame(sitting, targetWidth, targetHeight);
    const yawningFrame = await normalizedFrame(yawning, targetWidth, targetHeight);
    const frames = [
      sittingFrame,
      await blendedFrame(sittingFrame, yawningFrame, 0.28),
      await blendedFrame(sittingFrame, yawningFrame, 0.68),
      yawningFrame,
      await blendedFrame(sittingFrame, yawningFrame, 0.58),
      await blendedFrame(sittingFrame, yawningFrame, 0.18),
    ];
    for (let column = 0; column < frames.length; column += 1) {
      const frame = frames[column];
      composites.push({
        input: frame.input,
        left: column * CELL + Math.round((CELL - frame.width) / 2),
        top: row * CELL + BASELINE - frame.height,
      });
    }
  }

  await sharp({
    create: {
      width: CELL * COLUMNS,
      height: CELL * ROWS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 94, alphaQuality: 100, smartSubsample: true })
    .toFile(input);
  return input;
}

await mkdir(ASSET_DIR, { recursive: true });
for (let index = 1; index <= 6; index += 1) {
  const output = await normalizeAtlas(index);
  console.log(`normalized ${path.relative(ROOT, output)}`);
}
