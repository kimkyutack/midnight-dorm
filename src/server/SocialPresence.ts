import { DurableObject } from 'cloudflare:workers';

/** Lightweight push payloads; durable D1 data remains the source of truth. */
export interface SocialPush {
  type: 'friend-request' | 'friend-accepted' | 'message' | 'invite';
  fromAccountId?: string;
}

/**
 * One hibernating WebSocket hub per account.  It intentionally stores no
 * social data: messages, friendships, and invites are persisted in D1 before
 * this object is notified, so an eviction can never lose user data.
 */
export class SocialPresence extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() });
    server.send(JSON.stringify({ type: 'ready', timestamp: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async notify(event: SocialPush): Promise<void> {
    const payload = JSON.stringify({ ...event, timestamp: Date.now() });
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  }
}
