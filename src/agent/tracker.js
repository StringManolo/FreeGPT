'use strict';

// Observabilidad opt-in de tool calls del agente en consola.
// Se activa con `--track-agent` en el CLI (que exporta FREEGPT_TRACK_AGENT=1)
// o directamente si `--track-agent` aparece en process.argv.

function isTracking() {
  if (process.env.FREEGPT_TRACK_AGENT === '1') return true;
  if (process.argv.includes('--track-agent')) {
    process.env.FREEGPT_TRACK_AGENT = '1';
    return true;
  }
  return false;
}

// Color solo si estamos en un TTY y no hay NO_COLOR.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = useColor
  ? {
      dim:    (s) => `\x1b[2m${s}\x1b[0m`,
      bold:   (s) => `\x1b[1m${s}\x1b[0m`,
      red:    (s) => `\x1b[31m${s}\x1b[0m`,
      green:  (s) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s) => `\x1b[33m${s}\x1b[0m`,
      cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
    }
  : new Proxy({}, { get: () => (s) => String(s) });

function now() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function fmtStr(s) {
  return JSON.stringify(truncate(s, 120));
}

function fmtVal(v) {
  if (typeof v === 'string') return fmtStr(v);
  if (Array.isArray(v)) return '[' + v.map(fmtVal).join(', ') + ']';
  if (v && typeof v === 'object') return truncate(JSON.stringify(v), 120);
  return String(v);
}

function formatToolArgs(tool, args) {
  if (!args || typeof args !== 'object') return '';
  if (tool === 'terminal') {
    if (!args.command) return '';
    const parts = [fmtStr(args.command)];
    if (Array.isArray(args.args)) parts.push(...args.args.map(fmtVal));
    if (args.cwd) parts.push(`(cwd=${fmtStr(args.cwd)})`);
    return parts.join(' ');
  }
  if (tool === 'git') {
    const op = args.operation || '?';
    const cwd = args.cwd ? ` (cwd=${fmtStr(args.cwd)})` : '';
    return `${op}${cwd}`;
  }
  if (tool === 'filesystem') {
    const op = args.operation || '?';
    const path = args.path ? ` ${fmtStr(args.path)}` : '';
    const pattern = args.pattern ? ` pattern=${fmtStr(args.pattern)}` : '';
    return `${op}${path}${pattern}`;
  }
  if (tool === 'web_fetch') return fmtStr(args.url || '');
  if (tool === 'web_search') return fmtStr(args.query || '');
  const parts = [];
  for (const [k, v] of Object.entries(args)) parts.push(`${k}=${fmtVal(v)}`);
  return parts.join(' ');
}

function prefix() {
  return C.dim(`[agent ${now()}]`);
}

function logDeny(tool, message) {
  if (!isTracking()) return;
  console.log(`${prefix()} ${C.yellow('⊘')} ${tool} ${C.dim('blocked:')} ${C.yellow(message || 'denied')}`);
}

function logStart(tool, args) {
  if (!isTracking()) return;
  const formatted = formatToolArgs(tool, args);
  const suffix = formatted ? ' ' + C.cyan(formatted) : '';
  console.log(`${prefix()} ${C.yellow('→')} ${C.bold(tool)}${suffix}`);
}

function logOk(tool, ms, result) {
  if (!isTracking()) return;
  let bytes = '?';
  try { bytes = Buffer.byteLength(JSON.stringify(result === undefined ? null : result)); } catch {}
  console.log(`${prefix()} ${C.green('✓')} ${tool} ${C.dim(`(${ms}ms, ${bytes}b)`)}`);
}

function logFail(tool, ms, message) {
  if (!isTracking()) return;
  console.log(`${prefix()} ${C.red('✗')} ${tool} ${C.dim(`(${ms}ms)`)}${message ? ': ' + C.red(message) : ''}`);
}

module.exports = { isTracking, formatToolArgs, logDeny, logStart, logOk, logFail };
