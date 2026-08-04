import { expect, test } from "@playwright/test";

const previewModes = [
  "opening",
  "loading",
  "auth-login",
  "auth-register",
  "result-victory",
  "result-defeat",
] as const;

async function waitForSceneArtwork(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const urls = [
      "/assets/cinematic/arcade-auth-gateway-v1.webp",
      "/assets/cinematic/arcade-opening-intro-v1.webp",
      "/assets/cinematic/arcade-stage-loading-v1.webp",
      "/assets/cinematic/arcade-victory-dawn-v1.webp",
      "/assets/cinematic/arcade-defeat-regroup-v1.webp",
    ];
    await Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error(`failed to load ${url}`));
            image.src = url;
          }),
      ),
    );
    await document.fonts.ready;
  });
}

for (const mode of previewModes) {
  test(`arcade ${mode} preview fits the mobile viewport`, async ({ page }, testInfo) => {
    await page.goto(`/?dev=1&automation=1&ui-preview=${mode}`);
    await waitForSceneArtwork(page);
    await expect(page.locator("main")).toBeVisible();
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
    expect(viewport.scrollHeight).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({
      path: testInfo.outputPath(`${mode}.png`),
      animations: "disabled",
    });
  });
}

test("home pose stays visually centered across the six-frame yawn", async ({ page }, testInfo) => {
  await page.goto("/?dev=1&automation=1&e2e=1");
  await page.getByRole("button", { name: "새 계정" }).click();
  const suffix = Date.now().toString(36);
  await page.getByLabel("아이디").fill(`center${suffix}`.slice(0, 20));
  await page.getByLabel("게임 닉네임").fill(`중앙정렬${suffix.slice(-3)}`);
  await page.getByRole("textbox", { name: "비밀번호" }).fill("midnight-test-2026");
  await page.getByRole("button", { name: "생존자 등록" }).click();
  await expect(page.locator(".game-home")).toBeVisible();
  await page.waitForTimeout(800);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const promo = page.locator(".surfer-mong-promo");
    if (!(await promo.isVisible().catch(() => false))) break;
    await promo.getByRole("button", { name: "다시 보지 않기" }).click();
  }
  const alignment = await page.locator(".home-pose-avatar").evaluate((avatar) => {
    const avatarRect = avatar.getBoundingClientRect();
    const showcaseRect = avatar.parentElement?.getBoundingClientRect();
    return {
      avatarCellCenter: avatarRect.left + avatarRect.width / 2,
      showcaseCenter: showcaseRect ? showcaseRect.left + showcaseRect.width / 2 : 0,
      backgroundSize: getComputedStyle(avatar).backgroundSize,
      transform: getComputedStyle(avatar).transform,
    };
  });
  expect(alignment.backgroundSize).toBe("600% 500%");
  expect(alignment.transform).toBe("none");
  expect(Math.abs(alignment.avatarCellCenter - alignment.showcaseCenter)).toBeLessThan(0.5);
  await page.screenshot({
    path: testInfo.outputPath("home-centered.png"),
    animations: "disabled",
  });
});
