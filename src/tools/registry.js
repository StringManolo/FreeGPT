'use strict';

const registry = new Map();

function registerTool(def) {
  if (!def || typeof def !== 'object') {
    throw new TypeError('Tool definition must be an object.');
  }
  if (typeof def.name !== 'string' || !def.name.trim()) {
    throw new TypeError('Tool requires a non-empty "name".');
  }
  if (typeof def.description !== 'string') {
    throw new TypeError('Tool requires a "description".');
  }
  if (!def.parameters || typeof def.parameters !== 'object') {
    throw new TypeError('Tool requires a "parameters" JSON Schema object.');
  }
  if (typeof def.execute !== 'function') {
    throw new TypeError('Tool requires an "execute" function.');
  }

  registry.set(def.name, {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    defaults: def.defaults || {},
    validate: typeof def.validate === 'function' ? def.validate : null,
    execute: def.execute,
    enabled: def.enabled !== false,
  });

  return def.name;
}

function unregisterTool(name) {
  registry.delete(name);
}

function getTool(name) {
  return registry.get(name) || null;
}

function hasTool(name) {
  return registry.has(name);
}

function listTools() {
  return Array.from(registry.values());
}

function validateArguments(toolName, args) {
  const tool = getTool(toolName);
  if (!tool) {
    return { ok: false, code: 'UNKNOWN_TOOL', message: `Unknown tool: ${toolName}` };
  }
  if (!tool.enabled) {
    return { ok: false, code: 'TOOL_DISABLED', message: `Tool is disabled: ${toolName}` };
  }
  if (tool.validate) {
    let result;
    try {
      result = tool.validate(args);
    } catch (err) {
      return {
        ok: false,
        code: 'INVALID_SCHEMA',
        message: err.message || 'Tool argument validation failed.',
      };
    }
    if (result && result.ok === false) {
      return {
        ok: false,
        code: result.code || 'INVALID_SCHEMA',
        message: result.message || 'Invalid tool arguments.',
      };
    }
  }
  return { ok: true };
}

async function executeTool(toolName, args, ctx) {
  const tool = getTool(toolName);
  if (!tool) {
    const err = new Error(`Unknown tool: ${toolName}`);
    err.code = 'UNKNOWN_TOOL';
    throw err;
  }
  return await tool.execute(args, ctx || {});
}

module.exports = {
  registerTool,
  unregisterTool,
  getTool,
  hasTool,
  listTools,
  validateArguments,
  executeTool,
};
