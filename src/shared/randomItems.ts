import type { BuildingState, ItemRarity } from './types';

export interface RandomItemEffect {
  goldPerSecond?: number;
  powerPerSecond?: number;
  turretDamageMultiplier?: number;
  turretRateMultiplier?: number;
  turretRangeBonus?: number;
  /** Applied immediately to the owner's turrets that already exist. */
  turretLevelIncrease?: number;
  doorRepairPerSecond?: number;
  doorHpMultiplier?: number;
  goldenTurretTickets?: number;
  /** Draws and corridor loot may turn directly into an upgradeable moon gem. */
  moonGem?: boolean;
}

export interface RandomItemDefinition {
  id: string;
  label: string;
  description: string;
  rarity: ItemRarity;
  weight: number;
  effect: RandomItemEffect;
}

export const DRAW_COSTS = [
  { gold: 40, power: 0 },
  { gold: 60, power: 0 },
  { gold: 120, power: 0 },
  { gold: 200, power: 0 },
  // 별여우의 고유 특성으로만 열리는 다섯 번째 뽑기 비용.
  { gold: 300, power: 0 },
  // 달원숭이의 고유 특성으로만 열리는 여섯 번째 뽑기 비용.
  { gold: 420, power: 0 },
] as const;

export const RANDOM_ITEMS: readonly RandomItemDefinition[] = [
  { id: 'mythic-ark', label: '블랙 카드', description: '매초 골드 500을 생산합니다.', rarity: 'mythic', weight: 0.04, effect: { goldPerSecond: 500 } },
  { id: 'golden-ticket', label: '황금 티켓', description: '보유한 티켓 1장당 황금 심판 포탑을 한 대 설치할 수 있습니다.', rarity: 'legendary', weight: 0.45, effect: { goldenTurretTickets: 1 } },
  { id: 'void-cat', label: '공허 고양이', description: '모든 포탑의 발사 간격이 30% 짧아집니다.', rarity: 'legendary', weight: 0.7, effect: { turretRateMultiplier: 0.7 } },
  { id: 'royal-money-tree', label: '황금 황소 동상', description: '매초 골드 100을 생산합니다.', rarity: 'legendary', weight: 0.18, effect: { goldPerSecond: 100 } },
  { id: 'golden-goose', label: '황금 두꺼비 동상', description: '매초 골드 50을 생산합니다.', rarity: 'legendary', weight: 0.34, effect: { goldPerSecond: 50 } },
  { id: 'hundred-robot', label: '백전력 로봇', description: '매초 전력 100을 생산합니다.', rarity: 'legendary', weight: 0.5, effect: { powerPerSecond: 100 } },
  { id: 'red-lens', label: '붉은 조준 렌즈', description: '모든 포탑 피해가 45% 증가합니다.', rarity: 'epic', weight: 1.3, effect: { turretDamageMultiplier: 1.45 } },
  { id: 'time-gear', label: '멈춘 시계태엽', description: '모든 포탑의 발사 간격이 25% 짧아집니다.', rarity: 'epic', weight: 1.4, effect: { turretRateMultiplier: 0.75 } },
  { id: 'moon-battery', label: '월광 축전지', description: '매초 전력 8을 생산합니다.', rarity: 'epic', weight: 1.6, effect: { powerPerSecond: 8 } },
  { id: 'gold-frog', label: '회색 돼지 저금통', description: '매초 골드 5를 생산합니다.', rarity: 'epic', weight: 2.1, effect: { goldPerSecond: 5 } },
  { id: 'overdrive-core', label: '과충전 핵', description: '모든 포탑 피해가 28% 증가합니다.', rarity: 'epic', weight: 1.8, effect: { turretDamageMultiplier: 1.28 } },
  { id: 'eclipse-dynamo', label: '일식 다이너모', description: '매초 전력 14를 생산합니다.', rarity: 'epic', weight: 1.9, effect: { powerPerSecond: 14 } },
  { id: 'black-market-coin', label: '빨간색 돼지 저금통', description: '매초 골드 10을 생산합니다.', rarity: 'epic', weight: 2.4, effect: { goldPerSecond: 10 } },
  { id: 'moon-piggy-bank', label: '달빛 돼지 저금통', description: '매초 골드 20을 생산합니다.', rarity: 'epic', weight: 1.9, effect: { goldPerSecond: 20 } },
  { id: 'moon-gem-reward', label: '월광 보석', description: '랜덤 레벨의 월광 보석으로 설치됩니다. 일반 보석처럼 강화할 수 있습니다.', rarity: 'rare', weight: 3.1, effect: { moonGem: true } },
  { id: 'candle-coin-chest', label: '도깨비 수리 금고', description: '문을 초당 25만큼 수리합니다.', rarity: 'rare', weight: 3.9, effect: { doorRepairPerSecond: 25 } },
  { id: 'iron-heart', label: '철문 심장', description: '문의 최대 내구도가 30% 증가합니다.', rarity: 'rare', weight: 3.2, effect: { doorHpMultiplier: 1.3 } },
  { id: 'long-scope', label: '심야 망원경', description: '포탑 사거리가 2칸 증가합니다.', rarity: 'rare', weight: 3.5, effect: { turretRangeBonus: 2 } },
  { id: 'repair-spider', label: '수리 거미', description: '문을 초당 3만큼 수리합니다.', rarity: 'rare', weight: 3.8, effect: { doorRepairPerSecond: 3 } },
  { id: 'turret-overhaul-kit', label: '포탑 일괄 강화 키트', description: '현재 설치된 모든 포탑의 레벨이 1 상승합니다.', rarity: 'rare', weight: 4, effect: { turretLevelIncrease: 1 } },
  { id: 'silver-moth', label: '닭 모양 동상', description: '매초 골드 2를 생산합니다.', rarity: 'rare', weight: 5.5, effect: { goldPerSecond: 2 } },
  { id: 'lucky-coin-pouch', label: '행운 전지 주머니', description: '매초 전력 5를 생산합니다.', rarity: 'rare', weight: 4.3, effect: { powerPerSecond: 5 } },
  { id: 'armored-hinge', label: '강철 경첩', description: '문의 최대 내구도가 18% 증가합니다.', rarity: 'rare', weight: 4.4, effect: { doorHpMultiplier: 1.18 } },
  { id: 'field-medkit', label: '현장 수리함', description: '문을 초당 18만큼 수리합니다.', rarity: 'rare', weight: 4.6, effect: { doorRepairPerSecond: 18 } },
  { id: 'tracking-chip', label: '추적 칩', description: '포탑 사거리가 1칸 증가합니다.', rarity: 'rare', weight: 4.8, effect: { turretRangeBonus: 1 } },
  { id: 'pocket-cell', label: '주머니 전지', description: '매초 전력 2를 생산합니다.', rarity: 'uncommon', weight: 7.2, effect: { powerPerSecond: 2 } },
  { id: 'oiled-spring', label: '기름 먹은 용수철', description: '포탑 발사 간격이 10% 짧아집니다.', rarity: 'uncommon', weight: 7.6, effect: { turretRateMultiplier: 0.9 } },
  { id: 'sharp-nail', label: '날카로운 못', description: '포탑 피해가 12% 증가합니다.', rarity: 'uncommon', weight: 8, effect: { turretDamageMultiplier: 1.12 } },
  { id: 'copper-pig', label: '무덤 저금통', description: '매초 골드 1을 생산합니다.', rarity: 'uncommon', weight: 10.5, effect: { goldPerSecond: 1 } },
  { id: 'coin-candle', label: '동전 촛불', description: '매초 전력 1을 생산합니다.', rarity: 'uncommon', weight: 10.5, effect: { powerPerSecond: 1 } },
  { id: 'tiny-wrench', label: '작은 렌치', description: '문을 초당 8만큼 수리합니다.', rarity: 'uncommon', weight: 8.8, effect: { doorRepairPerSecond: 8 } },
  { id: 'reinforced-nails', label: '강화 못 묶음', description: '모든 포탑 피해가 8% 증가합니다.', rarity: 'uncommon', weight: 9.2, effect: { turretDamageMultiplier: 1.08 } },
  { id: 'tuned-rotor', label: '조율 로터', description: '포탑 발사 간격이 8% 짧아집니다.', rarity: 'uncommon', weight: 9.6, effect: { turretRateMultiplier: 0.92 } },
  { id: 'spare-fuse', label: '예비 퓨즈', description: '매초 전력 3을 생산합니다.', rarity: 'uncommon', weight: 10, effect: { powerPerSecond: 3 } },
  { id: 'cracked-mirror', label: '금 간 거울', description: '귀신 얼굴만 더 많이 보입니다.', rarity: 'common', weight: 0.8, effect: {} },
  { id: 'wet-socks', label: '축축한 양말', description: '누군가 두고 간 쓸모없는 양말입니다.', rarity: 'common', weight: 0.8, effect: {} },
] as const;

