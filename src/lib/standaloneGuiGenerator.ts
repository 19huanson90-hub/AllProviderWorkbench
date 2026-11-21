/**
 * Generates a complete, Docker-free standalone local Windows-11 GUI bundle
 * included inside ai-provider-suite.zip so double-clicking start-gui.bat
 * launches a full interactive Workbench on http://127.0.0.1:8787 with ZERO
 * Docker Desktop requirement (Node -> Python -> built-in PowerShell TcpListener).
 */

export function generateStandaloneGuiHtml(): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI-Provider-Suite – Lokale Windows-11-GUI (ohne Docker)</title>
  <style>
    :root {
      --bg: #f8fafc; --surface: #ffffff; --border: #e2e8f0; --text: #0f172a;
      --muted: #475569; --subtle: #64748b; --accent: #0f766e; --accent-hover: #115e59;
      --green: #047857; --amber: #b45309; --red: #b91c1c; --dark: #0f172a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.45;
    }
    code, pre, .mono { font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; }
    .topbar {
      position: sticky; top: 0; z-index: 20; background: var(--surface);
      border-bottom: 1px solid var(--border); padding: 12px 20px;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
    }
    .brand { display: flex; align-items: center; gap: 10px; }
    .brand-icon {
      width: 32px; height: 32px; border-radius: 6px; background: var(--accent);
      color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 14px;
    }
    .brand h1 { margin: 0; font-size: 16px; font-weight: 600; }
    .brand p { margin: 0; font-size: 12px; color: var(--subtle); }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
    .tab-btn {
      border: 1px solid var(--border); background: var(--surface); color: var(--muted);
      padding: 7px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500;
    }
    .tab-btn.active { background: #f0fdfa; border-color: #99f6e4; color: #134e4a; font-weight: 600; }
    .container { max-width: 1320px; margin: 0 auto; padding: 18px 20px 48px; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 8px; padding: 16px; margin-bottom: 16px;
    }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .kpi { border: 1px solid var(--border); border-radius: 6px; padding: 12px; background: #f8fafc; }
    .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--subtle); }
    .kpi-val { font-size: 22px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
    .btn {
      border: 1px solid #cbd5e1; background: #fff; color: var(--text); padding: 7px 12px;
      border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;
    }
    .btn:hover:not(:disabled) { background: #f1f5f9; }
    .btn:disabled { opacity: .5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-dark { background: #0f172a; border-color: #0f172a; color: #fff; }
    .btn-danger { background: #fef2f2; border-color: #fecaca; color: var(--red); }
    .btn-sm { padding: 4px 9px; font-size: 11px; }
    input[type="text"], input[type="search"], input[type="url"], input[type="password"], select {
      border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 10px; font-size: 13px;
      background: #fff; color: var(--text);
    }
    input:focus, select:focus { outline: 2px solid #99f6e4; border-color: var(--accent); }
    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th {
      background: #f8fafc; border-bottom: 1px solid var(--border); padding: 10px 12px;
      font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--subtle);
    }
    td { border-bottom: 1px solid #f1f5f9; padding: 9px 12px; vertical-align: top; }
    tr:hover td { background: #f8fafc; }
    .cls-GRUEN { color: var(--green); font-weight: 700; }
    .cls-GELB { color: var(--amber); font-weight: 700; }
    .cls-ROT { color: var(--red); font-weight: 700; }
    .cls-SCHWARZ { color: var(--dark); font-weight: 700; }
    .st-ok { color: var(--green); font-weight: 600; }
    .st-waf { color: var(--amber); font-weight: 600; }
    .st-err { color: var(--red); font-weight: 600; }
    .st-skip { color: var(--subtle); font-weight: 500; }
    .muted { color: var(--subtle); font-size: 12px; }
    .progress-bar { height: 6px; background: #ccfbf1; border-radius: 3px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; background: var(--accent); transition: width .2s; }
    pre.codebox {
      background: #0f172a; color: #f1f5f9; padding: 14px; border-radius: 6px;
      overflow: auto; max-height: 520px; font-size: 12px; line-height: 1.5; margin: 0;
    }
    .drawer-backdrop {
      position: fixed; inset: 0; background: rgba(15,23,42,.38); z-index: 50;
      display: none; justify-content: flex-end;
    }
    .drawer-backdrop.open { display: flex; }
    .drawer {
      width: 100%; max-width: 680px; height: 100%; background: #fff;
      border-left: 1px solid var(--border); overflow-y: auto; padding: 20px;
    }
    .warn-box {
      border: 1px solid #fde68a; background: #fffbeb; color: #78350f;
      padding: 10px 12px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;
    }
    .phase-row {
      display: flex; justify-content: space-between; gap: 10px; border: 1px solid var(--border);
      border-radius: 6px; padding: 7px 10px; margin-top: 6px; font-size: 12px; background: #fff;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-icon">AI</div>
      <div>
        <h1>AI-Provider-Suite – Lokale Windows-11-GUI</h1>
        <p id="runtime-subtitle" class="mono">Strikt 127.0.0.1 · Kein Docker erforderlich · Regel 1–7 aktiv</p>
      </div>
    </div>
    <nav class="tabs" aria-label="Hauptnavigation">
      <button class="tab-btn active" data-tab="classification">Klassifikation</button>
      <button class="tab-btn" data-tab="tests">4-Phasen-Tests</button>
      <button class="tab-btn" data-tab="bridges">Bridges (Ziel 3)</button>
      <button class="tab-btn" data-tab="chat">Chat-Fenster</button>
      <button class="tab-btn" data-tab="docs">Bericht & Dateien</button>
    </nav>
  </header>

  <main class="container">
    <!-- Summary KPI Strip -->
    <section class="card">
      <div class="grid-4" id="kpi-grid"></div>
    </section>

    <!-- TAB 1: CLASSIFICATION -->
    <section id="tab-classification">
      <div class="card">
        <div class="toolbar">
          <div style="display:flex;flex-wrap:wrap;gap:8px;flex:1;min-width:260px;">
            <input id="cls-search" type="search" placeholder="Name, ID oder URL filtern (z. B. groq, ollama, github.com)…" style="flex:1;min-width:220px;" aria-label="Provider suchen" />
            <select id="cls-class" aria-label="Sicherheitsklasse">
              <option value="ALL">Alle Klassen</option>
              <option value="GRUEN">GRÜN</option>
              <option value="GELB">GELB</option>
              <option value="ROT">ROT</option>
              <option value="SCHWARZ">SCHWARZ</option>
            </select>
          </div>
          <div class="muted mono" id="cls-count"></div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:95px">Klasse</th>
              <th style="width:240px">Provider / ID / URL</th>
              <th style="width:170px">Kategorien</th>
              <th style="width:110px">Auth</th>
              <th>Verbindung & Begründung</th>
              <th style="width:145px;text-align:right">Aktion</th>
            </tr>
          </thead>
          <tbody id="cls-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- TAB 2: 4-PHASE LIVE TESTS -->
    <section id="tab-tests" class="hidden">
      <div class="card">
        <div class="toolbar">
          <div>
            <strong>4-Phasen-Test-Engine (Einzeltest & Gesamttest)</strong>
            <div class="muted">P1 DNS → P2 HTTP/TLS + WAF-Erkennung → P3 GET /models (nur GRÜN) → P4 Score 0–100. ROT/SCHWARZ/Regel 1 gesperrt.</div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="btn btn-primary" id="btn-batch-all">Gesamttest: Alle GRÜN & GELB</button>
            <button class="btn" id="btn-batch-green">Alle GRÜN</button>
            <button class="btn" id="btn-batch-gelb">Alle GELB</button>
            <button class="btn" id="btn-batch-top12">Top 12 GRÜN</button>
            <button class="btn btn-danger hidden" id="btn-batch-stop">Stopp</button>
            <button class="btn" id="btn-save-csv">test_results.csv speichern</button>
          </div>
        </div>
        <div id="batch-progress" class="hidden" style="margin-top:12px;">
          <div class="toolbar mono" style="font-size:12px;">
            <span id="batch-label">Testlauf aktiv…</span>
            <span id="batch-pct">0 / 0</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" id="batch-fill" style="width:0%"></div></div>
        </div>
        <div id="test-summary-bar" class="muted mono" style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;"></div>
      </div>

      <div class="card">
        <div class="toolbar">
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="btn btn-sm" data-tfilter="ALL">Alle</button>
            <button class="btn btn-sm" data-tfilter="EXECUTED">Getestet</button>
            <button class="btn btn-sm" data-tfilter="OK">OK / Redirect</button>
            <button class="btn btn-sm" data-tfilter="WAF">WAF (403/429)</button>
            <button class="btn btn-sm" data-tfilter="ERR">Fehler</button>
            <button class="btn btn-sm" data-tfilter="SKIP">Gesperrt / Skip</button>
          </div>
          <input id="test-search" type="search" placeholder="Provider, Status oder URL suchen…" style="width:260px;" />
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:90px">Klasse</th>
              <th style="width:220px">Provider</th>
              <th style="width:165px">Status & Phasen</th>
              <th style="width:110px">Score / HTTP</th>
              <th>Diagnose & URL</th>
              <th style="width:155px;text-align:right">Aktionen</th>
            </tr>
          </thead>
          <tbody id="test-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- TAB 3: BRIDGES -->
    <section id="tab-bridges" class="hidden">
      <div class="card">
        <strong>ZIEL 3 – Konsolidierte Webclient-Bridges (Klick auf eine Bridge zum Ausführen)</strong>
        <div class="muted">Alle Bridges tragen Klasse ROT (ToS-Risiko). Klicke auf eine freigegebene Bridge oder auf „Ausführen“, um sie nach ToS-Bestätigung strikt lokal auf 127.0.0.1 zu starten und zu testen.</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:130px">Zielprovider</th>
              <th style="width:210px">Ausgewählte Bridge</th>
              <th style="width:125px">Port & Status</th>
              <th style="width:170px">Auth-Weg</th>
              <th>Begründung & Restrisiko</th>
              <th style="width:120px;text-align:right">Aktion</th>
            </tr>
          </thead>
          <tbody id="bridges-tbody"></tbody>
        </table>
      </div>
    </section>

    <!-- TAB 4: CHAT-FENSTER -->
    <section id="tab-chat" class="hidden">
      <div style="display:grid;grid-template-columns:minmax(260px,340px) 1fr;gap:14px;align-items:start;">
        <div class="card" style="display:grid;gap:10px;">
          <div class="toolbar">
            <strong>Chat-Ziel wählen</strong>
            <span class="muted mono" style="font-size:11px;">127.0.0.1 / SSRF</span>
          </div>
          <div>
            <label class="muted" for="chat-mode">Zieltyp</label>
            <select id="chat-mode" style="width:100%;margin-top:3px;">
              <option value="bridge">Bridge (Klasse ROT · lokal 127.0.0.1)</option>
              <option value="provider">Provider (GRÜN / GELB)</option>
              <option value="litellm">LiteLLM-Router (127.0.0.1:4000)</option>
              <option value="custom_local">Lokal (127.0.0.1 / Ollama / LM Studio)</option>
            </select>
          </div>
          <div id="chat-bridge-wrap">
            <label class="muted" for="chat-bridge">Bridge auswählen</label>
            <select id="chat-bridge" style="width:100%;margin-top:3px;"></select>
          </div>
          <div id="chat-provider-wrap" class="hidden">
            <label class="muted" for="chat-provider">Provider auswählen (GRÜN / GELB)</label>
            <select id="chat-provider" style="width:100%;margin-top:3px;"></select>
          </div>
          <div>
            <label class="muted" for="chat-base">OpenAI-kompatible Basis-URL</label>
            <input id="chat-base" type="text" class="mono" style="width:100%;margin-top:3px;" value="http://127.0.0.1:8001/v1" />
          </div>
          <div>
            <div class="toolbar">
              <label class="muted" for="chat-model">Modell-ID</label>
              <button class="btn btn-sm" id="chat-load-models">Modelle laden</button>
            </div>
            <input id="chat-model" type="text" list="chat-model-list" class="mono" style="width:100%;margin-top:3px;" value="default" />
            <datalist id="chat-model-list"></datalist>
            <div id="chat-models-note" class="muted" style="margin-top:4px;font-size:11px;"></div>
          </div>
          <div>
            <label class="muted" for="chat-key">Session-Key / Bridge-Token (nur RAM)</label>
            <input id="chat-key" type="password" autocomplete="off" class="mono" style="width:100%;margin-top:3px;" placeholder="Optional – wird nie gespeichert" />
          </div>
          <div>
            <label class="muted" for="chat-sys">System-Prompt (optional)</label>
            <textarea id="chat-sys" rows="2" style="width:100%;margin-top:3px;font-family:inherit;font-size:12px;padding:6px;border:1px solid #cbd5e1;border-radius:6px;" placeholder="z. B. Antworte knapp auf Deutsch."></textarea>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;min-height:520px;padding:0;overflow:hidden;">
          <div class="toolbar" style="padding:12px 14px;border-bottom:1px solid var(--border);background:#f8fafc;">
            <div>
              <strong id="chat-active-title">Direkt-Chat</strong>
              <div id="chat-active-sub" class="muted mono" style="font-size:11px;"></div>
            </div>
            <button class="btn btn-sm" id="chat-clear">Verlauf leeren</button>
          </div>
          <div id="chat-messages" style="flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;max-height:460px;">
            <div class="muted" style="text-align:center;padding:30px 10px;">
              Wähle links eine Bridge, einen GRÜN/GELB-Provider oder einen lokalen Endpunkt und sende deine erste Nachricht.
            </div>
          </div>
          <div style="border-top:1px solid var(--border);padding:10px 12px;background:#f8fafc;display:flex;gap:8px;align-items:flex-end;">
            <textarea id="chat-input" rows="2" style="flex:1;font-family:inherit;font-size:13px;padding:8px;border:1px solid #cbd5e1;border-radius:6px;resize:none;" placeholder="Nachricht eingeben… (Enter = Senden, Shift+Enter = Umbruch)"></textarea>
            <button class="btn btn-primary" id="chat-send" style="height:40px;">Senden</button>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 5: DOCS & CONFIGS -->
    <section id="tab-docs" class="hidden">
      <div class="card">
        <div class="toolbar">
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button class="btn btn-sm doc-btn" data-doc="REPORT.md">REPORT.md</button>
            <button class="btn btn-sm doc-btn" data-doc="litellm_config.yaml">litellm_config.yaml</button>
            <button class="btn btn-sm doc-btn" data-doc="docker-compose.yml">docker-compose.yml</button>
            <button class="btn btn-sm doc-btn" data-doc="SECURITY.md">SECURITY.md</button>
            <button class="btn btn-sm doc-btn" data-doc="README.md">README.md</button>
          </div>
          <span class="muted mono" id="doc-title">REPORT.md</span>
        </div>
      </div>
      <pre class="codebox"><code id="doc-content">Lade Datei…</code></pre>
    </section>
  </main>

  <!-- CONNECTION USE DRAWER -->
  <div id="use-backdrop" class="drawer-backdrop" role="dialog" aria-modal="true" aria-label="Verbindung nutzen">
    <div class="drawer" id="use-drawer">
      <div class="toolbar" style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:14px;">
        <div>
          <div id="use-meta" class="mono" style="font-size:12px;"></div>
          <h2 id="use-title" style="margin:4px 0 0;font-size:18px;"></h2>
          <div id="use-kind-sub" class="muted" style="margin-top:2px;"></div>
        </div>
        <button class="btn" id="use-close">Schließen</button>
      </div>
      <div id="use-gelb-warn" class="warn-box hidden">
        <strong>Hinweis: Klasse GELB (ToS-Grauzone / unklare Lizenz)</strong><br />
        Automatische Tests prüfen nur Phase 1+2 (Reachability). Direkte API-Aufrufe unten erfolgen nur auf deine manuelle Auslösung.
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <button class="btn btn-primary" id="use-open-chat">Im Chat öffnen</button>
        <button class="btn" id="use-retest">4-Phasen-Einzeltest</button>
        <a id="use-portal" class="btn" target="_blank" rel="noreferrer" style="text-decoration:none;">Portal öffnen</a>
      </div>
      <div class="card" style="background:#f8fafc;">
        <div class="mono" style="font-size:11px;font-weight:700;color:var(--subtle);text-transform:uppercase;">4-Phasen-Diagnose</div>
        <div id="use-phases" style="margin-top:8px;"></div>
      </div>
      <div class="card">
        <div class="toolbar" style="margin-bottom:8px;">
          <span id="use-invoke-heading" class="mono" style="font-size:11px;font-weight:700;color:var(--subtle);text-transform:uppercase;">
            Verbindung direkt nutzen (SSRF-gesichert, Key nur im RAM – Regel 2)
          </span>
          <button class="btn btn-sm hidden" id="use-toggle-manual">Manuellen HTTP-Test zeigen</button>
        </div>
        <div id="use-endpoint-note" class="warn-box hidden" style="background:#f8fafc;border-color:#cbd5e1;color:#334155;"></div>
        <div id="use-rest-form" style="display:grid;gap:10px;">
          <div>
            <label class="muted" for="use-base">OpenAI-kompatible Basis-URL</label>
            <input id="use-base" type="url" style="width:100%;margin-top:3px;" class="mono" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label class="muted" for="use-key">Session-API-Key (RAM-only)</label>
              <input id="use-key" type="password" autocomplete="off" style="width:100%;margin-top:3px;" class="mono" placeholder="Optionaler API-Key" />
            </div>
            <div>
              <label class="muted" for="use-model">Modell-ID (für Chat)</label>
              <input id="use-model" type="text" style="width:100%;margin-top:3px;" class="mono" placeholder="z. B. llama-3.3-70b-versatile" />
            </div>
          </div>
          <div>
            <label class="muted" for="use-prompt">Test-Prompt</label>
            <input id="use-prompt" type="text" value="Antworte mit genau einem Wort: OK" style="width:100%;margin-top:3px;" />
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="btn" id="use-call-models">Modelle abrufen (GET /models)</button>
            <button class="btn btn-dark" id="use-call-chat">Test-Prompt senden (POST /chat/completions)</button>
          </div>
          <pre id="use-invoke-out" class="codebox hidden" style="max-height:220px;"></pre>
        </div>
      </div>
      <div class="card">
        <div class="toolbar" style="margin-bottom:8px;">
          <span class="mono" style="font-size:11px;font-weight:700;color:var(--subtle);text-transform:uppercase;">Nutzungs-Snippet (PowerShell &amp; curl.exe, ohne Secrets)</span>
          <button class="btn btn-sm" id="use-copy-snippet">Kopieren</button>
        </div>
        <pre id="use-snippet" class="codebox" style="max-height:220px;"></pre>
      </div>
    </div>
  </div>

  <!-- BRIDGE EXECUTION DRAWER -->
  <div id="bridge-backdrop" class="drawer-backdrop" role="dialog" aria-modal="true" aria-label="Bridge ausführen">
    <div class="drawer" id="bridge-drawer">
      <div class="toolbar" style="border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:14px;">
        <div>
          <div id="br-meta" class="mono" style="font-size:12px;"></div>
          <h2 id="br-title" style="margin:4px 0 0;font-size:18px;"></h2>
        </div>
        <button class="btn" id="br-close">Schließen</button>
      </div>
      <div class="warn-box" style="background:#fef2f2;border-color:#fecaca;color:#7f1d1d;">
        <strong>ToS-Restrisiko (Klasse ROT · Regel 5)</strong>
        <div id="br-risk" style="margin-top:4px;"></div>
        <div id="br-auth" style="margin-top:6px;"></div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;background:#fff;padding:8px;border-radius:6px;border:1px solid #fecaca;color:#0f172a;cursor:pointer;">
          <input type="checkbox" id="br-confirm-tos" style="margin-top:2px;" />
          <span>Ich bestätige das ToS-Restrisiko (Klasse ROT) und starte diese Bridge nur lokal auf 127.0.0.1 mit eigenem Testkonto.</span>
        </label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <button class="btn btn-primary" id="br-btn-start" disabled>Bridge ausführen</button>
        <button class="btn btn-danger hidden" id="br-btn-stop">Stoppen</button>
        <button class="btn" id="br-btn-probe">Loopback testen</button>
        <button class="btn" id="br-btn-chat">Im Chat öffnen</button>
      </div>
      <div class="card" style="background:#f8fafc;">
        <div class="toolbar" style="margin-bottom:6px;">
          <span class="mono" style="font-size:11px;font-weight:700;color:var(--subtle);text-transform:uppercase;">Laufzeit-Diagnose &amp; Live-Logs</span>
          <span id="br-status-badge" class="mono" style="font-size:11px;">GESTOPPT</span>
        </div>
        <div id="br-error-box" class="warn-box hidden" style="background:#fef2f2;border-color:#fecaca;color:#991b1b;"></div>
        <pre id="br-logs" class="codebox" style="max-height:220px;">Noch keine Ausführung gestartet.</pre>
      </div>
      <div class="card">
        <div class="toolbar" style="margin-bottom:8px;">
          <span class="mono" style="font-size:11px;font-weight:700;color:var(--subtle);text-transform:uppercase;">Windows-11 Kommandos (PowerShell / curl.exe)</span>
          <button class="btn btn-sm" id="br-copy-cmd">Kopieren</button>
        </div>
        <pre id="br-cmd" class="codebox" style="max-height:200px;"></pre>
      </div>
    </div>
  </div>

  <script>
    const state = {
      providers: [],
      results: new Map(),
      bridges: [],
      bridgeRuntimes: new Map(),
      testFilter: 'ALL',
      batchStop: false,
      batchRunning: false,
      activeUseProvider: null,
      activeBridge: null,
      chatMessages: [],
      chatSending: false,
    };

    function esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    function normalizeClass(p) {
      const c = p.security_class || p.securityClass || '';
      if (c === 'GRÜN' || c === 'GRUEN') return 'GRUEN';
      if (c === 'GELB') return 'GELB';
      if (c === 'ROT') return 'ROT';
      return 'SCHWARZ';
    }

    function isUsable(p) {
      if (!p || p.illegal || p.isIllegal || p.anonym_pseudo_key || p.isAnonymPseudoKey) return false;
      if (Array.isArray(p.kategorien) && p.kategorien.includes('anonym_pseudo_key')) return false;
      if (String(p.test_policy || '').startsWith('SKIP_RULE1_')) return false;
      const cls = normalizeClass(p);
      return cls === 'GRUEN' || cls === 'GELB';
    }

    function normalizeEnvVar(p) {
      const slug = String(p.id || 'API').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (slug.endsWith('_API_KEY')) return slug;
      if (slug.endsWith('_API')) return slug + '_KEY';
      return slug + '_API_KEY';
    }

    function classifyConnKind(p) {
      const verb = String(p.verbindungsart || '').trim();
      const proto = String(p.protokoll || '').trim();
      const url = String(p.url || '').trim();
      const cats = Array.isArray(p.kategorien) ? p.kategorien : [];
      const id = String(p.id || '').toLowerCase();
      const idName = (id + ' ' + String(p.name || '')).toLowerCase();
      const isLocalOpenAi = cats.includes('lokal_self_hosted') && (/\\b(ollama|lm-?studio|vllm|llama-?cpp|localai|jan|koboldcpp|litellm|mistral-?rs|textgen|xinference|tabbyapi|aphrodite|mlx-?lm|ramalama|exo)\\b/i.test(idName) || /openai_kompatibel/i.test(proto));
      if (/w3\\.org\\/tr\\//i.test(url) || (/browser-only|browser-sdk/i.test(verb) && !/openai_kompatibel/i.test(proto))) {
        return { kind: 'browser_only', label: 'Browser-Only / Web-Standard (kein HTTP-/v1-Endpunkt)', supportsOpenAi: false };
      }
      if (/anthropic-native|bedrock-converse|gemini-native/i.test(verb) && !/openai/i.test(proto + ' ' + verb)) {
        return { kind: 'native_rest', label: 'Proprietaere REST-API (' + verb + ')', supportsOpenAi: false };
      }
      const isNonChatPortal = /developer\\.amd\\.com|cohere\\.com\\/research|metr\\.org|registry\\.modelcontextprotocol\\.io|cvron\\.org/i.test(url) || id === 'amd-ai-developer-program' || id === 'cohere-labs';
      if (isNonChatPortal) {
        return { kind: 'mcp_or_sdk', label: 'Kredit-/Forschungs-Portal (kein direkter Chat-Endpunkt)', supportsOpenAi: false };
      }
      if (!isLocalOpenAi && ((/^mcp\\b|sdk-eigen/i.test(verb) && !/https?:\\/\\//i.test(verb)) || (/github\\.com/i.test(url) && !/rest|openai|gateway/i.test(verb)))) {
        return { kind: 'mcp_or_sdk', label: /^mcp\\b/i.test(verb) ? 'MCP-Server / Tool-Protokoll' : 'SDK / Repository / Lokales Tool', supportsOpenAi: false };
      }
      if (isLocalOpenAi || /rest|openai|gateway/i.test(verb) || /openai_kompatibel/i.test(proto)) {
        return { kind: 'openai_rest', label: isLocalOpenAi ? 'Lokale OpenAI-kompatible Engine (127.0.0.1)' : 'REST / OpenAI-kompatible API', supportsOpenAi: true };
      }
      if (cats.includes('edge_browser') || cats.includes('web_chat')) {
        return { kind: 'browser_only', label: 'Browser-Portal / Web-Anwendung', supportsOpenAi: false };
      }
      return { kind: 'mcp_or_sdk', label: verb && verb !== 'null' ? verb : 'Portal / Dokumentation / SDK', supportsOpenAi: false };
    }

    function defaultApiBase(p, kindInfo) {
      const k = kindInfo || classifyConnKind(p);
      const url = String(p.url || '').trim();
      const id = String(p.id || '').toLowerCase();
      const cats = Array.isArray(p.kategorien) ? p.kategorien : [];
      if (!k.supportsOpenAi) return url || 'http://127.0.0.1:11434';
      if (cats.includes('lokal_self_hosted')) {
        if (id.includes('ollama')) return 'http://127.0.0.1:11434/v1';
        if (id.includes('vllm')) return 'http://127.0.0.1:8000/v1';
        if (id.includes('llama-cpp') || id.includes('llamacpp')) return 'http://127.0.0.1:8080/v1';
        if (id.includes('litellm')) return 'http://127.0.0.1:4000/v1';
        return 'http://127.0.0.1:1234/v1';
      }
      const emb = String(p.verbindungsart || '').match(/\\(([a-z0-9.-]+\\.[a-z]{2,}\\/[a-z0-9/_-]*)/i);
      if (emb && emb[1]) {
        const c = emb[1].replace(/\\/+$/, '');
        return 'https://' + (c.endsWith('/openai') ? c + '/v1' : c);
      }
      const descUrl = String(p.beschreibung || '').match(/https?:\\/\\/[a-z0-9.-]+\\/[a-z0-9/_-]*\\/v1\\b/i);
      if (descUrl && descUrl[0]) return descUrl[0].replace(/\\/+$/, '');
      if (id.includes('pollinations')) return 'https://text.pollinations.ai/openai';
      if (id.includes('hack-club')) return 'https://ai.hackclub.com/proxy/v1';
      if (id.includes('ovh')) return 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1';
      if (id.includes('openrouter')) return 'https://openrouter.ai/api/v1';
      if (id.includes('groq')) return 'https://api.groq.com/openai/v1';
      if (id.includes('cerebras')) return 'https://api.cerebras.ai/v1';
      if (id.includes('together')) return 'https://api.together.xyz/v1';
      if (id.includes('mistral-la-plateforme') || id === 'mistral' || id === 'mistral-api') return 'https://api.mistral.ai/v1';
      if (id === 'deepseek' || id.includes('deepseek-api')) return 'https://api.deepseek.com/v1';
      if (id.includes('sambanova')) return 'https://api.sambanova.ai/v1';
      if (id.includes('siliconflow')) return 'https://api.siliconflow.com/v1';
      if (id === 'venice-ai' || id.includes('venice')) return 'https://api.venice.ai/api/v1';
      if (url.startsWith('http') && !url.includes('github.com')) {
        const clean = url.replace(/\\/+$/, '');
        if (/\\/v1(\\b|\\/)/i.test(clean)) return clean;
        if (/\\/docs(\\/|$)/i.test(clean)) return clean;
        return clean + '/v1';
      }
      return url || 'http://127.0.0.1:11434/v1';
    }

    function parseCsv(text) {
      const lines = text.trim().split(/\\r?\\n/);
      if (lines.length < 2) return [];
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = [];
        let cur = '', inQ = false;
        for (let j = 0; j < lines[i].length; j++) {
          const ch = lines[i][j];
          if (ch === '"' && lines[i][j+1] === '"') { cur += '"'; j++; }
          else if (ch === '"') inQ = !inQ;
          else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
          else cur += ch;
        }
        vals.push(cur);
        if (vals[0]) {
          rows.push({
            id: vals[0], name: vals[1], kategorie: vals[2], status: vals[3],
            http_code: vals[4], risky: vals[5] === 'True', empfohlen: vals[6],
            note: vals[7], url: vals[8], executed: !['PENDING'].includes(vals[3]) && !String(vals[3]).startsWith('SKIPPED')
          });
        }
      }
      return rows;
    }

    function renderKpis() {
      const counts = { GRUEN: 0, GELB: 0, ROT: 0, SCHWARZ: 0 };
      let usable = 0, tested = 0;
      for (const p of state.providers) {
        counts[normalizeClass(p)]++;
        if (isUsable(p)) usable++;
        const r = state.results.get(p.id);
        if (r && r.executed) tested++;
      }
      document.getElementById('kpi-grid').innerHTML = [
        ['Gesamt-Provider', state.providers.length, 'var(--text)'],
        ['GRÜN (Sicher)', counts.GRUEN, 'var(--green)'],
        ['GELB (Grauzone)', counts.GELB, 'var(--amber)'],
        ['ROT (ToS-Risiko)', counts.ROT, 'var(--red)'],
        ['SCHWARZ (Gesperrt)', counts.SCHWARZ, 'var(--dark)'],
        ['Testbar / Getestet', tested + ' / ' + usable, 'var(--accent)'],
      ].map(([l, v, c]) => '<div class="kpi"><div class="kpi-label">' + l + '</div><div class="kpi-val mono" style="color:' + c + '">' + v + '</div></div>').join('');
    }

    function renderClassification() {
      const q = document.getElementById('cls-search').value.trim().toLowerCase();
      const clsF = document.getElementById('cls-class').value;
      const list = state.providers.filter((p) => {
        const c = normalizeClass(p);
        if (clsF !== 'ALL' && c !== clsF) return false;
        if (q) {
          const hay = (p.name + ' ' + p.id + ' ' + (c === 'SCHWARZ' ? '' : p.url || '')).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      document.getElementById('cls-count').textContent = 'Angezeigt: ' + list.length + ' / ' + state.providers.length;
      document.getElementById('cls-tbody').innerHTML = list.map((p) => {
        const c = normalizeClass(p);
        const usable = isUsable(p);
        const urlShow = c === 'SCHWARZ' || p.illegal ? '[GESPERRT – Regel 1]' : (p.url || '—');
        return '<tr>'
          + '<td class="mono cls-' + c + '">' + (c === 'GRUEN' ? 'GRÜN' : c) + '</td>'
          + '<td><strong>' + esc(p.name) + '</strong><div class="mono muted">' + esc(p.id) + '</div><div class="mono muted" style="word-break:break-all;font-size:11px;">' + esc(urlShow) + '</div></td>'
          + '<td class="mono" style="font-size:12px;">' + esc((p.kategorien || []).join(' · ')) + '</td>'
          + '<td class="mono" style="font-size:12px;">' + esc(p.auth_typ || '—') + '</td>'
          + '<td style="font-size:12px;">' + esc(p.verbindungsart || '—') + '<div class="muted">' + esc(p.classification_reason || p.classificationReason || '') + '</div></td>'
          + '<td style="text-align:right;white-space:nowrap;">'
            + (usable
                ? '<button class="btn btn-sm" data-action="test" data-id="' + esc(p.id) + '">Testen</button> '
                  + '<button class="btn btn-sm btn-primary" data-action="use" data-id="' + esc(p.id) + '">Nutzen</button>'
                : '<span class="mono muted">Gesperrt</span>')
          + '</td></tr>';
      }).join('');
    }

    function statusClass(st) {
      if (st === 'OK' || st === 'OK_API_PROBE' || st === 'REDIRECT') return 'st-ok';
      if (st === 'WAF_PROTECTED' || st === 'AUTH_REQUIRED') return 'st-waf';
      if (st === 'HTTP_ERROR' || st === 'TIMEOUT' || st === 'NETWORK_ERROR') return 'st-err';
      return 'st-skip';
    }

    function renderTests() {
      const q = document.getElementById('test-search').value.trim().toLowerCase();
      let ok = 0, waf = 0, err = 0, tested = 0, usable = 0;
      const rows = [];
      for (const p of state.providers) {
        const r = state.results.get(p.id) || { id: p.id, name: p.name, status: 'PENDING', http_code: '-', note: '', url: p.url, executed: false };
        if (isUsable(p)) usable++;
        if (r.executed) tested++;
        if (['OK','OK_API_PROBE','REDIRECT','AUTH_REQUIRED'].includes(r.status)) ok++;
        else if (r.status === 'WAF_PROTECTED') waf++;
        else if (['HTTP_ERROR','TIMEOUT','NETWORK_ERROR'].includes(r.status)) err++;

        const tf = state.testFilter;
        if (tf === 'EXECUTED' && !r.executed) continue;
        if (tf === 'OK' && !['OK','OK_API_PROBE','REDIRECT','AUTH_REQUIRED'].includes(r.status)) continue;
        if (tf === 'WAF' && r.status !== 'WAF_PROTECTED') continue;
        if (tf === 'ERR' && !['HTTP_ERROR','TIMEOUT','NETWORK_ERROR'].includes(r.status)) continue;
        if (tf === 'SKIP' && !String(r.status).startsWith('SKIPPED')) continue;
        if (q && !(p.name + ' ' + p.id + ' ' + r.status + ' ' + r.note + ' ' + (r.url || '')).toLowerCase().includes(q)) continue;
        rows.push({ p, r });
      }
      document.getElementById('test-summary-bar').textContent =
        'Abdeckung: ' + tested + ' / ' + usable + '  ·  Erreichbar/Auth: ' + ok + '  ·  WAF: ' + waf + '  ·  Fehler: ' + err;
      document.getElementById('test-tbody').innerHTML = rows.map(({ p, r }) => {
        const c = normalizeClass(p);
        const u = isUsable(p);
        const pStrip = Array.isArray(r.phases)
          ? '<div class="mono" style="font-size:11px;margin-top:3px;">' + r.phases.map((ph, idx) => 'P' + (idx+1) + ':' + ph.status.toUpperCase()).join(' ') + '</div>'
          : '';
        return '<tr>'
          + '<td class="mono cls-' + c + '">' + (c === 'GRUEN' ? 'GRÜN' : c) + '</td>'
          + '<td><strong>' + esc(p.name) + '</strong><div class="mono muted">' + esc(p.id) + '</div></td>'
          + '<td><span class="mono ' + statusClass(r.status) + '">' + esc(r.status) + '</span>' + pStrip + '</td>'
          + '<td class="mono" style="font-size:12px;">' + (r.healthScore !== undefined ? '<strong>' + r.healthScore + '/100</strong><br/>' : '') + 'HTTP ' + esc(r.http_code || '-') + (r.latencyMs ? ' · ' + r.latencyMs + 'ms' : '') + '</td>'
          + '<td style="font-size:12px;">' + esc(r.note || '—') + '<div class="mono muted" style="font-size:11px;word-break:break-all;">' + esc(c === 'SCHWARZ' ? '[GESPERRT]' : (r.url || '')) + '</div></td>'
          + '<td style="text-align:right;white-space:nowrap;">'
            + (u
                ? '<button class="btn btn-sm" data-action="test" data-id="' + esc(p.id) + '">Testen</button> '
                  + '<button class="btn btn-sm btn-primary" data-action="use" data-id="' + esc(p.id) + '">Nutzen</button>'
                : '<span class="mono muted">Gesperrt</span>')
          + '</td></tr>';
      }).join('');
    }

    function renderBridges() {
      document.getElementById('bridges-tbody').innerHTML = state.bridges.map((b) => {
        const runnable = Boolean(b.docker_capable && b.bridge_id && b.port);
        const rt = b.bridge_id ? state.bridgeRuntimes.get(b.bridge_id) : null;
        const stLabel = rt ? String(rt.status || 'stopped').toUpperCase() : 'GESTOPPT';
        const stCls = rt && rt.status === 'running' ? 'st-ok' : rt && rt.status === 'error' ? 'st-err' : 'st-skip';
        return '<tr' + (runnable ? ' data-bridge-row="' + esc(b.bridge_id) + '" style="cursor:pointer;"' : '') + '>'
          + '<td><strong>' + esc(b.zielprovider) + '</strong></td>'
          + '<td class="mono">' + esc(b.bridge_id || 'Keine') + (b.bridge_url ? '<div class="muted" style="font-size:11px;word-break:break-all;">' + esc(b.bridge_url) + '</div>' : '') + '</td>'
          + '<td class="mono">' + (b.port ? '127.0.0.1:' + b.port : '—') + (runnable ? '<div class="' + stCls + '" style="font-size:11px;margin-top:2px;">' + esc(stLabel) + '</div>' : '') + '</td>'
          + '<td style="font-size:12px;">' + esc(b.auth_weg || '—') + '</td>'
          + '<td style="font-size:12px;">' + esc(b.begruendung || '') + '<div style="color:var(--red);margin-top:4px;"><strong>Restrisiko:</strong> ' + esc(b.restrisiko || '') + '</div></td>'
          + '<td style="text-align:right;white-space:nowrap;">'
            + (runnable
                ? '<button class="btn btn-sm btn-primary" data-action="run-bridge" data-id="' + esc(b.bridge_id) + '">' + (rt && rt.status === 'running' ? 'Steuern' : 'Ausführen') + '</button>'
                : '<span class="mono muted">Nicht auf Win11</span>')
          + '</td>'
          + '</tr>';
      }).join('');
    }

    async function runSingle(id, byokApiKey) {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: id, byokApiKey: byokApiKey || undefined }),
      });
      const data = await res.json();
      if (data && data.result) {
        state.results.set(id, data.result);
        renderKpis();
        renderTests();
        if (state.activeUseProvider && state.activeUseProvider.id === id) {
          renderUsePhases(data.result);
        }
      }
      return data;
    }
    window.runSingle = runSingle;

    async function runBatch(mode) {
      if (state.batchRunning) return;
      let targets = state.providers.filter((p) => {
        if (!isUsable(p)) return false;
        const c = normalizeClass(p);
        if (mode === 'green') return c === 'GRUEN';
        if (mode === 'gelb') return c === 'GELB';
        if (mode === 'top12') return c === 'GRUEN' && (p.url || '').startsWith('http');
        return true;
      });
      if (mode === 'top12') targets = targets.slice(0, 12);

      state.batchRunning = true;
      state.batchStop = false;
      document.getElementById('batch-progress').classList.remove('hidden');
      document.getElementById('btn-batch-stop').classList.remove('hidden');
      let done = 0;
      const updateBar = () => {
        const pct = targets.length ? Math.round((done / targets.length) * 100) : 100;
        document.getElementById('batch-label').textContent = '4-Phasen-Batch (' + mode + ')';
        document.getElementById('batch-pct').textContent = done + ' / ' + targets.length + ' (' + pct + '%)';
        document.getElementById('batch-fill').style.width = pct + '%';
      };
      updateBar();

      let idx = 0;
      async function worker() {
        while (idx < targets.length && !state.batchStop) {
          const p = targets[idx++];
          try { await runSingle(p.id); } catch (_) {}
          done++;
          updateBar();
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);
      state.batchRunning = false;
      document.getElementById('btn-batch-stop').classList.add('hidden');
    }

    function renderUsePhases(r) {
      const box = document.getElementById('use-phases');
      if (!r || !Array.isArray(r.phases) || r.phases.length === 0) {
        box.innerHTML = '<div class="muted">Noch kein 4-Phasen-Einzeltest ausgeführt.</div>';
        return;
      }
      box.innerHTML = r.phases.map((ph) =>
        '<div class="phase-row"><div><strong>' + esc(ph.label) + '</strong><div class="muted">' + esc(ph.detail) + '</div></div><span class="mono">' + esc(ph.status.toUpperCase()) + (ph.durationMs ? ' · ' + ph.durationMs + 'ms' : '') + '</span></div>'
      ).join('');
    }

    function openUseDrawer(id) {
      const p = state.providers.find((x) => x.id === id);
      if (!p || !isUsable(p)) return;
      state.activeUseProvider = p;
      const c = normalizeClass(p);
      const kindInfo = classifyConnKind(p);
      document.getElementById('use-meta').innerHTML = '<span class="cls-' + c + '">' + (c === 'GRUEN' ? 'GRÜN' : c) + '</span> · ' + esc(p.id) + ' · Auth: ' + esc(p.auth_typ || '—');
      document.getElementById('use-title').textContent = p.name;
      document.getElementById('use-kind-sub').textContent = kindInfo.label;
      document.getElementById('use-gelb-warn').classList.toggle('hidden', c !== 'GELB');
      const portal = document.getElementById('use-portal');
      if (p.url && p.url.startsWith('http')) {
        portal.href = p.url;
        portal.textContent = kindInfo.kind === 'browser_only' ? 'Im Browser / Spezifikation öffnen' : 'Portal / Doku öffnen';
        portal.classList.remove('hidden');
      } else {
        portal.classList.add('hidden');
      }

      const base = defaultApiBase(p, kindInfo);
      document.getElementById('use-base').value = base;
      document.getElementById('use-key').value = '';
      document.getElementById('use-invoke-out').classList.add('hidden');

      const noteBox = document.getElementById('use-endpoint-note');
      const restForm = document.getElementById('use-rest-form');
      const toggleBtn = document.getElementById('use-toggle-manual');
      const heading = document.getElementById('use-invoke-heading');
      if (kindInfo.supportsOpenAi) {
        heading.textContent = 'Verbindung direkt nutzen (SSRF-gesichert, Key nur im RAM – Regel 2)';
        toggleBtn.classList.add('hidden');
        restForm.classList.remove('hidden');
        const looksApi = /^https?:\\/\\/(api\\.|models\\.|inference\\.|router\\.|127\\.0\\.0\\.1|localhost)/i.test(base) || /\\/api\\/v1|\\/openai\\/v1/i.test(base);
        if (!looksApi) {
          noteBox.textContent = 'Hinweis: Katalog-URL ist ggf. Portal/Doku. Falls /v1/models 404 liefert, offizielle API-Basis-URL oben eintragen.';
          noteBox.classList.remove('hidden');
        } else {
          noteBox.classList.add('hidden');
        }
      } else {
        heading.textContent = 'Verbindungsmodus: ' + kindInfo.label;
        noteBox.textContent = kindInfo.kind === 'browser_only'
          ? 'Kein HTTP-/v1/models-Endpunkt: Diese Verbindung laeuft im Browser bzw. ist eine Web-Spezifikation/Weboberflaeche.'
          : 'Kein klassischer OpenAI-/v1/models-Endpunkt: Nutzung ueber MCP-Client, SDK, Git-Repo oder herstellerspezifische Doku.';
        noteBox.classList.remove('hidden');
        restForm.classList.add('hidden');
        toggleBtn.classList.remove('hidden');
        toggleBtn.textContent = 'Manuellen HTTP-Test zeigen';
      }

      const envVar = normalizeEnvVar(p);
      let snippet = '';
      if (!kindInfo.supportsOpenAi) {
        const target = p.url || base;
        snippet = '# Windows PowerShell (Erreichbarkeit pruefen — kein /v1/models Endpunkt)\\n'
          + 'Invoke-WebRequest -Uri "' + target + '" -Method Head | Select-Object StatusCode, StatusDescription\\n'
          + 'Start-Process "' + target + '"\\n\\n'
          + '# Windows PowerShell / CMD (echtes curl.exe — nicht den PS-Alias "curl" nutzen!)\\n'
          + 'curl.exe -sSI "' + target + '"';
        if (String(p.id || '').toLowerCase().includes('webnn')) {
          snippet += '\\n\\n# WebNN Browser-Check (Chrome/Edge DevTools-Konsole):\\n# \'ml\' in navigator';
        }
      } else {
        const modelsUrl = base.replace(/\\/+$/, '') + '/models';
        const authCurl = p.auth_typ === 'keine' ? '' : ' -H "Authorization: Bearer <DEIN_KEY>"';
        snippet = '# Windows PowerShell (Invoke-RestMethod · Env: ' + envVar + ')\\n'
          + (p.auth_typ === 'keine'
              ? 'Invoke-RestMethod -Uri "' + modelsUrl + '" -Method Get'
              : '$h = @{ Authorization = "Bearer $env:' + envVar + '" }\\nInvoke-RestMethod -Uri "' + modelsUrl + '" -Headers $h -Method Get')
          + '\\n\\n# Windows PowerShell / CMD (echtes curl.exe — nicht den PS-Alias "curl" nutzen!)\\n'
          + 'curl.exe -sS "' + modelsUrl + '"' + authCurl;
      }
      document.getElementById('use-snippet').textContent = snippet;
      renderUsePhases(state.results.get(p.id));
      document.getElementById('use-backdrop').classList.add('open');
    }
    window.openUseDrawer = openUseDrawer;

    function updateBridgeDrawerUI() {
      const b = state.activeBridge;
      if (!b || !b.bridge_id) return;
      const rt = state.bridgeRuntimes.get(b.bridge_id) || { status: 'stopped', logs: [], error: null };
      document.getElementById('br-status-badge').textContent = String(rt.status || 'stopped').toUpperCase() + (rt.pid ? ' (PID ' + rt.pid + ')' : '');
      const errBox = document.getElementById('br-error-box');
      if (rt.error) {
        errBox.textContent = 'Diagnose [Belegt]: ' + rt.error;
        errBox.classList.remove('hidden');
      } else {
        errBox.classList.add('hidden');
      }
      document.getElementById('br-logs').textContent = (rt.logs && rt.logs.length > 0)
        ? rt.logs.join('\\n')
        : 'Noch keine Ausfuehrung gestartet. Bestaetige oben das ToS-Restrisiko und klicke auf "Bridge ausfuehren".';
      document.getElementById('br-btn-stop').classList.toggle('hidden', rt.status !== 'running' && rt.status !== 'starting');
    }

    function openBridgeDrawer(bridgeId) {
      const b = state.bridges.find((x) => x.bridge_id === bridgeId && x.docker_capable && x.port);
      if (!b) return;
      state.activeBridge = b;
      document.getElementById('br-meta').textContent = 'KLASSE ROT · 127.0.0.1:' + b.port + ' · ' + (b.docker_service || '');
      document.getElementById('br-title').textContent = b.zielprovider + ' — ' + b.bridge_id;
      document.getElementById('br-risk').textContent = b.restrisiko || '';
      document.getElementById('br-auth').textContent = 'Auth-Weg: ' + (b.auth_weg || '—');
      const chk = document.getElementById('br-confirm-tos');
      chk.checked = false;
      document.getElementById('br-btn-start').disabled = true;
      document.getElementById('br-btn-start').textContent = 'Bridge ausführen (127.0.0.1:' + b.port + ')';
      document.getElementById('br-cmd').textContent =
        '# 1) Repo klonen:\\ngit clone --depth 1 "' + (b.bridge_url || '') + '" ".\\\\bridges\\\\' + b.bridge_id + '"\\n\\n'
        + '# 2) Docker-Start (strikt 127.0.0.1:' + b.port + '):\\ndocker compose --profile tos-risk up -d --build ' + (b.docker_service || '') + '\\n\\n'
        + '# 3) Test in Windows PowerShell (kein PS-Alias "curl"!):\\nInvoke-RestMethod -Uri "http://127.0.0.1:' + b.port + '/v1/models" -Method Get\\ncurl.exe -sS "http://127.0.0.1:' + b.port + '/v1/models"';
      updateBridgeDrawerUI();
      document.getElementById('bridge-backdrop').classList.add('open');
    }

    async function refreshBridgeRuntimes() {
      try {
        const res = await fetch('/api/bridges/runtime');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.bridgeRuntimes)) {
          state.bridgeRuntimes.clear();
          for (const rt of data.bridgeRuntimes) state.bridgeRuntimes.set(rt.bridgeId, rt);
          renderBridges();
          updateBridgeDrawerUI();
        }
      } catch (_) {}
    }

    async function executeActiveBridge() {
      const b = state.activeBridge;
      if (!b || !b.bridge_id) return;
      const confirmed = document.getElementById('br-confirm-tos').checked;
      if (!confirmed) return;
      const btn = document.getElementById('br-btn-start');
      btn.disabled = true;
      btn.textContent = 'Starte Bridge…';
      try {
        const res = await fetch('/api/bridges/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bridgeId: b.bridge_id, confirmTosRisk: true }),
        });
        const data = await res.json();
        if (data && data.runtime) state.bridgeRuntimes.set(b.bridge_id, data.runtime);
        if (Array.isArray(data.bridgeRuntimes)) {
          for (const rt of data.bridgeRuntimes) state.bridgeRuntimes.set(rt.bridgeId, rt);
        }
        renderBridges();
        updateBridgeDrawerUI();
      } catch (e) {
        document.getElementById('br-error-box').textContent = 'Fehler: ' + (e && e.message ? e.message : String(e));
        document.getElementById('br-error-box').classList.remove('hidden');
      } finally {
        btn.disabled = !document.getElementById('br-confirm-tos').checked;
        btn.textContent = 'Bridge ausführen (127.0.0.1:' + b.port + ')';
      }
    }

    async function stopActiveBridge() {
      const b = state.activeBridge;
      if (!b || !b.bridge_id) return;
      const res = await fetch('/api/bridges/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: b.bridge_id }),
      });
      const data = await res.json();
      if (data && data.runtime) state.bridgeRuntimes.set(b.bridge_id, data.runtime);
      renderBridges();
      updateBridgeDrawerUI();
    }

    async function probeActiveBridge() {
      const b = state.activeBridge;
      if (!b || !b.bridge_id) return;
      const res = await fetch('/api/bridges/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridgeId: b.bridge_id }),
      });
      const data = await res.json();
      if (data && data.runtime) state.bridgeRuntimes.set(b.bridge_id, data.runtime);
      renderBridges();
      updateBridgeDrawerUI();
    }

    async function invokeActive(action) {
      const p = state.activeUseProvider;
      if (!p) return;
      const out = document.getElementById('use-invoke-out');
      out.classList.remove('hidden');
      out.textContent = 'Sende Anfrage…';
      try {
        const res = await fetch('/api/invoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: p.id,
            endpointUrl: document.getElementById('use-base').value.trim(),
            action,
            apiKey: document.getElementById('use-key').value.trim() || undefined,
            model: document.getElementById('use-model').value.trim() || undefined,
            prompt: document.getElementById('use-prompt').value.trim() || undefined,
          }),
        });
        const data = await res.json();
        out.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        out.textContent = 'Fehler: ' + (e && e.message ? e.message : String(e));
      }
    }

    async function loadDoc(name) {
      document.getElementById('doc-title').textContent = name;
      document.getElementById('doc-content').textContent = 'Lade ' + name + '…';
      const res = await fetch('/files/' + encodeURIComponent(name));
      document.getElementById('doc-content').textContent = await res.text();
    }

    async function saveCsv() {
      const rows = state.providers.map((p) => {
        const r = state.results.get(p.id) || {};
        return {
          id: p.id, name: p.name, kategorie: (p.kategorien && p.kategorien[0]) || 'unbekannt',
          status: r.status || 'PENDING', http_code: r.http_code || '-',
          risky: Boolean(p.risky), empfohlen: p.empfohlen || 'False',
          note: r.note || '', url: normalizeClass(p) === 'SCHWARZ' ? '[GESPERRT]' : (p.url || '')
        };
      });
      const res = await fetch('/api/save-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      document.getElementById('test-summary-bar').textContent =
        data.ok ? 'Gespeichert: test_results.csv (' + rows.length + ' Zeilen)' : 'Speichern fehlgeschlagen';
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
      ['classification','tests','bridges','chat','docs'].forEach((t) => {
        document.getElementById('tab-' + t).classList.toggle('hidden', tabName !== t);
      });
      if (tabName === 'docs') void loadDoc('REPORT.md');
    }

    function updateChatHeader() {
      const mode = document.getElementById('chat-mode').value;
      const base = document.getElementById('chat-base').value.trim().replace(/\\/+$/, '');
      const model = document.getElementById('chat-model').value.trim() || 'default';
      let title = 'Direkt-Chat';
      let chatCapable = true;
      if (mode === 'bridge') {
        const bid = document.getElementById('chat-bridge').value;
        const b = state.bridges.find((x) => x.bridge_id === bid);
        title = b ? (b.zielprovider + ' — ' + b.bridge_id) : 'Bridge';
      } else if (mode === 'provider') {
        const pid = document.getElementById('chat-provider').value;
        const p = state.providers.find((x) => x.id === pid);
        title = p ? p.name : 'Provider';
        if (p) chatCapable = classifyConnKind(p).supportsOpenAi;
      } else if (mode === 'litellm') {
        title = 'LiteLLM-Router (GRÜN)';
      } else {
        title = 'Lokaler OpenAI-Server (127.0.0.1)';
      }
      document.getElementById('chat-active-title').textContent = title;
      document.getElementById('chat-active-sub').textContent = chatCapable
        ? (base + '/chat/completions · Modell: ' + model)
        : (base + ' · Kein direkter OpenAI-/chat/completions-Endpunkt');
    }

    function defaultChatModel(providerId, bridgeId) {
      const bid = String(bridgeId || '').toLowerCase();
      if (bid === 'grok-com-to-openai') return 'grok-fast';
      if (bid === 'duck2api') return 'gpt-5.4-mini';
      if (bid === 'freedeepseekapi') return 'deepseek-chat';
      if (bid === 'openai-api-server-via-codex') return 'gpt-5.4-mini';
      if (bid === 'catgpt-gateway') return 'gpt-4o';
      if (bid === 'webai-to-api') return 'gemini-2.5-flash';
      const pid = String(providerId || '').toLowerCase();
      if (pid.includes('pollinations')) return 'openai-fast';
      if (pid.includes('ovh')) return 'gpt-oss-20b';
      if (pid === 'unrestrictable-ai') return 'abliterated-model';
      if (pid === 'obscurify-ai') return 'abliteration-ai/abliterated-model';
      return 'default';
    }

    function syncChatModeUI() {
      const mode = document.getElementById('chat-mode').value;
      document.getElementById('chat-bridge-wrap').classList.toggle('hidden', mode !== 'bridge');
      document.getElementById('chat-provider-wrap').classList.toggle('hidden', mode !== 'provider');
      const baseEl = document.getElementById('chat-base');
      const modelEl = document.getElementById('chat-model');
      baseEl.readOnly = mode === 'bridge';
      if (mode === 'bridge') {
        const bid = document.getElementById('chat-bridge').value;
        const b = state.bridges.find((x) => x.bridge_id === bid);
        if (b && b.port) baseEl.value = 'http://127.0.0.1:' + b.port + '/v1';
        modelEl.value = defaultChatModel('', bid);
      } else if (mode === 'provider') {
        const pid = document.getElementById('chat-provider').value;
        const p = state.providers.find((x) => x.id === pid);
        if (p) baseEl.value = defaultApiBase(p, classifyConnKind(p));
        modelEl.value = defaultChatModel(pid, '');
      } else if (mode === 'litellm') {
        baseEl.value = 'http://127.0.0.1:4000/v1';
        modelEl.value = 'default';
      } else {
        if (!/^https?:\\/\\/(127\\.0\\.0\\.1|localhost)/i.test(baseEl.value)) {
          baseEl.value = 'http://127.0.0.1:11434/v1';
        }
      }
      updateChatHeader();
    }

    function populateChatSelectors() {
      const brSel = document.getElementById('chat-bridge');
      const allowBr = state.bridges.filter((b) => b.docker_capable && b.bridge_id && b.port);
      brSel.innerHTML = allowBr.map((b) =>
        '<option value="' + esc(b.bridge_id) + '">' + esc(b.zielprovider + ' — ' + b.bridge_id + ' (:' + b.port + ')') + '</option>'
      ).join('');
      const prSel = document.getElementById('chat-provider');
      const usablePr = state.providers.filter((p) => isUsable(p) && classifyConnKind(p).supportsOpenAi);
      usablePr.sort((a, b) => {
        const score = (x) => (normalizeClass(x) === 'GRUEN' ? 0 : 10) + (x.auth_typ === 'keine' ? 0 : 2);
        return score(a) - score(b) || String(a.name || '').localeCompare(String(b.name || ''));
      });
      prSel.innerHTML = usablePr.map((p) =>
        '<option value="' + esc(p.id) + '">[' + esc(normalizeClass(p)) + (p.auth_typ === 'keine' ? ' · Kein Key' : '') + '] ' + esc(p.name) + '</option>'
      ).join('');
      syncChatModeUI();
    }

    function openChatForTarget(mode, targetId, customBase) {
      document.getElementById('chat-mode').value = mode;
      if (mode === 'bridge' && targetId) document.getElementById('chat-bridge').value = targetId;
      if (mode === 'provider' && targetId) document.getElementById('chat-provider').value = targetId;
      syncChatModeUI();
      if (customBase && mode !== 'bridge') {
        document.getElementById('chat-base').value = customBase;
        updateChatHeader();
      }
      switchTab('chat');
      document.getElementById('chat-input').focus();
    }

    function renderChatMessages() {
      const box = document.getElementById('chat-messages');
      if (state.chatMessages.length === 0) {
        box.innerHTML = '<div class="muted" style="text-align:center;padding:30px 10px;">Wähle links eine Bridge, einen GRÜN/GELB-Provider oder einen lokalen Endpunkt und sende deine erste Nachricht.</div>';
        return;
      }
      box.innerHTML = state.chatMessages.map((m) => {
        const align = m.role === 'user' ? 'flex-end' : 'flex-start';
        const bg = m.role === 'user' ? '#0f766e' : m.role === 'error' ? '#fef2f2' : '#f8fafc';
        const fg = m.role === 'user' ? '#ffffff' : m.role === 'error' ? '#991b1b' : '#0f172a';
        const brd = m.role === 'user' ? '#0f766e' : m.role === 'error' ? '#fecaca' : '#e2e8f0';
        const meta = (m.role === 'user' ? 'DU' : m.role === 'error' ? 'FEHLER' : (m.model || 'ASSISTANT')) + (m.latencyMs ? ' · ' + m.latencyMs + 'ms' : '');
        return '<div style="display:flex;justify-content:' + align + ';">'
          + '<div style="max-width:86%;padding:10px 12px;border-radius:8px;border:1px solid ' + brd + ';background:' + bg + ';color:' + fg + ';font-size:13px;white-space:pre-wrap;word-break:break-word;">'
          + '<div class="mono" style="font-size:10px;opacity:0.75;margin-bottom:4px;">' + esc(meta) + '</div>'
          + esc(m.content)
          + '</div></div>';
      }).join('');
      box.scrollTop = box.scrollHeight;
    }

    async function loadChatModels() {
      const note = document.getElementById('chat-models-note');
      note.textContent = 'Lade Modelle…';
      try {
        const mode = document.getElementById('chat-mode').value;
        const res = await fetch('/api/chat/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: mode,
            bridgeId: mode === 'bridge' ? document.getElementById('chat-bridge').value : undefined,
            providerId: mode === 'provider' ? document.getElementById('chat-provider').value : undefined,
            endpointUrl: document.getElementById('chat-base').value.trim(),
            apiKey: document.getElementById('chat-key').value.trim() || undefined,
          }),
        });
        const data = await res.json();
        const dl = document.getElementById('chat-model-list');
        if (data.ok && Array.isArray(data.models) && data.models.length > 0) {
          dl.innerHTML = data.models.map((m) => '<option value="' + esc(m) + '"></option>').join('');
          document.getElementById('chat-model').value = data.models[0];
          note.textContent = data.models.length + ' Modelle geladen.';
          updateChatHeader();
        } else {
          note.textContent = data.error || 'Keine Modelle geliefert (Modell-ID manuell eintragen).';
        }
      } catch (e) {
        note.textContent = 'Fehler: ' + (e && e.message ? e.message : String(e));
      }
    }

    async function sendChatMessage() {
      if (state.chatSending) return;
      const inp = document.getElementById('chat-input');
      const text = inp.value.trim();
      if (!text) return;
      state.chatMessages.push({ role: 'user', content: text });
      inp.value = '';
      renderChatMessages();
      state.chatSending = true;
      document.getElementById('chat-send').disabled = true;
      document.getElementById('chat-send').textContent = 'Sendet…';
      try {
        const mode = document.getElementById('chat-mode').value;
        const hist = state.chatMessages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
        const res = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: mode,
            bridgeId: mode === 'bridge' ? document.getElementById('chat-bridge').value : undefined,
            providerId: mode === 'provider' ? document.getElementById('chat-provider').value : undefined,
            endpointUrl: document.getElementById('chat-base').value.trim(),
            apiKey: document.getElementById('chat-key').value.trim() || undefined,
            model: document.getElementById('chat-model').value.trim() || 'default',
            systemPrompt: document.getElementById('chat-sys').value.trim() || undefined,
            messages: hist,
          }),
        });
        const data = await res.json();
        if (data.ok && typeof data.reply === 'string') {
          state.chatMessages.push({ role: 'assistant', content: data.reply, model: data.model, latencyMs: data.latencyMs });
        } else {
          state.chatMessages.push({ role: 'error', content: data.error || ('HTTP ' + res.status), latencyMs: data.latencyMs });
        }
      } catch (e) {
        state.chatMessages.push({ role: 'error', content: e && e.message ? e.message : String(e) });
      } finally {
        state.chatSending = false;
        document.getElementById('chat-send').disabled = false;
        document.getElementById('chat-send').textContent = 'Senden';
        renderChatMessages();
      }
    }

    // Event bindings
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    document.getElementById('cls-search').addEventListener('input', renderClassification);
    document.getElementById('cls-class').addEventListener('change', renderClassification);
    ['cls-tbody', 'test-tbody'].forEach((tid) => {
      document.getElementById(tid).addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        if (!id) return;
        if (btn.dataset.action === 'test') void runSingle(id);
        else if (btn.dataset.action === 'use') openUseDrawer(id);
      });
    });
    document.getElementById('test-search').addEventListener('input', renderTests);
    document.querySelectorAll('[data-tfilter]').forEach((b) => b.addEventListener('click', () => {
      state.testFilter = b.dataset.tfilter; renderTests();
    }));
    document.getElementById('btn-batch-all').addEventListener('click', () => void runBatch('all'));
    document.getElementById('btn-batch-green').addEventListener('click', () => void runBatch('green'));
    document.getElementById('btn-batch-gelb').addEventListener('click', () => void runBatch('gelb'));
    document.getElementById('btn-batch-top12').addEventListener('click', () => void runBatch('top12'));
    document.getElementById('btn-batch-stop').addEventListener('click', () => { state.batchStop = true; });
    document.getElementById('btn-save-csv').addEventListener('click', () => void saveCsv());
    document.querySelectorAll('.doc-btn').forEach((b) => b.addEventListener('click', () => void loadDoc(b.dataset.doc)));
    document.getElementById('use-close').addEventListener('click', () => document.getElementById('use-backdrop').classList.remove('open'));
    document.getElementById('use-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'use-backdrop') document.getElementById('use-backdrop').classList.remove('open');
    });
    document.getElementById('use-open-chat').addEventListener('click', () => {
      if (!state.activeUseProvider) return;
      const pid = state.activeUseProvider.id;
      const base = document.getElementById('use-base').value.trim();
      document.getElementById('use-backdrop').classList.remove('open');
      openChatForTarget('provider', pid, base);
    });
    document.getElementById('use-retest').addEventListener('click', () => {
      if (state.activeUseProvider) void runSingle(state.activeUseProvider.id, document.getElementById('use-key').value.trim() || undefined);
    });
    document.getElementById('use-call-models').addEventListener('click', () => void invokeActive('models'));
    document.getElementById('use-call-chat').addEventListener('click', () => void invokeActive('chat'));
    document.getElementById('use-copy-snippet').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(document.getElementById('use-snippet').textContent); } catch (_) {}
    });
    document.getElementById('use-toggle-manual').addEventListener('click', () => {
      const f = document.getElementById('use-rest-form');
      const hidden = f.classList.toggle('hidden');
      document.getElementById('use-toggle-manual').textContent = hidden ? 'Manuellen HTTP-Test zeigen' : 'Manuellen HTTP-Test ausblenden';
    });
    document.getElementById('bridges-tbody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="run-bridge"]');
      if (btn && btn.dataset.id) { openBridgeDrawer(btn.dataset.id); return; }
      const row = e.target.closest('tr[data-bridge-row]');
      if (row && row.dataset.bridgeRow) openBridgeDrawer(row.dataset.bridgeRow);
    });
    document.getElementById('br-close').addEventListener('click', () => document.getElementById('bridge-backdrop').classList.remove('open'));
    document.getElementById('bridge-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'bridge-backdrop') document.getElementById('bridge-backdrop').classList.remove('open');
    });
    document.getElementById('br-confirm-tos').addEventListener('change', (e) => {
      document.getElementById('br-btn-start').disabled = !e.target.checked;
    });
    document.getElementById('br-btn-start').addEventListener('click', () => void executeActiveBridge());
    document.getElementById('br-btn-stop').addEventListener('click', () => void stopActiveBridge());
    document.getElementById('br-btn-probe').addEventListener('click', () => void probeActiveBridge());
    document.getElementById('br-btn-chat').addEventListener('click', () => {
      if (!state.activeBridge || !state.activeBridge.bridge_id) return;
      const bid = state.activeBridge.bridge_id;
      document.getElementById('bridge-backdrop').classList.remove('open');
      openChatForTarget('bridge', bid);
    });
    document.getElementById('br-copy-cmd').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(document.getElementById('br-cmd').textContent); } catch (_) {}
    });
    document.getElementById('chat-mode').addEventListener('change', syncChatModeUI);
    document.getElementById('chat-bridge').addEventListener('change', syncChatModeUI);
    document.getElementById('chat-provider').addEventListener('change', syncChatModeUI);
    document.getElementById('chat-base').addEventListener('input', updateChatHeader);
    document.getElementById('chat-model').addEventListener('input', updateChatHeader);
    document.getElementById('chat-load-models').addEventListener('click', () => void loadChatModels());
    document.getElementById('chat-clear').addEventListener('click', () => { state.chatMessages = []; renderChatMessages(); });
    document.getElementById('chat-send').addEventListener('click', () => void sendChatMessage());
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChatMessage(); }
    });

    async function boot() {
      try {
        const health = await fetch('/api/health').then((r) => r.json());
        document.getElementById('runtime-subtitle').textContent =
          'Lokale GUI aktiv (127.0.0.1:8787 · Runtime: ' + (health.runtime || 'lokal') + ' · Kein Docker erforderlich)';
      } catch (_) {}

      const [clsJson, csvText, brJson] = await Promise.all([
        fetch('/files/classification.json').then((r) => r.json()),
        fetch('/files/test_results.csv').then((r) => r.text()),
        fetch('/files/bridge_selection.json').then((r) => r.json()),
      ]);
      state.providers = clsJson.providers || [];
      state.bridges = brJson.bridges || [];
      for (const row of parseCsv(csvText)) {
        state.results.set(row.id, row);
      }
      renderKpis();
      renderClassification();
      renderTests();
      renderBridges();
      populateChatSelectors();
      void refreshBridgeRuntimes();
    }
    void boot();
  </script>
