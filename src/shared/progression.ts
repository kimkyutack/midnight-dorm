import type { AccountProfile, DifficultyRuleState, PlayMode, RankedTier, RankId, StageId } from './types';

export const RANKS = [
  { id: 'beginner', label: '하수', minXp: 0 },
  { id: 'intermediate', label: '중수', minXp: 250 },
  { id: 'expert', label: '고수', minXp: 800 },
  { id: 'master', label: '초고수', minXp: 2_000 },
  { id: 'veteran', label: '베테랑', minXp: 5_000 },
  { id: 'legend', label: '레전드', minXp: 10_000 },
  { id: 'transcendent', label: '초월', minXp: 20_000 },
  { id: 'immortal', label: '불멸', minXp: 50_000 },
  { id: 'absolute', label: '절대자', minXp: 100_000 },
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
  transcendent: { badgeSymbol: '✧', hatLabel: '초월의 성광관' },
  immortal: { badgeSymbol: '♜', hatLabel: '불멸의 영혼관' },
  absolute: { badgeSymbol: '✹', hatLabel: '절대자의 천공관' },
};

const STAGE_TIERS = [
  { id: 'easy', label: '쉬움', count: 1 },
  { id: 'normal', label: '노말', count: 5 },
  { id: 'hard', label: '어려움', count: 5 },
  { id: 'nightmare', label: '악몽', count: 10 },
  { id: 'hell', label: '지옥', count: 10 },
  { id: 'inferno', label: '불지옥', count: 15 },
  { id: 'epic', label: '에픽', count: 20 },
  { id: 'mythic', label: '신화', count: 25 },
  { id: 'legendary', label: '레전더리', count: 30 },
  { id: 'calamity', label: '재앙', count: 35 },
  { id: 'cataclysm', label: '대재앙', count: 40 },
  { id: 'ruin', label: '파멸', count: 50 },
  { id: 'apocalypse', label: '종말', count: 99 },
] as const;

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

export interface DifficultyModifierPreset {
  timeAttackChance: number;
  controlAdaptation: boolean;
  barrierLayers: number;
  directionalShield: boolean;
}

/** A non-progression stage used until the account records its first victory. */
export const TUTORIAL_STAGE: StageDefinition = {
  id: 'tutorial-1',
  index: -1,
  tier: 'tutorial',
  level: 1,
  label: '생존 훈련',
  hpMultiplier: 1,
  damageMultiplier: 0.45,
  speedMultiplier: 0.72,
  levelHpGrowth: 0,
  levelDamageGrowth: 0,
  skillInterval: 999,
  skills: [],
  victoryXp: 80,
};

export const TIME_ATTACK_EXPIRED_MESSAGE =
  '시간이 초과 되어 귀신이 더욱 강력해집니다';

const DIFFICULTY_MODIFIERS: Readonly<Record<string, DifficultyModifierPreset>> = {
  easy: { timeAttackChance: 0, controlAdaptation: false, barrierLayers: 0, directionalShield: false },
  normal: { timeAttackChance: 0, controlAdaptation: false, barrierLayers: 0, directionalShield: false },
  hard: { timeAttackChance: 0, controlAdaptation: false, barrierLayers: 0, directionalShield: false },
  nightmare: { timeAttackChance: 0.07, controlAdaptation: true, barrierLayers: 0, directionalShield: false },
  hell: { timeAttackChance: 0.12, controlAdaptation: true, barrierLayers: 1, directionalShield: false },
  // Directional shielding already adds a second strategy requirement at
  // inferno. Keeping the old extra barrier layer on top of it made the first
  // mid-game wall much steeper than the numeric stage curve suggested.
  inferno: { timeAttackChance: 0.18, controlAdaptation: true, barrierLayers: 1, directionalShield: true },
  epic: { timeAttackChance: 0.25, controlAdaptation: true, barrierLayers: 2, directionalShield: true },
  mythic: { timeAttackChance: 0.30, controlAdaptation: true, barrierLayers: 3, directionalShield: true },
  legendary: { timeAttackChance: 0.35, controlAdaptation: true, barrierLayers: 4, directionalShield: true },
  calamity: { timeAttackChance: 0.40, controlAdaptation: true, barrierLayers: 5, directionalShield: true },
  cataclysm: { timeAttackChance: 0.45, controlAdaptation: true, barrierLayers: 6, directionalShield: true },
  ruin: { timeAttackChance: 0.50, controlAdaptation: true, barrierLayers: 7, directionalShield: true },
  apocalypse: { timeAttackChance: 0.55, controlAdaptation: true, barrierLayers: 8, directionalShield: true },
};

