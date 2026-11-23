import type { ChatTargetType } from './chatEngine.ts';
import type { CodingToolEvent, CodingToolId } from './codingTypes.ts';

export interface NotebookKnowledgeDoc {
  id: string;
  title: string;
  sourceType: 'note' | 'file' | 'snippet';
  filename?: string;
  mimeType?: string;
  tags: string[];
  content: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAttachmentMeta {
  name: string;
  mimeType: string;
  kind: 'image' | 'text';
  sizeBytes?: number;
  previewText?: string;
}

export interface ChatContextCitation {
  sourceType: 'knowledge' | 'chat';
  id: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface NotebookChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  thinking?: string;
  createdAt: string;
  model?: string;
  latencyMs?: number;
  httpStatus?: number;
  targetUrl?: string;
  rawPreview?: string;
  attachments?: ChatAttachmentMeta[];
  contextSources?: ChatContextCitation[];
  toolEvents?: CodingToolEvent[];
  providerMeta?: Record<string, unknown>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface NotebookChatThread {
  id: string;
  title: string;
  pinned?: boolean;
  targetType: ChatTargetType;
  bridgeId?: string;
  providerId?: string;
  endpointUrl?: string;
  modelId?: string;
  messages: NotebookChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export type ChronoScheduleType = 'once' | 'interval_min' | 'hourly' | 'daily' | 'weekly';

export interface NotebookChronoJob {
  id: string;
  name: string;
  prompt: string;
  scheduleType: ChronoScheduleType;
  intervalMinutes?: number; // for interval_min (min 1, max 1440)
  timeOfDay?: string; // "HH:MM" for daily / weekly
  dayOfWeek?: number; // 0=So .. 6=Sa for weekly
  runAtIso?: string; // ISO datetime for once
  enabled: boolean;
  saveToKnowledge: boolean;
  includeSources: boolean;
  targetType: ChatTargetType;
  bridgeId?: string;
  providerId?: string;
  endpointUrl?: string;
  modelId?: string;
  targetChatId?: string;
  lastRunAt?: string | null;
  lastStatus?: 'idle' | 'running' | 'ok' | 'error';
  lastError?: string | null;
  lastSummary?: string | null;
  nextRunAt?: string | null;
  runCount: number;
  createdAt: string;
}

export interface NotebookProject {
  id: string;
  name: string;
  description: string;
  instructions: string;
  crossChatMemoryEnabled: boolean;
  knowledgeBaseEnabled: boolean;
  knowledgeDocs: NotebookKnowledgeDoc[];
  chats: NotebookChatThread[];
  chronoJobs: NotebookChronoJob[];
  createdAt: string;
  updatedAt: string;
}

export interface NotebooksWorkspace {
  version: 1;
  activeProjectId: string | null;
  projects: NotebookProject[];
}

export interface ProjectSearchHit {
  sourceType: 'knowledge' | 'chat';
  id: string;
  title: string;
  snippet: string;
  score: number;
  messageId?: string;
  updatedAt: string;
}

export interface RetrievedContextBundle {
  knowledgeHits: ChatContextCitation[];
  chatHits: ChatContextCitation[];
  citations: ChatContextCitation[];
  compiledSystemBlock: string;
}

export interface GrokBridgeHealthz {
  ok: boolean;
  accounts?: number;
  available?: number;
  statsig_ready?: boolean;
  sessions?: number;
  degraded_accounts?: number;
  redis?: unknown;
  raw?: unknown;
}

export interface GrokCapabilityInfo {
  id: string;
  label: string;
  supported: boolean;
  detail: string;
}

/**
 * Empirically verified ([Belegt]) capabilities of anojndr/grok.com-to-openai
 * directly derived from server.py & grok_gateway.py.
 */
export const GROK_BRIDGE_MODELS = [
  { id: 'grok-fast', label: 'grok-fast', desc: 'Schnell (Standard, Grok Fast)' },
  { id: 'grok-auto', label: 'grok-auto', desc: 'Automatische Modellwahl' },
  { id: 'grok-expert', label: 'grok-expert', desc: 'Tiefes Nachdenken (Thinking/Expert)' },
  { id: 'grok-build', label: 'grok-build', desc: 'Code & Architektur (Build-Modus)' },
  { id: 'grok-heavy', label: 'grok-heavy', desc: 'Heavy (nur bezahlter Account-Tier)' },
] as const;

export const GROK_BRIDGE_CAPABILITIES: GrokCapabilityInfo[] = [
  {
    id: 'chat-streaming',
    label: 'Multi-Turn Chat & Session-Fortsetzung',
    supported: true,
    detail: 'POST /v1/chat/completions & /v1/responses mit System-Prompt und Prefix-Session-Cache.',
  },
  {
    id: 'web-sources',
    label: 'Live Web- & X-Suche mit Quellenangaben',
    supported: true,
    detail: 'Parameter include_sources: true hängt echte Web-Quellenlinks an Suchantworten an.',
  },
  {
    id: 'imagine',
    label: 'Bildgenerierung & Bildbearbeitung (Grok Imagine)',
    supported: true,
    detail: 'Direkt im Chat per Prompt; Bridge liefert ![generated image](https://...) Links aus.',
  },
  {
    id: 'vision-uploads',
    label: 'Bild-Analyse & Datei-Anhänge',
    supported: true,
    detail: 'Bilder (image_url Base64) über Grok File-Upload v2; Text-/Code-Dateien automatisch inline.',
  },
  {
    id: 'healthz-pool',
    label: 'Live Account-Pool & Quarantäne-Status (/healthz)',
    supported: true,
    detail: 'Zeigt aktive/verfügbare Konten (~7 Anfragen/Std./Free-Konto), Sessions und statsig-Status.',
  },
  {
    id: 'binary-office',
    label: 'Direkter Download von .docx/.pptx/.xlsx/.pdf',
    supported: false,
    detail: 'Nur in der grok.com Web-Oberfläche — die OpenAI-Bridge liefert Text, Code, Quellen & Bild-URLs.',
  },
];

const STOP_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen',
  'und', 'oder', 'aber', 'nicht', 'auch', 'mit', 'von', 'fuer', 'für', 'auf', 'aus',
  'bei', 'nach', 'vor', 'wie', 'was', 'wer', 'wo', 'wann', 'warum', 'ist', 'sind',
  'war', 'wird', 'werden', 'kann', 'koennen', 'können', 'hat', 'haben', 'habe',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mein', 'dein', 'sein', 'uns', 'euch',
  'dass', 'daß', 'wenn', 'dann', 'noch', 'nur', 'schon', 'sehr', 'mehr', 'alle', 'alles',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'what', 'when', 'where', 'which',
  'have', 'has', 'had', 'are', 'was', 'were', 'will', 'can', 'could', 'should', 'would',
  'about', 'into', 'over', 'after', 'please', 'bitte', 'mal', 'mir', 'mich', 'dir',
]);

export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function createDefaultWorkspace(): NotebooksWorkspace {
  const now = new Date().toISOString();
  const projectId = 'proj-default-grok';
  const chatId = 'chat-default-1';
  return {
    version: 1,
    activeProjectId: projectId,
    projects: [
      {
        id: projectId,
        name: 'Grok Recherche & Notebook',
        description:
          'Standard-Projekt mit gemeinsamer Wissensdatenbank und gegenseitiger Chat-Suche.',
        instructions:
          'Antworte strukturiert, präzise und ehrlich auf Deutsch. Nutze beigefügte Projekt-Wissensnotizen und Erkenntnisse aus verwandten Projekt-Chats, wenn sie zur Frage passen, und nenne kurz die genutzte Quelle.',
        crossChatMemoryEnabled: true,
        knowledgeBaseEnabled: true,
        knowledgeDocs: [],
        chats: [
          {
            id: chatId,
            title: 'Haupt-Chat',
            pinned: false,
            targetType: 'bridge',
            bridgeId: 'grok-com-to-openai',
            endpointUrl: 'http://127.0.0.1:8106/v1',
            modelId: 'grok-fast',
            messages: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
        chronoJobs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

export function tokenizeForSearch(text: string): string[] {
  if (!text) return [];
  const normalized = text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_.-]+/g, ' ');
  const tokens: string[] = [];
  for (const part of normalized.split(/\s+/)) {
    const clean = part.replace(/^[_.-]+|[_.-]+$/g, '');
    if (clean.length < 2) continue;
    if (STOP_WORDS.has(clean)) continue;
    tokens.push(clean);
  }
  return tokens;
}

export function chunkText(text: string, maxChars = 900, overlap = 120): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < cleaned.length) {
    let end = Math.min(cleaned.length, cursor + maxChars);
    if (end < cleaned.length) {
      const nl = cleaned.lastIndexOf('\n\n', end);
      const lineNl = cleaned.lastIndexOf('\n', end);
      const sentence = cleaned.lastIndexOf('. ', end);
      const bestBreak = Math.max(nl, lineNl, sentence);
      if (bestBreak > cursor + Math.floor(maxChars * 0.45)) {
        end = bestBreak + 1;
      }
    }
    const piece = cleaned.slice(cursor, end).trim();
    if (piece) chunks.push(piece);
    if (end >= cleaned.length) break;
    cursor = Math.max(end - overlap, cursor + 1);
  }
  return chunks;
}

function scoreTextOverlap(
  queryTokens: string[],
  rawQueryLower: string,
  targetText: string,
  titleBoostText = ''
): number {
  if (!targetText.trim()) return 0;
  const targetTokens = tokenizeForSearch(targetText);
  const titleTokens = tokenizeForSearch(titleBoostText);
  if (queryTokens.length === 0) return 0;

  const targetSet = new Set(targetTokens);
  const titleSet = new Set(titleTokens);
  let score = 0;

  for (const qt of queryTokens) {
    if (targetSet.has(qt)) {
      score += 3;
    } else if (qt.length >= 4 && targetTokens.some((tt) => tt.includes(qt) || qt.includes(tt))) {
      score += 1.5;
    }
    if (titleSet.has(qt)) {
      score += 4;
    }
  }

  // Exact phrase bonus
  if (rawQueryLower.length >= 4 && targetText.toLowerCase().includes(rawQueryLower)) {
    score += 6;
  }

  // Normalize gently by query size
  return Math.round((score / Math.max(1, Math.sqrt(queryTokens.length))) * 100) / 100;
}

/**
 * Deterministic local RAG retrieval across a Project/Notebook's:
 * 1) Enabled Knowledge Base documents (chunked)
 * 2) Sibling Chats in the same project (cross-chat discovery!)
 * Strictly isolated to `project` — never leaks across different projects.
 */
export function retrieveProjectContext(params: {
  project: NotebookProject;
  activeChatId: string;
  query: string;
  maxKnowledgeChunks?: number;
  maxChatExcerpts?: number;
  maxTotalChars?: number;
}): RetrievedContextBundle {
  const {
    project,
    activeChatId,
    query,
    maxKnowledgeChunks = 4,
    maxChatExcerpts = 4,
    maxTotalChars = 5600,
  } = params;

  const queryTrimmed = query.trim();
  const queryLower = queryTrimmed.toLowerCase();
  const queryTokens = Array.from(new Set(tokenizeForSearch(queryTrimmed)));

  const knowledgeCandidates: Array<ChatContextCitation & { fullText: string }> = [];
  if (project.knowledgeBaseEnabled) {
    for (const doc of project.knowledgeDocs) {
      if (!doc.enabled || !doc.content.trim()) continue;
      const chunks = chunkText(doc.content, 950, 120);
      const titleAndTags = `${doc.title} ${doc.tags.join(' ')} ${doc.filename || ''}`;
      chunks.forEach((chunk, idx) => {
        const score = scoreTextOverlap(queryTokens, queryLower, chunk, titleAndTags);
        knowledgeCandidates.push({
          sourceType: 'knowledge',
          id: doc.id,
          title: chunks.length > 1 ? `${doc.title} (Abschnitt ${idx + 1}/${chunks.length})` : doc.title,
          excerpt: chunk.slice(0, 220),
          fullText: chunk,
          score,
        });
      });
    }
  }

  knowledgeCandidates.sort((a, b) => b.score - a.score);
  let selectedKnowledge = knowledgeCandidates
    .filter((c) => c.score > 0)
    .slice(0, maxKnowledgeChunks);

  // Fallback for broad/overview prompts (e.g. "fasse das Projekt zusammen") when KB docs are enabled
  if (selectedKnowledge.length === 0 && knowledgeCandidates.length > 0) {
    const seenDoc = new Set<string>();
    selectedKnowledge = knowledgeCandidates
      .filter((c) => {
        if (seenDoc.has(c.id)) return false;
        seenDoc.add(c.id);
        return true;
      })
      .slice(0, Math.min(2, maxKnowledgeChunks));
  }

  const chatCandidates: Array<ChatContextCitation & { fullText: string }> = [];
  if (project.crossChatMemoryEnabled) {
    for (const chat of project.chats) {
      if (chat.id === activeChatId) continue;
      const usableMsgs = chat.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
      if (usableMsgs.length === 0) continue;

      // Group consecutive user + assistant turns into cohesive retrievable exchanges
      for (let i = 0; i < usableMsgs.length; i++) {
        const m = usableMsgs[i];
        let block = '';
        if (m.role === 'user') {
          const next = usableMsgs[i + 1];
          if (next && next.role === 'assistant') {
            block = `Nutzer: ${m.content.slice(0, 420)}\nAntwort: ${next.content.slice(0, 680)}`;
            i++; // consumed pair
          } else {
            block = `Nutzer: ${m.content.slice(0, 500)}`;
          }
        } else {
          block = `Antwort: ${m.content.slice(0, 700)}`;
        }

        const rawScore = scoreTextOverlap(queryTokens, queryLower, block, chat.title);
        const pinBoost = chat.pinned ? 1.2 : 0;
        const score = rawScore > 0 ? Math.round((rawScore + pinBoost) * 100) / 100 : 0;
        chatCandidates.push({
          sourceType: 'chat',
          id: chat.id,
          title: chat.title,
          excerpt: block.slice(0, 220),
          fullText: block,
          score,
        });
      }
    }
  }

  chatCandidates.sort((a, b) => b.score - a.score);
  let selectedChats = chatCandidates.filter((c) => c.score > 0).slice(0, maxChatExcerpts);

  // If user asks broad project summary question ("was haben wir in anderen chats besprochen?"), include latest sibling exchanges
  if (
    selectedChats.length === 0 &&
    chatCandidates.length > 0 &&
    /zusammenfass|ueberblick|überblick|projekt|andere.? chat|chats|bisher|wissen|notiz/i.test(queryLower)
  ) {
    const seenChat = new Set<string>();
    selectedChats = chatCandidates
      .slice()
      .reverse()
      .filter((c) => {
        if (seenChat.has(c.id)) return false;
        seenChat.add(c.id);
        return true;
      })
      .slice(0, Math.min(2, maxChatExcerpts));
  }

  // Compile deterministic system context block within strict character budget
  const sections: string[] = [];
  let remaining = maxTotalChars;

  if (project.instructions.trim()) {
    const instr = `[PROJEKT-ANWEISUNG: ${project.name}]\n${project.instructions.trim().slice(0, 1200)}`;
    sections.push(instr);
    remaining -= instr.length;
  }

  const finalKnowledge: ChatContextCitation[] = [];
  if (selectedKnowledge.length > 0 && remaining > 240) {
    const kbLines: string[] = ['[PROJEKT-WISSENSDATENBANK — RELEVANTE AUSZÜGE]'];
    for (const item of selectedKnowledge) {
      const entry = `--- Quelle (Wissen): ${item.title} ---\n${item.fullText}`;
      if (entry.length > remaining - 120) {
        if (remaining > 320) {
          kbLines.push(entry.slice(0, remaining - 120) + '…');
          finalKnowledge.push({
            sourceType: item.sourceType,
            id: item.id,
            title: item.title,
            excerpt: item.excerpt,
            score: item.score,
          });
          remaining = 0;
        }
        break;
      }
      kbLines.push(entry);
      finalKnowledge.push({
        sourceType: item.sourceType,
        id: item.id,
        title: item.title,
        excerpt: item.excerpt,
        score: item.score,
      });
      remaining -= entry.length;
    }
    if (kbLines.length > 1) {
      sections.push(kbLines.join('\n\n'));
    }
  }

  const finalChats: ChatContextCitation[] = [];
  if (selectedChats.length > 0 && remaining > 240) {
    const chatLines: string[] = ['[VERWANDTE CHATS IM SELBEN PROJEKT (CROSS-CHAT-KONTEXT)]'];
    for (const item of selectedChats) {
      const entry = `--- Quelle (Chat: "${item.title}") ---\n${item.fullText}`;
      if (entry.length > remaining - 120) {
        if (remaining > 320) {
          chatLines.push(entry.slice(0, remaining - 120) + '…');
          finalChats.push({
            sourceType: item.sourceType,
            id: item.id,
            title: item.title,
            excerpt: item.excerpt,
            score: item.score,
          });
          remaining = 0;
        }
        break;
      }
      chatLines.push(entry);
      finalChats.push({
        sourceType: item.sourceType,
        id: item.id,
        title: item.title,
        excerpt: item.excerpt,
        score: item.score,
      });
      remaining -= entry.length;
    }
    if (chatLines.length > 1) {
      sections.push(chatLines.join('\n\n'));
    }
  }

  return {
    knowledgeHits: finalKnowledge,
    chatHits: finalChats,
    citations: [...finalKnowledge, ...finalChats],
    compiledSystemBlock: sections.join('\n\n'),
  };
}

/**
 * Instant full-text search across every chat message and every knowledge document inside a project.
 */
export function searchProjectEverything(
  project: NotebookProject,
  query: string
): ProjectSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();
  const tokens = Array.from(new Set(tokenizeForSearch(q)));
  const hits: ProjectSearchHit[] = [];

  for (const doc of project.knowledgeDocs) {
    const hay = `${doc.title}\n${doc.tags.join(' ')}\n${doc.content}`;
    const score = scoreTextOverlap(tokens, qLower, hay, `${doc.title} ${doc.tags.join(' ')}`);
    const rawMatch = hay.toLowerCase().includes(qLower);
    if (score > 0 || rawMatch) {
      const idx = doc.content.toLowerCase().indexOf(qLower);
      const start = idx >= 0 ? Math.max(0, idx - 50) : 0;
      const snippet = doc.content.slice(start, start + 180).replace(/\s+/g, ' ').trim();
      hits.push({
        sourceType: 'knowledge',
        id: doc.id,
        title: doc.title,
        snippet: snippet || doc.title,
        score: rawMatch ? score + 5 : score,
        updatedAt: doc.updatedAt,
      });
    }
  }

  for (const chat of project.chats) {
    let bestScore = scoreTextOverlap(tokens, qLower, chat.title, chat.title);
    let bestSnippet = '';
    let bestMessageId: string | undefined;

    for (const msg of chat.messages) {
      if (msg.role === 'error') continue;
      const s = scoreTextOverlap(tokens, qLower, msg.content, chat.title);
      const rawMatch = msg.content.toLowerCase().includes(qLower);
      const total = rawMatch ? s + 5 : s;
      if (total > bestScore) {
        bestScore = total;
        const idx = msg.content.toLowerCase().indexOf(qLower);
        const start = idx >= 0 ? Math.max(0, idx - 50) : 0;
        bestSnippet = msg.content.slice(start, start + 180).replace(/\s+/g, ' ').trim();
        bestMessageId = msg.id;
      }
    }

    if (bestScore > 0 || chat.title.toLowerCase().includes(qLower)) {
      hits.push({
        sourceType: 'chat',
        id: chat.id,
        title: chat.title,
        snippet: bestSnippet || `${chat.messages.length} Nachrichten`,
        score: bestScore || 1,
        messageId: bestMessageId,
        updatedAt: chat.updatedAt,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, 30);
}

/**
 * Validates and sanitizes safe URLs for Markdown links & Grok Imagine generated images.
 * Strictly blocks javascript:, data:, vbscript:, file:, etc. (XSS protection).
 */
export function sanitizeSafeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:') return parsed.toString();
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export type SafeMarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'image'; alt: string; url: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; text: string };

/**
 * Pure, XSS-safe Markdown block parser (zero raw HTML rendering) tailored for
 * Grok / OpenAI assistant replies including code fences, bullet lists, headings,
 * and Grok Imagine `![alt](https://...)` images.
 */
export function parseSafeMarkdownBlocks(markdown: string): SafeMarkdownBlock[] {
  const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: SafeMarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block ```lang
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().slice(0, 32);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      blocks.push({ type: 'code', language: lang, code: codeLines.join('\n') });
      continue;
    }

    // Standalone Markdown image ![alt](url) (e.g. Grok Imagine output)
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imgMatch) {
      const safe = sanitizeSafeHttpUrl(imgMatch[2]);
      if (safe) {
        blocks.push({ type: 'image', alt: imgMatch[1] || 'Generiertes Bild', url: safe });
        i++;
        continue;
      }
    }

    // Heading ### ...
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Bullet or numbered list
    if (/^([-*•]|\d+\.)\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^([-*•]|\d+\.)\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^([-*•]|\d+\.)\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Paragraph (gather consecutive plain text lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^(#{1,4})\s+/.test(lines[i].trim()) &&
      !/^([-*•]|\d+\.)\s+/.test(lines[i].trim()) &&
      !/^!\[([^\]]*)\]\(([^)\s]+)\)$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

/**
 * Validates and normalizes an incoming NotebooksWorkspace payload before writing to local disk.
 * Structurally strips any unknown or sensitive fields (e.g. apiKey) to enforce Hard Rule 2.
 */
export function validateWorkspacePayload(
  raw: unknown
): { ok: true; workspace: NotebooksWorkspace } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Ungültiges Notebooks-JSON.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.projects)) {
    return { ok: false, error: 'Feld "projects" muss ein Array sein.' };
  }
  if (obj.projects.length > 50) {
    return { ok: false, error: 'Maximal 50 Projekte/Notebooks zulässig.' };
  }

  const now = new Date().toISOString();
  const cleanProjects: NotebookProject[] = [];

  for (const rawProj of obj.projects) {
    if (!rawProj || typeof rawProj !== 'object') continue;
    const p = rawProj as Record<string, unknown>;
    const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim().slice(0, 80) : createId('proj');
    const name =
      typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 120) : 'Unbenanntes Projekt';

    const rawDocs = Array.isArray(p.knowledgeDocs) ? p.knowledgeDocs.slice(0, 120) : [];
    const knowledgeDocs: NotebookKnowledgeDoc[] = [];
    for (const rawDoc of rawDocs) {
      if (!rawDoc || typeof rawDoc !== 'object') continue;
      const d = rawDoc as Record<string, unknown>;
      const content = typeof d.content === 'string' ? d.content.slice(0, 200000) : '';
      const srcType =
        d.sourceType === 'file' || d.sourceType === 'snippet' ? d.sourceType : 'note';
      knowledgeDocs.push({
        id: typeof d.id === 'string' && d.id.trim() ? d.id.trim().slice(0, 80) : createId('doc'),
        title:
          typeof d.title === 'string' && d.title.trim()
            ? d.title.trim().slice(0, 140)
            : 'Wissensnotiz',
        sourceType: srcType,
        filename: typeof d.filename === 'string' ? d.filename.slice(0, 140) : undefined,
        mimeType: typeof d.mimeType === 'string' ? d.mimeType.slice(0, 80) : undefined,
        tags: Array.isArray(d.tags)
          ? d.tags
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t) => t.trim().slice(0, 40))
              .slice(0, 12)
          : [],
        content,
        enabled: d.enabled !== false,
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : now,
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : now,
      });
    }

    const rawChats = Array.isArray(p.chats) ? p.chats.slice(0, 120) : [];
    const chats: NotebookChatThread[] = [];
    for (const rawChat of rawChats) {
      if (!rawChat || typeof rawChat !== 'object') continue;
      const c = rawChat as Record<string, unknown>;
      const tType =
        c.targetType === 'bridge' ||
        c.targetType === 'provider' ||
        c.targetType === 'litellm' ||
        c.targetType === 'custom_local'
          ? c.targetType
          : 'bridge';
      const rawMsgs = Array.isArray(c.messages) ? c.messages.slice(-150) : [];
      const messages: NotebookChatMessage[] = [];
      for (const rawMsg of rawMsgs) {
        if (!rawMsg || typeof rawMsg !== 'object') continue;
        const m = rawMsg as Record<string, unknown>;
        if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'error') continue;
        if (typeof m.content !== 'string') continue;
        messages.push({
          id: typeof m.id === 'string' ? m.id.slice(0, 80) : createId('msg'),
          role: m.role,
          content: m.content.slice(0, 64000),
          thinking: typeof m.thinking === 'string' && m.thinking.trim() ? m.thinking.slice(0, 24000) : undefined,
          createdAt: typeof m.createdAt === 'string' ? m.createdAt.slice(0, 32) : '',
          model: typeof m.model === 'string' ? m.model.slice(0, 120) : undefined,
          latencyMs: typeof m.latencyMs === 'number' ? m.latencyMs : undefined,
          httpStatus: typeof m.httpStatus === 'number' ? m.httpStatus : undefined,
          targetUrl: typeof m.targetUrl === 'string' ? m.targetUrl.slice(0, 300) : undefined,
          rawPreview: typeof m.rawPreview === 'string' ? m.rawPreview.slice(0, 800) : undefined,
          attachments: Array.isArray(m.attachments)
            ? m.attachments
                .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
                .slice(0, 6)
                .map((a) => ({
                  name: typeof a.name === 'string' ? a.name.slice(0, 120) : 'Anhang',
                  mimeType: typeof a.mimeType === 'string' ? a.mimeType.slice(0, 60) : 'text/plain',
                  kind: a.kind === 'image' ? 'image' : 'text',
                  sizeBytes: typeof a.sizeBytes === 'number' ? a.sizeBytes : undefined,
                  previewText:
                    typeof a.previewText === 'string' ? a.previewText.slice(0, 300) : undefined,
                }))
            : undefined,
          contextSources: Array.isArray(m.contextSources)
            ? m.contextSources
                .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
                .slice(0, 12)
                .map((s) => ({
                  sourceType: s.sourceType === 'chat' ? 'chat' : 'knowledge',
                  id: typeof s.id === 'string' ? s.id.slice(0, 80) : '',
                  title: typeof s.title === 'string' ? s.title.slice(0, 140) : '',
                  excerpt: typeof s.excerpt === 'string' ? s.excerpt.slice(0, 240) : '',
                  score: typeof s.score === 'number' ? s.score : 0,
                }))
            : undefined,
          toolEvents: Array.isArray(m.toolEvents)
            ? m.toolEvents
                .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === 'object'))
                .slice(0, 12)
                .map((t) => ({
                  id: typeof t.id === 'string' ? t.id.slice(0, 80) : createId('tool'),
                  tool: (typeof t.tool === 'string' ? t.tool : 'list_workspace_files') as CodingToolId,
                  args: {},
                  ok: Boolean(t.ok),
                  summary: typeof t.summary === 'string' ? t.summary.slice(0, 200) : '',
                  resultPreview: typeof t.resultPreview === 'string' ? t.resultPreview.slice(0, 400) : '',
                }))
            : undefined,
        });
      }

      chats.push({
        id: typeof c.id === 'string' && c.id.trim() ? c.id.trim().slice(0, 80) : createId('chat'),
        title:
          typeof c.title === 'string' && c.title.trim() ? c.title.trim().slice(0, 120) : 'Neuer Chat',
        pinned: Boolean(c.pinned),
        targetType: tType,
        bridgeId: typeof c.bridgeId === 'string' ? c.bridgeId.slice(0, 80) : undefined,
        providerId: typeof c.providerId === 'string' ? c.providerId.slice(0, 80) : undefined,
        endpointUrl: typeof c.endpointUrl === 'string' ? c.endpointUrl.slice(0, 300) : undefined,
        modelId: typeof c.modelId === 'string' ? c.modelId.slice(0, 120) : undefined,
        messages,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : now,
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : now,
      });
    }

    const rawJobs = Array.isArray(p.chronoJobs) ? p.chronoJobs.slice(0, 40) : [];
    const chronoJobs: NotebookChronoJob[] = [];
    for (const rawJob of rawJobs) {
      if (!rawJob || typeof rawJob !== 'object') continue;
      const j = rawJob as Record<string, unknown>;
      const sType: ChronoScheduleType =
        j.scheduleType === 'once' ||
        j.scheduleType === 'interval_min' ||
        j.scheduleType === 'hourly' ||
        j.scheduleType === 'daily' ||
        j.scheduleType === 'weekly'
          ? j.scheduleType
          : 'daily';
      const tType: ChatTargetType =
        j.targetType === 'bridge' ||
        j.targetType === 'provider' ||
        j.targetType === 'litellm' ||
        j.targetType === 'custom_local'
          ? j.targetType
          : 'bridge';
      const intervalMinutes =
        typeof j.intervalMinutes === 'number' && Number.isFinite(j.intervalMinutes)
          ? Math.max(1, Math.min(1440, Math.floor(j.intervalMinutes)))
          : 60;
      const timeOfDay =
        typeof j.timeOfDay === 'string' && /^\d{2}:\d{2}$/.test(j.timeOfDay.trim())
          ? j.timeOfDay.trim()
          : '09:00';
      const dayOfWeek =
        typeof j.dayOfWeek === 'number' && j.dayOfWeek >= 0 && j.dayOfWeek <= 6
          ? Math.floor(j.dayOfWeek)
          : 1;
      const job: NotebookChronoJob = {
        id: typeof j.id === 'string' && j.id.trim() ? j.id.trim().slice(0, 80) : createId('job'),
        name:
          typeof j.name === 'string' && j.name.trim()
            ? j.name.trim().slice(0, 120)
            : 'Geplanter Prompt',
        prompt: typeof j.prompt === 'string' ? j.prompt.slice(0, 8000) : '',
        scheduleType: sType,
        intervalMinutes,
        timeOfDay,
        dayOfWeek,
        runAtIso: typeof j.runAtIso === 'string' ? j.runAtIso.slice(0, 40) : undefined,
        enabled: j.enabled !== false,
        saveToKnowledge: Boolean(j.saveToKnowledge),
        includeSources: Boolean(j.includeSources),
        targetType: tType,
        bridgeId: typeof j.bridgeId === 'string' ? j.bridgeId.slice(0, 80) : undefined,
        providerId: typeof j.providerId === 'string' ? j.providerId.slice(0, 80) : undefined,
        endpointUrl: typeof j.endpointUrl === 'string' ? j.endpointUrl.slice(0, 300) : undefined,
        modelId: typeof j.modelId === 'string' ? j.modelId.slice(0, 120) : undefined,
        targetChatId: typeof j.targetChatId === 'string' ? j.targetChatId.slice(0, 80) : undefined,
        lastRunAt: typeof j.lastRunAt === 'string' ? j.lastRunAt : null,
        lastStatus:
          j.lastStatus === 'running' || j.lastStatus === 'ok' || j.lastStatus === 'error'
            ? j.lastStatus
            : 'idle',
        lastError: typeof j.lastError === 'string' ? j.lastError.slice(0, 400) : null,
        lastSummary: typeof j.lastSummary === 'string' ? j.lastSummary.slice(0, 300) : null,
        nextRunAt: typeof j.nextRunAt === 'string' ? j.nextRunAt : null,
        runCount: typeof j.runCount === 'number' && j.runCount >= 0 ? Math.floor(j.runCount) : 0,
        createdAt: typeof j.createdAt === 'string' ? j.createdAt : now,
      };
      if (job.enabled && !job.nextRunAt) {
        job.nextRunAt = computeNextRunAt(job, new Date());
      }
      chronoJobs.push(job);
    }

    cleanProjects.push({
      id,
      name,
      description: typeof p.description === 'string' ? p.description.slice(0, 500) : '',
      instructions: typeof p.instructions === 'string' ? p.instructions.slice(0, 4000) : '',
      crossChatMemoryEnabled: p.crossChatMemoryEnabled !== false,
      knowledgeBaseEnabled: p.knowledgeBaseEnabled !== false,
      knowledgeDocs,
      chats,
      chronoJobs,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : now,
      updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
    });
  }

  const activeProjectId =
    typeof obj.activeProjectId === 'string' &&
    cleanProjects.some((p) => p.id === obj.activeProjectId)
      ? obj.activeProjectId
      : cleanProjects[0]?.id ?? null;

  return {
    ok: true,
    workspace: {
      version: 1,
      activeProjectId,
      projects: cleanProjects,
    },
  };
}

/**
 * Computes the next scheduled ISO timestamp for a Chrono-Job deterministically.
 */
export function computeNextRunAt(
  job: Pick<
    NotebookChronoJob,
    'scheduleType' | 'intervalMinutes' | 'timeOfDay' | 'dayOfWeek' | 'runAtIso' | 'enabled' | 'lastRunAt'
  >,
  fromDate: Date = new Date()
): string | null {
  if (!job.enabled) return null;
  const nowMs = fromDate.getTime();

  if (job.scheduleType === 'once') {
    if (!job.runAtIso) return null;
    const t = Date.parse(job.runAtIso);
    if (Number.isNaN(t)) return null;
    if (job.lastRunAt && Date.parse(job.lastRunAt) >= t) return null;
    return new Date(t).toISOString();
  }

  if (job.scheduleType === 'interval_min') {
    const mins = Math.max(1, Math.min(1440, Math.floor(job.intervalMinutes || 60)));
    return new Date(nowMs + mins * 60_000).toISOString();
  }

  if (job.scheduleType === 'hourly') {
    const next = new Date(nowMs);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next.toISOString();
  }

  const [hhRaw, mmRaw] = (job.timeOfDay || '09:00').split(':');
  const hh = Math.max(0, Math.min(23, Number(hhRaw) || 9));
  const mm = Math.max(0, Math.min(59, Number(mmRaw) || 0));

  if (job.scheduleType === 'daily') {
    const next = new Date(nowMs);
    next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= nowMs) {
      next.setDate(next.getDate() + 1);
    }
    return next.toISOString();
  }

  // weekly
  const targetDow =
    typeof job.dayOfWeek === 'number' && job.dayOfWeek >= 0 && job.dayOfWeek <= 6
      ? job.dayOfWeek
      : 1;
  const next = new Date(nowMs);
  next.setHours(hh, mm, 0, 0);
  let deltaDays = (targetDow - next.getDay() + 7) % 7;
  if (deltaDays === 0 && next.getTime() <= nowMs) {
    deltaDays = 7;
  }
  next.setDate(next.getDate() + deltaDays);
  return next.toISOString();
}

export function isJobDue(job: NotebookChronoJob, now: Date = new Date()): boolean {
  if (!job.enabled || !job.prompt.trim()) return false;
  if (job.lastStatus === 'running') return false;
  if (!job.nextRunAt) return false;
  const dueMs = Date.parse(job.nextRunAt);
  if (Number.isNaN(dueMs)) return false;
  return dueMs <= now.getTime();
}

export type PromptRefineMode = 'structured' | 'research' | 'coding' | 'imagine';

/**
 * Deterministic instant local prompt optimizer (works offline without burning rate-limit quota).
 */
export function buildLocalImprovedPrompt(
  rawPrompt: string,
  mode: PromptRefineMode,
  projectName?: string
): string {
  const cleaned = rawPrompt.trim();
  if (!cleaned) return '';
  const scopeHint = projectName ? `Kontext: Projekt „${projectName}“.\n` : '';

  if (mode === 'research') {
    return [
      `${scopeHint}Aufgabe (Fakten- & Evidenzanalyse):`,
      cleaned,
      '',
      'Anforderungen:',
      '- Trenne strikt zwischen belegten Fakten, Konsens und offenen Annahmen.',
      '- Nenne konkrete Quellen/Datum, sofern verfügbar; erfinde keine Links oder Zitate.',
      '- Schließe mit einer kompakten Zusammenfassung (max. 5 Punkte) und offenen Fragen.',
    ].join('\n');
  }

  if (mode === 'coding') {
    return [
      `${scopeHint}Aufgabe (Software-Engineering & Architektur):`,
      cleaned,
      '',
      'Anforderungen:',
      '- Nenne zuerst kurz Architektur-Entscheidung & mögliche Edge-Cases.',
      '- Liefere sauberen, direkt ausführbaren Code ohne Platzhalter.',
      '- Kennzeichne Sicherheits-/Fehlerbehandlungs-Aspekte und mindestens 2 konkrete Testfälle.',
    ].join('\n');
  }

  if (mode === 'imagine') {
    return [
      `Erstelle ein hochauflösendes Bild (Grok Imagine) zu folgendem Motiv:`,
      cleaned,
      '',
      'Stil & Komposition: klares Hauptmotiv im Fokus, realistische Beleuchtung, ausgewogene Tiefenschärfe, hohe Detailtreue, keine verzerrten Texte oder Wasserzeichen.',
    ].join('\n');
  }

  // structured
  return [
    `${scopeHint}Ziel:`,
    cleaned,
    '',
    'Erwartetes Antwortformat:',
    '1. Kurze Kernaussage (2–3 Sätze)',
    '2. Strukturierte Details / Schritte mit konkreten Beispielen',
    '3. Mögliche Risiken, Einschränkungen oder nächste sinnvolle Schritte',
  ].join('\n');
}

/**
 * Builds the meta-prompt when the user chooses AI-powered prompt optimization via the active bridge/provider.
 */
export function buildAiRefineMetaPrompt(rawPrompt: string, mode: PromptRefineMode): string {
  const modeLabel: Record<PromptRefineMode, string> = {
    structured: 'klar strukturiert, präzise, ohne Mehrdeutigkeiten',
    research: 'wissenschaftlich-evidenzbasiert mit Quellentrennung und Verifikation',
    coding: 'technisch exakt für Softwareentwicklung, Edge-Cases und testbaren Code',
    imagine: 'visuell präzise für Bildgenerierung (Motiv, Licht, Perspektive, Stil)',
  };
  return [
    `Du bist ein Prompt-Engineering-Spezialist. Verbessere den folgenden Nutzer-Prompt für den Modus „${modeLabel[mode]}“.`,
    'Regeln:',
    '- Behalte die ursprüngliche Sprache und Absicht exakt bei.',
    '- Ergänze fehlende Klarheit (Rolle, Kontext, gewünschtes Format, Qualitätskriterien), ohne ihn unnötig aufzublähen.',
    '- Gib AUSSCHLIESSLICH den verbesserten Prompt zurück — ohne Einleitung, ohne Anführungszeichen, ohne Kommentar.',
    '',
    'Original-Prompt:',
    rawPrompt.trim(),
  ].join('\n');
}

/**
 * Exports a complete Project/Notebook (instructions, knowledge docs, chrono jobs, and all chats)
 * into a clean portable Markdown notebook file.
 */
export function exportProjectToMarkdown(project: NotebookProject): string {
  const lines: string[] = [
    `# Projekt / Notebook: ${project.name}`,
    '',
    project.description ? `> ${project.description}` : '',
    `- Exportiert am: ${new Date().toISOString()}`,
    `- Wissensdokumente: ${project.knowledgeDocs.length}`,
    `- Chats: ${project.chats.length}`,
    `- Chrono-Jobs: ${project.chronoJobs.length}`,
    '',
  ];

  if (project.instructions.trim()) {
    lines.push('## Projekt-Anweisungen', '', project.instructions.trim(), '');
  }

  if (project.knowledgeDocs.length > 0) {
    lines.push('## Wissensdatenbank', '');
    for (const doc of project.knowledgeDocs) {
      lines.push(
        `### ${doc.title} (${doc.enabled ? 'aktiv' : 'deaktiviert'}${doc.tags.length ? ` · Tags: ${doc.tags.join(', ')}` : ''})`,
        '',
        doc.content,
        ''
      );
    }
  }

  if (project.chronoJobs.length > 0) {
    lines.push('## Chrono-Jobs / Automatisierungen', '');
    for (const job of project.chronoJobs) {
      lines.push(
        `- **${job.name}** (${job.scheduleType}, ${job.enabled ? 'aktiv' : 'pausiert'}, Läufe: ${job.runCount}): ${job.prompt}`,
        ''
      );
    }
  }

  lines.push('## Chats', '');
  for (const chat of project.chats) {
    lines.push(`### Chat: ${chat.title} (${chat.messages.length} Nachrichten)`, '');
    for (const m of chat.messages) {
      const who = m.role === 'user' ? 'Nutzer' : m.role === 'assistant' ? (m.model || 'Assistant') : 'Fehler';
      lines.push(`**${who}** (${m.createdAt}):`, '', m.content, '');
    }
  }

  return lines.join('\n');
}

