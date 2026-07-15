import type { BuildingKind, ClientMessage, ServerMessage } from './types';

const clientTypes = new Set([
  'ready', 'start', 'add-bot', 'remove-bot', 'move', 'interact', 'build', 'upgrade', 'draw-item', 'rematch', 'ping', 'resync',
]);
const buildingKinds = new Set<BuildingKind>([
  'bed', 'reinforced-door', 'basic-turret', 'rapid-turret', 'frost-turret', 'arc-turret', 'generator', 'repair-drone',
  'electric-coil', 'floor-trap', 'shield-device', 'lucky-machine',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBase(value: Record<string, unknown>): boolean {
  return typeof value.type === 'string' && clientTypes.has(value.type)
    && Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
    && typeof value.timestamp === 'number' && Number.isFinite(value.timestamp);
}

export function parseClientMessage(raw: string | ArrayBuffer): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'binary messages are not supported' };
  if (raw.length > 2_048) return { ok: false, error: 'message exceeds 2048 bytes' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (!isRecord(value) || !validBase(value)) return { ok: false, error: 'invalid message envelope' };
  switch (value.type) {
    case 'ready':
      if (typeof value.ready !== 'boolean') return { ok: false, error: 'ready must be boolean' };
      break;
    case 'add-bot':
      if (!['easy', 'normal', 'hard'].includes(String(value.difficulty))) return { ok: false, error: 'invalid bot difficulty' };
      break;
    case 'remove-bot':
      if (typeof value.botId !== 'string') return { ok: false, error: 'invalid bot id' };
      break;
    case 'move': {
      const vectorValid = typeof value.dx === 'number' && Number.isFinite(value.dx) && Math.abs(value.dx) <= 1
        && typeof value.dy === 'number' && Number.isFinite(value.dy) && Math.abs(value.dy) <= 1;
      if (!vectorValid || !Number.isSafeInteger(value.inputSequence)) return { ok: false, error: 'invalid movement input' };
      break;
    }
    case 'build':
      if (typeof value.roomId !== 'string' || !isRecord(value.tile)
        || !Number.isInteger(value.tile.x) || !Number.isInteger(value.tile.y)
        || !buildingKinds.has(value.kind as BuildingKind) || value.kind === 'bed' || value.kind === 'reinforced-door') {
        return { ok: false, error: 'invalid building request' };
      }
      break;
    case 'upgrade':
      if (typeof value.targetId !== 'string') return { ok: false, error: 'invalid upgrade target' };
      break;
    case 'draw-item':
      if (typeof value.machineId !== 'string') return { ok: false, error: 'invalid lucky machine' };
      break;
    case 'ping':
      if (typeof value.clientTime !== 'number' || !Number.isFinite(value.clientTime)) return { ok: false, error: 'invalid ping' };
      break;
  }
  return { ok: true, message: value as unknown as ClientMessage };
}

export function encodeMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
