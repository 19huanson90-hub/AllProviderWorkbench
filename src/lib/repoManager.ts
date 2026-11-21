import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BridgeRepoStatus, BridgeSelectionEntry } from './types.ts';

const execFileAsync = promisify(execFile);

export interface AllowlistedBridgeRepo {
  bridgeId: string;
  zielprovider: string;
  repoUrl: string;
}

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/;
const SAFE_BRIDGE_ID_RE = /^[a-z0-9][a-z0-9-]{1,64}$/;

/**
 * Extract strictly allowlisted GitHub repositories from consolidated bridge selections.
 * Only Docker-capable selected bridges with verified GitHub HTTPS URLs are eligible.
 * Hard Rule 1: illegal / anonym_pseudo_key entries are never in bridgeSelections.
 */
export function getAllowlistedBridgeRepos(
  selections: BridgeSelectionEntry[]
): AllowlistedBridgeRepo[] {
  const result: AllowlistedBridgeRepo[] = [];
  const seen = new Set<string>();

  for (const s of selections) {
    if (!s.docker_capable || !s.bridge_id || !s.bridge_url) continue;
    if (!SAFE_BRIDGE_ID_RE.test(s.bridge_id)) continue;
    const cleanUrl = s.bridge_url.replace(/\/+$/, '');
    if (!GITHUB_URL_RE.test(cleanUrl)) continue;
    if (seen.has(s.bridge_id)) continue;
    seen.add(s.bridge_id);
    result.push({
      bridgeId: s.bridge_id,
      zielprovider: s.zielprovider,
      repoUrl: cleanUrl,
    });
  }

  return result;
}

async function runGit(args: string[], timeoutMs = 30000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    },
  });
  return stdout.trim();
}

