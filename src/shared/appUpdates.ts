/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.08.07.2";

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
  title: "30일 출석판과 판별 생존 미션",
  summary:
    "• 연속 출석 부담 없이 접속 횟수로 채우는 30일 출석 보상판을 추가했습니다. 7일 단위 특별 보상과 30일 프리미엄 스킨 선택권을 받을 수 있습니다.\n• 침대를 점유하면 30종 이상의 후보에서 매 판 새로 구성되는 생존 미션이 표시됩니다. 마지막 목표는 항상 스테이지 클리어입니다.\n• 완료한 판별 미션 포인트는 스테이지 클리어 보상에 합산되며, 진행도와 지급 결과는 서버에서 판정합니다.",
  publishedAt: 1786094576000,
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
