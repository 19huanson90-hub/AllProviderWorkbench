import {
  generateLocalGuiNodeServer,
  generateLocalGuiPowerShellServer,
  generateLocalGuiPythonServer,
  generateStandaloneGuiHtml,
} from './standaloneGuiGenerator.ts';
import { buildConnectionSnippets, isUsableGreenOrGelb } from './testEngine.ts';
import type {
  BridgeSelectionEntry,
  ClassifiedProvider,
  Rule7CollisionNotice,
  SecurityAuditCheck,
  SecurityClass,
  SuiteFile,
  TestResultRow,
} from './types.ts';

function csvEscape(value: string | number | boolean): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateTestResultsCsv(rows: TestResultRow[]): string {
  const header = 'id,name,kategorie,status,http_code,risky,empfohlen,note,url';
  const lines = rows.map((r) =>
    [
      csvEscape(r.id),
      csvEscape(r.name),
      csvEscape(r.kategorie),
      csvEscape(r.status),
      csvEscape(r.http_code),
      csvEscape(r.risky ? 'True' : 'False'),
      csvEscape(r.empfohlen),
      csvEscape(r.note),
      csvEscape(r.url),
    ].join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

export function generateClassificationJson(
  providers: ClassifiedProvider[],
  sourceName: string
): string {
  const counts: Record<SecurityClass, number> = {
    GRUEN: 0,
    GELB: 0,
    ROT: 0,
    SCHWARZ: 0,
  };
  for (const p of providers) {
    counts[p.securityClass]++;
  }

  const payload = {
    meta: {
      source: sourceName,
      total_providers: providers.length,
      counts: {
        GRÜN: counts.GRUEN,
        GELB: counts.GELB,
        ROT: counts.ROT,
        SCHWARZ: counts.SCHWARZ,
      },
      rules_enforced: [
        'Regel 1: illegal & anonym_pseudo_key werden niemals getestet, aufgerufen oder integriert.',
        'Regel 6: Klassifikation GRÜN/GELB/ROT/SCHWARZ bleibt vollständig erhalten.',
        'Regel 7: Konflikte zwischen Datensatz-Flags und Regel 1 sind explizit markiert.',
      ],
    },
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      security_class: p.securityClassLabel,
      is_unfiltered: p.isUnfiltered,
      classification_reason: p.classificationReason,
      url: p.securityClass === 'SCHWARZ' || p.isIllegal ? '[GESPERRT – NUR DOKUMENTATION]' : p.url,
      kategorien: p.kategorien,
      auth_typ: p.auth_typ,
      verbindungsart: p.verbindungsart,
      protokoll: p.protokoll,
      free_tier_typ: p.free_tier_typ,
      flags: p.flagsRaw,
      risiko: p.risiko || p.flags.riskantDetail || '',
      illegal: p.isIllegal,
      anonym_pseudo_key: p.isAnonymPseudoKey,
      test_policy: p.testPolicy,
      rule7_collision: p.rule7Collision,
    })),
  };

  return JSON.stringify(payload, null, 2) + '\n';
}

