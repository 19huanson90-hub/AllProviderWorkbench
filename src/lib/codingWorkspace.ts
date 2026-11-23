import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceTreeNode } from './codingTypes.ts';
export { buildFolderTreeSummary, type WorkspaceTreeNode } from './codingTypes.ts';

export const MAX_WORKSPACE_FILE_BYTES = 256 * 1024; // 256 KB
const MAX_TREE_DEPTH = 5;
const MAX_TREE_ENTRIES = 450;

const BLOCKED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.cache',
  '.aistudio',
  'bridges', // may contain local bridge auth/cookie JSONs
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
]);

const BLOCKED_FILE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.env(?:\..+)?$/i,
  /(?:^|[-_.])(secret|secrets|credential|credentials|token|tokens|cookie|cookies|private[-_]?key)(?:[-_.]|$)/i,
  /auth\.json$/i,
  /\.(pem|key|p12|pfx|jks|sqlite|db|exe|dll|so|dylib|zip|tar|gz|7z|png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|mp4|mp3|wav)$/i,
];

export function isBlockedWorkspaceEntryName(name: string, isDir: boolean): boolean {
  const clean = name.trim();
  if (!clean || clean === '.' || clean === '..') return true;
  if (isDir) {
    if (BLOCKED_DIR_NAMES.has(clean.toLowerCase())) return true;
    if (clean.startsWith('.') && clean !== '.github') return true;
    return false;
  }
  for (const re of BLOCKED_FILE_PATTERNS) {
    if (re.test(clean)) return true;
  }
  return false;
}

export function detectLanguageFromPath(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    htm: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    sh: 'bash',
    ps1: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sql: 'sql',
    xml: 'xml',
    txt: 'text',
  };
  return map[ext] || 'text';
}

function toPosixRel(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join('/');
}

/**
 * Strictly resolves a user-supplied relative path inside `rootDir`, preventing
 * directory traversal (`..`), absolute paths, symlink escapes, and secret file access.
 */
export function resolveSafeWorkspacePath(
  rootDir: string,
  relPath: string,
  options: { mustExist?: boolean } = {}
): { ok: true; absPath: string; relPath: string } | { ok: false; error: string } {
  if (typeof relPath !== 'string') {
    return { ok: false, error: 'Ungültiger Dateipfad.' };
  }
  const normalizedInput = relPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedInput || normalizedInput.includes('\0')) {
    return { ok: false, error: 'Pfad darf nicht leer sein.' };
  }
  if (path.isAbsolute(relPath)) {
    return { ok: false, error: 'Absolute Pfade sind nicht zulässig.' };
  }

  const segments = normalizedInput.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { ok: false, error: 'Ungültiger Dateipfad.' };
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '.' || seg === '..') {
      return { ok: false, error: 'Pfad-Traversal ("..") ist nicht zulässig.' };
    }
    const isDirSeg = i < segments.length - 1;
    if (isBlockedWorkspaceEntryName(seg, isDirSeg)) {
      return {
        ok: false,
        error: `Zugriff auf geschützten Pfad "${seg}" ist aus Sicherheitsgründen gesperrt.`,
      };
    }
  }

  const canonicalRoot = fs.realpathSync(path.resolve(rootDir));
  const candidate = path.resolve(canonicalRoot, ...segments);
  if (candidate !== canonicalRoot && !candidate.startsWith(canonicalRoot + path.sep)) {
    return { ok: false, error: 'Pfad liegt außerhalb des erlaubten Arbeitsverzeichnisses.' };
  }

  if (options.mustExist) {
    if (!fs.existsSync(candidate)) {
      return { ok: false, error: 'Datei nicht gefunden.' };
    }
    const realTarget = fs.realpathSync(candidate);
    if (realTarget !== canonicalRoot && !realTarget.startsWith(canonicalRoot + path.sep)) {
      return { ok: false, error: 'Symlink außerhalb des Arbeitsverzeichnisses blockiert.' };
    }
  } else {
    // Check nearest existing parent directory does not escape via symlink
    let parent = path.dirname(candidate);
    while (!fs.existsSync(parent) && parent !== canonicalRoot && parent.length > canonicalRoot.length) {
      parent = path.dirname(parent);
    }
    if (fs.existsSync(parent)) {
      const realParent = fs.realpathSync(parent);
      if (realParent !== canonicalRoot && !realParent.startsWith(canonicalRoot + path.sep)) {
        return { ok: false, error: 'Zielordner zeigt über Symlink nach außen.' };
      }
    }
  }

  return {
    ok: true,
    absPath: candidate,
    relPath: toPosixRel(canonicalRoot, candidate),
  };
}

