'use strict';

const { FgtpParser } = require('./parser');
const { formatToolResult, FGTP_STATUS } = require('./protocol');
const {
  listTools,
  validateArguments,
  executeTool,
} = require('../tools/registry');
const { checkPermission } = require('./permissions');
const { buildSystemPrompt } = require('./prompt');
const { createEventEmitter } = require('./events');

const DEFAULTS = {
  maxIterations: 15,
  maxCalls: 20,
  maxParallel: 3,
  formatCorrections: 2,
  maxTimeMs: 180000,
  maxResultBytes: 65536,
};

function now() {
  return Date.now();
}

function extractText(response) {
  if (typeof response === 'string') return response;
  const choice = response && response.choices && response.choices[0];
  if (!choice || !choice.message) return '';
  const content = choice.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part && part.text ? part.text : ''))
      .join('');
  }
  return '';
}

function resolveLimits(agentConfig) {
  const raw = (agentConfig && agentConfig.limits) || {};
  const limits = { ...DEFAULTS };

  if (Number.isInteger(raw.max_iterations) && raw.max_iterations > 0) limits.maxIterations = raw.max_iterations;
  if (Number.isInteger(raw.max_calls) && raw.max_calls > 0) limits.maxCalls = raw.max_calls;
  if (Number.isInteger(raw.max_parallel) && raw.max_parallel > 0) limits.maxParallel = raw.max_parallel;
  if (Number.isInteger(raw.format_corrections) && raw.format_corrections >= 0) limits.formatCorrections = raw.format_corrections;
  if (Number.isInteger(raw.max_time_ms) && raw.max_time_ms > 0) limits.maxTimeMs = raw.max_time_ms;
  if (Number.isInteger(raw.max_result_bytes) && raw.max_result_bytes > 0) limits.maxResultBytes = raw.max_result_bytes;

  return limits;
}

async function executeOne(call, { enabledTools, agentConfig, events, limits }) {
  if (!enabledTools[call.tool]) {
    const error = { code: 'TOOL_DISABLED', message: `Tool not enabled for this conversation: ${call.tool}` };
    events.toolDenied(call.id, call.tool, error);
    return {
      call,
      text: formatToolResult({
        id: call.id,
        tool: call.tool,
        status: FGTP_STATUS.DENIED,
        error,
      }),
    };
  }

  const argCheck = validateArguments(call.tool, call.arguments);
  if (!argCheck.ok) {
    events.toolFailed(call.id, call.tool, argCheck);
    return {
      call,
      text: formatToolResult({
        id: call.id,
        tool: call.tool,
        status: FGTP_STATUS.ERROR,
        error: { code: argCheck.code, message: argCheck.message },
      }),
    };
  }

  const perm = checkPermission(call.tool, call.arguments, {}, agentConfig);
  if (!perm.ok) {
    events.toolDenied(call.id, call.tool, perm.error);
    return {
      call,
      text: formatToolResult({
        id: call.id,
        tool: call.tool,
        status: FGTP_STATUS.DENIED,
        error: perm.error,
      }),
    };
  }

  events.toolStarted(call.id, call.tool);

  try {
    const result = await executeTool(call.tool, call.arguments, { agentConfig });
    const json = JSON.stringify(result === undefined ? null : result);

    if (json.length > limits.maxResultBytes) {
      const error = { code: 'RESULT_TOO_LARGE', message: `Tool result exceeds ${limits.maxResultBytes} bytes.` };
      events.toolFailed(call.id, call.tool, error);
      return {
        call,
        text: formatToolResult({
          id: call.id,
          tool: call.tool,
          status: FGTP_STATUS.ERROR,
          error,
        }),
      };
    }

    events.toolCompleted(call.id, call.tool);
    return {
      call,
      text: formatToolResult({
        id: call.id,
        tool: call.tool,
        status: FGTP_STATUS.SUCCESS,
        result: JSON.parse(json),
      }),
    };
  } catch (err) {
    const error = {
      code: err && err.code ? err.code : 'EXECUTION_FAILED',
      message: err && err.message ? err.message : 'Tool execution failed.',
    };
    events.toolFailed(call.id, call.tool, error);
    return {
      call,
      text: formatToolResult({
        id: call.id,
        tool: call.tool,
        status: FGTP_STATUS.ERROR,
        error,
      }),
    };
  }
}

