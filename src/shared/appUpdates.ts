/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.07.28.5";

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
  title: "서퍼 몽 테마: 파도 타일",
  summary:
    "• 상점과 내 보관함에 타일 스킨 탭을 추가했습니다.\n• 침대를 점유하면 파도가 방을 훑고 타일이 뒤집히며 파도 타일로 변경됩니다.\n• 방별 타일 스킨 상태를 서버가 저장해 멀티플레이와 재접속에서도 동일하게 유지합니다.",
  publishedAt: 1785230400000,
};

export const isUpdateAvailable = (
  currentVersion: string,
  latestVersion?: string | null,
): boolean => Boolean(latestVersion && latestVersion !== currentVersion);