/** The random roll is made once by the room engine and then stored in its snapshot. */
export function difficultyRuleForStage(stage: StageDefinition, timeAttack = false): DifficultyRuleState {
  const preset = DIFFICULTY_MODIFIERS[stage.tier] ?? (DIFFICULTY_MODIFIERS.easy as DifficultyModifierPreset);
  return {
    modifier: timeAttack ? 'time-attack' : 'none',
    introRemaining: timeAttack ? 2 : 0,
    timeAttackRemaining: timeAttack ? 300 : null,
    overtimeStacks: 0,
    controlAdaptation: preset.controlAdaptation,
    barrierLayers: preset.barrierLayers,
    directionalShield: preset.directionalShield,
  };
}

export function timeAttackChanceForStage(stage: StageDefinition): number {
  return (DIFFICULTY_MODIFIERS[stage.tier] ?? (DIFFICULTY_MODIFIERS.easy as DifficultyModifierPreset)).timeAttackChance;
}

export const RANKED_TIER_LABEL: Readonly<Record<RankedTier, string>> = {
  bronze: '브론즈', silver: '실버', gold: '골드', platinum: '플래티넘',
  diamond: '다이아몬드', master: '마스터', challenger: '챌린저',
};

export function rankedTierForRating(rating: number): RankedTier {
  if (rating >= 2_400) return 'challenger';
  if (rating >= 2_000) return 'master';
  if (rating >= 1_650) return 'diamond';
  if (rating >= 1_350) return 'platinum';
  if (rating >= 1_100) return 'gold';
  if (rating >= 850) return 'silver';
  return 'bronze';
}

export const rankedBadgeImage = (tier: RankedTier): string => `/assets/ranks/season-${tier}.png`;
export const rankedCrownImage = (tier: 'bronze' | 'silver' | 'gold'): string => `/assets/ranks/crown-${tier}.png`;

/**
 * Alpha-content measurements for the rank artwork canvases. The source PNGs
 * use the same 512px canvas but have very different transparent padding; the
 * three SVG ranks use a 128px viewBox. DOM and Three.js renderers share these
 * measurements so every badge has one visual size and a true center anchor.
 */
export interface BadgeArtworkLayout {
  canvasSize: number;
  centerX: number;
  centerY: number;
  visualExtent: number;
}

export interface BadgeArtworkViewport {
  cssScale: number;
  cssShiftXPercent: number;
  cssShiftYPercent: number;
  textureOffsetX: number;
  textureOffsetY: number;
  textureRepeat: number;
}

export const BADGE_TARGET_VISUAL_FILL = 0.9;

const RANK_BADGE_ARTWORK: Readonly<Record<RankId, BadgeArtworkLayout>> = {
  beginner: { canvasSize: 512, centerX: 296, centerY: 274, visualExtent: 330 },
  intermediate: { canvasSize: 512, centerX: 253, centerY: 273.5, visualExtent: 341 },
  expert: { canvasSize: 512, centerX: 202, centerY: 273, visualExtent: 354 },
  master: { canvasSize: 512, centerX: 295, centerY: 225, visualExtent: 342 },
  veteran: { canvasSize: 512, centerX: 251.5, centerY: 230.5, visualExtent: 371 },
  legend: { canvasSize: 512, centerX: 202.5, centerY: 224, visualExtent: 362 },
  transcendent: { canvasSize: 128, centerX: 64, centerY: 64.5, visualExtent: 119 },
  immortal: { canvasSize: 128, centerX: 64, centerY: 64, visualExtent: 118 },
  absolute: { canvasSize: 128, centerX: 64, centerY: 64.5, visualExtent: 121 },
};

const RANKED_BADGE_ARTWORK: Readonly<Record<RankedTier, BadgeArtworkLayout>> = {
  bronze: { canvasSize: 512, centerX: 265.5, centerY: 254.5, visualExtent: 329 },
  silver: { canvasSize: 512, centerX: 262, centerY: 252.5, visualExtent: 341 },
  gold: { canvasSize: 512, centerX: 260, centerY: 252.5, visualExtent: 345 },
  platinum: { canvasSize: 512, centerX: 255.5, centerY: 252.5, visualExtent: 347 },
  diamond: { canvasSize: 512, centerX: 249.5, centerY: 258, visualExtent: 334 },
  master: { canvasSize: 512, centerX: 244.5, centerY: 264.5, visualExtent: 369 },
  challenger: { canvasSize: 512, centerX: 246, centerY: 265, visualExtent: 406 },
};

