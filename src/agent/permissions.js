'use strict';

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

function checkPermission(toolName, args, ctx, agentConfig) {
  const tools = agentConfig && agentConfig.tools;
  const cfg = tools && tools[toolName];

  if (!cfg || cfg.enabled !== true) {
    return {
      ok: false,
      status: 'denied',
      error: {
        code: 'TOOL_DISABLED',
        message: `Tool not enabled on server: ${toolName}`,
      },
    };
  }

  // Per-tool custom policy
  if (cfg.policy && typeof cfg.policy.check === 'function') {
    let result;
    try {
      result = cfg.policy.check(args, ctx || {});
    } catch (err) {
      return {
        ok: false,
        status: 'denied',
        error: { code: 'PERMISSION_DENIED', message: err.message || 'Permission check failed.' },
      };
    }
    if (result && result.ok === false) {
      return {
        ok: false,
        status: 'denied',
        error: {
          code: result.code || 'PERMISSION_DENIED',
          message: result.message || 'Permission denied.',
        },
      };
    }
  }

  // Built-in filesystem path allow-list (no-op if not configured)
  if (toolName === 'filesystem' && Array.isArray(cfg.allow_paths) && cfg.allow_paths.length > 0) {
    const requestedPath = args && typeof args.path === 'string' ? args.path : '';
    const allowed = cfg.allow_paths.some((root) => {
      if (typeof root !== 'string' || root.length === 0) return false;
      if (root.endsWith('/')) return requestedPath.startsWith(root);
      return requestedPath === root || requestedPath.startsWith(root + '/');
    });
    if (!allowed) {
      return {
        ok: false,
        status: 'denied',
        error: {
          code: 'PERMISSION_DENIED',
          message: `Path is not in the allow-list: ${requestedPath}`,
        },
      };
    }
  }

  return { ok: true };
}

module.exports = {
  buildServerAllowedSet,
  normalizeToolSelection,
  checkPermission,
};
