'use strict';

const fs = require('fs');
const path = require('path');
const { registerTool } = require('./registry');
const sandbox = require('../sandbox');

const MAX_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

const ALLOWED_OPS = {
  status:          ['status', '--porcelain=v1', '-b', '--untracked-files=normal'],
  log:             ['log', '--oneline', '--decorate', '-n', '50'],
  diff:            ['diff', '--no-color'],
  'diff-staged':   ['diff', '--cached', '--no-color'],
  show:            ['show', '--no-color', '--stat', 'HEAD'],
  branch:          ['branch', '-a', '-vv'],
  'ls-files':      ['ls-files'],
  remote:          ['remote', '-v'],
  'rev-parse':     ['rev-parse', 'HEAD'],
};

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function realResolve(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch {
    const parent = path.dirname(abs);
    try { return path.join(fs.realpathSync(parent), path.basename(abs)); } catch { return abs; }
  }
}

function buildAllowedRoots(agentConfig) {
  const cfg = agentConfig?.tools?.git;
  if (!cfg || !Array.isArray(cfg.allow_paths) || cfg.allow_paths.length === 0) return null;
  return cfg.allow_paths.map(realResolve);
}

function runGit(agentConfig, roots, cwd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    sandbox.execFileIn(agentConfig, roots, 'git', args, {
      cwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C',
             GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' },
    }, (err, stdout, stderr) => {
      if (err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        return resolve({ output: String(stdout), stderr: String(stderr).slice(0, 4096), truncated: true });
      }
      if (err && err.killed) return reject(Object.assign(new Error('git timeout'), { code: 'TIMEOUT' }));
      if (err) return reject(Object.assign(new Error(`git failed: ${stderr || err.message}`), { code: 'EXECUTION_FAILED' }));
      const out = String(stdout);
      resolve({ output: out.slice(0, MAX_OUTPUT_BYTES), stderr: String(stderr).slice(0, 4096), truncated: out.length > MAX_OUTPUT_BYTES });
    });
  });
}

registerTool({
  name: 'git',
  description:
    'Read-only git inspection. Ops: ' + Object.keys(ALLOWED_OPS).join(', ') +
    '. Only inside allow_paths. No network, no writes, no arbitrary args.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: Object.keys(ALLOWED_OPS) },
      cwd: { type: 'string' },
      timeout_ms: { type: 'integer' },
    },
    required: ['operation'],
    additionalProperties: false,
  },
  validate(args) {
    if (!args || typeof args !== 'object') return { ok: false, code: 'INVALID_SCHEMA', message: 'arguments must be an object.' };
    if (!ALLOWED_OPS[args.operation]) return { ok: false, code: 'INVALID_SCHEMA', message: `operation must be one of: ${Object.keys(ALLOWED_OPS).join(', ')}` };
    if (args.cwd != null && typeof args.cwd !== 'string') return { ok: false, code: 'INVALID_SCHEMA', message: 'cwd must be a string.' };
    if (args.timeout_ms != null && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 100 || args.timeout_ms > 60_000))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'timeout_ms must be 100..60000.' };
    return { ok: true };
  },
  async execute(args, ctx) {
    const roots = buildAllowedRoots(ctx.agentConfig);
    if (!roots) throw Object.assign(new Error('git has no allow_paths.'), { code: 'TOOL_DISABLED' });
    await sandbox.ensureReady(ctx.agentConfig);
    const cwdRaw = args.cwd || roots[0];
    const cwd = realResolve(cwdRaw);
    if (!roots.some((root) => isInside(root, cwd)))
      throw Object.assign(new Error(`cwd outside allow_paths: ${cwd}`), { code: 'PERMISSION_DENIED' });
    const cfg = ctx.agentConfig?.tools?.git;
    const timeout = Math.min(args.timeout_ms ?? cfg?.timeout_ms ?? DEFAULT_TIMEOUT_MS, 60_000);
    const result = await runGit(ctx.agentConfig, roots, cwd, ALLOWED_OPS[args.operation], timeout);
    return { operation: args.operation, cwd, ...result };
  },
});