</body>
</html>
`;
}

export function generateLocalGuiNodeServer(): string {
  return `// AI-Provider-Suite – Zero-Dependency Local Windows-11 GUI Server (Node.js >= 18)
// Strikt 127.0.0.1:8787 · Kein Docker · Keine npm-Installation · Regel 1–7 aktiv
import { execFile, spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUITE_DIR = path.resolve(__dirname, '..');
const BRIDGES_DIR = path.join(SUITE_DIR, 'bridges');
const PORT = Number(process.env.AI_SUITE_GUI_PORT || 8787);

const ALLOWED_FILES = new Set([
  'classification.json',
  'test_results.csv',
  'bridge_selection.json',
  'litellm_config.yaml',
  'docker-compose.yml',
  'REPORT.md',
  'SECURITY.md',
  'README.md',
]);

const catalog = JSON.parse(fs.readFileSync(path.join(SUITE_DIR, 'classification.json'), 'utf8'));
const byId = new Map((catalog.providers || []).map((p) => [p.id, p]));
const bridgeCfg = JSON.parse(fs.readFileSync(path.join(SUITE_DIR, 'bridge_selection.json'), 'utf8'));
const allowBridges = new Map(
  (bridgeCfg.bridges || [])
    .filter((b) => b.docker_capable && b.bridge_id && b.port && /^https:\\/\\/github\\.com\\//.test(b.bridge_url || ''))
    .map((b) => [b.bridge_id, b])
);
const bridgeStates = new Map();
const bridgeChildren = new Map();
for (const b of allowBridges.values()) {
  bridgeStates.set(b.bridge_id, {
    bridgeId: b.bridge_id, zielprovider: b.zielprovider, port: b.port, dockerService: b.docker_service,
    status: 'stopped', mode: 'none', pid: null, error: null, logs: [],
  });
}
function logBridge(id, msg) {
  const st = bridgeStates.get(id);
  if (!st || !msg) return;
  const ts = new Date().toISOString().slice(11, 19);
  for (const l of String(msg).replace(/\\r/g, '').split('\\n')) {
    if (l.trim()) st.logs.push('[' + ts + '] ' + l.slice(0, 360));
  }
  if (st.logs.length > 140) st.logs = st.logs.slice(-140);
}
async function probeLocalPort(port) {
  for (const pth of ['/v1/models', '/healthz', '/health', '/']) {
    const url = 'http://127.0.0.1:' + port + pth;
    try {
      const r = await fetchTimeout(url, { method: 'GET' }, 3000);
      if (r.status < 500) return { ok: true, statusText: 'HTTP ' + r.status + ' (' + pth + ')', url };
    } catch {}
  }
  return { ok: false, statusText: 'Port 127.0.0.1:' + port + ' antwortet nicht.', url: 'http://127.0.0.1:' + port + '/v1/models' };
}
function resolveSafeNpm(npmArgs) {
  if (process.platform !== 'win32') return { bin: 'npm', args: npmArgs };
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(npmCli)) return { bin: process.execPath, args: [npmCli, ...npmArgs] };
  return { bin: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...npmArgs] };
}
async function waitForLoopback(port, maxMs) {
  const deadline = Date.now() + maxMs;
  let last = { ok: false, statusText: 'Port 127.0.0.1:' + port + ' antwortet nicht.', url: 'http://127.0.0.1:' + port + '/v1/models' };
  while (Date.now() < deadline) {
    last = await probeLocalPort(port);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, 750));
  }
  return last;
}
async function executeLocalBridge(id) {
  const b = allowBridges.get(id);
  const st = bridgeStates.get(id);
  if (!b || !st) return null;
  st.error = null; st.logs = [];
  const dir = path.join(BRIDGES_DIR, id);
  fs.mkdirSync(BRIDGES_DIR, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) {
    st.status = 'cloning';
    logBridge(id, 'Klone ' + b.bridge_url + ' nach .\\\\bridges\\\\' + id + ' ...');
    try {
      await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', b.bridge_url + '.git', dir], { timeout: 35000 });
      logBridge(id, 'Repository geklont.');
    } catch (e) {
      st.status = 'error';
      st.error = 'Git-Clone fehlgeschlagen: ' + (e.stderr || e.message || String(e)).slice(0, 200);
      logBridge(id, st.error);
      return st;
    }
  }
  st.status = 'starting';
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 3500 });
    st.mode = 'docker';
    logBridge(id, 'Starte via Docker Compose: ' + b.docker_service);
    const { stdout, stderr } = await execFileAsync('docker', ['compose', '--profile', 'tos-risk', 'up', '-d', '--build', b.docker_service], { cwd: SUITE_DIR, timeout: 120000 });
    if (stdout) logBridge(id, stdout);
    if (stderr) logBridge(id, stderr);
    const pr = await waitForLoopback(b.port, 9000);
    if (pr.ok) {
      st.status = 'running';
      logBridge(id, 'Loopback OK: ' + pr.statusText);
    } else {
      st.status = 'error';
      st.error = 'Container gestartet, aber ' + pr.statusText;
      logBridge(id, st.error);
    }
    return st;
  } catch {
    logBridge(id, 'Docker nicht aktiv — pruefe lokalen Direktstart ohne Docker.');
  }
  let bin = null, args = [], extraEnv = {}, isGoRuntime = false, isPyRuntime = false;
  const pyBin = process.platform === 'win32' ? 'python' : 'python3';
  const venvPy = process.platform === 'win32' ? path.join(dir, '.venv', 'Scripts', 'python.exe') : path.join(dir, '.venv', 'bin', 'python');
  const venvMarker = path.join(dir, '.venv', '.ai_suite_deps_ok');
  if (fs.existsSync(path.join(dir, 'package.json'))) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch {}
    if (!fs.existsSync(path.join(dir, 'node_modules'))) {
      const inst = resolveSafeNpm(['install', '--no-audit', '--no-fund']);
      logBridge(id, 'Installiere Node-Abhaengigkeiten (npm install)...');
      try {
        await execFileAsync(inst.bin, inst.args, { cwd: dir, timeout: 120000 });
        logBridge(id, 'npm install abgeschlossen.');
      } catch (e) {
        st.status = 'error';
        st.error = 'npm install fehlgeschlagen: ' + (e.stderr || e.message || String(e)).slice(0, 200);
        logBridge(id, st.error);
        return st;
      }
    }
    const startCmd = String((pkg.scripts && pkg.scripts.start) || '');
    if (pkg.scripts && pkg.scripts['start:node'] && /\\bbun\\b/i.test(startCmd)) {
      const run = resolveSafeNpm(['run', 'start:node']);
      bin = run.bin; args = run.args;
    } else if (pkg.scripts && pkg.scripts.start) {
      const run = resolveSafeNpm(['start']);
      bin = run.bin; args = run.args;
    } else if (pkg.scripts && pkg.scripts.dev) {
      const run = resolveSafeNpm(['run', 'dev']);
      bin = run.bin; args = run.args;
    } else {
      const entry = ['index.js', 'server.js', 'app.js', 'dist/index.js'].find((f) => fs.existsSync(path.join(dir, f)));
      if (entry) { bin = process.execPath; args = [entry]; }
    }
  } else if (fs.existsSync(path.join(dir, 'src', 'run.py'))) {
    isPyRuntime = true; bin = pyBin; args = ['src/run.py', '--host', '127.0.0.1', '--port', String(b.port)];
    extraEnv = { PYTHONPATH: path.join(dir, 'src'), PYTHONUNBUFFERED: '1' };
  } else if (fs.existsSync(path.join(dir, 'src', 'api', 'server.py'))) {
    isPyRuntime = true; bin = pyBin; args = ['-m', 'src.api.server'];
    extraEnv = { USE_XVFB: 'false', PYTHONUNBUFFERED: '1' };
  } else if (fs.existsSync(path.join(dir, 'src', 'main.py'))) {
    isPyRuntime = true; bin = pyBin; args = ['src/main.py'];
    extraEnv = { PYTHONPATH: path.join(dir, 'src'), PYTHONUNBUFFERED: '1' };
  } else if (['main.py', 'app.py', 'server.py', 'run.py', 'api.py'].some((f) => fs.existsSync(path.join(dir, f)))) {
    const pyEntry = ['main.py', 'app.py', 'server.py', 'run.py', 'api.py'].find((f) => fs.existsSync(path.join(dir, f)));
    isPyRuntime = true; bin = pyBin; args = [pyEntry];
    extraEnv = { PYTHONUNBUFFERED: '1' };
  } else if (fs.existsSync(path.join(dir, 'go.mod'))) {
    isGoRuntime = true;
    const hasRootGo = fs.readdirSync(dir).some((f) => f.endsWith('.go') && !f.endsWith('_test.go'));
    if (hasRootGo) {
      bin = 'go'; args = ['run', '.'];
    } else {
      const cmdDir = path.join(dir, 'cmd');
      if (fs.existsSync(cmdDir)) {
        const sub = fs.readdirSync(cmdDir, { withFileTypes: true }).find((e) => e.isDirectory() && fs.readdirSync(path.join(cmdDir, e.name)).some((f) => f.endsWith('.go')));
        if (sub) { bin = 'go'; args = ['run', './cmd/' + sub.name]; }
      }
    }
  }
  if (isPyRuntime && fs.existsSync(path.join(dir, 'requirements.txt'))) {
    if (!(fs.existsSync(venvPy) && fs.existsSync(venvMarker))) {
      logBridge(id, 'Richte isolierte Python-Umgebung (.venv) & requirements.txt ein...');
      try {
        if (!fs.existsSync(venvPy)) {
          await execFileAsync(pyBin, ['-m', 'venv', '.venv'], { cwd: dir, timeout: 60000 });
        }
        await execFileAsync(venvPy, ['-m', 'pip', 'install', '--no-input', '-r', 'requirements.txt'], { cwd: dir, timeout: 240000 });
        const reqTxt = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8');
        if (/\\bpatchright\\b/i.test(reqTxt)) {
          logBridge(id, 'Installiere Patchright Chromium-Browser...');
          await execFileAsync(venvPy, ['-m', 'patchright', 'install', 'chromium'], { cwd: dir, timeout: 240000 });
        }
        fs.writeFileSync(venvMarker, 'ok\\n', 'utf8');
        logBridge(id, 'Python .venv bereit.');
      } catch (e) {
        st.status = 'error';
        st.error = 'Python-.venv/pip-Setup fehlgeschlagen: ' + (e.stderr || e.message || String(e)).slice(0, 220);
        logBridge(id, st.error);
        return st;
      }
    }
    if (fs.existsSync(venvPy)) bin = venvPy;
  }
  if (!bin) {
    st.status = 'error';
    st.error = 'Docker laeuft nicht und kein Standard-Startpunkt (package.json/Python/go.mod) erkannt. Bitte Docker Desktop starten.';
    logBridge(id, st.error);
    return st;
  }
  try {
    const childEnv = {
      ...process.env,
      HOST: '127.0.0.1',
      SERVER_HOST: '127.0.0.1',
      OPENAI_VIA_CODEX_HOST: '127.0.0.1',
      BIND_ADDRESS: '127.0.0.1',
      PORT: String(b.port),
      SERVER_PORT: String(b.port),
      API_PORT: String(b.port),
      OPENAI_VIA_CODEX_PORT: String(b.port),
      LISTEN_ADDR: '127.0.0.1:' + b.port,
      SKIP_ACCOUNT_MENU: '1',
      NON_INTERACTIVE: '1',
      ...extraEnv,
    };
    const child = spawn(bin, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv });
    bridgeChildren.set(id, child);
    st.mode = 'native'; st.pid = child.pid || null; st.status = 'starting';
    logBridge(id, 'Starte: ' + bin + ' ' + args.join(' ') + ' (PID ' + st.pid + ', 127.0.0.1:' + b.port + ')');
    child.stdout?.on('data', (d) => logBridge(id, d.toString('utf8')));
    child.stderr?.on('data', (d) => logBridge(id, d.toString('utf8')));
    child.on('error', (err) => { st.status = 'error'; st.error = err.message; logBridge(id, 'Prozessfehler: ' + err.message); });
    child.on('exit', (code) => { bridgeChildren.delete(id); st.pid = null; if (st.status !== 'stopped') { st.status = code === 0 ? 'stopped' : 'error'; if (code !== 0) st.error = 'Prozess beendet (Exit ' + code + ').'; } logBridge(id, 'Beendet (Exit ' + code + ').'); });
    const pr = await waitForLoopback(b.port, isGoRuntime ? 24000 : 10000);
    if (pr.ok) {
      st.status = 'running';
      st.error = null;
      logBridge(id, 'Loopback bereit: ' + pr.statusText);
    } else if (st.status !== 'error') {
      st.status = 'error';
      st.error = 'Prozess gestartet, aber ' + pr.statusText + ' (Logs pruefen).';
      logBridge(id, st.error);
    }
    return st;
  } catch (e) {
    st.status = 'error';
    st.error = 'Start fehlgeschlagen: ' + e.message;
    logBridge(id, st.error);
    return st;
  }
}

