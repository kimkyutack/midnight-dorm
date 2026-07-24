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
    rooms: Array<{
      id: string;
      bed: { x: number; y: number };
      beds: Array<{ x: number; y: number }>;
    }>;
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
    buildings: Array<{
      id: string;
      kind: string;
      tile: { x: number; y: number };
    }>;
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
  await page
    .getByRole("textbox", { name: "비밀번호" })
    .fill("midnight-test-2026");
  await page.getByRole("button", { name: "계정 만들고 시작" }).click();
  await expect(page.locator(".game-home")).toBeVisible();
  return username;
}

async function createMultiplayerRoom(page: Page): Promise<void> {
  await page.getByRole("button", { name: /플레이 방식/ }).click();
  await page.getByRole("button", { name: /친구랑하기/ }).click();
  await page.getByTestId("home-stage-start").click();
}

async function joinMultiplayerRoom(page: Page, code: string): Promise<void> {
  await page.getByRole("button", { name: /플레이 방식/ }).click();
  await page.getByLabel("친구 방 초대 코드").fill(code);
  await page.getByRole("button", { name: "참가", exact: true }).click();
}

test("portrait home separates shop, owned customization and stage start", async ({
  browser,
}) => {
  const context = await portraitContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/?dev=1&fresh=1");
    await expect(page.locator(".opening-teaser")).toBeVisible();
    const skipOpening = page.getByRole("button", { name: "건너뛰기" });
    await expect(skipOpening).toBeVisible();
    await skipOpening.click();
    await page.getByRole("button", { name: "새 계정" }).click();
    const passwordInput = page.getByRole("textbox", { name: "비밀번호" });
    await expect(page.getByLabel("아이디")).toHaveAttribute(
      "autocapitalize",
      "off",
    );
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
    await expect(page.locator(".game-home h1")).toHaveCount(0);
    await expect(page.locator(".home-footer-nav .home-nav-icon")).toHaveCount(
      3,
    );
    await expect(page.locator("[data-home-logout]")).toHaveCount(0);
    const avatarBounds = await page
      .locator(".home-avatar-showcase")
      .boundingBox();
    expect(avatarBounds).toBeTruthy();
    expect(avatarBounds?.width ?? 999).toBeLessThanOrEqual(330);
    const homeAvatar = page.locator(".home-avatar-model .avatar-sprite-preview");
    await expect(homeAvatar).toHaveAttribute("data-character", "character-bunny");
    await expect(homeAvatar).toHaveAttribute("data-skin", "skin-basic-bunny");
    await expect(page.locator(".home-avatar-model canvas")).toBeVisible();
    await expect(page.locator(".home-chase-ghost")).toHaveCount(0);
    expect(
      await page
        .locator(".home-avatar-showcase")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    const summaryLayout = await page
      .locator(".home-stage-summary small")
      .evaluate((summary) => ({
        overflow: getComputedStyle(summary).overflow,
        whitespace: getComputedStyle(summary).whiteSpace,
      }));
    expect(summaryLayout.overflow).toBe("visible");
    expect(summaryLayout.whitespace).toBe("normal");
    await expect(
      page.locator("[data-ranking] .home-utility-icon"),
    ).toBeVisible();
    await page.getByRole("button", { name: "스테이지 난이도 선택" }).click();
    await expect(
      page.getByRole("dialog", { name: "도전할 스테이지" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "닫기" }).click();
    await page.getByRole("button", { name: "설정" }).click();
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
    await page.getByRole("button", { name: "완료" }).click();
    const profileResponse = await page.request.get("/api/auth/me");
    expect(profileResponse).toBeOK();
    const profile = (await profileResponse.json()) as {
      profile: {
        customPoints: number;
        appearance: { character: string };
        ownedCosmetics: string[];
      };
    };
    expect(profile.profile.customPoints).toBe(0);
    expect(profile.profile.appearance.character).toBe("character-bunny");
    expect(profile.profile.ownedCosmetics).toContain("character-bunny");
    expect(
      (
        await page.request.post("/api/customize/purchase", {
          data: { itemId: "character-cat" },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await page.request.post("/api/customize/equip", {
          data: { itemId: "character-bear" },
        })
      ).status(),
    ).toBe(403);
    await expect(page.locator("#orientation-lock")).toHaveCount(0);
    await page.getByRole("button", { name: /상점/ }).click();
    await expect(
      page.getByRole("heading", { name: "외형 상점" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "앞", exact: true }),
    ).toHaveClass(/active/);
    await expect(page.locator(".cosmetic-card")).toHaveCount(12);
    const catCard = page.locator(".cosmetic-card", { hasText: "달고양이 루루" });
    await expect(catCard.locator("img")).toHaveAttribute(
      "src",
      /\/assets\/paperdoll\/bases\/character-cat\/concept\.png$/,
    );
    await catCard.click();
    await expect(page.locator("[data-custom-preview-title]")).toHaveText(
      "달고양이 루루",
    );
    await page.getByRole("button", { name: "스킨", exact: true }).click();
    await expect(page.locator(".cosmetic-card")).toHaveCount(12);
    const bunnySkinCard = page.locator(".cosmetic-card", { hasText: "탐험가 모모" });
    await expect(bunnySkinCard.locator("img")).toHaveAttribute(
      "src",
      /\/assets\/sprites\/survivors\/character-bunny\/concept\.png$/,
    );
    await expect(bunnySkinCard.getByRole("button", { name: "100 P" })).toBeEnabled();
    const lockedCatSkin = page.locator(".cosmetic-card", {
      hasText: "새벽 탐정 루루",
    });
    await expect(
      lockedCatSkin.getByRole("button", { name: "캐릭터 구매 필요" }),
    ).toBeDisabled();
    await lockedCatSkin.click();
    await expect(page.locator(".skin-preview-canvas")).toHaveAttribute(
      "data-skin-id",
      "skin-look-cat-ward",
    );
    await expect(
      page.getByRole("button", { name: "포탑", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "이전 화면" }).click();
    await page.getByRole("button", { name: /커스텀/ }).click();
    await expect(page.getByRole("heading", { name: "스킨 보관함" })).toBeVisible();
    const avatarCanvas = page.locator(".skin-preview-canvas");
    await expect(avatarCanvas).toBeVisible();
    await expect(avatarCanvas).toHaveAttribute("data-avatar-view", "front");
    await expect(page.locator(".cosmetic-card")).toHaveCount(1);
    await expect(
      page.locator(".cosmetic-card", { hasText: "달고양이 루루" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "앞", exact: true }),
    ).toHaveClass(/active/);
    await page.getByRole("button", { name: "스킨", exact: true }).click();
    await expect(page.locator(".cosmetic-card")).toHaveCount(0);
    await expect(page.locator(".empty-collection")).toContainText("완성형 스킨");
    await page.getByRole("button", { name: "뒤", exact: true }).click();
    await expect(avatarCanvas).toHaveAttribute("data-avatar-view", "back");
    await expect(avatarCanvas).toHaveAttribute("data-preview-kind", "avatar");
    await page.getByRole("button", { name: "이전 화면" }).click();
    await expect(page.locator(".game-home")).toBeVisible();
    expect(await page.request.post("/api/auth/logout")).toBeOK();
    expect(
      await page.request.post("/api/auth/login", {
        data: { username, password },
      }),
    ).toBeOK();
    await page.getByRole("button", { name: /플레이 방식/ }).click();
    await expect(
      page.getByRole("dialog", { name: "플레이 방식 선택" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /친구랑하기/ }).click();
    await expect(
      page.getByRole("button", { name: /플레이 방식 친구랑하기/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /플레이 방식/ }).click();
    await page.locator("[data-home-mode='solo']").click();
    await page.getByTestId("home-stage-start").click();
    await expect(page.locator(".lobby-screen")).toBeVisible();
    const lobbyLayout = await page.locator(".lobby-shell").evaluate((shell) => {
      const stage = shell.querySelector(".lobby-stage");
      const content = shell.querySelector(".lobby-content");
      const players = shell.querySelector(".players");
      const first = shell.querySelector(".player-card");
      return {
        stageTextAlign: stage ? getComputedStyle(stage).textAlign : "",
        contentWidth: content?.getBoundingClientRect().width ?? 0,
        playersWidth: players?.getBoundingClientRect().width ?? 0,
        firstHeight: first?.getBoundingClientRect().height ?? 0,
        faces: shell.querySelectorAll(".player-card .player-face").length,
        legacyDots: shell.querySelectorAll(".player-card .player-dot").length,
      };
    });
    expect(lobbyLayout.stageTextAlign).toBe("center");
    expect(lobbyLayout.playersWidth).toBeGreaterThanOrEqual(
      lobbyLayout.contentWidth - 1,
    );
    expect(lobbyLayout.firstHeight).toBeLessThanOrEqual(62);
    expect(lobbyLayout.faces).toBeGreaterThan(0);
    expect(lobbyLayout.legacyDots).toBe(0);
    await page.getByTestId("start-game").click();
    await expect(page.locator("#game-shell")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "내 캐릭터 위치로 카메라 이동" }),
    ).toBeVisible();
    await expect(page.locator(".portrait-drag-hint")).toBeVisible();
    const beforeDrag = await state(page);
    const localBefore = beforeDrag.snapshot?.players.find(
      (player) => player.id === beforeDrag.playerId,
    )?.position;
    expect(localBefore).toBeTruthy();
    await page.mouse.move(195, 422);
    await page.mouse.down();
    await page.mouse.move(250, 365, { steps: 6 });
    await page.waitForTimeout(260);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const afterDrag = await state(page);
        const localAfter = afterDrag.snapshot?.players.find(
          (player) => player.id === afterDrag.playerId,
        )?.position;
        return localAfter && localBefore
          ? Math.hypot(
              localAfter.x - localBefore.x,
              localAfter.y - localBefore.y,
            )
          : 0;
      })
      .toBeGreaterThan(0.08);
  } finally {
    await context.close().catch(() => undefined);
  }
});

async function state(page: Page): Promise<TestState> {
  return page.evaluate(() => window.__DORM_TEST__ as unknown as TestState);
}

async function nearestSharedRoom(page: Page): Promise<{ roomId: string }> {
  const roomId = await page.evaluate(() => {
    const game = window.__DORM_TEST__;
    const map = game?.map;
    const player = game?.snapshot?.players.find((candidate) => candidate.id === game.playerId);
    if (!map || !player) return null;
    const walkable = new Set(map.walkable.map((tile) => `${tile.x},${tile.y}`));
    const start = { x: Math.round(player.position.x), y: Math.round(player.position.y) };
    const distances = new Map<string, number>([[`${start.x},${start.y}`, 0]]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index] as { x: number; y: number };
      const distance = distances.get(`${current.x},${current.y}`) ?? 0;
      for (const [dx = 0, dy = 0] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: current.x + dx, y: current.y + dy };
        const key = `${next.x},${next.y}`;
        if (!walkable.has(key) || distances.has(key)) continue;
        distances.set(key, distance + 1);
        queue.push(next);
      }
    }
    return map.rooms
      .map((room) => ({
        id: room.id,
        distance: Math.min(...room.beds.map((bed) => distances.get(`${bed.x},${bed.y}`) ?? Infinity)),
      }))
      .filter((room) => Number.isFinite(room.distance))
      .sort((left, right) => left.distance - right.distance)[0]?.id ?? null;
  });
  if (!roomId) throw new Error('reachable shared room was not found');
  return { roomId };
}

