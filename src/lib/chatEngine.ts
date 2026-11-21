import { buildConnectionSnippets, isUsableGreenOrGelb, validateInvokeTarget } from './testEngine.ts';
import type { BridgeSelectionEntry, ClassifiedProvider } from './types.ts';

export type ChatTargetType = 'bridge' | 'provider' | 'litellm' | 'custom_local';

export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatTargetResolution {
  ok: true;
  baseUrl: string;
  label: string;
  targetType: ChatTargetType;
  envVarHint?: string;
}

export interface ChatTargetError {
  ok: false;
  error: string;
}

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 32000;

export function isLoopbackHost(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return clean === '127.0.0.1' || clean === 'localhost' || clean === '::1';
}

/**
 * Validates and resolves any chat target (allowlisted Bridge, GRÜN/GELB Provider,
 * local LiteLLM router, or custom loopback server) with strict SSRF and Rule 1/3/4 guards.
 */
export function validateChatTarget(params: {
  targetType: ChatTargetType;
  bridgeId?: string;
  providerId?: string;
  endpointUrl?: string;
  providers: ClassifiedProvider[];
  bridgeSelections: BridgeSelectionEntry[];
}): ChatTargetResolution | ChatTargetError {
  const { targetType, bridgeId, providerId, endpointUrl, providers, bridgeSelections } = params;

  if (targetType === 'bridge') {
    const sel = bridgeSelections.find(
      (b) => b.bridge_id === bridgeId && b.docker_capable && typeof b.port === 'number'
    );
    if (!sel || !sel.bridge_id || !sel.port) {
      return {
        ok: false,
        error: `Bridge "${bridgeId || ''}" ist nicht auf der lokalen Allowlist (Regel 1/3/4).`,
      };
    }
    return {
      ok: true,
      baseUrl: `http://127.0.0.1:${sel.port}/v1`,
      label: `${sel.zielprovider} (${sel.bridge_id})`,
      targetType: 'bridge',
    };
  }

  if (targetType === 'provider') {
    const prov = providers.find((p) => p.id === providerId);
    if (!prov) {
      return { ok: false, error: `Provider "${providerId || ''}" nicht gefunden.` };
    }
    if (!isUsableGreenOrGelb(prov)) {
      return {
        ok: false,
        error:
          'Regel 1/3: Direkter Provider-Chat ist nur für GRÜN und GELB zulässig. Für Klasse ROT bitte eine lokale Bridge wählen.',
      };
    }
    const snippets = buildConnectionSnippets(prov);
    const rawBase = (endpointUrl && endpointUrl.trim() ? endpointUrl.trim() : snippets.defaultApiBase).replace(
      /\/+$/,
      ''
    );
    const check = validateInvokeTarget(prov, `${rawBase}/chat/completions`);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    return {
      ok: true,
      baseUrl: rawBase,
      label: prov.name,
      targetType: 'provider',
      envVarHint: prov.expectedEnvVar || undefined,
    };
  }

  if (targetType === 'litellm') {
    const rawBase = (
      endpointUrl && endpointUrl.trim() ? endpointUrl.trim() : 'http://127.0.0.1:4000/v1'
    ).replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(rawBase);
    } catch {
      return { ok: false, error: 'Ungültige LiteLLM-Router-URL.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Nur HTTP(S) für LiteLLM-Router zulässig.' };
    }
    if (!isLoopbackHost(parsed.hostname)) {
      return {
        ok: false,
        error: 'Regel 4: LiteLLM-Router-Chat ist strikt auf 127.0.0.1 / localhost beschränkt.',
      };
    }
    return {
      ok: true,
      baseUrl: rawBase,
      label: `LiteLLM-Router (${parsed.host})`,
      targetType: 'litellm',
      envVarHint: 'LITELLM_MASTER_KEY',
    };
  }

  if (targetType === 'custom_local') {
    const rawBase = (endpointUrl || '').trim().replace(/\/+$/, '');
    if (!rawBase) {
      return { ok: false, error: 'Bitte eine lokale Basis-URL angeben (z. B. http://127.0.0.1:11434/v1).' };
    }
    let parsed: URL;
    try {
      parsed = new URL(rawBase);
    } catch {
      return { ok: false, error: 'Ungültige URL-Syntax für lokalen Endpunkt.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Nur HTTP oder HTTPS erlaubt.' };
    }
    if (!isLoopbackHost(parsed.hostname)) {
      return {
        ok: false,
        error:
          'SSRF-Schutz (Regel 4): Freie Endpunkte sind nur auf Loopback (127.0.0.1 / localhost) erlaubt. Für externe APIs bitte den Provider aus dem Katalog wählen.',
      };
    }
    return {
      ok: true,
      baseUrl: rawBase,
      label: `Lokal (${parsed.host})`,
      targetType: 'custom_local',
    };
  }

  return { ok: false, error: 'Unbekannter Zieltyp.' };
}

export function sanitizeChatMessages(
  messages: unknown,
  systemPrompt?: string
): ChatTurnMessage[] {
  const out: ChatTurnMessage[] = [];
  if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
    out.push({
      role: 'system',
      content: systemPrompt.trim().slice(0, MAX_MESSAGE_CHARS),
    });
  }
  if (!Array.isArray(messages)) return out;
  for (const item of messages.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== 'object') continue;
    const roleRaw = (item as { role?: unknown }).role;
    const contentRaw = (item as { content?: unknown }).content;
    if (roleRaw !== 'user' && roleRaw !== 'assistant' && roleRaw !== 'system') continue;
    if (typeof contentRaw !== 'string') continue;
    const trimmed = contentRaw.trim();
    if (!trimmed) continue;
    out.push({
      role: roleRaw,
      content: trimmed.slice(0, MAX_MESSAGE_CHARS),
    });
  }
  return out;
}

