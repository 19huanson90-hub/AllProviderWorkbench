import fs from 'node:fs';
import path from 'node:path';
import type { CodingToolEvent, CodingToolId } from './codingTypes.ts';
import {
  buildFolderTreeSummary,
  isBlockedWorkspaceEntryName,
  MAX_WORKSPACE_FILE_BYTES,
  readSafeWorkspaceFile,
  scanSafeWorkspaceTree,
  writeSafeCodingSandboxFile,
} from './codingWorkspace.ts';
import {
  createId,
  searchProjectEverything,
  type NotebookProject,
} from './notebookEngine.ts';

export interface ToolExecutionContext {
  rootDir: string;
  activeProject?: NotebookProject | null;
  enabledTools: ReadonlySet<CodingToolId>;
}

export interface ToolExecutionResult {
  event: CodingToolEvent;
  outputText: string;
  writtenFilePath?: string;
}

/**
 * OpenAI-compatible JSON schema tool definitions for native tool-calling providers
 * (Weg 3 Free Uncensored APIs, Weg 4 Cloud-GPU Ollama/vLLM Tunnel, etc.).
 */
export function buildOpenAiToolSchemas(enabledTools: ReadonlySet<CodingToolId>): Array<Record<string, unknown>> {
  const all: Record<CodingToolId, Record<string, unknown>> = {
    list_workspace_files: {
      type: 'function',
      function: {
        name: 'list_workspace_files',
        description: 'Listet die Ordner- und Dateistruktur des aktuellen Projekts auf (ohne Secrets/node_modules).',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: 'Optionaler Unterordner, z. B. "src" oder "coding-workspace".' },
          },
        },
      },
    },
    read_workspace_file: {
      type: 'function',
      function: {
        name: 'read_workspace_file',
        description: 'Liest eine Quellcode- oder Textdatei aus dem lokalen Projektverzeichnis.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relativer Dateipfad, z. B. "src/App.tsx" oder "package.json".' },
          },
          required: ['path'],
        },
      },
    },
    search_workspace: {
      type: 'function',
      function: {
        name: 'search_workspace',
        description: 'Durchsucht Projektdateien nach einem Funktionsnamen, Text oder Fehler-String.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Suchbegriff (mindestens 2 Zeichen).' },
          },
          required: ['query'],
        },
      },
    },
    write_sandbox_file: {
      type: 'function',
      function: {
        name: 'write_sandbox_file',
        description: 'Schreibt oder erstellt eine Code-Datei sicher in der Sandbox (coding-workspace/...).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Zieldatei in coding-workspace/, z. B. "coding-workspace/demo.py".' },
            content: { type: 'string', description: 'Vollständiger UTF-8-Dateiinhalt.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    search_notebook_knowledge: {
      type: 'function',
      function: {
        name: 'search_notebook_knowledge',
        description: 'Durchsucht die Wissensdatenbank und frühere Chats des aktiven Notebook-Projekts.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Suchbegriff für Wissensdokumente und Chats.' },
          },
          required: ['query'],
        },
      },
    },
  };

  const out: Array<Record<string, unknown>> = [];
  for (const id of enabledTools) {
    if (all[id]) out.push(all[id]);
  }
  return out;
}

