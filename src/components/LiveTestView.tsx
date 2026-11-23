import {
  AlertTriangle,
  ArrowUpDown,
  Download,
  ExternalLink,
  Flame,
  KeyRound,
  Lock,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { isUsableGreenOrGelb, resolveProviderApiKeyPage } from '../lib/testEngine.ts';
import type {
  ClassifiedProvider,
  TestAnalytics,
  TestBatchState,
  TestResultRow,
} from '../lib/types.ts';
import {
  PhaseStrip,
  ReadinessLabel,
  SecurityClassTag,
  TestStatusTag,
  UnfilteredTag,
} from './SecurityIndicator.tsx';

export type BatchTestMode =
  | 'sample_green'
  | 'all_green_gelb'
  | 'all_green'
  | 'all_gelb'
  | 'retry_failed';

interface LiveTestViewProps {
  providers: ClassifiedProvider[];
  testResults: TestResultRow[];
  testAnalytics: TestAnalytics;
  activeRouterProviderIds: string[];
  batchState: TestBatchState;
  testingSingleId: string | null;
  onRunSingleTest: (providerId: string) => void;
  onRunBatch: (mode: BatchTestMode) => void;
  onStopBatch: () => void;
  onResetTests: () => void;
  onDownloadCsv: () => void;
  onUseConnection: (provider: ClassifiedProvider) => void;
  onApplyTestedToRouter: () => void;
  applyingRouter: boolean;
}

type StatusFilter = 'ALL' | 'EXECUTED' | 'READY' | 'WAF' | 'ERRORS' | 'SKIPPED';

const BATCH_MODE_LABELS: Record<string, string> = {
  sample_green: 'Top 12 GRÜN',
  all_green_gelb: 'Gesamttest: Alle GRÜN & GELB',
  all_green: 'Alle GRÜN',
  all_gelb: 'Alle GELB (nur Reachability)',
  retry_failed: 'Ausfälle erneut testen',
};

export function LiveTestView({
  providers,
  testResults,
  testAnalytics,
  activeRouterProviderIds,
  batchState,
  testingSingleId,
  onRunSingleTest,
  onRunBatch,
  onStopBatch,
  onResetTests,
  onDownloadCsv,
  onUseConnection,
  onApplyTestedToRouter,
  applyingRouter,
}: LiveTestViewProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [onlyUnfiltered, setOnlyUnfiltered] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'default' | 'unfiltered_first' | 'score_desc' | 'name_asc'>('default');
  const [search, setSearch] = useState('');

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const routerSet = useMemo(() => new Set(activeRouterProviderIds), [activeRouterProviderIds]);
  const unfilteredCount = useMemo(
    () => providers.filter((p) => p.isUnfiltered).length,
    [providers]
  );

  const stats = useMemo(() => {
    let executed = 0;
    let ok = 0;
    let waf = 0;
    let errors = 0;
    let skipped = 0;
    for (const r of testResults) {
      if (r.executed) executed++;
      if (
        r.status === 'OK' ||
        r.status === 'OK_API_PROBE' ||
        r.status === 'REDIRECT' ||
        r.status === 'AUTH_REQUIRED'
      )
        ok++;
      else if (r.status === 'WAF_PROTECTED') waf++;
      else if (r.status === 'HTTP_ERROR' || r.status === 'TIMEOUT' || r.status === 'NETWORK_ERROR')
        errors++;
      else if (r.status.startsWith('SKIPPED')) skipped++;
    }
    return { executed, ok, waf, errors, skipped };
  }, [testResults]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = testResults.filter((r) => {
      const prov = providerById.get(r.id);
      if (onlyUnfiltered && !prov?.isUnfiltered) return false;
      if (statusFilter === 'EXECUTED' && !r.executed) return false;
      if (
        statusFilter === 'READY' &&
        r.readinessTier !== 'SOFORT_NUTZBAR' &&
        r.readinessTier !== 'BEREIT_MIT_KEY' &&
        r.readinessTier !== 'LOKAL_ENGINE'
      ) {
        return false;
      }
      if (statusFilter === 'WAF' && r.status !== 'WAF_PROTECTED') return false;
      if (statusFilter === 'SKIPPED' && !r.status.startsWith('SKIPPED')) return false;
      if (
        statusFilter === 'ERRORS' &&
        r.status !== 'HTTP_ERROR' &&
        r.status !== 'TIMEOUT' &&
        r.status !== 'NETWORK_ERROR'
      ) {
        return false;
      }
      if (q) {
        const hay =
          `${r.id} ${r.name} ${r.kategorie} ${r.status} ${r.note} ${r.url} ${r.readinessTier ?? ''} ${prov?.isUnfiltered ? 'unfiltered uncensored' : ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'unfiltered_first') {
      return [...list].sort((a, b) => {
        const ua = providerById.get(a.id)?.isUnfiltered ? 1 : 0;
        const ub = providerById.get(b.id)?.isUnfiltered ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return a.name.localeCompare(b.name, 'de');
      });
    }
    if (sortBy === 'score_desc') {
      return [...list].sort((a, b) => {
        const sa = a.executed && typeof a.healthScore === 'number' ? a.healthScore : -1;
        const sb = b.executed && typeof b.healthScore === 'number' ? b.healthScore : -1;
        if (sa !== sb) return sb - sa;
        return a.name.localeCompare(b.name, 'de');
      });
    }
    if (sortBy === 'name_asc') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));
    }
    return list;
  }, [testResults, providerById, statusFilter, onlyUnfiltered, sortBy, search]);

  const progressPct =
    batchState.total > 0 ? Math.round((batchState.completed / batchState.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* 4-Phase Control Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">
              ZIEL 2 – 4-Phasen-Test-Engine (Einzeltest & Gesamttest)
            </h2>
            <p className="max-w-3xl text-xs leading-relaxed text-slate-600">
              <strong>P1</strong> URL/DNS (4,5 s) → <strong>P2</strong> HTTP/TLS + WAF-Erkennung
              (HEAD → GET-Fallback, trennt Cloudflare-403 von echten Ausfällen) →{' '}
              <strong>P3</strong> Protokoll-Probe <code className="font-mono">GET /models</code>{' '}
              (nur GRÜN; GELB überspringt P3 gemäß Ziel 2.3) → <strong>P4</strong> Health-Score
              (0–100) & Routing-Einstufung. ROT, SCHWARZ, <code className="font-mono">illegal</code>{' '}
              und <code className="font-mono">anonym_pseudo_key</code> bleiben serverseitig hart
              gesperrt.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRunBatch('all_green_gelb')}
              disabled={batchState.running}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Gesamttest: Alle GRÜN & GELB ({testAnalytics.totalTestableGreenGelb})
            </button>
            <button
              type="button"
              onClick={() => onRunBatch('all_green')}
              disabled={batchState.running}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              Alle GRÜN
            </button>
            <button
              type="button"
              onClick={() => onRunBatch('all_gelb')}
              disabled={batchState.running}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
              Alle GELB
            </button>
            <button
              type="button"
              onClick={() => onRunBatch('sample_green')}
              disabled={batchState.running}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Top 12 GRÜN
            </button>
            {stats.errors > 0 && !batchState.running && (
              <button
                type="button"
                onClick={() => onRunBatch('retry_failed')}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Ausfälle erneut testen ({stats.errors})
              </button>
            )}
            {batchState.running && (
              <button
                type="button"
                onClick={onStopBatch}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 transition-colors hover:bg-red-100"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Stopp
              </button>
            )}
            <button
              type="button"
              onClick={onResetTests}
              disabled={batchState.running}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Zurücksetzen
            </button>
            <button
              type="button"
              onClick={onDownloadCsv}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              test_results.csv
            </button>
          </div>
        </div>

        {/* Batch Progress */}
        {batchState.running && (
          <div className="mt-4 rounded-md border border-teal-200 bg-teal-50/60 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-teal-900">
              <span>
                4-Phasen-Batch aktiv ({BATCH_MODE_LABELS[batchState.mode ?? ''] ?? batchState.mode})
              </span>
              <span className="font-mono tabular-nums">
                {batchState.completed} / {batchState.total} ({progressPct}%)
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-sm bg-teal-100">
              <div
                className="h-full bg-teal-700 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Inline Metrics Strip */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600 tabular-nums">
          <span>
            Abdeckung:{' '}
            <strong className="text-slate-900">
              {testAnalytics.testedGreenGelb} / {testAnalytics.totalTestableGreenGelb}
            </strong>
          </span>
          <span>·</span>
          <span>
            OK / Probe / Redirect: <strong className="text-emerald-700">{stats.ok}</strong>
          </span>
          <span>·</span>
          <span>
            WAF-geschützt: <strong className="text-amber-700">{stats.waf}</strong>
          </span>
          <span>·</span>
          <span>
            Echte Fehler: <strong className="text-red-700">{stats.errors}</strong>
          </span>
          <span>·</span>
          <span>
            Ø Latenz:{' '}
            <strong className="text-slate-900">
              {testAnalytics.avgLatencyMs !== null ? `${testAnalytics.avgLatencyMs} ms` : '—'}
            </strong>
          </span>
          <span>·</span>
          <span>
            Gesperrt (Regel 1/ROT):{' '}
            <strong className="text-slate-900">{testAnalytics.blockedRule1OrRotCount}</strong>
          </span>
        </div>
      </section>

      {/* Smart Utilization of Test Results Panel */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              Operative Verwertung der Testergebnisse
            </p>
            <h3 className="mt-0.5 text-base font-semibold text-slate-900">
              Smart-Routing, Fehler-Cluster & LiteLLM-Synchronisation
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Geprüfte GRÜNE Endpunkte (Score ≥ 70) lassen sich direkt nach Latenz sortiert in{' '}
              <code className="font-mono">litellm_config.yaml</code> und{' '}
              <code className="font-mono">.env.example</code> übernehmen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs text-slate-600 tabular-nums">
              Im Router aktiv:{' '}
              <strong className="text-slate-900">{activeRouterProviderIds.length}</strong>
            </span>
            <button
              type="button"
              onClick={onApplyTestedToRouter}
              disabled={applyingRouter || testAnalytics.topRankedGreenIds.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              <Network className="h-3.5 w-3.5" aria-hidden="true" />
              {applyingRouter
                ? 'Übernehme…'
                : `Top geprüfte GRÜN in Router übernehmen (${testAnalytics.topRankedGreenIds.length})`}
            </button>
          </div>
        </div>

        {/* Readiness Breakdown */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Sofort nutzbar (GRÜN)</div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-emerald-700 tabular-nums">
              {testAnalytics.readyImmediateCount}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Bereit (mit API-Key)</div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-teal-700 tabular-nums">
              {testAnalytics.readyWithKeyCount}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">WAF-geschützt (aktiv)</div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-amber-700 tabular-nums">
              {testAnalytics.wafProtectedCount}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="text-[11px] font-medium text-slate-500">Nicht erreichbar</div>
            <div className="mt-0.5 font-mono text-lg font-semibold text-red-700 tabular-nums">
              {testAnalytics.unreachableCount}
            </div>
          </div>
        </div>

        {/* Failure Root-Cause Clusters */}
        {testAnalytics.failureClusters.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Ursachen-Cluster & Handlungsempfehlungen
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {testAnalytics.failureClusters.map((cluster) => (
                <div
                  key={cluster.key}
                  className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-xs"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 tabular-nums">
                      {cluster.label} ({cluster.count})
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                      {cluster.recommendation}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Filter Strip */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Nach Test-Status filtern"
          >
            {(
              [
                ['ALL', `Alle (${testResults.length})`],
                ['EXECUTED', `Getestet (${stats.executed})`],
                [
                  'READY',
                  `Nutzbar (${testAnalytics.readyImmediateCount + testAnalytics.readyWithKeyCount + testAnalytics.localEnginesCount})`,
                ],
                ['WAF', `WAF (${stats.waf})`],
                ['ERRORS', `Fehler (${stats.errors})`],
                ['SKIPPED', `Gesperrt/Skip (${stats.skipped})`],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setStatusFilter(val)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors tabular-nums ${
                  statusFilter === val
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setOnlyUnfiltered((prev) => !prev)}
            aria-pressed={onlyUnfiltered}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition-colors tabular-nums ${
              onlyUnfiltered
                ? 'border-fuchsia-600 bg-fuchsia-700 text-white shadow-xs'
                : 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100'
            }`}
          >
            <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Nur Unfiltered ({unfilteredCount})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as 'default' | 'unfiltered_first' | 'score_desc' | 'name_asc'
                )
              }
              aria-label="Testergebnisse sortieren"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
            >
              <option value="default">Sortierung: Standard</option>
              <option value="unfiltered_first">Sortierung: Unfiltered zuerst</option>
              <option value="score_desc">Sortierung: Score (hoch → tief)</option>
              <option value="name_asc">Sortierung: Name (A–Z)</option>
            </select>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Provider, URL oder Status suchen…"
              aria-label="Testergebnisse durchsuchen"
              className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none sm:w-64"
            />
          </div>
        </div>
      </div>

      {/* Results Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] table-fixed border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                <th className="w-24 px-3 py-3">Klasse</th>
                <th className="w-52 px-3 py-3">Provider</th>
                <th className="w-44 px-3 py-3">Status & Phasen</th>
                <th className="w-24 px-3 py-3">Score / HTTP</th>
                <th className="px-3 py-3">Diagnose & URL</th>
                <th className="w-56 px-3 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((row) => {
                const provider = providerById.get(row.id);
                const usable = provider ? isUsableGreenOrGelb(provider) : false;
                const isRunningThis = testingSingleId === row.id;
                const inRouter = routerSet.has(row.id);

                return (
                  <tr key={row.id} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-3 py-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <SecurityClassTag secClass={row.securityClass} />
                        {provider?.isUnfiltered && <UnfilteredTag compact />}
                        {inRouter && (
                          <div className="font-mono text-[10px] font-semibold text-teal-700">
                            IM ROUTER
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="break-words font-medium text-slate-900">{row.name}</div>
                      <div className="truncate font-mono text-xs text-slate-500">
                        {row.id} · {row.kategorie}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <TestStatusTag status={row.status} />
                      <PhaseStrip phases={row.phases} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs tabular-nums">
                      <div className="font-semibold text-slate-900">
                        {row.executed && typeof row.healthScore === 'number'
                          ? `${row.healthScore}/100`
                          : '—'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        HTTP {row.http_code}
                        {typeof row.latencyMs === 'number' ? ` · ${row.latencyMs}ms` : ''}
                      </div>
                      <ReadinessLabel tier={row.readinessTier} />
                    </td>
                    <td className="px-3 py-2.5 align-top text-xs leading-relaxed text-slate-600">
                      <div className="break-words">{row.note}</div>
                      {row.url && !row.url.startsWith('[GESPERRT') && (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                          {row.url}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
                      {!usable || !provider ? (
                        <span
                          className="inline-flex items-center gap-1 font-mono text-xs text-slate-400"
                          title={row.note}
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          Gesperrt
                        </span>
                      ) : (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {(() => {
                            const keyPage = resolveProviderApiKeyPage(provider);
                            return keyPage ? (
                              <a
                                href={keyPage.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`${keyPage.label} von ${row.name} öffnen (${keyPage.url})`}
                                aria-label={`API-Key-Seite von ${row.name} öffnen`}
                                className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
                              >
                                <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                                Key
                                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden="true" />
                              </a>
                            ) : null;
                          })()}
                          <button
                            type="button"
                            onClick={() => onRunSingleTest(row.id)}
                            disabled={isRunningThis || batchState.running}
                            aria-label={`${row.name} einzeln testen`}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" aria-hidden="true" />
                            {isRunningThis ? '…' : 'Testen'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onUseConnection(provider)}
                            aria-label={`${row.name} nutzen`}
                            className="inline-flex items-center gap-1 rounded bg-teal-700 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-teal-800"
                          >
                            <Zap className="h-3 w-3" aria-hidden="true" />
                            Nutzen
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    Keine Testergebnisse für den aktuellen Filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
