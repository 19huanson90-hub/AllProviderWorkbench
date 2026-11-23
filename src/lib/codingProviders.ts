import {
  extractChatCompletionReply,
  isLoopbackHost,
  splitThinkingFromText,
  type ChatOutboundMessage,
} from './chatEngine.ts';
import {
  buildOpenAiToolSchemas,
  buildReActToolPrompt,
  executeCodingTool,
  extractReActToolCalls,
  shouldOfferReActTools,
  type ToolExecutionContext,
} from './codingTools.ts';
import {
  HF_SPACE_PRESETS,
  type CodingToolEvent,
  type ThinkingMode,
} from './codingTypes.ts';
import type { CodingStreamEvent } from './codingStream.ts';

export type CodingStreamCallback = (event: CodingStreamEvent) => void;

const ALLOWED_TUNNEL_SUFFIXES = [
  '.trycloudflare.com',
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.io',
  '.loca.lt',
  '.gradio.live',
  '.hf.space',
];

const PRIVATE_IP_RE =
  /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80:|::1$)/i;

/**
 * Strictly validates a Cloud-GPU Notebook Tunnel URL (Kaggle / Colab -> Ollama/vLLM).
 * Permits ONLY HTTPS on allowlisted public tunnel suffixes OR local loopback (127.0.0.1/localhost).
 * Blocks arbitrary domains, credentials in URL, private LAN IPs, and cloud metadata endpoints.
 */
export function validateCloudTunnelUrl(
  rawUrl: string
): { ok: true; baseUrl: string; rootOrigin: string } | { ok: false; error: string } {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return {
      ok: false,
      error: 'Bitte die HTTPS-Tunnel-URL aus dem Kaggle/Colab-Notebook eingeben (z. B. https://xyz.trycloudflare.com/v1).',
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Ungültige Tunnel-URL-Syntax.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URL darf keine eingebetteten Zugangsdaten enthalten.' };
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = isLoopbackHost(host);

  if (isLoopback) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'Nur HTTP/HTTPS erlaubt.' };
    }
  } else {
    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'Externe Cloud-Tunnel müssen zwingend HTTPS verwenden.' };
    }
    if (PRIVATE_IP_RE.test(host)) {
      return { ok: false, error: 'SSRF-Schutz: Private IP-Adressen sind nicht zulässig.' };
    }
    const allowed = ALLOWED_TUNNEL_SUFFIXES.some((sfx) => host.endsWith(sfx) && host.length > sfx.length);
    if (!allowed) {
      return {
        ok: false,
        error: `SSRF-Schutz: Erlaubt sind nur bekannte Tunnel-Domains (${ALLOWED_TUNNEL_SUFFIXES.join(', ')}) oder 127.0.0.1.`,
      };
    }
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const baseUrl = cleanPath.endsWith('/v1')
    ? `${parsed.origin}${cleanPath}`
    : `${parsed.origin}${cleanPath}/v1`;
  return { ok: true, baseUrl, rootOrigin: parsed.origin };
}

export interface UnifiedCodingReply {
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
}

/**
 * Detects whether a model output was likely cut off mid-generation by a token limit
 * (unclosed Markdown code fence, unclosed <think> tag, or hitting >=72% of maxTokens without sentence closure).
 */
export function isLikelyTruncatedOutput(text: string, maxTokens: number): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  // Unclosed Markdown code fence (odd number of ```)
  const fenceMatches = trimmed.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 === 1) return true;
  // Unclosed <think> / <thinking> block
  if (/<(?:think|thinking)>/i.test(trimmed) && !/<\/(?:think|thinking)>/i.test(trimmed)) return true;
  // Estimate tokens (~3.6 chars/token) against requested budget
  const estTokens = trimmed.length / 3.6;
  const effectiveBudget = Math.max(48, maxTokens);
  if (estTokens >= effectiveBudget * 0.72) {
    const lastLine = trimmed.split(/\r?\n/).pop()?.trim() || '';
    const cleanlyEnded =
      /[.!?…]["'»”)]*$/.test(lastLine) ||
      lastLine === '```' ||
      /^[-*]/.test(lastLine) === false && /[;}]$/.test(lastLine);
    if (!cleanlyEnded) return true;
  }
  return false;
}

async function fetchTimed(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  const ctrl = new AbortController();
  const onExtAbort = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', onExtAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExtAbort);
  }
}

/**
 * Formats conversation history into a compact ChatML prompt string for text-completion APIs (AI Horde).
 */
export function formatMessagesAsChatMl(messages: ChatOutboundMessage[]): string {
  const chunks: string[] = [];
  for (const m of messages) {
    const txt =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n');
    chunks.push(`<|im_start|>${m.role}\n${txt.trim()}<|im_end|>`);
  }
  chunks.push('<|im_start|>assistant\n');
  return chunks.join('\n');
}

/**
 * Parses Gradio v4/v5 SSE stream (`event: complete` / `event: error`) from Hugging Face Spaces.
 */
