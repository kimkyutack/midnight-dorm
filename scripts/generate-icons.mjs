import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const icon = (size, maskable = false) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#171a42"/><stop offset="1" stop-color="#090b1a"/></linearGradient>
    <linearGradient id="moon" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d4c2ff"/><stop offset="1" stop-color="#5be5ff"/></linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#sky)"/>
  <circle cx="380" cy="126" r="74" fill="url(#moon)" filter="url(#glow)"/>
  <path d="M77 404V211l179-92 179 92v193H77Z" fill="#2b305d" stroke="#9b8ae8" stroke-width="16" stroke-linejoin="round"/>
  <path d="M214 404V276h84v128" fill="#10132d" stroke="#5be5ff" stroke-width="12"/>
  <path d="M130 243h58v66h-58zm194 0h58v66h-58z" fill="#ffd36f" stroke="#14172f" stroke-width="10"/>
  <path d="M186 174c22-45 104-45 126 0-12 20-31 31-63 31s-51-11-63-31Z" fill="#7765b5"/>
  <ellipse cx="225" cy="174" rx="9" ry="13" fill="#ff668c"/><ellipse cx="278" cy="174" rx="9" ry="13" fill="#ff668c"/>
</svg>`;

await mkdir('public/icons', { recursive: true });
await writeFile('public/icons/icon.svg', icon(512));
await writeFile('public/icons/icon-maskable.svg', icon(512, true));
await writeFile('public/icons/icon-192.png', makePng(192));
await writeFile('public/icons/icon-512.png', makePng(512));

function makePng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (Math.floor(y) * size + Math.floor(x)) * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = color[3] ?? 255;
  };
  const rectangle = (x, y, width, height, color) => {
    for (let py = Math.floor(y); py < y + height; py += 1) for (let px = Math.floor(x); px < x + width; px += 1) put(px, py, color);
  };
  const circle = (cx, cy, radius, color) => {
    for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= radius * radius) put(cx + x, cy + y, color);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (size * 2);
      put(x, y, [Math.floor(18 - t * 9), Math.floor(22 - t * 11), Math.floor(54 - t * 28), 255]);
    }
  }
  const unit = size / 512;
  circle(Math.floor(382 * unit), Math.floor(124 * unit), Math.floor(70 * unit), [139, 221, 244, 255]);
  circle(Math.floor(360 * unit), Math.floor(105 * unit), Math.floor(61 * unit), [205, 188, 255, 255]);
  rectangle(76 * unit, 210 * unit, 360 * unit, 195 * unit, [43, 48, 93, 255]);
  rectangle(95 * unit, 230 * unit, 322 * unit, 175 * unit, [54, 58, 111, 255]);
  rectangle(214 * unit, 278 * unit, 84 * unit, 127 * unit, [12, 16, 44, 255]);
  rectangle(130 * unit, 248 * unit, 58 * unit, 65 * unit, [255, 211, 111, 255]);
  rectangle(324 * unit, 248 * unit, 58 * unit, 65 * unit, [255, 211, 111, 255]);
  circle(Math.floor(226 * unit), Math.floor(179 * unit), Math.max(2, Math.floor(9 * unit)), [255, 102, 140, 255]);
  circle(Math.floor(280 * unit), Math.floor(179 * unit), Math.max(2, Math.floor(9 * unit)), [255, 102, 140, 255]);

  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
