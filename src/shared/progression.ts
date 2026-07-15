import type { AccountProfile, PlayMode, RankId, StageId } from './types';

export const RANKS = [
  { id: 'beginner', label: '하수', minXp: 0 },
  { id: 'intermediate', label: '중수', minXp: 250 },
  { id: 'expert', label: '고수', minXp: 800 },
  { id: 'master', label: '초고수', minXp: 2_000 },
  { id: 'veteran', label: '베테랑', minXp: 5_000 },
  { id: 'legend', label: '레전드', minXp: 10_000 },
] as const satisfies ReadonlyArray<{ id: RankId; label: string; minXp: number }>;

export interface RankVisual {
  badgeSymbol: string;
  hatLabel: string;
}

export const RANK_VISUALS: Readonly<Record<RankId, RankVisual>> = {
  beginner: { badgeSymbol: '◇', hatLabel: '낡은 밀짚모자' },
  intermediate: { badgeSymbol: '◆', hatLabel: '생존자 캡모자' },
  expert: { badgeSymbol: '✦', hatLabel: '야간 스냅백' },
  master: { badgeSymbol: '♛', hatLabel: '은빛 왕관' },
  veteran: { badgeSymbol: '✪', hatLabel: '황금 지휘관 왕관' },
  legend: { badgeSymbol: '✺', hatLabel: '심연의 전설 왕관' },
};

const STAGE_TIERS = [
  { id: 'easy', label: '쉬움', count: 1 },
  { id: 'normal', label: '노말', count: 5 },
  { id: 'nightmare', label: '악몽', count: 10 },
  { id: 'hell', label: '지옥', count: 10 },
  { id: 'inferno', label: '불지옥', count: 15 },
  { id: 'epic', label: '에픽', count: 20 },
  { id: 'mythic', label: '신화', count: 25 },
  { id: 'legendary', label: '레전더리', count: 99 },
] as const;

const TOTAL_STAGE_COUNT = 185;

export type GhostStageSkill = 'turret-jam' | 'gold-lock' | 'repair-lock' | 'door-crush';

export interface StageDefinition {
  id: StageId;
  index: number;
  tier: string;
  level: number;
  label: string;
  hpMultiplier: number;
  damageMultiplier: number;
  speedMultiplier: number;
  levelHpGrowth: number;
  levelDamageGrowth: number;
  skillInterval: number;
  skills: GhostStageSkill[];
  victoryXp: number;
}

export const STAGES: readonly StageDefinition[] = STAGE_TIERS.flatMap((tier) =>
  Array.from({ length: tier.count }, (_, offset) => ({ tier, level: offset + 1 })),
).map(({ tier, level }, index) => {
  const pressure = index / (TOTAL_STAGE_COUNT - 1);
  const skills: GhostStageSkill[] = [];
  if (index >= 6) skills.push('turret-jam');
  if (index >= 16) skills.push('gold-lock');
  if (index >= 26) skills.push('repair-lock');
  if (index >= 41) skills.push('door-crush');
  return {
    id: `${tier.id}-${level}` as StageId,
    index,
    tier: tier.id,
    level,
    label: `${tier.label} ${level}`,
    hpMultiplier: Number((1 + index * 0.032 + pressure * pressure * 1.2).toFixed(3)),
    damageMultiplier: Number((1 + index * 0.023 + pressure * 0.8).toFixed(3)),
    speedMultiplier: Number(Math.min(1.62, 1 + index * 0.004).toFixed(3)),
    levelHpGrowth: Number(Math.min(0.58, 0.26 + index * 0.0019).toFixed(3)),
    levelDamageGrowth: Number(Math.min(0.5, 0.22 + index * 0.0017).toFixed(3)),
    skillInterval: Math.max(9, 28 - Math.floor(index / 10)),
    skills,
    victoryXp: 60 + index * 14,
  };
});

export interface RankBenefits {
  speedMultiplier: number;
  startingGoldBonus: number;
  startingPowerBonus: number;
  turretLevelBonus: number;
  rareTurretUnlocked: boolean;
  rareTurretDiscount: number;
}

const BENEFITS: Record<RankId, RankBenefits> = {
  beginner: { speedMultiplier: 1, startingGoldBonus: 0, startingPowerBonus: 0, turretLevelBonus: 0, rareTurretUnlocked: false, rareTurretDiscount: 0 },
  intermediate: { speedMultiplier: 1.05, startingGoldBonus: 10, startingPowerBonus: 0, turretLevelBonus: 0, rareTurretUnlocked: false, rareTurretDiscount: 0 },
  expert: { speedMultiplier: 1.07, startingGoldBonus: 15, startingPowerBonus: 5, turretLevelBonus: 0, rareTurretUnlocked: false, rareTurretDiscount: 0 },
  master: { speedMultiplier: 1.09, startingGoldBonus: 20, startingPowerBonus: 7, turretLevelBonus: 1, rareTurretUnlocked: false, rareTurretDiscount: 0 },
  veteran: { speedMultiplier: 1.11, startingGoldBonus: 30, startingPowerBonus: 10, turretLevelBonus: 1, rareTurretUnlocked: true, rareTurretDiscount: 0.15 },
  legend: { speedMultiplier: 1.14, startingGoldBonus: 45, startingPowerBonus: 15, turretLevelBonus: 2, rareTurretUnlocked: true, rareTurretDiscount: 0.3 },
};

export const rankIndex = (rank: RankId): number => Math.max(0, RANKS.findIndex((candidate) => candidate.id === rank));
export const rankLabel = (rank: RankId): string => RANKS[rankIndex(rank)]?.label ?? '하수';
export const rankBadgeSymbol = (rank: RankId): string => RANK_VISUALS[rank].badgeSymbol;
export const rankFromXp = (xp: number): RankId => [...RANKS].reverse().find((rank) => xp >= rank.minXp)?.id ?? 'beginner';
export const higherRank = (solo: RankId, multiplayer: RankId): RankId => rankIndex(solo) >= rankIndex(multiplayer) ? solo : multiplayer;
export const isEliteRank = (rank: RankId): boolean => rankIndex(rank) >= rankIndex('master');
export const rankBenefits = (rank: RankId): RankBenefits => BENEFITS[rank];

export function getStage(id: StageId | string | undefined): StageDefinition {
  return STAGES.find((stage) => stage.id === id) ?? STAGES[0] as StageDefinition;
}

export function unlockedStageIndex(profile: AccountProfile, mode: PlayMode): number {
  return mode === 'solo' ? profile.soloStageIndex : profile.multiplayerStageIndex;
}

export function stagesThrough(index: number): readonly StageDefinition[] {
  return STAGES.slice(0, Math.max(1, Math.min(STAGES.length, Math.floor(index) + 1)));
}
