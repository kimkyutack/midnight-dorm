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

// The first few door upgrades are intentionally inexpensive now, so the
// health curve grows more gently than the former quadratic-price curve. The
// later levels still give a meaningful end-game wall without making a cheap
// early door upgrade decide the whole match.
const DOOR_HP = [80, 150, 235, 350, 500, 690, 920, 1_180, 1_480, 1_820, 2_210, 2_660, 3_160, 3_720, 4_360] as const;
const DOOR_LEVELS = DOOR_HP.map((hp, index) => {
  const doorLevel = index + 1;
  const gold = doorLevel === 1 ? 0 : 20 * 2 ** (doorLevel - 2);
  return level(gold, doorLevel >= 6 ? Math.ceil(gold * 0.1) : 0, hp, 0, 0);
});
const BED_LEVELS = Array.from({ length: 15 }, (_, index) => {
  const bedLevel = index + 1;
  const gold = bedLevel === 1 ? 0 : 25 * 2 ** (bedLevel - 2);
  return level(gold, bedLevel >= 6 ? Math.ceil(gold * 0.1) : 0, 2 ** index, 1, 0);
});
const GENERATOR_LEVELS = Array.from({ length: 10 }, (_, index) => {
  const generatorLevel = index + 1;
  const gold = 200 * 2 ** index;
  return level(gold, generatorLevel >= 5 ? Math.ceil(gold * 0.1) : 0, 2 ** index, 1, 0);
});

