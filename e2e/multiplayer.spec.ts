import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface TestState {
  map: { walkable: Array<{ x: number; y: number }> } | null;
  snapshot: {
    seed: number;
    status: string;
    players: Array<{ id: string; position: { x: number; y: number }; gold: number }>;
    buildings: unknown[];
    rooms: Array<{ doorHp: number; doorMaxHp: number }>;
    ghost: { hp: number };
  } | null;
  playerId: string;
  move: (dx: number, dy: number) => void;
  buildFirst: (kind: string) => boolean;
}

async function enter(page: Page, nickname: string): Promise<void> {
  await page.goto('/?dev=1&e2e=1');
  await page.getByLabel('생존자 닉네임').fill(nickname);
  await page.getByRole('button', { name: '기숙사 입장' }).click();
}

async function state(page: Page): Promise<TestState> {
  return page.evaluate(() => window.__DORM_TEST__ as unknown as TestState);
}

async function mobileContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
}

test('two real browser contexts share movement, building, combat and reconnection', async ({ browser }) => {
  const firstContext = await mobileContext(browser);
  const secondContext = await mobileContext(browser);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  try {
    await enter(first, '별빛하나');
    await first.getByTestId('create-room').click();
    const code = await first.getByTestId('room-code').textContent();
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    await enter(second, '별빛둘');
    await second.getByLabel('초대 코드로 참가').fill(code as string);
    await second.getByTestId('join-room').click();
    await expect(first.locator('[data-player-id]')).toHaveCount(2);
    await expect(second.locator('[data-player-id]')).toHaveCount(2);

    await second.getByRole('button', { name: '준비', exact: true }).click();
    await expect(first.locator('.player-card', { hasText: '별빛둘' })).toContainText('READY');
    await first.getByTestId('start-game').click();
    await expect(first.getByTestId('network')).toBeVisible();
    await expect(second.getByTestId('network')).toBeVisible();
    await first.waitForFunction(() => window.__DORM_TEST__?.snapshot?.status === 'PLAYING');
    await second.waitForFunction(() => window.__DORM_TEST__?.snapshot?.status === 'PLAYING');

    const firstState = await state(first);
    const secondState = await state(second);
    expect(firstState.snapshot?.seed).toBe(secondState.snapshot?.seed);
    expect(firstState.snapshot?.players).toHaveLength(2);

    const movingId = firstState.playerId;
    const beforePosition = secondState.snapshot?.players.find((player) => player.id === movingId)?.position ?? { x: 0, y: 0 };
    await first.evaluate(() => {
      const state = window.__DORM_TEST__;
      const player = state?.snapshot?.players.find((candidate) => candidate.id === state.playerId);
      const directions = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
      const direction = directions.find((candidate) => state?.map?.walkable.some((tile) => tile.x === Math.round((player?.position.x ?? 0) + candidate.x) && tile.y === Math.round((player?.position.y ?? 0) + candidate.y)));
      if (direction) state?.move(direction.x, direction.y);
    });
    await second.waitForFunction(({ id, position }) => {
      const player = window.__DORM_TEST__?.snapshot?.players.find((candidate) => candidate.id === id);
      return Boolean(player && Math.hypot(player.position.x - position.x, player.position.y - position.y) > 0.08);
    }, { id: movingId, position: beforePosition }, { timeout: 10_000 });
    await first.evaluate(() => window.__DORM_TEST__?.move(0, 0));

    const goldBefore = (await state(first)).snapshot?.players.find((player) => player.id === movingId)?.gold ?? 0;
    expect(await first.evaluate(() => window.__DORM_TEST__?.buildFirst('basic-turret'))).toBe(true);
    await second.waitForFunction(() => (window.__DORM_TEST__?.snapshot?.buildings.length ?? 0) >= 1);
    const builtFirst = await state(first);
    const builtSecond = await state(second);
    expect(builtFirst.snapshot?.buildings.length).toBe(builtSecond.snapshot?.buildings.length);
    expect((builtFirst.snapshot?.players.find((player) => player.id === movingId)?.gold ?? goldBefore)).toBeLessThan(goldBefore);

    await first.waitForFunction(() => window.__DORM_TEST__?.snapshot?.rooms.some((room) => room.doorHp < room.doorMaxHp), undefined, { timeout: 35_000 });
    await second.waitForFunction(() => window.__DORM_TEST__?.snapshot?.rooms.some((room) => room.doorHp < room.doorMaxHp), undefined, { timeout: 35_000 });
    const combatFirst = await state(first);
    const combatSecond = await state(second);
    expect(combatFirst.snapshot?.ghost.hp).toBe(combatSecond.snapshot?.ghost.hp);

    const secondId = (await state(second)).playerId;
    await second.reload();
    await expect(second.getByTestId('network')).toBeVisible({ timeout: 20_000 });
    await second.waitForFunction((id) => window.__DORM_TEST__?.playerId === id, secondId);
    expect((await state(second)).playerId).toBe(secondId);

    await expect(first.getByTestId('rematch')).toBeVisible({ timeout: 45_000 });
    await expect(second.getByTestId('rematch')).toBeVisible({ timeout: 45_000 });

    const manifest = await first.request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBe(true);
    expect((await manifest.json()).display).toBe('fullscreen');
  } finally {
    await firstContext.close().catch(() => undefined);
    await secondContext.close().catch(() => undefined);
  }
});
