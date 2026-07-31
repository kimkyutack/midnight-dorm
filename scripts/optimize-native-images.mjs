import { execFile } from "node:child_process";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
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

async function convertToWebp(source) {
  const target = `${source.slice(0, -4)}.webp`;
  const temporary = `${target}.tmp`;
  await rm(temporary, { force: true });
  await run("cwebp", ["-quiet", "-q", "96", "-alpha_q", "100", "-m", "2", "-mt", source, "-o", temporary]);
  await rename(temporary, target);
  await rm(source, { force: true });
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
  `Native image optimization complete: ${pngFiles.length} PNG assets converted to high-quality WebP; ${rewrittenFiles} client files updated.`,
);