export function parseGradioSseOutput(sseText: string): {
  ok: boolean;
  reply?: string;
  thinking?: string;
  stats?: Record<string, unknown>;
  error?: string;
} {
  let lastEvent = '';
  let completeData: unknown = null;
  let errorMsg: string | null = null;

  for (const rawLine of sseText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('event:')) {
      lastEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const payloadStr = line.slice(5).trim();
      if (!payloadStr || payloadStr === 'null') {
        if (lastEvent === 'error' && !errorMsg) {
          errorMsg = 'Hugging Face Space meldete einen internen Fehler (event: error).';
        }
        continue;
      }
      try {
        const parsed = JSON.parse(payloadStr) as unknown;
        if (lastEvent === 'error') {
          if (parsed && typeof parsed === 'object') {
            const rec = parsed as Record<string, unknown>;
            if (typeof rec.error === 'string' && rec.error.trim()) {
              errorMsg = rec.error.trim();
            } else if (typeof rec.message === 'string' && rec.message.trim()) {
              errorMsg = rec.message.trim();
            } else if (rec.error === null) {
              errorMsg =
                'Hugging Face Space meldete einen internen Serverfehler (event: error, error: null) — z. B. ungültiges Parameter-/Verlaufsformat oder kurzzeitiger Space-Neustart.';
            } else {
              errorMsg = JSON.stringify(parsed).slice(0, 300);
            }
          } else {
            errorMsg = String(parsed);
          }
        } else if (lastEvent === 'complete') {
          completeData = parsed;
        }
      } catch {
        if (lastEvent === 'error') errorMsg = payloadStr;
      }
    }
  }

  if (errorMsg) return { ok: false, error: errorMsg };
  if (!Array.isArray(completeData) || completeData.length === 0) {
    return { ok: false, error: 'Keine abgeschlossene Antwort vom Hugging Face Space erhalten.' };
  }

  const first = completeData[0];

  // Shape A: Muse-Glimmer object { reasoning, content, stats }
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    const rec = first as Record<string, unknown>;
    if (typeof rec.content === 'string') {
      const explicitReason = typeof rec.reasoning === 'string' ? rec.reasoning : undefined;
      const split = splitThinkingFromText(rec.content, explicitReason);
      return {
        ok: true,
        reply: split.reply || rec.content,
        thinking: split.thinking,
        stats: rec.stats && typeof rec.stats === 'object' ? (rec.stats as Record<string, unknown>) : undefined,
      };
    }
  }

  // Shape B: Gemma-4 Chatbot history array [[...], ...] or [{ role, content: [{ text }], metadata }]
  if (Array.isArray(first)) {
    const thinkParts: string[] = [];
    let lastAssistantText = '';
    for (const item of first) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const msg = item as Record<string, unknown>;
        if (msg.role !== 'assistant') continue;
        const meta = msg.metadata as Record<string, unknown> | undefined;
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
            .join('');
        }
        if (meta && typeof meta.title === 'string' && /think|reason/i.test(meta.title)) {
          if (text.trim()) thinkParts.push(text.trim());
        } else if (text.trim()) {
          lastAssistantText = text.trim();
        }
      }
    }
    if (lastAssistantText || thinkParts.length > 0) {
      const split = splitThinkingFromText(lastAssistantText, thinkParts.join('\n\n'));
      return {
        ok: true,
        reply: split.reply || lastAssistantText || thinkParts.join('\n\n'),
        thinking: split.thinking,
      };
    }
  }

  // Shape C: Plain string output (e.g. Qwen3-VL / DeepSeek-R1)
  if (typeof first === 'string') {
    if (first.startsWith('[ERROR]')) {
      return { ok: false, error: first };
    }
    const split = splitThinkingFromText(first);
    return { ok: true, reply: split.reply || first, thinking: split.thinking };
  }

  return { ok: false, error: `Unerwartetes Gradio-Antwortformat: ${JSON.stringify(first).slice(0, 220)}` };
}

// =========================================================================
// WEG 1: Hugging Face ZeroGPU Space Execution (with optional ReAct Tools)
// =========================================================================
export interface HfSpaceCallOptions {
  spaceId: string;
  hfToken?: string;
  messages: ChatOutboundMessage[];
  systemPrompt: string;
  thinkingMode: ThinkingMode;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  gpuDuration: number;
  useDflash: boolean;
  imageBase64?: string;
  toolCtx?: ToolExecutionContext;
  onStream?: CodingStreamCallback;
  signal?: AbortSignal;
}