export function badgeArtworkViewport(
  layout: BadgeArtworkLayout,
): BadgeArtworkViewport {
  const cropSize = layout.visualExtent / BADGE_TARGET_VISUAL_FILL;
  const cssScale = layout.canvasSize / cropSize;
  return {
    cssScale,
    cssShiftXPercent:
      (-(layout.centerX - layout.canvasSize / 2) * cssScale * 100) /
      layout.canvasSize,
    cssShiftYPercent:
      (-(layout.centerY - layout.canvasSize / 2) * cssScale * 100) /
      layout.canvasSize,
    textureOffsetX: (layout.centerX - cropSize / 2) / layout.canvasSize,
    textureOffsetY:
      1 - (layout.centerY + cropSize / 2) / layout.canvasSize,
    textureRepeat: cropSize / layout.canvasSize,
  };
}

export const rankBadgeArtworkLayout = (rank: RankId): BadgeArtworkLayout =>
  RANK_BADGE_ARTWORK[rank];

export const rankedBadgeArtworkLayout = (
  tier: RankedTier,
): BadgeArtworkLayout => RANKED_BADGE_ARTWORK[tier];

/** Inferno 1~5 eases into the combined shield rules, then stays 10% softer. */
export function stagePressureScale(index: number): number {
  if (index < 31) return 1;
  return Math.max(0.9, 1 - (index - 30) * 0.02);
}

export const STAGES: readonly StageDefinition[] = STAGE_TIERS.flatMap((tier) =>
  Array.from({ length: tier.count }, (_, offset) => ({ tier, level: offset + 1 })),
).map(({ tier, level }, index) => {
  // The original ladder ended around global index 189. Preserve its readable
  // early progression, then use a slower end-game slope so the 345-stage
  // ladder requires strategy without producing unbounded one-shot numbers.
  const earlyIndex = Math.min(index, 120);
  const earlyPressure = earlyIndex / 120;
  const endgameIndex = Math.max(0, index - 120);
  const pressureScale = stagePressureScale(index);
  const rawHpPressure =
    earlyIndex * 0.037 +
    earlyPressure * earlyPressure * 0.65 +
    endgameIndex * 0.018;
  const rawDamagePressure =
    earlyIndex * 0.023 + earlyPressure * 0.45 + endgameIndex * 0.011;
  const skills: GhostStageSkill[] = [];
  if (index >= 11) skills.push('turret-jam');
  if (index >= 21) skills.push('gold-lock');
  if (index >= 31) skills.push('repair-lock');
  if (index >= 46) skills.push('door-crush');
  return {
    id: `${tier.id}-${level}` as StageId,
    index,
    tier: tier.id,
    level,
    label: `${tier.label} ${level}`,
    hpMultiplier: Number((1 + rawHpPressure * pressureScale).toFixed(3)),
    damageMultiplier: Number((1 + rawDamagePressure * pressureScale).toFixed(3)),
    speedMultiplier: Number(Math.min(1.55, 1 + index * 0.0016).toFixed(3)),
    levelHpGrowth: Number(Math.min(0.38, 0.16 + index * 0.0007).toFixed(3)),
    levelDamageGrowth: Number(Math.min(0.30, 0.11 + index * 0.00056).toFixed(3)),
    skillInterval: Math.max(8, 28 - Math.floor(index / 12)),
    skills,
    victoryXp: 60 + index * 14,
  };
});

export interface RankBenefits {
  speedMultiplier: number;
  startingGoldBonus: number;
  startingPowerBonus: number;
  bedGoldMultiplier: number;
  ghostDifficultyMultiplier: number;
}

