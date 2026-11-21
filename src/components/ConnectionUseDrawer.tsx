import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FlaskConical,
  KeyRound,
  MessageSquare,
  Network,
  Play,
  Send,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildConnectionSnippets, isUsableGreenOrGelb } from '../lib/testEngine.ts';
import type { ClassifiedProvider, TestResultRow } from '../lib/types.ts';
import { ReadinessLabel, SecurityClassTag, TestStatusTag } from './SecurityIndicator.tsx';

interface ConnectionUseDrawerProps {
  provider: ClassifiedProvider | null;
  testRow: TestResultRow | undefined;
  isInRouter: boolean;
  testingSingleId: string | null;
  onClose: () => void;
  onRunSingleTest: (providerId: string, byokApiKey?: string) => Promise<void> | void;
  onToggleRouter: (providerId: string) => Promise<void> | void;
  onOpenInChat: (provider: ClassifiedProvider, endpointUrl?: string) => void;
}

interface InvokeResponse {
  ok: boolean;
  httpStatus?: number;
  latencyMs?: number;
  targetUrl?: string;
  parsedBody?: unknown;
  rawPreview?: string;
  error?: string;
}

export function ConnectionUseDrawer({
  provider,
  testRow,
  isInRouter,
  testingSingleId,
  onClose,
  onRunSingleTest,
  onToggleRouter,
  onOpenInChat,
}: ConnectionUseDrawerProps) {
  const snippets = useMemo(
    () => (provider ? buildConnectionSnippets(provider) : null),
    [provider]
  );

  const [endpointUrl, setEndpointUrl] = useState<string>('');
  const [byokKey, setByokKey] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('Antworte mit genau einem Wort: OK');
  const [snippetTab, setSnippetTab] = useState<'powershell' | 'curl' | 'python'>('powershell');
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);
  const [invoking, setInvoking] = useState<'models' | 'chat' | null>(null);
  const [invokeResult, setInvokeResult] = useState<InvokeResponse | null>(null);
  const [togglingRouter, setTogglingRouter] = useState<boolean>(false);
  const [showManualRestOverride, setShowManualRestOverride] = useState<boolean>(false);

  useEffect(() => {
    if (!provider || !snippets) return;
    setEndpointUrl(snippets.defaultApiBase);
    setByokKey('');
    setModelName('');
    setInvokeResult(null);
    setCopiedSnippet(false);
    setShowManualRestOverride(snippets.supportsOpenAiEndpoints);
  }, [provider?.id, snippets]);

  if (!provider || !snippets) return null;

  const usable = isUsableGreenOrGelb(provider);
  const isTesting = testingSingleId === provider.id;

  const activeSnippetCode =
    snippetTab === 'curl'
      ? snippets.curl
      : snippetTab === 'powershell'
        ? snippets.powershell
        : snippets.python;

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(activeSnippetCode);
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const handleInvoke = async (action: 'models' | 'chat') => {
    if (!usable) return;
    setInvoking(action);
    setInvokeResult(null);
    try {
      const res = await fetch('/api/connections/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: provider.id,
          endpointUrl: endpointUrl.trim(),
          action,
          apiKey: byokKey.trim() || undefined,
          model: modelName.trim() || undefined,
          prompt: prompt.trim() || undefined,
        }),
      });
      const data = (await res.json()) as InvokeResponse;
      setInvokeResult(data);
    } catch (err: unknown) {
      setInvokeResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Anfrage fehlgeschlagen.',
      });
    } finally {
      setInvoking(null);
    }
  };

  const handleToggleRouterClick = async () => {
    setTogglingRouter(true);
    try {
      await onToggleRouter(provider.id);
    } finally {
      setTogglingRouter(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35"
      role="dialog"
      aria-modal="true"
      aria-label={`Verbindung nutzen: ${provider.name}`}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <SecurityClassTag secClass={provider.securityClass} />
              <span className="font-mono text-xs text-slate-500">{provider.id}</span>
              {testRow?.healthScore !== undefined && testRow.executed && (
                <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
                  · Score {testRow.healthScore}/100
                </span>
              )}
              <ReadinessLabel tier={testRow?.readinessTier} />
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold text-slate-900">{provider.name}</h3>
            <p className="mt-0.5 text-xs text-slate-600">
              <strong className="text-slate-800">{snippets.connectionLabel}</strong> · Auth:{' '}
              <code className="font-mono">{provider.auth_typ}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Verbindungs-Panel schließen"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5 text-sm">
          {/* GELB ToS Warning */}
          {provider.securityClass === 'GELB' && (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold">Hinweis: Klasse GELB (ToS-Grauzone / unklare Lizenz)</p>
                <p className="leading-relaxed text-amber-900">
                  Automatische Batch-Tests führen für GELB nur Phase 1+2 (DNS & Reachability) aus.
                  Ein direkter API-Aufruf unten erfolgt nur auf deine explizite Auslösung hin und
                  mit deinem eigenen API-Key (nicht für produktive oder vertrauliche Daten).
                </p>
              </div>
            </div>
          )}

          {/* Quick Actions: Portal, 4-Phase Test, LiteLLM Router Toggle */}
          <section className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
            {usable && (
              <button
                type="button"
                onClick={() => {
                  onOpenInChat(provider, endpointUrl.trim() || undefined);
                  onClose();
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  snippets.supportsOpenAiEndpoints
                    ? 'bg-teal-700 text-white hover:bg-teal-800'
                    : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                Im Chat öffnen
              </button>
            )}

            {snippets.supportsOpenAiEndpoints && (
              <button
                type="button"
                onClick={() => void handleToggleRouterClick()}
                disabled={togglingRouter || !usable}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                  isInRouter
                    ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                    : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                <Network className="h-3.5 w-3.5" aria-hidden="true" />
                {isInRouter ? 'Im LiteLLM-Router aktiv (Entfernen)' : 'In LiteLLM-Router aufnehmen'}
              </button>
            )}

            <button
              type="button"
              onClick={() => void onRunSingleTest(provider.id, byokKey.trim() || undefined)}
              disabled={isTesting || !usable}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <FlaskConical className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
              {isTesting
                ? '4-Phasen-Test läuft…'
                : byokKey.trim()
                  ? '4-Phasen-Test (mit Key)'
                  : '4-Phasen-Einzeltest'}
            </button>

            {provider.url && /^https?:\/\//i.test(provider.url) && (
              <a
                href={provider.url}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  snippets.supportsOpenAiEndpoints
                    ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    : 'bg-teal-700 text-white hover:bg-teal-800'
                }`}
              >
                {snippets.connectionKind === 'browser_only'
                  ? 'Im Browser / Spezifikation öffnen'
                  : 'Portal / Doku öffnen'}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </section>

          {/* 4-Phase Diagnostic Breakdown */}
          <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-600">
                4-Phasen-Diagnose
              </h4>
              {testRow && <TestStatusTag status={testRow.status} />}
            </div>

            {testRow?.phases && testRow.phases.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {testRow.phases.map((ph) => {
                  const Icon =
                    ph.status === 'pass'
                      ? CheckCircle2
                      : ph.status === 'warn'
                        ? AlertTriangle
                        : ph.status === 'fail'
                          ? XCircle
                          : Play;
                  const iconColor =
                    ph.status === 'pass'
                      ? 'text-emerald-700'
                      : ph.status === 'warn'
                        ? 'text-amber-700'
                        : ph.status === 'fail'
                          ? 'text-red-700'
                          : 'text-slate-400';

                  return (
                    <li
                      key={ph.phase}
                      className="flex items-start justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconColor}`} aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{ph.label}</div>
                          <div className="break-words text-slate-600">{ph.detail}</div>
                        </div>
                      </div>
                      {typeof ph.durationMs === 'number' && (
                        <span className="shrink-0 font-mono text-[11px] text-slate-500 tabular-nums">
                          {ph.durationMs} ms
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-2 text-xs text-slate-600">
                Noch kein 4-Phasen-Einzeltest ausgeführt. Klicke oben auf „4-Phasen-Einzeltest“, um
                DNS, HTTP/TLS (inkl. WAF-Erkennung), Protokoll-Probe und Score zu prüfen.
              </p>
            )}
          </section>

          {/* Direct SSRF-Safe Live API Playground (contextual to connectionKind) */}
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-slate-700">
                <Send className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                {snippets.supportsOpenAiEndpoints
                  ? 'Verbindung direkt nutzen (SSRF-gesicherter Live-Aufruf)'
                  : `Verbindungsmodus: ${snippets.connectionLabel}`}
              </h4>
              {!snippets.supportsOpenAiEndpoints && (
                <button
                  type="button"
                  onClick={() => setShowManualRestOverride((prev) => !prev)}
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  {showManualRestOverride
                    ? 'Manuellen HTTP-Test ausblenden'
                    : 'Erweitert: Manuellen HTTP-Endpunkt testen'}
                </button>
              )}
            </div>

            {snippets.endpointNote && (
              <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                {snippets.endpointNote}
              </div>
            )}

            {showManualRestOverride && (
              <>
                <p className="mt-2 text-xs text-slate-500">
                  Sendet einen echten HTTP-Aufruf ausschließlich an die Katalog-Domain dieser
                  Verbindung (oder Loopback bei lokalen Engines). Der optionale API-Key bleibt
                  ausschließlich im Arbeitsspeicher dieses Requests und wird niemals gespeichert
                  oder geloggt (Regel 2).
                </p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="conn-endpoint-url"
                      className="block text-xs font-medium text-slate-700"
                    >
                      OpenAI-kompatible Basis-URL
                    </label>
                    <input
                      id="conn-endpoint-url"
                      type="url"
                      value={endpointUrl}
                      onChange={(e) => setEndpointUrl(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="conn-byok-key"
                      className="flex items-center gap-1 text-xs font-medium text-slate-700"
                    >
                      <KeyRound className="h-3 w-3 text-slate-500" aria-hidden="true" />
                      Session-API-Key (optional, RAM-only)
                    </label>
                    <input
                      id="conn-byok-key"
                      type="password"
                      autoComplete="off"
                      value={byokKey}
                      onChange={(e) => setByokKey(e.target.value)}
                      placeholder={
                        provider.auth_typ === 'keine'
                          ? 'Nicht erforderlich (keine)'
                          : `${snippets.envVar} oder temporär`
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="conn-model" className="block text-xs font-medium text-slate-700">
                      Modell-ID (für Chat-Test)
                    </label>
                    <input
                      id="conn-model"
                      type="text"
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      placeholder="z. B. llama-3.3-70b-versatile"
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label htmlFor="conn-prompt" className="block text-xs font-medium text-slate-700">
                      Test-Prompt (POST /chat/completions)
                    </label>
                    <input
                      id="conn-prompt"
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleInvoke('models')}
                    disabled={invoking !== null || !usable}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    {invoking === 'models' ? 'Rufe /models ab…' : 'Modelle abrufen (GET /models)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleInvoke('chat')}
                    disabled={invoking !== null || !usable}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden="true" />
                    {invoking === 'chat'
                      ? 'Sende Chat-Request…'
                      : 'Test-Prompt senden (POST /chat/completions)'}
                  </button>
                </div>

                {invokeResult && (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                      <span className={invokeResult.ok ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>
                        {invokeResult.ok
                          ? `HTTP ${invokeResult.httpStatus} OK`
                          : invokeResult.httpStatus
                            ? `HTTP ${invokeResult.httpStatus}`
                            : 'Fehler'}
                      </span>
                      {typeof invokeResult.latencyMs === 'number' && (
                        <span className="text-slate-500 tabular-nums">{invokeResult.latencyMs} ms</span>
                      )}
                    </div>
                    {invokeResult.targetUrl && (
                      <div className="mt-1 truncate font-mono text-[11px] text-slate-500">
                        {invokeResult.targetUrl}
                      </div>
                    )}
                    {invokeResult.error && (
                      <p className="mt-1.5 text-xs text-red-700">{invokeResult.error}</p>
                    )}
                    {(invokeResult.parsedBody !== undefined || invokeResult.rawPreview) && (
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                        <code>
                          {invokeResult.parsedBody !== undefined && invokeResult.parsedBody !== null
                            ? JSON.stringify(invokeResult.parsedBody, null, 2)
                            : invokeResult.rawPreview}
                        </code>
                      </pre>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Copyable Secret-Free Snippets (Windows-11 PowerShell safe!) */}
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="flex items-center gap-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-slate-700">
                <Terminal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                Nutzungs-Snippets (PowerShell-sicher, ohne Secrets)
              </h4>
              <div className="flex items-center gap-2">
                <div
                  className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5"
                  role="group"
                  aria-label="Snippet-Sprache wählen"
                >
                  {(
                    [
                      { id: 'powershell', label: 'PowerShell' },
                      { id: 'curl', label: 'curl.exe' },
                      { id: 'python', label: 'Python' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSnippetTab(tab.id)}
                      className={`rounded px-2 py-0.5 font-mono text-[11px] font-medium ${
                        snippetTab === tab.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopySnippet()}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {copiedSnippet ? (
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
            </div>
            <pre className="mt-2.5 overflow-x-auto rounded bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
              <code>{activeSnippetCode}</code>
            </pre>
          </section>

          {/* Source Context */}
          {(provider.beschreibung || provider.einschraenkungen) && (
            <section className="space-y-2 border-t border-slate-200 pt-3 text-xs text-slate-600">
              {provider.beschreibung && (
                <div>
                  <span className="font-semibold text-slate-800">Beschreibung: </span>
                  {provider.beschreibung}
                </div>
              )}
              {provider.einschraenkungen && (
                <div>
                  <span className="font-semibold text-slate-800">Einschränkungen: </span>
                  {provider.einschraenkungen}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
