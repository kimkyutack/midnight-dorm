import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CELL_SIZE = 362;
const FRAME_BASELINE = 340;
const MAX_FRAME_WIDTH = 336;
const MAX_FRAME_HEIGHT = 330;
const DIRECTIONS = ['front', 'back', 'side'];
const ACTIONS = ['idle', 'walk-1', 'walk-2', 'walk-3'];

const cliOptions = new Map(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf('=');
    return separator < 0
      ? [argument, true]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);

const REPAIRS = [
  {
    directory: 'skin-police-enforcer-croco',
    // Keep every marching pose after detached dust/debris has been removed.
    sources: ACTIONS,
  },
  {
    directory: 'skin-secret-agent-monkey',
    // Keep every aiming pose with a complete, non-holographic silhouette.
    sources: ACTIONS,
  },
];

async function keepPrimaryAlphaComponent(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  let largest = [];

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[start * 4 + 3] === 0) continue;
    const component = [];
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const pixel = stack.pop();
      component.push(pixel);
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      const neighbours = [
        x > 0 ? pixel - 1 : -1,
        x + 1 < info.width ? pixel + 1 : -1,
        y > 0 ? pixel - info.width : -1,
        y + 1 < info.height ? pixel + info.width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || visited[next] || data[next * 4 + 3] === 0) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    if (component.length > largest.length) largest = component;
  }

  const keep = new Uint8Array(pixelCount);
  for (const pixel of largest) keep[pixel] = 1;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (keep[pixel]) continue;
    data[pixel * 4 + 3] = 0;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function frameMetrics(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= 3) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('Transparent sprite frame');
  const bounds = {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
  const bodyLimit = Math.min(info.height, top + Math.round(bounds.height * 0.7));
  let bodyLeft = info.width;
  let bodyRight = -1;
  for (let y = top; y < bodyLimit; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= 3) continue;
      bodyLeft = Math.min(bodyLeft, x);
      bodyRight = Math.max(bodyRight, x);
    }
  }
  return {
    bounds,
    bodyCenterX: bodyRight >= bodyLeft
      ? (bodyLeft + bodyRight) / 2
      : left + bounds.width / 2,
  };
}

async function alignFrame(input, scale) {
  const { bounds, bodyCenterX } = await frameMetrics(input);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const crop = await sharp(input)
    .extract(bounds)
    .resize({ width, height, fit: 'fill' })
    .png()
    .toBuffer();
  const left = Math.round(CELL_SIZE / 2 - (bodyCenterX - bounds.left) * scale);
  const top = FRAME_BASELINE - height + 1;
  return sharp({
    create: {
      width: CELL_SIZE,
      height: CELL_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: crop, left, top }]).png().toBuffer();
}

async function removeConnectedCheckerboard(input) {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const background = new Uint8Array(pixelCount);
  const stack = [];

  const isCheckerPixel = (pixel) => {
    const offset = pixel * 3;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    return Math.min(red, green, blue) >= 225
      && Math.max(red, green, blue) - Math.min(red, green, blue) <= 12;
  };
  const enqueue = (pixel) => {
    if (background[pixel] || !isCheckerPixel(pixel)) return;
    background[pixel] = 1;
    stack.push(pixel);
  };

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue((info.height - 1) * info.width + x);
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(y * info.width);
    enqueue(y * info.width + info.width - 1);
  }
  while (stack.length) {
    const pixel = stack.pop();
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < info.width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - info.width);
    if (y + 1 < info.height) enqueue(pixel + info.width);
  }

  const output = Buffer.alloc(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const source = pixel * 3;
    const target = pixel * 4;
    output[target] = data[source];
    output[target + 1] = data[source + 1];
    output[target + 2] = data[source + 2];
    output[target + 3] = background[pixel] ? 0 : 255;
  }
  return sharp(output, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();
}

