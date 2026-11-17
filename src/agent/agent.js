'use strict';

const { runAgent } = require('./loop');
const {
  buildServerAllowedSet,
  normalizeToolSelection,
} = require('./permissions');
const { listTools } = require('../tools/registry');

async function runAgentRequest({
  router,
  model,
  messages,
  requestedTools,
  agentConfig,
  emit,
  signal,
}) {
  const serverAllowed = buildServerAllowedSet(agentConfig);
  const enabledTools = normalizeToolSelection(requestedTools, serverAllowed);

  return await runAgent({
    router,
    model,
    messages,
    enabledTools,
    agentConfig,
    emit,
    signal,
  });
}

function listAvailableTools(agentConfig) {
  const serverAllowed = buildServerAllowedSet(agentConfig);
  return listTools()
    .filter((t) => serverAllowed.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
}

module.exports = { runAgentRequest, listAvailableTools };
