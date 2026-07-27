/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = '2026.07.27.5';

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
  title: '우편함과 홈 빠른 메뉴',
  summary: '• 홈 상단에 우편함을 추가해 서버 공지·개인 우편·보상 우편을 한곳에서 확인할 수 있습니다.\n• 업데이트 내역·광고 제거·랭킹을 세로형 빠른 메뉴로 정리했습니다.',
  publishedAt: 1785157800000,
};

export const isUpdateAvailable = (currentVersion: string, latestVersion?: string | null): boolean =>
  Boolean(latestVersion && latestVersion !== currentVersion);
