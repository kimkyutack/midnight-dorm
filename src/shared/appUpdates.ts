/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = "2026.08.02.2";

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
  title: "프로필·인게임 UI와 골드 봉인 개선",
  summary:
    "• 프로필의 닉네임 수정 버튼을 작은 정사각형으로 다듬고 불필요한 사진 안내 문구를 제거했습니다.\n• 일반·시즌·대기열 등급 이미지를 투명한 동일 규격 중앙 정렬로 통일했습니다.\n• 강력계 크로코의 이동 충격 이펙트를 실제 앞발 착지 위치에 맞추고, 문 이름과 내구도가 건물에 가려지지 않도록 개선했으며 침대 점유 전 카메라 확대·축소 버튼을 숨겼습니다.\n• 불지옥 5 이후 난이도 상승 폭을 완화하고 장기 고레벨 경기에서 골드 획득이 멈추는 문제를 수정했습니다.\n• 골드 봉인은 귀신이 문을 실제 공격하는 동안 해당 방에만 적용되며, 시전자에게 전용 이펙트와 '골드 획득 봉인' 문구를 표시하고 봉인된 방의 모든 침대·설치 건물에 자물쇠를 표시합니다.",
  publishedAt: 1785676920000,
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
