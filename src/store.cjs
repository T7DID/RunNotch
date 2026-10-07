'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_LOG_LINES, cleanText, publicJob } = require('./protocol.cjs');

const DEFAULT_SETTINGS = Object.freeze({
  launchAtStartup: true,
  notifySuccess: true,
  notifyFailure: true,
  keepFinishedMinutes: 15,
  sound: true
});

class JobStore {
  constructor(filePath, now = () => Date.now()) {
    this.filePath = filePath;
    this.now = now;
    this.state = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.map(publicJob).filter(Boolean) : [];
      this.state = {
        jobs,
        settings: this.normalizeSettings(parsed.settings)
      };
    } catch {
      this.state = { jobs: [], settings: { ...DEFAULT_SETTINGS } };
    }
    const bootTime = this.now();
    for (const job of this.state.jobs) {
      if (job.status === 'running' || job.status === 'attention') {
        job.status = 'interrupted';
        job.finishedAt = bootTime;
        job.updatedAt = bootTime;
        job.lastLines.push('RunNotch restarted before this command reported an exit code.');
      }
    }
    this.prune();
  }

  normalizeSettings(value = {}) {
    const minutes = Number(value.keepFinishedMinutes);
    return {
      launchAtStartup: value.launchAtStartup !== false,
      notifySuccess: value.notifySuccess !== false,
      notifyFailure: value.notifyFailure !== false,
      keepFinishedMinutes: [5, 15, 60, 0].includes(minutes) ? minutes : DEFAULT_SETTINGS.keepFinishedMinutes,
      sound: value.sound !== false
    };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  apply(event) {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
      throw new TypeError('Invalid event.');
    }
    const now = this.now();
    const id = String(event.id || event.job?.id || '');
    if (!id || id.length > 128) throw new TypeError('Event id is required.');
    let job = this.state.jobs.find((item) => item.id === id);

    if (event.type === 'start') {
      const candidate = publicJob({
        ...event.job,
        id,
        status: 'running',
        progress: Number.isFinite(event.job?.progress) ? event.job.progress : null,
        startedAt: Number(event.job?.startedAt || now),
        updatedAt: now,
        lastLines: []
      });
      const existingIndex = this.state.jobs.findIndex((item) => item.id === id);
      if (existingIndex >= 0) this.state.jobs.splice(existingIndex, 1, candidate);
      else this.state.jobs.unshift(candidate);
      job = candidate;
    } else {
      if (!job) throw new RangeError('Unknown run.');
      job.updatedAt = now;
      if (event.type === 'output') {
        const text = cleanText(event.text || '', 24_000);
        const lines = text.split('\n').filter((line, index, array) => line || index < array.length - 1);
        job.lastLines.push(...lines.map((line) => cleanText(line, 2_000)));
        job.lastLines = job.lastLines.slice(-MAX_LOG_LINES);
        job.stream = event.stream === 'stderr' ? 'stderr' : 'stdout';
        if (Number.isFinite(event.progress)) job.progress = Math.max(0, Math.min(100, Number(event.progress)));
        if (event.attention === true) job.status = 'attention';
        else if (event.attention === false && job.status === 'attention') job.status = 'running';
      } else if (event.type === 'finish') {
        job.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
        job.status = event.status || (job.exitCode === 0 ? 'success' : 'failed');
        if (job.status === 'success' && job.progress !== null) job.progress = 100;
        job.finishedAt = Number(event.finishedAt || now);
        job.seen = false;
      } else if (event.type === 'seen') {
        job.seen = true;
      } else if (event.type === 'stopping') {
        job.status = 'stopping';
      } else {
        throw new TypeError(`Unsupported event type: ${event.type}`);
      }
    }

    this.prune();
    this.save();
    return publicJob(job);
  }

  prune() {
    const minutes = this.state.settings.keepFinishedMinutes;
    if (minutes === 0) return;
    const cutoff = this.now() - minutes * 60_000;
    this.state.jobs = this.state.jobs.filter((job) => {
      if (['running', 'attention', 'stopping'].includes(job.status)) return true;
      return !job.finishedAt || job.finishedAt >= cutoff;
    });
  }

  list() {
    this.prune();
    const priority = { attention: 0, failed: 1, running: 2, stopping: 3, interrupted: 4, success: 5 };
    return this.state.jobs
      .map(publicJob)
      .sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || b.updatedAt - a.updatedAt);
  }

  get(id) {
    const found = this.state.jobs.find((job) => job.id === id);
    return found ? publicJob(found) : null;
  }

  remove(id) {
    const before = this.state.jobs.length;
    this.state.jobs = this.state.jobs.filter((job) => job.id !== id);
    if (this.state.jobs.length !== before) this.save();
    return before !== this.state.jobs.length;
  }

  clearFinished() {
    this.state.jobs = this.state.jobs.filter((job) => ['running', 'attention', 'stopping'].includes(job.status));
    this.save();
  }

  settings() {
    return { ...this.state.settings };
  }

  updateSettings(patch) {
    this.state.settings = this.normalizeSettings({ ...this.state.settings, ...patch });
    this.prune();
    this.save();
    return this.settings();
  }
}

module.exports = { JobStore, DEFAULT_SETTINGS };
