import type { ParsedFlags, ProviderRecord } from './types.ts';

export const BRIDGE_CATEGORIES = new Set([
  'webclient_automation',
  'web_cookie_bypass',
  'reverse_engineered_web',
]);

/**
 * Generic browser automation SDKs / reverse-engineering developer tools that
 * appear in `webclient_automation` or `reverse_engineered_web` in the catalog,
 * but are NOT provider-specific webclient-to-OpenAI bridges.
 */
export const GENERIC_AUTOMATION_TOOL_IDS = new Set([
  'stagehand',
  'skyvern',
  'nanobrowser',
  'browser-use',
  'browseract-skills',
  'patchright',
  'camoufox',
  'nodriver',
  'reverseloom',
  'reverse-api-engineer',
]);

function extractBalancedParen(text: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  return text.slice(openIndex + 1);
}

export function parseFlags(raw: string): ParsedFlags {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      raw: '',
      riskant: null,
      riskantDetail: null,
      forschung: null,
      selbstEvaluierend: null,
      empfehlenswert: null,
    };
  }

  let riskant: boolean | null = null;
  let riskantDetail: string | null = null;
  const riskMatch = trimmed.match(/riskant\s*=\s*(True|False)/i);
  if (riskMatch) {
    riskant = riskMatch[1].toLowerCase() === 'true';
    const afterIndex = (riskMatch.index ?? 0) + riskMatch[0].length;
    const rest = trimmed.slice(afterIndex);
    const parenMatch = rest.match(/^\s*\(/);
    if (parenMatch) {
      const openIdx = afterIndex + parenMatch[0].length - 1;
      riskantDetail = extractBalancedParen(trimmed, openIdx).trim();
    }
  }

  const forschungMatch = trimmed.match(/forschung\s*=\s*(True|False)/i);
  const selbstMatch = trimmed.match(/selbst_evaluierend\s*=\s*(True|False)/i);
  const empfMatch = trimmed.match(/empfehlenswert\s*=\s*(True|False|unklar)/i);

  let empfehlenswert: 'True' | 'False' | 'unklar' | null = null;
  if (empfMatch) {
    const v = empfMatch[1].toLowerCase();
    if (v === 'true') empfehlenswert = 'True';
    else if (v === 'false') empfehlenswert = 'False';
    else if (v === 'unklar') empfehlenswert = 'unklar';
  }

  return {
    raw: trimmed,
    riskant,
    riskantDetail,
    forschung: forschungMatch ? forschungMatch[1].toLowerCase() === 'true' : null,
    selbstEvaluierend: selbstMatch ? selbstMatch[1].toLowerCase() === 'true' : null,
    empfehlenswert,
  };
}

/**
 * Extract GitHub stars ONLY if explicitly stated in the provider's text.
 * Returns null if not verifiable from the source block.
 */
export function extractStars(text: string): number | null {
  const m = text.match(/~?(\d+(?:[.,]\d+)?)\s*([kK])?\s*(?:GitHub-?)?(?:Sterne|Stars)\b/i);
  if (!m) return null;
  const numStr = m[1].replace(',', '.');
  const val = Number.parseFloat(numStr);
  if (Number.isNaN(val)) return null;
  if (m[2]) {
    return Math.round(val * 1000);
  }
  return Math.round(val);
}

/**
 * Extract commit/push date string ONLY if explicitly present in the source text.
 */
