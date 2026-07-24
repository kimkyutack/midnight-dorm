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
  // 랭크 계약은 개인 혼자하기 진행도를 재사용하지 않는다. 계약마다 서버가
  // 고정한 난이도를 모든 참가자에게 동일하게 적용한다. S1 첫 계약은 노말을
  // 건너뛴 악몽 3으로 시작해, 입장 조건(노말 5)과 실제 경쟁 난이도 사이에
  // 분명한 간격을 둔다.
  const schedule: readonly StageId[] = [
    'nightmare-3',
    'nightmare-4',
    'nightmare-5',
    'hell-1',
    'hell-2',
    'hell-3',
    'hell-4',
  ];
  return schedule[Math.min(schedule.length - 1, Math.max(0, contractNumber - 1))] as StageId;
}
