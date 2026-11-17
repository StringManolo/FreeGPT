'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerTool, unregisterTool } = require('../src/tools/registry');
const { runAgentRequest } = require('../src/agent/agent');

function makeRouter(script) {
  let i = 0;
  return {
    async chatCompletion() {
      const reply = script[i++];
      if (reply === undefined) throw new Error('Router script exhausted');
      if (typeof reply === 'function') return reply();
      return { choices: [{ message: { role: 'assistant', content: reply } }] };
    },
  };
}

const TEST_TOOL = 'echo_test';

function registerEcho() {
  registerTool({
    name: TEST_TOOL,
    description: 'Echo the input.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    validate(args) {
      if (!args || typeof args.value !== 'string') {
        return { ok: false, code: 'INVALID_SCHEMA', message: 'value must be a string' };
      }
      return { ok: true };
    },
    async execute(args) {
      return { echoed: args.value };
    },
  });
}

const AGENT_CONFIG = {
  limits: { max_iterations: 5, max_calls: 10, max_parallel: 2 },
  tools: {
    [TEST_TOOL]: { enabled: true },
  },
};

test('devuelve respuesta final cuando el modelo no pide herramientas', async () => {
  registerEcho();
  try {
    const router = makeRouter(['Hola, soy el agente.']);
    const events = [];
    const result = await runAgentRequest({
      router,
      model: 'fake',
      messages: [{ role: 'user', content: 'Hola' }],
      requestedTools: {},
      agentConfig: AGENT_CONFIG,
      emit: (e) => events.push(e),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.content, 'Hola, soy el agente.');
    assert.ok(events.some((e) => e.type === 'agent.started'));
    assert.ok(events.some((e) => e.type === 'agent.completed'));
  } finally {
    unregisterTool(TEST_TOOL);
  }
});

test('ejecuta una herramienta y devuelve resultado al modelo', async () => {
  registerEcho();
  try {
    let round = 0;
    const router = {
      async chatCompletion({ messages }) {
        round += 1;
        if (round === 1) {
          return {
            choices: [{
              message: {
                role: 'assistant',
                content: '<fgpt:tool_call>{"id":"c1","tool":"echo_test","arguments":{"value":"ok"}}</fgpt:tool_call>',
              },
            }],
          };
        }
        // Verifica que el resultado llegó al contexto
        const last = messages[messages.length - 1];
        assert.equal(last.role, 'user');
        assert.match(last.content, /<fgpt:tool_result>/);
        assert.match(last.content, /"echoed":"ok"/);
        return { choices: [{ message: { role: 'assistant', content: 'Listo.' } }] };
      },
    };

    const events = [];
    const result = await runAgentRequest({
      router,
      model: 'fake',
      messages: [{ role: 'user', content: 'Hazlo' }],
      requestedTools: { [TEST_TOOL]: true },
      agentConfig: AGENT_CONFIG,
      emit: (e) => events.push(e),
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.content, 'Listo.');
    assert.ok(events.some((e) => e.type === 'tool.started'));
    assert.ok(events.some((e) => e.type === 'tool.completed'));
  } finally {
    unregisterTool(TEST_TOOL);
  }
});

test('deniega herramienta no habilitada por el usuario', async () => {
  registerEcho();
  try {
    let round = 0;
    const router = {
      async chatCompletion({ messages }) {
        round += 1;
        if (round === 1) {
          return {
            choices: [{
              message: {
                role: 'assistant',
                content: '<fgpt:tool_call>{"id":"c1","tool":"echo_test","arguments":{"value":"ok"}}</fgpt:tool_call>',
              },
            }],
          };
        }
        const last = messages[messages.length - 1];
        assert.match(last.content, /"status":"denied"/);
        return { choices: [{ message: { role: 'assistant', content: 'No puedo.' } }] };
      },
    };

    const events = [];
    const result = await runAgentRequest({
      router,
      model: 'fake',
      messages: [{ role: 'user', content: 'Hazlo' }],
      requestedTools: {}, // no habilitada por el usuario
      agentConfig: AGENT_CONFIG,
      emit: (e) => events.push(e),
    });

    assert.equal(result.status, 'completed');
    assert.ok(events.some((e) => e.type === 'tool.denied'));
  } finally {
    unregisterTool(TEST_TOOL);
  }
});

test('devuelve error al modelo cuando el JSON FGTP es inválido y agota correcciones', async () => {
  registerEcho();
  try {
    const router = makeRouter([
      '<fgpt:tool_call>{"tool":"echo_test",</fgpt:tool_call>',
      '<fgpt:tool_call>{"tool":"echo_test",</fgpt:tool_call>',
      '<fgpt:tool_call>{"tool":"echo_test",</fgpt:tool_call>',
    ]);

    const result = await runAgentRequest({
      router,
      model: 'fake',
      messages: [{ role: 'user', content: 'x' }],
      requestedTools: { [TEST_TOOL]: true },
      agentConfig: {
        limits: { format_corrections: 1 },
        tools: { [TEST_TOOL]: { enabled: true } },
      },
      emit: () => {},
    });

    assert.equal(result.status, 'error');
    assert.equal(result.error.code, 'INVALID_SCHEMA');
  } finally {
    unregisterTool(TEST_TOOL);
  }
});
