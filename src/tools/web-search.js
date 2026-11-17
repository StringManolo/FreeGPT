'use strict';

const { registerTool } = require('./registry');
const { assertSafeUrl } = require('./ssrf');
const { htmlToText, combineSignals } = require('./web-fetch');

const TIMEOUT_MS = 15000;
const MAX_RESULTS = 8;

function parseDuckDuckGo(html) {
  const results = [];
  // Cada resultado viene en <a class="result__a" href="...">TITLE</a>
  // seguido de un <a class="result__snippet">SNIPPET</a>.
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;

  let m;
  while ((m = re.exec(html)) !== null && results.length < MAX_RESULTS) {
    let rawHref = m[1];
    // DDG a veces envuelve con //duckduckgo.com/l/?uddg=...
    if (rawHref.startsWith('//duckduckgo.com/l/?')) {
      try {
        const u = new URL('https:' + rawHref);
        const real = u.searchParams.get('uddg');
        if (real) rawHref = real;
      } catch {}
    }
    const url = rawHref.startsWith('http') ? rawHref : null;
    if (!url) continue;
    const title = htmlToText(m[2] || '').trim();
    const snippet = htmlToText(m[3] || '').trim();
    if (!title) continue;
    results.push({ title, url, snippet });
  }
  return results;
}

async function search(query, externalSignal) {
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  await assertSafeUrl(target);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signal = combineSignals(controller.signal, externalSignal);

  let res;
  try {
    res = await fetch(target, {
      signal,
      headers: {
        'User-Agent': 'FreeGPT/0.1',
        Accept: 'text/html',
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  return parseDuckDuckGo(html);
}

registerTool({
  name: 'web_search',
  description:
    'Search the web via DuckDuckGo. Returns a list of results with title, url and snippet. ' +
    'Use web_fetch afterwards to read the full content of a result.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  validate(args) {
    if (!args || typeof args.query !== 'string' || args.query.trim() === '') {
      return { ok: false, code: 'INVALID_SCHEMA', message: '"query" must be a non-empty string.' };
    }
    if (args.query.length > 500) {
      return { ok: false, code: 'INVALID_SCHEMA', message: 'Query too long (max 500 chars).' };
    }
    return { ok: true };
  },
  async execute(args, ctx) {
    const pages = await search(args.query.trim(), ctx && ctx.signal);
    return { query: args.query, pages };
  },
});
