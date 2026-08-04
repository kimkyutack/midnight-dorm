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
const BED_LEVELS = Array.from({ length: 10 }, (_, index) => {
  const bedLevel = index + 1;
  const gold = bedLevel === 1 ? 0 : 25 * 2 ** (bedLevel - 2);
  return level(gold, bedLevel >= 6 ? Math.ceil(gold * 0.1) : 0, 2 ** index, 1, 0);
});
const GENERATOR_LEVELS = Array.from({ length: 10 }, (_, index) => {
  const generatorLevel = index + 1;
  const gold = 150 * 2 ** index;
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
  resource: {
    // High-level beds, reward buildings and golden turrets can legitimately
    // pass the old 999,999 clamp during a long match. Keep a finite safety
    // ceiling for serialization without making normal income silently stop.
    maxStored: 999_999_999_999,
  },
  reconnectMs: 90_000,
  inactiveCleanupMs: 180_000,
  // Two seconds of a fixed ghost poster followed by a two-second fade. The
  // 30-second preparation countdown begins only after this sequence ends.
  ghostIntroSeconds: 4,
  // Time Attack is announced after the ghost poster and immediately before
  // the preparation countdown.
  timeAttackIntroSeconds: 2.5,
  countdownSeconds: 30,
  player: {
    maxHp: 100,
    // Touch movement begins from anywhere on the battlefield. A modest base
    // increase keeps the longer gesture travel responsive without making
    // ghosts look as though they teleport between snapshots.
    speed: 6.24,
    startingGold: 20,
    startingPower: 18,
    interactionRange: 1.7,
    // The sleep prompt is rendered from a 10 Hz authoritative snapshot. While
    // a survivor is still dragging, that snapshot can be roughly one network
    // trip behind the server. The server accepts this extra distance only
    // when the survivor is still on that same room's floor, never through a
    // wall or from the corridor.
    interactionLatencyGrace: 1.05,
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
    // Baseline pressure is deliberately higher now that late-game strategic
    // buildings create burst and recovery windows.
    // The previous baseline combined with the level growth curve let an
    // early ghost snowball to Lv.5 before a normal solo room was established.
    // Keep higher stages threatening, while making the first retreat and the
    // first two upgrades realistically reachable.
    baseHp: 760,
    collisionRadius: 0.28,
    hpPerPlayer: 0.1,
    baseDamage: 4.5,
    damagePerPlayer: 0.13,
    damageGrowthPerLevel: 0.3,
    shieldPenetrationPerLevel: 0.15,
    speed: 3.55,
    // 방을 아직 점유하지 못한 생존자를 추격할 때도 일반 이동의 흐름을
    // 유지한다. 과도한 배율은 10Hz 스냅샷 사이의 이동량을 키워 모바일에서
    // 순간이동처럼 보이므로, 기본 생존자와 비슷한 속도로 제한한다.
    outsideTargetSpeedMultiplier: 1.35,
    // 준비 시간이 끝날 때까지 방을 점유하지 못한 생존자는 계속 도망쳐
    // 전투를 무기한 지연할 수 없다. 감속과 느린 귀신 변종을 포함해 실제
    // 대상 생존자의 현재 속도보다 최소 1.5배 빠르게 추격한다.
    outsideTargetMinimumPlayerMultiplier: 1.5,
    attackInterval: 1.25,
    retreatThreshold: 0.2,
    healDurationSeconds: 7,
    // 후퇴를 시작한 귀신이 포탑 네 대에 곧바로 삭제되지 않도록 집중 사격 보정을 낮춘다.
    retreatDamageMultiplier: 1.45,
    // 회복 구역으로 복귀 중에도 포탑이 마무리 공격을 할 수 있도록 속도를 제한한다.
    retreatSpeedMultiplier: 1.3,
    // 쉬움 1 기준 첫 성장 21회. 스테이지가 오를수록 1회씩 줄어
    // 어려움 1부터는 15회 아래로 내려가지 않는다. 고난도에서도
    // 귀신 레벨이 너무 빨리 오르는 것을 막기 위한 최소 간격이다.
    firstLevelAttacks: 21,
    firstLevelFollowupAttacks: 3,
    attacksAddedPerLevel: 5,
  },
  buildings: {
    bed: {
      label: '꿈결 침대',
      description: '매초 골드를 얻습니다. 레벨이 오르면 획득 골드가 2배가 됩니다.',
      maxLevel: 10,
      levels: BED_LEVELS,
    },
    'reinforced-door': {
      label: '봉인 강화문',
      description: '귀신이 방에 들어오는 것을 막습니다. 레벨이 오르면 HP가 늘어납니다.',
      maxLevel: 15,
      levels: DOOR_LEVELS,
    },
    'basic-turret': {
      label: '수호 포탑',
      description: '가까운 귀신을 자동으로 공격합니다.',
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
      description: '귀신을 느리게 만듭니다. 여러 대를 설치하면 더 느려집니다.',
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
      description: '공격마다 골드를 얻는 10단계 신화 포탑입니다.',
      maxLevel: 10,
      levels: [level(0, 0, 170, 0.5, 5.5)],
    },
    generator: {
      label: '달빛 발전기',
      description: '매초 전기를 얻습니다. 레벨이 오르면 획득 전기가 2배가 됩니다.',
      maxLevel: 10,
      levels: GENERATOR_LEVELS,
    },
    'repair-drone': {
      label: '문 수리대',
      description: '매초 문 HP를 회복합니다.',
      maxLevel: 3,
      levels: [level(70, 0, 7.5, 1, 0), level(140, 0, 15, 1, 0), level(280, 0, 22.5, 1, 0)],
    },
    'electric-coil': {
      label: '별고리 코일',
      description: '가까운 귀신에게 계속 피해를 줍니다.',
      maxLevel: 3,
      levels: [level(0, 25, 7, 0.75, 4.5), level(0, 50, 14, 0.65, 5), level(0, 75, 28, 0.52, 5.5)],
    },
    'shield-device': {
      label: '새벽 보호막',
      description: '문이 받는 피해를 잠시 줄여줍니다.',
      maxLevel: 3,
      levels: [level(0, 30, 0.3, 5, 0), level(0, 40, 0.45, 7, 0), level(0, 50, 0.6, 9, 0)],
    },
    'lucky-machine': {
      label: '심야 랜덤 상자',
      description: '골드를 내고 랜덤 보상 하나를 뽑습니다.',
      maxLevel: 1,
      levels: [level(0, 0, 0, 0, 0)],
    },
    'gem-core': {
      label: '월광 보석',
      description: '매초 골드를 얻습니다.',
      maxLevel: 7,
      levels: [
        level(0, 32, 8, 1, 0),
        level(0, 64, 16, 1, 0),
        level(0, 128, 32, 1, 0),
        level(0, 256, 64, 1, 0),
        level(0, 512, 128, 1, 0),
        level(0, 1_024, 256, 1, 0),
        level(0, 2_048, 512, 1, 0),
      ],
    },
    'ghost-net': {
      label: '봉쇄 그물 발사기',
      description: '문을 공격하는 약한 귀신을 1.5초 멈춥니다.',
      maxLevel: 1,
      levels: [level(0, 250, 1.5, 12, 0)],
    },
    'range-amplifier': {
      label: '포탑 사거리 증폭기',
      description: '내 수호 포탑 모두의 사거리를 1칸 늘립니다.',
      maxLevel: 4,
      levels: [
        level(0, 180, 1, 0, 0),
        level(0, 360, 2, 0, 0),
        level(0, 720, 3, 0, 0),
        level(0, 1_440, 4, 0, 0),
      ],
    },
    'overload-capacitor': {
      label: '과부하 축전기',
      description: '60초 충전 후 사용하면 포탑이 잠시 폭주합니다.',
      maxLevel: 1,
      levels: [level(0, 300, 60, 8, 0)],
    },
    'turret-enhancer': {
      label: '포탑 강화소',
      description: '상하좌우 수호 포탑을 1레벨 높입니다.',
      maxLevel: 1,
      levels: [level(0, 350, 1, 0, 0)],
    },
    'door-anchor': {
      label: '도어 앵커',
      description: '문이 부서질 때 한 번 4초 동안 버팁니다.',
      maxLevel: 1,
      levels: [level(0, 2_000, 4, 0, 0)],
    },
    'reflect-mirror': {
      label: '반사 거울',
      description: '문이 받은 피해의 5%를 귀신에게 돌려줍니다.',
      maxLevel: 1,
      levels: [level(0, 1_200, 0.05, 0, 0)],
    },
    'power-panel': {
      label: '배전 제어판',
      description: '한 모드를 강화하는 대신 다른 능력에 손해가 생깁니다.',
      maxLevel: 1,
      levels: [level(1_000, 0, 0, 0, 0)],
    },
    'cursed-contract': {
      label: '저주 계약서',
      description: '한 번만 사용할 수 있는 강력한 선택을 제안합니다.',
      maxLevel: 1,
      levels: [level(10_000, 0, 0, 0, 0)],
    },
    'soul-vial': {
      label: '영혼 저장병',
      description: '포탑 피해를 저장해 한 발의 충전 레이저로 바꿉니다.',
      maxLevel: 1,
      levels: [level(5_000, 0, 0.35, 0, 0)],
    },
    'hide-and-seek-doll': {
      label: '숨바꼭질 인형',
      description: '귀신의 공격 목표를 바꿉니다. 한 번만 사용 가능하니 신중하게 사용하세요.',
      maxLevel: 1,
      levels: [level(100, 0, 0, 0, 0)],
    },
    'starter-grave': {
      label: '잠든 무덤',
      description: '방을 점유하면 매초 골드 1을 얻습니다.',
      maxLevel: 1,
      levels: [level(0, 0, 1, 1, 0)],
    },
    'random-item': {
      label: '랜덤 보상',
      description: '랜덤 상자에서 나온 보상입니다. 필요 없으면 철거할 수 있습니다.',
      maxLevel: 1,
      levels: [level(0, 0, 0, 0, 0)],
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
        : 0;
    if (requiredBedLevel > 0 && context.bedLevel < requiredBedLevel)
      return `침대 Lv.${requiredBedLevel} 필요`;
    const requiredDoorLevel = targetLevel === 13 ? 13
      : targetLevel === 14 ? 14
        : targetLevel === 15 ? 15
          : 0;
    if (requiredDoorLevel > 0 && context.doorLevel < requiredDoorLevel)
      return `문 Lv.${requiredDoorLevel} 필요`;
  }
  return null;
}

export function buildingStats(kind: BuildingKind, requestedLevel: number): BuildingLevelStats {
  const normalizedLevel = Math.max(1, Math.floor(requestedLevel));
  const safeLevel = Math.min(BALANCE.buildings[kind].maxLevel, normalizedLevel);
  const definition = BALANCE.buildings[kind];
  if (!TURRETS.has(kind)) return definition.levels[safeLevel - 1] as BuildingLevelStats;
  const base = definition.levels[0] as BuildingLevelStats;
  if (kind === 'golden-turret') {
    const scale = 1 + (safeLevel - 1) * 0.5;
    // Golden turret fires exactly twice as fast as a guardian turret at the
    // same level. Character, skin, and item attack-speed modifiers apply
    // afterwards in the engine and therefore remain independent bonuses.
    const rateScale = Math.max(0.42, 1 - (safeLevel - 1) * 0.035);
    const guardianRate = Math.round(rateScale * 100) / 100;
    const cost = upgradeCostWithoutStats(kind, safeLevel);
    return {
      gold: cost.gold,
      power: cost.power,
      value: Math.round(base.value * scale),
      rate: guardianRate / 2,
      range: base.range,
    };
  }
  // A Lv.15 guardian keeps its final art, but adjacent enhancers may continue
  // its combat progression beyond the permanent cap. The invested level and
  // upgrade cost stay capped; only temporary damage/fire-rate stats advance.
  const combatLevel = kind === 'basic-turret' ? normalizedLevel : safeLevel;
  const scale = 1 + (combatLevel - 1) * 0.34;
  const rateScale = Math.max(0.42, 1 - (combatLevel - 1) * 0.035);
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

/** Golden judgment turret earns a doubling bounty whenever a shot hits. */
export function goldenTurretGoldPerShot(requestedLevel: number): number {
  const level = Math.min(
    BALANCE.buildings['golden-turret'].maxLevel,
    Math.max(1, Math.floor(requestedLevel)),
  );
  return 8 * 2 ** (level - 1);
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
