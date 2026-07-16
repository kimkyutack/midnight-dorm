import type { GameRoom } from './GameRoom';
import { getStage, unlockedStageIndex } from '../shared/progression';
import type { AccountProfile, PlayMode, StageId } from '../shared/types';
import { getAuthenticatedProfile, routeAuth } from './auth';

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  DB: D1Database;
  ASSETS: Fetcher;
  DATA_ENV: 'remote-d1' | 'local-e2e';
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

async function createRoom(request: Request, env: Env, profile: AccountProfile): Promise<Response> {
  let testMode = false;
  let stageId: StageId = 'easy-1';
  let playMode: PlayMode = 'multiplayer';
  try {
    const body = await request.json<{ testMode?: boolean; stageId?: StageId; playMode?: PlayMode }>();
    const hostname = new URL(request.url).hostname;
    testMode = Boolean(body.testMode) && (hostname === 'localhost' || hostname === '127.0.0.1');
    playMode = body.playMode === 'solo' ? 'solo' : 'multiplayer';
    const requestedStage = getStage(body.stageId);
    if (requestedStage.index > unlockedStageIndex(profile, playMode)) {
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
      body: JSON.stringify({ code, seed, testMode, stageId, playMode }),
    });
    if (response.ok) return Response.json({ code, seed });
    if (response.status !== 409) return response;
  }
  return Response.json({ error: '초대 코드를 만들지 못했습니다.' }, { status: 503 });
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
  return stub.fetch(new Request(target, { method: request.method, headers }));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'midnight-dorm', dataEnvironment: env.DATA_ENV, timestamp: Date.now() });
    }
    const authResponse = await routeAuth(request, env.DB, env.DATA_ENV === 'local-e2e');
    if (authResponse) return authResponse;
    if (url.pathname === '/api/rooms/create' && request.method === 'POST') {
      const profile = await getAuthenticatedProfile(request, env.DB, env.DATA_ENV === 'local-e2e');
      return profile ? createRoom(request, env, profile) : Response.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/(ws|status)$/);
    if (match) return routeRoom(request, env, match[1] as string, match[2] as 'ws' | 'status');
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { GameRoom } from './GameRoom';
