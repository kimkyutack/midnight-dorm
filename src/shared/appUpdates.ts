/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.08.04.1";

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
  title: "심야 술래잡기 정식 출시",
  summary:
    "• 귀신 전용 격리 대기실을 추가해 숨기 시간에도 방 안에서 이동할 수 있고, 추격 시작과 함께 잠긴 문이 열립니다.\n• 은신·수색 버튼을 구조물 위에 표시하고, 은신 중에는 구조물 앞 한 칸만 볼 수 있도록 긴장감을 높였습니다.\n• 사망 관전, 역할별 승리 포인트, 출시 이벤트 팝업과 술래잡기 진입 안내를 추가했습니다.",
  publishedAt: 1785833725000,
};

/**
 * Release identifiers use `YYYY.MM.DD.patch`.  Equality alone is not enough:
 * an out-of-date D1 row must never tell a newer client to refresh backwards.
 */
export function compareAppVersions(left: string, right: string): number {
  const parse = (version: string): number[] | null => {
    const parts = version.split('.').map((part) => Number(part));
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0)
      ? parts
      : null;
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  // Keep an unknown future deployment from being silently ignored, while
  // still comparing all normal release versions numerically.
  if (!leftParts || !rightParts) return left.localeCompare(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const isUpdateAvailable = (
  currentVersion: string,
  latestVersion?: string | null,
): boolean => Boolean(latestVersion && compareAppVersions(latestVersion, currentVersion) > 0);
