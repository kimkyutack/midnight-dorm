import type { ServerMessage } from '../shared/types';

interface ParseRequest {
  id: number;
  generation: number;
  raw: string | ArrayBuffer;
}

type ParseResponse =
  | { id: number; generation: number; ok: true; message: ServerMessage }
  | { id: number; generation: number; ok: false };

const workerScope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ParseRequest>) => void,
  ): void;
  postMessage(message: ParseResponse): void;
};
const decoder = new TextDecoder();

workerScope.addEventListener('message', (event) => {
  const { id, generation, raw } = event.data;
  try {
    const text = typeof raw === 'string' ? raw : decoder.decode(raw);
    workerScope.postMessage({
      id,
      generation,
      ok: true,
      message: JSON.parse(text) as ServerMessage,
    });
  } catch {
    workerScope.postMessage({ id, generation, ok: false });
  }
});
