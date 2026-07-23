import { rankBenefits } from './progression';
import type { BuildingKind, RankId } from './types';

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

const DOOR_HP = [80, 230, 440, 690, 970, 1_290, 1_630, 2_010, 2_410, 2_840] as const;
const DOOR_LEVELS = DOOR_HP.map((hp, index) => {
  const doorLevel = index + 1;
  return level(doorLevel === 1 ? 0 : 15 * doorLevel * doorLevel, doorLevel === 1 ? 0 : Math.ceil(doorLevel * 0.8), hp, 0, 0);
});
const BED_UPGRADE_GOLD = [0, 35, 90, 210, 460, 970, 2_000, 4_050, 8_200, 16_500] as const;
const BED_UPGRADE_POWER = [0, 0, 1, 3, 6, 10, 16, 24, 35, 50] as const;
const BED_LEVELS = BED_UPGRADE_GOLD.map((gold, index) =>
  level(gold, BED_UPGRADE_POWER[index] as number, 2 ** index, 1, 0),
);
const GENERATOR_LEVELS = Array.from({ length: 10 }, (_, index) =>
  level(45 * 2 ** index, 0, 2 ** index, 1, 0),
);

export const BALANCE = {
  tickRate: 20,
  snapshotRate: 15,
  buildInputCooldownMs: 350,
  maxHumanPlayers: 4,
  maxPlayersWithBots: 4,
  reconnectMs: 30_000,
  inactiveCleanupMs: 90_000,
  countdownSeconds: 30,
  player: {
    maxHp: 100,
    speed: 4.8,
    startingGold: 100,
    startingPower: 18,
    interactionRange: 1.7,
    collisionRadius: 0.36,
  },
  door: {
    baseHp: DOOR_HP[0],
    upgradeHp: DOOR_HP,
    passiveRegenDelaySeconds: 5,
    passiveRegenAmount: 5,
    passiveRegenIntervalSeconds: 1,
  },
  ghost: {
    baseHp: 760,
    collisionRadius: 0.28,
    hpPerPlayer: 0.1,
    // 노말 초반에도 문을 실제로 압박하도록 기존 4에서 15%만 올린다.
    baseDamage: 4.6,
    damagePerPlayer: 0.13,
    damageGrowthPerLevel: 0.58,
    shieldPenetrationPerLevel: 0.15,
    speed: 3.55,
    // 미점유 생존자는 즉시 방을 찾아야 하므로 기존 1.5배의 정확히 두 배다.
    outsideTargetSpeedMultiplier: 3,
    attackInterval: 1.25,
    retreatThreshold: 0.23,
    healDurationSeconds: 7,
    // 후퇴를 시작한 귀신이 포탑 네 대에 곧바로 삭제되지 않도록 집중 사격 보정을 낮춘다.
    retreatDamageMultiplier: 1.45,
    // 회복 구역으로 복귀 중에도 포탑이 마무리 공격을 할 수 있도록 속도를 제한한다.
    retreatSpeedMultiplier: 1.3,
    firstLevelAttacks: 30,
    attacksAddedPerLevel: 15,
  },
  buildings: {
    bed: {
      label: '꿈결 침대',
      description: '레벨마다 골드 생산량이 정확히 2배가 됩니다.',
      maxLevel: 10,
      levels: BED_LEVELS,
    },
    'reinforced-door': {
      label: '봉인 강화문',
      description: '10단계 외형으로 강화되며, 단계마다 방어 소재가 뚜렷하게 바뀝니다.',
      maxLevel: 10,
      levels: DOOR_LEVELS,
    },
    'basic-turret': {
      label: '수호 포탑',
      description: '포탄을 발사하는 15단계 기본 포탑입니다.',
      maxLevel: 15,
      levels: [level(10, 0, 13, 1, 4)],
    },
    'rapid-turret': {
      label: '반딧불 연사포',
      description: '빠른 탄환을 연속으로 발사하는 15단계 포탑입니다.',
      maxLevel: 15,
      levels: [level(10, 1, 6, 0.34, 4)],
    },
    'frost-turret': {
      label: '서리 레이저',
      description: '귀신을 느리게 하는 레이저 포탑입니다.',
      maxLevel: 15,
      levels: [level(10, 2, 9, 1.1, 4)],
    },
    'arc-turret': {
      label: '희귀 천둥포',
      description: '베테랑부터 설치할 수 있는 고위력 희귀 포탑입니다.',
      maxLevel: 15,
      levels: [level(250, 25, 38, 1.55, 4)],
    },
    'golden-turret': {
      label: '황금 심판 포탑',
      description: '황금 티켓 1장당 한 대만 설치할 수 있는 10단계 신화 포탑입니다.',
      maxLevel: 10,
      levels: [level(0, 0, 170, 0.25, 5.5)],
    },
    generator: {
      label: '달빛 발전기',
      description: '침대와 같이 10단계까지 강화되며 매초 전력이 2배씩 늘어납니다.',
      maxLevel: 10,
      levels: GENERATOR_LEVELS,
    },
    'repair-drone': {
      label: '바느질 수리봇',
      description: '전력만 사용해 방문을 꾸준히 수리합니다.',
      maxLevel: 3,
      levels: [level(0, 6, 1.5, 1, 0), level(0, 10, 3, 1, 0), level(0, 16, 6, 1, 0)],
    },
    'electric-coil': {
      label: '별고리 코일',
      description: '전력만 사용해 가까운 귀신에게 지속 범위 피해를 줍니다.',
      maxLevel: 3,
      levels: [level(0, 12, 7, 0.75, 4.5), level(0, 18, 14, 0.65, 5), level(0, 27, 28, 0.52, 5.5)],
    },
    'floor-trap': {
      label: '그림자 덫',
      description: '전력만 사용해 귀신의 이동 속도를 크게 낮춥니다.',
      maxLevel: 3,
      levels: [level(0, 4, 0.24, 3, 1.3), level(0, 7, 0.34, 4, 1.5), level(0, 11, 0.45, 5, 1.8)],
    },
    'shield-device': {
      label: '새벽 보호막',
      description: '전력만 사용해 귀신이 주는 방문 피해를 일시적으로 줄입니다.',
      maxLevel: 3,
      levels: [level(0, 9, 0.3, 5, 0), level(0, 14, 0.45, 7, 0), level(0, 20, 0.6, 9, 0)],
    },
    'lucky-machine': {
      label: '심야 랜덤 상자',
      description: '한 판에 네 번, 확률형 아이템을 뽑습니다.',
      maxLevel: 1,
      levels: [level(0, 0, 0, 0, 0)],
    },
    'gem-core': {
      label: '월광 보석',
      description: '전력을 응축해 매초 골드를 생산합니다.',
      maxLevel: 5,
      levels: [
        level(0, 125, 8, 1, 0),
        level(0, 250, 16, 1, 0),
        level(0, 500, 32, 1, 0),
        level(0, 1_000, 64, 1, 0),
        level(0, 2_000, 128, 1, 0),
      ],
    },
    'ghost-net': {
      label: '봉쇄 그물 발사기',
      description: '문을 공격하는 HP 30% 이하 귀신을 1.5초 멈춥니다.',
      maxLevel: 1,
      levels: [level(0, 250, 1.5, 12, 0)],
    },
    'range-amplifier': {
      label: '포탑 사거리 증폭기',
      description: '같은 방 모든 포탑의 사거리를 레벨당 1칸 늘립니다.',
      maxLevel: 4,
      levels: [
        level(0, 180, 1, 0, 0),
        level(0, 360, 2, 0, 0),
        level(0, 720, 3, 0, 0),
        level(0, 1_440, 4, 0, 0),
      ],
    },
    'starter-grave': {
      label: '잠든 무덤',
      description: '방을 점유하면 소유권을 얻고 매초 골드 1을 생산합니다.',
      maxLevel: 1,
      levels: [level(0, 0, 1, 1, 0)],
    },
  } satisfies Record<BuildingKind, BuildingDefinition>,
} as const;