export async function runHfSpaceChat(opts: HfSpaceCallOptions): Promise<UnifiedCodingReply> {
  const start = Date.now();
  const preset = HF_SPACE_PRESETS.find((p) => p.id === opts.spaceId);
  if (!preset) {
    return { ok: false, latencyMs: 0, error: `Hugging Face Space "${opts.spaceId}" ist nicht auf der verifizierten Allowlist.` };
  }

  const toolEvents: CodingToolEvent[] = [];
  const writtenFiles: string[] = [];
  const initialLastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
  const initialUserText =
    initialLastUser && typeof initialLastUser.content === 'string'
      ? initialLastUser.content
      : initialLastUser && Array.isArray(initialLastUser.content)
        ? initialLastUser.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n')
        : '';

  const offerTools = Boolean(
    opts.toolCtx && opts.toolCtx.enabledTools.size > 0 && shouldOfferReActTools(initialUserText)
  );
  const reActPrompt = offerTools && opts.toolCtx ? buildReActToolPrompt(opts.toolCtx.enabledTools) : '';
  const combinedSystem = [opts.systemPrompt, reActPrompt].filter(Boolean).join('\n\n').slice(0, 24000);

  const convo = [...opts.messages];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.hfToken && opts.hfToken.trim()) {
    headers['Authorization'] = `Bearer ${opts.hfToken.trim()}`;
  }

  // Muse-Glimmer params.py choices: ("low", "medium", "high", "xhigh")
  const reasoningLevel =
    opts.thinkingMode === 'off' ? 'low' : opts.thinkingMode === 'deep' ? 'high' : 'medium';
  const targetUrl = `${preset.host}/gradio_api/call${preset.endpoint}`;

  for (let round = 0; round < 2; round++) {
    const lastUser = [...convo].reverse().find((m) => m.role === 'user');
    const latestUserText =
      lastUser && typeof lastUser.content === 'string'
        ? lastUser.content
        : lastUser && Array.isArray(lastUser.content)
          ? lastUser.content
              .filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('\n')
          : 'Hilf mir mit dem Code.';

    // Build prior turns for Spaces that accept history
    const priorTurns = convo
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      }));

    let dataPayload: unknown[];
    if (preset.id === 'ukung/Muse-Glimmer-30B-DFlash-Abliterated') {
      // Verified against ukung/Muse-Glimmer-30B-DFlash-Abliterated app.py process_history():
      // expects { role: "user"|"assistant", text: string, files?: string[] } (NOT "content")
      // and params.py bounds: top_k [0..100], repetition_penalty [1.0..2.0], max_new_tokens [10..8000]
      const museHistory = priorTurns
        .filter((t) => t.content.trim().length > 0)
        .map((t) =>
          t.role === 'assistant'
            ? { role: 'assistant', text: t.content }
            : { role: 'user', text: t.content, files: [] }
        );
      dataPayload = [
        latestUserText,
        [],
        museHistory,
        combinedSystem,
        Math.max(64, Math.min(8000, Math.floor(opts.maxTokens))),
        Math.max(0.0, Math.min(2, opts.temperature)),
        Math.max(0.0, Math.min(1, opts.topP)),
        Math.max(0, Math.min(100, Math.floor(opts.topK))),
        Math.max(1.0, Math.min(2.0, opts.repetitionPenalty)),
        reasoningLevel,
        Math.max(5, Math.min(120, Math.floor(opts.gpuDuration))),
        Boolean(opts.useDflash),
      ];
    } else if (preset.id === 'markpaulm/gemma-4-31B-it-abliterated') {
      const gemmaHistory = priorTurns.map((t) => ({
        role: t.role,
        metadata: null,
        content: [{ text: t.content, type: 'text' }],
        options: null,
      }));
      dataPayload = [
        latestUserText,
        gemmaHistory,
        {},
        opts.thinkingMode !== 'off',
        combinedSystem,
        Math.max(64, Math.min(4096, opts.maxTokens)),
        Math.max(0.05, Math.min(2, opts.temperature)),
        Math.max(0.1, Math.min(1, opts.topP)),
        Math.max(1, Math.min(200, Math.floor(opts.topK))),
        Math.max(0.8, Math.min(2, opts.repetitionPenalty)),
      ];
    } else if (preset.id === 'prithivMLmods/Qwen3-VL-abliterated-MAX-Fast') {
      if (!opts.imageBase64) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          targetUrl,
          error:
            'Qwen3-VL-abliterated-MAX-Fast ist ein Vision-Space und benötigt ein angehängtes Bild (z. B. Code-Screenshot). Für reinen Text-Code bitte Muse-Glimmer 30B wählen.',
        };
      }
      const pureB64 = opts.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
      dataPayload = [
        `${combinedSystem ? `${combinedSystem}\n\n` : ''}${latestUserText}`,
        pureB64,
        Math.max(64, Math.min(4096, opts.maxTokens)),
        Math.max(0.05, Math.min(2, opts.temperature)),
        Math.max(0.1, Math.min(1, opts.topP)),
        Math.max(1, Math.min(200, Math.floor(opts.topK))),
        Math.max(0.8, Math.min(2, opts.repetitionPenalty)),
        Math.max(30, Math.min(120, Math.floor(opts.gpuDuration))),
      ];
    } else {
      // JonathanColetti/Qwen3.8-27B-Uncensored-Demo
      const qReasoning = opts.thinkingMode === 'off' ? 'Off' : opts.thinkingMode === 'deep' ? 'High' : 'Low';
      const promptWithSys = combinedSystem ? `[System]\n${combinedSystem}\n\n[User]\n${latestUserText}` : latestUserText;
      dataPayload = [
        { text: promptWithSys, files: [] },
        qReasoning,
        Math.max(0.05, Math.min(2, opts.temperature)),
        Math.max(0.1, Math.min(1, opts.topP)),
        Math.max(1, Math.min(200, Math.floor(opts.topK))),
      ];
    }

    try {
      opts.onStream?.({ type: 'status', message: `Verbinde mit HF Space (${preset.id})…` });
      const postRes = await fetchTimed(
        targetUrl,
        { method: 'POST', headers, body: JSON.stringify({ data: dataPayload }) },
        15000,
        opts.signal
      );
      const postTxt = await postRes.text();
      if (!postRes.ok) {
        return {
          ok: false,
          httpStatus: postRes.status,
          latencyMs: Date.now() - start,
          targetUrl,
          error: `HF Space HTTP ${postRes.status}: ${postTxt.slice(0, 260)}`,
        };
      }
      let eventId = '';
      try {
        eventId = String((JSON.parse(postTxt) as { event_id?: string }).event_id || '');
      } catch {
        // invalid JSON
      }
      if (!eventId) {
        return {
          ok: false,
          latencyMs: Date.now() - start,
          targetUrl,
          error: `Kein Gradio event_id erhalten (${postTxt.slice(0, 200)}).`,
        };
      }

      opts.onStream?.({ type: 'status', message: 'ZeroGPU-Stream aktiv — warte auf erste Tokens…' });
      const sseRes = await fetchTimed(
        `${targetUrl}/${encodeURIComponent(eventId)}`,
        { method: 'GET', headers: opts.hfToken?.trim() ? { Authorization: `Bearer ${opts.hfToken.trim()}` } : {} },
        Math.max(45000, (opts.gpuDuration + 25) * 1000),
        opts.signal
      );

      let sseText = '';
      if (opts.onStream && sseRes.body) {
        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let lineBuf = '';
        let currentEvent = '';
        let sentReply = '';
        let sentThinking = '';

        const processGradioLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:') && (currentEvent === 'generating' || currentEvent === 'complete')) {
            const payloadStr = line.slice(5).trim();
            if (!payloadStr || payloadStr === 'null') return;
            try {
              const parsedChunk = JSON.parse(payloadStr) as unknown;
              if (!Array.isArray(parsedChunk) || parsedChunk.length === 0) return;
              const first = parsedChunk[0];
              let nextReply = '';
              let nextThink = '';
              if (first && typeof first === 'object' && !Array.isArray(first)) {
                const rec = first as Record<string, unknown>;
                if (typeof rec.content === 'string') nextReply = rec.content;
                if (typeof rec.reasoning === 'string') nextThink = rec.reasoning;
              } else if (typeof first === 'string') {
                nextReply = first;
              }
              if (nextThink.length > sentThinking.length && nextThink.startsWith(sentThinking)) {
                opts.onStream?.({ type: 'thinking', delta: nextThink.slice(sentThinking.length) });
                sentThinking = nextThink;
              }
              if (nextReply.length > sentReply.length && nextReply.startsWith(sentReply)) {
                const delta = nextReply.slice(sentReply.length);
                if (!delta.includes('<tool_call>')) {
                  opts.onStream?.({ type: 'token', delta });
                }
                sentReply = nextReply;
              }
            } catch {
              // ignore partial JSON
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          sseText += chunk;
          lineBuf += chunk;
          const parts = lineBuf.split(/\r?\n/);
          lineBuf = parts.pop() || '';
          for (const p of parts) processGradioLine(p);
        }
        if (lineBuf.trim()) processGradioLine(lineBuf);
      } else {
        sseText = await sseRes.text();
      }

      const parsed = parseGradioSseOutput(sseText);
      if (!parsed.ok || !parsed.reply) {
        return {
          ok: false,
          httpStatus: sseRes.status,
          latencyMs: Date.now() - start,
          targetUrl,
          error: parsed.error || 'HF Space lieferte keine Antwort.',
          rawPreview: sseText.slice(-600),
        };
      }

      // Check for ReAct <tool_call> blocks if workspace tools are offered for this turn
      const toolCalls =
        offerTools && opts.toolCtx && round < 1
          ? extractReActToolCalls(parsed.reply)
          : [];

      if (toolCalls.length > 0 && opts.toolCtx) {
        const resultBlocks: string[] = [];
        for (const call of toolCalls) {
          const exec = executeCodingTool(call.name, call.arguments, opts.toolCtx);
          toolEvents.push(exec.event);
          opts.onStream?.({ type: 'tool', event: exec.event });
          if (exec.writtenFilePath) writtenFiles.push(exec.writtenFilePath);
          resultBlocks.push(`<tool_result name="${call.name}">\n${exec.outputText}\n</tool_result>`);
        }
        convo.push({ role: 'assistant', content: parsed.reply });
        convo.push({
          role: 'user',
          content: `${resultBlocks.join('\n\n')}\n\nAntworte jetzt dem Nutzer mit den erhaltenen Tool-Ergebnissen (ohne weitere unnötige Tool-Aufrufe).`,
        });
        continue;
      }

      return {
        ok: true,
        httpStatus: 200,
        latencyMs: Date.now() - start,
        targetUrl,
        reply: parsed.reply,
        thinking: parsed.thinking,
        model: preset.id,
        toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
        writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
        meta: parsed.stats,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        targetUrl,
        error: `HF Space Verbindungs-/Timeout-Fehler: ${err instanceof Error ? err.message : 'Unbekannt'}`,
      };
    }
  }

  return { ok: false, latencyMs: Date.now() - start, targetUrl, error: 'Maximale Tool-Runden überschritten.' };
}

