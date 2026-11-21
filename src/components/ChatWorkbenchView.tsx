import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  GitMerge,
  KeyRound,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTargetType } from '../lib/chatEngine.ts';
import { buildConnectionSnippets, isUsableGreenOrGelb } from '../lib/testEngine.ts';
import type {
  BridgeRuntimeState,
  BridgeSelectionEntry,
  ClassifiedProvider,
} from '../lib/types.ts';
import { SecurityClassTag } from './SecurityIndicator.tsx';

export interface ChatTargetPreset {
  targetType: ChatTargetType;
  bridgeId?: string;
  providerId?: string;
  endpointUrl?: string;
  nonce: number;
}

interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  createdAt: string;
  model?: string;
  latencyMs?: number;
  httpStatus?: number;
  targetUrl?: string;
  rawPreview?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatWorkbenchViewProps {
  providers: ClassifiedProvider[];
  bridgeSelections: BridgeSelectionEntry[];
  bridgeRuntimes: BridgeRuntimeState[];
  executingBridgeId: string | null;
  initialTarget: ChatTargetPreset | null;
  onExecuteBridge: (bridgeId: string, confirmTosRisk: boolean) => Promise<void> | void;
  onStopBridge: (bridgeId: string) => Promise<void> | void;
  onProbeBridge: (bridgeId: string) => Promise<void> | void;
}

