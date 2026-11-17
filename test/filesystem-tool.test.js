'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../src/tools/filesystem');
const { executeTool } = require('../src/tools/registry');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fgpt-fs-'));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello world');
  fs.writeFileSync(path.join(root, 'sub', 'nested.txt'), 'nested');
  return root;
}
const cfgFor = (root) => ({ tools: { filesystem: { enabled: true, allow_paths: [root] } } });

test('read inside sandbox', async () => {
  const root = makeSandbox();
  const r = await executeTool('filesystem', { operation: 'read', path: path.join(root, 'hello.txt') }, { agentConfig: cfgFor(root) });
  assert.strictEqual(r.content, 'hello world');
});

test('read outside sandbox blocked', async () => {
  const root = makeSandbox();
  await assert.rejects(
    () => executeTool('filesystem', { operation: 'read', path: '/etc/passwd' }, { agentConfig: cfgFor(root) }),
    (e) => e.code === 'PERMISSION_DENIED',
  );
});

test('path traversal .. blocked', async () => {
  const root = makeSandbox();
  const evil = path.join(root, '..', '..', 'etc', 'passwd');
  await assert.rejects(
    () => executeTool('filesystem', { operation: 'read', path: evil }, { agentConfig: cfgFor(root) }),
    (e) => e.code === 'PERMISSION_DENIED',
  );
});

test('symlink escape blocked', async (t) => {
  const root = makeSandbox();
  const link = path.join(root, 'escape');
  try { fs.symlinkSync('/etc/passwd', link); } catch { t.skip('symlinks unsupported'); return; }
  await assert.rejects(
    () => executeTool('filesystem', { operation: 'read', path: link }, { agentConfig: cfgFor(root) }),
    (e) => e.code === 'PERMISSION_DENIED',
  );
});

test('glob inside sandbox', async () => {
  const root = makeSandbox();
  const r = await executeTool('filesystem', { operation: 'glob', path: root, pattern: '**/*.txt' }, { agentConfig: cfgFor(root) });
  assert.ok(r.results.some((x) => x.rel === 'hello.txt'));
  assert.ok(r.results.some((x) => x.rel === 'sub/nested.txt'));
});
