/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.08.05.2";

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
  title: "캐시 지갑과 충전 상점",
  summary:
    "• 홈 포인트 왼쪽에 캐시 지갑과 충전 버튼을 추가하고 작은 화면에서도 프로필이 잘리지 않도록 잔액을 축약 표시합니다.\n• 100·550·1,200·2,500·5,200·10,400 캐시 충전 상품과 Google Play·App Store 공통 SKU를 추가했습니다. 10,400 캐시 팩의 가격은 ₩156,000입니다.\n• 각 캐시 팩은 계정당 최초 1회에 한해 20% 추가 캐시를 지급합니다. 예를 들어 10,400 캐시 팩은 첫 구매 시 12,480 캐시를 지급합니다.\n• 유료 콘텐츠는 개별 결제 대신 충전한 캐시를 사용하며, 캐시 부족 시 충전 상점으로 바로 이동합니다.\n• 캐시 확인·차감·보상 지급을 서버 원장에서 함께 처리해 중복 요청이나 동시 결제로 잔액이 음수가 되지 않도록 보호했습니다.",
  publishedAt: 1785931403000,
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
