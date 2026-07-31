import type { AccountProfile } from '../shared/types';
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

export const dismissPromotion = (promotionId: 'summer' | 'cyberpunk' | 'special-ops'): Promise<AccountProfile> => authRequest('/api/auth/promotion-dismissals', {
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
