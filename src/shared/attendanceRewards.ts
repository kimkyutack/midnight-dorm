export type AttendanceRewardKind = 'points' | 'cosmetic';

export interface AttendanceRewardDefinition {
  day: number;
  kind: AttendanceRewardKind;
  amount?: number;
  itemId?: string;
  label: string;
  imageUrl: string;
  special: boolean;
  duplicatePoints?: number;
}

export interface AttendanceRewardProgress extends AttendanceRewardDefinition {
  unlocked: boolean;
  claimed: boolean;
  claimable: boolean;
}

export interface AttendancePremiumChoice {
  pending: boolean;
  sourceDay: number;
  choices: Array<{
    itemId: string;
    label: string;
    imageUrl: string;
  }>;
}

export interface AttendanceOverview {
  attendanceCount: number;
  lastAttendedDayKey: string;
  claimableCount: number;
  rewards: AttendanceRewardProgress[];
  premiumChoice: AttendancePremiumChoice | null;
}

const POINT_IMAGE = '/assets/tutorial/rewards-points-guide.webp';

const pointReward = (day: number, amount: number): AttendanceRewardDefinition => ({
  day,
  kind: 'points',
  amount,
  label: `${amount} 포인트`,
  imageUrl: POINT_IMAGE,
  special: false,
});

export const ATTENDANCE_REWARDS: readonly AttendanceRewardDefinition[] = Array.from(
  { length: 30 },
  (_, index): AttendanceRewardDefinition => {
    const day = index + 1;
    if (day === 7) {
      return {
        day,
        kind: 'cosmetic',
        itemId: 'character-puppy',
        label: '구름강아지 몽',
        imageUrl: '/assets/sprites/survivors/character-puppy/concept.png',
        special: true,
        duplicatePoints: 600,
      };
    }
    if (day === 14) {
      return {
        day,
        kind: 'cosmetic',
        itemId: 'tile-wave-surfer',
        label: '파도 타일',
        imageUrl: '/assets/tiles/skin-wave/wave-tile.webp',
        special: true,
        duplicatePoints: 2_500,
      };
    }
    if (day === 21) {
      return {
        day,
        kind: 'cosmetic',
        itemId: 'turret-basic-surfer-water',
        label: '서퍼 물총포',
        imageUrl: '/assets/turret-skins/skin-surfer-water-blaster/level-01.webp',
        special: true,
        duplicatePoints: 2_500,
      };
    }
    if (day === 30) {
      return {
        day,
        kind: 'cosmetic',
        itemId: 'skin-look-puppy-surfer',
        label: '서퍼 몽',
        imageUrl: '/assets/sprites/skins/skin-surfer-mong/surfer-mong-summer-event.webp',
        special: true,
      };
    }
    if (day <= 6) return pointReward(day, 100);
    if (day <= 13) return pointReward(day, 150);
    if (day <= 20) return pointReward(day, 200);
    return pointReward(day, 250);
  },
);

export const attendanceRewardForDay = (day: number): AttendanceRewardDefinition | undefined =>
  ATTENDANCE_REWARDS.find((reward) => reward.day === day);
