import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const excludedDirectories = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.cache',
  'cache',
  'logs',
]);
const excludedFilePatterns = [
  /\.zip$/i,
  /\.log$/i,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /__temporary/i,
  /audit[-_ ]scratch/i,
];
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    if (excludedDirectories.has(name)) continue;
    const absolute = resolve(directory, name);
    const stats = statSync(absolute);
    if (stats.isDirectory()) walk(absolute);
    else if (stats.isFile() && !excludedFilePatterns.some((pattern) => pattern.test(name)))
      files.push(absolute);
  }
}
walk(root);
const normalized = files
  .map((file) => relative(root, file).split(sep).join('/'))
  .sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
const hash = createHash('sha256');
for (const path of normalized) {
  hash.update(Buffer.from(path, 'utf8'));
  hash.update(Buffer.from([0]));
  hash.update(readFileSync(resolve(root, path)));
  hash.update(Buffer.from([0]));
}
console.log(`${hash.digest('hex')}  ${normalized.length} files`);
