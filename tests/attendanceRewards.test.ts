import { describe, expect, it } from 'vitest';
import { ATTENDANCE_REWARDS, attendanceRewardForDay } from '../src/shared/attendanceRewards';

describe('attendance rewards', () => {
  it('defines one cumulative reward for every attendance count from 1 to 30', () => {
    expect(ATTENDANCE_REWARDS).toHaveLength(30);
    expect(ATTENDANCE_REWARDS.map((reward) => reward.day)).toEqual(
      Array.from({ length: 30 }, (_, index) => index + 1),
    );
  });

  it('uses the requested weekly milestone cosmetics and point bands', () => {
    expect(attendanceRewardForDay(1)).toMatchObject({ kind: 'points', amount: 100 });
    expect(attendanceRewardForDay(6)).toMatchObject({ kind: 'points', amount: 100 });
    expect(attendanceRewardForDay(7)).toMatchObject({ itemId: 'character-puppy', special: true });
    expect(attendanceRewardForDay(8)).toMatchObject({ kind: 'points', amount: 150 });
    expect(attendanceRewardForDay(14)).toMatchObject({ itemId: 'tile-wave-surfer', special: true });
    expect(attendanceRewardForDay(15)).toMatchObject({ kind: 'points', amount: 200 });
    expect(attendanceRewardForDay(21)).toMatchObject({ itemId: 'turret-basic-surfer-water', special: true });
    expect(attendanceRewardForDay(22)).toMatchObject({ kind: 'points', amount: 250 });
    expect(attendanceRewardForDay(29)).toMatchObject({ kind: 'points', amount: 250 });
    expect(attendanceRewardForDay(30)).toMatchObject({ itemId: 'skin-look-puppy-surfer', special: true });
  });
});
