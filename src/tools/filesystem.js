'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { registerTool } = require('./registry');

const MAX_READ_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_GLOB_RESULTS = 200;
const DEFAULT_GLOB_MAX_DEPTH = 6;

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
  const cfg = agentConfig?.tools?.filesystem;
  if (!cfg || !Array.isArray(cfg.allow_paths) || cfg.allow_paths.length === 0) return null;
  return cfg.allow_paths.map((p) => realResolve(p));
}

function assertAllowed(targetPath, allowedRoots) {
  if (!allowedRoots) throw Object.assign(new Error('filesystem has no allow_paths.'), { code: 'TOOL_DISABLED' });
  const resolved = realResolve(targetPath);
  if (!allowedRoots.some((root) => isInside(root, resolved))) {
    throw Object.assign(new Error(`Path outside allow_paths: ${resolved}`), { code: 'PERMISSION_DENIED' });
  }
  return resolved;
}

async function opRead(resolved, maxBytes) {
  const stat = await fsp.stat(resolved);
  if (!stat.isFile()) throw Object.assign(new Error('Not a regular file'), { code: 'INVALID_PATH' });
  if (stat.size > maxBytes) {
    const fh = await fsp.open(resolved, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
      return { path: resolved, size: stat.size, truncated: true, content: buf.slice(0, bytesRead).toString('utf8') };
    } finally { await fh.close(); }
  }
  return { path: resolved, size: stat.size, truncated: false, content: await fsp.readFile(resolved, 'utf8') };
}

async function opList(resolved) {
  const stat = await fsp.stat(resolved);
  if (!stat.isDirectory()) throw Object.assign(new Error('Not a directory'), { code: 'INVALID_PATH' });
  const entries = await fsp.readdir(resolved, { withFileTypes: true });
  const out = entries.slice(0, MAX_LIST_ENTRIES).map((e) => ({
    name: e.name,
    type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'symlink' : 'other',
  }));
  return { path: resolved, total: entries.length, entries: out, truncated: entries.length > MAX_LIST_ENTRIES };
}

async function opStat(resolved) {
  const stat = await fsp.stat(resolved);
  return {
    path: resolved, size: stat.size,
    isFile: stat.isFile(), isDirectory: stat.isDirectory(), isSymbolicLink: stat.isSymbolicLink(),
    mode: '0' + (stat.mode & 0o777).toString(8),
    mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
  };
}

function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (ch === '?') re += '[^/]';
    else if ('.+^$(){}|[]\\'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp('^' + re + '$');
}

async function opGlob(resolved, pattern, maxDepth) {
  const re = globToRegex(pattern || '**/*');
  const results = [];
  async function walk(dir, depth) {
    if (results.length >= MAX_GLOB_RESULTS || depth > maxDepth) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= MAX_GLOB_RESULTS) return;
      const abs = path.join(dir, e.name);
      const rel = path.relative(resolved, abs).split(path.sep).join('/');
      if (re.test(rel)) results.push({ path: abs, rel, type: e.isDirectory() ? 'dir' : 'file' });
      if (e.isDirectory()) await walk(abs, depth + 1);
    }
  }
  await walk(resolved, 0);
  return { root: resolved, pattern, results, truncated: results.length >= MAX_GLOB_RESULTS };
}

registerTool({
  name: 'filesystem',
  description:
    'Read-only filesystem. Operations: read, list, stat, glob. ' +
    'Only paths inside allow_paths. Symlinks are resolved and re-checked. Writes not supported.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['read', 'list', 'stat', 'glob'] },
      path: { type: 'string' },
      pattern: { type: 'string', description: 'Glob pattern (supports * and **).' },
      max_bytes: { type: 'integer' },
      max_depth: { type: 'integer' },
    },
    required: ['operation', 'path'],
    additionalProperties: false,
  },
  validate(args) {
    if (!args || typeof args !== 'object') return { ok: false, code: 'INVALID_SCHEMA', message: 'arguments must be an object.' };
    if (!['read', 'list', 'stat', 'glob'].includes(args.operation))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'operation must be read|list|stat|glob.' };
    if (typeof args.path !== 'string' || args.path.trim() === '')
      return { ok: false, code: 'INVALID_SCHEMA', message: 'path must be a non-empty string.' };
    if (args.max_bytes != null && (!Number.isInteger(args.max_bytes) || args.max_bytes < 1))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'max_bytes must be a positive integer.' };
    if (args.max_depth != null && (!Number.isInteger(args.max_depth) || args.max_depth < 1))
      return { ok: false, code: 'INVALID_SCHEMA', message: 'max_depth must be a positive integer.' };
    return { ok: true };
  },
  async execute(args, ctx) {
    const roots = buildAllowedRoots(ctx.agentConfig);
    const resolved = assertAllowed(args.path, roots);
    const maxBytes = Math.min(args.max_bytes ?? MAX_READ_BYTES, MAX_READ_BYTES);
    switch (args.operation) {
      case 'read': return await opRead(resolved, maxBytes);
      case 'list': return await opList(resolved);
      case 'stat': return await opStat(resolved);
      case 'glob': return await opGlob(resolved, args.pattern || '**/*', args.max_depth ?? DEFAULT_GLOB_MAX_DEPTH);
    }
  },
});
