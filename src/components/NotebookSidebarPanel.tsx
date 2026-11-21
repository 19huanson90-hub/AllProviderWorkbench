import {
  BookOpen,
  Check,
  Clock,
  Download,
  FileText,
  FolderPlus,
  MessageSquare,
  Pause,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import type { ChatTargetType } from '../lib/chatEngine.ts';
import {
  computeNextRunAt,
  createId,
  exportProjectToMarkdown,
  searchProjectEverything,
  type ChronoScheduleType,
  type NotebookChatThread,
  type NotebookChronoJob,
  type NotebookKnowledgeDoc,
  type NotebookProject,
} from '../lib/notebookEngine.ts';

interface NotebookSidebarPanelProps {
  projects: NotebookProject[];
  activeProject: NotebookProject;
  activeChatId: string;
  activeRailTab: 'notebook' | 'knowledge' | 'chrono' | 'connection';
  onChangeRailTab: (tab: 'notebook' | 'knowledge' | 'chrono' | 'connection') => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (name: string, description: string, instructions: string) => void;
  onUpdateProject: (updater: (project: NotebookProject) => NotebookProject) => void;
  onDeleteProject: (projectId: string) => void;
  onSelectChat: (chatId: string) => void;
  onCreateChat: (title?: string) => void;
  onDeleteChat: (chatId: string) => void;
  onRunChronoNow: (jobId: string) => Promise<void> | void;
  runningChronoJobId: string | null;
  currentTargetConfig: {
    targetType: ChatTargetType;
    bridgeId?: string;
    providerId?: string;
    endpointUrl: string;
    modelId: string;
  };
  connectionPanelNode: React.ReactNode;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

export function NotebookSidebarPanel({
  projects,
  activeProject,
  activeChatId,
  activeRailTab,
  onChangeRailTab,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onSelectChat,
  onCreateChat,
  onDeleteChat,
  onRunChronoNow,
  runningChronoJobId,
  currentTargetConfig,
  connectionPanelNode,
}: NotebookSidebarPanelProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjInstr, setNewProjInstr] = useState('');
  const [showEditInstructions, setShowEditInstructions] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');

  // Knowledge Base form state
  const [kbTitle, setKbTitle] = useState('');
  const [kbTags, setKbTags] = useState('');
  const [kbContent, setKbContent] = useState('');
  const [kbUploadMsg, setKbUploadMsg] = useState<string | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const kbFileInputRef = useRef<HTMLInputElement | null>(null);

  // Chrono-Job form state
  const [jobName, setJobName] = useState('');
  const [jobPrompt, setJobPrompt] = useState('');
  const [jobSchedule, setJobSchedule] = useState<ChronoScheduleType>('daily');
  const [jobIntervalMin, setJobIntervalMin] = useState<number>(30);
  const [jobTimeOfDay, setJobTimeOfDay] = useState<string>('09:00');
  const [jobDayOfWeek, setJobDayOfWeek] = useState<number>(1);
  const [jobRunAtLocal, setJobRunAtLocal] = useState<string>(() => {
    const d = new Date(Date.now() + 15 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [jobSaveToKb, setJobSaveToKb] = useState<boolean>(true);
  const [jobIncludeSources, setJobIncludeSources] = useState<boolean>(true);

  const searchHits = projectSearch.trim()
    ? searchProjectEverything(activeProject, projectSearch)
    : [];

  const handleSubmitNewProject = () => {
    const clean = newProjName.trim();
    if (!clean) return;
    onCreateProject(clean, newProjDesc.trim(), newProjInstr.trim());
    setNewProjName('');
    setNewProjDesc('');
    setNewProjInstr('');
    setShowNewProject(false);
  };

  const handleAddKnowledgeNote = () => {
    const title = kbTitle.trim();
    const content = kbContent.trim();
    if (!title || !content) return;
    const now = new Date().toISOString();
    const tags = kbTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    const doc: NotebookKnowledgeDoc = {
      id: createId('doc'),
      title,
      sourceType: 'note',
      tags,
      content,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    onUpdateProject((p) => ({
      ...p,
      knowledgeDocs: [doc, ...p.knowledgeDocs],
      updatedAt: now,
    }));
    setKbTitle('');
    setKbTags('');
    setKbContent('');
    setKbUploadMsg(`Wissenseintrag „${title}“ gespeichert.`);
  };

  const handleKnowledgeFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: NotebookKnowledgeDoc[] = [];
    const errors: string[] = [];
    const now = new Date().toISOString();

    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 2_000_000) {
        errors.push(`${file.name}: größer als 2 MB`);
        continue;
      }
      try {
        const text = await file.text();
        // Guard against binary files with null bytes
        if (text.includes('\u0000')) {
          errors.push(
            `${file.name}: Binärdatei (für Bilder bitte direkt den Bild-Anhang im Chat-Eingabefeld nutzen).`
          );
          continue;
        }
        const trimmed = text.trim();
        if (!trimmed) {
          errors.push(`${file.name}: Datei ist leer`);
          continue;
        }
        const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
        added.push({
          id: createId('doc'),
          title: file.name,
          sourceType: 'file',
          filename: file.name,
          mimeType: file.type || 'text/plain',
          tags: [ext, 'upload'],
          content: trimmed.slice(0, 180000),
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        errors.push(`${file.name}: Lesefehler`);
      }
    }

    if (added.length > 0) {
      onUpdateProject((p) => ({
        ...p,
        knowledgeDocs: [...added, ...p.knowledgeDocs],
        updatedAt: now,
      }));
    }
    const parts: string[] = [];
    if (added.length > 0) parts.push(`${added.length} Datei(en) in Wissensdatenbank aufgenommen.`);
    if (errors.length > 0) parts.push(`Hinweis: ${errors.join(' · ')}`);
    setKbUploadMsg(parts.join(' '));
    e.target.value = '';
  };

  const handleCreateChronoJob = () => {
    const name = jobName.trim();
    const prompt = jobPrompt.trim();
    if (!name || !prompt) return;
    const now = new Date();
    const draftJob: NotebookChronoJob = {
      id: createId('job'),
      name,
      prompt,
      scheduleType: jobSchedule,
      intervalMinutes: jobSchedule === 'interval_min' ? Math.max(1, jobIntervalMin) : undefined,
      timeOfDay: jobSchedule === 'daily' || jobSchedule === 'weekly' ? jobTimeOfDay : undefined,
      dayOfWeek: jobSchedule === 'weekly' ? jobDayOfWeek : undefined,
      runAtIso:
        jobSchedule === 'once' && jobRunAtLocal ? new Date(jobRunAtLocal).toISOString() : undefined,
      enabled: true,
      saveToKnowledge: jobSaveToKb,
      includeSources: jobIncludeSources,
      targetType: currentTargetConfig.targetType,
      bridgeId: currentTargetConfig.bridgeId,
      providerId: currentTargetConfig.providerId,
      endpointUrl: currentTargetConfig.endpointUrl,
      modelId: currentTargetConfig.modelId,
      lastRunAt: null,
      lastStatus: 'idle',
      lastError: null,
      lastSummary: null,
      nextRunAt: null,
      runCount: 0,
      createdAt: now.toISOString(),
    };
    draftJob.nextRunAt = computeNextRunAt(draftJob, now);
    onUpdateProject((p) => ({
      ...p,
      chronoJobs: [draftJob, ...p.chronoJobs],
      updatedAt: now.toISOString(),
    }));
    setJobName('');
    setJobPrompt('');
  };

  const handleExportMarkdown = () => {
    const md = exportProjectToMarkdown(activeProject);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeSlug = activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'notebook';
    a.download = `${safeSlug}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const activeKbCount = activeProject.knowledgeDocs.filter((d) => d.enabled).length;
  const activeChronoCount = activeProject.chronoJobs.filter((j) => j.enabled).length;

  return (
    <aside className="space-y-3 lg:col-span-4">
      {/* Compact Rail Switcher */}
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <div
          role="tablist"
          aria-label="Chat-Arbeitsbereich"
          className="grid grid-cols-4 gap-1"
        >
          {(
            [
              { id: 'connection', label: 'Ziel', icon: Settings2, count: null },
              { id: 'notebook', label: 'Projekte', icon: MessageSquare, count: activeProject.chats.length },
              { id: 'knowledge', label: 'Wissen', icon: BookOpen, count: activeKbCount },
              { id: 'chrono', label: 'Chrono', icon: Clock, count: activeChronoCount },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = activeRailTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChangeRailTab(t.id)}
                className={`flex flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-2 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-teal-700 bg-teal-50 text-teal-900'
                    : 'border-transparent bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.count !== null && (
                    <span className="font-mono text-[10px] font-semibold">{t.count}</span>
                  )}
                </span>
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: CONNECTION & GROK CAPABILITIES */}
      {activeRailTab === 'connection' && connectionPanelNode}

      {/* TAB 2: PROJECTS / NOTEBOOKS & CROSS-CHAT DISCOVERY */}
      {activeRailTab === 'notebook' && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Projekt / Notebook</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleExportMarkdown}
                title="Projekt als Markdown (.md) exportieren"
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                .md
              </button>
              <button
                type="button"
                onClick={() => setShowNewProject((v) => !v)}
                className="inline-flex items-center gap-1 rounded bg-teal-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-800"
              >
                <FolderPlus className="h-3 w-3" aria-hidden="true" />
                Neu
              </button>
            </div>
          </div>

          {showNewProject && (
            <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 text-xs">
              <label htmlFor="nb-new-name" className="block text-[11px] font-medium text-slate-700">
                Neues Projekt / Notebook anlegen
              </label>
              <input
                id="nb-new-name"
                type="text"
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
                placeholder="z. B. Recherche KI-Architektur"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <input
                type="text"
                value={newProjDesc}
                onChange={(e) => setNewProjDesc(e.target.value)}
                placeholder="Kurzbeschreibung (optional)"
                aria-label="Projekt-Beschreibung"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <textarea
                rows={2}
                value={newProjInstr}
                onChange={(e) => setNewProjInstr(e.target.value)}
                placeholder="Projektweite System-Anweisung (optional)"
                aria-label="Projektweite System-Anweisung"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowNewProject(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleSubmitNewProject}
                  disabled={!newProjName.trim()}
                  className="rounded bg-teal-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-800 disabled:opacity-45"
                >
                  Projekt erstellen
                </button>
              </div>
            </div>
          )}

          {/* Project Selector */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="nb-project-select" className="sr-only">
              Aktives Projekt wählen
            </label>
            <select
              id="nb-project-select"
              value={activeProject.id}
              onChange={(e) => onSelectProject(e.target.value)}
              className="flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:border-teal-700 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.chats.length} Chats · {p.knowledgeDocs.length} Wissen)
                </option>
              ))}
            </select>
            {projects.length > 1 && (
              <button
                type="button"
                aria-label={`Projekt ${activeProject.name} löschen`}
                onClick={() => onDeleteProject(activeProject.id)}
                className="rounded border border-slate-200 p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Cross-Chat & Knowledge Base Toggles */}
          <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px]">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-slate-700">
                <strong>Cross-Chat-Suche</strong> (Chats finden sich)
              </span>
              <input
                type="checkbox"
                checked={activeProject.crossChatMemoryEnabled}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    crossChatMemoryEnabled: e.target.checked,
                    updatedAt: new Date().toISOString(),
                  }))
                }
                className="h-3.5 w-3.5 accent-teal-700"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-slate-700">
                <strong>Wissensdatenbank</strong> im Prompt nutzen ({activeKbCount} aktiv)
              </span>
              <input
                type="checkbox"
                checked={activeProject.knowledgeBaseEnabled}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    knowledgeBaseEnabled: e.target.checked,
                    updatedAt: new Date().toISOString(),
                  }))
                }
                className="h-3.5 w-3.5 accent-teal-700"
              />
            </label>
            <button
              type="button"
              onClick={() => setShowEditInstructions((v) => !v)}
              className="mt-1 text-[11px] font-medium text-teal-700 hover:underline"
            >
              {showEditInstructions
                ? 'Projekt-Anweisung ausblenden'
                : 'Projekt-Anweisung bearbeiten'}
            </button>
            {showEditInstructions && (
              <textarea
                rows={3}
                value={activeProject.instructions}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    instructions: e.target.value,
                    updatedAt: new Date().toISOString(),
                  }))
                }
                aria-label="Projekt-Anweisung bearbeiten"
                className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            )}
          </div>

          {/* Instant Project-Wide Search across ALL chats & KB docs */}
          <div>
            <label htmlFor="nb-project-search" className="block text-[11px] font-medium text-slate-700">
              Alle Chats & Wissensdatenbank durchsuchen
            </label>
            <div className="relative mt-1">
              <Search
                className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="nb-project-search"
                type="text"
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                placeholder="Stichwort über alle Projekt-Chats & Wissen…"
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>
            {projectSearch.trim() && (
              <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                {searchHits.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Keine Treffer in diesem Projekt.</p>
                ) : (
                  searchHits.map((hit) => (
                    <button
                      key={`${hit.sourceType}-${hit.id}-${hit.messageId || ''}`}
                      type="button"
                      onClick={() => {
                        if (hit.sourceType === 'chat') {
                          onSelectChat(hit.id);
                        } else {
                          setExpandedDocId(hit.id);
                          onChangeRailTab('knowledge');
                        }
                      }}
                      className="block w-full rounded border border-slate-200 bg-white p-2 text-left hover:border-teal-600"
                    >
                      <div className="flex items-center justify-between gap-2 text-[10px]">
                        <span
                          className={`font-mono font-semibold ${
                            hit.sourceType === 'knowledge' ? 'text-teal-700' : 'text-slate-700'
                          }`}
                        >
                          {hit.sourceType === 'knowledge' ? 'WISSEN' : 'CHAT'}
                        </span>
                        <span className="truncate font-medium text-slate-900">{hit.title}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">{hit.snippet}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Chats List */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">
                Chats im Projekt ({activeProject.chats.length})
              </span>
              <button
                type="button"
                onClick={() => onCreateChat()}
                className="inline-flex items-center gap-1 rounded border border-teal-700 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-900 hover:bg-teal-100"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Neuer Chat
              </button>
            </div>

            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-0.5">
              {activeProject.chats.map((chat: NotebookChatThread) => {
                const isSelected = chat.id === activeChatId;
                return (
                  <li
                    key={chat.id}
                    className={`flex items-center justify-between gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                      isSelected
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectChat(chat.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-1.5 truncate font-medium">
                        {chat.pinned && (
                          <Pin className="h-3 w-3 shrink-0 text-teal-700" aria-hidden="true" />
                        )}
                        <span className="truncate">{chat.title}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                        {chat.messages.length} Nachr. · {chat.modelId || 'default'}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Chat ${chat.title} anheften`}
                        onClick={() =>
                          onUpdateProject((p) => ({
                            ...p,
                            chats: p.chats.map((c) =>
                              c.id === chat.id ? { ...c, pinned: !c.pinned } : c
                            ),
                          }))
                        }
                        className={`rounded p-1 ${
                          chat.pinned
                            ? 'text-teal-700 hover:bg-teal-100'
                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                        }`}
                      >
                        <Pin className="h-3 w-3" aria-hidden="true" />
                      </button>
                      {activeProject.chats.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Chat ${chat.title} löschen`}
                          onClick={() => onDeleteChat(chat.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* TAB 3: LOCAL KNOWLEDGE BASE (RAG) + FILE UPLOAD */}
      {activeRailTab === 'knowledge' && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Wissensdatenbank</h2>
              <p className="text-[11px] text-slate-500">
                Projekt: <strong className="text-slate-700">{activeProject.name}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => kbFileInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-teal-800"
            >
              <Upload className="h-3 w-3" aria-hidden="true" />
              Datei hochladen
            </button>
            <input
              ref={kbFileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.tsv,.py,.ts,.tsx,.js,.jsx,.html,.css,.xml,.yaml,.yml,.sql,.log,.ini,.env.example"
              onChange={(e) => void handleKnowledgeFileUpload(e)}
              className="hidden"
              aria-label="Dateien in Wissensdatenbank hochladen"
            />
          </div>

          {kbUploadMsg && (
            <p className="rounded border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-[11px] text-teal-900">
              {kbUploadMsg}
            </p>
          )}

          {/* Add Note Form */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-slate-800">
              Neue Wissensnotiz / Quelle hinzufügen
            </p>
            <input
              id="kb-doc-title"
              type="text"
              value={kbTitle}
              onChange={(e) => setKbTitle(e.target.value)}
              placeholder="Titel (z. B. API-Spezifikation, Meeting-Notiz)"
              aria-label="Wissensdokument Titel"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <input
              id="kb-doc-tags"
              type="text"
              value={kbTags}
              onChange={(e) => setKbTags(e.target.value)}
              placeholder="Tags kommagetrennt (z. B. architektur, fakten)"
              aria-label="Wissensdokument Tags"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <textarea
              id="kb-doc-content"
              rows={3}
              value={kbContent}
              onChange={(e) => setKbContent(e.target.value)}
              placeholder="Inhalt, Fakten, Code oder Markdown einfügen… Wird lokal chunked & automatisch zu passenden Fragen im Projekt gefunden."
              aria-label="Wissensdokument Inhalt"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddKnowledgeNote}
              disabled={!kbTitle.trim() || !kbContent.trim()}
              className="inline-flex w-full items-center justify-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-45"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              In Wissensdatenbank speichern
            </button>
          </div>

          {/* Knowledge Docs List */}
          <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
            {activeProject.knowledgeDocs.length === 0 ? (
              <p className="rounded border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-500">
                Noch keine Dokumente. Lade Text-/Code-Dateien hoch oder speichere Notizen &
                Chat-Antworten hier ab.
              </p>
            ) : (
              activeProject.knowledgeDocs.map((doc) => {
                const expanded = expandedDocId === doc.id;
                return (
                  <div
                    key={doc.id}
                    className={`rounded-md border p-2.5 text-xs ${
                      doc.enabled
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-200 bg-slate-50 opacity-65'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={doc.enabled}
                          onChange={(e) =>
                            onUpdateProject((p) => ({
                              ...p,
                              knowledgeDocs: p.knowledgeDocs.map((d) =>
                                d.id === doc.id ? { ...d, enabled: e.target.checked } : d
                              ),
                            }))
                          }
                          className="mt-0.5 h-3.5 w-3.5 accent-teal-700"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 font-medium text-slate-900">
                            <FileText className="h-3 w-3 shrink-0 text-teal-700" aria-hidden="true" />
                            <span className="truncate">{doc.title}</span>
                          </span>
                          <span className="mt-0.5 block font-mono text-[10px] text-slate-500">
                            {doc.content.length.toLocaleString('de-DE')} Zeichen
                            {doc.tags.length > 0 ? ` · ${doc.tags.join(', ')}` : ''}
                          </span>
                        </span>
                      </label>
                      <button
                        type="button"
                        aria-label={`Dokument ${doc.title} löschen`}
                        onClick={() =>
                          onUpdateProject((p) => ({
                            ...p,
                            knowledgeDocs: p.knowledgeDocs.filter((d) => d.id !== doc.id),
                          }))
                        }
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedDocId(expanded ? null : doc.id)}
                      className="mt-1 text-[10px] font-medium text-teal-700 hover:underline"
                    >
                      {expanded ? 'Vorschau schließen' : 'Inhalt anzeigen'}
                    </button>
                    {expanded && (
                      <pre className="mt-1.5 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 font-mono text-[10px] text-slate-800">
                        {doc.content.slice(0, 3000)}
                        {doc.content.length > 3000 ? '\n… (gekürzt in Vorschau)' : ''}
                      </pre>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}

      {/* TAB 4: CHRONO-JOBS / AUTOMATIONS */}
      {activeRailTab === 'chrono' && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Chrono-Jobs & Automatisierung</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Führt Prompts zeitgesteuert über das aktive Ziel aus (mit Projekt-Wissensdatenbank).
              ROT-Bridges werden nicht automatisch gestartet — laufen nur, wenn bereits aktiv.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <input
              id="chrono-job-name"
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              placeholder="Job-Name (z. B. Tägliches KI-Briefing)"
              aria-label="Chrono-Job Name"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <textarea
              id="chrono-job-prompt"
              rows={2}
              value={jobPrompt}
              onChange={(e) => setJobPrompt(e.target.value)}
              placeholder="Auszuführender Prompt (z. B. Prüfe aktuelle X/Web-News zu Thema X und fasse zusammen)…"
              aria-label="Chrono-Job Prompt"
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="chrono-schedule-type" className="block text-[10px] font-medium text-slate-600">
                  Zeitplan
                </label>
                <select
                  id="chrono-schedule-type"
                  value={jobSchedule}
                  onChange={(e) => setJobSchedule(e.target.value as ChronoScheduleType)}
                  className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                >
                  <option value="once">Einmalig</option>
                  <option value="interval_min">Alle X Minuten</option>
                  <option value="hourly">Stündlich</option>
                  <option value="daily">Täglich</option>
                  <option value="weekly">Wöchentlich</option>
                </select>
              </div>
              {jobSchedule === 'interval_min' && (
                <div>
                  <label htmlFor="chrono-interval-min" className="block text-[10px] font-medium text-slate-600">
                    Minuten
                  </label>
                  <input
                    id="chrono-interval-min"
                    type="number"
                    min={1}
                    max={1440}
                    value={jobIntervalMin}
                    onChange={(e) => setJobIntervalMin(Number(e.target.value) || 30)}
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                  />
                </div>
              )}
              {(jobSchedule === 'daily' || jobSchedule === 'weekly') && (
                <div>
                  <label htmlFor="chrono-time" className="block text-[10px] font-medium text-slate-600">
                    Uhrzeit
                  </label>
                  <input
                    id="chrono-time"
                    type="time"
                    value={jobTimeOfDay}
                    onChange={(e) => setJobTimeOfDay(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs"
                  />
                </div>
              )}
              {jobSchedule === 'once' && (
                <div>
                  <label htmlFor="chrono-run-at" className="block text-[10px] font-medium text-slate-600">
                    Zeitpunkt
                  </label>
                  <input
                    id="chrono-run-at"
                    type="datetime-local"
                    value={jobRunAtLocal}
                    onChange={(e) => setJobRunAtLocal(e.target.value)}
                    className="mt-0.5 w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-[11px]"
                  />
                </div>
              )}
            </div>
            {jobSchedule === 'weekly' && (
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((wd, idx) => (
                  <button
                    key={wd}
                    type="button"
                    onClick={() => setJobDayOfWeek(idx)}
                    className={`rounded border px-2 py-0.5 text-[11px] ${
                      jobDayOfWeek === idx
                        ? 'border-teal-700 bg-teal-50 font-semibold text-teal-900'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {wd}
                  </button>
                ))}
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={jobSaveToKb}
                onChange={(e) => setJobSaveToKb(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal-700"
              />
              Ergebnis automatisch in Wissensdatenbank speichern
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={jobIncludeSources}
                onChange={(e) => setJobIncludeSources(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal-700"
              />
              Web-Quellen anhängen (Grok <code className="font-mono">include_sources</code>)
            </label>
            <p className="font-mono text-[10px] text-slate-500">
              Ziel: {currentTargetConfig.targetType} · {currentTargetConfig.modelId || 'default'}
            </p>
            <button
              type="button"
              onClick={handleCreateChronoJob}
              disabled={!jobName.trim() || !jobPrompt.trim()}
              className="inline-flex w-full items-center justify-center gap-1 rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-45"
            >
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Chrono-Job anlegen
            </button>
          </div>

          {/* Chrono Jobs List */}
          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
            {activeProject.chronoJobs.length === 0 ? (
              <p className="rounded border border-dashed border-slate-200 p-3 text-center text-[11px] text-slate-500">
                Noch keine Chrono-Jobs angelegt.
              </p>
            ) : (
              activeProject.chronoJobs.map((job) => {
                const isRunning = runningChronoJobId === job.id || job.lastStatus === 'running';
                return (
                  <div
                    key={job.id}
                    className="rounded-md border border-slate-200 bg-white p-2.5 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{job.name}</p>
                        <p className="font-mono text-[10px] text-slate-500">
                          {job.scheduleType === 'interval_min'
                            ? `Alle ${job.intervalMinutes} Min.`
                            : job.scheduleType === 'daily'
                              ? `Täglich ${job.timeOfDay}`
                              : job.scheduleType === 'weekly'
                                ? `Wöchentlich ${WEEKDAYS[job.dayOfWeek ?? 1]} ${job.timeOfDay}`
                                : job.scheduleType === 'hourly'
                                  ? 'Stündlich'
                                  : 'Einmalig'}{' '}
                          · Läufe: {job.runCount}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 font-mono text-[10px] font-semibold ${
                          isRunning
                            ? 'text-teal-700'
                            : job.lastStatus === 'error'
                              ? 'text-red-700'
                              : job.enabled
                                ? 'text-emerald-700'
                                : 'text-slate-400'
                        }`}
                      >
                        {isRunning
                          ? 'LÄUFT…'
                          : job.lastStatus === 'error'
                            ? 'FEHLER'
                            : job.enabled
                              ? 'AKTIV'
                              : 'PAUSE'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">{job.prompt}</p>
                    {job.nextRunAt && job.enabled && (
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        Nächster Lauf:{' '}
                        {new Date(job.nextRunAt).toLocaleString('de-DE', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    )}
                    {job.lastError && (
                      <p className="mt-1 text-[10px] text-red-700">{job.lastError}</p>
                    )}
                    {job.lastSummary && !job.lastError && (
                      <p className="mt-1 line-clamp-2 text-[10px] text-emerald-800">
                        <Check className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
                        {job.lastSummary}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isRunning}
                        onClick={() => void onRunChronoNow(job.id)}
                        className="inline-flex items-center gap-1 rounded bg-teal-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                      >
                        {isRunning ? (
                          <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Play className="h-3 w-3" aria-hidden="true" />
                        )}
                        Jetzt ausführen
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateProject((p) => ({
                            ...p,
                            chronoJobs: p.chronoJobs.map((j) => {
                              if (j.id !== job.id) return j;
                              const nextEnabled = !j.enabled;
                              return {
                                ...j,
                                enabled: nextEnabled,
                                nextRunAt: nextEnabled
                                  ? computeNextRunAt({ ...j, enabled: true }, new Date())
                                  : null,
                              };
                            }),
                          }))
                        }
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-50"
                      >
                        {job.enabled ? (
                          <>
                            <Pause className="h-3 w-3" aria-hidden="true" />
                            Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3" aria-hidden="true" />
                            Aktivieren
                          </>
                        )}
                      </button>
                      {job.targetChatId && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectChat(job.targetChatId!);
                            onChangeRailTab('notebook');
                          }}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-teal-800 hover:bg-teal-50"
                        >
                          Chat öffnen
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Chrono-Job ${job.name} löschen`}
                        onClick={() =>
                          onUpdateProject((p) => ({
                            ...p,
                            chronoJobs: p.chronoJobs.filter((j) => j.id !== job.id),
                          }))
                        }
                        className="ml-auto rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
