'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { commandDisplay, detectAttention, detectProgress, redactSecrets } = require('../src/protocol.cjs');

test('detectProgress reads percentages and fractions', () => {
  assert.equal(detectProgress('Building 42%'), 42);
  assert.equal(detectProgress('Tests [25/100]'), 25);
  assert.equal(detectProgress('no progress here'), null);
});

test('detectAttention recognizes interactive prompts', () => {
  assert.equal(detectAttention('Continue? [y/n]'), true);
  assert.equal(detectAttention('Waiting for approval'), true);
  assert.equal(detectAttention('Compiled successfully'), false);
});

test('redactSecrets masks common credentials', () => {
  assert.doesNotMatch(redactSecrets('token=super-secret-value'), /super-secret-value/);
  assert.doesNotMatch(redactSecrets('Authorization: Bearer abc.def.ghi'), /abc\.def\.ghi/);
  assert.doesNotMatch(redactSecrets('ghp_abcdefghijklmnopqrstuvwxyz123456'), /ghp_abcdefghijklmnopqrstuvwxyz/);
});

test('commandDisplay quotes spaces and redacts secrets', () => {
  const result = commandDisplay('node', ['my script.js', 'token=super-secret-value']);
  assert.match(result, /"my script\.js"/);
  assert.doesNotMatch(result, /super-secret-value/);
});
