import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { consolidateBridges } from './bridgeSelector.ts';
import { buildInitialTestResults, classifyAllProviders } from './classifier.ts';
import { parseProviderMarkdown } from './parser.ts';
import { generateAllSuiteFiles } from './suiteGenerator.ts';

const DATASET_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/ai_provider_2__1d92e1da.txt'
);

const rawMarkdown = fs.readFileSync(DATASET_PATH, 'utf8');
const parsed = parseProviderMarkdown(rawMarkdown);
const { classified, collisions } = classifyAllProviders(parsed);
const initialTests = buildInitialTestResults(classified, {});
const { selections, excludedEntries, totalBridgeCategoryCount } = consolidateBridges(classified);
const { files, auditChecks } = generateAllSuiteFiles(
  classified,
  initialTests,
  selections,
  collisions,
  'ai_provider(2).txt'
);

test('ZIEL 1: parses all 344 provider blocks from ai_provider(2).txt cleanly', () => {
  assert.equal(parsed.length, 344, `Expected 344 blocks, got ${parsed.length}`);
  assert.ok(parsed.every((p) => p.id.length > 0 && p.name.length > 0));
  assert.ok(
    parsed.every((p) => !p.verbindungsart.includes('**protokoll:**')),
    'Compound pipe lines must split verbindungsart and protokoll cleanly'
  );
  const qwengate = parsed.find((p) => p.id === 'qwengate');
  assert.equal(qwengate?.verbindungsart, 'Webclient-Bridge');
  assert.equal(qwengate?.protokoll, 'openai_kompatibel');
});

test('ZIEL 1: strict illegal detection avoids prose false positives (gemini-web2api-go)', () => {
  const geminiGo = classified.find((p) => p.id === 'gemini-web2api-go');
  assert.ok(geminiGo, 'gemini-web2api-go must exist');
  assert.equal(geminiGo.isIllegal, false, 'gemini-web2api-go prose caveat must not trigger illegal');
  assert.equal(geminiGo.securityClass, 'ROT', 'gemini-web2api-go must be ROT, not SCHWARZ');

  const mixer = classified.find((p) => p.id === 'llm-mixer-marktplaetze');
  assert.ok(mixer, 'llm-mixer-marktplaetze must exist');
  assert.equal(mixer.isIllegal, true);
  assert.equal(mixer.securityClass, 'SCHWARZ');

  const fakeInstaller = classified.find((p) => p.id === 'fake-ai-install-lures');
  assert.ok(fakeInstaller, 'fake-ai-install-lures must exist');
  assert.equal(fakeInstaller.isIllegal, true);
  assert.equal(fakeInstaller.securityClass, 'ROT');
});

test('HARTE REGEL 1 & 7: blocks illegal and anonym_pseudo_key providers even if riskant=False', () => {
  const aiHorde = classified.find((p) => p.id === 'ai-horde');
  assert.ok(aiHorde, 'ai-horde must exist');
  assert.equal(aiHorde.isAnonymPseudoKey, true);
  assert.equal(aiHorde.testPolicy, 'SKIP_RULE1_ANONYM_PSEUDO_KEY');
  assert.ok(aiHorde.rule7Collision, 'Rule 7 collision must be documented for ai-horde');

  const aiHordeRow = initialTests.find((r) => r.id === 'ai-horde');
  assert.ok(aiHordeRow);
  assert.equal(aiHordeRow.status, 'SKIPPED (Regel 1: anonym_pseudo_key)');

  assert.ok(collisions.length >= 1, 'Rule 7 collisions must be surfaced');
});

test('ZIEL 2: ROT and SCHWARZ entries are always SKIPPED initially', () => {
  const rotRows = initialTests.filter((r) => r.securityClass === 'ROT');
  const schwarzRows = initialTests.filter((r) => r.securityClass === 'SCHWARZ');
  assert.ok(rotRows.length > 0);
  assert.ok(schwarzRows.length > 0);
  for (const r of rotRows) {
    assert.ok(
      r.status === 'SKIPPED (ToS-Risiko)' ||
        r.status === 'SKIPPED (illegal)' ||
        r.status === 'SKIPPED (Regel 1: anonym_pseudo_key)',
      `Unexpected ROT status for ${r.id}: ${r.status}`
    );
  }
  for (const r of schwarzRows) {
    assert.equal(r.status, 'SKIPPED (illegal)');
    assert.equal(r.url, '[GESPERRT – NUR DOKUMENTATION]');
  }
});

test('ZIEL 3: bridge consolidation covers all bridge-category entries and selects <= 1 per target', () => {
  assert.equal(totalBridgeCategoryCount, 43);
  assert.ok(excludedEntries.length > 0);

  const qwen = selections.find((s) => s.zielprovider === 'Qwen');
  assert.equal(qwen?.bridge_id, 'qwengate');
  assert.equal(qwen?.docker_capable, true);

  const cursor = selections.find((s) => s.zielprovider === 'Cursor');
  assert.equal(cursor?.bridge_id, 'composer-api');
  assert.equal(cursor?.docker_capable, false, 'macOS-only composer-api must not be dockerized on Win11');

  const copilot = selections.find((s) => s.zielprovider === 'GitHub Copilot');
  assert.equal(copilot?.bridge_id, null, 'Stale copilot-api (> 6 months) must be rejected');
});

