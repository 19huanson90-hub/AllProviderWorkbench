import { AlertCircle, CheckCircle2, Play, ShieldCheck, Terminal, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SandboxExecutionResult, SandboxRunnerPresetId } from '../lib/codingSandboxRunner.ts';

interface PresetInfo {
  id: SandboxRunnerPresetId;
  label: string;
  description: string;
  extensions: readonly string[];
  commandPreviewPrefix: string;
}

const CLIENT_SANDBOX_PRESETS: readonly PresetInfo[] = [
  {
    id: 'node_run',
    label: 'Node.js ausführen',
    description: 'JS/MJS/CJS-Datei in coding-workspace/ ausführen.',
    extensions: ['.js', '.mjs', '.cjs'],
    commandPreviewPrefix: 'node',
  },
  {
    id: 'node_test',
    label: 'Node Unit-Tests',
    description: 'node --test auf einer JS-Testdatei ausführen.',
    extensions: ['.js', '.mjs', '.cjs'],
    commandPreviewPrefix: 'node --test',
  },
  {
    id: 'tsx_run',
    label: 'TypeScript ausführen (tsx)',
    description: 'TS-Datei in coding-workspace/ über lokales tsx ausführen.',
    extensions: ['.ts', '.mts'],
    commandPreviewPrefix: 'tsx',
  },
  {
    id: 'tsx_test',
    label: 'TypeScript Unit-Tests (tsx)',
    description: 'tsx --test auf einer TS-Testdatei ausführen.',
    extensions: ['.ts', '.mts'],
    commandPreviewPrefix: 'tsx --test',
  },
  {
    id: 'tsc_check',
    label: 'TypeScript Typprüfung (tsc)',
    description: 'Prüft Typen ohne Output (--noEmit).',
    extensions: ['.ts', '.tsx'],
    commandPreviewPrefix: 'tsc --noEmit',
  },
  {
    id: 'python_run',
    label: 'Python ausführen (-I)',
    description: 'Python-Skript isoliert ausführen.',
    extensions: ['.py'],
    commandPreviewPrefix: 'python3 -I',
  },
  {
    id: 'python_syntax',
    label: 'Python Syntax-Check',
    description: 'Syntaxprüfung via py_compile.',
    extensions: ['.py'],
    commandPreviewPrefix: 'python3 -I -m py_compile',
  },
];

function suggestPresetForFile(filePath: string): SandboxRunnerPresetId {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.test.ts') || lower.endsWith('.spec.ts')) return 'tsx_test';
  if (lower.endsWith('.test.js') || lower.endsWith('.test.mjs') || lower.endsWith('.spec.js')) return 'node_test';
  if (lower.endsWith('.tsx')) return 'tsc_check';
  if (lower.endsWith('.ts') || lower.endsWith('.mts')) return 'tsx_run';
  if (lower.endsWith('.py')) return 'python_run';
  return 'node_run';
}