const TURRETS = new Set<BuildingKind>(['basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret', 'golden-turret']);
const RANK_TURRETS = new Set<BuildingKind>(['basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret']);

export function maxBuildingLevel(kind: BuildingKind, soloRank: RankId = 'beginner'): number {
  const benefits = rankBenefits(soloRank);
  if (kind === 'reinforced-door') return BALANCE.buildings[kind].maxLevel;
  if (RANK_TURRETS.has(kind)) return BALANCE.buildings[kind].maxLevel + benefits.turretLevelBonus;
  return BALANCE.buildings[kind].maxLevel;
}

export function upgradeCost(kind: BuildingKind, targetLevel: number, soloRank: RankId = 'beginner'): { gold: number; power: number } {
  const safeLevel = Math.max(1, Math.min(maxBuildingLevel(kind, soloRank), Math.floor(targetLevel)));
  if (kind === 'golden-turret') {
    return {
      gold: safeLevel === 1 ? 0 : 150 * safeLevel * safeLevel,
      power: safeLevel === 1 ? 0 : safeLevel,
    };
  }
  if (TURRETS.has(kind)) {
    const baseGold = kind === 'arc-turret' ? 250 : 10;
    const discount = kind === 'arc-turret' ? 1 - rankBenefits(soloRank).rareTurretDiscount : 1;
    return { gold: Math.ceil(baseGold * safeLevel * safeLevel * discount), power: safeLevel === 1 ? buildingStats(kind, 1).power : 0 };
  }
  const stats = BALANCE.buildings[kind].levels[safeLevel - 1] as BuildingLevelStats;
  return { gold: stats.gold, power: stats.power };
}

