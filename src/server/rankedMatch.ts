import type { RankedMatchState, StageId } from '../shared/types';

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

export function rankedStageForContract(contractNumber: number): StageId {
  return `nightmare-${Math.min(10, Math.max(1, contractNumber + 2))}` as StageId;
}