import { getAllowlistedBridgeRepos, readClonedRepoFile } from './repoManager.ts';
import {
  analyzeTestResults,
  computePhase4Evaluation,
  isLikelyWafChallenge,
  isUsableGreenOrGelb,
  validateInvokeTarget,
} from './testEngine.ts';

test('ZIEL 4 & 5: all 19 suite artifacts generated (incl. Docker-free GUI & start-gui.bat) and all 6 Hard Rule audit checks pass', () => {
  assert.equal(files.length, 19);
  for (const check of auditChecks) {
    assert.equal(check.passed, true, `Audit check failed: ${check.rule} - ${check.evidence}`);
  }

  const startBat = files.find((f) => f.path === 'start-gui.bat');
  assert.ok(startBat, 'start-gui.bat must be generated');
  assert.ok(startBat.content.includes('\r\n'), 'start-gui.bat must use CRLF line endings for cmd.exe');
  assert.ok(!/[^\x00-\x7F]/.test(startBat.content), 'start-gui.bat must be pure ASCII');
  assert.ok(startBat.content.includes('127.0.0.1:3000'));
  assert.ok(startBat.content.includes('127.0.0.1:8787'));
  assert.ok(startBat.content.includes('node_modules\\.bin\\tsx.cmd'));
  assert.ok(startBat.content.includes('set "HOST=127.0.0.1"'), 'HOST must be quoted in set to avoid trailing space');
  assert.ok(!startBat.content.includes('set HOST=127.0.0.1 &&'), 'Must never use unquoted set HOST=... &&');
  assert.ok(!startBat.content.includes('""%~dp0""'), 'Must use /D "%~dp0" instead of nested quotes that break on (1) paths');
  assert.ok(startBat.content.includes('sys.version_info'));
  assert.ok(startBat.content.includes('local_gui_server.ps1'));
  assert.ok(startBat.content.includes('chcp 65001'));

  const viteCfg = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  assert.ok(!viteCfg.includes('__dirname'), 'vite.config.ts must use import.meta.dirname instead of __dirname');

  for (const guiPath of [
    'gui/index.html',
    'gui/local_gui_server.mjs',
    'gui/local_gui_server.py',
    'gui/local_gui_server.ps1',
  ]) {
    const f = files.find((x) => x.path === guiPath);
    assert.ok(f, `${guiPath} must be bundled in ZIP`);
    if (guiPath === 'gui/index.html') {
      assert.ok(!f.content.includes('onclick='), 'gui/index.html must use event delegation, not inline onclick');
    }
    if (guiPath === 'gui/local_gui_server.ps1') {
      assert.ok(!/[^\x00-\x7F]/.test(f.content), 'local_gui_server.ps1 must be pure ASCII for PowerShell 5.1');
      assert.ok(f.content.includes('DefaultConnectionLimit = 32'));
      assert.ok(f.content.includes('Read-HttpRequest'));
      assert.ok(f.content.includes('Test-SsrfSafe'));
    }
  }

  for (const psPath of ['start-all.ps1', 'stop-all.ps1', 'clone-bridges.ps1']) {
    const psFile = files.find((f) => f.path === psPath);
    assert.ok(psFile, `${psPath} must be generated`);
    assert.ok(!/[^\x00-\x7F]/.test(psFile.content), `${psPath} must be pure ASCII for PowerShell 5.1`);
    assert.ok(
      psFile.content.includes("$ErrorActionPreference = 'Continue'"),
      `${psPath} must guard native commands against PS 5.1 NativeCommandError`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  assert.equal(
    pkg.devDependencies?.esbuild,
    undefined,
    'package.json must not pin conflicting esbuild@^0.25.0 against vite@8'
  );

  const csvFile = files.find((f) => f.path === 'test_results.csv');
  assert.ok(csvFile);
  assert.ok(
    csvFile.content.startsWith('id,name,kategorie,status,http_code,risky,empfohlen,note,url\n')
  );

  const composeFile = files.find((f) => f.path === 'docker-compose.yml');
  assert.ok(composeFile);
  assert.ok(!composeFile.content.includes('0.0.0.0:'), 'Must never bind host port to 0.0.0.0');
  assert.ok(composeFile.content.includes('127.0.0.1:4000:4000'));

  const cloneScript = files.find((f) => f.path === 'clone-bridges.ps1');
  assert.ok(cloneScript, 'clone-bridges.ps1 must be generated');
  assert.ok(cloneScript.content.includes('qwengate'));
});

test('Bridge repo manager enforces strict GitHub allowlist and blocks path traversal', () => {
  const allowlisted = getAllowlistedBridgeRepos(selections);
  assert.equal(allowlisted.length, 7);
  assert.ok(allowlisted.every((r) => r.repoUrl.startsWith('https://github.com/')));
  assert.ok(!allowlisted.some((r) => r.bridgeId === 'composer-api'));

  assert.throws(
    () => readClonedRepoFile('qwengate', '../package.json', allowlisted, path.resolve(process.cwd(), 'bridges')),
    /Top-Level-Dateien/
  );
  assert.throws(
    () => readClonedRepoFile('llm-mixer-marktplaetze', 'README.md', allowlisted, path.resolve(process.cwd(), 'bridges')),
    /Allowlist/
  );
});

test('Multi-phase testEngine: WAF detection, Phase-4 scoring, analytics, and SSRF guard', () => {
  assert.equal(isLikelyWafChallenge(403, { server: 'cloudflare', 'cf-ray': 'abc' }), true);
  assert.equal(isLikelyWafChallenge(404, { server: 'cloudflare' }), false);

  const greenProv = classified.find((p) => p.securityClass === 'GRUEN' && p.url.startsWith('https://'))!;
  const rotProv = classified.find((p) => p.securityClass === 'ROT')!;
  const schwarzProv = classified.find((p) => p.securityClass === 'SCHWARZ')!;

  assert.equal(isUsableGreenOrGelb(greenProv), true);
  assert.equal(isUsableGreenOrGelb(rotProv), false);
  assert.equal(isUsableGreenOrGelb(schwarzProv), false);

  const dnsFail = computePhase4Evaluation(
    greenProv,
    [{ phase: 'dns', label: 'P1', status: 'fail', detail: 'NXDOMAIN' }],
    50,
    '-',
    false
  );
  assert.equal(dnsFail.healthScore, 0);
  assert.equal(dnsFail.readinessTier, 'NICHT_ERREICHBAR');

  const healthy = computePhase4Evaluation(
    greenProv,
    [
      { phase: 'dns', label: 'P1', status: 'pass', detail: 'ok' },
      { phase: 'reachability', label: 'P2', status: 'pass', detail: '200' },
      { phase: 'protocol', label: 'P3', status: 'pass', detail: '200' },
    ],
    180,
    '200',
    true
  );
  assert.equal(healthy.healthScore, 100);
  assert.equal(healthy.readinessTier, 'SOFORT_NUTZBAR');

  // SSRF protection must block cloud metadata, RFC1918 private IPs, 0.0.0.0, and ROT/SCHWARZ providers
  assert.equal(validateInvokeTarget(greenProv, 'http://169.254.169.254/latest/meta-data/').ok, false);
  assert.equal(validateInvokeTarget(greenProv, 'http://10.0.0.1/v1/models').ok, false);
  assert.equal(validateInvokeTarget(greenProv, 'http://192.168.1.1/v1/models').ok, false);
  assert.equal(validateInvokeTarget(greenProv, 'http://172.16.0.5/v1/models').ok, false);
  assert.equal(validateInvokeTarget(greenProv, 'http://0.0.0.0:3000/v1/models').ok, false);
  assert.equal(validateInvokeTarget(rotProv, rotProv.url).ok, false);
  assert.equal(validateInvokeTarget(greenProv, greenProv.url).ok, true);

  const analytics = analyzeTestResults(classified, initialTests);
  assert.ok(analytics.totalTestableGreenGelb > 250);
  assert.ok(analytics.blockedRule1OrRotCount >= 40);
});

import { buildBridgeManualCommands, detectLocalBridgeStartPlan } from './bridgeRunner.ts';
import {
  categorizeModelIds,
  extractChatCompletionReply,
  extractModelIds,
  resolveDefaultChatModel,
  sanitizeChatMessages,
  validateChatTarget,
} from './chatEngine.ts';
import {
  buildConnectionSnippets,
  classifyConnectionKind,
  normalizeEnvVarName,
} from './testEngine.ts';

test('Connection snippets fix PowerShell curl alias, double _API_API_KEY, and non-REST WebNN 404', () => {
  assert.equal(normalizeEnvVarName({ id: 'webnn-api', expectedEnvVar: null }), 'WEBNN_API_KEY');
  assert.equal(normalizeEnvVarName({ id: 'webnn-api', expectedEnvVar: 'WEBNN_API_API_KEY' }), 'WEBNN_API_KEY');
  assert.equal(normalizeEnvVarName({ id: 'groq', expectedEnvVar: null }), 'GROQ_API_KEY');

  const webnn = classified.find((p) => p.id === 'webnn-api');
  assert.ok(webnn, 'webnn-api must exist in dataset');
  assert.equal(classifyConnectionKind(webnn).kind, 'browser_only');
  const webnnSnip = buildConnectionSnippets(webnn);
  assert.equal(webnnSnip.supportsOpenAiEndpoints, false);
  assert.equal(webnnSnip.defaultApiBase, 'https://www.w3.org/TR/webnn/');
  assert.ok(!webnnSnip.curl.includes('webnn/v1/models'), 'WebNN curl must not append /v1/models to URL');
  assert.ok(!webnnSnip.powershell.includes('webnn/v1/models'), 'WebNN PowerShell must not append /v1/models to URL');
  assert.ok(webnnSnip.curl.includes('curl.exe -sSI "https://www.w3.org/TR/webnn/"'), 'Windows curl snippet must use curl.exe on exact URL');
  assert.ok(webnnSnip.powershell.includes('Invoke-WebRequest -Uri "https://www.w3.org/TR/webnn/"'), 'PowerShell snippet must check exact URL');
  assert.ok(!webnnSnip.curl.includes('WEBNN_API_API_KEY'), 'Env var must not duplicate _API_API_KEY');

  const groq = classified.find((p) => p.id.includes('groq') && p.securityClass === 'GRUEN');
  assert.ok(groq, 'a GRÜN Groq provider must exist in dataset');
  assert.equal(classifyConnectionKind(groq).kind, 'openai_rest');
  const groqSnip = buildConnectionSnippets(groq);
  assert.equal(groqSnip.supportsOpenAiEndpoints, true);
  assert.equal(groqSnip.defaultApiBase, 'https://api.groq.com/openai/v1');
  assert.ok(groqSnip.curl.includes('curl.exe -sS'));
  assert.ok(groqSnip.powershell.includes('Invoke-RestMethod'));
});

test('BridgeRunner manual commands and start plan detection enforce 127.0.0.1 and curl.exe', () => {
  const qwenSel = selections.find((s) => s.bridge_id === 'qwengate')!;
  const cmds = buildBridgeManualCommands(qwenSel);
  assert.ok(cmds.powershellTest.includes(`127.0.0.1:${qwenSel.port}`), 'Must target strict loopback port');
  assert.ok(cmds.curlTest.includes('curl.exe -sS'), 'Must use curl.exe for Windows PowerShell');
  assert.ok(cmds.powershellTest.includes('Invoke-RestMethod'), 'Must include PowerShell Invoke-RestMethod');
  const missingPlan = detectLocalBridgeStartPlan('/tmp/definitely-nonexistent-bridge-dir-12345', 8006);
  assert.equal(missingPlan.runtime, 'unknown');
  assert.equal(missingPlan.bin, null);
});

test('ChatEngine enforces Rule 1/3/4 SSRF guards and parses OpenAI + SSE replies & model lists', () => {
  const greenProv = classified.find((p) => p.id.includes('groq') && p.securityClass === 'GRUEN')!;
  const rotProv = classified.find((p) => p.securityClass === 'ROT')!;
  const schwarzProv = classified.find((p) => p.securityClass === 'SCHWARZ')!;

  const brOk = validateChatTarget({
    targetType: 'bridge',
    bridgeId: 'qwengate',
    providers: classified,
    bridgeSelections: selections,
  });
  assert.equal(brOk.ok, true);
  if (brOk.ok) assert.ok(brOk.baseUrl.startsWith('http://127.0.0.1:'));

  const brBlocked = validateChatTarget({
    targetType: 'bridge',
    bridgeId: 'llm-mixer-marktplaetze',
    providers: classified,
    bridgeSelections: selections,
  });
  assert.equal(brBlocked.ok, false);

  const provOk = validateChatTarget({
    targetType: 'provider',
    providerId: greenProv.id,
    providers: classified,
    bridgeSelections: selections,
  });
  assert.equal(provOk.ok, true);

  assert.equal(
    validateChatTarget({
      targetType: 'provider',
      providerId: rotProv.id,
      providers: classified,
      bridgeSelections: selections,
    }).ok,
    false
  );
  assert.equal(
    validateChatTarget({
      targetType: 'provider',
      providerId: schwarzProv.id,
      providers: classified,
      bridgeSelections: selections,
    }).ok,
    false
  );

  assert.equal(
    validateChatTarget({
      targetType: 'custom_local',
      endpointUrl: 'http://127.0.0.1:11434/v1',
      providers: classified,
      bridgeSelections: selections,
    }).ok,
    true
  );
  assert.equal(
    validateChatTarget({
      targetType: 'custom_local',
      endpointUrl: 'http://169.254.169.254/latest/meta-data',
      providers: classified,
      bridgeSelections: selections,
    }).ok,
    false
  );
  assert.equal(
    validateChatTarget({
      targetType: 'custom_local',
      endpointUrl: 'https://evil.example.com/v1',
      providers: classified,
      bridgeSelections: selections,
    }).ok,
    false
  );

  // Reply extraction: OpenAI JSON + SSE fallback + error
  const oai = extractChatCompletionReply(
    { model: 'llama-3', choices: [{ message: { content: 'Hallo Welt' } }], usage: { total_tokens: 12 } },
    ''
  );
  assert.equal(oai.reply, 'Hallo Welt');
  assert.equal(oai.usage?.total_tokens, 12);

  const sse = extractChatCompletionReply(
    null,
    'data: {"choices":[{"delta":{"content":"Hi "}}]}\ndata: {"choices":[{"delta":{"content":"du!"}}]}\ndata: [DONE]\n'
  );
  assert.equal(sse.reply, 'Hi du!');

  const errRes = extractChatCompletionReply({ error: { message: 'Invalid API key' } }, '');
  assert.equal(errRes.reply, null);
  assert.equal(errRes.errorMessage, 'Invalid API key');

  assert.deepEqual(extractModelIds({ data: [{ id: 'gpt-4o' }, { id: 'llama3' }] }), ['gpt-4o', 'llama3']);

  const msgs = sanitizeChatMessages([{ role: 'user', content: '  Test  ' }], 'Systemhinweis');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[1].content, 'Test');
});

test('Standalone Windows-11 GUI bundles Chat-Fenster, bridge execution routes, and pure ASCII PS1', () => {
  const html = files.find((f) => f.path === 'gui/index.html')!;
  assert.ok(html.content.includes('tab-chat'));
  assert.ok(html.content.includes('openChatForTarget'));
  assert.ok(html.content.includes('openBridgeDrawer'));
  assert.ok(html.content.includes('curl.exe'));
  assert.ok(!html.content.includes('onclick='));

  for (const srvPath of ['gui/local_gui_server.mjs', 'gui/local_gui_server.py', 'gui/local_gui_server.ps1']) {
    const f = files.find((x) => x.path === srvPath)!;
    assert.ok(f.content.includes('/api/bridges/execute'), `${srvPath} must expose /api/bridges/execute`);
    assert.ok(f.content.includes('/api/chat/send'), `${srvPath} must expose /api/chat/send`);
    assert.ok(f.content.includes('/api/chat/models'), `${srvPath} must expose /api/chat/models`);
  }

  const mjs = files.find((f) => f.path === 'gui/local_gui_server.mjs')!;
  assert.ok(!mjs.content.includes("'npm.cmd'"), 'local_gui_server.mjs must never spawn bare npm.cmd (Node 20.12+/26 EINVAL)');
  assert.ok(mjs.content.includes('resolveSafeNpm'));
  assert.ok(mjs.content.includes('waitForLoopback'));
});

import { resolveNpmInvocation } from './bridgeRunner.ts';
import {
  buildLocalImprovedPrompt,
  computeNextRunAt,
  createDefaultWorkspace,
  exportProjectToMarkdown,
  GROK_BRIDGE_CAPABILITIES,
  GROK_BRIDGE_MODELS,
  isJobDue,
  parseSafeMarkdownBlocks,
  retrieveProjectContext,
  sanitizeSafeHttpUrl,
  searchProjectEverything,
  validateWorkspacePayload,
  type NotebookProject,
} from './notebookEngine.ts';

test('Windows-11 regression fixes: mistral-rs, pollinations, hack-club-ai, non-chat portals, and safe npm invocation', () => {
  const mistralRs = classified.find((p) => p.id === 'mistral-rs');
  assert.ok(mistralRs, 'mistral-rs must exist in catalog');
  assert.equal(classifyConnectionKind(mistralRs).supportsOpenAiEndpoints, true);
  const mistralRsBase = buildConnectionSnippets(mistralRs).defaultApiBase;
  assert.equal(mistralRsBase, 'http://127.0.0.1:1234/v1');
  assert.equal(validateInvokeTarget(mistralRs, `${mistralRsBase}/chat/completions`).ok, true);

  const mistralCloud = classified.find((p) => p.id === 'mistral-la-plateforme');
  if (mistralCloud) {
    const cloudBase = buildConnectionSnippets(mistralCloud).defaultApiBase;
    assert.equal(cloudBase, 'https://api.mistral.ai/v1');
  }

  const pollinations = classified.find((p) => p.id === 'pollinations');
  assert.ok(pollinations, 'pollinations must exist in catalog');
  assert.equal(classifyConnectionKind(pollinations).supportsOpenAiEndpoints, true);
  const pollBase = buildConnectionSnippets(pollinations).defaultApiBase;
  assert.equal(pollBase, 'https://text.pollinations.ai/openai');
  assert.equal(validateInvokeTarget(pollinations, `${pollBase}/chat/completions`).ok, true);

  const hackClub = classified.find((p) => p.id === 'hack-club-ai');
  if (hackClub) {
    const hcBase = buildConnectionSnippets(hackClub).defaultApiBase;
    assert.equal(hcBase, 'https://ai.hackclub.com/proxy/v1');
  }

  for (const nonChatId of ['webnn-api', 'amd-ai-developer-program', 'cohere-labs']) {
    const prov = classified.find((p) => p.id === nonChatId);
    assert.ok(prov, `${nonChatId} must exist in catalog`);
    assert.equal(
      classifyConnectionKind(prov).supportsOpenAiEndpoints,
      false,
      `${nonChatId} must not be classified as direct OpenAI chat endpoint`
    );
  }

  const winNpm = resolveNpmInvocation(['start'], 'win32', 'C:\\nonexistent\\node.exe', {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  });
  assert.notEqual(winNpm.bin.toLowerCase(), 'npm.cmd', 'Must never spawn bare npm.cmd on Windows');
  assert.ok(
    winNpm.bin.toLowerCase().endsWith('cmd.exe') || winNpm.bin.toLowerCase().endsWith('node.exe')
  );
  assert.ok(winNpm.args.includes('start'));
});

test('NotebookEngine: cross-chat discovery, KB retrieval isolation, full-text search, and Markdown export', () => {
  assert.equal(GROK_BRIDGE_MODELS.length, 5);
  assert.ok(GROK_BRIDGE_CAPABILITIES.some((c) => c.id === 'web-sources' && c.supported));
  assert.ok(GROK_BRIDGE_CAPABILITIES.some((c) => c.id === 'binary-office' && !c.supported));

  const projectA: NotebookProject = {
    id: 'proj-a',
    name: 'Solar Architektur',
    description: 'Projekt A',
    instructions: 'Nutze immer Projekt-Fakten.',
    crossChatMemoryEnabled: true,
    knowledgeBaseEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    knowledgeDocs: [
      {
        id: 'doc-1',
        title: 'Wechselrichter Spezifikation',
        sourceType: 'note',
        tags: ['hardware', 'pv'],
        content: 'Der Hybrid-Wechselrichter unterstützt 12 kW Spitzenleistung und Modbus TCP auf Port 502.',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'doc-disabled',
        title: 'Veraltete Notiz',
        sourceType: 'note',
        tags: [],
        content: 'Veralteter Modbus Port 9999 darf nicht injiziert werden.',
        enabled: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    chats: [
      {
        id: 'chat-1',
        title: 'Batterie-Planung',
        targetType: 'bridge',
        bridgeId: 'grok-com-to-openai',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Welchen Speicher haben wir gewählt?',
            createdAt: '10:00:00',
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Wir haben den LiFePO4 Speicher mit 15 kWh Kapazität und CAN-Bus BMS festgelegt.',
            createdAt: '10:00:05',
          },
        ],
      },
      {
        id: 'chat-2',
        title: 'Monitoring-Chat',
        targetType: 'bridge',
        bridgeId: 'grok-com-to-openai',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messages: [],
      },
    ],
    chronoJobs: [],
  };

  // Query from Chat 2 must discover both KB doc-1 (Modbus) and sibling Chat 1 (LiFePO4 15 kWh), while excluding disabled doc
  const ctx = retrieveProjectContext({
    project: projectA,
    activeChatId: 'chat-2',
    query: 'Wie verbinden wir den LiFePO4 Speicher mit dem Modbus Wechselrichter?',
  });

  assert.ok(ctx.knowledgeHits.some((h) => h.id === 'doc-1'), 'Enabled KB doc must be retrieved');
  assert.ok(!ctx.knowledgeHits.some((h) => h.id === 'doc-disabled'), 'Disabled KB doc must never be retrieved');
  assert.ok(ctx.chatHits.some((h) => h.id === 'chat-1'), 'Sibling chat must be discovered via cross-chat memory');
  assert.ok(ctx.compiledSystemBlock.includes('15 kWh'));
  assert.ok(ctx.compiledSystemBlock.includes('Port 502'));
  assert.ok(!ctx.compiledSystemBlock.includes('9999'));

  // Full-text search across chats + knowledge docs
  const hits = searchProjectEverything(projectA, 'LiFePO4');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sourceType, 'chat');
  assert.equal(hits[0].id, 'chat-1');

  const md = exportProjectToMarkdown(projectA);
  assert.ok(md.includes('# Projekt / Notebook: Solar Architektur'));
  assert.ok(md.includes('Wechselrichter Spezifikation'));
  assert.ok(md.includes('Batterie-Planung'));
});