// =========================================================================
// WEG 2: AI Horde Async Job + Polling Execution (with optional ReAct Tools)
// =========================================================================
export interface AiHordeCallOptions {
  model: string;
  apiKey?: string; // defaults to official anonymous "0000000000"
  messages: ChatOutboundMessage[];
  systemPrompt: string;
  maxLength: number;
  maxContextLength: number;
  temperature: number;
  topP: number;
  topK: number;
  repPen: number;
  trustedWorkers: boolean;
  slowWorkers: boolean;
  allowDowngrade: boolean;
  autoContinue?: boolean;
  toolCtx?: ToolExecutionContext;
  onStream?: CodingStreamCallback;
  signal?: AbortSignal;
}

export async function fetchAiHordeModels(): Promise<{
  ok: boolean;
  models: Array<{ name: string; count: number; eta: number; maxContext: number; jobs: number }>;
  error?: string;
}> {
  try {
    const res = await fetchTimed('https://aihorde.net/api/v2/status/models?type=text', { method: 'GET' }, 10000);
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const raw = (await res.json()) as Array<{
      name?: string;
      count?: number;
      eta?: number;
      max_context_length?: number;
      jobs?: number;
    }>;
    const models = raw
      .filter((m) => typeof m.name === 'string' && (m.count ?? 0) > 0)
      .map((m) => ({
        name: m.name!,
        count: m.count ?? 0,
        eta: m.eta ?? 0,
        maxContext: m.max_context_length ?? 4096,
        jobs: m.jobs ?? 0,
      }))
      .sort((a, b) => {
        const score = (x: { name: string; count: number; eta: number; jobs: number }) => {
          let s = x.count * 2;
          if (/uncensored|heretic|abliterat|unleashed/i.test(x.name)) s += 20;
          if (/qwen|coder|gemma-4|deepseek|behemoth|skyfall/i.test(x.name)) s += 10;
          // Strongly favor fast, uncongested models (0–10s ETA) over 60s+ queues
          if (x.eta <= 10) s += 18;
          else s -= Math.min(40, Math.floor(x.eta / 3));
          s -= Math.min(15, x.jobs);
          return s;
        };
        return score(b) - score(a);
      });
    return { ok: true, models };
  } catch (err: unknown) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : 'AI Horde nicht erreichbar' };
  }
}