const BENEFITS: Record<RankId, RankBenefits> = {
  beginner: { speedMultiplier: 1, startingGoldBonus: 0, startingPowerBonus: 0, bedGoldMultiplier: 1, ghostDifficultyMultiplier: 1 },
  intermediate: { speedMultiplier: 1.05, startingGoldBonus: 10, startingPowerBonus: 0, bedGoldMultiplier: 1.1, ghostDifficultyMultiplier: 1.05 },
  expert: { speedMultiplier: 1.07, startingGoldBonus: 15, startingPowerBonus: 5, bedGoldMultiplier: 1.2, ghostDifficultyMultiplier: 1.1 },
  master: { speedMultiplier: 1.09, startingGoldBonus: 20, startingPowerBonus: 7, bedGoldMultiplier: 1.3, ghostDifficultyMultiplier: 1.15 },
  veteran: { speedMultiplier: 1.11, startingGoldBonus: 30, startingPowerBonus: 10, bedGoldMultiplier: 1.4, ghostDifficultyMultiplier: 1.2 },
  legend: { speedMultiplier: 1.14, startingGoldBonus: 45, startingPowerBonus: 15, bedGoldMultiplier: 1.5, ghostDifficultyMultiplier: 1.25 },
  transcendent: { speedMultiplier: 1.16, startingGoldBonus: 60, startingPowerBonus: 20, bedGoldMultiplier: 1.65, ghostDifficultyMultiplier: 1.3 },
  immortal: { speedMultiplier: 1.18, startingGoldBonus: 75, startingPowerBonus: 25, bedGoldMultiplier: 1.8, ghostDifficultyMultiplier: 1.35 },
  absolute: { speedMultiplier: 1.2, startingGoldBonus: 95, startingPowerBonus: 32, bedGoldMultiplier: 2, ghostDifficultyMultiplier: 1.4 },
};

export const rankIndex = (rank: RankId): number => Math.max(0, RANKS.findIndex((candidate) => candidate.id === rank));
export const rankLabel = (rank: RankId): string => RANKS[rankIndex(rank)]?.label ?? '하수';
export const rankBadgeSymbol = (rank: RankId): string => RANK_VISUALS[rank].badgeSymbol;
export const rankBadgeImage = (rank: RankId): string =>
  `/assets/ranks/${rank}.${rank === 'transcendent' || rank === 'immortal' || rank === 'absolute' ? 'svg' : 'png'}`;
export const rankLabelGradient = (rank: RankId): readonly [string, string, string] | null => {
  if (rank === 'master') return ['#b18bff', '#f2d6ff', '#8eeeff'];
  if (rank === 'veteran') return ['#ff8d67', '#ffe48b', '#fff2d0'];
  if (rank === 'legend') return ['#ffffff', '#ffd47a', '#ff77c4'];
  if (rank === 'transcendent') return ['#8ffcff', '#c7a5ff', '#fff7b0'];
  if (rank === 'immortal') return ['#8bffe2', '#ffffff', '#9275ff'];
  if (rank === 'absolute') return ['#ffef8f', '#ffffff', '#ff62cc'];
  return null;
};
export const rankFromXp = (xp: number): RankId => [...RANKS].reverse().find((rank) => xp >= rank.minXp)?.id ?? 'beginner';
export const higherRank = (solo: RankId, multiplayer: RankId): RankId => rankIndex(solo) >= rankIndex(multiplayer) ? solo : multiplayer;
export const isEliteRank = (rank: RankId): boolean => rankIndex(rank) >= rankIndex('master');
export const rankBenefits = (rank: RankId): RankBenefits => BENEFITS[rank];

/**
 * Returns the progression rank whose documented challenge range contains the
 * selected stage. Survivor bots use this rank so their economy and profile
 * communicate the actual encounter level instead of always showing 하수.
 */
export function recommendedRankForStage(
  stage: StageDefinition | number,
): RankId {
  const index = typeof stage === 'number' ? stage : stage.index;
  if (index >= 246) return 'absolute';
  if (index >= 156) return 'immortal';
  if (index >= 121) return 'transcendent';
  if (index >= 66) return 'legend';
  if (index >= 46) return 'veteran';
  if (index >= 31) return 'master';
  if (index >= 21) return 'expert';
  if (index >= 11) return 'intermediate';
  return 'beginner';
}

export function getStage(id: StageId | string | undefined): StageDefinition {
  if (id === TUTORIAL_STAGE.id) return TUTORIAL_STAGE;
  return STAGES.find((stage) => stage.id === id) ?? STAGES[0] as StageDefinition;
}

export function unlockedStageIndex(profile: AccountProfile, mode: PlayMode): number {
  return mode === 'solo' ? profile.soloStageIndex : profile.multiplayerStageIndex;
}

export function stagesThrough(index: number): readonly StageDefinition[] {
  return STAGES.slice(0, Math.max(1, Math.min(STAGES.length, Math.floor(index) + 1)));
}
