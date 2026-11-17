'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FgtpParser, parseFgtp } = require('../src/agent/parser');
const {
  formatToolCall,
  FGTP_ERROR_CODES,
} = require('../src/agent/protocol');

test('parsea una llamada FGTP válida', () => {
  const call = {
    id: 'call_001',
    tool: 'web_search',
    arguments: { query: 'Node.js documentation' },
  };

  const result = parseFgtp(formatToolCall(call));

  assert.equal(result.hasToolCalls, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.calls[0], call);
});

test('parsea varias llamadas FGTP', () => {
  const text = [
    formatToolCall({
      id: 'call_001',
      tool: 'web_search',
      arguments: { query: 'Node.js documentation' },
    }),
    formatToolCall({
      id: 'call_002',
      tool: 'web_search',
      arguments: { query: 'Node.js security best practices' },
    }),
  ].join('\n');

  const result = parseFgtp(text);

  assert.equal(result.calls.length, 2);
  assert.equal(result.errors.length, 0);
});

test('conserva texto fuera de bloques FGTP', () => {
  const text = [
    'Antes',
    formatToolCall({
      id: 'call_001',
      tool: 'web_search',
      arguments: { query: 'Node.js' },
    }),
    'Después',
  ].join('\n');

  const result = parseFgtp(text);

  assert.equal(result.calls.length, 1);
  assert.match(result.text, /Antes/);
  assert.match(result.text, /Después/);
});

test('rechaza JSON inválido', () => {
  const result = parseFgtp(
    '<fgpt:tool_call>{"tool":"web_search","arguments":</fgpt:tool_call>'
  );

  assert.equal(result.calls.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].error.code, FGTP_ERROR_CODES.INVALID_JSON);
});

test('rechaza propiedades inesperadas', () => {
  const result = parseFgtp(
    '<fgpt:tool_call>{"id":"c1","tool":"web_search","arguments":{},"extra":true}</fgpt:tool_call>'
  );

  assert.equal(result.calls.length, 0);
  assert.equal(result.errors[0].error.code, FGTP_ERROR_CODES.INVALID_SCHEMA);
});

test('rechaza herramienta desconocida', () => {
  const result = parseFgtp(
    formatToolCall({
      id: 'call_001',
      tool: 'web_search',
      arguments: { query: 'Node.js' },
    }),
    { knownTools: ['web_fetch'] }
  );

  assert.equal(result.calls.length, 0);
  assert.equal(result.errors[0].error.code, FGTP_ERROR_CODES.UNKNOWN_TOOL);
});

test('rechaza herramienta deshabilitada', () => {
  const result = parseFgtp(
    formatToolCall({
      id: 'call_001',
      tool: 'web_search',
      arguments: { query: 'Node.js' },
    }),
    {
      knownTools: ['web_search'],
      enabledTools: [],
    }
  );

  assert.equal(result.calls.length, 0);
  assert.equal(result.errors[0].error.code, FGTP_ERROR_CODES.TOOL_DISABLED);
});

test('soporta bloques partidos entre chunks', () => {
  const parser = new FgtpParser();

  const first = parser.push('Hola <fgpt:tool_');
  assert.equal(first.text, 'Hola ');

  parser.push(
    'call>\n{"id":"call_001","tool":"web_search","arguments":{"query":"x"}}\n</fgpt:tool_call>'
  );

  const result = parser.end();

  assert.equal(result.text, 'Hola ');
  assert.equal(result.calls.length, 1);
  assert.equal(result.errors.length, 0);
});

test('detecta bloque incompleto al finalizar', () => {
  const result = parseFgtp(
    '<fgpt:tool_call>{"id":"call_001","tool":"web_search","arguments":{}}'
  );

  assert.equal(result.calls.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].error.code, FGTP_ERROR_CODES.INVALID_SCHEMA);
});

test('aplica límite de llamadas', () => {
  const text = [
    formatToolCall({
      id: 'call_001',
      tool: 'web_search',
      arguments: { query: 'uno' },
    }),
    formatToolCall({
      id: 'call_002',
      tool: 'web_search',
      arguments: { query: 'dos' },
    }),
  ].join('\n');

  const result = parseFgtp(text, { maxCalls: 1 });

  assert.equal(result.calls.length, 1);
  assert.equal(
    result.errors[0].error.code,
    FGTP_ERROR_CODES.CALL_LIMIT_REACHED
  );
});