const CASUAL_SHORT_PROMPT_RE =
  /^(hi+|hey+|hallo+|moin|servus|tach|yo+|jo+|ok(ay)?|ja+|nein|nee|nö|danke|thx|thanks|bitte|cool|super|gut|alles klar|wie geht'?s\??|was geht\??|test|ping|i|a|hm+|aha|alles gut)[!.?\s]*$/i;

const TOOL_INTENT_HINT_RE =
  /(datei|file|ordner|folder|projekt|project|code|src\/|coding-workspace|lies|read|such|search|schreib|write|erstell|speicher|notebook|wissen|bug|fehler|test|refact|class|function|import|export|package\.json|\.[a-z]{1,4}\b)/i;

/**
 * Returns false for short casual greetings/acknowledgements ("hi", "jo", "ok", "i", etc.)
 * so remote GPU providers (HF Spaces, AI Horde) never waste a second queue round calling workspace tools.
 */
export function shouldOfferReActTools(latestUserText: string): boolean {
  const trimmed = (latestUserText || '').trim();
  if (!trimmed) return false;
  if (TOOL_INTENT_HINT_RE.test(trimmed)) return true;
  if (CASUAL_SHORT_PROMPT_RE.test(trimmed)) return false;
  if (trimmed.length <= 12 && !/\s/.test(trimmed)) return false;
  return true;
}

/**
 * Textual tool instruction block for models without native OpenAI `tools` support
 * (Weg 1 Hugging Face ZeroGPU Spaces & Weg 2 AI Horde).
 */
export function buildReActToolPrompt(enabledTools: ReadonlySet<CodingToolId>): string {
  if (enabledTools.size === 0) return '';
  const lines: string[] = [
    'Du hast optionalen Zugriff auf lokale Coding-Studio-Tools. WICHTIG: Rufe NIEMALS ein Tool auf bei Begrüßungen, Smalltalk oder allgemeinen Fragen ohne konkreten Bezug zu Projektdateien oder Notebooks!',
    'Nur wenn du ausdrücklich Projektdateien lesen, suchen, in coding-workspace/ speichern oder Notebook-Wissen abfragen musst, gib EXAKT diesen Block aus:',
    '<tool_call>{"name":"TOOL_NAME","arguments":{...}}</tool_call>',
    'Verfügbare Tools:',
  ];
  if (enabledTools.has('list_workspace_files')) {
    lines.push('- list_workspace_files(dir?: string): Zeigt Ordner-/Dateistruktur.');
  }
  if (enabledTools.has('read_workspace_file')) {
    lines.push('- read_workspace_file(path: string): Liest eine Projektdatei.');
  }
  if (enabledTools.has('search_workspace')) {
    lines.push('- search_workspace(query: string): Sucht im Projektcode.');
  }
  if (enabledTools.has('write_sandbox_file')) {
    lines.push('- write_sandbox_file(path: string, content: string): Speichert Code in coding-workspace/.');
  }
  if (enabledTools.has('search_notebook_knowledge')) {
    lines.push('- search_notebook_knowledge(query: string): Durchsucht Notebook-Wissen & Chats.');
  }
  lines.push('Antworte bei normalen Fragen direkt OHNE <tool_call>.');
  return lines.join('\n');
}

export function extractReActToolCalls(text: string): Array<{ name: string; arguments: Record<string, unknown> }> {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && calls.length < 3) {
    try {
      const parsed = JSON.parse(m[1]) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name === 'string' && parsed.name.trim()) {
        const args =
          parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
            ? (parsed.arguments as Record<string, unknown>)
            : {};
        calls.push({ name: parsed.name.trim(), arguments: args });
      }
    } catch {
      // ignore malformed tool_call JSON
    }
  }
  return calls;
}

