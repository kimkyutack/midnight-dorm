export type EventMissionPeriod = 'daily' | 'weekly';
export type EventMissionMetric = 'stage-clears' | 'login-days' | 'ranked-completions';

export interface EventMissionDefinition {
  id: string;
  period: EventMissionPeriod;
  metric: EventMissionMetric;
  title: string;
  description: string;
  target: number;
  rewardPoints: number;
}

export interface EventMissionProgress extends EventMissionDefinition {
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface EventMissionPeriodState {
  key: string;
  resetsAt: number;
  missions: EventMissionProgress[];
}

export interface EventMissionOverview {
  serverNow: number;
  customPoints: number;
  claimableCount: number;
  hasProgress: boolean;
  periods: Record<EventMissionPeriod, EventMissionPeriodState>;
}

export const EVENT_MISSIONS = [
  {
    id: 'daily-login-1',
    period: 'daily',
    metric: 'login-days',
    title: '오늘의 출석',
    description: '오늘 앱에 접속하세요.',
    target: 1,
    rewardPoints: 20,
  },
  {
    id: 'daily-clear-1',
    period: 'daily',
    metric: 'stage-clears',
    title: '첫 생존 보고',
    description: '오늘 스테이지를 1회 클리어하세요.',
    target: 1,
    rewardPoints: 50,
  },
  {
    id: 'daily-clear-2',
    period: 'daily',
    metric: 'stage-clears',
    title: '야간 순찰 완료',
    description: '오늘 스테이지를 2회 클리어하세요.',
    target: 2,
    rewardPoints: 75,
  },
  {
    id: 'daily-clear-3',
    period: 'daily',
    metric: 'stage-clears',
    title: '생존',
    description: '오늘 스테이지를 3회 클리어하세요.',
    target: 3,
    rewardPoints: 100,
  },
  {
    id: 'daily-ranked-1',
    period: 'daily',
    metric: 'ranked-completions',
    title: '랭크전 출전',
    description: '오늘 랭크전을 1회 완료하세요.',
    target: 1,
    rewardPoints: 75,
  },
  {
    id: 'weekly-login-5',
    period: 'weekly',
    metric: 'login-days',
    title: '주간 출석 생존자',
    description: '5일 동안 접속하세요.',
    target: 5,
    rewardPoints: 50,
  },
  {
    id: 'weekly-clear-5',
    period: 'weekly',
    metric: 'stage-clears',
    title: '주간 방어 교대',
    description: '스테이지를 5회 클리어하세요.',
    target: 5,
    rewardPoints: 100,
  },
  {
    id: 'weekly-clear-10',
    period: 'weekly',
    metric: 'stage-clears',
    title: '숙련 생존자',
    description: '스테이지를 10회 클리어하세요.',
    target: 10,
    rewardPoints: 150,
  },
  {
    id: 'weekly-clear-20',
    period: 'weekly',
    metric: 'stage-clears',
    title: '불침번의 증명',
    description: '스테이지를 20회 클리어하세요.',
    target: 20,
    rewardPoints: 200,
  },
  {
    id: 'weekly-ranked-5',
    period: 'weekly',
    metric: 'ranked-completions',
    title: '주간 랭크 작전',
    description: '랭크전을 5회 완료하세요.',
    target: 5,
    rewardPoints: 150,
  },
] as const satisfies readonly EventMissionDefinition[];

const KOREA_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

const dateKey = (shiftedTime: number): string => {
  const date = new Date(shiftedTime);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

/** Mission resets use Korean calendar days regardless of device timezone. */
export function eventMissionPeriodWindow(
  period: EventMissionPeriod,
  now = Date.now(),
): { key: string; startsAt: number; resetsAt: number } {
  const shifted = new Date(now + KOREA_OFFSET_MS);
  const today = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  if (period === 'daily') {
    return {
      key: dateKey(today),
      startsAt: today - KOREA_OFFSET_MS,
      resetsAt: today + DAY_MS - KOREA_OFFSET_MS,
    };
  }
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const monday = today - daysSinceMonday * DAY_MS;
  return {
    key: dateKey(monday),
    startsAt: monday - KOREA_OFFSET_MS,
    resetsAt: monday + 7 * DAY_MS - KOREA_OFFSET_MS,
  };
}

export function eventMissionsForPeriod(
  period: EventMissionPeriod,
): EventMissionDefinition[] {
  return EVENT_MISSIONS.filter((mission) => mission.period === period);
}
