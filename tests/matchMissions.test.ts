import { describe, expect, it } from 'vitest';
import type { PlayerState } from '../src/shared/types';
import {
  MATCH_MISSION_POOL,
  advanceMatchMissions,
  completedMatchMissionPoints,
  createMatchMissions,
} from '../src/shared/matchMissions';

describe('match missions', () => {
  it('keeps at least 30 varied definitions with difficulty-scaled rewards', () => {
    expect(MATCH_MISSION_POOL.length).toBeGreaterThanOrEqual(30);
    expect(MATCH_MISSION_POOL.every((mission) => mission.rewardPoints >= 20 && mission.rewardPoints <= 50)).toBe(true);
  });

  it('creates a deterministic two-or-three mission set ending in clear', () => {
    const first = createMatchMissions('match-1', 'player-1');
    const same = createMatchMissions('match-1', 'player-1');
    expect(first).toEqual(same);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(first.at(-1)?.metric).toBe('clear');
    expect(first.at(-1)?.title).toBe('클리어');
  });

  it('marks progress server-side and sums only completed rewards', () => {
    const player = {
      matchMissions: [
        {
          id: 'generator-lv7',
          title: '달빛 발전기 Lv.7',
          description: '달빛 발전기를 7레벨까지 업그레이드하세요.',
          metric: 'reach-level',
          targetKind: 'generator',
          target: 7,
          rewardPoints: 50,
          progress: 0,
          completed: false,
        },
        {
          id: 'clear-stage',
          title: '클리어',
          description: '스테이지를 클리어하세요.',
          metric: 'clear',
          target: 1,
          rewardPoints: 50,
          progress: 0,
          completed: false,
        },
      ],
    } as Pick<PlayerState, 'matchMissions'>;
    advanceMatchMissions(player as PlayerState, { type: 'upgrade', kind: 'generator', level: 7 });
    expect(completedMatchMissionPoints(player)).toBe(50);
    advanceMatchMissions(player as PlayerState, { type: 'clear' });
    expect(completedMatchMissionPoints(player)).toBe(100);
  });
});
