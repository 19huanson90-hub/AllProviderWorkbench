import type {
  ClassifiedProvider,
  ProviderRecord,
  Rule7CollisionNotice,
  SecurityClass,
  SecurityClassLabel,
  TestEligibility,
  TestResultRow,
} from './types.ts';

export const SECURITY_CLASS_LABELS: Record<SecurityClass, SecurityClassLabel> = {
  GRUEN: 'GRÜN',
  GELB: 'GELB',
  ROT: 'ROT',
  SCHWARZ: 'SCHWARZ',
};

const KNOWN_ENV_VAR_MAP: Record<string, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  'google-ai-studio': 'GEMINI_API_KEY',
  'gemini-api': 'GEMINI_API_KEY',
  'mistral-ai': 'MISTRAL_API_KEY',
  'mistral-la-plateforme': 'MISTRAL_API_KEY',
  'cohere-trial-key': 'COHERE_API_KEY',
  cohere: 'COHERE_API_KEY',
  'github-models': 'GITHUB_TOKEN',
  huggingface: 'HF_TOKEN',
  'huggingface-inference': 'HF_TOKEN',
  'cloudflare-workers-ai': 'CLOUDFLARE_API_TOKEN',
  'nvidia-nim': 'NVIDIA_API_KEY',
  'sambanova-cloud': 'SAMBANOVA_API_KEY',
  'together-ai': 'TOGETHER_API_KEY',
  'fireworks-ai': 'FIREWORKS_API_KEY',
  'deepinfra': 'DEEPINFRA_API_KEY',
  'deepseek-api': 'DEEPSEEK_API_KEY',
  'anthropic-api': 'ANTHROPIC_API_KEY',
  'openai-api': 'OPENAI_API_KEY',
  'xai-grok': 'XAI_API_KEY',
  'perplexity-api': 'PERPLEXITY_API_KEY',
  'replicate': 'REPLICATE_API_TOKEN',
  'siliconflow': 'SILICONFLOW_API_KEY',
  'chutes-ai': 'CHUTES_API_KEY',
  'bytez': 'BYTEZ_API_KEY',
  'glhf': 'GLHF_API_KEY',
  'kluster-ai': 'KLUSTER_API_KEY',
  'nebius-ai': 'NEBIUS_API_KEY',
  'novita-ai': 'NOVITA_API_KEY',
  'hyperbolic': 'HYPERBOLIC_API_KEY',
  'featherless': 'FEATHERLESS_API_KEY',
  'requesty': 'REQUESTY_API_KEY',
  'helicone': 'HELICONE_API_KEY',
  'portkey': 'PORTKEY_API_KEY',
  'litellm': 'LITELLM_API_KEY',
};