export function buildingStats(kind: BuildingKind, requestedLevel: number): BuildingLevelStats {
  const absoluteMax = RANK_TURRETS.has(kind) ? BALANCE.buildings[kind].maxLevel + 2 : BALANCE.buildings[kind].maxLevel;
  const safeLevel = Math.max(1, Math.min(absoluteMax, Math.floor(requestedLevel)));
  const definition = BALANCE.buildings[kind];
  if (!TURRETS.has(kind)) return definition.levels[safeLevel - 1] as BuildingLevelStats;
  const base = definition.levels[0] as BuildingLevelStats;
  if (kind === 'golden-turret') {
    const scale = 1 + (safeLevel - 1) * 0.5;
    const rateScale = Math.max(0.1, 1 - (safeLevel - 1) * 0.065);
    const cost = upgradeCostWithoutStats(kind, safeLevel, base.power);
    return {
      gold: cost.gold,
      power: cost.power,
      value: Math.round(base.value * scale),
      rate: Math.round(base.rate * rateScale * 100) / 100,
      range: base.range,
    };
  }
  const scale = 1 + (safeLevel - 1) * 0.34;
  const rateScale = Math.max(0.42, 1 - (safeLevel - 1) * 0.035);
  const cost = upgradeCostWithoutStats(kind, safeLevel, base.power);
  return {
    gold: cost.gold,
    power: cost.power,
    value: Math.round(base.value * scale * 10) / 10,
    rate: Math.round(base.rate * rateScale * 100) / 100,
    // Turret reach is intentionally fixed so upgrading improves damage and fire rate,
    // not the ability to shoot through an entire room.
    range: base.range,
  };
}

function upgradeCostWithoutStats(kind: BuildingKind, safeLevel: number, initialPower: number): { gold: number; power: number } {
  if (kind === 'golden-turret') {
    return {
      gold: safeLevel === 1 ? 0 : 150 * safeLevel * safeLevel,
      power: safeLevel === 1 ? 0 : safeLevel,
    };
  }
  if (!TURRETS.has(kind)) {
    const stats = BALANCE.buildings[kind].levels[safeLevel - 1] as BuildingLevelStats;
    return { gold: stats.gold, power: stats.power };
  }
  const baseGold = kind === 'arc-turret' ? 250 : 10;
  return { gold: baseGold * safeLevel * safeLevel, power: safeLevel === 1 ? initialPower : 0 };
}
