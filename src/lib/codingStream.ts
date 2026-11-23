import type { CodingToolEvent } from './codingTypes.ts';

export type CodingStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'thinking'; delta: string }
  | { type: 'token'; delta: string }
  | { type: 'tool'; event: CodingToolEvent }
  | {
      type: 'done';
      payload: {
        ok: boolean;
        reply?: string;
        thinking?: string;
        model?: string;
        latencyMs: number;
        httpStatus?: number;
        targetUrl?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        toolEvents?: CodingToolEvent[];
        writtenFiles?: string[];
        truncated?: boolean;
        meta?: Record<string, unknown>;
        error?: string;
        rawPreview?: string;
      };
    }
  | {
      type: 'error';
      error: string;
      httpStatus?: number;
      targetUrl?: string;
      rawPreview?: string;
      latencyMs?: number;
      toolEvents?: CodingToolEvent[];
    };

/**
 * Formats a typed CodingStreamEvent as an RFC-compliant Server-Sent Events (SSE) frame.
 */
export function formatSseFrame(event: CodingStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Stateful incremental SSE frame parser for Fetch ReadableStream chunks.
 * Safely handles UTF-8 chunks split arbitrarily across frame or line boundaries.
 */
export function createSseFrameParser(onEvent: (event: CodingStreamEvent) => void): {
  push: (chunkText: string) => void;
  flush: () => void;
} {
  let buffer = '';

  const dispatchBlock = (block: string) => {
    const trimmed = block.trim();
    if (!trimmed) return;
    let eventType = '';
    const dataLines: string[] = [];

    for (const rawLine of trimmed.split(/\r?\n/)) {
      if (rawLine.startsWith(':')) continue; // SSE comment / keepalive
      if (rawLine.startsWith('event:')) {
        eventType = rawLine.slice(6).trim();
      } else if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) return;
    const rawData = dataLines.join('\n').trim();
    if (!rawData || rawData === '[DONE]') return;

    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      const type = (typeof parsed.type === 'string' ? parsed.type : eventType) as CodingStreamEvent['type'];
      if (type === 'status' && typeof parsed.message === 'string') {
        onEvent({ type: 'status', message: parsed.message });
      } else if (type === 'thinking' && typeof parsed.delta === 'string') {
        onEvent({ type: 'thinking', delta: parsed.delta });
      } else if (type === 'token' && typeof parsed.delta === 'string') {
        onEvent({ type: 'token', delta: parsed.delta });
      } else if (type === 'tool' && parsed.event && typeof parsed.event === 'object') {
        onEvent({ type: 'tool', event: parsed.event as CodingToolEvent });
      } else if (type === 'done' && parsed.payload && typeof parsed.payload === 'object') {
        onEvent({ type: 'done', payload: parsed.payload as Extract<CodingStreamEvent, { type: 'done' }>['payload'] });
      } else if (type === 'error') {
        onEvent({
          type: 'error',
          error: typeof parsed.error === 'string' ? parsed.error : 'Unbekannter Stream-Fehler.',
          httpStatus: typeof parsed.httpStatus === 'number' ? parsed.httpStatus : undefined,
          targetUrl: typeof parsed.targetUrl === 'string' ? parsed.targetUrl : undefined,
          rawPreview: typeof parsed.rawPreview === 'string' ? parsed.rawPreview : undefined,
          latencyMs: typeof parsed.latencyMs === 'number' ? parsed.latencyMs : undefined,
          toolEvents: Array.isArray(parsed.toolEvents) ? (parsed.toolEvents as CodingToolEvent[]) : undefined,
        });
      }
    } catch {
      // Ignore malformed SSE JSON line
    }
  };

  return {
    push(chunkText: string) {
      buffer += chunkText.replace(/\r\n/g, '\n');
      let sepIdx = buffer.indexOf('\n\n');
      while (sepIdx !== -1) {
        const block = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        dispatchBlock(block);
        sepIdx = buffer.indexOf('\n\n');
      }
    },
    flush() {
      if (buffer.trim()) {
        dispatchBlock(buffer);
        buffer = '';
      }
    },
  };
}
