import { readdir, rm, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const clientAssetsRoot = resolve("dist/client/assets");
const generatedSourcePattern = /(?:-master|-chroma)\.(?:png|webp)$/i;

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

async function pruneGeneratedSources(path) {
  const entries = await readdir(path, { withFileTypes: true });
  let removedBytes = 0;
  let removedDirectories = 0;
  let removedFiles = 0;

  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory() && entry.name === "source") {
      removedBytes += await directorySize(entryPath);
      await rm(entryPath, { recursive: true, force: true });
      removedDirectories += 1;
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await pruneGeneratedSources(entryPath);
      removedBytes += nested.removedBytes;
      removedDirectories += nested.removedDirectories;
      removedFiles += nested.removedFiles;
      continue;
    }
    if (entry.isFile() && generatedSourcePattern.test(entry.name)) {
      removedBytes += (await stat(entryPath)).size;
      await rm(entryPath, { force: true });
      removedFiles += 1;
    }
  }

  return { removedBytes, removedDirectories, removedFiles };
}

if (!clientAssetsRoot.startsWith(`${resolve("dist/client")}${sep}`)) {
  throw new Error("Refusing to prune outside the generated client bundle.");
}

try {
  const { removedBytes, removedDirectories, removedFiles } = await pruneGeneratedSources(clientAssetsRoot);
  console.log(
    `Client asset pruning complete: ${removedDirectories} source directories and ${removedFiles} source images removed (${(
      removedBytes /
      1024 /
      1024
    ).toFixed(1)} MB).`,
  );
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error("Client bundle was not found. Run Vite build before pruning assets.");
  }
  throw error;
}
