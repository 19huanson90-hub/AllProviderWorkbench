import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { consolidateBridges } from './bridgeSelector.ts';
import { buildInitialTestResults, classifyAllProviders } from './classifier.ts';
import {
  readSafeWorkspaceFile,
  resolveSafeWorkspacePath,
  scanSafeWorkspaceTree,
  writeSafeCodingSandboxFile,
} from './codingWorkspace.ts';
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

test('ZIEL 1: parses all 368 provider blocks from ai_provider(2).txt cleanly', () => {
  assert.equal(parsed.length, 368, `Expected 368 blocks, got ${parsed.length}`);
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

import {
  buildBridgeManualCommands,
  detectLocalBridgeStartPlan,
  resolveVenvPythonPath,
} from './bridgeRunner.ts';
import {
  BRIDGE_VERIFIED_MODELS,
  DUCK2API_MODELS,
  categorizeModelIds,
  extractChatCompletionReply,
  extractModelIds,
  resolveDefaultChatModel,
  resolveVerifiedBridgeModelOptions,
  sanitizeChatMessages,
  validateChatTarget,
} from './chatEngine.ts';
import {
  buildConnectionSnippets,
  classifyConnectionKind,
  normalizeEnvVarName,
  resolveProviderApiKeyPage,
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
  assert.equal(resolveDefaultChatModel(undefined, 'duck2api'), 'gpt-5.4-mini');
  assert.equal(resolveDefaultChatModel(undefined, 'freedeepseekapi'), 'deepseek-chat');
  assert.equal(resolveDefaultChatModel(undefined, 'openai-api-server-via-codex'), 'gpt-5.4-mini');
  assert.equal(resolveDefaultChatModel(undefined, 'catgpt-gateway'), 'claude-browser');
  assert.equal(resolveDefaultChatModel(undefined, 'webai-to-api'), 'gemini-3-flash');
  assert.equal(resolveDefaultChatModel(undefined, 'qwengate'), 'qwen3.7-plus');
  assert.ok(DUCK2API_MODELS.includes('gpt-5.4-mini'));
  assert.ok(DUCK2API_MODELS.includes('claude-haiku-5-5'));
  assert.ok(DUCK2API_MODELS.includes('mistral-small-2603'));
  assert.ok(DUCK2API_MODELS.includes('tinfoil/gemma4-31b'));
  assert.ok(!DUCK2API_MODELS.includes('claude-opus-5-5'));

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

test('BridgeRunner detects native entrypoints, Python venv/pip/patchright & version caps, Go cmd/, and qwengate start:node', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-suite-bridge-test-'));
  try {
    // 1. webai-to-api (src/run.py + requirements.txt with python_version < 3.13)
    const webaiDir = path.join(tmpRoot, 'webai-to-api');
    fs.mkdirSync(path.join(webaiDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(webaiDir, 'src', 'run.py'), 'print("ok")');
    fs.writeFileSync(
      path.join(webaiDir, 'requirements.txt'),
      'gemini-webapi==2.1.1 ; python_version >= "3.11" and python_version < "3.13"\n'
    );
    const webaiPlan = detectLocalBridgeStartPlan(webaiDir, 8104);
    assert.equal(webaiPlan.runtime, 'python');
    assert.deepEqual(webaiPlan.args, ['src/run.py', '--host', '127.0.0.1', '--port', '8104']);
    assert.equal(webaiPlan.extraEnv?.PYTHONPATH, path.join(webaiDir, 'src'));
    assert.equal(webaiPlan.needsPipInstall, true);
    assert.equal(webaiPlan.pythonRequiresMaxMinor, 12);

    // Once .venv + marker exist, needsPipInstall becomes false and bin points to venv python
    const venvPy = resolveVenvPythonPath(webaiDir);
    fs.mkdirSync(path.dirname(venvPy), { recursive: true });
    fs.writeFileSync(venvPy, '');
    fs.writeFileSync(path.join(webaiDir, '.venv', '.ai_suite_deps_ok'), 'ok\n');
    const webaiReadyPlan = detectLocalBridgeStartPlan(webaiDir, 8104);
    assert.equal(webaiReadyPlan.needsPipInstall, false);
    assert.equal(webaiReadyPlan.bin, venvPy);

    // 2. catgpt-gateway (src/api/server.py + patchright in requirements.txt)
    const catDir = path.join(tmpRoot, 'catgpt-gateway');
    fs.mkdirSync(path.join(catDir, 'src', 'api'), { recursive: true });
    fs.writeFileSync(path.join(catDir, 'src', 'api', 'server.py'), 'print("ok")');
    fs.writeFileSync(path.join(catDir, 'requirements.txt'), 'patchright>=1.58\nfastapi>=0.115\n');
    const catPlan = detectLocalBridgeStartPlan(catDir, 8103);
    assert.equal(catPlan.runtime, 'python');
    assert.deepEqual(catPlan.args, ['-m', 'src.api.server']);
    assert.equal(catPlan.extraEnv?.USE_XVFB, 'false');
    assert.equal(catPlan.needsPipInstall, true);
    assert.equal(catPlan.needsPatchrightBrowser, true);

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
    assert.ok(mjs.content.includes('.ai_suite_deps_ok'));
    assert.ok(mjs.content.includes('patchright'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Newly verified OpenAI-compatible REST APIs (23 GELB + venice-ai) resolve cleanly and pass SSRF/chat guards', () => {
  const expectedApis: Array<{ id: string; baseUrl: string; defaultModel?: string }> = [
    { id: 'unrestrictable-ai', baseUrl: 'https://unrestrictable.ai/v1', defaultModel: 'abliterated-model' },
    { id: 'obscurify-ai', baseUrl: 'https://obscurify.ai/v1', defaultModel: 'abliteration-ai/abliterated-model' },
    { id: 'uncensoredaichat-ai', baseUrl: 'https://uncensoredaichat.ai/v1' },
    { id: 'nofilterai-ai', baseUrl: 'https://nofilterai.ai/v1' },
    { id: 'uncutgpt', baseUrl: 'https://uncutgpt.com/api/v1' },
    { id: 'uncensored-chat', baseUrl: 'https://uncensored.chat/api/v1' },
    { id: 'infernus-ai', baseUrl: 'https://infernus.ai/v1' },
    { id: 'cleus-ai', baseUrl: 'https://cleus.ai/api/v1' },
    { id: 'ablit-app', baseUrl: 'https://ablit.app/api/v1' },
    { id: 'abliteration-ai', baseUrl: 'https://api.abliteration.ai/v1' },
    { id: 'openuncensored', baseUrl: 'https://api.openuncensored.com/v1', defaultModel: 'abliterated-model' },
    { id: 'magmarouter', baseUrl: 'https://api.magmarouter.com/v1', defaultModel: 'glm-5.3-xploded' },
    { id: 'mancer-ai', baseUrl: 'https://neuro.mancer.tech/oai/v1', defaultModel: 'mythomax' },
    { id: 'infermatic-ai', baseUrl: 'https://api.infermatic.ai/v1' },
    { id: 'arli-ai', baseUrl: 'https://api.arliai.com/v1' },
    { id: 'redpill-ai', baseUrl: 'https://api.redpill.ai/v1', defaultModel: 'phala/deepseek-v4.1-flash-1017-uncensored' },
    { id: 'ppq-ai', baseUrl: 'https://api.ppq.ai/v1' },
    { id: 'akashml', baseUrl: 'https://api.akashml.com/v1' },
    { id: 'nous-research', baseUrl: 'https://inference-api.nousresearch.com/v1' },
    { id: 'tinfoil-sh', baseUrl: 'https://inference.tinfoil.sh/v1', defaultModel: 'deepseek-v4-1-flash' },
    { id: 'notrack-ai', baseUrl: 'https://notrack.ai/v1' },
    { id: 'gab-ai', baseUrl: 'https://gab.ai/v1', defaultModel: 'auto' },
    { id: 'unfilteredaimodels', baseUrl: 'https://api.unfilteredaimodels.com/v1' },
  ];

  for (const spec of expectedApis) {
    const prov = classified.find((p) => p.id === spec.id);
    assert.ok(prov, `${spec.id} must exist in catalog`);
    assert.equal(prov.securityClass, 'GELB', `${spec.id} must be classified as GELB`);
    assert.equal(prov.isUnfiltered, true, `${spec.id} must be tagged isUnfiltered=true`);
    assert.equal(isUsableGreenOrGelb(prov), true, `${spec.id} must be usable`);
    assert.equal(classifyConnectionKind(prov).supportsOpenAiEndpoints, true, `${spec.id} must support OpenAI endpoints`);
    const snips = buildConnectionSnippets(prov);
    assert.equal(snips.defaultApiBase, spec.baseUrl, `${spec.id} defaultApiBase mismatch`);
    assert.equal(validateInvokeTarget(prov, `${spec.baseUrl}/models`).ok, true, `${spec.id} invoke SSRF check failed`);
    const chatCheck = validateChatTarget({
      targetType: 'provider',
      providerId: spec.id,
      providers: classified,
      bridgeSelections: selections,
    });
    assert.equal(chatCheck.ok, true, `${spec.id} chat target validation failed`);
    if (chatCheck.ok) {
      assert.equal(chatCheck.baseUrl, spec.baseUrl);
    }
    if (spec.defaultModel) {
      assert.equal(resolveDefaultChatModel(spec.id), spec.defaultModel);
    }
  }

  const venice = classified.find((p) => p.id === 'venice-ai');
  assert.ok(venice, 'venice-ai must exist in catalog');
  assert.equal(venice.isUnfiltered, true, 'venice-ai must be tagged isUnfiltered=true');
  assert.equal(isUsableGreenOrGelb(venice), true);
  assert.equal(buildConnectionSnippets(venice).defaultApiBase, 'https://api.venice.ai/api/v1');
  assert.equal(validateInvokeTarget(venice, 'https://api.venice.ai/api/v1/models').ok, true);

  // SCHWARZ / illegal entries must never be marked as usable unfiltered options
  const schwarzItems = classified.filter((p) => p.securityClass === 'SCHWARZ');
  assert.ok(schwarzItems.length > 0);
  assert.ok(schwarzItems.every((p) => !p.isUnfiltered), 'SCHWARZ entries must never have isUnfiltered=true');

  const clsJson = JSON.parse(files.find((f) => f.path === 'classification.json')!.content) as {
    providers: Array<{ id: string; is_unfiltered?: boolean }>;
  };
  assert.equal(clsJson.providers.find((p) => p.id === 'openuncensored')?.is_unfiltered, true);

  const html = files.find((f) => f.path === 'gui/index.html')!;
  assert.ok(html.content.includes('https://api.venice.ai/api/v1'));
  assert.ok(html.content.includes('abliterated-model'));
  assert.ok(html.content.includes('abliteration-ai/abliterated-model'));
  assert.ok(html.content.includes('glm-5.3-xploded'));
  assert.ok(html.content.includes('mythomax'));
  assert.ok(html.content.includes('cls-unfiltered'));
  assert.ok(html.content.includes('chat-only-unfiltered'));
  assert.ok(html.content.includes('BRIDGE_VERIFIED_MODELS'));
  assert.ok(html.content.includes('chat-bridge-model'));
});

test('All 7 allowlisted bridges have exclusive verified active model dropdown lists without legacy/paid/default aliases', () => {
  const allowlisted = getAllowlistedBridgeRepos(selections);
  assert.equal(allowlisted.length, 7);

  const forbidden = new Set([
    'default',
    'deepseek-v3',
    'deepseek-r1',
    'deepseek-expert',
    'deepseek-v4-pro',
    'deepseek-vision',
    'claude-haiku-4-5',
    'gpt-5.4-nano',
    'mistral-small',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'gpt-4o',
    'gemini-2.5-flash',
  ]);

  for (const repo of allowlisted) {
    const models = BRIDGE_VERIFIED_MODELS[repo.bridgeId];
    assert.ok(Array.isArray(models) && models.length >= 2, `${repo.bridgeId} must have >= 2 verified models`);
    for (const m of models) {
      assert.ok(!forbidden.has(m.id), `${repo.bridgeId} must not include forbidden/legacy model ${m.id}`);
    }
    assert.equal(
      resolveDefaultChatModel(undefined, repo.bridgeId),
      models[0].id,
      `${repo.bridgeId} default model must equal first verified model`
    );
  }

  // Live filtering must strip "default", legacy DeepSeek aliases, and paid-only Duck.ai models
  const filteredDuck = resolveVerifiedBridgeModelOptions('duck2api', [
    'default',
    'gpt-5.4-mini',
    'claude-opus-5-5',
    'claude-haiku-5-5',
    'mistral-small',
  ]);
  assert.deepEqual(
    filteredDuck.map((m) => m.id),
    ['gpt-5.4-mini', 'claude-haiku-5-5']
  );

  const filteredDs = resolveVerifiedBridgeModelOptions('freedeepseekapi', [
    'deepseek-chat',
    'deepseek-v3',
    'deepseek-r1',
    'deepseek-reasoner',
  ]);
  assert.deepEqual(
    filteredDs.map((m) => m.id),
    ['deepseek-chat', 'deepseek-reasoner']
  );
});

test('Chutes & AION Labs resolve real OpenAI /v1 hosts (no HTML marketing page) and API-Key page resolver covers key-requiring providers safely', () => {
  const chutes = classified.find((p) => p.id === 'chutes')!;
  assert.ok(chutes, 'chutes must exist');
  assert.equal(buildConnectionSnippets(chutes).defaultApiBase, 'https://llm.chutes.ai/v1');
  assert.equal(validateInvokeTarget(chutes, 'https://llm.chutes.ai/v1/chat/completions').ok, true);
  assert.equal(resolveDefaultChatModel('chutes'), 'Qwen/Qwen3.8-27B-TEE');
  const chutesKeyPage = resolveProviderApiKeyPage(chutes);
  assert.equal(chutesKeyPage?.url, 'https://chutes.ai/app/settings/api-keys');
  assert.equal(chutesKeyPage?.isDirectKeyConsole, true);

  const aion = classified.find((p) => p.id === 'aionlabs')!;
  assert.ok(aion, 'aionlabs must exist');
  assert.equal(buildConnectionSnippets(aion).defaultApiBase, 'https://api.aionlabs.ai/v1');
  assert.equal(validateInvokeTarget(aion, 'https://api.aionlabs.ai/v1/models').ok, true);
  assert.equal(resolveDefaultChatModel('aionlabs'), 'aion-labs/aion-2.0');

  const groq = classified.find((p) => p.id.includes('groq') && p.securityClass === 'GRUEN')!;
  assert.ok(groq, 'a GRÜN groq provider must exist');
  assert.equal(resolveProviderApiKeyPage(groq)?.url, 'https://console.groq.com/keys');

  const ovh = classified.find((p) => p.id === 'ovh-ai-endpoints')!;
  assert.equal(resolveProviderApiKeyPage(ovh), null, 'Keyless providers (auth_typ=keine) must not show API-Key button');

  const schwarz = classified.find((p) => p.securityClass === 'SCHWARZ')!;
  assert.equal(resolveProviderApiKeyPage(schwarz), null, 'SCHWARZ entries must never expose external API-Key links');

  const html = files.find((f) => f.path === 'gui/index.html')!;
  assert.ok(html.content.includes('https://llm.chutes.ai/v1'));
  assert.ok(html.content.includes('https://chutes.ai/app/settings/api-keys'));
  assert.ok(html.content.includes('resolveApiKeyPage'));
});

test('Ablit default model fix + live-verified UplinkSwitch, Api.Airforce, and ElectronHub unfiltered mappings', () => {
  assert.equal(resolveDefaultChatModel('ablit-app'), 'ablit-flash');
  assert.equal(resolveDefaultChatModel('abliteration-ai'), 'abliterated-model');
  assert.equal(resolveDefaultChatModel('uplinkswitch'), 'abliterated-model');
  assert.equal(resolveDefaultChatModel('api-airforce'), 'llama-instant');
  assert.equal(resolveDefaultChatModel('electronhub'), 'gemma-4-uncensored:free');

  for (const spec of [
    { id: 'uplinkswitch', base: 'https://api.uplinkswitch.com/v1' },
    { id: 'api-airforce', base: 'https://api.airforce/v1' },
    { id: 'electronhub', base: 'https://api.electronhub.ai/v1' },
  ]) {
    const p = classified.find((x) => x.id === spec.id);
    assert.ok(p, `${spec.id} must exist in catalog`);
    assert.equal(p!.isUnfiltered, true, `${spec.id} must be flagged isUnfiltered`);
    assert.equal(buildConnectionSnippets(p!).defaultApiBase, spec.base);
    assert.ok(resolveProviderApiKeyPage(p!)?.url.startsWith('https://'));
  }

  const html = files.find((f) => f.path === 'gui/index.html')!;
  assert.ok(html.content.includes("'ablit-flash'"));
  assert.ok(html.content.includes('https://api.uplinkswitch.com/v1'));
});

test('extractChatCompletionReply cleanly extracts thinking traces from reasoning, reasoning_content, <think> tags, and SSE', () => {
  const ovhStyle = extractChatCompletionReply(
    {
      model: 'gpt-oss-20b',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'OK',
            reasoning: 'User requested OK only.',
          },
        },
      ],
    },
    ''
  );
  assert.equal(ovhStyle.reply, 'OK');
  assert.equal(ovhStyle.thinking, 'User requested OK only.');

  const tagStyle = extractChatCompletionReply(
    {
      model: 'qwen-thinking',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '<think>Step 1: check edge cases.</think>\nFinal answer: 42',
          },
        },
      ],
    },
    ''
  );
  assert.equal(tagStyle.reply, 'Final answer: 42');
  assert.equal(tagStyle.thinking, 'Step 1: check edge cases.');

  const sseReason = extractChatCompletionReply(
    null,
    'data: {"choices":[{"delta":{"reasoning_content":"Plan A"}}]}\ndata: {"choices":[{"delta":{"content":"Done"}}]}\ndata: [DONE]\n'
  );
  assert.equal(sseReason.reply, 'Done');
  assert.equal(sseReason.thinking, 'Plan A');
});

