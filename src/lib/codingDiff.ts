export interface SearchReplaceHunk {
  search: string;
  replace: string;
  targetPath?: string;
}

export interface AppliedPatchResult {
  ok: boolean;
  content: string;
  appliedCount: number;
  failedIndices: number[];
  error?: string;
}

export interface DiffLine {
  type: 'unchanged' | 'removed' | 'added';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface LineDiffResult {
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  truncated?: boolean;
}

export interface FileCheckpoint {
  id: string;
  path: string;
  previousContent: string;
  language: string;
  createdAt: string;
  reason: string;
}

const SEARCH_REPLACE_RE =
  /<<<<<<<\s*SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>\s*REPLACE/g;

function normalizeSandboxPathCandidate(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .replace(/^[`'"*#\s]+|[`'"*:\s]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.length > 140) return undefined;
  if (!/^[a-zA-Z0-9._/-]+\.[a-zA-Z][a-zA-Z0-9]{0,7}$/.test(cleaned)) return undefined;
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return undefined;
  const normalized = parts.join('/');
  return normalized.startsWith('coding-workspace/') ? normalized : `coding-workspace/${normalized}`;
}

/**
 * Extracts all Aider/Cline-style `<<<<<<< SEARCH / ======= / >>>>>>> REPLACE` blocks from a Markdown or code string.
 * Optionally detects a target file path from preceding lines or fence headers.
 */
export function parseSearchReplaceBlocks(text: string): SearchReplaceHunk[] {
  if (!text || !text.includes('<<<<<<< SEARCH')) return [];
  const hunks: SearchReplaceHunk[] = [];
  const re = new RegExp(SEARCH_REPLACE_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const search = match[1] ?? '';
    const replace = match[2] ?? '';
    const before = text.slice(Math.max(0, match.index - 260), match.index);
    const beforeLines = before.split(/\r?\n/).reverse().slice(0, 5);
    let targetPath: string | undefined;
    for (const line of beforeLines) {
      const colonMatch = line.match(/```[^\s:]+:([^\s`]+)/);
      if (colonMatch?.[1]) {
        targetPath = normalizeSandboxPathCandidate(colonMatch[1]);
        if (targetPath) break;
      }
      const fileMatch = line.match(/([a-zA-Z0-9._/-]+\.[a-zA-Z][a-zA-Z0-9]{0,7})\b/);
      if (fileMatch?.[1]) {
        targetPath = normalizeSandboxPathCandidate(fileMatch[1]);
        if (targetPath) break;
      }
    }
    hunks.push({ search, replace, targetPath });
  }
  return hunks;
}

/**
 * Checks whether a single fenced code block contains at least one SEARCH/REPLACE hunk.
 */
export function hasSearchReplaceHunks(code: string): boolean {
  return /<<<<<<<\s*SEARCH\r?\n[\s\S]*?\r?\n=======\r?\n[\s\S]*?\r?\n>>>>>>>\s*REPLACE/.test(code || '');
}

/**
 * Applies one or more SEARCH/REPLACE hunks to `originalContent`.
 * Uses exact substring match first, then line-trimmed whitespace-tolerant match as fallback.
 */
export function applySearchReplacePatches(
  originalContent: string,
  hunks: readonly SearchReplaceHunk[]
): AppliedPatchResult {
  if (hunks.length === 0) {
    return {
      ok: false,
      content: originalContent,
      appliedCount: 0,
      failedIndices: [],
      error: 'Keine SEARCH/REPLACE-Blöcke gefunden.',
    };
  }

  let current = (originalContent || '').replace(/\r\n/g, '\n');
  let appliedCount = 0;
  const failedIndices: number[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const searchNorm = hunks[i].search.replace(/\r\n/g, '\n');
    const replaceNorm = hunks[i].replace.replace(/\r\n/g, '\n');

    if (!searchNorm) {
      // Empty SEARCH means append/replace empty file
      current = current ? `${current}\n${replaceNorm}` : replaceNorm;
      appliedCount++;
      continue;
    }

    const exactIdx = current.indexOf(searchNorm);
    if (exactIdx !== -1) {
      current = current.slice(0, exactIdx) + replaceNorm + current.slice(exactIdx + searchNorm.length);
      appliedCount++;
      continue;
    }

    // Fallback: line-by-line trimmed match (tolerates minor leading/trailing indentation drift)
    const curLines = current.split('\n');
    const searchLines = searchNorm.split('\n');
    const trimmedSearch = searchLines.map((l) => l.trim());
    let matchedStart = -1;

    for (let start = 0; start <= curLines.length - searchLines.length; start++) {
      let allMatch = true;
      for (let k = 0; k < searchLines.length; k++) {
        if (curLines[start + k].trim() !== trimmedSearch[k]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        matchedStart = start;
        break;
      }
    }

    if (matchedStart !== -1) {
      const nextLines = [
        ...curLines.slice(0, matchedStart),
        ...replaceNorm.split('\n'),
        ...curLines.slice(matchedStart + searchLines.length),
      ];
      current = nextLines.join('\n');
      appliedCount++;
    } else {
      failedIndices.push(i);
    }
  }

  if (appliedCount === 0) {
    return {
      ok: false,
      content: originalContent,
      appliedCount: 0,
      failedIndices,
      error: `Kein SEARCH-Block wurde in der Zieldatei gefunden (${failedIndices.length} fehlgeschlagen).`,
    };
  }

  return {
    ok: failedIndices.length === 0,
    content: current,
    appliedCount,
    failedIndices,
    error:
      failedIndices.length > 0
        ? `${appliedCount} von ${hunks.length} Änderungen angewendet (${failedIndices.length} SEARCH-Blöcke nicht gefunden).`
        : undefined,
  };
}

/**
 * Deterministic Myers/LCS-based line diff for crisp unified Diff-Review UI.
 * Caps DP table size for very large files (>900 lines) with a clean prefix/suffix trim
 * so UI diffing stays instantaneous (<5ms).
 */
export function computeLineDiff(oldText: string, newText: string): LineDiffResult {
  const oldLines = oldText === '' ? [] : oldText.replace(/\r\n/g, '\n').split('\n');
  const newLines = newText === '' ? [] : newText.replace(/\r\n/g, '\n').split('\n');

  // Trim identical prefix and suffix first (fast path for large files)
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const midOld = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const midNew = newLines.slice(prefixLen, newLines.length - suffixLen);

  const lines: DiffLine[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (let i = 0; i < prefixLen; i++) {
    lines.push({ type: 'unchanged', oldLine: i + 1, newLine: i + 1, text: oldLines[i] });
    unchangedCount++;
  }

  const MAX_CELLS = 450_000;
  let truncated = false;

  if (midOld.length * midNew.length <= MAX_CELLS) {
    const m = midOld.length;
    const n = midNew.length;
    const dp = new Int32Array((m + 1) * (n + 1));
    const width = n + 1;

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (midOld[i] === midNew[j]) {
          dp[i * width + j] = dp[(i + 1) * width + (j + 1)] + 1;
        } else {
          const down = dp[(i + 1) * width + j];
          const right = dp[i * width + (j + 1)];
          dp[i * width + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midOld[i] === midNew[j]) {
        lines.push({
          type: 'unchanged',
          oldLine: prefixLen + i + 1,
          newLine: prefixLen + j + 1,
          text: midOld[i],
        });
        unchangedCount++;
        i++;
        j++;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
        lines.push({
          type: 'removed',
          oldLine: prefixLen + i + 1,
          newLine: null,
          text: midOld[i],
        });
        removedCount++;
        i++;
      } else {
        lines.push({
          type: 'added',
          oldLine: null,
          newLine: prefixLen + j + 1,
          text: midNew[j],
        });
        addedCount++;
        j++;
      }
    }
    while (i < m) {
      lines.push({ type: 'removed', oldLine: prefixLen + i + 1, newLine: null, text: midOld[i] });
      removedCount++;
      i++;
    }
    while (j < n) {
      lines.push({ type: 'added', oldLine: null, newLine: prefixLen + j + 1, text: midNew[j] });
      addedCount++;
      j++;
    }
  } else {
    // Huge file fallback: show midOld as removed, midNew as added
    truncated = true;
    for (let i = 0; i < midOld.length; i++) {
      lines.push({ type: 'removed', oldLine: prefixLen + i + 1, newLine: null, text: midOld[i] });
      removedCount++;
    }
    for (let j = 0; j < midNew.length; j++) {
      lines.push({ type: 'added', oldLine: null, newLine: prefixLen + j + 1, text: midNew[j] });
      addedCount++;
    }
  }

  for (let s = 0; s < suffixLen; s++) {
    const oldIdx = oldLines.length - suffixLen + s;
    const newIdx = newLines.length - suffixLen + s;
    lines.push({
      type: 'unchanged',
      oldLine: oldIdx + 1,
      newLine: newIdx + 1,
      text: oldLines[oldIdx],
    });
    unchangedCount++;
  }

  return { lines, addedCount, removedCount, unchangedCount, truncated };
}

export function buildDiffModeInstruction(): string {
  return [
    'DIFF-/PATCH-MODUS AKTIV: Wenn du bestehende Dateien bearbeitest, gib kompakte SEARCH/REPLACE-Blöcke statt die ganze Datei neu zu schreiben:',
    '```diff:coding-workspace/pfad/zur/datei.ts',
    '<<<<<<< SEARCH',
    'exakter bestehender Code-Ausschnitt',
    '=======',
    'neuer ersetzter Code-Ausschnitt',
    '>>>>>>> REPLACE',
    '```',
    'Für komplett neue Dateien nutze weiterhin normale Codeblöcke mit Dateipfad im Header (z. B. ```ts:coding-workspace/neu.ts).',
  ].join('\n');
}
