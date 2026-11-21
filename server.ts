import express from 'express';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { BridgeProcessManager, buildBridgeManualCommands } from './src/lib/bridgeRunner.ts';
import { consolidateBridges } from './src/lib/bridgeSelector.ts';
import {
  categorizeModelIds,
  extractChatCompletionReply,
  extractModelIds,
  sanitizeChatMessages,
  validateChatTarget,
  type ChatTargetType,
} from './src/lib/chatEngine.ts';
import { buildInitialTestResults, classifyAllProviders } from './src/lib/classifier.ts';
import {
  computeNextRunAt,
  createDefaultWorkspace,
  createId,
  isJobDue,
  retrieveProjectContext,
  validateWorkspacePayload,
  type NotebookChronoJob,
  type NotebooksWorkspace,
} from './src/lib/notebookEngine.ts';
import { parseProviderMarkdown } from './src/lib/parser.ts';
import {
  cloneOrUpdateBridgeRepo,
  getAllowlistedBridgeRepos,
  inspectLocalBridgeRepo,
  readClonedRepoFile,
} from './src/lib/repoManager.ts';
import { generateAllSuiteFiles } from './src/lib/suiteGenerator.ts';
import {
  analyzeTestResults,
  buildConnectionSnippets,
  computePhase4Evaluation,
  isLikelyWafChallenge,
  isUsableGreenOrGelb,
  validateInvokeTarget,
} from './src/lib/testEngine.ts';
import type {
  BridgeCandidateEvaluation,
  BridgeRepoStatus,
  BridgeSelectionEntry,
  ClassifiedProvider,
  DatasetSummary,
  Rule7CollisionNotice,
  SecurityClass,
  TestBatchState,
  TestPhaseResult,
  TestResultRow,
  WorkspacePayload,
} from './src/lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATASET_PATH = path.resolve(
  __dirname,
  'public/assets/aistudio/ai_provider_2__1d92e1da.txt'
);
const BRIDGES_ROOT_DIR = path.resolve(__dirname, 'bridges');
const NOTEBOOKS_DATA_DIR = path.resolve(__dirname, 'data');
const NOTEBOOKS_FILE_PATH = path.resolve(NOTEBOOKS_DATA_DIR, 'notebooks.json');

function loadNotebooksFromDisk(): NotebooksWorkspace {
  try {
    if (fs.existsSync(NOTEBOOKS_FILE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(NOTEBOOKS_FILE_PATH, 'utf8'));
      const validated = validateWorkspacePayload(raw);
      if (validated.ok && validated.workspace.projects.length > 0) {
        return validated.workspace;
      }
    }
  } catch (err) {
    console.warn('Could not load data/notebooks.json, initializing fresh workspace:', err);
  }
  return createDefaultWorkspace();
}

function saveNotebooksToDisk(workspace: NotebooksWorkspace): void {
  fs.mkdirSync(NOTEBOOKS_DATA_DIR, { recursive: true });
  const tmpPath = path.resolve(NOTEBOOKS_DATA_DIR, `notebooks.${process.pid}.tmp.json`);
  if (!tmpPath.startsWith(NOTEBOOKS_DATA_DIR + path.sep)) {
    throw new Error('Ungültiger Speicherpfad.');
  }
  fs.writeFileSync(tmpPath, JSON.stringify(workspace, null, 2), 'utf8');
  fs.renameSync(tmpPath, NOTEBOOKS_FILE_PATH);
}

interface ServerState {
  sourceName: string;
  parsedAt: string;
  providers: ClassifiedProvider[];
  collisions: Rule7CollisionNotice[];
  testResults: Map<string, TestResultRow>;
  activeRouterProviderIds: Set<string>;
  bridgeSelections: BridgeSelectionEntry[];
  excludedBridgeEntries: BridgeCandidateEvaluation[];
  totalBridgeCategoryCount: number;
  bridgeRepos: Map<string, BridgeRepoStatus>;
  cloneBatchRunning: boolean;
  batchState: TestBatchState;
  activeBatchToken: number;
}

function loadDatasetIntoState(markdown: string, sourceName: string): ServerState {
  const parsed = parseProviderMarkdown(markdown);
  const { classified, collisions } = classifyAllProviders(parsed);
  const initialRows = buildInitialTestResults(classified, process.env);
  const testResults = new Map<string, TestResultRow>();
  for (const row of initialRows) {
    testResults.set(row.id, row);
  }
  const { selections, excludedEntries, totalBridgeCategoryCount } = consolidateBridges(classified);
  const allowlisted = getAllowlistedBridgeRepos(selections);
  const bridgeRepos = new Map<string, BridgeRepoStatus>();
  for (const r of allowlisted) {
    bridgeRepos.set(r.bridgeId, {
      bridgeId: r.bridgeId,
      zielprovider: r.zielprovider,
      repoUrl: r.repoUrl,
      localPath: `bridges/${r.bridgeId}`,
      status: 'idle',
      cloned: false,
      commitHash: null,
      commitDate: null,
      branch: null,
      fileCount: 0,
      hasDockerfile: false,
      hasDockerCompose: false,
      hasLicense: false,
      hasReadme: false,
      topFiles: [],
      error: null,
      updatedAt: null,
    });
  }

  return {
    sourceName,
    parsedAt: new Date().toISOString(),
    providers: classified,
    collisions,
    testResults,
    activeRouterProviderIds: new Set<string>(),
    bridgeSelections: selections,
    excludedBridgeEntries: excludedEntries,
    totalBridgeCategoryCount,
    bridgeRepos,
    cloneBatchRunning: false,
    batchState: {
      running: false,
      mode: null,
      total: 0,
      completed: 0,
      startedAt: null,
      finishedAt: null,
    },
    activeBatchToken: 0,
  };
}

const bridgeManager = new BridgeProcessManager();

let state: ServerState = loadDatasetIntoState(
  fs.readFileSync(DEFAULT_DATASET_PATH, 'utf8'),
  'ai_provider(2).txt'
);
bridgeManager.initFromSelections(state.bridgeSelections);

async function refreshLocalBridgeRepos(): Promise<void> {
  const allowlisted = getAllowlistedBridgeRepos(state.bridgeSelections);
  const statuses = await Promise.all(
    allowlisted.map((repo) => inspectLocalBridgeRepo(repo, BRIDGES_ROOT_DIR))
  );
  for (const st of statuses) {
    const existing = state.bridgeRepos.get(st.bridgeId);
    if (existing?.status === 'cloning') continue;
    if (!st.cloned && existing?.status === 'failed') continue;
    state.bridgeRepos.set(st.bridgeId, st);
  }
}

