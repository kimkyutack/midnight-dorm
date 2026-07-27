/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = '2026.07.27.2';

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
  title: '모바일 조작과 보상 흐름 개선',
  summary: '화면 어디서나 드래그 이동, 이동 입력 재전송으로 끊김 완화, 복도 보상 낙하와 랜덤 보상 설치 흐름을 개선했습니다.',
  publishedAt: 1785110400000,
};

export const isUpdateAvailable = (currentVersion: string, latestVersion?: string | null): boolean =>
  Boolean(latestVersion && latestVersion !== currentVersion);