export function getRandomItem(itemId: string): RandomItemDefinition | undefined {
  return RANDOM_ITEMS.find((item) => item.id === itemId);
}

/** True only when a placed structure's own recurring output includes gold. */
export function isGoldProducingBuilding(
  building: Pick<BuildingState, 'kind' | 'itemId'>,
): boolean {
  if (building.kind === 'gem-core' || building.kind === 'starter-grave')
    return true;
  return Boolean(
    building.kind === 'random-item' &&
      (getRandomItem(building.itemId ?? '')?.effect.goldPerSecond ?? 0) > 0,
  );
}

const weightedPick = (
  items: readonly RandomItemDefinition[],
  rollUnit: number,
): RandomItemDefinition | undefined => {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return items[items.length - 1];
  let roll = Math.min(0.999999999, Math.max(0, rollUnit)) * totalWeight;
  return items.find((item) => (roll -= item.weight) <= 0) ?? items[items.length - 1];
};

/**
 * Selects one random-box reward while allowing authored skins to add a small,
 * explicit probability-point bonus to the legendary/mythic pool. The bonus
 * changes only which rarity pool is chosen; relative weights inside each pool
 * stay intact, so existing reward balance remains recognizable.
 */
export function randomItemForRoll(
  rollUnit: number,
  highRarityChanceBonus = 0,
): RandomItemDefinition | undefined {
  const roll = Math.min(0.999999999, Math.max(0, rollUnit));
  const bonus = Math.min(0.95, Math.max(0, highRarityChanceBonus));
  if (bonus <= 0) return weightedPick(RANDOM_ITEMS, roll);

  const highRarity = RANDOM_ITEMS.filter(
    (item) => item.rarity === 'legendary' || item.rarity === 'mythic',
  );
  const standardRarity = RANDOM_ITEMS.filter(
    (item) => item.rarity !== 'legendary' && item.rarity !== 'mythic',
  );
  const highWeight = highRarity.reduce((sum, item) => sum + item.weight, 0);
  const standardWeight = standardRarity.reduce((sum, item) => sum + item.weight, 0);
  const baseHighChance = highWeight / Math.max(1, highWeight + standardWeight);
  const highChance = Math.min(0.99, baseHighChance + bonus);
  if (roll < highChance) {
    return weightedPick(highRarity, roll / highChance);
  }
  return weightedPick(standardRarity, (roll - highChance) / (1 - highChance));
}