function buildWorkspacePayload(): WorkspacePayload {
  const testResultsArray = state.providers.map((p) => state.testResults.get(p.id)!);
  const activeRouterList = Array.from(state.activeRouterProviderIds);
  const testAnalytics = analyzeTestResults(state.providers, testResultsArray);

  const { files, auditChecks } = generateAllSuiteFiles(
    state.providers,
    testResultsArray,
    state.bridgeSelections,
    state.collisions,
    state.sourceName,
    activeRouterList
  );

  const counts: Record<SecurityClass, number> = {
    GRUEN: 0,
    GELB: 0,
    ROT: 0,
    SCHWARZ: 0,
  };
  for (const p of state.providers) {
    counts[p.securityClass]++;
  }

  const summary: DatasetSummary = {
    totalProviders: state.providers.length,
    sourceName: state.sourceName,
    parsedAt: state.parsedAt,
    counts,
    bridgeCandidatesCount: state.totalBridgeCategoryCount,
    selectedBridgesCount: state.bridgeSelections.filter((s) => s.bridge_id !== null).length,
    dockerizedBridgesCount: state.bridgeSelections.filter((s) => s.docker_capable).length,
    rule7Collisions: state.collisions,
    auditChecks,
  };

  const bridgeReposArray = getAllowlistedBridgeRepos(state.bridgeSelections).map(
    (r) => state.bridgeRepos.get(r.bridgeId)!
  );

  return {
    summary,
    providers: state.providers,
    testResults: testResultsArray,
    testAnalytics,
    activeRouterProviderIds: activeRouterList,
    bridgeSelections: state.bridgeSelections,
    excludedBridgeEntries: state.excludedBridgeEntries,
    bridgeRepos: bridgeReposArray,
    bridgeRuntimes: bridgeManager.getAllStates(),
    cloneBatchRunning: state.cloneBatchRunning,
    artifacts: files,
    batchState: state.batchState,
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AI-Provider-Suite-Workbench/2.0 (ToS-Compliant-4Phase-Check)',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function dnsLookupWithTimeout(
  hostname: string,
  timeoutMs = 4500
): Promise<{ ok: true; address: string; ms: number } | { ok: false; error: string; ms: number }> {
  const start = Date.now();
  try {
    const res = await Promise.race([
      dns.lookup(hostname),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS-Timeout nach 4,5 s')), timeoutMs)
      ),
    ]);
    return { ok: true, address: res.address, ms: Date.now() - start };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'DNS-Auflösung fehlgeschlagen',
      ms: Date.now() - start,
    };
  }
}

/**
 * ZIEL 2 + 4-PHASE SERVER-SIDE TEST ENGINE
 * Phase 1: URL & DNS resolution (separates dead domains from WAF/HTTP errors)
 * Phase 2: HTTP/TLS Reachability (HEAD -> GET fallback + Cloudflare/WAF detection)
 * Phase 3: Protocol / API Probe (ONLY GRÜN: anonymous /v1/models or BYOK/Env Bearer probe; GELB strictly SKIP)
 * Phase 4: Health Score (0-100) & Readiness Tier for Smart Routing
 * Hard Rule 1 & 3 enforced unconditionally at the server boundary.
 */
