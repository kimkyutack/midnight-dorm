import type {
  BuildingKind,
  RankedSeasonConstraint,
  RankedSeasonRules,
} from './types';

const S1_RULES: Readonly<RankedSeasonRules> = {
  constraint: { kind: 'turret-limit', maxTurrets: 4 },
};

const RANKED_TURRET_KINDS = new Set<BuildingKind>([
  'basic-turret',
  'rapid-turret',
  'arc-turret',
  'golden-turret',
]);

/**
 * Ranked restrictions are part of the authoritative season contract. Return a
 * copy so a restored room cannot mutate the shared defaults.
 */
export function rankedSeasonRules(_seasonId: string): RankedSeasonRules {
  return { constraint: { ...S1_RULES.constraint } };
}

function isSeasonConstraint(value: unknown): value is RankedSeasonConstraint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'turret-limit')
    return Number.isFinite(candidate.maxTurrets) && (candidate.maxTurrets as number) > 0;
  if (candidate.kind === 'random-box-limit')
    return Number.isFinite(candidate.maxRandomBoxes) && (candidate.maxRandomBoxes as number) > 0;
  if (candidate.kind === 'slow-resistance')
    return Number.isFinite(candidate.slowResistance);
  return candidate.kind === 'bind-resistance' && Number.isFinite(candidate.bindResistance);
}

/** Restores legacy ranked snapshots without accidentally enabling every old rule. */
export function normalizeRankedSeasonRules(
  seasonId: string,
  value?: unknown,
): RankedSeasonRules {
  const constraint =
    value && typeof value === 'object'
      ? (value as { constraint?: unknown }).constraint
      : undefined;
  return isSeasonConstraint(constraint)
    ? { constraint: { ...constraint } }
    : rankedSeasonRules(seasonId);
}

export function isRankedTurretKind(kind: BuildingKind): boolean {
  return RANKED_TURRET_KINDS.has(kind);
}

export function rankedSeasonRuleSummary(
  seasonId: string,
  rules = rankedSeasonRules(seasonId),
): string {
  const { constraint } = rules;
  if (constraint.kind === 'turret-limit')
    return `${seasonId} 시즌 제약 · 포탑 수 최대 ${constraint.maxTurrets}개`;
  if (constraint.kind === 'random-box-limit')
    return `${seasonId} 시즌 제약 · 랜덤 상자 최대 ${constraint.maxRandomBoxes}개`;
  if (constraint.kind === 'slow-resistance')
    return `${seasonId} 시즌 제약 · 귀신 감속 저항 ${Math.round(constraint.slowResistance * 100)}%`;
  return `${seasonId} 시즌 제약 · 귀신 속박 저항 ${Math.round(constraint.bindResistance * 100)}%`;
}
