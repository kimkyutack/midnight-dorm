import { hashString, SeededRandom } from './rng';
import type { BuildingKind, MatchMissionMetric, MatchMissionProgress, PlayerState } from './types';

export interface MatchMissionDefinition {
  id: string;
  title: string;
  description: string;
  metric: MatchMissionMetric;
  target: number;
  targetKind?: BuildingKind;
  rewardPoints: number;
}

export type MatchMissionEvent =
  | { type: 'build'; kind: BuildingKind; level: number }
  | { type: 'upgrade'; kind: BuildingKind; level: number }
  | { type: 'spend'; gold: number; power: number }
  | { type: 'draw-item' }
  | { type: 'use-consumable' }
  | { type: 'free-repair' }
  | { type: 'soul-vial-use' }
  | { type: 'clear' };

const buildMission = (
  id: string,
  title: string,
  kind: BuildingKind,
  rewardPoints: number,
): MatchMissionDefinition => ({
  id,
  title,
  description: `${title} 설비를 1개 설치하세요.`,
  metric: 'build',
  target: 1,
  targetKind: kind,
  rewardPoints,
});

const levelMission = (
  id: string,
  title: string,
  kind: BuildingKind,
  target: number,
  rewardPoints: number,
): MatchMissionDefinition => ({
  id,
  title: `${title} Lv.${target}`,
  description: `${title}를 ${target}레벨까지 업그레이드하세요.`,
  metric: 'reach-level',
  target,
  targetKind: kind,
  rewardPoints,
});

export const MATCH_MISSION_POOL: readonly MatchMissionDefinition[] = [
  buildMission('build-generator', '달빛 발전기', 'generator', 20),
  buildMission('build-basic-turret', '수호 포탑', 'basic-turret', 20),
  buildMission('build-frost-turret', '서리 포탑', 'frost-turret', 30),
  buildMission('build-repair-drone', '수리 드론', 'repair-drone', 25),
  buildMission('build-electric-coil', '감전 코일', 'electric-coil', 25),
  buildMission('build-shield-device', '보호막 장치', 'shield-device', 25),
  buildMission('build-ghost-net', '봉쇄 그물 발사기', 'ghost-net', 30),
  buildMission('build-range-amplifier', '사거리 증폭기', 'range-amplifier', 30),
  buildMission('build-turret-enhancer', '포탑 강화기', 'turret-enhancer', 30),
  buildMission('build-power-panel', '배전 제어판', 'power-panel', 35),
  buildMission('build-door-anchor', '도어 앵커', 'door-anchor', 35),
  buildMission('build-soul-vial', '영혼 저장병', 'soul-vial', 35),
  { id: 'build-count-2', title: '설비 기초 공사', description: '설비를 2개 설치하세요.', metric: 'build-count', target: 2, rewardPoints: 20 },
  { id: 'build-count-3', title: '방어선 확장', description: '설비를 3개 설치하세요.', metric: 'build-count', target: 3, rewardPoints: 30 },
  { id: 'build-count-5', title: '병동 요새화', description: '설비를 5개 설치하세요.', metric: 'build-count', target: 5, rewardPoints: 45 },
  { id: 'upgrade-count-2', title: '첫 강화', description: '설비를 총 2회 업그레이드하세요.', metric: 'upgrade-count', target: 2, rewardPoints: 20 },
  { id: 'upgrade-count-4', title: '정비 숙련', description: '설비를 총 4회 업그레이드하세요.', metric: 'upgrade-count', target: 4, rewardPoints: 30 },
  { id: 'upgrade-count-7', title: '완벽한 정비', description: '설비를 총 7회 업그레이드하세요.', metric: 'upgrade-count', target: 7, rewardPoints: 45 },
  levelMission('generator-lv3', '달빛 발전기', 'generator', 3, 25),
  levelMission('generator-lv5', '달빛 발전기', 'generator', 5, 40),
  levelMission('generator-lv7', '달빛 발전기', 'generator', 7, 50),
  levelMission('turret-lv3', '수호 포탑', 'basic-turret', 3, 25),
  levelMission('turret-lv5', '수호 포탑', 'basic-turret', 5, 40),
  levelMission('turret-lv7', '수호 포탑', 'basic-turret', 7, 50),
  levelMission('bed-lv3', '침대', 'bed', 3, 25),
  levelMission('bed-lv5', '침대', 'bed', 5, 40),
  levelMission('bed-lv7', '침대', 'bed', 7, 50),
  levelMission('door-lv3', '병실 문', 'reinforced-door', 3, 25),
  levelMission('door-lv5', '병실 문', 'reinforced-door', 5, 40),
  levelMission('door-lv7', '병실 문', 'reinforced-door', 7, 50),
  { id: 'spend-gold-150', title: '골드 투자', description: '골드 150을 설비에 사용하세요.', metric: 'spend-gold', target: 150, rewardPoints: 20 },
  { id: 'spend-gold-400', title: '대규모 투자', description: '골드 400을 설비에 사용하세요.', metric: 'spend-gold', target: 400, rewardPoints: 35 },
  { id: 'spend-power-100', title: '전력 가동', description: '전력 100을 설비에 사용하세요.', metric: 'spend-power', target: 100, rewardPoints: 25 },
  { id: 'spend-power-250', title: '고출력 운용', description: '전력 250을 설비에 사용하세요.', metric: 'spend-power', target: 250, rewardPoints: 40 },
  { id: 'draw-item-1', title: '심야 랜덤 상자', description: '랜덤 상자를 1회 여세요.', metric: 'draw-item', target: 1, rewardPoints: 25 },
  { id: 'use-consumable-1', title: '보급품 활용', description: '장착한 보급품을 1회 사용하세요.', metric: 'use-consumable', target: 1, rewardPoints: 30 },
  { id: 'free-repair-1', title: '긴급 문 수리', description: '무료 수리 스킬을 1회 사용하세요.', metric: 'free-repair', target: 1, rewardPoints: 25 },
  { id: 'soul-vial-use-1', title: '영혼 방출', description: '영혼 저장병을 1회 사용하세요.', metric: 'soul-vial-use', target: 1, rewardPoints: 40 },
];