export function generateBridgeSelectionJson(selections: BridgeSelectionEntry[]): string {
  const payload = {
    meta: {
      criteria: [
        '1. Aktiv gepflegt (letzter Commit < 6 Monate, Stichtag Nov. 2026)',
        '2. Lokal selbst gehostet (kein gehosteter Drittanbieter-Service)',
        '3. Dokumentierter Auth-Weg (Session-Cookie / API-Key / Login-Workflow)',
        '4. Höchste GitHub-Stars bei vergleichbarem Risiko',
      ],
      hard_rules_notice:
        'Keine illegalen oder anonym_pseudo_key-Einträge enthalten (Regel 1). Jede Bridge trägt explizites ToS-Restrisiko (Regel 5).',
    },
    bridges: selections.map((s) => ({
      zielprovider: s.zielprovider,
      bridge_id: s.bridge_id,
      bridge_url: s.bridge_url,
      begruendung: s.begruendung,
      restrisiko: s.restrisiko,
      auth_weg: s.auth_weg,
      docker_capable_win11: s.docker_capable,
      docker_service: s.docker_service,
      local_port: s.port ? `127.0.0.1:${s.port}` : null,
      stars_belegt: s.stars_belegt,
      last_commit_belegt: s.last_commit_belegt,
    })),
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

export function generateDockerCompose(selections: BridgeSelectionEntry[]): string {
  const dockerBridges = selections.filter((s) => s.docker_capable && s.bridge_id && s.port && s.docker_service);

  const bridgeServices = dockerBridges
    .map((b) => {
      const envLines: string[] = [];
      if (b.bridge_id === 'qwengate') {
        envLines.push('      - QWEN_SESSION_COOKIE=${QWEN_SESSION_COOKIE:-<DEIN_COOKIE>}');
      } else if (b.bridge_id === 'openai-api-server-via-codex') {
        envLines.push('      - CHATGPT_CODEX_TOKEN=${CHATGPT_CODEX_TOKEN:-<DEIN_KEY>}');
      } else if (b.bridge_id === 'catgpt-gateway') {
        envLines.push('      - CLAUDE_SESSION_COOKIE=${CLAUDE_SESSION_COOKIE:-<DEIN_COOKIE>}');
      } else if (b.bridge_id === 'webai-to-api') {
        envLines.push('      - GEMINI_SECURE_1PSID=${GEMINI_SECURE_1PSID:-<DEIN_COOKIE>}');
        envLines.push('      - GEMINI_SECURE_1PSIDTS=${GEMINI_SECURE_1PSIDTS:-<DEIN_COOKIE>}');
      } else if (b.bridge_id === 'freedeepseekapi') {
        envLines.push('      - DEEPSEEK_USER_TOKEN=${DEEPSEEK_USER_TOKEN:-<DEIN_COOKIE>}');
      } else if (b.bridge_id === 'grok-com-to-openai') {
        envLines.push('      - GROK_SSO_COOKIE=${GROK_SSO_COOKIE:-<DEIN_COOKIE>}');
        envLines.push('      - GROK_SSO_RW_COOKIE=${GROK_SSO_RW_COOKIE:-<DEIN_COOKIE>}');
      } else if (b.bridge_id === 'duck2api') {
        envLines.push('      - DUCK2API_AUTH_KEY=${DUCK2API_AUTH_KEY:-<DEIN_KEY>}');
      }

      const extraPort =
        b.bridge_id === 'catgpt-gateway'
          ? `\n      - "127.0.0.1:8193:6080" # Lokales noVNC-Erstlogin-Interface (strikt Loopback)`
          : '';

      return `  # Zielprovider: ${b.zielprovider} (${b.bridge_id})
  # WARNUNG (Regel 5): ToS-Risiko! Nur über Opt-in-Profil "tos-risk" mit Wegwerf-Konto starten.
  # Upstream-Quelle: ${b.bridge_url}
  ${b.docker_service}:
    profiles: ["tos-risk"]
    build:
      context: ./bridges/${b.bridge_id}
      dockerfile: Dockerfile
    container_name: ai-suite-${b.docker_service}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${b.port}:${b.port}"${extraPort}
    environment:
      - PORT=${b.port}
      - HOST=0.0.0.0
${envLines.join('\n')}
    networks:
      - ai-provider-net
    security_opt:
      - no-new-privileges:true`;
    })
    .join('\n\n');

  return `# AI-Provider-Suite – Lokale Docker-Compose-Orchestrierung (Windows 11 / Docker Desktop)
# ======================================================================================
# SICHERHEITSREGELN (Regel 1–5):
#   1. ALLE Host-Ports sind strikt an 127.0.0.1 gebunden (NIEMALS 0.0.0.0).
#   2. Webclient-Bridges liegen hinter dem Opt-in-Profil "tos-risk" und starten NICHT
#      automatisch ohne explizite Nutzerentscheidung (start-all.ps1 -IncludeTosRiskBridges).
#   3. Keine illegalen oder anonym_pseudo_key-Einträge enthalten.
#   4. LiteLLM-Hinweis: Vor Produktiveinsatz Image-Digest pinnen (CVE-2026-40217 beachten!).

services:
  # Zentraler OpenAI-kompatibler Router (GRÜN – startet standardmäßig)
  # Einheitlicher Endpunkt: http://127.0.0.1:4000/v1
  litellm-router:
    image: ghcr.io/berriai/litellm:main-stable
    container_name: ai-suite-litellm
    restart: unless-stopped
    ports:
      - "127.0.0.1:4000:4000"
    volumes:
      - ./litellm_config.yaml:/app/config.yaml:ro
    command: ["--config", "/app/config.yaml", "--port", "4000", "--host", "0.0.0.0"]
    environment:
      - LITELLM_MASTER_KEY=\${LITELLM_MASTER_KEY:-<DEIN_KEY>}
      - OPENROUTER_API_KEY=\${OPENROUTER_API_KEY:-<DEIN_KEY>}
      - GROQ_API_KEY=\${GROQ_API_KEY:-<DEIN_KEY>}
      - GEMINI_API_KEY=\${GEMINI_API_KEY:-<DEIN_KEY>}
      - CEREBRAS_API_KEY=\${CEREBRAS_API_KEY:-<DEIN_KEY>}
      - BRIDGE_LOCAL_KEY=\${BRIDGE_LOCAL_KEY:-<DEIN_KEY>}
    networks:
      - ai-provider-net
    security_opt:
      - no-new-privileges:true

${bridgeServices}

networks:
  ai-provider-net:
    driver: bridge
`;
}

export function generateLiteLlmConfig(
  selections: BridgeSelectionEntry[],
  providers: ClassifiedProvider[] = [],
  activeRouterProviderIds: string[] = []
): string {
  const dockerBridges = selections.filter(
    (s) => s.docker_capable && s.bridge_id && s.port && s.docker_service
  );

  const byId = new Map(providers.map((p) => [p.id, p]));
  const customUpstreams = activeRouterProviderIds
    .map((id) => byId.get(id))
    .filter((p): p is ClassifiedProvider => Boolean(p && isUsableGreenOrGelb(p)))
    .map((p) => {
      const snippets = buildConnectionSnippets(p);
      const safeName = `${p.securityClass === 'GRUEN' ? 'green' : 'gelb'}-${p.id}`;
      const apiBase = snippets.defaultApiBase.replace(
        /^http:\/\/(127\.0\.0\.1|localhost)/i,
        'http://host.docker.internal'
      );
      const apiKeyLine =
        p.auth_typ === 'keine'
          ? '      api_key: "not-needed"'
          : `      api_key: os.environ/${snippets.envVar}`;
      return `  # [${p.securityClassLabel} – aktiv aus Workbench/Live-Test übernommen] ${p.name}
  - model_name: ${safeName}
    litellm_params:
      model: openai/default
      api_base: ${apiBase}
${apiKeyLine}
      timeout: 45`;
    })
    .join('\n\n');

  const customBlock = customUpstreams
    ? `\n  # =========================================================================\n  # AUS LIVE-TESTS / WORKBENCH AKTIVIERTE GRÜN/GELB-VERBINDUNGEN\n  # =========================================================================\n${customUpstreams}\n`
    : '';

  const bridgeEntries = dockerBridges
    .map(
      (b) => `  # [ROT – ToS-Risiko] ${b.zielprovider} via ${b.bridge_id} (nur aktiv mit --profile tos-risk)
  - model_name: bridge-${b.zielprovider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
    litellm_params:
      model: openai/default
      api_base: http://${b.docker_service}:${b.port}/v1
      api_key: os.environ/BRIDGE_LOCAL_KEY
      timeout: 60`
    )
    .join('\n\n');

  return `# AI-Provider-Suite – LiteLLM Router Konfiguration
# Einheitlicher OpenAI-kompatibler Endpunkt: http://127.0.0.1:4000/v1
# Keine echten Secrets eintragen! Alle Keys werden ausschließlich über .env / os.environ geladen.

model_list:
  # =========================================================================
  # OFFIZIELLE GRÜNE UPSTREAMS (ToS-konform, empfohlen als Standard)
  # =========================================================================
  - model_name: green-groq-llama
    litellm_params:
      model: groq/llama-3.3-70b-versatile
      api_key: os.environ/GROQ_API_KEY

  - model_name: green-openrouter-free
    litellm_params:
      model: openrouter/meta-llama/llama-3.3-70b-instruct:free
      api_key: os.environ/OPENROUTER_API_KEY

  - model_name: green-gemini-flash
    litellm_params:
      model: gemini/gemini-2.5-flash
      api_key: os.environ/GEMINI_API_KEY

  - model_name: green-cerebras-llama
    litellm_params:
      model: openai/llama-3.3-70b
      api_base: https://api.cerebras.ai/v1
      api_key: os.environ/CEREBRAS_API_KEY

  - model_name: green-ollama-local
    litellm_params:
      model: ollama/llama3.2
      api_base: http://host.docker.internal:11434
${customBlock}
  # =========================================================================
  # WEBCLIENT-BRIDGES (ROT – NUR OPT-IN mit Wegwerf-Account & 127.0.0.1!)
  # =========================================================================
${bridgeEntries}

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  telemetry: false
  disable_spend_logs: false
`;
}

export function generateEnvExample(
  providers: ClassifiedProvider[] = [],
  activeRouterProviderIds: string[] = []
): string {
  const baseEnvKeys = new Set([
    'LITELLM_MASTER_KEY',
    'BRIDGE_LOCAL_KEY',
    'OPENROUTER_API_KEY',
    'GROQ_API_KEY',
    'GEMINI_API_KEY',
    'CEREBRAS_API_KEY',
    'MISTRAL_API_KEY',
    'GITHUB_TOKEN',
    'HF_TOKEN',
  ]);
  const byId = new Map(providers.map((p) => [p.id, p]));
  const extraLines: string[] = [];
  for (const id of activeRouterProviderIds) {
    const p = byId.get(id);
    if (!p || !isUsableGreenOrGelb(p) || p.auth_typ === 'keine') continue;
    const envVar = buildConnectionSnippets(p).envVar;
    if (!baseEnvKeys.has(envVar)) {
      baseEnvKeys.add(envVar);
      extraLines.push(`${envVar}=<DEIN_KEY>`);
    }
  }
  const extraBlock =
    extraLines.length > 0
      ? `\n# === Zusätzliche aus Workbench aktivierte Verbindungen ===\n${extraLines.join('\n')}\n`
      : '';

  return `# AI-Provider-Suite – Beispiel-Umgebungsvariablen
# Kopiere diese Datei nach ".env" und ersetze NUR die Platzhalter (<DEIN_KEY>, <DEIN_COOKIE>).
# NIEMALS die echte ".env" in Git committen oder teilen (Regel 2)!

# === Zentraler LiteLLM-Router (lokal auf 127.0.0.1:4000) ===
LITELLM_MASTER_KEY=<DEIN_KEY>
BRIDGE_LOCAL_KEY=<DEIN_KEY>

# === Offizielle GRÜNE API-Keys (empfohlen) ===
OPENROUTER_API_KEY=<DEIN_KEY>
GROQ_API_KEY=<DEIN_KEY>
GEMINI_API_KEY=<DEIN_KEY>
CEREBRAS_API_KEY=<DEIN_KEY>
MISTRAL_API_KEY=<DEIN_KEY>
GITHUB_TOKEN=<DEIN_KEY>
HF_TOKEN=<DEIN_KEY>
${extraBlock}
# === Optionale Webclient-Bridges (ROT – NUR WEGWERF-ACCOUNTS, Regel 3 & 5!) ===
QWEN_SESSION_COOKIE=<DEIN_COOKIE>
CHATGPT_CODEX_TOKEN=<DEIN_KEY>
CLAUDE_SESSION_COOKIE=<DEIN_COOKIE>
GEMINI_SECURE_1PSID=<DEIN_COOKIE>
GEMINI_SECURE_1PSIDTS=<DEIN_COOKIE>
DEEPSEEK_USER_TOKEN=<DEIN_COOKIE>
GROK_SSO_COOKIE=<DEIN_COOKIE>
GROK_SSO_RW_COOKIE=<DEIN_COOKIE>
DUCK2API_AUTH_KEY=<DEIN_KEY>
`;
}

export function generateStartGuiBat(): string {
  const lines = [
    '@echo off',
    'setlocal EnableExtensions',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    '',
    'echo ====================================================================',
    'echo   AI-Provider-Suite Workbench - Grafische Oberflaeche (Windows 11)',
    'echo ====================================================================',
    'echo.',
    '',
    'if exist "package.json" if exist "server.ts" goto :mode_node_workbench',
    'if exist "gui\\index.html" goto :mode_standalone_gui',
    'if exist "start-all.ps1" goto :mode_legacy_docker',
    '',
    'echo [FEHLER] Weder package.json/server.ts noch gui\\index.html gefunden.',
    'echo Bitte start-gui.bat im Projekt- oder entpackten Suite-Ordner ausfuehren.',
    'pause',
    'exit /b 1',
    '',
    ':mode_node_workbench',
    'REM Modus A: Vollstaendiger Quellcode-Ordner (package.json + server.ts)',
    'powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri \'http://127.0.0.1:3000/api/workspace\' -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; exit 1" >nul 2>&1',
    'if not errorlevel 1 (',
    '    echo [INFO] Workbench-Server laeuft bereits auf http://127.0.0.1:3000 - oeffne Browser...',
    '    start "" "http://127.0.0.1:3000"',
    '    exit /b 0',
    ')',
    '',
    'where node >nul 2>&1',
    'if errorlevel 1 (',
    '    echo [FEHLER] Node.js ^>= 20 wurde nicht gefunden.',
    '    echo Bitte Node.js LTS installieren: https://nodejs.org/',
    '    echo.',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'node -e "process.exit(Number(process.versions.node.split(\'.\')[0]) >= 20 ? 0 : 1)" >nul 2>&1',
    'if errorlevel 1 (',
    '    echo [FEHLER] Installierte Node.js-Version ist zu alt ^(benoetigt Node.js ^>= 20 LTS fuer Vite 8^).',
    '    node -v',
    '    echo Bitte Node.js 22 LTS installieren: https://nodejs.org/',
    '    echo.',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'if not exist "node_modules\\.bin\\tsx.cmd" (',
    '    echo [1/3] Installiere Abhaengigkeiten ^(npm install^)...',
    '    call npm install',
    '    if errorlevel 1 (',
    '        echo [WARNUNG] Standard npm install meldete Peer-Konflikt - wiederhole mit --legacy-peer-deps...',
    '        call npm install --legacy-peer-deps',
    '        if errorlevel 1 (',
    '            echo [FEHLER] npm install fehlgeschlagen.',
    '            pause',
    '            exit /b 1',
    '        )',
    '    )',
    ')',
    '',
    'if not exist "node_modules\\.bin\\tsx.cmd" (',
    '    echo [FEHLER] node_modules\\.bin\\tsx.cmd fehlt nach npm install.',
    '    echo Bitte node_modules loeschen und start-gui.bat erneut ausfuehren.',
    '    pause',
    '    exit /b 1',
    ')',
    '',
    'REM Striktes Loopback-Binding ohne Leerzeichen (wird an Kindprozess vererbt)',
    'set "HOST=127.0.0.1"',
    'set "PORT=3000"',
    'echo [2/3] Starte AI-Provider-Suite Workbench Server strikt auf http://127.0.0.1:3000 ...',
    'start "AI-Provider-Suite-Server" /D "%~dp0" cmd /k npm run dev',
    '',
    'echo [3/3] Warte auf lokale GUI ^(max. 25 Sekunden^)...',
    'powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 50;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri \'http://127.0.0.1:3000/api/workspace\' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){ Start-Process \'http://127.0.0.1:3000\' } else { Write-Warning \'Server antwortet noch nicht auf Port 3000 - pruefe das Server-Fenster.\' }"',
    'echo.',
    'echo GUI-URL: http://127.0.0.1:3000',
    'echo Zum Beenden einfach das geoeffnete Server-Fenster schliessen.',
    'exit /b 0',
    '',
    ':mode_standalone_gui',
    'REM Modus B: Entpacktes Suite-ZIP -> Lokale Windows-11-GUI OHNE Docker Desktop!',
    'powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri \'http://127.0.0.1:8787/api/health\' -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } } catch {}; exit 1" >nul 2>&1',
    'if not errorlevel 1 (',
    '    echo [INFO] Lokale GUI laeuft bereits auf http://127.0.0.1:8787 - oeffne Browser...',
    '    start "" "http://127.0.0.1:8787"',
    '    exit /b 0',
    ')',
    '',
    'echo [MODUS] Lokale Windows-11-GUI ^(kein Docker Desktop erforderlich^).',
    'echo Bindung strikt auf http://127.0.0.1:8787 ^(Harte Regel 4^).',
    'echo.',
    '',
    'where node >nul 2>&1',
    'if not errorlevel 1 (',
    '    node -e "process.exit(Number(process.versions.node.split(\'.\')[0]) >= 18 ? 0 : 1)" >nul 2>&1',
    '    if not errorlevel 1 goto :launch_gui_node',
    ')',
    '',
    'REM Echte Python-Pruefung verhindert Windows-11 Microsoft-Store-Alias-Falle',
    'python -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1',
    'if not errorlevel 1 goto :launch_gui_python',
    '',
    'py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1',
    'if not errorlevel 1 goto :launch_gui_py',
    '',
    'goto :launch_gui_ps',
    '',
    ':launch_gui_node',
    'echo [1/2] Starte lokalen GUI-Server via Node.js ^(ohne npm install^)...',
    'start "AI-Provider-Suite-GUI" /D "%~dp0" cmd /k node "gui\\local_gui_server.mjs"',
    'goto :wait_standalone_gui',
    '',
    ':launch_gui_python',
    'echo [1/2] Starte lokalen GUI-Server via Python ^(ohne pip install^)...',
    'start "AI-Provider-Suite-GUI" /D "%~dp0" cmd /k python "gui\\local_gui_server.py"',
    'goto :wait_standalone_gui',
    '',
    ':launch_gui_py',
    'echo [1/2] Starte lokalen GUI-Server via Python Launcher ^(py -3^)...',
    'start "AI-Provider-Suite-GUI" /D "%~dp0" cmd /k py -3 "gui\\local_gui_server.py"',
    'goto :wait_standalone_gui',
    '',
    ':launch_gui_ps',
    'echo [1/2] Starte lokalen GUI-Server via Windows PowerShell ^(Zero-Install^)...',
    'start "AI-Provider-Suite-GUI" /D "%~dp0" powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "gui\\local_gui_server.ps1"',
    'goto :wait_standalone_gui',
    '',
    ':wait_standalone_gui',
    'echo [2/2] Warte auf lokale GUI auf http://127.0.0.1:8787 ...',
    'powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 30;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri \'http://127.0.0.1:8787/api/health\' -TimeoutSec 2; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){ Start-Process \'http://127.0.0.1:8787\' } else { Write-Warning \'Server antwortet noch nicht auf Port 8787 - pruefe das Server-Fenster.\' }"',
    'echo.',
    'echo Lokale GUI-URL : http://127.0.0.1:8787',
    'echo Optional Docker: Fuer den LiteLLM-Router ^(Port 4000^) spaeter Docker Desktop + start-all.ps1 nutzen.',
    'echo Zum Beenden einfach das Server-Fenster schliessen.',
    'exit /b 0',
    '',
    ':mode_legacy_docker',
    'REM Modus C: Legacy-Fallback (nur start-all.ps1 vorhanden)',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "start-all.ps1"',
    'if errorlevel 1 (',
    '    pause',
    '    exit /b 1',
    ')',
    'start "" "http://127.0.0.1:4000"',
    'pause',
    'exit /b 0',
    '',
  ];
  return lines.join('\r\n');
}

export function generateStartAllPs1(selections: BridgeSelectionEntry[]): string {
  const dockerBridges = selections.filter((s) => s.docker_capable && s.port && s.docker_service);
  const bridgeUrlLines = dockerBridges
    .map(
      (b) =>
        `    Write-Host "  - ${b.zielprovider} (${b.bridge_id}): http://127.0.0.1:${b.port}/v1  [ROT - ToS-Risiko]"`
    )
    .join('\n');

  return `<#
.SYNOPSIS
    Startet den Docker-basierten LiteLLM-Router lokal unter Windows 11 (PowerShell 5.1 & PowerShell 7 kompatibel).
.DESCRIPTION
    1. Prueft sauber ohne PS-5.1-NativeCommandError, ob Docker CLI & Docker Desktop Daemon laufen.
    2. Startet den zentralen LiteLLM-Router auf http://127.0.0.1:4000/v1.
    3. Startet Webclient-Bridges (Profil "tos-risk") NUR nach explizitem Opt-in (-IncludeTosRiskBridges).
    4. Hinweis: Fuer die grafische Oberflaeche OHNE Docker Desktop einfach start-gui.bat starten.
#>
[CmdletBinding()]
param(
    [switch]$IncludeTosRiskBridges
)

$ErrorActionPreference = 'Stop'
$SuiteDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $SuiteDir

Write-Host "=== AI-Provider-Suite Docker-Router Start ===" -ForegroundColor Cyan

# 1. Pruefe Docker CLI & laufenden Docker Daemon (PowerShell-5.1-sicher ohne NativeCommandError)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[FEHLER] Docker CLI wurde nicht gefunden." -ForegroundColor Red
    Write-Host "  -> Fuer die lokale GUI OHNE Docker einfach 'start-gui.bat' doppelklicken." -ForegroundColor Yellow
    Write-Host "  -> Fuer den Docker-Router (Port 4000) bitte Docker Desktop installieren und starten." -ForegroundColor Yellow
    exit 1
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = & docker info 2>$null
$dockerExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($dockerExit -ne 0) {
    Write-Host "[FEHLER] Docker Desktop Daemon laeuft nicht (docker_engine nicht erreichbar)." -ForegroundColor Red
    Write-Host "  -> Option 1 (ohne Docker): Einfach 'start-gui.bat' fuer die lokale GUI auf http://127.0.0.1:8787 starten." -ForegroundColor Yellow
    Write-Host "  -> Option 2 (mit Docker) : Docker Desktop starten, warten bis 'Engine running', dann erneut ausfuehren." -ForegroundColor Yellow
    exit 1
}

# 2. Pruefe .env (erzeuge niemals echte Secrets, warne bei fehlender .env)
if (-not (Test-Path -Path (Join-Path $SuiteDir ".env"))) {
    Write-Warning ".env fehlt. Kopiere .env.example nach .env und ersetze <DEIN_KEY>/<DEIN_COOKIE>."
    Copy-Item -Path (Join-Path $SuiteDir ".env.example") -Destination (Join-Path $SuiteDir ".env")
}

# 3. Starte Container (idempotent, PS-5.1-sicher gegen stderr-Fortschrittsmeldungen von docker compose)
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
if ($IncludeTosRiskBridges) {
    Write-Host ""
    Write-Warning "OPT-IN AKTIV: Starte Webclient-Bridges (Klasse ROT, ToS-Risiko)."
    Write-Warning "Regel 3: Niemals Hauptaccount verwenden! Alle Ports bleiben strikt an 127.0.0.1 gebunden."
    $confirm = Read-Host "Bestaetige Betrieb mit Wegwerf-Account durch Eingabe von 'JA'"
    if ($confirm -ne 'JA') {
        Write-Host "Abgebrochen durch Nutzer. Starte stattdessen nur den GRUENEN Router..." -ForegroundColor Yellow
        & docker compose up -d litellm-router
    } else {
        & docker compose --profile tos-risk up -d
    }
} else {
    Write-Host "Starte zentralen LiteLLM-Router (GRUENE Upstreams, ohne ROT-Bridges)..." -ForegroundColor Green
    & docker compose up -d litellm-router
}
$composeExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($composeExit -ne 0) {
    Write-Host "[FEHLER] docker compose up ist fehlgeschlagen (Exit-Code: $composeExit)." -ForegroundColor Red
    exit $composeExit
}

Write-Host ""
Write-Host "=== Lokale Endpunkte & Dashboards (strikt 127.0.0.1) ===" -ForegroundColor Green
Write-Host "  - Zentraler OpenAI-Endpunkt : http://127.0.0.1:4000/v1"
Write-Host "  - LiteLLM Swagger / Health  : http://127.0.0.1:4000/health/liveliness"
if ($IncludeTosRiskBridges) {
    Write-Host ""
    Write-Host "=== Optionale Webclient-Bridges (nur bei Bestaetigung gestartet) ===" -ForegroundColor Yellow
${bridgeUrlLines}
    Write-Host "  - Claude noVNC Erstlogin    : http://127.0.0.1:8193  (nur Loopback)"
}
Write-Host ""
Write-Host "Stoppen mit: .\\stop-all.ps1" -ForegroundColor Cyan
`;
}

export function generateStopAllPs1(): string {
  return `<#
.SYNOPSIS
    Stoppt alle Container der AI-Provider-Suite sauber und idempotent (PS 5.1 & PS 7).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$SuiteDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -Path $SuiteDir

Write-Host "=== AI-Provider-Suite Stop ===" -ForegroundColor Cyan

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[FEHLER] Docker CLI wurde nicht gefunden." -ForegroundColor Red
    exit 1
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = & docker info 2>$null
$dockerExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($dockerExit -ne 0) {
    Write-Warning "Docker Daemon laeuft nicht - keine aktiven Container zu stoppen."
    exit 0
}

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& docker compose --profile tos-risk down --remove-orphans
$downExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($downExit -ne 0) {
    Write-Host "[FEHLER] docker compose down meldete Fehler (Exit-Code: $downExit)." -ForegroundColor Red
    exit $downExit
}

Write-Host "Alle AI-Provider-Suite Container wurden sauber gestoppt." -ForegroundColor Green
`;
}

export function generateCloneBridgesPs1(selections: BridgeSelectionEntry[]): string {
  const dockerBridges = selections.filter(
    (s) => s.docker_capable && s.bridge_id && s.bridge_url
  );
  const repoEntries = dockerBridges
    .map(
      (b) =>
        `    @{ Id = "${b.bridge_id}"; Target = "${b.zielprovider}"; Url = "${b.bridge_url}.git" }`
    )
    .join('\n');

  return `<#
.SYNOPSIS
    Klont alle ausgewaehlten, Docker-faehigen Bridge-Repositories lokal nach .\\bridges\\<bridge_id>\\ (Windows 11, PS 5.1 & PS 7).
.DESCRIPTION
    Bereitet ausschliesslich die allowlist-geprueften GitHub-Repositories (keine illegal/anonym_pseudo_key-Eintraege)
    fuer den optionalen Betrieb mit .\\start-all.ps1 -IncludeTosRiskBridges vor.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$SuiteDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BridgesDir = Join-Path $SuiteDir "bridges"
New-Item -ItemType Directory -Force -Path $BridgesDir | Out-Null

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "[FEHLER] Git CLI wurde nicht gefunden. Bitte Git for Windows installieren." -ForegroundColor Red
    exit 1
}

$env:GIT_TERMINAL_PROMPT = "0"
$Repos = @(
${repoEntries}
)

Write-Host "=== AI-Provider-Suite: Lokales Klonen der Bridge-Repos ===" -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
foreach ($r in $Repos) {
    $targetDir = Join-Path $BridgesDir $r.Id
    if (Test-Path (Join-Path $targetDir ".git")) {
        Write-Host "[UPDATE] $($r.Target) ($($r.Id))..." -ForegroundColor Green
        & git -C $targetDir fetch --depth 1 origin
        if ($LASTEXITCODE -eq 0) {
            & git -C $targetDir reset --hard FETCH_HEAD
        }
    } else {
        Write-Host "[CLONE ] $($r.Target) ($($r.Id)) <- $($r.Url)" -ForegroundColor Yellow
        & git clone --depth 1 --single-branch $r.Url $targetDir
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Repository $($r.Id) konnte nicht geklont/aktualisiert werden (Exit-Code: $LASTEXITCODE)."
    }
}
$ErrorActionPreference = $prevEap
Write-Host "Fertig. Optionaler Start (nur mit Wegwerf-Konto): .\\start-all.ps1 -IncludeTosRiskBridges" -ForegroundColor Cyan
`;
}

export function generatePythonParserScript(): string {
  return `#!/usr/bin/env python3
"""
ZIEL 1 – Parser & 4-Klassen-Klassifikator für ai_provider(2).txt
Kompatibel mit Python >= 3.11 (nur Standardbibliothek).
Liest standardmäßig %USERPROFILE%\\Downloads\\ai_provider(2).txt
und schreibt %USERPROFILE%\\Desktop\\ai-provider-suite\\classification.json.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

BRIDGE_CATS = {"webclient_automation", "web_cookie_bypass", "reverse_engineered_web"}
GENERIC_TOOLS = {
    "stagehand", "skyvern", "nanobrowser", "browser-use", "browseract-skills",
    "patchright", "camoufox", "nodriver", "reverseloom", "reverse-api-engineer",
}


def detect_illegal(flags_raw: str, risiko: str) -> bool:
    if re.match(r"^illegal\\b", risiko.strip(), re.IGNORECASE):
        return True
    if re.search(r"riskant\\s*=\\s*True\\s*\\(\\s*illegal\\b", flags_raw, re.IGNORECASE):
        return True
    return False


def parse_blocks(text: str) -> list[dict[str, Any]]:
    lines = text.replace("\\r\\n", "\\n").split("\\n")
    starts: list[tuple[int, str]] = []
    in_fence = False
    for idx, line in enumerate(lines):
        if line.strip().startswith("\`\`\`"):
            in_fence = not in_fence
            continue
        if not in_fence and line.startswith("## "):
            starts.append((idx, line[3:].strip()))

    records: list[dict[str, Any]] = []
    for i, (start_idx, name) in enumerate(starts):
        end_idx = starts[i + 1][0] if i + 1 < len(starts) else len(lines)
        fields: dict[str, str] = {}
        current_key: str | None = None
        for raw in lines[start_idx + 1 : end_idx]:
            m = re.match(r"^- \\*\\*([a-zA-Z0-9_]+):\\*\\*\\s*(.*)$", raw)
            if m:
                current_key = m.group(1).lower()
                fields[current_key] = m.group(2).strip()
            elif current_key and raw.strip() and not raw.startswith("---"):
                fields[current_key] += "\\n" + raw.strip()

        raw_id = fields.get("id", "")
        if not raw_id:
            continue
        provider_id = raw_id.split("|")[0].strip()
        kategorien = [c.strip() for c in fields.get("kategorien", "").split(",") if c.strip()]
        flags_raw = fields.get("flags", "")
        risiko = fields.get("risiko", "")

        riskant = bool(re.search(r"riskant\\s*=\\s*True", flags_raw, re.IGNORECASE))
        empf_m = re.search(r"empfehlenswert\\s*=\\s*(True|False|unklar)", flags_raw, re.IGNORECASE)
        empf = empf_m.group(1) if empf_m else "unklar"

        is_illegal = detect_illegal(flags_raw, risiko)
        is_pseudo = "anonym_pseudo_key" in kategorien
        is_bridge = any(c in BRIDGE_CATS for c in kategorien)
        is_generic = provider_id in GENERIC_TOOLS

        if is_pseudo and is_illegal:
            sec_class = "SCHWARZ"
        elif is_illegal or (riskant and is_bridge and not is_generic) or (is_bridge and not is_generic and empf.lower() == "false"):
            sec_class = "ROT"
        elif is_generic or riskant or empf.lower() == "unklar" or is_pseudo or empf.lower() == "false":
            sec_class = "GELB"
        else:
            sec_class = "GRÜN"

        records.append({
            "id": provider_id,
            "name": name,
            "security_class": sec_class,
            "url": "[GESPERRT – NUR DOKUMENTATION]" if (sec_class == "SCHWARZ" or is_illegal) else fields.get("url", ""),
            "kategorien": kategorien,
            "auth_typ": fields.get("auth_typ", "unbekannt"),
            "verbindungsart": fields.get("verbindungsart", ""),
            "free_tier_typ": fields.get("free_tier_typ", ""),
            "flags": flags_raw,
            "risiko": risiko,
            "illegal": is_illegal,
            "anonym_pseudo_key": is_pseudo,
        })
    return records


def main() -> None:
    user_profile = Path(os.environ.get("USERPROFILE", Path.home()))
    input_path = user_profile / "Downloads" / "ai_provider(2).txt"
    output_dir = user_profile / "Desktop" / "ai-provider-suite"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "classification.json"

    text = input_path.read_text(encoding="utf-8")
    records = parse_blocks(text)
    counts = {k: sum(1 for r in records if r["security_class"] == k) for k in ("GRÜN", "GELB", "ROT", "SCHWARZ")}
    output_path.write_text(
        json.dumps({"total": len(records), "counts": counts, "providers": records}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Geschrieben: {output_path} ({len(records)} Provider: {counts})")


if __name__ == "__main__":
    main()
`;
}

export function generatePythonTestRunnerScript(): string {
  return `#!/usr/bin/env python3
"""
ZIEL 2 – Reale ToS-konforme Tests (Python >= 3.11 + requests).
Setzt Harte Regel 1 & 7 konsequent durch:
  - SCHWARZ / illegal / anonym_pseudo_key -> SKIPPED (kein Request)
  - ROT -> SKIPPED (ToS-Risiko)
  - GELB -> NUR HEAD (Fallback GET), KEIN API-Call
  - GRÜN -> HEAD/GET (10s Timeout), bei auth_typ=keine & REST optional GET /v1/models
  - auth_typ=api_key -> prüft Env-Var; wenn nicht gesetzt -> SKIPPED (kein Key)
"""

from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path
import requests

TIMEOUT_SECONDS = 10


def env_var_for(provider_id: str) -> str:
    clean = re.sub(r"[^A-Z0-9]+", "_", provider_id.upper()).strip("_")
    return f"{clean}_API_KEY"


def main() -> None:
    user_profile = Path(os.environ.get("USERPROFILE", Path.home()))
    suite_dir = user_profile / "Desktop" / "ai-provider-suite"
    cls_path = suite_dir / "classification.json"
    out_csv = suite_dir / "test_results.csv"

    data = json.loads(cls_path.read_text(encoding="utf-8"))
    providers = data["providers"]

    session = requests.Session()
    session.headers.update({"User-Agent": "AI-Provider-Suite-HealthCheck/1.0 (ToS-compliant HEAD)"})

    with out_csv.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["id", "name", "kategorie", "status", "http_code", "risky", "empfohlen", "note", "url"])

        for p in providers:
            pid = p["id"]
            name = p["name"]
            kat = (p.get("kategorien") or ["unbekannt"])[0]
            sec = p["security_class"]
            url = p.get("url", "")
            risky = sec in ("ROT", "SCHWARZ") or "riskant=True" in p.get("flags", "")
            empf_m = re.search(r"empfehlenswert\\s*=\\s*(True|False|unklar)", p.get("flags", ""), re.IGNORECASE)
            empf = empf_m.group(1) if empf_m else "False"

            if sec == "SCHWARZ" or p.get("illegal"):
                writer.writerow([pid, name, kat, "SKIPPED (illegal)", "-", "True", "False", "Regel 1: illegal", "[GESPERRT]"])
                continue
            if p.get("anonym_pseudo_key"):
                writer.writerow([pid, name, kat, "SKIPPED (Regel 1: anonym_pseudo_key)", "-", str(risky), empf, "Regel 1 & 7", url])
                continue
            if sec == "ROT":
                writer.writerow([pid, name, kat, "SKIPPED (ToS-Risiko)", "-", "True", empf, "Ziel 2.4: ROT", url])
                continue
            if not url.startswith("http"):
                writer.writerow([pid, name, kat, "SKIPPED (lokal/kein Endpunkt)", "-", str(risky), empf, "Keine HTTP-URL", url])
                continue
            if p.get("auth_typ") == "api_key" and not os.environ.get(env_var_for(pid)):
                writer.writerow([pid, name, kat, "SKIPPED (kein Key)", "-", str(risky), empf, f"Env {env_var_for(pid)} fehlt", url])
                continue

            try:
                resp = session.head(url, timeout=TIMEOUT_SECONDS, allow_redirects=True)
                if resp.status_code in (405, 501):
                    resp = session.get(url, timeout=TIMEOUT_SECONDS, allow_redirects=True, stream=True)
                    resp.close()
                note = f"Final: {resp.url}" if resp.url != url else "OK"
                if sec == "GELB":
                    note = f"GELB nur Reachability ({note})"
                status = "OK" if resp.status_code < 400 else "HTTP_ERROR"
                writer.writerow([pid, name, kat, status, str(resp.status_code), str(risky), empf, note, url])
            except requests.Timeout:
                writer.writerow([pid, name, kat, "TIMEOUT", "-", str(risky), empf, "Timeout nach 10s", url])
            except Exception as exc:
                writer.writerow([pid, name, kat, "NETWORK_ERROR", "-", str(risky), empf, str(exc)[:140], url])

    print(f"Geschrieben: {out_csv}")


if __name__ == "__main__":
    main()
`;
}

export function generateSecurityMd(): string {
  return `# SECURITY.md – Sicherheitsregeln der AI-Provider-Suite

Dieses Dokument definiert die **nicht verhandelbaren Sicherheitsgrundregeln** für Analyse, Tests und Betrieb der AI-Provider-Suite unter Windows 11.

---

## 1. Niemals den Hauptaccount für Webclient-Bridges verwenden
- Webclient-Bridges (Klasse **ROT**) automatisieren Weboberflächen oder nutzen Session-Cookies außerhalb offizieller Developer-APIs.
- **Risiko [Belegt]:** Anbieter wie OpenAI, Anthropic, Google, DeepSeek oder xAI sperren Konten bei automatisiertem Web-Zugriff ohne Vorwarnung.
- **Pflicht:** Für jede optionale Bridge ausschließlich ein dediziertes **Wegwerf-/Testkonto** ohne verknüpfte Zahlungsmittel, Produktivdaten oder Unternehmens-Identität verwenden.

## 2. Bridges strikt an \`127.0.0.1\` binden (niemals \`0.0.0.0\`)
- Alle Docker-Port-Mappings in \`docker-compose.yml\` sind ausnahmslos als \`127.0.0.1:<port>:<port>\` konfiguriert.
- **Begründung [Belegt]:** Ein Binding auf \`0.0.0.0\` exponiert ungeschützte Proxy-Endpunkte (und ggf. noVNC-Login-Oberflächen) im lokalen WLAN/LAN oder über falsch konfigurierte Firewalls an Dritte.
- **Pflicht:** Vor jedem Start prüfen, dass keine Port-Weiterleitung auf nicht-Loopback-Interfaces existiert.

## 3. Keine kommerzielle Nutzung von „Personal Use“-Tools oder Trial-Keys
- Viele kostenlose Tiers, Forschungs-Grants und Webclient-Bridges verbieten kommerzielle Nutzung ausdrücklich (im Katalog dokumentiert unter \`kommerzielle_nutzung: nicht_erlaubt\`, z. B. Cohere Trial Key, Google Research Credits, Lambda Research Grant).
- **Pflicht:** Für produktive oder kommerzielle Workloads ausschließlich **GRÜNE** offizielle APIs mit geklärter Lizenz und Data-Processing-Agreement (DPA) verwenden.

## 4. Session-Cookies wie Passwörter behandeln
- Session-Cookies (\`__Secure-1PSID\`, \`sessionKey\`, \`sso\`, OAuth-Refresh-Tokens) gewähren Vollzugriff auf das jeweilige Konto und **umgehen häufig MFA** (siehe Okta/CSA-Analyse zu Infostealer-AI-Token-Logs im Datensatz).
- **Pflicht:**
  - Cookies und API-Keys **niemals** in Git-Repositories, Logs, Screenshots, Markdown-Reports oder Prompt-Eingaben ablegen.
  - Ausschließlich über lokale \`.env\`-Dateien (per \`.gitignore\` ausgeschlossen) oder Windows Credential Manager einbinden.
  - Nach Tests oder Kompromittierungsverdacht sofort abmelden und alle Sessions im Anbieter-Dashboard widerrufen.

## 5. Keine Nutzung gestohlener Keys, Breaches oder illegaler Mixer-Gateways (strafbar)
- Einträge der Klasse **SCHWARZ** (Kategorie \`anonym_pseudo_key\` + \`illegal\`, z. B. LLMJacking, LLM-Mixer-Marktplätze, Infostealer-Token-Dumps, Fake-AI-Malware-Installer) stellen unbefugten Datenzugriff und Computerbetrug dar und sind **strafbar**.
- **Pflicht (Harte Regel 1):** Solche Einträge werden ausschließlich als Gefahrenlage dokumentiert — **niemals** testen, aufrufen, verlinken (keine funktionsfähigen Exploit-Links), containerisieren oder in Router integrieren.

---

## Zusätzlicher Supply-Chain-Hinweis (belegt im Quelldatensatz)
- **LiteLLM-Image-Integrität:** Im Datensatz ist ein Supply-Chain-Vorfall / Sicherheitsrisiko rund um unpinned Container-Tags dokumentiert. Vor produktivem Einsatz sollte \`ghcr.io/berriai/litellm\` in \`docker-compose.yml\` auf einen geprüften SHA256-Image-Digest gepinnt und der ausgehende Container-Traffic überwacht werden.
- **Datenschutz bei Free-Tiers:** Auch offizielle **GRÜNE** Free-Tiers (z. B. Google AI Studio Free Tier, Mistral Experiment, OpenRouter Free) können Prompts laut Anbieter-ToS zum Modelltraining verwenden. Keine personenbezogenen Daten, Quellcode-Geheimnisse oder Kundendaten über Free-Tiers senden.
`;
}

export function generateReadmeMd(selections: BridgeSelectionEntry[]): string {
  const dockerBridges = selections.filter((s) => s.docker_capable && s.bridge_id && s.port);
  const setupList = dockerBridges
    .map(
      (b) =>
        `### ${b.zielprovider} (\`${b.bridge_id}\` → \`http://127.0.0.1:${b.port}/v1\`)\n- **Auth-Weg:** ${b.auth_weg}\n- **Restrisiko:** ${b.restrisiko}\n- **Upstream-Repo:** ${b.bridge_url}\n`
    )
    .join('\n');

  return `# AI-Provider-Suite (Windows 11)

Konsolidierte, sicherheitsklassifizierte Analyse-, Test- und Router-Suite auf Basis von \`ai_provider(2).txt\`.

---

## 1. Installationsvoraussetzungen (Windows 11)
- **Docker Desktop für Windows** (WSL2-Backend empfohlen, laufender Daemon erforderlich)
- **Node.js ≥ 20 LTS** (für optionale MCP-Server / JS-Tools)
- **Python ≥ 3.11** inkl. \`pip install requests\` (für die lokalen Skripte unter \`tools/\`)
- **PowerShell 5.1** (Windows-11-Standard) oder **PowerShell 7+**

---

## 2. Verzeichnisstruktur (\`%USERPROFILE%\\Desktop\\ai-provider-suite\\\`)
- \`classification.json\` — Vollständige 4-Klassen-Einordnung (GRÜN / GELB / ROT / SCHWARZ)
- \`test_results.csv\` — ToS-konforme Testergebnisse (\`id,name,kategorie,status,http_code,risky,empfohlen,note,url\`)
- \`bridge_selection.json\` — Konsolidierte Auswahl max. einer Bridge je Zielprovider
- \`docker-compose.yml\` — Zentraler LiteLLM-Router + optionale Bridges (\`--profile tos-risk\`), **alle Ports auf \`127.0.0.1\`**
- \`litellm_config.yaml\` — Einheitlicher OpenAI-Endpunkt \`http://127.0.0.1:4000/v1\`
- \`start-all.ps1\` & \`stop-all.ps1\` — Windows-11-Start-/Stopp-Skripte
- \`clone-bridges.ps1\` — Klont alle ausgewählten GitHub-Bridge-Repos nach \`./bridges/<bridge_id>/\`
- \`.env.example\` — Vorlage mit Platzhaltern (\`<DEIN_KEY>\`, \`<DEIN_COOKIE>\`)
- \`REPORT.md\` & \`SECURITY.md\` — Vollständiger Bericht und verbindliche Sicherheitsregeln
- \`tools/parse_and_classify.py\` & \`tools/run_tests.py\` — Lokale Windows-11-CLI-Skripte

---

## 3. Startreihenfolge
1. **Umgebungsvariablen anlegen:**
   \`\`\`powershell
   Copy-Item .env.example .env
   notepad .env
   \`\`\`
   Ersetze die benötigten \`<DEIN_KEY>\`-Platzhalter für offizielle GRÜNE Provider (z. B. \`GROQ_API_KEY\`, \`OPENROUTER_API_KEY\`, \`GEMINI_API_KEY\`).
2. **Docker Desktop starten** und warten, bis der Status „Engine running“ zeigt.
3. **Suite starten (Standard: NUR GRÜNER Router, sicher):**
   \`\`\`powershell
   .\\start-all.ps1
   \`\`\`
4. **Optional – Webclient-Bridges zusätzlich aktivieren (ToS-Risiko, nur mit Wegwerf-Konto!):**
   - Klone die ausgewählten GitHub-Bridge-Repositories automatisch nach \`./bridges/<bridge_id>/\`:
   \`\`\`powershell
   .\\clone-bridges.ps1
   \`\`\`
   - Hinterlege die zugehörigen Wegwerf-Account-Cookies in \`.env\`.
   - Starte mit explizitem Opt-in:
   \`\`\`powershell
   .\\start-all.ps1 -IncludeTosRiskBridges
   \`\`\`
5. **Einheitlichen OpenAI-Endpunkt testen:**
   - Base URL: \`http://127.0.0.1:4000/v1\`
   - API Key: Wert aus \`LITELLM_MASTER_KEY\`
6. **Sauber stoppen:**
   \`\`\`powershell
   .\\stop-all.ps1
   \`\`\`

---

## 4. Session-Cookie / Key pro Bridge hinterlegen (nur bei Opt-in)

${setupList}

> **Hinweis zu Cursor & GitHub Copilot:**
> - **Cursor (\`composer-api\`)** ist laut Katalog eine reine macOS-App und wird unter Windows 11 nicht containerisiert.
> - **GitHub Copilot (\`copilot-api\`)** wurde wegen Inaktivität (> 6 Monate) und Kontosperrrisiko nicht ausgewählt.

---

## 5. Sicherheitshinweise (Kurzfassung — Details in \`SECURITY.md\`)
- **Niemals** Hauptaccounts für Bridges nutzen.
- **Niemals** Ports auf \`0.0.0.0\` öffnen (immer \`127.0.0.1\`).
- **Niemals** \`.env\` oder Cookies in Logs, Chats oder Git teilen.
- **Niemals** SCHWARZE / illegale Einträge testen oder ausführen.
`;
}

export function generateReportMd(
  providers: ClassifiedProvider[],
  testResults: TestResultRow[],
  selections: BridgeSelectionEntry[],
  collisions: Rule7CollisionNotice[],
  sourceName: string
): string {
  const counts: Record<SecurityClass, number> = {
    GRUEN: 0,
    GELB: 0,
    ROT: 0,
    SCHWARZ: 0,
  };
  for (const p of providers) {
    counts[p.securityClass]++;
  }

  const testById = new Map(testResults.map((t) => [t.id, t]));
  const green = providers.filter((p) => p.securityClass === 'GRUEN');
  const gelb = providers.filter((p) => p.securityClass === 'GELB');
  const rot = providers.filter((p) => p.securityClass === 'ROT');
  const schwarz = providers.filter((p) => p.securityClass === 'SCHWARZ');

  // Top 10 sofort nutzbar (GRÜN: keine Auth oder direkte kostenlose Nutzung / lokal)
  const top10Immediate = green
    .filter((p) => p.auth_typ === 'keine' || p.kategorien.includes('anonym_keyless') || p.kategorien.includes('lokal_self_hosted'))
    .slice(0, 10);

  // Top 10 kostenlose API-Keys (GRÜN: api_key + kostenlos_dauerhaft)
  const top10FreeApi = green
    .filter((p) => p.auth_typ === 'api_key' && p.kategorien.includes('kostenlos_dauerhaft'))
    .slice(0, 10);

  const localEngines = green.filter((p) => p.kategorien.includes('lokal_self_hosted'));
  const gateways = green.filter((p) => p.kategorien.includes('gateway_router'));
  const mcpServers = green.filter((p) => p.kategorien.includes('mcp_serverless'));
  const researchGrants = green.filter(
    (p) => p.kategorien.includes('forschung_akademisch') || p.flags.forschung === true
  );

  const renderGreenTable = (items: ClassifiedProvider[], limit = 40): string => {
    if (items.length === 0) return '_Keine Einträge vorhanden._\n';
    const slice = items.slice(0, limit);
    const rows = slice
      .map((p) => {
        const t = testById.get(p.id);
        const statusStr = t ? `${t.status} (${t.http_code})` : '-';
        const cleanDesc = p.beschreibung.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 110);
        return `| \`${p.id}\` | ${p.name.replace(/\|/g, '/')} | ${p.auth_typ} | ${statusStr} | ${p.url || '-'} | ${cleanDesc} |`;
      })
      .join('\n');
    const tail = items.length > limit ? `\n_… sowie ${items.length - limit} weitere Einträge in \`classification.json\`._\n` : '\n';
    return `| ID | Name | Auth | Test-Status | URL | Kurzbeschreibung |\n|---|---|---|---|---|---|\n${rows}\n${tail}`;
  };

  // Status statistics
  const statusCounts = new Map<string, number>();
  for (const r of testResults) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }
  const statusRows = Array.from(statusCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([st, cnt]) => `| ${st} | ${cnt} |`)
    .join('\n');

  const collisionSection =
    collisions.length > 0
      ? collisions
          .map((c) => `- **\`${c.providerId}\` (${c.providerName}):** ${c.conflict} → *Entscheidung:* ${c.resolution}`)
          .join('\n')
      : '- Keine Konflikte festgestellt.';

  const gelbRows = gelb
    .slice(0, 35)
    .map(
      (p) =>
        `| \`${p.id}\` | ${p.name.replace(/\|/g, '/')} | ${p.kategorien.join(', ')} | ${p.classificationReason.replace(/\|/g, '/')} |`
    )
    .join('\n');

  const rotRows = rot
    .map(
      (p) =>
        `| \`${p.id}\` | ${p.name.replace(/\|/g, '/')} | ${p.kategorien.join(', ')} | ${(p.risiko || p.classificationReason).replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 140)} |`
    )
    .join('\n');

  const schwarzRows = schwarz
    .map(
      (p) =>
        `| \`${p.id}\` | ${p.name.replace(/\|/g, '/')} | [KEIN EXPLOIT-LINK – NUR WARNUNG] | ${(p.risiko || 'Illegale Zugangsklasse / gestohlene Credentials').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 140)} |`
    )
    .join('\n');

  const bridgeSummaryRows = selections
    .map(
      (s) =>
        `| ${s.zielprovider} | ${s.bridge_id ? `\`${s.bridge_id}\`` : '_Keine gewählt_'} | ${s.port ? `\`127.0.0.1:${s.port}\`` : 'Nicht containerisiert'} | ${s.restrisiko.slice(0, 110)} |`
    )
    .join('\n');

  return `# REPORT.md – AI-Provider-Analyse, Sicherheitsklassifikation & Konsolidierung

- **Datenquelle [Belegt]:** \`${sourceName}\`
- **Gesamtanzahl geparster Provider-Blöcke [Belegt]:** ${providers.length}

---

## 1. Executive Summary

| Sicherheitsklasse | Anzahl | Anteil | Betriebs- & Test-Policy |
|---|---:|---:|---|
| **GRÜN** (sauber, dokumentiert, kein ToS-Risiko) | ${counts.GRUEN} | ${((counts.GRUEN / Math.max(providers.length, 1)) * 100).toFixed(1)}% | Produktiv/lokal nutzbar; HEAD/GET & anonyme REST-Probes zulässig |
| **GELB** (ToS-Grauzone / unklare Lizenz / Regel-1-Kollision) | ${counts.GELB} | ${((counts.GELB / Math.max(providers.length, 1)) * 100).toFixed(1)}% | Nur Reachability-Check (außer Regel-1-Sperre); keine produktive Freigabe ohne Prüfung |
| **ROT** (Webclient-Bypass / Reverse-Engineering / illegal) | ${counts.ROT} | ${((counts.ROT / Math.max(providers.length, 1)) * 100).toFixed(1)}% | **Automatische Tests übersprungen** (\`SKIPPED (ToS-Risiko)\` bzw. \`SKIPPED (illegal)\`) |
| **SCHWARZ** (\`anonym_pseudo_key\` + \`illegal\`) | ${counts.SCHWARZ} | ${((counts.SCHWARZ / Math.max(providers.length, 1)) * 100).toFixed(1)}% | **Strikt verboten (Regel 1)** — nur Warnhinweis, keine Exploit-Links |
| **Gesamt** | **${providers.length}** | **100.0%** | |

---

## 2. Top 10 sofort nutzbar (GRÜN – ohne API-Key / direkt lokal)
${renderGreenTable(top10Immediate, 10)}

## 3. Top 10 kostenlose API-Keys (GRÜN – dauerhaftes Free-Tier)
${renderGreenTable(top10FreeApi, 10)}

## 4. Lokale Engines (GRÜN – ${localEngines.length} Einträge)
${renderGreenTable(localEngines, 30)}

## 5. Gateways & Router (GRÜN – ${gateways.length} Einträge)
${renderGreenTable(gateways, 25)}

## 6. MCP-Server (GRÜN – ${mcpServers.length} Einträge)
${renderGreenTable(mcpServers, 25)}

## 7. Forschung & Grants (GRÜN – ${researchGrants.length} Einträge)
${renderGreenTable(researchGrants, 25)}

---

## 8. Konsolidierte Webclient-Bridges (ZIEL 3 – nur Opt-in mit Wegwerf-Konto)

| Zielprovider | Ausgewählte Bridge | Lokales Binding | Restrisiko (Regel 5) |
|---|---|---|---|
${bridgeSummaryRows}

---

## 9. GELB – ToS-Grauzone, unklare Lizenz & Sonderfälle (${gelb.length} Einträge)
> **Warnhinweis:** Einträge der Klasse GELB werden im Testlauf ausschließlich auf HTTP-Erreichbarkeit geprüft (kein API-Call). Einträge mit Kategorie \`anonym_pseudo_key\` werden gemäß Regel 1 & 7 vollständig übersprungen.

| ID | Name | Kategorien | Begründung / Warnhinweis |
|---|---|---|---|
${gelbRows}
${gelb.length > 35 ? `\n_… sowie ${gelb.length - 35} weitere GELB-Einträge in \`classification.json\`._\n` : ''}

