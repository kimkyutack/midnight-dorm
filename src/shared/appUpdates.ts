/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.08.03.4";

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
  title: "홈 휴식 모션과 모바일 탭 개편",
  summary:
    "• 홈 캐릭터와 모든 스킨에 앉기·하품 전용 모션을 추가하고 화면 비율을 다듬었습니다.\n• 스테이지 시작 버튼을 노란색으로 통일하고 난이도 제목·푸터 글자를 중앙 정렬했습니다.\n• 친구, 상점, 보관함 탭을 버튼형으로 개편하고 다크 아케이드 기본 프로필을 새로 적용했습니다.",
  publishedAt: 1785749700000,
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
