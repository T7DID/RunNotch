'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IPC_HOST = '127.0.0.1';
const IPC_PORT = 47_737;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_LOG_LINES = 120;

const SECRET_PATTERNS = [
  [/\b(sk-(?:ant-|proj-)?[a-zA-Z0-9_-]{16,})\b/g, 'sk-••••••••'],
  [/\b(gh[opusr]_[a-zA-Z0-9]{20,})\b/g, 'gh_••••••••'],
  [/\b(AKIA[0-9A-Z]{16})\b/g, 'AKIA••••••••••••••••'],
  [/\b(Bearer\s+)[a-zA-Z0-9._~+\/-]+=*/gi, '$1••••••••'],
  [/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1••••••••'],
  [/(https?:\/\/[^:\s/]+:)[^@\s/]+@/g, '$1••••••••@']
];

function appDataDirectory() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'RunNotch');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'RunNotch');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'RunNotch');
}

function tokenPath() {
  return path.join(appDataDirectory(), 'ipc-token');
}

function ensureIpcToken() {
  const directory = appDataDirectory();
  const file = tokenPath();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
  } catch {
    // First launch.
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function readIpcToken() {
  try {
    const value = fs.readFileSync(tokenPath(), 'utf8').trim();
    return /^[a-f0-9]{64}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

function redactSecrets(value) {
  let text = String(value ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function cleanText(value, maxLength = 16_000) {
  return redactSecrets(value)
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r/g, '')
    .slice(-maxLength);
}

function detectProgress(value) {
  const text = cleanText(value, 4_000);
  const percentMatches = [...text.matchAll(/(?:^|\s|\[)(100|[1-9]?\d(?:\.\d+)?)\s*%/g)];
  if (percentMatches.length) {
    return Math.max(0, Math.min(100, Number(percentMatches.at(-1)[1])));
  }
  const fractionMatches = [...text.matchAll(/(?:^|\s|\[)(\d{1,6})\s*\/\s*(\d{1,6})(?:\]|\s|$)/g)];
  if (fractionMatches.length) {
    const [, current, total] = fractionMatches.at(-1);
    if (Number(total) > 0 && Number(current) <= Number(total)) {
      return Math.round((Number(current) / Number(total)) * 1000) / 10;
    }
  }
  return null;
}

function detectAttention(value) {
  const text = cleanText(value, 2_000).toLowerCase();
  return /(?:\[y\/n\]|\(y\/n\)|press enter|requires? (?:your )?(?:approval|permission)|waiting for (?:input|approval)|approve\?|continue\?|allow\?)/i.test(text);
}

function commandDisplay(command, args = []) {
  const quote = (part) => {
    const text = redactSecrets(String(part));
    return /[\s"']/u.test(text) ? JSON.stringify(text) : text;
  };
  return [command, ...args].map(quote).join(' ');
}

function publicJob(job) {
  if (!job || typeof job !== 'object') return null;
  const allowed = {
    id: String(job.id || ''),
    name: cleanText(job.name || 'Untitled run', 120),
    command: cleanText(job.command || '', 600),
    cwd: cleanText(job.cwd || '', 1_000),
    status: String(job.status || 'running'),
    progress: Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : null,
    startedAt: Number(job.startedAt || Date.now()),
    updatedAt: Number(job.updatedAt || Date.now()),
    finishedAt: job.finishedAt ? Number(job.finishedAt) : null,
    exitCode: Number.isInteger(job.exitCode) ? job.exitCode : null,
    childPid: Number.isInteger(job.childPid) ? job.childPid : null,
    terminalPid: Number.isInteger(job.terminalPid) ? job.terminalPid : null,
    lastLines: Array.isArray(job.lastLines) ? job.lastLines.slice(-MAX_LOG_LINES).map((line) => cleanText(line, 2_000)) : [],
    stream: job.stream === 'stderr' ? 'stderr' : 'stdout',
    seen: Boolean(job.seen)
  };
  return allowed;
}

module.exports = {
  IPC_HOST,
  IPC_PORT,
  MAX_EVENT_BYTES,
  MAX_LOG_LINES,
  appDataDirectory,
  tokenPath,
  ensureIpcToken,
  readIpcToken,
  redactSecrets,
  cleanText,
  detectProgress,
  detectAttention,
  commandDisplay,
  publicJob
};
