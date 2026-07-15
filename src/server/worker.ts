import type { GameRoom } from './GameRoom';

export interface Env {
  GAME_ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

async function createRoom(request: Request, env: Env): Promise<Response> {
  let testMode = false;
  try {
    const body = await request.json<{ testMode?: boolean }>();
    const hostname = new URL(request.url).hostname;
    testMode = Boolean(body.testMode) && (hostname === 'localhost' || hostname === '127.0.0.1');
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
      body: JSON.stringify({ code, seed, testMode }),
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
  return stub.fetch(new Request(target, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return Response.json({ ok: true, service: 'midnight-dorm', timestamp: Date.now() });
    if (url.pathname === '/api/rooms/create' && request.method === 'POST') return createRoom(request, env);
    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{8})\/(ws|status)$/);
    if (match) return routeRoom(request, env, match[1] as string, match[2] as 'ws' | 'status');
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { GameRoom } from './GameRoom';