const LOCAL_PRESETS = [
  { label: 'Ollama', url: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
  { label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { label: 'vLLM', url: 'http://127.0.0.1:8000/v1', model: 'default' },
  { label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', model: 'default' },
];

const STARTER_PROMPTS = [
  'Verbindungstest: Nenne kurz dein aktives Modell und bestätige mit „Bereit“.',
  'Erkläre in 3 knappen Sätzen den Unterschied zwischen TCP und UDP.',
  'Schreibe eine kurze Python-Funktion, die Duplikate aus einer Liste entfernt und die Reihenfolge behält.',
];

export function ChatWorkbenchView({
  providers,
  bridgeSelections,
  bridgeRuntimes,
  executingBridgeId,
  initialTarget,
  onExecuteBridge,
  onStopBridge,
  onProbeBridge,
}: ChatWorkbenchViewProps) {
  const allowlistedBridges = useMemo(
    () => bridgeSelections.filter((b) => b.bridge_id && b.docker_capable && b.port),
    [bridgeSelections]
  );

  const usableProviders = useMemo(() => {
    const list = providers.filter((p) => isUsableGreenOrGelb(p));
    // Sort OpenAI-compatible REST & GRÜN entries first for faster discovery
    return list.sort((a, b) => {
      const aRest = buildConnectionSnippets(a).supportsOpenAiEndpoints ? 0 : 1;
      const bRest = buildConnectionSnippets(b).supportsOpenAiEndpoints ? 0 : 1;
      if (aRest !== bRest) return aRest - bRest;
      if (a.securityClass !== b.securityClass) {
        return a.securityClass === 'GRUEN' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'de');
    });
  }, [providers]);

  const defaultProviderId = useMemo(() => {
    const preferred = ['groq', 'openrouter', 'deepseek-api', 'ollama', 'cerebras'];
    for (const pid of preferred) {
      if (usableProviders.some((p) => p.id === pid)) return pid;
    }
    return usableProviders[0]?.id ?? '';
  }, [usableProviders]);

  const [targetType, setTargetType] = useState<ChatTargetType>('bridge');
  const [selectedBridgeId, setSelectedBridgeId] = useState<string>(
    allowlistedBridges[0]?.bridge_id ?? ''
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(defaultProviderId);
  const [providerSearch, setProviderSearch] = useState<string>('');
  const [endpointUrl, setEndpointUrl] = useState<string>(() => {
    const firstBridge = allowlistedBridges[0];
    return firstBridge?.port ? `http://127.0.0.1:${firstBridge.port}/v1` : 'http://127.0.0.1:4000/v1';
  });
  const [modelId, setModelId] = useState<string>('default');
  const [apiKey, setApiKey] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.4);
  const [maxTokens, setMaxTokens] = useState<number>(1024);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [modelsNote, setModelsNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [tosConfirmedMap, setTosConfirmedMap] = useState<Record<string, boolean>>({});
  const [probingBridge, setProbingBridge] = useState<boolean>(false);

  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [draft, setDraft] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const runtimeById = useMemo(
    () => new Map(bridgeRuntimes.map((rt) => [rt.bridgeId, rt])),
    [bridgeRuntimes]
  );

  const activeBridge = useMemo(
    () => allowlistedBridges.find((b) => b.bridge_id === selectedBridgeId) ?? null,
    [allowlistedBridges, selectedBridgeId]
  );
  const activeBridgeRuntime = activeBridge?.bridge_id
    ? runtimeById.get(activeBridge.bridge_id)
    : undefined;

  const activeProvider = useMemo(
    () => usableProviders.find((p) => p.id === selectedProviderId) ?? null,
    [usableProviders, selectedProviderId]
  );
  const activeProviderSnippets = useMemo(
    () => (activeProvider ? buildConnectionSnippets(activeProvider) : null),
    [activeProvider]
  );

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    if (!q) return usableProviders.slice(0, 80);
    return usableProviders
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.url.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [usableProviders, providerSearch]);

  // Apply external preselection when user clicks "Im Chat öffnen" from Provider Drawer or Bridge View
  useEffect(() => {
    if (!initialTarget) return;
    setTargetType(initialTarget.targetType);
    setAvailableModels([]);
    setModelsNote(null);

    if (initialTarget.targetType === 'bridge' && initialTarget.bridgeId) {
      setSelectedBridgeId(initialTarget.bridgeId);
      const b = allowlistedBridges.find((x) => x.bridge_id === initialTarget.bridgeId);
      if (b?.port) {
        setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
      }
      setModelId('default');
    } else if (initialTarget.targetType === 'provider' && initialTarget.providerId) {
      setSelectedProviderId(initialTarget.providerId);
      const p = usableProviders.find((x) => x.id === initialTarget.providerId);
      if (p) {
        setEndpointUrl(initialTarget.endpointUrl || buildConnectionSnippets(p).defaultApiBase);
      }
      setModelId('default');
    } else if (initialTarget.targetType === 'litellm') {
      setEndpointUrl(initialTarget.endpointUrl || 'http://127.0.0.1:4000/v1');
      setModelId('default');
    } else if (initialTarget.targetType === 'custom_local') {
      setEndpointUrl(initialTarget.endpointUrl || 'http://127.0.0.1:11434/v1');
    }
  }, [initialTarget, allowlistedBridges, usableProviders]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  const handleSelectTargetType = (next: ChatTargetType) => {
    setTargetType(next);
    setAvailableModels([]);
    setModelsNote(null);
    if (next === 'bridge') {
      const b = allowlistedBridges.find((x) => x.bridge_id === selectedBridgeId) || allowlistedBridges[0];
      if (b?.bridge_id) setSelectedBridgeId(b.bridge_id);
      if (b?.port) setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
    } else if (next === 'provider') {
      const p = usableProviders.find((x) => x.id === selectedProviderId) || usableProviders[0];
      if (p) {
        setSelectedProviderId(p.id);
        setEndpointUrl(buildConnectionSnippets(p).defaultApiBase);
      }
    } else if (next === 'litellm') {
      setEndpointUrl('http://127.0.0.1:4000/v1');
    } else if (next === 'custom_local') {
      setEndpointUrl('http://127.0.0.1:11434/v1');
    }
  };

  const handleSelectBridge = (bridgeId: string) => {
    setSelectedBridgeId(bridgeId);
    setAvailableModels([]);
    setModelsNote(null);
    const b = allowlistedBridges.find((x) => x.bridge_id === bridgeId);
    if (b?.port) {
      setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
    }
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setAvailableModels([]);
    setModelsNote(null);
    const p = usableProviders.find((x) => x.id === providerId);
    if (p) {
      setEndpointUrl(buildConnectionSnippets(p).defaultApiBase);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    setModelsNote(null);
    try {
      const res = await fetch('/api/chat/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl: endpointUrl.trim(),
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        models?: string[];
        httpStatus?: number;
        latencyMs?: number;
        error?: string;
      };
      if (json.ok && Array.isArray(json.models) && json.models.length > 0) {
        setAvailableModels(json.models);
        setModelId(json.models[0]);
        setModelsNote({
          ok: true,
          text: `${json.models.length} Modelle geladen (${json.latencyMs ?? 0} ms).`,
        });
      } else if (json.ok) {
        setAvailableModels([]);
        setModelsNote({
          ok: true,
          text: `HTTP ${json.httpStatus ?? 200} — Endpunkt aktiv, aber leere Modell-Liste. Modell-ID manuell eingeben.`,
        });
      } else {
        setAvailableModels([]);
        setModelsNote({
          ok: false,
          text: json.error || `Modelle konnten nicht geladen werden (HTTP ${res.status}).`,
        });
      }
    } catch (err: unknown) {
      setModelsNote({
        ok: false,
        text: err instanceof Error ? err.message : 'Verbindungsfehler beim Laden der Modelle.',
      });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleProbeActiveBridge = async () => {
    if (!activeBridge?.bridge_id) return;
    setProbingBridge(true);
    try {
      await onProbeBridge(activeBridge.bridge_id);
    } finally {
      setProbingBridge(false);
    }
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || sending) return;

    const userMsg: ChatMessageItem = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      createdAt: new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!overrideText) setDraft('');
    setSending(true);

    const apiHistory = nextHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl: endpointUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          model: modelId.trim() || 'default',
          messages: apiHistory,
          systemPrompt: systemPrompt.trim() || undefined,
          temperature,
          maxTokens,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        reply?: string;
        model?: string;
        httpStatus?: number;
        latencyMs?: number;
        targetUrl?: string;
        rawPreview?: string;
        error?: string;
        usage?: ChatMessageItem['usage'];
      };

      const ts = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (json.ok && typeof json.reply === 'string') {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: json.reply!,
            createdAt: ts,
            model: json.model || modelId,
            latencyMs: json.latencyMs,
            httpStatus: json.httpStatus,
            targetUrl: json.targetUrl,
            usage: json.usage,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'error',
            content: json.error || `Anfrage fehlgeschlagen (HTTP ${res.status}).`,
            createdAt: ts,
            latencyMs: json.latencyMs,
            httpStatus: json.httpStatus ?? res.status,
            targetUrl: json.targetUrl,
            rawPreview: json.rawPreview,
          },
        ]);
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'error',
          content: isAbort
            ? 'Anfrage manuell abgebrochen.'
            : err instanceof Error
              ? err.message
              : 'Netzwerkfehler beim Senden.',
          createdAt: new Date().toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
        },
      ]);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const handleStopSending = () => {
    abortRef.current?.abort();
  };

  const handleCopyMessage = async (msg: ChatMessageItem) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((cur) => (cur === msg.id ? null : cur)), 1600);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const activeTitle =
    targetType === 'bridge'
      ? activeBridge
        ? `${activeBridge.zielprovider} — ${activeBridge.bridge_id}`
        : 'Keine Bridge gewählt'
      : targetType === 'provider'
        ? activeProvider?.name || 'Kein Provider gewählt'
        : targetType === 'litellm'
          ? 'LiteLLM-Router (GRÜN)'
          : 'Eigener lokaler OpenAI-Server';

  const isNonRestProvider =
    targetType === 'provider' &&
    activeProviderSnippets &&
    !activeProviderSnippets.supportsOpenAiEndpoints;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Left Configuration Rail */}
      <aside className="space-y-4 lg:col-span-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Verbindungsziel</h2>
            <span className="font-mono text-[11px] text-slate-500">SSRF · Regel 1–5</span>
          </div>

          {/* 4-Mode Segmented Control */}
          <div
            role="tablist"
            aria-label="Chat-Zielmodus"
            className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2"
          >
            {(
              [
                { id: 'bridge', label: 'Bridge (ROT)', icon: GitMerge },
                { id: 'provider', label: 'Provider (G/Y)', icon: Zap },
                { id: 'litellm', label: 'LiteLLM-Router', icon: Server },
                { id: 'custom_local', label: 'Lokal (127.0.0.1)', icon: Activity },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = targetType === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleSelectTargetType(tab.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                    active
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Mode-Specific Selector */}
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            {targetType === 'bridge' && (
              <>
                <div>
                  <label
                    htmlFor="chat-bridge-select"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Allowlist-Bridge (lokal 127.0.0.1)
                  </label>
                  <select
                    id="chat-bridge-select"
                    value={selectedBridgeId}
                    onChange={(e) => handleSelectBridge(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {allowlistedBridges.map((b) => {
                      const rt = b.bridge_id ? runtimeById.get(b.bridge_id) : undefined;
                      const statusTxt = rt?.status === 'running' ? 'LÄUFT' : 'GESTOPPT';
                      return (
                        <option key={b.bridge_id} value={b.bridge_id!}>
                          {b.zielprovider} — {b.bridge_id} (:{b.port} · {statusTxt})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {activeBridge && activeBridge.bridge_id && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold text-red-700">
                        ROT · 127.0.0.1:{activeBridge.port}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          activeBridgeRuntime?.status === 'running'
                            ? 'text-emerald-700'
                            : activeBridgeRuntime?.status === 'error'
                              ? 'text-red-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {activeBridgeRuntime?.status === 'running'
                          ? 'LÄUFT'
                          : activeBridgeRuntime?.status === 'cloning'
                            ? 'KLONT…'
                            : activeBridgeRuntime?.status === 'starting'
                              ? 'STARTET…'
                              : activeBridgeRuntime?.status === 'error'
                                ? 'FEHLER'
                                : 'GESTOPPT'}
                      </span>
                    </div>

                    {activeBridgeRuntime?.status !== 'running' && (
                      <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded border border-red-200 bg-white p-2 text-[11px] text-slate-800">
                        <input
                          type="checkbox"
                          checked={Boolean(tosConfirmedMap[activeBridge.bridge_id])}
                          onChange={(e) =>
                            setTosConfirmedMap((prev) => ({
                              ...prev,
                              [activeBridge.bridge_id!]: e.target.checked,
                            }))
                          }
                          className="mt-0.5 h-3.5 w-3.5 accent-teal-700"
                        />
                        <span>ToS-Restrisiko (Regel 5) bestätigt — lokal starten</span>
                      </label>
                    )}

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {activeBridgeRuntime?.status !== 'running' ? (
                        <button
                          type="button"
                          onClick={() =>
                            void onExecuteBridge(
                              activeBridge.bridge_id!,
                              Boolean(tosConfirmedMap[activeBridge.bridge_id!])
                            )
                          }
                          disabled={
                            !tosConfirmedMap[activeBridge.bridge_id] ||
                            executingBridgeId === activeBridge.bridge_id
                          }
                          className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                        >
                          {executingBridgeId === activeBridge.bridge_id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            <Play className="h-3 w-3" aria-hidden="true" />
                          )}
                          Bridge starten
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void onStopBridge(activeBridge.bridge_id!)}
                          className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-800 hover:bg-red-100"
                        >
                          <Square className="h-3 w-3" aria-hidden="true" />
                          Stoppen
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleProbeActiveBridge()}
                        disabled={probingBridge}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <Activity className="h-3 w-3 text-teal-700" aria-hidden="true" />
                        {probingBridge ? 'Prüfe…' : 'Loopback prüfen'}
                      </button>
                    </div>

                    {activeBridgeRuntime?.error && (
                      <p className="mt-2 text-[11px] text-red-700">{activeBridgeRuntime.error}</p>
                    )}
                    {activeBridgeRuntime?.lastProbeStatus && (
                      <p className="mt-1.5 font-mono text-[11px] text-slate-600">
                        Probe: {activeBridgeRuntime.lastProbeStatus}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {targetType === 'provider' && (
              <>
                <div>
                  <label
                    htmlFor="chat-provider-search"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Provider filtern ({usableProviders.length} GRÜN/GELB)
                  </label>
                  <div className="relative mt-1">
                    <Search
                      className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="chat-provider-search"
                      type="text"
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                      placeholder="z. B. groq, openrouter, ollama, deepseek…"
                      className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="chat-provider-select"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Provider auswählen
                  </label>
                  <select
                    id="chat-provider-select"
                    value={selectedProviderId}
                    onChange={(e) => handleSelectProvider(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                  >
                    {filteredProviders.map((p) => {
                      const rest = buildConnectionSnippets(p).supportsOpenAiEndpoints;
                      return (
                        <option key={p.id} value={p.id}>
                          [{p.securityClass}] {p.name} ({rest ? 'REST' : p.verbindungsart})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {isNonRestProvider && activeProvider && activeProviderSnippets && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-950">
                    <p className="flex items-center gap-1.5 font-semibold text-amber-900">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Hinweis ({activeProviderSnippets.connectionKind})
                    </p>
                    <p className="mt-1 leading-relaxed">{activeProviderSnippets.endpointNote}</p>
                    {/^https?:\/\//i.test(activeProvider.url) && (
                      <a
                        href={activeProvider.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 font-medium text-teal-800 hover:underline"
                      >
                        Offizielle Seite öffnen
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                )}
              </>
            )}

            {targetType === 'litellm' && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50/70 p-2.5 text-[11px] text-emerald-950">
                Spricht den zentralen <strong>GRÜNEN LiteLLM-Router</strong> auf{' '}
                <code className="font-mono">127.0.0.1:4000/v1</code> an (alle aktivierten Modelle
                aus <code className="font-mono">litellm_config.yaml</code>).
              </p>
            )}

            {targetType === 'custom_local' && (
              <div>
                <p className="text-[11px] text-slate-600">
                  Schnellwahl für lokale OpenAI-kompatible Server (strikt 127.0.0.1):
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {LOCAL_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setEndpointUrl(preset.url);
                        setModelId(preset.model);
                      }}
                      className="rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-800 hover:bg-slate-100"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Shared Connection Fields */}
            <div>
              <label
                htmlFor="chat-endpoint-url"
                className="block text-xs font-medium text-slate-700"
              >
                OpenAI-kompatible Basis-URL
              </label>
              <input
                id="chat-endpoint-url"
                type="text"
                value={endpointUrl}
                readOnly={targetType === 'bridge'}
                onChange={(e) => setEndpointUrl(e.target.value)}
                className={`mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none ${
                  targetType === 'bridge' ? 'bg-slate-100 text-slate-600' : 'bg-white'
                }`}
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="chat-model-id"
                  className="block text-xs font-medium text-slate-700"
                >
                  Modell-ID
                </label>
                <button
                  type="button"
                  onClick={() => void handleLoadModels()}
                  disabled={loadingModels}
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${loadingModels ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  {loadingModels ? 'Lädt…' : 'Modelle laden'}
                </button>
              </div>
              <input
                id="chat-model-id"
                type="text"
                list="chat-loaded-models"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="z. B. llama-3.3-70b-versatile, deepseek-chat, default"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <datalist id="chat-loaded-models">
                {availableModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {modelsNote && (
                <p
                  className={`mt-1 text-[11px] ${modelsNote.ok ? 'text-emerald-700' : 'text-red-700'}`}
                >
                  {modelsNote.text}
                </p>
              )}
              {availableModels.length > 0 && (
                <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {availableModels.slice(0, 12).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModelId(m)}
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        modelId === m
                          ? 'border-teal-700 bg-teal-50 text-teal-900'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="chat-api-key"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-700"
              >
                <KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                Session-Key / Bridge-Token (nur RAM)
              </label>
              <input
                id="chat-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  targetType === 'provider' && activeProvider?.expectedEnvVar
                    ? `Optional (Env: ${activeProvider.expectedEnvVar})`
                    : 'Optional – wird niemals gespeichert (Regel 2)'
                }
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>

            {/* Collapsible System Prompt & Generation Params */}
            <div className="border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between text-xs font-medium text-slate-700 hover:text-slate-950"
              >
                <span className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  System-Prompt & Parameter
                </span>
                {showAdvanced ? (
                  <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-2.5 space-y-2.5">
                  <div>
                    <label
                      htmlFor="chat-system-prompt"
                      className="block text-[11px] font-medium text-slate-600"
                    >
                      System-Prompt (optional)
                    </label>
                    <textarea
                      id="chat-system-prompt"
                      rows={2}
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="z. B. Antworte präzise auf Deutsch."
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label
                        htmlFor="chat-temperature"
                        className="block text-[11px] font-medium text-slate-600"
                      >
                        Temperature ({temperature.toFixed(1)})
                      </label>
                      <input
                        id="chat-temperature"
                        type="range"
                        min={0}
                        max={1.5}
                        step={0.1}
                        value={temperature}
                        onChange={(e) => setTemperature(Number(e.target.value))}
                        className="mt-1 w-full accent-teal-700"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="chat-max-tokens"
                        className="block text-[11px] font-medium text-slate-600"
                      >
                        Max Tokens
                      </label>
                      <input
                        id="chat-max-tokens"
                        type="number"
                        min={32}
                        max={8192}
                        step={64}
                        value={maxTokens}
                        onChange={(e) => setMaxTokens(Number(e.target.value) || 512)}
                        className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </aside>

      {/* Main Chat Conversation Window */}
      <section
        aria-label="Direkt-Chat Verlauf"
        className="flex min-h-[580px] flex-col rounded-lg border border-slate-200 bg-white lg:col-span-8 lg:h-[calc(100vh-8.5rem)]"
      >
        {/* Chat Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {targetType === 'bridge' ? (
                <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-700">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  BRIDGE (ROT)
                </span>
              ) : targetType === 'provider' && activeProvider ? (
                <SecurityClassTag secClass={activeProvider.securityClass} />
              ) : (
                <span className="font-mono text-xs font-semibold text-emerald-700">
                  LOKAL (127.0.0.1)
                </span>
              )}
              <h2 className="truncate text-sm font-semibold text-slate-900">{activeTitle}</h2>
            </div>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {endpointUrl}/chat/completions · Modell: <strong className="text-slate-700">{modelId || 'default'}</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setMessages([])}
            disabled={messages.length === 0 || sending}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Verlauf leeren
          </button>
        </div>

        {/* Message List */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-teal-700">
                <MessageSquare className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">
                Direkt-Chat über {activeTitle}
              </h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600">
                Sende Nachrichten direkt an die ausgewählte Bridge, den GRÜN/GELB-Provider, den
                LiteLLM-Router oder einen lokalen Server auf <code className="font-mono">127.0.0.1</code>.
                Keys bleiben strikt im RAM.
              </p>
              <div className="mt-5 grid w-full max-w-xl grid-cols-1 gap-2">
                {STARTER_PROMPTS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => void handleSend(sp)}
                    disabled={sending}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left text-xs text-slate-700 transition-colors hover:border-teal-600 hover:bg-teal-50/50 hover:text-slate-950"
                  >
                    {sp}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <article
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-lg border px-4 py-3 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'border-teal-700 bg-teal-700 text-white'
                      : msg.role === 'error'
                        ? 'border-red-200 bg-red-50 text-red-950'
                        : 'border-slate-200 bg-slate-50 text-slate-900'
                  }`}
                >
                  <div
                    className={`mb-1 flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] ${
                      msg.role === 'user'
                        ? 'text-teal-100'
                        : msg.role === 'error'
                          ? 'text-red-700'
                          : 'text-slate-500'
                    }`}
                  >
                    <span>
                      {msg.role === 'user'
                        ? 'DU'
                        : msg.role === 'error'
                          ? `FEHLER${msg.httpStatus ? ` · HTTP ${msg.httpStatus}` : ''}`
                          : (msg.model || 'ASSISTANT').toUpperCase()}
                    </span>
                    <span className="flex items-center gap-2">
                      {typeof msg.latencyMs === 'number' && <span>{msg.latencyMs} ms</span>}
                      {msg.usage?.total_tokens !== undefined && (
                        <span>{msg.usage.total_tokens} tok</span>
                      )}
                      <span>{msg.createdAt}</span>
                    </span>
                  </div>

                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                  {msg.rawPreview && (
                    <pre className="mt-2 max-h-36 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] text-slate-200">
                      <code>{msg.rawPreview}</code>
                    </pre>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="mt-2 flex justify-end border-t border-slate-200/70 pt-1.5">
                      <button
                        type="button"
                        onClick={() => void handleCopyMessage(msg)}
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500 hover:text-slate-900"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                            Kopiert
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" aria-hidden="true" />
                            Kopieren
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))
          )}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-teal-700" aria-hidden="true" />
              <span className="font-mono">Warte auf Antwort von {activeTitle}…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer Footer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="border-t border-slate-200 bg-slate-50/70 p-3.5"
        >
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="chat-composer-input" className="sr-only">
                Nachricht eingeben
              </label>
              <textarea
                id="chat-composer-input"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={`Nachricht an ${activeTitle} senden… (Enter = Senden, Shift+Enter = Zeilenumbruch)`}
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>

            {sending ? (
              <button
                type="button"
                onClick={handleStopSending}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3.5 text-xs font-medium text-red-800 hover:bg-red-100"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Abbrechen
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim()}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-teal-700 px-4 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-45"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Senden
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
