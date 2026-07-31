import { readdir, rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const nativeAssetsRoot = resolve("dist/client/assets");

async function directorySize(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

async function pruneSourceDirectories(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let removedBytes = 0;
  let removedDirectories = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const entryPath = resolve(path, entry.name);
    if (entry.name === "source") {
      removedBytes += await directorySize(entryPath);
      await rm(entryPath, { recursive: true, force: true });
      removedDirectories += 1;
      continue;
    }

    const nested = await pruneSourceDirectories(entryPath);
    removedBytes += nested.removedBytes;
    removedDirectories += nested.removedDirectories;
  }

  return { removedBytes, removedDirectories };
}

if (!nativeAssetsRoot.startsWith(`${resolve("dist/client")}${sep}`)) {
  throw new Error("Refusing to prune outside the generated native client bundle.");
}

try {
  const { removedBytes, removedDirectories } = await pruneSourceDirectories(nativeAssetsRoot);
  console.log(
    `Native asset pruning complete: ${removedDirectories} source directories removed (${(
      removedBytes /
      1024 /
      1024
    ).toFixed(1)} MB).`,
  );
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error("Native client bundle was not found. Run Vite build before pruning assets.");
  }
  throw error;
}
