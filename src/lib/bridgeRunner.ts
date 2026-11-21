import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { cloneOrUpdateBridgeRepo, type AllowlistedBridgeRepo } from './repoManager.ts';
import type { BridgeRepoStatus, BridgeRuntimeState, BridgeSelectionEntry } from './types.ts';

const execFileAsync = promisify(execFile);
const MAX_LOG_LINES = 160;

export interface LocalBridgeStartPlan {
  runtime: 'node' | 'python' | 'go' | 'docker_only' | 'unknown';
  bin: string | null;
  args: string[];
  commandDisplay: string;
  reason: string;
  needsNpmInstall?: boolean;
  extraEnv?: Record<string, string>;
}

/**
 * Resolves npm execution safely across Windows 11 (Node 20.12+/22+/26 CVE-2024-27980 blocks
 * direct spawn/execFile of `.cmd` files without shell). Prefers invoking Node directly with
 * `npm-cli.js` beside `process.execPath` (zero shell, zero EINVAL), falling back to
 * `cmd.exe /d /s /c npm ...` with strictly internal hardcoded arguments.
 */
export function resolveNpmInvocation(
  npmArgs: string[],
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
  env: NodeJS.ProcessEnv = process.env
): { bin: string; args: string[]; display: string } {
  const display = `npm ${npmArgs.join(' ')}`;
  if (platform !== 'win32') {
    return { bin: 'npm', args: npmArgs, display };
  }

  const nodeDir = path.dirname(execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    env.APPDATA ? path.join(env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js') : '',
    env.ProgramFiles
      ? path.join(env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : '',
  ].filter(Boolean);

  for (const cliPath of candidates) {
    try {
      if (fs.existsSync(cliPath)) {
        return { bin: execPath, args: [cliPath, ...npmArgs], display };
      }
    } catch {
      // ignore fs access issues
    }
  }

  const comspec = env.ComSpec || 'cmd.exe';
  return { bin: comspec, args: ['/d', '/s', '/c', 'npm', ...npmArgs], display };
}

/**
 * Pure, deterministic inspection of a cloned bridge repository to determine
 * how it can be executed locally without Docker (strictly bound to 127.0.0.1:<port>).
 */
export function detectLocalBridgeStartPlan(localDir: string, port: number): LocalBridgeStartPlan {
  if (!fs.existsSync(localDir)) {
    return {
      runtime: 'unknown',
      bin: null,
      args: [],
      commandDisplay: '',
      reason: 'Repository ist noch nicht lokal geklont.',
    };
  }

  const pkgPath = path.join(localDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
        main?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const hasDeps =
        (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
        (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);
      const needsNpmInstall = Boolean(hasDeps && !fs.existsSync(path.join(localDir, 'node_modules')));

      if (pkg.scripts?.['start:node'] && pkg.scripts?.start && /\bbun\b/i.test(pkg.scripts.start)) {
        const inv = resolveNpmInvocation(['run', 'start:node']);
        return {
          runtime: 'node',
          bin: inv.bin,
          args: inv.args,
          commandDisplay: `HOST=127.0.0.1 PORT=${port} ${inv.display}`,
          reason: `package.json nutzt bun fuer start — waehle Node-kompatibles Skript start:node (${pkg.scripts['start:node']}).`,
          needsNpmInstall,
        };
      }
      if (pkg.scripts?.start) {
        const inv = resolveNpmInvocation(['start']);
        return {
          runtime: 'node',
          bin: inv.bin,
          args: inv.args,
          commandDisplay: `HOST=127.0.0.1 PORT=${port} ${inv.display}`,
          reason: `package.json mit start-Skript erkannt (${pkg.scripts.start}).`,
          needsNpmInstall,
        };
      }
      if (pkg.scripts?.dev) {
        const inv = resolveNpmInvocation(['run', 'dev']);
        return {
          runtime: 'node',
          bin: inv.bin,
          args: inv.args,
          commandDisplay: `HOST=127.0.0.1 PORT=${port} ${inv.display}`,
          reason: `package.json mit dev-Skript erkannt (${pkg.scripts.dev}).`,
          needsNpmInstall,
        };
      }
      if (pkg.main && fs.existsSync(path.join(localDir, pkg.main))) {
        return {
          runtime: 'node',
          bin: process.execPath,
          args: [pkg.main],
          commandDisplay: `HOST=127.0.0.1 PORT=${port} node ${pkg.main}`,
          reason: `package.json Einstiegspunkt ${pkg.main} erkannt.`,
          needsNpmInstall,
        };
      }
      for (const jsEntry of ['index.js', 'server.js', 'app.js', 'dist/index.js']) {
        if (fs.existsSync(path.join(localDir, jsEntry))) {
          return {
            runtime: 'node',
            bin: process.execPath,
            args: [jsEntry],
            commandDisplay: `HOST=127.0.0.1 PORT=${port} node ${jsEntry}`,
            reason: `Node.js-Einstiegspunkt ${jsEntry} erkannt.`,
            needsNpmInstall,
          };
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  const pyBin = process.platform === 'win32' ? 'python' : 'python3';
  const pyEntries = ['main.py', 'app.py', 'server.py', 'run.py', 'api.py'];
  for (const entry of pyEntries) {
    if (fs.existsSync(path.join(localDir, entry))) {
      return {
        runtime: 'python',
        bin: pyBin,
        args: [entry],
        commandDisplay: `HOST=127.0.0.1 PORT=${port} ${pyBin} ${entry}`,
        reason: `Python-Einstiegspunkt ${entry} erkannt.`,
      };
    }
  }

  // Subdirectory Python entrypoints (verified e.g. WebAI-to-API: src/run.py, CatGPT-Gateway: src/api/server.py)
  if (fs.existsSync(path.join(localDir, 'src', 'run.py'))) {
    return {
      runtime: 'python',
      bin: pyBin,
      args: ['src/run.py', '--host', '127.0.0.1', '--port', String(port)],
      commandDisplay: `${pyBin} src/run.py --host 127.0.0.1 --port ${port}`,
      reason: 'Python-Einstiegspunkt src/run.py erkannt (WebAI-to-API Layout).',
      extraEnv: { PYTHONPATH: path.join(localDir, 'src'), PYTHONUNBUFFERED: '1' },
    };
  }
  if (fs.existsSync(path.join(localDir, 'src', 'api', 'server.py'))) {
    return {
      runtime: 'python',
      bin: pyBin,
      args: ['-m', 'src.api.server'],
      commandDisplay: `HOST=127.0.0.1 PORT=${port} ${pyBin} -m src.api.server`,
      reason: 'Python-Modul src.api.server erkannt (CatGPT-Gateway Layout).',
      extraEnv: { USE_XVFB: 'false', PYTHONUNBUFFERED: '1' },
    };
  }
  if (fs.existsSync(path.join(localDir, 'src', 'main.py'))) {
    return {
      runtime: 'python',
      bin: pyBin,
      args: ['src/main.py'],
      commandDisplay: `HOST=127.0.0.1 PORT=${port} ${pyBin} src/main.py`,
      reason: 'Python-Einstiegspunkt src/main.py erkannt.',
      extraEnv: { PYTHONPATH: path.join(localDir, 'src'), PYTHONUNBUFFERED: '1' },
    };
  }

  if (fs.existsSync(path.join(localDir, 'go.mod'))) {
    // Check whether root has .go files; otherwise resolve ./cmd/<subpkg> (e.g. openai-api-server-via-codex)
    let hasRootGo = false;
    try {
      hasRootGo = fs.readdirSync(localDir).some((f) => f.endsWith('.go'));
    } catch {
      // ignore
    }
    let goTarget = '.';
    if (!hasRootGo) {
      const cmdDir = path.join(localDir, 'cmd');
      if (fs.existsSync(cmdDir)) {
        try {
          const subdirs = fs
            .readdirSync(cmdDir, { withFileTypes: true })
            .filter((d) => d.isDirectory());
          for (const sub of subdirs) {
            const subPath = path.join(cmdDir, sub.name);
            if (fs.readdirSync(subPath).some((f) => f.endsWith('.go'))) {
              goTarget = `./cmd/${sub.name}`;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return {
      runtime: 'go',
      bin: 'go',
      args: ['run', goTarget],
      commandDisplay: `SERVER_HOST=127.0.0.1 SERVER_PORT=${port} PORT=${port} go run ${goTarget}`,
      reason:
        goTarget === '.'
          ? 'Go-Modul (go.mod mit Root-Go-Dateien) erkannt.'
          : `Go-Modul (go.mod) mit Einstiegspunkt ${goTarget} erkannt.`,
    };
  }

  if (fs.existsSync(path.join(localDir, 'Dockerfile'))) {
    return {
      runtime: 'docker_only',
      bin: null,
      args: [],
      commandDisplay: 'docker compose --profile tos-risk up -d --build',
      reason: 'Nur Dockerfile erkannt — benötigt laufenden Docker-Daemon.',
    };
  }

  return {
    runtime: 'unknown',
    bin: null,
    args: [],
    commandDisplay: '',
    reason: 'Kein eindeutiger Standard-Startpunkt (package.json / main.py / go.mod / Dockerfile) im Top-Level gefunden.',
  };
}

/**
 * Generates copyable, Windows-11 PowerShell-safe manual commands for an allowlisted bridge.
 */
export function buildBridgeManualCommands(selection: BridgeSelectionEntry): {
  powershellStart: string;
  powershellTest: string;
  curlTest: string;
} {
  const id = selection.bridge_id || 'bridge';
  const port = selection.port || 8100;
  const service = selection.docker_service || `bridge-${id}`;
  const repoUrl = selection.bridge_url || '';

  const powershellStart = [
    `# 1) Repository klonen (falls noch nicht lokal unter .\\bridges\\${id})`,
    `git clone --depth 1 "${repoUrl}" ".\\bridges\\${id}"`,
    `# 2) Start via Docker Compose (strikt 127.0.0.1:${port}, Opt-in-Profil tos-risk):`,
    `docker compose --profile tos-risk up -d --build ${service}`,
  ].join('\n');

  const powershellTest = [
    `# Windows PowerShell: Lokale Bridge auf 127.0.0.1:${port} pruefen`,
    `Invoke-RestMethod -Uri "http://127.0.0.1:${port}/v1/models" -Method Get`,
  ].join('\n');

  const curlTest = [
    `# Windows PowerShell / CMD (echtes curl.exe — nicht den PS-Alias "curl" nutzen):`,
    `curl.exe -sS "http://127.0.0.1:${port}/v1/models"`,
  ].join('\n');

  return { powershellStart, powershellTest, curlTest };
}

async function checkPlanBinaryAvailable(plan: LocalBridgeStartPlan): Promise<boolean> {
  if (!plan.bin) return false;
  // Running Node executable itself is guaranteed available
  if (plan.bin === process.execPath) return true;
  if (plan.runtime === 'node' && /cmd(\.exe)?$/i.test(path.basename(plan.bin))) {
    try {
      await execFileAsync(plan.bin, ['/d', '/s', '/c', 'npm', '--version'], { timeout: 4000 });
      return true;
    } catch {
      return false;
    }
  }
  const versionArgs = plan.runtime === 'go' ? ['version'] : ['--version'];
  try {
    await execFileAsync(plan.bin, versionArgs, { timeout: 3500 });
    return true;
  } catch {
    return false;
  }
}

async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 3500 });
    return true;
  } catch {
    return false;
  }
}

export async function probeLoopbackPort(port: number): Promise<{
  ok: boolean;
  statusText: string;
  latencyMs: number;
  url: string;
  bodyPreview?: string;
}> {
  const candidates = [
    `http://127.0.0.1:${port}/v1/models`,
    `http://127.0.0.1:${port}/health`,
    `http://127.0.0.1:${port}/`,
  ];
  const t0 = Date.now();
  let lastErr = 'Verbindung auf 127.0.0.1:' + port + ' abgelehnt (Dienst laeuft nicht).';

  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        signal: ctrl.signal,
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      const text = (await resp.text()).slice(0, 1000);
      const latencyMs = Date.now() - t0;
      if (resp.status < 500) {
        return {
          ok: true,
          statusText: `HTTP ${resp.status} (${new URL(url).pathname})`,
          latencyMs,
          url,
          bodyPreview: text,
        };
      }
      lastErr = `HTTP ${resp.status} auf ${url}`;
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err.message.slice(0, 140) : 'Verbindungsfehler';
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    statusText: lastErr,
    latencyMs: Date.now() - t0,
    url: candidates[0],
  };
}

/**
 * Manages explicit, user-triggered execution of allowlisted bridges ONLY (Hard Rules 1, 3, 4, 5).
 * Never auto-starts any bridge on boot; strictly binds loopback 127.0.0.1:<port>.
 * Never falsely reports `running` unless `127.0.0.1:<port>` actually responds to a live probe.
 */
export class BridgeProcessManager {
  private states = new Map<string, BridgeRuntimeState>();
  private children = new Map<string, ChildProcess>();

  initFromSelections(selections: BridgeSelectionEntry[]): void {
    const nextIds = new Set<string>();
    for (const s of selections) {
      if (!s.docker_capable || !s.bridge_id || !s.port) continue;
      nextIds.add(s.bridge_id);
      if (!this.states.has(s.bridge_id)) {
        this.states.set(s.bridge_id, {
          bridgeId: s.bridge_id,
          zielprovider: s.zielprovider,
          port: s.port,
          dockerService: s.docker_service,
          status: 'stopped',
          mode: 'none',
          pid: null,
          startedAt: null,
          lastProbeOk: null,
          lastProbeStatus: null,
          lastProbeLatencyMs: null,
          detectedCommand: null,
          error: null,
          logs: [],
        });
      }
    }
    for (const existingId of Array.from(this.states.keys())) {
      if (!nextIds.has(existingId)) {
        this.states.delete(existingId);
      }
    }
  }

  getAllStates(): BridgeRuntimeState[] {
    return Array.from(this.states.values());
  }

  getState(bridgeId: string): BridgeRuntimeState | undefined {
    return this.states.get(bridgeId);
  }

  private appendLog(bridgeId: string, line: string): void {
    const st = this.states.get(bridgeId);
    if (!st) return;
    const stamp = new Date().toISOString().slice(11, 19);
    const cleaned = line.replace(/\r/g, '').trimEnd();
    if (!cleaned) return;
    for (const part of cleaned.split('\n')) {
      if (!part.trim()) continue;
      st.logs.push(`[${stamp}] ${part.slice(0, 400)}`);
    }
    if (st.logs.length > MAX_LOG_LINES) {
      st.logs = st.logs.slice(-MAX_LOG_LINES);
    }
  }

  private async runNpmInstall(bridgeId: string, localDir: string): Promise<{ ok: boolean; error?: string }> {
    const inv = resolveNpmInvocation(['install', '--no-audit', '--no-fund']);
    this.appendLog(bridgeId, `node_modules fehlt — installiere Abhaengigkeiten (${inv.display}) ...`);

    return new Promise((resolve) => {
      let finished = false;
      const done = (result: { ok: boolean; error?: string }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result);
      };

      const installer = spawn(inv.bin, inv.args, {
        cwd: localDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        try {
          installer.kill('SIGTERM');
        } catch {
          // ignore
        }
        done({ ok: false, error: 'npm install Zeitueberschreitung nach 90 Sekunden.' });
      }, 90000);

      installer.stdout?.on('data', (chunk: Buffer) => this.appendLog(bridgeId, chunk.toString('utf8')));
      installer.stderr?.on('data', (chunk: Buffer) => this.appendLog(bridgeId, chunk.toString('utf8')));
      installer.on('error', (err) => {
        done({ ok: false, error: `npm install Prozessfehler: ${err.message}` });
      });
      installer.on('exit', (code) => {
        if (code === 0) {
          this.appendLog(bridgeId, 'npm install erfolgreich abgeschlossen.');
          done({ ok: true });
        } else {
          done({ ok: false, error: `npm install fehlgeschlagen (Exit-Code ${code ?? 'null'}).` });
        }
      });
    });
  }

  async executeBridge(
    selection: BridgeSelectionEntry,
    repo: AllowlistedBridgeRepo,
    bridgesRootDir: string,
    composeDir: string,
    onRepoUpdated?: (status: BridgeRepoStatus) => void
  ): Promise<BridgeRuntimeState> {
    const bridgeId = repo.bridgeId;
    const port = selection.port;
    if (!selection.docker_capable || !port || !selection.docker_service) {
      throw new Error(
        `Bridge "${bridgeId}" ist nicht fuer lokale Ausfuehrung freigegeben (Allowlist / Regel 1 & 3).`
      );
    }

    // Ensure state record exists
    if (!this.states.has(bridgeId)) {
      this.initFromSelections([selection]);
    }
    const st = this.states.get(bridgeId)!;

    // If a child process already exists, probe honestly before deciding whether to keep or restart
    if (this.children.has(bridgeId)) {
      const probe = await probeLoopbackPort(port);
      st.lastProbeOk = probe.ok;
      st.lastProbeStatus = probe.statusText;
      st.lastProbeLatencyMs = probe.latencyMs;
      if (probe.ok) {
        st.status = 'running';
        st.error = null;
        return st;
      }
      // Clean up stale non-responsive child before fresh restart
      await this.stopBridge(bridgeId, composeDir);
    }

    // Reset previous error & logs for fresh run
    st.error = null;
    st.logs = [];
    st.lastProbeOk = null;
    st.lastProbeStatus = null;
    st.lastProbeLatencyMs = null;

    // Step 1: Ensure repository is cloned locally
    const localDir = path.resolve(bridgesRootDir, bridgeId);
    if (!fs.existsSync(path.join(localDir, '.git'))) {
      st.status = 'cloning';
      this.appendLog(bridgeId, `Klone Allowlist-Repository ${repo.repoUrl} nach ./bridges/${bridgeId} ...`);
      const repoStatus = await cloneOrUpdateBridgeRepo(repo, bridgesRootDir);
      onRepoUpdated?.(repoStatus);
      if (!repoStatus.cloned) {
        st.status = 'error';
        st.error = repoStatus.error || 'Repository konnte nicht geklont werden.';
        this.appendLog(bridgeId, `FEHLER beim Klonen: ${st.error}`);
        return st;
      }
      this.appendLog(
        bridgeId,
        `Geklont: Commit ${repoStatus.commitHash ?? '?'} (${repoStatus.commitDate ?? '?'}, ${repoStatus.fileCount} Dateien).`
      );
    } else {
      this.appendLog(bridgeId, `Lokales Repository ./bridges/${bridgeId} bereits vorhanden.`);
    }

    // Step 2: Check if port is already serving externally on 127.0.0.1:<port>
    const preProbe = await probeLoopbackPort(port);
    if (preProbe.ok) {
      st.status = 'running';
      st.mode = 'native';
      st.startedAt = new Date().toISOString();
      st.lastProbeOk = true;
      st.lastProbeStatus = preProbe.statusText;
      st.lastProbeLatencyMs = preProbe.latencyMs;
      this.appendLog(
        bridgeId,
        `Dienst antwortet bereits auf 127.0.0.1:${port} (${preProbe.statusText}, ${preProbe.latencyMs}ms).`
      );
      return st;
    }

    st.status = 'starting';

    // Step 3: Prefer Docker Compose if Docker daemon AND docker-compose.yml exist
    const composeFile = path.join(composeDir, 'docker-compose.yml');
    const hasDocker = fs.existsSync(composeFile) && (await checkDockerAvailable());
    if (hasDocker) {
      st.mode = 'docker';
      st.detectedCommand = `docker compose --profile tos-risk up -d --build ${selection.docker_service}`;
      this.appendLog(bridgeId, `Starte via Docker Compose: ${st.detectedCommand}`);
      try {
        const { stdout, stderr } = await execFileAsync(
          'docker',
          ['compose', '--profile', 'tos-risk', 'up', '-d', '--build', selection.docker_service],
          { cwd: composeDir, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }
        );
        if (stdout) this.appendLog(bridgeId, stdout);
        if (stderr) this.appendLog(bridgeId, stderr);
        st.startedAt = new Date().toISOString();
        const probe = await probeLoopbackPort(port);
        st.lastProbeOk = probe.ok;
        st.lastProbeStatus = probe.statusText;
        st.lastProbeLatencyMs = probe.latencyMs;
        if (probe.ok) {
          st.status = 'running';
          st.error = null;
          this.appendLog(bridgeId, `Loopback-Check OK: ${probe.url} -> ${probe.statusText} (${probe.latencyMs}ms)`);
        } else {
          st.status = 'error';
          st.error = `Container gestartet, aber 127.0.0.1:${port} antwortet nicht (${probe.statusText}). Ggf. Erstlogin/Env pruefen und "Loopback pruefen" klicken.`;
          this.appendLog(bridgeId, st.error);
        }
        return st;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message.slice(0, 260) : 'Docker-Start fehlgeschlagen.';
        this.appendLog(bridgeId, `Docker-Start fehlgeschlagen: ${msg}`);
        // Fall through to native runtime check
      }
    } else {
      this.appendLog(
        bridgeId,
        'Docker-Daemon nicht verfuegbar (oder keine docker-compose.yml im Workspace) — pruefe lokalen Direktstart ohne Docker.'
      );
    }

    // Step 4: Native local runtime fallback (strictly 127.0.0.1:<port>)
    const plan = detectLocalBridgeStartPlan(localDir, port);
    st.detectedCommand = plan.commandDisplay || null;
    this.appendLog(bridgeId, `Repo-Analyse: ${plan.reason}`);

    if (!plan.bin) {
      st.status = 'error';
      st.mode = 'none';
      st.error = `${plan.reason} Docker-Daemon laeuft nicht — bitte Docker Desktop starten oder Anleitung/Kommandos unten nutzen.`;
      this.appendLog(bridgeId, `ABBRUCH: ${st.error}`);
      return st;
    }

    const binOk = await checkPlanBinaryAvailable(plan);
    if (!binOk) {
      st.status = 'error';
      st.mode = 'none';
      st.error = `Benoetigte lokale Runtime "${plan.bin}" nicht gefunden und Docker-Daemon nicht aktiv. Bitte ${plan.runtime.toUpperCase()} oder Docker Desktop installieren.`;
      this.appendLog(bridgeId, `FEHLER: ${st.error}`);
      return st;
    }

    if (plan.runtime === 'node' && plan.needsNpmInstall) {
      const installRes = await this.runNpmInstall(bridgeId, localDir);
      if (!installRes.ok) {
        st.status = 'error';
        st.mode = 'none';
        st.error = `${installRes.error || 'npm install fehlgeschlagen.'} Details siehe Live-Logs.`;
        this.appendLog(bridgeId, `FEHLER: ${st.error}`);
        return st;
      }
    }

    this.appendLog(bridgeId, `Starte lokalen Prozess (strikt 127.0.0.1:${port}): ${plan.commandDisplay}`);

    let childExited = false;
    let exitCode: number | null = null;

    const child = spawn(plan.bin, plan.args, {
      cwd: localDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        SERVER_HOST: '127.0.0.1',
        OPENAI_VIA_CODEX_HOST: '127.0.0.1',
        BIND_ADDRESS: '127.0.0.1',
        PORT: String(port),
        SERVER_PORT: String(port),
        API_PORT: String(port),
        OPENAI_VIA_CODEX_PORT: String(port),
        LISTEN_ADDR: `127.0.0.1:${port}`,
        SKIP_ACCOUNT_MENU: '1',
        NON_INTERACTIVE: '1',
        ...(plan.extraEnv || {}),
      },
    });

    this.children.set(bridgeId, child);
    st.mode = 'native';
    st.pid = child.pid ?? null;
    st.startedAt = new Date().toISOString();
    st.status = 'starting';

    child.stdout?.on('data', (chunk: Buffer) => {
      this.appendLog(bridgeId, chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendLog(bridgeId, chunk.toString('utf8'));
    });
    child.on('error', (err) => {
      childExited = true;
      this.children.delete(bridgeId);
      st.pid = null;
      st.status = 'error';
      st.error = `Prozessfehler: ${err.message}`;
      this.appendLog(bridgeId, st.error);
    });
    child.on('exit', (code, signal) => {
      childExited = true;
      exitCode = code;
      this.children.delete(bridgeId);
      st.pid = null;
      if (st.status !== 'stopped') {
        st.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) {
          st.error = `Prozess beendet (Exit-Code ${code ?? 'null'}, Signal ${signal ?? 'none'}). Moegliche Ursache: fehlende Abhaengigkeiten (pip/go/npm) oder benoetigte Auth-Cookies/Env-Variablen — siehe Live-Logs.`;
        }
      }
      this.appendLog(
        bridgeId,
        `Prozess beendet (Code: ${code ?? 'null'}, Signal: ${signal ?? 'none'}).`
      );
    });

    // Honest startup readiness polling: Go (`go run`) needs up to ~24s on first Windows compile, Node/Python ~10.5s
    const maxAttempts = plan.runtime === 'go' ? 32 : 14;
    const waitSeconds = Math.round((maxAttempts * 750) / 1000);
    let latestProbe: Awaited<ReturnType<typeof probeLoopbackPort>> | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 750));
      if (childExited || (st.status as BridgeRuntimeState['status']) === 'stopped') break;
      const probe = await probeLoopbackPort(port);
      latestProbe = probe;
      st.lastProbeOk = probe.ok;
      st.lastProbeStatus = probe.statusText;
      st.lastProbeLatencyMs = probe.latencyMs;
      if (probe.ok) {
        st.status = 'running';
        st.error = null;
        this.appendLog(
          bridgeId,
          `Loopback-Check OK: ${probe.url} -> ${probe.statusText} (${probe.latencyMs}ms)`
        );
        return st;
      }
    }

    if (childExited) {
      st.status = 'error';
      const joinedLogs = st.logs.join('\n');
      if (/deepseek-auth\.json/i.test(joinedLogs)) {
        st.error = `DeepSeek-Erstlogin erforderlich (deepseek-auth.json fehlt). Einmalig in PowerShell ausfuehren: cd bridges\\${bridgeId} ; npm run auth`;
      } else if (/auth_file_not_found|\.codex[/\\]auth\.json/i.test(joinedLogs)) {
        st.error =
          'Codex-Erstlogin erforderlich (~/.codex/auth.json fehlt). Einmalig im Terminal `codex login` ausfuehren und Bridge neu starten.';
      } else if (/ModuleNotFoundError|No module named/i.test(joinedLogs)) {
        st.error = `Python-Abhaengigkeiten fehlen. In PowerShell ausfuehren: cd bridges\\${bridgeId} ; pip install -r requirements.txt`;
      } else if (!st.error) {
        st.error = `Prozess hat sich vor Port-Oeffnung auf 127.0.0.1:${port} beendet (Exit-Code ${exitCode ?? 'null'}). Siehe Live-Logs.`;
      }
      return st;
    }

    // Child process is still alive, but port 127.0.0.1:<port> never opened -> NEVER claim LÄUFT!
    st.status = 'error';
    const probeDetail = latestProbe?.statusText || 'Verbindung abgelehnt';
    st.error = `Prozess laeuft (PID ${st.pid ?? '?'}), aber 127.0.0.1:${port} antwortet nach ${waitSeconds} s nicht (${probeDetail}). Falls Go/Python noch kompiliert oder startet, kurz warten und "Loopback pruefen" klicken.`;
    this.appendLog(bridgeId, `WARNUNG: ${st.error}`);

    return st;
  }

  async stopBridge(bridgeId: string, composeDir: string): Promise<BridgeRuntimeState | null> {
    const st = this.states.get(bridgeId);
    if (!st) return null;

    const child = this.children.get(bridgeId);
    st.status = 'stopped';
    st.error = null;

    if (child) {
      this.appendLog(bridgeId, `Stoppe lokalen Prozess (PID ${child.pid ?? '?'}) ...`);
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            if (!child.killed) child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 2000);
      } catch {
        // ignore
      }
      this.children.delete(bridgeId);
      st.pid = null;
    }

    if (st.mode === 'docker' && st.dockerService) {
      this.appendLog(bridgeId, `Stoppe Docker-Service ${st.dockerService} ...`);
      try {
        await execFileAsync(
          'docker',
          ['compose', '--profile', 'tos-risk', 'stop', st.dockerService],
          { cwd: composeDir, timeout: 15000 }
        );
      } catch {
        // ignore if docker not running
      }
    }

    st.mode = 'none';
    st.lastProbeOk = null;
    st.lastProbeStatus = null;
    st.lastProbeLatencyMs = null;
    this.appendLog(bridgeId, 'Bridge gestoppt.');
    return st;
  }

  async probeBridge(bridgeId: string): Promise<{
    runtime: BridgeRuntimeState | null;
    probe: Awaited<ReturnType<typeof probeLoopbackPort>> | null;
  }> {
    const st = this.states.get(bridgeId);
    if (!st || !st.port) return { runtime: null, probe: null };
    const probe = await probeLoopbackPort(st.port);
    st.lastProbeOk = probe.ok;
    st.lastProbeStatus = probe.statusText;
    st.lastProbeLatencyMs = probe.latencyMs;

    if (probe.ok) {
      st.status = 'running';
      st.error = null;
      if (st.mode === 'none') st.mode = 'native';
    } else if (st.status === 'running' || st.status === 'starting') {
      // Honest downgrade: never display LÄUFT when 127.0.0.1:<port> fails probe
      const hasAliveChild = this.children.has(bridgeId);
      st.status = hasAliveChild ? 'error' : 'stopped';
      st.error = `Port 127.0.0.1:${st.port} ist nicht erreichbar (${probe.statusText}).`;
    }

    this.appendLog(
      bridgeId,
      probe.ok
        ? `Loopback-Probe OK: ${probe.url} -> ${probe.statusText} (${probe.latencyMs}ms)`
        : `Loopback-Probe fehlgeschlagen: ${probe.statusText}`
    );
    return { runtime: st, probe };
  }

  stopAll(): void {
    for (const [, child] of this.children) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    this.children.clear();
  }
}
