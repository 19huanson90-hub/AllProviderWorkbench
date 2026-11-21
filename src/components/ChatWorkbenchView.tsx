import {
  Activity,
  AlertTriangle,
  BookmarkPlus,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  GitMerge,
  Globe,
  Image as ImageIcon,
  KeyRound,
  MessageSquare,
  Paperclip,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Server,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { DUCK2API_MODELS, resolveDefaultChatModel, type ChatTargetType } from '../lib/chatEngine.ts';
import {
  GROK_BRIDGE_CAPABILITIES,
  GROK_BRIDGE_MODELS,
  buildAiRefineMetaPrompt,
  buildLocalImprovedPrompt,
  createDefaultWorkspace,
  createId,
  retrieveProjectContext,
  type ChatAttachmentMeta,
  type GrokBridgeHealthz,
  type NotebookChatMessage,
  type NotebookChatThread,
  type NotebookProject,
  type NotebooksWorkspace,
  type PromptRefineMode,
} from '../lib/notebookEngine.ts';
import { buildConnectionSnippets, isUsableGreenOrGelb } from '../lib/testEngine.ts';
import type {
  BridgeRuntimeState,
  BridgeSelectionEntry,
  ClassifiedProvider,
} from '../lib/types.ts';
import { ChatMarkdownMessage } from './ChatMarkdownMessage.tsx';
import { NotebookSidebarPanel } from './NotebookSidebarPanel.tsx';
import { SecurityClassTag } from './SecurityIndicator.tsx';

export interface ChatTargetPreset {
  targetType: ChatTargetType;
  bridgeId?: string;
  providerId?: string;
  endpointUrl?: string;
  nonce: number;
}

interface PendingAttachment extends ChatAttachmentMeta {
  id: string;
  dataUrl?: string; // for images
  textContent?: string; // for text/code files
}

interface ChatWorkbenchViewProps {
  providers: ClassifiedProvider[];
  bridgeSelections: BridgeSelectionEntry[];
  bridgeRuntimes: BridgeRuntimeState[];
  executingBridgeId: string | null;
  initialTarget: ChatTargetPreset | null;
  onExecuteBridge: (bridgeId: string, confirmTosRisk: boolean) => Promise<void> | void;
  onStopBridge: (bridgeId: string) => Promise<void> | void;
  onProbeBridge: (bridgeId: string) => Promise<void> | void;
}

const LOCAL_PRESETS = [
  { label: 'Ollama', url: 'http://127.0.0.1:11434/v1', model: 'llama3.2' },
  { label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { label: 'vLLM', url: 'http://127.0.0.1:8000/v1', model: 'default' },
  { label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', model: 'default' },
];

const STARTER_PROMPTS = [
  'Verbindungstest: Nenne kurz dein aktives Modell und bestätige mit „Bereit“.',
  'Fasse alle aktiven Wissensdokumente und wichtigen Punkte aus anderen Chats dieses Projekts zusammen.',
  'Recherchiere aktuelle Entwicklungen zu lokalen KI-Inferenz-Engines mit Quellenangaben.',
  'Erstelle mit Grok Imagine ein minimalistisches technisches Architektur-Schaubild eines lokalen KI-Routers.',
];

export function ChatWorkbenchView({
  providers,
  bridgeSelections,
  bridgeRuntimes,
  executingBridgeId,
  initialTarget,
  onExecuteBridge,
  onStopBridge,
  onProbeBridge,
}: ChatWorkbenchViewProps) {
  const allowlistedBridges = useMemo(
    () => bridgeSelections.filter((b) => b.bridge_id && b.docker_capable && b.port),
    [bridgeSelections]
  );

  // Precompute snippets once per provider for crisp sorting & readiness labeling
  const providerMetaMap = useMemo(() => {
    const map = new Map<
      string,
      {
        supportsOpenAi: boolean;
        isLocal: boolean;
        isKeylessCloud: boolean;
        readinessTag: string;
        defaultApiBase: string;
      }
    >();
    for (const p of providers) {
      const sn = buildConnectionSnippets(p);
      const isLocal = p.kategorien.includes('lokal_self_hosted');
      const isKeylessCloud = sn.supportsOpenAiEndpoints && !isLocal && p.auth_typ === 'keine';
      const readinessTag = !sn.supportsOpenAiEndpoints
        ? 'Nur Portal/SDK'
        : isLocal
          ? 'Lokal 127.0.0.1'
          : p.auth_typ === 'keine'
            ? 'Ohne Key'
            : 'API-Key';
      map.set(p.id, {
        supportsOpenAi: sn.supportsOpenAiEndpoints,
        isLocal,
        isKeylessCloud,
        readinessTag,
        defaultApiBase: sn.defaultApiBase,
      });
    }
    return map;
  }, [providers]);

  const usableProviders = useMemo(() => {
    const list = providers.filter((p) => isUsableGreenOrGelb(p));
    // Sort order: 1) Keyless GRÜN REST, 2) Keyless GELB REST, 3) GRÜN Cloud REST, 4) GRÜN Lokal, 5) GELB REST, 6) Non-REST
    const rank = (p: ClassifiedProvider) => {
      const m = providerMetaMap.get(p.id);
      if (!m || !m.supportsOpenAi) return 50;
      if (m.isKeylessCloud && p.securityClass === 'GRUEN') return 0;
      if (m.isKeylessCloud && p.securityClass === 'GELB') return 5;
      if (!m.isLocal && p.securityClass === 'GRUEN') return 10;
      if (m.isLocal && p.securityClass === 'GRUEN') return 20;
      if (!m.isLocal && p.securityClass === 'GELB') return 30;
      return 40;
    };
    return list.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, 'de');
    });
  }, [providers, providerMetaMap]);

  const defaultProviderId = useMemo(() => {
    const preferred = ['ovh-ai-endpoints', 'pollinations', 'opencode-zen', 'groq', 'openrouter'];
    for (const pid of preferred) {
      if (usableProviders.some((p) => p.id === pid)) return pid;
    }
    return usableProviders[0]?.id ?? '';
  }, [usableProviders]);

  const defaultBridgeId = useMemo(() => {
    // Prefer running bridge, else grok-com-to-openai, else first allowlisted
    const running = allowlistedBridges.find((b) =>
      bridgeRuntimes.some((rt) => rt.bridgeId === b.bridge_id && rt.status === 'running')
    );
    if (running?.bridge_id) return running.bridge_id;
    const grok = allowlistedBridges.find((b) => b.bridge_id === 'grok-com-to-openai');
    if (grok?.bridge_id) return grok.bridge_id;
    return allowlistedBridges[0]?.bridge_id ?? '';
  }, [allowlistedBridges, bridgeRuntimes]);

  // =========================================================================
  // Persistent Projects / Notebooks Workspace State
  // =========================================================================
  const [workspace, setWorkspace] = useState<NotebooksWorkspace>(() => createDefaultWorkspace());
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string>('chat-default-1');
  const [activeRailTab, setActiveRailTab] = useState<
    'notebook' | 'knowledge' | 'chrono' | 'connection'
  >('connection');
  const [saveIndicator, setSaveIndicator] = useState<'saved' | 'saving' | 'error'>('saved');
  const [runningChronoJobId, setRunningChronoJobId] = useState<string | null>(null);

  // Connection controls
  const [targetType, setTargetType] = useState<ChatTargetType>('bridge');
  const [selectedBridgeId, setSelectedBridgeId] = useState<string>(defaultBridgeId);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(defaultProviderId);
  const [providerSearch, setProviderSearch] = useState<string>('');
  const [onlyDirectRestProviders, setOnlyDirectRestProviders] = useState<boolean>(true);
  const [allowManualNonRestOverride, setAllowManualNonRestOverride] = useState<boolean>(false);
  const [endpointUrl, setEndpointUrl] = useState<string>(() => {
    const b = allowlistedBridges.find((x) => x.bridge_id === defaultBridgeId) || allowlistedBridges[0];
    return b?.port ? `http://127.0.0.1:${b.port}/v1` : 'http://127.0.0.1:4000/v1';
  });
  const [modelId, setModelId] = useState<string>(
    resolveDefaultChatModel(undefined, defaultBridgeId)
  );
  const [apiKey, setApiKey] = useState<string>('');
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.4);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [includeSources, setIncludeSources] = useState<boolean>(true);
  const [showCapabilities, setShowCapabilities] = useState<boolean>(false);

  // Live Bridge /healthz state (for Grok Account Pool)
  const [bridgeHealthz, setBridgeHealthz] = useState<GrokBridgeHealthz | null>(null);
  const [loadingHealthz, setLoadingHealthz] = useState<boolean>(false);

  // Models loader
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState<boolean>(false);
  const [modelsNote, setModelsNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Bridge execution UI state
  const [tosConfirmedMap, setTosConfirmedMap] = useState<Record<string, boolean>>({});
  const [probingBridge, setProbingBridge] = useState<boolean>(false);

  // Chat composer, attachments & prompt refiner state
  const [draft, setDraft] = useState<string>('');
  const [previousDraftBeforeRefine, setPreviousDraftBeforeRefine] = useState<string | null>(null);
  const [refineMode, setRefineMode] = useState<PromptRefineMode>('structured');
  const [refiningWithAi, setRefiningWithAi] = useState<boolean>(false);
  const [refineNote, setRefineNote] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedToKbMsgId, setSavedToKbMsgId] = useState<string | null>(null);
  const [editingChatTitle, setEditingChatTitle] = useState<boolean>(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted local notebooks from /api/notebooks on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/notebooks');
        const json = (await res.json()) as { ok?: boolean; workspace?: NotebooksWorkspace };
        if (active && json.ok && json.workspace && json.workspace.projects.length > 0) {
          setWorkspace(json.workspace);
          const proj =
            json.workspace.projects.find((p) => p.id === json.workspace?.activeProjectId) ||
            json.workspace.projects[0];
          if (proj?.chats[0]) {
            setActiveChatId(proj.chats[0].id);
          }
        }
      } catch {
        // Fallback to default in-memory workspace
      } finally {
        if (active) setWorkspaceLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Debounced atomic persistence to /api/notebooks whenever workspace changes
  const persistWorkspace = useCallback((nextWs: NotebooksWorkspace) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveIndicator('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/notebooks', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace: nextWs }),
        });
        setSaveIndicator(res.ok ? 'saved' : 'error');
      } catch {
        setSaveIndicator('error');
      }
    }, 350);
  }, []);

  const updateWorkspace = useCallback(
    (updater: (prev: NotebooksWorkspace) => NotebooksWorkspace) => {
      setWorkspace((prev) => {
        const next = updater(prev);
        if (workspaceLoaded) {
          persistWorkspace(next);
        }
        return next;
      });
    },
    [persistWorkspace, workspaceLoaded]
  );

  // Derived active project & chat
  const activeProject: NotebookProject = useMemo(() => {
    return (
      workspace.projects.find((p) => p.id === workspace.activeProjectId) ||
      workspace.projects[0] ||
      createDefaultWorkspace().projects[0]
    );
  }, [workspace]);

  const activeChat: NotebookChatThread = useMemo(() => {
    return (
      activeProject.chats.find((c) => c.id === activeChatId) ||
      activeProject.chats[0] || {
        id: 'chat-fallback',
        title: 'Haupt-Chat',
        targetType,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );
  }, [activeProject, activeChatId, targetType]);

  const messages = activeChat.messages;

  const updateActiveProject = useCallback(
    (updater: (proj: NotebookProject) => NotebookProject) => {
      updateWorkspace((prev) => ({
        ...prev,
        projects: prev.projects.map((p) => (p.id === activeProject.id ? updater(p) : p)),
      }));
    },
    [activeProject.id, updateWorkspace]
  );

  const updateActiveChat = useCallback(
    (updater: (chat: NotebookChatThread) => NotebookChatThread) => {
      updateActiveProject((proj) => ({
        ...proj,
        chats: proj.chats.map((c) => (c.id === activeChat.id ? updater(c) : c)),
        updatedAt: new Date().toISOString(),
      }));
    },
    [activeChat.id, updateActiveProject]
  );

  const runtimeById = useMemo(
    () => new Map(bridgeRuntimes.map((rt) => [rt.bridgeId, rt])),
    [bridgeRuntimes]
  );

  const activeBridge = useMemo(
    () => allowlistedBridges.find((b) => b.bridge_id === selectedBridgeId) ?? null,
    [allowlistedBridges, selectedBridgeId]
  );
  const activeBridgeRuntime = activeBridge?.bridge_id
    ? runtimeById.get(activeBridge.bridge_id)
    : undefined;

  const isGrokBridge = targetType === 'bridge' && selectedBridgeId === 'grok-com-to-openai';

  const activeProvider = useMemo(
    () => usableProviders.find((p) => p.id === selectedProviderId) ?? null,
    [usableProviders, selectedProviderId]
  );
  const activeProviderSnippets = useMemo(
    () => (activeProvider ? buildConnectionSnippets(activeProvider) : null),
    [activeProvider]
  );

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    return usableProviders
      .filter((p) => {
        if (onlyDirectRestProviders) {
          const meta = providerMetaMap.get(p.id);
          if (!meta?.supportsOpenAi && p.id !== selectedProviderId) return false;
        }
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q) ||
          p.url.toLowerCase().includes(q)
        );
      })
      .slice(0, 90);
  }, [usableProviders, providerSearch, onlyDirectRestProviders, providerMetaMap, selectedProviderId]);

  const fetchBridgeHealthz = useCallback(async (bridgeId: string) => {
    if (!bridgeId) return;
    setLoadingHealthz(true);
    try {
      const res = await fetch(`/api/bridges/${encodeURIComponent(bridgeId)}/healthz`);
      const json = (await res.json()) as {
        ok?: boolean;
        healthz?: GrokBridgeHealthz | null;
        models?: string[];
      };
      setBridgeHealthz(json.healthz || (json.ok ? { ok: true } : null));
      if (Array.isArray(json.models) && json.models.length > 0) {
        setAvailableModels(json.models);
        setModelId((cur) => {
          const trimmed = cur.trim();
          if (!trimmed || trimmed === 'default' || !json.models!.includes(trimmed)) {
            return json.models![0];
          }
          return cur;
        });
      }
    } catch {
      setBridgeHealthz(null);
    } finally {
      setLoadingHealthz(false);
    }
  }, []);

  useEffect(() => {
    if (targetType === 'bridge' && selectedBridgeId) {
      void fetchBridgeHealthz(selectedBridgeId);
    }
  }, [targetType, selectedBridgeId, activeBridgeRuntime?.status, fetchBridgeHealthz]);

  // Apply external preselection when user clicks "Im Chat öffnen" from Provider Drawer or Bridge View
  useEffect(() => {
    if (!initialTarget) return;
    setTargetType(initialTarget.targetType);
    setActiveRailTab('connection');
    setAvailableModels([]);
    setModelsNote(null);
    setAllowManualNonRestOverride(false);

    if (initialTarget.targetType === 'bridge' && initialTarget.bridgeId) {
      setSelectedBridgeId(initialTarget.bridgeId);
      const b = allowlistedBridges.find((x) => x.bridge_id === initialTarget.bridgeId);
      if (b?.port) {
        setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
      }
      setModelId(resolveDefaultChatModel(undefined, initialTarget.bridgeId));
    } else if (initialTarget.targetType === 'provider' && initialTarget.providerId) {
      setSelectedProviderId(initialTarget.providerId);
      const p = usableProviders.find((x) => x.id === initialTarget.providerId);
      if (p) {
        const sn = buildConnectionSnippets(p);
        if (!sn.supportsOpenAiEndpoints) {
          setOnlyDirectRestProviders(false);
        }
        setEndpointUrl(initialTarget.endpointUrl || sn.defaultApiBase);
      }
      setModelId(resolveDefaultChatModel(initialTarget.providerId, undefined));
    } else if (initialTarget.targetType === 'litellm') {
      setEndpointUrl(initialTarget.endpointUrl || 'http://127.0.0.1:4000/v1');
      setModelId('default');
    } else if (initialTarget.targetType === 'custom_local') {
      setEndpointUrl(initialTarget.endpointUrl || 'http://127.0.0.1:11434/v1');
    }
  }, [initialTarget, allowlistedBridges, usableProviders]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sending]);

  // Project / Chat handlers
  const handleSelectProject = (projectId: string) => {
    const targetProj = workspace.projects.find((p) => p.id === projectId);
    if (!targetProj) return;
    updateWorkspace((prev) => ({ ...prev, activeProjectId: projectId }));
    if (targetProj.chats[0]) {
      setActiveChatId(targetProj.chats[0].id);
    }
  };

  const handleCreateProject = (name: string, description: string, instructions: string) => {
    const now = new Date().toISOString();
    const newChatId = createId('chat');
    const newProj: NotebookProject = {
      id: createId('proj'),
      name,
      description,
      instructions:
        instructions ||
        'Antworte strukturiert, präzise und ehrlich auf Deutsch. Nutze die Wissensdatenbank und relevante Infos aus anderen Chats dieses Projekts.',
      crossChatMemoryEnabled: true,
      knowledgeBaseEnabled: true,
      knowledgeDocs: [],
      chats: [
        {
          id: newChatId,
          title: 'Erster Chat',
          pinned: false,
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl,
          modelId,
          messages: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      chronoJobs: [],
      createdAt: now,
      updatedAt: now,
    };
    updateWorkspace((prev) => ({
      ...prev,
      activeProjectId: newProj.id,
      projects: [newProj, ...prev.projects],
    }));
    setActiveChatId(newChatId);
  };

  const handleDeleteProject = (projectId: string) => {
    if (workspace.projects.length <= 1) return;
    const remaining = workspace.projects.filter((p) => p.id !== projectId);
    const nextProj = remaining[0];
    updateWorkspace((prev) => ({
      ...prev,
      activeProjectId: nextProj.id,
      projects: remaining,
    }));
    if (nextProj.chats[0]) setActiveChatId(nextProj.chats[0].id);
  };

  const handleCreateChat = (customTitle?: string) => {
    const now = new Date().toISOString();
    const chat: NotebookChatThread = {
      id: createId('chat'),
      title: customTitle || `Chat #${activeProject.chats.length + 1}`,
      pinned: false,
      targetType,
      bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
      providerId: targetType === 'provider' ? selectedProviderId : undefined,
      endpointUrl,
      modelId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    updateActiveProject((p) => ({
      ...p,
      chats: [chat, ...p.chats],
      updatedAt: now,
    }));
    setActiveChatId(chat.id);
  };

  const handleDeleteChat = (chatId: string) => {
    if (activeProject.chats.length <= 1) return;
    const remaining = activeProject.chats.filter((c) => c.id !== chatId);
    updateActiveProject((p) => ({
      ...p,
      chats: remaining,
      updatedAt: new Date().toISOString(),
    }));
    if (activeChatId === chatId && remaining[0]) {
      setActiveChatId(remaining[0].id);
    }
  };

  const handleRunChronoNow = async (jobId: string) => {
    setRunningChronoJobId(jobId);
    try {
      const res = await fetch('/api/notebooks/chrono/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          jobId,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        workspace?: NotebooksWorkspace;
      };
      if (json.workspace) {
        setWorkspace(json.workspace);
      }
    } finally {
      setRunningChronoJobId(null);
    }
  };

  // Connection selectors
  const handleSelectTargetType = (next: ChatTargetType) => {
    setTargetType(next);
    setAvailableModels([]);
    setModelsNote(null);
    setAllowManualNonRestOverride(false);
    if (next === 'bridge') {
      const b =
        allowlistedBridges.find((x) => x.bridge_id === selectedBridgeId) || allowlistedBridges[0];
      if (b?.bridge_id) {
        setSelectedBridgeId(b.bridge_id);
        setModelId(resolveDefaultChatModel(undefined, b.bridge_id));
      }
      if (b?.port) setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
    } else if (next === 'provider') {
      const p =
        usableProviders.find((x) => x.id === selectedProviderId) ||
        usableProviders.find((x) => x.id === defaultProviderId) ||
        usableProviders[0];
      if (p) {
        setSelectedProviderId(p.id);
        setEndpointUrl(buildConnectionSnippets(p).defaultApiBase);
        setModelId(resolveDefaultChatModel(p.id));
      } else {
        setModelId('default');
      }
    } else if (next === 'litellm') {
      setEndpointUrl('http://127.0.0.1:4000/v1');
      setModelId('default');
    } else if (next === 'custom_local') {
      setEndpointUrl('http://127.0.0.1:11434/v1');
    }
  };

  const handleSelectBridge = (bridgeId: string) => {
    setSelectedBridgeId(bridgeId);
    setAvailableModels([]);
    setModelsNote(null);
    const b = allowlistedBridges.find((x) => x.bridge_id === bridgeId);
    if (b?.port) {
      setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
    }
    setModelId(resolveDefaultChatModel(undefined, bridgeId));
  };

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId);
    setAvailableModels([]);
    setModelsNote(null);
    setAllowManualNonRestOverride(false);
    const p = usableProviders.find((x) => x.id === providerId);
    if (p) {
      setEndpointUrl(buildConnectionSnippets(p).defaultApiBase);
      setModelId(resolveDefaultChatModel(p.id));
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
          endpointUrl: endpointUrl.trim(),
          allowManualOverride: allowManualNonRestOverride,
          apiKey: apiKey.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        models?: string[];
        chatModels?: string[];
        nonChatModels?: string[];
        httpStatus?: number;
        latencyMs?: number;
        error?: string;
      };
      const chatOnly =
        Array.isArray(json.chatModels) && json.chatModels.length > 0
          ? json.chatModels
          : Array.isArray(json.models)
            ? json.models
            : [];
      const skippedNonChat = Array.isArray(json.nonChatModels) ? json.nonChatModels.length : 0;
      if (json.ok && chatOnly.length > 0) {
        setAvailableModels(chatOnly);
        if (!chatOnly.includes(modelId)) {
          setModelId(chatOnly[0]);
        }
        setModelsNote({
          ok: true,
          text: `${chatOnly.length} Chat-Modelle geladen (${json.latencyMs ?? 0} ms)${
            skippedNonChat > 0 ? ` · ${skippedNonChat} Nicht-Chat-Modelle (TTS/Whisper/Embed) ausgeblendet` : ''
          }.`,
        });
      } else if (json.ok) {
        setAvailableModels([]);
        setModelsNote({
          ok: true,
          text: `HTTP ${json.httpStatus ?? 200} — Endpunkt aktiv, aber leere Modell-Liste. Modell-ID manuell eingeben.`,
        });
      } else {
        setAvailableModels([]);
        setModelsNote({
          ok: false,
          text: json.error || `Modelle konnten nicht geladen werden (HTTP ${res.status}).`,
        });
      }
    } catch (err: unknown) {
      setModelsNote({
        ok: false,
        text: err instanceof Error ? err.message : 'Verbindungsfehler beim Laden der Modelle.',
      });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleProbeActiveBridge = async () => {
    if (!activeBridge?.bridge_id) return;
    setProbingBridge(true);
    try {
      await onProbeBridge(activeBridge.bridge_id);
      await fetchBridgeHealthz(activeBridge.bridge_id);
    } finally {
      setProbingBridge(false);
    }
  };

  // Composer File & Image Upload Handler
  const handleAttachFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const next: PendingAttachment[] = [];

    for (const file of Array.from(files).slice(0, 4)) {
      if (file.type.startsWith('image/')) {
        if (file.size > 5_000_000) continue;
        const dataUrl = await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        });
        if (dataUrl) {
          next.push({
            id: createId('att'),
            name: file.name,
            mimeType: file.type,
            kind: 'image',
            sizeBytes: file.size,
            dataUrl,
          });
        }
      } else {
        if (file.size > 1_500_000) continue;
        try {
          const text = await file.text();
          if (text.includes('\u0000')) continue;
          next.push({
            id: createId('att'),
            name: file.name,
            mimeType: file.type || 'text/plain',
            kind: 'text',
            sizeBytes: file.size,
            previewText: text.slice(0, 180),
            textContent: text.slice(0, 24000),
          });
        } catch {
          // ignore unreadable file
        }
      }
    }

    if (next.length > 0) {
      setAttachments((prev) => [...prev, ...next].slice(0, 4));
    }
    e.target.value = '';
  };

  // Prompt Refiner (Local instant OR via Active Model)
  const handleRefineLocal = () => {
    if (!draft.trim()) return;
    setPreviousDraftBeforeRefine(draft);
    const improved = buildLocalImprovedPrompt(draft, refineMode, activeProject.name);
    setDraft(improved);
    setRefineNote('Prompt lokal strukturiert (ohne API-Verbrauch).');
  };

  const handleRefineWithAi = async () => {
    if (!draft.trim() || refiningWithAi || sending) return;
    setPreviousDraftBeforeRefine(draft);
    setRefiningWithAi(true);
    setRefineNote(null);
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl: endpointUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          model: modelId.trim() || 'default',
          messages: [{ role: 'user', content: buildAiRefineMetaPrompt(draft, refineMode) }],
          temperature: 0.3,
          maxTokens: 1024,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; reply?: string; error?: string };
      if (json.ok && json.reply) {
        setDraft(json.reply.trim());
        setRefineNote('Prompt per aktivem Modell geschärft.');
      } else {
        setRefineNote(json.error || 'KI-Optimierung fehlgeschlagen — nutze „Strukturieren (Lokal)“.');
      }
    } catch {
      setRefineNote('Verbindungsfehler bei KI-Optimierung — nutze „Strukturieren (Lokal)“.');
    } finally {
      setRefiningWithAi(false);
    }
  };

  const isNonRestProvider =
    targetType === 'provider' &&
    Boolean(activeProviderSnippets && !activeProviderSnippets.supportsOpenAiEndpoints);
  const sendBlockedByNonRest = isNonRestProvider && !allowManualNonRestOverride;

  const handleSend = async (overrideText?: string) => {
    const rawText = (overrideText ?? draft).trim();
    if ((!rawText && attachments.length === 0) || sending || sendBlockedByNonRest) return;

    const currentAttachments = overrideText ? [] : attachments;
    const textFiles = currentAttachments.filter((a) => a.kind === 'text' && a.textContent);
    const imageFiles = currentAttachments.filter((a) => a.kind === 'image' && a.dataUrl);

    let fullPrompt = rawText || 'Analysiere die angehängte Datei bzw. das angehängte Bild.';
    if (textFiles.length > 0) {
      const blocks = textFiles.map(
        (f) => `\n\n--- Angehängte Datei: ${f.name} ---\n${f.textContent}`
      );
      fullPrompt = `${fullPrompt}${blocks.join('')}`;
    }

    const tsNow = new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // Retrieve local Knowledge Base + Cross-Chat context for this project!
    const rag = retrieveProjectContext({
      project: activeProject,
      activeChatId: activeChat.id,
      query: rawText || fullPrompt,
    });

    const combinedSystemPrompt = [rag.compiledSystemBlock, systemPrompt.trim()]
      .filter(Boolean)
      .join('\n\n');

    const userMsg: NotebookChatMessage = {
      id: createId('u'),
      role: 'user',
      content: rawText || `(Anhang: ${currentAttachments.map((a) => a.name).join(', ')})`,
      createdAt: tsNow,
      attachments:
        currentAttachments.length > 0
          ? currentAttachments.map((a) => ({
              name: a.name,
              mimeType: a.mimeType,
              kind: a.kind,
              sizeBytes: a.sizeBytes,
              previewText: a.previewText,
            }))
          : undefined,
    };

    const nextHistory = [...messages, userMsg];
    const autoTitle =
      messages.length === 0 && /^Haupt-Chat|^Erster Chat|^Chat #/i.test(activeChat.title)
        ? rawText.slice(0, 44) + (rawText.length > 44 ? '…' : '')
        : activeChat.title;

    updateActiveChat((c) => ({
      ...c,
      title: autoTitle || c.title,
      targetType,
      bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
      providerId: targetType === 'provider' ? selectedProviderId : undefined,
      endpointUrl: endpointUrl.trim(),
      modelId: modelId.trim() || 'default',
      messages: nextHistory,
      updatedAt: new Date().toISOString(),
    }));

    if (!overrideText) {
      setDraft('');
      setAttachments([]);
      setPreviousDraftBeforeRefine(null);
      setRefineNote(null);
    }
    setSending(true);

    const apiHistory = nextHistory
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m, idx, arr) => ({
        role: m.role as 'user' | 'assistant',
        content: idx === arr.length - 1 ? fullPrompt : m.content,
      }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl: endpointUrl.trim(),
          allowManualOverride: allowManualNonRestOverride,
          apiKey: apiKey.trim() || undefined,
          model: modelId.trim() || 'default',
          messages: apiHistory,
          systemPrompt: combinedSystemPrompt || undefined,
          images: imageFiles.map((img) => ({ dataUrl: img.dataUrl, name: img.name })),
          includeSources: isGrokBridge && includeSources,
          temperature,
          maxTokens,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        reply?: string;
        model?: string;
        httpStatus?: number;
        latencyMs?: number;
        targetUrl?: string;
        rawPreview?: string;
        error?: string;
        usage?: NotebookChatMessage['usage'];
      };

      const ts = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (json.ok && typeof json.reply === 'string') {
        const assistantMsg: NotebookChatMessage = {
          id: createId('a'),
          role: 'assistant',
          content: json.reply,
          createdAt: ts,
          model: json.model || modelId,
          latencyMs: json.latencyMs,
          httpStatus: json.httpStatus,
          targetUrl: json.targetUrl,
          contextSources: rag.citations.length > 0 ? rag.citations : undefined,
          usage: json.usage,
        };
        updateActiveChat((c) => ({
          ...c,
          messages: [...c.messages, assistantMsg],
          updatedAt: new Date().toISOString(),
        }));
      } else {
        const errMsg: NotebookChatMessage = {
          id: createId('e'),
          role: 'error',
          content: json.error || `Anfrage fehlgeschlagen (HTTP ${res.status}).`,
          createdAt: ts,
          latencyMs: json.latencyMs,
          httpStatus: json.httpStatus ?? res.status,
          targetUrl: json.targetUrl,
          rawPreview: json.rawPreview,
        };
        updateActiveChat((c) => ({
          ...c,
          messages: [...c.messages, errMsg],
          updatedAt: new Date().toISOString(),
        }));
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const errMsg: NotebookChatMessage = {
        id: createId('e'),
        role: 'error',
        content: isAbort
          ? 'Anfrage manuell abgebrochen.'
          : err instanceof Error
            ? err.message
            : 'Netzwerkfehler beim Senden.',
        createdAt: new Date().toLocaleTimeString('de-DE', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };
      updateActiveChat((c) => ({
        ...c,
        messages: [...c.messages, errMsg],
        updatedAt: new Date().toISOString(),
      }));
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const handleSaveReplyToKnowledge = (msg: NotebookChatMessage) => {
    const now = new Date().toISOString();
    const firstLine = msg.content.split('\n').find((l) => l.trim()) || 'Chat-Antwort';
    const title = firstLine.replace(/^#+\s*/, '').slice(0, 72);
    updateActiveProject((p) => ({
      ...p,
      knowledgeDocs: [
        {
          id: createId('doc'),
          title: `Notiz: ${title}`,
          sourceType: 'snippet',
          tags: ['chat', (msg.model || 'antwort').toLowerCase().slice(0, 20)],
          content: msg.content,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
        ...p.knowledgeDocs,
      ],
      updatedAt: now,
    }));
    setSavedToKbMsgId(msg.id);
    setTimeout(() => setSavedToKbMsgId((cur) => (cur === msg.id ? null : cur)), 2000);
  };

  const handleCopyMessage = async (msg: NotebookChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId((cur) => (cur === msg.id ? null : cur)), 1600);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const activeTitle =
    targetType === 'bridge'
      ? activeBridge
        ? `${activeBridge.zielprovider} — ${activeBridge.bridge_id}`
        : 'Keine Bridge gewählt'
      : targetType === 'provider'
        ? activeProvider?.name || 'Kein Provider gewählt'
        : targetType === 'litellm'
          ? 'LiteLLM-Router (GRÜN)'
          : 'Eigener lokaler OpenAI-Server';

  const cleanBaseDisplay = endpointUrl.trim().replace(/\/+$/, '');
  const activeKbCount = activeProject.knowledgeDocs.filter((d) => d.enabled).length;
  const siblingChatCount = Math.max(0, activeProject.chats.length - 1);

  const connectionPanelNode = (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Verbindungsziel</h2>
        <span className="font-mono text-[11px] text-slate-500">SSRF · Regel 1–5</span>
      </div>

      {/* 4-Mode Segmented Control */}
      <div
        role="tablist"
        aria-label="Chat-Zielmodus"
        className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2"
      >
        {(
          [
            { id: 'bridge', label: 'Bridge (ROT)', icon: GitMerge },
            { id: 'provider', label: 'Provider (G/Y)', icon: Zap },
            { id: 'litellm', label: 'LiteLLM-Router', icon: Server },
            { id: 'custom_local', label: 'Lokal (127.0.0.1)', icon: Activity },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = targetType === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleSelectTargetType(tab.id)}
              className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'border-teal-700 bg-teal-50 text-teal-900'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Mode-Specific Selector */}
      <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
        {targetType === 'bridge' && (
          <>
            <div>
              <label htmlFor="chat-bridge-select" className="block text-xs font-medium text-slate-700">
                Allowlist-Bridge (lokal 127.0.0.1)
              </label>
              <select
                id="chat-bridge-select"
                value={selectedBridgeId}
                onChange={(e) => handleSelectBridge(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {allowlistedBridges.map((b) => {
                  const rt = b.bridge_id ? runtimeById.get(b.bridge_id) : undefined;
                  const statusTxt =
                    rt?.status === 'running'
                      ? 'LÄUFT'
                      : rt?.status === 'error'
                        ? 'FEHLER'
                        : 'GESTOPPT';
                  return (
                    <option key={b.bridge_id} value={b.bridge_id!}>
                      {b.zielprovider} — {b.bridge_id} (:{b.port} · {statusTxt})
                    </option>
                  );
                })}
              </select>
            </div>

            {activeBridge && activeBridge.bridge_id && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-semibold text-red-700">
                    ROT · 127.0.0.1:{activeBridge.port}
                  </span>
                  <span
                    className={`font-mono text-[11px] font-semibold ${
                      activeBridgeRuntime?.status === 'running'
                        ? 'text-emerald-700'
                        : activeBridgeRuntime?.status === 'error'
                          ? 'text-red-700'
                          : 'text-slate-500'
                    }`}
                  >
                    {activeBridgeRuntime?.status === 'running'
                      ? 'LÄUFT'
                      : activeBridgeRuntime?.status === 'cloning'
                        ? 'KLONT…'
                        : activeBridgeRuntime?.status === 'starting'
                          ? 'STARTET…'
                          : activeBridgeRuntime?.status === 'error'
                            ? 'FEHLER'
                            : 'GESTOPPT'}
                  </span>
                </div>

                {activeBridgeRuntime?.status !== 'running' && (
                  <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded border border-red-200 bg-white p-2 text-[11px] text-slate-800">
                    <input
                      type="checkbox"
                      checked={Boolean(tosConfirmedMap[activeBridge.bridge_id])}
                      onChange={(e) =>
                        setTosConfirmedMap((prev) => ({
                          ...prev,
                          [activeBridge.bridge_id!]: e.target.checked,
                        }))
                      }
                      className="mt-0.5 h-3.5 w-3.5 accent-teal-700"
                    />
                    <span>ToS-Restrisiko (Regel 5) bestätigt — lokal starten</span>
                  </label>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {activeBridgeRuntime?.status !== 'running' && (
                    <button
                      type="button"
                      onClick={() =>
                        void onExecuteBridge(
                          activeBridge.bridge_id!,
                          Boolean(tosConfirmedMap[activeBridge.bridge_id!])
                        )
                      }
                      disabled={
                        !tosConfirmedMap[activeBridge.bridge_id] ||
                        executingBridgeId === activeBridge.bridge_id
                      }
                      className="inline-flex items-center gap-1 rounded bg-teal-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-teal-800 disabled:opacity-50"
                    >
                      {executingBridgeId === activeBridge.bridge_id ? (
                        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="h-3 w-3" aria-hidden="true" />
                      )}
                      Bridge starten
                    </button>
                  )}
                  {(activeBridgeRuntime?.status === 'running' || Boolean(activeBridgeRuntime?.pid)) && (
                    <button
                      type="button"
                      onClick={() => void onStopBridge(activeBridge.bridge_id!)}
                      className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-800 hover:bg-red-100"
                    >
                      <Square className="h-3 w-3" aria-hidden="true" />
                      Stoppen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleProbeActiveBridge()}
                    disabled={probingBridge}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Activity className="h-3 w-3 text-teal-700" aria-hidden="true" />
                    {probingBridge ? 'Prüfe…' : 'Loopback prüfen'}
                  </button>
                </div>

                {activeBridgeRuntime?.error && (
                  <p className="mt-2 text-[11px] text-red-700">{activeBridgeRuntime.error}</p>
                )}
                {activeBridgeRuntime?.lastProbeStatus && (
                  <p className="mt-1.5 font-mono text-[11px] text-slate-600">
                    Probe: {activeBridgeRuntime.lastProbeStatus}
                  </p>
                )}
                {activeBridgeRuntime &&
                  activeBridgeRuntime.logs.length > 0 &&
                  (activeBridgeRuntime.status === 'error' ||
                    activeBridgeRuntime.status === 'starting') && (
                    <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] leading-snug text-slate-200">
                      {activeBridgeRuntime.logs.slice(-6).join('\n')}
                    </pre>
                  )}
              </div>
            )}

            {/* DuckDuckGo AI (duck2api) Verified Quick-Model Selector */}
            {targetType === 'bridge' && selectedBridgeId === 'duck2api' && (
              <div className="space-y-2 rounded-md border border-teal-200 bg-teal-50/40 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-teal-950">DuckDuckGo AI Modelle (duck2api)</span>
                  <button
                    type="button"
                    onClick={() => void fetchBridgeHealthz('duck2api')}
                    disabled={loadingHealthz}
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-teal-800 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${loadingHealthz ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    /v1/models
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(availableModels.length > 0 ? availableModels : [...DUCK2API_MODELS]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModelId(m)}
                      className={`rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
                        modelId === m
                          ? 'border-teal-700 bg-teal-700 font-semibold text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-teal-500'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grok Bridge Specific Capabilities & Live /healthz Panel */}
            {isGrokBridge && (
              <div className="space-y-2.5 rounded-md border border-teal-200 bg-teal-50/40 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-teal-950">Grok-Bridge Funktionen</span>
                  <button
                    type="button"
                    onClick={() => void fetchBridgeHealthz('grok-com-to-openai')}
                    disabled={loadingHealthz}
                    className="inline-flex items-center gap-1 font-mono text-[10px] text-teal-800 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${loadingHealthz ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    /healthz
                  </button>
                </div>

                {bridgeHealthz && typeof bridgeHealthz.accounts === 'number' && (
                  <div className="grid grid-cols-3 gap-1.5 rounded border border-teal-200/70 bg-white p-2 text-center font-mono text-[10px]">
                    <div>
                      <div className="text-slate-500">Konten</div>
                      <div className="font-semibold text-emerald-700">
                        {bridgeHealthz.available ?? 0}/{bridgeHealthz.accounts}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Sessions</div>
                      <div className="font-semibold text-slate-900">
                        {bridgeHealthz.sessions ?? 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Quarantäne</div>
                      <div
                        className={`font-semibold ${
                          (bridgeHealthz.degraded_accounts ?? 0) > 0
                            ? 'text-amber-700'
                            : 'text-slate-900'
                        }`}
                      >
                        {bridgeHealthz.degraded_accounts ?? 0}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <span className="block text-[11px] font-medium text-slate-700">
                    Grok-Modus (Direktwahl)
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {GROK_BRIDGE_MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        title={m.desc}
                        onClick={() => setModelId(m.id)}
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                          modelId === m.id
                            ? 'border-teal-700 bg-teal-700 font-semibold text-white'
                            : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-2 rounded border border-teal-200/70 bg-white px-2.5 py-1.5 text-[11px] text-slate-800">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
                    <span className="truncate">
                      Web-/X-Quellen (<code className="font-mono text-[10px]">include_sources</code>)
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={includeSources}
                    onChange={(e) => setIncludeSources(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-700"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => setShowCapabilities((v) => !v)}
                  className="flex w-full items-center justify-between text-[11px] font-medium text-teal-800 hover:underline"
                >
                  <span>Was über die Grok-Bridge belegt möglich ist</span>
                  {showCapabilities ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {showCapabilities && (
                  <ul className="space-y-1.5 rounded border border-slate-200 bg-white p-2 text-[11px]">
                    {GROK_BRIDGE_CAPABILITIES.map((cap) => (
                      <li key={cap.id} className="leading-snug">
                        <span
                          className={`mr-1 font-mono text-[10px] font-semibold ${
                            cap.supported ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {cap.supported ? '[JA]' : '[NUR WEB]'}
                        </span>
                        <strong className="text-slate-900">{cap.label}:</strong>{' '}
                        <span className="text-slate-600">{cap.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {targetType === 'provider' && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="chat-provider-search"
                  className="block text-xs font-medium text-slate-700"
                >
                  Provider filtern ({filteredProviders.length})
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={onlyDirectRestProviders}
                    onChange={(e) => setOnlyDirectRestProviders(e.target.checked)}
                    className="h-3 w-3 accent-teal-700"
                  />
                  Nur direkt chatfähige APIs
                </label>
              </div>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="chat-provider-search"
                  type="text"
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  placeholder="z. B. ovh, pollinations, groq, mistral, ollama…"
                  className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-2.5 pl-8 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="chat-provider-select"
                className="block text-xs font-medium text-slate-700"
              >
                Provider auswählen
              </label>
              <select
                id="chat-provider-select"
                value={selectedProviderId}
                onChange={(e) => handleSelectProvider(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {filteredProviders.map((p) => {
                  const meta = providerMetaMap.get(p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      [{p.securityClass} · {meta?.readinessTag || 'API'}] {p.name}
                    </option>
                  );
                })}
              </select>
            </div>

            {activeProviderSnippets?.endpointNote && !isNonRestProvider && (
              <p className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700">
                {activeProviderSnippets.endpointNote}
              </p>
            )}

            {isNonRestProvider && activeProvider && activeProviderSnippets && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-950">
                <p className="flex items-center gap-1.5 font-semibold text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Kein direkter Chat-Endpunkt ({activeProviderSnippets.connectionKind})
                </p>
                <p className="mt-1 leading-relaxed">{activeProviderSnippets.endpointNote}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {/^https?:\/\//i.test(activeProvider.url) && (
                    <a
                      href={activeProvider.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-teal-800 hover:underline"
                    >
                      Offizielle Seite öffnen
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-1.5 border-t border-amber-200 pt-2 text-[11px] text-amber-900">
                  <input
                    type="checkbox"
                    checked={allowManualNonRestOverride}
                    onChange={(e) => setAllowManualNonRestOverride(e.target.checked)}
                    className="h-3.5 w-3.5 accent-teal-700"
                  />
                  Trotzdem manuellen HTTP-Endpunkt testen
                </label>
              </div>
            )}
          </>
        )}

        {targetType === 'litellm' && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50/70 p-2.5 text-[11px] text-emerald-950">
            Spricht den zentralen <strong>GRÜNEN LiteLLM-Router</strong> auf{' '}
            <code className="font-mono">127.0.0.1:4000/v1</code> an.
          </p>
        )}

        {targetType === 'custom_local' && (
          <div>
            <p className="text-[11px] text-slate-600">
              Schnellwahl für lokale OpenAI-kompatible Server (strikt 127.0.0.1):
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {LOCAL_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setEndpointUrl(preset.url);
                    setModelId(preset.model);
                  }}
                  className="rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-800 hover:bg-slate-100"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shared Connection Fields */}
        <div>
          <label htmlFor="chat-endpoint-url" className="block text-xs font-medium text-slate-700">
            OpenAI-kompatible Basis-URL
          </label>
          <input
            id="chat-endpoint-url"
            type="text"
            value={endpointUrl}
            readOnly={targetType === 'bridge'}
            onChange={(e) => setEndpointUrl(e.target.value)}
            className={`mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none ${
              targetType === 'bridge' ? 'bg-slate-100 text-slate-600' : 'bg-white'
            }`}
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="chat-model-id" className="block text-xs font-medium text-slate-700">
              Modell-ID
            </label>
            <button
              type="button"
              onClick={() => void handleLoadModels()}
              disabled={loadingModels || sendBlockedByNonRest}
              className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3 w-3 ${loadingModels ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {loadingModels ? 'Lädt…' : 'Modelle laden'}
            </button>
          </div>
          <input
            id="chat-model-id"
            type="text"
            list="chat-loaded-models"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="z. B. grok-fast, grok-expert, llama-3.3-70b-versatile"
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
          />
          <datalist id="chat-loaded-models">
            {availableModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelsNote && (
            <p className={`mt-1 text-[11px] ${modelsNote.ok ? 'text-emerald-700' : 'text-red-700'}`}>
              {modelsNote.text}
            </p>
          )}
          {availableModels.length > 0 && (
            <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {availableModels.slice(0, 12).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModelId(m)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    modelId === m
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="chat-api-key"
            className="flex items-center justify-between gap-1.5 text-xs font-medium text-slate-700"
          >
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              Session-Key / Bridge-Token (nur RAM)
            </span>
            {targetType === 'provider' && activeProvider?.auth_typ === 'api_key' && !apiKey.trim() && (
              <span className="font-mono text-[10px] font-semibold text-amber-700">
                Key erforderlich
              </span>
            )}
          </label>
          <input
            id="chat-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={
              targetType === 'provider' && activeProviderSnippets?.envVar
                ? `Env: ${activeProviderSnippets.envVar} (nur RAM)`
                : 'Optional – wird niemals gespeichert (Regel 2)'
            }
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
          />
          {targetType === 'provider' &&
            activeProvider?.auth_typ === 'api_key' &&
            !apiKey.trim() &&
            !isNonRestProvider && (
              <p className="mt-1 text-[10px] text-amber-800">
                Dieser Provider erfordert einen API-Key (sonst HTTP 401). Für sofortigen Test ohne
                Key z. B. <strong>OVHcloud AI Endpoints</strong> oder{' '}
                <strong>Pollinations.AI</strong> wählen.
              </p>
            )}
        </div>

        {/* Collapsible Extra System Prompt & Generation Params */}
        <div className="border-t border-slate-100 pt-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex w-full items-center justify-between text-xs font-medium text-slate-700 hover:text-slate-950"
          >
            <span className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              Zusatz-System-Prompt & Parameter
            </span>
            {showAdvanced ? (
              <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            )}
          </button>

          {showAdvanced && (
            <div className="mt-2.5 space-y-2.5">
              <div>
                <label
                  htmlFor="chat-system-prompt"
                  className="block text-[11px] font-medium text-slate-600"
                >
                  Zusätzlicher System-Prompt (ergänzt Projekt-Anweisung)
                </label>
                <textarea
                  id="chat-system-prompt"
                  rows={2}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="z. B. Antworte als Tabelle."
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="chat-temperature"
                    className="block text-[11px] font-medium text-slate-600"
                  >
                    Temperature ({temperature.toFixed(1)})
                  </label>
                  <input
                    id="chat-temperature"
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                    className="mt-1 w-full accent-teal-700"
                  />
                </div>
                <div>
                  <label
                    htmlFor="chat-max-tokens"
                    className="block text-[11px] font-medium text-slate-600"
                  >
                    Max Tokens
                  </label>
                  <input
                    id="chat-max-tokens"
                    type="number"
                    min={64}
                    max={8192}
                    step={64}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value) || 1024)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      {/* Left Rail: Connection + Projects/Notebooks + Knowledge Base + Chrono-Jobs */}
      <NotebookSidebarPanel
        projects={workspace.projects}
        activeProject={activeProject}
        activeChatId={activeChat.id}
        activeRailTab={activeRailTab}
        onChangeRailTab={setActiveRailTab}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onUpdateProject={updateActiveProject}
        onDeleteProject={handleDeleteProject}
        onSelectChat={(cid) => setActiveChatId(cid)}
        onCreateChat={handleCreateChat}
        onDeleteChat={handleDeleteChat}
        onRunChronoNow={handleRunChronoNow}
        runningChronoJobId={runningChronoJobId}
        currentTargetConfig={{
          targetType,
          bridgeId: targetType === 'bridge' ? selectedBridgeId : undefined,
          providerId: targetType === 'provider' ? selectedProviderId : undefined,
          endpointUrl: endpointUrl.trim(),
          modelId: modelId.trim() || 'default',
        }}
        connectionPanelNode={connectionPanelNode}
      />

      {/* Main Chat Conversation Window */}
      <section
        aria-label="Direkt-Chat Verlauf"
        className="flex min-h-[620px] flex-col rounded-lg border border-slate-200 bg-white lg:col-span-8 lg:h-[calc(100vh-8.5rem)]"
      >
        {/* Chat Header */}
        <div className="border-b border-slate-200 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {targetType === 'bridge' ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-red-700">
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    BRIDGE (ROT)
                  </span>
                ) : targetType === 'provider' && activeProvider ? (
                  <SecurityClassTag secClass={activeProvider.securityClass} />
                ) : (
                  <span className="font-mono text-xs font-semibold text-emerald-700">
                    LOKAL (127.0.0.1)
                  </span>
                )}
                <h2 className="truncate text-sm font-semibold text-slate-900">{activeTitle}</h2>
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                {isNonRestProvider
                  ? `${cleanBaseDisplay} · Kein /chat/completions-Endpunkt`
                  : `${cleanBaseDisplay}/chat/completions · Modell: ${modelId || 'default'}`}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCreateChat()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <MessageSquare className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                Neuer Chat
              </button>
              <button
                type="button"
                onClick={() =>
                  updateActiveChat((c) => ({
                    ...c,
                    messages: [],
                    updatedAt: new Date().toISOString(),
                  }))
                }
                disabled={messages.length === 0 || sending}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Verlauf leeren
              </button>
            </div>
          </div>

          {/* Active Project / Knowledge / Cross-Chat Context Bar */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveRailTab('notebook')}
                className="font-medium text-teal-800 hover:underline"
              >
                Projekt: {activeProject.name}
              </button>
              <span className="text-slate-300">·</span>
              {editingChatTitle ? (
                <input
                  type="text"
                  autoFocus
                  value={activeChat.title}
                  onChange={(e) =>
                    updateActiveChat((c) => ({ ...c, title: e.target.value.slice(0, 120) }))
                  }
                  onBlur={() => setEditingChatTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setEditingChatTitle(false);
                  }}
                  aria-label="Chat-Titel bearbeiten"
                  className="rounded border border-teal-600 px-1.5 py-0.5 text-[11px] font-medium text-slate-900 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingChatTitle(true)}
                  title="Klicken zum Umbenennen"
                  className="font-medium text-slate-700 hover:text-slate-950 hover:underline"
                >
                  Chat: {activeChat.title}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
              <button
                type="button"
                onClick={() => setActiveRailTab('knowledge')}
                className={`rounded border px-1.5 py-0.5 ${
                  activeProject.knowledgeBaseEnabled && activeKbCount > 0
                    ? 'border-teal-200 bg-teal-50 text-teal-800'
                    : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                Wissen: {activeProject.knowledgeBaseEnabled ? `${activeKbCount} aktiv` : 'AUS'}
              </button>
              <button
                type="button"
                onClick={() => setActiveRailTab('notebook')}
                className={`rounded border px-1.5 py-0.5 ${
                  activeProject.crossChatMemoryEnabled
                    ? 'border-teal-200 bg-teal-50 text-teal-800'
                    : 'border-slate-200 bg-slate-50 text-slate-500'
                }`}
              >
                Cross-Chat: {activeProject.crossChatMemoryEnabled ? `AN (${siblingChatCount})` : 'AUS'}
              </button>
              <span className="text-slate-400">
                {saveIndicator === 'saving'
                  ? 'Speichert…'
                  : saveIndicator === 'error'
                    ? 'Speicherfehler'
                    : 'Lokal gespeichert'}
              </span>
            </div>
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-teal-700">
                <MessageSquare className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-slate-900">
                {activeProject.name} — {activeChat.title}
              </h3>
              <p className="mt-1 max-w-lg text-xs leading-relaxed text-slate-600">
                Verbunden mit <strong>{activeTitle}</strong>. Alle Chats dieses Projekts teilen sich
                die lokale <strong>Wissensdatenbank</strong>, finden sich gegenseitig per{' '}
                <strong>Cross-Chat-Suche</strong> und unterstützen{' '}
                <strong>Datei-/Bild-Upload</strong>, <strong>Prompt-Verbesserung</strong> &{' '}
                <strong>Chrono-Jobs</strong>.
              </p>
              <div className="mt-5 grid w-full max-w-xl grid-cols-1 gap-2">
                {STARTER_PROMPTS.map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => void handleSend(sp)}
                    disabled={sending || sendBlockedByNonRest}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-left text-xs text-slate-700 transition-colors hover:border-teal-600 hover:bg-teal-50/50 hover:text-slate-950 disabled:opacity-45"
                  >
                    {sp}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <article
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-lg border px-4 py-3 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'border-teal-700 bg-teal-700 text-white'
                      : msg.role === 'error'
                        ? 'border-red-200 bg-red-50 text-red-950'
                        : 'border-slate-200 bg-slate-50 text-slate-900'
                  }`}
                >
                  <div
                    className={`mb-1.5 flex flex-wrap items-center justify-between gap-3 font-mono text-[10px] ${
                      msg.role === 'user'
                        ? 'text-teal-100'
                        : msg.role === 'error'
                          ? 'text-red-700'
                          : 'text-slate-500'
                    }`}
                  >
                    <span>
                      {msg.role === 'user'
                        ? 'DU'
                        : msg.role === 'error'
                          ? `FEHLER${msg.httpStatus ? ` · HTTP ${msg.httpStatus}` : ''}`
                          : (msg.model || 'ASSISTANT').toUpperCase()}
                    </span>
                    <span className="flex items-center gap-2">
                      {typeof msg.latencyMs === 'number' && <span>{msg.latencyMs} ms</span>}
                      {msg.usage?.total_tokens !== undefined && (
                        <span>{msg.usage.total_tokens} tok</span>
                      )}
                      <span>{msg.createdAt}</span>
                    </span>
                  </div>

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {msg.attachments.map((att, idx) => (
                        <span
                          key={`${att.name}-${idx}`}
                          className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 font-mono text-[10px]"
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

                  {msg.role === 'assistant' ? (
                    <ChatMarkdownMessage content={msg.content} />
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  )}

                  {msg.rawPreview && (
                    <pre className="mt-2 max-h-36 overflow-auto rounded bg-slate-950 p-2 font-mono text-[10px] text-slate-200">
                      <code>{msg.rawPreview}</code>
                    </pre>
                  )}

                  {/* Context Citations used for this answer */}
                  {msg.role === 'assistant' && msg.contextSources && msg.contextSources.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-200/80 pt-2">
                      <span className="font-mono text-[10px] text-slate-500">Kontext:</span>
                      {msg.contextSources.map((src, i) => (
                        <button
                          key={`${src.sourceType}-${src.id}-${i}`}
                          type="button"
                          onClick={() => {
                            if (src.sourceType === 'chat') {
                              setActiveChatId(src.id);
                            } else {
                              setActiveRailTab('knowledge');
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] text-teal-900 hover:bg-teal-100"
                        >
                          {src.sourceType === 'knowledge' ? (
                            <BookOpen className="h-2.5 w-2.5" aria-hidden="true" />
                          ) : (
                            <MessageSquare className="h-2.5 w-2.5" aria-hidden="true" />
                          )}
                          {src.title}
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200/70 pt-1.5">
                      <button
                        type="button"
                        onClick={() => handleSaveReplyToKnowledge(msg)}
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-teal-700 hover:text-teal-950"
                      >
                        {savedToKbMsgId === msg.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                            Im Wissen gespeichert
                          </>
                        ) : (
                          <>
                            <BookmarkPlus className="h-3 w-3" aria-hidden="true" />
                            In Wissen speichern
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyMessage(msg)}
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-500 hover:text-slate-900"
                      >
                        {copiedId === msg.id ? (
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
                  )}
                </div>
              </article>
            ))
          )}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-teal-700" aria-hidden="true" />
              <span className="font-mono">Warte auf Antwort von {activeTitle}…</span>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer Footer with File/Image Upload + Prompt Improvement */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="border-t border-slate-200 bg-slate-50/70 p-3.5"
        >
          {/* Pending Attachments Bar */}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1.5 rounded border border-teal-200 bg-white px-2 py-1 text-[11px] text-slate-800"
                >
                  {att.kind === 'image' ? (
                    <ImageIcon className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                  )}
                  <span className="max-w-[160px] truncate">{att.name}</span>
                  <button
                    type="button"
                    aria-label={`Anhang ${att.name} entfernen`}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                    className="text-slate-400 hover:text-red-700"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Prompt Optimizer & Attachment Toolbar */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => chatFileInputRef.current?.click()}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <Paperclip className="h-3 w-3 text-teal-700" aria-hidden="true" />
                Datei / Bild
              </button>
              <input
                ref={chatFileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.py,.ts,.tsx,.js,.html,.xml,.yaml,.yml,.sql,.log"
                onChange={(e) => void handleAttachFiles(e)}
                className="hidden"
                aria-label="Bild oder Textdatei an Nachricht anhängen"
              />

              <label htmlFor="prompt-refine-mode" className="sr-only">
                Prompt-Verbesserungsmodus
              </label>
              <select
                id="prompt-refine-mode"
                value={refineMode}
                onChange={(e) => setRefineMode(e.target.value as PromptRefineMode)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700"
              >
                <option value="structured">Modus: Strukturiert</option>
                <option value="research">Modus: Forschung / Evidenz</option>
                <option value="coding">Modus: Code & Architektur</option>
                <option value="imagine">Modus: Grok Imagine (Bild)</option>
              </select>

              <button
                type="button"
                onClick={handleRefineLocal}
                disabled={!draft.trim() || sending}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-45"
              >
                <Sparkles className="h-3 w-3 text-teal-700" aria-hidden="true" />
                Prompt verbessern
              </button>
              <button
                type="button"
                onClick={() => void handleRefineWithAi()}
                disabled={!draft.trim() || sending || refiningWithAi || sendBlockedByNonRest}
                className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-45"
              >
                {refiningWithAi ? (
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                )}
                Per KI schärfen
              </button>
              {previousDraftBeforeRefine !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(previousDraftBeforeRefine);
                    setPreviousDraftBeforeRefine(null);
                    setRefineNote(null);
                  }}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:text-slate-900"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Rückgängig
                </button>
              )}
            </div>
            {refineNote && <span className="text-[10px] text-teal-800">{refineNote}</span>}
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="chat-composer-input" className="sr-only">
                Nachricht eingeben
              </label>
              <textarea
                id="chat-composer-input"
                rows={2}
                value={draft}
                disabled={sendBlockedByNonRest}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={
                  sendBlockedByNonRest
                    ? 'Kein direkter Chat-Endpunkt — wähle links eine REST-API oder aktiviere den manuellen HTTP-Test.'
                    : `Nachricht an ${activeTitle} senden… (Enter = Senden, Shift+Enter = Zeilenumbruch)`
                }
                className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>

            {sending ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3.5 text-xs font-medium text-red-800 hover:bg-red-100"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Abbrechen
              </button>
            ) : (
              <button
                type="submit"
                disabled={(!draft.trim() && attachments.length === 0) || sendBlockedByNonRest}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-teal-700 px-4 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-45"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Senden
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