test('Coding-Studio workspace helper enforces strict path confinement, blocks secrets/bridges, and restricts writes to coding-workspace/', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-studio-test-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'bridges'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 'index.ts'), 'export const ok = true;\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, '.env'), 'SECRET=123\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, 'bridges', 'deepseek-auth.json'), '{"cookie":"x"}', 'utf8');

    assert.equal(resolveSafeWorkspacePath(tmpRoot, '../etc/passwd').ok, false);
    assert.equal(resolveSafeWorkspacePath(tmpRoot, '.env').ok, false);
    assert.equal(resolveSafeWorkspacePath(tmpRoot, 'bridges/deepseek-auth.json').ok, false);
    assert.equal(readSafeWorkspaceFile(tmpRoot, '.env').ok, false);

    const tree = scanSafeWorkspaceTree(tmpRoot);
    assert.equal(tree.ok, true);
    if (tree.ok) {
      const names = tree.tree.map((n) => n.name);
      assert.ok(names.includes('src'));
      assert.ok(!names.includes('.env'));
      assert.ok(!names.includes('bridges'));
    }

    const readOk = readSafeWorkspaceFile(tmpRoot, 'src/index.ts');
    assert.equal(readOk.ok, true);
    if (readOk.ok) {
      assert.equal(readOk.writable, false);
      assert.equal(readOk.language, 'typescript');
    }

    const writeOk = writeSafeCodingSandboxFile(tmpRoot, 'demo/hello.ts', 'console.log("hi");\n');
    assert.equal(writeOk.ok, true);
    if (writeOk.ok) {
      assert.equal(writeOk.path, 'coding-workspace/demo/hello.ts');
      const reread = readSafeWorkspaceFile(tmpRoot, writeOk.path);
      assert.equal(reread.ok, true);
      if (reread.ok) {
        assert.equal(reread.writable, true);
        assert.equal(reread.content, 'console.log("hi");\n');
      }
    }

    assert.equal(writeSafeCodingSandboxFile(tmpRoot, '../escape.ts', 'bad').ok, false);
    assert.equal(writeSafeCodingSandboxFile(tmpRoot, '.env.local', 'bad').ok, false);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

