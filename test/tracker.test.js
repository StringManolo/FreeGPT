'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
delete process.env.FREEGPT_TRACK_AGENT;
const tracker = require('../src/agent/tracker');

test('formatToolArgs terminal', () => {
  const s = tracker.formatToolArgs('terminal', { command: 'ls', args: ['-la'], cwd: '/r' });
  assert.match(s, /"ls"/);
  assert.match(s, /"-la"/);
  assert.match(s, /cwd="\/r"/);
});

test('formatToolArgs git', () => {
  const s = tracker.formatToolArgs('git', { operation: 'status', cwd: '/r' });
  assert.match(s, /^status/);
  assert.match(s, /cwd="\/r"/);
});

test('formatToolArgs filesystem', () => {
  const s = tracker.formatToolArgs('filesystem', { operation: 'read', path: '/a' });
  assert.match(s, /^read/);
  assert.match(s, /"\/a"/);
});

test('formatToolArgs terminal vacío', () => {
  assert.strictEqual(tracker.formatToolArgs('terminal', {}), '');
});

test('isTracking false por defecto', () => {
  assert.strictEqual(tracker.isTracking(), false);
});

test('logStart no imprime si no tracking', () => {
  const orig = console.log;
  let called = false;
  console.log = () => { called = true; };
  try { tracker.logStart('terminal', { command: 'ls' }); } finally { console.log = orig; }
  assert.strictEqual(called, false);
});
