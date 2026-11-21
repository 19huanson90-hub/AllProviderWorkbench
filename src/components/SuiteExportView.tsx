import { Check, CheckCircle2, Copy, Download, FileCode2, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { SecurityAuditCheck, SuiteFile } from '../lib/types.ts';

interface SuiteExportViewProps {
  artifacts: SuiteFile[];
  auditChecks: SecurityAuditCheck[];
  onDownloadZip: () => void;
  downloadingZip: boolean;
}

export function SuiteExportView({
  artifacts,
  auditChecks,
  onDownloadZip,
  downloadingZip,
}: SuiteExportViewProps) {
  const [selectedPath, setSelectedPath] = useState<string>(
    artifacts.find((a) => a.path === 'start-gui.bat')?.path ??
      artifacts.find((a) => a.path === 'docker-compose.yml')?.path ??
      artifacts[0]?.path ??
      ''
  );
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const activeFile = artifacts.find((a) => a.path === selectedPath) ?? artifacts[0];
  const startBatFile = artifacts.find((a) => a.path === 'start-gui.bat');

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedPath(activeFile.path);
      setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // ignore clipboard restrictions in headless contexts
    }
  };

  const downloadFileContent = (file: SuiteFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path.split('/').pop() || file.path;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSingle = () => {
    if (!activeFile) return;
    downloadFileContent(activeFile);
  };

  const allChecksPassed = auditChecks.every((a) => a.passed);

  return (
    <div className="space-y-5">
      {/* Top Export & Windows 11 Quickstart Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              ZIELE 4 & 5 · Zielpfad Windows 11: %USERPROFILE%\Desktop\ai-provider-suite\
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">
              Vollständige Suite-Dateien ({artifacts.length} Artefakte) & Windows-Starter
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Enthält <code className="font-mono">start-gui.bat</code> (Doppelklick-Starter für
              Windows 11) sowie dynamisch aktualisierte{' '}
              <code className="font-mono">litellm_config.yaml</code>,{' '}
              <code className="font-mono">test_results.csv</code> und{' '}
              <code className="font-mono">REPORT.md</code>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {allChecksPassed ? 'ALLE 6 REGELN GEPRÜFT' : 'AUDIT PRÜFEN'}
            </span>
            {startBatFile && (
              <button
                type="button"
                onClick={() => downloadFileContent(startBatFile)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50"
              >
                <Terminal className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                start-gui.bat laden
              </button>
            )}
            <button
              type="button"
              onClick={onDownloadZip}
              disabled={downloadingZip}
              className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {downloadingZip ? 'Erstelle ZIP…' : 'ai-provider-suite.zip laden'}
            </button>
          </div>
        </div>

        {/* Windows 11 Quickstart: start-gui.bat & PowerShell */}
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold text-slate-800">
            <Terminal className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            Windows-11-Start: Doppelklick auf start-gui.bat (KEIN Docker Desktop nötig!)
          </div>
          <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-slate-700">
{`# Option A – Grafische Oberflaeche OHNE Docker Desktop (Doppelklick im Explorer):
#   1. Neues ai-provider-suite.zip entpacken
#   2. start-gui.bat doppelklicken -> startet lokale GUI auf http://127.0.0.1:8787
#      (nutzt automatisch Node.js, Python oder eingebautes Windows PowerShell – Null-Installation!)

# Option B – Optionaler Docker LiteLLM-Router (nur wenn Docker Desktop laeuft):
cd "$env:USERPROFILE\\Desktop\\ai-provider-suite"
Copy-Item .env.example .env    # Nur echte Keys fuer GRUENE APIs eintragen
.\\start-all.ps1                # Startet GRUENEN LiteLLM-Router auf http://127.0.0.1:4000/v1
.\\stop-all.ps1                 # Stoppt alle Container sauber`}
          </pre>
        </div>
      </section>

      {/* Split Explorer & Code Preview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <nav
          aria-label="Suite-Dateiliste"
          className="rounded-lg border border-slate-200 bg-white p-2 lg:col-span-4"
        >
          <div className="px-2.5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-slate-500">
            Dateien ({artifacts.length})
          </div>
          <ul className="space-y-0.5">
            {artifacts.map((file) => {
              const active = file.path === activeFile?.path;
              const linesCount = file.content.split('\n').length;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'bg-teal-50 text-teal-950'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-950'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <FileCode2
                        className={`h-4 w-4 shrink-0 ${active ? 'text-teal-700' : 'text-slate-400'}`}
                        aria-hidden="true"
                      />
                      <span className="truncate font-mono text-xs font-medium">{file.path}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                      {linesCount} Z.
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white lg:col-span-8">
          {activeFile && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate font-mono text-sm font-semibold text-slate-900">
                    {activeFile.path}
                  </h3>
                  <p className="text-xs text-slate-600">{activeFile.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {copiedPath === activeFile.path ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
                        Kopiert
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        Kopieren
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSingle}
                    className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Datei laden
                  </button>
                </div>
              </div>
              <pre className="max-h-[620px] overflow-auto bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
                <code>{activeFile.content}</code>
              </pre>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
