'use strict';

const {
  FGTP,
  FGTP_STATUS,
  FGTP_ERROR_CODES,
  validateToolCallShape,
} = require('./protocol');

function toSet(value, name) {
  if (value === undefined || value === null) return null;
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  throw new TypeError(`${name} must be a Set, an array, or null/undefined.`);
}

// Determina el status FGTP a partir del código de error.
// Permiso → denied. Formato/validación → error.
function statusForCode(code) {
  switch (code) {
    case FGTP_ERROR_CODES.TOOL_DISABLED:
    case FGTP_ERROR_CODES.PERMISSION_DENIED:
      return FGTP_STATUS.DENIED;
    default:
      return FGTP_STATUS.ERROR;
  }
}

function longestSuffixPrefix(text, tag) {
  const max = Math.min(text.length, tag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

class FgtpParser {
  constructor(options = {}) {
    this.options = options;
    this.knownTools = toSet(options.knownTools, 'knownTools');
    this.enabledTools = toSet(options.enabledTools, 'enabledTools');

    this.maxCalls =
      Number.isInteger(options.maxCalls) && options.maxCalls >= 0
        ? options.maxCalls
        : Infinity;

    this.buffer = '';
    this.calls = [];
    this.errors = [];
    this.textParts = [];
    this.incomplete = false;
    this.ended = false;
  }

  push(chunk) {
    if (this.ended) throw new Error('Cannot push data into an ended FGTP parser.');
    this.buffer += String(chunk ?? '');
    this._drain(false);
    return this.snapshot();
  }

  end() {
    if (!this.ended) {
      this._drain(true);
      this.ended = true;
    }
    return this.snapshot();
  }

  snapshot() {
    const formatErrors = [];
    const denials = [];
    for (const e of this.errors) {
      if (e.status === FGTP_STATUS.DENIED) denials.push(e);
      else formatErrors.push(e);
    }
    return {
      calls: this.calls.slice(),
      errors: this.errors.slice(),
      formatErrors,
      denials,
      text: this.textParts.join(''),
      hasToolCalls: this.calls.length > 0,
      hasFormatErrors: formatErrors.length > 0,
      hasDenials: denials.length > 0,
      incomplete: this.incomplete,
      ended: this.ended,
    };
  }

  _drain(final) {
    while (true) {
      const openIndex = this.buffer.indexOf(FGTP.OPEN_TOOL_CALL);

      if (openIndex === -1) {
        if (final) {
          this._pushText(this.buffer);
          this.buffer = '';
          return;
        }
        const keep = longestSuffixPrefix(this.buffer, FGTP.OPEN_TOOL_CALL);
        if (keep === 0) {
          this._pushText(this.buffer);
          this.buffer = '';
        } else {
          const emit = this.buffer.slice(0, -keep);
          this._pushText(emit);
          this.buffer = this.buffer.slice(-keep);
        }
        return;
      }

      if (openIndex > 0) {
        this._pushText(this.buffer.slice(0, openIndex));
        this.buffer = this.buffer.slice(openIndex);
      }

      const closeIndex = this.buffer.indexOf(
        FGTP.CLOSE_TOOL_CALL,
        FGTP.OPEN_TOOL_CALL.length
      );

      if (closeIndex === -1) {
        this.incomplete = !final;
        if (final) {
          this._addError({
            code: FGTP_ERROR_CODES.INVALID_SCHEMA,
            message: 'Incomplete FGTP tool call block.',
          });
          this.buffer = '';
          this.incomplete = false;
        }
        return;
      }

      const jsonText = this.buffer.slice(
        FGTP.OPEN_TOOL_CALL.length,
        closeIndex
      );
      this.buffer = this.buffer.slice(closeIndex + FGTP.CLOSE_TOOL_CALL.length);
      this._parseBlock(jsonText);
    }
  }

  _pushText(text) {
    if (text) this.textParts.push(text);
  }

  _parseBlock(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      this._addError({
        code: FGTP_ERROR_CODES.INVALID_JSON,
        message: 'Invalid FGTP tool call JSON.',
      });
      return;
    }

    const validation = validateToolCallShape(parsed);
    if (!validation.ok) {
      this._addError({
        code: validation.code,
        message: validation.message,
        id: validation.id,
        tool: validation.tool,
      });
      return;
    }

    const call = validation.call;

    if (this.knownTools && !this.knownTools.has(call.tool)) {
      this._addError({
        code: FGTP_ERROR_CODES.UNKNOWN_TOOL,
        message: `Unknown FGTP tool: ${call.tool}`,
        id: call.id,
        tool: call.tool,
      });
      return;
    }

    if (this.enabledTools && !this.enabledTools.has(call.tool)) {
      this._addError({
        code: FGTP_ERROR_CODES.TOOL_DISABLED,
        message: `FGTP tool is disabled for this conversation: ${call.tool}`,
        id: call.id,
        tool: call.tool,
      });
      return;
    }

    if (this.calls.length >= this.maxCalls) {
      this._addError({
        code: FGTP_ERROR_CODES.CALL_LIMIT_REACHED,
        message: 'FGTP tool call limit reached.',
        id: call.id,
        tool: call.tool,
      });
      return;
    }

    if (typeof this.options.validateCall === 'function') {
      let extraValidation;
      try {
        extraValidation = this.options.validateCall(call);
      } catch (error) {
        this._addError({
          code: FGTP_ERROR_CODES.INVALID_SCHEMA,
          message: error.message || 'FGTP tool call validation failed.',
          id: call.id,
          tool: call.tool,
        });
        return;
      }
      if (extraValidation && extraValidation.ok === false) {
        this._addError({
          code: extraValidation.code || FGTP_ERROR_CODES.INVALID_SCHEMA,
          message: extraValidation.message || 'Invalid FGTP tool call.',
          id: call.id,
          tool: call.tool,
        });
        return;
      }
    }

    this.calls.push(call);
  }

  _addError({ code, message, id = null, tool = null }) {
    this.errors.push({
      id: id ?? null,
      tool: tool ?? null,
      status: statusForCode(code),
      error: { code, message },
    });
  }
}

function parseFgtp(text, options = {}) {
  const parser = new FgtpParser(options);
  parser.push(text);
  return parser.end();
}

module.exports = {
  FgtpParser,
  parseFgtp,
};
