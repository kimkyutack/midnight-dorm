import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import sharp from "sharp";

const clientRoot = resolve("dist/client");
const assetRoot = resolve(clientRoot, "assets");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".mjs"]);
const concurrency = Math.min(6, Math.max(2, availableParallelism() - 1));

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function runPool(items, task) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await task(item);
      }
    }),
  );
}

const pngFallbackDirectories = [resolve(assetRoot, "ranks")];

function preservesPngFallback(source) {
  return pngFallbackDirectories.some(
    (directory) => source === directory || source.startsWith(`${directory}/`),
  );
}

async function convertToWebp(source) {
  const target = `${source.slice(0, -4)}.webp`;
  const temporary = `${target}.tmp`;
  await rm(temporary, { force: true });
  await sharp(source, { failOn: "warning" })
    .webp({ quality: 94, alphaQuality: 100, effort: 4, smartSubsample: true })
    .toFile(temporary);
  await rename(temporary, target);
  // Rank URLs are assembled dynamically at runtime, so the blanket text
  // rewrite below cannot see every ".png" request. Keep the tiny PNG set as
  // a native fallback while direct/literal references still use WebP.
  if (!preservesPngFallback(source)) await rm(source, { force: true });
}

const assetFiles = await walk(assetRoot);
const pngFiles = assetFiles.filter((file) => file.endsWith(".png"));
await runPool(pngFiles, convertToWebp);

const clientFiles = await walk(clientRoot);
let rewrittenFiles = 0;
for (const file of clientFiles) {
  const extension = file.slice(file.lastIndexOf("."));
  if (!textExtensions.has(extension)) continue;
  const content = await readFile(file, "utf8");
  if (!content.includes(".png")) continue;
  await writeFile(file, content.replaceAll(".png", ".webp"));
  rewrittenFiles += 1;
}

console.log(
  `Client image optimization complete: ${pngFiles.length} PNG assets converted to high-quality WebP; ${pngFiles.filter(preservesPngFallback).length} dynamic rank PNG fallbacks preserved; ${rewrittenFiles} client files updated.`,
);