import {
  formatMessagesAsChatMl,
  parseGradioSseOutput,
  validateCloudTunnelUrl,
} from './codingProviders.ts';
import {
  buildOpenAiToolSchemas,
  executeCodingTool,
  extractReActToolCalls,
} from './codingTools.ts';
import {
  buildCloudNotebookIpynb,
  CODING_TOOL_DEFINITIONS,
  type CodingToolId,
} from './codingTypes.ts';

test('CodingProviders: Cloud-GPU tunnel validation enforces strict HTTPS allowlist & blocks SSRF/credentials', () => {
  const cf = validateCloudTunnelUrl('https://cool-llama-123.trycloudflare.com');
  assert.equal(cf.ok, true);
  if (cf.ok) assert.equal(cf.baseUrl, 'https://cool-llama-123.trycloudflare.com/v1');

  const ngrok = validateCloudTunnelUrl('https://demo.ngrok-free.app/v1/');
  assert.equal(ngrok.ok, true);
  if (ngrok.ok) assert.equal(ngrok.baseUrl, 'https://demo.ngrok-free.app/v1');

  const local = validateCloudTunnelUrl('http://127.0.0.1:11434/v1');
  assert.equal(local.ok, true);

  assert.equal(validateCloudTunnelUrl('http://cool-llama.trycloudflare.com/v1').ok, false);
  assert.equal(validateCloudTunnelUrl('https://169.254.169.254/latest/meta-data').ok, false);
  assert.equal(validateCloudTunnelUrl('https://192.168.1.50/v1').ok, false);
  assert.equal(validateCloudTunnelUrl('https://evil.example.com/v1').ok, false);
  assert.equal(validateCloudTunnelUrl('https://user:pass@cool.trycloudflare.com/v1').ok, false);
});