export async function inspectLocalBridgeRepo(
  repo: AllowlistedBridgeRepo,
  bridgesRootDir: string
): Promise<BridgeRepoStatus> {
  const localDir = path.resolve(bridgesRootDir, repo.bridgeId);
  const relPath = `bridges/${repo.bridgeId}`;

  if (!fs.existsSync(path.join(localDir, '.git'))) {
    return {
      bridgeId: repo.bridgeId,
      zielprovider: repo.zielprovider,
      repoUrl: repo.repoUrl,
      localPath: relPath,
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
    };
  }

  try {
    const [commitHash, commitDate, branch] = await Promise.all([
      runGit(['-C', localDir, 'rev-parse', '--short', 'HEAD'], 5000).catch(() => null),
      runGit(['-C', localDir, 'log', '-1', '--format=%cs'], 5000).catch(() => null),
      runGit(['-C', localDir, 'rev-parse', '--abbrev-ref', 'HEAD'], 5000).catch(() => null),
    ]);

    const entries = fs.readdirSync(localDir, { withFileTypes: true });
    const visibleEntries = entries.filter((e) => e.name !== '.git');
    const fileNames = visibleEntries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const dirNames = visibleEntries
      .filter((e) => e.isDirectory())
      .map((e) => `${e.name}/`)
      .sort((a, b) => a.localeCompare(b));

    const lowerFiles = new Set(fileNames.map((f) => f.toLowerCase()));
    const hasDockerfile = fileNames.some((f) => /^dockerfile/i.test(f));
    const hasDockerCompose = fileNames.some((f) => /^(docker-)?compose\.ya?ml$/i.test(f));
    const hasLicense = fileNames.some((f) => /^licen[cs]e/i.test(f));
    const hasReadme = lowerFiles.has('readme.md') || fileNames.some((f) => /^readme/i.test(f));

    // Count tracked files via git ls-files (fast & accurate)
    let fileCount = fileNames.length;
    try {
      const tracked = await runGit(['-C', localDir, 'ls-files'], 5000);
      if (tracked) {
        fileCount = tracked.split('\n').filter(Boolean).length;
      }
    } catch {
      // keep top-level count
    }

    return {
      bridgeId: repo.bridgeId,
      zielprovider: repo.zielprovider,
      repoUrl: repo.repoUrl,
      localPath: relPath,
      status: 'cloned',
      cloned: true,
      commitHash,
      commitDate,
      branch,
      fileCount,
      hasDockerfile,
      hasDockerCompose,
      hasLicense,
      hasReadme,
      topFiles: [...fileNames, ...dirNames].slice(0, 40),
      error: null,
      updatedAt: new Date().toISOString(),
    };
  } catch (err: unknown) {
    return {
      bridgeId: repo.bridgeId,
      zielprovider: repo.zielprovider,
      repoUrl: repo.repoUrl,
      localPath: relPath,
      status: 'failed',
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
      error: err instanceof Error ? err.message.slice(0, 180) : 'Fehler beim Prüfen des Repos.',
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function cloneOrUpdateBridgeRepo(
  repo: AllowlistedBridgeRepo,
  bridgesRootDir: string
): Promise<BridgeRepoStatus> {
  fs.mkdirSync(bridgesRootDir, { recursive: true });
  const localDir = path.resolve(bridgesRootDir, repo.bridgeId);
  if (!localDir.startsWith(path.resolve(bridgesRootDir) + path.sep)) {
    throw new Error('Ungültiger Zielpfad.');
  }

  try {
    if (fs.existsSync(path.join(localDir, '.git'))) {
      await runGit(['-C', localDir, 'fetch', '--depth', '1', 'origin'], 30000);
      await runGit(['-C', localDir, 'reset', '--hard', 'FETCH_HEAD'], 10000);
    } else {
      fs.rmSync(localDir, { recursive: true, force: true });
      const gitUrl = repo.repoUrl.endsWith('.git') ? repo.repoUrl : `${repo.repoUrl}.git`;
      await runGit(['clone', '--depth', '1', '--single-branch', gitUrl, localDir], 35000);
    }
    return await inspectLocalBridgeRepo(repo, bridgesRootDir);
  } catch (err: unknown) {
    if (!fs.existsSync(path.join(localDir, '.git'))) {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
    const rawMsg =
      err instanceof Error
        ? ((err as Error & { stderr?: string }).stderr || err.message)
        : 'Git-Clone fehlgeschlagen.';
    const cleanMsg = rawMsg
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);

    return {
      bridgeId: repo.bridgeId,
      zielprovider: repo.zielprovider,
      repoUrl: repo.repoUrl,
      localPath: `bridges/${repo.bridgeId}`,
      status: 'failed',
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
      error: cleanMsg || 'Repository konnte nicht geklont werden (evtl. privat/gelöscht/Timeout).',
      updatedAt: new Date().toISOString(),
    };
  }
}

export function readClonedRepoFile(
  bridgeId: string,
  fileName: string,
  allowlist: AllowlistedBridgeRepo[],
  bridgesRootDir: string
): { fileName: string; content: string; truncated: boolean } {
  if (!allowlist.some((r) => r.bridgeId === bridgeId)) {
    throw new Error(`Repository "${bridgeId}" ist nicht auf der Allowlist.`);
  }
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('Nur Top-Level-Dateien ohne Pfadtrenner sind zulässig.');
  }
  const repoRoot = path.resolve(bridgesRootDir, bridgeId);
  const fullPath = path.resolve(repoRoot, fileName);
  if (!fullPath.startsWith(repoRoot + path.sep)) {
    throw new Error('Pfad außerhalb des Repository-Verzeichnisses verweigert.');
  }
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw new Error(`Datei "${fileName}" existiert im geklonten Repo nicht.`);
  }
  const MAX_BYTES = 64 * 1024;
  const buf = fs.readFileSync(fullPath);
  const truncated = buf.length > MAX_BYTES;
  const content = buf.subarray(0, MAX_BYTES).toString('utf8');
  return { fileName, content, truncated };
}