export async function runAiHordeChat(opts: AiHordeCallOptions): Promise<UnifiedCodingReply> {
  const start = Date.now();
  const targetUrl = 'https://aihorde.net/api/v2/generate/text/async';
  const effectiveKey = (opts.apiKey || '').trim() || '0000000000';
  const toolEvents: CodingToolEvent[] = [];
  const writtenFiles: string[] = [];

  const lastUserMsg = [...opts.messages].reverse().find((m) => m.role === 'user');
  const latestHordeUserText =
    lastUserMsg && typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : '';
  const offerTools = Boolean(
    opts.toolCtx && opts.toolCtx.enabledTools.size > 0 && shouldOfferReActTools(latestHordeUserText)
  );
  const reActPrompt = offerTools && opts.toolCtx ? buildReActToolPrompt(opts.toolCtx.enabledTools) : '';
  const combinedSystem = [opts.systemPrompt, reActPrompt].filter(Boolean).join('\n\n').slice(0, 14000);

  const convo: ChatOutboundMessage[] = [];
  if (combinedSystem) convo.push({ role: 'system', content: combinedSystem });
  convo.push(...opts.messages.filter((m) => m.role !== 'system'));

  const requestedMaxLen = Math.max(32, Math.min(1024, Math.floor(opts.maxLength)));
  const allowAutoContinue = opts.autoContinue !== false;

  const runSingleHordeGeneration = async (
    promptText: string
  ): Promise<
    | { ok: true; text: string; model?: string; worker_name?: string; kudos?: number; hitStopToken: boolean }
    | { ok: false; httpStatus?: number; targetUrl: string; error: string }
  > => {
    const boundedPrompt = promptText.slice(-Math.max(4000, opts.maxContextLength * 3));
    const body: Record<string, unknown> = {
      prompt: boundedPrompt,
      params: {
        max_length: requestedMaxLen,
        max_context_length: Math.max(1024, Math.min(16384, Math.floor(opts.maxContextLength))),
        temperature: Math.max(0.05, Math.min(2, opts.temperature)),
        top_p: Math.max(0.1, Math.min(1, opts.topP)),
        top_k: Math.max(0, Math.min(200, Math.floor(opts.topK))),
        rep_pen: Math.max(1, Math.min(1.5, opts.repPen)),
        stop_sequence: ['<|im_end|>', '<|endoftext|>', '\n<|im_start|>user'],
      },
      trusted_workers: Boolean(opts.trustedWorkers),
      slow_workers: Boolean(opts.slowWorkers),
      allow_downgrade: Boolean(opts.allowDowngrade),
      censor_nsfw: false,
      models: opts.model && opts.model.trim() ? [opts.model.trim()] : undefined,
    };

    opts.onStream?.({
      type: 'status',
      message: `Sende Job an AI Horde (${opts.model || 'Auto-Worker'})…`,
    });
    const postRes = await fetchTimed(
      targetUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: effectiveKey,
          'Client-Agent': 'ai-provider-suite-coding-studio:1.0:workbench',
        },
        body: JSON.stringify(body),
      },
      15000,
      opts.signal
    );
    const postTxt = await postRes.text();
    if (!postRes.ok) {
      return {
        ok: false,
        httpStatus: postRes.status,
        targetUrl,
        error: `AI Horde HTTP ${postRes.status}: ${postTxt.slice(0, 260)}`,
      };
    }
    const submitted = JSON.parse(postTxt) as { id?: string; message?: string };
    if (!submitted.id) {
      return {
        ok: false,
        targetUrl,
        error: submitted.message || 'AI Horde hat keine Job-ID zurückgegeben.',
      };
    }

    const statusUrl = `https://aihorde.net/api/v2/generate/text/status/${encodeURIComponent(submitted.id)}`;
    const deadline = Date.now() + 75_000;

    while (Date.now() < deadline) {
      if (opts.signal?.aborted) {
        return { ok: false, targetUrl: statusUrl, error: 'Anfrage abgebrochen.' };
      }
      await new Promise((r) => setTimeout(r, 1200));
      const stRes = await fetchTimed(
        statusUrl,
        { method: 'GET', headers: { 'Client-Agent': 'ai-provider-suite-coding-studio:1.0:workbench' } },
        10000,
        opts.signal
      );
      if (!stRes.ok) continue;
      const st = (await stRes.json()) as {
        done?: boolean;
        faulted?: boolean;
        is_possible?: boolean;
        kudos?: number;
        queue_position?: number;
        wait_time?: number;
        processing?: number;
        generations?: Array<{ text?: string; model?: string; worker_name?: string }>;
      };
      if (st.faulted || st.is_possible === false) {
        return {
          ok: false,
          targetUrl: statusUrl,
          error:
            'AI Horde meldet: Kein passender Worker verfügbar (Tipp: "Slow Worker" oder "Allow Downgrade" aktivieren oder Modell mit vielen Workern wählen).',
        };
      }
      if (!st.done) {
        const waitHint =
          st.processing && st.processing > 0
            ? `Worker generiert aktiv (ETA ~${st.wait_time ?? 0}s)…`
            : `AI Horde Warteschlange: Position ${st.queue_position ?? '?'} · ETA ~${st.wait_time ?? '?'}s…`;
        opts.onStream?.({ type: 'status', message: waitHint });
      }
      if (st.done && Array.isArray(st.generations) && st.generations.length > 0) {
        const g = st.generations[0];
        const rawText = g.text || '';
        const hitStopToken = /<\|im_end\|>|<\|endoftext\|>|\n<\|im_start\|>user/i.test(rawText);
        return {
          ok: true,
          text: rawText.replace(/<\|im_end\|>[\s\S]*$/i, ''),
          model: g.model,
          worker_name: g.worker_name,
          kudos: st.kudos,
          hitStopToken,
        };
      }
    }

    return {
      ok: false,
      targetUrl,
      error:
        'AI Horde Zeitüberschreitung (75 s) in der Warteschlange. Tipp: Modell mit mehr Workern oder persönlichen kostenlosen Horde-Key nutzen.',
    };
  };

  for (let round = 0; round < 2; round++) {
    const basePrompt = formatMessagesAsChatMl(convo);
    try {
      const firstGen = await runSingleHordeGeneration(basePrompt);
      if (!firstGen.ok) {
        return {
          ok: false,
          httpStatus: firstGen.httpStatus,
          latencyMs: Date.now() - start,
          targetUrl: firstGen.targetUrl,
          error: firstGen.error,
        };
      }

      let combinedRaw = firstGen.text;
      if (combinedRaw && !combinedRaw.includes('<tool_call>')) {
        opts.onStream?.({ type: 'token', delta: combinedRaw });
      }
      let totalKudos = firstGen.kudos ?? 0;
      let lastModel = firstGen.model;
      let lastWorker = firstGen.worker_name;
      let continuationChunks = 0;

      // Seamless Auto-Continuation when anonymous 512-token cap cuts off code blocks or sentences
      const maxContinuations = allowAutoContinue ? 2 : 0;
      let lastHitStop = firstGen.hitStopToken;
      while (
        continuationChunks < maxContinuations &&
        !lastHitStop &&
        isLikelyTruncatedOutput(combinedRaw, requestedMaxLen) &&
        Date.now() - start < 95_000
      ) {
        opts.onStream?.({
          type: 'status',
          message: `Auto-Fortsetzung ${continuationChunks + 1}/${maxContinuations} auf AI Horde…`,
        });
        const contGen = await runSingleHordeGeneration(basePrompt + combinedRaw);
        if (!contGen.ok || !contGen.text) break;
        combinedRaw += contGen.text;
        opts.onStream?.({ type: 'token', delta: contGen.text });
        totalKudos += contGen.kudos ?? 0;
        lastModel = contGen.model || lastModel;
        lastWorker = contGen.worker_name || lastWorker;
        lastHitStop = contGen.hitStopToken;
        continuationChunks++;
      }

      const trimmedCombined = combinedRaw.trim();
      const stillTruncated = !lastHitStop && isLikelyTruncatedOutput(trimmedCombined, requestedMaxLen);
      const split = splitThinkingFromText(trimmedCombined);
      const replyText = split.reply || trimmedCombined;

      const toolCalls =
        offerTools && opts.toolCtx && round < 1
          ? extractReActToolCalls(replyText)
          : [];

      if (toolCalls.length > 0 && opts.toolCtx) {
        const resultBlocks: string[] = [];
        for (const call of toolCalls) {
          const exec = executeCodingTool(call.name, call.arguments, opts.toolCtx);
          toolEvents.push(exec.event);
          opts.onStream?.({ type: 'tool', event: exec.event });
          if (exec.writtenFilePath) writtenFiles.push(exec.writtenFilePath);
          resultBlocks.push(`<tool_result name="${call.name}">\n${exec.outputText}\n</tool_result>`);
        }
        convo.push({ role: 'assistant', content: replyText });
        convo.push({
          role: 'user',
          content: `${resultBlocks.join('\n\n')}\n\nGib nun die endgültige Antwort für den Nutzer.`,
        });
        continue;
      }

      return {
        ok: true,
        httpStatus: 200,
        latencyMs: Date.now() - start,
        targetUrl,
        reply: replyText,
        thinking: split.thinking,
        model: lastModel || opts.model,
        truncated: stillTruncated,
        toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
        writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
        meta: {
          worker: lastWorker,
          kudos: totalKudos,
          continuationChunks,
          anonymousKey: effectiveKey === '0000000000',
        },
      };
    } catch (err: unknown) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        targetUrl,
        error: `AI Horde Fehler: ${err instanceof Error ? err.message : 'Netzwerkfehler'}`,
      };
    }
  }

  return { ok: false, latencyMs: Date.now() - start, targetUrl, error: 'Maximale Tool-Runden überschritten.' };
}

