'use strict';

const fs = require('fs');
const path = require('path');
const { registerTool } = require('./registry');
const sandbox = require('../sandbox');

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT = 128 * 1024;
const MAX_COMMAND_CHARS = 20_000;

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
  const cfg = agentConfig?.tools?.shell;
  if (!cfg || cfg.enabled !== true) return null;
  if (!Array.isArray(cfg.allow_paths) || cfg.allow_paths.length === 0) return null;
  return {
    roots: cfg.allow_paths.map(realResolve),
    timeoutMs: Math.min(cfg.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxOutputBytes: cfg.max_output_bytes ?? DEFAULT_MAX_OUTPUT,
  };
}

registerTool({
  name: 'shell',
  description:
    'Run a shell command (sh -c) inside an isolated Debian sandbox. Only the allow_paths folder of the ' +
    'host is visible and writable; the rest of the host is not. Each call is a fresh process: cd and ' +
    'env vars do not persist, so chain steps with && in one command. apt/dpkg do not work in the ' +
    'sandbox. exit_code 124 means the command timed out.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string' },
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
    if (args.command.length > MAX_COMMAND_CHARS || args.command.includes('\0'))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'command too long or contains NUL.' };
    if (args.cwd != null && typeof args.cwd !== 'string')
      return { ok: false, code: 'INVALID_SCHEMA', message: 'cwd must be a string.' };
    if (args.timeout_ms != null && (!Number.isInteger(args.timeout_ms) || args.timeout_ms < 100))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'timeout_ms must be an integer >= 100.' };
    return { ok: true };
  },
  async execute(args, ctx) {
    const cfg = buildConfig(ctx.agentConfig);
    if (!cfg) throw Object.assign(new Error('shell not enabled or no allow_paths.'), { code: 'TOOL_DISABLED' });
    if (!sandbox.isOn(ctx.agentConfig))
      throw Object.assign(new Error('shell requires agent.sandbox.enabled: true (it never runs on the host).'), { code: 'TOOL_DISABLED' });
    await sandbox.ensureReady(ctx.agentConfig);

    const cwd = realResolve(args.cwd || cfg.roots[0]);
    if (!cfg.roots.some((root) => isInside(root, cwd)))
      throw Object.assign(new Error(`cwd outside allow_paths: ${cwd}`), { code: 'PERMISSION_DENIED' });

    const timeoutMs = Math.min(args.timeout_ms ?? cfg.timeoutMs, MAX_TIMEOUT_MS);
    const secs = Math.max(1, Math.ceil(timeoutMs / 1000));
    const max = cfg.maxOutputBytes;

    return new Promise((resolve, reject) => {
      // `timeout` corre DENTRO del contenedor: mata el proceso hijo, no solo el wrapper de udocker.
      sandbox.execFileIn(
        ctx.agentConfig, cfg.roots, '/usr/bin/timeout',
        ['-k', '5', String(secs), '/bin/sh', '-c', args.command],
        { cwd, timeout: timeoutMs + 15_000, maxBuffer: max, env: { LANG: 'C.UTF-8' } },
        (err, stdout, stderr) => {
          const base = { command: args.command, cwd };
          if (err && err.code === 'SANDBOX_UNAVAILABLE') return reject(err);
          if (err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
            return resolve({ ...base, exit_code: null, stdout: String(stdout), stderr: String(stderr).slice(0, 4096), truncated: true });
          if (err && err.killed) return reject(Object.assign(new Error('command timeout'), { code: 'TIMEOUT' }));
          if (err && typeof err.code !== 'number')
            return reject(Object.assign(new Error(`shell failed: ${stderr || err.message}`), { code: 'EXECUTION_FAILED' }));
          const out = String(stdout);
          resolve({
            ...base,
            exit_code: err ? err.code : 0,   // un exit != 0 NO es un error de la tool: el modelo necesita ver stderr
            stdout: out.slice(0, max),
            stderr: String(stderr).slice(0, 4096),
            truncated: out.length > max,
          });
        },
      );
    });
  },
});
