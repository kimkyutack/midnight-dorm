import type { BuildingKind } from './types';

export interface BuildingLevelStats {
  gold: number;
  power: number;
  value: number;
  rate: number;
  range: number;
}

export interface BuildingDefinition {
  label: string;
  description: string;
  maxLevel: number;
  levels: readonly BuildingLevelStats[];
}

const level = (gold: number, power: number, value: number, rate: number, range: number): BuildingLevelStats => ({
  gold, power, value, rate, range,
});

export const BALANCE = {
  tickRate: 20,
  snapshotRate: 10,
  maxHumanPlayers: 4,
  maxPlayersWithBots: 4,
  reconnectMs: 30_000,
  inactiveCleanupMs: 90_000,
  countdownSeconds: 20,
  player: {
    maxHp: 100,
    speed: 3.6,
    startingGold: 100,
    startingPower: 18,
    interactionRange: 1.7,
  },
  economy: {
    buildCooldown: 0.35,
  },
  door: {
    baseHp: 100,
    upgradeHp: [100, 180, 320] as const,
  },
  ghost: {
    baseHp: 1_150,
    hpPerPlayer: 0.42,
    baseDamage: 16,
    damagePerPlayer: 0.13,
    speed: 1.8,
    attackInterval: 1.25,
    playerDamage: 18,
    retreatThreshold: 0.1,
    returnThreshold: 0.68,
    healPerSecond: 0.1,
    firstLevelAttacks: 5,
    attacksAddedPerLevel: 4,
  },
  buildings: {
    bed: {
      label: '꿈결 침대',
      description: '레벨마다 골드 생산량이 정확히 2배가 됩니다.',
      maxLevel: 3,
      levels: [level(0, 0, 1, 1, 0), level(35, 0, 2, 1, 0), level(90, 1, 4, 1, 0)],
    },
    'reinforced-door': {
      label: '봉인 강화문',
      description: '업그레이드할수록 최대 내구도와 현재 내구도가 증가합니다.',
      maxLevel: 3,
      levels: [level(0, 0, 100, 0, 0), level(55, 2, 180, 0, 0), level(140, 4, 320, 0, 0)],
    },
    'basic-turret': {
      label: '수호 포탑',
      description: '포탄을 발사하는 15단계 기본 포탑입니다.',
      maxLevel: 15,
      levels: [level(10, 0, 11, 1.05, 7)],
    },
    'rapid-turret': {
      label: '반딧불 연사포',
      description: '빠른 탄환을 연속으로 발사하는 15단계 포탑입니다.',
      maxLevel: 15,
      levels: [level(10, 1, 5, 0.38, 6.5)],
    },
    'frost-turret': {
      label: '서리 레이저',
      description: '귀신을 느리게 하는 레이저 포탑입니다.',
      maxLevel: 15,
      levels: [level(10, 2, 7, 1.3, 6)],
    },
    generator: {
      label: '달빛 발전기',
      description: '매초 전력을 생산합니다.',
      maxLevel: 3,
      levels: [level(45, 0, 1.1, 1, 0), level(90, 0, 2.2, 1, 0), level(180, 0, 4.4, 1, 0)],
    },
    'repair-drone': {
      label: '바느질 수리봇',
      description: '방문을 꾸준히 수리합니다.',
      maxLevel: 3,
      levels: [level(70, 3, 6, 1, 0), level(140, 3, 12, 1, 0), level(280, 5, 24, 1, 0)],
    },
    'electric-coil': {
      label: '별고리 코일',
      description: '가까운 귀신에게 지속 범위 피해를 줍니다.',
      maxLevel: 3,
      levels: [level(90, 6, 7, 0.75, 4.5), level(180, 5, 14, 0.65, 5), level(360, 7, 28, 0.52, 5.5)],
    },
    'floor-trap': {
      label: '그림자 덫',
      description: '귀신의 이동 속도를 크게 낮춥니다.',
      maxLevel: 3,
      levels: [level(40, 1, 0.24, 3, 1.3), level(80, 1, 0.34, 4, 1.5), level(160, 2, 0.45, 5, 1.8)],
    },
    'shield-device': {
      label: '새벽 보호막',
      description: '귀신이 주는 방문 피해를 일시적으로 줄입니다.',
      maxLevel: 3,
      levels: [level(75, 5, 0.3, 5, 0), level(150, 3, 0.45, 7, 0), level(300, 4, 0.6, 9, 0)],
    },
    'lucky-machine': {
      label: '심야 랜덤 상자',
      description: '한 판에 네 번, 확률형 아이템을 뽑습니다.',
      maxLevel: 1,
      levels: [level(0, 0, 0, 0, 0)],
    },
  } satisfies Record<BuildingKind, BuildingDefinition>,
} as const;

const TURRETS = new Set<BuildingKind>(['basic-turret', 'rapid-turret', 'frost-turret']);

export function maxBuildingLevel(kind: BuildingKind): number {
  return BALANCE.buildings[kind].maxLevel;
}

export function upgradeCost(kind: BuildingKind, targetLevel: number): { gold: number; power: number } {
  const safeLevel = Math.max(1, Math.min(maxBuildingLevel(kind), Math.floor(targetLevel)));
  if (TURRETS.has(kind)) return { gold: 10 * safeLevel * safeLevel, power: safeLevel === 1 ? buildingStats(kind, 1).power : 0 };
  const stats = BALANCE.buildings[kind].levels[safeLevel - 1] as BuildingLevelStats;
  return { gold: stats.gold, power: stats.power };
}

export function buildingStats(kind: BuildingKind, requestedLevel: number): BuildingLevelStats {
  const safeLevel = Math.max(1, Math.min(maxBuildingLevel(kind), Math.floor(requestedLevel)));
  const definition = BALANCE.buildings[kind];
  if (!TURRETS.has(kind)) return definition.levels[safeLevel - 1] as BuildingLevelStats;
  const base = definition.levels[0] as BuildingLevelStats;
  const scale = 1 + (safeLevel - 1) * 0.34;
  const rateScale = Math.max(0.42, 1 - (safeLevel - 1) * 0.035);
  const cost = upgradeCostWithoutStats(kind, safeLevel, base.power);
  return {
    gold: cost.gold,
    power: cost.power,
    value: Math.round(base.value * scale * 10) / 10,
    rate: Math.round(base.rate * rateScale * 100) / 100,
    range: Math.round((base.range + Math.floor((safeLevel - 1) / 3) * 0.5) * 10) / 10,
  };
}

function upgradeCostWithoutStats(kind: BuildingKind, safeLevel: number, initialPower: number): { gold: number; power: number } {
  if (!TURRETS.has(kind)) {
    const stats = BALANCE.buildings[kind].levels[safeLevel - 1] as BuildingLevelStats;
    return { gold: stats.gold, power: stats.power };
  }
  return { gold: 10 * safeLevel * safeLevel, power: safeLevel === 1 ? initialPower : 0 };
}
