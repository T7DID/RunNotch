'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JobStore } = require('../src/store.cjs');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runnotch-test-'));
  let now = 1_000_000;
  const store = new JobStore(path.join(directory, 'state.json'), () => now);
  return { store, tick: (milliseconds) => { now += milliseconds; }, directory };
}

test('job lifecycle moves from running to success', (t) => {
  const { store, directory } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  store.apply({ type: 'start', id: 'one', job: { id: 'one', name: 'Tests', command: 'npm test', cwd: 'C:\\project', childPid: 42 } });
  store.apply({ type: 'output', id: 'one', text: '50%', progress: 50 });
  store.apply({ type: 'finish', id: 'one', exitCode: 0 });
  const job = store.get('one');
  assert.equal(job.status, 'success');
  assert.equal(job.progress, 100);
  assert.equal(job.exitCode, 0);
});

test('output is bounded and secrets are redacted', (t) => {
  const { store, directory } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  store.apply({ type: 'start', id: 'two', job: { id: 'two', name: 'Build' } });
  for (let index = 0; index < 150; index += 1) store.apply({ type: 'output', id: 'two', text: `line ${index} token=private-${index}` });
  const job = store.get('two');
  assert.equal(job.lastLines.length, 120);
  assert.doesNotMatch(job.lastLines.join('\n'), /private-149/);
});

test('finished jobs expire according to settings', (t) => {
  const { store, tick, directory } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  store.updateSettings({ keepFinishedMinutes: 5 });
  store.apply({ type: 'start', id: 'three', job: { id: 'three', name: 'Build' } });
  store.apply({ type: 'finish', id: 'three', exitCode: 1 });
  tick(6 * 60_000);
  assert.equal(store.list().length, 0);
});

test('launch at startup is enabled by default and can be disabled', (t) => {
  const { store, directory } = fixture();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(store.settings().launchAtStartup, true);
  assert.equal(store.updateSettings({ launchAtStartup: false }).launchAtStartup, false);
});
