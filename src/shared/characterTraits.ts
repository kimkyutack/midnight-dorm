import { skinTraitMultiplier, skinTraitOverride } from './customization';
import type { AvatarAppearance } from './types';

export type CharacterTraitId =
  | 'none'
  | 'turret-damage'
  | 'turret-speed'
  | 'gold-income'
  | 'extra-draw'
  | 'starter-turret'
  | 'croc-bite'
  | 'duck-treasure'
  | 'tiger-range'
  | 'dino-overdrive'
  | 'monkey-luck'
  | 'gorilla-bastion'
  | 'skin-special';

export interface CharacterTrait {
  id: CharacterTraitId;
  label: string;
  description: string;
  turretDamageMultiplier: number;
  turretRateMultiplier: number;
  goldPerSecond: number;
  extraDraws: number;
  unclaimedMoveSpeedMultiplier: number;
  turretRangeBonus: number;
  /** Added to Lv.1 for the first guardian turret the player constructs. */
  firstGuardianLevelBonus: number;
  /** Added to Lv.1 when the player first occupies a room. */
  occupiedDoorLevelBonus: number;
}

const NONE: CharacterTrait = {
  id: 'none',
  label: '기본 생존자',
  description: '추가 특성 없이 균형 잡힌 생존자입니다.',
  turretDamageMultiplier: 1,
  turretRateMultiplier: 1,
  goldPerSecond: 0,
  extraDraws: 0,
  unclaimedMoveSpeedMultiplier: 1,
  turretRangeBonus: 0,
  firstGuardianLevelBonus: 0,
  occupiedDoorLevelBonus: 0,
};

/** 캐릭터 외형은 서버가 판정하는 고유 특성 하나와 정확히 대응한다. */
export const CHARACTER_TRAITS: Readonly<Record<string, CharacterTrait>> = {
  'character-bunny': NONE,
  'character-cat': {
    ...NONE,
    id: 'turret-speed',
    label: '고양이 반사신경',
    description: '모든 포탑의 공격속도가 15% 증가합니다.',
    turretRateMultiplier: 1 / 1.15,
  },
  'character-puppy': {
    ...NONE,
    id: 'gold-income',
    label: '행운의 발자국',
    description: '침대를 점유한 동안 초당 골드 획득량이 1 증가합니다.',
    goldPerSecond: 1,
  },
  'character-bear': {
    ...NONE,
    id: 'turret-damage',
    label: '든든한 사수',
    description: '모든 포탑의 피해가 10% 증가합니다.',
    turretDamageMultiplier: 1.1,
  },
  'character-fox': {
    ...NONE,
    id: 'extra-draw',
    label: '별빛 행운',
    description: '램프 랜덤 뽑기를 한 판에 1회 더 사용할 수 있습니다.',
    extraDraws: 1,
  },
  'character-hamster': {
    ...NONE,
    id: 'starter-turret',
    label: '꼬마 설계자',
    description: '처음 건설하는 수호 포탑이 Lv.2로 시작합니다.',
    firstGuardianLevelBonus: 1,
  },
  'character-crocodile': {
    ...NONE,
    id: 'croc-bite',
    label: '늪지의 턱힘',
    description: '모든 포탑의 피해가 35% 증가합니다.',
    turretDamageMultiplier: 1.35,
  },
  'character-duck': {
    ...NONE,
    id: 'duck-treasure',
    label: '달빛 저금통',
    description: '침대를 점유한 동안 초당 골드 획득량이 3 증가합니다.',
    goldPerSecond: 3,
  },
  'character-tiger': {
    ...NONE,
    id: 'tiger-range',
    label: '맹수의 시야',
    description: '모든 수호 포탑의 사거리가 1칸 증가합니다.',
    turretRangeBonus: 1,
  },
  'character-dinosaur': {
    ...NONE,
    id: 'dino-overdrive',
    label: '별빛 과충전',
    description: '모든 포탑의 공격속도가 40% 증가합니다.',
    turretRateMultiplier: 1 / 1.4,
  },
  'character-monkey': {
    ...NONE,
    id: 'monkey-luck',
    label: '행운의 손재주',
    description: '램프 랜덤 뽑기를 한 판에 2회 더 사용할 수 있습니다.',
    extraDraws: 2,
  },
  'character-gorilla': {
    ...NONE,
    id: 'gorilla-bastion',
    label: '요새 보강',
    description: '방을 점유하면 문이 Lv.2가 됩니다.',
    occupiedDoorLevelBonus: 1,
  },
};

export const characterTrait = (characterId: string): CharacterTrait =>
  CHARACTER_TRAITS[characterId] ?? NONE;

/**
 * A complete skin is an authored unit, so its passive is scaled as an effect
 * (not by multiplying the raw cooldown multiplier). Future skins can supply a
 * different multiplier in the cosmetic catalogue without changing combat code.
 */
export const characterTraitForAppearance = (appearance: AvatarAppearance): CharacterTrait => {
  const base = characterTrait(appearance.character);
  const multiplier = skinTraitMultiplier(appearance);
  const special = skinTraitOverride(appearance);
  if (multiplier === 1 && !special) return base;
  const boostedMultiplier = (value: number): number => 1 + (value - 1) * multiplier;
  const attackSpeed = 1 / Math.max(0.1, base.turretRateMultiplier);
  const boosted: CharacterTrait = {
    ...base,
    label: `${base.label} · 스킨 강화`,
    description: `스킨 효과: ${base.description.replace(/합니다\.$/, '')} 효과가 ${Math.round(multiplier * 100)}%로 적용됩니다.`,
    turretDamageMultiplier: boostedMultiplier(base.turretDamageMultiplier),
    turretRateMultiplier: 1 / (1 + (attackSpeed - 1) * multiplier),
    goldPerSecond: base.goldPerSecond * multiplier,
    extraDraws: Math.round(base.extraDraws * multiplier),
    unclaimedMoveSpeedMultiplier: boostedMultiplier(base.unclaimedMoveSpeedMultiplier),
    turretRangeBonus: base.turretRangeBonus * multiplier,
    firstGuardianLevelBonus: Math.round(base.firstGuardianLevelBonus * multiplier),
    occupiedDoorLevelBonus: Math.round(base.occupiedDoorLevelBonus * multiplier),
  };
  if (!special) return boosted;
  return {
    ...boosted,
    id: 'skin-special',
    label: special.label,
    description: special.description,
    turretDamageMultiplier: special.turretDamageMultiplier ?? boosted.turretDamageMultiplier,
    turretRateMultiplier: special.turretRateMultiplier ?? boosted.turretRateMultiplier,
    goldPerSecond: special.goldPerSecond ?? boosted.goldPerSecond,
    extraDraws: special.extraDraws ?? boosted.extraDraws,
    unclaimedMoveSpeedMultiplier: special.unclaimedMoveSpeedMultiplier ?? boosted.unclaimedMoveSpeedMultiplier,
    turretRangeBonus: special.turretRangeBonus ?? boosted.turretRangeBonus,
    firstGuardianLevelBonus: special.firstGuardianLevelBonus ?? boosted.firstGuardianLevelBonus,
    occupiedDoorLevelBonus: special.occupiedDoorLevelBonus ?? boosted.occupiedDoorLevelBonus,
  };
};

export const BASE_DRAW_LIMIT = 4;

export const drawLimitForCharacter = (characterId: string): number =>
  BASE_DRAW_LIMIT + characterTrait(characterId).extraDraws;

export const drawLimitForAppearance = (appearance: AvatarAppearance): number =>
  BASE_DRAW_LIMIT + characterTraitForAppearance(appearance).extraDraws;
