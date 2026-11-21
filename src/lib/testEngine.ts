import type {
  ClassifiedProvider,
  ReadinessTier,
  TestAnalytics,
  TestPhaseResult,
  TestResultRow,
} from './types.ts';

/**
 * Determines whether a provider is eligible for live testing & interactive usage.
 * Strictly enforces Hard Rule 1 (never illegal / anonym_pseudo_key) and
 * Hard Rule 3 / Ziel 2.4 (never auto-test or directly invoke ROT webclient bridges).
 */
export function isUsableGreenOrGelb(p: ClassifiedProvider): boolean {
  if (p.isIllegal || p.isAnonymPseudoKey) return false;
  return p.securityClass === 'GRUEN' || p.securityClass === 'GELB';
}

/**
 * Detects WAF / Bot-Protection responses (e.g. Cloudflare 403/429/503) so Phase 2
 * does not misclassify live, healthy API portals as dead hosts.
 */
export function isLikelyWafChallenge(
  statusCode: number,
  headers: Record<string, string | null | undefined>
): boolean {
  if (statusCode !== 403 && statusCode !== 429 && statusCode !== 503) {
    return false;
  }
  const server = (headers['server'] || '').toLowerCase();
  const cfMitigated = (headers['cf-mitigated'] || '').toLowerCase();
  const cfRay = headers['cf-ray'] || '';
  if (cfMitigated.includes('challenge')) return true;
  if (statusCode === 403 && (server.includes('cloudflare') || Boolean(cfRay) || server.includes('akamai') || server.includes('cloudfront'))) {
    return true;
  }
  if (statusCode === 429) return true;
  return false;
}

/**
 * Computes Phase 4 deterministic Health Score (0-100) and Readiness Tier from
 * Phase 1-3 results so test outcomes directly drive routing, filtering, and reporting.
 */
export function computePhase4Evaluation(
  provider: ClassifiedProvider,
  phases: TestPhaseResult[],
  latencyMs: number | undefined,
  httpCode: string,
  hasKeyConfigured: boolean
): {
  healthScore: number;
  readinessTier: ReadinessTier;
  phase4: TestPhaseResult;
} {
  if (!isUsableGreenOrGelb(provider)) {
    return {
      healthScore: 0,
      readinessTier: 'GESPERRT',
      phase4: {
        phase: 'scoring',
        label: 'Phase 4: Bewertung',
        status: 'skip',
        detail: 'Gesperrt nach Regel 1 / Ziel 2.4 (ROT, SCHWARZ, illegal oder anonym_pseudo_key).',
      },
    };
  }

  const p1 = phases.find((p) => p.phase === 'dns');
  const p2 = phases.find((p) => p.phase === 'reachability');
  const p3 = phases.find((p) => p.phase === 'protocol');

  const isLocalEngine =
    provider.kategorien.includes('lokal_self_hosted') &&
    (!provider.url || /localhost|127\.0\.0\.1|github\.com/i.test(provider.url));

  if (p1?.status === 'fail') {
    return {
      healthScore: 0,
      readinessTier: 'NICHT_ERREICHBAR',
      phase4: {
        phase: 'scoring',
        label: 'Phase 4: Bewertung',
        status: 'fail',
        detail: 'Score 0/100 — DNS/Host nicht auflösbar; für automatisches Routing ausschließen.',
      },
    };
  }

  if (p2?.status === 'fail' && p3?.status !== 'pass' && p3?.status !== 'warn') {
    return {
      healthScore: 15,
      readinessTier: 'NICHT_ERREICHBAR',
      phase4: {
        phase: 'scoring',
        label: 'Phase 4: Bewertung',
        status: 'fail',
        detail: `Score 15/100 — Host aufgelöst, aber HTTP/TLS fehlgeschlagen (${httpCode}).`,
      },
    };
  }

  const isAuthRequired =
    httpCode === '401' ||
    /HTTP 401|Auth\/API-Key|Authentifizierung/i.test(p2?.detail || '') ||
    /HTTP 401/i.test(p3?.detail || '');

  let score = 50;
  if (p1?.status === 'pass') score += 15;
  if (p2?.status === 'pass' || p3?.status === 'pass') score += 25;
  else if (isAuthRequired) score += 16; // Reachable API actively enforcing auth (HTTP 401)
  else if (p2?.status === 'warn') score += 12; // WAF-protected live host

  if (p3?.status === 'pass') score += 10;
  else if (p3?.status === 'warn') score += 4;

  // Latency adjustment for verified reachable hosts
  if (typeof latencyMs === 'number') {
    if (latencyMs <= 350) score += 5;
    else if (latencyMs > 3000) score -= 10;
    else if (latencyMs > 1500) score -= 5;
  }

  // GELB capped below GRÜN so GRÜN always ranks higher in router recommendations
  if (provider.securityClass === 'GELB') {
    score = Math.min(score, 74);
  }

  score = Math.max(0, Math.min(100, score));

  let readinessTier: ReadinessTier;
  if (p3?.status === 'pass' && provider.securityClass === 'GRUEN') {
    readinessTier = 'SOFORT_NUTZBAR';
  } else if (isAuthRequired) {
    readinessTier = 'BEREIT_MIT_KEY';
  } else if (p2?.status === 'warn') {
    readinessTier = 'EINGESCHRAENKT_WAF';
  } else if (isLocalEngine && provider.auth_typ === 'keine') {
    readinessTier = 'LOKAL_ENGINE';
  } else if (
    provider.securityClass === 'GRUEN' &&
    (provider.auth_typ === 'keine' || hasKeyConfigured)
  ) {
    readinessTier = 'SOFORT_NUTZBAR';
  } else {
    readinessTier = 'BEREIT_MIT_KEY';
  }

  return {
    healthScore: score,
    readinessTier,
    phase4: {
      phase: 'scoring',
      label: 'Phase 4: Bewertung',
      status: score >= 75 ? 'pass' : 'warn',
      detail: `Score ${score}/100 · Einstufung: ${readinessTier}`,
    },
  };
}

