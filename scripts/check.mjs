import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'package.json',
  'src/main.cjs',
  'src/preload.cjs',
  'src/protocol.cjs',
  'src/store.cjs',
  'src/ui/index.html',
  'src/ui/app.css',
  'src/ui/app.js',
  'cli/runnotch.mjs'
];

let failed = false;
for (const relative of required) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
    process.stderr.write(`Missing or empty: ${relative}\n`);
    failed = true;
  }
}

const html = fs.readFileSync(path.join(root, 'src/ui/index.html'), 'utf8');
for (const requirement of ['Content-Security-Policy', 'aria-label', 'app.js', 'app.css']) {
  if (!html.includes(requirement)) {
    process.stderr.write(`UI check failed: missing ${requirement}\n`);
    failed = true;
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.bin?.runnotch !== 'cli/runnotch.mjs') {
  process.stderr.write('Package check failed: runnotch binary is not registered.\n');
  failed = true;
}

if (failed) process.exit(1);
process.stdout.write('RunNotch project checks passed.\n');
