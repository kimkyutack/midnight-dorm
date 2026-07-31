import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const SESSION_KEY = 'midnight_native_session';
const rawApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';

export const isNativeApp = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform();
export const nativeApiBaseUrl = rawApiBase;

let sessionToken = '';
let fetchInstalled = false;

const sessionReady = isNativeApp
  ? SecureStoragePlugin.get({ key: SESSION_KEY })
      .then(({ value }) => {
        sessionToken = value;
      })
      .catch(() => {
        sessionToken = '';
      })
  : Promise.resolve();

export async function setNativeSessionToken(token: string | null): Promise<void> {
  if (!isNativeApp) return;
  sessionToken = token?.trim() ?? '';
  if (sessionToken) {
    await SecureStoragePlugin.set({ key: SESSION_KEY, value: sessionToken });
  } else {
    await SecureStoragePlugin.remove({ key: SESSION_KEY }).catch(() => undefined);
  }
}

export async function getNativeSessionToken(): Promise<string> {
  await sessionReady;
  return sessionToken;
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

function nativeApiUrl(value: string): string {
  if (!value.startsWith('/api/')) return value;
  if (!nativeApiBaseUrl) {
    throw new Error('네이티브 API 주소가 설정되지 않았습니다. VITE_API_BASE_URL을 확인해주세요.');
  }
  return `${nativeApiBaseUrl}${value}`;
}

export function installNativeFetchBridge(): void {
  if (!isNativeApp || fetchInstalled) return;
  fetchInstalled = true;
  const browserFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    await sessionReady;
    const sourceUrl = requestUrl(input);
    const targetUrl = nativeApiUrl(sourceUrl);
    const isApiRequest = targetUrl.startsWith(`${nativeApiBaseUrl}/api/`);
    if (!isApiRequest) return browserFetch(input, init);

    const sourceRequest = input instanceof Request ? input : null;
    const headers = new Headers(sourceRequest?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`);
    headers.set('x-midnight-native-platform', nativePlatform);
    return browserFetch(
      sourceRequest ? new Request(targetUrl, sourceRequest) : targetUrl,
      {
        ...init,
        headers,
        credentials: 'omit',
        cache: init?.cache ?? 'no-store',
      },
    );
  };
}

export async function nativeWebSocketUrl(path: string, params = new URLSearchParams()): Promise<string> {
  if (!isNativeApp) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const suffix = params.size ? `?${params}` : '';
    return `${protocol}//${location.host}${path}${suffix}`;
  }
  if (!nativeApiBaseUrl) throw new Error('VITE_API_BASE_URL이 설정되지 않았습니다.');
  const token = await getNativeSessionToken();
  if (token) params.set('nativeSession', token);
  const target = new URL(path, `${nativeApiBaseUrl}/`);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  target.search = params.toString();
  return target.toString();
}

export function nativeWebSocketUrlSync(path: string, params = new URLSearchParams()): string {
  if (!isNativeApp) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const suffix = params.size ? `?${params}` : '';
    return `${protocol}//${location.host}${path}${suffix}`;
  }
  if (!nativeApiBaseUrl) throw new Error('VITE_API_BASE_URL이 설정되지 않았습니다.');
  if (sessionToken) params.set('nativeSession', sessionToken);
  const target = new URL(path, `${nativeApiBaseUrl}/`);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  target.search = params.toString();
  return target.toString();
}
