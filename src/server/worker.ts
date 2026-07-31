import type { GameRoom } from './GameRoom';
import { getStage, unlockedStageIndex } from '../shared/progression';
import { CURRENT_APP_UPDATE, isUpdateAvailable, type AppUpdate } from '../shared/appUpdates';
import type { AccountProfile, PlayMode, StageId } from '../shared/types';
import { getAuthenticatedProfile, profileAvatarResponse, rankedContractNumber, rankedLeaderboard, rankedSeasonId, routeAuth } from './auth';
import type { RankedQueue } from './RankedQueue';
import { createRoomCode, rankedMatchForContract, rankedMatchmakingTier, rankedStageForTier } from './rankedMatch';
import { routeMailbox } from './mailbox';
import type { SocialPresence } from './SocialPresence';
import { routeSocial } from './social';
import { routeNativeStore } from './nativeStore';

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  RANKED_QUEUE: DurableObjectNamespace<RankedQueue>;
  SOCIAL_PRESENCE: DurableObjectNamespace<SocialPresence>;
  DB: D1Database;
  ASSETS: Fetcher;
  DATA_ENV: 'remote-d1' | 'local-e2e';
  NATIVE_ALLOWED_ORIGINS?: string;
  GOOGLE_WEB_CLIENT_ID?: string;
  STORE_VERIFICATION_ENABLED?: string;
}

interface AppUpdateRow {
  version: string;
  title: string;
  summary: string;
  published_at: number;
}

const noStoreHeaders = {
  'cache-control': 'no-store, max-age=0, must-revalidate',
  pragma: 'no-cache',
};

function appUpdateFromRow(row: AppUpdateRow): AppUpdate {
  return {
    version: row.version,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
  };
}

async function routeAppUpdates(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const latestOnly = url.pathname.endsWith('/latest');
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get('limit') ?? 12) || 12));
  try {
    if (latestOnly) {
      const row = await env.DB.prepare(
        'SELECT version, title, summary, published_at FROM app_updates ORDER BY published_at DESC, version DESC LIMIT 1',
      ).first<AppUpdateRow>();
      const databaseLatest = row ? appUpdateFromRow(row) : null;
      // Static assets and the Worker can be deployed before the matching D1
      // migration. In that window the compiled release metadata is newer than
      // the newest stored row and must win, otherwise a current client gets a
      // false "new update" prompt for an older date.
      const latest = !databaseLatest || isUpdateAvailable(
        databaseLatest.version,
        CURRENT_APP_UPDATE.version,
      )
        ? CURRENT_APP_UPDATE
        : databaseLatest;
      return Response.json({ latest }, { headers: noStoreHeaders });
    }
    const result = await env.DB.prepare(
      'SELECT version, title, summary, published_at FROM app_updates ORDER BY published_at DESC, version DESC LIMIT ?',
    ).bind(limit).all<AppUpdateRow>();
    return Response.json({ updates: (result.results ?? []).map(appUpdateFromRow) }, { headers: noStoreHeaders });
  } catch (error) {
    // A stale worker can briefly run before the D1 migration is applied. It
    // must not block login or cause an infinite refresh loop in that window.
    const missingUpdateTable = error instanceof Error && /no such table: app_updates/i.test(error.message);
    if (!missingUpdateTable) console.error('Failed to read app update history', error);
    return Response.json(
      { latest: latestOnly ? CURRENT_APP_UPDATE : null, updates: latestOnly ? [] : [CURRENT_APP_UPDATE] },
      { headers: noStoreHeaders },
    );
  }
}

async function createRoom(request: Request, env: Env, profile: AccountProfile): Promise<Response> {
  let testMode = false;
  let stageId: StageId = 'easy-1';
  let playMode: PlayMode = 'multiplayer';
  try {
    const body = await request.json<{ testMode?: boolean; stageId?: StageId; playMode?: PlayMode; ranked?: boolean }>();
    const hostname = new URL(request.url).hostname;
    testMode = Boolean(body.testMode) && (hostname === 'localhost' || hostname === '127.0.0.1');
    if (body.ranked) {
      return Response.json({ error: '랭크전은 랭크 대기열에서만 시작할 수 있습니다.' }, { status: 409 });
    }
    playMode = body.playMode === 'solo' ? 'solo' : 'multiplayer';
    const tutorialRequired =
      playMode === 'solo' && !profile.tutorialCompleted;
    const requestedStage = tutorialRequired
      ? getStage('tutorial-1')
      : getStage(body.stageId);
    if (
      !tutorialRequired &&
      requestedStage.index > unlockedStageIndex(profile, playMode)
    ) {
      return Response.json({ error: '아직 잠긴 스테이지입니다.' }, { status: 403 });
    }
    stageId = requestedStage.id;
  } catch {
    testMode = false;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createRoomCode();
    const stub = env.GAME_ROOMS.getByName(code);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] as number;
    const response = await stub.fetch('https://game-room.internal/init', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, seed, testMode, stageId, playMode, ranked: null }),
    });
    if (response.ok) return Response.json({ code, seed });
    if (response.status !== 409) return response;
  }
  return Response.json({ error: '초대 코드를 만들지 못했습니다.' }, { status: 503 });
}

