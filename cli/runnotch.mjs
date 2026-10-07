#!/usr/bin/env node

import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  IPC_HOST,
  IPC_PORT,
  commandDisplay,
  detectAttention,
  detectProgress,
  readIpcToken,
  cleanText
} = require('../src/protocol.cjs');
const packageJson = require('../package.json');
const crossSpawn = require('cross-spawn');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  process.stdout.write(`RunNotch ${packageJson.version}\n\n`);
  process.stdout.write('Track a long-running command from the edge of your screen.\n\n');
  process.stdout.write('Usage:\n');
  process.stdout.write('  runnotch [options] -- <command> [arguments]\n');
  process.stdout.write('  runnotch [options] <command> [arguments]\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write('  -n, --name <name>   Label shown in RunNotch\n');
  process.stdout.write('  -C, --cwd <path>    Working directory for the command\n');
  process.stdout.write('      --quiet         Do not print command output locally\n');
  process.stdout.write('      --no-app        Do not launch the desktop app automatically\n');
  process.stdout.write('  -h, --help          Show this help\n');
  process.stdout.write('  -v, --version       Show the version\n\n');
  process.stdout.write('Examples:\n');
  process.stdout.write('  runnotch npm test\n');
  process.stdout.write('  runnotch --name "Release build" -- cargo build --release\n');
  process.stdout.write('  runnotch -C ./web npm run dev\n');
}

function parseArguments(argv) {
  const options = { name: null, cwd: process.cwd(), quiet: false, noApp: false };
  const command = [];
  let passthrough = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (passthrough) { command.push(value); continue; }
    if (value === '--') { passthrough = true; continue; }
    if (value === '-h' || value === '--help') return { help: true };
    if (value === '-v' || value === '--version') return { version: true };
    if (value === '--quiet') { options.quiet = true; continue; }
    if (value === '--no-app') { options.noApp = true; continue; }
    if (value === '-n' || value === '--name') {
      if (!argv[index + 1]) throw new Error(`${value} requires a name.`);
      options.name = argv[++index];
      continue;
    }
    if (value === '-C' || value === '--cwd') {
      if (!argv[index + 1]) throw new Error(`${value} requires a path.`);
      options.cwd = path.resolve(argv[++index]);
      continue;
    }
    command.push(value);
    passthrough = true;
  }
  if (!command.length) return { help: true };
  return { options, command: command[0], args: command.slice(1) };
}

function request(method, route, payload, timeout = 1_000) {
  const token = readIpcToken();
  if (!token) return Promise.reject(new Error('RunNotch has not created its local connection yet.'));
  const body = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: IPC_HOST,
      port: IPC_PORT,
      path: route,
      method,
      timeout,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json', 'content-length': body.length } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        if ((response.statusCode || 500) >= 400) reject(new Error(parsed.error || `RunNotch returned HTTP ${response.statusCode}.`));
        else resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('RunNotch did not respond.')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function healthy() {
  try {
    const result = await request('GET', '/v1/health', undefined, 400);
    return result.ok === true;
  } catch {
    return false;
  }
}

function desktopCandidates() {
  const candidates = [];
  try { candidates.push(require('electron')); } catch { /* dependency not installed */ }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) candidates.push(path.join(local, 'Programs', 'RunNotch', 'RunNotch.exe'));
    candidates.push(path.join(root, 'dist', 'win-unpacked', 'RunNotch.exe'));
  }
  return [...new Set(candidates.filter(Boolean))];
}

async function ensureDesktop(allowLaunch) {
  if (await healthy()) return true;
  if (!allowLaunch) return false;
  const fs = await import('node:fs');
  const executable = desktopCandidates().find((candidate) => fs.existsSync(candidate));
  if (!executable) return false;
  const isElectronRuntime = /electron(?:\.exe)?$/i.test(executable);
  const argumentsList = isElectronRuntime ? [root, '--background'] : ['--background'];
  const launchEnvironment = { ...process.env };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, argumentsList, { detached: true, stdio: 'ignore', windowsHide: true, env: launchEnvironment });
  child.unref();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await healthy()) return true;
  }
  return false;
}

class OutputReporter {
  constructor(id) {
    this.id = id;
    this.pending = { stdout: '', stderr: '' };
    this.timer = null;
    this.chain = Promise.resolve();
  }

  push(stream, text) {
    this.pending[stream] += text;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const packets = [];
    for (const stream of ['stdout', 'stderr']) {
      if (!this.pending[stream]) continue;
      const text = this.pending[stream];
      this.pending[stream] = '';
      packets.push({
        type: 'output',
        id: this.id,
        stream,
        text: cleanText(text, 24_000),
        progress: detectProgress(text),
        attention: detectAttention(text)
      });
    }
    for (const packet of packets) {
      this.chain = this.chain.then(() => request('POST', '/v1/events', packet, 1_500)).catch(() => {});
    }
    await this.chain;
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`runnotch: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (parsed.help) { printHelp(); return; }
  if (parsed.version) { process.stdout.write(`${packageJson.version}\n`); return; }

  const { options, command, args } = parsed;
  const connected = await ensureDesktop(!options.noApp);
  if (!connected) {
    process.stderr.write('runnotch: desktop app is unavailable; the command will still run normally. Start it with "npm start".\n');
  }

  const id = crypto.randomUUID();
  const displayCommand = commandDisplay(command, args);
  const projectName = path.basename(options.cwd);
  const name = options.name || `${path.basename(command).replace(/\.(?:cmd|exe|ps1)$/i, '')} · ${projectName}`;
  const startedAt = Date.now();
  const child = crossSpawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    shell: false,
    windowsHide: false,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  const reporter = new OutputReporter(id);

  if (connected) {
    await request('POST', '/v1/events', {
      type: 'start',
      id,
      job: {
        id,
        name,
        command: displayCommand,
        cwd: options.cwd,
        childPid: child.pid,
        terminalPid: process.ppid,
        startedAt
      }
    }, 2_000).catch((error) => process.stderr.write(`runnotch: could not register the run: ${error.message}\n`));
  }

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    if (!options.quiet) process.stdout.write(chunk);
    if (connected) reporter.push('stdout', text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    if (!options.quiet) process.stderr.write(chunk);
    if (connected) reporter.push('stderr', text);
  });

  let spawnError = null;
  child.on('error', (error) => { spawnError = error; });
  const result = await new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  if (connected) {
    await reporter.flush();
    const exitCode = Number.isInteger(result.code) ? result.code : spawnError ? 1 : null;
    await request('POST', '/v1/events', {
      type: 'finish',
      id,
      exitCode,
      status: exitCode === 0 ? 'success' : 'failed',
      finishedAt: Date.now()
    }, 2_000).catch(() => {});
  }
  if (spawnError) process.stderr.write(`runnotch: ${spawnError.message}\n`);
  if (result.signal) process.stderr.write(`runnotch: command ended by ${result.signal}.\n`);
  process.exitCode = Number.isInteger(result.code) ? result.code : 1;
}

main().catch((error) => {
  process.stderr.write(`runnotch: ${error.message}\n`);
  process.exitCode = 1;
});
