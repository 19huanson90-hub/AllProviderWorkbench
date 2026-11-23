export type CodingMainWay =
  | 'hf_space'
  | 'ai_horde'
  | 'free_uncensored_api'
  | 'cloud_tunnel'
  | 'catalog_or_bridge';

export type ThinkingMode = 'off' | 'standard' | 'deep';
export type CodingRolePreset = 'architect' | 'bugfix' | 'refactor' | 'tests' | 'security' | 'free';

export type CodingToolId =
  | 'list_workspace_files'
  | 'read_workspace_file'
  | 'search_workspace'
  | 'write_sandbox_file'
  | 'search_notebook_knowledge'
  | 'inspect_code_outline'
  | 'remember_fact'
  | 'recall_memory';

export interface WorkspaceTreeNode {
  name: string;
  path: string; // POSIX relative path from workspace root
  type: 'dir' | 'file';
  size?: number;
  language?: string;
  children?: WorkspaceTreeNode[];
}

export interface CodingToolEvent {
  id: string;
  tool: CodingToolId;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  resultPreview: string;
}

export interface HfSpacePreset {
  id: string;
  label: string;
  host: string;
  endpoint: string;
  hardware: string;
  requiresImage?: boolean;
  recommendedToken?: boolean;
  supportsThinking: boolean;
  supportsDflash?: boolean;
  supportsGpuDuration?: boolean;
  note: string;
  spaceUrl: string;
}

export const HF_SPACE_PRESETS: readonly HfSpacePreset[] = [
  {
    id: 'ukung/Muse-Glimmer-30B-DFlash-Abliterated',
    label: 'Muse-Glimmer 30B Abliterated (Live ohne Key · ~25 tok/s)',
    host: 'https://ukung-muse-glimmer-30b-dflash-abliterated.hf.space',
    endpoint: '/chat',
    hardware: 'zero-a10g',
    supportsThinking: true,
    supportsDflash: true,
    supportsGpuDuration: true,
    note: 'Empirisch ohne Login/Key getestet (HTTP 200). Natives Reasoning + DFlash-Beschleunigung.',
    spaceUrl: 'https://huggingface.co/spaces/ukung/Muse-Glimmer-30B-DFlash-Abliterated',
  },
  {
    id: 'markpaulm/gemma-4-31B-it-abliterated',
    label: 'Gemma 4 31B Abliterated (ZeroGPU · HF-Token empfohlen)',
    host: 'https://markpaulm-gemma-4-31b-it-abliterated.hf.space',
    endpoint: '/chat',
    hardware: 'zero-a10g',
    recommendedToken: true,
    supportsThinking: true,
    note: 'Natives Thinking-Flag & System-Prompt. Anonymes ZeroGPU-Kontingent teils knapp — kostenloser HF-Token erhöht Quota.',
    spaceUrl: 'https://huggingface.co/spaces/markpaulm/gemma-4-31B-it-abliterated',
  },
  {
    id: 'prithivMLmods/Qwen3-VL-abliterated-MAX-Fast',
    label: 'Qwen3-VL Abliterated (Vision / Code-Screenshot)',
    host: 'https://prithivmlmods-qwen3-vl-abliterated-max-fast.hf.space',
    endpoint: '/run_router',
    hardware: 'zero-a10g',
    requiresImage: true,
    supportsThinking: false,
    supportsGpuDuration: true,
    note: 'Vision-Space: Bitte Code-Screenshot oder UI-Bild anhängen (reiner Text-Prompt wird vom Space abgelehnt).',
    spaceUrl: 'https://huggingface.co/spaces/prithivMLmods/Qwen3-VL-abliterated-MAX-Fast',
  },
  {
    id: 'JonathanColetti/Qwen3.8-27B-Uncensored-Demo',
    label: 'Qwen 3.8 27B Uncensored (ZeroGPU · HF-Token / Browser)',
    host: 'https://jonathancoletti-qwen3-8-27b-uncensored-demo.hf.space',
    endpoint: '/respond',
    hardware: 'zero-a10g',
    recommendedToken: true,
    supportsThinking: true,
    note: 'Fordert 200 s ZeroGPU-Dauer an; per API meist HF-Token nötig oder direkt im Browser öffnen.',
    spaceUrl: 'https://huggingface.co/spaces/JonathanColetti/Qwen3.8-27B-Uncensored-Demo',
  },
];

