import { afterEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeFakeNpm(body: string): { executable: string; counter: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'audit-retry-'));
  tempDirs.push(directory);
  const executable = path.join(directory, 'fake-npm.sh');
  const counter = path.join(directory, 'counter');
  writeFileSync(
    executable,
    `#!/usr/bin/env bash\nset -eu\nCOUNTER="${counter}"\nn=0\nif [[ -f "$COUNTER" ]]; then n=$(cat "$COUNTER"); fi\nn=$((n+1))\nprintf '%s' "$n" > "$COUNTER"\n${body}\n`,
  );
  chmodSync(executable, 0o755);
  return { executable, counter };
}

function run(executable: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['scripts/npm-audit-retry.mjs', 'full'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      NPM_AUDIT_EXECUTABLE: executable,
      AUDIT_MAX_ATTEMPTS: '3',
      AUDIT_TIMEOUT_MS: '100',
      AUDIT_RETRY_DELAY_MS: '1',
      AUDIT_KILL_GRACE_MS: '50',
      ...extraEnv,
    },
  });
}

describe('bounded npm audit retry runner', () => {
  it('times out an attempt, kills it, retries, and fails closed', () => {
    const fake = makeFakeNpm("trap '' TERM; sleep 2");
    const result = run(fake.executable, { AUDIT_MAX_ATTEMPTS: '2' });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('timed out');
    expect(readFileSync(fake.counter, 'utf8')).toBe('2');
  });

  it('retries a transient registry failure and succeeds', () => {
    const fake = makeFakeNpm(
      'if [[ "$n" -eq 1 ]]; then echo "502 Bad Gateway" >&2; exit 1; fi; echo "found 0 vulnerabilities"; exit 0',
    );
    const result = run(fake.executable);
    expect(result.status).toBe(0);
    expect(readFileSync(fake.counter, 'utf8')).toBe('2');
  });

  it('does not retry a vulnerability finding', () => {
    const fake = makeFakeNpm('echo "1 high severity vulnerability"; exit 1');
    const result = run(fake.executable);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fake.counter, 'utf8')).toBe('1');
  });

  it('retries only to the bound and then fails closed', () => {
    const fake = makeFakeNpm('echo "503 Service Unavailable" >&2; exit 1');
    const result = run(fake.executable);
    expect(result.status).not.toBe(0);
    expect(readFileSync(fake.counter, 'utf8')).toBe('3');
  });
});
