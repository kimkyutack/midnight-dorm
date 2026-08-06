#!/usr/bin/env node
import path from 'node:path';
import sharp from 'sharp';

const [input, output, requestedBottom = '12'] = process.argv.slice(2);
if (!input || !output) {
  throw new Error('usage: node scripts/normalize_sprite_sheet_baseline.mjs <input> <output> [bottom-padding]');
}

const columns = 4;
const rows = 3;
const { data, info } = await sharp(input)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.width % columns !== 0 || info.height % rows !== 0) {
  throw new Error(`sprite sheet must be a 4x3 grid: ${info.width}x${info.height}`);
}

const cellWidth = info.width / columns;
const cellHeight = info.height / rows;
const frames = [];
let maximumSafeBottom = Number.POSITIVE_INFINITY;

function inspectFrame(row, column) {
  const opaque = new Uint8Array(cellWidth * cellHeight);
  for (let y = 0; y < cellHeight; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      const sourceOffset = (((row * cellHeight + y) * info.width) + column * cellWidth + x) * 4;
      if (data[sourceOffset + 3] > 24) opaque[y * cellWidth + x] = 1;
    }
  }

  const labels = new Int32Array(opaque.length);
  labels.fill(-1);
  const components = [];
  for (let start = 0; start < opaque.length; start += 1) {
    if (!opaque[start] || labels[start] !== -1) continue;
    const id = components.length;
    const queue = [start];
    labels[start] = id;
    const component = {
      id,
      size: 0,
      minimumX: cellWidth,
      maximumX: -1,
      minimumY: cellHeight,
      maximumY: -1,
    };
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % cellWidth;
      const y = Math.floor(index / cellWidth);
      component.size += 1;
      component.minimumX = Math.min(component.minimumX, x);
      component.maximumX = Math.max(component.maximumX, x);
      component.minimumY = Math.min(component.minimumY, y);
      component.maximumY = Math.max(component.maximumY, y);
      for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
        for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
          if (deltaX === 0 && deltaY === 0) continue;
          const nextX = x + deltaX;
          const nextY = y + deltaY;
          if (nextX < 0 || nextX >= cellWidth || nextY < 0 || nextY >= cellHeight) continue;
          const next = nextY * cellWidth + nextX;
          if (opaque[next] && labels[next] === -1) {
            labels[next] = id;
            queue.push(next);
          }
        }
      }
    }
    components.push(component);
  }

  const main = components.reduce((largest, component) => (
    !largest || component.size > largest.size ? component : largest
  ), null);
  if (!main) {
    return { bottom: 0, minimumY: 0, anchorX: (cellWidth - 1) / 2, discardedBounds: [] };
  }

  // Prestige sprites have asymmetrical capes, tails, and floating effects.
  // Their full alpha bounds are not a stable animation anchor. The upper 36%
  // of the largest connected body component contains the head/helmet, which is
  // the visually stable center shared by every walking frame.
  const headEndY = main.minimumY + Math.round((main.maximumY - main.minimumY + 1) * 0.36);
  let headMinimumX = cellWidth;
  let headMaximumX = -1;
  for (let y = main.minimumY; y <= headEndY; y += 1) {
    for (let x = 0; x < cellWidth; x += 1) {
      if (labels[y * cellWidth + x] !== main.id) continue;
      headMinimumX = Math.min(headMinimumX, x);
      headMaximumX = Math.max(headMaximumX, x);
    }
  }

  // A generated atlas can contain a detached piece of a neighbouring pose at
  // the cell edge. Keep authored upper-body effects (foxfire, stars), but drop
  // sizeable detached fragments in the lower half where cape/tail bleed shows.
  const discardedBounds = components
    .filter((component) => (
      component.id !== main.id
      && component.size >= 48
      && component.minimumY > cellHeight * 0.5
    ))
    .map((component) => ({
      minimumX: Math.max(0, component.minimumX - 2),
      maximumX: Math.min(cellWidth - 1, component.maximumX + 2),
      minimumY: Math.max(0, component.minimumY - 2),
      maximumY: Math.min(cellHeight - 1, component.maximumY + 2),
    }));

  return {
    bottom: cellHeight - 1 - main.maximumY,
    minimumY: main.minimumY,
    anchorX: headMaximumX < 0 ? (cellWidth - 1) / 2 : (headMinimumX + headMaximumX) / 2,
    discardedBounds,
  };
}

for (let row = 0; row < rows; row += 1) {
  for (let column = 0; column < columns; column += 1) {
    const inspected = inspectFrame(row, column);
    frames.push({ row, column, ...inspected });
    maximumSafeBottom = Math.min(maximumSafeBottom, inspected.bottom + inspected.minimumY);
  }
}

const targetBottom = Math.max(0, Math.min(Number(requestedBottom) || 0, maximumSafeBottom));

const normalized = Buffer.alloc(data.length);
for (const frame of frames) {
  // Positive offsets move into existing bottom padding; negative offsets use
  // verified top padding. Every prestige skin therefore shares one 12px foot
  // baseline without cropping ears, helmets, or effects.
  const offsetY = frame.bottom - targetBottom;
  const offsetX = Math.round(((cellWidth - 1) / 2) - frame.anchorX);
  for (let y = 0; y < cellHeight; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= cellHeight) continue;
    for (let x = 0; x < cellWidth; x += 1) {
      if (frame.discardedBounds.some((bounds) => (
        x >= bounds.minimumX && x <= bounds.maximumX
        && y >= bounds.minimumY && y <= bounds.maximumY
      ))) continue;
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= cellWidth) continue;
      const sourceOffset = (((frame.row * cellHeight + y) * info.width) + frame.column * cellWidth + x) * 4;
      const targetOffset = (((frame.row * cellHeight + targetY) * info.width) + frame.column * cellWidth + targetX) * 4;
      data.copy(normalized, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

let pipeline = sharp(normalized, {
  raw: { width: info.width, height: info.height, channels: 4 },
});
if (path.extname(output).toLowerCase() === '.webp') {
  // Lossless alpha avoids 8x8 color blocks around dark prestige armor on
  // WebKit/Android decoders while keeping the authored sprite resolution.
  pipeline = pipeline.webp({ lossless: true, effort: 6 });
} else {
  pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
}
await pipeline.toFile(path.resolve(output));

console.log(`normalized ${frames.length} frames to a body-centered axis and ${targetBottom}px bottom padding`);
