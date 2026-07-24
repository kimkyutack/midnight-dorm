import type { RankedMatchState, RankedTier, StageId } from '../shared/types';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function createRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

/** A ranked contract must create the same map for every ranked participant. */
export function contractSeed(contractId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < contractId.length; index += 1) {
    hash ^= contractId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function rankedMatchForContract(
  seasonId: string,
  contractNumber: number,
): RankedMatchState {
  const goldenPolicies: RankedMatchState['goldenTurretPolicy'][] = [
    'disabled',
    'loaned',
    'objective',
    'penalized',
  ];
  const supplyPolicies: RankedMatchState['supplyPolicy'][] = [
    'disabled',
    'loaned',
    'penalized',
  ];
  return {
    seasonId,
    contractId: `${seasonId}-C${contractNumber}`,
    contractNumber,
    modifier: contractNumber % 3 === 0 ? 'time-attack' : 'none',
    goldenTurretPolicy: goldenPolicies[(contractNumber - 1) % goldenPolicies.length] as RankedMatchState['goldenTurretPolicy'],
    supplyPolicy: supplyPolicies[(contractNumber - 1) % supplyPolicies.length] as RankedMatchState['supplyPolicy'],
  };
}

/**
 * Contracts keep their common map seed and modifier, while the combat stage
 * scales with the team's matchmaking bracket. Unranked entrants use the
 * bronze bracket until their first result is recorded.
 */
export function rankedStageForTier(tier: RankedTier): StageId {
  const stages: Readonly<Record<RankedTier, StageId>> = {
    bronze: 'nightmare-1',
    silver: 'hell-1',
    gold: 'inferno-1',
    platinum: 'epic-1',
    diamond: 'mythic-1',
    master: 'legendary-1',
    challenger: 'legendary-15',
  };
  return stages[tier];
}

/** Unranked players share the bronze bracket and can never meet silver+. */
export function rankedMatchmakingTier(tier: RankedTier, hasPlayedRanked: boolean): RankedTier {
  return hasPlayedRanked ? tier : 'bronze';
}