function normCls(p) {
  const c = p.security_class || '';
  if (c === 'GRÜN' || c === 'GRUEN') return 'GRUEN';
  if (c === 'GELB') return 'GELB';
  if (c === 'ROT') return 'ROT';
  return 'SCHWARZ';
}

function isUsable(p) {
  if (!p || p.illegal || p.anonym_pseudo_key) return false;
  if (Array.isArray(p.kategorien) && p.kategorien.includes('anonym_pseudo_key')) return false;
  if (String(p.test_policy || '').startsWith('SKIP_RULE1_')) return false;
  const c = normCls(p);
  return c === 'GRUEN' || c === 'GELB';
}

function isWaf(status, headers) {
  if (![403, 429, 503].includes(status)) return false;
  const srv = String(headers.get('server') || '').toLowerCase();
  const cf = String(headers.get('cf-mitigated') || '').toLowerCase();
  if (cf.includes('challenge') || status === 429) return true;
  return status === 403 && (srv.includes('cloudflare') || Boolean(headers.get('cf-ray')) || srv.includes('akamai') || srv.includes('cloudfront'));
}

function validateSsrf(provider, rawUrl) {
  if (!isUsable(provider)) return { ok: false, error: 'Regel 1/3: Nur GRÜN und GELB sind zulässig.' };
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, error: 'Ungültige URL.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Nur HTTP(S) erlaubt.' };
  const h = u.hostname.toLowerCase().replace(/^\\[|\\]$/g, '');
  const isPriv4 = /^10\\./.test(h) || /^192\\.168\\./.test(h) || /^172\\.(1[6-9]|2\\d|3[0-1])\\./.test(h) || /^169\\.254\\./.test(h) || h === '0.0.0.0';
  const isPriv6 = h.startsWith('fe80:') || h.startsWith('fc00:') || h.startsWith('fd00:') || h.startsWith('::ffff:');
  if (isPriv4 || isPriv6 || h === 'metadata.google.internal') {
    return { ok: false, error: 'Zielhost durch SSRF-Schutz blockiert.' };
  }
  const isLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1';
  if (isLocal && !(provider.kategorien || []).includes('lokal_self_hosted')) {
    return { ok: false, error: 'Loopback nur für lokale Engines (lokal_self_hosted).' };
  }
  if (!isLocal && provider.url && /^https?:\\/\\//i.test(provider.url)) {
    const ch = new URL(provider.url).hostname.toLowerCase();
    const root = (x) => x.split('.').slice(-2).join('.');
    if (h !== ch && root(h) !== root(ch)) {
      return { ok: false, error: 'Zielhost stimmt nicht mit Katalog-Domain überein (SSRF-Schutz).' };
    }
  }
  return { ok: true, url: u };
}

