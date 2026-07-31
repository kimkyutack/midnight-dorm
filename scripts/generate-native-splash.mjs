import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const source = resolve("public/assets/cinematic/native-splash-master.png");

const androidTargets = [
  ["android/app/src/main/res/drawable/splash.png", 480, 320],
  ["android/app/src/main/res/drawable-port-mdpi/splash.png", 320, 480],
  ["android/app/src/main/res/drawable-port-xhdpi/splash.png", 720, 1280],
  ["android/app/src/main/res/drawable-port-xxhdpi/splash.png", 960, 1600],
  ["android/app/src/main/res/drawable-port-xxxhdpi/splash.png", 1280, 1920],
  ["android/app/src/main/res/drawable-land-mdpi/splash.png", 480, 320],
  ["android/app/src/main/res/drawable-land-hdpi/splash.png", 800, 480],
  ["android/app/src/main/res/drawable-land-xhdpi/splash.png", 1280, 720],
  ["android/app/src/main/res/drawable-land-xxhdpi/splash.png", 1600, 960],
  ["android/app/src/main/res/drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["android/app/src/main/res/drawable-land-xxxhdpi/drawable-port-hdpi/splash.png", 480, 800],
];

const iosTargets = [
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png",
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png",
];

function sips(args) {
  execFileSync("sips", args, { stdio: "inherit" });
}

async function makeCrop(target, width, height, scratch) {
  await mkdir(dirname(target), { recursive: true });
  const resized = resolve(scratch, `${width}x${height}.png`);
  const resample = width >= height ? ["--resampleWidth", String(width)] : ["--resampleHeight", String(height)];
  sips([...resample, source, "--out", resized]);
  sips(["--cropToHeightWidth", String(height), String(width), resized, "--out", target]);
}

await stat(source);
const scratch = mkdtempSync(resolve(tmpdir(), "midnight-dorm-splash-"));

try {
  for (const [relativeTarget, width, height] of androidTargets) {
    await makeCrop(resolve(relativeTarget), width, height, scratch);
  }

  for (const relativeTarget of iosTargets) {
    const target = resolve(relativeTarget);
    await mkdir(dirname(target), { recursive: true });
    sips(["--resampleHeightWidth", "2732", "2732", source, "--out", target]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log("Native splash images generated for Android and iOS.");
