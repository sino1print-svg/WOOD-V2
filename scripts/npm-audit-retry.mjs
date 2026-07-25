/**
 * Fail-closed npm-audit runner with bounded retries and per-attempt timeout.
 * Only known transport/registry failures (including timeout) are retried.
 * Vulnerability findings and all other command failures exit immediately.
 */
import { spawn } from 'node:child_process';

const mode = process.argv[2];
const MODES = {
  full: ['audit', '--audit-level=high'],
  prod: ['audit', '--omit=dev'],
};

if (!(mode in MODES)) {
  console.error('Usage: node scripts/npm-audit-retry.mjs <full|prod>');
  process.exit(2);
}

function positiveIntegerFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const npmExecutable =
  process.env.NPM_AUDIT_EXECUTABLE ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const maxAttempts = positiveIntegerFromEnv('AUDIT_MAX_ATTEMPTS', 8);
const retryDelayMs = positiveIntegerFromEnv('AUDIT_RETRY_DELAY_MS', 2_000);
const attemptTimeoutMs = positiveIntegerFromEnv('AUDIT_TIMEOUT_MS', 55_000);
const killGraceMs = positiveIntegerFromEnv('AUDIT_KILL_GRACE_MS', 2_000);
const transientPattern =
  /audit endpoint returned an error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout|410 Gone|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENOTFOUND/i;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runAttempt() {
  return new Promise((resolve) => {
    const child = spawn(npmExecutable, MODES[mode], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;
    let forceKillTimer = null;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      spawnError = error;
    });

    function terminate(signal) {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall back to the direct child if the process group has already exited.
        }
      }
      child.kill(signal);
    }

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.error(`[audit-retry] audit attempt timed out after ${attemptTimeoutMs}ms`);
      terminate('SIGTERM');
      forceKillTimer = setTimeout(() => {
        terminate('SIGKILL');
      }, killGraceMs);
      forceKillTimer.unref();
    }, attemptTimeoutMs);
    timeoutTimer.unref();

    child.on('close', (status, signal) => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ status, signal, stdout, stderr, timedOut, spawnError });
    });
  });
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = await runAttempt();
  if (result.status === 0 && !result.timedOut) process.exit(0);

  const combined = `${result.stdout}\n${result.stderr}\n${result.spawnError?.message ?? ''}`;
  const isTransient = result.timedOut || transientPattern.test(combined);
  if (!isTransient || attempt === maxAttempts) process.exit(result.status ?? 1);

  console.warn(
    `[audit-retry] transient registry/infrastructure failure; retrying (${attempt}/${maxAttempts})`,
  );
  await sleep(retryDelayMs);
}

process.exit(1);