async function fetchTimeout(url, opts, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

async function run4PhaseTest(p, byokApiKey) {
  const cls = normCls(p);
  if (!isUsable(p)) {
    return {
      id: p.id, name: p.name, status: cls === 'ROT' ? 'SKIPPED (ToS-Risiko)' : 'SKIPPED (illegal)',
      http_code: '-', note: 'Gesperrt (Regel 1 / 3)', url: cls === 'SCHWARZ' ? '[GESPERRT]' : p.url,
      executed: false, healthScore: 0, phases: [],
    };
  }
  const phases = [];
  if (!p.url || !/^https?:\\/\\//i.test(p.url)) {
    phases.push({ phase: 'dns', label: 'Phase 1: URL/DNS', status: 'skip', detail: 'Lokal / keine HTTP-URL.' });
    return { id: p.id, name: p.name, status: 'SKIPPED (lokal/kein Endpunkt)', http_code: '-', note: 'Lokale Engine', url: p.url || '', executed: true, healthScore: 70, phases };
  }
  const u = new URL(p.url);
  const host = u.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const d0 = Date.now();
  if (!isLocal) {
    try {
      const addr = await dns.lookup(host);
      phases.push({ phase: 'dns', label: 'Phase 1: URL/DNS', status: 'pass', detail: host + ' -> ' + addr.address, durationMs: Date.now() - d0 });
    } catch (e) {
      phases.push({ phase: 'dns', label: 'Phase 1: URL/DNS', status: 'fail', detail: 'DNS-Fehler: ' + e.message, durationMs: Date.now() - d0 });
      return { id: p.id, name: p.name, status: 'NETWORK_ERROR', http_code: '-', note: 'P1 DNS-FAIL: ' + e.message, url: p.url, executed: true, healthScore: 0, phases };
    }
  } else {
    phases.push({ phase: 'dns', label: 'Phase 1: URL/DNS', status: 'pass', detail: 'Loopback-Host' });
  }

  const h0 = Date.now();
  let status = 'OK', httpCode = '-', latencyMs = 0, score = 65;
  try {
    let resp = await fetchTimeout(p.url, { method: 'HEAD', headers: { 'User-Agent': 'AI-Provider-Suite-LocalGUI/1.0' } }, 8000);
    if ([405, 501, 403, 400].includes(resp.status)) {
      resp = await fetchTimeout(p.url, { method: 'GET', headers: { 'User-Agent': 'AI-Provider-Suite-LocalGUI/1.0' } }, 8000);
      try { await resp.body?.cancel(); } catch {}
    }
    latencyMs = Date.now() - h0;
    httpCode = String(resp.status);
    const ok = resp.status >= 200 && resp.status < 400;
    const isAuth = resp.status === 401;
    const waf = !ok && !isAuth && isWaf(resp.status, resp.headers);
    if (ok) {
      status = resp.url !== p.url ? 'REDIRECT' : 'OK';
      score += 25;
      phases.push({ phase: 'reachability', label: 'Phase 2: HTTP/TLS', status: 'pass', detail: 'HTTP ' + resp.status, durationMs: latencyMs });
    } else if (isAuth) {
      status = 'AUTH_REQUIRED';
      score = 78;
      phases.push({ phase: 'reachability', label: 'Phase 2: HTTP/TLS', status: 'warn', detail: 'HTTP 401 (Endpunkt aktiv, Auth/API-Key erforderlich)', durationMs: latencyMs });
    } else if (waf) {
      status = 'WAF_PROTECTED';
      score += 10;
      phases.push({ phase: 'reachability', label: 'Phase 2: HTTP/TLS', status: 'warn', detail: 'HTTP ' + resp.status + ' (WAF/Bot-Schutz, Host aktiv)', durationMs: latencyMs });
    } else {
      status = 'HTTP_ERROR';
      score = 15;
      phases.push({ phase: 'reachability', label: 'Phase 2: HTTP/TLS', status: 'fail', detail: 'HTTP ' + resp.status, durationMs: latencyMs });
    }

    const canProbeOnRoot404 = (resp.status === 404 || resp.status === 405) && /\\/v1\\b|\\/openai\\b/i.test(p.url);
    if (cls === 'GELB') {
      phases.push({ phase: 'protocol', label: 'Phase 3: API-Probe', status: 'skip', detail: 'GELB: nur Reachability (Ziel 2.3).' });
      score = Math.min(score, 74);
    } else if ((ok || waf || canProbeOnRoot404) && (p.auth_typ === 'keine' || byokApiKey) && !/github\\.com/i.test(p.url)) {
      const probeBase = p.url.replace(/\\/+$/, '') + (/(\\/v1|\\/openai)$/i.test(p.url.replace(/\\/+$/, '')) ? '' : '/v1');
      const p0 = Date.now();
      try {
        const hdrs = { Accept: 'application/json' };
        if (byokApiKey) hdrs.Authorization = 'Bearer ' + byokApiKey;
        let pr = await fetchTimeout(probeBase + '/models', { method: 'GET', headers: hdrs }, 6000);
        if (!pr.ok && probeBase.endsWith('/openai')) {
          const altPr = await fetchTimeout(probeBase.replace(/\\/openai$/, '') + '/models', { method: 'GET', headers: hdrs }, 6000);
          if (altPr.ok) pr = altPr;
        }
        if (pr.ok) {
          status = 'OK_API_PROBE';
          httpCode = String(pr.status);
          score = Math.max(96, Math.min(100, score + 10));
          phases.push({ phase: 'protocol', label: 'Phase 3: API-Probe', status: 'pass', detail: 'GET /models -> HTTP ' + pr.status, durationMs: Date.now() - p0 });
        } else {
          phases.push({ phase: 'protocol', label: 'Phase 3: API-Probe', status: 'warn', detail: 'GET /models -> HTTP ' + pr.status, durationMs: Date.now() - p0 });
        }
      } catch {
        phases.push({ phase: 'protocol', label: 'Phase 3: API-Probe', status: 'skip', detail: 'Standard-/v1/models nicht direkt offen.' });
      }
    } else {
      phases.push({ phase: 'protocol', label: 'Phase 3: API-Probe', status: 'skip', detail: isAuth ? 'Auth erforderlich (HTTP 401).' : 'Kein Key / kein offener v1-Endpunkt.' });
    }
  } catch (e) {
    latencyMs = Date.now() - h0;
    status = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    score = 15;
    phases.push({ phase: 'reachability', label: 'Phase 2: HTTP/TLS', status: 'fail', detail: e.message.slice(0, 120), durationMs: latencyMs });
  }

  phases.push({ phase: 'scoring', label: 'Phase 4: Bewertung', status: score >= 70 ? 'pass' : 'warn', detail: 'Score ' + score + '/100' });
  return {
    id: p.id, name: p.name, status, http_code: httpCode, latencyMs,
    note: phases.map((ph, i) => 'P' + (i + 1) + ':' + ph.status.toUpperCase()).join(' · ') + ' · Score ' + score + '/100',
    url: p.url, executed: true, healthScore: score, phases,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4e6) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', 'http://127.0.0.1:' + PORT);
  const pth = urlObj.pathname;

  if (req.method === 'GET' && (pth === '/' || pth === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    return;
  }

  if (req.method === 'GET' && pth === '/api/health') {
    sendJson(res, 200, { ok: true, runtime: 'node ' + process.version, dockerFree: true, host: '127.0.0.1', port: PORT });
    return;
  }

  if (req.method === 'GET' && pth.startsWith('/files/')) {
    const name = decodeURIComponent(pth.slice('/files/'.length));
    if (!ALLOWED_FILES.has(name)) { sendJson(res, 403, { error: 'Datei nicht freigegeben.' }); return; }
    const fp = path.join(SUITE_DIR, name);
    if (!fs.existsSync(fp)) { sendJson(res, 404, { error: 'Nicht gefunden.' }); return; }
    const ct = name.endsWith('.json') ? 'application/json' : 'text/plain';
    res.writeHead(200, { 'Content-Type': ct + '; charset=utf-8' });
    res.end(fs.readFileSync(fp, 'utf8'));
    return;
  }

  if (req.method === 'POST' && pth === '/api/test') {
    const body = await readBody(req);
    const prov = byId.get(body.providerId);
    if (!prov) { sendJson(res, 404, { error: 'Provider nicht gefunden.' }); return; }
    const result = await run4PhaseTest(prov, typeof body.byokApiKey === 'string' ? body.byokApiKey : '');
    sendJson(res, 200, { result });
    return;
  }

  if (req.method === 'POST' && pth === '/api/invoke') {
    const body = await readBody(req);
    const prov = byId.get(body.providerId);
    if (!prov) { sendJson(res, 404, { error: 'Provider nicht gefunden.' }); return; }
    const base = String(body.endpointUrl || prov.url || '').replace(/\\/+$/, '');
    const target = body.action === 'chat' ? base + '/chat/completions' : base + '/models';
    const check = validateSsrf(prov, target);
    if (!check.ok) { sendJson(res, 403, { ok: false, error: check.error }); return; }
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (body.apiKey) headers.Authorization = 'Bearer ' + String(body.apiKey).trim();
    const t0 = Date.now();
    try {
      const opts = body.action === 'chat'
        ? { method: 'POST', headers, body: JSON.stringify({ model: body.model || 'default', messages: [{ role: 'user', content: body.prompt || 'OK' }], max_tokens: 128 }) }
        : { method: 'GET', headers };
      const r = await fetchTimeout(check.url.toString(), opts, 15000);
      const txt = (await r.text()).slice(0, 12000);
      let parsed = null;
      try { parsed = JSON.parse(txt); } catch {}
      sendJson(res, 200, { ok: r.ok, httpStatus: r.status, latencyMs: Date.now() - t0, targetUrl: check.url.toString(), body: parsed || txt.slice(0, 1200) });
    } catch (e) {
      sendJson(res, 502, { ok: false, latencyMs: Date.now() - t0, error: e.message });
    }
    return;
  }

  if (req.method === 'GET' && pth === '/api/bridges/runtime') {
    sendJson(res, 200, { bridgeRuntimes: Array.from(bridgeStates.values()) });
    return;
  }

  if (req.method === 'POST' && pth === '/api/bridges/execute') {
    const body = await readBody(req);
    if (!body.confirmTosRisk) { sendJson(res, 400, { error: 'Bitte ToS-Restrisiko bestaetigen.' }); return; }
    const runtime = await executeLocalBridge(body.bridgeId);
    if (!runtime) { sendJson(res, 404, { error: 'Bridge nicht auf Allowlist.' }); return; }
    sendJson(res, 200, { runtime, bridgeRuntimes: Array.from(bridgeStates.values()) });
    return;
  }

  if (req.method === 'POST' && pth === '/api/bridges/stop') {
    const body = await readBody(req);
    const st = bridgeStates.get(body.bridgeId);
    if (!st) { sendJson(res, 404, { error: 'Bridge nicht gefunden.' }); return; }
    st.status = 'stopped';
    const ch = bridgeChildren.get(body.bridgeId);
    if (ch) { try { ch.kill('SIGTERM'); } catch {} bridgeChildren.delete(body.bridgeId); st.pid = null; }
    if (st.mode === 'docker' && st.dockerService) {
      try { await execFileAsync('docker', ['compose', '--profile', 'tos-risk', 'stop', st.dockerService], { cwd: SUITE_DIR, timeout: 15000 }); } catch {}
    }
    st.mode = 'none';
    logBridge(body.bridgeId, 'Bridge gestoppt.');
    sendJson(res, 200, { runtime: st, bridgeRuntimes: Array.from(bridgeStates.values()) });
    return;
  }

  if (req.method === 'POST' && pth === '/api/bridges/probe') {
    const body = await readBody(req);
    const st = bridgeStates.get(body.bridgeId);
    if (!st) { sendJson(res, 404, { error: 'Bridge nicht gefunden.' }); return; }
    const pr = await probeLocalPort(st.port);
    logBridge(body.bridgeId, 'Loopback-Probe: ' + pr.statusText);
    if (pr.ok) {
      st.status = 'running';
      st.error = null;
    } else if (st.status === 'running' || st.status === 'starting') {
      st.status = 'error';
      st.error = pr.statusText;
    }
    sendJson(res, 200, { runtime: st, probe: pr, bridgeRuntimes: Array.from(bridgeStates.values()) });
    return;
  }

  if (req.method === 'POST' && (pth === '/api/chat/models' || pth === '/api/chat/send')) {
    const body = await readBody(req);
    const mode = body.targetType || 'provider';
    let baseUrl = '';
    if (mode === 'bridge') {
      const b = allowBridges.get(body.bridgeId);
      if (!b || !b.port) { sendJson(res, 403, { ok: false, error: 'Bridge nicht auf Allowlist.' }); return; }
      baseUrl = 'http://127.0.0.1:' + b.port + '/v1';
    } else if (mode === 'provider') {
      const prov = byId.get(body.providerId);
      if (!prov) { sendJson(res, 404, { ok: false, error: 'Provider nicht gefunden.' }); return; }
      const raw = String(body.endpointUrl || prov.url || '').trim().replace(/\\/+$/, '');
      const chk = validateSsrf(prov, raw + '/chat/completions');
      if (!chk.ok) { sendJson(res, 403, { ok: false, error: chk.error }); return; }
      baseUrl = raw;
    } else {
      const raw = String(body.endpointUrl || (mode === 'litellm' ? 'http://127.0.0.1:4000/v1' : '')).trim().replace(/\\/+$/, '');
      let u;
      try { u = new URL(raw); } catch { sendJson(res, 400, { ok: false, error: 'Ungueltige URL.' }); return; }
      const h = u.hostname.toLowerCase().replace(/^\\[|\\]$/g, '');
      if (h !== '127.0.0.1' && h !== 'localhost' && h !== '::1') {
        sendJson(res, 403, { ok: false, error: 'SSRF-Schutz: Nur 127.0.0.1 / localhost zulaessig.' }); return;
      }
      baseUrl = raw;
    }
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (body.apiKey) headers.Authorization = 'Bearer ' + String(body.apiKey).trim();
    const t0 = Date.now();
    try {
      if (pth === '/api/chat/models') {
        let r = await fetchTimeout(baseUrl + '/models', { method: 'GET', headers }, 10000);
        if (!r.ok && baseUrl.endsWith('/openai')) {
          const alt = await fetchTimeout(baseUrl.replace(/\\/openai$/, '') + '/models', { method: 'GET', headers }, 10000);
          if (alt.ok) r = alt;
        }
        const txt = (await r.text()).slice(0, 120000);
        let parsed = null; try { parsed = JSON.parse(txt); } catch {}
        const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.models) ? parsed.models : [];
        const nonChatRe = /(whisper|tts|nvr-tts|solaria|embed|bge-|rerank|stable-diffusion|sdxl|flux|dall-e|moderation|transcribe|\\basr\\b|\\bstt\\b|\\bocr\\b)/i;
        const chatModels = [];
        const allModels = [];
        for (const item of list) {
          const mid = typeof item === 'string' ? item.trim() : String(item?.id || item?.name || '').trim();
          if (!mid || allModels.includes(mid)) continue;
          allModels.push(mid);
          const zeroCtx = typeof item === 'object' && item && item.context_length === 0 && item.max_completion_tokens === 0;
          const nonTextOut = Array.isArray(item?.output_modalities) && !item.output_modalities.includes('text');
          if (!zeroCtx && !nonTextOut && !nonChatRe.test(mid)) chatModels.push(mid);
        }
        const models = (chatModels.length > 0 ? chatModels : allModels).slice(0, 100);
        sendJson(res, 200, { ok: r.ok, httpStatus: r.status, latencyMs: Date.now() - t0, models, chatModels: chatModels.slice(0, 100), error: r.ok ? undefined : ('HTTP ' + r.status) });
      } else {
        const msgs = [];
        if (body.systemPrompt) msgs.push({ role: 'system', content: String(body.systemPrompt).trim() });
        if (Array.isArray(body.messages)) {
          for (const m of body.messages.slice(-40)) {
            if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
              msgs.push({ role: m.role, content: m.content });
            }
          }
        }
        const r = await fetchTimeout(baseUrl + '/chat/completions', {
          method: 'POST', headers,
          body: JSON.stringify({ model: body.model || 'default', messages: msgs, stream: false }),
        }, 45000);
        const txt = (await r.text()).slice(0, 120000);
        let parsed = null; try { parsed = JSON.parse(txt); } catch {}
        const reply = parsed?.choices?.[0]?.message?.content ?? parsed?.message?.content ?? parsed?.response ?? null;
        if (r.ok && typeof reply === 'string') {
          sendJson(res, 200, { ok: true, httpStatus: r.status, latencyMs: Date.now() - t0, reply, model: parsed?.model || body.model || 'default' });
        } else {
          sendJson(res, 200, { ok: false, httpStatus: r.status, latencyMs: Date.now() - t0, error: parsed?.error?.message || ('HTTP ' + r.status + ': ' + txt.slice(0, 200)) });
        }
      }
    } catch (e) {
      sendJson(res, 502, { ok: false, latencyMs: Date.now() - t0, error: 'Endpunkt ' + baseUrl + ' nicht erreichbar: ' + e.message });
    }
    return;
  }

  if (req.method === 'POST' && pth === '/api/save-csv') {
    const body = await readBody(req);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const escCsv = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = ['id,name,kategorie,status,http_code,risky,empfohlen,note,url'];
    for (const r of rows) {
      lines.push([r.id, r.name, r.kategorie, r.status, r.http_code, r.risky ? 'True' : 'False', r.empfohlen, r.note, r.url].map(escCsv).join(','));
    }
    fs.writeFileSync(path.join(SUITE_DIR, 'test_results.csv'), lines.join('\\n') + '\\n', 'utf8');
    sendJson(res, 200, { ok: true, count: rows.length });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log('Hinweis: Port ' + PORT + ' ist bereits belegt (GUI laeuft vermutlich schon unter http://127.0.0.1:' + PORT + ').');
    process.exit(0);
  }
  console.error('Serverfehler:', err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('AI-Provider-Suite Lokale GUI (Node) laeuft auf http://127.0.0.1:' + PORT);
});
`;
}

export function generateLocalGuiPythonServer(): string {
  return `#!/usr/bin/env python3
