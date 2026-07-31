import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import type { AccountProfile } from '../../shared/types';
import { isNativeApp, setNativeSessionToken } from './runtime';

const bundledGoogleWebClientId = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined)?.trim() ?? '';
let initialized = false;
let googleWebScript: Promise<void> | null = null;
let googleWebClientIdRequest: Promise<string> | null = null;
let activeWebResultHandler: ((result: GoogleLoginResult) => void) | null = null;
let activeWebErrorHandler: ((error: unknown) => void) | null = null;

export const googleLoginUsesNativeButton = isNativeApp;

export type GoogleLoginResult =
  | { status: 'authenticated'; profile: AccountProfile }
  | {
      status: 'nickname-required';
      signupToken: string;
      suggestedNickname: string;
    };

async function googleWebClientId(): Promise<string> {
  if (bundledGoogleWebClientId) return bundledGoogleWebClientId;
  if (!googleWebClientIdRequest) {
    googleWebClientIdRequest = fetch('/api/auth/google/config', {
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        const data = await response.json() as { clientId?: string; error?: string };
        const clientId = data.clientId?.trim() ?? '';
        if (!response.ok || !clientId) {
          throw new Error(data.error ?? 'Google 로그인이 서버에 설정되지 않았습니다.');
        }
        return clientId;
      })
      .catch((error) => {
        googleWebClientIdRequest = null;
        throw error;
      });
  }
  return googleWebClientIdRequest;
}

export async function initializeGoogleSignIn(): Promise<void> {
  if (!isNativeApp || initialized) return;
  await GoogleSignIn.initialize({ clientId: await googleWebClientId() });
  initialized = true;
}

async function exchangeGoogleIdToken(idToken: string): Promise<GoogleLoginResult> {
  const response = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await response.json() as {
    status?: 'authenticated' | 'nickname-required';
    profile?: AccountProfile;
    sessionToken?: string;
    signupToken?: string;
    suggestedNickname?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(data.error ?? 'Google 로그인에 실패했습니다.');
  }
  if (data.status === 'nickname-required' && data.signupToken) {
    return {
      status: 'nickname-required',
      signupToken: data.signupToken,
      suggestedNickname: data.suggestedNickname ?? '',
    };
  }
  if (!data.profile || (isNativeApp && !data.sessionToken)) {
    throw new Error('Google 로그인 응답을 확인하지 못했습니다.');
  }
  if (data.sessionToken) await setNativeSessionToken(data.sessionToken);
  return { status: 'authenticated', profile: data.profile };
}

export async function signInWithGoogle(): Promise<GoogleLoginResult> {
  await initializeGoogleSignIn();
  if (!isNativeApp) {
    throw new Error('네이티브 Google 로그인을 사용할 수 없습니다.');
  }
  const result = await GoogleSignIn.signIn();
  return exchangeGoogleIdToken(result.idToken);
}

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleAccountsApi {
  id: {
    initialize(config: {
      client_id: string;
      callback(response: GoogleCredentialResponse): void;
      ux_mode?: 'popup';
      use_fedcm_for_prompt?: boolean;
    }): void;
    renderButton(
      parent: HTMLElement,
      options: {
        type: 'icon';
        shape: 'circle';
        theme: 'outline';
        size: 'large';
        locale: 'ko';
      },
    ): void;
    disableAutoSelect(): void;
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccountsApi };
  }
}

function loadGoogleWebScript(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (googleWebScript) return googleWebScript;
  googleWebScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google 로그인 모듈을 불러오지 못했습니다.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client?hl=ko';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google 로그인 모듈을 불러오지 못했습니다.')), { once: true });
    document.head.appendChild(script);
  });
  return googleWebScript;
}

export async function mountGoogleWebButton(
  parent: HTMLElement,
  onResult: (result: GoogleLoginResult) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  if (isNativeApp) return;
  activeWebResultHandler = onResult;
  activeWebErrorHandler = onError;
  const clientId = await googleWebClientId();
  await loadGoogleWebScript();
  const google = window.google;
  if (!google) throw new Error('Google 로그인 모듈을 초기화하지 못했습니다.');
  if (!initialized) {
    google.accounts.id.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      use_fedcm_for_prompt: true,
      callback: (response) => {
        if (!response.credential) {
          activeWebErrorHandler?.(new Error('Google 인증 정보를 받지 못했습니다.'));
          return;
        }
        void exchangeGoogleIdToken(response.credential)
          .then((result) => activeWebResultHandler?.(result))
          .catch((error) => activeWebErrorHandler?.(error));
      },
    });
    initialized = true;
  }
  parent.replaceChildren();
  google.accounts.id.renderButton(parent, {
    type: 'icon',
    shape: 'circle',
    theme: 'outline',
    size: 'large',
    locale: 'ko',
  });
}

export async function completeGoogleSignup(
  signupToken: string,
  nickname: string,
): Promise<AccountProfile> {
  const response = await fetch('/api/auth/google/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signupToken, nickname }),
  });
  const data = await response.json() as {
    profile?: AccountProfile;
    sessionToken?: string;
    error?: string;
  };
  if (!response.ok || !data.profile || (isNativeApp && !data.sessionToken)) {
    throw new Error(data.error ?? '닉네임을 저장하지 못했습니다.');
  }
  if (data.sessionToken) await setNativeSessionToken(data.sessionToken);
  return data.profile;
}

export async function signOutGoogle(): Promise<void> {
  if (isNativeApp) {
    await GoogleSignIn.signOut().catch(() => undefined);
    return;
  }
  window.google?.accounts.id.disableAutoSelect();
}
