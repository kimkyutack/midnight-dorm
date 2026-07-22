import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

interface TestState {
  map: {
    walkable: Array<{ x: number; y: number }>;
    rooms: Array<{ id: string; bed: { x: number; y: number }; beds: Array<{ x: number; y: number }> }>;
  } | null;
  snapshot: {
    seed: number;
    serverSeq: number;
    status: string;
    players: Array<{
      id: string;
      position: { x: number; y: number };
      gold: number;
      isBot: boolean;
      roomId: string | null;
      bedIndex: number | null;
    }>;
    buildings: Array<{ id: string; kind: string; tile: { x: number; y: number } }>;
    rooms: Array<{ doorHp: number; doorMaxHp: number }>;
    ghost: { hp: number };
  } | null;
  playerId: string;
  move: (dx: number, dy: number) => void;
  buildFirst: (kind: string) => boolean;
  cameraMode: () => "follow" | "free" | "none";
  cameraZoom: () => number;
  cameraYaw: () => number;
}

async function enter(
  page: Page,
  nickname: string,
  suffix: string,
  accelerated = true,
): Promise<string> {
  await page.goto(`/?dev=1&automation=1${accelerated ? "&e2e=1" : ""}`);
  await page.getByRole("button", { name: "새 계정" }).click();
  const username = `e2e${Date.now().toString(36)}${suffix}`.slice(0, 20);
  await page.getByLabel("아이디").fill(username);
  await page.getByLabel("게임 닉네임").fill(nickname);
  await page.getByRole("textbox", { name: "비밀번호" }).fill("midnight-test-2026");
  await page.getByRole("button", { name: "계정 만들고 시작" }).click();
  await expect(page.getByTestId("create-room")).toBeVisible();
  return username;
}

test("first launch teaser leads through login to the cinematic game home and mode select", async ({
  browser,
}) => {
  const context = await mobileContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/?dev=1&fresh=1");
    await expect(page.locator(".opening-teaser")).toBeVisible();
    await expect(page.getByRole("heading", { name: "심야 병동" })).toBeVisible();
    await page.getByRole("button", { name: "건너뛰기" }).click();
    await page.getByRole("button", { name: "새 계정" }).click();
    const passwordInput = page.getByRole("textbox", { name: "비밀번호" });
    await expect(page.getByLabel("아이디")).toHaveAttribute("autocapitalize", "off");
    await expect(passwordInput).toHaveAttribute("autocapitalize", "off");
    await expect(passwordInput).toHaveAttribute("autocorrect", "off");
    await expect(passwordInput).toHaveAttribute("spellcheck", "false");
    await expect(passwordInput).toHaveAttribute("inputmode", "email");
    const username = `intro${Date.now().toString(36)}`.slice(0, 20);
    const password = "midnight-test-2026";
    await page.getByLabel("아이디").fill(username);
    await page.getByLabel("게임 닉네임").fill("새벽도망자");
    await passwordInput.fill(password);
    await expect(passwordInput).toHaveValue(password);
    await page.getByRole("button", { name: "계정 만들고 시작" }).click();
    await expect(page.locator(".game-home")).toBeVisible();
    await expect(page.locator(".home-account")).toContainText("새벽도망자");
    await expect(page.locator(".home-account .rank-badge")).toBeVisible();
    const profileResponse = await page.request.get("/api/auth/me");
    expect(profileResponse).toBeOK();
    const profile = await profileResponse.json() as {
      profile: { customPoints: number; appearance: { character: string }; ownedCosmetics: string[] };
    };
    expect(profile.profile.customPoints).toBe(0);
    expect(profile.profile.appearance.character).toBe("character-bunny");
    expect(profile.profile.ownedCosmetics).toContain("hat-rank");
    expect((await page.request.post("/api/customize/purchase", { data: { itemId: "character-cat" } })).status()).toBe(409);
    expect((await page.request.post("/api/customize/equip", { data: { itemId: "character-bear" } })).status()).toBe(403);
    await page.getByRole("button", { name: /커스텀/ }).click();
    await expect(page.getByRole("heading", { name: "나만의 생존자" })).toBeVisible();
    const avatarCanvas = page.locator(".custom-avatar-canvas");
    await expect(avatarCanvas).toBeVisible();
    await expect(avatarCanvas).toHaveAttribute("data-avatar-view", "front");
    await expect(page.locator(".cosmetic-card")).toHaveCount(6);
    await page.locator(".cosmetic-card", { hasText: "달고양이 루루" }).click();
    await expect(page.locator("[data-custom-preview-title]")).toHaveText("달고양이 루루");
    await expect(page.locator("[data-custom-preview-copy]")).toContainText("포인트는 차감되지 않습니다");
    await page.getByRole("button", { name: "뒤", exact: true }).click();
    await expect(avatarCanvas).toHaveAttribute("data-avatar-view", "back");
    await avatarCanvas.tap();
    await expect(avatarCanvas).toHaveAttribute("data-preview-kind", "avatar");
    await page.getByRole("button", { name: "포탑", exact: true }).click();
    const turretCanvas = page.locator(".custom-avatar-canvas");
    await expect(turretCanvas).toHaveAttribute("data-preview-kind", "turret");
    await page.locator(".cosmetic-card", { hasText: "수호포 · 호박등" }).click();
    await expect(turretCanvas).toHaveAttribute("data-skin-id", "turret-basic-pumpkin");
    await expect(page.locator("[data-custom-preview-title]")).toHaveText("수호포 · 호박등");
    await page.getByRole("button", { name: "이전 화면" }).click();
    await expect(page.locator(".game-home")).toBeVisible();
    expect(await page.request.post("/api/auth/logout")).toBeOK();
    expect(await page.request.post("/api/auth/login", { data: { username, password } })).toBeOK();
    await page.getByRole("button", { name: "게임 시작" }).click();
    await expect(page.getByTestId("create-room")).toBeVisible();
    await expect(page.locator(".mode-poster")).toHaveCount(2);
  } finally {
    await context.close().catch(() => undefined);
  }
});