/**
 * Extracts assistant text and optional token usage from OpenAI-compatible JSON,
 * Anthropic/Ollama variants, or SSE `data: {...}` streams returned by bridges.
 */
export function extractChatCompletionReply(
  parsedJson: unknown,
  rawText: string
): {
  reply: string | null;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  errorMessage?: string;
} {
  if (parsedJson && typeof parsedJson === 'object') {
    const obj = parsedJson as Record<string, unknown>;

    // Error payloads
    if (obj.error) {
      if (typeof obj.error === 'string') return { reply: null, errorMessage: obj.error };
      if (typeof obj.error === 'object' && obj.error !== null) {
        const errMsg = (obj.error as Record<string, unknown>).message;
        if (typeof errMsg === 'string') return { reply: null, errorMessage: errMsg };
      }
    }
    if (typeof obj.detail === 'string' && !obj.choices && !obj.message) {
      return { reply: null, errorMessage: obj.detail };
    }

    const model = typeof obj.model === 'string' ? obj.model : undefined;
    const usage =
      obj.usage && typeof obj.usage === 'object'
        ? (obj.usage as {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          })
        : undefined;

    // OpenAI / LiteLLM / standard bridges: choices[0].message.content or choices[0].text
    if (Array.isArray(obj.choices) && obj.choices.length > 0) {
      const first = obj.choices[0] as Record<string, unknown>;
      const msg = first.message as Record<string, unknown> | undefined;
      if (msg) {
        if (typeof msg.content === 'string' && msg.content.length > 0) {
          return { reply: msg.content, model, usage };
        }
        if (Array.isArray(msg.content)) {
          const joined = msg.content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
                return (part as { text: string }).text;
              }
              return '';
            })
            .join('');
          if (joined) return { reply: joined, model, usage };
        }
        if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0) {
          return { reply: msg.reasoning_content, model, usage };
        }
      }
      if (typeof first.text === 'string' && first.text.length > 0) {
        return { reply: first.text, model, usage };
      }
    }

    // Ollama native /api/chat shape: { message: { content } }
    if (obj.message && typeof obj.message === 'object') {
      const mc = (obj.message as Record<string, unknown>).content;
      if (typeof mc === 'string' && mc.length > 0) {
        return { reply: mc, model, usage };
      }
    }

    // Anthropic Messages shape: { content: [{ type: 'text', text }] }
    if (Array.isArray(obj.content)) {
      const joined = obj.content
        .map((c) =>
          c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
            ? (c as { text: string }).text
            : ''
        )
        .join('');
      if (joined) return { reply: joined, model, usage };
    }

    // Generic fallback fields used by some lightweight bridges
    if (typeof obj.response === 'string' && obj.response.length > 0) {
      return { reply: obj.response, model, usage };
    }
    if (typeof obj.reply === 'string' && obj.reply.length > 0) {
      return { reply: obj.reply, model, usage };
    }
  }

  // Fallback for bridges that force SSE (`data: {...}`) even when stream: false
  if (rawText && rawText.includes('data:')) {
    const chunks: string[] = [];
    let sseModel: string | undefined;
    for (const line of rawText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        if (!sseModel && typeof parsed.model === 'string') sseModel = parsed.model;
        if (Array.isArray(parsed.choices) && parsed.choices.length > 0) {
          const ch = parsed.choices[0] as Record<string, unknown>;
          const delta = ch.delta as Record<string, unknown> | undefined;
          if (delta && typeof delta.content === 'string') {
            chunks.push(delta.content);
          } else if (ch.message && typeof (ch.message as Record<string, unknown>).content === 'string') {
            chunks.push((ch.message as Record<string, unknown>).content as string);
          }
        }
      } catch {
        // ignore malformed SSE line
      }
    }
    if (chunks.length > 0) {
      return { reply: chunks.join(''), model: sseModel };
    }
  }

  return { reply: null };
}

/**
 * Extracts model identifiers from OpenAI `/v1/models`, Ollama `/api/tags`, or plain arrays.
 */
export function extractModelIds(parsedJson: unknown): string[] {
  if (!parsedJson) return [];
  const ids: string[] = [];
  const pushUnique = (val: unknown) => {
    if (typeof val === 'string' && val.trim() && !ids.includes(val.trim())) {
      ids.push(val.trim());
    }
  };

  if (Array.isArray(parsedJson)) {
    for (const item of parsedJson) {
      if (typeof item === 'string') pushUnique(item);
      else if (item && typeof item === 'object') {
        pushUnique((item as Record<string, unknown>).id ?? (item as Record<string, unknown>).name);
      }
    }
    return ids.slice(0, 120);
  }

  if (typeof parsedJson === 'object') {
    const obj = parsedJson as Record<string, unknown>;
    const list = Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(obj.models)
        ? obj.models
        : [];
    for (const item of list) {
      if (typeof item === 'string') pushUnique(item);
      else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        pushUnique(rec.id ?? rec.name ?? rec.model);
      }
    }
  }
  return ids.slice(0, 120);
}
