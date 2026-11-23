import {
  AlertTriangle,
  BookOpen,
  BookmarkPlus,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code2,
  Copy,
  Cpu,
  Download,
  Eye,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  GitCompareArrows,
  History,
  Image as ImageIcon,
  Maximize2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Minimize2,
  Network,
  Paperclip,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  resolveDefaultChatModel,
  resolveVerifiedBridgeModelOptions,
  type ChatTargetType,
} from '../lib/chatEngine.ts';
import {
  applySearchReplacePatches,
  buildDiffModeInstruction,
  parseSearchReplaceBlocks,
  type FileCheckpoint,
} from '../lib/codingDiff.ts';
import {
  compileMemorySystemBlock,
  createDefaultMemoryStore,
  estimateContextTokenBudget,
  type CodingMemoryCategory,
  type CodingMemoryStore,
} from '../lib/codingMemory.ts';
import type { SandboxExecutionResult } from '../lib/codingSandboxRunner.ts';
import { createSseFrameParser } from '../lib/codingStream.ts';
import {
  buildCloudNotebookIpynb,
  buildCloudNotebookScript,
  buildFolderTreeSummary,
  CLOUD_NOTEBOOK_MODELS,
  CODING_TOOL_DEFINITIONS,
  extractCodeBlocksWithPaths,
  FREE_UNCENSORED_API_PRESETS,
  HF_SPACE_PRESETS,
  PROVIDER_WARNINGS,
  type CodingMainWay,
  type CodingRolePreset,
  type CodingToolEvent,
  type CodingToolId,
  type FreeUncensoredApiPreset,
  type ThinkingMode,
  type WorkspaceTreeNode,
} from '../lib/codingTypes.ts';
import {
  buildLocalImprovedPrompt,
  createDefaultWorkspace,
  createId,
  retrieveProjectContext,
  searchProjectEverything,
  type ChatAttachmentMeta,
  type NotebookChatMessage,
  type NotebookChatThread,
  type NotebookProject,
  type NotebooksWorkspace,
} from '../lib/notebookEngine.ts';
import {
  buildConnectionSnippets,
  isUsableGreenOrGelb,
} from '../lib/testEngine.ts';
import type {
  BridgeRuntimeState,
  BridgeSelectionEntry,
  ClassifiedProvider,
} from '../lib/types.ts';
import { ChatMarkdownMessage } from './ChatMarkdownMessage.tsx';
import { CodingCodeEditor, supportsLivePreview } from './CodingCodeEditor.tsx';
import {
  CodingConnectionSettings,
  type HfSpaceStatusRow,
  type HordeLiveModel,
} from './CodingConnectionSettings.tsx';
import { CodingDiffModal, type PendingDiffReview } from './CodingDiffModal.tsx';
import { CodingGadgetsPanel } from './CodingGadgetsPanel.tsx';
import { CodingSandboxRunnerPanel } from './CodingSandboxRunnerPanel.tsx';

interface VirtualCodeFile {
  path: string;
  content: string;
  language: string;
  source: 'server' | 'upload' | 'sandbox';
  writable: boolean;
  dirty?: boolean;
}

interface PendingUpload extends ChatAttachmentMeta {
  id: string;
  dataUrl?: string;
  textContent?: string;
}

interface CodingStudioViewProps {
  providers: ClassifiedProvider[];
  bridgeSelections: BridgeSelectionEntry[];
  bridgeRuntimes: BridgeRuntimeState[];
  executingBridgeId: string | null;
  onExecuteBridge: (bridgeId: string, confirmTosRisk: boolean) => Promise<void> | void;
  onStopBridge: (bridgeId: string) => Promise<void> | void;
  onProbeBridge: (bridgeId: string) => Promise<void> | void;
}

const CODING_ROLE_PROMPTS: Record<CodingRolePreset, { label: string; prompt: string }> = {
  architect: {
    label: 'Architekt & Umsetzung',
    prompt:
      'Du bist ein Senior-Software-Architekt. Plane präzise, nenne Trade-offs knapp und liefere direkt ausführbaren, typsicheren Code ohne Platzhalter.',
  },
  bugfix: {
    label: 'Bugfix & Diagnose',
    prompt:
      'Du bist ein Debugging-Spezialist. Identifiziere zuerst die konkrete Fehlerursache (Root Cause), prüfe Randfälle und liefere den minimal-invasiven Fix.',
  },
  refactor: {
    label: 'Refactoring & Performance',
    prompt:
      'Du bist ein Refactoring-Experte. Verbessere Lesbarkeit, Modularität und Laufzeitverhalten ohne Verhaltensbrüche. Begründe jede strukturelle Änderung knapp.',
  },
  tests: {
    label: 'Tests & Edge-Cases',
    prompt:
      'Du bist ein QA- und Test-Engineer. Entwickle aussagekräftige Unit- und Integrationstests inkl. Fehler-, Grenz- und Sicherheitsfällen.',
  },
  security: {
    label: 'Security-Review',
    prompt:
      'Du bist ein Security-Auditor. Prüfe Code strikt auf Injection, Path-Traversal, Auth-Lücken, Secret-Leaks und unsichere Defaults. Liefere gehärteten Code.',
  },
  free: {
    label: 'Freier Modus',
    prompt: '',
  },
};

const THINKING_PROMPTS: Record<ThinkingMode, string> = {
  off: '',
  standard:
    'Strukturiere komplexe Probleme vor der Code-Ausgabe in einem kurzen <think>...</think>-Block (Analyse, Annahmen, Plan), danach die prägnante Endantwort.',
  deep:
    'Führe vor der Endantwort eine gründliche, schrittweise Tiefenanalyse im <think>...</think>-Block durch (Hypothesen, Gegenprüfung, Randfälle, Architektur- und Sicherheitsrisiken). Liefere danach die geprüfte Lösung außerhalb des <think>-Blocks.',
};

const MAIN_CONNECTION_WAYS: ReadonlyArray<{
  id: CodingMainWay;
  shortLabel: string;
  subtitle: string;
}> = [
  { id: 'hf_space', shortLabel: '1. HF ZeroGPU Space', subtitle: 'Ohne Key · 30B Abliterated' },
  { id: 'ai_horde', shortLabel: '2. AI Horde', subtitle: 'Anonym · 37+ Uncensored' },
  { id: 'free_uncensored_api', shortLabel: '3. Uncensored APIs', subtitle: 'NoTrack · Airforce · OVH' },
  { id: 'cloud_tunnel', shortLabel: '4. Cloud-GPU Tunnel', subtitle: 'Kaggle 2×T4 / Colab Ollama' },
  { id: 'catalog_or_bridge', shortLabel: 'Weitere', subtitle: 'Katalog & Bridges' },
];

const QUICK_CODING_PROMPTS = [
  'Analysiere die aktive Datei und Ordnerstruktur: Wo liegen die wichtigsten Architektur- oder Fehlerquellen?',
  'Finde mögliche Bugs, Race-Conditions und Randfälle im angehefteten Code und liefere den korrigierten Codeblock.',
  'Schreibe vollständige Unit-Tests inkl. Rand- und Fehlerfällen für die geöffnete Datei.',
  'Führe ein knappes Security-Audit durch (Input-Validierung, Pfadsicherheit, Secrets, Fehlerbehandlung).',
];

function guessLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    sh: 'bash',
    ps1: 'powershell',
    sql: 'sql',
    rs: 'rust',
    go: 'go',
    java: 'java',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return map[ext] || 'text';
}

function buildTreeFromPaths(paths: Array<{ path: string; size: number; language: string }>): WorkspaceTreeNode[] {
  const root: WorkspaceTreeNode[] = [];
  const dirMap = new Map<string, WorkspaceTreeNode>();

  const ensureDir = (dirPath: string): WorkspaceTreeNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];
    const node: WorkspaceTreeNode = { name, path: dirPath, type: 'dir', children: [] };
    dirMap.set(dirPath, node);
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parent = ensureDir(parts.slice(0, -1).join('/'));
      parent.children!.push(node);
    }
    return node;
  };

  for (const item of paths) {
    const clean = item.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean) continue;
    const parts = clean.split('/');
    const fileNode: WorkspaceTreeNode = {
      name: parts[parts.length - 1],
      path: clean,
      type: 'file',
      size: item.size,
      language: item.language,
    };
    if (parts.length === 1) {
      root.push(fileNode);
    } else {
      const parent = ensureDir(parts.slice(0, -1).join('/'));
      parent.children!.push(fileNode);
    }
  }

  const sortNodes = (nodes: WorkspaceTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'de');
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };
  sortNodes(root);
  return root;
}

