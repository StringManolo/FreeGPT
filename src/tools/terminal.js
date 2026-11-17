'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { registerTool } = require('./registry');

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

// Read-only commands. `fixed` means user args are ignored.
const ALLOWED = {
  ls:      { argv: ['-la', '--color=never'], maxArgs: 1 },
  pwd:     { argv: [],                         maxArgs: 0, fixed: true },
  cat:     { argv: [],                         maxArgs: 1 },
  head:    { argv: ['-n', '100'],              maxArgs: 1 },
  tail:    { argv: ['-n', '100'],              maxArgs: 1 },
  wc:      { argv: ['-l', '-c'],               maxArgs: 1 },
  du:      { argv: ['-sh'],                    maxArgs: 1 },
  df:      { argv: ['-h'],                     maxArgs: 0, fixed: true },
  file:    { argv: [],                         maxArgs: 1 },
  stat:    { argv: ['--printf=%n %s %F\n'],    maxArgs: 1 },
  which:   { argv: [],                         maxArgs: 1 },
  node:    { argv: ['--version'],              maxArgs: 0, fixed: true },
  python3: { argv: ['--version'],              maxArgs: 0, fixed: true },
};
const PATH_TAKING = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'du', 'file', 'stat', 'which']);

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

function buildConfig(agentConfig) {
  const cfg = agentConfig?.tools?.terminal;
  if (!cfg || cfg.enabled !== true) return null;
  if (!Array.isArray(cfg.allow_paths) || cfg.allow_paths.length === 0) return null;
  return {
    roots: cfg.allow_paths.map(realResolve),
    timeoutMs: cfg.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: cfg.max_output_bytes ?? MAX_OUTPUT_BYTES,
    allowCommands: Array.isArray(cfg.allow_commands) ? cfg.allow_commands : Object.keys(ALLOWED),
    runner: Array.isArray(cfg.runner) ? cfg.runner : [],
  };
}

function runWithRunner(argv, cwd, timeoutMs, maxBytes, runner) {
  const finalArgv = runner.length ? [...runner, ...argv] : argv;
  const cmd = finalArgv[0];
  const args = finalArgv.slice(1);
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      cwd, timeout: timeoutMs, maxBuffer: maxBytes,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C', LC_ALL: 'C' },
    }, (err, stdout, stderr) => {
      if (err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
        return resolve({ stdout: String(stdout), stderr: String(stderr).slice(0, 4096), truncated: true });
      if (err && err.killed) return reject(Object.assign(new Error('command timeout'), { code: 'TIMEOUT' }));
      if (err) return reject(Object.assign(new Error(`command failed: ${stderr || err.message}`), { code: 'EXECUTION_FAILED' }));
      const out = String(stdout);
      resolve({ stdout: out.slice(0, maxBytes), stderr: String(stderr).slice(0, 4096), truncated: out.length > maxBytes });
    });
  });
}

registerTool({
  name: 'terminal',
  description:
    'Run a small allow-listed set of READ-ONLY commands (' + Object.keys(ALLOWED).join(', ') + '). ' +
    'cwd and path args must be inside allow_paths. No shell, no pipes, no writes. NOT a true sandbox — ' +
    'configure `runner` (e.g. bwrap) for real isolation.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      args: { type: 'array', items: { type: 'string' } },
      cwd: { type: 'string' },
      timeout_ms: { type: 'integer' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  validate(args) {
    if (!args || typeof args !== 'object') return { ok: false, code: 'INVALID_SCHEMA', message: 'arguments must be an object.' };
    if (typeof args.command !== 'string' || args.command.trim() === '')
      return { ok: false, code: 'INVALID_SCHEMA', message: 'command must be a non-empty string.' };
    if (args.args != null && (!Array.isArray(args.args) || !args.args.every((a) => typeof a === 'string')))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'args must be an array of strings.' };
    return { ok: true };
  },
  async execute(args, ctx) {
    const cfg = buildConfig(ctx.agentConfig);
    if (!cfg) throw Object.assign(new Error('terminal not enabled or no allow_paths.'), { code: 'TOOL_DISABLED' });

    const cmd = args.command.trim();
    if (!cfg.allowCommands.includes(cmd))
      throw Object.assign(new Error(`command not in allow_commands: ${cmd}`), { code: 'PERMISSION_DENIED' });
    const spec = ALLOWED[cmd];
    if (!spec) throw Object.assign(new Error(`unsupported command: ${cmd}`), { code: 'PERMISSION_DENIED' });

    const userArgs = spec.fixed ? [] : (args.args || []);
    if (userArgs.length > spec.maxArgs)
      throw Object.assign(new Error(`too many args for ${cmd} (max ${spec.maxArgs})`), { code: 'INVALID_SCHEMA' });
    for (const a of userArgs) {
      if (a.includes('\0')) throw Object.assign(new Error('NUL byte in args'), { code: 'INVALID_SCHEMA' });
    }

    const cwdRaw = args.cwd || cfg.roots[0];
    const cwd = realResolve(cwdRaw);
    if (!cfg.roots.some((root) => isInside(root, cwd)))
      throw Object.assign(new Error(`cwd outside allow_paths: ${cwd}`), { code: 'PERMISSION_DENIED' });

    const finalArgs = [...spec.argv, ...userArgs];
    if (PATH_TAKING.has(cmd) && userArgs.length > 0) {
      const target = realResolve(path.resolve(cwd, userArgs[0]));
      if (!cfg.roots.some((root) => isInside(root, target)))
        throw Object.assign(new Error(`path arg outside allow_paths: ${target}`), { code: 'PERMISSION_DENIED' });
      finalArgs[finalArgs.length - 1] = target;
    }

    const timeout = Math.min(args.timeout_ms ?? cfg.timeoutMs, 60_000);
    const result = await runWithRunner([cmd, ...finalArgs], cwd, timeout, cfg.maxOutputBytes, cfg.runner);
    return { command: cmd, args: userArgs, cwd, ...result };
  },
});
