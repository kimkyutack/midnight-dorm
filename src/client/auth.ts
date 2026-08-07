import type { AccountProfile } from '../shared/types';
import type { EventMissionOverview } from '../shared/eventMissions';
import type { AttendanceOverview } from '../shared/attendanceRewards';
import { setNativeSessionToken } from './native/runtime';

async function authRequest(path: string, options?: RequestInit): Promise<AccountProfile> {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options?.headers } });
  const data = await response.json() as { profile?: AccountProfile; sessionToken?: string; error?: string };
  if (!response.ok || !data.profile) throw new Error(data.error ?? '계정 요청을 처리하지 못했습니다.');
  if (data.sessionToken) await setNativeSessionToken(data.sessionToken);
  return data.profile;
}

export const getAccount = (): Promise<AccountProfile> => authRequest('/api/auth/me');

export const loginAccount = (username: string, password: string): Promise<AccountProfile> => authRequest('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password }),
});

export const registerAccount = (username: string, nickname: string, password: string): Promise<AccountProfile> => authRequest('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ username, nickname, password }),
});

export const purchaseCosmetic = (itemId: string): Promise<AccountProfile> => authRequest('/api/customize/purchase', {
  method: 'POST', body: JSON.stringify({ itemId }),
});

export const equipCosmetic = (itemId: string): Promise<AccountProfile> => authRequest('/api/customize/equip', {
  method: 'POST', body: JSON.stringify({ itemId }),
});

export const purchaseConsumable = (itemId: string, quantity: 1 | 5): Promise<AccountProfile> => authRequest('/api/shop/consumables/purchase', {
  method: 'POST', body: JSON.stringify({ itemId, quantity }),
});

export const setSelectedPlayMode = (playMode: 'solo' | 'multiplayer' | 'ranked'): Promise<AccountProfile> => authRequest('/api/auth/play-mode', {
  method: 'POST', body: JSON.stringify({ playMode }),
});

export const setProfileDisplayMode = (displayMode: 'solo' | 'multiplayer' | 'ranked'): Promise<AccountProfile> => authRequest('/api/auth/profile-display', {
  method: 'POST', body: JSON.stringify({ displayMode }),
});

export const setProfileAvatar = (avatarData: string | null): Promise<AccountProfile> => authRequest('/api/auth/profile-avatar', {
  method: 'POST', body: JSON.stringify({ avatarData }),
});

export const setPrestigeLoadout = (loadout: {
  profileImageId?: string | null;
  profileFrameId?: string | null;
  nameplateId?: string | null;
  homeBackgroundId?: string | null;
  emoteIds?: string[];
}): Promise<AccountProfile> => authRequest('/api/auth/prestige-loadout', {
  method: 'POST', body: JSON.stringify(loadout),
});

export const exchangePrestigePackage = (packageId: string): Promise<AccountProfile> =>
  authRequest('/api/auth/prestige-package/exchange', {
    method: 'POST',
    body: JSON.stringify({ packageId }),
  });

export const exchangePrestigeAccessory = (accessoryId: string): Promise<AccountProfile> =>
  authRequest('/api/auth/prestige-accessory/exchange', {
    method: 'POST',
    body: JSON.stringify({ accessoryId }),
  });

export const purchasePresentation = (itemId: string): Promise<AccountProfile> =>
  authRequest('/api/customize/presentation/purchase', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });

export const claimRandomBoxRefill = (rewardedAdCompleted: boolean): Promise<AccountProfile> =>
  authRequest('/api/shop/random-box/claim', {
    method: 'POST',
    body: JSON.stringify({ rewardedAdCompleted }),
  });

export const exchangeMoonlitPrestigePackage = (): Promise<AccountProfile> =>
  exchangePrestigePackage('prestige-moonlit-phantom-fox');

export interface GhostOrbDrawRewardResult {
  kind: 'points' | 'orbs' | 'cosmetic' | 'duplicate';
  amount?: number;
  itemId?: string;
  label: string;
  symbol: string;
  detail: string;
}

export interface GhostOrbDrawResult {
  profile: AccountProfile;
  rewards: GhostOrbDrawRewardResult[];
  freePurchase: boolean;
  storeConnected: boolean;
  cashSpent: number;
}

export async function drawGhostOrbs(count: 1 | 10): Promise<GhostOrbDrawResult> {
  const response = await fetch('/api/auth/ghost-orb/draw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ count }),
  });
  const data = await response.json() as GhostOrbDrawResult & { error?: string };
  if (!response.ok || !data.profile || !Array.isArray(data.rewards)) {
    throw new Error(data.error ?? '귀신구슬 소환 보상을 지급하지 못했습니다.');
  }
  return data;
}

