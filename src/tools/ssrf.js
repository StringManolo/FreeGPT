'use strict';

const dns = require('dns').promises;
const net = require('net');

const BLOCKED_V4 = [
  // 0.0.0.0/8
  [/^0\./, 'this-network'],
  // 10.0.0.0/8
  [/^10\./, 'private'],
  // 100.64.0.0/10 (CGNAT)
  [/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, 'cgnat'],
  // 127.0.0.0/8
  [/^127\./, 'loopback'],
  // 169.254.0.0/16 (link-local, incluye metadata clouds)
  [/^169\.254\./, 'link-local'],
  // 172.16.0.0/12
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  // 192.0.0.0/24 (IETF)
  [/^192\.0\.0\./, 'ietf'],
  // 192.0.2.0/24 (TEST-NET-1)
  [/^192\.0\.2\./, 'test-net'],
  // 192.168.0.0/16
  [/^192\.168\./, 'private'],
  // 198.18.0.0/15 (benchmark)
  [/^198\.(1[89])\./, 'benchmark'],
  // 198.51.100.0/24 (TEST-NET-2)
  [/^198\.51\.100\./, 'test-net'],
  // 203.0.113.0/24 (TEST-NET-3)
  [/^203\.0\.113\./, 'test-net'],
  // 224.0.0.0/4 (multicast) y 240.0.0.0/4 (reservado)
  [/^(22[4-9]|23\d|24\d|25[0-5])\./, 'multicast-reserved'],
];

function checkIPv4(ip) {
  for (const [re, label] of BLOCKED_V4) {
    if (re.test(ip)) return label;
  }
  return null;
}

function checkIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return 'loopback';
  if (lower.startsWith('fe80:')) return 'link-local';
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return 'unique-local';
  // IPv4 mapeado (::ffff:a.b.c.d)
  const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return checkIPv4(m[1]);
  return null;
}

function classifyIP(ip) {
  const family = net.isIP(ip);
  if (family === 4) return checkIPv4(ip);
  if (family === 6) return checkIPv6(ip);
  return 'not-an-ip';
}

async function assertSafeUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const err = new Error(`Invalid URL: ${rawUrl}`);
    err.code = 'INVALID_URL';
    throw err;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`Only http/https URLs are allowed (got ${parsed.protocol}).`);
    err.code = 'INVALID_SCHEME';
    throw err;
  }

  const host = parsed.hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) {
    const err = new Error('localhost is not allowed.');
    err.code = 'SSRF_BLOCKED';
    throw err;
  }

  // Si es una IP literal, valídala directamente.
  if (net.isIP(host)) {
    const label = classifyIP(host);
    if (label) {
      const err = new Error(`Blocked IP range (${label}): ${host}`);
      err.code = 'SSRF_BLOCKED';
      throw err;
    }
    return { parsed, resolvedIp: host };
  }

  let records;
  try {
    records = await dns.lookup(host, { all: true });
  } catch (e) {
    const err = new Error(`DNS lookup failed for ${host}: ${e.message}`);
    err.code = 'DNS_FAILED';
    throw err;
  }

  for (const rec of records) {
    const label = classifyIP(rec.address);
    if (label) {
      const err = new Error(`DNS resolves to blocked range (${label}): ${host} → ${rec.address}`);
      err.code = 'SSRF_BLOCKED';
      throw err;
    }
  }

  return { parsed, resolvedIp: records[0]?.address || null };
}

module.exports = { assertSafeUrl, classifyIP };
