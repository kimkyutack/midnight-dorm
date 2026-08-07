import sharp from 'sharp';

const [input, ...outputs] = process.argv.slice(2);
if (!input || outputs.length !== 3) {
  throw new Error('Usage: node scripts/repack-prestige-sleep.mjs <three-pose-green-screen> <fox-output.png> <rabbit-output.png> <gorilla-output.png>');
}

const metadata = await sharp(input).metadata();
const cuts = [
  [0, 0.36],
  [0.29, 0.69],
  [0.61, 1],
];

function alphaBounds(data, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * 4 + 3] <= 8) continue;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) throw new Error('Empty sleep pose');
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function keepLargestSilhouette(data, width, height) {
  const visited = new Uint8Array(width * height);
  let largest = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || data[start * 4 + 3] <= 8) continue;
    const queue = [start];
    const component = [];
    visited[start] = 1;
    for (let index = 0; index < queue.length; index += 1) {
      const pixel = queue[index];
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const neighbours = [];
      if (x > 0) neighbours.push(pixel - 1);
      if (x + 1 < width) neighbours.push(pixel + 1);
      if (y > 0) neighbours.push(pixel - width);
      if (y + 1 < height) neighbours.push(pixel + width);
      for (const neighbour of neighbours) {
        if (visited[neighbour] || data[neighbour * 4 + 3] <= 8) continue;
        visited[neighbour] = 1;
        queue.push(neighbour);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const keep = new Uint8Array(width * height);
  for (const pixel of largest) keep[pixel] = 1;
  for (let pixel = 0; pixel < keep.length; pixel += 1) {
    if (keep[pixel]) continue;
    const offset = pixel * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
}

for (const [index, output] of outputs.entries()) {
  const left = Math.round(metadata.width * cuts[index][0]);
  const right = Math.round(metadata.width * cuts[index][1]);
  const { data, info } = await sharp(input)
    .extract({ left, top: 0, width: right - left, height: metadata.height })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const key = Math.max(0, Math.min(1, (green - Math.max(red, blue) - 12) / 72));
    data[offset + 3] = Math.round(255 * (1 - key));
    if (data[offset + 3] < 9) data[offset + 3] = 0;
  }
  keepLargestSilhouette(data, info.width, info.height);
  const bounds = alphaBounds(data, info.width, info.height);
  const width = Math.round(Math.min(604, bounds.width * Math.min(1, 604 / bounds.width, 420 / bounds.height)));
  const height = Math.round(bounds.height * width / bounds.width);
  const pose = await sharp(data, { raw: info })
    .extract(bounds)
    .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const canvas = await sharp({
    create: { width: 640, height: 640, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: pose,
    left: Math.round((640 - width) / 2),
    top: Math.round((640 - height) / 2),
  }]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  await sharp(canvas).toFile(output);
  await sharp(canvas).webp({ quality: 92, alphaQuality: 100, effort: 6 }).toFile(output.replace(/\.png$/i, '.webp'));
}