/**
 * Aggregates live test results into actionable analytics:
 * - Ranked top GRÜN providers by healthScore & latency for router generation
 * - Failure clusters distinguishing real outages from WAF false-negatives and missing keys
 */
export function analyzeTestResults(
  providers: ClassifiedProvider[],
  testResults: TestResultRow[]
): TestAnalytics {
  const byId = new Map(providers.map((p) => [p.id, p]));
  let totalTestableGreenGelb = 0;
  let testedGreenGelb = 0;
  let readyImmediateCount = 0;
  let readyWithKeyCount = 0;
  let wafProtectedCount = 0;
  let localEnginesCount = 0;
  let unreachableCount = 0;
  let blockedRule1OrRotCount = 0;

  let dnsFailures = 0;
  let timeoutFailures = 0;
  let httpErrorFailures = 0;
  let missingKeyCount = 0;
  const latencies: number[] = [];

  const greenCandidates: Array<{ id: string; score: number; latency: number }> = [];

  for (const row of testResults) {
    const p = byId.get(row.id);
    if (!p) continue;

    if (!isUsableGreenOrGelb(p)) {
      blockedRule1OrRotCount++;
      continue;
    }

    totalTestableGreenGelb++;
    if (row.executed) {
      testedGreenGelb++;
      if (typeof row.latencyMs === 'number' && row.latencyMs > 0) {
        latencies.push(row.latencyMs);
      }
    }

    if (row.status === 'SKIPPED (kein Key)' || row.status === 'AUTH_REQUIRED') {
      missingKeyCount++;
    } else if (row.status === 'WAF_PROTECTED') {
      wafProtectedCount++;
    } else if (row.status === 'TIMEOUT') {
      timeoutFailures++;
      unreachableCount++;
    } else if (row.status === 'NETWORK_ERROR') {
      dnsFailures++;
      unreachableCount++;
    } else if (row.status === 'HTTP_ERROR') {
      httpErrorFailures++;
      unreachableCount++;
    }

    if (row.readinessTier === 'SOFORT_NUTZBAR') readyImmediateCount++;
    else if (row.readinessTier === 'BEREIT_MIT_KEY') readyWithKeyCount++;
    else if (row.readinessTier === 'LOKAL_ENGINE') localEnginesCount++;

    if (
      p.securityClass === 'GRUEN' &&
      row.executed &&
      (row.healthScore ?? 0) >= 70 &&
      (/REST|OpenAI|Anthropic|Gateway/i.test(p.verbindungsart) ||
        /openai/i.test(p.protokoll)) &&
      !/github\.com/i.test(p.url)
    ) {
      greenCandidates.push({
        id: p.id,
        score: row.healthScore ?? 70,
        latency: row.latencyMs ?? 9999,
      });
    }
  }

  greenCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.latency - b.latency;
  });

  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((acc, v) => acc + v, 0) / latencies.length)
      : null;

  const failureClusters: TestAnalytics['failureClusters'] = [];
  if (wafProtectedCount > 0) {
    failureClusters.push({
      key: 'waf',
      label: 'WAF / Bot-Schutz (HTTP 403/429)',
      count: wafProtectedCount,
      recommendation:
        'Kein echter Ausfall: Domain aktiv, aber Headless-HEAD wird per WAF geblockt. Nutzung über offiziellen API-Endpunkt mit API-Key oder Browser regulär möglich.',
    });
  }
  if (dnsFailures > 0) {
    failureClusters.push({
      key: 'dns',
      label: 'DNS / Netzwerk nicht erreichbar',
      count: dnsFailures,
      recommendation:
        'Host nicht auflösbar oder Verbindung abgewiesen — aus automatischem Router-Fallback ausschließen oder lokal prüfen.',
    });
  }
  if (timeoutFailures > 0) {
    failureClusters.push({
      key: 'timeout',
      label: 'Zeitüberschreitung (> 8–10 s)',
      count: timeoutFailures,
      recommendation:
        'Hohe Latenz oder Paketverlust — einzeln erneut testen, bevor Aufnahme in LiteLLM-Router erfolgt.',
    });
  }
  if (httpErrorFailures > 0) {
    failureClusters.push({
      key: 'http',
      label: 'HTTP 4xx/5xx Fehler',
      count: httpErrorFailures,
      recommendation:
        'Endpunkt meldet Fehlerstatus (z. B. 404/502/503) — Ziel-URL im Detail prüfen.',
    });
  }
  if (missingKeyCount > 0) {
    failureClusters.push({
      key: 'nokey',
      label: 'Noch ohne lokalen API-Key',
      count: missingKeyCount,
      recommendation:
        'Über „Alle GRÜN & GELB testen“ werden Phase 1+2 (DNS & Reachability) trotzdem geprüft; Phase 3 API-Probe lässt sich einzeln mit eigenem Key testen.',
    });
  }

  return {
    totalTestableGreenGelb,
    testedGreenGelb,
    readyImmediateCount,
    readyWithKeyCount,
    wafProtectedCount,
    localEnginesCount,
    unreachableCount,
    blockedRule1OrRotCount,
    avgLatencyMs,
    topRankedGreenIds: greenCandidates.slice(0, 12).map((c) => c.id),
    failureClusters,
  };
}

