import { access } from "node:fs/promises";

// The product favicon and install icons are curated raster derivatives of
// public/icons/icon-scene-source.png. They are versioned assets committed to
// the project so a Cloudflare build never replaces them with placeholder art.
const requiredIcons = [
  "public/icons/favicon.png",
  "public/icons/favicon.ico",
  "public/icons/android-icon-192x192.png",
  "public/icons/android-icon-512x512.png",
  "public/icons/icon-maskable-512.png",
];

await Promise.all(requiredIcons.map((path) => access(path)));
console.log("Using curated scene favicon and PWA icon assets.");