export function combinedItemEffects(itemIds: readonly { itemId: string; count: number }[]): Required<RandomItemEffect> {
  const result: Required<RandomItemEffect> = {
    goldPerSecond: 0,
    powerPerSecond: 0,
    turretDamageMultiplier: 1,
    turretRateMultiplier: 1,
    turretRangeBonus: 0,
    turretLevelIncrease: 0,
    doorRepairPerSecond: 0,
    doorHpMultiplier: 1,
    goldenTurretTickets: 0,
    moonGem: false,
  };
  for (const owned of itemIds) {
    const effect = getRandomItem(owned.itemId)?.effect;
    if (!effect) continue;
    result.goldPerSecond += (effect.goldPerSecond ?? 0) * owned.count;
    result.powerPerSecond += (effect.powerPerSecond ?? 0) * owned.count;
    result.turretDamageMultiplier *= Math.pow(effect.turretDamageMultiplier ?? 1, owned.count);
    result.turretRateMultiplier *= Math.pow(effect.turretRateMultiplier ?? 1, owned.count);
    result.turretRangeBonus += (effect.turretRangeBonus ?? 0) * owned.count;
    result.doorRepairPerSecond += (effect.doorRepairPerSecond ?? 0) * owned.count;
    result.doorHpMultiplier *= Math.pow(effect.doorHpMultiplier ?? 1, owned.count);
    result.goldenTurretTickets += (effect.goldenTurretTickets ?? 0) * owned.count;
  }
  return result;
}