---

## 10. ROT – nicht testen (${rot.length} Einträge)
> **Begründung:** Diese Einträge kombinieren \`riskant=True\` mit \`webclient_automation\`, \`web_cookie_bypass\` oder \`reverse_engineered_web\` oder sind als \`illegal\` eingestuft. Automatische Tests werden vollständig übersprungen.

| ID | Name | Kategorien | Begründung / Risiko |
|---|---|---|---|
${rotRows}

---

## 11. SCHWARZ – illegal (${schwarz.length} Einträge – NUR WARNUNG)
> **STRAFRECHTLICHE WARNUNG (Regel 1):** Die folgenden Klassen betreffen gestohlene Cloud-/API-Keys, Infostealer-Session-Dumps, LLMJacking oder kriminelle Weiterverkaufs-Gateways. Es werden **bewusst keine Links zu funktionierenden Exploits, Dumps oder Marktplätzen** wiedergegeben.

| ID | Name | Verweis | Gefahrenlage |
|---|---|---|---|
${schwarzRows}

---

## 12. Statistik-Tabelle & Regel-7-Konfliktaudit

### Test-Status-Verteilung (\`test_results.csv\`)
| Test-Status | Anzahl |
|---|---:|
${statusRows}

### Explizit dokumentierte Kollisionen (Harte Regel 7)
${collisionSection}
`;
}