async function routeRankedQueue(request: Request, env: Env): Promise<Response> {
  const profile = await getAuthenticatedProfile(request, env.DB, env.DATA_ENV === 'local-e2e');
  if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  if (!profile.ranked.eligible) {
    return Response.json({ error: '랭크전은 혼자하기 노말 5 클리어와 일반 게임 10회 완료 후 참여할 수 있습니다.' }, { status: 403 });
  }
  const seasonId = rankedSeasonId();
  const contractNumber = rankedContractNumber();
  const ranked = rankedMatchForContract(seasonId, contractNumber);
  const hasPlayedRanked = profile.ranked.contractsPlayed > 0;
  const matchmakingTier = rankedMatchmakingTier(profile.ranked.tier, hasPlayedRanked);
  // Unranked entrants deliberately use this bronze namespace. Higher tiers
  // receive a separate queue and a correspondingly harder ranked stage.
  const queue = env.RANKED_QUEUE.getByName(`${seasonId}:${ranked.contractId}:${matchmakingTier}`);
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith('/join') && request.method === 'POST') {
    const hostname = new URL(request.url).hostname;
    const body = await request.json<{ testMode?: boolean }>().catch((): { testMode?: boolean } => ({}));
    return Response.json(await queue.join({
      accountId: profile.id,
      nickname: profile.nickname,
      rating: profile.ranked.rating,
      avatarUrl: profile.profileAvatarUrl,
      tier: matchmakingTier,
      placementCompleted: profile.ranked.placementCompleted,
      testMode: Boolean(body.testMode) && (hostname === 'localhost' || hostname === '127.0.0.1'),
      ranked,
      stageId: rankedStageForTier(matchmakingTier),
    }));
  }
  if (pathname.endsWith('/status') && request.method === 'GET') {
    return Response.json(await queue.status(profile.id));
  }
  if (pathname.endsWith('/leave') && request.method === 'POST') {
    return Response.json(await queue.leave(profile.id));
  }
  return Response.json({ error: '랭크 대기열 요청이 올바르지 않습니다.' }, { status: 404 });
}

async function routeRoom(request: Request, env: Env, code: string, action: 'ws' | 'status'): Promise<Response> {
  if (!/^[A-Z2-9]{8}$/.test(code)) return Response.json({ error: '초대 코드는 8자리입니다.' }, { status: 400 });
  const stub = env.GAME_ROOMS.getByName(code);
  const url = new URL(request.url);
  const target = new URL(`https://game-room.internal/${action}`);
  target.search = url.search;
  if (action === 'status') return stub.fetch(new Request(target, request));
  const profile = await getAuthenticatedProfile(request, env.DB, env.DATA_ENV === 'local-e2e');
  if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const headers = new Headers(request.headers);
  headers.set('x-account-id', profile.id);
  headers.set('x-account-nickname', encodeURIComponent(profile.nickname));
  headers.set('x-solo-rank', profile.soloRank);
  headers.set('x-multiplayer-rank', profile.multiplayerRank);
  headers.set('x-profile-display-mode', profile.profileDisplayMode);
  headers.set('x-profile-ranked-season-id', profile.ranked.seasonId);
  headers.set('x-profile-ranked-tier', profile.ranked.tier);
  headers.set('x-profile-ranked-rating', String(profile.ranked.rating));
  headers.set('x-profile-avatar-url', profile.profileAvatarUrl ?? '');
  headers.set('x-avatar-appearance', encodeURIComponent(JSON.stringify(profile.appearance)));
  headers.set('x-turret-skins', encodeURIComponent(JSON.stringify(profile.turretSkins)));
  headers.set('x-consumable-inventory', encodeURIComponent(JSON.stringify(profile.consumables)));
  return stub.fetch(new Request(target, { method: request.method, headers }));
}

