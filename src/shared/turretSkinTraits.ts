import type { TurretKind } from './types';

/**
 * 포탑 외형은 단순 장식이 아니라, 설치 시 건물에 기록되는 전투 보너스다.
 * 기본 스킨은 항상 중립이며 같은 포탑군에서는 더 높은 가격의 스킨이 더 높은
 * 수치를 제공한다.
 */
export interface TurretSkinTrait {
  turretKind: TurretKind;
  label: string;
  description: string;
  damageMultiplier: number;
  rateMultiplier: number;
  /** 1보다 클수록 서리포의 이동속도 감소량이 강해진다. */
  frostSlowStrengthMultiplier: number;
}

const neutral = (turretKind: TurretKind): TurretSkinTrait => ({
  turretKind,
  label: '표준 조정',
  description: '기본 외형입니다. 추가 전투 보너스가 없습니다.',
  damageMultiplier: 1,
  rateMultiplier: 1,
  frostSlowStrengthMultiplier: 1,
});

export const TURRET_SKIN_TRAITS: Readonly<Record<string, TurretSkinTrait>> = {
  'turret-basic-ward': neutral('basic-turret'),
  'turret-basic-toy': {
    ...neutral('basic-turret'),
    label: '별빛 탄환',
    description: '수호포 피해가 8% 증가합니다.',
    damageMultiplier: 1.08,
  },
  'turret-basic-pumpkin': {
    ...neutral('basic-turret'),
    label: '호박 폭발탄',
    description: '수호포 피해가 18% 증가하고 공격속도가 2% 증가합니다.',
    damageMultiplier: 1.18,
    rateMultiplier: 1 / 1.02,
  },
  'turret-rapid-firefly': neutral('rapid-turret'),
  'turret-rapid-candy': {
    ...neutral('rapid-turret'),
    label: '캔디 연사',
    description: '연사포 공격속도가 10% 증가합니다.',
    rateMultiplier: 1 / 1.1,
  },
  'turret-rapid-dragon': {
    ...neutral('rapid-turret'),
    label: '용의 기관포',
    description: '연사포 피해가 7%, 공격속도가 22% 증가합니다.',
    damageMultiplier: 1.07,
    rateMultiplier: 1 / 1.22,
  },
  'turret-frost-snow': neutral('frost-turret'),
  'turret-frost-globe': {
    ...neutral('frost-turret'),
    label: '빙결 구체',
    description: '서리포의 이동속도 감소 효과가 25% 강해집니다.',
    frostSlowStrengthMultiplier: 1.25,
  },
  'turret-frost-crystal': {
    ...neutral('frost-turret'),
    label: '수정 한파',
    description: '서리포 피해가 8%, 이동속도 감소 효과가 50% 강해집니다.',
    damageMultiplier: 1.08,
    frostSlowStrengthMultiplier: 1.5,
  },
  'turret-arc-storm': neutral('arc-turret'),
  'turret-arc-idol': {
    ...neutral('arc-turret'),
    label: '신상 증폭',
    description: '천둥포 피해가 14%, 공격속도가 7% 증가합니다.',
    damageMultiplier: 1.14,
    rateMultiplier: 1 / 1.07,
  },
  'turret-arc-crown': {
    ...neutral('arc-turret'),
    label: '왕실 폭뢰',
    description: '천둥포 피해가 28%, 공격속도가 19% 증가합니다.',
    damageMultiplier: 1.28,
    rateMultiplier: 1 / 1.19,
  },
};

export function turretSkinTrait(skinId: string, kind?: TurretKind): TurretSkinTrait {
  if (TURRET_SKIN_TRAITS[skinId]) return TURRET_SKIN_TRAITS[skinId];
  return neutral(kind ?? 'basic-turret');
}