export function CodingStudioView({
  providers,
  bridgeSelections,
  bridgeRuntimes,
  executingBridgeId,
  onExecuteBridge,
  onStopBridge,
  onProbeBridge,
}: CodingStudioViewProps) {
  const allowlistedBridges = useMemo(
    () => bridgeSelections.filter((b) => b.bridge_id && b.docker_capable && b.port),
    [bridgeSelections]
  );

  const usableProviders = useMemo(() => {
    return providers
      .filter((p) => isUsableGreenOrGelb(p))
      .sort((a, b) => {
        const snA = buildConnectionSnippets(a);
        const snB = buildConnectionSnippets(b);
        const score = (p: ClassifiedProvider, sn: ReturnType<typeof buildConnectionSnippets>) => {
          if (!sn.supportsOpenAiEndpoints) return 50;
          if (p.auth_typ === 'keine' && p.securityClass === 'GRUEN') return 0;
          if (p.securityClass === 'GRUEN') return 10;
          if (p.isUnfiltered) return 15;
          return 25;
        };
        const diff = score(a, snA) - score(b, snB);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'de');
      });
  }, [providers]);

  const defaultProviderId = useMemo(() => {
    const preferred = ['ovh-ai-endpoints', 'pollinations', 'api-airforce', 'electronhub', 'openrouter'];
    for (const pid of preferred) {
      if (usableProviders.some((p) => p.id === pid)) return pid;
    }
    return usableProviders[0]?.id ?? '';
  }, [usableProviders]);

  const defaultBridgeId = useMemo(() => {
    const running = allowlistedBridges.find((b) =>
      bridgeRuntimes.some((rt) => rt.bridgeId === b.bridge_id && rt.status === 'running')
    );
    if (running?.bridge_id) return running.bridge_id;
    return (
      allowlistedBridges.find((b) => b.bridge_id === 'grok-com-to-openai')?.bridge_id ||
      allowlistedBridges[0]?.bridge_id ||
      ''
    );
  }, [allowlistedBridges, bridgeRuntimes]);

  // =========================================================================
  // Layout & Maximizable Chat Controls
  // =========================================================================
  const [chatMaximized, setChatMaximized] = useState<boolean>(false);
  const [showExplorerPanel, setShowExplorerPanel] = useState<boolean>(true);
  const [showRightDrawer, setShowRightDrawer] = useState<boolean>(true);
  const [rightTab, setRightTab] = useState<'connection' | 'tools' | 'notebooks' | 'gadgets'>('connection');
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Record<string, boolean>>({});
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});
  const [warningDetailsOpen, setWarningDetailsOpen] = useState<boolean>(false);

  // =========================================================================
  // Persistent Long-Term Memory ("Merkender Verlauf") & Local Browser Voice
  // =========================================================================
  const [memoryStore, setMemoryStore] = useState<CodingMemoryStore>(() => createDefaultMemoryStore());
  const [rememberedMsgId, setRememberedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [dictating, setDictating] = useState<boolean>(false);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);

  const speechSttSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );
  const speechTtsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const refreshCodingMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/coding/memory');
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; store?: CodingMemoryStore };
      if (json.ok && json.store) {
        setMemoryStore(json.store);
      }
    } catch {
      // ignore offline memory load error
    }
  }, []);

  useEffect(() => {
    void refreshCodingMemory();
  }, [refreshCodingMemory]);

  const handleSaveMemoryEntry = async (entry: {
    title: string;
    content: string;
    category: CodingMemoryCategory;
    source?: 'user' | 'assistant' | 'tool';
  }) => {
    const res = await fetch('/api/coding/memory/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; store?: CodingMemoryStore };
      if (json.ok && json.store) setMemoryStore(json.store);
    }
  };

  const handleUpdateMemoryStore = async (nextStore: CodingMemoryStore) => {
    setMemoryStore(nextStore);
    const res = await fetch('/api/coding/memory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextStore),
    });
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; store?: CodingMemoryStore };
      if (json.ok && json.store) setMemoryStore(json.store);
    }
  };

  const handleDeleteMemoryEntry = async (id: string) => {
    const res = await fetch(`/api/coding/memory/entry/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; store?: CodingMemoryStore };
      if (json.ok && json.store) setMemoryStore(json.store);
    }
  };

  const handleImportMemoryStore = async (raw: unknown): Promise<{ ok: boolean; error?: string }> => {
    const res = await fetch('/api/coding/memory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(raw),
    });
    const json = (await res.json()) as { ok?: boolean; store?: CodingMemoryStore; error?: string };
    if (res.ok && json.ok && json.store) {
      setMemoryStore(json.store);
      return { ok: true };
    }
    return { ok: false, error: json.error || 'Import fehlgeschlagen.' };
  };

  const handleRememberMessage = async (msg: NotebookChatMessage) => {
    const firstLine = msg.content.split('\n').find((l) => l.trim().length > 4)?.replace(/^#+\s*/, '').trim() || 'Chat-Notiz';
    await handleSaveMemoryEntry({
      title: firstLine.slice(0, 72),
      content: msg.content.slice(0, 1400),
      category: 'fact',
      source: 'assistant',
    });
    setRememberedMsgId(msg.id);
    setTimeout(() => setRememberedMsgId(null), 1600);
  };

  const handleToggleSpeakMessage = (msg: NotebookChatMessage) => {
    if (!speechTtsSupported) return;
    const synth = window.speechSynthesis;
    if (speakingMsgId === msg.id) {
      synth.cancel();
      setSpeakingMsgId(null);
      return;
    }
    synth.cancel();
    const plain = msg.content.replace(/```[\s\S]*?```/g, ' Codeblock. ').replace(/[#*_`]/g, ' ').slice(0, 2800);
    const utt = new SpeechSynthesisUtterance(plain);
    utt.lang = 'de-DE';
    utt.onend = () => setSpeakingMsgId(null);
    utt.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msg.id);
    synth.speak(utt);
  };

  const handleToggleDictation = () => {
    if (!speechSttSupported) return;
    if (dictating) {
      speechRecRef.current?.stop();
      setDictating(false);
      return;
    }
    const win = window as unknown as Record<string, unknown>;
    const Ctor = (win.SpeechRecognition || win.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          interimResults: boolean;
          continuous: boolean;
          onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
          onerror: (() => void) | null;
          onend: (() => void) | null;
          start: () => void;
          stop: () => void;
        })
      | undefined;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'de-DE';
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev) => {
      const chunks: string[] = [];
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i]?.[0]?.transcript;
        if (t) chunks.push(t.trim());
      }
      if (chunks.length > 0) {
        setPromptInput((prev) => `${prev ? `${prev.trimEnd()} ` : ''}${chunks.join(' ')}`);
      }
    };
    rec.onerror = () => setDictating(false);
    rec.onend = () => setDictating(false);
    speechRecRef.current = rec;
    setDictating(true);
    rec.start();
  };

  // =========================================================================
  // Persistent Projects / Notebooks & Knowledge Base (synced with /api/notebooks)
  // =========================================================================
  const [notebookWs, setNotebookWs] = useState<NotebooksWorkspace>(() => createDefaultWorkspace());
  const [nbLoaded, setNbLoaded] = useState<boolean>(false);
  const [activeChatId, setActiveChatId] = useState<string>('');
  const [nbSaveState, setNbSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [newProjectName, setNewProjectName] = useState<string>('');
  const [showNewProjectForm, setShowNewProjectForm] = useState<boolean>(false);
  const [newDocTitle, setNewDocTitle] = useState<string>('');
  const [newDocContent, setNewDocContent] = useState<string>('');
  const [showNewDocForm, setShowNewDocForm] = useState<boolean>(false);
  const [nbSearchQuery, setNbSearchQuery] = useState<string>('');
  const kbFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/notebooks');
        if (!res.ok) return;
        const json = (await res.json()) as { ok?: boolean; workspace?: NotebooksWorkspace };
        if (alive && json.ok && json.workspace && json.workspace.projects.length > 0) {
          setNotebookWs(json.workspace);
          const proj =
            json.workspace.projects.find((p) => p.id === json.workspace!.activeProjectId) ||
            json.workspace.projects[0];
          setActiveChatId(proj.chats[0]?.id || '');
        }
      } finally {
        if (alive) setNbLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persistNotebooks = useCallback(async (nextWs: NotebooksWorkspace) => {
    setNbSaveState('saving');
    try {
      const res = await fetch('/api/notebooks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: nextWs }),
      });
      setNbSaveState(res.ok ? 'saved' : 'error');
    } catch {
      setNbSaveState('error');
    }
  }, []);

  const updateNotebookWs = useCallback(
    (updater: (prev: NotebooksWorkspace) => NotebooksWorkspace) => {
      setNotebookWs((prev) => {
        const next = updater(prev);
        if (nbLoaded) void persistNotebooks(next);
        return next;
      });
    },
    [nbLoaded, persistNotebooks]
  );

  const activeProject: NotebookProject = useMemo(() => {
    return (
      notebookWs.projects.find((p) => p.id === notebookWs.activeProjectId) ||
      notebookWs.projects[0]
    );
  }, [notebookWs]);

  const activeChat: NotebookChatThread | undefined = useMemo(() => {
    if (!activeProject) return undefined;
    return activeProject.chats.find((c) => c.id === activeChatId) || activeProject.chats[0];
  }, [activeProject, activeChatId]);

  useEffect(() => {
    if (activeProject && (!activeChatId || !activeProject.chats.some((c) => c.id === activeChatId))) {
      setActiveChatId(activeProject.chats[0]?.id || '');
    }
  }, [activeProject, activeChatId]);

  // =========================================================================
  // Workspace File & Folder Structure + Editor State
  // =========================================================================
  const [workspaceMode, setWorkspaceMode] = useState<'none' | 'server' | 'uploaded'>('none');
  const [workspaceRootLabel, setWorkspaceRootLabel] = useState<string>('');
  const [serverSubDir, setServerSubDir] = useState<string>('');
  const [treeNodes, setTreeNodes] = useState<WorkspaceTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState<string>('');
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ src: true, 'coding-workspace': true });

  const [filesMap, setFilesMap] = useState<Record<string, VirtualCodeFile>>({});
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [pinnedFilePaths, setPinnedFilePaths] = useState<string[]>([]);
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [fileStatusMsg, setFileStatusMsg] = useState<string | null>(null);
  const [showNewFileInput, setShowNewFileInput] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('coding-workspace/app.ts');

  // Stage 1: Diff-Mode, Diff-Review Modal, Checkpoints, Live-Preview, Sandbox Runner & Live Stream
  const [diffModeEnabled, setDiffModeEnabled] = useState<boolean>(false);
  const [pendingDiffReview, setPendingDiffReview] = useState<PendingDiffReview | null>(null);
  const [applyingDiff, setApplyingDiff] = useState<boolean>(false);
  const [checkpoints, setCheckpoints] = useState<FileCheckpoint[]>([]);
  const [editorPreviewMode, setEditorPreviewMode] = useState<boolean>(false);
  const [showSandboxRunner, setShowSandboxRunner] = useState<boolean>(false);
  const [liveStream, setLiveStream] = useState<{
    status: string;
    content: string;
    thinking: string;
    toolEvents: CodingToolEvent[];
  } | null>(null);

  const folderUploadRef = useRef<HTMLInputElement | null>(null);
  const multiFileUploadRef = useRef<HTMLInputElement | null>(null);
  const chatAttachmentRef = useRef<HTMLInputElement | null>(null);

  const activeFile = activeFilePath ? filesMap[activeFilePath] ?? null : null;

  const sandboxFilePaths = useMemo(() => {
    const found = new Set<string>();
    const walk = (nodes: WorkspaceTreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file' && n.path.startsWith('coding-workspace/')) {
          found.add(n.path);
        } else if (n.type === 'dir' && n.children) {
          walk(n.children);
        }
      }
    };
    walk(treeNodes);
    for (const p of Object.keys(filesMap)) {
      if (p.startsWith('coding-workspace/')) found.add(p);
    }
    return Array.from(found).sort((a, b) => a.localeCompare(b, 'de'));
  }, [treeNodes, filesMap]);

  const activeFileCheckpoints = useMemo(
    () => (activeFile ? checkpoints.filter((cp) => cp.path === activeFile.path) : []),
    [checkpoints, activeFile]
  );

  // Reset preview toggle when switching to a non-previewable file
  useEffect(() => {
    if (!activeFile || !supportsLivePreview(activeFile.path, activeFile.language)) {
      setEditorPreviewMode(false);
    }
  }, [activeFile?.path, activeFile?.language]);

  const loadServerWorkspace = useCallback(async (subDir = '') => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const qs = subDir ? `?dir=${encodeURIComponent(subDir)}` : '';
      const res = await fetch(`/api/coding/workspace/tree${qs}`);
      const json = (await res.json()) as {
        ok: boolean;
        rootName?: string;
        tree?: WorkspaceTreeNode[];
        error?: string;
      };
      if (!res.ok || !json.ok || !json.tree) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setTreeNodes(json.tree);
      setWorkspaceMode('server');
      setServerSubDir(subDir);
      setWorkspaceRootLabel(subDir ? `${json.rootName} (${subDir})` : json.rootName || 'Projektordner');
      setShowExplorerPanel(true);
    } catch (err: unknown) {
      setTreeError(err instanceof Error ? err.message : 'Ordnerstruktur konnte nicht geladen werden.');
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // Automatically load the local project workspace once on mount so the real folder tree
  // and coding-workspace/ sandbox are immediately visible and available as chat context.
  const initialWorkspaceLoadedRef = useRef(false);
  useEffect(() => {
    if (initialWorkspaceLoadedRef.current) return;
    initialWorkspaceLoadedRef.current = true;
    void loadServerWorkspace('');
  }, [loadServerWorkspace]);

  const openWorkspaceFile = useCallback(
    async (relPath: string) => {
      setActiveFilePath(relPath);
      setFileStatusMsg(null);
      if (filesMap[relPath]) return;
      if (workspaceMode !== 'server') return;
      setFileLoading(true);
      try {
        const res = await fetch(`/api/coding/workspace/file?path=${encodeURIComponent(relPath)}`);
        const json = (await res.json()) as {
          ok: boolean;
          path?: string;
          content?: string;
          language?: string;
          writable?: boolean;
          error?: string;
        };
        if (!res.ok || !json.ok || typeof json.content !== 'string') {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        setFilesMap((prev) => ({
          ...prev,
          [relPath]: {
            path: json.path || relPath,
            content: json.content!,
            language: json.language || guessLanguage(relPath),
            source: 'server',
            writable: Boolean(json.writable),
            dirty: false,
          },
        }));
      } catch (err: unknown) {
        setFileStatusMsg(err instanceof Error ? err.message : 'Datei konnte nicht geladen werden.');
      } finally {
        setFileLoading(false);
      }
    },
    [filesMap, workspaceMode]
  );

  const handleUploadFolder = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    const nextFiles: Record<string, VirtualCodeFile> = {};
    const treeInput: Array<{ path: string; size: number; language: string }> = [];
    const maxFiles = 150;
    let firstRoot = '';

    for (const file of fileList.slice(0, maxFiles)) {
      const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
      if (
        /(^|\/)(node_modules|\.git|dist|\.next|__pycache__|\.venv)(\/|$)/i.test(rel) ||
        /(^|\/)\.env(\.|$)/i.test(rel)
      ) {
        continue;
      }
      if (!firstRoot && rel.includes('/')) firstRoot = rel.split('/')[0];
      if (file.size > 256 * 1024) continue;
      if (file.type && file.type.startsWith('image/')) continue;
      try {
        const txt = await file.text();
        if (txt.includes('\0')) continue;
        const lang = guessLanguage(rel);
        nextFiles[rel] = {
          path: rel,
          content: txt,
          language: lang,
          source: 'upload',
          writable: true,
          dirty: false,
        };
        treeInput.push({ path: rel, size: file.size, language: lang });
      } catch {
        // skip unreadable file
      }
    }

    if (treeInput.length === 0) {
      setTreeError('Keine lesbaren Text-/Code-Dateien im Ordner gefunden (max. 256 KB je Datei).');
      return;
    }

    setFilesMap(nextFiles);
    setTreeNodes(buildTreeFromPaths(treeInput));
    setWorkspaceMode('uploaded');
    setWorkspaceRootLabel(firstRoot ? `Ordner: ${firstRoot}` : `Hochgeladen (${treeInput.length})`);
    setExpandedDirs(firstRoot ? { [firstRoot]: true } : {});
    setActiveFilePath(treeInput[0].path);
    setPinnedFilePaths([treeInput[0].path]);
    setShowExplorerPanel(true);
    setTreeError(null);
  };

  const handleUploadCodeFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (fileList.length === 0) return;

    const added: Record<string, VirtualCodeFile> = {};
    let firstPath: string | null = null;
    for (const file of fileList.slice(0, 30)) {
      if (file.size > 256 * 1024) continue;
      const txt = await file.text();
      if (txt.includes('\0')) continue;
      const cleanName = file.name.replace(/\\/g, '/');
      added[cleanName] = {
        path: cleanName,
        content: txt,
        language: guessLanguage(cleanName),
        source: 'upload',
        writable: true,
        dirty: false,
      };
      if (!firstPath) firstPath = cleanName;
    }

    if (!firstPath) return;
    setFilesMap((prev) => {
      const merged = { ...prev, ...added };
      if (workspaceMode !== 'server') {
        const list = Object.values(merged).map((f) => ({
          path: f.path,
          size: f.content.length,
          language: f.language,
        }));
        setTreeNodes(buildTreeFromPaths(list));
        setWorkspaceMode('uploaded');
        setWorkspaceRootLabel(`Dateien (${list.length})`);
      }
      return merged;
    });
    setActiveFilePath(firstPath);
    setPinnedFilePaths((prev) => (prev.includes(firstPath!) ? prev : [...prev, firstPath!]));
    setShowExplorerPanel(true);
  };

  const handleCreateNewFile = async () => {
    const clean = newFileName.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean) return;

    // If path starts with coding-workspace/ or workspace is in server mode, persist in local coding-workspace/
    const shouldSaveToSandbox = workspaceMode === 'server' || clean.startsWith('coding-workspace/');
    const targetPath = shouldSaveToSandbox
      ? clean.startsWith('coding-workspace/')
        ? clean
        : `coding-workspace/${clean}`
      : clean;

    if (shouldSaveToSandbox) {
      try {
        const res = await fetch('/api/coding/workspace/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath, content: '' }),
        });
        const json = (await res.json()) as { ok: boolean; path?: string; error?: string };
        if (!res.ok || !json.ok) {
          setFileStatusMsg(json.error || 'Datei konnte nicht erstellt werden.');
          return;
        }
        const finalPath = json.path || targetPath;
        setFilesMap((prev) => ({
          ...prev,
          [finalPath]: {
            path: finalPath,
            content: '',
            language: guessLanguage(finalPath),
            source: 'sandbox',
            writable: true,
            dirty: false,
          },
        }));
        setActiveFilePath(finalPath);
        setPinnedFilePaths((prev) => (prev.includes(finalPath) ? prev : [...prev, finalPath]));
        setShowNewFileInput(false);
        setFileStatusMsg(`Erstellt: ${finalPath}`);
        void loadServerWorkspace(serverSubDir);
      } catch {
        setFileStatusMsg('Fehler beim Anlegen der Datei.');
      }
      return;
    }

    setFilesMap((prev) => {
      const merged: Record<string, VirtualCodeFile> = {
        ...prev,
        [targetPath]: {
          path: targetPath,
          content: '',
          language: guessLanguage(targetPath),
          source: 'upload',
          writable: true,
          dirty: false,
        },
      };
      const list = Object.values(merged).map((f) => ({
        path: f.path,
        size: f.content.length,
        language: f.language,
      }));
      setTreeNodes(buildTreeFromPaths(list));
      setWorkspaceMode('uploaded');
      setWorkspaceRootLabel(`Dateien (${list.length})`);
      return merged;
    });
    setActiveFilePath(targetPath);
    setPinnedFilePaths((prev) => (prev.includes(targetPath) ? prev : [...prev, targetPath]));
    setShowNewFileInput(false);
  };

  const writeFileToLocalSandbox = useCallback(
    async (rawPath: string, content: string, language?: string): Promise<string | null> => {
      const clean = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const targetPath = clean.startsWith('coding-workspace/')
        ? clean
        : `coding-workspace/${clean || 'generated.txt'}`;
      try {
        const res = await fetch('/api/coding/workspace/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath, content }),
        });
        const json = (await res.json()) as { ok: boolean; path?: string; error?: string };
        if (!res.ok || !json.ok) {
          setFileStatusMsg(json.error || `Speichern fehlgeschlagen (${targetPath}).`);
          return null;
        }
        const savedPath = json.path || targetPath;
        setFilesMap((prev) => ({
          ...prev,
          [savedPath]: {
            path: savedPath,
            content,
            language: language || guessLanguage(savedPath),
            source: 'sandbox',
            writable: true,
            dirty: false,
          },
        }));
        return savedPath;
      } catch {
        setFileStatusMsg('Netzwerkfehler beim Schreiben in coding-workspace/.');
        return null;
      }
    },
    []
  );

  const readExistingSandboxContent = useCallback(
    async (
      targetPath: string,
      bypassCache = false
    ): Promise<{ exists: boolean; content: string; language: string }> => {
      if (!bypassCache) {
        const cached = filesMap[targetPath];
        if (cached) {
          return { exists: true, content: cached.content, language: cached.language };
        }
      }
      try {
        const res = await fetch(`/api/coding/workspace/file?path=${encodeURIComponent(targetPath)}`);
        if (res.ok) {
          const json = (await res.json()) as { ok: boolean; content?: string; language?: string };
          if (json.ok && typeof json.content === 'string') {
            return {
              exists: true,
              content: json.content,
              language: json.language || guessLanguage(targetPath),
            };
          }
        }
      } catch {
        // file does not exist yet
      }
      return { exists: false, content: '', language: guessLanguage(targetPath) };
    },
    [filesMap]
  );

  const recordFileCheckpoint = useCallback(
    (filePath: string, previousContent: string, language: string, reason: string) => {
      setCheckpoints((prev) => [
        {
          id: createId('cp'),
          path: filePath,
          previousContent,
          language,
          createdAt: new Date().toLocaleTimeString('de-DE'),
          reason,
        },
        ...prev.slice(0, 29),
      ]);
    },
    []
  );

  const handleRollbackCheckpoint = async (filePath: string) => {
    const idx = checkpoints.findIndex((cp) => cp.path === filePath);
    if (idx === -1) return;
    const cp = checkpoints[idx];
    const savedPath = await writeFileToLocalSandbox(cp.path, cp.previousContent, cp.language);
    if (!savedPath) return;
    setCheckpoints((prev) => prev.filter((_, i) => i !== idx));
    setActiveFilePath(savedPath);
    setFileStatusMsg(`Checkpoint (${cp.createdAt}) wiederhergestellt: ${savedPath}`);
    void loadServerWorkspace(serverSubDir);
  };

  const handleSaveActiveFile = async () => {
    if (!activeFile) return;
    const targetPath = activeFile.path.startsWith('coding-workspace/')
      ? activeFile.path
      : `coding-workspace/${activeFile.path.split('/').pop() || 'snippet.txt'}`;
    const prevDisk = await readExistingSandboxContent(targetPath, true);
    if (prevDisk.exists && prevDisk.content !== activeFile.content) {
      recordFileCheckpoint(targetPath, prevDisk.content, prevDisk.language, 'Editor-Speichern');
    }
    const savedPath = await writeFileToLocalSandbox(targetPath, activeFile.content, activeFile.language);
    if (!savedPath) return;
    setActiveFilePath(savedPath);
    setExpandedDirs((prev) => ({ ...prev, 'coding-workspace': true }));
    setFileStatusMsg(
      savedPath !== activeFile.path
        ? `Sicher als Datei in ${savedPath} gespeichert.`
        : `Gespeichert: ${savedPath}`
    );
    void loadServerWorkspace(serverSubDir);
  };

  const handleDownloadActiveFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.path.split('/').pop() || 'code.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resolveCodeTargetPath = (language: string, suggestedPath?: string): string => {
    const extMap: Record<string, string> = {
      typescript: 'ts',
      ts: 'ts',
      tsx: 'tsx',
      javascript: 'js',
      js: 'js',
      python: 'py',
      py: 'py',
      csharp: 'cs',
      'c#': 'cs',
      kotlin: 'kt',
      json: 'json',
      html: 'html',
      css: 'css',
      bash: 'sh',
      sh: 'sh',
      sql: 'sql',
      markdown: 'md',
      md: 'md',
    };
    const ext = extMap[language.toLowerCase()] || 'txt';
    if (suggestedPath && suggestedPath.trim()) return suggestedPath.trim();
    if (activeFile && activeFile.path.startsWith('coding-workspace/')) return activeFile.path;
    return `coding-workspace/generated.${ext}`;
  };

  const handlePreviewDiff = async (
    code: string,
    language: string,
    suggestedPath?: string,
    isPatch = false
  ) => {
    const hunks = isPatch ? parseSearchReplaceBlocks(code) : [];
    const patchHintPath = hunks.find((h) => h.targetPath)?.targetPath;
    const targetPath = resolveCodeTargetPath(language, suggestedPath || patchHintPath);
    const existing = await readExistingSandboxContent(targetPath);

    if (isPatch && hunks.length > 0) {
      const applied = applySearchReplacePatches(existing.content, hunks);
      setPendingDiffReview({
        targetPath,
        language: existing.language || guessLanguage(targetPath),
        oldContent: existing.content,
        newContent: applied.appliedCount > 0 ? applied.content : existing.content,
        mode: 'patch',
        appliedHunks: applied.appliedCount,
        totalHunks: hunks.length,
        warning: applied.error,
      });
      return;
    }

    setPendingDiffReview({
      targetPath,
      language: language || existing.language || guessLanguage(targetPath),
      oldContent: existing.content,
      newContent: code,
      mode: existing.exists ? 'overwrite' : 'create',
    });
  };

  const handleConfirmPendingDiff = async () => {
    if (!pendingDiffReview || applyingDiff) return;
    setApplyingDiff(true);
    try {
      if (pendingDiffReview.oldContent !== pendingDiffReview.newContent) {
        recordFileCheckpoint(
          pendingDiffReview.targetPath,
          pendingDiffReview.oldContent,
          pendingDiffReview.language,
          pendingDiffReview.mode === 'patch' ? 'SEARCH/REPLACE-Patch' : 'Diff-Übernahme'
        );
      }
      const savedPath = await writeFileToLocalSandbox(
        pendingDiffReview.targetPath,
        pendingDiffReview.newContent,
        pendingDiffReview.language
      );
      if (savedPath) {
        setActiveFilePath(savedPath);
        setPinnedFilePaths((prev) => (prev.includes(savedPath) ? prev : [...prev, savedPath]));
        setExpandedDirs((prev) => ({ ...prev, 'coding-workspace': true }));
        setShowExplorerPanel(true);
        setFileStatusMsg(`Diff übernommen (Checkpoint angelegt): ${savedPath}`);
        void loadServerWorkspace(serverSubDir);
      }
      setPendingDiffReview(null);
    } finally {
      setApplyingDiff(false);
    }
  };

  const handleApplyCodeBlock = async (code: string, language: string, suggestedPath?: string) => {
    const targetPath = resolveCodeTargetPath(language, suggestedPath);
    const existing = await readExistingSandboxContent(targetPath);
    if (existing.exists && existing.content !== code) {
      recordFileCheckpoint(targetPath, existing.content, existing.language, 'Codeblock gespeichert');
    }

    const savedPath = await writeFileToLocalSandbox(targetPath, code, language || guessLanguage(targetPath));
    if (!savedPath) return;
    setActiveFilePath(savedPath);
    setPinnedFilePaths((prev) => (prev.includes(savedPath) ? prev : [...prev, savedPath]));
    setExpandedDirs((prev) => ({ ...prev, 'coding-workspace': true }));
    setShowExplorerPanel(true);
    setFileStatusMsg(`Lokal angelegt & gespeichert: ${savedPath}`);
    void loadServerWorkspace(serverSubDir);
  };

  const [savedFilesMsgId, setSavedFilesMsgId] = useState<string | null>(null);
  const handleSaveAllCodeBlocks = async (msg: NotebookChatMessage) => {
    const blocks = extractCodeBlocksWithPaths(msg.content);
    if (blocks.length === 0) return;
    const createdPaths: string[] = [];
    for (const blk of blocks) {
      const savedPath = await writeFileToLocalSandbox(blk.path, blk.code, blk.language);
      if (savedPath) createdPaths.push(savedPath);
    }
    if (createdPaths.length > 0) {
      setActiveFilePath(createdPaths[0]);
      setPinnedFilePaths((prev) => {
        const next = new Set(prev);
        createdPaths.forEach((p) => next.add(p));
        return Array.from(next);
      });
      setExpandedDirs((prev) => ({ ...prev, 'coding-workspace': true }));
      setShowExplorerPanel(true);
      setSavedFilesMsgId(msg.id);
      setTimeout(() => setSavedFilesMsgId((cur) => (cur === msg.id ? null : cur)), 2500);
      setFileStatusMsg(`${createdPaths.length} Datei(en) in coding-workspace/ angelegt.`);
      void loadServerWorkspace(serverSubDir);
    }
  };

  const togglePinFile = async (relPath: string) => {
    if (pinnedFilePaths.includes(relPath)) {
      setPinnedFilePaths((prev) => prev.filter((p) => p !== relPath));
      return;
    }
    if (!filesMap[relPath] && workspaceMode === 'server') {
      await openWorkspaceFile(relPath);
    }
    setPinnedFilePaths((prev) => (prev.includes(relPath) ? prev : [...prev, relPath]));
  };

  // =========================================================================
  // 4 Primary Connection Ways + Per-Provider Warnings & Settings
  // =========================================================================
  const [activeWay, setActiveWay] = useState<CodingMainWay>('hf_space');
  const [warningConfirmed, setWarningConfirmed] = useState<Record<CodingMainWay, boolean>>({
    hf_space: false,
    ai_horde: false,
    free_uncensored_api: false,
    cloud_tunnel: false,
    catalog_or_bridge: true,
  });

  // Weg 1: Hugging Face ZeroGPU Spaces
  const [hfSpaceId, setHfSpaceId] = useState<string>(HF_SPACE_PRESETS[0].id);
  const [hfToken, setHfToken] = useState<string>('');
  const [gpuDuration, setGpuDuration] = useState<number>(60);
  const [useDflash, setUseDflash] = useState<boolean>(true);
  const [hfStatuses, setHfStatuses] = useState<Record<string, HfSpaceStatusRow>>({});
  const [hfStatusLoading, setHfStatusLoading] = useState<boolean>(false);

  // Weg 2: AI Horde
  const [hordeModel, setHordeModel] = useState<string>('koboldcpp/gemma-4-31B-it-heretic');
  const [hordeApiKey, setHordeApiKey] = useState<string>('');
  const [hordeModels, setHordeModels] = useState<HordeLiveModel[]>([]);
  const [hordeLoading, setHordeLoading] = useState<boolean>(false);
  const [hordeNote, setHordeNote] = useState<string | null>(null);
  const [hordeMaxLength, setHordeMaxLength] = useState<number>(512);
  const [hordeMaxContextLength, setHordeMaxContextLength] = useState<number>(4096);
  const [hordeRepPen, setHordeRepPen] = useState<number>(1.08);
  const [hordeTrustedWorkers, setHordeTrustedWorkers] = useState<boolean>(false);
  const [hordeSlowWorkers, setHordeSlowWorkers] = useState<boolean>(true);
  const [hordeAllowDowngrade, setHordeAllowDowngrade] = useState<boolean>(true);

  // Weg 3: Free Uncensored OpenAI-APIs
  const [freeApiPresetId, setFreeApiPresetId] = useState<FreeUncensoredApiPreset['id']>('ovh-ai-endpoints');
  const [freeApiKey, setFreeApiKey] = useState<string>('');
  const [freeApiModel, setFreeApiModel] = useState<string>('gpt-oss-20b');
  const [freeApiLiveModels, setFreeApiLiveModels] = useState<string[]>([]);
  const [freeApiLoading, setFreeApiLoading] = useState<boolean>(false);
  const [freeApiNote, setFreeApiNote] = useState<string | null>(null);
  const [presencePenalty, setPresencePenalty] = useState<number>(0);
  const [frequencyPenalty, setFrequencyPenalty] = useState<number>(0);
  const [seedValue, setSeedValue] = useState<string>('');

  // Weg 4: Cloud-GPU Notebook Tunnel
  const [cloudPlatform, setCloudPlatform] = useState<'kaggle' | 'colab'>('kaggle');
  const [cloudScriptModel, setCloudScriptModel] = useState<string>(CLOUD_NOTEBOOK_MODELS[0].id);
  const [tunnelUrl, setTunnelUrl] = useState<string>('');
  const [tunnelModel, setTunnelModel] = useState<string>(CLOUD_NOTEBOOK_MODELS[0].id);
  const [tunnelToken, setTunnelToken] = useState<string>('');
  const [tunnelNumCtx, setTunnelNumCtx] = useState<number>(16384);
  const [tunnelModels, setTunnelModels] = useState<string[]>([]);
  const [tunnelLoading, setTunnelLoading] = useState<boolean>(false);
  const [tunnelNote, setTunnelNote] = useState<string | null>(null);

  // Weg 5 Fallback: Catalog / Local Bridges / LiteLLM
  const [targetType, setTargetType] = useState<ChatTargetType>('provider');
  const [selectedBridgeId, setSelectedBridgeId] = useState<string>(defaultBridgeId);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(defaultProviderId);
  const [providerSearch, setProviderSearch] = useState<string>('');
  const [onlyUnfiltered, setOnlyUnfiltered] = useState<boolean>(false);
  const [sortUnfilteredFirst, setSortUnfilteredFirst] = useState<boolean>(false);
  const [endpointUrl, setEndpointUrl] = useState<string>(() => {
    const p = usableProviders.find((x) => x.id === defaultProviderId);
    return p ? buildConnectionSnippets(p).defaultApiBase : 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';
  });
  const [modelId, setModelId] = useState<string>(() => resolveDefaultChatModel(defaultProviderId));
  const [apiKey, setApiKey] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [bridgeTosConfirm, setBridgeTosConfirm] = useState<boolean>(false);

  // Shared Generation + Workspace Tools + Thinking knobs
  const [enabledTools, setEnabledTools] = useState<CodingToolId[]>(() =>
    CODING_TOOL_DEFINITIONS.map((t) => t.id)
  );
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>('standard');
  const [codingRole, setCodingRole] = useState<CodingRolePreset>('architect');
  const [autoInjectTree, setAutoInjectTree] = useState<boolean>(true);
  const [autoInjectActiveFile, setAutoInjectActiveFile] = useState<boolean>(true);
  const [temperature, setTemperature] = useState<number>(0.25);
  const [maxTokens, setMaxTokens] = useState<number>(4096);
  const [topP, setTopP] = useState<number>(0.95);
  const [topK, setTopK] = useState<number>(40);
  const [repetitionPenalty, setRepetitionPenalty] = useState<number>(1.05);
  const [customSystemPrompt, setCustomSystemPrompt] = useState<string>('');

  // Chat composer & attachments
  const [promptInput, setPromptInput] = useState<string>('');
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState<boolean>(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [savedKbMsgId, setSavedKbMsgId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const handleRefreshHfStatus = useCallback(async () => {
    setHfStatusLoading(true);
    try {
      const res = await fetch('/api/coding/providers/hf/status');
      const json = (await res.json()) as { ok?: boolean; spaces?: HfSpaceStatusRow[] };
      if (json.ok && Array.isArray(json.spaces)) {
        const next: Record<string, HfSpaceStatusRow> = {};
        for (const row of json.spaces) next[row.id] = row;
        setHfStatuses(next);
      }
    } catch {
      // keep existing status
    } finally {
      setHfStatusLoading(false);
    }
  }, []);

  const handleLoadHordeModels = useCallback(async () => {
    setHordeLoading(true);
    setHordeNote(null);
    try {
      const res = await fetch('/api/coding/providers/horde/models');
      const json = (await res.json()) as { ok?: boolean; models?: HordeLiveModel[]; error?: string };
      if (json.ok && Array.isArray(json.models)) {
        setHordeModels(json.models);
        setHordeNote(`${json.models.length} aktive Community-Modelle live geladen.`);
        if (json.models.length > 0 && !json.models.some((m) => m.name === hordeModel)) {
          setHordeModel(json.models[0].name);
        }
      } else {
        setHordeNote(json.error || 'AI Horde Modellliste konnte nicht geladen werden.');
      }
    } catch {
      setHordeNote('Verbindungsfehler zu AI Horde.');
    } finally {
      setHordeLoading(false);
    }
  }, [hordeModel]);

  const handleSelectFreeApiPreset = (id: FreeUncensoredApiPreset['id']) => {
    setFreeApiPresetId(id);
    const preset = FREE_UNCENSORED_API_PRESETS.find((p) => p.id === id);
    if (preset) {
      setFreeApiModel(preset.defaultModel);
      setFreeApiLiveModels([]);
      setFreeApiNote(null);
    }
  };

  const handleLoadFreeApiModels = async () => {
    setFreeApiLoading(true);
    setFreeApiNote(null);
    try {
      const res = await fetch('/api/coding/providers/free-api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          presetId: freeApiPresetId,
          apiKey: freeApiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; models?: string[]; error?: string };
      if (Array.isArray(json.models) && json.models.length > 0) {
        setFreeApiLiveModels(json.models);
        if (!json.models.includes(freeApiModel)) setFreeApiModel(json.models[0]);
      }
      setFreeApiNote(
        json.ok
          ? `${json.models?.length ?? 0} Modelle live geladen.`
          : json.error || 'Abruf fehlgeschlagen.'
      );
    } catch {
      setFreeApiNote('Netzwerkfehler beim Modell-Abruf.');
    } finally {
      setFreeApiLoading(false);
    }
  };

  const handleTestTunnelModels = async () => {
    setTunnelLoading(true);
    setTunnelNote(null);
    try {
      const res = await fetch('/api/coding/providers/tunnel/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tunnelUrl: tunnelUrl.trim(),
          apiKey: tunnelToken.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; models?: string[]; error?: string };
      if (json.ok) {
        const list = json.models || [];
        setTunnelModels(list);
        if (list.length > 0) setTunnelModel(list[0]);
        setTunnelNote(
          list.length > 0
            ? `Tunnel aktiv · ${list.length} Modell(e) gefunden.`
            : 'Tunnel erreichbar (noch kein Modell gepullt).'
        );
      } else {
        setTunnelNote(json.error || 'Tunnel-Prüfung fehlgeschlagen.');
      }
    } catch {
      setTunnelNote('Verbindungsfehler zum Tunnel.');
    } finally {
      setTunnelLoading(false);
    }
  };

  useEffect(() => {
    void handleRefreshHfStatus();
  }, [handleRefreshHfStatus]);

  useEffect(() => {
    if (activeWay === 'ai_horde' && hordeModels.length === 0 && !hordeLoading) {
      void handleLoadHordeModels();
    }
  }, [activeWay, hordeModels.length, hordeLoading, handleLoadHordeModels]);

  const selectedBridge = useMemo(
    () => allowlistedBridges.find((b) => b.bridge_id === selectedBridgeId),
    [allowlistedBridges, selectedBridgeId]
  );
  const selectedBridgeRuntime = useMemo(
    () => bridgeRuntimes.find((rt) => rt.bridgeId === selectedBridgeId),
    [bridgeRuntimes, selectedBridgeId]
  );
  const verifiedBridgeModels = useMemo(() => {
    if (targetType !== 'bridge') return [];
    return resolveVerifiedBridgeModelOptions(selectedBridgeId, availableModels);
  }, [targetType, selectedBridgeId, availableModels]);

  const selectedProvider = useMemo(
    () => usableProviders.find((p) => p.id === selectedProviderId),
    [usableProviders, selectedProviderId]
  );

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    let list = usableProviders.filter((p) => {
      if (!buildConnectionSnippets(p).supportsOpenAiEndpoints) return false;
      if (onlyUnfiltered && !p.isUnfiltered) return false;
      if (q && !`${p.name} ${p.id} ${p.beschreibung}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortUnfilteredFirst) {
      list = [...list].sort((a, b) => Number(b.isUnfiltered) - Number(a.isUnfiltered));
    }
    return list;
  }, [usableProviders, providerSearch, onlyUnfiltered, sortUnfilteredFirst]);

  // Keep bridge model strictly on verified dropdown options
  useEffect(() => {
    if (targetType !== 'bridge' || verifiedBridgeModels.length === 0) return;
    if (!verifiedBridgeModels.some((m) => m.id === modelId)) {
      setModelId(verifiedBridgeModels[0].id);
    }
  }, [targetType, verifiedBridgeModels, modelId]);

  const switchTargetType = (next: ChatTargetType) => {
    setTargetType(next);
    setAvailableModels([]);
    setModelsNote(null);
    if (next === 'bridge') {
      const b = allowlistedBridges.find((x) => x.bridge_id === selectedBridgeId) || allowlistedBridges[0];
      if (b?.bridge_id) {
        setSelectedBridgeId(b.bridge_id);
        setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
        setModelId(resolveDefaultChatModel(undefined, b.bridge_id));
      }
    } else if (next === 'provider') {
      const p = selectedProvider || usableProviders[0];
      if (p) {
        setSelectedProviderId(p.id);
        setEndpointUrl(buildConnectionSnippets(p).defaultApiBase);
        setModelId(resolveDefaultChatModel(p.id));
      }
    } else if (next === 'litellm') {
      setEndpointUrl('http://127.0.0.1:4000/v1');
      setModelId('default');
    } else {
      setEndpointUrl('http://127.0.0.1:11434/v1');
      setModelId('huihui_ai/qwen2.5-abliterated');
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    setModelsNote(null);
    try {
      const res = await fetch('/api/chat/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        chatModels?: string[];
        models?: string[];
        error?: string;
      };
      if (!json.ok) {
        setModelsNote(json.error || 'Modelle konnten nicht geladen werden.');
        return;
      }
      const list = json.chatModels && json.chatModels.length > 0 ? json.chatModels : json.models || [];
      setAvailableModels(list);
      if (list.length > 0) {
        setModelsNote(`${list.length} Chat-Modelle geladen.`);
        if (targetType !== 'bridge' && (modelId === 'default' || !list.includes(modelId))) {
          setModelId(list[0]);
        }
      } else {
        setModelsNote('Endpunkt antwortete ohne Modellliste.');
      }
    } catch {
      setModelsNote('Verbindungsfehler beim Modell-Abruf.');
    } finally {
      setLoadingModels(false);
    }
  };

  // =========================================================================
  // Chat Attachment Upload (Files & Vision Images)
  // =========================================================================
  const handleChatAttachmentChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    for (const file of files.slice(0, 6)) {
      if (file.type.startsWith('image/')) {
        if (file.size > 5 * 1024 * 1024) continue;
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.readAsDataURL(file);
        });
        setPendingUploads((prev) => [
          ...prev,
          {
            id: createId('att'),
            name: file.name,
            mimeType: file.type,
            kind: 'image',
            sizeBytes: file.size,
            dataUrl,
          },
        ]);
      } else {
        if (file.size > 256 * 1024) continue;
        const txt = await file.text();
        if (txt.includes('\0')) continue;
        setPendingUploads((prev) => [
          ...prev,
          {
            id: createId('att'),
            name: file.name,
            mimeType: file.type || 'text/plain',
            kind: 'text',
            sizeBytes: file.size,
            previewText: txt.slice(0, 140),
            textContent: txt,
          },
        ]);
      }
    }
  };

  // =========================================================================
  // Send Coding Chat Prompt (with Tree, Pinned Files, Active File, Thinking, RAG)
  // =========================================================================
  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    if (messages.length > 0 || sending) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, sending]);

  const isActiveWayConfirmed = activeWay === 'catalog_or_bridge' || Boolean(warningConfirmed[activeWay]);

  const activeDisplayModel =
    activeWay === 'hf_space'
      ? hfSpaceId
      : activeWay === 'ai_horde'
        ? hordeModel || 'Auto-Worker'
        : activeWay === 'free_uncensored_api'
          ? freeApiModel
          : activeWay === 'cloud_tunnel'
            ? tunnelModel
            : modelId;

  const isMissingCloudTunnelUrl = activeWay === 'cloud_tunnel' && !tunnelUrl.trim();

  const handleSendMessage = async (overridePrompt?: string) => {
    const rawUserText = (typeof overridePrompt === 'string' ? overridePrompt : promptInput).trim();
    if ((!rawUserText && pendingUploads.length === 0) || sending || !activeProject) return;
    if (!isActiveWayConfirmed) {
      setWarningDetailsOpen(true);
      return;
    }
    if (isMissingCloudTunnelUrl) {
      setRightTab('connection');
      setShowRightDrawer(true);
      return;
    }

    // Ensure there is an active chat thread
    let targetChatId = activeChat?.id || '';
    if (!targetChatId) {
      const created: NotebookChatThread = {
        id: createId('chat'),
        title: rawUserText.slice(0, 42) || 'Coding-Session',
        targetType,
        bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
        providerId: targetType === 'provider' ? selectedProviderId : undefined,
        endpointUrl,
        modelId,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      targetChatId = created.id;
      setActiveChatId(created.id);
      updateNotebookWs((ws) => ({
        ...ws,
        projects: ws.projects.map((p) =>
          p.id === activeProject.id ? { ...p, chats: [created, ...p.chats] } : p
        ),
      }));
    }

    const nowTime = new Date().toLocaleTimeString('de-DE');
    const textUploads = pendingUploads.filter((a) => a.kind === 'text' && a.textContent);
    const imageUploads = pendingUploads.filter((a) => a.kind === 'image' && a.dataUrl);

    const userMsg: NotebookChatMessage = {
      id: createId('u'),
      role: 'user',
      content: rawUserText || '(Dateien/Bilder gesendet)',
      createdAt: nowTime,
      attachments:
        pendingUploads.length > 0
          ? pendingUploads.map(({ name, mimeType, kind, sizeBytes, previewText }) => ({
              name,
              mimeType,
              kind,
              sizeBytes,
              previewText,
            }))
          : undefined,
    };

    const prevMessages = activeChat?.messages ?? [];
    const nextChatTitle =
      prevMessages.length === 0 && rawUserText
        ? rawUserText.replace(/\s+/g, ' ').slice(0, 48)
        : activeChat?.title || 'Coding-Session';

    updateNotebookWs((ws) => ({
      ...ws,
      projects: ws.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              updatedAt: new Date().toISOString(),
              chats: p.chats.map((c) =>
                c.id === targetChatId
                  ? {
                      ...c,
                      title: nextChatTitle,
                      targetType,
                      bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
                      providerId: targetType === 'provider' ? selectedProviderId : undefined,
                      endpointUrl,
                      modelId,
                      messages: [...c.messages, userMsg],
                      updatedAt: new Date().toISOString(),
                    }
                  : c
              ),
            }
          : p
      ),
    }));

    setPromptInput('');
    setPendingUploads([]);
    setSending(true);
    setLiveStream({
      status: `Verbinde mit ${activeTargetLabel} (${activeDisplayModel})…`,
      content: '',
      thinking: '',
      toolEvents: [],
    });

    // Build structured coding system prompt: Role + Thinking + Diff-Mode + Tree + Active/Pinned Files + Notebooks RAG
    const sysSections: string[] = [];
    if (CODING_ROLE_PROMPTS[codingRole].prompt) {
      sysSections.push(CODING_ROLE_PROMPTS[codingRole].prompt);
    }
    if (THINKING_PROMPTS[thinkingMode]) {
      sysSections.push(THINKING_PROMPTS[thinkingMode]);
    }
    if (diffModeEnabled) {
      sysSections.push(buildDiffModeInstruction());
    }
    if (customSystemPrompt.trim()) {
      sysSections.push(customSystemPrompt.trim());
    }
    if (activeProject.instructions.trim()) {
      sysSections.push(`Projekt-Anweisungen (${activeProject.name}):\n${activeProject.instructions.trim()}`);
    }

    // Folder tree context
    if (autoInjectTree && treeNodes.length > 0) {
      sysSections.push(
        `Aktive Ordnerstruktur (${workspaceRootLabel || 'Workspace'}):\n\`\`\`\n${buildFolderTreeSummary(treeNodes, 100)}\n\`\`\``
      );
    }

    // Active file + pinned files context (deduplicated, bounded)
    const contextPaths = new Set<string>(pinnedFilePaths);
    if (autoInjectActiveFile && activeFilePath) {
      contextPaths.add(activeFilePath);
    }
    let remainingCodeBudget = 18000;
    for (const relPath of contextPaths) {
      const f = filesMap[relPath];
      if (!f || remainingCodeBudget <= 400) continue;
      const snippet = f.content.slice(0, remainingCodeBudget);
      remainingCodeBudget -= snippet.length;
      sysSections.push(
        `Workspace-Datei "${f.path}" (${f.language}):\n\`\`\`${f.language}\n${snippet}\n\`\`\``
      );
    }

    // Notebooks Knowledge Base & Cross-Chat RAG
    const rag = retrieveProjectContext({
      project: activeProject,
      activeChatId: targetChatId,
      query: rawUserText,
    });
    if (rag.compiledSystemBlock) {
      sysSections.push(rag.compiledSystemBlock);
    }

    // Include inline text attachments on the latest user turn
    let outboundUserContent = rawUserText || 'Analysiere die angehängten Dateien/Bilder.';
    if (textUploads.length > 0) {
      const attBlocks = textUploads
        .map((u) => `--- Anhang: ${u.name} ---\n${(u.textContent || '').slice(0, 10000)}`)
        .join('\n\n');
      outboundUserContent = `${outboundUserContent}\n\n${attBlocks}`;
    }

    const historyPayload = [
      ...prevMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-18)
        .map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: outboundUserContent },
    ];

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let streamedContent = '';
    let streamedThinking = '';
    const streamedToolEvents: CodingToolEvent[] = [];
    let finalReceived = false;

    const appendReplyToChat = (replyMsg: NotebookChatMessage) => {
      updateNotebookWs((ws) => ({
        ...ws,
        projects: ws.projects.map((p) =>
          p.id === activeProject.id
            ? {
                ...p,
                updatedAt: new Date().toISOString(),
                chats: p.chats.map((c) =>
                  c.id === targetChatId
                    ? { ...c, messages: [...c.messages, replyMsg], updatedAt: new Date().toISOString() }
                    : c
                ),
              }
            : p
        ),
      }));
    };

    try {
      const parsedSeed = seedValue.trim() ? Number.parseInt(seedValue.trim(), 10) : undefined;
      const res = await fetch('/api/coding/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          way: activeWay,
          warningAcknowledged: isActiveWayConfirmed,
          activeProjectId: activeProject.id,
          enabledTools,
          usePersistentMemory: memoryStore.autoInject,
          messages: historyPayload,
          systemPrompt: sysSections.join('\n\n').slice(0, 31500),
          images: imageUploads.map((i) => i.dataUrl),
          thinkingMode,
          temperature,
          maxTokens,
          topP,
          topK,
          repetitionPenalty,
          presencePenalty,
          frequencyPenalty,
          seed: Number.isInteger(parsedSeed) ? parsedSeed : undefined,
          hfSpaceId,
          hfToken: hfToken.trim() || undefined,
          gpuDuration,
          useDflash,
          hordeModel: hordeModel.trim() || undefined,
          hordeApiKey: hordeApiKey.trim() || undefined,
          hordeMaxLength,
          hordeMaxContextLength,
          hordeRepPen,
          hordeTrustedWorkers,
          hordeSlowWorkers,
          hordeAllowDowngrade,
          freeApiPresetId,
          tunnelUrl: tunnelUrl.trim() || undefined,
          numCtx: tunnelNumCtx,
          model: activeDisplayModel,
          apiKey:
            activeWay === 'free_uncensored_api'
              ? freeApiKey.trim() || undefined
              : activeWay === 'cloud_tunnel'
                ? tunnelToken.trim() || undefined
                : apiKey.trim() || undefined,
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl,
        }),
      });

      if (!res.body) {
        throw new Error(`HTTP ${res.status}: Kein Antwort-Stream verfügbar.`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const streamOutcome: {
        done: {
          ok: boolean;
          reply?: string;
          thinking?: string;
          model?: string;
          latencyMs?: number;
          httpStatus?: number;
          targetUrl?: string;
          error?: string;
          rawPreview?: string;
          toolEvents?: CodingToolEvent[];
          writtenFiles?: string[];
          meta?: Record<string, unknown>;
          usage?: NotebookChatMessage['usage'];
        } | null;
        err: {
          error: string;
          httpStatus?: number;
          targetUrl?: string;
          rawPreview?: string;
          latencyMs?: number;
          toolEvents?: CodingToolEvent[];
        } | null;
      } = { done: null, err: null };

      const parser = createSseFrameParser((ev) => {
        if (ev.type === 'status') {
          setLiveStream((prev) =>
            prev ? { ...prev, status: ev.message } : { status: ev.message, content: '', thinking: '', toolEvents: [] }
          );
        } else if (ev.type === 'thinking') {
          streamedThinking += ev.delta;
          setLiveStream((prev) =>
            prev
              ? { ...prev, status: 'Denkt nach (Live-Stream)…', thinking: streamedThinking }
              : { status: 'Denkt nach…', content: streamedContent, thinking: streamedThinking, toolEvents: streamedToolEvents }
          );
        } else if (ev.type === 'token') {
          streamedContent += ev.delta;
          setLiveStream((prev) =>
            prev
              ? { ...prev, status: 'Streamt Antwort live…', content: streamedContent }
              : { status: 'Streamt Antwort live…', content: streamedContent, thinking: streamedThinking, toolEvents: streamedToolEvents }
          );
        } else if (ev.type === 'tool') {
          streamedToolEvents.push(ev.event);
          setLiveStream((prev) =>
            prev
              ? {
                  ...prev,
                  status: `Tool ausgeführt: ${ev.event.tool}`,
                  toolEvents: [...streamedToolEvents],
                }
              : {
                  status: `Tool ausgeführt: ${ev.event.tool}`,
                  content: streamedContent,
                  thinking: streamedThinking,
                  toolEvents: [...streamedToolEvents],
                }
          );
        } else if (ev.type === 'done') {
          streamOutcome.done = ev.payload;
          finalReceived = true;
        } else if (ev.type === 'error') {
          streamOutcome.err = ev;
          finalReceived = true;
        }
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.flush();

      const dp = streamOutcome.done;
      const se = streamOutcome.err;

      if (dp && dp.ok && typeof dp.reply === 'string') {
        appendReplyToChat({
          id: createId('a'),
          role: 'assistant',
          content: dp.reply || streamedContent,
          thinking: dp.thinking || streamedThinking || undefined,
          toolEvents: dp.toolEvents || (streamedToolEvents.length > 0 ? streamedToolEvents : undefined),
          providerMeta: dp.meta,
          createdAt: new Date().toLocaleTimeString('de-DE'),
          model: dp.model || activeDisplayModel,
          latencyMs: dp.latencyMs,
          httpStatus: dp.httpStatus,
          targetUrl: dp.targetUrl,
          contextSources: rag.citations.length > 0 ? rag.citations : undefined,
          usage: dp.usage,
        });

        if (dp.meta && dp.meta.memoryUpdated === true) {
          void refreshCodingMemory();
        }
        if (Array.isArray(dp.writtenFiles) && dp.writtenFiles.length > 0) {
          const lastWritten = dp.writtenFiles[dp.writtenFiles.length - 1];
          void loadServerWorkspace(serverSubDir);
          setFilesMap((prev) => {
            const copy = { ...prev };
            delete copy[lastWritten];
            return copy;
          });
          setTimeout(() => {
            void openWorkspaceFile(lastWritten);
          }, 250);
        }
      } else if (se) {
        appendReplyToChat({
          id: createId('e'),
          role: 'error',
          content: se.error,
          createdAt: new Date().toLocaleTimeString('de-DE'),
          latencyMs: se.latencyMs,
          httpStatus: se.httpStatus || res.status,
          targetUrl: se.targetUrl,
          rawPreview: se.rawPreview,
          toolEvents: se.toolEvents || (streamedToolEvents.length > 0 ? streamedToolEvents : undefined),
        });
      } else if (streamedContent.trim()) {
        appendReplyToChat({
          id: createId('a'),
          role: 'assistant',
          content: streamedContent,
          thinking: streamedThinking || undefined,
          toolEvents: streamedToolEvents.length > 0 ? streamedToolEvents : undefined,
          createdAt: new Date().toLocaleTimeString('de-DE'),
          model: activeDisplayModel,
          contextSources: rag.citations.length > 0 ? rag.citations : undefined,
        });
      } else {
        appendReplyToChat({
          id: createId('e'),
          role: 'error',
          content: `Keine Antwort vom Stream erhalten (HTTP ${res.status}).`,
          createdAt: new Date().toLocaleTimeString('de-DE'),
          httpStatus: res.status,
        });
      }
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      if (!finalReceived) {
        if (aborted && (streamedContent.trim() || streamedThinking.trim())) {
          // Preserve partial streamed response on manual Stop!
          appendReplyToChat({
            id: createId('a'),
            role: 'assistant',
            content: `${streamedContent.trim()}\n\n> *[Stream vom Benutzer gestoppt — bisherige Teilantwort erhalten]*`,
            thinking: streamedThinking || undefined,
            toolEvents: streamedToolEvents.length > 0 ? streamedToolEvents : undefined,
            createdAt: new Date().toLocaleTimeString('de-DE'),
            model: activeDisplayModel,
            contextSources: rag.citations.length > 0 ? rag.citations : undefined,
          });
        } else {
          appendReplyToChat({
            id: createId('e'),
            role: 'error',
            content: aborted
              ? 'Anfrage vom Benutzer abgebrochen.'
              : err instanceof Error
                ? `Netzwerkfehler beim Streamen: ${err.message}`
                : 'Netzwerkfehler beim Senden.',
            createdAt: new Date().toLocaleTimeString('de-DE'),
          });
        }
      }
    } finally {
      setSending(false);
      setLiveStream(null);
      abortRef.current = null;
    }
  };

  const handleSendSandboxErrorToAi = (execResult: SandboxExecutionResult) => {
    const target = execResult.targetFile;
    if (target && !pinnedFilePaths.includes(target)) {
      setPinnedFilePaths((prev) => [...prev, target]);
    }
    const errText = [
      `Der Sandbox-Befehl \`${execResult.displayCommand}\` ist fehlgeschlagen (Exit-Code ${execResult.exitCode ?? 'unbekannt'}, ${execResult.durationMs} ms).`,
      execResult.error ? `Fehler: ${execResult.error}` : '',
      execResult.stderr ? `stderr:\n\`\`\`\n${execResult.stderr.slice(0, 3000)}\n\`\`\`` : '',
      execResult.stdout ? `stdout:\n\`\`\`\n${execResult.stdout.slice(0, 1500)}\n\`\`\`` : '',
      'Analysiere die genaue Ursache in der angehefteten Datei und liefere den korrigierten Code (gerne als SEARCH/REPLACE-Patch oder vollständige Datei).',
    ]
      .filter(Boolean)
      .join('\n\n');
    setCodingRole('bugfix');
    if (isActiveWayConfirmed && !isMissingCloudTunnelUrl) {
      void handleSendMessage(errText);
    } else {
      setPromptInput(errText);
    }
  };

  // =========================================================================
  // Notebooks & Knowledge Base Actions
  // =========================================================================
  const handleCreateProject = () => {
    const name = newProjectName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const firstChat: NotebookChatThread = {
      id: createId('chat'),
      title: 'Coding-Session',
      targetType,
      bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
      providerId: targetType === 'provider' ? selectedProviderId : undefined,
      endpointUrl,
      modelId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    const proj: NotebookProject = {
      id: createId('proj'),
      name,
      description: 'Coding-Studio Projekt',
      instructions: '',
      crossChatMemoryEnabled: true,
      knowledgeBaseEnabled: true,
      knowledgeDocs: [],
      chats: [firstChat],
      chronoJobs: [],
      createdAt: now,
      updatedAt: now,
    };
    updateNotebookWs((ws) => ({
      ...ws,
      activeProjectId: proj.id,
      projects: [proj, ...ws.projects],
    }));
    setActiveChatId(firstChat.id);
    setNewProjectName('');
    setShowNewProjectForm(false);
  };

  const handleNewChat = () => {
    if (!activeProject) return;
    const now = new Date().toISOString();
    const chat: NotebookChatThread = {
      id: createId('chat'),
      title: `Coding #${activeProject.chats.length + 1}`,
      targetType,
      bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
      providerId: targetType === 'provider' ? selectedProviderId : undefined,
      endpointUrl,
      modelId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    updateNotebookWs((ws) => ({
      ...ws,
      projects: ws.projects.map((p) =>
        p.id === activeProject.id ? { ...p, chats: [chat, ...p.chats] } : p
      ),
    }));
    setActiveChatId(chat.id);
  };

  const handleAddKnowledgeDoc = () => {
    if (!activeProject || !newDocTitle.trim() || !newDocContent.trim()) return;
    const now = new Date().toISOString();
    updateNotebookWs((ws) => ({
      ...ws,
      projects: ws.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              knowledgeDocs: [
                {
                  id: createId('doc'),
                  title: newDocTitle.trim(),
                  sourceType: 'note',
                  tags: ['coding'],
                  content: newDocContent.trim(),
                  enabled: true,
                  createdAt: now,
                  updatedAt: now,
                },
                ...p.knowledgeDocs,
              ],
            }
          : p
      ),
    }));
    setNewDocTitle('');
    setNewDocContent('');
    setShowNewDocForm(false);
  };

  const handleUploadKnowledgeFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeProject) return;
    const txt = await file.text();
    const now = new Date().toISOString();
    updateNotebookWs((ws) => ({
      ...ws,
      projects: ws.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              knowledgeDocs: [
                {
                  id: createId('doc'),
                  title: file.name,
                  sourceType: 'file',
                  filename: file.name,
                  mimeType: file.type || 'text/plain',
                  tags: ['upload', guessLanguage(file.name)],
                  content: txt.slice(0, 60000),
                  enabled: true,
                  createdAt: now,
                  updatedAt: now,
                },
                ...p.knowledgeDocs,
              ],
            }
          : p
      ),
    }));
  };

  const handleSaveReplyToKb = (msg: NotebookChatMessage) => {
    if (!activeProject) return;
    const now = new Date().toISOString();
    updateNotebookWs((ws) => ({
      ...ws,
      projects: ws.projects.map((p) =>
        p.id === activeProject.id
          ? {
              ...p,
              knowledgeDocs: [
                {
                  id: createId('doc'),
                  title: `Coding-Notiz (${msg.model || 'Antwort'} · ${msg.createdAt})`,
                  sourceType: 'snippet',
                  tags: ['coding', 'antwort'],
                  content: msg.content,
                  enabled: true,
                  createdAt: now,
                  updatedAt: now,
                },
                ...p.knowledgeDocs,
              ],
            }
          : p
      ),
    }));
    setSavedKbMsgId(msg.id);
    setTimeout(() => setSavedKbMsgId((cur) => (cur === msg.id ? null : cur)), 1600);
  };

  const handleExportChatMarkdown = () => {
    if (!activeChat) return;
    const md = activeChat.messages
      .map((m) => {
        const header = `## ${m.role === 'user' ? 'DU' : m.role === 'assistant' ? `ASSISTENT (${m.model || ''})` : 'FEHLER'} · ${m.createdAt}`;
        const think = m.thinking ? `<details><summary>Gedankengang</summary>\n\n${m.thinking}\n\n</details>\n\n` : '';
        return `${header}\n\n${think}${m.content}`;
      })
      .join('\n\n---\n\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(activeChat.title || 'coding-chat').replace(/[^a-z0-9-_]+/gi, '_')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const nbSearchHits = useMemo(() => {
    if (!activeProject || !nbSearchQuery.trim()) return [];
    return searchProjectEverything(activeProject, nbSearchQuery.trim());
  }, [activeProject, nbSearchQuery]);

  // =========================================================================
  // Tree Rendering Helper
  // =========================================================================
  const filterTree = useCallback((nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    const out: WorkspaceTreeNode[] = [];
    for (const n of nodes) {
      if (n.type === 'dir') {
        const kids = filterTree(n.children || [], q);
        if (kids.length > 0 || n.name.toLowerCase().includes(q)) {
          out.push({ ...n, children: kids });
        }
      } else if (n.path.toLowerCase().includes(q)) {
        out.push(n);
      }
    }
    return out;
  }, []);

  const visibleTree = useMemo(() => filterTree(treeNodes, treeFilter), [treeNodes, treeFilter, filterTree]);

  const renderTreeNodes = (nodes: WorkspaceTreeNode[], depth = 0) => {
    return nodes.map((node) => {
      if (node.type === 'dir') {
        const isOpen = treeFilter.trim().length > 0 || Boolean(expandedDirs[node.path]);
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() =>
                setExpandedDirs((prev) => ({ ...prev, [node.path]: !prev[node.path] }))
              }
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              )}
              {isOpen ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              )}
              <span className="truncate font-medium">{node.name}</span>
            </button>
            {isOpen && node.children && node.children.length > 0 && (
              <div>{renderTreeNodes(node.children, depth + 1)}</div>
            )}
          </div>
        );
      }

      const isActive = activeFilePath === node.path;
      const isPinned = pinnedFilePaths.includes(node.path);
      return (
        <div
          key={node.path}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
          className={`group flex items-center justify-between gap-1 rounded px-1.5 py-1 text-xs ${
            isActive ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <button
            type="button"
            onClick={() => void openWorkspaceFile(node.path)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <FileCode2
              className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-teal-700' : 'text-slate-400'}`}
              aria-hidden="true"
            />
            <span className="truncate font-mono text-[11px]">{node.name}</span>
          </button>
          <button
            type="button"
            onClick={() => void togglePinFile(node.path)}
            title={isPinned ? 'Aus Chat-Kontext entfernen' : 'Als Chat-Kontext (@) anheften'}
            className={`shrink-0 rounded p-0.5 transition-colors ${
              isPinned
                ? 'bg-teal-100 text-teal-800'
                : 'text-slate-300 opacity-0 hover:text-slate-700 group-hover:opacity-100'
            }`}
          >
            <Pin className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      );
    });
  };

  const activeKnowledgeCount = activeProject?.knowledgeDocs.filter((d) => d.enabled).length ?? 0;
  const activeFreePreset =
    FREE_UNCENSORED_API_PRESETS.find((p) => p.id === freeApiPresetId) ||
    FREE_UNCENSORED_API_PRESETS[0];
  const activeTargetLabel =
    activeWay === 'hf_space'
      ? 'Weg 1 · HF ZeroGPU Space'
      : activeWay === 'ai_horde'
        ? 'Weg 2 · AI Horde'
        : activeWay === 'free_uncensored_api'
          ? `Weg 3 · ${activeFreePreset.label.split(' (')[0]}`
          : activeWay === 'cloud_tunnel'
            ? `Weg 4 · Cloud-GPU (${cloudPlatform === 'kaggle' ? 'Kaggle' : 'Colab'})`
            : targetType === 'bridge'
              ? selectedBridge
                ? `Bridge: ${selectedBridge.zielprovider}`
                : 'Bridge'
              : targetType === 'provider'
                ? selectedProvider?.name || 'Provider'
                : targetType === 'litellm'
                  ? 'LiteLLM Router'
                  : 'Lokal 127.0.0.1';
  const activeWarning = PROVIDER_WARNINGS[activeWay];

  return (
    <div
      className={
        chatMaximized
          ? 'fixed inset-0 z-50 flex flex-col bg-slate-50 p-3 sm:p-4'
          : 'flex h-[calc(100vh-7.25rem)] min-h-[640px] flex-col gap-3'
      }
    >
      {/* Hidden inputs for folder upload, code file upload, chat attachments, and KB upload */}
      <input
        ref={folderUploadRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard in Chromium/Firefox/Safari
        webkitdirectory=""
        className="hidden"
        onChange={(e) => void handleUploadFolder(e)}
      />
      <input
        ref={multiFileUploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void handleUploadCodeFiles(e)}
      />
      <input
        ref={chatAttachmentRef}
        type="file"
        multiple
        accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.css,.html,.sql,.yml,.yaml,.sh,.ps1,.csv,.log"
        className="hidden"
        onChange={(e) => void handleChatAttachmentChange(e)}
      />
      <input
        ref={kbFileInputRef}
        type="file"
        accept=".txt,.md,.json,.ts,.tsx,.js,.py,.csv,.yml,.yaml"
        className="hidden"
        onChange={(e) => void handleUploadKnowledgeFile(e)}
      />

      {/* Top IDE Workspace Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 pr-1 text-xs font-semibold text-slate-900">
            <Code2 className="h-4 w-4 text-teal-700" aria-hidden="true" />
            <span>Coding-Studio</span>
          </div>

          <span className="hidden h-4 w-px bg-slate-200 sm:inline-block" aria-hidden="true" />

          {/* Workspace Loader Actions */}
          <button
            type="button"
            onClick={() => void loadServerWorkspace('')}
            disabled={treeLoading}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FolderTree className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>Projektordner</span>
          </button>

          <button
            type="button"
            onClick={() => folderUploadRef.current?.click()}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Ordner hochladen</span>
          </button>

          <button
            type="button"
            onClick={() => multiFileUploadRef.current?.click()}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Dateien</span>
          </button>

          <span className="hidden h-4 w-px bg-slate-200 md:inline-block" aria-hidden="true" />

          {/* Thinking Mode Segmented Selector */}
          <div
            className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px]"
            role="group"
            aria-label="Thinking-Modus"
          >
            <span className="inline-flex items-center gap-1 px-1.5 font-medium text-slate-500">
              <Brain className="h-3 w-3 text-teal-700" aria-hidden="true" />
              Thinking
            </span>
            {(['off', 'standard', 'deep'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setThinkingMode(mode)}
                className={`rounded px-2 py-0.5 font-medium transition-colors ${
                  thinkingMode === mode
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode === 'off' ? 'Aus' : mode === 'standard' ? 'Standard' : 'Tief'}
              </button>
            ))}
          </div>

          {/* Coding Role Preset */}
          <select
            aria-label="Coding-Modus"
            value={codingRole}
            onChange={(e) => setCodingRole(e.target.value as CodingRolePreset)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:border-teal-600 focus:outline-none"
          >
            {Object.entries(CODING_ROLE_PROMPTS).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
        </div>

        {/* Right Controls: Panel Toggles + Maximize Chat */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!chatMaximized && (
            <>
              <button
                type="button"
                onClick={() => setShowExplorerPanel((v) => !v)}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium ${
                  showExplorerPanel
                    ? 'border-teal-200 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <FolderTree className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Dateistruktur</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (showRightDrawer && rightTab === 'tools') {
                    setShowRightDrawer(false);
                  } else {
                    setRightTab('tools');
                    setShowRightDrawer(true);
                  }
                }}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium ${
                  showRightDrawer && rightTab === 'tools'
                    ? 'border-teal-200 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Tools ({enabledTools.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (showRightDrawer && rightTab === 'notebooks') {
                    setShowRightDrawer(false);
                  } else {
                    setRightTab('notebooks');
                    setShowRightDrawer(true);
                  }
                }}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium ${
                  showRightDrawer && rightTab === 'notebooks'
                    ? 'border-teal-200 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Notebooks</span>
              </button>

              <button
                type="button"
                data-testid="coding-toolbar-memory-btn"
                onClick={() => {
                  if (showRightDrawer && rightTab === 'gadgets') {
                    setShowRightDrawer(false);
                  } else {
                    setRightTab('gadgets');
                    setShowRightDrawer(true);
                  }
                }}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium ${
                  showRightDrawer && rightTab === 'gadgets'
                    ? 'border-teal-200 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">
                  Gedächtnis ({memoryStore.entries.filter((e) => e.enabled).length})
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (showRightDrawer && rightTab === 'connection') {
                    setShowRightDrawer(false);
                  } else {
                    setRightTab('connection');
                    setShowRightDrawer(true);
                  }
                }}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium ${
                  showRightDrawer && rightTab === 'connection'
                    ? 'border-teal-200 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Verbindung</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setChatMaximized((v) => !v)}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800"
          >
            {chatMaximized ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Normalansicht</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Chat maximieren</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* 4 Primary Free Unfiltered Connection Selector Bar */}
      <nav
        aria-label="Hauptverbindungen Coding-Studio"
        className="grid grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-white p-1.5 lg:grid-cols-5"
      >
        {MAIN_CONNECTION_WAYS.map((way) => {
          const isSelected = activeWay === way.id;
          const confirmed = way.id === 'catalog_or_bridge' || warningConfirmed[way.id];
          const Icon =
            way.id === 'hf_space'
              ? Cpu
              : way.id === 'ai_horde'
                ? Network
                : way.id === 'free_uncensored_api'
                  ? Zap
                  : way.id === 'cloud_tunnel'
                    ? Cloud
                    : Settings2;
          return (
            <button
              key={way.id}
              type="button"
              onClick={() => {
                setActiveWay(way.id);
                setWarningDetailsOpen(false);
                if (!chatMaximized) {
                  setRightTab('connection');
                  setShowRightDrawer(true);
                }
              }}
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                isSelected
                  ? 'border-teal-600 bg-teal-50/90 text-teal-950'
                  : 'border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-teal-700' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{way.shortLabel}</span>
                </div>
                <div className="truncate font-mono text-[10px] text-slate-500">{way.subtitle}</div>
              </div>
              {way.id !== 'catalog_or_bridge' && (
                <span
                  title={confirmed ? 'Warnung bestätigt' : 'Warnung noch nicht bestätigt'}
                  className={`shrink-0 font-mono text-[10px] font-semibold ${
                    confirmed ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {confirmed ? 'OK' : '!'}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Main 3-Pane IDE Grid */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* LEFT PANE: File & Folder Structure + Split CodeMirror Editor + Sandbox Runner */}
        {!chatMaximized && showExplorerPanel && (
          <section className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white xl:w-96">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">
                  {workspaceRootLabel || 'Dateistruktur & Editor'}
                </div>
                <div className="font-mono text-[10px] text-slate-500">
                  {workspaceMode === 'server'
                    ? 'Lokal · Schreib-Sandbox: coding-workspace/'
                    : workspaceMode === 'uploaded'
                      ? 'Hochgeladener Arbeitsbereich'
                      : 'Kein Ordner geladen'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowSandboxRunner((v) => !v)}
                  title="Sandbox-Runner (Build/Test-Loop) ein-/ausblenden"
                  aria-label="Sandbox-Runner umschalten"
                  aria-expanded={showSandboxRunner}
                  className={`rounded p-1 ${
                    showSandboxRunner
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewFileInput((v) => !v)}
                  title="Neue Datei anlegen"
                  aria-label="Neue Datei anlegen"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {workspaceMode === 'server' && (
                  <button
                    type="button"
                    onClick={() => void loadServerWorkspace(serverSubDir)}
                    title="Ordner aktualisieren"
                    aria-label="Ordner aktualisieren"
                    className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${treeLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            {showNewFileInput && (
              <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-2.5 py-2">
                <input
                  type="text"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  placeholder="coding-workspace/script.ts"
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] text-slate-900 focus:border-teal-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateNewFile()}
                  className="rounded bg-teal-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-800"
                >
                  Anlegen
                </button>
              </div>
            )}

            {treeError && (
              <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800">
                {treeError}
              </div>
            )}

            {/* Quick Directory Filter + Search */}
            {workspaceMode !== 'none' && (
              <div className="space-y-1.5 border-b border-slate-200 px-2.5 py-2">
                {workspaceMode === 'server' && (
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    {[
                      { label: 'Root', dir: '' },
                      { label: 'src/', dir: 'src' },
                      { label: 'coding-workspace/', dir: 'coding-workspace' },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => void loadServerWorkspace(opt.dir)}
                        className={`rounded border px-1.5 py-0.5 ${
                          serverSubDir === opt.dir
                            ? 'border-teal-300 bg-teal-50 text-teal-800'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={treeFilter}
                    onChange={(e) => setTreeFilter(e.target.value)}
                    placeholder="Datei filtern…"
                    className="w-full rounded border border-slate-200 bg-slate-50 py-1 pl-6 pr-2 text-[11px] text-slate-800 focus:border-teal-600 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Folder Tree or Empty State */}
            <div
              className={`overflow-y-auto p-1.5 ${
                activeFile && showSandboxRunner
                  ? 'h-24 shrink-0 border-b border-slate-200'
                  : activeFile
                    ? 'h-40 shrink-0 border-b border-slate-200'
                    : showSandboxRunner
                      ? 'min-h-0 flex-1 border-b border-slate-200'
                      : 'flex-1'
              }`}
            >
              {workspaceMode === 'none' ? (
                <div className="flex h-full flex-col items-center justify-center p-4 text-center">
                  <FolderTree className="h-8 w-8 text-slate-300" aria-hidden="true" />
                  <p className="mt-2 text-xs font-medium text-slate-800">
                    Kein Projektordner aktiv
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Lade den lokalen Projektordner, einen beliebigen Ordner vom Rechner oder einzelne Code-Dateien. Angeheftete Dateien (<span className="font-mono">@</span>) werden automatisch im Coding-Chat mitgegeben.
                  </p>
                  <div className="mt-3 flex flex-col gap-1.5 w-full">
                    <button
                      type="button"
                      onClick={() => void loadServerWorkspace('')}
                      className="w-full rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                    >
                      Lokalen Projektordner öffnen
                    </button>
                    <button
                      type="button"
                      onClick={() => folderUploadRef.current?.click()}
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Ordner vom Rechner hochladen
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewFileInput(true)}
                      className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Neue Code-Datei anlegen
                    </button>
                  </div>
                </div>
              ) : visibleTree.length === 0 ? (
                <div className="p-3 text-center text-[11px] text-slate-500">
                  Keine passenden Dateien gefunden.
                </div>
              ) : (
                renderTreeNodes(visibleTree)
              )}
            </div>

            {/* Split CodeMirror 6 Editor + Live-Preview + Checkpoints */}
            {activeFile && (
              <div className="flex min-h-[150px] flex-1 flex-col overflow-hidden bg-slate-950 text-slate-100">
                <div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-slate-800 bg-slate-900 px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] font-medium text-slate-100">
                      {activeFile.path}
                      {activeFile.dirty ? ' *' : ''}
                    </div>
                    <div className="font-mono text-[10px] tabular-nums text-slate-400">
                      {activeFile.language} · {activeFile.content.split('\n').length} Zeilen
                      {activeFileCheckpoints.length > 0
                        ? ` · ${activeFileCheckpoints.length} Checkpoint${activeFileCheckpoints.length === 1 ? '' : 's'}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {supportsLivePreview(activeFile.path, activeFile.language) && (
                      <button
                        type="button"
                        data-testid="toggle-live-preview"
                        onClick={() => setEditorPreviewMode((v) => !v)}
                        title={editorPreviewMode ? 'Zurück zum Code-Editor' : 'Isolierte Live-Vorschau öffnen'}
                        aria-label="Live-Vorschau umschalten"
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${
                          editorPreviewMode
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
                        }`}
                      >
                        <Eye className="h-3 w-3" aria-hidden="true" />
                        <span>{editorPreviewMode ? 'Code' : 'Vorschau'}</span>
                      </button>
                    )}
                    {activeFileCheckpoints.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void handleRollbackCheckpoint(activeFile.path)}
                        title={`Letzten Checkpoint (${activeFileCheckpoints[0].createdAt}) wiederherstellen`}
                        aria-label="Checkpoint wiederherstellen"
                        className="rounded p-1 text-amber-300 hover:bg-slate-800 hover:text-amber-200"
                      >
                        <History className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void togglePinFile(activeFile.path)}
                      title="In Chat-Kontext anheften"
                      aria-label="Datei anheften"
                      className={`rounded p-1 text-[10px] ${
                        pinnedFilePaths.includes(activeFile.path)
                          ? 'bg-teal-700 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <Pin className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveActiveFile()}
                      title="In coding-workspace/ speichern"
                      aria-label="Datei speichern"
                      className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <Save className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadActiveFile}
                      title="Datei herunterladen"
                      aria-label="Datei herunterladen"
                      className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <Download className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveFilePath(null)}
                      title="Editor schließen"
                      aria-label="Editor schließen"
                      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {fileStatusMsg && (
                  <div className="border-b border-slate-800 bg-slate-900/90 px-2.5 py-1 font-mono text-[10px] text-teal-300">
                    {fileStatusMsg}
                  </div>
                )}
                {fileLoading ? (
                  <div className="p-3 font-mono text-[11px] text-slate-400">Lade Datei…</div>
                ) : (
                  <CodingCodeEditor
                    filePath={activeFile.path}
                    value={activeFile.content}
                    language={activeFile.language}
                    previewMode={editorPreviewMode}
                    onChange={(nextVal) =>
                      setFilesMap((prev) => ({
                        ...prev,
                        [activeFile.path]: { ...activeFile, content: nextVal, dirty: true },
                      }))
                    }
                  />
                )}
              </div>
            )}

            {/* Collapsible Sandbox Execution Runner (Human-in-the-Loop Build/Test Loop) */}
            {showSandboxRunner && (
              <CodingSandboxRunnerPanel
                activeFilePath={activeFilePath}
                sandboxFilePaths={sandboxFilePaths}
                onSendErrorToAi={handleSendSandboxErrorToAi}
              />
            )}
          </section>
        )}

        {/* CENTER PANE: Large Maximizable Coding Chat Window */}
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          {/* Chat Session Status Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-3.5 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-900">{activeTargetLabel}</span>
              <span className="truncate font-mono text-[11px] text-slate-500">
                Modell: <strong className="text-slate-800">{activeDisplayModel}</strong>
              </span>
              <span className="font-mono text-[11px] text-slate-400">·</span>
              <span className="truncate font-mono text-[11px] text-slate-600">
                Projekt: {activeProject?.name}
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                Wissen: {activeKnowledgeCount} · Gedächtnis: {memoryStore.entries.filter((e) => e.enabled).length} · Tools: {enabledTools.length}
              </span>
              {pinnedFilePaths.length > 0 && (
                <span className="font-mono text-[11px] font-medium text-teal-800">
                  · @{pinnedFilePaths.length} Datei{pinnedFilePaths.length === 1 ? '' : 'en'}
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDiffModeEnabled((v) => !v)}
                title="Instruiert die KI, kompakte SEARCH/REPLACE-Patches statt kompletter Dateien auszugeben"
                aria-pressed={diffModeEnabled}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                  diffModeEnabled
                    ? 'border-teal-600 bg-teal-50 text-teal-900'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <GitCompareArrows className="h-3 w-3" aria-hidden="true" />
                <span>Diff-Modus</span>
              </button>
              <button
                type="button"
                onClick={handleNewChat}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <MessageSquarePlus className="h-3 w-3" aria-hidden="true" />
                <span>Neuer Chat</span>
              </button>
              <button
                type="button"
                onClick={handleExportChatMarkdown}
                disabled={messages.length === 0}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">MD</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!activeProject || !activeChat) return;
                  updateNotebookWs((ws) => ({
                    ...ws,
                    projects: ws.projects.map((p) =>
                      p.id === activeProject.id
                        ? {
                            ...p,
                            chats: p.chats.map((c) =>
                              c.id === activeChat.id ? { ...c, messages: [] } : c
                            ),
                          }
                        : p
                    ),
                  }));
                }}
                disabled={messages.length === 0}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                <span className="hidden sm:inline">Leeren</span>
              </button>
            </div>
          </div>

          {/* Per-Provider Explicit Warning Banner & Confirmation Gate */}
          <div
            className={`border-b px-3.5 py-2 text-xs ${
              isActiveWayConfirmed
                ? 'border-slate-200 bg-slate-50/90 text-slate-700'
                : 'border-amber-300 bg-amber-50/90 text-amber-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isActiveWayConfirmed ? 'text-slate-500' : 'text-amber-700'
                  }`}
                  aria-hidden="true"
                />
                <span>{activeWarning.title}</span>
              </div>
              <div className="flex items-center gap-3">
                {activeWay !== 'catalog_or_bridge' && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium">
                    <input
                      type="checkbox"
                      checked={Boolean(warningConfirmed[activeWay])}
                      onChange={(e) =>
                        setWarningConfirmed((prev) => ({
                          ...prev,
                          [activeWay]: e.target.checked,
                        }))
                      }
                      className="rounded border-amber-400 accent-teal-700"
                    />
                    <span>Warnung verstanden — Verbindung freischalten</span>
                  </label>
                )}
                {isActiveWayConfirmed && (
                  <button
                    type="button"
                    onClick={() => setWarningDetailsOpen((v) => !v)}
                    className="font-mono text-[10px] text-slate-500 hover:text-slate-900 hover:underline"
                  >
                    {warningDetailsOpen ? 'Hinweise ausblenden' : 'Hinweise anzeigen'}
                  </button>
                )}
              </div>
            </div>

            {(!isActiveWayConfirmed || warningDetailsOpen) && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[11px] leading-snug">
                {activeWarning.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Inline Weg 4 Setup Helper when Cloud-GPU Tunnel URL is not yet entered */}
          {activeWay === 'cloud_tunnel' && !tunnelUrl.trim() && (
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-800">
                  Weg 4: Python-Notebook im Browser bei Kaggle/Colab starten (<strong>nicht</strong> in Windows PowerShell!):
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <a
                    href="https://www.kaggle.com/code"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-slate-100"
                  >
                    Kaggle ↗
                  </a>
                  <a
                    href="https://colab.research.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-slate-100"
                  >
                    Colab ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const ipynb = buildCloudNotebookIpynb(cloudPlatform, cloudScriptModel);
                      const blob = new Blob([ipynb], { type: 'application/json;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `cloud-gpu-${cloudPlatform}-abliterated.ipynb`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900 hover:bg-teal-100"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    .ipynb laden
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(buildCloudNotebookScript(cloudPlatform, cloudScriptModel));
                    }}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    Python-Zelle kopieren
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="text"
                  value={tunnelUrl}
                  onChange={(e) => setTunnelUrl(e.target.value)}
                  placeholder="https://xxxx-xxxx.trycloudflare.com/v1 hier einfügen…"
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[11px] text-slate-900 focus:border-teal-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleTestTunnelModels()}
                  disabled={!tunnelUrl.trim() || tunnelLoading}
                  className="shrink-0 rounded bg-teal-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                >
                  Prüfen
                </button>
              </div>
            </div>
          )}

          {/* Chat Message Feed */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="mx-auto max-w-2xl py-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Coding-Studio bereit
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Stelle Architektur-, Bugfix-, Refactoring- oder Security-Fragen. Lade bei Bedarf links einen Projektordner oder Dateien hoch, hefte relevante Dateien per <span className="font-mono">@</span> an und übernehme generierte Codeblöcke mit einem Klick in den Editor.
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {QUICK_CODING_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setPromptInput(q)}
                      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-left text-xs leading-relaxed text-slate-700 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isError = msg.role === 'error';
                const thinkingOpen = Boolean(expandedThinkingIds[msg.id]);

                return (
                  <article
                    key={msg.id}
                    className={`rounded-lg border p-3.5 ${
                      isUser
                        ? 'ml-auto max-w-3xl border-teal-200 bg-teal-50/50'
                        : isError
                          ? 'border-red-200 bg-red-50'
                          : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-1.5 font-mono text-[10px] text-slate-500">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-semibold uppercase ${
                            isUser
                              ? 'text-teal-800'
                              : isError
                                ? 'text-red-700'
                                : 'text-slate-900'
                          }`}
                        >
                          {isUser ? 'DU' : isError ? 'FEHLER' : msg.model || 'ASSISTENT'}
                        </span>
                        <span className="tabular-nums">{msg.createdAt}</span>
                        {typeof msg.latencyMs === 'number' && (
                          <span className="tabular-nums">{msg.latencyMs} ms</span>
                        )}
                        {msg.usage?.total_tokens && (
                          <span className="tabular-nums">{msg.usage.total_tokens} tok</span>
                        )}
                      </div>

                      {!isUser && !isError && (() => {
                        const detectedBlocks = extractCodeBlocksWithPaths(msg.content);
                        const isLastAssistant = messages[messages.length - 1]?.id === msg.id;
                        return (
                          <div className="flex flex-wrap items-center gap-2.5">
                            {detectedBlocks.length > 0 && (
                              <button
                                type="button"
                                onClick={() => void handleSaveAllCodeBlocks(msg)}
                                className="inline-flex items-center gap-1 font-medium text-teal-700 hover:text-teal-900"
                                title="Alle Codeblöcke dieser Antwort real in coding-workspace/ anlegen"
                              >
                                {savedFilesMsgId === msg.id ? (
                                  <>
                                    <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                                    Angelegt
                                  </>
                                ) : (
                                  <>
                                    <FilePlus2 className="h-3 w-3" aria-hidden="true" />
                                    Dateien anlegen ({detectedBlocks.length})
                                  </>
                                )}
                              </button>
                            )}
                            {isLastAssistant && !sending && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleSendMessage(
                                    'Fahre exakt an der Stelle fort, an der deine letzte Antwort aufgehört hat, ohne bereits geschriebenen Text zu wiederholen.'
                                  )
                                }
                                className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-teal-800"
                                title="Nahtlos weiter generieren, falls die Antwort abgeschnitten wurde"
                              >
                                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                                Weiter generieren
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleRememberMessage(msg)}
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-teal-700"
                              title="Dauerhaft im sitzungsübergreifenden Gedächtnis merken"
                            >
                              {rememberedMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                                  Gemerkt
                                </>
                              ) : (
                                <>
                                  <Brain className="h-3 w-3" aria-hidden="true" />
                                  Merken
                                </>
                              )}
                            </button>
                            {speechTtsSupported && (
                              <button
                                type="button"
                                onClick={() => handleToggleSpeakMessage(msg)}
                                className="inline-flex items-center gap-1 text-slate-600 hover:text-teal-700"
                                title="Antwort lokal im Browser vorlesen"
                              >
                                {speakingMsgId === msg.id ? (
                                  <>
                                    <VolumeX className="h-3 w-3 text-rose-600" aria-hidden="true" />
                                    Stop
                                  </>
                                ) : (
                                  <>
                                    <Volume2 className="h-3 w-3" aria-hidden="true" />
                                    Vorlesen
                                  </>
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleSaveReplyToKb(msg)}
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-teal-700"
                            >
                              {savedKbMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                                  Gespeichert
                                </>
                              ) : (
                                <>
                                  <BookmarkPlus className="h-3 w-3" aria-hidden="true" />
                                  In Wissen
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(msg.content);
                                setCopiedMsgId(msg.id);
                                setTimeout(() => setCopiedMsgId(null), 1400);
                              }}
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
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
                        );
                      })()}
                    </div>

                    {/* Collapsible Thinking / Reasoning Trace */}
                    {msg.thinking && (
                      <div className="mb-3 rounded-md border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedThinkingIds((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Brain className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                            <span>Gedankengang (Thinking)</span>
                            <span className="font-mono text-[10px] tabular-nums text-slate-400">
                              {msg.thinking.length} Zeichen
                            </span>
                          </span>
                          {thinkingOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          )}
                        </button>
                        {thinkingOpen && (
                          <div className="max-h-64 overflow-y-auto border-t border-slate-200 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-600">
                            {msg.thinking}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Collapsible Executed Workspace / Notebook Tools Trace */}
                    {msg.toolEvents && msg.toolEvents.length > 0 && (
                      <div className="mb-3 rounded-md border border-teal-200 bg-teal-50/40">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedToolIds((prev) => ({
                              ...prev,
                              [msg.id]: !prev[msg.id],
                            }))
                          }
                          className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-medium text-teal-950 hover:bg-teal-50"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Wrench className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                            <span>Tools ausgeführt ({msg.toolEvents.length})</span>
                          </span>
                          {expandedToolIds[msg.id] ? (
                            <ChevronDown className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                          )}
                        </button>
                        {expandedToolIds[msg.id] && (
                          <div className="space-y-1.5 border-t border-teal-200/80 p-2.5">
                            {msg.toolEvents.map((ev) => (
                              <div
                                key={ev.id}
                                className="rounded border border-slate-200 bg-white p-2 font-mono text-[10px]"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-900">{ev.tool}</span>
                                  <span className={ev.ok ? 'text-emerald-700' : 'text-red-700'}>
                                    {ev.ok ? 'OK' : 'FEHLER'}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-slate-600">{ev.summary}</div>
                                {ev.resultPreview && (
                                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-1.5 text-[10px] text-slate-700">
                                    {ev.resultPreview}
                                  </pre>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Content */}
                    {isUser || isError ? (
                      <div className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${isError ? 'text-red-900' : 'text-slate-900'}`}>
                        {msg.content}
                        {isError && /ZeroGPU|429|Rate-Limit|Zeitüberschreitung/i.test(msg.content) && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 font-sans">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveWay('ai_horde');
                                if (hordeModels.length > 0) setHordeModel(hordeModels[0].name);
                                else setHordeModel('koboldcpp/gemma-4-31B-it-heretic');
                                setRightTab('connection');
                                setShowRightDrawer(true);
                              }}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                            >
                              Zu Weg 2 · AI Horde wechseln
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveWay('free_uncensored_api');
                                setFreeApiPresetId('pollinations');
                                setFreeApiModel('openai');
                                setRightTab('connection');
                                setShowRightDrawer(true);
                              }}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                            >
                              Zu Weg 3 · Pollinations (Ohne Key)
                            </button>
                            {/ZeroGPU/i.test(msg.content) && (
                              <a
                                href="https://huggingface.co/settings/tokens"
                                target="_blank"
                                rel="noreferrer"
                                className="rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-900 hover:bg-teal-100"
                              >
                                Kostenlosen HF-Token holen ↗
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <ChatMarkdownMessage
                        content={msg.content}
                        onApplyCode={(code, lang, suggestedPath) => void handleApplyCodeBlock(code, lang, suggestedPath)}
                        onPreviewDiff={(code, lang, suggestedPath, isPatch) =>
                          void handlePreviewDiff(code, lang, suggestedPath, isPatch)
                        }
                        applyCodeLabel="In coding-workspace/ speichern"
                      />
                    )}

                    {msg.rawPreview && (
                      <pre className="mt-2 max-h-40 overflow-auto rounded border border-red-200 bg-white p-2 font-mono text-[10px] text-red-900">
                        {msg.rawPreview}
                      </pre>
                    )}

                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.attachments.map((att, idx) => (
                          <span
                            key={`${att.name}-${idx}`}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-600"
                          >
                            {att.kind === 'image' ? (
                              <ImageIcon className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <FileText className="h-3 w-3" aria-hidden="true" />
                            )}
                            {att.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.contextSources && msg.contextSources.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
                        <span className="font-mono uppercase">Kontext:</span>
                        {msg.contextSources.map((src) => (
                          <span
                            key={src.id}
                            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-slate-700"
                          >
                            {src.sourceType === 'knowledge' ? 'KB' : 'Chat'}: {src.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })
            )}

            {sending && (
              <article
                data-testid="live-stream-card"
                className="space-y-2 rounded-lg border border-teal-200 bg-white px-3.5 py-3 shadow-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                  <span className="font-medium text-teal-800">
                    {liveStream?.status ||
                      `Generiere Antwort (${activeTargetLabel} · ${activeDisplayModel})…`}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                    {activeDisplayModel} · Streaming aktiv
                  </span>
                </div>

                {liveStream && liveStream.toolEvents.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-600">
                    {liveStream.toolEvents.map((te) => (
                      <span key={te.id}>
                        Tool: {te.tool} ({te.ok ? 'OK' : 'Fehler'})
                      </span>
                    ))}
                  </div>
                )}

                {liveStream?.thinking && (
                  <details open className="rounded border border-slate-200 bg-slate-50 p-2">
                    <summary className="cursor-pointer font-mono text-[10px] font-medium text-slate-600">
                      Gedankengang (Live · {liveStream.thinking.length} Zeichen)
                    </summary>
                    <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-600">
                      {liveStream.thinking}
                    </pre>
                  </details>
                )}

                {liveStream?.content ? (
                  <ChatMarkdownMessage content={liveStream.content} />
                ) : (
                  <div className="text-xs text-slate-500">Warte auf erste Tokens…</div>
                )}
              </article>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Composer Footer */}
          <div className="border-t border-slate-200 bg-slate-50/70 p-3">
            {/* Active Context Strip (Pinned Workspace Files + Pending Uploads) */}
            {(pinnedFilePaths.length > 0 || pendingUploads.length > 0) && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {pinnedFilePaths.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[10px] text-teal-900"
                  >
                    <span>@{p}</span>
                    <button
                      type="button"
                      onClick={() => setPinnedFilePaths((prev) => prev.filter((x) => x !== p))}
                      aria-label={`${p} entfernen`}
                      className="text-teal-700 hover:text-teal-950"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                {pendingUploads.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-[10px] text-slate-700"
                  >
                    {att.kind === 'image' ? (
                      <ImageIcon className="h-3 w-3 text-teal-700" aria-hidden="true" />
                    ) : (
                      <Paperclip className="h-3 w-3 text-slate-500" aria-hidden="true" />
                    )}
                    <span>{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingUploads((prev) => prev.filter((x) => x.id !== att.id))}
                      aria-label={`${att.name} entfernen`}
                      className="text-slate-400 hover:text-slate-900"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => chatAttachmentRef.current?.click()}
                  title="Code-Datei oder Screenshot anhängen"
                  className="rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  <Paperclip className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!promptInput.trim()) return;
                    setPromptInput(buildLocalImprovedPrompt(promptInput, 'coding'));
                  }}
                  title="Prompt technisch präzisieren"
                  className="rounded-md border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-100 hover:text-teal-700"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </button>
                {speechSttSupported && (
                  <button
                    type="button"
                    onClick={handleToggleDictation}
                    title={dictating ? 'Spracheingabe stoppen' : 'Lokal per Mikrofon diktieren (Browser Speech-API)'}
                    aria-label="Spracheingabe umschalten"
                    className={`rounded-md border p-2 ${
                      dictating
                        ? 'border-rose-500 bg-rose-50 text-rose-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 hover:text-teal-700'
                    }`}
                  >
                    {dictating ? (
                      <MicOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Mic className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>

              <textarea
                rows={chatMaximized ? 4 : 3}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void handleSendMessage();
                    }
                  }
                }}
                placeholder="Coding-Aufgabe eingeben… (Enter zum Senden, Shift+Enter für Zeilenumbruch)"
                className="min-w-0 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-xs leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none"
              />

              {sending ? (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-3.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  <Square className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSendMessage()}
                  disabled={
                    (!promptInput.trim() && pendingUploads.length === 0) ||
                    !isActiveWayConfirmed ||
                    isMissingCloudTunnelUrl
                  }
                  title={
                    !isActiveWayConfirmed
                      ? 'Bitte zuerst oben die Warnung für diese Verbindung bestätigen.'
                      : isMissingCloudTunnelUrl
                        ? 'Bitte zuerst die HTTPS-Tunnel-URL aus Kaggle/Colab einfügen.'
                        : 'Anfrage senden'
                  }
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-teal-700 px-4 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {!isActiveWayConfirmed
                      ? 'Erst bestätigen'
                      : isMissingCloudTunnelUrl
                        ? 'Tunnel-URL fehlt'
                        : 'Senden'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT PANE: 4-Tab Drawer (Verbindung, Tools, Notebooks, Gedächtnis & Gadgets) */}
        {!chatMaximized && showRightDrawer && (
          <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
            {/* Segmented Drawer Tabs */}
            <div className="grid grid-cols-4 border-b border-slate-200 bg-slate-50 p-1 text-[10px]">
              <button
                type="button"
                onClick={() => setRightTab('connection')}
                className={`rounded px-1 py-1.5 font-medium truncate ${
                  rightTab === 'connection'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Verbindung
              </button>
              <button
                type="button"
                onClick={() => setRightTab('tools')}
                className={`rounded px-1 py-1.5 font-medium truncate ${
                  rightTab === 'tools'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tools
              </button>
              <button
                type="button"
                onClick={() => setRightTab('notebooks')}
                className={`rounded px-1 py-1.5 font-medium truncate ${
                  rightTab === 'notebooks'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Notebooks
              </button>
              <button
                type="button"
                data-testid="right-tab-gadgets"
                onClick={() => setRightTab('gadgets')}
                className={`rounded px-1 py-1.5 font-medium truncate ${
                  rightTab === 'gadgets'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Gedächtnis
              </button>
            </div>

            {rightTab === 'gadgets' ? (
              <div className="flex-1 overflow-y-auto p-3">
                <CodingGadgetsPanel
                  memoryStore={memoryStore}
                  budget={estimateContextTokenBudget({
                    systemText: `${CODING_ROLE_PROMPTS[codingRole].prompt}\n${customSystemPrompt}`,
                    memoryText: compileMemorySystemBlock(memoryStore, 4000).block,
                    pinnedFilesText: pinnedFilePaths.map((p) => filesMap[p]?.content || '').join('\n'),
                    historyTexts: (activeChat?.messages || []).map((m) => m.content),
                    contextWindow:
                      activeWay === 'free_uncensored_api'
                        ? activeFreePreset.contextWindow || 65_536
                        : activeWay === 'cloud_tunnel'
                          ? tunnelNumCtx
                          : 32_768,
                  })}
                  activeFilePath={activeFilePath}
                  speechSttSupported={speechSttSupported}
                  speechTtsSupported={speechTtsSupported}
                  onSaveEntry={handleSaveMemoryEntry}
                  onToggleAutoInject={(next) =>
                    handleUpdateMemoryStore({
                      ...memoryStore,
                      autoInject: next,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  onToggleEntry={(id) =>
                    handleUpdateMemoryStore({
                      ...memoryStore,
                      entries: memoryStore.entries.map((e) =>
                        e.id === id ? { ...e, enabled: !e.enabled, updatedAt: new Date().toISOString() } : e
                      ),
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  onDeleteEntry={handleDeleteMemoryEntry}
                  onImportStore={handleImportMemoryStore}
                  onInsertQuickPrompt={(text) => setPromptInput(text)}
                  onSelectNoTrackApi={() => {
                    setActiveWay('free_uncensored_api');
                    handleSelectFreeApiPreset('notrack-ai');
                    setRightTab('connection');
                  }}
                />
              </div>
            ) : rightTab !== 'notebooks' ? (
              <CodingConnectionSettings
                drawerSubTab={rightTab === 'tools' ? 'tools' : 'connection'}
                activeWay={activeWay}
                hfSpaceId={hfSpaceId}
                setHfSpaceId={setHfSpaceId}
                hfToken={hfToken}
                setHfToken={setHfToken}
                gpuDuration={gpuDuration}
                setGpuDuration={setGpuDuration}
                useDflash={useDflash}
                setUseDflash={setUseDflash}
                hfStatuses={hfStatuses}
                hfStatusLoading={hfStatusLoading}
                onRefreshHfStatus={() => void handleRefreshHfStatus()}
                hordeModel={hordeModel}
                setHordeModel={setHordeModel}
                hordeApiKey={hordeApiKey}
                setHordeApiKey={setHordeApiKey}
                hordeModels={hordeModels}
                hordeLoading={hordeLoading}
                hordeNote={hordeNote}
                onLoadHordeModels={() => void handleLoadHordeModels()}
                hordeMaxLength={hordeMaxLength}
                setHordeMaxLength={setHordeMaxLength}
                hordeMaxContextLength={hordeMaxContextLength}
                setHordeMaxContextLength={setHordeMaxContextLength}
                hordeRepPen={hordeRepPen}
                setHordeRepPen={setHordeRepPen}
                hordeTrustedWorkers={hordeTrustedWorkers}
                setHordeTrustedWorkers={setHordeTrustedWorkers}
                hordeSlowWorkers={hordeSlowWorkers}
                setHordeSlowWorkers={setHordeSlowWorkers}
                hordeAllowDowngrade={hordeAllowDowngrade}
                setHordeAllowDowngrade={setHordeAllowDowngrade}
                freeApiPresetId={freeApiPresetId}
                onSelectFreeApiPreset={handleSelectFreeApiPreset}
                freeApiKey={freeApiKey}
                setFreeApiKey={setFreeApiKey}
                freeApiModel={freeApiModel}
                setFreeApiModel={setFreeApiModel}
                freeApiLiveModels={freeApiLiveModels}
                freeApiLoading={freeApiLoading}
                freeApiNote={freeApiNote}
                onLoadFreeApiModels={() => void handleLoadFreeApiModels()}
                presencePenalty={presencePenalty}
                setPresencePenalty={setPresencePenalty}
                frequencyPenalty={frequencyPenalty}
                setFrequencyPenalty={setFrequencyPenalty}
                seedValue={seedValue}
                setSeedValue={setSeedValue}
                cloudPlatform={cloudPlatform}
                setCloudPlatform={setCloudPlatform}
                cloudScriptModel={cloudScriptModel}
                setCloudScriptModel={setCloudScriptModel}
                tunnelUrl={tunnelUrl}
                setTunnelUrl={setTunnelUrl}
                tunnelModel={tunnelModel}
                setTunnelModel={setTunnelModel}
                tunnelToken={tunnelToken}
                setTunnelToken={setTunnelToken}
                tunnelNumCtx={tunnelNumCtx}
                setTunnelNumCtx={setTunnelNumCtx}
                tunnelModels={tunnelModels}
                tunnelLoading={tunnelLoading}
                tunnelNote={tunnelNote}
                onTestTunnelModels={() => void handleTestTunnelModels()}
                targetType={targetType}
                switchTargetType={switchTargetType}
                usableProviders={usableProviders}
                filteredProviders={filteredProviders}
                selectedProviderId={selectedProviderId}
                setSelectedProviderId={setSelectedProviderId}
                selectedProvider={selectedProvider}
                providerSearch={providerSearch}
                setProviderSearch={setProviderSearch}
                onlyUnfiltered={onlyUnfiltered}
                setOnlyUnfiltered={setOnlyUnfiltered}
                sortUnfilteredFirst={sortUnfilteredFirst}
                setSortUnfilteredFirst={setSortUnfilteredFirst}
                allowlistedBridges={allowlistedBridges}
                selectedBridgeId={selectedBridgeId}
                setSelectedBridgeId={setSelectedBridgeId}
                selectedBridgeRuntime={selectedBridgeRuntime}
                verifiedBridgeModels={verifiedBridgeModels}
                bridgeTosConfirm={bridgeTosConfirm}
                setBridgeTosConfirm={setBridgeTosConfirm}
                executingBridgeId={executingBridgeId}
                onExecuteBridge={onExecuteBridge}
                onStopBridge={onStopBridge}
                onProbeBridge={onProbeBridge}
                endpointUrl={endpointUrl}
                setEndpointUrl={setEndpointUrl}
                modelId={modelId}
                setModelId={setModelId}
                apiKey={apiKey}
                setApiKey={setApiKey}
                availableModels={availableModels}
                setAvailableModels={setAvailableModels}
                loadingModels={loadingModels}
                modelsNote={modelsNote}
                setModelsNote={setModelsNote}
                onLoadCatalogModels={() => void handleLoadModels()}
                temperature={temperature}
                setTemperature={setTemperature}
                maxTokens={maxTokens}
                setMaxTokens={setMaxTokens}
                topP={topP}
                setTopP={setTopP}
                topK={topK}
                setTopK={setTopK}
                repetitionPenalty={repetitionPenalty}
                setRepetitionPenalty={setRepetitionPenalty}
                enabledTools={enabledTools}
                onToggleTool={(id) =>
                  setEnabledTools((prev) =>
                    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
                  )
                }
                onSetAllTools={(all) =>
                  setEnabledTools(all ? CODING_TOOL_DEFINITIONS.map((t) => t.id) : [])
                }
                thinkingMode={thinkingMode}
                setThinkingMode={setThinkingMode}
                codingRole={codingRole}
                setCodingRole={setCodingRole}
                roleOptions={Object.entries(CODING_ROLE_PROMPTS).map(([id, cfg]) => ({
                  id: id as CodingRolePreset,
                  label: cfg.label,
                }))}
                autoInjectTree={autoInjectTree}
                setAutoInjectTree={setAutoInjectTree}
                autoInjectActiveFile={autoInjectActiveFile}
                setAutoInjectActiveFile={setAutoInjectActiveFile}
                customSystemPrompt={customSystemPrompt}
                setCustomSystemPrompt={setCustomSystemPrompt}
              />
            ) : (
              /* NOTEBOOKS & KNOWLEDGE BASE TAB */
              <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
                {/* Project Switcher */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      Notebook / Projekt
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewProjectForm((v) => !v)}
                      className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      Neu
                    </button>
                  </div>

                  {showNewProjectForm && (
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        placeholder="Projektname…"
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={handleCreateProject}
                        className="rounded bg-teal-700 px-2 py-1 text-[11px] font-medium text-white"
                      >
                        OK
                      </button>
                    </div>
                  )}

                  <select
                    aria-label="Aktives Projekt"
                    value={activeProject?.id || ''}
                    onChange={(e) => {
                      const pid = e.target.value;
                      updateNotebookWs((ws) => ({ ...ws, activeProjectId: pid }));
                    }}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-900"
                  >
                    {notebookWs.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.chats.length} Chats · {p.knowledgeDocs.length} KB)
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between font-mono text-[10px] text-slate-400">
                    <span>
                      {nbSaveState === 'saving'
                        ? 'Speichert…'
                        : nbSaveState === 'error'
                          ? 'Speicherfehler'
                          : 'Lokal gespeichert'}
                    </span>
                    <div className="flex items-center gap-2 text-slate-600">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={activeProject?.knowledgeBaseEnabled ?? true}
                          onChange={(e) =>
                            updateNotebookWs((ws) => ({
                              ...ws,
                              projects: ws.projects.map((p) =>
                                p.id === activeProject.id
                                  ? { ...p, knowledgeBaseEnabled: e.target.checked }
                                  : p
                              ),
                            }))
                          }
                        />
                        Wissen
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={activeProject?.crossChatMemoryEnabled ?? true}
                          onChange={(e) =>
                            updateNotebookWs((ws) => ({
                              ...ws,
                              projects: ws.projects.map((p) =>
                                p.id === activeProject.id
                                  ? { ...p, crossChatMemoryEnabled: e.target.checked }
                                  : p
                              ),
                            }))
                          }
                        />
                        Cross-Chat
                      </label>
                    </div>
                  </div>
                </div>

                {/* Chats in Active Project */}
                <div className="space-y-1 border-t border-slate-200 pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      Chats im Projekt
                    </span>
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className="text-[11px] font-medium text-teal-700 hover:underline"
                    >
                      + Neuer Chat
                    </button>
                  </div>
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {activeProject?.chats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setActiveChatId(c.id)}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] ${
                          c.id === activeChat?.id
                            ? 'bg-teal-50 font-medium text-teal-900'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="truncate">{c.title}</span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-400">
                          {c.messages.length}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Knowledge Base Documents */}
                <div className="space-y-1.5 border-t border-slate-200 pt-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      Wissensdatenbank ({activeKnowledgeCount}/{activeProject?.knowledgeDocs.length ?? 0})
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => kbFileInputRef.current?.click()}
                        className="text-[11px] font-medium text-slate-600 hover:text-slate-900"
                      >
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowNewDocForm((v) => !v)}
                        className="text-[11px] font-medium text-teal-700 hover:underline"
                      >
                        + Notiz
                      </button>
                    </div>
                  </div>

                  {showNewDocForm && (
                    <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2">
                      <input
                        type="text"
                        value={newDocTitle}
                        onChange={(e) => setNewDocTitle(e.target.value)}
                        placeholder="Titel (z. B. API-Konventionen)"
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      />
                      <textarea
                        rows={3}
                        value={newDocContent}
                        onChange={(e) => setNewDocContent(e.target.value)}
                        placeholder="Wissen, Spezifikation oder Code-Richtlinien…"
                        className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={handleAddKnowledgeDoc}
                        className="w-full rounded bg-teal-700 py-1 text-[11px] font-medium text-white hover:bg-teal-800"
                      >
                        In Wissensdatenbank speichern
                      </button>
                    </div>
                  )}

                  <div className="max-h-44 space-y-1 overflow-y-auto">
                    {activeProject?.knowledgeDocs.length === 0 ? (
                      <p className="text-[11px] text-slate-500">
                        Noch keine Dokumente. Lade Spezifikationen/Docs hoch oder speichere Antworten aus dem Chat.
                      </p>
                    ) : (
                      activeProject?.knowledgeDocs.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between gap-1.5 rounded border border-slate-200 px-2 py-1.5"
                        >
                          <label className="flex min-w-0 flex-1 items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={doc.enabled}
                              onChange={(e) =>
                                updateNotebookWs((ws) => ({
                                  ...ws,
                                  projects: ws.projects.map((p) =>
                                    p.id === activeProject.id
                                      ? {
                                          ...p,
                                          knowledgeDocs: p.knowledgeDocs.map((d) =>
                                            d.id === doc.id ? { ...d, enabled: e.target.checked } : d
                                          ),
                                        }
                                      : p
                                  ),
                                }))
                              }
                            />
                            <span className="truncate text-[11px] text-slate-800">{doc.title}</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              updateNotebookWs((ws) => ({
                                ...ws,
                                projects: ws.projects.map((p) =>
                                  p.id === activeProject.id
                                    ? {
                                        ...p,
                                        knowledgeDocs: p.knowledgeDocs.filter((d) => d.id !== doc.id),
                                      }
                                    : p
                                ),
                              }))
                            }
                            aria-label={`${doc.title} löschen`}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Project Full-Text Search */}
                <div className="space-y-1.5 border-t border-slate-200 pt-2.5">
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={nbSearchQuery}
                      onChange={(e) => setNbSearchQuery(e.target.value)}
                      placeholder="Projekt-Wissen & Chats durchsuchen…"
                      className="w-full rounded border border-slate-300 py-1 pl-6 pr-2 text-[11px]"
                    />
                  </div>
                  {nbSearchHits.length > 0 && (
                    <div className="max-h-36 space-y-1 overflow-y-auto">
                      {nbSearchHits.slice(0, 6).map((hit) => (
                        <div
                          key={`${hit.sourceType}-${hit.id}-${hit.messageId || ''}`}
                          className="rounded border border-slate-200 bg-slate-50 p-1.5 text-[10px]"
                        >
                          <div className="font-mono font-semibold text-teal-800">
                            {hit.sourceType === 'knowledge' ? 'Wissen' : 'Chat'}: {hit.title}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-slate-600">{hit.snippet}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {pendingDiffReview && (
        <CodingDiffModal
          review={pendingDiffReview}
          applying={applyingDiff}
          onConfirm={() => void handleConfirmPendingDiff()}
          onCancel={() => setPendingDiffReview(null)}
        />
      )}
    </div>
  );
}
