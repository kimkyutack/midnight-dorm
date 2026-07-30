/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.07.31.1";

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
  title: "모바일 이동·채팅과 전술 보급 개선",
  summary:
    "• 드래그를 놓을 때 캐릭터가 뒤로 되감기는 현상을 보정했습니다.\n• 모바일 키보드가 열려도 게임 화면은 고정되고 채팅창만 올라오도록 개선했습니다.\n• 전술 보급품 이미지와 카드 배치를 정리하고 포탑 지정 사용 절차를 추가했습니다.\n• 홈 설정에서 현재 버전과 최신 업데이트 여부를 바로 확인할 수 있습니다.",
  publishedAt: 1785466800000,
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