export function CodingSandboxRunnerPanel({
  activeFilePath,
  sandboxFilePaths,
  onSendErrorToAi,
}: {
  activeFilePath: string | null;
  sandboxFilePaths: string[];
  onSendErrorToAi: (result: SandboxExecutionResult) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [presetId, setPresetId] = useState<SandboxRunnerPresetId>('node_run');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SandboxExecutionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync default file when user opens a file in coding-workspace/
  useEffect(() => {
    if (activeFilePath && activeFilePath.startsWith('coding-workspace/')) {
      setSelectedFile(activeFilePath);
      setPresetId(suggestPresetForFile(activeFilePath));
    } else if (!selectedFile && sandboxFilePaths.length > 0) {
      setSelectedFile(sandboxFilePaths[0]);
      setPresetId(suggestPresetForFile(sandboxFilePaths[0]));
    }
  }, [activeFilePath, sandboxFilePaths, selectedFile]);

  const activePreset = useMemo(
    () => CLIENT_SANDBOX_PRESETS.find((p) => p.id === presetId) ?? CLIENT_SANDBOX_PRESETS[0],
    [presetId]
  );

  const commandPreview = selectedFile
    ? `${activePreset.commandPreviewPrefix} ${selectedFile}`
    : `${activePreset.commandPreviewPrefix} <datei-in-coding-workspace>`;

  const handleRunApproved = async () => {
    if (!selectedFile || running) return;
    setRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/coding/sandbox/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId,
          targetFile: selectedFile,
          confirmExecution: true,
        }),
      });
      const json = (await res.json()) as SandboxExecutionResult & { error?: string };
      if (!res.ok && !json.displayCommand) {
        setErrorMsg(json.error || `HTTP ${res.status}`);
        setResult(null);
      } else {
        setResult(json);
      }
    } catch {
      setErrorMsg('Verbindungsfehler zum lokalen Sandbox-Runner.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      data-testid="sandbox-runner-panel"
      className="flex max-h-[235px] shrink-0 flex-col overflow-y-auto border-t border-slate-800 bg-slate-950 text-slate-100"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-100">
          <Terminal className="h-3.5 w-3.5 text-teal-400" aria-hidden="true" />
          <span>Sandbox-Runner</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 whitespace-nowrap">
          <ShieldCheck className="h-3 w-3 text-emerald-400" aria-hidden="true" />
          <span>Allowlist · Ohne Secrets · 12s</span>
        </span>
      </div>

      <div className="space-y-1.5 p-2 text-[11px]">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] text-slate-400">Zieldatei (Sandbox)</span>
            {sandboxFilePaths.length > 0 ? (
              <select
                value={selectedFile}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedFile(next);
                  setPresetId(suggestPresetForFile(next));
                }}
                aria-label="Sandbox-Zieldatei wählen"
                className="w-full truncate rounded border border-slate-700 bg-slate-900 px-1.5 py-1 font-mono text-[10px] text-slate-100 focus:border-teal-500 focus:outline-none"
              >
                {sandboxFilePaths.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/^coding-workspace\//, '')}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded border border-slate-800 bg-slate-900/70 px-1.5 py-1 text-[10px] text-slate-400">
                Keine Sandbox-Datei
              </div>
            )}
          </label>

          <label className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10px] text-slate-400">Modus</span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as SandboxRunnerPresetId)}
              aria-label="Sandbox-Preset wählen"
              className="w-full truncate rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[10px] text-slate-100 focus:border-teal-500 focus:outline-none"
            >
              {CLIENT_SANDBOX_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Exact command preview + Human-in-the-Loop approval CTA */}
        <div className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/80 px-2 py-1">
          <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-teal-300">
            $ {commandPreview}
          </code>
          <button
            type="button"
            onClick={() => void handleRunApproved()}
            disabled={!selectedFile || running}
            className="inline-flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-500 disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            <Play className="h-3 w-3" aria-hidden="true" />
            <span>{running ? 'Läuft…' : 'Freigeben & Ausführen'}</span>
          </button>
        </div>

        {errorMsg && (
          <div className="rounded border border-rose-800 bg-rose-950/60 px-2 py-1.5 text-[11px] text-rose-200">
            {errorMsg}
          </div>
        )}

        {result && (
          <div
            data-testid="sandbox-runner-output"
            className="space-y-1.5 rounded border border-slate-800 bg-slate-900/70 p-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] tabular-nums">
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  result.ok ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {result.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>
                  {result.ok ? 'Erfolgreich' : 'Fehlgeschlagen'} · Exit {result.exitCode ?? '—'} ·{' '}
                  {result.durationMs} ms
                </span>
              </span>

              {!result.ok && (
                <button
                  type="button"
                  onClick={() => onSendErrorToAi(result)}
                  className="inline-flex items-center gap-1 rounded border border-amber-500/60 bg-amber-950/60 px-2 py-0.5 text-[10px] font-medium text-amber-200 hover:bg-amber-900/70 whitespace-nowrap shrink-0"
                >
                  <Wrench className="h-3 w-3" aria-hidden="true" />
                  <span>Fehler an KI senden</span>
                </button>
              )}
            </div>

            {result.error && (
              <div className="font-mono text-[10px] text-rose-300">{result.error}</div>
            )}

            {result.stdout && (
              <pre className="max-h-32 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] leading-relaxed text-slate-200">
                {result.stdout}
              </pre>
            )}

            {result.stderr && (
              <pre className="max-h-32 overflow-auto rounded border border-rose-900/70 bg-rose-950/40 p-2 font-mono text-[10px] leading-relaxed text-rose-200">
                {result.stderr}
              </pre>
            )}

            {!result.stdout && !result.stderr && !result.error && (
              <div className="font-mono text-[10px] text-slate-400">(Keine Ausgabe auf stdout/stderr)</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