"""
AI-Provider-Suite – Zero-Dependency Local Windows-11 GUI Server (Python 3 stdlib only).
Strikt 127.0.0.1:8787 · Kein Docker · Keine pip-Pakete · Regel 1–7 aktiv.
"""
from __future__ import annotations

import csv
import io
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SUITE_DIR = Path(__file__).resolve().parent.parent
GUI_DIR = Path(__file__).resolve().parent
PORT = int(os.environ.get("AI_SUITE_GUI_PORT", "8787"))

ALLOWED_FILES = {
    "classification.json", "test_results.csv", "bridge_selection.json",
    "litellm_config.yaml", "docker-compose.yml", "REPORT.md", "SECURITY.md", "README.md",
}

CATALOG = json.loads((SUITE_DIR / "classification.json").read_text(encoding="utf-8"))
BY_ID = {p["id"]: p for p in CATALOG.get("providers", [])}
BRIDGES_RAW = json.loads((SUITE_DIR / "bridge_selection.json").read_text(encoding="utf-8")).get("bridges", []) if (SUITE_DIR / "bridge_selection.json").exists() else []
BRIDGE_BY_ID = {b["bridge_id"]: b for b in BRIDGES_RAW if b.get("docker_capable") and b.get("bridge_id") and b.get("port")}
BRIDGE_STATES = {
    bid: {
        "bridgeId": bid, "zielprovider": b.get("zielprovider", ""), "port": b["port"],
        "dockerService": b.get("docker_service"), "status": "stopped", "mode": "none",
        "pid": None, "error": None, "logs": [],
    }
    for bid, b in BRIDGE_BY_ID.items()
}


