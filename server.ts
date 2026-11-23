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
  compileMemorySystemBlock,
  createDefaultMemoryStore,
  upsertMemoryEntry,
  validateMemoryStorePayload,
  type CodingMemoryCategory,
  type CodingMemoryStore,
} from './src/lib/codingMemory.ts';
import {
  fetchAiHordeModels,
  runAiHordeChat,
  runHfSpaceChat,
  runOpenAiCompatibleCodingChat,
  validateCloudTunnelUrl,
  type UnifiedCodingReply,
} from './src/lib/codingProviders.ts';
import {
  runSafeSandboxCommand,
  SANDBOX_RUNNER_PRESETS,
  type SandboxRunnerPresetId,
} from './src/lib/codingSandboxRunner.ts';
import { formatSseFrame, type CodingStreamEvent } from './src/lib/codingStream.ts';
import {
  CODING_TOOL_DEFINITIONS,
  FREE_UNCENSORED_API_PRESETS,
  HF_SPACE_PRESETS,
  type CodingMainWay,
  type CodingToolId,
  type ThinkingMode,
} from './src/lib/codingTypes.ts';
import {
  readSafeWorkspaceFile,
  scanSafeWorkspaceTree,
  writeSafeCodingSandboxFile,
} from './src/lib/codingWorkspace.ts';
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

const CODING_MEMORY_FILE_PATH = path.resolve(NOTEBOOKS_DATA_DIR, 'coding-memory.json');

function loadCodingMemoryFromDisk(): CodingMemoryStore {
  try {
    if (fs.existsSync(CODING_MEMORY_FILE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CODING_MEMORY_FILE_PATH, 'utf8'));
      const validated = validateMemoryStorePayload(raw);
      if (validated.ok) return validated.store;
    }
  } catch (err) {
    console.warn('Could not load data/coding-memory.json, initializing fresh memory store:', err);
  }
  return createDefaultMemoryStore();
}