test('CodingProviders: Gradio SSE parser handles Muse-Glimmer reasoning, Gemma-4 history, and error events', () => {
  const museSse = [
    'event: generating',
    'data: [{"reasoning":"Plan...","content":""}]',
    'event: complete',
    'data: [{"reasoning":"Step 1: add a+b.","content":"def add(a, b):\\n    return a + b","stats":{"tok_per_sec":25.4}}]',
  ].join('\n');
  const museParsed = parseGradioSseOutput(museSse);
  assert.equal(museParsed.ok, true);
  assert.equal(museParsed.thinking, 'Step 1: add a+b.');
  assert.ok(museParsed.reply?.includes('def add(a, b):'));
  assert.equal(museParsed.stats?.tok_per_sec, 25.4);

  const gemmaSse = [
    'event: complete',
    'data: [[{"role":"user","content":[{"text":"hi"}]},{"role":"assistant","metadata":{"title":"Thinking"},"content":[{"text":"Check types"}]},{"role":"assistant","metadata":null,"content":[{"text":"const x = 1;"}]}]]',
  ].join('\n');
  const gemmaParsed = parseGradioSseOutput(gemmaSse);
  assert.equal(gemmaParsed.ok, true);
  assert.equal(gemmaParsed.thinking, 'Check types');
  assert.equal(gemmaParsed.reply, 'const x = 1;');

  const errSse = 'event: error\ndata: {"error":"ZeroGPU quota exceeded"}\n';
  const errParsed = parseGradioSseOutput(errSse);
  assert.equal(errParsed.ok, false);
  assert.ok(errParsed.error?.includes('ZeroGPU quota'));

  const chatMl = formatMessagesAsChatMl([
    { role: 'system', content: 'Sys' },
    { role: 'user', content: 'Hi' },
  ]);
  assert.ok(chatMl.includes('<|im_start|>system\nSys<|im_end|>'));
  assert.ok(chatMl.endsWith('<|im_start|>assistant\n'));
});