export interface FreeUncensoredApiPreset {
  id: 'notrack-ai' | 'api-airforce' | 'electronhub' | 'ovh-ai-endpoints' | 'pollinations';
  label: string;
  baseUrl: string;
  needsKey: boolean;
  keyPageUrl?: string;
  docsUrl?: string;
  webChatUrl?: string;
  defaultModel: string;
  contextWindow?: number;
  models: readonly string[];
  warning: string;
}

export const FREE_UNCENSORED_API_PRESETS: readonly FreeUncensoredApiPreset[] = [
  {
    id: 'notrack-ai',
    label: 'NoTrack.ai (Offizielle API · notrack-uncensored · 100K)',
    baseUrl: 'https://api.notrack.ai/v1',
    needsKey: true,
    keyPageUrl: 'https://notrack.ai/api/keys',
    docsUrl: 'https://notrack.ai/api/docs',
    webChatUrl: 'https://notrack.ai/chat',
    defaultModel: 'notrack-uncensored',
    contextWindow: 100_000,
    models: ['notrack-uncensored'],
    warning:
      'Offizielle OpenAI-kompatible NoTrack-API (100K Kontext, SSE-Streaming, native Tools, Zero-Logs). Start: $0,50 Gratis-Guthaben (7 Tage, E-Mail-Verifizierung für Key), danach Prepaid ($0,15/1M Input, auch USDT/USDC). Webchat notrack.ai/chat sperrt Bots (HTTP 403).',
  },
  {
    id: 'api-airforce',
    label: 'Api.Airforce (23 unmoderierte Free-Modelle · Coding)',
    baseUrl: 'https://api.airforce/v1',
    needsKey: true,
    keyPageUrl: 'https://api.airforce',
    defaultModel: 'kimi-k2.7-code',
    contextWindow: 65_536,
    models: [
      'kimi-k2.7-code',
      'mistral-code-latest',
      'mistral-code-fim-latest',
      'codestral-latest',
      'codestral-2508',
      'mistral-large-4',
      'gpt-oss-20b',
      'open-mistral-nemo',
      'llama-instant',
    ],
    warning: 'Kostenloser Account-Key nötig · Limit: 1 Anfrage/Minute (1.000/Tag). `moderated: false` entfernt API-Zusatzfilter, nicht das Basis-Training.',
  },
  {
    id: 'electronhub',
    label: 'ElectronHub (gemma-4-uncensored:free)',
    baseUrl: 'https://api.electronhub.ai/v1',
    needsKey: true,
    keyPageUrl: 'https://www.electronhub.ai',
    defaultModel: 'gemma-4-uncensored:free',
    contextWindow: 32_768,
    models: [
      'gemma-4-uncensored:free',
      'hermes-4-70b',
      'llama-3.1-8b-lexi-uncensored-v2',
      'qwen3.8-27b-yes-man-uncensored',
    ],
    warning: 'Free-Plan-Key ($0) erforderlich · 5 RPM, Free-Requests teils via Ad-Rewards/Wochen-Credits. Drittanbieter-Datenpolitik unklar.',
  },
  {
    id: 'ovh-ai-endpoints',
    label: 'OVHcloud AI Endpoints (Ohne Key · Open-Weight)',
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    needsKey: false,
    defaultModel: 'gpt-oss-20b',
    contextWindow: 131_072,
    models: [
      'gpt-oss-20b',
      'Qwen3.8-27B',
      'DeepSeek-V4.1-Flash-1017',
      'Mistral-Small-3.2-24B-Instruct-2506',
      'gpt-oss-120b',
    ],
    warning: '100 % ohne API-Key, offene Gewichte (nicht abliterated). Strenges anonymes IP-Rate-Limit (bei schnellen Anfragen HTTP 429).',
  },
  {
    id: 'pollinations',
    label: 'Pollinations.ai (Ohne Key · Natives Thinking)',
    baseUrl: 'https://text.pollinations.ai/openai',
    needsKey: false,
    defaultModel: 'openai-fast',
    contextWindow: 65_536,
    models: ['openai-fast'],
    warning: '100 % ohne API-Key, liefert natives Thinking (`gpt-oss-20b`). Max. 1 Anfrage / 30 s pro IP; Antworten können öffentlich gecacht werden.',
  },
];

export const CLOUD_NOTEBOOK_MODELS = [
  { id: 'huihui_ai/qwen3-coder-abliterated', label: 'huihui_ai/qwen3-coder-abliterated (Empfohlen · Coding)' },
  { id: 'huihui_ai/qwen2.5-coder-abliterated:14b', label: 'huihui_ai/qwen2.5-coder-abliterated:14b (Kaggle 2×T4 / T4)' },
  { id: 'huihui_ai/qwen2.5-coder-abliterated:7b', label: 'huihui_ai/qwen2.5-coder-abliterated:7b (Schnell · Colab T4)' },
  { id: 'huihui_ai/deepseek-r1-abliterated:14b', label: 'huihui_ai/deepseek-r1-abliterated:14b (Deep Thinking)' },
  { id: 'dolphin-mistral', label: 'dolphin-mistral (7B · Sehr schnell)' },
] as const;