async function runAgent({
  router,
  model,
  messages,
  enabledTools,
  agentConfig,
  emit,
  signal,
}) {
  const limits = resolveLimits(agentConfig);
  const events = createEventEmitter(emit);
  const startedAt = now();

  const knownTools = new Set(listTools().map((t) => t.name));
  const enabledSet = new Set(
    Object.entries(enabledTools || {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
  );

  const systemPrompt = buildSystemPrompt({ enabledTools, agentConfig });
  const workingMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  let iterations = 0;
  let callsUsed = 0;
  let formatCorrections = 0;

  events.started();

  while (iterations < limits.maxIterations) {
    if (signal && signal.aborted) {
      events.cancelled();
      return { status: 'cancelled', iterations, callsUsed };
    }

    if (now() - startedAt > limits.maxTimeMs) {
      const error = { code: 'TIMEOUT', message: 'Agent task exceeded the time limit.' };
      events.error(error);
      return { status: 'timeout', error, iterations, callsUsed };
    }

    iterations += 1;
    events.thinking();

    let raw;
try {
  raw = await router.chatCompletion({
    model,
    messages: workingMessages,
    options: {},
  });
} catch (err) {
  const error = {
    code: 'EXECUTION_FAILED',
    message: err && err.message ? err.message : 'Model call failed.',
  };
  events.error(error);
  return { status: 'error', error, iterations, callsUsed };
}

// Router real → { completion, meta }. Router de tests → completion directa.
const response = raw && raw.completion ? raw.completion : raw;
const text = extractText(response);

    const parser = new FgtpParser({
      knownTools,
      enabledTools: enabledSet,
      maxCalls: limits.maxCalls - callsUsed,
    });
    parser.push(text);
    const parsed = parser.end();

    const { calls, formatErrors, denials } = parsed;
    const hasCalls = calls.length > 0;
    const hasFormatErrors = formatErrors.length > 0;
    const hasDenials = denials.length > 0;

    // 1. Respuesta final: ni llamadas ni errores.
    if (!hasCalls && !hasFormatErrors && !hasDenials) {
      events.completed(parsed.text);
      return { status: 'completed', content: parsed.text, iterations, callsUsed };
    }

    // 2. Solo errores de formato: ruta de corrección acotada.
    if (!hasCalls && !hasDenials && hasFormatErrors) {
      if (formatCorrections >= limits.formatCorrections) {
        const error = {
          code: 'INVALID_SCHEMA',
          message: 'FGTP format correction limit reached.',
        };
        events.error(error);
        return { status: 'error', error, iterations, callsUsed };
      }
      formatCorrections += 1;

      workingMessages.push({ role: 'assistant', content: text });
      workingMessages.push({
        role: 'user',
        content: formatErrors
          .map((err) =>
            formatToolResult({
              id: err.id,
              tool: err.tool,
              status: FGTP_STATUS.ERROR,
              error: err.error,
            })
          )
          .join('\n\n'),
      });
      continue;
    }

    // 3. Hay llamadas y/o denials: ejecutar lo autorizado y devolver todo al modelo.
    callsUsed += calls.length;
    if (callsUsed > limits.maxCalls) {
      const error = { code: 'CALL_LIMIT_REACHED', message: 'Tool call limit reached.' };
      events.error(error);
      return { status: 'error', error, iterations, callsUsed };
    }

    workingMessages.push({ role: 'assistant', content: text });

    const results = [];

    for (let i = 0; i < calls.length; i += limits.maxParallel) {
      const batch = calls.slice(i, i + limits.maxParallel);
      const batchResults = await Promise.all(
        batch.map((call) => executeOne(call, { enabledTools, agentConfig, events, limits }))
      );
      results.push(...batchResults);
    }

    const denialResults = denials.map((d) => {
      events.toolDenied(d.id, d.tool, d.error);
      return formatToolResult({
        id: d.id,
        tool: d.tool,
        status: FGTP_STATUS.DENIED,
        error: d.error,
      });
    });

    const formatErrorResults = formatErrors.map((e) =>
      formatToolResult({
        id: e.id,
        tool: e.tool,
        status: FGTP_STATUS.ERROR,
        error: e.error,
      })
    );

    const allResultText = [
      ...results.map((r) => r.text),
      ...denialResults,
      ...formatErrorResults,
    ];

    if (allResultText.length === 0) {
      // Nada que devolver: evita bucle. No debería ocurrir dada la condición (3).
      const error = { code: 'EXECUTION_FAILED', message: 'No FGTP results to return.' };
      events.error(error);
      return { status: 'error', error, iterations, callsUsed };
    }

    workingMessages.push({
      role: 'user',
      content: allResultText.join('\n\n'),
    });
  }

  const error = { code: 'TIMEOUT', message: 'Agent iteration limit reached.' };
  events.error(error);
  return { status: 'error', error, iterations, callsUsed };
}

module.exports = { runAgent, DEFAULTS, resolveLimits, extractText };
