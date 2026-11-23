export type CodingMemoryCategory = 'fact' | 'preference' | 'decision' | 'snippet' | 'todo';

export interface CodingMemoryEntry {
  id: string;
  title: string;
  content: string;
  category: CodingMemoryCategory;
  enabled: boolean;
  source: 'user' | 'assistant' | 'tool';
  createdAt: string;
  updatedAt: string;
}

export interface CodingMemoryStore {
  version: 1;
  autoInject: boolean;
  entries: CodingMemoryEntry[];
  updatedAt: string;
}

export interface CodeOutlineSymbol {
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'route' | 'method';
  name: string;
  line: number;
  signature: string;
}

export interface ContextBudgetEstimate {
  systemTokens: number;
  memoryTokens: number;
  filesTokens: number;
  historyTokens: number;
  totalTokens: number;
  contextWindow: number;
  usagePercent: number;
  status: 'ok' | 'warn' | 'critical';
}

const VALID_CATEGORIES = new Set<CodingMemoryCategory>([
  'fact',
  'preference',
  'decision',
  'snippet',
  'todo',
]);

const SECRET_PATTERN_RE =
  /\b(sk-[a-zA-Z0-9_-]{12,}|sk-notrack-[a-zA-Z0-9_-]{8,}|hf_[a-zA-Z0-9]{16,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/g;

export function createDefaultMemoryStore(): CodingMemoryStore {
  return {
    version: 1,
    autoInject: true,
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Redacts obvious API-key/secret token shapes so secrets are never written to persistent memory on disk.
 */
export function redactSecretsFromMemoryText(input: string): { text: string; redacted: boolean } {
  const raw = String(input || '');
  let redacted = false;
  const cleaned = raw.replace(SECRET_PATTERN_RE, () => {
    redacted = true;
    return '[REDACTED_SECRET]';
  });
  return { text: cleaned, redacted };
}

export function sanitizeMemoryEntry(raw: unknown): CodingMemoryEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 80) : '';
  const rawTitle = typeof r.title === 'string' ? r.title.trim() : '';
  const rawContent = typeof r.content === 'string' ? r.content.trim() : '';
  if (!id || !rawTitle || !rawContent) return null;

  const title = redactSecretsFromMemoryText(rawTitle.slice(0, 140)).text;
  const content = redactSecretsFromMemoryText(rawContent.slice(0, 2400)).text;
  const category: CodingMemoryCategory =
    typeof r.category === 'string' && VALID_CATEGORIES.has(r.category as CodingMemoryCategory)
      ? (r.category as CodingMemoryCategory)
      : 'fact';
  const source: CodingMemoryEntry['source'] =
    r.source === 'assistant' || r.source === 'tool' ? r.source : 'user';
  const now = new Date().toISOString();

  return {
    id,
    title,
    content,
    category,
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    source,
    createdAt: typeof r.createdAt === 'string' && r.createdAt ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : now,
  };
}

export function validateMemoryStorePayload(
  raw: unknown
): { ok: true; store: CodingMemoryStore } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Ungültiges Memory-Payload.' };
  }
  const obj = raw as Record<string, unknown>;
  const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
  const entries: CodingMemoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of rawEntries.slice(0, 120)) {
    const clean = sanitizeMemoryEntry(item);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      entries.push(clean);
    }
  }
  return {
    ok: true,
    store: {
      version: 1,
      autoInject: typeof obj.autoInject === 'boolean' ? obj.autoInject : true,
      entries,
      updatedAt: typeof obj.updatedAt === 'string' && obj.updatedAt ? obj.updatedAt : new Date().toISOString(),
    },
  };
}

