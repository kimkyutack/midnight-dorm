import type { AccountProfile } from '../shared/types';

async function authRequest(path: string, options?: RequestInit): Promise<AccountProfile> {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...options?.headers } });
  const data = await response.json() as { profile?: AccountProfile; error?: string };
  if (!response.ok || !data.profile) throw new Error(data.error ?? '계정 요청을 처리하지 못했습니다.');
  return data.profile;
}

export const getAccount = (): Promise<AccountProfile> => authRequest('/api/auth/me');

export const loginAccount = (username: string, password: string): Promise<AccountProfile> => authRequest('/api/auth/login', {
  method: 'POST', body: JSON.stringify({ username, password }),
});

export const registerAccount = (username: string, nickname: string, password: string): Promise<AccountProfile> => authRequest('/api/auth/register', {
  method: 'POST', body: JSON.stringify({ username, nickname, password }),
});

export async function logoutAccount(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' } });
}