export const CODING_TOOL_DEFINITIONS: ReadonlyArray<{
  id: CodingToolId;
  label: string;
  description: string;
}> = [
  {
    id: 'list_workspace_files',
    label: 'Ordnerstruktur lesen',
    description: 'Listet erlaubte Projektordner & Dateien (blockiert .env/Secrets).',
  },
  {
    id: 'read_workspace_file',
    label: 'Projektdatei lesen',
    description: 'Liest Quellcode-Dateien aus dem geladenen Projekt (bis 256 KB).',
  },
  {
    id: 'search_workspace',
    label: 'Im Code suchen',
    description: 'Durchsucht Projektdateien nach Symbolen, Funktionen oder Fehlermeldungen.',
  },
  {
    id: 'write_sandbox_file',
    label: 'In Sandbox schreiben',
    description: 'Erstellt/ändert Code-Dateien strikt in coding-workspace/.',
  },
  {
    id: 'search_notebook_knowledge',
    label: 'Notebook-Wissen abfragen',
    description: 'Durchsucht Wissensdatenbank & Cross-Chat-Verlauf des aktiven Projekts.',
  },
  {
    id: 'inspect_code_outline',
    label: 'Code-Outline extrahieren',
    description: 'Extrahiert Funktionen, Klassen, Typen & Routen inkl. Zeilennummern ohne Volltext-Overhead.',
  },
  {
    id: 'remember_fact',
    label: 'Dauerhaft merken (Gedächtnis)',
    description: 'Speichert Fakten, Entscheidungen oder Präferenzen dauerhaft über alle Sitzungen (ohne Secrets).',
  },
  {
    id: 'recall_memory',
    label: 'Langzeit-Gedächtnis abrufen',
    description: 'Durchsucht alle dauerhaft gemerkten Fakten & Verlaufseinträge.',
  },
];

export const PROVIDER_WARNINGS: Record<
  CodingMainWay,
  { title: string; severity: 'amber' | 'red'; bullets: readonly string[] }
> = {
  hf_space: {
    title: 'Warnung: Öffentliche Hugging Face ZeroGPU-Spaces',
    severity: 'amber',
    bullets: [
      'Community-betriebene Cloud-GPUs ohne SLA: Spaces können jederzeit pausieren, überlastet sein oder geändert werden.',
      'Keine privaten Secrets, Passwörter oder vertraulichen Firmendaten senden (Drittanbieter-Server).',
      'Anonymes ZeroGPU-Tageskontingent ist begrenzt — ein optionaler kostenloser HF-Token (nur im RAM) erhöht das Limit.',
    ],
  },
  ai_horde: {
    title: 'Warnung: Dezentrales Volunteer-Netzwerk (AI Horde)',
    severity: 'amber',
    bullets: [
      'Deine Prompts werden über fremde Freiwilligen-GPUs (Community-Worker) verarbeitet — sende NIEMALS API-Keys, Passwörter oder sensiblen Firmencode.',
      'Anonyme Nutzung (Key 0000000000) hat niedrigere Warteschlangen-Priorität als ein kostenloser persönlicher Horde-Key.',
      'Antwortzeiten schwanken je nach verfügbaren Workern (meist 5–45 Sekunden).',
    ],
  },
  free_uncensored_api: {
    title: 'Warnung: Drittanbieter Free-APIs (Limits & Datenschutz)',
    severity: 'amber',
    bullets: [
      'Kostenlose API-Tiers haben strenge Rate-Limits (z. B. Api.Airforce 1 RPM, OVH IP-Limit, Pollinations 1 Req/30 s).',
      'Datenpolitik und Protokollierung externer Gratis-Aggregatoren sind nicht unabhängig auditiert.',
      'Session-API-Keys werden ausschließlich im RAM gehalten und niemals lokal gespeichert.',
    ],
  },
  cloud_tunnel: {
    title: 'Warnung: Cloud-GPU Notebook Tunnel (Kaggle / Colab)',
    severity: 'amber',
    bullets: [
      'Öffentliche Quick-Tunnel (*.trycloudflare.com etc.) sind temporär — jeder mit der URL könnte Anfragen senden, solange das Notebook läuft.',
      'Nutzungsbedingungen (ToS) von Google Colab / Kaggle beachten: dauerhafte Web-Server-Tunnels können im Free-Tier getrennt werden.',
      'Aus Sicherheitsgründen akzeptiert die Workbench ausschließlich HTTPS-Tunnel-Domains oder 127.0.0.1 (SSRF-Schutz).',
    ],
  },
  catalog_or_bridge: {
    title: 'Hinweis: Standard-Katalog / Lokale Bridges (ROT)',
    severity: 'amber',
    bullets: [
      'Lokale Bridges (Klasse ROT) nutzen Webclient-Schnittstellen mit ToS-Restrisiko — laufen strikt auf 127.0.0.1.',
      'Alle Katalog-Provider der Klassen GRÜN/GELB sind über denselben Workspace nutzbar.',
    ],
  },
};