test('NotebookEngine: Chrono-Job scheduling, XSS-safe Markdown, secret-stripping validation, and prompt refiner', () => {
  const baseDate = new Date('2026-06-01T08:00:00.000Z');

  const intervalNext = computeNextRunAt(
    { scheduleType: 'interval_min', intervalMinutes: 30, enabled: true, lastRunAt: null },
    baseDate
  );
  assert.equal(intervalNext, '2026-06-01T08:30:00.000Z');

  const onceNext = computeNextRunAt(
    { scheduleType: 'once', runAtIso: '2026-06-01T09:00:00.000Z', enabled: true, lastRunAt: null },
    baseDate
  );
  assert.equal(onceNext, '2026-06-01T09:00:00.000Z');

  const dueJob = {
    id: 'j1',
    name: 'Morgen-Briefing',
    prompt: 'Fasse neue Ereignisse zusammen.',
    scheduleType: 'daily' as const,
    timeOfDay: '09:00',
    enabled: true,
    saveToKnowledge: false,
    includeSources: true,
    targetType: 'bridge' as const,
    bridgeId: 'grok-com-to-openai',
    nextRunAt: '2026-06-01T07:55:00.000Z',
    runCount: 0,
    lastStatus: 'idle' as const,
    createdAt: baseDate.toISOString(),
  };
  assert.equal(isJobDue(dueJob, baseDate), true);
  assert.equal(isJobDue({ ...dueJob, enabled: false }, baseDate), false);
  assert.equal(isJobDue({ ...dueJob, lastStatus: 'running' }, baseDate), false);

  // XSS-safe URL & Markdown image parsing (Grok Imagine safe https vs blocked javascript/data)
  assert.equal(sanitizeSafeHttpUrl('https://assets.grok.com/img/test.png'), 'https://assets.grok.com/img/test.png');
  assert.equal(sanitizeSafeHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeSafeHttpUrl('data:text/html,<script>alert(1)</script>'), null);

  const blocks = parseSafeMarkdownBlocks(
    '### Ergebnis\n![generated image](https://assets.grok.com/img/a.png)\n![bad](javascript:alert(1))\n```ts\nconst x = 1;\n```'
  );
  assert.ok(blocks.some((b) => b.type === 'heading' && b.text === 'Ergebnis'));
  assert.ok(blocks.some((b) => b.type === 'image' && b.url === 'https://assets.grok.com/img/a.png'));
  assert.ok(!blocks.some((b) => b.type === 'image' && b.url.includes('javascript:')));
  assert.ok(blocks.some((b) => b.type === 'code' && b.language === 'ts'));

  // Secret stripping in workspace persistence validation
  const ws = createDefaultWorkspace();
  const polluted = JSON.parse(JSON.stringify(ws)) as Record<string, unknown>;
  (polluted.projects as Array<Record<string, unknown>>)[0].apiKey = 'sk-secret-never-persist';
  const validated = validateWorkspacePayload(polluted);
  assert.equal(validated.ok, true);
  if (validated.ok) {
    assert.ok(!JSON.stringify(validated.workspace).includes('sk-secret-never-persist'));
  }

  // Prompt refiner modes
  const refined = buildLocalImprovedPrompt('Erkläre Grok Bridge', 'research', 'Grok Notebook');
  assert.ok(refined.includes('Grok Notebook'));
  assert.ok(refined.includes('belegten Fakten'));
  const imagineRefined = buildLocalImprovedPrompt('Futuristisches Labor', 'imagine');
  assert.ok(imagineRefined.includes('Grok Imagine'));
});

