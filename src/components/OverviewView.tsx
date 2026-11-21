import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  DownloadCloud,
  FlaskConical,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from 'lucide-react';
import type {
  BridgeRepoStatus,
  DatasetSummary,
  SecurityClass,
  TestResultRow,
} from '../lib/types.ts';

interface OverviewViewProps {
  summary: DatasetSummary;
  testResults: TestResultRow[];
  bridgeRepos: BridgeRepoStatus[];
  artifactsCount: number;
  cloneBatchRunning: boolean;
  onNavigate: (
    tab: 'classification' | 'tests' | 'bridges' | 'export',
    classFilter?: SecurityClass
  ) => void;
  onLoadBridgeRepos: () => void;
  onDownloadZip: () => void;
  downloadingZip: boolean;
}

export function OverviewView({
  summary,
  testResults,
  bridgeRepos,
  artifactsCount,
  cloneBatchRunning,
  onNavigate,
  onLoadBridgeRepos,
  onDownloadZip,
  downloadingZip,
}: OverviewViewProps) {
  const total = Math.max(summary.totalProviders, 1);
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  const executedCount = testResults.filter((r) => r.executed).length;
  const skippedCount = testResults.filter((r) => r.status.startsWith('SKIPPED')).length;
  const okCount = testResults.filter(
    (r) =>
      r.status === 'OK' ||
      r.status === 'OK_API_PROBE' ||
      r.status === 'REDIRECT' ||
      r.status === 'AUTH_REQUIRED'
  ).length;
  const passedAudits = summary.auditChecks.filter((a) => a.passed).length;
  const clonedReposCount = bridgeRepos.filter((r) => r.cloned).length;

  const classCards = [
    {
      key: 'GRUEN' as const,
      label: 'GRÜN',
      subtitle: 'Sauber, dokumentiert, kein ToS-Risiko',
      count: summary.counts.GRUEN,
      icon: ShieldCheck,
      accentText: 'text-emerald-700',
      barColor: 'bg-emerald-600',
    },
    {
      key: 'GELB' as const,
      label: 'GELB',
      subtitle: 'ToS-Grauzone, unklare Lizenz, Regel-1-Kollision',
      count: summary.counts.GELB,
      icon: AlertTriangle,
      accentText: 'text-amber-700',
      barColor: 'bg-amber-500',
    },
    {
      key: 'ROT' as const,
      label: 'ROT',
      subtitle: 'Webclient-Bypass / RE / illegal (nicht testen)',
      count: summary.counts.ROT,
      icon: ShieldAlert,
      accentText: 'text-red-700',
      barColor: 'bg-red-600',
    },
    {
      key: 'SCHWARZ' as const,
      label: 'SCHWARZ',
      subtitle: 'anonym_pseudo_key + illegal (nur Warnung)',
      count: summary.counts.SCHWARZ,
      icon: ShieldOff,
      accentText: 'text-slate-900',
      barColor: 'bg-slate-900',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Compact Executive Summary Header */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              [Belegt] Quelle: {summary.sourceName} · {summary.totalProviders} Provider-Blöcke
            </p>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Executive Summary & Sicherheits-Audit
            </h2>
            <p className="max-w-2xl text-sm text-slate-600">
              Vollständige 4-Klassen-Auswertung (Ziel 1), ToS-konformer Live-Testrunner (Ziel 2),
              Webclient-Bridge-Konsolidierung (Ziel 3) sowie Windows-11-Suite-Export mit striktem{' '}
              <code className="font-mono text-xs text-slate-800">127.0.0.1</code>-Loopback-Binding
              (Ziele 4 & 5).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onLoadBridgeRepos}
              disabled={cloneBatchRunning}
              className="inline-flex items-center gap-2 rounded-md border border-teal-700 bg-teal-50/70 px-3.5 py-2 text-sm font-medium text-teal-900 transition-colors hover:bg-teal-100 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              {cloneBatchRunning ? (
                <RefreshCw className="h-4 w-4 animate-spin text-teal-700" aria-hidden="true" />
              ) : (
                <DownloadCloud className="h-4 w-4 text-teal-700" aria-hidden="true" />
              )}
              {cloneBatchRunning ? 'Klone Repos…' : 'Verbindungen laden'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('tests')}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              <FlaskConical className="h-4 w-4 text-slate-600" aria-hidden="true" />
              Live-Tests starten
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              disabled={downloadingZip}
              className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {downloadingZip ? 'Erstelle ZIP…' : 'Suite als ZIP laden'}
            </button>
          </div>
        </div>

        {/* Proportional 4-Class Bar */}
        <div className="mt-5">
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-sm bg-slate-100"
            role="img"
            aria-label={`Verteilung: ${summary.counts.GRUEN} GRÜN, ${summary.counts.GELB} GELB, ${summary.counts.ROT} ROT, ${summary.counts.SCHWARZ} SCHWARZ`}
          >
            {classCards.map((c) => (
              <div
                key={c.key}
                className={c.barColor}
                style={{ width: `${(c.count / total) * 100}%` }}
                title={`${c.label}: ${c.count} (${pct(c.count)})`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
            <span className="tabular-nums">
              Tests live ausgeführt: <strong className="text-slate-900">{executedCount}</strong>
            </span>
            <span>·</span>
            <span className="tabular-nums">
              Erreichbar (HTTP 2xx/3xx): <strong className="text-emerald-700">{okCount}</strong>
            </span>
            <span>·</span>
            <span className="tabular-nums">
              Per Policy übersprungen: <strong className="text-slate-900">{skippedCount}</strong>
            </span>
            <span>·</span>
            <span className="tabular-nums">
              Bridge-Repos lokal geklont:{' '}
              <strong className="text-emerald-700">{clonedReposCount}</strong> von{' '}
              {bridgeRepos.length}
            </span>
          </div>
        </div>
      </section>

      {/* 4 Security Class KPI Grid */}
      <section aria-label="Sicherheitsklassen-Verteilung" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {classCards.map((c) => {
          const Icon = c.icon;
          return (
            <div
              key={c.key}
              className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4"
            >
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${c.accentText}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {c.label}
                </span>
                <span className="font-mono text-xs text-slate-500 tabular-nums">{pct(c.count)}</span>
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {c.count}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('classification', c.key)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900"
                >
                  Details
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{c.subtitle}</p>
            </div>
          );
        })}
      </section>

      {/* Two-Column Lower Grid: Hard Rules Audit + Rule 7 Collisions */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <section className="rounded-lg border border-slate-200 bg-white p-5 xl:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Harte Regeln 1–6 (Programmatisches Live-Audit)
              </h3>
              <p className="text-xs text-slate-500">
                Geprüft gegen alle {artifactsCount} erzeugten Suite-Dateien und den aktuellen Testzustand.
              </p>
            </div>
            <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
              {passedAudits}/{summary.auditChecks.length} BESTANDEN
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {summary.auditChecks.map((check) => (
              <div key={check.id} className="flex items-start gap-3 py-3">
                {check.passed ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {check.rule}
                    </span>
                    <span className="text-sm font-medium text-slate-800">{check.label}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">{check.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 xl:col-span-5">
          <div>
            <div className="border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Regel-7-Konfliktaudit (Offene Ablehnungen)
              </h3>
              <p className="text-xs text-slate-500">
                Kollisionen zwischen Quelldatensatz-Flags und Harter Regel 1 werden niemals still
                umgangen.
              </p>
            </div>

            {summary.rule7Collisions.length === 0 ? (
              <p className="py-6 text-sm text-slate-500">Keine Regel-7-Kollisionen festgestellt.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {summary.rule7Collisions.map((col) => (
                  <li key={col.providerId} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-900">
                        {col.providerId}
                      </span>
                      <span className="font-mono text-xs text-amber-700">GESPERRT (Regel 1)</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">{col.conflict}</p>
                    <p className="mt-1 text-xs font-medium text-slate-800">{col.resolution}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => onNavigate('bridges')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900"
            >
              Bridge-Konsolidierung prüfen ({summary.bridgeCandidatesCount} Einträge)
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('export')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-950"
            >
              {artifactsCount} Dateien ansehen
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
