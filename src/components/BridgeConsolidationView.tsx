import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  DownloadCloud,
  ExternalLink,
  FileCode2,
  FolderGit2,
  MessageSquare,
  Play,
  RefreshCw,
  ShieldAlert,
  Square,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  BridgeCandidateEvaluation,
  BridgeRepoStatus,
  BridgeRuntimeState,
  BridgeSelectionEntry,
} from '../lib/types.ts';

interface BridgeConsolidationViewProps {
  selections: BridgeSelectionEntry[];
  excludedEntries: BridgeCandidateEvaluation[];
  bridgeRepos: BridgeRepoStatus[];
  bridgeRuntimes: BridgeRuntimeState[];
  cloneBatchRunning: boolean;
  cloningSingleId: string | null;
  executingBridgeId: string | null;
  totalBridgeCategoryCount: number;
  onCloneAllRepos: () => void;
  onCloneSingleRepo: (bridgeId: string) => void;
  onExecuteBridge: (bridgeId: string, confirmTosRisk: boolean) => Promise<void> | void;
  onStopBridge: (bridgeId: string) => Promise<void> | void;
  onProbeBridge: (bridgeId: string) => Promise<void> | void;
  onRefreshBridgeRuntimes: () => Promise<void> | void;
  onOpenBridgeInChat: (bridgeId: string) => void;
}

function InlineCodeText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, idx) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code
            key={idx}
            className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] text-slate-900"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </>
  );
}

function RuntimeStatusBadge({ runtime }: { runtime?: BridgeRuntimeState }) {
  if (!runtime || runtime.status === 'stopped') {
    return <span className="font-mono text-[11px] text-slate-500">GESTOPPT</span>;
  }
  if (runtime.status === 'cloning') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-teal-700">
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
        KLONT…
      </span>
    );
  }
  if (runtime.status === 'starting') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-teal-700">
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
        STARTET…
      </span>
    );
  }
  if (runtime.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-emerald-700">
        <Activity className="h-3 w-3" aria-hidden="true" />
        LÄUFT ({runtime.mode === 'docker' ? 'Docker' : 'Lokal'})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-red-700">
      <XCircle className="h-3 w-3" aria-hidden="true" />
      FEHLER
    </span>
  );
}

