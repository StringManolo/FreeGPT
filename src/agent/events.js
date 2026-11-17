'use strict';

function createEventEmitter(sink) {
  const emit = (evt) => {
    if (typeof sink === 'function') {
      try {
        sink(evt);
      } catch {
        /* nunca romper el bucle por un fallo del sink */
      }
    }
  };

  return {
    started: () => emit({ type: 'agent.started' }),
    thinking: () => emit({ type: 'agent.thinking' }),
    toolStarted: (id, tool) => emit({ type: 'tool.started', id, tool }),
    toolCompleted: (id, tool) => emit({ type: 'tool.completed', id, tool }),
    toolFailed: (id, tool, error) =>
      emit({ type: 'tool.failed', id, tool, error: error || null }),
    toolDenied: (id, tool, error) =>
      emit({ type: 'tool.denied', id, tool, error: error || null }),
    completed: (content) => emit({ type: 'agent.completed', content }),
    error: (error) => emit({ type: 'agent.error', error: error || null }),
    cancelled: () => emit({ type: 'agent.cancelled' }),
  };
}

module.exports = { createEventEmitter };
