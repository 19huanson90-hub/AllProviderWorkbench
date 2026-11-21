import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from 'lucide-react';
import type {
  ReadinessTier,
  SecurityClass,
  TestPhaseResult,
  TestRunStatus,
} from '../lib/types.ts';

export function SecurityClassTag({ secClass }: { secClass: SecurityClass }) {
  switch (secClass) {
    case 'GRUEN':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-emerald-700">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          GRÜN
        </span>
      );
    case 'GELB':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          GELB
        </span>
      );
    case 'ROT':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-red-700">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ROT
        </span>
      );
    case 'SCHWARZ':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-900">
          <ShieldOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          SCHWARZ
        </span>
      );
  }
}

export function TestStatusTag({ status }: { status: TestRunStatus }) {
  switch (status) {
    case 'OK':
    case 'OK_API_PROBE':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {status}
        </span>
      );
    case 'REDIRECT':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-sky-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          REDIRECT
        </span>
      );
    case 'WAF_PROTECTED':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-amber-700">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          WAF (403/429)
        </span>
      );
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-slate-500">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          BEREIT
        </span>
      );
    case 'HTTP_ERROR':
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-red-700">
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {status}
        </span>
      );
    case 'SKIPPED (illegal)':
    case 'SKIPPED (Regel 1: anonym_pseudo_key)':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-slate-900">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {status}
        </span>
      );
    case 'SKIPPED (ToS-Risiko)':
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-red-700">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          SKIPPED (ToS-Risiko)
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-slate-500">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {status}
        </span>
      );
  }
}

export function PhaseStrip({ phases }: { phases?: TestPhaseResult[] }) {
  if (!phases || phases.length === 0) return null;

  const shortLabel: Record<TestPhaseResult['phase'], string> = {
    dns: 'P1',
    reachability: 'P2',
    protocol: 'P3',
    scoring: 'P4',
  };

  const colorByStatus: Record<TestPhaseResult['status'], string> = {
    pass: 'text-emerald-700',
    warn: 'text-amber-700',
    fail: 'text-red-700',
    skip: 'text-slate-400',
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
      {phases.map((p) => (
        <span
          key={p.phase}
          title={`${p.label}: ${p.detail}`}
          className={`font-semibold ${colorByStatus[p.status]}`}
        >
          {shortLabel[p.phase]}:{p.status === 'pass' ? 'OK' : p.status === 'warn' ? 'W' : p.status === 'fail' ? 'ERR' : '–'}
        </span>
      ))}
    </div>
  );
}

export function ReadinessLabel({ tier }: { tier?: ReadinessTier }) {
  if (!tier || tier === 'UNGETESTET' || tier === 'GESPERRT') return null;

  const map: Record<Exclude<ReadinessTier, 'UNGETESTET' | 'GESPERRT'>, { text: string; cls: string }> = {
    SOFORT_NUTZBAR: { text: 'Sofort nutzbar', cls: 'text-emerald-700' },
    BEREIT_MIT_KEY: { text: 'Bereit (mit Key)', cls: 'text-teal-700' },
    EINGESCHRAENKT_WAF: { text: 'WAF-geschützt', cls: 'text-amber-700' },
    LOKAL_ENGINE: { text: 'Lokale Engine', cls: 'text-sky-700' },
    NICHT_ERREICHBAR: { text: 'Nicht erreichbar', cls: 'text-red-700' },
  };

  const item = map[tier];
  return <span className={`font-mono text-[11px] font-medium ${item.cls}`}>{item.text}</span>;
}

