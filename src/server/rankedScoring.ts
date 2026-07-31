import type { PlayerState } from '../shared/types';

export interface RankedContributionSummary {
  score: number;
  rank: number;
  participantCount: number;
  participationRatio: number;
  died: boolean;
  abandoned: boolean;
}

const safeRatio = (value: number, maximum: number): number =>
  maximum > 0 ? Math.max(0, Math.min(1, value / maximum)) : 0;

/**
 * Normalizes each role independently so a defender, controller or economy
 * player can rank alongside the survivor who happened to receive the most
 * ghost visits. Bots remain in the comparison pool, preventing a one-human
 * fill match from granting automatic top-contributor status.
 */
export function summarizeRankedContributions(
  players: PlayerState[],
  elapsedSeconds: number,
): Map<string, RankedContributionSummary> {
  const participants = players.filter((player) => !player.spectator || player.rankedContribution.activeSeconds > 0);
  const maximums = participants.reduce(
    (result, player) => {
      const stats = player.rankedContribution;
      result.damage = Math.max(result.damage, stats.turretDamage);
      result.defense = Math.max(result.defense, stats.defenseValue);
      result.control = Math.max(result.control, stats.controlSeconds);
      result.investment = Math.max(
        result.investment,
        stats.goldSpent + stats.powerSpent * 4,
      );
      return result;
    },
    { damage: 0, defense: 0, control: 0, investment: 0 },
  );
  const rows = participants.map((player) => {
    const stats = player.rankedContribution;
    const participationRatio = safeRatio(
      stats.activeSeconds,
      Math.max(1, elapsedSeconds),
    );
    const roleScore =
      safeRatio(stats.turretDamage, maximums.damage) * 35 +
      safeRatio(stats.defenseValue, maximums.defense) * 20 +
      safeRatio(stats.controlSeconds, maximums.control) * 10 +
      safeRatio(stats.goldSpent + stats.powerSpent * 4, maximums.investment) * 15;
    return {
      player,
      participationRatio,
      score: Math.round((participationRatio * 20 + roleScore) * 10) / 10,
    };
  }).sort((left, right) =>
    right.score - left.score ||
    right.participationRatio - left.participationRatio ||
    left.player.id.localeCompare(right.player.id),
  );
  return new Map(
    rows.map((row, index) => [
      row.player.id,
      {
        score: row.score,
        rank: index + 1,
        participantCount: rows.length,
        participationRatio: row.participationRatio,
        died: row.player.rankedContribution.diedAt !== null || !row.player.alive,
        abandoned: row.player.rankedContribution.abandonedAt !== null,
      },
    ]),
  );
}

export function rankedRatingDelta(input: {
  victory: boolean;
  doorHpRatio: number;
  ghostLevel: number;
  contributionScore: number;
  contributionRank: number;
  participantCount: number;
  participationRatio: number;
  died: boolean;
  abandoned: boolean;
  /** Completed placement matches before this result is settled. */
  placementCompleted: number;
}): number {
  const highContribution =
    input.contributionRank <= Math.max(1, Math.ceil(input.participantCount / 2)) &&
    input.contributionScore >= 45;
  const mediumContribution =
    input.contributionScore >= 25 || input.contributionRank <= 2;

  let delta: number;
  if (input.abandoned) {
    if (input.participationRatio < 0.35) delta = -24;
    else if (highContribution) delta = -12;
    else delta = mediumContribution ? -16 : -20;
  } else if (input.died) {
    const lateHighContribution =
      input.participationRatio >= 0.7 &&
      input.ghostLevel >= 10 &&
      highContribution;
    if (lateHighContribution) {
      if (input.contributionRank === 1 && input.contributionScore >= 75) delta = 5;
      else if (input.contributionRank === 1) delta = 4;
      else if (input.contributionScore >= 60) delta = 3;
      else delta = 1;
    } else {
      const earlyPenalty = input.participationRatio < 0.45 ? 4 : 0;
      if (highContribution) delta = -(4 + earlyPenalty);
      else if (mediumContribution) delta = -(8 + earlyPenalty);
      else delta = -(12 + earlyPenalty);
    }
  } else if (!input.victory) {
    delta = highContribution ? -4 : mediumContribution ? -8 : -12;
  } else {
    const contributionBonus = highContribution ? 8 : mediumContribution ? 4 : 0;
    delta = 24 + contributionBonus + Math.round(Math.max(0, Math.min(1, input.doorHpRatio)) * 4);
  }

  // The first five results are placement matches. Amplifying gains and losses
  // lets an initial rating converge quickly without changing later progress.
  return input.placementCompleted < 5 ? delta * 2 : delta;
}

export function rankedContractScoreMultiplier(input: {
  contributionScore: number;
  participationRatio: number;
  died: boolean;
  abandoned: boolean;
}): number {
  if (input.abandoned) return 0;
  if (!input.died) {
    if (input.participationRatio < 0.6 || input.contributionScore < 10) return 0.35;
    return 1;
  }
  return Math.max(
    0.05,
    Math.min(
      0.8,
      (0.2 + input.participationRatio * 0.45) *
        (0.5 + Math.min(1, input.contributionScore / 100) * 0.5),
    ),
  );
}