async function routeWorkerRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'midnight-dorm', dataEnvironment: env.DATA_ENV, timestamp: Date.now() });
    }
    if ((url.pathname === '/api/app-updates' || url.pathname === '/api/app-updates/latest') && request.method === 'GET') {
      return routeAppUpdates(request, env);
    }
    const mailboxResponse = await routeMailbox(request, env.DB, env.DATA_ENV === 'local-e2e');
    if (mailboxResponse) return mailboxResponse;
    const socialResponse = await routeSocial(request, env.DB, env);
    if (socialResponse) return socialResponse;
    const authResponse = await routeAuth(
      request,
      env.DB,
      env.DATA_ENV === 'local-e2e',
      env.GOOGLE_WEB_CLIENT_ID,
    );
    if (authResponse) return authResponse;
    if (url.pathname.startsWith('/api/store/')) {
      const profile = await getAuthenticatedProfile(request, env.DB, env.DATA_ENV === 'local-e2e');
      const storeResponse = await routeNativeStore(request, env.DB, profile, env);
      if (storeResponse) return storeResponse;
    }
    const avatarMatch = url.pathname.match(/^\/api\/profile-avatar\/([a-zA-Z0-9-]{8,80})$/);
    if (avatarMatch && request.method === 'GET') {
      return profileAvatarResponse(env.DB, avatarMatch[1] as string, env.DATA_ENV === 'local-e2e');
    }
    if (url.pathname === '/api/ranked/season' && request.method === 'GET') {
      const profile = await getAuthenticatedProfile(request, env.DB, env.DATA_ENV === 'local-e2e');
      if (!profile) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
      return Response.json({ seasonId: rankedSeasonId(), me: profile.ranked, leaderboard: await rankedLeaderboard(env.DB) });
    }
    if (/^\/api\/ranked\/queue\/(join|status|leave)$/.test(url.pathname)) {
      return routeRankedQueue(request, env);
    }
    if (url.pathname === '/api/rooms/create' && request.method === 'POST') {
      const profile = await getAuthenticatedProfile(request, env.DB, env.DATA_ENV === 'local-e2e');
      return profile ? createRoom(request, env, profile) : Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/(ws|status)$/);
    if (match) return routeRoom(request, env, match[1] as string, match[2] as 'ws' | 'status');
    return env.ASSETS.fetch(request);
}

const DEFAULT_NATIVE_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];

function nativeOrigins(env: Env): Set<string> {
  const configured = env.NATIVE_ALLOWED_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_NATIVE_ORIGINS);
}

function nativeCorsHeaders(origin: string): HeadersInit {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-midnight-native-platform',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function withNativeCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  new Headers(nativeCorsHeaders(origin)).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function withGooglePopupHeaders(response: Response): Response {
  if (response.status === 101) return response;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  // Google Identity Services uses a popup when FedCM is unavailable or
  // disabled. Keep the opener relationship for that fallback without
  // weakening isolation for unrelated cross-origin documents.
  headers.set('cross-origin-opener-policy', 'same-origin-allow-popups');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('origin')?.replace(/\/+$/, '') ?? '';
    const nativeOrigin = origin && nativeOrigins(env).has(origin);
    const nativePlatform = request.headers.get('x-midnight-native-platform');
    const nativeSocket = url.pathname.endsWith('/ws') && url.searchParams.has('nativeSession');
    const verifiedNative = Boolean(nativeOrigin && (
      nativePlatform === 'android' ||
      nativePlatform === 'ios' ||
      nativeSocket
    ));

    if (request.method === 'OPTIONS' && origin) {
      if (!nativeOrigin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: nativeCorsHeaders(origin) });
    }
    if (origin && url.pathname.startsWith('/api/') && origin !== url.origin && !verifiedNative) {
      return Response.json({ error: '허용되지 않은 앱 출처입니다.' }, { status: 403 });
    }

    let routedRequest = request;
    if (verifiedNative) {
      const headers = new Headers(request.headers);
      headers.delete('origin');
      headers.set('x-native-origin-verified', '1');
      routedRequest = new Request(request, { headers });
    }
    const response = await routeWorkerRequest(routedRequest, env);
    // A WebSocket upgrade response carries a Cloudflare-specific `webSocket`
    // handle that cannot survive reconstructing the Response just to add CORS.
    // Browser WebSockets do not use CORS response headers, so return it intact.
    const responseWithCors = verifiedNative && !nativeSocket
      ? withNativeCors(response, origin)
      : response;
    return withGooglePopupHeaders(responseWithCors);
  },
} satisfies ExportedHandler<Env>;

export { GameRoom } from './GameRoom';
export { RankedQueue } from './RankedQueue';
export { SocialPresence } from './SocialPresence';