export function buildCloudNotebookScript(
  platform: 'kaggle' | 'colab',
  modelId: string
): string {
  const safeModel = modelId.replace(/[^a-zA-Z0-9._:/-]/g, '') || 'huihui_ai/qwen3-coder-abliterated';
  return [
    `# ${platform === 'kaggle' ? 'Kaggle (Settings -> Accelerator: GPU T4 x2, Internet: ON)' : 'Google Colab (Runtime -> Change runtime type -> T4 GPU)'}`,
    '# 1. Ollama in der Cloud installieren & starten (keine lokale GPU noetig!)',
    '!curl -fsSL https://ollama.com/install.sh | sh',
    'import subprocess, time, re',
    'subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)',
    'time.sleep(3)',
    '',
    `# 2. Abliterated Coding-Modell in die Cloud-GPU laden (${safeModel})`,
    `!ollama pull ${safeModel}`,
    '',
    '# 3. Sicheren temporären HTTPS-Tunnel (Cloudflare) zu Ollama oeffnen',
    '!curl -fsSL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared',
    'proc = subprocess.Popen(["./cloudflared", "tunnel", "--url", "http://127.0.0.1:11434"], stderr=subprocess.PIPE, text=True)',
    'for line in proc.stderr:',
    '    m = re.search(r"https://[a-z0-9-]+\\.trycloudflare\\.com", line)',
    '    if m:',
    '        print("\\n=== KOPIERE DIESE URL IN WEG 4 (CLOUD-GPU TUNNEL) ===")',
    '        print(m.group(0) + "/v1")',
    '        break',
  ].join('\n');
}

export function buildCloudNotebookIpynb(platform: 'kaggle' | 'colab', modelId: string): string {
  const script = buildCloudNotebookScript(platform, modelId);
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.10' },
      ...(platform === 'colab' ? { accelerator: 'GPU' } : {}),
    },
    cells: [
      {
        cell_type: 'markdown',
        metadata: {},
        source: [
          `# Cloud-GPU Abliterated Coding Server (${platform === 'kaggle' ? 'Kaggle 2x T4' : 'Google Colab T4'})\n`,
          `Startet **Ollama** mit \`${modelId}\` auf einer kostenlosen Cloud-GPU und stellt einen temporären HTTPS-Tunnel für das Coding-Studio bereit.\n`,
        ],
      },
      {
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: [],
        source: script.split('\n').map((line, i, arr) => (i < arr.length - 1 ? `${line}\n` : line)),
      },
    ],
  };
  return JSON.stringify(nb, null, 2);
}

export function buildFolderTreeSummary(nodes: WorkspaceTreeNode[], maxLines = 120): string {
  const lines: string[] = [];
  const walk = (list: WorkspaceTreeNode[], indent: string) => {
    for (const node of list) {
      if (lines.length >= maxLines) return;
      lines.push(`${indent}${node.type === 'dir' ? `${node.name}/` : node.name}`);
      if (node.type === 'dir' && node.children) {
        walk(node.children, `${indent}  `);
      }
    }
  };
  walk(nodes, '');
  if (lines.length >= maxLines) {
    lines.push('… (gekürzt)');
  }
  return lines.join('\n');
}

export interface ExtractedCodeBlock {
  path: string;
  language: string;
  code: string;
  /** 0-based index among ALL fenced code blocks in the Markdown message (including skipped trees) */
  fenceIndex: number;
}

const LANG_TO_EXT: Record<string, string> = {
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  python: 'py',
  py: 'py',
  csharp: 'cs',
  'c#': 'cs',
  cs: 'cs',
  kotlin: 'kt',
  kt: 'kt',
  java: 'java',
  go: 'go',
  rust: 'rs',
  rs: 'rs',
  sql: 'sql',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  html: 'html',
  css: 'css',
  bash: 'sh',
  sh: 'sh',
  powershell: 'ps1',
  ps1: 'ps1',
  markdown: 'md',
  md: 'md',
};

