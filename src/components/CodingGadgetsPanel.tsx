import {
  AlertTriangle,
  BookmarkPlus,
  Brain,
  Download,
  ExternalLink,
  Gauge,
  KeyRound,
  Mic,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  CodingMemoryCategory,
  CodingMemoryStore,
  ContextBudgetEstimate,
} from '../lib/codingMemory.ts';

const CATEGORY_LABELS: Record<CodingMemoryCategory, string> = {
  fact: 'Fakt',
  decision: 'Entscheidung',
  preference: 'Präferenz',
  snippet: 'Snippet',
  todo: 'Offen',
};

export function CodingGadgetsPanel({
  memoryStore,
  budget,
  activeFilePath,
  speechSttSupported,
  speechTtsSupported,
  onSaveEntry,
  onToggleAutoInject,
  onToggleEntry,
  onDeleteEntry,
  onImportStore,
  onInsertQuickPrompt,
  onSelectNoTrackApi,
}: {
  memoryStore: CodingMemoryStore;
  budget: ContextBudgetEstimate;
  activeFilePath: string | null;
  speechSttSupported: boolean;
  speechTtsSupported: boolean;
  onSaveEntry: (entry: {
    title: string;
    content: string;
    category: CodingMemoryCategory;
  }) => Promise<void>;
  onToggleAutoInject: (next: boolean) => Promise<void>;
  onToggleEntry: (id: string) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onImportStore: (raw: unknown) => Promise<{ ok: boolean; error?: string }>;
  onInsertQuickPrompt: (prompt: string) => void;
  onSelectNoTrackApi: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<CodingMemoryCategory>('fact');
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activeCount = useMemo(
    () => memoryStore.entries.filter((e) => e.enabled).length,
    [memoryStore.entries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return memoryStore.entries;
    return memoryStore.entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.content.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
    );
  }, [memoryStore.entries, searchQuery]);

  const handleAdd = async () => {
    if (!title.trim() || !content.trim() || saving) return;
    setSaving(true);
    setStatusMsg(null);
    try {
      await onSaveEntry({ title: title.trim(), content: content.trim(), category });
      setTitle('');
      setContent('');
      setStatusMsg('Dauerhaft im Langzeit-Gedächtnis gespeichert.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(memoryStore, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coding-memory-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const res = await onImportStore(parsed);
      setStatusMsg(res.ok ? 'Gedächtnis-Backup importiert.' : res.error || 'Import fehlgeschlagen.');
    } catch {
      setStatusMsg('Ungültige JSON-Datei.');
    }
  };

  const barTone =
    budget.status === 'critical'
      ? 'bg-rose-600'
      : budget.status === 'warn'
        ? 'bg-amber-500'
        : 'bg-teal-600';

  return (
    <div data-testid="coding-gadgets-panel" className="space-y-4">
      {/* 1. Persistent Long-Term Memory ("Merkender Verlauf") */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <Brain className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>Merkender Verlauf ({activeCount}/{memoryStore.entries.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleExportJson}
              title="Gedächtnis als JSON sichern"
              aria-label="Gedächtnis exportieren"
              className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              title="Gedächtnis-Backup (JSON) importieren"
              aria-label="Gedächtnis importieren"
              className="rounded border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <Upload className="h-3 w-3" aria-hidden="true" />
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                void handleImportFile(e.target.files?.[0] || null);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>

        <label className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700">
          <span>Automatisch in jeden Chat einblenden</span>
          <input
            type="checkbox"
            checked={memoryStore.autoInject}
            onChange={(e) => void onToggleAutoInject(e.target.checked)}
            className="h-3.5 w-3.5 accent-teal-700"
          />
        </label>

        <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2.5">
          <div className="flex gap-1.5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Titel (z. B. Tech-Stack / Stil)"
              aria-label="Gedächtnis-Titel"
              className="min-w-0 flex-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CodingMemoryCategory)}
              aria-label="Gedächtnis-Kategorie"
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[11px] text-slate-800 focus:border-teal-600 focus:outline-none"
            >
              {(Object.keys(CATEGORY_LABELS) as CodingMemoryCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
          </div>
          <textarea
            rows={2}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Dauerhaft merken (API-Keys werden automatisch geschwärzt)…"
            aria-label="Gedächtnis-Inhalt"
            className="w-full resize-none rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-none"
          />
          <button
            type="button"
            data-testid="memory-save-btn"
            onClick={() => void handleAdd()}
            disabled={!title.trim() || !content.trim() || saving}
            className="inline-flex w-full items-center justify-center gap-1 rounded bg-teal-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-800 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            <span>{saving ? 'Speichere…' : 'Dauerhaft merken'}</span>
          </button>
          {statusMsg && <div className="text-[10px] text-teal-700">{statusMsg}</div>}
        </div>

        {memoryStore.entries.length > 0 && (
          <div className="space-y-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Im Gedächtnis suchen…"
                className="w-full rounded border border-slate-200 bg-slate-50 py-1 pl-6 pr-2 text-[11px] text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  data-testid="memory-entry-item"
                  className={`rounded-md border px-2 py-1.5 text-[11px] ${
                    entry.enabled
                      ? 'border-slate-200 bg-white text-slate-800'
                      : 'border-slate-200/70 bg-slate-50 text-slate-400'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <label className="flex min-w-0 items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={() => void onToggleEntry(entry.id)}
                        className="mt-0.5 h-3 w-3 accent-teal-700"
                      />
                      <span className="truncate font-semibold">{entry.title}</span>
                    </label>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 font-mono text-[9px] uppercase text-slate-500">
                        {CATEGORY_LABELS[entry.category]}
                      </span>
                      <button
                        type="button"
                        onClick={() => void onDeleteEntry(entry.id)}
                        aria-label={`Eintrag ${entry.title} löschen`}
                        className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-600">
                    {entry.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Live Context & Token Budget Meter */}
      <div className="space-y-1.5 border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
          <span className="inline-flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>Kontext-Budget (ca.)</span>
          </span>
          <span className="font-mono text-[11px] tabular-nums text-slate-700">
            {budget.totalTokens.toLocaleString('de-DE')} / {budget.contextWindow.toLocaleString('de-DE')} tok
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full transition-all ${barTone}`}
            style={{ width: `${Math.max(2, budget.usagePercent)}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-1 font-mono text-[10px] tabular-nums text-slate-500">
          <span>System: {budget.systemTokens}</span>
          <span>Gedächtnis: {budget.memoryTokens}</span>
          <span>Dateien: {budget.filesTokens}</span>
          <span>Verlauf: {budget.historyTokens}</span>
        </div>
      </div>

      {/* 3. Developer Gadgets & Local Browser Voice */}
      <div className="space-y-2 border-t border-slate-200 pt-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <Sparkles className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
          <span>Schnell-Gadgets</span>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            onClick={() =>
              onInsertQuickPrompt(
                'Fasse die wichtigsten Fakten, Entscheidungen und offenen Punkte aus diesem Verlauf prägnant zusammen und speichere sie per Tool remember_fact im Langzeit-Gedächtnis.'
              )
            }
            className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-700 hover:border-teal-300 hover:bg-teal-50/50"
          >
            <BookmarkPlus className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
            <span>Verlauf zusammenfassen & dauerhaft merken</span>
          </button>
          <button
            type="button"
            onClick={() =>
              onInsertQuickPrompt(
                activeFilePath
                  ? `Analysiere die Struktur von ${activeFilePath} per inspect_code_outline und nenne konkrete Verbesserungen oder Risiken.`
                  : 'Analysiere die Projektstruktur mit list_workspace_files und inspect_code_outline auf Architektur-Engpässe.'
              )
            }
            className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] text-slate-700 hover:border-teal-300 hover:bg-teal-50/50"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
            <span>Code-Outline & Architektur-Check starten</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] text-slate-600">
          <span className="inline-flex items-center gap-1">
            <Mic className="h-3 w-3 text-teal-700" aria-hidden="true" />
            Diktat: {speechSttSupported ? 'Im Eingabefeld bereit' : 'Browser nicht unterstützt'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Volume2 className="h-3 w-3 text-teal-700" aria-hidden="true" />
            Vorlesen: {speechTtsSupported ? 'An jeder Antwort aktiv' : 'Nicht verfügbar'}
          </span>
        </div>
      </div>

      {/* 4. NoTrack.ai Connection & Bridge Reference Card */}
      <div className="space-y-2 border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
            <ShieldCheck className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>NoTrack.ai Verbindungs-Kompass</span>
          </span>
          <button
            type="button"
            onClick={onSelectNoTrackApi}
            className="rounded bg-teal-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-teal-800 whitespace-nowrap"
          >
            In Weg 3 laden
          </button>
        </div>

        <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[10px] leading-relaxed text-slate-700">
          <div>
            <strong className="text-slate-900">Offizielle API (Empfohlen):</strong>{' '}
            <code className="font-mono text-teal-800">https://api.notrack.ai/v1</code> · Modell{' '}
            <code className="font-mono">notrack-uncensored</code> (100K Kontext, SSE, native Tools, Zero-Logs, $0,50 Startguthaben).
          </div>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <a
              href="https://notrack.ai/api/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-0.5 font-medium text-teal-800 hover:bg-teal-50"
            >
              <KeyRound className="h-3 w-3" aria-hidden="true" />
              <span>API-Key ($0,50 Start)</span>
            </a>
            <a
              href="https://notrack.ai/chat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span>Web-Chat</span>
            </a>
            <a
              href="https://notrack.ai/coder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-100"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span>NoTrack Coder</span>
            </a>
          </div>
          <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50/80 p-1.5 text-[10px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              <strong>Webchat-Bridge-Hinweis (ROT/ToS):</strong> <code className="font-mono">notrack.ai/chat</code> blockt Bots explizit (HTTP 403). Externe Community-Bridge{' '}
              <code className="font-mono">theabbie/pi-llm-bridge</code> nutzt UA-/Cookie-Spoofing gegen <code className="font-mono">/api/dispatch</code> — daher hier bewusst nicht als automatischer Bypass integriert.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