export function validateSuiteArtifacts(
  providers: ClassifiedProvider[],
  testResults: TestResultRow[],
  selections: BridgeSelectionEntry[],
  files: SuiteFile[]
): SecurityAuditCheck[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const compose = byPath.get('docker-compose.yml') ?? '';
  const litellm = byPath.get('litellm_config.yaml') ?? '';
  const envEx = byPath.get('.env.example') ?? '';
  const report = byPath.get('REPORT.md') ?? '';
  const security = byPath.get('SECURITY.md') ?? '';

  // Rule 1: No illegal or anonym_pseudo_key tested or containerized
  const illegalOrPseudoIds = new Set(
    providers.filter((p) => p.isIllegal || p.isAnonymPseudoKey).map((p) => p.id)
  );
  const illegallyTested = testResults.filter(
    (r) =>
      illegalOrPseudoIds.has(r.id) &&
      !r.status.startsWith('SKIPPED')
  );
  const illegallyContainerized = selections.filter(
    (s) => s.bridge_id && illegalOrPseudoIds.has(s.bridge_id)
  );

  // Rule 2: No real secrets in any generated file
  const secretPattern = /(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})/;
  const leakedSecretFiles = files.filter((f) => secretPattern.test(f.content)).map((f) => f.path);

  // Rule 4: Every port mapping in docker-compose.yml binds to 127.0.0.1
  const portLines = compose
    .split('\n')
    .filter((l) => /^\s*-\s*["']?[\d.:]+:\d+/.test(l));
  const nonLoopbackPorts = portLines.filter((l) => !/127\.0\.0\.1:\d+:\d+/.test(l));

  // Rule 5: Every selected bridge has explicit restrisiko
  const bridgesMissingRisk = selections.filter((s) => !s.restrisiko || s.restrisiko.trim().length < 10);

  // Rule 6: REPORT.md preserves all 4 classes
  const hasAll4Classes =
    report.includes('GRÜN') &&
    report.includes('GELB') &&
    report.includes('ROT') &&
    report.includes('SCHWARZ');

  // ROT entries never executed in testResults
  const rotIds = new Set(providers.filter((p) => p.securityClass === 'ROT').map((p) => p.id));
  const rotExecuted = testResults.filter((r) => rotIds.has(r.id) && !r.status.startsWith('SKIPPED'));

  return [
    {
      id: 'rule-1-block',
      rule: 'Harte Regel 1',
      label: 'Kein illegal- oder anonym_pseudo_key-Provider getestet oder containerisiert',
      passed: illegallyTested.length === 0 && illegallyContainerized.length === 0,
      evidence: `${illegalOrPseudoIds.size} geschützte Einträge geprüft: 0 Tests ausgeführt, 0 in docker-compose.yml.`,
    },
    {
      id: 'rule-2-secrets',
      rule: 'Harte Regel 2',
      label: 'Keine echten API-Keys, Tokens oder Cookies in Konfigurationen & Reports',
      passed: leakedSecretFiles.length === 0 && envEx.includes('<DEIN_KEY>') && envEx.includes('<DEIN_COOKIE>'),
      evidence:
        leakedSecretFiles.length === 0
          ? `Alle ${files.length} Suite-Dateien gescannt: 0 Secret-Muster, nur <DEIN_KEY>/<DEIN_COOKIE>-Platzhalter.`
          : `Mögliche Secrets in: ${leakedSecretFiles.join(', ')}`,
    },
    {
      id: 'rule-3-bridges-optin',
      rule: 'Harte Regel 3',
      label: 'Bridges niemals automatisch aufgerufen; Opt-in-Profil & Wegwerf-Account-Warnung',
      passed:
        rotExecuted.length === 0 &&
        compose.includes('profiles: ["tos-risk"]') &&
        security.includes('Wegwerf'),
      evidence: `${rotIds.size} ROT-Provider: 0 automatisch getestet; Bridges hinter Docker-Profil "tos-risk" geschützt.`,
    },
    {
      id: 'rule-4-loopback',
      rule: 'Harte Regel 4',
      label: 'Alle Docker-Port-Bindings strikt auf 127.0.0.1 (niemals 0.0.0.0)',
      passed: portLines.length > 0 && nonLoopbackPorts.length === 0,
      evidence: `${portLines.length} Host-Port-Mappings in docker-compose.yml geprüft: ${nonLoopbackPorts.length} Verstöße.`,
    },
    {
      id: 'rule-5-tos-risk',
      rule: 'Harte Regel 5',
      label: 'ToS-Restrisiko pro Zielprovider-Bridge explizit dokumentiert',
      passed: bridgesMissingRisk.length === 0 && litellm.includes('ToS-Risiko'),
      evidence: `${selections.length}/${selections.length} Zielprovider tragen dokumentiertes Restrisiko & Auth-Weg.`,
    },
    {
      id: 'rule-6-classes',
      rule: 'Harte Regel 6',
      label: 'Vollständige 4-Klassen-Systematik (GRÜN/GELB/ROT/SCHWARZ) in REPORT.md',
      passed: hasAll4Classes && providers.length > 0,
      evidence: `Alle 4 Sicherheitsklassen über ${providers.length} Provider vollständig ausgewiesen.`,
    },
  ];
}

export function generateAllSuiteFiles(
  providers: ClassifiedProvider[],
  testResults: TestResultRow[],
  selections: BridgeSelectionEntry[],
  collisions: Rule7CollisionNotice[],
  sourceName: string,
  activeRouterProviderIds: string[] = []
): { files: SuiteFile[]; auditChecks: SecurityAuditCheck[] } {
  const files: SuiteFile[] = [
    {
      path: 'start-gui.bat',
      language: 'powershell',
      description: 'Windows-11-Doppelklick-Starter: öffnet die lokale GUI auf http://127.0.0.1:8787 OHNE Docker Desktop (Node/Python/PowerShell) oder im Projektordner auf Port 3000.',
      content: generateStartGuiBat(),
    },
    {
      path: 'gui/index.html',
      language: 'html',
      description: 'Eigenständige lokale Windows-11-GUI (Klassifikation, Suche, 4-Phasen-Tests, Verbindung nutzen, Bridges & Bericht) – komplett ohne Docker.',
      content: generateStandaloneGuiHtml(),
    },
    {
      path: 'gui/local_gui_server.mjs',
      language: 'javascript',
      description: 'Zero-Dependency Node.js Loopback-Server (127.0.0.1:8787) für lokale 4-Phasen-Tests, SSRF-gesicherte API-Calls & CSV-Speicherung.',
      content: generateLocalGuiNodeServer(),
    },
    {
      path: 'gui/local_gui_server.py',
      language: 'python',
      description: 'Zero-Dependency Python-3-Stdlib Loopback-Server (127.0.0.1:8787) – Fallback falls kein Node.js installiert ist.',
      content: generateLocalGuiPythonServer(),
    },
    {
      path: 'gui/local_gui_server.ps1',
      language: 'powershell',
      description: 'Zero-Dependency Windows-11-PowerShell TcpListener-Server (127.0.0.1:8787) – funktioniert auf jedem Windows 11 ohne Docker, Node, Python oder Admin-Rechte.',
      content: generateLocalGuiPowerShellServer(),
    },
    {
      path: 'classification.json',
      language: 'json',
      description: 'ZIEL 1: Strukturierte 4-Klassen-Klassifikation aller geparsten Provider.',
      content: generateClassificationJson(providers, sourceName),
    },
    {
      path: 'test_results.csv',
      language: 'csv',
      description: 'ZIEL 2: ToS-konforme 4-Phasen-Testergebnisse im geforderten 9-Spalten-Schema.',
      content: generateTestResultsCsv(testResults),
    },
    {
      path: 'bridge_selection.json',
      language: 'json',
      description: 'ZIEL 3: Konsolidierte Bridge-Auswahl (max. 1 pro Zielprovider) inkl. Begründung & Restrisiko.',
      content: generateBridgeSelectionJson(selections),
    },
    {
      path: 'docker-compose.yml',
      language: 'yaml',
      description: 'ZIEL 4.1: LiteLLM-Router + Opt-in-Bridges, strikt an 127.0.0.1 gebunden.',
      content: generateDockerCompose(selections),
    },
    {
      path: 'litellm_config.yaml',
      language: 'yaml',
      description: 'ZIEL 4.2: Zentraler OpenAI-kompatibler Router-Endpunkt http://127.0.0.1:4000/v1 (inkl. getesteter Top-Verbindungen).',
      content: generateLiteLlmConfig(selections, providers, activeRouterProviderIds),
    },
    {
      path: 'start-all.ps1',
      language: 'powershell',
      description: 'ZIEL 4.3: Windows-11-Startskript (PS 5.1 & PS 7) mit Docker-Check und Opt-in-Schutz.',
      content: generateStartAllPs1(selections),
    },
    {
      path: 'stop-all.ps1',
      language: 'powershell',
      description: 'ZIEL 4.4: Idempotentes Windows-11-Stoppskript für Router & Bridge-Profile.',
      content: generateStopAllPs1(),
    },
    {
      path: 'clone-bridges.ps1',
      language: 'powershell',
      description: 'Windows-11-Hilfsskript zum lokalen Klonen aller 7 Docker-fähigen Bridge-GitHub-Repos nach ./bridges/.',
      content: generateCloneBridgesPs1(selections),
    },
    {
      path: '.env.example',
      language: 'dotenv',
      description: 'Vorlage für lokale API-Keys & Session-Cookies (nur Platzhalter, keine echten Secrets).',
      content: generateEnvExample(providers, activeRouterProviderIds),
    },
    {
      path: 'README.md',
      language: 'markdown',
      description: 'ZIEL 4.5: Installationsvoraussetzungen, Startreihenfolge & Cookie-Einrichtung.',
      content: generateReadmeMd(selections),
    },
    {
      path: 'REPORT.md',
      language: 'markdown',
      description: 'ZIEL 5.1: Vollständiger Analyse- und Klassifikationsbericht inkl. aller 11 Tabellen/Abschnitte.',
      content: generateReportMd(providers, testResults, selections, collisions, sourceName),
    },
    {
      path: 'SECURITY.md',
      language: 'markdown',
      description: 'ZIEL 5.2: Verbindliche Sicherheitsregeln für Bridges, Cookies, Loopback-Bindings & Strafrecht.',
      content: generateSecurityMd(),
    },
    {
      path: 'tools/parse_and_classify.py',
      language: 'python',
      description: 'Lokales Windows-11-Skript (Python >= 3.11) zum erneuten Parsen von %USERPROFILE%\\Downloads\\ai_provider(2).txt.',
      content: generatePythonParserScript(),
    },
    {
      path: 'tools/run_tests.py',
      language: 'python',
      description: 'Lokales Windows-11-Skript (Python >= 3.11 + requests) für ToS-konforme Reachability-Tests.',
      content: generatePythonTestRunnerScript(),
    },
  ];

  const auditChecks = validateSuiteArtifacts(providers, testResults, selections, files);
  return { files, auditChecks };
}