function searchSafeWorkspaceFiles(
  rootDir: string,
  query: string,
  maxMatches = 20
): Array<{ path: string; line: number; text: string }> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const canonicalRoot = fs.realpathSync(path.resolve(rootDir));
  const matches: Array<{ path: string; line: number; text: string }> = [];
  let scannedFiles = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > 5 || matches.length >= maxMatches || scannedFiles > 260) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      if (matches.length >= maxMatches || scannedFiles > 260) break;
      if (d.isSymbolicLink()) continue;
      if (isBlockedWorkspaceEntryName(d.name, d.isDirectory())) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) {
        walk(abs, depth + 1);
      } else if (d.isFile()) {
        scannedFiles++;
        try {
          const stat = fs.statSync(abs);
          if (stat.size > MAX_WORKSPACE_FILE_BYTES) continue;
          const buf = fs.readFileSync(abs);
          let isBin = false;
          for (let i = 0; i < Math.min(buf.length, 1024); i++) {
            if (buf[i] === 0) {
              isBin = true;
              break;
            }
          }
          if (isBin) continue;
          const rel = path.relative(canonicalRoot, abs).split(path.sep).join('/');
          const lines = buf.toString('utf8').split(/\r?\n/);
          for (let li = 0; li < lines.length; li++) {
            if (lines[li].toLowerCase().includes(q)) {
              matches.push({ path: rel, line: li + 1, text: lines[li].trim().slice(0, 180) });
              if (matches.length >= maxMatches) break;
            }
          }
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(canonicalRoot, 0);
  return matches;
}

export function executeCodingTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): ToolExecutionResult {
  const id = createId('tool');
  const validTool = toolName as CodingToolId;

  if (!ctx.enabledTools.has(validTool)) {
    const msg = `Tool "${toolName}" ist aktuell deaktiviert oder unbekannt.`;
    return {
      event: { id, tool: validTool, args, ok: false, summary: msg, resultPreview: msg },
      outputText: msg,
    };
  }

  if (validTool === 'list_workspace_files') {
    const dir = typeof args.dir === 'string' ? args.dir : '';
    const scanned = scanSafeWorkspaceTree(ctx.rootDir, dir);
    if (!scanned.ok) {
      return {
        event: { id, tool: validTool, args, ok: false, summary: scanned.error, resultPreview: scanned.error },
        outputText: `Fehler: ${scanned.error}`,
      };
    }
    const text = buildFolderTreeSummary(scanned.tree, 120);
    return {
      event: {
        id,
        tool: validTool,
        args,
        ok: true,
        summary: `${scanned.totalFiles} Dateien in "${scanned.rootName}"`,
        resultPreview: text.slice(0, 600),
      },
      outputText: `Ordnerstruktur (${scanned.rootName}, ${scanned.totalFiles} Dateien):\n${text}`,
    };
  }

  if (validTool === 'read_workspace_file') {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const res = readSafeWorkspaceFile(ctx.rootDir, filePath);
    if (!res.ok) {
      return {
        event: { id, tool: validTool, args, ok: false, summary: res.error, resultPreview: res.error },
        outputText: `Fehler: ${res.error}`,
      };
    }
    const clipped = res.content.slice(0, 14000);
    return {
      event: {
        id,
        tool: validTool,
        args,
        ok: true,
        summary: `${res.path} gelesen (${res.content.split('\n').length} Zeilen)`,
        resultPreview: clipped.slice(0, 500),
      },
      outputText: `Datei ${res.path} (${res.language}):\n\`\`\`${res.language}\n${clipped}\n\`\`\``,
    };
  }

  if (validTool === 'search_workspace') {
    const query = typeof args.query === 'string' ? args.query : '';
    const hits = searchSafeWorkspaceFiles(ctx.rootDir, query, 20);
    const out =
      hits.length === 0
        ? `Keine Treffer für "${query}".`
        : hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n');
    return {
      event: {
        id,
        tool: validTool,
        args,
        ok: true,
        summary: `${hits.length} Treffer für "${query}"`,
        resultPreview: out.slice(0, 600),
      },
      outputText: out,
    };
  }

  if (validTool === 'write_sandbox_file') {
    const filePath = typeof args.path === 'string' ? args.path : '';
    const content = typeof args.content === 'string' ? args.content : '';
    const saved = writeSafeCodingSandboxFile(ctx.rootDir, filePath, content);
    if (!saved.ok) {
      return {
        event: { id, tool: validTool, args: { path: filePath }, ok: false, summary: saved.error, resultPreview: saved.error },
        outputText: `Fehler beim Schreiben: ${saved.error}`,
      };
    }
    return {
      event: {
        id,
        tool: validTool,
        args: { path: saved.path, bytes: saved.size },
        ok: true,
        summary: `Gespeichert: ${saved.path} (${saved.size} Bytes)`,
        resultPreview: content.slice(0, 400),
      },
      outputText: `Datei erfolgreich gespeichert unter ${saved.path} (${saved.size} Bytes).`,
      writtenFilePath: saved.path,
    };
  }

  if (validTool === 'search_notebook_knowledge') {
    const query = typeof args.query === 'string' ? args.query : '';
    if (!ctx.activeProject) {
      const msg = 'Kein aktives Notebook-Projekt geladen.';
      return {
        event: { id, tool: validTool, args, ok: false, summary: msg, resultPreview: msg },
        outputText: msg,
      };
    }
    const hits = searchProjectEverything(ctx.activeProject, query).slice(0, 8);
    const out =
      hits.length === 0
        ? `Keine Notebook-/Wissens-Treffer für "${query}".`
        : hits
            .map((h) => `[${h.sourceType === 'knowledge' ? 'Wissen' : 'Chat'}: ${h.title}]\n${h.snippet}`)
            .join('\n\n');
    return {
      event: {
        id,
        tool: validTool,
        args,
        ok: true,
        summary: `${hits.length} Notebook-Treffer für "${query}"`,
        resultPreview: out.slice(0, 600),
      },
      outputText: out,
    };
  }

  return {
    event: { id, tool: validTool, args, ok: false, summary: 'Unbekanntes Tool', resultPreview: 'Unbekanntes Tool' },
    outputText: 'Unbekanntes Tool.',
  };
}
