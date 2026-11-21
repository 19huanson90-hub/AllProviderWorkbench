import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  extractChatCompletionReply,
  extractModelIds,
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
});