export const grantDevelopmentCash = (productId: string): Promise<AccountProfile> =>
  authRequest('/api/auth/cash/dev-grant', {
    method: 'POST',
    body: JSON.stringify({ productId }),
  });

export async function checkNicknameAvailability(
  nickname: string,
): Promise<{ nickname: string; available: boolean }> {
  const response = await fetch('/api/auth/nickname/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const data = await response.json() as { nickname?: string; available?: boolean; error?: string };
  if (!response.ok || typeof data.available !== 'boolean')
    throw new Error(data.error ?? '닉네임 중복 여부를 확인하지 못했습니다.');
  return { nickname: data.nickname ?? nickname.trim(), available: data.available };
}

export const setNickname = (nickname: string): Promise<AccountProfile> => authRequest('/api/auth/nickname', {
  method: 'POST', body: JSON.stringify({ nickname }),
});

export const dismissPromotion = (promotionId: 'summer' | 'cyberpunk' | 'special-ops' | 'hide-seek-release'): Promise<AccountProfile> => authRequest('/api/auth/promotion-dismissals', {
  method: 'POST', body: JSON.stringify({ promotionId }),
});

export interface MatchRewardClaim {
  profile: AccountProfile;
  pointsAwarded: number;
  multiplier: 1 | 2;
  alreadyClaimed: boolean;
}

export async function claimMatchReward(
  matchId: string,
  multiplier: 1 | 2,
  rewardedAdCompleted = false,
): Promise<MatchRewardClaim> {
  const response = await fetch('/api/rewards/match/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ matchId, multiplier, rewardedAdCompleted }),
  });
  const data = await response.json() as MatchRewardClaim & { error?: string };
  if (!response.ok || !data.profile) throw new Error(data.error ?? '전리품을 지급하지 못했습니다.');
  return data;
}

export async function getEventMissions(): Promise<EventMissionOverview> {
  const response = await fetch('/api/events/missions', { cache: 'no-store' });
  const data = await response.json() as { overview?: EventMissionOverview; error?: string };
  if (!response.ok || !data.overview) {
    throw new Error(data.error ?? '이벤트 미션을 불러오지 못했습니다.');
  }
  return data.overview;
}

export async function claimEventMissions(
  missionIds: readonly string[] = [],
): Promise<{ overview: EventMissionOverview; awardedPoints: number; claimedCount: number }> {
  const response = await fetch('/api/events/missions/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ missionIds }),
  });
  const data = await response.json() as {
    overview?: EventMissionOverview;
    awardedPoints?: number;
    claimedCount?: number;
    error?: string;
  };
  if (!response.ok || !data.overview) {
    throw new Error(data.error ?? '미션 보상을 수령하지 못했습니다.');
  }
  return {
    overview: data.overview,
    awardedPoints: data.awardedPoints ?? 0,
    claimedCount: data.claimedCount ?? 0,
  };
}

export interface AttendanceClaimResult {
  overview: AttendanceOverview;
  awardedPoints: number;
  awardedItemId: string | null;
  premiumChoiceRequired: boolean;
}

export async function claimAttendanceDay(day: number): Promise<AttendanceClaimResult> {
  const response = await fetch('/api/events/attendance/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day }),
  });
  const data = await response.json() as AttendanceClaimResult & { error?: string };
  if (!response.ok || !data.overview) throw new Error(data.error ?? '출석 보상을 수령하지 못했습니다.');
  return data;
}

export async function redeemAttendanceSkin(itemId: string): Promise<{
  overview: AttendanceOverview;
  awardedItemId: string;
}> {
  const response = await fetch('/api/events/attendance/premium-choice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
  const data = await response.json() as { overview?: AttendanceOverview; awardedItemId?: string; error?: string };
  if (!response.ok || !data.overview || !data.awardedItemId) {
    throw new Error(data.error ?? '프리미엄 스킨을 선택하지 못했습니다.');
  }
  return { overview: data.overview, awardedItemId: data.awardedItemId };
}

export const purchaseAdFree = (plan: 'monthly' | 'permanent'): Promise<AccountProfile> =>
  authRequest('/api/entitlements/ad-free/purchase', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });

export async function logoutAccount(): Promise<void> {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error('로그아웃 요청을 처리하지 못했습니다.');
  } finally {
    await setNativeSessionToken(null);
  }
}
