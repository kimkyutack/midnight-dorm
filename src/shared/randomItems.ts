import type { ItemRarity } from './types';

export interface RandomItemEffect {
  goldPerSecond?: number;
  powerPerSecond?: number;
  turretDamageMultiplier?: number;
  turretRateMultiplier?: number;
  turretRangeBonus?: number;
  moveSpeedMultiplier?: number;
  doorRepairPerSecond?: number;
  doorHpMultiplier?: number;
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
  { gold: 60, power: 10 },
  { gold: 120, power: 20 },
  { gold: 200, power: 40 },
] as const;

export const RANDOM_ITEMS: readonly RandomItemDefinition[] = [
  { id: 'void-cat', label: '공허 고양이', description: '0.5초마다 골드 10을 물어옵니다.', rarity: 'legendary', weight: 0.35, effect: { goldPerSecond: 20 } },
  { id: 'hundred-robot', label: '백전력 로봇', description: '매초 전력 100을 생산합니다.', rarity: 'legendary', weight: 0.18, effect: { powerPerSecond: 100 } },
  { id: 'red-lens', label: '붉은 조준 렌즈', description: '모든 포탑 피해가 45% 증가합니다.', rarity: 'epic', weight: 1.1, effect: { turretDamageMultiplier: 1.45 } },
  { id: 'time-gear', label: '멈춘 시계태엽', description: '모든 포탑의 발사 간격이 25% 짧아집니다.', rarity: 'epic', weight: 1.2, effect: { turretRateMultiplier: 0.75 } },
  { id: 'moon-battery', label: '월광 축전지', description: '매초 전력 8을 생산합니다.', rarity: 'epic', weight: 1.4, effect: { powerPerSecond: 8 } },
  { id: 'gold-frog', label: '황금 두꺼비', description: '매초 골드 4를 생산합니다.', rarity: 'epic', weight: 1.5, effect: { goldPerSecond: 4 } },
  { id: 'iron-heart', label: '철문 심장', description: '문의 최대 내구도가 30% 증가합니다.', rarity: 'rare', weight: 3.1, effect: { doorHpMultiplier: 1.3 } },
  { id: 'long-scope', label: '심야 망원경', description: '포탑 사거리가 2칸 증가합니다.', rarity: 'rare', weight: 3.4, effect: { turretRangeBonus: 2 } },
  { id: 'repair-spider', label: '수리 거미', description: '문을 초당 3만큼 수리합니다.', rarity: 'rare', weight: 3.8, effect: { doorRepairPerSecond: 3 } },
  { id: 'runner-shoes', label: '핏빛 운동화', description: '플레이어 이동 속도가 25% 증가합니다.', rarity: 'rare', weight: 4, effect: { moveSpeedMultiplier: 1.25 } },
  { id: 'silver-moth', label: '은빛 나방', description: '매초 골드 1.5를 생산합니다.', rarity: 'rare', weight: 4.2, effect: { goldPerSecond: 1.5 } },
  { id: 'pocket-cell', label: '주머니 전지', description: '매초 전력 2를 생산합니다.', rarity: 'uncommon', weight: 7, effect: { powerPerSecond: 2 } },
  { id: 'oiled-spring', label: '기름 먹은 용수철', description: '포탑 발사 간격이 10% 짧아집니다.', rarity: 'uncommon', weight: 7.5, effect: { turretRateMultiplier: 0.9 } },
  { id: 'sharp-nail', label: '날카로운 못', description: '포탑 피해가 12% 증가합니다.', rarity: 'uncommon', weight: 8, effect: { turretDamageMultiplier: 1.12 } },
  { id: 'copper-pig', label: '구리 저금통', description: '매초 골드 0.5를 생산합니다.', rarity: 'uncommon', weight: 8.5, effect: { goldPerSecond: 0.5 } },
  { id: 'tiny-wrench', label: '작은 렌치', description: '문을 초당 0.8만큼 수리합니다.', rarity: 'uncommon', weight: 9, effect: { doorRepairPerSecond: 0.8 } },
  { id: 'paper-crown', label: '종이 왕관', description: '그럴듯하지만 아무 효과도 없습니다.', rarity: 'common', weight: 14, effect: {} },
  { id: 'cracked-mirror', label: '금 간 거울', description: '귀신 얼굴만 더 많이 보입니다.', rarity: 'common', weight: 14, effect: {} },
  { id: 'wet-socks', label: '축축한 양말', description: '누군가 두고 간 쓸모없는 양말입니다.', rarity: 'common', weight: 14, effect: {} },
  { id: 'bent-spoon', label: '휘어진 숟가락', description: '무기로도 장식으로도 애매합니다.', rarity: 'common', weight: 14, effect: {} },
  { id: 'empty-frame', label: '빈 액자', description: '안에는 아무것도 없습니다.', rarity: 'common', weight: 14, effect: {} },
  { id: 'dust-ball', label: '거대 먼지뭉치', description: '굉장히 크고 굉장히 쓸모없습니다.', rarity: 'common', weight: 14, effect: {} },
  { id: 'rubber-duck', label: '검은 고무오리', description: '누르면 낮게 울지만 효과는 없습니다.', rarity: 'common', weight: 13, effect: {} },
  { id: 'old-calendar', label: '작년 달력', description: '날짜가 맞지 않는 장식품입니다.', rarity: 'common', weight: 13, effect: {} },
  { id: 'fake-key', label: '가짜 열쇠', description: '어떤 문에도 맞지 않습니다.', rarity: 'common', weight: 13, effect: {} },
  { id: 'cold-teacup', label: '식은 찻잔', description: '차는 이미 다 식었습니다.', rarity: 'common', weight: 13, effect: {} },
  { id: 'mystery-rock', label: '평범한 돌', description: '정말 평범한 돌입니다.', rarity: 'common', weight: 13, effect: {} },
  { id: 'broken-radio', label: '고장 난 라디오', description: '잡음만 들리는 장식품입니다.', rarity: 'common', weight: 12, effect: {} },
  { id: 'one-glove', label: '한 짝 장갑', description: '반대쪽 장갑은 나오지 않습니다.', rarity: 'common', weight: 12, effect: {} },
  { id: 'wooden-fish', label: '나무 물고기', description: '배고픔도 방어도 해결하지 못합니다.', rarity: 'common', weight: 12, effect: {} },
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
    moveSpeedMultiplier: 1,
    doorRepairPerSecond: 0,
    doorHpMultiplier: 1,
  };
  for (const owned of itemIds) {
    const effect = getRandomItem(owned.itemId)?.effect;
    if (!effect) continue;
    result.goldPerSecond += (effect.goldPerSecond ?? 0) * owned.count;
    result.powerPerSecond += (effect.powerPerSecond ?? 0) * owned.count;
    result.turretDamageMultiplier *= Math.pow(effect.turretDamageMultiplier ?? 1, owned.count);
    result.turretRateMultiplier *= Math.pow(effect.turretRateMultiplier ?? 1, owned.count);
    result.turretRangeBonus += (effect.turretRangeBonus ?? 0) * owned.count;
    result.moveSpeedMultiplier *= Math.pow(effect.moveSpeedMultiplier ?? 1, owned.count);
    result.doorRepairPerSecond += (effect.doorRepairPerSecond ?? 0) * owned.count;
    result.doorHpMultiplier *= Math.pow(effect.doorHpMultiplier ?? 1, owned.count);
  }
  return result;
}
