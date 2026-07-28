/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = '2026.07.28.2';

export interface AppUpdate {
  version: string;
  title: string;
  summary: string;
  publishedAt: number;
}

// Used as a safe fallback while a newly deployed Worker is waiting for its D1
// migration. The D1 record remains the source of truth once it is available.
export const CURRENT_APP_UPDATE: AppUpdate = {
  version: APP_RELEASE_VERSION,
  title: '구름강아지 몽 신규 스킨: 서퍼 몽',
  summary: '• 하늘빛 고글과 서핑보드를 갖춘 서퍼 몽 스킨을 추가했습니다.\n• 서퍼 몽은 구름강아지 몽의 골드 특성을 200% 효율로 적용하며 3,000P에 구매할 수 있습니다.\n• 이동할 때 걷지 않고 보드 아래 물결이 찰랑이는 전용 활주 모션을 사용합니다.\n• 상점과 내 보관함에 파도 배경, NEW 뱃지, 하늘빛 프리미엄 카드 연출을 적용했습니다.',
  publishedAt: 1785218400000,
};

export const isUpdateAvailable = (currentVersion: string, latestVersion?: string | null): boolean =>
  Boolean(latestVersion && latestVersion !== currentVersion);
