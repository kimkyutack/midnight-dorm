/**
 * Bump this value together with a new D1 app_updates migration.  It lives in
 * the client bundle so an already-open, cached app can compare itself against
 * the uncached update API before it loads a newer shell.
 */
export const APP_RELEASE_VERSION = '2026.07.27.4';

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
  title: '월광 보석·랜덤 보상 경제 업데이트',
  summary: '• 시작 골드를 20으로 조정하고 침대 점유 전에는 골드가 생산되지 않도록 변경했습니다.\n• 귀신 첫 레벨업 타격 수는 쉬움 1에서 21회로 시작해 악몽 1부터 10회로 고정되며, 이후 성장 간격도 새 규칙으로 조정했습니다.\n• 7단계 월광 보석과 전용 골드 보상 8종을 추가했습니다. 랜덤 상자와 복도 보급에서 나온 보석은 랜덤 레벨로 설치되고 강화할 수 있습니다.',
  publishedAt: 1785139500000,
};

export const isUpdateAvailable = (currentVersion: string, latestVersion?: string | null): boolean =>
  Boolean(latestVersion && latestVersion !== currentVersion);
