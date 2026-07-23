/**
 * Imports the approved transparent base-character sleeping poses into the
 * paperdoll directory.  Keeping this step separate from atlas normalization
 * preserves the horizontal sleeping composition instead of forcing it onto
 * the walking-frame baseline.
 */
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const sourceDirectory = '/tmp/base-sleeps';
const CELL = 362;
const MAX_WIDTH = 334;
const MAX_HEIGHT = 286;

const sources = {
  'character-bunny': 'alpha-exec-a391b10b-80f2-494f-852b-0268fba2b74f.png',
  'character-cat': 'alpha-exec-04280720-a1b0-45c4-94f3-5584ed40e24c.png',
  'character-puppy': 'alpha-exec-57dc1c02-f0d6-493d-a1fe-c42aef86c5ff.png',
  'character-bear': 'alpha-exec-35c47fb1-e726-4356-a7d6-e46b784fae7d.png',
  'character-fox': 'alpha-exec-11e5eb17-f82f-4681-92d8-5122a8e04f9e.png',
  'character-hamster': 'alpha-exec-647df758-77d1-4563-93c7-5f0cf2c63dfc.png',
  'character-crocodile': 'alpha-exec-33e536ed-8fed-4e3f-bef8-c56b4a6ceaf2.png',
  'character-duck': 'alpha-exec-29d451ad-db1f-4228-a828-800a4508b3fa.png',
  'character-tiger': 'alpha-exec-2768c6d6-6ca7-463b-8f6b-873f5fe1f939.png',
  'character-dinosaur': 'alpha-exec-3fd530ed-b50d-4cf3-bcb9-3d6ddb440c36.png',
  'character-monkey': 'alpha-exec-af5a5f5f-8817-4496-b74b-0e8ed9d75873.png',
  'character-gorilla': 'alpha-exec-ec407f22-0388-459d-8e70-1225af99daca.png',
};

function alphaBounds(data, info) {
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  const alphaIndex = info.channels - 1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + alphaIndex] <= 4) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error('sleep art is fully transparent');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function importSleep(character, filename) {
  const input = path.join(sourceDirectory, filename);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(data, info);
  const scale = Math.min(1, MAX_WIDTH / bounds.width, MAX_HEIGHT / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const crop = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .extract(bounds)
    .resize({ width, height, fit: 'fill' })
    .png()
    .toBuffer();
  const output = path.join(root, 'public/assets/paperdoll/bases', character, 'sleep.png');
  await sharp({
    create: {
      width: CELL,
      height: CELL,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: crop, left: Math.round((CELL - width) / 2), top: Math.round((CELL - height) / 2) }])
    .png()
    .toFile(output);
  console.log(`${character}: ${width}×${height} centered`);
}

for (const [character, filename] of Object.entries(sources)) {
  await importSleep(character, filename);
}