async function state(page: Page): Promise<TestState> {
  return page.evaluate(() => window.__DORM_TEST__ as unknown as TestState);
}

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
}

test("three solo bots visibly pathfind through doors before the normal countdown ends", async ({
  browser,
}) => {
  const context = await mobileContext(browser);
  const page = await context.newPage();
  try {
    await enter(page, "봇길검증", "p", false);
    await page.getByRole("button", { name: "봇과 혼자 시작" }).click();
    await expect(page.locator("[data-player-id]")).toHaveCount(4);
    await page.getByTestId("start-game").click();
    await expect(page.locator("#game-root canvas[data-theme='hospital']")).toBeVisible();
    await expect(page.locator(".stage-chip .rank-badge")).toBeVisible();
    await page.waitForFunction(
      () => {
        const snapshot = window.__DORM_TEST__?.snapshot;
        return (
          snapshot?.status === "COUNTDOWN" &&
          snapshot.players.filter((player) => player.isBot && player.roomId)
            .length === 3
        );
      },
      undefined,
      { timeout: 18_000 },
    );
    const snapshot = (await state(page)).snapshot;
    const bots = snapshot?.players.filter((player) => player.isBot) ?? [];
    expect(new Set(bots.map((bot) => bot.roomId)).size).toBe(3);
    expect(bots.every((bot) => bot.roomId && bot.position)).toBe(true);
    expect(await page.evaluate(() => window.__DORM_TEST__?.cameraMode())).toBe(
      "follow",
    );
    const initialYaw = await page.evaluate(() => window.__DORM_TEST__?.cameraYaw());
    await page.getByRole("button", { name: "카메라 확대" }).click();
    expect(await page.evaluate(() => window.__DORM_TEST__?.cameraZoom())).toBeCloseTo(Math.SQRT2, 1);
    await page.getByRole("button", { name: "카메라 오른쪽 회전" }).click();
    expect(await page.evaluate(() => window.__DORM_TEST__?.cameraYaw())).not.toBeCloseTo(initialYaw ?? 0, 3);

    await page.getByRole("button", { name: "설정" }).click();
    const vibration = page.locator("[data-vibration]");
    await expect(vibration).toHaveAttribute("aria-pressed", "true");
    await vibration.click();
    await expect(vibration).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "완료" }).click();

    const beforeReload = await state(page);
    const beforeGold =
      beforeReload.snapshot?.players.find(
        (player) => player.id === beforeReload.playerId,
      )?.gold ?? 0;
    await page.reload();
    await expect(page.getByTestId("network")).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(
      (id) => window.__DORM_TEST__?.playerId === id,
      beforeReload.playerId,
    );
    const goldSamples = [beforeGold];
    const sequenceSamples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      await page.waitForTimeout(250);
      const sample = await state(page);
      goldSamples.push(
        sample.snapshot?.players.find((player) => player.id === sample.playerId)
          ?.gold ?? 0,
      );
      sequenceSamples.push(sample.snapshot?.serverSeq ?? 0);
    }
    for (let index = 1; index < goldSamples.length; index += 1)
      expect(goldSamples[index]).toBeGreaterThanOrEqual(
        goldSamples[index - 1] as number,
      );
    for (let index = 1; index < sequenceSamples.length; index += 1)
      expect(sequenceSamples[index]).toBeGreaterThanOrEqual(
        sequenceSamples[index - 1] as number,
      );

    await page.getByRole("button", { name: "설정" }).click();
    await expect(page.locator("[data-vibration]")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const leave = page.getByTestId("leave-game");
    await leave.click();
    await expect(leave).toContainText("한 번 더");
    await leave.click();
    await expect(page.getByTestId("create-room")).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("lobby host can remove bots, transfer ownership, kick a player and close an empty room", async ({ browser }) => {
  const firstContext = await mobileContext(browser);
  const secondContext = await mobileContext(browser);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await enter(first, "교대방장", "host");
    await first.getByTestId("create-room").click();
    const code = (await first.getByTestId("room-code").textContent()) as string;

    await first.getByRole("button", { name: "봇 추가" }).click();
    await expect(first.getByRole("button", { name: "봇 제거" })).toBeVisible();
    await first.getByRole("button", { name: "봇 제거" }).click();
    await expect(first.locator(".player-card", { hasText: "서버 생존자 봇" })).toHaveCount(0);

    await enter(second, "다음방장", "guest");
    await second.getByLabel("초대 코드로 참가").fill(code);
    await second.getByTestId("join-room").click();
    await expect(first.locator("[data-player-id]")).toHaveCount(2);

    await first.getByRole("button", { name: "방 나가기" }).click();
    await expect(first.getByTestId("create-room")).toBeVisible();
    await expect(second.locator(".player-card", { hasText: "다음방장" })).toContainText("★");

    await first.getByLabel("초대 코드로 참가").fill(code);
    await first.getByTestId("join-room").click();
    await expect(second.getByRole("button", { name: "추방" })).toBeVisible();
    await second.getByRole("button", { name: "추방" }).click();
    await expect(first.getByTestId("create-room")).toBeVisible();
    await expect(first.locator("#toast")).toContainText("방장에 의해");

    await second.getByRole("button", { name: "방 나가기" }).click();
    await expect(second.getByTestId("create-room")).toBeVisible();
    expect((await second.request.get(`/api/rooms/${code}/status`)).status()).toBe(404);
  } finally {
    await firstContext.close().catch(() => undefined);
    await secondContext.close().catch(() => undefined);
  }
});

