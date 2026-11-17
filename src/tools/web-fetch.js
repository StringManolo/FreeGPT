'use strict';

const { registerTool } = require('./registry');
const { assertSafeUrl } = require('./ssrf');

const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15000;
const MAX_TEXT = 32 * 1024;

/**
 * Combina varios AbortSignal en uno. Prefiere AbortSignal.any (Node 20.3+),
 * con fallback manual para versiones anteriores.
 */
function combineSignals(...signals) {
  const valid = signals.filter(Boolean);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(valid);

  const controller = new AbortController();
  for (const s of valid) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|article|section|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchWithRedirects(startUrl, externalSignal) {
  let current = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const { parsed } = await assertSafeUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const signal = combineSignals(controller.signal, externalSignal);

    let res;
    try {
      res = await fetch(parsed.toString(), {
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': 'FreeGPT/0.1 (+https://github.com/)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirect ${res.status} without Location header.`);
      current = new URL(loc, parsed).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${parsed.toString()}`);
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/') && !ct.includes('html') && !ct.includes('json') && !ct.includes('xml')) {
      throw new Error(`Unsupported content-type: ${ct || 'unknown'}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Empty response body.');

    const chunks = [];
    let received = 0;
    while (true) {
      if (externalSignal && externalSignal.aborted) {
        try { await reader.cancel(); } catch {}
        throw Object.assign(new Error('Fetch cancelled by client.'), { code: 'CANCELLED' });
      }
      const { value, done } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_BYTES) {
        try { await reader.cancel(); } catch {}
        break;
      }
      chunks.push(value);
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    const text = ct.includes('html') ? htmlToText(raw) : raw;

    return {
      url: parsed.toString(),
      status: res.status,
      contentType: ct,
      truncated: received > MAX_BYTES || text.length > MAX_TEXT,
      text: text.slice(0, MAX_TEXT),
    };
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS}).`);
}

registerTool({
  name: 'web_fetch',
  description:
    'Fetch a public HTTP/HTTPS URL and return readable text. ' +
    'Useful for reading documentation, articles or API responses. ' +
    'Blocked: localhost, loopback, private networks, link-local.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL to fetch.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  validate(args) {
    if (!args || typeof args.url !== 'string' || args.url.trim() === '') {
      return { ok: false, code: 'INVALID_SCHEMA', message: '"url" must be a non-empty string.' };
    }
    return { ok: true };
  },
  async execute(args, ctx) {
    return await fetchWithRedirects(args.url.trim(), ctx && ctx.signal);
  },
});

module.exports = { htmlToText, combineSignals };