export function inferEnvVarName(id: string): string {
  if (KNOWN_ENV_VAR_MAP[id]) {
    return KNOWN_ENV_VAR_MAP[id];
  }
  const clean = id
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${clean}_API_KEY`;
}

export function isLocalOnlyUrl(url: string): boolean {
  if (!url) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i.test(url.trim());
}

const KNOWN_UNFILTERED_PROVIDER_IDS = new Set<string>([
  'unrestrictable-ai',
  'obscurify-ai',
  'uncensoredaichat-ai',
  'nofilterai-ai',
  'uncutgpt',
  'uncensored-chat',
  'infernus-ai',
  'cleus-ai',
  'ablit-app',
  'abliteration-ai',
  'openuncensored',
  'magmarouter',
  'mancer-ai',
  'infermatic-ai',
  'arli-ai',
  'redpill-ai',
  'ppq-ai',
  'akashml',
  'nous-research',
  'tinfoil-sh',
  'notrack-ai',
  'gab-ai',
  'unfilteredaimodels',
  'venice-ai',
  'featherless',
  'nanogpt',
  'aionlabs',
  'chutes',
  'api-airforce',
  'electronhub',
  'uplinkswitch',
]);

const UNFILTERED_KEYWORD_RE =
  /\b(uncensored|unzensiert\w*|abliterat\w*|unfiltered|ungefiltert\w*|no[- ]?filter|xploded|mythomax)\b/i;

export function detectUnfilteredProvider(
  record: ProviderRecord,
  securityClass: SecurityClass
): boolean {
  if (securityClass === 'SCHWARZ' || record.isIllegal) return false;
  if (KNOWN_UNFILTERED_PROVIDER_IDS.has(record.id.toLowerCase())) return true;
  const hay = `${record.id} ${record.name} ${record.beschreibung}`;
  return UNFILTERED_KEYWORD_RE.test(hay);
}

/**
 * ZIEL 1: Strict 4-class security classification.
 *
 * - SCHWARZ: `anonym_pseudo_key` + `illegal` (breaches, worms, stolen keys) -> NUR DOKUMENTIEREN
 * - ROT:     `illegal` (without anonym_pseudo_key)
 *            OR (`riskant=True` AND category in {webclient_automation, web_cookie_bypass, reverse_engineered_web})
 *            OR (`isBridgeCategory` AND NOT generic automation tool AND `empfehlenswert=False`)
 * - GELB:    `riskant=True` OR `empfehlenswert=unklar` OR `isGenericAutomationTool`
 *            OR `isAnonymPseudoKey` (Rule 1 collision: non-illegal pseudo-key providers are marked GELB + test-blocked)
 * - GRÜN:    Clean, documented, no ToS risk (`riskant=False`, not illegal, not bridge, not anonym_pseudo_key)
 */
export function classifyProvider(record: ProviderRecord): ClassifiedProvider {
  const isRisky = record.flags.riskant === true;
  const isUnclear = record.flags.empfehlenswert === 'unklar';
  const isNotRecommended = record.flags.empfehlenswert === 'False';

  let securityClass: SecurityClass = 'GRUEN';
  let classificationReason = 'Dokumentierter Dienst ohne bekanntes ToS-Risiko (riskant=False).';
  let rule7Collision: string | null = null;

  // 1. SCHWARZ: anonym_pseudo_key + illegal
  if (record.isAnonymPseudoKey && record.isIllegal) {
    securityClass = 'SCHWARZ';
    classificationReason =
      'Kategorie anonym_pseudo_key kombiniert mit illegal-Einstufung (gestohlene Keys, Breaches oder Malware). Nur dokumentieren.';
  }
  // 2. ROT: illegal (other categories) OR riskant=True + bridge/bypass/RE category
  else if (record.isIllegal) {
    securityClass = 'ROT';
    classificationReason =
      'Als illegal / strafbar eingestuft (z. B. Malware-Installer, Paywall-Bypass oder unbefugter Zugriff). Test und Nutzung strikt verboten.';
  } else if (isRisky && record.isBridgeCategory && !record.isGenericAutomationTool) {
    securityClass = 'ROT';
    classificationReason =
      'riskant=True in Kombination mit webclient_automation / web_cookie_bypass / reverse_engineered_web (ToS-Konflikt).';
  } else if (record.isBridgeCategory && !record.isGenericAutomationTool && isNotRecommended) {
    securityClass = 'ROT';
    classificationReason =
      'Webclient-Bridge / Reverse-Engineering mit empfehlenswert=False (erhöhtes ToS-/Stabilitätsrisiko).';
  }
  // 3. GELB: generic automation tools in bridge categories (Stagehand, Skyvern, Browser Use, etc.),
  //          or riskant=True (non-bridge), or empfehlenswert=unklar, or non-illegal anonym_pseudo_key
  else if (record.isGenericAutomationTool) {
    securityClass = 'GELB';
    classificationReason =
      'Generisches Browser-Automations-/RE-Framework: rechtliche/ToS-Zulässigkeit hängt vollständig von der Ziel-Website ab (ToS-Grauzone).';
  } else if (isRisky || isUnclear) {
    securityClass = 'GELB';
    classificationReason = isRisky
      ? 'riskant=True außerhalb der Webclient-Bypass-Kategorien (ToS-Grauzone, Lizenz-, Datenschutz- oder Wartungsrisiko).'
      : 'empfehlenswert=unklar (Lizenz, Stabilität oder Nutzungsbedingungen nicht abschließend geklärt).';
  } else if (record.isAnonymPseudoKey) {
    // Hard Rule 1 vs ZIEL 1/2 collision: dataset has riskant=False + anonym_pseudo_key (e.g. llm7, nanogpt, ai-horde)
    securityClass = 'GELB';
    classificationReason =
      'Trägt Kategorie anonym_pseudo_key trotz riskant=False im Quelldatensatz — gemäß Regel 1 & 7 konservativ eingestuft und von Tests ausgeschlossen.';
    rule7Collision =
      `Kollision (Regel 1 vs. Ziel 2): "${record.name}" (${record.id}) ist im Datensatz als riskant=False markiert, trägt aber die Kategorie "anonym_pseudo_key". Harte Regel 1 verbietet jeden Test, Aufruf oder Integration für Kategorie "anonym_pseudo_key" ausnahmslos.`;
  } else if (isNotRecommended) {
    securityClass = 'GELB';
    classificationReason =
      'empfehlenswert=False im Quelldatensatz (eingeschränkte Eignung, veraltet oder unklare Konditionen).';
  } else {
    securityClass = 'GRUEN';
    classificationReason =
      'Sauber dokumentierter offizieller Dienst, lokales Engine-Projekt, Gateway, MCP-Server oder Forschungsprogramm ohne ToS-Konflikt.';
  }

  // Resolve Test Policy under ZIEL 2 + HARTE REGELN 1 & 7
  const expectedEnvVar =
    record.auth_typ === 'api_key' ? inferEnvVarName(record.id) : null;

  let testPolicy: TestEligibility;

  if (securityClass === 'SCHWARZ') {
    testPolicy = 'SKIP_SCHWARZ_ILLEGAL';
  } else if (record.isIllegal) {
    testPolicy = 'SKIP_RULE1_ILLEGAL';
  } else if (record.isAnonymPseudoKey) {
    testPolicy = 'SKIP_RULE1_ANONYM_PSEUDO_KEY';
    if (!rule7Collision) {
      rule7Collision =
        `Kollision (Regel 1 vs. Ziel 2): "${record.name}" (${record.id}) fällt unter Kategorie "anonym_pseudo_key" und wird strikt übersprungen.`;
    }
  } else if (securityClass === 'ROT') {
    testPolicy = 'SKIP_ROT_TOS';
  } else if (!record.url || !/^https?:\/\//i.test(record.url)) {
    testPolicy = 'SKIP_NO_URL';
  } else if (isLocalOnlyUrl(record.url)) {
    testPolicy = 'SKIP_LOCALHOST';
  } else if (securityClass === 'GELB') {
    testPolicy = 'HEAD_ONLY_GELB';
  } else if (record.auth_typ === 'api_key') {
    testPolicy = 'API_KEY_ENV_CHECK';
  } else if (
    record.auth_typ === 'keine' &&
    (/REST/i.test(record.verbindungsart) || /openai/i.test(record.protokoll)) &&
    !record.kategorien.includes('lokal_self_hosted') &&
    !/github\.com/i.test(record.url)
  ) {
    testPolicy = 'ANONYMOUS_API_AND_HEAD';
  } else {
    testPolicy = 'HEAD_ONLY_GREEN';
  }

  const empfohlenValue =
    record.flags.empfehlenswert ?? (securityClass === 'GRUEN' ? 'True' : 'False');

  const isUnfiltered = detectUnfilteredProvider(record, securityClass);

  return {
    ...record,
    securityClass,
    securityClassLabel: SECURITY_CLASS_LABELS[securityClass],
    classificationReason,
    riskyBool: securityClass === 'ROT' || securityClass === 'SCHWARZ' || isRisky,
    empfohlenValue,
    testPolicy,
    expectedEnvVar,
    rule7Collision,
    isUnfiltered,
  };
}

export function classifyAllProviders(records: ProviderRecord[]): {
  classified: ClassifiedProvider[];
  collisions: Rule7CollisionNotice[];
} {
  const classified = records.map(classifyProvider);
  const collisions: Rule7CollisionNotice[] = [];

  for (const item of classified) {
    if (item.rule7Collision) {
      collisions.push({
        providerId: item.id,
        providerName: item.name,
        securityClass: item.securityClass,
        conflict: item.rule7Collision,
        resolution:
          'Test, Aufruf, Containerisierung und GUI-Integration gemäß Harter Regel 1 & 7 verweigert (SKIPPED).',
      });
    }
  }

  return { classified, collisions };
}

/**
 * Generates initial deterministic test result rows BEFORE live HTTP tests run.
 * Skipped entries (ROT, SCHWARZ, Rule 1, missing env var, localhost) already have
 * their definitive policy status; eligible GRÜN/GELB entries start as PENDING.
 */
export function buildInitialTestResults(
  providers: ClassifiedProvider[],
  envVars: Record<string, string | undefined> = {}
): TestResultRow[] {
  return providers.map((p) => {
    const primaryKat = p.kategorien[0] || 'unbekannt';
    const base = {
      id: p.id,
      name: p.name,
      kategorie: primaryKat,
      securityClass: p.securityClass,
      risky: p.riskyBool,
      empfohlen: p.empfohlenValue,
      url: p.securityClass === 'SCHWARZ' || p.isIllegal ? '[GESPERRT – NUR DOKUMENTATION]' : p.url,
      executed: false,
    };

    switch (p.testPolicy) {
      case 'SKIP_SCHWARZ_ILLEGAL':
      case 'SKIP_RULE1_ILLEGAL':
        return {
          ...base,
          status: 'SKIPPED (illegal)',
          http_code: '-',
          note: 'Regel 1: illegal / strafbar — Test und Aufruf strikt verboten.',
        };
      case 'SKIP_RULE1_ANONYM_PSEUDO_KEY':
        return {
          ...base,
          status: 'SKIPPED (Regel 1: anonym_pseudo_key)',
          http_code: '-',
          note: 'Regel 1 & 7: Kategorie anonym_pseudo_key — kein Test, kein Aufruf, keine Integration.',
        };
      case 'SKIP_ROT_TOS':
        return {
          ...base,
          status: 'SKIPPED (ToS-Risiko)',
          http_code: '-',
          note: 'Ziel 2.4: Klasse ROT — automatischer Test wegen ToS-Risiko vollständig übersprungen.',
        };
      case 'SKIP_NO_URL':
      case 'SKIP_LOCALHOST':
        return {
          ...base,
          status: 'SKIPPED (lokal/kein Endpunkt)',
          http_code: '-',
          note: 'Kein externer HTTP-Endpunkt (lokale Engine oder fehlende URL).',
        };
      case 'API_KEY_ENV_CHECK': {
        const envName = p.expectedEnvVar || 'API_KEY';
        const hasKey = Boolean(envVars[envName] && envVars[envName]!.trim().length > 0);
        if (!hasKey) {
          return {
            ...base,
            status: 'SKIPPED (kein Key)',
            http_code: '-',
            note: `Env-Var ${envName} nicht gesetzt (Ziel 2.5). Reachability-Check auf Wunsch manuell ausführbar.`,
          };
        }
        return {
          ...base,
          status: 'PENDING',
          http_code: '-',
          note: `Env-Var ${envName} erkannt — bereit für Live-Test.`,
        };
      }
      case 'HEAD_ONLY_GELB':
        return {
          ...base,
          status: 'PENDING',
          http_code: '-',
          note: 'Klasse GELB: nur Reachability-Check (HEAD/GET), kein API-Call (Ziel 2.3).',
        };
      case 'ANONYMOUS_API_AND_HEAD':
        return {
          ...base,
          status: 'PENDING',
          http_code: '-',
          note: 'Klasse GRÜN (REST/OpenAI, auth=keine): bereit für Reachability + anonymen /v1/models-Test.',
        };
      case 'HEAD_ONLY_GREEN':
      default:
        return {
          ...base,
          status: 'PENDING',
          http_code: '-',
          note: 'Klasse GRÜN: bereit für HEAD/GET Reachability-Test (10 s Timeout).',
        };
    }
  });
}