function sanitizeSandboxSubpath(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^[`'"*#\s]+|[`'"*:\s]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.length > 140) return null;
  if (!/^[a-zA-Z0-9._/-]+\.[a-zA-Z][a-zA-Z0-9]{0,7}$/.test(cleaned)) return null;
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return null;
  const normalized = parts.join('/');
  return normalized.startsWith('coding-workspace/') ? normalized : `coding-workspace/${normalized}`;
}

export function isAsciiDirectoryTree(code: string, langToken: string): boolean {
  if (/[├└]─/.test(code) && (!langToken || langToken === 'code' || langToken === 'text' || langToken === 'tree' || langToken === 'plaintext')) {
    return true;
  }
  return false;
}

/**
 * Extracts fenced code blocks from Markdown assistant replies (including an unclosed trailing fence
 * if truncated) and infers safe `coding-workspace/...` target file paths from fence tags,
 * first-line comments, or preceding headings.
 */
export function extractCodeBlocksWithPaths(markdown: string): ExtractedCodeBlock[] {
  if (!markdown || !markdown.includes('```')) return [];
  const results: ExtractedCodeBlock[] = [];
  const usedPaths = new Set<string>();
  const fenceRe = /```([^\r\n`]*)\r?\n([\s\S]*?)(?:```|$)/g;
  let match: RegExpExecArray | null;
  let codeFileIdx = 0;
  let rawFenceIdx = -1;

  while ((match = fenceRe.exec(markdown)) !== null) {
    rawFenceIdx++;
    const info = (match[1] || '').trim();
    const code = (match[2] || '').replace(/\n+$/, '');
    if (!code.trim()) continue;

    const langToken = info.split(/[\s:]/)[0]?.toLowerCase() || '';
    if (isAsciiDirectoryTree(code, langToken)) {
      continue;
    }

    codeFileIdx++;
    let candidatePath: string | null = null;

    // 1) Fence info hint: ```python:sandbox/app.py or ```ts filename="src/a.ts"
    const colonHint = info.match(/^[^\s:]+:([^\s]+)$/);
    if (colonHint?.[1]) candidatePath = sanitizeSandboxSubpath(colonHint[1]);
    if (!candidatePath) {
      const attrHint = info.match(/(?:file|filename|path)=["']?([^\s"']+)["']?/i);
      if (attrHint?.[1]) candidatePath = sanitizeSandboxSubpath(attrHint[1]);
    }

    // 2) First line comment hint: # path/to/file.py or // file.ts
    if (!candidatePath) {
      const firstLine = code.split(/\r?\n/, 1)[0]?.trim() || '';
      const commentHint = firstLine.match(
        /^(?:#|\/\/|--|\/\*)\s*(?:file|datei|path)?[:\s]*([a-zA-Z0-9._/-]+\.[a-zA-Z][a-zA-Z0-9]{0,7})\b/i
      );
      if (commentHint?.[1]) candidatePath = sanitizeSandboxSubpath(commentHint[1]);
    }

    // 3) Preceding Markdown heading / bold filename within the last 240 chars before fence
    if (!candidatePath) {
      const before = markdown.slice(Math.max(0, match.index - 240), match.index);
      const beforeLines = before.split(/\r?\n/).reverse().slice(0, 4);
      for (const bl of beforeLines) {
        const mFile = bl.match(/([a-zA-Z0-9._/-]+\.[a-zA-Z][a-zA-Z0-9]{0,7})\b/);
        if (mFile?.[1]) {
          candidatePath = sanitizeSandboxSubpath(mFile[1]);
          if (candidatePath) break;
        }
      }
    }

    const ext = LANG_TO_EXT[langToken] || 'txt';
    let finalPath = candidatePath || `coding-workspace/generated-${codeFileIdx}.${ext}`;
    if (usedPaths.has(finalPath)) {
      const dot = finalPath.lastIndexOf('.');
      finalPath =
        dot > 0
          ? `${finalPath.slice(0, dot)}-${codeFileIdx}${finalPath.slice(dot)}`
          : `${finalPath}-${codeFileIdx}`;
    }
    usedPaths.add(finalPath);
    results.push({
      path: finalPath,
      language: langToken || 'text',
      code: `${code}\n`,
      fenceIndex: rawFenceIdx,
    });
  }

  return results;
}

