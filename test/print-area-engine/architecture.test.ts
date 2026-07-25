import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('src/engines/print-area-engine');
const files = fs.readdirSync(ROOT).filter((name) => name.endsWith('.ts'));
const source = files.map((name) => fs.readFileSync(path.join(ROOT, name), 'utf8')).join('\n');

describe('Print-Area architecture and source scans', () => {
  it('contains no engine implementation imports', () => {
    expect(source).not.toMatch(
      /from ['"][^'"]*\/(rule|palette|scene|dedup|validation|prompt|cover|export)-engine/,
    );
  });

  it('contains no UI, persistence, asset-store, orchestrator, filesystem or network imports', () => {
    expect(source).not.toMatch(
      /from ['"][^'"]*(ui|persistence|asset-store|orchestrator|node:fs|node:path)/,
    );
    expect(source).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\b/);
  });

  it('contains no clocks, random sources, eval or Function constructor', () => {
    expect(source).not.toMatch(
      /Date\.now|new Date|performance\.now|Math\.random|randomUUID|\beval\s*\(|new Function|Function\s*\(/,
    );
  });

  it('contains no description parsing or RULE token extraction', () => {
    expect(source).not.toMatch(/\.description\b|RULE_\w+.*description|description.*RULE_\w+/i);
  });

  it('exports the public engine adapter', async () => {
    const module = await import('../../src/engines/print-area-engine');
    expect(typeof module.measurePrintArea).toBe('function');
  });
});
