/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = '2026.07.28.1';

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
  title: '친구, 1:1 채팅과 협동 빠른 문구',
  summary: '• 친구 코드로 요청을 보내고, 친구 목록에서 1:1 채팅과 방 초대를 사용할 수 있습니다.\n• 인게임에 문 위험, 포탑 강화, 내가 끝낼게, 좋은 아이템 발견 빠른 문구를 추가했습니다.',
  publishedAt: 1785209200000,
};

export const isUpdateAvailable = (currentVersion: string, latestVersion?: string | null): boolean =>
  Boolean(latestVersion && latestVersion !== currentVersion);