test('ChatEngine multimodal sanitization allows safe Base64 images and rejects SVG/invalid schemes', () => {
  const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const badSvg = 'data:image/svg+xml;base64,PHN2Zy8+';
  const badJs = 'javascript:alert(1)';

  const msgs = sanitizeChatMessages(
    [{ role: 'user', content: 'Analysiere dieses Bild' }],
    'System',
    [validPng, badSvg, badJs]
  );
  assert.equal(msgs.length, 2);
  assert.ok(Array.isArray(msgs[1].content), 'Last user message must contain multimodal content array');
  if (Array.isArray(msgs[1].content)) {
    assert.equal(msgs[1].content.length, 2, 'Only text + 1 valid PNG must remain (SVG and JS rejected)');
    assert.equal(msgs[1].content[1].type, 'image_url');
  }
});

test('Live-test scoring fixes: HTTP 401 AUTH_REQUIRED and OVH /v1 404 recovered by Phase-3 200', () => {
  const mistral = classified.find((p) => p.id === 'mistral-la-plateforme')!;
  const ovh = classified.find((p) => p.id === 'ovh-ai-endpoints')!;
  assert.ok(mistral && ovh);

  const auth401 = computePhase4Evaluation(
    mistral,
    [
      { phase: 'dns', label: 'P1', status: 'pass', detail: 'ok' },
      { phase: 'reachability', label: 'P2', status: 'warn', detail: 'HTTP 401 (Auth erforderlich)' },
      { phase: 'protocol', label: 'P3', status: 'skip', detail: 'Auth erforderlich' },
    ],
    95,
    '401',
    false
  );
  assert.ok(auth401.healthScore >= 75, `Expected score >= 75 for HTTP 401, got ${auth401.healthScore}`);
  assert.equal(auth401.readinessTier, 'BEREIT_MIT_KEY');

  const ovhRecovered = computePhase4Evaluation(
    ovh,
    [
      { phase: 'dns', label: 'P1', status: 'pass', detail: 'ok' },
      { phase: 'reachability', label: 'P2', status: 'fail', detail: 'HTTP 404 auf /v1' },
      { phase: 'protocol', label: 'P3', status: 'pass', detail: 'GET /v1/models -> HTTP 200' },
    ],
    140,
    '200',
    true
  );
  assert.ok(ovhRecovered.healthScore >= 90, `Expected score >= 90 when P3 /models passes, got ${ovhRecovered.healthScore}`);
  assert.equal(ovhRecovered.readinessTier, 'SOFORT_NUTZBAR');

  const mockRows = initialTests.map((r) =>
    r.id === mistral.id
      ? {
          ...r,
          executed: true,
          status: 'AUTH_REQUIRED' as const,
          http_code: '401',
          readinessTier: 'BEREIT_MIT_KEY' as const,
        }
      : r
  );
  const analytics = analyzeTestResults(classified, mockRows);
  const nokeyCluster = analytics.failureClusters.find((c) => c.key === 'nokey');
  assert.ok((nokeyCluster?.count ?? 0) >= 1, 'AUTH_REQUIRED must count under nokey cluster');
  assert.ok(analytics.readyWithKeyCount >= 1, 'AUTH_REQUIRED must count under readyWithKeyCount');
  assert.equal(analytics.unreachableCount, 0, 'AUTH_REQUIRED must not count as unreachable');
});

