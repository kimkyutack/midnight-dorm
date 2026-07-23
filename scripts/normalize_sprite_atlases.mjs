/**
 * Normalizes every survivor base and complete skin to one 4 x 3 atlas grid.
 *
 * All frames use the exact same bottom baseline. This keeps a character's
 * torso stable while only the feet change during a walk and prevents the
 * front/back/side preview from jumping or clipping on mobile canvases.
 */
import { readdir } from 'node:fs/promises';
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
  { label: 'base', directory: path.join(root, 'public/assets/paperdoll/bases'), makeSleep: true },
  { label: 'skin', directory: path.join(root, 'public/assets/sprites/survivors'), makeSleep: false },
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
  return { data, info, bounds };
}

async function normalizeFrame(input, scale) {
  const { data, info, bounds } = await sourceMetrics(input);
  const resizedWidth = Math.max(1, Math.round(bounds.width * scale));
  const resizedHeight = Math.max(1, Math.round(bounds.height * scale));
  const crop = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract(bounds)
    .resize({ width: resizedWidth, height: resizedHeight, fit: 'fill' })
    .png()
    .toBuffer();
  const scaledSourceWidth = Math.round(info.width * scale);
  const left = Math.round((CELL - scaledSourceWidth) / 2) + Math.round(bounds.left * scale);
  const top = BASELINE - resizedHeight + 1;
  if (left < 0 || top < 0 || left + resizedWidth > CELL || top + resizedHeight > CELL) {
    throw new Error(`${input} does not fit ${CELL}px cell after alignment`);
  }
  const buffer = await sharp({
    create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: crop, left, top }]).png().toBuffer();
  return { buffer, bounds: { left, top, width: resizedWidth, height: resizedHeight } };
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
      const result = await normalizeFrame(path.join(characterDir, 'frames', `${id}.png`), scale);
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
    // Neutral base characters do not borrow a fully dressed sleeping image.
    // A rotated side pose is a consistent, transparent resting placeholder
    // until dedicated neutral sleep art is drawn for each character.
    await sharp(frames.get('side-idle')).rotate(90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png()
      .toFile(path.join(characterDir, 'sleep.png'));
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
  for (const group of GROUPS) {
    const characters = (await readdir(group.directory)).filter((entry) => entry.startsWith('character-')).sort();
    for (const character of characters) {
      if (!verifyOnly) await normalizeCharacter(group, character);
      await verifyCharacter(group, character);
    }
    console.log(`${group.label}: ${characters.length} character atlases verified`);
  }
}

await run(process.argv.includes('--verify'));
