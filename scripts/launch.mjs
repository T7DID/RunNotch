import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [root, ...process.argv.slice(2)], {
  cwd: root,
  env: environment,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  process.stderr.write(`Could not start RunNotch: ${error.message}\n`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`RunNotch stopped by ${signal}.\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 0;
  }
});
