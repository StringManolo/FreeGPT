'use strict';
const fs = require('node:fs');
const yaml = require('js-yaml');
const { REAL_CONFIG, DEMO_CONFIG } = require('../src/config/paths');
const sandbox = require('../src/sandbox');

if (process.env.FREEGPT_SKIP_SANDBOX === '1') process.exit(0);

let agent = {};
try {
  const f = fs.existsSync(REAL_CONFIG) ? REAL_CONFIG : DEMO_CONFIG;
  agent = (yaml.load(fs.readFileSync(f, 'utf8')) || {}).agent || {};
} catch {}

if (!sandbox.needed(agent)) { console.log('[freegpt] sandbox no necesario (desactivado o sin tools terminal/git)'); process.exit(0); }

console.log('[freegpt] preparando sandbox del agente (puede tardar unos minutos)…');
sandbox.ensureReady(agent).then(
  (r) => console.log(`[freegpt] sandbox listo (${r.name})`),
  (e) => console.warn(`[freegpt] sandbox NO preparado: ${e.message}\n  Se reintentará al arrancar; hasta entonces las tools terminal/git fallarán.`),
);
