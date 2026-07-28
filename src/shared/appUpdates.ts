/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = '2026.07.28.3';

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
  title: '서퍼 몽 여름 출시 이벤트',
  summary: '• 홈에 처음 들어오면 서퍼 몽 출시 이벤트 팝업을 표시합니다.\n• 구매하러 가기를 누르면 외형 상점의 스킨 탭과 서퍼 몽 미리보기가 바로 열립니다.\n• 다시 보지 않기를 선택하면 같은 기기에서 이벤트 팝업을 더 이상 표시하지 않습니다.',
  publishedAt: 1785222000000,
};

export const isUpdateAvailable = (currentVersion: string, latestVersion?: string | null): boolean =>
  Boolean(latestVersion && latestVersion !== currentVersion);
