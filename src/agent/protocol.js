'use strict';

const FGTP = Object.freeze({
  OPEN_TOOL_CALL: '<fgpt:tool_call>',
  CLOSE_TOOL_CALL: '</fgpt:tool_call>',
  OPEN_TOOL_RESULT: '<fgpt:tool_result>',
  CLOSE_TOOL_RESULT: '</fgpt:tool_result>',
});

const FGTP_STATUS = Object.freeze({
  SUCCESS: 'success',
  ERROR: 'error',
  DENIED: 'denied',
});

const FGTP_ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON',
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  TOOL_DISABLED: 'TOOL_DISABLED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  RESULT_TOO_LARGE: 'RESULT_TOO_LARGE',
  CALL_LIMIT_REACHED: 'CALL_LIMIT_REACHED',
  TIMEOUT: 'TIMEOUT',
});

const TOOL_CALL_KEYS = Object.freeze(['id', 'tool', 'arguments']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validateToolCallShape(value) {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: FGTP_ERROR_CODES.INVALID_SCHEMA,
      message: 'FGTP tool call must be a JSON object.',
      id: null,
      tool: null,
    };
  }

  const keys = Object.keys(value);
  const extraKeys = keys.filter((key) => !TOOL_CALL_KEYS.includes(key));

  if (extraKeys.length > 0) {
    return {
      ok: false,
      code: FGTP_ERROR_CODES.INVALID_SCHEMA,
      message: `Unexpected FGTP tool call properties: ${extraKeys.join(', ')}`,
      id: typeof value.id === 'string' ? value.id : null,
      tool: typeof value.tool === 'string' ? value.tool : null,
    };
  }

  if (typeof value.id !== 'string' || value.id.trim() === '') {
    return {
      ok: false,
      code: FGTP_ERROR_CODES.INVALID_SCHEMA,
      message: 'FGTP tool call requires a non-empty string "id".',
      id: null,
      tool: typeof value.tool === 'string' ? value.tool : null,
    };
  }

  if (typeof value.tool !== 'string' || value.tool.trim() === '') {
    return {
      ok: false,
      code: FGTP_ERROR_CODES.INVALID_SCHEMA,
      message: 'FGTP tool call requires a non-empty string "tool".',
      id: value.id,
      tool: null,
    };
  }

  if (!isPlainObject(value.arguments)) {
    return {
      ok: false,
      code: FGTP_ERROR_CODES.INVALID_SCHEMA,
      message: 'FGTP tool call requires an object "arguments".',
      id: value.id,
      tool: value.tool,
    };
  }

  return {
    ok: true,
    call: {
      id: value.id,
      tool: value.tool,
      arguments: value.arguments,
    },
  };
}

function formatToolCall(call) {
  const validation = validateToolCallShape(call);

  if (!validation.ok) {
    const error = new Error(validation.message);
    error.code = validation.code;
    throw error;
  }

  return [
    FGTP.OPEN_TOOL_CALL,
    JSON.stringify(validation.call),
    FGTP.CLOSE_TOOL_CALL,
  ].join('\n');
}

function formatToolResult(input = {}) {
  const {
    id = null,
    tool = null,
    status,
    result,
    error,
  } = input;

  if (!Object.values(FGTP_STATUS).includes(status)) {
    throw new TypeError(`Invalid FGTP tool result status: ${status}`);
  }

  const payload = {
    id: id ?? null,
    tool: tool ?? null,
    status,
  };

  if (status === FGTP_STATUS.SUCCESS) {
    payload.result = result === undefined ? null : result;
  } else {
    const defaultCode =
      status === FGTP_STATUS.DENIED
        ? FGTP_ERROR_CODES.PERMISSION_DENIED
        : FGTP_ERROR_CODES.EXECUTION_FAILED;

    const defaultMessage =
      status === FGTP_STATUS.DENIED
        ? 'Tool call denied.'
        : 'Tool execution failed.';

    payload.error = isPlainObject(error)
      ? {
          code: error.code || defaultCode,
          message: error.message || defaultMessage,
        }
      : {
          code: defaultCode,
          message: defaultMessage,
        };
  }

  return [
    FGTP.OPEN_TOOL_RESULT,
    JSON.stringify(payload),
    FGTP.CLOSE_TOOL_RESULT,
  ].join('\n');
}

module.exports = {
  FGTP,
  FGTP_STATUS,
  FGTP_ERROR_CODES,
  TOOL_CALL_KEYS,
  isPlainObject,
  validateToolCallShape,
  formatToolCall,
  formatToolResult,
};
