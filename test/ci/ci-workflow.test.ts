/**
 * CI workflow / repository-root consistency (deterministic).
 * CI runs from the repo ROOT (root .nvmrc + root package-lock.json), does `npm ci`
 * then `npm run verify:full`, and `verify:full` contains the required ordered steps
 * (both audits + typecheck + lint + format:check + test + determinism + build).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};
const DETERMINISM_SCRIPT = readFileSync(
  path.join(ROOT, 'scripts', 'build-determinism.mjs'),
  'utf8',
);

describe('CI runs from repository root', () => {
  it('has no working-directory / nested-folder path prefixes', () => {
    expect(CI).not.toMatch(/working-directory:\s*mockup-photoshoot-director/);
    expect(CI).not.toContain('mockup-photoshoot-director/');
  });
  it('uses root .nvmrc and root package-lock.json with npm cache', () => {
    expect(CI).toMatch(/node-version-file:\s*\.nvmrc/);
    expect(CI).toMatch(/cache-dependency-path:\s*package-lock\.json/);
    expect(CI).toMatch(/cache:\s*npm/);
  });
  it('runs npm ci then npm run verify:full (in order)', () => {
    const ci = CI.indexOf('npm ci');
    const vf = CI.indexOf('npm run verify:full');
    expect(ci).toBeGreaterThan(-1);
    expect(vf).toBeGreaterThan(ci);
  });
  it('repo-root layout matches (no nested project folder)', () => {
    for (const f of ['package.json', 'package-lock.json', '.nvmrc', '.github/workflows/ci.yml']) {
      expect(existsSync(path.join(ROOT, f)), `expected ${f} at root`).toBe(true);
    }
    expect(existsSync(path.join(ROOT, 'mockup-photoshoot-director'))).toBe(false);
  });
});

describe('verify:full contains the required ordered steps', () => {
  it('maps both audit scripts to the bounded fail-closed audit runner', () => {
    expect(PKG.scripts['audit:full']).toBe('node scripts/npm-audit-retry.mjs full');
    expect(PKG.scripts['audit:prod']).toBe('node scripts/npm-audit-retry.mjs prod');
  });
  it('runs both audits + full gate chain in order', () => {
    const vf = PKG.scripts['verify:full'];
    expect(vf, 'verify:full script missing').toBeTruthy();
    const required = [
      'npm run audit:full',
      'npm run audit:prod',
      'npm run typecheck',
      'npm run lint',
      'npm run format:check',
      'npm run test',
      'npm run verify:determinism',
      'npm run build',
    ];
    let last = -1;
    for (const step of required) {
      const idx = vf.indexOf(step);
      expect(idx, `verify:full missing step: ${step}`).toBeGreaterThan(-1);
      expect(idx, `verify:full step out of order: ${step}`).toBeGreaterThan(last);
      last = idx;
    }
  });
  it('pins AJV exactly to the approved version', () => {
    expect(PKG.dependencies.ajv).toBe('8.20.0');
  });
  it('standard verify remains available for development', () => {
    expect(PKG.scripts['verify']).toBeTruthy();
  });
  it('runs deterministic builds through the pinned local Vite CLI with a hard timeout', () => {
    expect(DETERMINISM_SCRIPT).toContain("node_modules', 'vite', 'bin', 'vite.js");
    expect(DETERMINISM_SCRIPT).toContain('timeout: BUILD_TIMEOUT_MS');
    expect(DETERMINISM_SCRIPT).toContain("killSignal: 'SIGKILL'");
    expect(DETERMINISM_SCRIPT).not.toContain('npx vite build');
  });
});