async function importCleanGeneratedSprites(directory, sheetPath, sleepPath) {
  const root = path.join(ROOT, 'public/assets/sprites/skins', directory);
  const framesDirectory = path.join(root, 'frames');
  const sheet = await removeConnectedCheckerboard(await fs.readFile(sheetPath));
  const metadata = await sharp(sheet).metadata();
  if (metadata.width !== CELL_SIZE * ACTIONS.length
      || metadata.height !== CELL_SIZE * DIRECTIONS.length) {
    throw new Error(`Unexpected ${directory} sheet dimensions: ${metadata.width}x${metadata.height}`);
  }

  for (let row = 0; row < DIRECTIONS.length; row += 1) {
    for (let column = 0; column < ACTIONS.length; column += 1) {
      const frame = await sharp(sheet)
        .extract({
          left: column * CELL_SIZE,
          top: row * CELL_SIZE,
          width: CELL_SIZE,
          height: CELL_SIZE,
        })
        .png()
        .toBuffer();
      await fs.writeFile(
        path.join(framesDirectory, `${DIRECTIONS[row]}-${ACTIONS[column]}.png`),
        frame,
      );
      if (row === 0 && column === 0) {
        await fs.writeFile(path.join(root, 'concept.png'), frame);
      }
    }
  }

  const cleanSleep = await removeConnectedCheckerboard(await fs.readFile(sleepPath));
  const sleep = await sharp(cleanSleep)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({
      width: CELL_SIZE - 18,
      height: CELL_SIZE - 18,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .extend({
      top: 9,
      bottom: 9,
      left: 9,
      right: 9,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(CELL_SIZE, CELL_SIZE, { fit: 'contain' })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(root, 'sleep.png'), sleep);
}

async function repairSpriteSet({ directory, sources }) {
  const root = path.join(ROOT, 'public/assets/sprites/skins', directory);
  const framesDirectory = path.join(root, 'frames');
  const repairedFrames = new Map();

  const cleanedSources = new Map();
  for (const direction of DIRECTIONS) {
    const sourceBuffers = new Map();
    for (const source of new Set(sources)) {
      const sourcePath = path.join(framesDirectory, `${direction}-${source}.png`);
      sourceBuffers.set(source, await keepPrimaryAlphaComponent(await fs.readFile(sourcePath)));
    }
    for (const [source, buffer] of sourceBuffers) {
      cleanedSources.set(`${direction}:${source}`, buffer);
    }
  }
  const metrics = await Promise.all([...cleanedSources.values()].map(frameMetrics));
  const scale = Math.min(
    1,
    MAX_FRAME_WIDTH / Math.max(...metrics.map(({ bounds }) => bounds.width)),
    MAX_FRAME_HEIGHT / Math.max(...metrics.map(({ bounds }) => bounds.height)),
  );

  for (const direction of DIRECTIONS) {
    for (let column = 0; column < ACTIONS.length; column += 1) {
      const action = ACTIONS[column];
      const source = cleanedSources.get(`${direction}:${sources[column]}`);
      const repaired = await alignFrame(source, scale);
      await fs.writeFile(path.join(framesDirectory, `${direction}-${action}.png`), repaired);
      repairedFrames.set(`${direction}:${action}`, repaired);
    }
  }

  await fs.writeFile(path.join(root, 'concept.png'), repairedFrames.get('front:idle'));
  const sleepTarget = path.join(root, 'sleep.png');
  await fs.writeFile(
    sleepTarget,
    await keepPrimaryAlphaComponent(await fs.readFile(sleepTarget)),
  );

  const composites = [];
  for (let row = 0; row < DIRECTIONS.length; row += 1) {
    for (let column = 0; column < ACTIONS.length; column += 1) {
      composites.push({
        input: repairedFrames.get(`${DIRECTIONS[row]}:${ACTIONS[column]}`),
        left: column * CELL_SIZE,
        top: row * CELL_SIZE,
      });
    }
  }
  await sharp({
    create: {
      width: CELL_SIZE * ACTIONS.length,
      height: CELL_SIZE * DIRECTIONS.length,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(path.join(root, 'movement-sheet.png'));
}

const monkeySheet = cliOptions.get('--monkey-sheet');
const monkeySleep = cliOptions.get('--monkey-sleep');
if (monkeySheet || monkeySleep) {
  if (typeof monkeySheet !== 'string' || typeof monkeySleep !== 'string') {
    throw new Error('--monkey-sheet and --monkey-sleep must be provided together');
  }
  await importCleanGeneratedSprites(
    'skin-secret-agent-monkey',
    monkeySheet,
    monkeySleep,
  );
}

const crocodileSheet = cliOptions.get('--crocodile-sheet');
const crocodileSleep = cliOptions.get('--crocodile-sleep');
if (crocodileSheet || crocodileSleep) {
  if (typeof crocodileSheet !== 'string' || typeof crocodileSleep !== 'string') {
    throw new Error('--crocodile-sheet and --crocodile-sleep must be provided together');
  }
  await importCleanGeneratedSprites(
    'skin-police-enforcer-croco',
    crocodileSheet,
    crocodileSleep,
  );
}

for (const repair of REPAIRS) await repairSpriteSet(repair);