function saveCodingMemoryToDisk(store: CodingMemoryStore): void {
  fs.mkdirSync(NOTEBOOKS_DATA_DIR, { recursive: true });
  const tmpPath = path.resolve(NOTEBOOKS_DATA_DIR, `coding-memory.${process.pid}.tmp.json`);
  if (!tmpPath.startsWith(NOTEBOOKS_DATA_DIR + path.sep)) {
    throw new Error('Ungültiger Memory-Speicherpfad.');
  }
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, CODING_MEMORY_FILE_PATH);
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
      const rawText = (await response.text()).slice(0, 1500000);
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
          thinking: extracted.thinking,
          model: extracted.model || payloadBody.model,
          usage: extracted.usage,
        });
        return;
      }

      const looksLikeHtml = /^\s*<(?:!doctype|html)\b/i.test(rawText);
      const errHint =
        extracted.errorMessage ||
        (response.status === 401 || response.status === 403
          ? `HTTP ${response.status}: Authentifizierung fehlgeschlagen — bitte gültigen Session-API-Key / Bridge-Token eintragen.`
          : response.status === 429
            ? `HTTP 429: Rate-Limit oder API-Key erforderlich bei ${resolved.label}${!effectiveKey ? ' (aktuell ohne Key gesendet)' : ''}.`
            : response.ok && looksLikeHtml
              ? `HTML-Webseite statt OpenAI-JSON (HTTP ${response.status}) von ${resolved.label} (${targetUrl}). Die Basis-URL zeigt auf ein Web-Portal statt auf den API-Host — bitte offizielle API-Basis-URL prüfen.`
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
  let codingMemoryStore: CodingMemoryStore = loadCodingMemoryFromDisk();
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

  // =========================================================================
  // Coding-Studio Safe Local Workspace Explorer & Sandbox Routes
  // Strictly confined to workspace root (read) & coding-workspace/ (write).
  // =========================================================================
  app.get('/api/coding/workspace/tree', (req, res) => {
    const subDir = typeof req.query.dir === 'string' ? req.query.dir : '';
    const scanned = scanSafeWorkspaceTree(__dirname, subDir);
    if (!scanned.ok) {
      res.status(400).json({ ok: false, error: scanned.error });
      return;
    }
    res.json(scanned);
  });

  app.get('/api/coding/workspace/file', (req, res) => {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const result = readSafeWorkspaceFile(__dirname, relPath);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json(result);
  });

  app.put('/api/coding/workspace/file', (req, res) => {
    const { path: relPath, content } = req.body as { path?: string; content?: string };
    if (typeof relPath !== 'string' || typeof content !== 'string') {
      res.status(400).json({ ok: false, error: 'Dateipfad und Inhalt erforderlich.' });
      return;
    }
    const saved = writeSafeCodingSandboxFile(__dirname, relPath, content);
    if (!saved.ok) {
      res.status(400).json({ ok: false, error: saved.error });
      return;
    }
    res.json(saved);
  });

  // =========================================================================
  // Coding-Studio 4 Primary Connections + Unified Tool-Enabled Chat Endpoint
  // =========================================================================
  app.get('/api/coding/providers/horde/models', async (_req, res) => {
    const result = await fetchAiHordeModels();
    res.json(result);
  });

  app.get('/api/coding/providers/hf/status', async (_req, res) => {
    const spaces = await Promise.all(
      HF_SPACE_PRESETS.map(async (preset) => {
        try {
          const r = await fetchWithTimeout(
            `https://huggingface.co/api/spaces/${preset.id}`,
            { method: 'GET' },
            6000
          );
          if (!r.ok) {
            return { id: preset.id, stage: `HTTP_${r.status}`, hardware: preset.hardware };
          }
          const data = (await r.json()) as {
            runtime?: { stage?: string; hardware?: { current?: string } };
          };
          return {
            id: preset.id,
            stage: data.runtime?.stage || 'UNKNOWN',
            hardware: data.runtime?.hardware?.current || preset.hardware,
          };
        } catch {
          return { id: preset.id, stage: 'UNREACHABLE', hardware: preset.hardware };
        }
      })
    );
    res.json({ ok: true, spaces });
  });

  app.post('/api/coding/providers/free-api/models', async (req, res) => {
    const { presetId, apiKey } = req.body as { presetId?: string; apiKey?: string };
    const preset = FREE_UNCENSORED_API_PRESETS.find((p) => p.id === presetId);
    if (!preset) {
      res.status(400).json({ ok: false, models: [], error: 'Unbekanntes Free-API-Preset.' });
      return;
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (typeof apiKey === 'string' && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    try {
      let url = `${preset.baseUrl.replace(/\/+$/, '')}/models`;
      let response = await fetchWithTimeout(url, { method: 'GET', headers }, 9000);
      if (!response.ok && preset.baseUrl.endsWith('/openai')) {
        url = `${preset.baseUrl.replace(/\/openai$/, '')}/models`;
        response = await fetchWithTimeout(url, { method: 'GET', headers }, 9000);
      }
      const txt = (await response.text()).slice(0, 1_500_000);
      if (!response.ok) {
        res.json({
          ok: false,
          models: [...preset.models],
          error: `HTTP ${response.status} von ${preset.label} (Standard-Modelle bleiben nutzbar).`,
        });
        return;
      }
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(txt);
      } catch {
        // non-JSON
      }
      const cat = categorizeModelIds(parsed);
      const list = cat.chatModels.length > 0 ? cat.chatModels : cat.allModels;
      res.json({
        ok: true,
        models: list.length > 0 ? list : [...preset.models],
        targetUrl: url,
      });
    } catch (err: unknown) {
      res.json({
        ok: false,
        models: [...preset.models],
        error: err instanceof Error ? err.message.slice(0, 140) : 'Abruf fehlgeschlagen.',
      });
    }
  });

  app.post('/api/coding/providers/tunnel/models', async (req, res) => {
    const { tunnelUrl, apiKey } = req.body as { tunnelUrl?: string; apiKey?: string };
    const checked = validateCloudTunnelUrl(typeof tunnelUrl === 'string' ? tunnelUrl : '');
    if (!checked.ok) {
      res.status(400).json({ ok: false, models: [], error: checked.error });
      return;
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (typeof apiKey === 'string' && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    try {
      const oaiRes = await fetchWithTimeout(`${checked.baseUrl}/models`, { method: 'GET', headers }, 9000);
      if (oaiRes.ok) {
        const parsed = (await oaiRes.json()) as unknown;
        const models = extractModelIds(parsed);
        res.json({ ok: true, models, baseUrl: checked.baseUrl });
        return;
      }
      // Fallback for native Ollama `/api/tags`
      const tagsRes = await fetchWithTimeout(`${checked.rootOrigin}/api/tags`, { method: 'GET', headers }, 9000);
      if (tagsRes.ok) {
        const data = (await tagsRes.json()) as { models?: Array<{ name?: string }> };
        const models = Array.isArray(data.models)
          ? data.models.map((m) => m.name).filter((n): n is string => typeof n === 'string' && n.length > 0)
          : [];
        res.json({ ok: true, models, baseUrl: checked.baseUrl });
        return;
      }
      res.json({
        ok: false,
        models: [],
        baseUrl: checked.baseUrl,
        error: `Tunnel erreichbar, aber /v1/models meldete HTTP ${oaiRes.status}. Läuft Ollama/vLLM im Notebook?`,
      });
    } catch (err: unknown) {
      res.json({
        ok: false,
        models: [],
        baseUrl: checked.baseUrl,
        error: `Tunnel nicht erreichbar: ${err instanceof Error ? err.message.slice(0, 140) : 'Verbindungsfehler'}`,
      });
    }
  });

  interface CodingChatRequestBody {
    way?: CodingMainWay;
    warningAcknowledged?: boolean;
    activeProjectId?: string;
    enabledTools?: string[];
    usePersistentMemory?: boolean;
    messages?: unknown;
    systemPrompt?: string;
    images?: unknown;
    thinkingMode?: ThinkingMode;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    repetitionPenalty?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    seed?: number;
    hfSpaceId?: string;
    hfToken?: string;
    gpuDuration?: number;
    useDflash?: boolean;
    hordeModel?: string;
    hordeApiKey?: string;
    hordeMaxLength?: number;
    hordeMaxContextLength?: number;
    hordeRepPen?: number;
    hordeTrustedWorkers?: boolean;
    hordeSlowWorkers?: boolean;
    hordeAllowDowngrade?: boolean;
    hordeAutoContinue?: boolean;
    freeApiPresetId?: string;
    tunnelUrl?: string;
    numCtx?: number;
    model?: string;
    apiKey?: string;
    targetType?: ChatTargetType;
    bridgeId?: string;
    providerId?: string;
    endpointUrl?: string;
    allowManualOverride?: boolean;
  }

  async function executeUnifiedCodingChat(
    body: CodingChatRequestBody,
    streamOpts?: { onStream?: (ev: CodingStreamEvent) => void; signal?: AbortSignal }
  ): Promise<{ status: number; payload: UnifiedCodingReply }> {
    const way: CodingMainWay =
      body.way === 'hf_space' ||
      body.way === 'ai_horde' ||
      body.way === 'free_uncensored_api' ||
      body.way === 'cloud_tunnel' ||
      body.way === 'catalog_or_bridge'
        ? body.way
        : 'hf_space';

    if (way !== 'catalog_or_bridge' && body.warningAcknowledged !== true) {
      return {
        status: 400,
        payload: {
          ok: false,
          latencyMs: 0,
          error:
            'Bitte zuerst den Warnhinweis für diese Verbindung im Coding-Studio bestätigen (Checkbox aktivieren).',
        },
      };
    }

    const allowedToolIds = new Set<string>(CODING_TOOL_DEFINITIONS.map((t) => t.id));
    const enabledTools = new Set<CodingToolId>(
      Array.isArray(body.enabledTools)
        ? body.enabledTools.filter((id): id is CodingToolId => typeof id === 'string' && allowedToolIds.has(id))
        : []
    );

    const activeProject =
      typeof body.activeProjectId === 'string'
        ? notebooksWorkspace.projects.find((p) => p.id === body.activeProjectId) || null
        : notebooksWorkspace.projects[0] || null;

    let memoryMutated = false;
    const toolCtx =
      enabledTools.size > 0
        ? {
            rootDir: __dirname,
            activeProject,
            enabledTools,
            memoryStore: codingMemoryStore,
            onMemoryMutated: (nextStore: CodingMemoryStore) => {
              codingMemoryStore = nextStore;
              memoryMutated = true;
              try {
                saveCodingMemoryToDisk(codingMemoryStore);
              } catch (err) {
                console.warn('Failed to persist coding memory after tool mutation:', err);
              }
            },
          }
        : undefined;

    const thinkingMode: ThinkingMode =
      body.thinkingMode === 'off' || body.thinkingMode === 'deep' ? body.thinkingMode : 'standard';
    const rawSystemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.slice(0, 27500) : '';
    const memoryCompilation =
      body.usePersistentMemory !== false
        ? compileMemorySystemBlock(codingMemoryStore, 4000)
        : { block: '', activeCount: 0 };
    const systemPrompt = [rawSystemPrompt, memoryCompilation.block].filter(Boolean).join('\n\n').slice(0, 31500);
    const temperature =
      typeof body.temperature === 'number' && Number.isFinite(body.temperature) ? body.temperature : 0.25;
    const maxTokens =
      typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens) ? body.maxTokens : 4096;

    const attachMemoryMeta = (reply: UnifiedCodingReply): UnifiedCodingReply => {
      if (!memoryMutated && memoryCompilation.activeCount === 0) return reply;
      return {
        ...reply,
        meta: {
          ...(reply.meta || {}),
          memoryUpdated: memoryMutated,
          memoryInjectedCount: memoryCompilation.activeCount,
        },
      };
    };

    const firstSafeImage =
      Array.isArray(body.images)
        ? body.images.find(
            (img): img is string =>
              typeof img === 'string' && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img.trim())
          )
        : undefined;

    if (way === 'hf_space') {
      const sanitizedNoSys = sanitizeChatMessages(body.messages, undefined, undefined);
      if (sanitizedNoSys.length === 0 || !sanitizedNoSys.some((m) => m.role === 'user')) {
        return { status: 400, payload: { ok: false, latencyMs: 0, error: 'Bitte eine Nachricht eingeben.' } };
      }
      const result = await runHfSpaceChat({
        spaceId: typeof body.hfSpaceId === 'string' && body.hfSpaceId ? body.hfSpaceId : HF_SPACE_PRESETS[0].id,
        hfToken: typeof body.hfToken === 'string' ? body.hfToken : undefined,
        messages: sanitizedNoSys,
        systemPrompt,
        thinkingMode,
        temperature,
        maxTokens,
        topP: typeof body.topP === 'number' && Number.isFinite(body.topP) ? body.topP : 0.95,
        topK: typeof body.topK === 'number' && Number.isFinite(body.topK) ? body.topK : 40,
        repetitionPenalty:
          typeof body.repetitionPenalty === 'number' && Number.isFinite(body.repetitionPenalty)
            ? body.repetitionPenalty
            : 1.05,
        gpuDuration:
          typeof body.gpuDuration === 'number' && Number.isFinite(body.gpuDuration) ? body.gpuDuration : 60,
        useDflash: body.useDflash !== false,
        imageBase64: firstSafeImage,
        toolCtx,
        onStream: streamOpts?.onStream,
        signal: streamOpts?.signal,
      });
      return { status: 200, payload: attachMemoryMeta(result) };
    }

    if (way === 'ai_horde') {
      const sanitizedNoSys = sanitizeChatMessages(body.messages, undefined, undefined);
      if (sanitizedNoSys.length === 0 || !sanitizedNoSys.some((m) => m.role === 'user')) {
        return { status: 400, payload: { ok: false, latencyMs: 0, error: 'Bitte eine Nachricht eingeben.' } };
      }
      const result = await runAiHordeChat({
        model: typeof body.hordeModel === 'string' ? body.hordeModel : '',
        apiKey: typeof body.hordeApiKey === 'string' ? body.hordeApiKey : undefined,
        messages: sanitizedNoSys,
        systemPrompt,
        maxLength:
          typeof body.hordeMaxLength === 'number' && Number.isFinite(body.hordeMaxLength)
            ? body.hordeMaxLength
            : Math.min(512, maxTokens),
        maxContextLength:
          typeof body.hordeMaxContextLength === 'number' && Number.isFinite(body.hordeMaxContextLength)
            ? body.hordeMaxContextLength
            : 4096,
        temperature,
        topP: typeof body.topP === 'number' && Number.isFinite(body.topP) ? body.topP : 0.95,
        topK: typeof body.topK === 'number' && Number.isFinite(body.topK) ? body.topK : 40,
        repPen:
          typeof body.hordeRepPen === 'number' && Number.isFinite(body.hordeRepPen)
            ? body.hordeRepPen
            : 1.08,
        trustedWorkers: body.hordeTrustedWorkers === true,
        slowWorkers: body.hordeSlowWorkers !== false,
        allowDowngrade: body.hordeAllowDowngrade !== false,
        autoContinue: body.hordeAutoContinue !== false,
        toolCtx,
        onStream: streamOpts?.onStream,
        signal: streamOpts?.signal,
      });
      return { status: 200, payload: attachMemoryMeta(result) };
    }

    const sanitizedMessages = sanitizeChatMessages(body.messages, systemPrompt, body.images);
    if (sanitizedMessages.length === 0 || !sanitizedMessages.some((m) => m.role === 'user')) {
      return { status: 400, payload: { ok: false, latencyMs: 0, error: 'Bitte eine Nachricht eingeben.' } };
    }

    if (way === 'free_uncensored_api') {
      const preset =
        FREE_UNCENSORED_API_PRESETS.find((p) => p.id === body.freeApiPresetId) ||
        FREE_UNCENSORED_API_PRESETS[0];
      if (preset.needsKey && !(typeof body.apiKey === 'string' && body.apiKey.trim())) {
        return {
          status: 400,
          payload: {
            ok: false,
            latencyMs: 0,
            error: `${preset.label} erfordert einen Session-API-Key. Klicke rechts auf „API-Key holen“ oder wähle OVHcloud/Pollinations (Ohne Key).`,
          },
        };
      }
      const result = await runOpenAiCompatibleCodingChat({
        baseUrl: preset.baseUrl,
        label: preset.label,
        model: (typeof body.model === 'string' && body.model.trim()) || preset.defaultModel,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        messages: sanitizedMessages,
        temperature,
        topP: typeof body.topP === 'number' ? body.topP : undefined,
        maxTokens,
        presencePenalty: typeof body.presencePenalty === 'number' ? body.presencePenalty : undefined,
        frequencyPenalty: typeof body.frequencyPenalty === 'number' ? body.frequencyPenalty : undefined,
        seed: typeof body.seed === 'number' ? body.seed : undefined,
        toolCtx,
        onStream: streamOpts?.onStream,
        signal: streamOpts?.signal,
      });
      return { status: 200, payload: attachMemoryMeta(result) };
    }

    if (way === 'cloud_tunnel') {
      const checked = validateCloudTunnelUrl(typeof body.tunnelUrl === 'string' ? body.tunnelUrl : '');
      if (!checked.ok) {
        return { status: 400, payload: { ok: false, latencyMs: 0, error: checked.error } };
      }
      const result = await runOpenAiCompatibleCodingChat({
        baseUrl: checked.baseUrl,
        label: 'Cloud-GPU Notebook Tunnel',
        model: (typeof body.model === 'string' && body.model.trim()) || 'huihui_ai/qwen3-coder-abliterated',
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        messages: sanitizedMessages,
        temperature,
        topP: typeof body.topP === 'number' ? body.topP : undefined,
        maxTokens,
        seed: typeof body.seed === 'number' ? body.seed : undefined,
        numCtx: typeof body.numCtx === 'number' ? body.numCtx : undefined,
        toolCtx,
        onStream: streamOpts?.onStream,
        signal: streamOpts?.signal,
      });
      return { status: 200, payload: attachMemoryMeta(result) };
    }

    const resolved = validateChatTarget({
      targetType: body.targetType || 'provider',
      bridgeId: body.bridgeId,
      providerId: body.providerId,
      endpointUrl: body.endpointUrl,
      allowManualOverride: body.allowManualOverride === true,
      providers: state.providers,
      bridgeSelections: state.bridgeSelections,
    });
    if (!resolved.ok) {
      return { status: 403, payload: { ok: false, latencyMs: 0, error: resolved.error } };
    }
    const effectiveKey =
      (typeof body.apiKey === 'string' && body.apiKey.trim()) ||
      (resolved.envVarHint ? process.env[resolved.envVarHint]?.trim() : '') ||
      '';
    const result = await runOpenAiCompatibleCodingChat({
      baseUrl: resolved.baseUrl,
      label: resolved.label,
      model: (typeof body.model === 'string' && body.model.trim()) || 'default',
      apiKey: effectiveKey || undefined,
      messages: sanitizedMessages,
      temperature,
      topP: typeof body.topP === 'number' ? body.topP : undefined,
      maxTokens,
      toolCtx,
      onStream: streamOpts?.onStream,
      signal: streamOpts?.signal,
    });
    return { status: 200, payload: attachMemoryMeta(result) };
  }

  // Persistent Long-Term Memory ("Merkender Verlauf") REST endpoints (strictly local, secrets auto-redacted)
  app.get('/api/coding/memory', (_req, res) => {
    res.json({ ok: true, store: codingMemoryStore });
  });

  app.put('/api/coding/memory', (req, res) => {
    const validated = validateMemoryStorePayload(req.body);
    if (!validated.ok) {
      res.status(400).json({ ok: false, error: validated.error });
      return;
    }
    codingMemoryStore = validated.store;
    try {
      saveCodingMemoryToDisk(codingMemoryStore);
      res.json({ ok: true, store: codingMemoryStore });
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Fehler beim Speichern des Gedächtnisses.',
      });
    }
  });

  app.post('/api/coding/memory/entry', (req, res) => {
    const body = (req.body || {}) as {
      id?: string;
      title?: string;
      content?: string;
      category?: CodingMemoryCategory;
      source?: 'user' | 'assistant' | 'tool';
      enabled?: boolean;
    };
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!title || !content) {
      res.status(400).json({ ok: false, error: 'Titel und Inhalt sind erforderlich.' });
      return;
    }
    const updated = upsertMemoryEntry(codingMemoryStore, {
      id: typeof body.id === 'string' ? body.id : undefined,
      title,
      content,
      category: body.category,
      source: body.source === 'assistant' || body.source === 'tool' ? body.source : 'user',
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    });
    codingMemoryStore = updated.store;
    try {
      saveCodingMemoryToDisk(codingMemoryStore);
      res.json({ ok: true, entry: updated.entry, redacted: updated.redacted, store: codingMemoryStore });
    } catch (err: unknown) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Fehler beim Speichern.',
      });
    }
  });

  app.delete('/api/coding/memory/entry/:id', (req, res) => {
    const entryId = String(req.params.id || '').trim();
    const before = codingMemoryStore.entries.length;
    codingMemoryStore = {
      ...codingMemoryStore,
      entries: codingMemoryStore.entries.filter((e) => e.id !== entryId),
      updatedAt: new Date().toISOString(),
    };
    if (codingMemoryStore.entries.length !== before) {
      try {
        saveCodingMemoryToDisk(codingMemoryStore);
      } catch (err: unknown) {
        res.status(500).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Fehler beim Löschen.',
        });
        return;
      }
    }
    res.json({ ok: true, store: codingMemoryStore });
  });

  app.post('/api/coding/chat', async (req, res) => {
    const out = await executeUnifiedCodingChat((req.body || {}) as CodingChatRequestBody);
    res.status(out.status).json(out.payload);
  });

  // Real-time Server-Sent Events (SSE) Streaming endpoint for Coding Studio
  app.post('/api/coding/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortCtrl = new AbortController();
    let closed = false;
    req.on('close', () => {
      closed = true;
      abortCtrl.abort();
    });

    const sendEvent = (ev: CodingStreamEvent) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(formatSseFrame(ev));
      } catch {
        closed = true;
      }
    };

    try {
      const out = await executeUnifiedCodingChat((req.body || {}) as CodingChatRequestBody, {
        onStream: sendEvent,
        signal: abortCtrl.signal,
      });
      if (!closed) {
        if (out.payload.ok) {
          sendEvent({ type: 'done', payload: out.payload });
        } else {
          sendEvent({
            type: 'error',
            error: out.payload.error || `HTTP ${out.status}`,
            httpStatus: out.payload.httpStatus || out.status,
            targetUrl: out.payload.targetUrl,
            rawPreview: out.payload.rawPreview,
            latencyMs: out.payload.latencyMs,
            toolEvents: out.payload.toolEvents,
          });
        }
      }
    } catch (err: unknown) {
      if (!closed) {
        sendEvent({
          type: 'error',
          error: err instanceof Error ? err.message : 'Stream-Ausführung fehlgeschlagen.',
        });
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // Hardened Sandbox Execution Runner (allowlisted presets, coding-workspace/ confinement, human-in-the-loop approval)
  app.get('/api/coding/sandbox/presets', (_req, res) => {
    res.json({ ok: true, presets: SANDBOX_RUNNER_PRESETS });
  });

  app.post('/api/coding/sandbox/run', async (req, res) => {
    const body = (req.body || {}) as {
      presetId?: string;
      targetFile?: string;
      confirmExecution?: boolean;
    };
    const presetValid = SANDBOX_RUNNER_PRESETS.some((p) => p.id === body.presetId);
    if (!presetValid) {
      res.status(400).json({ ok: false, error: 'Ungültiges Sandbox-Ausführungs-Preset.' });
      return;
    }
    if (body.confirmExecution !== true) {
      res.status(403).json({
        ok: false,
        error: 'Ausführung erfordert eine explizite Nutzer-Freigabe (confirmExecution: true).',
      });
      return;
    }
    const result = await runSafeSandboxCommand({
      rootDir: __dirname,
      presetId: body.presetId as SandboxRunnerPresetId,
      targetFile: typeof body.targetFile === 'string' ? body.targetFile : '',
      confirmExecution: true,
    });
    res.json(result);
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
