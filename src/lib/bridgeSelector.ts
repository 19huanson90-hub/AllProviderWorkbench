import type {
  BridgeCandidateEvaluation,
  BridgeSelectionEntry,
  ClassifiedProvider,
} from './types.ts';

interface CuratedBridgeMeta {
  targets: string[];
  activeUnder6Months: boolean | null;
  locallySelfHosted: boolean;
  documentedAuth: boolean;
  dockerCompatibleWin11: boolean;
  riskLevel: 'mittel' | 'hoch' | 'illegal' | 'unklar';
  authWay: string;
  note: string;
}

/**
 * Curated evidence extracted strictly from ai_provider(2).txt (reference date: Nov 2026).
 * Unknown values remain null — no invented stars or commit dates.
 */
const BRIDGE_META: Record<string, CuratedBridgeMeta> = {
  qwengate: {
    targets: ['Qwen'],
    activeUnder6Months: true, // Push 21.08.2026 (< 6 Mo)
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'mittel',
    authWay: 'Playwright Browser-Session (lokaler Login auf chat.qwen.ai, Cookie im Container-Volume)',
    note: 'MIT-Lizenz, 210 Stars, Push 21.08.2026, aktiv gepflegt, einzelner lokaler Web-Account.',
  },
  'openai-api-server-via-codex': {
    targets: ['ChatGPT'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'mittel',
    authWay: 'OAuth / CLI-Login über `codex login` mit eigenem ChatGPT-Konto (Token in lokaler Config)',
    note: 'Go-Server (Apache-2.0, Docker-Image/Binary), nutzt regulären Codex-Login-Flow statt Fragile-Cookie-Scraping oder Multi-Account-Pool.',
  },
  'gpt-web-gateway': {
    targets: ['ChatGPT'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Headless Patchright/Chrome Browser-Session',
    note: 'MIT-Lizenz, nutzt Stealth-Browser-Automation (Patchright); höheres Erkennungs-/Sperrrisiko als Codex-OAuth-Flow.',
  },
  'codex-lb': {
    targets: ['ChatGPT'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'OAuth Multi-Account-Pool (Dashboard mit Passwort + TOTP)',
    note: 'Zwar 3,4k Stars, aber ausdrücklich Multi-Account-Pooling → höheres ToS-/Sperrrisiko (Kriterium 4: höchste Stars nur bei vergleichbarem Risiko).',
  },
  'chatgpt-web-provider': {
    targets: ['ChatGPT'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Lokaler Browser-Worker + Bearer/X-API-Key vor Web-Session',
    note: 'Browser-Automation vor ChatGPT-Web; geringere Reife und höheres Risiko als openai-api-server-via-codex.',
  },
  'chatgpt-bridge': {
    targets: ['ChatGPT'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: false,
    riskLevel: 'hoch',
    authWay: 'Tampermonkey-Userscript im offenen Desktop-Browser + lokales FastAPI-Backend',
    note: 'Benötigt aktiven Desktop-Browsertab mit Userscript; nicht sauber als isolierter Docker-Container betreibbar.',
  },
  zerokey: {
    targets: ['ChatGPT'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: false,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Lokale ChatGPT-Web-Subskription (Auth/Lizenz im Repo unklar)',
    note: 'Fehlende LICENSE-Datei (404 laut Katalog) und geringere Dokumentation.',
  },
  chat2api: {
    targets: ['ChatGPT'],
    activeUnder6Months: false,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'AccessToken / Session-Cookie',
    note: 'Veraltet / instabil gegenüber aktuellen ChatGPT-Web-Änderungen.',
  },
  ninja: {
    targets: ['ChatGPT'],
    activeUnder6Months: false, // 04.03.2024 (~32 Mo)
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Session-Cookie',
    note: 'Projekt laut README beendet ("Project has ended", letzter Commit 04.03.2024 — ~32 Monate inaktiv).',
  },
  'catgpt-gateway': {
    targets: ['Claude', 'ChatGPT'],
    activeUnder6Months: true, // Commit 14.09.2026
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Docker-Container mit einmaligem noVNC-Browser-Erstlogin (Patchright Stealth-Session)',
    note: 'MIT-Lizenz, 316 Stars, aktiv (Commit 14.09.2026), klar dokumentierter Docker+noVNC-Auth-Workflow für Claude.',
  },
  claude2api: {
    targets: ['Claude'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Manuell extrahierter Claude-Session-Cookie (sessionKey)',
    note: 'Ungeklärte Lizenz / höheres Bruchrisiko durch direktes Reverse-Engineering von Claude-Web-Endpunkten gegenüber catgpt-gateway.',
  },
  'webai-to-api': {
    targets: ['Gemini'],
    activeUnder6Months: true, // Commit 01.11.2026
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Playwright-Erstlogin (`verify_login.py`) + lokaler Cookie-Cache (`__Secure-1PSID`)',
    note: 'MIT-Lizenz, ~1.4k Stars (höchste Stars im Gemini-Segment), Commit 01.11.2026, aktiv gepflegt, lokal betreibbar.',
  },
  'gemini-web2api-go': {
    targets: ['Gemini'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Cookie-Pool aus Google-Websessions (`__Secure-1PSID` / `__Secure-1PSIDTS`)',
    note: '780 Stars (MIT), aber weniger Stars als webai-to-api (~1.4k Stars) und stark auf Cookie-Pooling ausgerichtet.',
  },
  'gemini-web2api': {
    targets: ['Gemini'],
    activeUnder6Months: true, // ~2.5 Monate
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Google-Session-Cookies',
    note: 'Kleinere Community als webai-to-api bei vergleichbarem ToS-Risiko.',
  },
  'gemini-web-to-api': {
    targets: ['Gemini'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Aus dem Browser entnommene Gemini-Session-Cookies',
    note: 'Geringere Community-Verbreitung / Commit-Aktivität im Katalog nicht belegt gegenüber webai-to-api.',
  },
  freedeepseekapi: {
    targets: ['DeepSeek'],
    activeUnder6Months: true, // Commit 07.10.2026
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'mittel',
    authWay: 'Lokaler DeepSeek-Web-Login / Browser-Session-Token',
    note: 'Aktiv gepflegt, lokal, OpenAI- und Anthropic-kompatible Endpunkte; geringeres Risiko als Multi-Account-Pool / Fingerprint-Emulation.',
  },
  'ds-free-api': {
    targets: ['DeepSeek'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Session-Cookie Multi-Account-Pool im Web-Admin-Panel',
    note: 'Multi-Account-Pool + Risk-Control-/Fingerprint-Emulation → höheres ToS-Risiko als freedeepseekapi.',
  },
  'grok-com-to-openai': {
    targets: ['Grok'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Session-Cookie (`sso` / `sso-rw`) aus eigenem grok.com-Konto',
    note: 'Einziger dedizierter Grok-Web-Proxy im Katalog (FastAPI, lokal); ACHTUNG: hohes ToS-Risiko & fehlende LICENSE-Angabe im Katalog.',
  },
  duck2api: {
    targets: ['DuckDuckGo AI'],
    activeUnder6Months: true,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'mittel',
    authWay: 'Kein Account erforderlich (`auth_typ: keine`, anonyme DuckDuckGo-AI-Session)',
    note: 'Go-Proxy (MIT), lokal per Docker ausführbar, kein Benutzerkonto nötig.',
  },
  'composer-api': {
    targets: ['Cursor'],
    activeUnder6Months: true, // Push 12.08.2026
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: false, // macOS-App laut Katalog!
    riskLevel: 'mittel',
    authWay: 'Lokaler API-Key / Cursor-Sitzung über macOS-App (`localhost/v1`)',
    note: 'MIT, 348 Stars, Push 12.08.2026 — ABER laut Katalog explizit eine macOS-App; NICHT als Windows-11-Docker-Container lauffähig.',
  },
  'copilot-api': {
    targets: ['GitHub Copilot'],
    activeUnder6Months: false, // 10.11.2025 (~12 Mo inaktiv)
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'GitHub OAuth Device Flow (Copilot-Abo)',
    note: 'Abgelehnt: letzter Push > 6 Monate zurück (Kriterium 1 verletzt) und hohes Risiko einer GitHub-Kontosperrung.',
  },
  llms2api: {
    targets: ['ChatGPT', 'DeepSeek', 'Qwen', 'Claude'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Browser-Session für mehrere Web-Chats',
    note: 'Multi-Site-Bridge mit geringerer Spezialisierung/Dokumentation als die jeweiligen Single-Provider-Gewinner.',
  },
  webmodel: {
    targets: ['Claude', 'ChatGPT', 'DeepSeek'],
    activeUnder6Months: false,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Dashboard-Login für 11 Websessions',
    note: 'Inaktiv (> 6 Monate) und im Quelldatensatz doppelt vorhanden (`webmodel` & `web-model-bridge`).',
  },
  'web-model-bridge': {
    targets: ['Claude', 'ChatGPT', 'DeepSeek'],
    activeUnder6Months: false,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: true,
    riskLevel: 'hoch',
    authWay: 'Playwright-Dashboard-Login (Duplikat zu `webmodel`)',
    note: 'Duplikat zu `webmodel` (identische URL github.com/linuxhsj/WebModel), > 6 Monate inaktiv.',
  },
  'browser-llm-bridge': {
    targets: ['ChatGPT'],
    activeUnder6Months: null,
    locallySelfHosted: true,
    documentedAuth: true,
    dockerCompatibleWin11: false,
    riskLevel: 'mittel',
    authWay: 'Lokaler Node.js-PoC mit Browser-Tab',
    note: 'Experimenteller Proof-of-Concept ohne aktive Produktionsreife.',
  },
};

interface TargetSelectionPlan {
  zielprovider: string;
  winnerId: string | null;
  port: number | null;
  dockerService: string | null;
  dockerCapable: boolean;
  begruendung: string;
  restrisiko: string;
  auth_weg: string;
}

const TARGET_PLANS: TargetSelectionPlan[] = [
  {
    zielprovider: 'Qwen',
    winnerId: 'qwengate',
    port: 8101,
    dockerService: 'bridge-qwen',
    dockerCapable: true,
    begruendung:
      '[Belegt] Einzige spezialisierte, aktiv gepflegte Qwen-Bridge (MIT, 210 Stars, Push 21.08.2026 < 6 Mo.), lokal selbst gehostet per Playwright.',
    restrisiko:
      'MITTEL–HOCH (Klasse ROT): Automatisierter Zugriff auf chat.qwen.ai verstößt typischerweise gegen Web-ToS; Risiko von Captcha-Blockaden oder Kontosperrung. Nur mit Wegwerf-Konto und auf 127.0.0.1 betreiben.',
    auth_weg:
      'Playwright-Browser-Session (Erstlogin auf chat.qwen.ai; Session-Cookie über ENV `QWEN_SESSION_COOKIE=<DEIN_COOKIE>` bzw. persistentes Container-Profil).',
  },
  {
    zielprovider: 'ChatGPT',
    winnerId: 'openai-api-server-via-codex',
    port: 8102,
    dockerService: 'bridge-chatgpt',
    dockerCapable: true,
    begruendung:
      '[Belegt] Apache-2.0 Go-Server (Docker-fähig), nutzt regulären `codex login`-Flow statt fragiler Cookie-Extraktion oder Multi-Account-Pooling (`codex-lb` hat zwar 3,4k Stars, aber höheres Risiko durch Multi-Account-Pool; `ninja`/`chat2api` sind veraltet).',
    restrisiko:
      'MITTEL–HOCH (Klasse ROT): Nutzung eines privaten ChatGPT-Web-/Codex-Abos als lokaler API-Server liegt außerhalb der regulären OpenAI-Platform-API-Nutzung; Kontosperrung möglich. Keine kommerzielle Nutzung, nur eigenes Wegwerf-/Testkonto.',
    auth_weg:
      'Interaktiver `codex login` (OAuth) im Container oder Übergabe des lokalen Auth-Tokens über `CHATGPT_CODEX_TOKEN=<DEIN_KEY>` (niemals committen).',
  },
  {
    zielprovider: 'Claude',
    winnerId: 'catgpt-gateway',
    port: 8103,
    dockerService: 'bridge-claude',
    dockerCapable: true,
    begruendung:
      '[Belegt] MIT-Lizenz, 316 Stars, aktiv gepflegt (Commit 14.09.2026 < 6 Mo.), selbst gehosteter Docker-Container mit dokumentiertem noVNC-Erstlogin. Schlägt das inaktive `webmodel` (~7 Mo.) und das unlizenzierte `claude2api`.',
    restrisiko:
      'HOCH (Klasse ROT): Stealth-Browser-Automatisierung (Patchright) gegen claude.ai verstößt gegen Anthropic Consumer Terms; hohes Risiko einer sofortigen Kontosperrung. Nur mit separatem Testkonto auf 127.0.0.1.',
    auth_weg:
      'Einmaliger manueller Browser-Login über lokales noVNC-Interface (`127.0.0.1:8193`, nur Loopback) oder Session-Datei `CLAUDE_SESSION_COOKIE=<DEIN_COOKIE>`.',
  },
  {
    zielprovider: 'Gemini',
    winnerId: 'webai-to-api',
    port: 8104,
    dockerService: 'bridge-gemini',
    dockerCapable: true,
    begruendung:
      '[Belegt] MIT-Lizenz, ~1.4k Stars (höchste Verbreitung im Gemini-Segment), Commit 01.11.2026 (< 6 Mo.), lokal selbst gehostet. Schlägt `gemini-web2api-go` (780 Stars, Cookie-Pool) und `gemini-web2api`.',
    restrisiko:
      'HOCH (Klasse ROT): Reverse-Engineering/Browser-Automatisierung der Gemini-Weboberfläche verletzt Google Terms of Service; Risiko von Account-Einschränkungen. Hinweis: Offizielle Google-AI-Studio-API (GRÜN) ist ausdrücklich vorzuziehen.',
    auth_weg:
      'Einmaliger Playwright-Login (`verify_login.py`) oder lokale Übergabe von `GEMINI_SECURE_1PSID=<DEIN_COOKIE>` und `GEMINI_SECURE_1PSIDTS=<DEIN_COOKIE>`.',
  },
  {
    zielprovider: 'DeepSeek',
    winnerId: 'freedeepseekapi',
    port: 8105,
    dockerService: 'bridge-deepseek',
    dockerCapable: true,
    begruendung:
      '[Belegt] Aktiv gepflegter lokaler Proxy mit OpenAI- und Anthropic-kompatiblen Endpunkten. Schlägt `ds-free-api`, das auf Multi-Account-Pooling und Fingerprint-Emulation setzt (höheres Risiko), sowie das inaktive `webmodel`.',
    restrisiko:
      'MITTEL–HOCH (Klasse ROT): Unoffizielle Nutzung des DeepSeek-Web-Chats verstößt gegen Web-ToS; API-Änderungen oder Account-Sperren jederzeit möglich. Datenabfluss an chinesische Server beachten (keine sensiblen Daten).',
    auth_weg:
      'DeepSeek-Web-Session-Token aus eigenem Testkonto über ENV `DEEPSEEK_USER_TOKEN=<DEIN_COOKIE>`.',
  },
  {
    zielprovider: 'Grok',
    winnerId: 'grok-com-to-openai',
    port: 8106,
    dockerService: 'bridge-grok',
    dockerCapable: true,
    begruendung:
      '[Belegt] Einzige dedizierte, lokal selbst gehostete FastAPI-Bridge für grok.com im Katalog. ACHTUNG: Lizenzstatus und letztes Commit-Datum im Katalog nicht vollständig verifiziert — nur mit ausdrücklichem Vorbehalt im Opt-in-Profil `tos-risk`.',
    restrisiko:
      'HOCH (Klasse ROT): Anti-Bot-Header-Umgehung und fehlende LICENSE-Datei im Repo; hohes ToS- und Urheberrechts-/Lizenzrisiko. Einsatz nur nach eigener Repo-Prüfung und ausschließlich mit Wegwerf-Konto.',
    auth_weg:
      'Session-Cookies aus eigenem grok.com-Testkonto über ENV `GROK_SSO_COOKIE=<DEIN_COOKIE>` und `GROK_SSO_RW_COOKIE=<DEIN_COOKIE>`.',
  },
  {
    zielprovider: 'DuckDuckGo AI',
    winnerId: 'duck2api',
    port: 8107,
    dockerService: 'bridge-duckduckgo',
    dockerCapable: true,
    begruendung:
      '[Belegt] Go-Proxy (MIT-Lizenz), aktiv gepflegt, lokal selbst gehostet per Docker, benötigt kein Benutzerkonto (`auth_typ: keine`).',
    restrisiko:
      'MITTEL (Klasse ROT): Unoffizieller Reverse-Proxy gegen DuckDuckGo AI Chat; IP-Rate-Limits oder Endpunkt-Änderungen jederzeit möglich, aber kein persönliches Konto gefährdet.',
    auth_weg:
      'Kein Account erforderlich (`auth_typ: keine`); optional lokaler Zugangsschutz über `DUCK2API_AUTH_KEY=<DEIN_KEY>`.',
  },
  {
    zielprovider: 'Cursor',
    winnerId: 'composer-api',
    port: null,
    dockerService: null,
    dockerCapable: false,
    begruendung:
      '[Belegt] MIT-Lizenz, 348 Stars, Push 12.08.2026 (< 6 Mo.), lokal selbst gehostet. WICHTIG (Regel 7 / Faktentreue): Laut Katalog eine reine macOS-App — wird daher NICHT in die Windows-11 `docker-compose.yml` aufgenommen.',
    restrisiko:
      'MITTEL–HOCH (Klasse ROT): Exponiert Cursor-First-Party-Modelle außerhalb der IDE (ToS-Konflikt). Auf Windows 11 mangels macOS-Runtime nicht direkt containerisierbar.',
    auth_weg:
      'Lokale macOS-App mit eigenem Cursor-Account und lokalem API-Key (`CURSOR_COMPOSER_KEY=<DEIN_KEY>`). Auf Windows 11 nicht verfügbar.',
  },
  {
    zielprovider: 'GitHub Copilot',
    winnerId: null,
    port: null,
    dockerService: null,
    dockerCapable: false,
    begruendung:
      '[Belegt] KEINE Bridge ausgewählt: Der einzige Kandidat `copilot-api` liegt > 6 Monate ohne Commit zurück (letzter Push 10.11.2025 gegenüber Nov. 2026) und verletzt damit Kriterium 1 (aktiv gepflegt < 6 Monate) bei gleichzeitig hohem GitHub-Account-Sperrrisiko.',
    restrisiko:
      'HOCH: Sperrung eines GitHub-Hauptkontos hätte gravierende Folgen. Empfohlene GRÜNE Alternative: Offizielle GitHub Models API (`https://models.github.ai`).',
    auth_weg: 'Nicht integriert (Kriterien nicht erfüllt).',
  },
];

export function consolidateBridges(providers: ClassifiedProvider[]): {
  selections: BridgeSelectionEntry[];
  excludedEntries: BridgeCandidateEvaluation[];
  totalBridgeCategoryCount: number;
} {
  const bridgeCatProviders = providers.filter((p) => p.isBridgeCategory);
  const byId = new Map<string, ClassifiedProvider>();
  for (const p of providers) {
    byId.set(p.id, p);
  }

  const excludedEntries: BridgeCandidateEvaluation[] = [];
  const candidatesByTarget = new Map<string, BridgeCandidateEvaluation[]>();

  for (const p of bridgeCatProviders) {
    // Hard Rule 1: illegal or anonym_pseudo_key MUST NEVER be integrated
    if (p.isIllegal || p.isAnonymPseudoKey) {
      excludedEntries.push({
        id: p.id,
        name: p.name,
        url: '[GESPERRT – REGEL 1]',
        targetProviders: [],
        stars: p.starsExtracted,
        lastCommitText: p.lastCommitText,
        activeUnder6Months: null,
        locallySelfHosted: false,
        documentedAuth: false,
        dockerCompatibleWin11: false,
        riskLevel: 'illegal',
        authWay: 'Gesperrt (Regel 1)',
        selected: false,
        decisionReason:
          'Ausgeschlossen nach Harter Regel 1 (illegal / anonym_pseudo_key) — niemals testen, containerisieren oder integrieren.',
      });
      continue;
    }

    // Generic automation frameworks (Stagehand, Skyvern, Browser Use, Patchright, etc.)
    if (p.isGenericAutomationTool) {
      excludedEntries.push({
        id: p.id,
        name: p.name,
        url: p.url,
        targetProviders: [],
        stars: p.starsExtracted,
        lastCommitText: p.lastCommitText,
        activeUnder6Months: true,
        locallySelfHosted: true,
        documentedAuth: true,
        dockerCompatibleWin11: true,
        riskLevel: 'mittel',
        authWay: p.auth_typ,
        selected: false,
        decisionReason:
          'Kein zielprovider-spezifischer Webclient-Proxy, sondern allgemeines Browser-Automations-/RE-Framework (Klasse GELB).',
      });
      continue;
    }

    // Hosted third-party mirrors or broad unstable multi-provider scrapers
    if (p.id === 'hf-spaces-g4f-mirrors' || p.id === 'gpt4free' || p.id === 'freebuff-proxy') {
      const reason =
        p.id === 'hf-spaces-g4f-mirrors'
          ? 'Ausgeschlossen (Kriterium 2): Gehosteter Drittanbieter-Mirror auf HuggingFace Spaces — Prompts fließen über anonyme Fremdinfrastruktur.'
          : p.id === 'gpt4free'
            ? 'Ausgeschlossen: Instabiler Multi-Provider-Aggregator mit historischer C&D-/ToS-Konfliktlage und wechselnden Dritt-Proxys statt dedizierter Single-Provider-Bridge.'
            : 'Ausgeschlossen: Reverse-Proxy für chinesischen Free-Relay-Dienst (Freebuff), kein direkter Zielprovider-Webclient.';

      excludedEntries.push({
        id: p.id,
        name: p.name,
        url: p.url,
        targetProviders: [],
        stars: p.starsExtracted,
        lastCommitText: p.lastCommitText,
        activeUnder6Months: p.id !== 'hf-spaces-g4f-mirrors',
        locallySelfHosted: p.id !== 'hf-spaces-g4f-mirrors',
        documentedAuth: false,
        dockerCompatibleWin11: false,
        riskLevel: 'hoch',
        authWay: p.auth_typ,
        selected: false,
        decisionReason: reason,
      });
      continue;
    }

    const meta = BRIDGE_META[p.id];
    if (!meta) {
      excludedEntries.push({
        id: p.id,
        name: p.name,
        url: p.url,
        targetProviders: [],
        stars: p.starsExtracted,
        lastCommitText: p.lastCommitText,
        activeUnder6Months: null,
        locallySelfHosted: p.kategorien.includes('lokal_self_hosted'),
        documentedAuth: Boolean(p.auth_typ && p.auth_typ !== 'unbekannt'),
        dockerCompatibleWin11: false,
        riskLevel: 'unklar',
        authWay: p.auth_typ,
        selected: false,
        decisionReason: 'Keinem Standard-Zielprovider eindeutig zuordenbar oder Metadaten unvollständig.',
      });
      continue;
    }

    for (const target of meta.targets) {
      const plan = TARGET_PLANS.find((tp) => tp.zielprovider === target);
      const isWinner = plan?.winnerId === p.id;
      const evalEntry: BridgeCandidateEvaluation = {
        id: p.id,
        name: p.name,
        url: p.url,
        targetProviders: meta.targets,
        stars: p.starsExtracted,
        lastCommitText: p.lastCommitText,
        activeUnder6Months: meta.activeUnder6Months,
        locallySelfHosted: meta.locallySelfHosted,
        documentedAuth: meta.documentedAuth,
        dockerCompatibleWin11: meta.dockerCompatibleWin11,
        riskLevel: meta.riskLevel,
        authWay: meta.authWay,
        selected: isWinner,
        decisionReason: meta.note,
      };

      const list = candidatesByTarget.get(target) ?? [];
      list.push(evalEntry);
      candidatesByTarget.set(target, list);
    }
  }

  const selections: BridgeSelectionEntry[] = TARGET_PLANS.map((plan) => {
    const winner = plan.winnerId ? byId.get(plan.winnerId) : undefined;
    const candidates = (candidatesByTarget.get(plan.zielprovider) ?? []).sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      return (b.stars ?? -1) - (a.stars ?? -1);
    });

    return {
      zielprovider: plan.zielprovider,
      bridge_id: winner ? winner.id : null,
      bridge_name: winner ? winner.name : null,
      bridge_url: winner ? winner.url : null,
      begruendung: plan.begruendung,
      restrisiko: plan.restrisiko,
      auth_weg: plan.auth_weg,
      port: winner && plan.dockerCapable ? plan.port : null,
      docker_service: winner && plan.dockerCapable ? plan.dockerService : null,
      docker_capable: Boolean(winner && plan.dockerCapable),
      stars_belegt: winner ? winner.starsExtracted : null,
      last_commit_belegt: winner ? winner.lastCommitText : null,
      candidatesEvaluated: candidates,
    };
  });

  return {
    selections,
    excludedEntries,
    totalBridgeCategoryCount: bridgeCatProviders.length,
  };
}