test('ChatEngine: default models, OVH/Pollinations non-chat model filtering, and server-side WebNN guard', () => {
  assert.equal(resolveDefaultChatModel('pollinations'), 'openai-fast');
  assert.equal(resolveDefaultChatModel('ovh-ai-endpoints'), 'gpt-oss-20b');
  assert.equal(resolveDefaultChatModel(undefined, 'grok-com-to-openai'), 'grok-fast');
  assert.equal(resolveDefaultChatModel(undefined, 'freedeepseekapi'), 'deepseek-chat');
  assert.equal(resolveDefaultChatModel(undefined, 'openai-api-server-via-codex'), 'gpt-5.4-mini');

  const ovhModelsPayload = {
    object: 'list',
    data: [
      { id: 'solaria-3', context_length: 0, max_completion_tokens: 0 },
      { id: 'whisper-large-v3', context_length: 0, max_completion_tokens: 0 },
      { id: 'nvr-tts-de-de', context_length: 0, max_completion_tokens: 0 },
      { id: 'bge-m3', context_length: 8192, max_completion_tokens: 0 },
      { id: 'stable-diffusion-xl-base-v10', context_length: 0, max_completion_tokens: 0 },
      { id: 'gpt-oss-20b', context_length: 131072, max_completion_tokens: 32768 },
      { id: 'Qwen3.8-27B', context_length: 65536, max_completion_tokens: 16384 },
    ],
  };
  const ovhCat = categorizeModelIds(ovhModelsPayload);
  assert.deepEqual(ovhCat.chatModels, ['gpt-oss-20b', 'Qwen3.8-27B']);
  assert.equal(ovhCat.nonChatModels.length, 5);
  assert.ok(ovhCat.nonChatModels.includes('solaria-3'));
  assert.ok(ovhCat.nonChatModels.includes('nvr-tts-de-de'));

  const pollCat = categorizeModelIds([
    { name: 'openai-fast', output_modalities: ['text'] },
    { name: 'flux-image', output_modalities: ['image'] },
  ]);
  assert.deepEqual(pollCat.chatModels, ['openai-fast']);
  assert.deepEqual(pollCat.nonChatModels, ['flux-image']);

  // Server-side guard blocks WebNN unless allowManualOverride is explicitly true
  const webnnBlocked = validateChatTarget({
    targetType: 'provider',
    providerId: 'webnn-api',
    providers: classified,
    bridgeSelections: selections,
  });
  assert.equal(webnnBlocked.ok, false, 'WebNN must be rejected by default on server');

  const webnnOverride = validateChatTarget({
    targetType: 'provider',
    providerId: 'webnn-api',
    providers: classified,
    bridgeSelections: selections,
    allowManualOverride: true,
  });
  assert.equal(webnnOverride.ok, true, 'WebNN may proceed only with explicit manual override');
});

