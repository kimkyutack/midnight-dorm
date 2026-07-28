/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.07.28.4";

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
  title: "여름 한정 스킨: 해변 구조대 라온",
  summary:
    "• 빨간 구조대 모자와 구명 튜브를 갖춘 해변 구조대 라온을 추가했습니다.\n• 라온의 수호 포탑 사거리 특성을 200% 효율로 적용하며 5,000P에 구매할 수 있습니다.\n• 서퍼 몽과 구조대 라온이 함께 등장하는 여름 특별 스킨 통합 이벤트를 적용했습니다.",
  publishedAt: 1785225600000,
};

export const isUpdateAvailable = (
  currentVersion: string,
  latestVersion?: string | null,
): boolean => Boolean(latestVersion && latestVersion !== currentVersion);
