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
export interface BridgeModelOption {
  id: string;
  label: string;
  note?: string;
}

/**
 * Exclusively verified, actively supported models per allowlisted local bridge.
 * Audited directly against upstream bridge source code and live upstream /models endpoints
 * (excluding "default", legacy deprecated aliases, and paid-only inaccessible models).
 */
export const BRIDGE_VERIFIED_MODELS: Record<string, readonly BridgeModelOption[]> = {
  qwengate: [
    { id: 'qwen3.7-plus', label: 'qwen3.7-plus', note: 'Standard · Live chat.qwen.ai' },
    { id: 'qwen3.8-max', label: 'qwen3.8-max', note: 'Flaggschiff · Live chat.qwen.ai' },
  ],
  'openai-api-server-via-codex': [
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', note: 'Standard · Schnell' },
    { id: 'gpt-5.4', label: 'gpt-5.4', note: 'Allround' },
    { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex', note: 'Codex' },
    { id: 'gpt-5.3-codex-spark', label: 'gpt-5.3-codex-spark', note: 'Codex Spark' },
    { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex', note: 'Codex' },
    { id: 'gpt-5.2', label: 'gpt-5.2', note: 'Allround' },
    { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max', note: 'Codex Max' },
    { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini', note: 'Codex Mini' },
    { id: 'gpt-5.1', label: 'gpt-5.1', note: 'Basis' },
    { id: 'gpt-5.5', label: 'gpt-5.5', note: 'Erweitert' },
    { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', note: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra', note: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna', note: 'GPT-5.6 Luna' },
  ],
  'catgpt-gateway': [
    { id: 'claude-browser', label: 'claude-browser', note: 'Standard · PROVIDER=claude' },
    { id: 'catgpt-browser', label: 'catgpt-browser', note: 'ChatGPT-Modus · PROVIDER=chatgpt' },
  ],
  'webai-to-api': [
    { id: 'gemini-3-flash', label: 'gemini-3-flash', note: 'Standard · Flash' },
    { id: 'gemini-3-flash-thinking', label: 'gemini-3-flash-thinking', note: 'Thinking' },
    { id: 'gemini-3-pro', label: 'gemini-3-pro', note: 'Pro' },
  ],
  freedeepseekapi: [
    { id: 'deepseek-chat', label: 'deepseek-chat', note: 'Standard · Unified' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner', note: 'DeepThink' },
    { id: 'deepseek-chat-search', label: 'deepseek-chat-search', note: 'Mit Web-Suche' },
    { id: 'deepseek-reasoner-search', label: 'deepseek-reasoner-search', note: 'DeepThink + Web-Suche' },
    { id: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash', note: 'V4.1 Flash' },
    { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', note: 'V4 Flash' },
  ],
  'grok-com-to-openai': [
    { id: 'grok-fast', label: 'grok-fast', note: 'Standard · Schnell' },
    { id: 'grok-auto', label: 'grok-auto', note: 'Auto-Routing' },
    { id: 'grok-expert', label: 'grok-expert', note: 'Tiefes Reasoning' },
    { id: 'grok-heavy', label: 'grok-heavy', note: 'Multi-Agent' },
    { id: 'grok-build', label: 'grok-build', note: 'Coding / Architektur' },
  ],
  duck2api: [
    { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', note: 'Standard · OpenAI (Gratis)' },
    { id: 'gpt-6-luna', label: 'gpt-6-luna', note: 'OpenAI (Gratis)' },
    { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5', note: 'Anthropic (Gratis)' },
    { id: 'mistral-small-2603', label: 'mistral-small-2603', note: 'Mistral (Gratis)' },
    { id: 'tinfoil/gpt-oss-120b', label: 'tinfoil/gpt-oss-120b', note: 'Tinfoil TEE (Gratis)' },
    { id: 'tinfoil/gemma4-31b', label: 'tinfoil/gemma4-31b', note: 'Tinfoil TEE (Gratis)' },
  ],
};

const BRIDGE_EXCLUDED_MODEL_IDS: Record<string, ReadonlySet<string>> = {
  freedeepseekapi: new Set([
    'deepseek-v3',
    'deepseek-r1',
    'deepseek-expert',
    'deepseek-v4-pro',
    'deepseek-vision',
  ]),
  duck2api: new Set([
    'gpt-5.4-nano',
    'claude-haiku-4-5',
    'mistral-small',
    'gpt-5.6-terra',
    'claude-sonnet-5-5',
    'gpt-5.6-sol',
    'claude-opus-5-5',
  ]),
};

export const DUCK2API_MODELS: readonly string[] = BRIDGE_VERIFIED_MODELS.duck2api.map((m) => m.id);

export function getVerifiedBridgeModels(bridgeId?: string): readonly BridgeModelOption[] {
  if (!bridgeId) return [];
  return BRIDGE_VERIFIED_MODELS[bridgeId] ?? [];
}

/**
 * Resolves the exclusive list of verified models for a bridge.
 * When live /v1/models IDs are available from the running bridge, filters out "default"
 * and known deprecated/paid-only IDs while enriching labels with curated notes.
 */
export function resolveVerifiedBridgeModelOptions(
  bridgeId?: string,
  liveModels?: readonly string[]
): BridgeModelOption[] {
  const curated = getVerifiedBridgeModels(bridgeId);
  if (!bridgeId) return [];

  if (Array.isArray(liveModels) && liveModels.length > 0) {
    const excluded = BRIDGE_EXCLUDED_MODEL_IDS[bridgeId];
    const curatedById = new Map(curated.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const resolved: BridgeModelOption[] = [];

    for (const raw of liveModels) {
      const id = String(raw || '').trim();
      if (!id || id.toLowerCase() === 'default' || seen.has(id)) continue;
      if (excluded && excluded.has(id)) continue;
      seen.add(id);
      const match = curatedById.get(id);
      resolved.push(
        match
          ? { id: match.id, label: match.label, note: match.note }
          : { id, label: id, note: 'Live /v1/models' }
      );
    }

    if (resolved.length > 0) return resolved;
  }

  return curated.map((m) => ({ ...m }));
}

export function resolveDefaultChatModel(providerId?: string, bridgeId?: string): string {
  if (bridgeId) {
    const firstBridgeModel = BRIDGE_VERIFIED_MODELS[bridgeId]?.[0]?.id;
    if (firstBridgeModel) return firstBridgeModel;
  }
  const pid = (providerId || '').toLowerCase();
  if (pid === 'pollinations' || pid.includes('pollinations')) return 'openai-fast';
  if (pid === 'ovh-ai-endpoints' || pid.includes('ovh')) return 'gpt-oss-20b';
  if (pid === 'unrestrictable-ai') return 'abliterated-model';
  if (pid === 'obscurify-ai') return 'abliteration-ai/abliterated-model';
  if (pid === 'openuncensored') return 'abliterated-model';
  if (pid === 'magmarouter') return 'glm-5.3-xploded';
  if (pid === 'mancer-ai') return 'mythomax';
  if (pid === 'redpill-ai') return 'phala/deepseek-v4.1-flash-1017-uncensored';
  if (pid === 'tinfoil-sh') return 'deepseek-v4-1-flash';
  if (pid === 'gab-ai') return 'auto';
  if (pid === 'ablit-app') return 'ablit-flash';
  if (pid === 'abliteration-ai') return 'abliterated-model';
  if (pid === 'uplinkswitch') return 'abliterated-model';
  if (pid === 'api-airforce') return 'llama-instant';
  if (pid === 'electronhub') return 'gemma-4-uncensored:free';
  if (pid === 'chutes') return 'Qwen/Qwen3.8-27B-TEE';
  if (pid === 'aionlabs') return 'aion-labs/aion-2.0';
  return 'default';
}

export function validateChatTarget(params: {
  targetType: ChatTargetType;
  bridgeId?: string;
  providerId?: string;
  endpointUrl?: string;
  allowManualOverride?: boolean;
  providers: ClassifiedProvider[];
  bridgeSelections: BridgeSelectionEntry[];
}): ChatTargetResolution | ChatTargetError {
  const {
    targetType,
    bridgeId,
    providerId,
    endpointUrl,
    allowManualOverride,
    providers,
    bridgeSelections,
  } = params;

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
    if (!snippets.supportsOpenAiEndpoints && !allowManualOverride) {
      return {
        ok: false,
        error: `${prov.name} ist kein direkter OpenAI-/chat/completions-Endpunkt (${snippets.connectionLabel}). Wähle einen chatfähigen Provider (z. B. OVHcloud, Pollinations.AI, Groq) oder aktiviere explizit den manuellen Override.`,
      };
    }
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

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatOutboundMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentPart[];
}

const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const MAX_IMAGE_DATA_URL_CHARS = 7_500_000; // ~5.5 MB raw image

export function sanitizeChatMessages(
  messages: unknown,
  systemPrompt?: string,
  latestImages?: unknown
): ChatOutboundMessage[] {
  const out: ChatOutboundMessage[] = [];
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

  // Attach strictly validated base64 image data URLs to the last user message (for Grok Vision / OpenAI multimodal)
  if (Array.isArray(latestImages) && latestImages.length > 0) {
    const validUrls: string[] = [];
    for (const img of latestImages.slice(0, 4)) {
      const candidate =
        typeof img === 'string'
          ? img.trim()
          : img && typeof img === 'object' && typeof (img as { dataUrl?: unknown }).dataUrl === 'string'
            ? (img as { dataUrl: string }).dataUrl.trim()
            : '';
      if (
        candidate &&
        candidate.length <= MAX_IMAGE_DATA_URL_CHARS &&
        SAFE_DATA_IMAGE_RE.test(candidate)
      ) {
        validUrls.push(candidate);
      }
    }
    if (validUrls.length > 0) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'user' && typeof out[i].content === 'string') {
          const parts: ChatContentPart[] = [
            { type: 'text', text: out[i].content as string },
            ...validUrls.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ];
          out[i] = { role: 'user', content: parts };
          break;
        }
      }
    }
  }

  return out;
}

/**
 * Splits embedded `<think>...</think>` / `<thinking>...</thinking>` blocks from assistant text
 * and merges them with explicit API reasoning fields (`reasoning_content`, `reasoning`).
 */
export function splitThinkingFromText(
  rawText: string,
  explicitReasoning?: string
): { reply: string; thinking?: string } {
  const thinkParts: string[] = [];
  if (explicitReasoning && explicitReasoning.trim()) {
    thinkParts.push(explicitReasoning.trim());
  }
  let cleaned = rawText
    .replace(/<(?:think|thinking)>([\s\S]*?)<\/(?:think|thinking)>/gi, (_m, inner: string) => {
      if (inner && inner.trim()) thinkParts.push(inner.trim());
      return '';
    })
    .trim();

  // Handle truncated reasoning where the model hit max_tokens before emitting </think>
  const unclosedMatch = cleaned.match(/<(?:think|thinking)>([\s\S]*)$/i);
  if (unclosedMatch) {
    const before = cleaned.slice(0, unclosedMatch.index ?? 0).trim();
    const partialThink = (unclosedMatch[1] || '').trim();
    if (partialThink) {
      thinkParts.push(`${partialThink}\n\n[Abgeschnitten durch Token-Limit]`);
    }
    cleaned = before;
  }

  const mergedThinking = thinkParts.length > 0 ? thinkParts.join('\n\n') : undefined;
  return {
    reply:
      cleaned ||
      (unclosedMatch
        ? 'Der Gedankengang wurde durch das Token-Limit abgeschnitten (oben ausklappbar). Erhöhe „Max Antwort-Tokens“ oder stelle Thinking auf „Aus“.'
        : mergedThinking
          ? ''
          : rawText.trim()),
    thinking: mergedThinking,
  };
}

/**
 * Extracts assistant text, optional thinking/reasoning trace, and token usage from
 * OpenAI-compatible JSON, Anthropic/Ollama variants, or SSE `data: {...}` streams.
 */
export function extractChatCompletionReply(
  parsedJson: unknown,
  rawText: string
): {
  reply: string | null;
  thinking?: string;
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
        const explicitReasoning =
          typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim().length > 0
            ? msg.reasoning_content.trim()
            : typeof msg.reasoning === 'string' && msg.reasoning.trim().length > 0
              ? msg.reasoning.trim()
              : undefined;

        if (typeof msg.content === 'string' && msg.content.length > 0) {
          const split = splitThinkingFromText(msg.content, explicitReasoning);
          return {
            reply: split.reply || msg.content,
            thinking: split.thinking,
            model,
            usage,
          };
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
          if (joined) {
            const split = splitThinkingFromText(joined, explicitReasoning);
            return { reply: split.reply || joined, thinking: split.thinking, model, usage };
          }
        }
        if (explicitReasoning) {
          return { reply: explicitReasoning, thinking: explicitReasoning, model, usage };
        }
      }
      if (typeof first.text === 'string' && first.text.length > 0) {
        const split = splitThinkingFromText(first.text);
        return { reply: split.reply || first.text, thinking: split.thinking, model, usage };
      }
    }

    // Ollama native /api/chat shape: { message: { content, thinking } }
    if (obj.message && typeof obj.message === 'object') {
      const msgObj = obj.message as Record<string, unknown>;
      const mc = msgObj.content;
      const mt =
        typeof msgObj.thinking === 'string'
          ? msgObj.thinking
          : typeof msgObj.reasoning_content === 'string'
            ? msgObj.reasoning_content
            : undefined;
      if (typeof mc === 'string' && mc.length > 0) {
        const split = splitThinkingFromText(mc, mt);
        return { reply: split.reply || mc, thinking: split.thinking, model, usage };
      }
    }

    // Anthropic Messages shape: { content: [{ type: 'thinking' | 'text', text, thinking }] }
    if (Array.isArray(obj.content)) {
      const thinkChunks: string[] = [];
      const textChunks: string[] = [];
      for (const c of obj.content) {
        if (!c || typeof c !== 'object') continue;
        const rec = c as Record<string, unknown>;
        if (rec.type === 'thinking' && typeof rec.thinking === 'string') {
          thinkChunks.push(rec.thinking);
        } else if (typeof rec.text === 'string') {
          textChunks.push(rec.text);
        }
      }
      const joined = textChunks.join('');
      if (joined) {
        const split = splitThinkingFromText(joined, thinkChunks.join('\n\n'));
        return { reply: split.reply || joined, thinking: split.thinking, model, usage };
      }
    }

    // Generic fallback fields used by some lightweight bridges
    if (typeof obj.response === 'string' && obj.response.length > 0) {
      const split = splitThinkingFromText(obj.response);
      return { reply: split.reply || obj.response, thinking: split.thinking, model, usage };
    }
    if (typeof obj.reply === 'string' && obj.reply.length > 0) {
      const split = splitThinkingFromText(obj.reply);
      return { reply: split.reply || obj.reply, thinking: split.thinking, model, usage };
    }
  }

  // Fallback for bridges that force SSE (`data: {...}`) even when stream: false
  if (rawText && rawText.includes('data:')) {
    const chunks: string[] = [];
    const reasoningChunks: string[] = [];
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
          if (delta) {
            if (typeof delta.reasoning_content === 'string') {
              reasoningChunks.push(delta.reasoning_content);
            } else if (typeof delta.reasoning === 'string') {
              reasoningChunks.push(delta.reasoning);
            }
            if (typeof delta.content === 'string') {
              chunks.push(delta.content);
            }
          } else if (ch.message && typeof (ch.message as Record<string, unknown>).content === 'string') {
            chunks.push((ch.message as Record<string, unknown>).content as string);
          }
        }
      } catch {
        // ignore malformed SSE line
      }
    }
    if (chunks.length > 0 || reasoningChunks.length > 0) {
      const joined = chunks.join('');
      const joinedReason = reasoningChunks.join('');
      const split = splitThinkingFromText(joined || joinedReason, joined ? joinedReason : undefined);
      return {
        reply: split.reply || joined || joinedReason,
        thinking: split.thinking,
        model: sseModel,
      };
    }
  }

  return { reply: null };
}

const NON_CHAT_MODEL_RE =
  /(^|[-_/.])(whisper|tts|nvr-tts|solaria|embed|embedding|embeddings|bge|rerank|reranker|stable-diffusion|sdxl|flux|dall-e|moderation|transcribe|asr|stt|speech|audio-only|ocr)($|[-_/.0-9])/i;

function isLikelyNonChatModel(id: string, meta?: Record<string, unknown>): boolean {
  if (NON_CHAT_MODEL_RE.test(id)) return true;
  if (meta) {
    // OVHcloud & OpenAI-compatible registries set context_length=0 & max_completion_tokens=0 on TTS/ASR/Image models
    const ctxLen = typeof meta.context_length === 'number' ? meta.context_length : null;
    const maxComp = typeof meta.max_completion_tokens === 'number' ? meta.max_completion_tokens : null;
    if (ctxLen === 0 && (maxComp === 0 || maxComp === null)) return true;
    if (Array.isArray(meta.output_modalities) && meta.output_modalities.length > 0) {
      const outs = meta.output_modalities.map((x) => String(x).toLowerCase());
      if (!outs.includes('text')) return true;
    }
  }
  return false;
}

/**
 * Separates chat-capable LLM IDs from non-chat models (TTS, Whisper ASR, Embeddings, Image-only)
 * so chat pickers never default to models that return HTTP 404 on /v1/chat/completions.
 */
export function categorizeModelIds(parsedJson: unknown): {
  chatModels: string[];
  nonChatModels: string[];
  allModels: string[];
} {
  if (!parsedJson) return { chatModels: [], nonChatModels: [], allModels: [] };
  const chatModels: string[] = [];
  const nonChatModels: string[] = [];
  const seen = new Set<string>();

  const register = (rawId: unknown, meta?: Record<string, unknown>) => {
    if (typeof rawId !== 'string') return;
    const id = rawId.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    if (isLikelyNonChatModel(id, meta)) {
      nonChatModels.push(id);
    } else {
      chatModels.push(id);
    }
  };

  const items: unknown[] = Array.isArray(parsedJson)
    ? parsedJson
    : typeof parsedJson === 'object'
      ? Array.isArray((parsedJson as Record<string, unknown>).data)
        ? ((parsedJson as Record<string, unknown>).data as unknown[])
        : Array.isArray((parsedJson as Record<string, unknown>).models)
          ? ((parsedJson as Record<string, unknown>).models as unknown[])
          : []
      : [];

  for (const item of items) {
    if (typeof item === 'string') {
      register(item);
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      register(rec.id ?? rec.name ?? rec.model, rec);
    }
  }

  const allModels = [...chatModels, ...nonChatModels].slice(0, 120);
  return {
    chatModels: chatModels.slice(0, 100),
    nonChatModels: nonChatModels.slice(0, 40),
    allModels,
  };
}

/**
 * Extracts model identifiers from OpenAI `/v1/models`, Ollama `/api/tags`, or plain arrays,
 * prioritizing chat-capable LLM models first.
 */
export function extractModelIds(parsedJson: unknown): string[] {
  return categorizeModelIds(parsedJson).allModels;
}