test('CodingTools & Cloud Notebook Generator: sandboxed tool execution, ReAct extraction, and valid .ipynb output', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-tools-test-'));
  try {
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 'math.ts'), 'export function sum(a: number, b: number) { return a + b; }\n', 'utf8');
    fs.writeFileSync(path.join(tmpRoot, '.env'), 'API_SECRET=topsecret\n', 'utf8');

    const allEnabled = new Set<CodingToolId>(CODING_TOOL_DEFINITIONS.map((t) => t.id));
    assert.equal(buildOpenAiToolSchemas(allEnabled).length, 5);

    const ctx = { rootDir: tmpRoot, activeProject: null, enabledTools: allEnabled };

    const listRes = executeCodingTool('list_workspace_files', { dir: '' }, ctx);
    assert.equal(listRes.event.ok, true);
    assert.ok(listRes.outputText.includes('src/'));
    assert.ok(!listRes.outputText.includes('.env'));

    const searchRes = executeCodingTool('search_workspace', { query: 'function sum' }, ctx);
    assert.equal(searchRes.event.ok, true);
    assert.ok(searchRes.outputText.includes('src/math.ts'));

    const secretRead = executeCodingTool('read_workspace_file', { path: '.env' }, ctx);
    assert.equal(secretRead.event.ok, false);

    const writeRes = executeCodingTool(
      'write_sandbox_file',
      { path: 'generated/test.ts', content: 'export const ok = 42;\n' },
      ctx
    );
    assert.equal(writeRes.event.ok, true);
    assert.equal(writeRes.writtenFilePath, 'coding-workspace/generated/test.ts');

    // Disabled tool must be blocked
    const disabledCtx = { rootDir: tmpRoot, activeProject: null, enabledTools: new Set<CodingToolId>(['list_workspace_files']) };
    const blockedWrite = executeCodingTool('write_sandbox_file', { path: 'x.ts', content: 'no' }, disabledCtx);
    assert.equal(blockedWrite.event.ok, false);

    const calls = extractReActToolCalls(
      'Ich prüfe erst die Datei.\n<tool_call>{"name":"read_workspace_file","arguments":{"path":"src/math.ts"}}</tool_call>'
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'read_workspace_file');
    assert.equal(calls[0].arguments.path, 'src/math.ts');

    const ipynbRaw = buildCloudNotebookIpynb('kaggle', 'huihui_ai/qwen3-coder-abliterated');
    const ipynb = JSON.parse(ipynbRaw) as { nbformat: number; cells: Array<{ source: string[] }> };
    assert.equal(ipynb.nbformat, 4);
    assert.ok(ipynb.cells[1].source.join('').includes('ollama pull huihui_ai/qwen3-coder-abliterated'));
    assert.ok(ipynb.cells[1].source.join('').includes('trycloudflare'));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

