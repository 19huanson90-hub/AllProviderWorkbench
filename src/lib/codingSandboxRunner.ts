import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSafeWorkspacePath } from './codingWorkspace.ts';

export type SandboxRunnerPresetId =
  | 'node_run'
  | 'node_test'
  | 'tsx_run'
  | 'tsx_test'
  | 'tsc_check'
  | 'python_run'
  | 'python_syntax';

export interface SandboxRunnerPresetMeta {
  id: SandboxRunnerPresetId;
  label: string;
  description: string;
  extensions: readonly string[];
  commandPreviewPrefix: string;
}

export const SANDBOX_RUNNER_PRESETS: readonly SandboxRunnerPresetMeta[] = [
  {
    id: 'node_run',
    label: 'Node.js ausführen',
    description: 'Führt eine JS/MJS/CJS-Datei isoliert in coding-workspace/ aus.',
    extensions: ['.js', '.mjs', '.cjs'],
    commandPreviewPrefix: 'node',
  },
  {
    id: 'node_test',
    label: 'Node Unit-Tests',
    description: 'Führt node --test auf einer JS/MJS-Testdatei in coding-workspace/ aus.',
    extensions: ['.js', '.mjs', '.cjs'],
    commandPreviewPrefix: 'node --test',
  },
  {
    id: 'tsx_run',
    label: 'TypeScript ausführen (tsx)',
    description: 'Führt eine TS-Datei in coding-workspace/ über lokales tsx aus.',
    extensions: ['.ts', '.mts'],
    commandPreviewPrefix: 'tsx',
  },
  {
    id: 'tsx_test',
    label: 'TypeScript Unit-Tests (tsx)',
    description: 'Führt tsx --test auf einer TS-Testdatei in coding-workspace/ aus.',
    extensions: ['.ts', '.mts'],
    commandPreviewPrefix: 'tsx --test',
  },
  {
    id: 'tsc_check',
    label: 'TypeScript Typprüfung (tsc)',
    description: 'Prüft Typen ohne Output (--noEmit) für eine TS/TSX-Datei in coding-workspace/.',
    extensions: ['.ts', '.tsx'],
    commandPreviewPrefix: 'tsc --noEmit',
  },
  {
    id: 'python_run',
    label: 'Python ausführen (-I isoliert)',
    description: 'Führt ein Python-Skript in coding-workspace/ im isolierten Modus (-I) aus.',
    extensions: ['.py'],
    commandPreviewPrefix: 'python3 -I',
  },
  {
    id: 'python_syntax',
    label: 'Python Syntax-Check',
    description: 'Kompiliert/prüft Python-Syntax ohne Ausführung (py_compile).',
    extensions: ['.py'],
    commandPreviewPrefix: 'python3 -I -m py_compile',
  },
];

export interface SafeSandboxCommandSpec {
  ok: true;
  bin: string;
  args: string[];
  cwd: string;
  displayCommand: string;
  resolvedRelPath: string;
}

export interface SandboxExecutionResult {
  ok: boolean;
  presetId: SandboxRunnerPresetId;
  targetFile: string;
  displayCommand: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncatedOutput: boolean;
  error?: string;
}

const MAX_SANDBOX_OUTPUT_BYTES = 32 * 1024; // 32 KB per stream
const DEFAULT_SANDBOX_TIMEOUT_MS = 12_000;

/**
 * Strips ALL server secrets/API keys from child process environment.
 * Passes strictly an allowlisted minimal runtime environment.
 */
export function buildSanitizedChildEnv(sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    NO_COLOR: '1',
    CI: 'true',
  };
  const allowKeys = ['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'SYSTEMROOT', 'COMSPEC', 'LANG', 'LC_ALL'];
  for (const key of allowKeys) {
    const val = sourceEnv[key];
    if (typeof val === 'string' && val.length > 0) {
      safe[key] = val;
    }
  }
  return safe;
}

function resolveLocalNodeToolScript(rootDir: string, pkgSubpath: string): string | null {
  const candidate = path.resolve(rootDir, 'node_modules', pkgSubpath);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  return null;
}