test("two real browser contexts share a room, building, combat and reconnection", async ({
  browser,
}) => {
  const firstContext = await mobileContext(browser);
  const secondContext = await mobileContext(browser);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  try {
    const firstUsername = await enter(first, "별빛하나", "a");
    await first.getByTestId("create-room").click();
    const code = await first.getByTestId("room-code").textContent();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    await enter(second, "별빛둘", "b");
    await second.getByLabel("초대 코드로 참가").fill(code as string);
    await second.getByTestId("join-room").click();
    await expect(first.locator("[data-player-id]")).toHaveCount(2);
    await expect(second.locator("[data-player-id]")).toHaveCount(2);

    await second.getByRole("button", { name: "준비", exact: true }).click();
    await expect(
      first.locator(".player-card", { hasText: "별빛둘" }),
    ).toContainText("READY");
    await first.getByTestId("start-game").click();
    await Promise.all([
      expect.poll(async () => (await state(first)).snapshot?.status, { timeout: 15_000, intervals: [100] }).toBe("PLAYING"),
      expect.poll(async () => (await state(second)).snapshot?.status, { timeout: 15_000, intervals: [100] }).toBe("PLAYING"),
    ]);
    await Promise.all([
      expect(first.getByTestId("network")).toBeVisible(),
      expect(second.getByTestId("network")).toBeVisible(),
    ]);
    await expect.poll(
      async () => first.evaluate(() => window.__DORM_TEST__?.cameraMode()),
      { timeout: 5_000, intervals: [100] },
    ).toBe("free");

    const firstState = await state(first);
    const secondState = await state(second);
    expect(firstState.snapshot?.seed).toBe(secondState.snapshot?.seed);
    expect(firstState.snapshot?.players).toHaveLength(2);
    const roommates = firstState.snapshot?.players ?? [];
    expect(roommates[0]?.roomId).toBe(roommates[1]?.roomId);
    expect(roommates[0]?.bedIndex).not.toBe(roommates[1]?.bedIndex);

    const movingId = firstState.playerId;
    const goldBefore =
      firstState.snapshot?.players.find((player) => player.id === movingId)
        ?.gold ?? 0;
    expect(
      await first.evaluate(() =>
        window.__DORM_TEST__?.buildFirst("basic-turret"),
      ),
    ).toBe(true);
    await expect.poll(
      async () => (await state(second)).snapshot?.buildings.length ?? 0,
      { timeout: 5_000, intervals: [50] },
    ).toBeGreaterThanOrEqual(1);
    const builtFirst = await state(first);
    const builtSecond = await state(second);
    expect(builtFirst.snapshot?.buildings.length).toBe(
      builtSecond.snapshot?.buildings.length,
    );
    expect(
      builtFirst.snapshot?.players.find((player) => player.id === movingId)
        ?.gold ?? goldBefore,
    ).toBeLessThan(goldBefore);

    await first.waitForTimeout(400);
    const beforeRapidBuilds = (await state(first)).snapshot?.buildings.length ?? 0;
    await first.evaluate(() => {
      window.__DORM_TEST__?.buildFirst("generator");
      window.__DORM_TEST__?.buildFirst("floor-trap");
    });
    await expect.poll(
      async () => (await state(first)).snapshot?.buildings.length ?? 0,
      { timeout: 5_000, intervals: [50] },
    ).toBe(beforeRapidBuilds + 1);
    await first.waitForTimeout(500);
    const afterRapidBuilds = await state(first);
    expect(afterRapidBuilds.snapshot?.buildings).toHaveLength(beforeRapidBuilds + 1);
    expect(afterRapidBuilds.snapshot?.buildings.at(-1)?.kind).toBe("generator");

    const secondId = (await state(second)).playerId;
    await second.reload();
    await expect(second.getByTestId("network")).toBeVisible({
      timeout: 20_000,
    });
    await second.waitForFunction(
      (id) => window.__DORM_TEST__?.playerId === id,
      secondId,
    );
    expect((await state(second)).playerId).toBe(secondId);

    const occupiedPlayer = secondState.snapshot?.players.find(
      (player) => player.id === movingId,
    );
    const occupiedBed = secondState.map?.rooms.find(
      (room) => room.id === occupiedPlayer?.roomId,
    )?.beds[occupiedPlayer?.bedIndex ?? 0];
    expect(occupiedPlayer?.position).toEqual(occupiedBed);
    await first.evaluate(() => window.__DORM_TEST__?.move(1, 1));
    await first.waitForTimeout(500);
    await first.evaluate(() => window.__DORM_TEST__?.move(0, 0));
    const afterMoveAttempt = (await state(second)).snapshot?.players.find(
      (player) => player.id === movingId,
    );
    expect(afterMoveAttempt?.position).toEqual(occupiedBed);

    await Promise.all([
      expect.poll(
        async () => (await state(first)).snapshot?.rooms.some((room) => room.doorHp < room.doorMaxHp),
        { timeout: 35_000, intervals: [100] },
      ).toBe(true),
      expect.poll(
        async () => (await state(second)).snapshot?.rooms.some((room) => room.doorHp < room.doorMaxHp),
        { timeout: 35_000, intervals: [100] },
      ).toBe(true),
    ]);
    const [combatFirst, combatSecond] = await Promise.all([
      state(first),
      state(second),
    ]);
    expect(
      Math.abs(
        (combatFirst.snapshot?.serverSeq ?? 0) -
          (combatSecond.snapshot?.serverSeq ?? 0),
      ),
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        (combatFirst.snapshot?.ghost.hp ?? 0) -
          (combatSecond.snapshot?.ghost.hp ?? 0),
      ),
    // 10Hz 스냅샷 경계에서 한 클라이언트만 1발(기본 피해 13)을 먼저 볼 수 있다.
    ).toBeLessThanOrEqual(13);

    await expect(first.getByTestId("rematch")).toBeVisible({ timeout: 45_000 });
    await expect(second.getByTestId("rematch")).toBeVisible({
      timeout: 45_000,
    });

    await second.reload();
    await expect(second.getByTestId("create-room")).toBeVisible();

    const manifest = await first.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).display).toBe("fullscreen");

    await first.goto("/?dev=1&fresh=1&automation=1");
    await expect(first.getByTestId("create-room")).toBeVisible();
    await first.getByRole("button", { name: "로그아웃" }).click();
    await first.getByLabel("아이디").fill(firstUsername);
    await first.getByRole("textbox", { name: "비밀번호" }).fill("midnight-test-2026");
    await first.getByRole("button", { name: "로그인하고 시작" }).click();
    await expect(first.getByTestId("create-room")).toBeVisible();
  } finally {
    await firstContext.close().catch(() => undefined);
    await secondContext.close().catch(() => undefined);
  }
});
