import type { ConsumableId, ConsumableTarget } from './types';

export interface ShopConsumableDefinition {
  id: ConsumableId;
  label: string;
  description: string;
  price: number;
  target: ConsumableTarget;
  icon: string;
  category: 'assault' | 'defense' | 'engineering';
}

/**
 * 상점 전술 보급은 랜덤 상자 보상과 의도적으로 별도 카탈로그를 사용한다.
 * 랭크전은 선택한 보급품 3종만, 일반 모드는 보유한 모든 보급품을 사용할 수 있다.
 * 실제 사용 또는 설치가 승인된 시점에만 계정 재고가 차감된다.
 */
export const SHOP_CONSUMABLES = [
  { id: 'scout-flare', label: '섬광 충격탄', description: '선택 지점 주변 귀신에게 큰 피해를 주고 1.5초간 멈춥니다.', price: 200, target: 'tile', icon: '✹', category: 'assault' },
  { id: 'path-chalk', label: '취약 표식탄', description: '선택 지점 주변 귀신이 8초간 35% 더 큰 피해를 받습니다.', price: 180, target: 'tile', icon: '⌖', category: 'assault' },
  { id: 'adrenal-shot', label: '포탑 과충전제', description: '10초간 내 방의 모든 포탑 공격속도가 50% 빨라집니다.', price: 250, target: 'room', icon: 'ϟ', category: 'assault' },
  { id: 'room-beacon', label: '집중 사격 비콘', description: '10초간 내 방의 모든 포탑 공격력이 35% 증가합니다.', price: 270, target: 'room', icon: '◎', category: 'assault' },

  { id: 'quick-mortar', label: '긴급 문 수리 키트', description: '파괴되지 않은 문 HP를 즉시 160 회복합니다.', price: 180, target: 'door', icon: '✚', category: 'defense' },
  { id: 'hinge-brace', label: '합금 경첩 지지대', description: '15초간 문이 받는 피해를 35% 줄입니다.', price: 220, target: 'door', icon: '▣', category: 'defense' },
  { id: 'ward-seal', label: '절대 방호 봉인서', description: '4초간 문이 귀신의 피해를 받지 않습니다.', price: 300, target: 'door', icon: '✧', category: 'defense' },
  { id: 'last-latch', label: '최후의 걸쇠', description: '문이 파괴될 순간 4초간 HP가 1 아래로 내려가지 않습니다.', price: 250, target: 'door', icon: '⚿', category: 'defense' },

  { id: 'toolbelt-voucher', label: '집속 탄두 모듈', description: '선택 포탑의 다음 공격 피해가 3배가 됩니다.', price: 200, target: 'building', icon: '◈', category: 'engineering' },
  { id: 'turret-grease', label: '고속 윤활 카트리지', description: '선택 포탑의 공격속도가 12초간 45% 빨라집니다.', price: 200, target: 'building', icon: '◐', category: 'engineering' },
  { id: 'lens-kit', label: '장거리 조준 렌즈', description: '선택 포탑의 사거리가 12초간 2칸 증가합니다.', price: 220, target: 'building', icon: '◉', category: 'engineering' },
  { id: 'field-crane', label: '전술 강화 신호기', description: '12초간 내 방 모든 포탑이 1레벨 강해집니다.', price: 320, target: 'room', icon: '⌗', category: 'engineering' },
  { id: 'ghost-lure-beacon', label: '원혼 유도 송신기', description: '설치 후 최대 2회 모든 귀신을 내 방으로 유인합니다. 첫 사용 후 60초 재충전됩니다.', price: 450, target: 'install', icon: '◉', category: 'engineering' },
] as const satisfies readonly ShopConsumableDefinition[];

/** Existing inventories are collapsed into the closest new combat role. */
export const LEGACY_CONSUMABLE_REPLACEMENTS: Readonly<Partial<Record<ConsumableId, ConsumableId>>> = {
  'quiet-slippers': 'scout-flare',
  'echo-lens': 'scout-flare',
  'moon-compass': 'path-chalk',
  'sprint-candy': 'adrenal-shot',
  'mist-cape': 'path-chalk',
  'rescue-whistle': 'room-beacon',
  'repair-window': 'quick-mortar',
  'emergency-bedroll': 'quick-mortar',
  'patch-paste': 'quick-mortar',
  'steel-rivet': 'hinge-brace',
  'ice-seal': 'ward-seal',
  'rewind-clock': 'quick-mortar',
  'calibrator-key': 'toolbelt-voucher',
  'pulse-solder': 'turret-grease',
  'spare-gears': 'turret-grease',
  'copper-coil': 'turret-grease',
  'welding-gel': 'lens-kit',
  'blueprint-chip': 'field-crane',
};

export const SHOP_CONSUMABLE_IDS = new Set<ConsumableId>(SHOP_CONSUMABLES.map((item) => item.id));

export function shopConsumableById(id: string): ShopConsumableDefinition | undefined {
  return SHOP_CONSUMABLES.find((item) => item.id === id);
}

export function normalizeConsumableId(id: string): ConsumableId | null {
  const replacement = LEGACY_CONSUMABLE_REPLACEMENTS[id as ConsumableId] ?? id;
  return SHOP_CONSUMABLE_IDS.has(replacement as ConsumableId)
    ? replacement as ConsumableId
    : null;
}

export function isConsumableTarget(value: unknown): value is ConsumableTarget {
  return value === 'self' || value === 'tile' || value === 'room' || value === 'door' || value === 'building' || value === 'install';
}
