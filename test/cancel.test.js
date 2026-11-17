'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { Router } = require('../src/router/router');

function emptyRouter() {
  return new Router(
    { providers: {}, routing: {}, settings: {} },
    new Map()
  );
}

test('withTimeout rechaza si el signal ya esta abortado', async () => {
  const router = emptyRouter();
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => router.withTimeout(new Promise(() => {}), 5000, ctrl.signal),
    (e) => e.code === 'CANCELLED'
  );
});

test('withTimeout rechaza a mitad de vuelo', async () => {
  const router = emptyRouter();
  const ctrl = new AbortController();
  const promise = router.withTimeout(new Promise(() => {}), 5000, ctrl.signal);
  setTimeout(() => ctrl.abort(), 20);
  await assert.rejects(() => promise, (e) => e.code === 'CANCELLED');
});

test('withTimeout mantiene el timeout clasico', async () => {
  const router = emptyRouter();
  await assert.rejects(
    () => router.withTimeout(new Promise(() => {}), 20),
    (e) => e.code === 'ETIMEDOUT'
  );
});

test('chatCompletion propaga CANCELLED sin fallback', async () => {
  const calls = [];
  const makeAdapter = (name) => ({
    name,
    config: { api_keys: ['k1'], models: ['m1'], limits: {}, key_strategy: 'sequential' },
    async chatCompletion({ signal }) {
      calls.push(name);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ choices: [{ message: { content: 'ok' } }] }), 5000);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
          }, { once: true });
        }
      });
    },
    async healthCheck() { return true; }
  });

  const providers = new Map();
  providers.set('p1', makeAdapter('p1'));
  providers.set('p2', makeAdapter('p2'));

  const config = {
    providers: {
      p1: { api_keys: ['k1'], models: ['m1'], limits: {}, key_strategy: 'sequential' },
      p2: { api_keys: ['k1'], models: ['m1'], limits: {}, key_strategy: 'sequential' }
    },
    routing: {
      model_groups: {
        'test-group': [
          { provider: 'p1', model: 'm1', priority: 1 },
          { provider: 'p2', model: 'm1', priority: 2 }
        ]
      }
    },
    settings: { request_timeout_ms: 30000, cooldown_after_failure_ms: 60000 }
  };

  const router = new Router(config, providers);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 30);

  await assert.rejects(
    () => router.chatCompletion({
      model: 'test-group',
      messages: [{ role: 'user', content: 'hi' }],
      signal: ctrl.signal
    }),
    (e) => e.code === 'CANCELLED'
  );

  assert.deepStrictEqual(calls, ['p1'], 'no debe hacer fallback a p2 tras cancel');
});

const ADAPTER_CASES = [
  ['../src/providers/generic-openai', 'GenericOpenAIAdapter', { base_url: 'https://example.com/v1' }],
  ['../src/providers/groq',           'GroqAdapter',           {}],
  ['../src/providers/openrouter',     'OpenRouterAdapter',     {}],
  ['../src/providers/gemini',         'GeminiAdapter',         {}]
];

for (const [modPath, cls, extra] of ADAPTER_CASES) {
  test(`${cls} propaga signal al fetch`, async () => {
    const Adapter = require(modPath)[cls];
    const adapter = new Adapter('test', { api_keys: ['k1'], models: ['m1'], ...extra });
    const ctrl = new AbortController();
    let seenSignal;
    const orig = global.fetch;
    global.fetch = async (_url, opts) => {
      seenSignal = opts && opts.signal;
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }]
        })
      };
    };
    try {
      await adapter.chatCompletion({
        model: 'm1',
        messages: [{ role: 'user', content: 'hi' }],
        signal: ctrl.signal
      });
      assert.strictEqual(seenSignal, ctrl.signal, `${cls} no paso signal a fetch`);
    } finally {
      global.fetch = orig;
    }
  });
}
