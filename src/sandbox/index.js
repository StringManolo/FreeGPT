'use strict';
const { execFile, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const BASE = path.join(REPO, '.sandbox');
const UDIR = process.env.UDOCKER_DIR || path.join(BASE, 'udocker');
const VENV = path.join(BASE, 'venv');
const LOCK = path.join(BASE, 'setup.lock');
const PY_COMPAT = path.join(REPO, 'scripts', 'python-compat');

// Modo de ejecución fijo: F1 (fakechroot). No usar otros modos.
const EXEC_MODE = 'F1';

// loader x64: suposición, sin probar
const ARCHS = {
  arm64: { platform: 'linux/arm64', loader: '/lib/ld-linux-aarch64.so.1', bundled: 'rootfs-aarch64.tar.gz' },
  x64:   { platform: 'linux/amd64', loader: '/lib64/ld-linux-x86-64.so.2', bundled: 'rootfs-x86_64.tar.gz' },
};
const DEFAULTS = {
  enabled: true,
  name: 'freegpt-agent',
  image: 'debian:bookworm-slim',
  packages: [], // dpkg no funciona en F1: los paquetes extra deben venir ya en el rootfs (scripts/build-rootfs.sh)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => Object.assign(new Error(m), { code: 'SANDBOX_UNAVAILABLE' });

// ---------- config ----------
const cfgOf = (agentConfig) => ({ ...DEFAULTS, ...(agentConfig && agentConfig.sandbox) });
const isOn = (agentConfig) => cfgOf(agentConfig).enabled !== false;
const needed = (agentConfig) =>
  isOn(agentConfig) && ['terminal', 'git'].some((t) => agentConfig?.tools?.[t]?.enabled === true);

// ---------- udocker ----------
function pythonPath() {
  // Parche de posix_spawn para los procesos Python hijos de udocker (no toca el Python global)
  return [PY_COMPAT, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
}

function bin() {
  const v = path.join(VENV, 'bin', 'udocker');
  if (fs.existsSync(v)) return v;
  const dirs = [...(process.env.PATH || '').split(':'), path.join(os.homedir(), '.local', 'bin')];
  for (const d of dirs) {
    const p = path.join(d, 'udocker');
    if (d && fs.existsSync(p)) return p;
  }
  return 'udocker';
}

const pre = () => (process.getuid && process.getuid() === 0 ? ['--allow-root'] : []);

const fullEnv = () => ({
  ...process.env,
  UDOCKER_DIR: UDIR,
  PYTHONPATH: pythonPath(),
  PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
});

const minimalEnv = () => ({
  PATH: process.env.PATH || '/usr/bin:/bin',
  HOME: os.homedir(),
  UDOCKER_DIR: UDIR,
  PYTHONPATH: pythonPath(),
  LANG: 'C',
});

const U = (args, o = {}) => spawnSync(bin(), [...pre(), ...args], { env: fullEnv(), encoding: 'utf8', ...o });

const exists = (n) => (U(['ps']).stdout || '').includes(`'${n}'`);
const rootOf = (n) => (U(['inspect', '-p', n]).stdout || '').trim();
const contDir = (n) => path.dirname(rootOf(n));

// udocker guarda el modo en <contenedor>/execmode
const modeOf = (n) => {
  try { return fs.readFileSync(path.join(contDir(n), 'execmode'), 'utf8').trim(); } catch { return ''; }
};

function preflight() {
  if (process.platform !== 'linux')
    throw fail(`el sandbox solo funciona en Linux (esto es ${process.platform}). Pon agent.sandbox.enabled: false para correr sin aislamiento.`);
  const a = ARCHS[process.arch];
  if (!a) throw fail(`arquitectura no soportada: ${process.arch}`);
  return a;
}

function installUdocker() {
  if (U(['version']).status !== 0) {
    if (spawnSync('python3', ['--version']).status !== 0)
      throw fail('falta python3 (Debian: apt install python3 python3-venv python3-pip curl)');
    fs.mkdirSync(BASE, { recursive: true });
    let r = spawnSync('python3', ['-m', 'venv', VENV], { encoding: 'utf8' });
    if (r.status === 0) r = spawnSync(path.join(VENV, 'bin', 'pip'), ['install', '--quiet', 'udocker'], { encoding: 'utf8' });
    if (r.status !== 0) r = spawnSync('python3', ['-m', 'pip', 'install', '--user', '--break-system-packages', 'udocker'], { encoding: 'utf8' });
    if (U(['version']).status !== 0)
      throw fail('no se pudo instalar udocker: ' + String(r.stderr || '').trim().split('\n').pop());
  }
  if (U(['install']).status !== 0) throw fail('udocker no pudo descargar sus herramientas (¿red? ¿curl instalado?)');
}

// ---------- verificación ----------
function fixLoader(name, a) {
  // setup a veces no genera ld.so.path y fakechroot sale en silencio (exit 252)
  const f = path.join(contDir(name), 'ld.so.path');
  if (!fs.existsSync(f) || fs.statSync(f).size === 0) fs.writeFileSync(f, a.loader);
}

// El fichero testigo está en el host: si dentro del contenedor se ve, no hay aislamiento.
function selftest(name) {
  if (modeOf(name) !== EXEC_MODE) return false; // nunca ejecutar fuera de F1
  const w = path.join(os.homedir(), `.fgpt-witness-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(w, '');
  try {
    const r = U(['run', '--nosysdirs', name, '/bin/sh', '-c',
      `if [ -e '${w}' ]; then echo LEAK; else echo ISOLATED; fi`], { timeout: 60000 });
    return r.status === 0 && /ISOLATED/.test(r.stdout) && !/LEAK/.test(r.stdout);
  } finally { fs.rmSync(w, { force: true }); }
}

// ¿se puede montar una ruta del host con la MISMA ruta dentro? (lo necesitan allow_paths)
function mountcheck(name) {
  const d = path.join(BASE, 'mounttest');
  fs.mkdirSync(d, { recursive: true });
  const m = crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(path.join(d, 'm'), m);
  const r = U(['-q', 'run', '--nosysdirs', '-v', `${d}:${d}`, `--workdir=${d}`, name, '/bin/cat', 'm'], { timeout: 60000 });
  return r.status === 0 && (r.stdout || '').trim() === m;
}

// ---------- paquetes ----------
// apt/dpkg dentro de F1 no funciona. Los paquetes extra (git, file) vienen ya instalados
// en el rootfs incluido, generado por scripts/build-rootfs.sh.
const packagesOk = () => true;
function ensurePackages(c) {
  if ((c.packages || []).length)
    console.warn('[freegpt] agent.sandbox.packages se ignora: dpkg no funciona en F1');
}

// ---------- creación ----------
function build(c, a, make) {
  const drop = () => { if (exists(c.name)) U(['rm', c.name]); };
  const r = make();
  if (r.status !== 0 || !exists(c.name)) { drop(); return false; }
  U(['setup', `--execmode=${EXEC_MODE}`, c.name]);
  fixLoader(c.name, a);
  if (!selftest(c.name)) { drop(); return false; }
  return true;
}

async function setup(c) {
  const a = preflight();
  installUdocker();
  if (exists(c.name)) {
    fixLoader(c.name, a);
    if (selftest(c.name)) { ensurePackages(c); return; }
    U(['rm', c.name]); // roto o fuera de F1: se recrea
  }
  const tar = path.join(REPO, 'sandbox', a.bundled);
  let ok = false;
  if (fs.existsSync(tar)) // rootfs incluido, solo si es de ESTA arquitectura
    ok = build(c, a, () => U(['import', '--tocontainer', `--name=${c.name}`, tar, 'freegpt-agent:bundled']));
  if (!ok) // fallback: imagen oficial para la arquitectura del usuario (sin git ni file)
    ok = build(c, a, () => {
      const p = U(['pull', `--platform=${a.platform}`, c.image]);
      return p.status === 0 ? U(['create', `--name=${c.name}`, c.image]) : p;
    });
  if (!ok) throw fail('no se pudo crear un sandbox que aísle de verdad.');
  if (!mountcheck(c.name)) {
    U(['rm', c.name]);
    throw fail('este udocker no permite montar rutas del host con la misma ruta (necesario para allow_paths).');
  }
  ensurePackages(c);
}

// ---------- lock y espera ----------
async function withLock(fn, timeoutMs = 600000) {
  fs.mkdirSync(BASE, { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(LOCK); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 900000) fs.rmSync(LOCK, { recursive: true }); } catch {}
      if (Date.now() - t0 > timeoutMs) throw fail('timeout esperando a que otro proceso termine de preparar el sandbox');
      await sleep(1000);
    }
  }
  try { return await fn(); } finally { fs.rmSync(LOCK, { recursive: true, force: true }); }
}

// ---------- API ----------
let pending = null;
let readyFor = null;
let failure = null;

function ensureReady(agentConfig) {
  const c = cfgOf(agentConfig);
  if (c.enabled === false)
    return Promise.resolve({ mode: 'host', warning: 'agent.sandbox.enabled=false: el agente corre SIN aislamiento' });
  if (failure && Date.now() - failure.at < 300000) return Promise.reject(failure.err); // no reintentar en bucle
  pending ??= (async () => {
    preflight();
    if (exists(c.name) && packagesOk(c) && selftest(c.name)) return; // ya listo
    await withLock(() => setup(c));
  })().then(
    () => { readyFor = c.name; failure = null; return { mode: 'udocker', name: c.name }; },
    (e) => { pending = null; failure = { err: e, at: Date.now() }; throw e; },
  );
  return pending;
}

// Sustituye a execFile para TODO proceso del agente. Si el sandbox está activo y no
// está listo, falla cerrado (nunca cae al host).
function execFileIn(agentConfig, mounts, cmd, args, opts, cb) {
  const c = cfgOf(agentConfig);
  if (c.enabled === false) return execFile(cmd, args, opts, cb);
  if (readyFor !== c.name) {
    cb(Object.assign(new Error('sandbox no preparado'), { code: 'SANDBOX_UNAVAILABLE' }), '', '');
    return null;
  }
  const vols = [...new Set(mounts || [])].flatMap((m) => ['-v', `${m}:${m}`]);
  const envs = Object.entries(opts.env || {})            // el entorno del host NO entra,
    .filter(([k]) => k !== 'HOME' && k !== 'PATH')       // solo lo que la tool pide explícitamente
    .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const full = [...pre(), '-q', 'run', '--nosysdirs', ...vols, ...envs, `--workdir=${opts.cwd}`, c.name, cmd, ...args];
  return execFile(bin(), full, { ...opts, env: minimalEnv() }, cb);
}

module.exports = { ensureReady, execFileIn, needed, isOn, selftest };