async function sleepInBed(page: Page, roomId: string, bedIndex: number): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(({ targetRoomId, targetBedIndex }) => {
          const game = window.__DORM_TEST__;
          const map = game?.map;
          const player = game?.snapshot?.players.find((candidate) => candidate.id === game.playerId);
          const bed = map?.rooms.find(
            (candidate) => candidate.id === targetRoomId,
          )?.beds[targetBedIndex];
          if (!game || !map || !player || !bed) return Infinity;
          const distance = Math.hypot(player.position.x - bed.x, player.position.y - bed.y);
          if (distance <= 1.25) {
            game.move(0, 0);
            return distance;
          }
          const start = { x: Math.round(player.position.x), y: Math.round(player.position.y) };
          const targetKey = `${bed.x},${bed.y}`;
          const walkable = new Set(map.walkable.map((tile) => `${tile.x},${tile.y}`));
          const previous = new Map<string, string | null>([[`${start.x},${start.y}`, null]]);
          const queue = [start];
          for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index] as { x: number; y: number };
            const currentKey = `${current.x},${current.y}`;
            if (currentKey === targetKey) break;
            for (const [dx = 0, dy = 0] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const next = { x: current.x + dx, y: current.y + dy };
              const key = `${next.x},${next.y}`;
              if (!walkable.has(key) || previous.has(key)) continue;
              previous.set(key, currentKey);
              queue.push(next);
            }
          }
          if (!previous.has(targetKey)) return Infinity;
          const route: Array<{ x: number; y: number }> = [];
          for (let key: string | null = targetKey; key; key = previous.get(key) ?? null) {
            const [x, y] = key.split(',').map(Number);
            route.push({ x: x as number, y: y as number });
          }
          const waypoint = route.reverse()[1] ?? bed;
          const dx = waypoint.x - player.position.x;
          const dy = waypoint.y - player.position.y;
          const magnitude = Math.hypot(dx, dy) || 1;
          game.move(dx / magnitude, dy / magnitude);
          return distance;
        }, { targetRoomId: roomId, targetBedIndex: bedIndex }),
      { timeout: 12_000, intervals: [100] },
    )
    .toBeLessThanOrEqual(1.25);
  await page.evaluate(() => {
    window.__DORM_TEST__?.move(0, 0);
    window.__DORM_TEST__?.interact();
  });
}

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
}

