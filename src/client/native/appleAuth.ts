import { registerPlugin } from '@capacitor/core';
import type { AccountProfile } from '../../shared/types';
import { isNativeApp, nativePlatform, setNativeSessionToken } from './runtime';

interface AppleNativePlugin {
  signIn(): Promise<{ idToken: string; authorizationCode?: string; displayName?: string }>;
}

const AppleSignIn = registerPlugin<AppleNativePlugin>('AppleSignIn');

export const appleLoginAvailable = isNativeApp && nativePlatform === 'ios';

export type AppleLoginResult =
  | { status: 'authenticated'; profile: AccountProfile }
  | { status: 'nickname-required'; signupToken: string; suggestedNickname: string };

export async function signInWithApple(): Promise<AppleLoginResult> {
  if (!appleLoginAvailable) throw new Error('Apple 로그인은 iPhone/iPad 앱에서만 사용할 수 있습니다.');
  const credential = await AppleSignIn.signIn();
  if (!credential.idToken) throw new Error('Apple ID 토큰을 받지 못했습니다.');
  const response = await fetch('/api/auth/apple', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: credential.idToken, displayName: credential.displayName ?? '' }),
  });
  const data = await response.json() as {
    status?: 'authenticated' | 'nickname-required'; profile?: AccountProfile; sessionToken?: string;
    signupToken?: string; suggestedNickname?: string; error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? 'Apple 로그인에 실패했습니다.');
  if (data.status === 'nickname-required' && data.signupToken) {
    return { status: 'nickname-required', signupToken: data.signupToken, suggestedNickname: data.suggestedNickname ?? '' };
  }
  if (!data.profile || !data.sessionToken) throw new Error('Apple 로그인 응답을 확인하지 못했습니다.');
  await setNativeSessionToken(data.sessionToken);
  return { status: 'authenticated', profile: data.profile };
}

export async function completeAppleSignup(signupToken: string, nickname: string): Promise<AccountProfile> {
  const response = await fetch('/api/auth/apple/complete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signupToken, nickname }),
  });
  const data = await response.json() as { profile?: AccountProfile; sessionToken?: string; error?: string };
  if (!response.ok || !data.profile || !data.sessionToken) throw new Error(data.error ?? 'Apple 계정 생성을 완료하지 못했습니다.');
  await setNativeSessionToken(data.sessionToken);
  return data.profile;
}