import { splitThinkingFromText } from './chatEngine.ts';
import { isLikelyTruncatedOutput } from './codingProviders.ts';
import { shouldOfferReActTools } from './codingTools.ts';
import { extractCodeBlocksWithPaths } from './codingTypes.ts';

test('splitThinkingFromText separates closed and unclosed <think> blocks cleanly', () => {
  const closed = splitThinkingFromText('<think>Plan A</think>\nconst x = 1;');
  assert.equal(closed.thinking, 'Plan A');
  assert.equal(closed.reply, 'const x = 1;');

  const unclosed = splitThinkingFromText('<think>Analyse ohne Schluss-Tag...');
  assert.ok(unclosed.thinking?.includes('Analyse ohne Schluss-Tag...'));
  assert.ok(unclosed.thinking?.includes('Token-Limit'));
  assert.ok(!unclosed.reply.includes('<think>'));
});

test('Gradio null-error text & ReAct casual-greeting guard prevent wasted AI Horde tool rounds', () => {
  const nullErr = parseGradioSseOutput('event: error\ndata: {"error": null}\n');
  assert.equal(nullErr.ok, false);
  assert.ok(nullErr.error?.includes('internen Serverfehler'));
  assert.ok(!nullErr.error?.startsWith('{"error":null}'));

  assert.equal(shouldOfferReActTools('hi'), false);
  assert.equal(shouldOfferReActTools('jo'), false);
  assert.equal(shouldOfferReActTools('i'), false);
  assert.equal(shouldOfferReActTools('hallo!'), false);
  assert.equal(shouldOfferReActTools('Lies bitte src/App.tsx'), true);
  assert.equal(shouldOfferReActTools('Schreibe eine Funktion clamp in coding-workspace/math.ts'), true);
});

