import type { ConsumableId, ConsumableTarget } from './types';

export interface ShopConsumableDefinition {
  id: ConsumableId;
  label: string;
  description: string;
  price: number;
  target: ConsumableTarget;
  icon: string;
  category: 'scout' | 'survival' | 'construction';
}

/**
 * 상점 전술 보급은 랜덤 상자 보상과 의도적으로 별도 카탈로그를 사용한다.
 * 한 판에 선택한 보급품은 각각 한 번만 사용할 수 있으며, 실제 사용 시에만
 * 계정 재고가 차감된다.
 */
export const SHOP_CONSUMABLES = [
  { id: 'scout-flare', label: '정찰 조명탄', description: '복도 반경 8칸의 귀신 위치를 8초간 드러냅니다.', price: 90, target: 'tile', icon: '◉', category: 'scout' },
  { id: 'path-chalk', label: '야광 분필', description: '빈 침대까지 가는 안전 경로를 12초간 표시합니다.', price: 80, target: 'self', icon: '⌁', category: 'scout' },
  { id: 'adrenal-shot', label: '아드레날린 주사', description: '침대를 점유하지 않은 상태에서 4초간 이동속도가 45% 증가합니다.', price: 150, target: 'self', icon: '↗', category: 'scout' },
  { id: 'quiet-slippers', label: '무소음 슬리퍼', description: '6초간 귀신의 복도 우선 추적 대상에서 제외됩니다.', price: 120, target: 'self', icon: '◌', category: 'scout' },
  { id: 'room-beacon', label: '방호 비콘', description: '10초간 현재 방을 귀신의 새 목표 선택에서 제외합니다.', price: 130, target: 'room', icon: '⌾', category: 'scout' },
  { id: 'echo-lens', label: '메아리 렌즈', description: '선택 복도 반경 12칸의 귀신 위치를 10초간 드러냅니다.', price: 170, target: 'tile', icon: '◍', category: 'scout' },
  { id: 'moon-compass', label: '월광 나침반', description: '빈 침대까지 가는 안전 경로를 18초간 표시합니다.', price: 140, target: 'self', icon: '✥', category: 'scout' },
  { id: 'sprint-candy', label: '질주 사탕', description: '침대를 점유하지 않은 상태에서 6초간 이동속도가 65% 증가합니다.', price: 210, target: 'self', icon: '»', category: 'scout' },
  { id: 'mist-cape', label: '안개 망토', description: '8초간 귀신의 복도 우선 추적 대상에서 제외됩니다.', price: 220, target: 'self', icon: '≈', category: 'scout' },
  { id: 'rescue-whistle', label: '구조 호루라기', description: '12초간 빈 침대 점유 상호작용 거리가 2칸으로 늘어납니다.', price: 200, target: 'self', icon: '♬', category: 'scout' },

  { id: 'quick-mortar', label: '속건 보수제', description: '파괴되지 않은 문의 HP를 즉시 70 회복합니다.', price: 160, target: 'door', icon: '✚', category: 'survival' },
  { id: 'hinge-brace', label: '경첩 지지대', description: '15초간 선택 문이 받는 피해를 25% 줄입니다.', price: 190, target: 'door', icon: '▣', category: 'survival' },
  { id: 'ward-seal', label: '결계 봉인서', description: '3초간 선택 문을 귀신 공격으로부터 보호합니다.', price: 260, target: 'door', icon: '✧', category: 'survival' },
  { id: 'repair-window', label: '수리 시간창', description: '선택 문의 자연 회복 대기 시간을 즉시 끝냅니다.', price: 150, target: 'door', icon: '◴', category: 'survival' },
  { id: 'last-latch', label: '최후의 걸쇠', description: '문 HP가 15% 이하가 될 때 4초간 파괴를 막도록 미리 장착합니다.', price: 230, target: 'door', icon: '⚿', category: 'survival' },
  { id: 'emergency-bedroll', label: '응급 침낭', description: '8초간 빈 침대 점유 상호작용 거리가 1.5칸으로 늘어납니다.', price: 170, target: 'self', icon: '▰', category: 'survival' },
  { id: 'patch-paste', label: '긴급 보수 퍼티', description: '파괴되지 않은 문의 HP를 즉시 120 회복합니다.', price: 240, target: 'door', icon: '▤', category: 'survival' },
  { id: 'steel-rivet', label: '강철 리벳 세트', description: '20초간 선택 문이 받는 피해를 35% 줄입니다.', price: 280, target: 'door', icon: '⬢', category: 'survival' },
  { id: 'ice-seal', label: '서리 결계서', description: '5초간 선택 문을 귀신 공격으로부터 보호합니다.', price: 320, target: 'door', icon: '❄', category: 'survival' },
  { id: 'rewind-clock', label: '되감기 시계', description: '선택 문의 자연 회복 대기 시간을 즉시 끝냅니다.', price: 210, target: 'door', icon: '◷', category: 'survival' },

  { id: 'toolbelt-voucher', label: '공구 벨트 교환권', description: '선택 설비의 다음 업그레이드 골드 비용을 35% 할인합니다.', price: 180, target: 'building', icon: '⚒', category: 'construction' },
  { id: 'calibrator-key', label: '정밀 보정키', description: '선택 설비의 다음 업그레이드 골드 비용을 15% 할인합니다.', price: 90, target: 'building', icon: '⌘', category: 'construction' },
  { id: 'turret-grease', label: '포탑 윤활유', description: '선택 설비의 다음 업그레이드 골드 비용을 25% 할인합니다.', price: 130, target: 'building', icon: '◐', category: 'construction' },
  { id: 'pulse-solder', label: '펄스 납땜기', description: '선택 설비의 다음 업그레이드 골드 비용을 30% 할인합니다.', price: 155, target: 'building', icon: 'ϟ', category: 'construction' },
  { id: 'spare-gears', label: '예비 기어 상자', description: '선택 설비의 다음 업그레이드 골드 비용을 32% 할인합니다.', price: 170, target: 'building', icon: '⚙', category: 'construction' },
  { id: 'copper-coil', label: '구리 코일 묶음', description: '선택 설비의 다음 업그레이드 골드 비용을 38% 할인합니다.', price: 210, target: 'building', icon: '∿', category: 'construction' },
  { id: 'lens-kit', label: '조준 렌즈 키트', description: '선택 설비의 다음 업그레이드 골드 비용을 40% 할인합니다.', price: 240, target: 'building', icon: '◉', category: 'construction' },
  { id: 'welding-gel', label: '냉각 용접젤', description: '선택 설비의 다음 업그레이드 골드 비용을 45% 할인합니다.', price: 290, target: 'building', icon: '▧', category: 'construction' },
  { id: 'blueprint-chip', label: '설계도 칩', description: '선택 설비의 다음 업그레이드 골드 비용을 50% 할인합니다.', price: 340, target: 'building', icon: '▱', category: 'construction' },
  { id: 'field-crane', label: '현장 크레인 호출권', description: '선택 설비의 다음 업그레이드 골드 비용을 60% 할인합니다.', price: 420, target: 'building', icon: '⌗', category: 'construction' },
] as const satisfies readonly ShopConsumableDefinition[];

export const SHOP_CONSUMABLE_IDS = new Set<ConsumableId>(SHOP_CONSUMABLES.map((item) => item.id));

export function shopConsumableById(id: string): ShopConsumableDefinition | undefined {
  return SHOP_CONSUMABLES.find((item) => item.id === id);
}

export function isConsumableTarget(value: unknown): value is ConsumableTarget {
  return value === 'self' || value === 'tile' || value === 'room' || value === 'door' || value === 'building';
}