/**
 * Validates preset + targetFile strictly within `<rootDir>/coding-workspace/` and produces
 * an argv-only command spec (`shell: false` always).
 */
export function buildSafeSandboxCommand(params: {
  rootDir: string;
  presetId: SandboxRunnerPresetId;
  targetFile: string;
}): SafeSandboxCommandSpec | { ok: false; error: string } {
  const preset = SANDBOX_RUNNER_PRESETS.find((p) => p.id === params.presetId);
  if (!preset) {
    return { ok: false, error: `Unbekanntes Sandbox-Preset "${String(params.presetId)}".` };
  }

  const sandboxRoot = path.resolve(params.rootDir, 'coding-workspace');
  fs.mkdirSync(sandboxRoot, { recursive: true });

  const rawTarget = (params.targetFile || '').trim().replace(/\\/g, '/');
  if (!rawTarget) {
    return { ok: false, error: 'Bitte zuerst eine Zieldatei aus coding-workspace/ wählen.' };
  }
  if (!rawTarget.startsWith('coding-workspace/') && rawTarget.includes('/..')) {
    return { ok: false, error: 'Pfad-Traversal ist nicht zulässig.' };
  }
  // Explicitly reject files outside coding-workspace/ (e.g. server.ts, src/App.tsx)
  if (
    !rawTarget.startsWith('coding-workspace/') &&
    fs.existsSync(path.resolve(params.rootDir, rawTarget)) &&
    !fs.existsSync(path.resolve(sandboxRoot, rawTarget))
  ) {
    return {
      ok: false,
      error: 'Ausführung ist aus Sicherheitsgründen strikt auf Dateien in coding-workspace/ beschränkt.',
    };
  }

  const stripped = rawTarget.replace(/^coding-workspace\/+/, '');
  const resolved = resolveSafeWorkspacePath(sandboxRoot, stripped, { mustExist: true });
  if (!resolved.ok) {
    return {
      ok: false,
      error: `Zieldatei in coding-workspace/ nicht zulässig oder nicht gefunden: ${resolved.error}`,
    };
  }

  const ext = path.extname(resolved.relPath).toLowerCase();
  if (!preset.extensions.includes(ext)) {
    return {
      ok: false,
      error: `Preset "${preset.label}" unterstützt nur ${preset.extensions.join(', ')} (erhalten: "${ext || 'keine Endung'}").`,
    };
  }

  const nodeBin = process.execPath;
  const relInSandbox = resolved.relPath;
  const displayPath = `coding-workspace/${relInSandbox}`;

  if (preset.id === 'node_run') {
    return {
      ok: true,
      bin: nodeBin,
      args: [relInSandbox],
      cwd: sandboxRoot,
      displayCommand: `node ${displayPath}`,
      resolvedRelPath: displayPath,
    };
  }

  if (preset.id === 'node_test') {
    return {
      ok: true,
      bin: nodeBin,
      args: ['--test', relInSandbox],
      cwd: sandboxRoot,
      displayCommand: `node --test ${displayPath}`,
      resolvedRelPath: displayPath,
    };
  }

  if (preset.id === 'tsx_run' || preset.id === 'tsx_test') {
    const tsxCli = resolveLocalNodeToolScript(params.rootDir, 'tsx/dist/cli.mjs');
    if (!tsxCli) {
      return { ok: false, error: 'Lokales tsx-Paket in node_modules nicht gefunden.' };
    }
    const extraArgs = preset.id === 'tsx_test' ? ['--test', relInSandbox] : [relInSandbox];
    return {
      ok: true,
      bin: nodeBin,
      args: [tsxCli, ...extraArgs],
      cwd: sandboxRoot,
      displayCommand: `${preset.commandPreviewPrefix} ${displayPath}`,
      resolvedRelPath: displayPath,
    };
  }

  if (preset.id === 'tsc_check') {
    const tscCli = resolveLocalNodeToolScript(params.rootDir, 'typescript/bin/tsc');
    if (!tscCli) {
      return { ok: false, error: 'Lokaler TypeScript-Compiler (tsc) nicht gefunden.' };
    }
    return {
      ok: true,
      bin: nodeBin,
      args: [tscCli, '--noEmit', '--target', 'ES2022', '--moduleResolution', 'bundler', '--skipLibCheck', relInSandbox],
      cwd: sandboxRoot,
      displayCommand: `tsc --noEmit ${displayPath}`,
      resolvedRelPath: displayPath,
    };
  }

  if (preset.id === 'python_run') {
    return {
      ok: true,
      bin: process.platform === 'win32' ? 'python' : 'python3',
      args: ['-I', relInSandbox],
      cwd: sandboxRoot,
      displayCommand: `python3 -I ${displayPath}`,
      resolvedRelPath: displayPath,
    };
  }

  // python_syntax
  return {
    ok: true,
    bin: process.platform === 'win32' ? 'python' : 'python3',
    args: ['-I', '-m', 'py_compile', relInSandbox],
    cwd: sandboxRoot,
    displayCommand: `python3 -I -m py_compile ${displayPath}`,
    resolvedRelPath: displayPath,
  };
}