async function executeMultiPhaseTest(
  p: ClassifiedProvider,
  options: { byokApiKey?: string } = {}
): Promise<TestResultRow> {
  const base: Omit<TestResultRow, 'status' | 'http_code' | 'note'> = {
    id: p.id,
    name: p.name,
    kategorie: p.kategorien[0] || 'unbekannt',
    securityClass: p.securityClass,
    risky: p.riskyBool,
    empfohlen: p.empfohlenValue,
    url: p.securityClass === 'SCHWARZ' || p.isIllegal ? '[GESPERRT – NUR DOKUMENTATION]' : p.url,
    executed: true,
    testedAt: new Date().toISOString(),
  };

  // Hard server-side gate (Regel 1 & Ziel 2.4)
  if (p.securityClass === 'SCHWARZ' || p.isIllegal) {
    return {
      ...base,
      executed: false,
      status: 'SKIPPED (illegal)',
      http_code: '-',
      healthScore: 0,
      readinessTier: 'GESPERRT',
      note: 'Server-Sperre (Regel 1): illegal / strafbar — niemals aufrufen.',
    };
  }
  if (p.isAnonymPseudoKey) {
    return {
      ...base,
      executed: false,
      status: 'SKIPPED (Regel 1: anonym_pseudo_key)',
      http_code: '-',
      healthScore: 0,
      readinessTier: 'GESPERRT',
      note: 'Server-Sperre (Regel 1 & 7): Kategorie anonym_pseudo_key — niemals testen.',
    };
  }
  if (p.securityClass === 'ROT') {
    return {
      ...base,
      executed: false,
      status: 'SKIPPED (ToS-Risiko)',
      http_code: '-',
      healthScore: 0,
      readinessTier: 'GESPERRT',
      note: 'Server-Sperre (Ziel 2.4 / Regel 3): Klasse ROT — automatischer Test untersagt.',
    };
  }

  const phases: TestPhaseResult[] = [];

  // Phase 1: URL & DNS Validation
  if (!p.url || !/^https?:\/\//i.test(p.url)) {
    const p1: TestPhaseResult = {
      phase: 'dns',
      label: 'Phase 1: URL/DNS',
      status: 'skip',
      detail: 'Keine externe HTTP(S)-URL hinterlegt (lokale Engine / SDK).',
    };
    phases.push(p1);
    const { healthScore, readinessTier, phase4 } = computePhase4Evaluation(
      p,
      phases,
      undefined,
      '-',
      false
    );
    phases.push(phase4);
    return {
      ...base,
      executed: true,
      status: 'SKIPPED (lokal/kein Endpunkt)',
      http_code: '-',
      note: 'P1: lokal/kein HTTP-Endpunkt · Lokal nutzbar über Workbench-Konfiguration.',
      phases,
      healthScore,
      readinessTier,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(p.url);
  } catch {
    phases.push({
      phase: 'dns',
      label: 'Phase 1: URL/DNS',
      status: 'fail',
      detail: `Ungültige URL-Syntax: ${p.url}`,
    });
    const { healthScore, readinessTier, phase4 } = computePhase4Evaluation(
      p,
      phases,
      undefined,
      '-',
      false
    );
    phases.push(phase4);
    return {
      ...base,
      status: 'NETWORK_ERROR',
      http_code: '-',
      note: 'P1 FAIL: Ungültige URL-Syntax.',
      phases,
      healthScore,
      readinessTier,
    };
  }

  const host = parsedUrl.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (isLocal) {
    phases.push({
      phase: 'dns',
      label: 'Phase 1: URL/DNS',
      status: 'pass',
      detail: `Loopback-Host (${host}) erkannt — lokale Engine.`,
    });
  } else {
    const dnsRes = await dnsLookupWithTimeout(host, 4500);
    if (!dnsRes.ok) {
      phases.push({
        phase: 'dns',
        label: 'Phase 1: URL/DNS',
        status: 'fail',
        detail: `DNS-Fehler für ${host}: ${dnsRes.error}`,
        durationMs: dnsRes.ms,
      });
      const { healthScore, readinessTier, phase4 } = computePhase4Evaluation(
        p,
        phases,
        dnsRes.ms,
        '-',
        false
      );
      phases.push(phase4);
      return {
        ...base,
        status: 'NETWORK_ERROR',
        http_code: '-',
        latencyMs: dnsRes.ms,
        note: `P1 DNS-FAIL (${host}: ${dnsRes.error}) · P4 Score ${healthScore}/100`,
        phases,
        healthScore,
        readinessTier,
      };
    }
    phases.push({
      phase: 'dns',
      label: 'Phase 1: URL/DNS',
      status: 'pass',
      detail: `${host} → ${dnsRes.address} (${dnsRes.ms}ms)`,
      durationMs: dnsRes.ms,
    });
  }

  // Phase 2: HTTP/TLS Reachability (HEAD -> GET fallback + WAF detection)
  const envVar = p.expectedEnvVar || '';
  const serverKey = envVar ? process.env[envVar]?.trim() : '';
  const activeKey = (options.byokApiKey?.trim() || serverKey || '');
  const hasKeyConfigured = activeKey.length > 0;

  const startMs = Date.now();
  let httpCode = '-';
  let latencyMs = 0;
  let finalUrl = p.url;
  let redirected = false;
  let finalStatus: TestResultRow['status'] = 'OK';
  let apiProbeSummary: string | undefined;

  try {
    let response = await fetchWithTimeout(p.url, { method: 'HEAD' }, 8000);
    let usedMethod = 'HEAD';
    if (
      response.status === 405 ||
      response.status === 501 ||
      response.status === 403 ||
      response.status === 400
    ) {
      response = await fetchWithTimeout(p.url, { method: 'GET' }, 8000);
      usedMethod = 'GET-Fallback';
      try {
        await response.body?.cancel();
      } catch {
        // ignore stream cancel errors
      }
    }

    latencyMs = Date.now() - startMs;
    httpCode = String(response.status);
    finalUrl = response.url || p.url;
    redirected = finalUrl !== p.url;

    const headerObj: Record<string, string | null> = {
      server: response.headers.get('server'),
      'cf-mitigated': response.headers.get('cf-mitigated'),
      'cf-ray': response.headers.get('cf-ray'),
    };
    const ok = response.status >= 200 && response.status < 400;
    const isAuth401 = response.status === 401;
    const isWaf = !ok && !isAuth401 && isLikelyWafChallenge(response.status, headerObj);

    if (ok) {
      finalStatus = redirected ? 'REDIRECT' : 'OK';
      phases.push({
        phase: 'reachability',
        label: 'Phase 2: HTTP/TLS',
        status: 'pass',
        detail: `${usedMethod} HTTP ${response.status} (${latencyMs}ms)${redirected ? ` → ${finalUrl}` : ''}`,
        durationMs: latencyMs,
      });
    } else if (isAuth401) {
      finalStatus = 'AUTH_REQUIRED';
      phases.push({
        phase: 'reachability',
        label: 'Phase 2: HTTP/TLS',
        status: 'warn',
        detail: `HTTP 401 — Host erreichbar, Auth/API-Key erforderlich (${latencyMs}ms)${redirected ? ` → ${finalUrl}` : ''}`,
        durationMs: latencyMs,
      });
    } else if (isWaf) {
      finalStatus = 'WAF_PROTECTED';
      phases.push({
        phase: 'reachability',
        label: 'Phase 2: HTTP/TLS',
        status: 'warn',
        detail: `HTTP ${response.status} WAF/Bot-Schutz (${headerObj.server || 'CDN'}) — Host aktiv, Browser/API-Key erforderlich (${latencyMs}ms).`,
        durationMs: latencyMs,
      });
    } else {
      finalStatus = 'HTTP_ERROR';
      phases.push({
        phase: 'reachability',
        label: 'Phase 2: HTTP/TLS',
        status: 'fail',
        detail: `${usedMethod} meldet HTTP ${response.status} (${latencyMs}ms).`,
        durationMs: latencyMs,
      });
    }

    // Phase 3: Protocol / API Probe (also runs when an OpenAI /v1 root returns 404/405, e.g. OVHcloud AI Endpoints)
    const snippets = buildConnectionSnippets(p);
    const isOpenAiApiBase404 =
      (response.status === 404 || response.status === 405) &&
      snippets.supportsOpenAiEndpoints &&
      !/github\.com/i.test(finalUrl);

    if (p.securityClass === 'GELB') {
      phases.push({
        phase: 'protocol',
        label: 'Phase 3: API-Probe',
        status: 'skip',
        detail: 'Übersprungen gemäß Ziel 2.3 (GELB: nur Reachability-Check, kein automatischer API-Call).',
      });
    } else if (
      (ok || isWaf || isAuth401 || isOpenAiApiBase404) &&
      snippets.supportsOpenAiEndpoints &&
      !/github\.com/i.test(finalUrl)
    ) {
      if (p.auth_typ === 'keine' || hasKeyConfigured || isOpenAiApiBase404) {
        const cleanBase = snippets.defaultApiBase.replace(/\/+$/, '');
        const probeUrls = [
          `${cleanBase}/models`,
          ...(cleanBase.endsWith('/openai') ? [`${cleanBase.replace(/\/openai$/, '')}/models`] : []),
        ];
        const p3Start = Date.now();
        let p3Done = false;
        try {
          const probeHeaders: Record<string, string> = { Accept: 'application/json' };
          if (hasKeyConfigured) {
            probeHeaders['Authorization'] = `Bearer ${activeKey}`;
          }
          let lastProbeStatus = 0;
          for (const probeUrl of probeUrls) {
            const probeRes = await fetchWithTimeout(
              probeUrl,
              { method: 'GET', headers: probeHeaders },
              6000
            );
            lastProbeStatus = probeRes.status;
            const p3Ms = Date.now() - p3Start;
            if (probeRes.ok) {
              const text = await probeRes.text();
              let modelCount: number | null = null;
              try {
                const parsedJson = JSON.parse(text) as unknown;
                const cat = categorizeModelIds(parsedJson);
                if (cat.allModels.length > 0) modelCount = cat.chatModels.length || cat.allModels.length;
              } catch {
                // non-JSON
              }
              apiProbeSummary =
                modelCount !== null
                  ? `GET /models → HTTP ${probeRes.status} (${modelCount} Chat-Modelle, ${p3Ms}ms)`
                  : `GET /models → HTTP ${probeRes.status} (${p3Ms}ms)`;
              finalStatus = 'OK_API_PROBE';
              httpCode = String(probeRes.status);
              phases.push({
                phase: 'protocol',
                label: 'Phase 3: API-Probe',
                status: 'pass',
                detail: apiProbeSummary,
                durationMs: p3Ms,
              });
              p3Done = true;
              break;
            }
          }
          if (!p3Done) {
            const p3Ms = Date.now() - p3Start;
            apiProbeSummary = `GET /models → HTTP ${lastProbeStatus} (${p3Ms}ms)`;
            if (lastProbeStatus === 401) {
              finalStatus = 'AUTH_REQUIRED';
              httpCode = '401';
            }
            phases.push({
              phase: 'protocol',
              label: 'Phase 3: API-Probe',
              status: lastProbeStatus === 401 || lastProbeStatus === 403 ? 'warn' : 'skip',
              detail: `${apiProbeSummary} (Endpunkt existiert, Auth/Pfad ggf. spezifisch).`,
              durationMs: p3Ms,
            });
          }
        } catch {
          phases.push({
            phase: 'protocol',
            label: 'Phase 3: API-Probe',
            status: 'skip',
            detail: `Standard-Pfad ${probeUrls[0]} nicht direkt abrufbar (Basis-Portal jedoch aktiv).`,
          });
        }
      } else {
        phases.push({
          phase: 'protocol',
          label: 'Phase 3: API-Probe',
          status: 'skip',
          detail: `Kein ${envVar || 'API-Key'} gesetzt — Phase 1+2 bestanden; Phase 3 über „Nutzen“ mit eigenem Key testbar.`,
        });
      }
    } else {
      phases.push({
        phase: 'protocol',
        label: 'Phase 3: API-Probe',
        status: 'skip',
        detail: 'Kein offener REST-/v1-Endpunkt (GitHub-Repo, Browser-Portal oder SDK).',
      });
    }
  } catch (err: unknown) {
    latencyMs = Date.now() - startMs;
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
    const msg = err instanceof Error ? err.message : 'Netzwerkfehler';
    finalStatus = isAbort ? 'TIMEOUT' : 'NETWORK_ERROR';
    phases.push({
      phase: 'reachability',
      label: 'Phase 2: HTTP/TLS',
      status: 'fail',
      detail: isAbort ? `Timeout nach 8 s (${latencyMs}ms)` : `Verbindungs-/TLS-Fehler: ${msg.slice(0, 120)}`,
      durationMs: latencyMs,
    });
    phases.push({
      phase: 'protocol',
      label: 'Phase 3: API-Probe',
      status: 'skip',
      detail: 'Übersprungen wegen Phase-2-Fehler.',
    });
  }

  // Phase 4: Score & Routing Tier
  const { healthScore, readinessTier, phase4 } = computePhase4Evaluation(
    p,
    phases,
    latencyMs,
    httpCode,
    hasKeyConfigured
  );
  phases.push(phase4);

  const summaryParts = [
    `P1:${phases[0]?.status?.toUpperCase() ?? 'SKIP'}`,
    `P2:${phases[1]?.status?.toUpperCase() ?? 'SKIP'} (${httpCode}, ${latencyMs}ms)`,
    `P3:${phases[2]?.status?.toUpperCase() ?? 'SKIP'}`,
    `Score:${healthScore}/100`,
  ];
  if (apiProbeSummary) summaryParts.push(apiProbeSummary);
  else if (redirected) summaryParts.push(`Redirect → ${finalUrl}`);

  return {
    ...base,
    status: finalStatus,
    http_code: httpCode,
    note: summaryParts.join(' · '),
    redirectTarget: redirected ? finalUrl : undefined,
    latencyMs,
    apiProbeSummary,
    phases,
    healthScore,
    readinessTier,
  };
}

async function runBatchAsync(targets: ClassifiedProvider[], mode: string, token: number) {
  state.batchState = {
    running: true,
    mode,
    total: targets.length,
    completed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  let cursor = 0;
  const concurrency = 8;

  async function worker() {
    while (cursor < targets.length) {
      if (state.activeBatchToken !== token) return;
      const idx = cursor++;
      const provider = targets[idx];
      const row = await executeMultiPhaseTest(provider);
      if (state.activeBatchToken !== token) return;
      state.testResults.set(provider.id, row);
      state.batchState = {
        ...state.batchState,
        completed: state.batchState.completed + 1,
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(targets.length, 1)) }, () => worker())
  );

  if (state.activeBatchToken === token) {
    state.batchState = {
      ...state.batchState,
      running: false,
      finishedAt: new Date().toISOString(),
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  app.get('/api/workspace', (_req, res) => {
    res.json(buildWorkspacePayload());
  });

  app.post('/api/upload', (req, res) => {
    const { filename, content } = req.body as { filename?: string; content?: string };
    if (!content || typeof content !== 'string' || content.trim().length < 20) {
      res.status(400).json({ error: 'Ungültiger oder leerer Dateiinhalt.' });
      return;
    }
    const nextState = loadDatasetIntoState(
      content,
      typeof filename === 'string' && filename.trim() ? filename.trim() : 'hochgeladen.txt'
    );
    if (nextState.providers.length === 0) {
      res.status(400).json({
        error:
          'Keine gültigen Provider-Blöcke (Format `## <Name>` mit `- **id:** ...`) erkannt.',
      });
      return;
    }
    state.activeBatchToken++;
    bridgeManager.stopAll();
    state = nextState;
    bridgeManager.initFromSelections(state.bridgeSelections);
    void refreshLocalBridgeRepos().then(() => {
      res.json(buildWorkspacePayload());
    });
  });

  app.post('/api/test/run', async (req, res) => {
    const { mode, providerId, byokApiKey } = req.body as {
      mode?:
        | 'single'
        | 'sample_green'
        | 'all_green_gelb'
        | 'all_green'
        | 'all_gelb'
        | 'retry_failed';
      providerId?: string;
      byokApiKey?: string;
    };

    if (mode === 'single') {
      const target = state.providers.find((p) => p.id === providerId);
      if (!target) {
        res.status(404).json({ error: `Provider "${providerId}" nicht gefunden.` });
        return;
      }
      // Note: byokApiKey is used strictly in-memory for this single request and NEVER logged/saved (Rule 2)
      const row = await executeMultiPhaseTest(target, {
        byokApiKey: typeof byokApiKey === 'string' ? byokApiKey : undefined,
      });
      state.testResults.set(target.id, row);
      const payload = buildWorkspacePayload();
      res.json({
        result: row,
        testAnalytics: payload.testAnalytics,
        summary: payload.summary,
        artifacts: payload.artifacts,
        batchState: payload.batchState,
      });
      return;
    }

    if (state.batchState.running) {
      res.status(409).json({
        error: 'Ein Batch-Testlauf ist bereits aktiv.',
        batchState: state.batchState,
      });
      return;
    }

    let targets: ClassifiedProvider[] = [];
    if (mode === 'sample_green') {
      targets = state.providers
        .filter((p) => isUsableGreenOrGelb(p) && p.securityClass === 'GRUEN' && /^https?:\/\//i.test(p.url))
        .slice(0, 12);
    } else if (mode === 'all_green_gelb') {
      targets = state.providers.filter((p) => isUsableGreenOrGelb(p));
    } else if (mode === 'all_green') {
      targets = state.providers.filter(
        (p) => isUsableGreenOrGelb(p) && p.securityClass === 'GRUEN'
      );
    } else if (mode === 'all_gelb') {
      targets = state.providers.filter(
        (p) => isUsableGreenOrGelb(p) && p.securityClass === 'GELB'
      );
    } else if (mode === 'retry_failed') {
      targets = state.providers.filter((p) => {
        if (!isUsableGreenOrGelb(p)) return false;
        const r = state.testResults.get(p.id);
        return (
          r?.status === 'HTTP_ERROR' ||
          r?.status === 'TIMEOUT' ||
          r?.status === 'NETWORK_ERROR'
        );
      });
    } else {
      res.status(400).json({ error: 'Unbekannter Testmodus.' });
      return;
    }

    const token = ++state.activeBatchToken;
    void runBatchAsync(targets, mode, token);
    res.json({
      started: true,
      batchState: {
        running: true,
        mode,
        total: targets.length,
        completed: 0,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
    });
  });

  app.post('/api/test/stop', (_req, res) => {
    state.activeBatchToken++;
    state.batchState = {
      ...state.batchState,
      running: false,
      finishedAt: new Date().toISOString(),
    };
    const payload = buildWorkspacePayload();
    res.json({
      batchState: payload.batchState,
      testResults: payload.testResults,
      testAnalytics: payload.testAnalytics,
      summary: payload.summary,
      artifacts: payload.artifacts,
    });
  });

  app.post('/api/test/reset', (_req, res) => {
    state.activeBatchToken++;
    const resetRows = buildInitialTestResults(state.providers, process.env);
    state.testResults = new Map(resetRows.map((r) => [r.id, r]));
    state.batchState = {
      running: false,
      mode: null,
      total: 0,
      completed: 0,
      startedAt: null,
      finishedAt: null,
    };
    res.json(buildWorkspacePayload());
  });

  app.get('/api/test/status', (_req, res) => {
    const payload = buildWorkspacePayload();
    res.json({
      batchState: payload.batchState,
      testResults: payload.testResults,
      testAnalytics: payload.testAnalytics,
      summary: payload.summary,
      artifacts: payload.artifacts,
    });
  });

  // Smart utilization of test results: Toggle provider in litellm_config.yaml or apply top tested GRÜN
  app.post('/api/router/toggle', (req, res) => {
    const { providerId } = req.body as { providerId?: string };
    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider || !isUsableGreenOrGelb(provider)) {
      res.status(400).json({
        error:
          'Nur GRÜNE und GELBE Verbindungen dürfen in den Router aufgenommen werden (Regel 1/3).',
      });
      return;
    }
    if (state.activeRouterProviderIds.has(provider.id)) {
      state.activeRouterProviderIds.delete(provider.id);
    } else {
      state.activeRouterProviderIds.add(provider.id);
    }
    const payload = buildWorkspacePayload();
    res.json({
      activeRouterProviderIds: payload.activeRouterProviderIds,
      artifacts: payload.artifacts,
      summary: payload.summary,
    });
  });

  app.post('/api/router/apply-tested', (_req, res) => {
    const current = buildWorkspacePayload();
    for (const id of current.testAnalytics.topRankedGreenIds) {
      state.activeRouterProviderIds.add(id);
    }
    const updated = buildWorkspacePayload();
    res.json({
      addedCount: current.testAnalytics.topRankedGreenIds.length,
      activeRouterProviderIds: updated.activeRouterProviderIds,
      artifacts: updated.artifacts,
      summary: updated.summary,
    });
  });

  // SSRF-safe live connection invoker for ANY GRÜN / GELB connection (BYOK in-memory only!)
  app.post('/api/connections/invoke', async (req, res) => {
    const { providerId, endpointUrl, action, apiKey, model, prompt } = req.body as {
      providerId?: string;
      endpointUrl?: string;
      action?: 'models' | 'chat';
      apiKey?: string;
      model?: string;
      prompt?: string;
    };

    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider) {
      res.status(404).json({ error: `Provider "${providerId}" nicht gefunden.` });
      return;
    }

    const baseClean = (endpointUrl || buildConnectionSnippets(provider).defaultApiBase)
      .trim()
      .replace(/\/+$/, '');
    const targetUrlStr =
      action === 'chat' ? `${baseClean}/chat/completions` : `${baseClean}/models`;

    const validation = validateInvokeTarget(provider, targetUrlStr);
    if (!validation.ok) {
      res.status(403).json({ error: validation.error });
      return;
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const envVar = provider.expectedEnvVar || '';
    const effectiveKey =
      (typeof apiKey === 'string' && apiKey.trim()) ||
      (envVar ? process.env[envVar]?.trim() : '') ||
      '';
    if (effectiveKey) {
      headers['Authorization'] = `Bearer ${effectiveKey}`;
    }

    const start = Date.now();
    try {
      const fetchOpts: RequestInit =
        action === 'chat'
          ? {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: (model && model.trim()) || 'default',
                messages: [
                  {
                    role: 'user',
                    content:
                      (prompt && prompt.trim()) ||
                      'Antworte mit genau einem Wort: OK',
                  },
                ],
                max_tokens: 128,
              }),
            }
          : { method: 'GET', headers };

      const response = await fetchWithTimeout(validation.url.toString(), fetchOpts, 15000);
      const latencyMs = Date.now() - start;
      const rawText = (await response.text()).slice(0, 12000);
      let parsedBody: unknown = null;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        // plain text or HTML
      }

      res.json({
        ok: response.ok,
        httpStatus: response.status,
        latencyMs,
        targetUrl: validation.url.toString(),
        parsedBody,
        rawPreview: parsedBody ? undefined : rawText.slice(0, 1200),
      });
    } catch (err: unknown) {
      res.status(502).json({
        ok: false,
        latencyMs: Date.now() - start,
        targetUrl: validation.url.toString(),
        error:
          err instanceof Error
            ? err.message.slice(0, 180)
            : 'Verbindungsaufbau fehlgeschlagen.',
      });
    }
  });

  // Dedicated Chat Window: fetch available models from Bridge, GRÜN/GELB Provider, LiteLLM, or Local Loopback
  app.post('/api/chat/models', async (req, res) => {
    const { targetType, bridgeId, providerId, endpointUrl, apiKey, allowManualOverride } = req.body as {
      targetType?: ChatTargetType;
      bridgeId?: string;
      providerId?: string;
      endpointUrl?: string;
      apiKey?: string;
      allowManualOverride?: boolean;
    };

    const resolved = validateChatTarget({
      targetType: targetType || 'provider',
      bridgeId,
      providerId,
      endpointUrl,
      providers: state.providers,
      bridgeSelections: state.bridgeSelections,
      allowManualOverride: allowManualOverride === true,
    });
    if (!resolved.ok) {
      res.status(403).json({ ok: false, error: resolved.error, models: [] });
      return;
    }

    const targetUrl = `${resolved.baseUrl}/models`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const effectiveKey =
      (typeof apiKey === 'string' && apiKey.trim()) ||
      (resolved.envVarHint ? process.env[resolved.envVarHint]?.trim() : '') ||
      '';
    if (effectiveKey) {
      headers['Authorization'] = `Bearer ${effectiveKey}`;
    }

    const start = Date.now();
    try {
      let effectiveTargetUrl = targetUrl;
      let response = await fetchWithTimeout(effectiveTargetUrl, { method: 'GET', headers }, 10000);
      // Fallback for APIs like Pollinations (`https://text.pollinations.ai/openai` -> `/models` at root)
      if (!response.ok && resolved.baseUrl.endsWith('/openai')) {
        const altUrl = `${resolved.baseUrl.replace(/\/openai$/, '')}/models`;
        const altRes = await fetchWithTimeout(altUrl, { method: 'GET', headers }, 10000);
        if (altRes.ok) {
          response = altRes;
          effectiveTargetUrl = altUrl;
        }
      }
      const latencyMs = Date.now() - start;
      const rawText = (await response.text()).slice(0, 200000);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // non-JSON
      }
      const categorized = categorizeModelIds(parsed);
      res.json({
        ok: response.ok,
        httpStatus: response.status,
        latencyMs,
        targetUrl: effectiveTargetUrl,
        models: categorized.chatModels.length > 0 ? categorized.chatModels : categorized.allModels,
        chatModels: categorized.chatModels,
        nonChatModels: categorized.nonChatModels,
        error: response.ok
          ? undefined
          : `HTTP ${response.status} beim Laden von /models (${resolved.label}).`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.';
      res.json({
        ok: false,
        httpStatus: 502,
        latencyMs: Date.now() - start,
        targetUrl,
        models: [],
        error:
          resolved.targetType === 'bridge' || resolved.targetType === 'litellm' || resolved.targetType === 'custom_local'
            ? `Lokaler Endpunkt ${targetUrl} nicht erreichbar (${msg.slice(0, 140)}). Läuft die Bridge / der lokale Server?`
            : msg.slice(0, 180),
      });
    }
  });

  // Dedicated Chat Window: multi-turn chat proxy (API key strictly RAM-only, never logged/persisted)
  app.post('/api/chat/send', async (req, res) => {
    const {
      targetType,
      bridgeId,
      providerId,
      endpointUrl,
      allowManualOverride,
      apiKey,
      model,
      messages,
      systemPrompt,
      images,
      includeSources,
      temperature,
      maxTokens,
    } = req.body as {
      targetType?: ChatTargetType;
      bridgeId?: string;
      providerId?: string;
      endpointUrl?: string;
      allowManualOverride?: boolean;
      apiKey?: string;
      model?: string;
      messages?: unknown;
      systemPrompt?: string;
      images?: unknown;
      includeSources?: boolean;
      temperature?: number;
      maxTokens?: number;
    };

    const resolved = validateChatTarget({
      targetType: targetType || 'provider',
      bridgeId,
      providerId,
      endpointUrl,
      allowManualOverride: allowManualOverride === true,
      providers: state.providers,
      bridgeSelections: state.bridgeSelections,
    });
    if (!resolved.ok) {
      res.status(403).json({ ok: false, error: resolved.error });
      return;
    }

    const sanitizedMessages = sanitizeChatMessages(messages, systemPrompt, images);
    if (sanitizedMessages.length === 0 || !sanitizedMessages.some((m) => m.role === 'user')) {
      res.status(400).json({ ok: false, error: 'Bitte mindestens eine Benutzer-Nachricht senden.' });
      return;
    }

    const targetUrl = `${resolved.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const effectiveKey =
      (typeof apiKey === 'string' && apiKey.trim()) ||
      (resolved.envVarHint ? process.env[resolved.envVarHint]?.trim() : '') ||
      '';
    if (effectiveKey) {
      headers['Authorization'] = `Bearer ${effectiveKey}`;
    }

    const payloadBody: Record<string, unknown> = {
      model: (typeof model === 'string' && model.trim()) || 'default',
      messages: sanitizedMessages,
      stream: false,
    };
    if (includeSources === true) {
      payloadBody.include_sources = true;
    }
    if (typeof temperature === 'number' && Number.isFinite(temperature)) {
      payloadBody.temperature = Math.max(0, Math.min(2, temperature));
    }
    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
      payloadBody.max_tokens = Math.min(8192, Math.floor(maxTokens));
    }

    const start = Date.now();
    try {
      const response = await fetchWithTimeout(
        targetUrl,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payloadBody),
        },
        90000
      );
      const latencyMs = Date.now() - start;
      const rawText = (await response.text()).slice(0, 180000);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // SSE or plain text
      }

      const extracted = extractChatCompletionReply(parsed, rawText);
      if (response.ok && extracted.reply !== null) {
        res.json({
          ok: true,
          httpStatus: response.status,
          latencyMs,
          targetUrl,
          reply: extracted.reply,
          model: extracted.model || payloadBody.model,
          usage: extracted.usage,
        });
        return;
      }

      const errHint =
        extracted.errorMessage ||
        (response.status === 401 || response.status === 403
          ? `HTTP ${response.status}: Authentifizierung fehlgeschlagen — bitte gültigen Session-API-Key / Bridge-Token eintragen.`
          : response.status === 404
            ? `HTTP 404: Endpunkt ${targetUrl} oder Modell "${payloadBody.model}" nicht gefunden.`
            : `HTTP ${response.status} von ${resolved.label}.`);

      res.json({
        ok: false,
        httpStatus: response.status,
        latencyMs,
        targetUrl,
        error: errHint,
        rawPreview: rawText.slice(0, 800),
      });
    } catch (err: unknown) {
      const isAbort =
        err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
      const msg = err instanceof Error ? err.message : 'Netzwerkfehler.';
      res.json({
        ok: false,
        httpStatus: 502,
        latencyMs: Date.now() - start,
        targetUrl,
        error: isAbort
          ? 'Timeout nach 90 s — keine Antwort vom Zielendpunkt.'
          : resolved.targetType === 'bridge' || resolved.targetType === 'litellm' || resolved.targetType === 'custom_local'
            ? `Lokaler Endpunkt ${targetUrl} nicht erreichbar (${msg.slice(0, 140)}). Starte zuerst die Bridge bzw. den lokalen Dienst.`
            : `Verbindungsfehler zu ${targetUrl}: ${msg.slice(0, 160)}`,
      });
    }
  });

  // =========================================================================
  // Local Projects / Notebooks, Knowledge Base & Chrono-Jobs (strictly local)
  // =========================================================================
  let notebooksWorkspace: NotebooksWorkspace = loadNotebooksFromDisk();
  const runningChronoJobs = new Set<string>();

  async function executeChronoJob(
    projectId: string,
    jobId: string,
    ramOnlyApiKey?: string
  ): Promise<{ ok: boolean; error?: string; job?: NotebookChronoJob }> {
    const project = notebooksWorkspace.projects.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'Projekt nicht gefunden.' };
    const job = project.chronoJobs.find((j) => j.id === jobId);
    if (!job) return { ok: false, error: 'Chrono-Job nicht gefunden.' };
    if (runningChronoJobs.has(job.id)) {
      return { ok: false, error: 'Chrono-Job läuft bereits.' };
    }

    const resolved = validateChatTarget({
      targetType: job.targetType,
      bridgeId: job.bridgeId,
      providerId: job.providerId,
      endpointUrl: job.endpointUrl,
      providers: state.providers,
      bridgeSelections: state.bridgeSelections,
    });
    if (!resolved.ok) {
      job.lastStatus = 'error';
      job.lastError = resolved.error;
      job.lastRunAt = new Date().toISOString();
      job.nextRunAt = computeNextRunAt(job, new Date());
      saveNotebooksToDisk(notebooksWorkspace);
      return { ok: false, error: resolved.error, job };
    }

    runningChronoJobs.add(job.id);
    job.lastStatus = 'running';
    job.lastError = null;
    const nowIso = new Date().toISOString();
    const tsLabel = new Date().toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    try {
      // Find or create the dedicated Chrono-Job output chat inside the project
      let targetChat = project.chats.find((c) => c.id === job.targetChatId);
      if (!targetChat) {
        targetChat = {
          id: createId('chat-chrono'),
          title: `Chrono: ${job.name}`,
          pinned: false,
          targetType: job.targetType,
          bridgeId: job.bridgeId,
          providerId: job.providerId,
          endpointUrl: resolved.baseUrl,
          modelId: job.modelId || 'default',
          messages: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        project.chats.unshift(targetChat);
        job.targetChatId = targetChat.id;
      }

      const rag = retrieveProjectContext({
        project,
        activeChatId: targetChat.id,
        query: job.prompt,
      });

      const messagesPayload = sanitizeChatMessages(
        [{ role: 'user', content: job.prompt }],
        rag.compiledSystemBlock || undefined
      );

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      const effectiveKey =
        (typeof ramOnlyApiKey === 'string' && ramOnlyApiKey.trim()) ||
        (resolved.envVarHint ? process.env[resolved.envVarHint]?.trim() : '') ||
        '';
      if (effectiveKey) {
        headers['Authorization'] = `Bearer ${effectiveKey}`;
      }

      const payloadBody: Record<string, unknown> = {
        model: (job.modelId && job.modelId.trim()) || 'default',
        messages: messagesPayload,
        stream: false,
      };
      if (job.includeSources) {
        payloadBody.include_sources = true;
      }

      const targetUrl = `${resolved.baseUrl}/chat/completions`;
      const start = Date.now();
      const response = await fetchWithTimeout(
        targetUrl,
        { method: 'POST', headers, body: JSON.stringify(payloadBody) },
        90000
      );
      const latencyMs = Date.now() - start;
      const rawText = (await response.text()).slice(0, 180000);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // non-JSON
      }
      const extracted = extractChatCompletionReply(parsed, rawText);

      targetChat.messages.push({
        id: createId('u'),
        role: 'user',
        content: `[Chrono-Job: ${job.name}]\n${job.prompt}`,
        createdAt: tsLabel,
      });

      if (response.ok && extracted.reply !== null) {
        targetChat.messages.push({
          id: createId('a'),
          role: 'assistant',
          content: extracted.reply,
          createdAt: tsLabel,
          model: extracted.model || String(payloadBody.model),
          latencyMs,
          httpStatus: response.status,
          targetUrl,
          contextSources: rag.citations.length > 0 ? rag.citations : undefined,
          usage: extracted.usage,
        });
        targetChat.updatedAt = new Date().toISOString();

        if (job.saveToKnowledge) {
          const docTitle = `Chrono: ${job.name} (${new Date().toLocaleDateString('de-DE')} ${tsLabel.slice(0, 5)})`;
          project.knowledgeDocs.unshift({
            id: createId('doc'),
            title: docTitle,
            sourceType: 'snippet',
            tags: ['chrono', job.name.toLowerCase().slice(0, 24)],
            content: extracted.reply,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }

        job.lastStatus = 'ok';
        job.lastError = null;
        job.lastSummary = extracted.reply.replace(/\s+/g, ' ').slice(0, 220);
        job.lastRunAt = new Date().toISOString();
        job.runCount = (job.runCount || 0) + 1;
        if (job.scheduleType === 'once') {
          job.enabled = false;
          job.nextRunAt = null;
        } else {
          job.nextRunAt = computeNextRunAt(job, new Date());
        }
        project.updatedAt = new Date().toISOString();
        saveNotebooksToDisk(notebooksWorkspace);
        return { ok: true, job };
      }

      const errMsg =
        extracted.errorMessage || `HTTP ${response.status} von ${resolved.label}`;
      targetChat.messages.push({
        id: createId('e'),
        role: 'error',
        content: `Chrono-Job Fehler: ${errMsg}`,
        createdAt: tsLabel,
        latencyMs,
        httpStatus: response.status,
        targetUrl,
      });
      targetChat.updatedAt = new Date().toISOString();

      job.lastStatus = 'error';
      job.lastError = errMsg.slice(0, 300);
      job.lastRunAt = new Date().toISOString();
      job.nextRunAt = computeNextRunAt(job, new Date());
      saveNotebooksToDisk(notebooksWorkspace);
      return { ok: false, error: errMsg, job };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.slice(0, 260) : 'Verbindungsfehler';
      job.lastStatus = 'error';
      job.lastError = `Ziel nicht erreichbar (${msg}). Läuft die Bridge / der Dienst?`;
      job.lastRunAt = new Date().toISOString();
      job.nextRunAt = computeNextRunAt(job, new Date());
      saveNotebooksToDisk(notebooksWorkspace);
      return { ok: false, error: job.lastError, job };
    } finally {
      runningChronoJobs.delete(job.id);
    }
  }

  app.get('/api/notebooks', (_req, res) => {
    res.json({ ok: true, workspace: notebooksWorkspace });
  });

  app.put('/api/notebooks', (req, res) => {
    const body = (req.body as { workspace?: unknown })?.workspace ?? req.body;
    const validated = validateWorkspacePayload(body);
    if (!validated.ok) {
      res.status(400).json({ ok: false, error: validated.error });
      return;
    }
    notebooksWorkspace = validated.workspace;
    try {
      saveNotebooksToDisk(notebooksWorkspace);
      res.json({ ok: true, workspace: notebooksWorkspace });
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Konnte Notebooks nicht lokal speichern.',
      });
    }
  });

  app.post('/api/notebooks/chrono/run', async (req, res) => {
    const { projectId, jobId, apiKey } = req.body as {
      projectId?: string;
      jobId?: string;
      apiKey?: string;
    };
    if (!projectId || !jobId) {
      res.status(400).json({ ok: false, error: 'projectId und jobId erforderlich.' });
      return;
    }
    const result = await executeChronoJob(projectId, jobId, apiKey);
    res.json({
      ok: result.ok,
      error: result.error,
      job: result.job,
      workspace: notebooksWorkspace,
    });
  });

  // Live bridge /healthz & capability probe (strictly allowlisted 127.0.0.1:<port>)
  app.get('/api/bridges/:bridgeId/healthz', async (req, res) => {
    const bridgeId = String(req.params.bridgeId || '');
    const sel = state.bridgeSelections.find(
      (b) => b.bridge_id === bridgeId && b.docker_capable && typeof b.port === 'number'
    );
    if (!sel || !sel.port) {
      res.status(404).json({ ok: false, error: 'Bridge nicht auf der lokalen Allowlist.' });
      return;
    }
    const healthUrl = `http://127.0.0.1:${sel.port}/healthz`;
    const modelsUrl = `http://127.0.0.1:${sel.port}/v1/models`;
    let healthz: Record<string, unknown> | null = null;
    let models: string[] = [];
    let reachable = false;
    try {
      const hRes = await fetchWithTimeout(healthUrl, { method: 'GET' }, 4000);
      if (hRes.ok) {
        reachable = true;
        const txt = await hRes.text();
        try {
          healthz = JSON.parse(txt) as Record<string, unknown>;
        } catch {
          healthz = { ok: true, raw: txt.slice(0, 300) };
        }
      }
    } catch {
      // bridge may not expose /healthz or may be stopped
    }
    try {
      const mRes = await fetchWithTimeout(modelsUrl, { method: 'GET' }, 4000);
      if (mRes.ok) {
        reachable = true;
        const txt = await mRes.text();
        try {
          models = extractModelIds(JSON.parse(txt));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    res.json({
      ok: reachable,
      bridgeId,
      port: sel.port,
      healthz,
      models,
    });
  });

  // Background Chrono-Job ticker (every 30s). Never auto-starts stopped ROT bridges!
  const chronoInterval = setInterval(() => {
    const now = new Date();
    for (const project of notebooksWorkspace.projects) {
      for (const job of project.chronoJobs) {
        if (isJobDue(job, now)) {
          void executeChronoJob(project.id, job.id);
        }
      }
    }
  }, 30_000);
  chronoInterval.unref?.();

  app.get('/api/bridges/repos', async (_req, res) => {
    if (!state.cloneBatchRunning) {
      await refreshLocalBridgeRepos();
    }
    const payload = buildWorkspacePayload();
    res.json({
      bridgeRepos: payload.bridgeRepos,
      cloneBatchRunning: payload.cloneBatchRunning,
    });
  });

  app.post('/api/bridges/clone', async (req, res) => {
    const { mode, bridgeId } = req.body as {
      mode?: 'all' | 'single';
      bridgeId?: string;
    };
    const allowlisted = getAllowlistedBridgeRepos(state.bridgeSelections);

    if (mode === 'single') {
      const target = allowlisted.find((r) => r.bridgeId === bridgeId);
      if (!target) {
        res.status(404).json({
          error: `Bridge-Repository "${bridgeId}" ist nicht auf der Allowlist (Regel 1/3).`,
        });
        return;
      }
      const prev = state.bridgeRepos.get(target.bridgeId);
      if (prev) {
        state.bridgeRepos.set(target.bridgeId, { ...prev, status: 'cloning', error: null });
      }
      const updated = await cloneOrUpdateBridgeRepo(target, BRIDGES_ROOT_DIR);
      state.bridgeRepos.set(target.bridgeId, updated);
      const payload = buildWorkspacePayload();
      res.json({
        repo: updated,
        bridgeRepos: payload.bridgeRepos,
        cloneBatchRunning: payload.cloneBatchRunning,
      });
      return;
    }

    if (state.cloneBatchRunning) {
      res.status(409).json({
        error: 'Klonvorgang läuft bereits im Hintergrund.',
        bridgeRepos: buildWorkspacePayload().bridgeRepos,
        cloneBatchRunning: true,
      });
      return;
    }

    state.cloneBatchRunning = true;
    for (const r of allowlisted) {
      const cur = state.bridgeRepos.get(r.bridgeId);
      if (cur) {
        state.bridgeRepos.set(r.bridgeId, { ...cur, status: 'cloning', error: null });
      }
    }

    void (async () => {
      try {
        let cursor = 0;
        const worker = async () => {
          while (cursor < allowlisted.length) {
            const idx = cursor++;
            const repo = allowlisted[idx];
            const result = await cloneOrUpdateBridgeRepo(repo, BRIDGES_ROOT_DIR);
            state.bridgeRepos.set(repo.bridgeId, result);
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      } finally {
        state.cloneBatchRunning = false;
      }
    })();

    res.json({
      started: true,
      bridgeRepos: buildWorkspacePayload().bridgeRepos,
      cloneBatchRunning: true,
    });
  });

  app.get('/api/bridges/repos/:bridgeId/file', (req, res) => {
    const bridgeId = req.params.bridgeId;
    const fileName = typeof req.query.name === 'string' ? req.query.name : '';
    const allowlisted = getAllowlistedBridgeRepos(state.bridgeSelections);
    try {
      const fileData = readClonedRepoFile(bridgeId, fileName, allowlisted, BRIDGES_ROOT_DIR);
      res.json(fileData);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden.',
      });
    }
  });

  app.get('/api/bridges/runtime', (_req, res) => {
    res.json({
      bridgeRuntimes: bridgeManager.getAllStates(),
    });
  });

  app.post('/api/bridges/execute', async (req, res) => {
    const { bridgeId, confirmTosRisk } = req.body as {
      bridgeId?: string;
      confirmTosRisk?: boolean;
    };
    if (!confirmTosRisk) {
      res.status(400).json({
        error:
          'Bitte zuerst das ToS-Restrisiko (Klasse ROT, Regel 5) explizit bestaetigen, bevor die Bridge gestartet wird.',
      });
      return;
    }
    const selection = state.bridgeSelections.find(
      (s) => s.bridge_id === bridgeId && s.docker_capable && s.port
    );
    const allowlisted = getAllowlistedBridgeRepos(state.bridgeSelections);
    const repo = allowlisted.find((r) => r.bridgeId === bridgeId);
    if (!selection || !repo) {
      res.status(404).json({
        error: `Bridge "${bridgeId}" ist nicht fuer lokale Ausfuehrung auf der Allowlist freigegeben (Regel 1/3).`,
      });
      return;
    }

    try {
      const runtime = await bridgeManager.executeBridge(
        selection,
        repo,
        BRIDGES_ROOT_DIR,
        __dirname,
        (updatedRepo) => {
          state.bridgeRepos.set(updatedRepo.bridgeId, updatedRepo);
        }
      );
      const payload = buildWorkspacePayload();
      res.json({
        runtime,
        bridgeRuntimes: payload.bridgeRuntimes,
        bridgeRepos: payload.bridgeRepos,
        manualCommands: buildBridgeManualCommands(selection),
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Bridge konnte nicht ausgefuehrt werden.',
        bridgeRuntimes: bridgeManager.getAllStates(),
      });
    }
  });

  app.post('/api/bridges/stop', async (req, res) => {
    const { bridgeId } = req.body as { bridgeId?: string };
    if (!bridgeId) {
      res.status(400).json({ error: 'bridgeId fehlt.' });
      return;
    }
    const runtime = await bridgeManager.stopBridge(bridgeId, __dirname);
    if (!runtime) {
      res.status(404).json({ error: `Bridge "${bridgeId}" nicht gefunden.` });
      return;
    }
    res.json({
      runtime,
      bridgeRuntimes: bridgeManager.getAllStates(),
    });
  });

  app.post('/api/bridges/probe', async (req, res) => {
    const { bridgeId } = req.body as { bridgeId?: string };
    if (!bridgeId) {
      res.status(400).json({ error: 'bridgeId fehlt.' });
      return;
    }
    const { runtime, probe } = await bridgeManager.probeBridge(bridgeId);
    if (!runtime) {
      res.status(404).json({ error: `Bridge "${bridgeId}" nicht gefunden.` });
      return;
    }
    res.json({
      runtime,
      probe,
      bridgeRuntimes: bridgeManager.getAllStates(),
    });
  });

  await refreshLocalBridgeRepos();

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number((process.env.PORT || '3000').trim()) || 3000;
  const HOST = (process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} auf ${HOST} ist bereits belegt. Bitte bestehendes Server-Fenster nutzen.`);
    } else {
      console.error(`Server-Bind-Fehler (${HOST}:${PORT}):`, err.message);
    }
    process.exit(1);
  });
  httpServer.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`AI-Provider-Suite Workbench server listening on http://${displayHost}:${PORT}`);
  });

  const cleanup = () => {
    bridgeManager.stopAll();
    process.exit(0);
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
}

startServer().catch((err) => {
  bridgeManager.stopAll();
  console.error('Server failed to start:', err);
  process.exit(1);
});
