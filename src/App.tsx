import JSZip from 'jszip';
import {
  Code2,
  Download,
  FileArchive,
  FlaskConical,
  GitMerge,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Shield,
  TableProperties,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BridgeConsolidationView } from './components/BridgeConsolidationView.tsx';
import { ChatWorkbenchView, type ChatTargetPreset } from './components/ChatWorkbenchView.tsx';
import { ClassificationView } from './components/ClassificationView.tsx';
import { CodingStudioView } from './components/CodingStudioView.tsx';
import { ConnectionUseDrawer } from './components/ConnectionUseDrawer.tsx';
import { LiveTestView, type BatchTestMode } from './components/LiveTestView.tsx';
import { OverviewView } from './components/OverviewView.tsx';
import { SuiteExportView } from './components/SuiteExportView.tsx';
import type { ClassifiedProvider, SecurityClass, WorkspacePayload } from './lib/types.ts';

type NavTab = 'overview' | 'classification' | 'tests' | 'bridges' | 'chat' | 'coding' | 'export';

const NAV_ITEMS: Array<{ id: NavTab; label: string; shortGoal: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Übersicht & Audit', shortGoal: 'Regeln', icon: LayoutDashboard },
  { id: 'classification', label: 'Klassifikation', shortGoal: 'Ziel 1', icon: TableProperties },
  { id: 'tests', label: 'Live-Tests (ToS)', shortGoal: 'Ziel 2', icon: FlaskConical },
  { id: 'bridges', label: 'Bridge-Auswahl', shortGoal: 'Ziel 3', icon: GitMerge },
  { id: 'chat', label: 'Chat-Fenster', shortGoal: 'Direkt', icon: MessageSquare },
  { id: 'coding', label: 'Coding-Studio', shortGoal: 'IDE · Chat', icon: Code2 },
  { id: 'export', label: 'Suite-Export', shortGoal: 'Ziel 4–5', icon: FileArchive },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [classFilter, setClassFilter] = useState<SecurityClass | 'ALL'>('ALL');
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testingSingleId, setTestingSingleId] = useState<string | null>(null);
  const [cloningSingleId, setCloningSingleId] = useState<string | null>(null);
  const [executingBridgeId, setExecutingBridgeId] = useState<string | null>(null);
  const [applyingRouter, setApplyingRouter] = useState<boolean>(false);
  const [selectedUseProvider, setSelectedUseProvider] = useState<ClassifiedProvider | null>(null);
  const [chatPreset, setChatPreset] = useState<ChatTargetPreset | null>(null);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchWorkspace = async () => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/workspace');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WorkspacePayload;
      setWorkspace(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Fehler beim Laden der Daten.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchWorkspace();
  }, []);

  // Poll live status while batch tests run
  useEffect(() => {
    if (!workspace?.batchState.running) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/test/status');
        if (!res.ok) return;
        const patch = (await res.json()) as Pick<
          WorkspacePayload,
          'batchState' | 'testResults' | 'testAnalytics' | 'summary' | 'artifacts'
        >;
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                batchState: patch.batchState,
                testResults: patch.testResults,
                testAnalytics: patch.testAnalytics,
                summary: patch.summary,
                artifacts: patch.artifacts,
              }
            : prev
        );
      } catch {
        // ignore transient poll errors
      }
    }, 800);
    return () => clearInterval(interval);
  }, [workspace?.batchState.running]);

  // Poll local GitHub bridge clone progress while background cloning runs
  useEffect(() => {
    if (!workspace?.cloneBatchRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/bridges/repos');
        if (!res.ok) return;
        const patch = (await res.json()) as Pick<
          WorkspacePayload,
          'bridgeRepos' | 'cloneBatchRunning'
        >;
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                bridgeRepos: patch.bridgeRepos,
                cloneBatchRunning: patch.cloneBatchRunning,
              }
            : prev
        );
      } catch {
        // ignore transient poll errors
      }
    }, 900);
    return () => clearInterval(interval);
  }, [workspace?.cloneBatchRunning]);

  const handleCloneAllRepos = async (navigateToBridges = false) => {
    try {
      setErrorMsg(null);
      if (navigateToBridges) setActiveTab('bridges');
      const res = await fetch('/api/bridges/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all' }),
      });
      const json = (await res.json()) as {
        bridgeRepos?: WorkspacePayload['bridgeRepos'];
        cloneBatchRunning?: boolean;
        error?: string;
      };
      if (!res.ok && res.status !== 409) {
        throw new Error(json.error || `Klonen fehlgeschlagen (HTTP ${res.status})`);
      }
      if (json.bridgeRepos) {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                bridgeRepos: json.bridgeRepos!,
                cloneBatchRunning: Boolean(json.cloneBatchRunning),
              }
            : prev
        );
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'GitHub-Repos konnten nicht geklont werden.');
    }
  };

  const handleCloneSingleRepo = async (bridgeId: string) => {
    try {
      setCloningSingleId(bridgeId);
      setErrorMsg(null);
      const res = await fetch('/api/bridges/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'single', bridgeId }),
      });
      const json = (await res.json()) as {
        bridgeRepos?: WorkspacePayload['bridgeRepos'];
        cloneBatchRunning?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `Klonen fehlgeschlagen (HTTP ${res.status})`);
      }
      if (json.bridgeRepos) {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                bridgeRepos: json.bridgeRepos!,
                cloneBatchRunning: Boolean(json.cloneBatchRunning),
              }
            : prev
        );
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Repository konnte nicht geklont werden.');
    } finally {
      setCloningSingleId(null);
    }
  };

  const handleRefreshBridgeRuntimes = async () => {
    try {
      const res = await fetch('/api/bridges/runtime');
      if (!res.ok) return;
      const json = (await res.json()) as {
        bridgeRuntimes?: WorkspacePayload['bridgeRuntimes'];
      };
      if (json.bridgeRuntimes) {
        setWorkspace((prev) =>
          prev ? { ...prev, bridgeRuntimes: json.bridgeRuntimes! } : prev
        );
      }
    } catch {
      // ignore transient poll errors
    }
  };

  const handleExecuteBridge = async (bridgeId: string, confirmTosRisk: boolean) => {
    try {
      setExecutingBridgeId(bridgeId);
      setErrorMsg(null);
      const res = await fetch('/api/bridges/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId, confirmTosRisk }),
      });
      const json = (await res.json()) as {
        bridgeRuntimes?: WorkspacePayload['bridgeRuntimes'];
        bridgeRepos?: WorkspacePayload['bridgeRepos'];
        error?: string;
      };
      if (json.bridgeRuntimes || json.bridgeRepos) {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                bridgeRuntimes: json.bridgeRuntimes ?? prev.bridgeRuntimes,
                bridgeRepos: json.bridgeRepos ?? prev.bridgeRepos,
              }
            : prev
        );
      }
      if (!res.ok) {
        throw new Error(json.error || `Bridge-Ausführung fehlgeschlagen (HTTP ${res.status})`);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Bridge konnte nicht ausgeführt werden.');
    } finally {
      setExecutingBridgeId(null);
    }
  };

  const handleStopBridge = async (bridgeId: string) => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/bridges/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId }),
      });
      const json = (await res.json()) as {
        bridgeRuntimes?: WorkspacePayload['bridgeRuntimes'];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Stoppen fehlgeschlagen (HTTP ${res.status})`);
      if (json.bridgeRuntimes) {
        setWorkspace((prev) =>
          prev ? { ...prev, bridgeRuntimes: json.bridgeRuntimes! } : prev
        );
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Bridge konnte nicht gestoppt werden.');
    }
  };

  const handleProbeBridge = async (bridgeId: string) => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/bridges/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId }),
      });
      const json = (await res.json()) as {
        bridgeRuntimes?: WorkspacePayload['bridgeRuntimes'];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Loopback-Test fehlgeschlagen (HTTP ${res.status})`);
      if (json.bridgeRuntimes) {
        setWorkspace((prev) =>
          prev ? { ...prev, bridgeRuntimes: json.bridgeRuntimes! } : prev
        );
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Loopback-Probe fehlgeschlagen.');
    }
  };

  const handleUploadFile = async (file: File) => {
    try {
      setErrorMsg(null);
      const content = await file.text();
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, content }),
      });
      const json = (await res.json()) as WorkspacePayload & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || `Upload fehlgeschlagen (HTTP ${res.status})`);
      }
      setWorkspace(json);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Datei konnte nicht verarbeitet werden.');
    }
  };

  const handleRunSingleTest = async (providerId: string, byokApiKey?: string) => {
    try {
      setTestingSingleId(providerId);
      setErrorMsg(null);
      const res = await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'single',
          providerId,
          byokApiKey: byokApiKey || undefined,
        }),
      });
      const json = (await res.json()) as {
        result: WorkspacePayload['testResults'][number];
        testAnalytics: WorkspacePayload['testAnalytics'];
        summary: WorkspacePayload['summary'];
        artifacts: WorkspacePayload['artifacts'];
        batchState: WorkspacePayload['batchState'];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Test fehlgeschlagen (HTTP ${res.status})`);
      setWorkspace((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          testAnalytics: json.testAnalytics,
          summary: json.summary,
          artifacts: json.artifacts,
          batchState: json.batchState,
          testResults: prev.testResults.map((r) => (r.id === json.result.id ? json.result : r)),
        };
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Live-Test fehlgeschlagen.');
    } finally {
      setTestingSingleId(null);
    }
  };

  const handleRunBatch = async (mode: BatchTestMode) => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/test/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = (await res.json()) as {
        batchState: WorkspacePayload['batchState'];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Batch-Start fehlgeschlagen (HTTP ${res.status})`);
      setWorkspace((prev) => (prev ? { ...prev, batchState: json.batchState } : prev));
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Batch-Test konnte nicht gestartet werden.');
    }
  };

  const handleStopBatch = async () => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/test/stop', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const patch = (await res.json()) as Pick<
        WorkspacePayload,
        'batchState' | 'testResults' | 'testAnalytics' | 'summary' | 'artifacts'
      >;
      setWorkspace((prev) =>
        prev
          ? {
              ...prev,
              batchState: patch.batchState,
              testResults: patch.testResults,
              testAnalytics: patch.testAnalytics,
              summary: patch.summary,
              artifacts: patch.artifacts,
            }
          : prev
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Stoppen fehlgeschlagen.');
    }
  };

  const handleToggleRouterProvider = async (providerId: string) => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/router/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      const json = (await res.json()) as {
        activeRouterProviderIds?: string[];
        artifacts?: WorkspacePayload['artifacts'];
        summary?: WorkspacePayload['summary'];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Router-Update fehlgeschlagen (HTTP ${res.status})`);
      setWorkspace((prev) =>
        prev && json.activeRouterProviderIds && json.artifacts && json.summary
          ? {
              ...prev,
              activeRouterProviderIds: json.activeRouterProviderIds,
              artifacts: json.artifacts,
              summary: json.summary,
            }
          : prev
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Router-Konfiguration konnte nicht geändert werden.');
    }
  };

  const handleApplyTestedToRouter = async () => {
    try {
      setApplyingRouter(true);
      setErrorMsg(null);
      const res = await fetch('/api/router/apply-tested', { method: 'POST' });
      const json = (await res.json()) as {
        activeRouterProviderIds?: string[];
        artifacts?: WorkspacePayload['artifacts'];
        summary?: WorkspacePayload['summary'];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Router-Übernahme fehlgeschlagen (HTTP ${res.status})`);
      setWorkspace((prev) =>
        prev && json.activeRouterProviderIds && json.artifacts && json.summary
          ? {
              ...prev,
              activeRouterProviderIds: json.activeRouterProviderIds,
              artifacts: json.artifacts,
              summary: json.summary,
            }
          : prev
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Übernahme in Router fehlgeschlagen.');
    } finally {
      setApplyingRouter(false);
    }
  };

  const handleResetTests = async () => {
    try {
      setErrorMsg(null);
      const res = await fetch('/api/test/reset', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WorkspacePayload;
      setWorkspace(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Zurücksetzen fehlgeschlagen.');
    }
  };

  const handleDownloadCsv = () => {
    if (!workspace) return;
    const csvFile = workspace.artifacts.find((a) => a.path === 'test_results.csv');
    if (!csvFile) return;
    const blob = new Blob([csvFile.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'test_results.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (!workspace) return;
    try {
      setDownloadingZip(true);
      const zip = new JSZip();
      const folder = zip.folder('ai-provider-suite');
      if (folder) {
        for (const file of workspace.artifacts) {
          folder.file(file.path, file.content);
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-provider-suite.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingZip(false);
    }
  };

  const activeNavItem = NAV_ITEMS.find((n) => n.id === activeTab)!;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Hidden File Input for custom ai_provider*.txt */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUploadFile(file);
          e.target.value = '';
        }}
      />

      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Sidebar Navigation (256px desktop, drawer mobile) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-150 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-700 text-white">
              <Shield className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-slate-900">
                AI-Provider-Suite
              </div>
              <div className="font-mono text-[11px] text-slate-500">Audit & Konsolidierung</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Menü schließen"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Hauptnavigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  active
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-950'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? 'text-teal-700' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-slate-400">
                  {item.shortGoal}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Dataset Footer Summary */}
        {workspace && (
          <div className="border-t border-slate-200 p-4 text-xs text-slate-600">
            <div className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Aktiver Katalog
            </div>
            <div className="mt-1 truncate font-mono font-medium text-slate-800">
              {workspace.summary.sourceName}
            </div>
            <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums">
              <span className="text-emerald-700">G:{workspace.summary.counts.GRUEN}</span>
              <span className="text-amber-700">Y:{workspace.summary.counts.GELB}</span>
              <span className="text-red-700">R:{workspace.summary.counts.ROT}</span>
              <span className="text-slate-900">S:{workspace.summary.counts.SCHWARZ}</span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Shell */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Navigation öffnen"
              className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900">
                {activeNavItem.label}
              </h1>
              <p className="hidden font-mono text-xs text-slate-500 sm:block">
                {activeNavItem.shortGoal} · Strikt 127.0.0.1 · Keine Secrets
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Katalog laden</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={downloadingZip || !workspace}
              className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>ZIP-Suite</span>
            </button>
          </div>
        </header>

        <main
          className={
            activeTab === 'coding'
              ? 'mx-auto max-w-[1680px] px-3 py-4 sm:px-4'
              : 'mx-auto max-w-7xl px-4 py-6 sm:px-6'
          }
        >
          {errorMsg && (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900"
            >
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="font-mono font-semibold text-red-700 hover:underline"
              >
                Schließen
              </button>
            </div>
          )}

          {loading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
              Lade und klassifiziere AI-Provider-Katalog…
            </div>
          ) : !workspace ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
              Kein Datensatz geladen.
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  summary={workspace.summary}
                  testResults={workspace.testResults}
                  bridgeRepos={workspace.bridgeRepos}
                  artifactsCount={workspace.artifacts.length}
                  cloneBatchRunning={workspace.cloneBatchRunning}
                  onNavigate={(tab, secClass) => {
                    if (tab === 'classification') {
                      setClassFilter(secClass ?? 'ALL');
                    }
                    setActiveTab(tab);
                  }}
                  onLoadBridgeRepos={() => void handleCloneAllRepos(true)}
                  onDownloadZip={handleDownloadZip}
                  downloadingZip={downloadingZip}
                />
              )}
              {activeTab === 'classification' && (
                <ClassificationView
                  providers={workspace.providers}
                  initialClassFilter={classFilter}
                  activeRouterProviderIds={workspace.activeRouterProviderIds}
                  testingSingleId={testingSingleId}
                  onUseConnection={(p) => setSelectedUseProvider(p)}
                  onRunSingleTest={(id) => void handleRunSingleTest(id)}
                />
              )}
              {activeTab === 'tests' && (
                <LiveTestView
                  providers={workspace.providers}
                  testResults={workspace.testResults}
                  testAnalytics={workspace.testAnalytics}
                  activeRouterProviderIds={workspace.activeRouterProviderIds}
                  batchState={workspace.batchState}
                  testingSingleId={testingSingleId}
                  onRunSingleTest={(id) => void handleRunSingleTest(id)}
                  onRunBatch={(mode) => void handleRunBatch(mode)}
                  onStopBatch={() => void handleStopBatch()}
                  onResetTests={() => void handleResetTests()}
                  onDownloadCsv={handleDownloadCsv}
                  onUseConnection={(p) => setSelectedUseProvider(p)}
                  onApplyTestedToRouter={() => void handleApplyTestedToRouter()}
                  applyingRouter={applyingRouter}
                />
              )}
              {activeTab === 'bridges' && (
                <BridgeConsolidationView
                  selections={workspace.bridgeSelections}
                  excludedEntries={workspace.excludedBridgeEntries}
                  bridgeRepos={workspace.bridgeRepos}
                  bridgeRuntimes={workspace.bridgeRuntimes}
                  cloneBatchRunning={workspace.cloneBatchRunning}
                  cloningSingleId={cloningSingleId}
                  executingBridgeId={executingBridgeId}
                  totalBridgeCategoryCount={workspace.summary.bridgeCandidatesCount}
                  onCloneAllRepos={() => void handleCloneAllRepos(false)}
                  onCloneSingleRepo={(id) => void handleCloneSingleRepo(id)}
                  onExecuteBridge={handleExecuteBridge}
                  onStopBridge={handleStopBridge}
                  onProbeBridge={handleProbeBridge}
                  onRefreshBridgeRuntimes={handleRefreshBridgeRuntimes}
                  onOpenBridgeInChat={(bridgeId) => {
                    setChatPreset({ targetType: 'bridge', bridgeId, nonce: Date.now() });
                    setActiveTab('chat');
                  }}
                />
              )}
              {activeTab === 'chat' && (
                <ChatWorkbenchView
                  providers={workspace.providers}
                  bridgeSelections={workspace.bridgeSelections}
                  bridgeRuntimes={workspace.bridgeRuntimes}
                  executingBridgeId={executingBridgeId}
                  initialTarget={chatPreset}
                  onExecuteBridge={handleExecuteBridge}
                  onStopBridge={handleStopBridge}
                  onProbeBridge={handleProbeBridge}
                />
              )}
              {activeTab === 'coding' && (
                <CodingStudioView
                  providers={workspace.providers}
                  bridgeSelections={workspace.bridgeSelections}
                  bridgeRuntimes={workspace.bridgeRuntimes}
                  executingBridgeId={executingBridgeId}
                  onExecuteBridge={handleExecuteBridge}
                  onStopBridge={handleStopBridge}
                  onProbeBridge={handleProbeBridge}
                />
              )}
              {activeTab === 'export' && (
                <SuiteExportView
                  artifacts={workspace.artifacts}
                  auditChecks={workspace.summary.auditChecks}
                  onDownloadZip={handleDownloadZip}
                  downloadingZip={downloadingZip}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Interactive Connection Usage Drawer for any GRÜN / GELB connection */}
      {workspace && (
        <ConnectionUseDrawer
          provider={selectedUseProvider}
          testRow={
            selectedUseProvider
              ? workspace.testResults.find((r) => r.id === selectedUseProvider.id)
              : undefined
          }
          isInRouter={
            selectedUseProvider
              ? workspace.activeRouterProviderIds.includes(selectedUseProvider.id)
              : false
          }
          testingSingleId={testingSingleId}
          onClose={() => setSelectedUseProvider(null)}
          onRunSingleTest={handleRunSingleTest}
          onToggleRouter={handleToggleRouterProvider}
          onOpenInChat={(prov, ep) => {
            setChatPreset({
              targetType: 'provider',
              providerId: prov.id,
              endpointUrl: ep,
              nonce: Date.now(),
            });
            setActiveTab('chat');
          }}
        />
      )}
    </div>
  );
}
