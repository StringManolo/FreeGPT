'use strict';

const fs = require('fs');
const path = require('path');
const { hasTool } = require('../tools/registry');

function buildServerAllowedSet(agentConfig) {
  const set = new Set();
  const tools = agentConfig && agentConfig.tools;
  if (!tools || typeof tools !== 'object') return set;

  for (const [name, cfg] of Object.entries(tools)) {
    if (cfg && cfg.enabled === true && hasTool(name)) {
      set.add(name);
    }
  }
  return set;
}

function normalizeToolSelection(requested, serverAllowed) {
  const out = {};
  if (!requested || typeof requested !== 'object') return out;

  for (const [name, value] of Object.entries(requested)) {
    if (value === true && serverAllowed.has(name)) {
      out[name] = true;
    }
  }
  return out;
}

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

const PATH_TOOLS = new Set(['filesystem', 'git', 'terminal']);

function checkPermission(toolName, args, ctx, agentConfig) {
  const cfg = agentConfig && agentConfig.tools && agentConfig.tools[toolName];
  if (!cfg || cfg.enabled !== true) {
    return { ok: false, status: 'denied', error: { code: 'TOOL_DISABLED', message: `Tool not enabled on server: ${toolName}` } };
  }

  if (cfg.policy && typeof cfg.policy.check === 'function') {
    let result;
    try { result = cfg.policy.check(args, ctx || {}); }
    catch (err) { return { ok: false, status: 'denied', error: { code: 'PERMISSION_DENIED', message: err.message || 'Permission check failed.' } }; }
    if (result && result.ok === false) {
      return { ok: false, status: 'denied', error: { code: result.code || 'PERMISSION_DENIED', message: result.message || 'Permission denied.' } };
    }
  }

  if (PATH_TOOLS.has(toolName) && Array.isArray(cfg.allow_paths) && cfg.allow_paths.length > 0) {
    const requested = (args && (args.path || args.cwd)) || '';
    if (toolName === 'filesystem' && !requested) {
      return { ok: false, status: 'denied', error: { code: 'INVALID_SCHEMA', message: 'filesystem requires "path".' } };
    }
    if (requested) {
      const resolved = realResolve(requested);
      const allowed = cfg.allow_paths.some((root) =>
        typeof root === 'string' && root.length > 0 && isInside(realResolve(root), resolved));
      if (!allowed) {
        return { ok: false, status: 'denied', error: { code: 'PERMISSION_DENIED', message: `Path is not in the allow-list: ${requested}` } };
      }
    }
  }

  return { ok: true };
}

module.exports = { buildServerAllowedSet, normalizeToolSelection, checkPermission };