test('isLikelyTruncatedOutput and extractCodeBlocksWithPaths handle AI Horde cutoffs & sandbox files', () => {
  // Unclosed code fence -> truncated
  assert.equal(isLikelyTruncatedOutput('Hier ist Code:\n```python\ndef check_port(self, ip,', 512), true);
  // Short finished reply -> NOT truncated
  assert.equal(isLikelyTruncatedOutput('Hallo! Wie kann ich dir helfen?', 512), false);
  // Closed code block -> NOT truncated
  assert.equal(isLikelyTruncatedOutput('Fertig:\n```ts\nexport const x = 1;\n```', 512), false);
  // Mid-word cutoff near token budget -> truncated
  assert.equal(isLikelyTruncatedOutput(`${'a '.repeat(260)}Möchtest du die vollst`, 128), true);

  // Extract multiple code blocks with inferred safe coding-workspace/ paths (and ignore single/double-dash ASCII trees & ../)
  const md = [
    '```code',
    'my_app/',
    '├─ src/',
    '└─ README.md',
    '```',
    '',
    '### 2.1 backend/package.json',
    '```json',
    '{"name":"demo"}',
    '```',
    '',
    '```python:../escape.py',
    '# sandbox/demo.py',
    'print("ok")',
    '```',
    '',
    '### 2.3 backend/src/routes/tutorials.ts',
    '```ts',
    'export const partial = true;',
  ].join('\n');

  const extracted = extractCodeBlocksWithPaths(md);
  assert.equal(extracted.length, 3);
  assert.equal(extracted[0].path, 'coding-workspace/backend/package.json');
  assert.equal(extracted[0].fenceIndex, 1);
  assert.equal(extracted[1].path, 'coding-workspace/sandbox/demo.py');
  assert.equal(extracted[1].fenceIndex, 2);
  assert.equal(extracted[2].path, 'coding-workspace/backend/src/routes/tutorials.ts');
  assert.equal(extracted[2].fenceIndex, 3);
});