export const BALANCE = {
  tickRate: 20,
  // A full snapshot is intentionally less frequent than simulation ticks.
  // Local prediction keeps movement smooth while mobile radios avoid a backlog.
  snapshotRate: 10,
  buildInputCooldownMs: 350,
  maxHumanPlayers: 4,
  maxPlayersWithBots: 4,
  reconnectMs: 90_000,
  inactiveCleanupMs: 180_000,
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
    // 방을 아직 점유하지 못한 생존자를 추격할 때도 일반 이동의 흐름을
    // 유지한다. 과도한 배율은 10Hz 스냅샷 사이의 이동량을 키워 모바일에서
    // 순간이동처럼 보이므로, 기본 생존자와 비슷한 속도로 제한한다.
    outsideTargetSpeedMultiplier: 1.35,
    attackInterval: 1.25,
    retreatThreshold: 0.2,
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
      maxLevel: 15,
      levels: BED_LEVELS,
    },
    'reinforced-door': {
      label: '봉인 강화문',
      description: '15단계 외형으로 강화되며, 단계마다 방어 소재가 뚜렷하게 바뀝니다.',
      maxLevel: 15,
      levels: DOOR_LEVELS,
    },
    'basic-turret': {
      label: '수호 포탑',
      description: '단 하나의 공격 포탑입니다. 단계마다 더 견고한 수호포 외형으로 강화됩니다.',
      maxLevel: 15,
      levels: [level(10, 0, 13, 1, 4)],
    },
    'rapid-turret': {
      label: '구형 연사포',
      description: '이전 저장 데이터 호환용 설비입니다. 새 게임에서는 설치할 수 없습니다.',
      maxLevel: 15,
      levels: [level(10, 0, 6, 0.34, 4)],
    },
    'frost-turret': {
      label: '서리 스프레이',
      description: '전력 200으로 설치하는 강화 감속 설비입니다. 여러 대의 감속 효과가 누적됩니다.',
      maxLevel: 1,
      levels: [level(0, 200, 0.16, 0.5, 5)],
    },
    'arc-turret': {
      label: '희귀 천둥포',
      description: '베테랑부터 설치할 수 있는 고위력 희귀 포탑입니다.',
      maxLevel: 15,
      levels: [level(250, 0, 38, 1.55, 4)],
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
      label: '문 수리대',
      description: '골드를 사용해 방문을 꾸준히 수리합니다.',
      maxLevel: 3,
      levels: [level(70, 0, 1.5, 1, 0), level(140, 0, 3, 1, 0), level(280, 0, 6, 1, 0)],
    },
    'electric-coil': {
      label: '별고리 코일',
      description: '전력만 사용해 가까운 귀신에게 지속 범위 피해를 줍니다.',
      maxLevel: 3,
      levels: [level(0, 12, 7, 0.75, 4.5), level(0, 18, 14, 0.65, 5), level(0, 27, 28, 0.52, 5.5)],
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
      description: '문을 공격하는 HP 20% 이하 귀신을 1.5초 멈춥니다.',
      maxLevel: 1,
      levels: [level(0, 250, 1.5, 12, 0)],
    },
    'range-amplifier': {
      label: '포탑 사거리 증폭기',
      description: '내 수호 포탑 전체의 사거리를 레벨당 1칸 늘립니다.',
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

// Only the guardian turret is available in the live installation catalogue.
// The legacy entries stay in the balance table so an old saved match can still
// be read without crashing while it finishes.
const TURRETS = new Set<BuildingKind>(['basic-turret', 'rapid-turret', 'arc-turret', 'golden-turret']);

function turretGoldCost(kind: BuildingKind, targetLevel: number): number {
  const baseGold = kind === 'arc-turret' ? 250 : 10;
  return baseGold * 2 ** Math.max(0, targetLevel - 1);
}

export function maxBuildingLevel(kind: BuildingKind, _soloRank: RankId = 'beginner'): number {
  return BALANCE.buildings[kind].maxLevel;
}

export function upgradeCost(kind: BuildingKind, targetLevel: number, soloRank: RankId = 'beginner'): { gold: number; power: number } {
  const safeLevel = Math.max(1, Math.min(maxBuildingLevel(kind, soloRank), Math.floor(targetLevel)));
  if (kind === 'golden-turret') {
    return {
      gold: safeLevel === 1 ? 0 : 150 * safeLevel * safeLevel,
      power: 0,
    };
  }
  if (TURRETS.has(kind)) {
    return { gold: turretGoldCost(kind, safeLevel), power: 0 };
  }
  const stats = BALANCE.buildings[kind].levels[safeLevel - 1] as BuildingLevelStats;
  return { gold: stats.gold, power: stats.power };
}

/**
 * Server-authoritative level gates shared with the HUD. `bedLevel` is the
 * upgrading survivor's own bed, which keeps co-op players from borrowing a
 * teammate's progression to unlock the room's shared defenses.
 */
export function upgradeRequirement(
  kind: BuildingKind,
  currentLevel: number,
  context: { bedLevel: number; doorLevel: number },
): string | null {
  const targetLevel = currentLevel + 1;
  if (kind === 'bed') {
    const requiredDoorLevel = targetLevel === 4 ? 3
      : targetLevel === 6 ? 5
        : targetLevel === 8 ? 7
          : targetLevel >= 9 ? targetLevel
            : 0;
    return context.doorLevel < requiredDoorLevel
      ? `문 Lv.${requiredDoorLevel} 필요`
      : null;
  }
  if (kind === 'basic-turret') {
    const requiredBedLevel = targetLevel === 6 ? 6
      : targetLevel === 10 ? 10
        : targetLevel === 13 ? 13
          : targetLevel === 14 ? 14
            : targetLevel === 15 ? 15
              : 0;
    if (context.bedLevel < requiredBedLevel)
      return `침대 Lv.${requiredBedLevel} 필요`;
    if (targetLevel === 15 && context.doorLevel < 15)
      return '문 Lv.15 필요';
  }
  return null;
}

export function buildingStats(kind: BuildingKind, requestedLevel: number): BuildingLevelStats {
  const safeLevel = Math.max(1, Math.min(BALANCE.buildings[kind].maxLevel, Math.floor(requestedLevel)));
  const definition = BALANCE.buildings[kind];
  if (!TURRETS.has(kind)) return definition.levels[safeLevel - 1] as BuildingLevelStats;
  const base = definition.levels[0] as BuildingLevelStats;
  if (kind === 'golden-turret') {
    const scale = 1 + (safeLevel - 1) * 0.5;
    const rateScale = Math.max(0.1, 1 - (safeLevel - 1) * 0.065);
    const cost = upgradeCostWithoutStats(kind, safeLevel);
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
  const cost = upgradeCostWithoutStats(kind, safeLevel);
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

function upgradeCostWithoutStats(kind: BuildingKind, safeLevel: number): { gold: number; power: number } {
  if (kind === 'golden-turret') {
    return {
      gold: safeLevel === 1 ? 0 : 150 * safeLevel * safeLevel,
      power: 0,
    };
  }
  if (!TURRETS.has(kind)) {
    const stats = BALANCE.buildings[kind].levels[safeLevel - 1] as BuildingLevelStats;
    return { gold: stats.gold, power: stats.power };
  }
  return { gold: turretGoldCost(kind, safeLevel), power: 0 };
}