export const CLEAR_MATCH_MISSION: MatchMissionDefinition = {
  id: 'clear-stage',
  title: '클리어',
  description: '귀신을 물리치고 스테이지를 클리어하세요.',
  metric: 'clear',
  target: 1,
  rewardPoints: 50,
};

/**
 * Match orders grow with the selected stage instead of drawing the same
 * tutorial-sized requirement throughout the entire progression ladder.
 */
export function matchMissionDifficultyBand(stageIndex: number): number {
  if (stageIndex <= 10) return 0;
  if (stageIndex <= 20) return 1;
  if (stageIndex <= 45) return 2;
  if (stageIndex <= 120) return 3;
  return 4;
}

function roundedMissionTarget(value: number): number {
  return Math.max(10, Math.round(value / 10) * 10);
}

const SCALABLE_MISSION_METRICS = new Set<MatchMissionMetric>([
  'build-count',
  'upgrade-count',
  'reach-level',
  'spend-gold',
  'spend-power',
]);

const MISSION_BUILDING_MAX_LEVEL: Partial<Record<BuildingKind, number>> = {
  bed: 10,
  generator: 10,
  'basic-turret': 15,
  'reinforced-door': 15,
};

function scaleMissionForStage(
  mission: MatchMissionDefinition,
  stageIndex: number,
): MatchMissionDefinition {
  const band = matchMissionDifficultyBand(stageIndex);
  if (band === 0 || mission.metric === 'clear') return { ...mission };

  let target = mission.target;
  switch (mission.metric) {
    case 'build-count':
    case 'upgrade-count':
      target += band * 2;
      break;
    case 'reach-level': {
      const maximum = mission.targetKind
        ? (MISSION_BUILDING_MAX_LEVEL[mission.targetKind] ?? mission.target)
        : mission.target;
      target = Math.min(maximum, target + band * 2);
      break;
    }
    case 'spend-gold':
    case 'spend-power':
      target = roundedMissionTarget(target * (1 + band * 0.4));
      break;
    default:
      break;
  }

  const baseTitle = mission.title.replace(/ Lv\.\d+$/, '');
  const title = mission.metric === 'reach-level'
    ? `${baseTitle} Lv.${target}`
    : mission.title;
  let description = mission.description;
  switch (mission.metric) {
    case 'build': description = `${mission.title} 설비를 ${target}개 설치하세요.`; break;
    case 'build-count': description = `설비를 ${target}개 설치하세요.`; break;
    case 'upgrade-count': description = `설비를 총 ${target}회 업그레이드하세요.`; break;
    case 'reach-level': description = `${baseTitle}를 ${target}레벨까지 업그레이드하세요.`; break;
    case 'spend-gold': description = `골드 ${target}을 설비에 사용하세요.`; break;
    case 'spend-power': description = `전력 ${target}을 설비에 사용하세요.`; break;
    case 'draw-item': description = `랜덤 상자를 ${target}회 여세요.`; break;
    case 'use-consumable': description = `장착한 보급품을 ${target}회 사용하세요.`; break;
    case 'free-repair': description = `무료 수리 스킬을 ${target}회 사용하세요.`; break;
    case 'soul-vial-use': description = `영혼 저장병을 ${target}회 사용하세요.`; break;
  }

  return {
    ...mission,
    title,
    description,
    target,
    rewardPoints: Math.min(50, mission.rewardPoints + band * 5),
  };
}