def probe_local_port(port: int) -> dict:
    for suffix in ("/v1/models", "/health", "/"):
        url = f"http://127.0.0.1:{port}{suffix}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=2.5) as r:
                return {"ok": True, "statusText": f"HTTP {r.status} ({suffix})"}
        except urllib.error.HTTPError as he:
            return {"ok": True, "statusText": f"HTTP {he.code} ({suffix})"}
        except Exception:
            continue
    return {"ok": False, "statusText": f"Kein Dienst auf 127.0.0.1:{port}"}


def resolve_chat_base(body: dict) -> tuple[bool, str]:
    mode = body.get("targetType") or "provider"
    if mode == "bridge":
        b = BRIDGE_BY_ID.get(body.get("bridgeId"))
        if not b:
            return False, "Bridge nicht auf Allowlist."
        return True, f"http://127.0.0.1:{b['port']}/v1"
    if mode == "provider":
        prov = BY_ID.get(body.get("providerId"))
        if not prov:
            return False, "Provider nicht gefunden."
        raw = str(body.get("endpointUrl") or prov.get("url") or "").strip().rstrip("/")
        ok, msg = validate_ssrf(prov, f"{raw}/chat/completions")
        return (True, raw) if ok else (False, msg)
    raw = str(body.get("endpointUrl") or ("http://127.0.0.1:4000/v1" if mode == "litellm" else "")).strip().rstrip("/")
    u = urllib.parse.urlparse(raw)
    if u.scheme not in ("http", "https") or (u.hostname or "").lower().strip("[]") not in ("127.0.0.1", "localhost", "::1"):
        return False, "SSRF-Schutz: Nur 127.0.0.1 / localhost zulaessig."
    return True, raw


def norm_cls(p: dict) -> str:
    c = p.get("security_class", "")
    if c in ("GRÜN", "GRUEN"):
        return "GRUEN"
    if c in ("GELB", "ROT", "SCHWARZ"):
        return c
    return "SCHWARZ"


def is_usable(p: dict | None) -> bool:
    if not p or p.get("illegal") or p.get("anonym_pseudo_key"):
        return False
    if "anonym_pseudo_key" in (p.get("kategorien") or []):
        return False
    if str(p.get("test_policy") or "").startswith("SKIP_RULE1_"):
        return False
    return norm_cls(p) in ("GRUEN", "GELB")


def validate_ssrf(provider: dict, raw_url: str) -> tuple[bool, str]:
    if not is_usable(provider):
        return False, "Regel 1/3: Nur GRÜN und GELB sind zulässig."
    u = urllib.parse.urlparse(raw_url)
    if u.scheme not in ("http", "https") or not u.hostname:
        return False, "Ungültige HTTP(S)-URL."
    h = u.hostname.lower().strip("[]")
    parts = h.split(".")
    is_priv172 = len(parts) == 4 and parts[0] == "172" and parts[1].isdigit() and 16 <= int(parts[1]) <= 31
    if (
        h in ("0.0.0.0", "169.254.169.254", "metadata.google.internal")
        or h.startswith(("10.", "192.168.", "169.254.", "fe80:", "fc00:", "fd00:", "::ffff:"))
        or is_priv172
    ):
        return False, "Zielhost durch SSRF-Schutz blockiert."
    is_local = h in ("localhost", "127.0.0.1", "::1")
    if is_local and "lokal_self_hosted" not in (provider.get("kategorien") or []):
        return False, "Loopback nur für lokale Engines (lokal_self_hosted)."
    if not is_local and str(provider.get("url", "")).startswith("http"):
        ch = (urllib.parse.urlparse(provider["url"]).hostname or "").lower()
        root = lambda x: ".".join(x.split(".")[-2:])
        if h != ch and root(h) != root(ch):
            return False, "Zielhost stimmt nicht mit Katalog-Domain überein (SSRF-Schutz)."
    return True, raw_url