export function extractLastCommitText(text: string): string | null {
  const patterns = [
    /(?:letzter\s+Commit|Commit|Push|letzter\s+Push)\s*(?:am\s*)?(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2}|Ende\s+\w+\.?\s*\d{4}|am\s+Lauf-Tag|rund\s+[\d,]+\s+Monate\s+zurueck)/i,
    /Repo\s+seit\s+(\d{2}\.\d{2}\.\d{4})\s+ohne\s+Commit/i,
    /Web-Store-Version\s+[\d.]+\s+vom\s+(\d{2}\.\d{2}\.\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Strictly detect `illegal` classification markers in the source block.
 * Avoids false positives when prose mentions "waeren illegal" as a caveat
 * (e.g., gemini-web2api-go).
 */
export function detectIllegalFlag(flags: ParsedFlags, risiko: string): boolean {
  const risikoTrimmed = risiko.trim();
  if (/^illegal\b/i.test(risikoTrimmed)) {
    return true;
  }
  if (flags.riskantDetail && /^illegal\b/i.test(flags.riskantDetail.trim())) {
    return true;
  }
  if (/(?:^|[,;\s])illegal(?:$|\s*[:=]|,)/i.test(flags.raw)) {
    return true;
  }
  return false;
}

export function parseProviderMarkdown(markdown: string): ProviderRecord[] {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  const blockStarts: Array<{ lineIndex: number; name: string }> = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.startsWith('## ')) {
      blockStarts.push({ lineIndex: i, name: line.slice(3).trim() });
    }
  }

  const records: ProviderRecord[] = [];

  for (let b = 0; b < blockStarts.length; b++) {
    const start = blockStarts[b].lineIndex;
    const end = b + 1 < blockStarts.length ? blockStarts[b + 1].lineIndex : lines.length;
    const name = blockStarts[b].name;
    const blockLines = lines.slice(start + 1, end);

    const fields: Record<string, string> = {};
    let currentKey: string | null = null;

    for (const rawLine of blockLines) {
      const bulletMatch = rawLine.match(/^- \*\*([a-zA-Z0-9_]+):\*\*\s*(.*)$/);
      if (bulletMatch) {
        const firstKey = bulletMatch[1].toLowerCase();
        const rest = bulletMatch[2].trim();
        // Split compound pipe-delimited inline keys such as:
        // `- **verbindungsart:** REST | **protokoll:** openai_kompatibel`
        // `- **id:** slug | **update_typ:** neu`
        // `- **quelle:** https://... | **entdeckt_am:** 2026-10-01`
        const segments = rest.split(/\s*\|\s*(?=\*\*[a-zA-Z0-9_]+:\*\*)/);
        fields[firstKey] = (segments[0] ?? '').trim();
        currentKey = firstKey;
        for (let s = 1; s < segments.length; s++) {
          const subMatch = segments[s].match(/^\*\*([a-zA-Z0-9_]+):\*\*\s*(.*)$/);
          if (subMatch) {
            const subKey = subMatch[1].toLowerCase();
            fields[subKey] = subMatch[2].trim();
            currentKey = subKey;
          }
        }
      } else if (currentKey && rawLine.trim() !== '' && !rawLine.startsWith('---')) {
        fields[currentKey] = `${fields[currentKey]}\n${rawLine.trim()}`;
      }
    }

    const id = (fields['id'] || '').trim();
    const update_typ = (fields['update_typ'] || '').trim();
    if (!id) {
      // Skip non-provider headings (e.g. file intro headings if any)
      continue;
    }

    const quelle = (fields['quelle'] || '').trim();
    const entdeckt_am = (fields['entdeckt_am'] || '').trim();

    const url = (fields['url'] || '').trim();
    const kategorien = (fields['kategorien'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const verbindungsart = (fields['verbindungsart'] || '').trim();
    const protokoll = (fields['protokoll'] || '').trim();
    const beschreibung = (fields['beschreibung'] || '').trim();
    const einschraenkungen = (fields['einschraenkungen'] || '').trim();
    const flagsRaw = (fields['flags'] || '').trim();
    const risiko = (fields['risiko'] || '').trim();
    const auth_typ = (fields['auth_typ'] || 'unbekannt').trim();
    const free_tier_typ = (fields['free_tier_typ'] || '').trim();
    const kommerzielle_nutzung = (fields['kommerzielle_nutzung'] || '').trim();
    const modell_info = (fields['modelle'] || fields['modell_info'] || '').trim();

    const flags = parseFlags(flagsRaw);
    const isIllegal = detectIllegalFlag(flags, risiko);
    const isAnonymPseudoKey = kategorien.includes('anonym_pseudo_key');
    const isBridgeCategory = kategorien.some((c) => BRIDGE_CATEGORIES.has(c));
    const isGenericAutomationTool = GENERIC_AUTOMATION_TOOL_IDS.has(id);

    const combinedText = `${beschreibung} ${einschraenkungen} ${flagsRaw}`;
    const starsExtracted = extractStars(combinedText);
    const lastCommitText = extractLastCommitText(combinedText);

    records.push({
      id,
      name,
      update_typ,
      url,
      kategorien,
      verbindungsart,
      protokoll,
      beschreibung,
      einschraenkungen,
      flagsRaw,
      flags,
      risiko,
      auth_typ,
      free_tier_typ,
      kommerzielle_nutzung,
      modell_info,
      quelle,
      entdeckt_am,
      isIllegal,
      isAnonymPseudoKey,
      isBridgeCategory,
      isGenericAutomationTool,
      starsExtracted,
      lastCommitText,
      sourceLineNumber: start + 1,
    });
  }

  return records;
}