export function BridgeConsolidationView({
  selections,
  excludedEntries,
  bridgeRepos,
  bridgeRuntimes,
  cloneBatchRunning,
  cloningSingleId,
  executingBridgeId,
  totalBridgeCategoryCount,
  onCloneAllRepos,
  onCloneSingleRepo,
  onExecuteBridge,
  onStopBridge,
  onProbeBridge,
  onRefreshBridgeRuntimes,
  onOpenBridgeInChat,
}: BridgeConsolidationViewProps) {
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState<boolean>(false);
  const [inspectingRepo, setInspectingRepo] = useState<BridgeRepoStatus | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileTruncated, setFileTruncated] = useState<boolean>(false);
  const [loadingFile, setLoadingFile] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Bridge click-to-execute drawer state
  const [activeBridgeId, setActiveBridgeId] = useState<string | null>(null);
  const [tosConfirmedIds, setTosConfirmedIds] = useState<Record<string, boolean>>({});
  const [probingBridgeId, setProbingBridgeId] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<boolean>(false);

  const repoById = useMemo(
    () => new Map(bridgeRepos.map((r) => [r.bridgeId, r])),
    [bridgeRepos]
  );
  const runtimeById = useMemo(
    () => new Map(bridgeRuntimes.map((r) => [r.bridgeId, r])),
    [bridgeRuntimes]
  );
  const selectionByBridgeId = useMemo(
    () =>
      new Map(
        selections
          .filter((s) => Boolean(s.bridge_id))
          .map((s) => [s.bridge_id!, s])
      ),
    [selections]
  );

  const activeSelection = activeBridgeId ? selectionByBridgeId.get(activeBridgeId) ?? null : null;
  const activeRuntime = activeBridgeId ? runtimeById.get(activeBridgeId) : undefined;
  const activeRepo = activeBridgeId ? repoById.get(activeBridgeId) : undefined;

  // Poll live logs while active bridge is running / starting / cloning
  useEffect(() => {
    if (!activeBridgeId) return;
    if (
      activeRuntime?.status !== 'running' &&
      activeRuntime?.status !== 'starting' &&
      activeRuntime?.status !== 'cloning'
    ) {
      return;
    }
    const timer = setInterval(() => {
      void onRefreshBridgeRuntimes();
    }, 1800);
    return () => clearInterval(timer);
  }, [activeBridgeId, activeRuntime?.status, onRefreshBridgeRuntimes]);

  const dockerCount = selections.filter((s) => s.docker_capable).length;
  const clonedCount = bridgeRepos.filter((r) => r.cloned).length;
  const runningCount = bridgeRuntimes.filter((r) => r.status === 'running').length;
  const failedCount = bridgeRepos.filter((r) => r.status === 'failed').length;
  const cloningCount = bridgeRepos.filter((r) => r.status === 'cloning').length;

  const openFilePreview = async (repo: BridgeRepoStatus, fileName: string) => {
    setInspectingRepo(repo);
    setActiveFileName(fileName);
    setLoadingFile(true);
    setFileError(null);
    setFileContent('');
    setFileTruncated(false);
    try {
      const res = await fetch(
        `/api/bridges/repos/${encodeURIComponent(repo.bridgeId)}/file?name=${encodeURIComponent(fileName)}`
      );
      const data = (await res.json()) as {
        content?: string;
        truncated?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFileContent(data.content ?? '');
      setFileTruncated(Boolean(data.truncated));
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : 'Datei konnte nicht geladen werden.');
    } finally {
      setLoadingFile(false);
    }
  };

  const handleOpenInspector = (repo: BridgeRepoStatus) => {
    const preferred =
      repo.topFiles.find((f) => /^dockerfile$/i.test(f)) ||
      repo.topFiles.find((f) => /^readme\.md$/i.test(f)) ||
      repo.topFiles.find((f) => !f.endsWith('/'));
    setInspectingRepo(repo);
    if (preferred) {
      void openFilePreview(repo, preferred);
    } else {
      setActiveFileName(null);
      setFileContent('');
    }
  };

  const handleOpenBridgeRunner = (bridgeId: string) => {
    setActiveBridgeId(bridgeId);
    setCopiedCmd(false);
  };

  const handleRunProbe = async (bridgeId: string) => {
    setProbingBridgeId(bridgeId);
    try {
      await onProbeBridge(bridgeId);
    } finally {
      setProbingBridgeId(null);
    }
  };

  const activeManualCommands = useMemo(() => {
    if (!activeSelection || !activeSelection.bridge_id || !activeSelection.port) return '';
    const id = activeSelection.bridge_id;
    const port = activeSelection.port;
    const svc = activeSelection.docker_service || `bridge-${id}`;
    const url = activeSelection.bridge_url || '';
    return [
      `# 1) Repository klonen (falls noch nicht lokal vorhanden)`,
      `git clone --depth 1 "${url}" ".\\bridges\\${id}"`,
      ``,
      `# 2) Start via Docker Compose (strikt 127.0.0.1:${port}, Opt-in-Profil tos-risk)`,
      `docker compose --profile tos-risk up -d --build ${svc}`,
      ``,
      `# 3) Lokale Bridge testen (Windows PowerShell — kein PS-Alias "curl"!)`,
      `Invoke-RestMethod -Uri "http://127.0.0.1:${port}/v1/models" -Method Get`,
      `# Oder mit echtem Windows curl.exe:`,
      `curl.exe -sS "http://127.0.0.1:${port}/v1/models"`,
    ].join('\n');
  }, [activeSelection]);

  const handleCopyManualCommands = async () => {
    if (!activeManualCommands) return;
    try {
      await navigator.clipboard.writeText(activeManualCommands);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Local GitHub Repo Preparation Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              ZIEL 3 · {totalBridgeCategoryCount} Katalog-Einträge geprüft · Lokaler Workspace{' '}
              <code>./bridges/</code>
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              Webclient-Bridge-Konsolidierung & Direkt-Ausführung (127.0.0.1)
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
              Klicke auf eine der {dockerCount} freigegebenen Bridges (oder auf{' '}
              <strong>„Ausführen“</strong>), um das Ausführungs-Panel zu öffnen: automatischer
              Repo-Klon, lokaler Start (Docker oder nativer Fallback auf <code className="font-mono">127.0.0.1</code>),
              Live-Logs und Loopback-Test — erst nach expliziter ToS-Risiko-Bestätigung (Regel 5).
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-end">
            <button
              type="button"
              onClick={onCloneAllRepos}
              disabled={cloneBatchRunning}
              className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
            >
              {cloneBatchRunning ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <DownloadCloud className="h-4 w-4" aria-hidden="true" />
              )}
              {cloneBatchRunning
                ? `Klone GitHub-Repos (${clonedCount}/${bridgeRepos.length})…`
                : 'Alle Bridge-Repos laden'}
            </button>
            <div className="font-mono text-xs text-slate-600 tabular-nums">
              Geklont: <strong className="text-emerald-700">{clonedCount}</strong>/
              {bridgeRepos.length}
              {' · '}Aktiv: <strong className="text-teal-700">{runningCount}</strong>
              {cloningCount > 0 ? ` · Klont: ${cloningCount}` : ''}
              {failedCount > 0 ? ` · Fehler: ${failedCount}` : ''}
            </div>
          </div>
        </div>

        {/* Local Repository & Execution Overview Table */}
        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold uppercase tracking-wider text-slate-600">
                <th className="px-3 py-2">Ziel / Bridge</th>
                <th className="px-3 py-2">Laufzeit (127.0.0.1)</th>
                <th className="px-3 py-2">Repo / Commit [Belegt]</th>
                <th className="px-3 py-2">Struktur-Check</th>
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bridgeRepos.map((repo) => {
                const isCloningThis =
                  repo.status === 'cloning' || cloningSingleId === repo.bridgeId;
                const runtime = runtimeById.get(repo.bridgeId);
                const sel = selectionByBridgeId.get(repo.bridgeId);
                return (
                  <tr
                    key={repo.bridgeId}
                    onClick={() => handleOpenBridgeRunner(repo.bridgeId)}
                    className="cursor-pointer transition-colors hover:bg-teal-50/40"
                  >
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-medium text-slate-900">
                        {repo.zielprovider}{' '}
                        <span className="font-mono text-slate-500">({repo.bridgeId})</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {sel?.port ? `127.0.0.1:${sel.port} · ` : ''}./{repo.localPath}/
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top">
                      <RuntimeStatusBadge runtime={runtime} />
                      {runtime?.lastProbeStatus && (
                        <div className="mt-0.5 max-w-[200px] truncate font-mono text-[10px] text-slate-500">
                          {runtime.lastProbeStatus}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top font-mono text-slate-700 tabular-nums">
                      {isCloningThis ? (
                        <span className="inline-flex items-center gap-1 text-teal-700">
                          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                          KLONT…
                        </span>
                      ) : repo.cloned ? (
                        <div>
                          <span className="font-semibold text-emerald-700">
                            {repo.commitHash ?? '—'}
                          </span>
                          {' · '}
                          <span>{repo.commitDate ?? '—'}</span>
                          <div className="text-[11px] text-slate-400">
                            {repo.branch ?? 'HEAD'} · {repo.fileCount} Dateien
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Wird bei Start geklont</span>
                      )}
                      {repo.error && (
                        <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-600">
                          {repo.error}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top font-mono text-[11px] text-slate-600">
                      {repo.cloned ? (
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          <span
                            className={
                              repo.hasDockerfile ? 'text-emerald-700' : 'text-amber-700'
                            }
                          >
                            Dockerfile:{repo.hasDockerfile ? 'Ja' : 'Nein'}
                          </span>
                          <span>·</span>
                          <span
                            className={repo.hasLicense ? 'text-emerald-700' : 'text-amber-700'}
                          >
                            LICENSE:{repo.hasLicense ? 'Ja' : 'Fehlt'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">Nach Klon verfügbar</span>
                      )}
                    </td>
                    <td
                      className="whitespace-nowrap px-3 py-2.5 text-right align-top"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenBridgeRunner(repo.bridgeId)}
                          aria-label={`Bridge ${repo.bridgeId} ausführen`}
                          className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800"
                        >
                          <Play className="h-3 w-3" aria-hidden="true" />
                          {runtime?.status === 'running' ? 'Steuern' : 'Ausführen'}
                        </button>
                        {repo.cloned && (
                          <button
                            type="button"
                            onClick={() => handleOpenInspector(repo)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <FolderGit2 className="h-3 w-3" aria-hidden="true" />
                            Dateien
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCloneSingleRepo(repo.bridgeId)}
                          disabled={isCloningThis || cloneBatchRunning}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          <DownloadCloud className="h-3 w-3" aria-hidden="true" />
                          {repo.cloned ? 'Pull' : 'Klonen'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <p>
            <strong>Harte Regeln 1, 3, 4 & 5:</strong> Es werden niemals{' '}
            <code className="font-mono">illegal</code>- oder{' '}
            <code className="font-mono">anonym_pseudo_key</code>-Repositories geklont oder
            ausgeführt. Keine Bridge startet automatisch — Ausführung erfolgt erst nach deinem
            expliziten Klick und Bestätigung des ToS-Restrisikos, strikt auf{' '}
            <code className="font-mono">127.0.0.1</code>.
          </p>
        </div>
      </section>

      {/* Target Provider Matrix */}
      <div className="grid grid-cols-1 gap-4">
        {selections.map((entry) => {
          const isExpanded = expandedTarget === entry.zielprovider;
          const hasWinner = entry.bridge_id !== null;
          const localRepo = entry.bridge_id ? repoById.get(entry.bridge_id) : undefined;
          const runtime = entry.bridge_id ? runtimeById.get(entry.bridge_id) : undefined;
          const verifiedCommitDisplay =
            localRepo?.cloned && localRepo.commitDate
              ? `${localRepo.commitDate} (${localRepo.commitHash}) [lokal belegt]`
              : (entry.last_commit_belegt ?? 'nicht verifiziert');

          return (
            <article
              key={entry.zielprovider}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-base font-semibold text-slate-900">
                      {entry.zielprovider}
                    </h3>
                    {hasWinner ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-teal-800">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {entry.bridge_id}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-700">
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        KEINE BRIDGE GEWÄHLT
                      </span>
                    )}
                    {entry.port ? (
                      <span className="font-mono text-xs text-slate-600 tabular-nums">
                        · 127.0.0.1:{entry.port} ({entry.docker_service})
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-amber-700">
                        · Nicht in Win-11 docker-compose.yml
                      </span>
                    )}
                    {runtime && <RuntimeStatusBadge runtime={runtime} />}
                  </div>

                  {entry.bridge_url && (
                    <a
                      href={entry.bridge_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-teal-700 hover:underline"
                    >
                      {entry.bridge_url}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-600 tabular-nums">
                    <span>
                      Stars:{' '}
                      <strong className="text-slate-900">
                        {entry.stars_belegt !== null
                          ? entry.stars_belegt.toLocaleString('de-DE')
                          : 'nicht verifiziert'}
                      </strong>
                    </span>
                    <span>·</span>
                    <span>
                      Commit: <strong className="text-slate-900">{verifiedCommitDisplay}</strong>
                    </span>
                  </div>
                  {entry.docker_capable && entry.bridge_id && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenBridgeRunner(entry.bridge_id!)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        Bridge ausführen
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenBridgeInChat(entry.bridge_id!)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                        Chat
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-xs lg:grid-cols-3">
                <div>
                  <p className="font-semibold uppercase tracking-wider text-slate-500">
                    Auswahlbegründung
                  </p>
                  <p className="mt-1 leading-relaxed text-slate-700">
                    <InlineCodeText text={entry.begruendung} />
                  </p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wider text-slate-500">
                    Dokumentierter Auth-Weg
                  </p>
                  <p className="mt-1 leading-relaxed text-slate-700">
                    <InlineCodeText text={entry.auth_weg} />
                  </p>
                </div>
                <div>
                  <p className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-red-700">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    Restrisiko (Regel 5)
                  </p>
                  <p className="mt-1 leading-relaxed text-slate-700">
                    <InlineCodeText text={entry.restrisiko} />
                  </p>
                </div>
              </div>

              {entry.candidatesEvaluated.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setExpandedTarget(isExpanded ? null : entry.zielprovider)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-950"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Alle {entry.candidatesEvaluated.length} bewerteten Kandidaten für{' '}
                    {entry.zielprovider} {isExpanded ? 'ausblenden' : 'anzeigen'}
                  </button>

                  {localRepo?.cloned && (
                    <button
                      type="button"
                      onClick={() => handleOpenInspector(localRepo)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-950"
                    >
                      <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Geklontes Repo inspizieren (./{localRepo.localPath}/)
                    </button>
                  )}
                </div>
              )}

              {isExpanded && entry.candidatesEvaluated.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Stars</th>
                        <th className="px-3 py-2">Risiko</th>
                        <th className="px-3 py-2">Bewertung</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {entry.candidatesEvaluated.map((cand) => (
                        <tr key={`${entry.zielprovider}-${cand.id}`}>
                          <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">
                            {cand.selected ? (
                              <span className="text-teal-700">GEWÄHLT</span>
                            ) : (
                              <span className="text-slate-400">VERWORFEN</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">
                            {cand.id}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700 tabular-nums">
                            {cand.stars !== null ? cand.stars.toLocaleString('de-DE') : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">
                            {cand.riskLevel}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{cand.decisionReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Excluded Entries Audit */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <button
          type="button"
          onClick={() => setShowExcluded(!showExcluded)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Ausgeschlossene Bridge-Kategorie-Einträge ({excludedEntries.length})
            </h3>
            <p className="text-xs text-slate-500">
              Regel-1-Sperren (illegal), allgemeine Browser-Automations-Frameworks (GELB),
              gehostete Drittanbieter-Mirrors und instabile Multi-Provider-Scraper.
            </p>
          </div>
          {showExcluded ? (
            <ChevronUp className="h-4 w-4 text-slate-600" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-600" />
          )}
        </button>

        {showExcluded && (
          <div className="mt-4 overflow-x-auto border-t border-slate-200 pt-3">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Risiko</th>
                  <th className="px-3 py-2">Ausschlussgrund</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {excludedEntries.map((ex) => (
                  <tr key={ex.id}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-900">
                      {ex.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">
                      {ex.riskLevel}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{ex.decisionReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bridge Execution Drawer (Click-to-Execute) */}
      {activeSelection && activeSelection.bridge_id && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/35"
          role="dialog"
          aria-modal="true"
          aria-label={`Bridge ausführen: ${activeSelection.bridge_id}`}
          onClick={() => setActiveBridgeId(null)}
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-red-700">KLASSE ROT</span>
                  <span className="font-mono text-xs text-slate-500">
                    · 127.0.0.1:{activeSelection.port}
                  </span>
                  <span className="text-slate-300">·</span>
                  <RuntimeStatusBadge runtime={activeRuntime} />
                </div>
                <h3 className="mt-1 truncate text-lg font-semibold text-slate-900">
                  {activeSelection.zielprovider} — {activeSelection.bridge_id}
                </h3>
                <p className="mt-0.5 font-mono text-xs text-slate-500">
                  Service: {activeSelection.docker_service} · Repo:{' '}
                  {activeRepo?.cloned
                    ? `lokal geklont (${activeRepo.commitHash})`
                    : 'wird beim Start geklont'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveBridgeId(null)}
                aria-label="Bridge-Ausführung schließen"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5 text-xs">
              {/* Rule 5 Risk Warning + Explicit Opt-In */}
              <div className="rounded-md border border-red-200 bg-red-50/70 p-4 text-red-950">
                <p className="flex items-center gap-1.5 font-semibold text-red-800">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ToS-Restrisiko (Harte Regel 5)
                </p>
                <p className="mt-1 leading-relaxed text-red-900">{activeSelection.restrisiko}</p>
                <p className="mt-2 leading-relaxed text-red-900">
                  <strong>Auth-Weg:</strong> <InlineCodeText text={activeSelection.auth_weg} />
                </p>

                <label className="mt-3 flex cursor-pointer items-start gap-2 rounded border border-red-200 bg-white p-2.5 text-slate-900">
                  <input
                    type="checkbox"
                    checked={Boolean(tosConfirmedIds[activeSelection.bridge_id])}
                    onChange={(e) =>
                      setTosConfirmedIds((prev) => ({
                        ...prev,
                        [activeSelection.bridge_id!]: e.target.checked,
                      }))
                    }
                    className="mt-0.5 h-4 w-4 accent-teal-700"
                  />
                  <span>
                    Ich bestätige das ToS-Restrisiko (Klasse ROT) und starte diese Bridge
                    ausschließlich lokal auf <code className="font-mono">127.0.0.1:{activeSelection.port}</code>{' '}
                    mit eigenem Test-/Wegwerfkonto.
                  </span>
                </label>
              </div>

              {/* Execution Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void onExecuteBridge(
                      activeSelection.bridge_id!,
                      Boolean(tosConfirmedIds[activeSelection.bridge_id!])
                    )
                  }
                  disabled={
                    !tosConfirmedIds[activeSelection.bridge_id] ||
                    executingBridgeId === activeSelection.bridge_id
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {executingBridgeId === activeSelection.bridge_id ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {executingBridgeId === activeSelection.bridge_id
                    ? 'Starte Bridge…'
                    : `Bridge ausführen (127.0.0.1:${activeSelection.port})`}
                </button>

                {activeRuntime &&
                  (activeRuntime.status === 'running' || activeRuntime.status === 'starting') && (
                    <button
                      type="button"
                      onClick={() => void onStopBridge(activeSelection.bridge_id!)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 hover:bg-red-100"
                    >
                      <Square className="h-3.5 w-3.5" aria-hidden="true" />
                      Stoppen
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => void handleRunProbe(activeSelection.bridge_id!)}
                  disabled={probingBridgeId === activeSelection.bridge_id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Activity className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                  {probingBridgeId === activeSelection.bridge_id
                    ? 'Prüfe Loopback…'
                    : `Loopback testen (127.0.0.1:${activeSelection.port})`}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const id = activeSelection.bridge_id!;
                    setActiveBridgeId(null);
                    onOpenBridgeInChat(id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-teal-700 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900 hover:bg-teal-100"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                  Im Chat öffnen
                </button>
              </div>

              {/* Runtime Diagnostic & Live Logs */}
              <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    Laufzeit-Diagnose & Live-Logs
                  </h4>
                  {activeRuntime?.pid && (
                    <span className="font-mono text-[11px] text-slate-500">
                      PID {activeRuntime.pid}
                    </span>
                  )}
                </div>

                {activeRuntime?.error && (
                  <div className="mt-2 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                    <strong>Diagnose [Belegt]:</strong> {activeRuntime.error}
                  </div>
                )}

                {activeRuntime?.lastProbeStatus && (
                  <div
                    className={`mt-2 rounded border p-2.5 font-mono text-[11px] ${
                      activeRuntime.lastProbeOk
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    Loopback 127.0.0.1:{activeSelection.port}: {activeRuntime.lastProbeStatus}
                    {typeof activeRuntime.lastProbeLatencyMs === 'number'
                      ? ` (${activeRuntime.lastProbeLatencyMs} ms)`
                      : ''}
                  </div>
                )}

                <pre className="mt-3 max-h-56 overflow-auto rounded bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                  <code>
                    {activeRuntime?.logs && activeRuntime.logs.length > 0
                      ? activeRuntime.logs.join('\n')
                      : 'Noch keine Ausfuehrung gestartet. Bestaetige oben das ToS-Restrisiko und klicke auf „Bridge ausfuehren“.'}
                  </code>
                </pre>
              </section>

              {/* Windows-11 PowerShell & Docker Commands */}
              <section className="rounded-md border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                    <Terminal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                    Windows-11 Start- & Test-Kommandos (PowerShell / curl.exe)
                  </h4>
                  <button
                    type="button"
                    onClick={() => void handleCopyManualCommands()}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {copiedCmd ? (
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
                <pre className="mt-2.5 overflow-x-auto rounded bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                  <code>{activeManualCommands}</code>
                </pre>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Local Cloned Repo File Inspector Drawer */}
      {inspectingRepo && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/30"
          role="dialog"
          aria-modal="true"
          aria-label={`Lokales Repository ${inspectingRepo.bridgeId}`}
          onClick={() => setInspectingRepo(null)}
        >
          <div
            className="flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <p className="font-mono text-xs text-emerald-700">
                  [Belegt – lokal geklont] ./{inspectingRepo.localPath}/ · Commit{' '}
                  {inspectingRepo.commitHash} ({inspectingRepo.commitDate})
                </p>
                <h3 className="mt-1 text-base font-semibold text-slate-900">
                  {inspectingRepo.zielprovider} — {inspectingRepo.bridgeId}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectingRepo(null)}
                aria-label="Repo-Inspektor schließen"
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-12">
              <div className="overflow-y-auto border-b border-slate-200 p-3 sm:col-span-4 sm:border-r sm:border-b-0">
                <div className="px-2 pb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Top-Level-Inhalt ({inspectingRepo.topFiles.length})
                </div>
                <ul className="space-y-0.5">
                  {inspectingRepo.topFiles.map((item) => {
                    const isDir = item.endsWith('/');
                    const active = item === activeFileName;
                    return (
                      <li key={item}>
                        {isDir ? (
                          <div className="px-2 py-1 font-mono text-xs text-slate-400">{item}</div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void openFilePreview(inspectingRepo, item)}
                            className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left font-mono text-xs transition-colors ${
                              active
                                ? 'bg-teal-50 font-semibold text-teal-900'
                                : 'text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">{item}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="flex min-h-0 flex-col bg-slate-950 sm:col-span-8">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 font-mono text-xs text-slate-300">
                  <span>{activeFileName ?? 'Datei auswählen'}</span>
                  {fileTruncated && <span className="text-amber-400">Gekürzt bei 64 KB</span>}
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {loadingFile ? (
                    <p className="font-mono text-xs text-slate-400">Lade Datei…</p>
                  ) : fileError ? (
                    <p className="font-mono text-xs text-red-400">{fileError}</p>
                  ) : (
                    <pre className="font-mono text-xs leading-relaxed text-slate-100">
                      <code>{fileContent || '(Keine Datei ausgewählt)'}</code>
                    </pre>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