// =========================================================================
// WEG 3 & WEG 4: OpenAI-Compatible Chat WITH Native Function-Calling Tools Loop
// =========================================================================
export interface OpenAiToolChatOptions {
  baseUrl: string;
  label: string;
  model: string;
  apiKey?: string;
  messages: ChatOutboundMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  numCtx?: number; // Ollama cloud tunnel option
  toolCtx?: ToolExecutionContext;
  onStream?: CodingStreamCallback;
  signal?: AbortSignal;
}

export async function runOpenAiCompatibleCodingChat(
  opts: OpenAiToolChatOptions
): Promise<UnifiedCodingReply> {
  const start = Date.now();
  const targetUrl = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const wantsStream = typeof opts.onStream === 'function';
  const headers: Record<string, string> = {
    Accept: wantsStream ? 'text/event-stream, application/json' : 'application/json',
    'Content-Type': 'application/json',
  };
  if (opts.apiKey && opts.apiKey.trim()) {
    headers['Authorization'] = `Bearer ${opts.apiKey.trim()}`;
  }

  const toolEvents: CodingToolEvent[] = [];
  const writtenFiles: string[] = [];
  const toolSchemas =
    opts.toolCtx && opts.toolCtx.enabledTools.size > 0
      ? buildOpenAiToolSchemas(opts.toolCtx.enabledTools)
      : [];

  const convo: Array<Record<string, unknown>> = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let useNativeTools = toolSchemas.length > 0;
  let retried429 = false;

  for (let round = 0; round < 4; round++) {
    const payload: Record<string, unknown> = {
      model: opts.model.trim() || 'default',
      messages: convo,
      stream: wantsStream,
    };
    if (typeof opts.temperature === 'number' && Number.isFinite(opts.temperature)) {
      payload.temperature = Math.max(0, Math.min(2, opts.temperature));
    }
    if (typeof opts.topP === 'number' && Number.isFinite(opts.topP)) {
      payload.top_p = Math.max(0.05, Math.min(1, opts.topP));
    }
    if (typeof opts.maxTokens === 'number' && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0) {
      payload.max_tokens = Math.min(16384, Math.floor(opts.maxTokens));
    }
    if (typeof opts.presencePenalty === 'number' && Number.isFinite(opts.presencePenalty) && opts.presencePenalty !== 0) {
      payload.presence_penalty = Math.max(-2, Math.min(2, opts.presencePenalty));
    }
    if (typeof opts.frequencyPenalty === 'number' && Number.isFinite(opts.frequencyPenalty) && opts.frequencyPenalty !== 0) {
      payload.frequency_penalty = Math.max(-2, Math.min(2, opts.frequencyPenalty));
    }
    if (typeof opts.seed === 'number' && Number.isInteger(opts.seed)) {
      payload.seed = opts.seed;
    }
    if (typeof opts.numCtx === 'number' && opts.numCtx >= 1024) {
      payload.options = { num_ctx: Math.min(65536, Math.floor(opts.numCtx)) };
    }
    if (useNativeTools && toolSchemas.length > 0 && round < 3) {
      payload.tools = toolSchemas;
      payload.tool_choice = 'auto';
    }

    try {
      opts.onStream?.({
        type: 'status',
        message: round === 0 ? `Verbinde mit ${opts.label} (${opts.model})…` : `Tool-Runde ${round + 1} mit ${opts.label}…`,
      });
      const response = await fetchTimed(
        targetUrl,
        { method: 'POST', headers, body: JSON.stringify(payload) },
        95000,
        opts.signal
      );

      // Transient burst HTTP 429 (e.g. OVHcloud free tier): wait 2.2s and retry once automatically
      if (response.status === 429 && !retried429) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore
        }
        retried429 = true;
        opts.onStream?.({ type: 'status', message: `Rate-Limit (429) bei ${opts.label} — automatischer Retry in 2,2 s…` });
        await new Promise((r) => setTimeout(r, 2200));
        round--;
        continue;
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();

      // True OpenAI SSE streaming path
      if (wantsStream && response.ok && contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        let accReply = '';
        let accThinking = '';
        let finishReason: string | undefined;
        let streamModel: string | undefined;
        let streamUsage: UnifiedCodingReply['usage'] | undefined;
        const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>();

        const handleSseLine = (rawLine: string) => {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) return;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') return;
          try {
            const chunk = JSON.parse(dataStr) as Record<string, unknown>;
            if (typeof chunk.model === 'string' && chunk.model) streamModel = chunk.model;
            if (chunk.usage && typeof chunk.usage === 'object') {
              const u = chunk.usage as Record<string, unknown>;
              streamUsage = {
                prompt_tokens: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined,
                completion_tokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined,
                total_tokens: typeof u.total_tokens === 'number' ? u.total_tokens : undefined,
              };
            }
            const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as Record<string, unknown>) : null;
            if (!choice) return;
            if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
            const delta = choice.delta as Record<string, unknown> | undefined;
            if (!delta) return;

            const reasonDelta =
              typeof delta.reasoning_content === 'string'
                ? delta.reasoning_content
                : typeof delta.reasoning === 'string'
                  ? delta.reasoning
                  : '';
            if (reasonDelta) {
              accThinking += reasonDelta;
              opts.onStream?.({ type: 'thinking', delta: reasonDelta });
            }

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              accReply += delta.content;
              opts.onStream?.({ type: 'token', delta: delta.content });
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const rawTc of delta.tool_calls) {
                if (!rawTc || typeof rawTc !== 'object') continue;
                const tc = rawTc as {
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                };
                const idx = typeof tc.index === 'number' ? tc.index : 0;
                const cur = toolCallAcc.get(idx) || { id: '', name: '', arguments: '' };
                if (typeof tc.id === 'string' && tc.id) cur.id = tc.id;
                if (typeof tc.function?.name === 'string') cur.name += tc.function.name;
                if (typeof tc.function?.arguments === 'string') cur.arguments += tc.function.arguments;
                toolCallAcc.set(idx, cur);
              }
            }
          } catch {
            // ignore malformed SSE chunk
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });
          const lines = sseBuf.split(/\r?\n/);
          sseBuf = lines.pop() || '';
          for (const l of lines) handleSseLine(l);
        }
        if (sseBuf.trim()) handleSseLine(sseBuf);

        // Execute accumulated streamed tool calls if present
        if (toolCallAcc.size > 0 && opts.toolCtx && round < 3) {
          const assembled = Array.from(toolCallAcc.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([idx, tc]) => ({
              id: tc.id || `call_${round}_${idx}`,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments || '{}' },
            }));
          convo.push({
            role: 'assistant',
            content: accReply || null,
            tool_calls: assembled,
          });
          for (const tc of assembled.slice(0, 4)) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
            } catch {
              parsedArgs = {};
            }
            const exec = executeCodingTool(tc.function.name, parsedArgs, opts.toolCtx);
            toolEvents.push(exec.event);
            opts.onStream?.({ type: 'tool', event: exec.event });
            if (exec.writtenFilePath) writtenFiles.push(exec.writtenFilePath);
            convo.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: exec.outputText,
            });
          }
          continue;
        }

        const split = splitThinkingFromText(accReply, accThinking || undefined);
        const finalReply = split.reply || accReply;
        const isCutOff =
          finishReason === 'length' ||
          isLikelyTruncatedOutput(finalReply, opts.maxTokens ?? 4096);
        return {
          ok: true,
          httpStatus: response.status,
          latencyMs: Date.now() - start,
          targetUrl,
          reply: finalReply,
          thinking: split.thinking,
          model: streamModel || opts.model,
          usage: streamUsage,
          truncated: isCutOff,
          toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
          writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
        };
      }

      const rawText = (await response.text()).slice(0, 180000);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // SSE or HTML
      }

      // If endpoint rejects `tools` parameter with HTTP 400/422, automatically retry cleanly without tools!
      if (
        !response.ok &&
        useNativeTools &&
        (response.status === 400 || response.status === 422) &&
        /tool|function|unsupported|not supported/i.test(rawText)
      ) {
        useNativeTools = false;
        continue;
      }

      // Check for OpenAI native tool_calls in choices[0].message.tool_calls
      if (response.ok && parsed && typeof parsed === 'object' && opts.toolCtx) {
        const obj = parsed as Record<string, unknown>;
        const firstChoice = Array.isArray(obj.choices) ? (obj.choices[0] as Record<string, unknown>) : null;
        const msgObj = firstChoice?.message as Record<string, unknown> | undefined;
        const nativeCalls = Array.isArray(msgObj?.tool_calls)
          ? (msgObj.tool_calls as Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>)
          : [];

        if (nativeCalls.length > 0 && round < 3) {
          convo.push({
            role: 'assistant',
            content: typeof msgObj?.content === 'string' ? msgObj.content : null,
            tool_calls: nativeCalls,
          });
          for (const tc of nativeCalls.slice(0, 4)) {
            const fnName = tc.function?.name || '';
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = tc.function?.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
            } catch {
              parsedArgs = {};
            }
            const exec = executeCodingTool(fnName, parsedArgs, opts.toolCtx);
            toolEvents.push(exec.event);
            opts.onStream?.({ type: 'tool', event: exec.event });
            if (exec.writtenFilePath) writtenFiles.push(exec.writtenFilePath);
            convo.push({
              role: 'tool',
              tool_call_id: tc.id || exec.event.id,
              content: exec.outputText,
            });
          }
          continue;
        }
      }

      const extracted = extractChatCompletionReply(parsed, rawText);
      if (response.ok && extracted.reply !== null) {
        if (extracted.thinking) opts.onStream?.({ type: 'thinking', delta: extracted.thinking });
        opts.onStream?.({ type: 'token', delta: extracted.reply });
        const finishReason =
          parsed && typeof parsed === 'object' && Array.isArray((parsed as { choices?: unknown[] }).choices)
            ? ((parsed as { choices: Array<{ finish_reason?: unknown }> }).choices[0]?.finish_reason as string | undefined)
            : undefined;
        const isCutOff =
          finishReason === 'length' ||
          isLikelyTruncatedOutput(extracted.reply, opts.maxTokens ?? 4096);
        return {
          ok: true,
          httpStatus: response.status,
          latencyMs: Date.now() - start,
          targetUrl,
          reply: extracted.reply,
          thinking: extracted.thinking,
          model: extracted.model || opts.model,
          usage: extracted.usage,
          truncated: isCutOff,
          toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
          writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
        };
      }

      const errHint =
        extracted.errorMessage ||
        (response.status === 401 || response.status === 403
          ? `HTTP ${response.status}: API-Key fehlt oder ungültig für ${opts.label}.`
          : response.status === 429
            ? `HTTP 429: Rate-Limit erreicht bei ${opts.label}.`
            : `HTTP ${response.status} von ${opts.label}.`);

      return {
        ok: false,
        httpStatus: response.status,
        latencyMs: Date.now() - start,
        targetUrl,
        error: errHint,
        rawPreview: rawText.slice(0, 700),
        toolEvents: toolEvents.length > 0 ? toolEvents : undefined,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        httpStatus: 502,
        latencyMs: Date.now() - start,
        targetUrl,
        error: `Verbindungsfehler zu ${opts.label}: ${err instanceof Error ? err.message.slice(0, 160) : 'Unbekannt'}`,
      };
    }
  }

  return { ok: false, latencyMs: Date.now() - start, targetUrl, error: 'Maximale Tool-Runden erreicht.' };
}