/**
 * SSRF & Hard-Rule safety validation for /api/connections/invoke.
 * Ensures users can invoke ANY allowed GRÜN/GELB endpoint safely without
 * exposing internal cloud metadata IPs or violating Hard Rule 1 / 3.
 */
export function validateInvokeTarget(
  provider: ClassifiedProvider,
  rawEndpointUrl: string
): { ok: true; url: URL } | { ok: false; error: string } {
  if (!isUsableGreenOrGelb(provider)) {
    return {
      ok: false,
      error:
        'Aufruf gemäß Harter Regel 1 / 3 verweigert: Nur GRÜNE und GELBE Verbindungen dürfen genutzt werden.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawEndpointUrl.trim());
  } catch {
    return { ok: false, error: 'Ungültige Ziel-URL.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Nur HTTP(S)-Protokolle sind zulässig.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Block cloud metadata, link-local, 0.0.0.0, and RFC1918 private network SSRF addresses unconditionally
  const isPrivateIpv4 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === '0.0.0.0';
  const isPrivateIpv6 =
    host.startsWith('fe80:') ||
    host.startsWith('fc00:') ||
    host.startsWith('fd00:') ||
    host.startsWith('::ffff:');
  if (isPrivateIpv4 || isPrivateIpv6 || host === 'metadata.google.internal') {
    return { ok: false, error: 'Zielhost aus Sicherheitsgründen blockiert (SSRF-Schutz).' };
  }

  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (isLocalHost) {
    if (!provider.kategorien.includes('lokal_self_hosted')) {
      return {
        ok: false,
        error: 'Loopback-Ziele sind nur für lokale Engines (lokal_self_hosted) zulässig.',
      };
    }
    return { ok: true, url: parsed };
  }

  // Must match the provider's base domain (same registrable root, exact host, or server-trusted default API host)
  if (provider.url && /^https?:\/\//i.test(provider.url)) {
    try {
      const catalogHost = new URL(provider.url).hostname.toLowerCase();
      const rootDomain = (h: string) => h.split('.').slice(-2).join('.');
      let trustedDefaultHost: string | null = null;
      try {
        const defaultInfo = resolveDefaultEndpoint(provider, classifyConnectionKind(provider).kind);
        if (/^https?:\/\//i.test(defaultInfo.base)) {
          trustedDefaultHost = new URL(defaultInfo.base).hostname.toLowerCase();
        }
      } catch {
        // ignore
      }
      const matchesCatalog = host === catalogHost || rootDomain(host) === rootDomain(catalogHost);
      const matchesTrustedDefault = trustedDefaultHost !== null && host === trustedDefaultHost;
      if (!matchesCatalog && !matchesTrustedDefault) {
        return {
          ok: false,
          error: `Zielhost "${host}" stimmt nicht mit der Katalog-Domain "${catalogHost}" überein (SSRF-Schutz).`,
        };
      }
    } catch {
      // ignore malformed catalog url
    }
  }

  return { ok: true, url: parsed };
}

export interface ConnectionSnippetBundle {
  connectionKind: 'openai_rest' | 'native_rest' | 'browser_only' | 'mcp_or_sdk';
  connectionLabel: string;
  supportsOpenAiEndpoints: boolean;
  endpointNote: string | null;
  defaultApiBase: string;
  envVar: string;
  curl: string;
  powershell: string;
  python: string;
}

/**
 * Normalizes environment variable names so IDs ending in `-api` never produce `_API_API_KEY`.
 */
export function normalizeEnvVarName(provider: Pick<ClassifiedProvider, 'id' | 'expectedEnvVar'>): string {
  if (provider.expectedEnvVar) {
    return provider.expectedEnvVar.replace(/_API_API_KEY$/i, '_API_KEY');
  }
  const slug = provider.id
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) return 'API_KEY';
  if (slug.endsWith('_API_KEY')) return slug;
  if (slug.endsWith('_API')) return `${slug}_KEY`;
  return `${slug}_API_KEY`;
}

/**
 * Classifies how a usable (GRÜN/GELB) provider is actually meant to be used
 * so Browser-only standards (e.g. WebNN W3C spec), credit/grant portals
 * (e.g. AMD AI Developer Program), research pages (Cohere Labs), MCP servers,
 * and non-local SDK repos are never falsely given `/v1/models` OpenAI URLs.
 */
export function classifyConnectionKind(
  provider: Pick<
    ClassifiedProvider,
    'id' | 'name' | 'url' | 'verbindungsart' | 'protokoll' | 'kategorien' | 'beschreibung'
  >
): {
  kind: ConnectionSnippetBundle['connectionKind'];
  label: string;
  supportsOpenAiEndpoints: boolean;
} {
  const verb = (provider.verbindungsart || '').trim();
  const proto = (provider.protokoll || '').trim();
  const url = (provider.url || '').trim();
  const idName = `${provider.id} ${provider.name}`.toLowerCase();
  const isLocal = provider.kategorien.includes('lokal_self_hosted');
  const hasInlineApiUrl = /\(([a-z0-9.-]+\.[a-z]{2,}\/[a-z0-9/_-]*)/i.test(verb);
  const isExplicitSdkOrMcp = /^mcp\b|sdk-eigen/i.test(verb) && !hasInlineApiUrl;

  const isLocalOpenAiEngine =
    isLocal &&
    !isExplicitSdkOrMcp &&
    (/\b(ollama|lm-?studio|vllm|llama-?cpp|localai|jan|koboldcpp|tabbyapi|sglang|litellm|mistral-?rs|textgen|xinference|dynamo|openvino|mlc-?llm|openllm|freellama|bitnet|anythingllm|unsloth|atomic-?chat|agentgateway|cliproxyapi|paddler|llm-?keypool)\b/i.test(
      idName
    ) ||
      /rest|openai|gateway/i.test(verb) ||
      /openai_kompatibel/i.test(proto));

  // Explicit W3C specs or Browser-only / Browser-SDK entries without OpenAI REST endpoint
  if (
    /w3\.org\/tr\//i.test(url) ||
    (/browser-only|browser-sdk/i.test(verb) && !/openai_kompatibel/i.test(proto))
  ) {
    return {
      kind: 'browser_only',
      label: 'Browser-Only / Web-Standard (kein HTTP-/v1-Endpunkt)',
      supportsOpenAiEndpoints: false,
    };
  }

  // Credit/grant signup portals, research/blog/directory pages without direct chat API
  if (
    !isLocal &&
    (/\/ai-developer-program\b|\/blog\/|\/research\/?$|registry\.modelcontextprotocol\.io|cvron\.alwaysdata\.net/i.test(
      url
    ) ||
      /verzeichnis|forschungs-lagebild|gratis-credits/i.test(provider.name))
  ) {
    return {
      kind: 'mcp_or_sdk',
      label: 'Portal / Kreditprogramm / Doku (kein direkter /v1-Chat-Endpunkt)',
      supportsOpenAiEndpoints: false,
    };
  }

  // Native non-OpenAI REST protocols (Anthropic-native, Bedrock-Converse, Gemini-native without OpenAI compat)
  if (
    /anthropic-native|bedrock-converse|gemini-native/i.test(verb) &&
    !/openai/i.test(`${proto} ${verb}`)
  ) {
    return {
      kind: 'native_rest',
      label: `Proprietäre REST-API (${verb})`,
      supportsOpenAiEndpoints: false,
    };
  }

  // MCP servers, SDK-eigen entries (e.g. Cohere Labs, node-llama-cpp), or non-local GitHub repositories
  if (isExplicitSdkOrMcp || (!isLocalOpenAiEngine && /github\.com/i.test(url))) {
    return {
      kind: 'mcp_or_sdk',
      label: /^mcp\b/i.test(verb)
        ? 'MCP-Server / Tool-Protokoll'
        : /github\.com/i.test(url)
          ? 'GitHub-Repository / Self-Hosted Tool (zuerst lokal starten)'
          : 'SDK / Bibliothek / Forschung (kein direkter /v1-Endpunkt)',
      supportsOpenAiEndpoints: false,
    };
  }

  // OpenAI-compatible REST APIs & local OpenAI-compatible inference engines
  if (
    isLocalOpenAiEngine ||
    /rest|openai|gateway/i.test(verb) ||
    /openai_kompatibel/i.test(proto)
  ) {
    return {
      kind: 'openai_rest',
      label: isLocalOpenAiEngine
        ? 'Lokale OpenAI-kompatible Engine (127.0.0.1)'
        : 'REST / OpenAI-kompatible API',
      supportsOpenAiEndpoints: true,
    };
  }

  if (provider.kategorien.includes('edge_browser') || provider.kategorien.includes('web_chat')) {
    return {
      kind: 'browser_only',
      label: 'Browser-Portal / Web-Anwendung',
      supportsOpenAiEndpoints: false,
    };
  }

  return {
    kind: 'mcp_or_sdk',
    label: verb && verb !== 'null' ? verb : 'Portal / Dokumentation / SDK',
    supportsOpenAiEndpoints: false,
  };
}

function resolveDefaultEndpoint(
  provider: Pick<
    ClassifiedProvider,
    'id' | 'name' | 'url' | 'verbindungsart' | 'kategorien' | 'beschreibung'
  >,
  kind: ConnectionSnippetBundle['connectionKind']
): { base: string; note: string | null } {
  const rawUrl = (provider.url || '').trim();
  const idLower = provider.id.toLowerCase();
  const idName = `${provider.id} ${provider.name}`.toLowerCase();
  const isLocal = provider.kategorien.includes('lokal_self_hosted');
  const desc = (provider.beschreibung || '').trim();

  // For non-OpenAI targets (Browser-only, MCP, SDK, Native REST), never fabricate /v1
  if (kind !== 'openai_rest') {
    const note =
      kind === 'browser_only'
        ? 'Kein REST-/v1-Endpunkt: Diese Verbindung läuft direkt im Browser bzw. ist eine Web-Spezifikation/Weboberfläche.'
        : kind === 'mcp_or_sdk'
          ? 'Kein direkter OpenAI-/v1-Endpunkt: Portal, Kreditprogramm, SDK oder lokales Git-Repository (zuerst lokal starten bzw. Ziel-API im Portal abrufen).'
          : 'Nutzt ein herstellerspezifisches REST-Protokoll (nicht OpenAI /v1/models). Offizielle Endpunkt-Doku beachten.';
    return { base: rawUrl || 'http://127.0.0.1:11434', note };
  }

  // 1) Local self-hosted OpenAI engines MUST resolve to 127.0.0.1:<port>/v1 BEFORE any cloud name matching
  // (prevents e.g. mistral-rs from being falsely mapped to https://api.mistral.ai/v1)
  if (isLocal) {
    if (/ollama/i.test(idName)) return { base: 'http://127.0.0.1:11434/v1', note: null };
    if (/lm-?studio/i.test(idName)) return { base: 'http://127.0.0.1:1234/v1', note: null };
    if (/mistral-?rs/i.test(idName)) {
      return {
        base: 'http://127.0.0.1:1234/v1',
        note: 'Lokale Rust-Engine: zuerst "mistralrs serve" lokal starten (Standardport 1234, ggf. oben anpassen).',
      };
    }
    if (/vllm/i.test(idName)) return { base: 'http://127.0.0.1:8000/v1', note: null };
    if (/llama-?cpp/i.test(idName)) return { base: 'http://127.0.0.1:8080/v1', note: null };
    if (/textgen|oobabooga/i.test(idName)) {
      return {
        base: 'http://127.0.0.1:5000/v1',
        note: 'Lokaler Server: zuerst textgen mit --api lokal starten (Standardport 5000).',
      };
    }
    if (/litellm/i.test(idName)) return { base: 'http://127.0.0.1:4000/v1', note: null };
    if (/koboldcpp/i.test(idName)) return { base: 'http://127.0.0.1:5001/v1', note: null };
    if (/localai/i.test(idName)) return { base: 'http://127.0.0.1:8080/v1', note: null };
    return {
      base: 'http://127.0.0.1:8000/v1',
      note: 'Lokale Self-Hosted-Engine: zuerst lokal starten und bei Bedarf den lokalen Port unter Basis-URL anpassen.',
    };
  }

  // 2) Explicit inline API endpoint documented directly in verbindungsart (e.g. "(opencode.ai/zen/v1; ...)")
  const embeddedMatch = (provider.verbindungsart || '').match(
    /\(([a-z0-9.-]+\.[a-z]{2,}\/[a-z0-9/_-]*)/i
  );
  if (embeddedMatch && embeddedMatch[1]) {
    const cleaned = embeddedMatch[1].replace(/\/+$/, '');
    const normalized = cleaned.endsWith('/openai') ? `${cleaned}/v1` : cleaned;
    return { base: `https://${normalized}`, note: null };
  }

  // 3) Explicit full https://.../v1 or /proxy/v1 endpoint documented verbatim in beschreibung
  const descEndpointMatch = desc.match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[a-z0-9/_-]*\/v1\b/i);
  if (descEndpointMatch && descEndpointMatch[0]) {
    return { base: descEndpointMatch[0].replace(/\/+$/, ''), note: null };
  }

  // 4) Verified official cloud API base mappings (strictly non-local, non-GitHub)
  if (!/github\.com/i.test(rawUrl)) {
    if (idLower === 'pollinations') {
      return {
        base: 'https://text.pollinations.ai/openai',
        note: 'Keyless Text-API laut Katalog (max. 1 Anfrage / 30 s pro IP; anonymes Modell z. B. openai / gpt-oss-20b).',
      };
    }
    if (idLower.includes('openrouter')) return { base: 'https://openrouter.ai/api/v1', note: null };
    if (idLower.includes('groq')) return { base: 'https://api.groq.com/openai/v1', note: null };
    if (idLower.includes('cerebras')) return { base: 'https://api.cerebras.ai/v1', note: null };
    if (idLower.includes('together')) return { base: 'https://api.together.xyz/v1', note: null };
    if (idLower === 'mistral-la-plateforme' || (idLower.includes('mistral') && /mistral\.ai/i.test(rawUrl))) {
      return { base: 'https://api.mistral.ai/v1', note: null };
    }
    if (idLower === 'deepseek' || idLower.includes('deepseek-api')) {
      return { base: 'https://api.deepseek.com/v1', note: null };
    }
    if (idLower.includes('fireworks')) return { base: 'https://api.fireworks.ai/inference/v1', note: null };
    if (idLower.includes('sambanova')) return { base: 'https://api.sambanova.ai/v1', note: null };
    if (idLower.includes('siliconflow')) return { base: 'https://api.siliconflow.com/v1', note: null };
    if (idLower.includes('github-models')) return { base: 'https://models.github.ai/inference', note: null };
    if (idLower.includes('google-ai-studio') || idLower === 'gemini-api') {
      return { base: 'https://generativelanguage.googleapis.com/v1beta/openai', note: null };
    }
  }

  // 5) Fallback for REST providers whose catalog URL is already an API path vs. a docs/landing page
  if (rawUrl.startsWith('http') && !/github\.com/i.test(rawUrl)) {
    const trimmed = rawUrl.replace(/\/+$/, '');
    if (/\/v1(\b|\/)/i.test(trimmed) || /\/openai$/i.test(trimmed)) {
      return { base: trimmed, note: null };
    }
    if (/^https?:\/\/docs\.|\/docs\//i.test(trimmed)) {
      return {
        base: trimmed,
        note: 'Katalog-URL zeigt auf die API-Dokumentation (nicht direkt auf den Inferenz-Host). Offizielle API-Basis-URL laut Doku oben eintragen.',
      };
    }
    const looksLikeApiHost = /^https?:\/\/(api\.|models\.|inference\.|router\.|oai\.)/i.test(trimmed);
    return {
      base: `${trimmed}/v1`,
      note: looksLikeApiHost
        ? null
        : 'Katalog-URL ist ggf. die Start-/Doku-Seite. Falls /v1/models HTTP 404 liefert, offizielle API-Subdomain (z. B. api.<domain>/v1) oben eintragen.',
    };
  }

  return {
    base: rawUrl || 'http://127.0.0.1:11434/v1',
    note: rawUrl && /github\.com/i.test(rawUrl)
      ? 'Katalog-URL verweist auf ein GitHub-Repository. Lokalen Server starten und Basis-URL auf 127.0.0.1:<Port>/v1 setzen.'
      : null,
  };
}

/**
 * Generates ready-to-use, secret-free (Hard Rule 2), Windows-11-PowerShell-safe
 * client snippets tailored to the provider's real connection kind.
 */
export function buildConnectionSnippets(provider: ClassifiedProvider): ConnectionSnippetBundle {
  const envVar = normalizeEnvVarName(provider);
  const { kind, label, supportsOpenAiEndpoints } = classifyConnectionKind(provider);
  const { base: defaultApiBase, note: endpointNote } = resolveDefaultEndpoint(provider, kind);

  if (kind === 'browser_only') {
    const safeUrl = provider.url || defaultApiBase;
    const isWebNn = /webnn/i.test(`${provider.id} ${provider.name}`);
    const curl = [
      '# Windows PowerShell / CMD (echtes curl.exe — nicht den PS-Alias "curl" nutzen)',
      '# Hinweis: Browser-Only / Web-Standard (kein HTTP /v1/models Endpunkt)',
      `curl.exe -sSI "${safeUrl}"`,
    ].join('\n');

    const powershellLines = [
      '# Windows PowerShell: Erreichbarkeit der Doku-/Portal-URL pruefen (kein /v1/models Endpunkt)',
      `Invoke-WebRequest -Uri "${safeUrl}" -Method Head | Select-Object StatusCode, StatusDescription`,
      `# Im Standardbrowser oeffnen:`,
      `Start-Process "${safeUrl}"`,
    ];
    if (isWebNn) {
      powershellLines.push(
        '# WebNN-Check in Chrome/Edge DevTools-Konsole (Flag #web-machine-learning-neural-network):',
        "# 'ml' in navigator"
      );
    }

    const python = isWebNn
      ? `# WebNN API ist eine reine Browser-JavaScript-API (W3C-Standard), keine Python-REST-API.\n# Empfohlener Weg laut Katalog: ONNX Runtime Web im Browser (Chrome/Edge DirectML-Backend).\n# Spezifikation: ${safeUrl}`
      : `import urllib.request\n\n# Browser-Only-Verbindung (kein OpenAI-/v1-Endpunkt) — nur Reachability-Check:\nreq = urllib.request.Request("${safeUrl}", method="HEAD")\nwith urllib.request.urlopen(req, timeout=10) as resp:\n    print("HTTP", resp.status, resp.geturl())`;

    return {
      connectionKind: kind,
      connectionLabel: label,
      supportsOpenAiEndpoints,
      endpointNote,
      defaultApiBase: safeUrl,
      envVar,
      curl,
      powershell: powershellLines.join('\n'),
      python,
    };
  }

  if (kind === 'mcp_or_sdk') {
    const safeUrl = provider.url || defaultApiBase;
    const isGithub = /^https:\/\/github\.com\//i.test(safeUrl);
    const curl = isGithub
      ? [
          '# GitHub-Repository lokal klonen (flacher Klon, ohne Ausfuehrung):',
          `git clone --depth 1 "${safeUrl}"`,
          '# Erreichbarkeit pruefen (Windows curl.exe):',
          `curl.exe -sSI "${safeUrl}"`,
        ].join('\n')
      : [
          '# Windows PowerShell / CMD (echtes curl.exe):',
          `curl.exe -sSI "${safeUrl}"`,
        ].join('\n');

    const powershell = isGithub
      ? [
          '# Windows PowerShell: Repository klonen & pruefen',
          `git clone --depth 1 "${safeUrl}"`,
          `Invoke-WebRequest -Uri "${safeUrl}" -Method Head | Select-Object StatusCode, StatusDescription`,
        ].join('\n')
      : [
          '# Windows PowerShell: Portal-/SDK-URL pruefen',
          `Invoke-WebRequest -Uri "${safeUrl}" -Method Head | Select-Object StatusCode, StatusDescription`,
          `Start-Process "${safeUrl}"`,
        ].join('\n');

    const python = `# ${label}\n# Kein direkter OpenAI-/v1/models-Endpunkt — Integration ueber offizielles SDK / MCP-Client.\n# Quelle / Doku: ${safeUrl}`;

    return {
      connectionKind: kind,
      connectionLabel: label,
      supportsOpenAiEndpoints,
      endpointNote,
      defaultApiBase: safeUrl,
      envVar,
      curl,
      powershell,
      python,
    };
  }

  if (kind === 'native_rest') {
    const safeUrl = provider.url || defaultApiBase;
    const curl = [
      `# ${label} (kein OpenAI /v1/models — offizielles Protokoll laut Doku nutzen)`,
      '# Windows PowerShell / CMD (echtes curl.exe):',
      `curl.exe -sSI "${safeUrl}"`,
    ].join('\n');

    const powershell = [
      `# ${label} (Env: ${envVar})`,
      `Invoke-WebRequest -Uri "${safeUrl}" -Method Head | Select-Object StatusCode, StatusDescription`,
      `# Offizielle Endpunkt-Doku: ${safeUrl}`,
    ].join('\n');

    const python = `# ${label}\n# Env-Variable: ${envVar}="<DEIN_KEY>"\n# Offizielle API-Dokumentation: ${safeUrl}`;

    return {
      connectionKind: kind,
      connectionLabel: label,
      supportsOpenAiEndpoints,
      endpointNote,
      defaultApiBase: safeUrl,
      envVar,
      curl,
      powershell,
      python,
    };
  }

  // Standard OpenAI-compatible REST endpoint
  const modelsUrl = `${defaultApiBase.replace(/\/+$/, '')}/models`;
  const authHeaderCurl =
    provider.auth_typ === 'keine'
      ? ''
      : ` -H "Authorization: Bearer <DEIN_KEY>"`;

  const curl = [
    `# Windows PowerShell / CMD (echtes curl.exe — nicht PS-Alias "curl"!) · Env: ${envVar}`,
    `curl.exe -sS "${modelsUrl}"${authHeaderCurl}`,
  ].join('\n');

  const powershell =
    provider.auth_typ === 'keine'
      ? [
          '# Windows PowerShell (Invoke-RestMethod)',
          `Invoke-RestMethod -Uri "${modelsUrl}" -Method Get`,
        ].join('\n')
      : [
          `# Windows PowerShell (vorher: $env:${envVar} = "<DEIN_KEY>")`,
          `$headers = @{ Authorization = "Bearer $env:${envVar}" }`,
          `Invoke-RestMethod -Uri "${modelsUrl}" -Headers $headers -Method Get`,
        ].join('\n');

  const python = `import os
from openai import OpenAI

client = OpenAI(
    base_url="${defaultApiBase}",
    api_key=${provider.auth_typ === 'keine' ? '"not-needed"' : `os.environ.get("${envVar}", "<DEIN_KEY>")`},
)
print([m.id for m in client.models.list().data[:10]])`;

  return {
    connectionKind: kind,
    connectionLabel: label,
    supportsOpenAiEndpoints,
    endpointNote,
    defaultApiBase,
    envVar,
    curl,
    powershell,
    python,
  };
}