async function portraitContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
}

async function desktopCompatPortraitContext(
  browser: Browser,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 980, height: 2394 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
}

test("desktop-site portrait viewport keeps the 390px mobile layout", async ({
  browser,
}) => {
  const context = await desktopCompatPortraitContext(browser);
  const page = await context.newPage();
  try {
    await page.goto("/?dev=1&fresh=1&e2e=1");
    await expect(page.locator("html")).toHaveClass(/mobile-viewport-compat/);
    const layout = await page.evaluate(() => ({
      appWidth: document.querySelector<HTMLElement>("#app")?.clientWidth,
      appHeight: document.querySelector<HTMLElement>("#app")?.clientHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      zoom: Number.parseFloat(getComputedStyle(document.documentElement).zoom),
    }));
    expect(layout.appWidth).toBe(390);
    expect(layout.appHeight).toBeCloseTo(2394 / (980 / 390), 0);
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.zoom).toBeCloseTo(980 / 390, 4);
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("three solo bots visibly pathfind through doors before the normal countdown ends", async ({
  browser,
}) => {
  const context = await mobileContext(browser);
  const page = await context.newPage();
  try {
    await enter(page, "봇길검증", "p", false);
    await page.getByTestId("home-stage-start").click();
    await expect(page.getByTestId("room-code")).toHaveCount(0);
    await expect(page.locator("[data-player-id]")).toHaveCount(4);
    await page.getByTestId("start-game").click();
    await expect(
      page.locator("#game-root canvas[data-theme='hospital']"),
    ).toBeVisible();
    await expect(page.locator(".stage-chip .rank-badge")).toHaveCount(1);
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
      { timeout: 28_000 },
    );
    const snapshot = (await state(page)).snapshot;
    const bots = snapshot?.players.filter((player) => player.isBot) ?? [];
    expect(new Set(bots.map((bot) => bot.roomId)).size).toBe(3);
    expect(bots.every((bot) => bot.roomId && bot.position)).toBe(true);
    expect(await page.evaluate(() => window.__DORM_TEST__?.cameraMode())).toBe(
      "follow",
    );
    await page.getByRole("button", { name: "카메라 확대" }).click();
    expect(
      await page.evaluate(() => window.__DORM_TEST__?.cameraZoom()),
    ).toBeCloseTo(Math.SQRT2, 1);
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
    await expect(page.locator(".game-home")).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
  }
});

test("lobby host can remove bots, transfer ownership, kick a player and close an empty room", async ({
  browser,
}) => {
  const firstContext = await mobileContext(browser);
  const secondContext = await mobileContext(browser);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    await enter(first, "교대방장", "host");
    await createMultiplayerRoom(first);
    const code = (await first.getByTestId("room-code").textContent()) as string;

    await first.getByRole("button", { name: "봇 추가" }).click();
    await expect(first.getByRole("button", { name: "봇 제거" })).toBeVisible();
    await first.getByRole("button", { name: "봇 제거" }).click();
    await expect(
      first.locator(".player-card", { hasText: "서버 생존자 봇" }),
    ).toHaveCount(0);

    await enter(second, "다음방장", "guest");
    await joinMultiplayerRoom(second, code);
    await expect(first.locator("[data-player-id]")).toHaveCount(2);

    await first.getByRole("button", { name: "방 나가기" }).click();
    await expect(first.locator(".game-home")).toBeVisible();
    await expect(
      second.locator(".player-card", { hasText: "다음방장" }),
    ).toContainText("★");

    await joinMultiplayerRoom(first, code);
    await expect(second.getByRole("button", { name: "추방" })).toBeVisible();
    await second.getByRole("button", { name: "추방" }).click();
    await expect(first.locator(".game-home")).toBeVisible();
    await expect(first.locator("#toast")).toContainText("방장에 의해");

    await second.getByRole("button", { name: "방 나가기" }).click();
    await expect(second.locator(".game-home")).toBeVisible();
    expect(
      (await second.request.get(`/api/rooms/${code}/status`)).status(),
    ).toBe(404);
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
    await createMultiplayerRoom(first);
    const code = await first.getByTestId("room-code").textContent();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    await enter(second, "별빛둘", "b");
    await joinMultiplayerRoom(second, code as string);
    await expect(first.locator("[data-player-id]")).toHaveCount(2);
    await expect(second.locator("[data-player-id]")).toHaveCount(2);

    await second.getByRole("button", { name: "준비", exact: true }).click();
    await expect(
      first.locator(".player-card", { hasText: "별빛둘" }),
    ).toContainText("READY");
    await first.getByTestId("start-game").click();
    await Promise.all([
      expect
        .poll(async () => (await state(first)).snapshot?.status, {
          timeout: 15_000,
          intervals: [100],
        })
        .toBe("PLAYING"),
      expect
        .poll(async () => (await state(second)).snapshot?.status, {
          timeout: 15_000,
          intervals: [100],
        })
        .toBe("PLAYING"),
    ]);
    await Promise.all([
      expect(first.getByTestId("network")).toBeVisible(),
      expect(second.getByTestId("network")).toBeVisible(),
    ]);
    await expect(first.getByRole("button", { name: "침대 점유" })).toBeHidden();
    await expect
      .poll(
        async () => first.evaluate(() => window.__DORM_TEST__?.cameraMode()),
        { timeout: 5_000, intervals: [100] },
      )
      .toBe("follow");

    const firstState = await state(first);
    const secondState = await state(second);
    expect(firstState.snapshot?.seed).toBe(secondState.snapshot?.seed);
    expect(firstState.snapshot?.players).toHaveLength(2);
    const { roomId } = await nearestSharedRoom(first);
    await Promise.all([
      sleepInBed(first, roomId, 0),
      sleepInBed(second, roomId, 1),
    ]);
    await expect
      .poll(async () => (await state(first)).snapshot?.players.every((player) => player.roomId === roomId), {
        timeout: 12_000,
        intervals: [100],
      })
      .toBe(true);
    const roommates = (await state(first)).snapshot?.players ?? [];
    expect(roommates[0]?.bedIndex).not.toBeNull();
    expect(roommates[1]?.bedIndex).not.toBeNull();
    expect(roommates[0]?.bedIndex).not.toBe(roommates[1]?.bedIndex);

    const movingId = firstState.playerId;
    const goldBefore =
      (await state(first)).snapshot?.players.find((player) => player.id === movingId)
        ?.gold ?? 0;
    expect(
      await first.evaluate(() =>
        window.__DORM_TEST__?.buildFirst("basic-turret"),
      ),
    ).toBe(true);
    await expect
      .poll(async () => (await state(second)).snapshot?.buildings.length ?? 0, {
        timeout: 5_000,
        intervals: [50],
      })
      .toBeGreaterThanOrEqual(1);
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
    const beforeRapidBuilds =
      (await state(first)).snapshot?.buildings.length ?? 0;
    await first.evaluate(() => {
      window.__DORM_TEST__?.buildFirst("basic-turret");
      window.__DORM_TEST__?.buildFirst("basic-turret");
    });
    await expect
      .poll(async () => (await state(first)).snapshot?.buildings.length ?? 0, {
        timeout: 5_000,
        intervals: [50],
      })
      .toBe(beforeRapidBuilds + 1);
    await first.waitForTimeout(500);
    const afterRapidBuilds = await state(first);
    expect(afterRapidBuilds.snapshot?.buildings).toHaveLength(
      beforeRapidBuilds + 1,
    );
    expect(afterRapidBuilds.snapshot?.buildings.at(-1)?.kind).toBe("basic-turret");

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

    const occupiedPlayer = (await state(second)).snapshot?.players.find(
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
      expect
        .poll(
          async () =>
            (await state(first)).snapshot?.rooms.some(
              (room) => room.doorHp < room.doorMaxHp,
            ),
          { timeout: 35_000, intervals: [100] },
        )
        .toBe(true),
      expect
        .poll(
          async () =>
            (await state(second)).snapshot?.rooms.some(
              (room) => room.doorHp < room.doorMaxHp,
            ),
          { timeout: 35_000, intervals: [100] },
        )
        .toBe(true),
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
    await expect(second.locator(".game-home")).toBeVisible();

    const manifest = await first.request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).display).toBe("fullscreen");

    await first.goto("/?dev=1&fresh=1&automation=1");
    await expect(first.locator(".game-home")).toBeVisible();
    await first.getByRole("button", { name: "설정" }).click();
    await first.getByRole("button", { name: "로그아웃" }).click();
    await first.getByLabel("아이디").fill(firstUsername);
    await first
      .getByRole("textbox", { name: "비밀번호" })
      .fill("midnight-test-2026");
    await first.getByRole("button", { name: "로그인하고 시작" }).click();
    await expect(first.locator(".game-home")).toBeVisible();
  } finally {
    await firstContext.close().catch(() => undefined);
    await secondContext.close().catch(() => undefined);
  }
});
