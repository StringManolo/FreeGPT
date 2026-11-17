'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../src/tools/terminal');
const { executeTool } = require('../src/tools/registry');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fgpt-term-'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'A');
  return root;
}
const cfgFor = (root) => ({
  tools: { terminal: { enabled: true, allow_paths: [root], allow_commands: ['ls', 'cat', 'pwd'] } },
});

test('ls inside sandbox', async () => {
  const root = makeSandbox();
  const r = await executeTool('terminal', { command: 'ls' }, { agentConfig: cfgFor(root) });
  assert.match(r.stdout, /a\.txt/);
});

test('cat outside sandbox blocked', async () => {
  const root = makeSandbox();
  await assert.rejects(
    () => executeTool('terminal', { command: 'cat', args: ['/etc/passwd'] }, { agentConfig: cfgFor(root) }),
    (e) => e.code === 'PERMISSION_DENIED',
  );
});

test('cwd outside sandbox blocked', async () => {
  const root = makeSandbox();
  await assert.rejects(
    () => executeTool('terminal', { command: 'ls', cwd: '/etc' }, { agentConfig: cfgFor(root) }),
    (e) => e.code === 'PERMISSION_DENIED',
  );
});

test('command not in allow_commands blocked', async () => {
  const root = makeSandbox();
  await assert.rejects(
    () => executeTool('terminal', { command: 'rm', args: ['-rf', '/'] }, { agentConfig: cfgFor(root) }),
    (e) => e.code === 'PERMISSION_DENIED',
  );
});