export function scanSafeWorkspaceTree(
  rootDir: string,
  subDir = ''
): { ok: true; rootName: string; totalFiles: number; truncated: boolean; tree: WorkspaceTreeNode[] } | { ok: false; error: string } {
  const canonicalRoot = fs.realpathSync(path.resolve(rootDir));
  let startDir = canonicalRoot;

  if (subDir && subDir.trim()) {
    const resolved = resolveSafeWorkspacePath(canonicalRoot, subDir.trim(), { mustExist: true });
    if (!resolved.ok) return resolved;
    const stat = fs.statSync(resolved.absPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: 'Ziel ist kein Verzeichnis.' };
    }
    startDir = resolved.absPath;
  }

  let entryCount = 0;
  let totalFiles = 0;
  let truncated = false;

  const walk = (dir: string, depth: number): WorkspaceTreeNode[] => {
    if (depth > MAX_TREE_DEPTH || entryCount >= MAX_TREE_ENTRIES) {
      truncated = true;
      return [];
    }
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const dirs: WorkspaceTreeNode[] = [];
    const files: WorkspaceTreeNode[] = [];

    for (const d of dirents) {
      if (entryCount >= MAX_TREE_ENTRIES) {
        truncated = true;
        break;
      }
      if (d.isSymbolicLink()) continue; // never follow symlinks during tree scan
      const isDir = d.isDirectory();
      if (isBlockedWorkspaceEntryName(d.name, isDir)) continue;

      const absChild = path.join(dir, d.name);
      const relChild = toPosixRel(canonicalRoot, absChild);
      entryCount++;

      if (isDir) {
        const children = walk(absChild, depth + 1);
        dirs.push({
          name: d.name,
          path: relChild,
          type: 'dir',
          children,
        });
      } else if (d.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(absChild).size;
        } catch {
          // ignore stat errors
        }
        totalFiles++;
        files.push({
          name: d.name,
          path: relChild,
          type: 'file',
          size,
          language: detectLanguageFromPath(relChild),
        });
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    files.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return [...dirs, ...files];
  };

  const tree = walk(startDir, 0);
  return {
    ok: true,
    rootName: path.basename(startDir),
    totalFiles,
    truncated,
    tree,
  };
}

export function readSafeWorkspaceFile(
  rootDir: string,
  relPath: string
):
  | { ok: true; path: string; content: string; size: number; language: string; writable: boolean }
  | { ok: false; error: string } {
  const resolved = resolveSafeWorkspacePath(rootDir, relPath, { mustExist: true });
  if (!resolved.ok) return resolved;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved.absPath);
  } catch {
    return { ok: false, error: 'Datei konnte nicht gelesen werden.' };
  }
  if (!stat.isFile()) {
    return { ok: false, error: 'Angegebener Pfad ist ein Ordner, keine Datei.' };
  }
  if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
    return {
      ok: false,
      error: `Datei ist zu groß (${Math.round(stat.size / 1024)} KB, Limit: ${Math.round(MAX_WORKSPACE_FILE_BYTES / 1024)} KB).`,
    };
  }

  const rawBuf = fs.readFileSync(resolved.absPath);
  // Reject binary buffers containing NUL bytes
  for (let i = 0; i < Math.min(rawBuf.length, 4096); i++) {
    if (rawBuf[i] === 0) {
      return { ok: false, error: 'Binärdateien werden im Text-Editor nicht unterstützt.' };
    }
  }

  return {
    ok: true,
    path: resolved.relPath,
    content: rawBuf.toString('utf8'),
    size: stat.size,
    language: detectLanguageFromPath(resolved.relPath),
    writable: resolved.relPath.startsWith('coding-workspace/'),
  };
}

/**
 * Safely writes a UTF-8 code file strictly inside `<rootDir>/coding-workspace/`.
 * Prevents overwriting server/app infrastructure files while giving the Coding-Studio
 * a real persistent local project sandbox.
 */
export function writeSafeCodingSandboxFile(
  rootDir: string,
  relPath: string,
  content: string
): { ok: true; path: string; size: number; language: string } | { ok: false; error: string } {
  if (typeof content !== 'string') {
    return { ok: false, error: 'Ungültiger Dateiinhalt.' };
  }
  const byteLen = Buffer.byteLength(content, 'utf8');
  if (byteLen > MAX_WORKSPACE_FILE_BYTES) {
    return {
      ok: false,
      error: `Inhalt überschreitet das Limit von ${Math.round(MAX_WORKSPACE_FILE_BYTES / 1024)} KB.`,
    };
  }

  const sandboxRoot = path.resolve(rootDir, 'coding-workspace');
  fs.mkdirSync(sandboxRoot, { recursive: true });

  const stripped = relPath.trim().replace(/\\/g, '/').replace(/^coding-workspace\/+/, '');
  const resolved = resolveSafeWorkspacePath(sandboxRoot, stripped, { mustExist: false });
  if (!resolved.ok) return resolved;

  fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
  fs.writeFileSync(resolved.absPath, content, 'utf8');
  return {
    ok: true,
    path: `coding-workspace/${resolved.relPath}`,
    size: byteLen,
    language: detectLanguageFromPath(resolved.relPath),
  };
}