def run_4phase_test(p: dict, byok_key: str = "") -> dict:
    cls = norm_cls(p)
    if not is_usable(p):
        return {
            "id": p["id"], "name": p["name"],
            "status": "SKIPPED (ToS-Risiko)" if cls == "ROT" else "SKIPPED (illegal)",
            "http_code": "-", "note": "Gesperrt (Regel 1/3)",
            "url": "[GESPERRT]" if cls == "SCHWARZ" else p.get("url", ""),
            "executed": False, "healthScore": 0, "phases": [],
        }
    url = p.get("url", "")
    phases = []
    if not url.startswith("http"):
        phases.append({"phase": "dns", "label": "Phase 1: URL/DNS", "status": "skip", "detail": "Lokal / keine HTTP-URL."})
        return {"id": p["id"], "name": p["name"], "status": "SKIPPED (lokal/kein Endpunkt)", "http_code": "-", "note": "Lokale Engine", "url": url, "executed": True, "healthScore": 70, "phases": phases}

    host = (urllib.parse.urlparse(url).hostname or "").lower()
    t0 = time.monotonic()
    if host not in ("localhost", "127.0.0.1"):
        try:
            addr = socket.gethostbyname(host)
            phases.append({"phase": "dns", "label": "Phase 1: URL/DNS", "status": "pass", "detail": f"{host} -> {addr}", "durationMs": int((time.monotonic() - t0) * 1000)})
        except Exception as exc:
            phases.append({"phase": "dns", "label": "Phase 1: URL/DNS", "status": "fail", "detail": f"DNS-Fehler: {exc}"})
            return {"id": p["id"], "name": p["name"], "status": "NETWORK_ERROR", "http_code": "-", "note": f"P1 DNS-FAIL: {exc}", "url": url, "executed": True, "healthScore": 0, "phases": phases}
    else:
        phases.append({"phase": "dns", "label": "Phase 1: URL/DNS", "status": "pass", "detail": "Loopback-Host"})

    h0 = time.monotonic()
    status, http_code, score = "OK", "-", 65
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "AI-Provider-Suite-LocalGUI/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                code = resp.status
                final_url = resp.geturl()
                hdrs = {k.lower(): v for k, v in resp.headers.items()}
        except urllib.error.HTTPError as he:
            if he.code in (400, 403, 405, 501):
                req2 = urllib.request.Request(url, method="GET", headers={"User-Agent": "AI-Provider-Suite-LocalGUI/1.0"})
                try:
                    with urllib.request.urlopen(req2, timeout=8) as r2:
                        code, final_url = r2.status, r2.geturl()
                        hdrs = {k.lower(): v for k, v in r2.headers.items()}
                except urllib.error.HTTPError as he2:
                    code, final_url = he2.code, url
                    hdrs = {k.lower(): v for k, v in he2.headers.items()}
            else:
                code, final_url = he.code, url
                hdrs = {k.lower(): v for k, v in he.headers.items()}
        latency_ms = int((time.monotonic() - h0) * 1000)
        http_code = str(code)
        ok = 200 <= code < 400
        srv = hdrs.get("server", "").lower()
        waf = (not ok) and (code == 429 or (code == 403 and ("cloudflare" in srv or "cf-ray" in hdrs or "akamai" in srv)))
        if ok:
            status = "REDIRECT" if final_url != url else "OK"
            score += 25
            phases.append({"phase": "reachability", "label": "Phase 2: HTTP/TLS", "status": "pass", "detail": f"HTTP {code}", "durationMs": latency_ms})
        elif waf:
            status = "WAF_PROTECTED"
            score += 10
            phases.append({"phase": "reachability", "label": "Phase 2: HTTP/TLS", "status": "warn", "detail": f"HTTP {code} (WAF-Schutz, Host aktiv)", "durationMs": latency_ms})
        else:
            status = "HTTP_ERROR"
            score = 15
            phases.append({"phase": "reachability", "label": "Phase 2: HTTP/TLS", "status": "fail", "detail": f"HTTP {code}", "durationMs": latency_ms})

        if cls == "GELB":
            phases.append({"phase": "protocol", "label": "Phase 3: API-Probe", "status": "skip", "detail": "GELB: nur Reachability (Ziel 2.3)."})
            score = min(score, 74)
        else:
            phases.append({"phase": "protocol", "label": "Phase 3: API-Probe", "status": "skip", "detail": "Direkt via 'Nutzen' mit optionalem Key prüfbar."})
    except Exception as exc:
        latency_ms = int((time.monotonic() - h0) * 1000)
        status = "TIMEOUT" if "timed out" in str(exc).lower() else "NETWORK_ERROR"
        score = 15
        phases.append({"phase": "reachability", "label": "Phase 2: HTTP/TLS", "status": "fail", "detail": str(exc)[:120], "durationMs": latency_ms})

    phases.append({"phase": "scoring", "label": "Phase 4: Bewertung", "status": "pass" if score >= 70 else "warn", "detail": f"Score {score}/100"})
    return {
        "id": p["id"], "name": p["name"], "status": status, "http_code": http_code,
        "latencyMs": latency_ms, "note": " · ".join(f"P{i+1}:{ph['status'].upper()}" for i, ph in enumerate(phases)) + f" · Score {score}/100",
        "url": url, "executed": True, "healthScore": score, "phases": phases,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send_json(self, code: int, obj: dict):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        pth = urllib.parse.urlparse(self.path).path
        if pth in ("/", "/index.html"):
            data = (GUI_DIR / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pth == "/api/health":
            self._send_json(200, {"ok": True, "runtime": "python", "dockerFree": True, "host": "127.0.0.1", "port": PORT})
            return
        if pth.startswith("/files/"):
            name = urllib.parse.unquote(pth[len("/files/"):])
            if name not in ALLOWED_FILES:
                self._send_json(403, {"error": "Datei nicht freigegeben."})
                return
            fp = SUITE_DIR / name
            if not fp.exists():
                self._send_json(404, {"error": "Nicht gefunden."})
                return
            data = fp.read_bytes()
            self.send_response(200)
            ct = "application/json" if name.endswith(".json") else "text/plain"
            self.send_header("Content-Type", f"{ct}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pth == "/api/bridges/runtime":
            self._send_json(200, {"bridgeRuntimes": list(BRIDGE_STATES.values())})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        pth = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(min(length, 4_000_000))
        try:
            body = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            body = {}

        if pth == "/api/test":
            prov = BY_ID.get(body.get("providerId"))
            if not prov:
                self._send_json(404, {"error": "Provider nicht gefunden."})
                return
            self._send_json(200, {"result": run_4phase_test(prov, str(body.get("byokApiKey") or ""))})
            return

        if pth == "/api/invoke":
            prov = BY_ID.get(body.get("providerId"))
            if not prov:
                self._send_json(404, {"error": "Provider nicht gefunden."})
                return
            base = str(body.get("endpointUrl") or prov.get("url") or "").rstrip("/")
            target = f"{base}/chat/completions" if body.get("action") == "chat" else f"{base}/models"
            ok, msg = validate_ssrf(prov, target)
            if not ok:
                self._send_json(403, {"ok": False, "error": msg})
                return
            hdrs = {"Accept": "application/json", "Content-Type": "application/json"}
            if body.get("apiKey"):
                hdrs["Authorization"] = f"Bearer {str(body['apiKey']).strip()}"
            t0 = time.monotonic()
            try:
                payload = None
                method = "GET"
                if body.get("action") == "chat":
                    method = "POST"
                    payload = json.dumps({
                        "model": body.get("model") or "default",
                        "messages": [{"role": "user", "content": body.get("prompt") or "OK"}],
                        "max_tokens": 128,
                    }).encode("utf-8")
                req = urllib.request.Request(target, data=payload, method=method, headers=hdrs)
                try:
                    with urllib.request.urlopen(req, timeout=15) as r:
                        txt = r.read(12000).decode("utf-8", errors="replace")
                        code = r.status
                except urllib.error.HTTPError as he:
                    txt = he.read(12000).decode("utf-8", errors="replace")
                    code = he.code
                try:
                    parsed = json.loads(txt)
                except Exception:
                    parsed = txt[:1200]
                self._send_json(200, {"ok": 200 <= code < 400, "httpStatus": code, "latencyMs": int((time.monotonic() - t0) * 1000), "targetUrl": target, "body": parsed})
            except Exception as exc:
                self._send_json(502, {"ok": False, "error": str(exc)[:180]})
            return

        if pth == "/api/bridges/execute":
            if not body.get("confirmTosRisk"):
                self._send_json(400, {"error": "Bitte ToS-Restrisiko bestaetigen."})
                return
            bid = body.get("bridgeId")
            st = BRIDGE_STATES.get(bid)
            b = BRIDGE_BY_ID.get(bid)
            if not st or not b:
                self._send_json(404, {"error": "Bridge nicht auf Allowlist."})
                return
            pr = probe_local_port(b["port"])
            if pr["ok"]:
                st["status"] = "running"
                st["error"] = None
                st["logs"].append("Loopback aktiv: " + pr["statusText"])
            else:
                st["status"] = "error"
                st["error"] = "Python-Fallback startet keine Docker/Node-Bridges direkt. Bitte Node.js GUI oder Docker Compose Kommando unten nutzen."
                st["logs"].append(st["error"])
            self._send_json(200, {"runtime": st, "bridgeRuntimes": list(BRIDGE_STATES.values())})
            return

        if pth == "/api/bridges/stop":
            st = BRIDGE_STATES.get(body.get("bridgeId"))
            if not st:
                self._send_json(404, {"error": "Bridge nicht gefunden."})
                return
            st["status"] = "stopped"
            st["logs"].append("Bridge gestoppt.")
            self._send_json(200, {"runtime": st, "bridgeRuntimes": list(BRIDGE_STATES.values())})
            return

        if pth == "/api/bridges/probe":
            st = BRIDGE_STATES.get(body.get("bridgeId"))
            if not st:
                self._send_json(404, {"error": "Bridge nicht gefunden."})
                return
            pr = probe_local_port(st["port"])
            st["logs"].append("Loopback-Probe: " + pr["statusText"])
            if pr["ok"]:
                st["status"] = "running"
            self._send_json(200, {"runtime": st, "probe": pr, "bridgeRuntimes": list(BRIDGE_STATES.values())})
            return

        if pth in ("/api/chat/models", "/api/chat/send"):
            ok, base_or_err = resolve_chat_base(body)
            if not ok:
                self._send_json(403, {"ok": False, "error": base_or_err})
                return
            hdrs = {"Accept": "application/json", "Content-Type": "application/json"}
            if body.get("apiKey"):
                hdrs["Authorization"] = f"Bearer {str(body['apiKey']).strip()}"
            t0 = time.monotonic()
            try:
                if pth == "/api/chat/models":
                    req = urllib.request.Request(f"{base_or_err}/models", method="GET", headers=hdrs)
                    with urllib.request.urlopen(req, timeout=10) as r:
                        parsed = json.loads(r.read(120000).decode("utf-8", errors="replace"))
                        items = parsed.get("data") or parsed.get("models") or []
                        models = [x["id"] if isinstance(x, dict) and "id" in x else (x.get("name") if isinstance(x, dict) else str(x)) for x in items][:100]
                        self._send_json(200, {"ok": True, "httpStatus": r.status, "latencyMs": int((time.monotonic() - t0) * 1000), "models": models})
                else:
                    msgs = []
                    if body.get("systemPrompt"):
                        msgs.append({"role": "system", "content": str(body["systemPrompt"]).strip()})
                    for m in (body.get("messages") or [])[-40:]:
                        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
                            msgs.append({"role": m["role"], "content": m["content"]})
                    payload = json.dumps({"model": body.get("model") or "default", "messages": msgs, "stream": False}).encode("utf-8")
                    req = urllib.request.Request(f"{base_or_err}/chat/completions", data=payload, method="POST", headers=hdrs)
                    try:
                        with urllib.request.urlopen(req, timeout=45) as r:
                            txt = r.read(120000).decode("utf-8", errors="replace")
                            code = r.status
                    except urllib.error.HTTPError as he:
                        txt = he.read(120000).decode("utf-8", errors="replace")
                        code = he.code
                    try:
                        parsed = json.loads(txt)
                    except Exception:
                        parsed = {}
                    reply = None
                    if isinstance(parsed, dict):
                        choices = parsed.get("choices") or []
                        if choices and isinstance(choices[0], dict):
                            reply = (choices[0].get("message") or {}).get("content")
                        if reply is None and isinstance(parsed.get("message"), dict):
                            reply = parsed["message"].get("content")
                    if 200 <= code < 300 and isinstance(reply, str):
                        self._send_json(200, {"ok": True, "httpStatus": code, "latencyMs": int((time.monotonic() - t0) * 1000), "reply": reply, "model": parsed.get("model") or body.get("model") or "default"})
                    else:
                        self._send_json(200, {"ok": False, "httpStatus": code, "latencyMs": int((time.monotonic() - t0) * 1000), "error": f"HTTP {code}: {txt[:200]}"})
            except Exception as exc:
                self._send_json(502, {"ok": False, "error": f"Endpunkt {base_or_err} nicht erreichbar: {str(exc)[:160]}"})
            return

        if pth == "/api/save-csv":
            rows = body.get("rows") or []
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["id", "name", "kategorie", "status", "http_code", "risky", "empfohlen", "note", "url"])
            for r in rows:
                w.writerow([r.get("id",""), r.get("name",""), r.get("kategorie",""), r.get("status",""), r.get("http_code","-"), "True" if r.get("risky") else "False", r.get("empfohlen","False"), r.get("note",""), r.get("url","")])
            (SUITE_DIR / "test_results.csv").write_text(buf.getvalue(), encoding="utf-8")
            self._send_json(200, {"ok": True, "count": len(rows)})
            return

        self._send_json(404, {"error": "Not found"})


if __name__ == "__main__":
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as exc:
        print(f"Hinweis: Port {PORT} konnte nicht geoeffnet werden ({exc}). Laeuft die GUI bereits unter http://127.0.0.1:{PORT}?", flush=True)
        raise SystemExit(0)
    print(f"AI-Provider-Suite Lokale GUI (Python) laeuft auf http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
`;
}

export function generateLocalGuiPowerShellServer(): string {
  return `<#
.SYNOPSIS
    Zero-Dependency Windows-11 Lokaler GUI-Server (reines PowerShell 5.1+, TcpListener).
    Benoetigt KEIN Docker Desktop, KEIN Node.js, KEIN Python und KEINE Admin-Rechte.
    Bindet strikt an 127.0.0.1:8787 (Harte Regel 4). Reines ASCII fuer PS-5.1-Kompatibilitaet.
#>
param(
    [int]$Port = 8787
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::DefaultConnectionLimit = 32

$GuiDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SuiteDir = Split-Path -Parent $GuiDir

$AllowedFiles = @(
    'classification.json','test_results.csv','bridge_selection.json',
    'litellm_config.yaml','docker-compose.yml','REPORT.md','SECURITY.md','README.md'
)

$Catalog = Get-Content -Raw -Encoding UTF8 (Join-Path $SuiteDir 'classification.json') | ConvertFrom-Json
$ById = @{}
foreach ($p in $Catalog.providers) { $ById[$p.id] = $p }
$BridgeById = @{}
$BridgeStates = @{}
$BridgeFile = Join-Path $SuiteDir 'bridge_selection.json'
if (Test-Path $BridgeFile) {
    $BrJson = Get-Content -Raw -Encoding UTF8 $BridgeFile | ConvertFrom-Json
    foreach ($br in $BrJson.bridges) {
        if ($br.docker_capable -and $br.bridge_id -and $br.port) {
            $BridgeById[[string]$br.bridge_id] = $br
            $BridgeStates[[string]$br.bridge_id] = @{
                bridgeId = [string]$br.bridge_id; zielprovider = [string]$br.zielprovider;
                port = [int]$br.port; dockerService = [string]$br.docker_service;
                status = 'stopped'; mode = 'none'; pid = $null; error = $null; logs = @()
            }
        }
    }
}

function Test-LocalBridgePort([int]$bPort) {
    foreach ($sfx in @('/v1/models','/health','/')) {
        try {
            $pr = Invoke-HttpProbe "http://127.0.0.1:$bPort$sfx" 'GET'
            return @{ ok = $true; statusText = "HTTP $($pr.code) ($sfx)" }
        } catch {}
    }
    return @{ ok = $false; statusText = "Kein Dienst auf 127.0.0.1:$bPort" }
}

function Get-NormClass($p) {
    $c = [string]$p.security_class
    if ($c -eq 'GRUEN' -or $c -like 'GR*N') { return 'GRUEN' }
    if ($c -eq 'GELB' -or $c -eq 'ROT' -or $c -eq 'SCHWARZ') { return $c }
    return 'SCHWARZ'
}

function Test-Usable($p) {
    if ($null -eq $p) { return $false }
    if ($p.illegal -or $p.anonym_pseudo_key) { return $false }
    if ($p.kategorien -contains 'anonym_pseudo_key') { return $false }
    if (([string]$p.test_policy).StartsWith('SKIP_RULE1_')) { return $false }
    $c = Get-NormClass $p
    return ($c -eq 'GRUEN' -or $c -eq 'GELB')
}

function Test-SsrfSafe($p, [string]$rawUrl) {
    if (-not (Test-Usable $p)) {
        return @{ ok = $false; error = 'Regel 1/3: Nur GRUEN und GELB sind zulaessig.' }
    }
    try { $u = [System.Uri]$rawUrl } catch {
        return @{ ok = $false; error = 'Ungueltige URL.' }
    }
    if ($u.Scheme -ne 'http' -and $u.Scheme -ne 'https') {
        return @{ ok = $false; error = 'Nur HTTP(S) erlaubt.' }
    }
    $h = $u.Host.ToLower().Trim('[', ']')
    if (
        $h -eq '0.0.0.0' -or
        $h -eq 'metadata.google.internal' -or
        $h -match '^(10|169\.254)\.' -or
        $h -match '^192\.168\.' -or
        $h -match '^172\.(1[6-9]|2[0-9]|3[0-1])\.' -or
        $h.StartsWith('fe80:') -or
        $h.StartsWith('fc00:') -or
        $h.StartsWith('fd00:') -or
        $h.StartsWith('::ffff:')
    ) {
        return @{ ok = $false; error = 'Zielhost durch SSRF-Schutz blockiert.' }
    }
    $isLocal = ($h -eq 'localhost' -or $h -eq '127.0.0.1' -or $h -eq '::1')
    if ($isLocal -and -not ($p.kategorien -contains 'lokal_self_hosted')) {
        return @{ ok = $false; error = 'Loopback nur fuer lokale Engines (lokal_self_hosted).' }
    }
    $catUrl = [string]$p.url
    if (-not $isLocal -and $catUrl -match '^https?://') {
        try {
            $ch = ([System.Uri]$catUrl).Host.ToLower()
            $hParts = $h.Split('.')
            $cParts = $ch.Split('.')
            $hRoot = if ($hParts.Length -ge 2) { ($hParts[($hParts.Length - 2)..($hParts.Length - 1)] -join '.') } else { $h }
            $cRoot = if ($cParts.Length -ge 2) { ($cParts[($cParts.Length - 2)..($cParts.Length - 1)] -join '.') } else { $ch }
            if ($h -ne $ch -and $hRoot -ne $cRoot) {
                return @{ ok = $false; error = 'Zielhost stimmt nicht mit Katalog-Domain ueberein (SSRF-Schutz).' }
            }
        } catch {}
    }
    return @{ ok = $true; url = $u.AbsoluteUri }
}

function Send-HttpResponse($stream, [int]$status, [string]$contentType, [byte[]]$bodyBytes) {
    $reason = if ($status -eq 200) { 'OK' } elseif ($status -eq 403) { 'Forbidden' } elseif ($status -eq 404) { 'Not Found' } else { 'Error' }
    $header = "HTTP/1.1 $status $reason\`r\`nContent-Type: $contentType\`r\`nContent-Length: $($bodyBytes.Length)\`r\`nConnection: close\`r\`n\`r\`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($bodyBytes, 0, $bodyBytes.Length)
    $stream.Flush()
}

function Send-Json($stream, [int]$status, $obj) {
    $json = $obj | ConvertTo-Json -Depth 8 -Compress
    Send-HttpResponse $stream $status 'application/json; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Invoke-HttpProbe([string]$url, [string]$method) {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = $method
    $req.Timeout = 8000
    $req.ReadWriteTimeout = 8000
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'AI-Provider-Suite-LocalGUI-PS/1.0'
    $resp = $null
    try {
        $resp = $req.GetResponse()
        return @{ code = [int]$resp.StatusCode; finalUrl = $resp.ResponseUri.AbsoluteUri }
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $errResp = $_.Exception.Response
            try {
                return @{ code = [int]$errResp.StatusCode; finalUrl = $url }
            } finally {
                $errResp.Close()
            }
        }
        throw
    } finally {
        if ($null -ne $resp) { $resp.Close() }
    }
}

function Invoke-4PhaseTest($p, [string]$byokKey) {
    $cls = Get-NormClass $p
    if (-not (Test-Usable $p)) {
        return @{
            id = $p.id; name = $p.name;
            status = if ($cls -eq 'ROT') { 'SKIPPED (ToS-Risiko)' } else { 'SKIPPED (illegal)' };
            http_code = '-'; note = 'Gesperrt (Regel 1/3)';
            url = if ($cls -eq 'SCHWARZ') { '[GESPERRT]' } else { [string]$p.url };
            executed = $false; healthScore = 0; phases = @()
        }
    }
    $url = [string]$p.url
    $phases = @()
    if (-not ($url -match '^https?://')) {
        $phases += @{ phase='dns'; label='Phase 1: URL/DNS'; status='skip'; detail='Lokal / keine HTTP-URL.' }
        return @{ id=$p.id; name=$p.name; status='SKIPPED (lokal/kein Endpunkt)'; http_code='-'; note='Lokale Engine'; url=$url; executed=$true; healthScore=70; phases=$phases }
    }
    $uri = [System.Uri]$url
    $hostName = $uri.Host.ToLower()
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    if ($hostName -ne 'localhost' -and $hostName -ne '127.0.0.1') {
        try {
            $ips = [System.Net.Dns]::GetHostAddresses($hostName)
            $phases += @{ phase='dns'; label='Phase 1: URL/DNS'; status='pass'; detail="$hostName -> $($ips[0].IPAddressToString)"; durationMs=[int]$sw.ElapsedMilliseconds }
        } catch {
            $phases += @{ phase='dns'; label='Phase 1: URL/DNS'; status='fail'; detail="DNS-Fehler: $($_.Exception.Message)" }
            return @{ id=$p.id; name=$p.name; status='NETWORK_ERROR'; http_code='-'; note='P1 DNS-FAIL'; url=$url; executed=$true; healthScore=0; phases=$phases }
        }
    } else {
        $phases += @{ phase='dns'; label='Phase 1: URL/DNS'; status='pass'; detail='Loopback-Host' }
    }

    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    $st = 'OK'; $httpCode = '-'; $score = 65
    try {
        $probe = Invoke-HttpProbe $url 'HEAD'
        if ($probe.code -in @(400, 403, 405, 501)) {
            $probe = Invoke-HttpProbe $url 'GET'
        }
        $code = $probe.code
        $httpCode = [string]$code
        if ($code -ge 200 -and $code -lt 400) {
            if ($probe.finalUrl -ne $url) { $st = 'REDIRECT' }
            $score += 25
            $phases += @{ phase='reachability'; label='Phase 2: HTTP/TLS'; status='pass'; detail="HTTP $code"; durationMs=[int]$sw2.ElapsedMilliseconds }
        } elseif ($code -eq 403 -or $code -eq 429) {
            $st = 'WAF_PROTECTED'; $score += 10
            $phases += @{ phase='reachability'; label='Phase 2: HTTP/TLS'; status='warn'; detail="HTTP $code (WAF/Bot-Schutz, Host aktiv)"; durationMs=[int]$sw2.ElapsedMilliseconds }
        } else {
            $st = 'HTTP_ERROR'; $score = 15
            $phases += @{ phase='reachability'; label='Phase 2: HTTP/TLS'; status='fail'; detail="HTTP $code"; durationMs=[int]$sw2.ElapsedMilliseconds }
        }
        if ($cls -eq 'GELB') {
            $phases += @{ phase='protocol'; label='Phase 3: API-Probe'; status='skip'; detail='GELB: nur Reachability (Ziel 2.3).' }
            if ($score -gt 74) { $score = 74 }
        } else {
            $phases += @{ phase='protocol'; label='Phase 3: API-Probe'; status='skip'; detail='Ueber Nutzen-Panel mit Key testbar.' }
        }
    } catch {
        $st = 'NETWORK_ERROR'; $score = 15
        $phases += @{ phase='reachability'; label='Phase 2: HTTP/TLS'; status='fail'; detail=$_.Exception.Message }
    }
    $phases += @{ phase='scoring'; label='Phase 4: Bewertung'; status=$(if ($score -ge 70) {'pass'} else {'warn'}); detail="Score $score/100" }
    return @{
        id=$p.id; name=$p.name; status=$st; http_code=$httpCode; latencyMs=[int]$sw2.ElapsedMilliseconds;
        note="P1..P4 | Score $score/100"; url=$url; executed=$true; healthScore=$score; phases=$phases
    }
}

function Read-HttpRequest($stream) {
    $ms = New-Object System.IO.MemoryStream
    $chunk = New-Object byte[] 4096
    $headerEnd = -1
    $contentLength = 0
    while ($headerEnd -lt 0 -and $ms.Length -lt 65536) {
        $n = $stream.Read($chunk, 0, $chunk.Length)
        if ($n -le 0) { break }
        $ms.Write($chunk, 0, $n)
        $arr = $ms.ToArray()
        for ($i = 0; $i -le ($arr.Length - 4); $i++) {
            if ($arr[$i] -eq 13 -and $arr[$i+1] -eq 10 -and $arr[$i+2] -eq 13 -and $arr[$i+3] -eq 10) {
                $headerEnd = $i
                break
            }
        }
    }
    if ($headerEnd -lt 0) { return $null }
    $all = $ms.ToArray()
    $headerText = [System.Text.Encoding]::ASCII.GetString($all, 0, $headerEnd)
    $headerLines = $headerText -split "\`r\`n"
    if ($headerLines.Length -eq 0) { return $null }
    $reqParts = $headerLines[0].Split(' ')
    if ($reqParts.Length -lt 2) { return $null }
    foreach ($hl in $headerLines) {
        if ($hl -match '^Content-Length:\s*(\d+)') { $contentLength = [int]$matches[1] }
    }
    $bodyOffset = $headerEnd + 4
    $bodyStream = New-Object System.IO.MemoryStream
    if ($all.Length -gt $bodyOffset) {
        $bodyStream.Write($all, $bodyOffset, $all.Length - $bodyOffset)
    }
    while ($contentLength -gt 0 -and $contentLength -lt 4000000 -and $bodyStream.Length -lt $contentLength) {
        $need = [Math]::Min($chunk.Length, $contentLength - [int]$bodyStream.Length)
        $n = $stream.Read($chunk, 0, $need)
        if ($n -le 0) { break }
        $bodyStream.Write($chunk, 0, $n)
    }
    $bodyStr = if ($bodyStream.Length -gt 0) { [System.Text.Encoding]::UTF8.GetString($bodyStream.ToArray()) } else { '' }
    return @{
        method = $reqParts[0]
        pathOnly = ($reqParts[1] -split '\?')[0]
        body = $bodyStr
    }
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try {
    $listener.Start()
} catch {
    Write-Host "Hinweis: Port $Port ist bereits belegt (GUI laeuft vermutlich schon unter http://127.0.0.1:$Port)." -ForegroundColor Yellow
    exit 0
}
Write-Host "AI-Provider-Suite Lokale GUI (PowerShell, ohne Docker) laeuft auf http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Dieses Fenster offen lassen. Zum Beenden einfach schliessen." -ForegroundColor Gray

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 8000
            $reqData = Read-HttpRequest $stream
            if ($null -eq $reqData) { continue }
            $method = $reqData.method
            $pathOnly = $reqData.pathOnly
            $bodyStr = $reqData.body

            if ($method -eq 'GET' -and ($pathOnly -eq '/' -or $pathOnly -eq '/index.html')) {
                $bytes = [System.IO.File]::ReadAllBytes((Join-Path $GuiDir 'index.html'))
                Send-HttpResponse $stream 200 'text/html; charset=utf-8' $bytes
            } elseif ($method -eq 'GET' -and $pathOnly -eq '/api/health') {
                Send-Json $stream 200 @{ ok=$true; runtime='PowerShell-TcpListener'; dockerFree=$true; host='127.0.0.1'; port=$Port }
            } elseif ($method -eq 'GET' -and $pathOnly.StartsWith('/files/')) {
                $fname = [System.Uri]::UnescapeDataString($pathOnly.Substring(7))
                if ($AllowedFiles -contains $fname) {
                    $fp = Join-Path $SuiteDir $fname
                    if (Test-Path $fp) {
                        $ct = if ($fname.EndsWith('.json')) { 'application/json; charset=utf-8' } else { 'text/plain; charset=utf-8' }
                        Send-HttpResponse $stream 200 $ct ([System.IO.File]::ReadAllBytes($fp))
                    } else { Send-Json $stream 404 @{ error='Nicht gefunden' } }
                } else { Send-Json $stream 403 @{ error='Datei nicht freigegeben' } }
            } elseif ($method -eq 'POST' -and $pathOnly -eq '/api/test') {
                $b = $bodyStr | ConvertFrom-Json
                $prov = $ById[[string]$b.providerId]
                if ($null -eq $prov) { Send-Json $stream 404 @{ error='Provider nicht gefunden' } }
                else { Send-Json $stream 200 @{ result = (Invoke-4PhaseTest $prov ([string]$b.byokApiKey)) } }
            } elseif ($method -eq 'POST' -and $pathOnly -eq '/api/invoke') {
                $b = $bodyStr | ConvertFrom-Json
                $prov = $ById[[string]$b.providerId]
                $base = ([string]$b.endpointUrl).TrimEnd('/')
                $target = if ($b.action -eq 'chat') { "$base/chat/completions" } else { "$base/models" }
                $chk = Test-SsrfSafe $prov $target
                if (-not $chk.ok) {
                    Send-Json $stream 403 @{ ok=$false; error=$chk.error }
                } else {
                    $hdrs = @{ Accept = 'application/json' }
                    if ($b.apiKey) { $hdrs['Authorization'] = "Bearer $([string]$b.apiKey)" }
                    try {
                        if ($b.action -eq 'chat') {
                            $pBody = @{ model = $(if ($b.model) { $b.model } else { 'default' }); messages = @(@{ role='user'; content=$(if ($b.prompt) { $b.prompt } else { 'OK' }) }); max_tokens = 128 } | ConvertTo-Json -Depth 4
                            $r = Invoke-WebRequest -UseBasicParsing -Uri $chk.url -Method Post -Headers $hdrs -ContentType 'application/json' -Body $pBody -TimeoutSec 15
                        } else {
                            $r = Invoke-WebRequest -UseBasicParsing -Uri $chk.url -Method Get -Headers $hdrs -TimeoutSec 15
                        }
                        Send-Json $stream 200 @{ ok=$true; httpStatus=[int]$r.StatusCode; targetUrl=$chk.url; body=$r.Content.Substring(0, [Math]::Min(2000, $r.Content.Length)) }
                    } catch {
                        Send-Json $stream 502 @{ ok=$false; targetUrl=$chk.url; error=$_.Exception.Message }
                    }
                }
            } elseif ($method -eq 'GET' -and $pathOnly -eq '/api/bridges/runtime') {
                Send-Json $stream 200 @{ bridgeRuntimes = @($BridgeStates.Values) }
            } elseif ($method -eq 'POST' -and $pathOnly -eq '/api/bridges/execute') {
                $b = $bodyStr | ConvertFrom-Json
                if (-not $b.confirmTosRisk) {
                    Send-Json $stream 400 @{ error='Bitte ToS-Restrisiko bestaetigen.' }
                } else {
                    $st = $BridgeStates[[string]$b.bridgeId]
                    if ($null -eq $st) { Send-Json $stream 404 @{ error='Bridge nicht auf Allowlist.' } }
                    else {
                        $pr = Test-LocalBridgePort $st.port
                        if ($pr.ok) {
                            $st.status = 'running'; $st.error = $null; $st.logs += ("Loopback aktiv: " + $pr.statusText)
                        } else {
                            $st.status = 'error'
                            $st.error = 'PowerShell-Fallback startet keine Docker/Node-Bridges direkt. Bitte Node.js GUI oder Docker-Kommando unten ausfuehren.'
                            $st.logs += $st.error
                        }
                        Send-Json $stream 200 @{ runtime=$st; bridgeRuntimes=@($BridgeStates.Values) }
                    }
                }
            } elseif ($method -eq 'POST' -and $pathOnly -eq '/api/bridges/stop') {
                $b = $bodyStr | ConvertFrom-Json
                $st = $BridgeStates[[string]$b.bridgeId]
                if ($null -eq $st) { Send-Json $stream 404 @{ error='Bridge nicht gefunden.' } }
                else { $st.status = 'stopped'; $st.logs += 'Bridge gestoppt.'; Send-Json $stream 200 @{ runtime=$st; bridgeRuntimes=@($BridgeStates.Values) } }
            } elseif ($method -eq 'POST' -and $pathOnly -eq '/api/bridges/probe') {
                $b = $bodyStr | ConvertFrom-Json
                $st = $BridgeStates[[string]$b.bridgeId]
                if ($null -eq $st) { Send-Json $stream 404 @{ error='Bridge nicht gefunden.' } }
                else {
                    $pr = Test-LocalBridgePort $st.port
                    $st.logs += ("Loopback-Probe: " + $pr.statusText)
                    if ($pr.ok) { $st.status = 'running' }
                    Send-Json $stream 200 @{ runtime=$st; probe=$pr; bridgeRuntimes=@($BridgeStates.Values) }
                }
            } elseif ($method -eq 'POST' -and ($pathOnly -eq '/api/chat/models' -or $pathOnly -eq '/api/chat/send')) {
                $b = $bodyStr | ConvertFrom-Json
                $mode = if ($b.targetType) { [string]$b.targetType } else { 'provider' }
                $chatBase = ''
                $chatErr = $null
                if ($mode -eq 'bridge') {
                    $br = $BridgeById[[string]$b.bridgeId]
                    if ($null -eq $br) { $chatErr = 'Bridge nicht auf Allowlist.' }
                    else { $chatBase = "http://127.0.0.1:$($br.port)/v1" }
                } elseif ($mode -eq 'provider') {
                    $prov = $ById[[string]$b.providerId]
                    $raw = ([string]$b.endpointUrl).TrimEnd('/')
                    $chk = Test-SsrfSafe $prov "$raw/chat/completions"
                    if (-not $chk.ok) { $chatErr = $chk.error } else { $chatBase = $raw }
                } else {
                    $raw = ([string]$b.endpointUrl).TrimEnd('/')
                    if (-not $raw -and $mode -eq 'litellm') { $raw = 'http://127.0.0.1:4000/v1' }
                    try {
                        $uu = [System.Uri]$raw
                        $hh = $uu.Host.ToLower().Trim('[',']')
                        if ($hh -ne '127.0.0.1' -and $hh -ne 'localhost' -and $hh -ne '::1') {
                            $chatErr = 'SSRF-Schutz: Nur 127.0.0.1 / localhost erlaubt.'
                        } else { $chatBase = $raw }
                    } catch { $chatErr = 'Ungueltige URL.' }
                }
                if ($null -ne $chatErr) {
                    Send-Json $stream 403 @{ ok=$false; error=$chatErr }
                } else {
                    $hdrs = @{ Accept = 'application/json' }
                    if ($b.apiKey) { $hdrs['Authorization'] = "Bearer $([string]$b.apiKey)" }
                    try {
                        if ($pathOnly -eq '/api/chat/models') {
                            $r = Invoke-WebRequest -UseBasicParsing -Uri "$chatBase/models" -Method Get -Headers $hdrs -TimeoutSec 10
                            $j = $r.Content | ConvertFrom-Json
                            $mlist = @()
                            if ($j.data) { foreach ($x in $j.data) { if ($x.id) { $mlist += [string]$x.id } } }
                            Send-Json $stream 200 @{ ok=$true; httpStatus=[int]$r.StatusCode; models=$mlist }
                        } else {
                            $msgs = @()
                            if ($b.systemPrompt) { $msgs += @{ role='system'; content=[string]$b.systemPrompt } }
                            foreach ($m in $b.messages) { $msgs += @{ role=[string]$m.role; content=[string]$m.content } }
                            $pBody = @{ model=$(if ($b.model) { [string]$b.model } else { 'default' }); messages=$msgs; stream=$false } | ConvertTo-Json -Depth 6
                            $r = Invoke-WebRequest -UseBasicParsing -Uri "$chatBase/chat/completions" -Method Post -Headers $hdrs -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($pBody)) -TimeoutSec 45
                            $j = $r.Content | ConvertFrom-Json
                            $rep = if ($j.choices -and $j.choices[0].message.content) { [string]$j.choices[0].message.content } else { $r.Content }
                            Send-Json $stream 200 @{ ok=$true; httpStatus=[int]$r.StatusCode; reply=$rep; model=$(if($j.model){[string]$j.model}else{[string]$b.model}) }
                        }
                    } catch {
                        Send-Json $stream 502 @{ ok=$false; error="Endpunkt $chatBase nicht erreichbar: $($_.Exception.Message)" }
                    }
                }
            } elseif ($method -eq 'POST' -and $pathOnly -eq '/api/save-csv') {
                $b = $bodyStr | ConvertFrom-Json
                $lines = New-Object System.Collections.Generic.List[string]
                $lines.Add('id,name,kategorie,status,http_code,risky,empfohlen,note,url')
                foreach ($r in $b.rows) {
                    $vals = @($r.id,$r.name,$r.kategorie,$r.status,$r.http_code,$(if($r.risky){'True'}else{'False'}),$r.empfohlen,$r.note,$r.url) | ForEach-Object { '"' + ([string]$_).Replace('"','""') + '"' }
                    $lines.Add(($vals -join ','))
                }
                [System.IO.File]::WriteAllLines((Join-Path $SuiteDir 'test_results.csv'), $lines, [System.Text.Encoding]::UTF8)
                Send-Json $stream 200 @{ ok=$true; count=$b.rows.Count }
            } else {
                Send-Json $stream 404 @{ error='Not found' }
            }
        } catch {
            # keep listener alive on client reset
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
`;
}
