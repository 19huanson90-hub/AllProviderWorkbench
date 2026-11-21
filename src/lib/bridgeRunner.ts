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
      };
      if (pkg.scripts?.start) {
        const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        return {
          runtime: 'node',
          bin: npmBin,
          args: ['start'],
          commandDisplay: `HOST=127.0.0.1 PORT=${port} npm start`,
          reason: `package.json mit start-Skript erkannt (${pkg.scripts.start}).`,
        };
      }
      if (pkg.main && fs.existsSync(path.join(localDir, pkg.main))) {
        return {
          runtime: 'node',
          bin: process.execPath,
          args: [pkg.main],
          commandDisplay: `HOST=127.0.0.1 PORT=${port} node ${pkg.main}`,
          reason: `package.json Einstiegspunkt ${pkg.main} erkannt.`,
        };
      }
    } catch {
      // ignore malformed package.json
    }
  }

  const pyEntries = ['main.py', 'app.py', 'server.py', 'run.py'];
  for (const entry of pyEntries) {
    if (fs.existsSync(path.join(localDir, entry))) {
      const pyBin = process.platform === 'win32' ? 'python' : 'python3';
      return {
        runtime: 'python',
        bin: pyBin,
        args: [entry],
        commandDisplay: `HOST=127.0.0.1 PORT=${port} ${pyBin} ${entry}`,
        reason: `Python-Einstiegspunkt ${entry} erkannt.`,
      };
    }
  }

  if (fs.existsSync(path.join(localDir, 'go.mod'))) {
    return {
      runtime: 'go',
      bin: 'go',
      args: ['run', '.'],
      commandDisplay: `HOST=127.0.0.1 PORT=${port} go run .`,
      reason: 'Go-Modul (go.mod) erkannt.',
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

async function checkBinaryAvailable(bin: string, versionArgs: string[] = ['--version']): Promise<boolean> {
  try {
    await execFileAsync(bin, versionArgs, { timeout: 3500 });
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

    // If already running, probe and return current status
    if (st.status === 'running' && this.children.has(bridgeId)) {
      const probe = await probeLoopbackPort(port);
      st.lastProbeOk = probe.ok;
      st.lastProbeStatus = probe.statusText;
      st.lastProbeLatencyMs = probe.latencyMs;
      return st;
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
        st.status = 'running';
        st.startedAt = new Date().toISOString();
        const probe = await probeLoopbackPort(port);
        st.lastProbeOk = probe.ok;
        st.lastProbeStatus = probe.statusText;
        st.lastProbeLatencyMs = probe.latencyMs;
        this.appendLog(
          bridgeId,
          probe.ok
            ? `Loopback-Check OK: ${probe.url} -> ${probe.statusText} (${probe.latencyMs}ms)`
            : `Container gestartet; Loopback-Check noch ausstehend (${probe.statusText}) — bitte ggf. Auth/Erstlogin laut Anleitung abschliessen.`
        );
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

    const versionArgs = plan.runtime === 'go' ? ['version'] : ['--version'];
    const binOk = await checkBinaryAvailable(plan.bin, versionArgs);
    if (!binOk) {
      st.status = 'error';
      st.mode = 'none';
      st.error = `Benoetigte lokale Runtime "${plan.bin}" nicht gefunden und Docker-Daemon nicht aktiv. Bitte ${plan.runtime.toUpperCase()} oder Docker Desktop installieren.`;
      this.appendLog(bridgeId, `FEHLER: ${st.error}`);
      return st;
    }

    this.appendLog(bridgeId, `Starte lokalen Prozess (strikt 127.0.0.1:${port}): ${plan.commandDisplay}`);

    // Note: spawn without shell:true (command injection safe)
    const child = spawn(plan.bin, plan.args, {
      cwd: localDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        BIND_ADDRESS: '127.0.0.1',
        PORT: String(port),
        LISTEN_ADDR: `127.0.0.1:${port}`,
      },
    });

    this.children.set(bridgeId, child);
    st.mode = 'native';
    st.pid = child.pid ?? null;
    st.startedAt = new Date().toISOString();
    st.status = 'running';

    child.stdout?.on('data', (chunk: Buffer) => {
      this.appendLog(bridgeId, chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendLog(bridgeId, chunk.toString('utf8'));
    });
    child.on('error', (err) => {
      this.children.delete(bridgeId);
      st.pid = null;
      st.status = 'error';
      st.error = `Prozessfehler: ${err.message}`;
      this.appendLog(bridgeId, st.error);
    });
    child.on('exit', (code, signal) => {
      this.children.delete(bridgeId);
      st.pid = null;
      if (st.status !== 'stopped') {
        st.status = code === 0 ? 'stopped' : 'error';
        if (code !== 0) {
          st.error = `Prozess beendet (Exit-Code ${code ?? 'null'}, Signal ${signal ?? 'none'}). Evtl. fehlen lokale Abhaengigkeiten (npm install / pip install) oder Auth-Cookies.`;
        }
      }
      this.appendLog(
        bridgeId,
        `Prozess beendet (Code: ${code ?? 'null'}, Signal: ${signal ?? 'none'}).`
      );
    });

    // Wait briefly (1.8s) to detect immediate startup crashes or verify loopback readiness
    await new Promise((r) => setTimeout(r, 1800));
    if (st.status === 'running') {
      const probe = await probeLoopbackPort(port);
      st.lastProbeOk = probe.ok;
      st.lastProbeStatus = probe.statusText;
      st.lastProbeLatencyMs = probe.latencyMs;
      if (probe.ok) {
        this.appendLog(bridgeId, `Loopback-Check OK: ${probe.url} -> ${probe.statusText} (${probe.latencyMs}ms)`);
      } else {
        this.appendLog(bridgeId, `Prozess laeuft (PID ${st.pid}), Port 127.0.0.1:${port} antwortet noch nicht (${probe.statusText}).`);
      }
    }

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
    if (probe.ok && st.status === 'stopped') {
      st.status = 'running';
      st.mode = 'native';
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
