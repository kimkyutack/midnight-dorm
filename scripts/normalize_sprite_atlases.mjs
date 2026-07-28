/**
 * Normalizes every survivor base and complete skin to one 4 x 3 atlas grid.
 *
 * All frames use the exact same bottom baseline. This keeps a character's
 * torso stable while only the feet change during a walk and prevents the
 * front/back/side preview from jumping or clipping on mobile canvases.
 */
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const CELL = 362;
const COLUMNS = 4;
const ROWS = 3;
const BASELINE = 340;
const MAX_CONTENT_HEIGHT = 330;
const MAX_CONTENT_WIDTH = 336;
const DIRECTIONS = ['front', 'back', 'side'];
const FRAMES = ['idle', 'walk-1', 'walk-2', 'walk-3'];
const GROUPS = [
  { label: 'base', directory: path.join(root, 'public/assets/paperdoll/bases'), entryPrefix: 'character-', makeSleep: true },
  { label: 'skin', directory: path.join(root, 'public/assets/sprites/survivors'), entryPrefix: 'character-', makeSleep: false },
  { label: 'skin-variant', directory: path.join(root, 'public/assets/sprites/skins'), entryPrefix: 'skin-', makeSleep: false },
];

function alphaBounds(data, info) {
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  const alphaIndex = info.channels - 1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alphaIndex] > 3) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) throw new Error('transparent frame');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function sourceMetrics(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(data, info);
  const bodyLimit = Math.min(info.height, bounds.top + Math.round(bounds.height * 0.7));
  let bodyLeft = info.width;
  let bodyRight = -1;
  const alphaIndex = info.channels - 1;
  for (let y = bounds.top; y < bodyLimit; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alphaIndex] > 3) {
        bodyLeft = Math.min(bodyLeft, x);
        bodyRight = Math.max(bodyRight, x);
      }
    }
  }
  const bodyCenterX = bodyRight >= bodyLeft ? (bodyLeft + bodyRight) / 2 : bounds.left + bounds.width / 2;
  return { data, info, bounds, bodyCenterX };
}

async function normalizeFrame(input, scale, alignBody = false) {
  const { data, info, bounds, bodyCenterX } = await sourceMetrics(input);
  const resizedWidth = Math.max(1, Math.round(bounds.width * scale));
  const resizedHeight = Math.max(1, Math.round(bounds.height * scale));
  const crop = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract(bounds)
    .resize({ width: resizedWidth, height: resizedHeight, fit: 'fill' })
    .png()
    .toBuffer();
  const scaledSourceWidth = Math.round(info.width * scale);
  const left = alignBody
    ? Math.round(CELL / 2 - (bodyCenterX - bounds.left) * scale)
    : Math.round((CELL - scaledSourceWidth) / 2) + Math.round(bounds.left * scale);
  const top = BASELINE - resizedHeight + 1;
  if (left < 0 || top < 0 || left + resizedWidth > CELL || top + resizedHeight > CELL) {
    throw new Error(`${input} does not fit ${CELL}px cell after alignment`);
  }
  const buffer = await sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: crop, left, top }]).png().toBuffer();
  return { buffer, bounds: { left, top, width: resizedWidth, height: resizedHeight } };
}

async function normalizeCenteredAsset(input, maxWidth, maxHeight) {
  const { data, info, bounds } = await sourceMetrics(input);
  const scale = Math.min(1, maxWidth / bounds.width, maxHeight / bounds.height);
  const resizedWidth = Math.max(1, Math.round(bounds.width * scale));
  const resizedHeight = Math.max(1, Math.round(bounds.height * scale));
  const crop = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract(bounds)
    .resize({ width: resizedWidth, height: resizedHeight, fit: 'fill' })
    .png()
    .toBuffer();
  return sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: crop,
    left: Math.round((CELL - resizedWidth) / 2),
    top: Math.round((CELL - resizedHeight) / 2),
  }]).png().toBuffer();
}

