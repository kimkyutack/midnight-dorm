import type { ItemRarity } from './types';

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
  { id: 'mythic-ark', label: '신화의 방주', description: '매초 골드 500과 전력 150을 생산합니다.', rarity: 'mythic', weight: 0.04, effect: { goldPerSecond: 500, powerPerSecond: 150 } },
  { id: 'golden-ticket', label: '황금 티켓', description: '보유한 티켓 1장당 황금 심판 포탑을 한 대 설치할 수 있습니다.', rarity: 'legendary', weight: 0.45, effect: { goldenTurretTickets: 1 } },
  { id: 'void-cat', label: '공허 고양이', description: '0.5초마다 골드 10을 물어옵니다.', rarity: 'legendary', weight: 0.7, effect: { goldPerSecond: 20 } },
  { id: 'hundred-robot', label: '백전력 로봇', description: '매초 전력 100을 생산합니다.', rarity: 'legendary', weight: 0.5, effect: { powerPerSecond: 100 } },
  { id: 'red-lens', label: '붉은 조준 렌즈', description: '모든 포탑 피해가 45% 증가합니다.', rarity: 'epic', weight: 1.3, effect: { turretDamageMultiplier: 1.45 } },
  { id: 'time-gear', label: '멈춘 시계태엽', description: '모든 포탑의 발사 간격이 25% 짧아집니다.', rarity: 'epic', weight: 1.4, effect: { turretRateMultiplier: 0.75 } },
  { id: 'moon-battery', label: '월광 축전지', description: '매초 전력 8을 생산합니다.', rarity: 'epic', weight: 1.6, effect: { powerPerSecond: 8 } },
  { id: 'gold-frog', label: '황금 두꺼비', description: '매초 골드 4를 생산합니다.', rarity: 'epic', weight: 1.7, effect: { goldPerSecond: 4 } },
  { id: 'overdrive-core', label: '과충전 핵', description: '모든 포탑 피해가 28% 증가합니다.', rarity: 'epic', weight: 1.8, effect: { turretDamageMultiplier: 1.28 } },
  { id: 'eclipse-dynamo', label: '일식 다이너모', description: '매초 전력 14를 생산합니다.', rarity: 'epic', weight: 1.9, effect: { powerPerSecond: 14 } },
  { id: 'black-market-coin', label: '암시장 금화', description: '매초 골드 7을 생산합니다.', rarity: 'epic', weight: 2, effect: { goldPerSecond: 7 } },
  { id: 'iron-heart', label: '철문 심장', description: '문의 최대 내구도가 30% 증가합니다.', rarity: 'rare', weight: 3.2, effect: { doorHpMultiplier: 1.3 } },
  { id: 'long-scope', label: '심야 망원경', description: '포탑 사거리가 2칸 증가합니다.', rarity: 'rare', weight: 3.5, effect: { turretRangeBonus: 2 } },
  { id: 'repair-spider', label: '수리 거미', description: '문을 초당 3만큼 수리합니다.', rarity: 'rare', weight: 3.8, effect: { doorRepairPerSecond: 3 } },
  { id: 'turret-overhaul-kit', label: '포탑 일괄 강화 키트', description: '현재 설치된 모든 포탑의 레벨이 1 상승합니다.', rarity: 'rare', weight: 4, effect: { turretLevelIncrease: 1 } },
  { id: 'silver-moth', label: '은빛 나방', description: '매초 골드 1.5를 생산합니다.', rarity: 'rare', weight: 4.2, effect: { goldPerSecond: 1.5 } },
  { id: 'armored-hinge', label: '강철 경첩', description: '문의 최대 내구도가 18% 증가합니다.', rarity: 'rare', weight: 4.4, effect: { doorHpMultiplier: 1.18 } },
  { id: 'field-medkit', label: '현장 수리함', description: '문을 초당 1.8만큼 수리합니다.', rarity: 'rare', weight: 4.6, effect: { doorRepairPerSecond: 1.8 } },
  { id: 'tracking-chip', label: '추적 칩', description: '포탑 사거리가 1칸 증가합니다.', rarity: 'rare', weight: 4.8, effect: { turretRangeBonus: 1 } },
  { id: 'pocket-cell', label: '주머니 전지', description: '매초 전력 2를 생산합니다.', rarity: 'uncommon', weight: 7.2, effect: { powerPerSecond: 2 } },
  { id: 'oiled-spring', label: '기름 먹은 용수철', description: '포탑 발사 간격이 10% 짧아집니다.', rarity: 'uncommon', weight: 7.6, effect: { turretRateMultiplier: 0.9 } },
  { id: 'sharp-nail', label: '날카로운 못', description: '포탑 피해가 12% 증가합니다.', rarity: 'uncommon', weight: 8, effect: { turretDamageMultiplier: 1.12 } },
  { id: 'copper-pig', label: '구리 저금통', description: '매초 골드 0.5를 생산합니다.', rarity: 'uncommon', weight: 8.4, effect: { goldPerSecond: 0.5 } },
  { id: 'tiny-wrench', label: '작은 렌치', description: '문을 초당 0.8만큼 수리합니다.', rarity: 'uncommon', weight: 8.8, effect: { doorRepairPerSecond: 0.8 } },
  { id: 'reinforced-nails', label: '강화 못 묶음', description: '모든 포탑 피해가 8% 증가합니다.', rarity: 'uncommon', weight: 9.2, effect: { turretDamageMultiplier: 1.08 } },
  { id: 'tuned-rotor', label: '조율 로터', description: '포탑 발사 간격이 8% 짧아집니다.', rarity: 'uncommon', weight: 9.6, effect: { turretRateMultiplier: 0.92 } },
  { id: 'spare-fuse', label: '예비 퓨즈', description: '매초 전력 3을 생산합니다.', rarity: 'uncommon', weight: 10, effect: { powerPerSecond: 3 } },
  { id: 'cracked-mirror', label: '금 간 거울', description: '귀신 얼굴만 더 많이 보입니다.', rarity: 'common', weight: 0.8, effect: {} },
  { id: 'wet-socks', label: '축축한 양말', description: '누군가 두고 간 쓸모없는 양말입니다.', rarity: 'common', weight: 0.8, effect: {} },
] as const;

export function getRandomItem(itemId: string): RandomItemDefinition | undefined {
  return RANDOM_ITEMS.find((item) => item.id === itemId);
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