test('BridgeRunner detects native entrypoints for webai-to-api, catgpt-gateway, codex Go cmd/, and qwengate start:node', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-suite-bridge-test-'));
  try {
    // 1. webai-to-api (src/run.py)
    const webaiDir = path.join(tmpRoot, 'webai-to-api');
    fs.mkdirSync(path.join(webaiDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(webaiDir, 'src', 'run.py'), 'print("ok")');
    const webaiPlan = detectLocalBridgeStartPlan(webaiDir, 8104);
    assert.equal(webaiPlan.runtime, 'python');
    assert.deepEqual(webaiPlan.args, ['src/run.py', '--host', '127.0.0.1', '--port', '8104']);
    assert.equal(webaiPlan.extraEnv?.PYTHONPATH, path.join(webaiDir, 'src'));

    // 2. catgpt-gateway (src/api/server.py)
    const catDir = path.join(tmpRoot, 'catgpt-gateway');
    fs.mkdirSync(path.join(catDir, 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(catDir, 'src', 'api', 'server.py'), 'print("ok")');
    const catPlan = detectLocalBridgeStartPlan(catDir, 8103);
    assert.equal(catPlan.runtime, 'python');
    assert.deepEqual(catPlan.args, ['-m', 'src.api.server']);
    assert.equal(catPlan.extraEnv?.USE_XVFB, 'false');

    // 3. openai-api-server-via-codex (go.mod + cmd/openai-api-server-via-codex/main.go)
    const codexDir = path.join(tmpRoot, 'openai-api-server-via-codex');
    fs.mkdirSync(path.join(codexDir, 'cmd', 'openai-api-server-via-codex'), { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'go.mod'), 'module example.com/codex\n');
    fs.writeFileSync(path.join(codexDir, 'cmd', 'openai-api-server-via-codex', 'main.go'), 'package main\nfunc main(){}\n');
    const codexPlan = detectLocalBridgeStartPlan(codexDir, 8102);
    assert.equal(codexPlan.runtime, 'go');
    assert.equal(codexPlan.bin, 'go');
    assert.deepEqual(codexPlan.args, ['run', './cmd/openai-api-server-via-codex']);

    // 4. qwengate (package.json with bun start + start:node)
    const qwenDir = path.join(tmpRoot, 'qwengate');
    fs.mkdirSync(qwenDir, { recursive: true });
    fs.writeFileSync(
      path.join(qwenDir, 'package.json'),
      JSON.stringify({ scripts: { start: 'bun src/index.tsx', 'start:node': 'node --import tsx src/index.tsx' } })
    );
    const qwenPlan = detectLocalBridgeStartPlan(qwenDir, 8101);
    assert.equal(qwenPlan.runtime, 'node');
    assert.ok(qwenPlan.args.includes('start:node'), 'Must prefer start:node when start script invokes bun');

    // 5. Standalone GUI server mirrors fixes and has no bridgeById typo
    const mjs = files.find((f) => f.path === 'gui/local_gui_server.mjs')!;
    assert.ok(!mjs.content.includes('bridgeById'), 'local_gui_server.mjs must use allowBridges, not undefined bridgeById');
    assert.ok(mjs.content.includes('AUTH_REQUIRED'));
    assert.ok(mjs.content.includes('SKIP_ACCOUNT_MENU'));
    assert.ok(mjs.content.includes('SERVER_PORT'));
    assert.ok(mjs.content.includes('src.api.server'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});