/**
 * Executes an allowlisted command inside `<rootDir>/coding-workspace/` with:
 * - explicit human-in-the-loop approval (`confirmExecution === true`)
 * - `shell: false` (zero shell interpolation)
 * - stripped secrets environment
 * - hard timeout & stdout/stderr size caps
 */
export async function runSafeSandboxCommand(params: {
  rootDir: string;
  presetId: SandboxRunnerPresetId;
  targetFile: string;
  confirmExecution: boolean;
  timeoutMs?: number;
}): Promise<SandboxExecutionResult> {
  if (params.confirmExecution !== true) {
    return {
      ok: false,
      presetId: params.presetId,
      targetFile: params.targetFile,
      displayCommand: '',
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      truncatedOutput: false,
      error: 'Ausführung erfordert eine explizite Nutzer-Freigabe (confirmExecution: true).',
    };
  }

  const spec = buildSafeSandboxCommand({
    rootDir: params.rootDir,
    presetId: params.presetId,
    targetFile: params.targetFile,
  });
  if (!spec.ok) {
    return {
      ok: false,
      presetId: params.presetId,
      targetFile: params.targetFile,
      displayCommand: '',
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      stdout: '',
      stderr: '',
      truncatedOutput: false,
      error: spec.error,
    };
  }

  const timeoutMs = Math.max(1000, Math.min(20_000, params.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS));
  const start = Date.now();

  return await new Promise<SandboxExecutionResult>((resolve) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    let truncatedOutput = false;
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number | null, spawnErr?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: !spawnErr && !timedOut && exitCode === 0,
        presetId: params.presetId,
        targetFile: spec.resolvedRelPath,
        displayCommand: spec.displayCommand,
        exitCode,
        timedOut,
        durationMs: Date.now() - start,
        stdout: stdoutBuf,
        stderr: spawnErr ? `${stderrBuf}${stderrBuf ? '\n' : ''}${spawnErr}` : stderrBuf,
        truncatedOutput,
        error: spawnErr
          ? spawnErr
          : timedOut
            ? `Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s (Prozess beendet).`
            : undefined,
      });
    };

    let child;
    try {
      child = spawn(spec.bin, spec.args, {
        cwd: spec.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildSanitizedChildEnv(process.env),
        windowsHide: true,
      });
    } catch (err: unknown) {
      finish(null, err instanceof Error ? err.message : 'Prozessstart fehlgeschlagen.');
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // already exited
          }
        }, 600);
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stdoutBuf.length + text.length > MAX_SANDBOX_OUTPUT_BYTES) {
        stdoutBuf += text.slice(0, Math.max(0, MAX_SANDBOX_OUTPUT_BYTES - stdoutBuf.length));
        truncatedOutput = true;
      } else {
        stdoutBuf += text;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stderrBuf.length + text.length > MAX_SANDBOX_OUTPUT_BYTES) {
        stderrBuf += text.slice(0, Math.max(0, MAX_SANDBOX_OUTPUT_BYTES - stderrBuf.length));
        truncatedOutput = true;
      } else {
        stderrBuf += text;
      }
    });

    child.on('error', (err) => {
      finish(null, `Runtime nicht verfügbar (${spec.bin}): ${err.message}`);
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}
