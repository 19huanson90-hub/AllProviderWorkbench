import {
  Brain,
  Check,
  Cloud,
  Code2,
  Copy,
  Download,
  ExternalLink,
  GitMerge,
  Globe,
  KeyRound,
  Play,
  RefreshCw,
  Server,
  Square,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import {
  resolveDefaultChatModel,
  type ChatTargetType,
} from '../lib/chatEngine.ts';
import {
  buildCloudNotebookIpynb,
  buildCloudNotebookScript,
  CLOUD_NOTEBOOK_MODELS,
  CODING_TOOL_DEFINITIONS,
  FREE_UNCENSORED_API_PRESETS,
  HF_SPACE_PRESETS,
  type CodingMainWay,
  type CodingRolePreset,
  type CodingToolId,
  type FreeUncensoredApiPreset,
  type ThinkingMode,
} from '../lib/codingTypes.ts';
import {
  buildConnectionSnippets,
  resolveProviderApiKeyPage,
} from '../lib/testEngine.ts';
import type {
  BridgeRuntimeState,
  BridgeSelectionEntry,
  ClassifiedProvider,
} from '../lib/types.ts';
import { SecurityClassTag, UnfilteredTag } from './SecurityIndicator.tsx';

export interface HordeLiveModel {
  name: string;
  count: number;
  eta: number;
  maxContext: number;
  jobs: number;
}

export interface HfSpaceStatusRow {
  id: string;
  stage: string;
  hardware: string;
}

const LOCAL_CODING_PRESETS = [
  { label: 'Ollama (Abliterated)', url: 'http://127.0.0.1:11434/v1', model: 'huihui_ai/qwen2.5-abliterated' },
  { label: 'Ollama (Qwen Coder)', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:14b' },
  { label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { label: 'vLLM', url: 'http://127.0.0.1:8000/v1', model: 'default' },
  { label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', model: 'default' },
];

export interface CodingConnectionSettingsProps {
  drawerSubTab: 'connection' | 'tools';
  activeWay: CodingMainWay;

  // Weg 1: HF ZeroGPU Space
  hfSpaceId: string;
  setHfSpaceId: (v: string) => void;
  hfToken: string;
  setHfToken: (v: string) => void;
  gpuDuration: number;
  setGpuDuration: (v: number) => void;
  useDflash: boolean;
  setUseDflash: (v: boolean) => void;
  hfStatuses: Record<string, HfSpaceStatusRow>;
  hfStatusLoading: boolean;
  onRefreshHfStatus: () => void;

  // Weg 2: AI Horde
  hordeModel: string;
  setHordeModel: (v: string) => void;
  hordeApiKey: string;
  setHordeApiKey: (v: string) => void;
  hordeModels: HordeLiveModel[];
  hordeLoading: boolean;
  hordeNote: string | null;
  onLoadHordeModels: () => void;
  hordeMaxLength: number;
  setHordeMaxLength: (v: number) => void;
  hordeMaxContextLength: number;
  setHordeMaxContextLength: (v: number) => void;
  hordeRepPen: number;
  setHordeRepPen: (v: number) => void;
  hordeTrustedWorkers: boolean;
  setHordeTrustedWorkers: (v: boolean) => void;
  hordeSlowWorkers: boolean;
  setHordeSlowWorkers: (v: boolean) => void;
  hordeAllowDowngrade: boolean;
  setHordeAllowDowngrade: (v: boolean) => void;

  // Weg 3: Free Uncensored APIs
  freeApiPresetId: FreeUncensoredApiPreset['id'];
  onSelectFreeApiPreset: (id: FreeUncensoredApiPreset['id']) => void;
  freeApiKey: string;
  setFreeApiKey: (v: string) => void;
  freeApiModel: string;
  setFreeApiModel: (v: string) => void;
  freeApiLiveModels: string[];
  freeApiLoading: boolean;
  freeApiNote: string | null;
  onLoadFreeApiModels: () => void;
  presencePenalty: number;
  setPresencePenalty: (v: number) => void;
  frequencyPenalty: number;
  setFrequencyPenalty: (v: number) => void;
  seedValue: string;
  setSeedValue: (v: string) => void;

  // Weg 4: Cloud-GPU Tunnel
  cloudPlatform: 'kaggle' | 'colab';
  setCloudPlatform: (v: 'kaggle' | 'colab') => void;
  cloudScriptModel: string;
  setCloudScriptModel: (v: string) => void;
  tunnelUrl: string;
  setTunnelUrl: (v: string) => void;
  tunnelModel: string;
  setTunnelModel: (v: string) => void;
  tunnelToken: string;
  setTunnelToken: (v: string) => void;
  tunnelNumCtx: number;
  setTunnelNumCtx: (v: number) => void;
  tunnelModels: string[];
  tunnelLoading: boolean;
  tunnelNote: string | null;
  onTestTunnelModels: () => void;

  // Weg 5: Catalog / Bridges Fallback
  targetType: ChatTargetType;
  switchTargetType: (next: ChatTargetType) => void;
  usableProviders: ClassifiedProvider[];
  filteredProviders: ClassifiedProvider[];
  selectedProviderId: string;
  setSelectedProviderId: (v: string) => void;
  selectedProvider: ClassifiedProvider | undefined;
  providerSearch: string;
  setProviderSearch: (v: string) => void;
  onlyUnfiltered: boolean;
  setOnlyUnfiltered: (v: boolean) => void;
  sortUnfilteredFirst: boolean;
  setSortUnfilteredFirst: (v: boolean) => void;
  allowlistedBridges: BridgeSelectionEntry[];
  selectedBridgeId: string;
  setSelectedBridgeId: (v: string) => void;
  selectedBridgeRuntime: BridgeRuntimeState | undefined;
  verifiedBridgeModels: Array<{ id: string; label: string; note?: string }>;
  bridgeTosConfirm: boolean;
  setBridgeTosConfirm: (v: boolean) => void;
  executingBridgeId: string | null;
  onExecuteBridge: (bridgeId: string, confirmTosRisk: boolean) => Promise<void> | void;
  onStopBridge: (bridgeId: string) => Promise<void> | void;
  onProbeBridge: (bridgeId: string) => Promise<void> | void;
  endpointUrl: string;
  setEndpointUrl: (v: string) => void;
  modelId: string;
  setModelId: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  availableModels: string[];
  setAvailableModels: (v: string[]) => void;
  loadingModels: boolean;
  modelsNote: string | null;
  setModelsNote: (v: string | null) => void;
  onLoadCatalogModels: () => void;

  // Shared Generation + Tools & Thinking knobs
  temperature: number;
  setTemperature: (v: number) => void;
  maxTokens: number;
  setMaxTokens: (v: number) => void;
  topP: number;
  setTopP: (v: number) => void;
  topK: number;
  setTopK: (v: number) => void;
  repetitionPenalty: number;
  setRepetitionPenalty: (v: number) => void;

  enabledTools: CodingToolId[];
  onToggleTool: (id: CodingToolId) => void;
  onSetAllTools: (all: boolean) => void;
  thinkingMode: ThinkingMode;
  setThinkingMode: (v: ThinkingMode) => void;
  codingRole: CodingRolePreset;
  setCodingRole: (v: CodingRolePreset) => void;
  roleOptions: Array<{ id: CodingRolePreset; label: string }>;
  autoInjectTree: boolean;
  setAutoInjectTree: (v: boolean) => void;
  autoInjectActiveFile: boolean;
  setAutoInjectActiveFile: (v: boolean) => void;
  customSystemPrompt: string;
  setCustomSystemPrompt: (v: string) => void;
}

export function CodingConnectionSettings(props: CodingConnectionSettingsProps) {
  const [copiedScript, setCopiedScript] = useState(false);

  if (props.drawerSubTab === 'tools') {
    return (
      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-xs">
        {/* Safe Workspace & Notebook Tools */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
              <Wrench className="h-3 w-3 text-teal-700" aria-hidden="true" />
              Coding-Studio Tools ({props.enabledTools.length}/{CODING_TOOL_DEFINITIONS.length})
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => props.onSetAllTools(true)}
                className="font-medium text-teal-700 hover:underline"
              >
                Alle an
              </button>
              <button
                type="button"
                onClick={() => props.onSetAllTools(false)}
                className="font-medium text-slate-500 hover:underline"
              >
                Alle aus
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Auf Weg 3 & 4 nativ per OpenAI Function-Calling, auf Weg 1 & 2 per strukturiertem ReAct-Protokoll. Schreibzugriffe sind strikt auf <span className="font-mono">coding-workspace/</span> begrenzt.
          </p>
          <div className="space-y-1.5">
            {CODING_TOOL_DEFINITIONS.map((tool) => {
              const active = props.enabledTools.includes(tool.id);
              return (
                <label
                  key={tool.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors ${
                    active ? 'border-teal-200 bg-teal-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => props.onToggleTool(tool.id)}
                    className="mt-0.5 rounded border-slate-300 accent-teal-700"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{tool.label}</div>
                    <div className="text-[10px] leading-snug text-slate-500">{tool.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Thinking & Role */}
        <div className="space-y-2.5 border-t border-slate-200 pt-3">
          <div className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
            <Brain className="h-3 w-3 text-teal-700" aria-hidden="true" />
            Thinking & Rolle
          </div>

          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Thinking-Intensität">
            {(['off', 'standard', 'deep'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => props.setThinkingMode(m)}
                className={`rounded border px-2 py-1 text-[11px] font-medium ${
                  props.thinkingMode === m
                    ? 'border-teal-700 bg-teal-700 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {m === 'off' ? 'Aus' : m === 'standard' ? 'Standard' : 'Tief'}
              </button>
            ))}
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase text-slate-500">
              Coding-Rollen-Preset
            </label>
            <select
              aria-label="Coding-Rollen-Preset"
              value={props.codingRole}
              onChange={(e) => props.setCodingRole(e.target.value as CodingRolePreset)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
            >
              {props.roleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Context Auto-Injection & System Prompt */}
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Kontext & System-Prompt
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-700">
            <input
              type="checkbox"
              checked={props.autoInjectTree}
              onChange={(e) => props.setAutoInjectTree(e.target.checked)}
              className="rounded border-slate-300"
            />
            Ordnerstruktur automatisch mitsenden
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-700">
            <input
              type="checkbox"
              checked={props.autoInjectActiveFile}
              onChange={(e) => props.setAutoInjectActiveFile(e.target.checked)}
              className="rounded border-slate-300"
            />
            Aktive Editor-Datei automatisch mitsenden
          </label>
          <div>
            <label className="block font-mono text-[10px] uppercase text-slate-500">
              Zusätzlicher System-Prompt
            </label>
            <textarea
              rows={3}
              value={props.customSystemPrompt}
              onChange={(e) => props.setCustomSystemPrompt(e.target.value)}
              placeholder="z. B. Antworte knapp auf Deutsch, nutze TypeScript ohne Platzhalter…"
              className="mt-1 w-full resize-none rounded border border-slate-300 px-2 py-1.5 text-[11px]"
            />
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CONNECTION SETTINGS PER ACTIVE WAY (WEG 1 - 4 + WEITERE)
  // =========================================================================
  const activeHfPreset = HF_SPACE_PRESETS.find((s) => s.id === props.hfSpaceId) || HF_SPACE_PRESETS[0];
  const activeHfStatus = props.hfStatuses[activeHfPreset.id];
  const activeFreePreset =
    FREE_UNCENSORED_API_PRESETS.find((p) => p.id === props.freeApiPresetId) ||
    FREE_UNCENSORED_API_PRESETS[0];
  const selectedProviderKeyPage = props.selectedProvider
    ? resolveProviderApiKeyPage(props.selectedProvider)
    : null;

  const handleCopyNotebookScript = () => {
    const script = buildCloudNotebookScript(props.cloudPlatform, props.cloudScriptModel);
    void navigator.clipboard.writeText(script);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 1600);
  };

  const handleDownloadIpynb = () => {
    const ipynb = buildCloudNotebookIpynb(props.cloudPlatform, props.cloudScriptModel);
    const blob = new Blob([ipynb], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cloud-gpu-${props.cloudPlatform}-abliterated.ipynb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-3 text-xs">
      {/* WEG 1: HUGGING FACE ZEROGPU SPACES */}
      {props.activeWay === 'hf_space' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              Weg 1 · HF ZeroGPU Space
            </span>
            <button
              type="button"
              onClick={props.onRefreshHfStatus}
              disabled={props.hfStatusLoading}
              className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${props.hfStatusLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Live-Status</span>
            </button>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase text-slate-500">
              Verifizierter Abliterated Space
            </label>
            <select
              aria-label="Hugging Face Space auswählen"
              value={props.hfSpaceId}
              onChange={(e) => props.setHfSpaceId(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
            >
              {HF_SPACE_PRESETS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-700">
            <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="text-slate-500">GPU: {activeHfStatus?.hardware || activeHfPreset.hardware}</span>
              {activeHfStatus ? (
                <span
                  className={`font-semibold ${
                    activeHfStatus.stage === 'RUNNING' ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {activeHfStatus.stage}
                </span>
              ) : (
                <span className="text-slate-500">Gradio API</span>
              )}
            </div>
            <p className="mt-1">{activeHfPreset.note}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a
                href={activeHfPreset.spaceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <span>Im Browser öffnen</span>
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
              <a
                href="https://huggingface.co/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-0.5 text-[10px] font-medium text-teal-800 hover:bg-teal-50"
              >
                <KeyRound className="h-2.5 w-2.5" aria-hidden="true" />
                <span>HF-Token holen</span>
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase text-slate-500">
              Optionaler HF-Token (nur RAM · mehr ZeroGPU-Quota)
            </label>
            <input
              type="password"
              value={props.hfToken}
              onChange={(e) => props.setHfToken(e.target.value)}
              placeholder="hf_… (leer = anonym nutzbar bei Muse-Glimmer)"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
            />
          </div>

          {activeHfPreset.supportsGpuDuration && (
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                ZeroGPU Zeitbudget ({props.gpuDuration} s · Anonym-Limit ≤ 90 s)
              </label>
              <input
                type="range"
                min={30}
                max={120}
                step={10}
                value={props.gpuDuration}
                onChange={(e) => props.setGpuDuration(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
          )}

          {activeHfPreset.supportsDflash && (
            <label className="flex items-center gap-2 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={props.useDflash}
                onChange={(e) => props.setUseDflash(e.target.checked)}
                className="rounded border-slate-300 accent-teal-700"
              />
              DFlash Speculative Decoding (~25 tok/s)
            </label>
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2.5">
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Temperatur ({props.temperature.toFixed(2)})
              </label>
              <input
                type="range"
                min={0.05}
                max={1.5}
                step={0.05}
                value={props.temperature}
                onChange={(e) => props.setTemperature(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">Max Tokens</label>
              <input
                type="number"
                min={128}
                max={8000}
                step={128}
                value={props.maxTokens}
                onChange={(e) => props.setMaxTokens(Number(e.target.value) || 2048)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px] tabular-nums"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Top-P ({props.topP.toFixed(2)})
              </label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={props.topP}
                onChange={(e) => props.setTopP(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">Top-K</label>
              <input
                type="number"
                min={1}
                max={200}
                value={props.topK}
                onChange={(e) => props.setTopK(Number(e.target.value) || 40)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px] tabular-nums"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-mono text-[10px] text-slate-500">
                Repetition Penalty ({props.repetitionPenalty.toFixed(2)})
              </label>
              <input
                type="range"
                min={0.9}
                max={1.5}
                step={0.05}
                value={props.repetitionPenalty}
                onChange={(e) => props.setRepetitionPenalty(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
          </div>
        </div>
      )}

      {/* WEG 2: AI HORDE */}
      {props.activeWay === 'ai_horde' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              Weg 2 · AI Horde (Dezentral)
            </span>
            <button
              type="button"
              onClick={props.onLoadHordeModels}
              disabled={props.hordeLoading}
              className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${props.hordeLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{props.hordeLoading ? 'Lade…' : 'Live-Modelle laden'}</span>
            </button>
          </div>

          <div>
            <label className="block font-mono text-[10px] uppercase text-slate-500">
              Aktives Community-Modell
            </label>
            <select
              aria-label="AI Horde Modell auswählen"
              value={props.hordeModel}
              onChange={(e) => props.setHordeModel(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-900"
            >
              <option value="">Automatisch (schnellster freier Worker)</option>
              {props.hordeModels.length > 0 ? (
                props.hordeModels.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} ({m.count}W · {m.maxContext} ctx · ~{m.eta}s)
                  </option>
                ))
              ) : (
                <>
                  <option value="llamacpp/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive">
                    llamacpp/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive
                  </option>
                  <option value="koboldcpp/gemma-4-31B-it-heretic">
                    koboldcpp/gemma-4-31B-it-heretic
                  </option>
                </>
              )}
            </select>
            {props.hordeNote && <p className="mt-1 text-[10px] text-slate-500">{props.hordeNote}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10px] uppercase text-slate-500">
                Horde API-Key (leer = 0000000000 anonym)
              </label>
              <a
                href="https://aihorde.net/register"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-teal-700 hover:underline"
              >
                <span>Gratis Key</span>
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
            </div>
            <input
              type="password"
              value={props.hordeApiKey}
              onChange={(e) => props.setHordeApiKey(e.target.value)}
              placeholder="0000000000 (anonym)"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2.5">
            <div>
              <label className="block font-mono text-[10px] text-slate-500">Max Antwort-Tokens</label>
              <input
                type="number"
                min={64}
                max={1024}
                step={32}
                value={props.hordeMaxLength}
                onChange={(e) => props.setHordeMaxLength(Number(e.target.value) || 384)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px] tabular-nums"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">Max Context</label>
              <input
                type="number"
                min={1024}
                max={16384}
                step={512}
                value={props.hordeMaxContextLength}
                onChange={(e) => props.setHordeMaxContextLength(Number(e.target.value) || 4096)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px] tabular-nums"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Temperatur ({props.temperature.toFixed(2)})
              </label>
              <input
                type="range"
                min={0.05}
                max={1.5}
                step={0.05}
                value={props.temperature}
                onChange={(e) => props.setTemperature(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Rep Penalty ({props.hordeRepPen.toFixed(2)})
              </label>
              <input
                type="range"
                min={1}
                max={1.4}
                step={0.02}
                value={props.hordeRepPen}
                onChange={(e) => props.setHordeRepPen(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
          </div>

          <div className="space-y-1.5 border-t border-slate-200 pt-2.5 text-[11px] text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.hordeSlowWorkers}
                onChange={(e) => props.setHordeSlowWorkers(e.target.checked)}
                className="rounded border-slate-300 accent-teal-700"
              />
              Slow Worker erlauben (bessere Verfügbarkeit)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.hordeAllowDowngrade}
                onChange={(e) => props.setHordeAllowDowngrade(e.target.checked)}
                className="rounded border-slate-300 accent-teal-700"
              />
              Allow Downgrade (Context automatisch anpassen)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={props.hordeTrustedWorkers}
                onChange={(e) => props.setHordeTrustedWorkers(e.target.checked)}
                className="rounded border-slate-300 accent-teal-700"
              />
              Nur Trusted Worker (strenger, evtl. längere Queue)
            </label>
            <div className="font-mono text-[10px] text-slate-500">
              Filter: <span className="font-semibold text-slate-800">censor_nsfw: false</span> (immer aktiv)
            </div>
          </div>
        </div>
      )}

      {/* WEG 3: FREE UNCENSORED OPENAI-APIS */}
      {props.activeWay === 'free_uncensored_api' && (
        <div className="space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
            Weg 3 · Free Uncensored OpenAI-APIs
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {FREE_UNCENSORED_API_PRESETS.map((preset) => {
              const active = preset.id === props.freeApiPresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => props.onSelectFreeApiPreset(preset.id)}
                  className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'border-teal-600 bg-teal-50 text-teal-950'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold">{preset.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">
                      {preset.needsKey ? 'Gratis-Key' : 'Ohne Key'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
            <div className="font-mono text-[10px] text-slate-500">{activeFreePreset.baseUrl}</div>
            <p className="mt-1 leading-snug">{activeFreePreset.warning}</p>
            {activeFreePreset.keyPageUrl && (
              <a
                href={activeFreePreset.keyPageUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-0.5 text-[10px] font-medium text-teal-800 hover:bg-teal-50"
              >
                <KeyRound className="h-3 w-3" aria-hidden="true" />
                <span>API-Key holen</span>
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="font-mono text-[10px] uppercase text-slate-500">Modell</label>
              <button
                type="button"
                onClick={props.onLoadFreeApiModels}
                disabled={props.freeApiLoading}
                className="font-mono text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
              >
                {props.freeApiLoading ? 'Lade…' : 'Live /models laden'}
              </button>
            </div>
            <select
              aria-label="Free-API Modell wählen"
              value={props.freeApiModel}
              onChange={(e) => props.setFreeApiModel(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-900"
            >
              {(props.freeApiLiveModels.length > 0 ? props.freeApiLiveModels : activeFreePreset.models).map(
                (m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                )
              )}
            </select>
            {props.freeApiNote && <p className="mt-1 text-[10px] text-slate-500">{props.freeApiNote}</p>}
          </div>

          {activeFreePreset.needsKey && (
            <div>
              <label className="block font-mono text-[10px] uppercase text-slate-500">
                Session API-Key (nur RAM)
              </label>
              <input
                type="password"
                value={props.freeApiKey}
                onChange={(e) => props.setFreeApiKey(e.target.value)}
                placeholder="Kostenlosen Key hier einfügen…"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2.5">
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Temperatur ({props.temperature.toFixed(2)})
              </label>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={props.temperature}
                onChange={(e) => props.setTemperature(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">Max Tokens</label>
              <input
                type="number"
                min={256}
                max={16384}
                step={256}
                value={props.maxTokens}
                onChange={(e) => props.setMaxTokens(Number(e.target.value) || 4096)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px] tabular-nums"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Presence ({props.presencePenalty.toFixed(1)})
              </label>
              <input
                type="range"
                min={-1}
                max={1.5}
                step={0.1}
                value={props.presencePenalty}
                onChange={(e) => props.setPresencePenalty(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Frequency ({props.frequencyPenalty.toFixed(1)})
              </label>
              <input
                type="range"
                min={-1}
                max={1.5}
                step={0.1}
                value={props.frequencyPenalty}
                onChange={(e) => props.setFrequencyPenalty(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-mono text-[10px] text-slate-500">
                Seed (optional, für reproduzierbaren Code)
              </label>
              <input
                type="text"
                value={props.seedValue}
                onChange={(e) => props.setSeedValue(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="z. B. 42"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px]"
              />
            </div>
          </div>
        </div>
      )}

      {/* WEG 4: CLOUD-GPU NOTEBOOK TUNNEL (KAGGLE / COLAB) */}
      {props.activeWay === 'cloud_tunnel' && (
        <div className="space-y-3">
          <div className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-slate-600">
            <Cloud className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            Weg 4 · Cloud-GPU Notebook Tunnel
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5 space-y-2">
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  { id: 'kaggle', label: 'Kaggle (2× T4 · 30 GB)' },
                  { id: 'colab', label: 'Colab (T4 · 15 GB)' },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => props.setCloudPlatform(p.id)}
                  className={`rounded border px-2 py-1 text-[10px] font-medium ${
                    props.cloudPlatform === p.id
                      ? 'border-teal-700 bg-teal-700 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block font-mono text-[10px] text-slate-500">
                Abliterated Coding-Modell für Cloud-GPU
              </label>
              <select
                aria-label="Cloud-Notebook Modell"
                value={props.cloudScriptModel}
                onChange={(e) => {
                  props.setCloudScriptModel(e.target.value);
                  props.setTunnelModel(e.target.value);
                }}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono text-[10px] text-slate-900"
              >
                {CLOUD_NOTEBOOK_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleCopyNotebookScript}
                className="inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
              >
                {copiedScript ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                    <span>Kopiert</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" aria-hidden="true" />
                    <span>Code kopieren</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDownloadIpynb}
                className="inline-flex items-center justify-center gap-1 rounded bg-teal-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-800"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                <span>.ipynb laden</span>
              </button>
            </div>
            <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] leading-snug text-amber-950">
              Nur im Browser in einer <strong>Kaggle- oder Google-Colab-Python-Zelle</strong> ausführen — <strong>nicht</strong> in Windows PowerShell!
            </p>
            <div className="flex items-center gap-3 text-[10px]">
              <a
                href="https://www.kaggle.com/code"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline"
              >
                <span>Kaggle öffnen</span>
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
              <a
                href="https://colab.research.google.com/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-teal-700 hover:underline"
              >
                <span>Google Colab öffnen</span>
                <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <label className="block font-mono text-[10px] uppercase text-slate-500">
                HTTPS Tunnel-URL aus Notebook
              </label>
              <input
                type="url"
                value={props.tunnelUrl}
                onChange={(e) => props.setTunnelUrl(e.target.value)}
                placeholder="https://xyz-abc.trycloudflare.com/v1"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
              />
            </div>

            <button
              type="button"
              onClick={props.onTestTunnelModels}
              disabled={props.tunnelLoading || !props.tunnelUrl.trim()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-teal-300 bg-teal-50 px-2.5 py-1.5 text-[11px] font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-40"
            >
              <RefreshCw className={`h-3 w-3 ${props.tunnelLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{props.tunnelLoading ? 'Teste Tunnel…' : 'Tunnel testen & Modelle laden'}</span>
            </button>
            {props.tunnelNote && <p className="text-[10px] text-slate-600">{props.tunnelNote}</p>}

            <div>
              <label className="block font-mono text-[10px] uppercase text-slate-500">Modell im Tunnel</label>
              <input
                type="text"
                value={props.tunnelModel}
                onChange={(e) => props.setTunnelModel(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
              />
              {props.tunnelModels.length > 0 && (
                <select
                  aria-label="Geladene Tunnel-Modelle"
                  value={props.tunnelModels.includes(props.tunnelModel) ? props.tunnelModel : ''}
                  onChange={(e) => {
                    if (e.target.value) props.setTunnelModel(e.target.value);
                  }}
                  className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px]"
                >
                  <option value="">Geladenes Modell wählen…</option>
                  {props.tunnelModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-mono text-[10px] text-slate-500">Ollama num_ctx</label>
                <input
                  type="number"
                  min={2048}
                  max={65536}
                  step={2048}
                  value={props.tunnelNumCtx}
                  onChange={(e) => props.setTunnelNumCtx(Number(e.target.value) || 16384)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px] tabular-nums"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-slate-500">
                  Temperatur ({props.temperature.toFixed(2)})
                </label>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={props.temperature}
                  onChange={(e) => props.setTemperature(Number(e.target.value))}
                  className="mt-1 w-full accent-teal-700"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-[10px] uppercase text-slate-500">
                Optionaler Tunnel Bearer-Token (nur RAM)
              </label>
              <input
                type="password"
                value={props.tunnelToken}
                onChange={(e) => props.setTunnelToken(e.target.value)}
                placeholder="Leer bei Standard-Ollama"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
              />
            </div>
          </div>
        </div>
      )}

      {/* SECONDARY FALLBACK: CATALOG PROVIDERS / LOCAL BRIDGES / LITELLM */}
      {props.activeWay === 'catalog_or_bridge' && (
        <div className="space-y-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Weitere Verbindung (Katalog / Bridges)
            </label>
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              {[
                { id: 'provider', label: 'Provider (API)', icon: Globe },
                { id: 'bridge', label: 'Bridge (ROT)', icon: GitMerge },
                { id: 'custom_local', label: 'Lokal 127.0.0.1', icon: Server },
                { id: 'litellm', label: 'LiteLLM Router', icon: Code2 },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => props.switchTargetType(t.id as ChatTargetType)}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-medium ${
                      props.targetType === t.id
                        ? 'border-teal-600 bg-teal-50 text-teal-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {props.targetType === 'provider' && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5">
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={props.onlyUnfiltered}
                    onChange={(e) => props.setOnlyUnfiltered(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700"
                  />
                  Nur Unfiltered
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={props.sortUnfilteredFirst}
                    onChange={(e) => props.setSortUnfilteredFirst(e.target.checked)}
                    className="rounded border-slate-300 text-teal-700"
                  />
                  Unfiltered zuerst
                </label>
              </div>
              <input
                type="text"
                value={props.providerSearch}
                onChange={(e) => props.setProviderSearch(e.target.value)}
                placeholder="Provider suchen…"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
              />
              <select
                aria-label="Provider auswählen"
                value={props.selectedProviderId}
                onChange={(e) => {
                  const pid = e.target.value;
                  props.setSelectedProviderId(pid);
                  const p = props.usableProviders.find((x) => x.id === pid);
                  if (p) {
                    props.setEndpointUrl(buildConnectionSnippets(p).defaultApiBase);
                    props.setModelId(resolveDefaultChatModel(p.id));
                    props.setAvailableModels([]);
                    props.setModelsNote(null);
                  }
                }}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
              >
                {props.filteredProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isUnfiltered ? '[UNFILTERED] ' : ''}
                    {p.name} ({p.auth_typ === 'keine' ? 'Ohne Key' : 'Key'})
                  </option>
                ))}
              </select>
              {props.selectedProvider && (
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <SecurityClassTag secClass={props.selectedProvider.securityClass} />
                    {props.selectedProvider.isUnfiltered && <UnfilteredTag />}
                  </div>
                  {selectedProviderKeyPage && (
                    <a
                      href={selectedProviderKeyPage.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-teal-200 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-50"
                    >
                      <KeyRound className="h-3 w-3" aria-hidden="true" />
                      <span>API-Key holen</span>
                      <ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {props.targetType === 'bridge' && (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/70 p-2.5">
              <select
                aria-label="Lokale Bridge wählen"
                value={props.selectedBridgeId}
                onChange={(e) => {
                  const bid = e.target.value;
                  props.setSelectedBridgeId(bid);
                  const b = props.allowlistedBridges.find((x) => x.bridge_id === bid);
                  if (b?.port) props.setEndpointUrl(`http://127.0.0.1:${b.port}/v1`);
                  props.setModelId(resolveDefaultChatModel(undefined, bid));
                  props.setAvailableModels([]);
                }}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              >
                {props.allowlistedBridges.map((b) => (
                  <option key={b.bridge_id} value={b.bridge_id!}>
                    {b.zielprovider} — {b.bridge_id} (:{b.port})
                  </option>
                ))}
              </select>
              <div className="font-mono text-[10px] text-slate-500">
                Status: {props.selectedBridgeRuntime?.status || 'stopped'}
              </div>
              <label className="flex items-start gap-1.5 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={props.bridgeTosConfirm}
                  onChange={(e) => props.setBridgeTosConfirm(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>ToS-Restrisiko (ROT) für lokalen Start bestätigt</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!props.bridgeTosConfirm || props.executingBridgeId === props.selectedBridgeId}
                  onClick={() => void props.onExecuteBridge(props.selectedBridgeId, props.bridgeTosConfirm)}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  <Play className="h-3 w-3" aria-hidden="true" />
                  <span>Start</span>
                </button>
                <button
                  type="button"
                  onClick={() => void props.onStopBridge(props.selectedBridgeId)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Square className="h-3 w-3" aria-hidden="true" />
                  <span>Stop</span>
                </button>
                <button
                  type="button"
                  aria-label="Bridge prüfen"
                  onClick={() => void props.onProbeBridge(props.selectedBridgeId)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {props.targetType === 'custom_local' && (
            <div className="flex flex-wrap gap-1">
              {LOCAL_CODING_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    props.setEndpointUrl(preset.url);
                    props.setModelId(preset.model);
                  }}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-900"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <div>
              <label className="block font-mono text-[10px] uppercase text-slate-500">Basis-URL</label>
              <input
                type="text"
                value={props.endpointUrl}
                onChange={(e) => props.setEndpointUrl(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px] text-slate-900"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="font-mono text-[10px] uppercase text-slate-500">Modell</label>
                <button
                  type="button"
                  onClick={props.onLoadCatalogModels}
                  disabled={props.loadingModels}
                  className="font-mono text-[10px] font-medium text-teal-700 hover:underline disabled:opacity-50"
                >
                  {props.loadingModels ? 'Lade…' : 'Live /models laden'}
                </button>
              </div>

              {props.targetType === 'bridge' ? (
                <select
                  aria-label="Verifiziertes Bridge-Modell"
                  value={props.modelId}
                  onChange={(e) => props.setModelId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-900"
                >
                  {props.verifiedBridgeModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                      {m.note ? ` — ${m.note}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    type="text"
                    value={props.modelId}
                    onChange={(e) => props.setModelId(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px] text-slate-900"
                  />
                  {props.availableModels.length > 0 && (
                    <select
                      aria-label="Geladene Modelle"
                      value={props.availableModels.includes(props.modelId) ? props.modelId : ''}
                      onChange={(e) => {
                        if (e.target.value) props.setModelId(e.target.value);
                      }}
                      className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-800"
                    >
                      <option value="">Geladenes Modell wählen…</option>
                      {props.availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {props.modelsNote && <p className="mt-1 text-[10px] text-slate-500">{props.modelsNote}</p>}
            </div>

            {props.targetType !== 'bridge' && (
              <div>
                <label className="block font-mono text-[10px] uppercase text-slate-500">
                  Session API-Key (nur RAM)
                </label>
                <input
                  type="password"
                  value={props.apiKey}
                  onChange={(e) => props.setApiKey(e.target.value)}
                  placeholder="Optional / leer für Keyless-APIs"
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