export function upsertMemoryEntry(
  store: CodingMemoryStore,
  input: {
    id?: string;
    title: string;
    content: string;
    category?: CodingMemoryCategory;
    source?: CodingMemoryEntry['source'];
    enabled?: boolean;
  }
): { store: CodingMemoryStore; entry: CodingMemoryEntry; redacted: boolean } {
  const now = new Date().toISOString();
  const titleRes = redactSecretsFromMemoryText(input.title.trim().slice(0, 140));
  const contentRes = redactSecretsFromMemoryText(input.content.trim().slice(0, 2400));
  const category: CodingMemoryCategory =
    input.category && VALID_CATEGORIES.has(input.category) ? input.category : 'fact';

  const normalizedTitle = titleRes.text.toLowerCase();
  const existingIdx = store.entries.findIndex(
    (e) => (input.id && e.id === input.id) || e.title.trim().toLowerCase() === normalizedTitle
  );

  const entry: CodingMemoryEntry =
    existingIdx >= 0
      ? {
          ...store.entries[existingIdx],
          title: titleRes.text || store.entries[existingIdx].title,
          content: contentRes.text || store.entries[existingIdx].content,
          category,
          enabled: input.enabled ?? store.entries[existingIdx].enabled,
          updatedAt: now,
        }
      : {
          id: input.id || `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          title: titleRes.text || 'Notiz',
          content: contentRes.text,
          category,
          enabled: input.enabled ?? true,
          source: input.source ?? 'user',
          createdAt: now,
          updatedAt: now,
        };

  const nextEntries =
    existingIdx >= 0
      ? [entry, ...store.entries.filter((_, i) => i !== existingIdx)]
      : [entry, ...store.entries].slice(0, 120);

  return {
    store: {
      ...store,
      entries: nextEntries,
      updatedAt: now,
    },
    entry,
    redacted: titleRes.redacted || contentRes.redacted,
  };
}

export function searchMemoryEntries(
  store: CodingMemoryStore,
  query: string,
  includeDisabled = false
): CodingMemoryEntry[] {
  const q = (query || '').trim().toLowerCase();
  const pool = includeDisabled ? store.entries : store.entries.filter((e) => e.enabled);
  if (!q) return pool.slice(0, 15);
  const terms = q.split(/\s+/).filter((t) => t.length >= 2);
  const scored = pool
    .map((entry) => {
      const hay = `${entry.title}\n${entry.category}\n${entry.content}`.toLowerCase();
      let score = 0;
      if (hay.includes(q)) score += 6;
      for (const term of terms) {
        if (entry.title.toLowerCase().includes(term)) score += 3;
        if (entry.content.toLowerCase().includes(term)) score += 1;
      }
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 12).map((s) => s.entry);
}

/**
 * Compiles active persistent memory entries into a compact system prompt block.
 */
export function compileMemorySystemBlock(
  store: CodingMemoryStore,
  maxChars = 4200
): { block: string; activeCount: number } {
  if (!store.autoInject) return { block: '', activeCount: 0 };
  const active = store.entries.filter((e) => e.enabled);
  if (active.length === 0) return { block: '', activeCount: 0 };

  const lines: string[] = [
    'DAUERHAFTES LANGZEIT-GEDÄCHTNIS (MERKENDER VERLAUF — ÜBER SITZUNGEN HINWEG AKTIV):',
  ];
  let total = lines[0].length;
  let included = 0;

  for (const item of active) {
    const line = `- [${item.category.toUpperCase()}] ${item.title}: ${item.content.replace(/\s+/g, ' ').trim()}`;
    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
    included++;
  }

  return {
    block: included > 0 ? lines.join('\n') : '',
    activeCount: included,
  };
}

/**
 * Lightweight, deterministic code outline extractor for JS/TS/TSX, Python, and Go files.
 * Allows models to inspect file structure without loading thousands of lines.
 */
export function extractCodeOutline(content: string, language = ''): CodeOutlineSymbol[] {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const lang = language.toLowerCase();
  const symbols: CodeOutlineSymbol[] = [];

  for (let i = 0; i < lines.length && symbols.length < 160; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      continue;
    }

    // Express / HTTP route definitions
    const routeMatch = trimmed.match(/^(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/i);
    if (routeMatch) {
      symbols.push({
        kind: 'route',
        name: `${routeMatch[1].toUpperCase()} ${routeMatch[2]}`,
        line: i + 1,
        signature: trimmed.slice(0, 120),
      });
      continue;
    }

    if (lang === 'python' || lang === 'py') {
      const pyClass = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (pyClass) {
        symbols.push({ kind: 'class', name: pyClass[1], line: i + 1, signature: trimmed.slice(0, 120) });
        continue;
      }
      const pyDef = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (pyDef) {
        symbols.push({ kind: 'function', name: pyDef[1], line: i + 1, signature: trimmed.slice(0, 120) });
        continue;
      }
    }

    if (lang === 'go') {
      const goFunc = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (goFunc) {
        symbols.push({ kind: 'function', name: goFunc[1], line: i + 1, signature: trimmed.slice(0, 120) });
        continue;
      }
    }

    // JS / TS / TSX / generic C-style declarations
    const ifaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (ifaceMatch) {
      symbols.push({ kind: 'interface', name: ifaceMatch[1], line: i + 1, signature: trimmed.slice(0, 120) });
      continue;
    }
    const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    if (typeMatch) {
      symbols.push({ kind: 'type', name: typeMatch[1], line: i + 1, signature: trimmed.slice(0, 120) });
      continue;
    }
    const classMatch = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (classMatch) {
      symbols.push({ kind: 'class', name: classMatch[1], line: i + 1, signature: trimmed.slice(0, 120) });
      continue;
    }
    const fnMatch = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    if (fnMatch) {
      symbols.push({ kind: 'function', name: fnMatch[1], line: i + 1, signature: trimmed.slice(0, 120) });
      continue;
    }
    const arrowMatch = trimmed.match(
      /^(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/
    );
    if (arrowMatch) {
      symbols.push({ kind: 'const', name: arrowMatch[1], line: i + 1, signature: trimmed.slice(0, 120) });
      continue;
    }
  }

  return symbols;
}

/**
 * Heuristic token estimator (~4 chars/token) for live Context-Budget UI telemetry.
 */
export function estimateTokensApprox(text: string): number {
  const len = (text || '').trim().length;
  if (len === 0) return 0;
  return Math.max(1, Math.ceil(len / 4));
}

export function estimateContextTokenBudget(params: {
  systemText: string;
  memoryText: string;
  pinnedFilesText: string;
  historyTexts: readonly string[];
  contextWindow: number;
}): ContextBudgetEstimate {
  const systemTokens = estimateTokensApprox(params.systemText);
  const memoryTokens = estimateTokensApprox(params.memoryText);
  const filesTokens = estimateTokensApprox(params.pinnedFilesText);
  const historyTokens = params.historyTexts.reduce((acc, t) => acc + estimateTokensApprox(t), 0);
  const totalTokens = systemTokens + memoryTokens + filesTokens + historyTokens;
  const contextWindow = Math.max(4096, params.contextWindow || 32768);
  const usagePercent = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
  const status: ContextBudgetEstimate['status'] =
    usagePercent >= 85 ? 'critical' : usagePercent >= 60 ? 'warn' : 'ok';

  return {
    systemTokens,
    memoryTokens,
    filesTokens,
    historyTokens,
    totalTokens,
    contextWindow,
    usagePercent,
    status,
  };
}
