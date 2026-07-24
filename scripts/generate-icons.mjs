import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const icon = (size, maskable = false) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="night" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#15294a"/><stop offset="1" stop-color="#050814"/></linearGradient>
    <radialGradient id="halo" cx="50%" cy="35%" r="62%"><stop stop-color="#2f6b94" stop-opacity=".72"/><stop offset="1" stop-color="#0b1125" stop-opacity="0"/></radialGradient>
    <linearGradient id="fur" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffdf6"/><stop offset="1" stop-color="#dce5ee"/></linearGradient>
    <filter id="softGlow"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#night)"/>
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="url(#halo)"/>
  <circle cx="385" cy="130" r="82" fill="#9cecff" opacity=".22" filter="url(#softGlow)"/>
  <path d="M382 235c-53 0-89 41-89 96v96l26-22 25 25 38-27 39 27 25-25 26 22v-96c0-55-36-96-90-96Z" fill="#ff627f" opacity=".88"/>
  <circle cx="350" cy="327" r="12" fill="#2a1535"/><circle cx="416" cy="327" r="12" fill="#2a1535"/>
  <path d="M173 251 151 91c-5-37 56-49 69-11l39 143M339 223l39-143c13-38 74-26 69 11l-22 160" fill="url(#fur)" stroke="#25324a" stroke-width="15" stroke-linejoin="round"/>
  <path d="M180 175 169 111c-3-18 27-23 33-6l22 76m109 0 22-76c6-17 36-12 33 6l-11 64" fill="#f6a5b8" opacity=".82"/>
  <ellipse cx="256" cy="306" rx="143" ry="126" fill="url(#fur)" stroke="#25324a" stroke-width="15"/>
  <path d="M137 253c24-60 213-69 238 0l-16 36H153z" fill="#63cae5" stroke="#25324a" stroke-width="15" stroke-linejoin="round"/>
  <path d="M178 246c19-38 136-44 157 0" fill="none" stroke="#e6f8ff" stroke-width="15" stroke-linecap="round"/>
  <ellipse cx="207" cy="304" rx="17" ry="23" fill="#172238"/><ellipse cx="305" cy="304" rx="17" ry="23" fill="#172238"/>
  <circle cx="202" cy="297" r="6" fill="#fff"/><circle cx="300" cy="297" r="6" fill="#fff"/>
  <ellipse cx="256" cy="344" rx="24" ry="18" fill="#f5a6b7" stroke="#25324a" stroke-width="8"/>
  <path d="M237 367c12 12 26 12 38 0" fill="none" stroke="#25324a" stroke-width="8" stroke-linecap="round"/>
  <ellipse cx="158" cy="350" rx="22" ry="12" fill="#f5a6b7" opacity=".75"/><ellipse cx="354" cy="350" rx="22" ry="12" fill="#f5a6b7" opacity=".75"/>
</svg>`;

await mkdir("public/icons", { recursive: true });
await writeFile("public/icons/favicon.ico", icon(512));
await writeFile("public/icons/icon-maskable.svg", icon(512, true));
await writeFile("public/icons/android-icon-192x192.png", makePng(192));
await writeFile("public/icons/android-icon-512x512.png", makePng(512));

function makePng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (Math.floor(y) * size + Math.floor(x)) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3] ?? 255;
  };
  const rectangle = (x, y, width, height, color) => {
    for (let py = Math.floor(y); py < y + height; py += 1)
      for (let px = Math.floor(x); px < x + width; px += 1) put(px, py, color);
  };
  const circle = (cx, cy, radius, color) => {
    for (let y = -radius; y <= radius; y += 1)
      for (let x = -radius; x <= radius; x += 1)
        if (x * x + y * y <= radius * radius) put(cx + x, cy + y, color);
  };
  const ellipse = (cx, cy, rx, ry, color) => {
    for (let y = -ry; y <= ry; y += 1)
      for (let x = -rx; x <= rx; x += 1)
        if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1)
          put(cx + x, cy + y, color);
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (x + y) / (size * 2);
      put(x, y, [
        Math.floor(23 - t * 13),
        Math.floor(43 - t * 28),
        Math.floor(76 - t * 49),
        255,
      ]);
    }
  }
  const unit = size / 512;
  const s = (value) => Math.max(1, Math.round(value * unit));
  circle(s(385), s(130), s(86), [85, 177, 215, 86]);
  circle(s(385), s(332), s(88), [236, 83, 116, 255]);
  rectangle(s(297), s(330), s(176), s(91), [236, 83, 116, 255]);
  circle(s(350), s(327), s(12), [40, 19, 50, 255]);
  circle(s(416), s(327), s(12), [40, 19, 50, 255]);
  ellipse(s(183), s(177), s(42), s(100), [223, 232, 238, 255]);
  ellipse(s(329), s(177), s(42), s(100), [223, 232, 238, 255]);
  ellipse(s(256), s(306), s(145), s(129), [242, 246, 244, 255]);
  rectangle(s(135), s(251), s(242), s(42), [93, 196, 224, 255]);
  ellipse(s(256), s(252), s(121), s(42), [99, 202, 229, 255]);
  ellipse(s(207), s(304), s(18), s(24), [23, 34, 56, 255]);
  ellipse(s(305), s(304), s(18), s(24), [23, 34, 56, 255]);
  circle(s(202), s(297), s(6), [255, 255, 255, 255]);
  circle(s(300), s(297), s(6), [255, 255, 255, 255]);
  ellipse(s(256), s(344), s(25), s(19), [245, 166, 183, 255]);
  ellipse(s(158), s(350), s(23), s(12), [245, 166, 183, 150]);
  ellipse(s(354), s(350), s(23), s(12), [245, 166, 183, 150]);

  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1)
    pixels.copy(
      scanlines,
      y * (size * 4 + 1) + 1,
      y * size * 4,
      (y + 1) * size * 4,
    );
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