async function normalizeCharacter(group, character) {
  const characterDir = path.join(group.directory, character);
  const framePaths = DIRECTIONS.flatMap((direction) => FRAMES.map((frame) => ({
    id: `${direction}-${frame}`,
    input: path.join(characterDir, 'frames', `${direction}-${frame}.png`),
  })));
  const metrics = await Promise.all(framePaths.map(({ input }) => sourceMetrics(input)));
  const largestHeight = Math.max(...metrics.map((entry) => entry.bounds.height));
  const largestWidth = Math.max(...metrics.map((entry) => entry.bounds.width));
  const scale = Math.min(1, MAX_CONTENT_HEIGHT / largestHeight, MAX_CONTENT_WIDTH / largestWidth);
  const frames = new Map();
  const sheetInputs = [];
  for (const [row, direction] of DIRECTIONS.entries()) {
    for (const [column, frame] of FRAMES.entries()) {
      const id = `${direction}-${frame}`;
      const result = await normalizeFrame(
        path.join(characterDir, 'frames', `${id}.png`),
        scale,
        group.label === 'skin-variant',
      );
      frames.set(id, result.buffer);
      await sharp(result.buffer).toFile(path.join(characterDir, 'frames', `${id}.png`));
      sheetInputs.push({ input: result.buffer, left: column * CELL, top: row * CELL });
    }
  }
  const sheet = await sharp({
    create: { width: CELL * COLUMNS, height: CELL * ROWS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(sheetInputs).png().toBuffer();
  await sharp(sheet).toFile(path.join(characterDir, 'movement-sheet.png'));
  await sharp(frames.get('front-idle')).toFile(path.join(characterDir, 'concept.png'));
  if (group.makeSleep) {
    const sleepPath = path.join(characterDir, 'sleep.png');
    // Dedicated base sleep art is generated and centered separately.  Keep it
    // intact on future atlas normalization runs; only make the old rotated
    // fallback when a new character has not supplied sleep art yet.
    try {
      await access(sleepPath);
    } catch {
      await sharp(frames.get('side-idle')).rotate(90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png()
        .toFile(sleepPath);
    }
  }
  if (group.label === 'skin-variant') {
    const sleepPath = path.join(characterDir, 'sleep.png');
    await access(sleepPath);
    const sleep = await normalizeCenteredAsset(sleepPath, 340, 210);
    await sharp(sleep).toFile(sleepPath);
  }
}

async function verifyCharacter(group, character) {
  const input = path.join(group.directory, character, 'movement-sheet.png');
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== CELL * COLUMNS || info.height !== CELL * ROWS) throw new Error(`${input} has invalid atlas size`);
  const alphaIndex = info.channels - 1;
  for (const [row, direction] of DIRECTIONS.entries()) {
    for (const [column, frame] of FRAMES.entries()) {
      let bottom = -1;
      for (let y = 0; y < CELL; y += 1) for (let x = 0; x < CELL; x += 1) {
        const sheetX = column * CELL + x;
        const sheetY = row * CELL + y;
        if (data[(sheetY * info.width + sheetX) * info.channels + alphaIndex] > 3) bottom = Math.max(bottom, y);
      }
      if (bottom !== BASELINE) throw new Error(`${group.label}/${character}/${direction}-${frame} baseline ${bottom}, expected ${BASELINE}`);
    }
  }
}

async function run(verifyOnly) {
  const groups = process.argv.includes('--variant-only')
    ? GROUPS.filter((group) => group.label === 'skin-variant')
    : GROUPS;
  for (const group of groups) {
    const characters = (await readdir(group.directory)).filter((entry) => entry.startsWith(group.entryPrefix)).sort();
    for (const character of characters) {
      if (!verifyOnly) await normalizeCharacter(group, character);
      await verifyCharacter(group, character);
    }
    console.log(`${group.label}: ${characters.length} character atlases verified`);
  }
}

await run(process.argv.includes('--verify'));