export function createMatchMissions(
  matchId: string,
  playerId: string,
  stageIndex = 0,
): MatchMissionProgress[] {
  const random = new SeededRandom(hashString(`${matchId}:${playerId}:match-missions`));
  const optionalCount = random.next() < 0.5 ? 1 : 2;
  const band = matchMissionDifficultyBand(stageIndex);
  const missionPool = band === 0
    ? MATCH_MISSION_POOL
    : MATCH_MISSION_POOL.filter((mission) => SCALABLE_MISSION_METRICS.has(mission.metric));
  const selected = random
    .shuffle(missionPool)
    .slice(0, optionalCount)
    .map((mission) => scaleMissionForStage(mission, stageIndex));
  return [...selected, CLEAR_MATCH_MISSION].map((mission) => ({
    ...mission,
    progress: 0,
    completed: false,
  }));
}

export function advanceMatchMissions(player: PlayerState, event: MatchMissionEvent): void {
  for (const mission of player.matchMissions) {
    if (mission.completed) continue;
    let next = mission.progress;
    if (event.type === 'build') {
      if (mission.metric === 'build' && mission.targetKind === event.kind) next += 1;
      if (mission.metric === 'build-count') next += 1;
      if (mission.metric === 'reach-level' && mission.targetKind === event.kind) next = Math.max(next, event.level);
    } else if (event.type === 'upgrade') {
      if (mission.metric === 'upgrade-count') next += 1;
      if (mission.metric === 'reach-level' && mission.targetKind === event.kind) next = Math.max(next, event.level);
    } else if (event.type === 'spend') {
      if (mission.metric === 'spend-gold') next += event.gold;
      if (mission.metric === 'spend-power') next += event.power;
    } else if (event.type === mission.metric) {
      next += 1;
    }
    mission.progress = Math.min(mission.target, Math.max(0, next));
    mission.completed = mission.progress >= mission.target;
  }
}

export function completedMatchMissionPoints(player: Pick<PlayerState, 'matchMissions'>): number {
  return player.matchMissions.reduce(
    (total, mission) => total + (mission.completed ? mission.rewardPoints : 0),
    0,
  );
}
