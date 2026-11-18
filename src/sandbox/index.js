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

/* Patch python bug unable to use curl on spawn of new process */
const PY_COMPAT = path.join(REPO, 'scripts', 'python-compat');
function pythonPath() {
  return [
    PY_COMPAT,
    process.env.PYTHONPATH
  ].filter(Boolean).join(path.delimiter);
}

// loader x64: suposición mía, sin probar
const ARCHS = {
  arm64: { platform: 'linux/arm64', loader: '/lib/ld-linux-aarch64.so.1', bundled: 'rootfs-aarch64.tar.gz' },
  x64:   { platform: 'linux/amd64', loader: '/lib64/ld-linux-x86-64.so.2', bundled: 'rootfs-x86_64.tar.gz' },
};
const DEFAULTS = { enabled: true, name: 'freegpt-agent', image: 'debian:bookworm-slim', packages: ['git', 'file'] };
const PKG_RE = /^[a-z0-9][a-z0-9+.-]*$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => Object.assign(new Error(m), { code: 'SANDBOX_UNAVAILABLE' });

// ---------- config ----------
const cfgOf = (agentConfig) => ({ ...DEFAULTS, ...(agentConfig && agentConfig.sandbox) });
const isOn = (agentConfig) => cfgOf(agentConfig).enabled !== false;
const needed = (agentConfig) =>
  isOn(agentConfig) && ['terminal', 'git'].some((t) => agentConfig?.tools?.[t]?.enabled === true);

// ---------- udocker ----------
function bin() {
  const v = path.join(VENV, 'bin', 'udocker');
  if (fs.existsSync(v)) return v;
  const dirs = [...(process.env.PATH || '').split(':'), path.join(os.homedir(), '.local', 'bin')];
  for (const d of dirs) { const p = path.join(d, 'udocker'); if (d && fs.existsSync(p)) return p; }
  return 'udocker';
}
const pre = () => (process.getuid && process.getuid() === 0 ? ['--allow-root'] : []);
/*const fullEnv = () => ({ ...process.env, UDOCKER_DIR: UDIR, PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}` });
const minimalEnv = () => ({ PATH: process.env.PATH || '/usr/bin:/bin', HOME: os.homedir(), UDOCKER_DIR: UDIR, LANG: 'C' });*/
const fullEnv = () => ({
  ...process.env,
  UDOCKER_DIR: UDIR,
  PATH: `${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
  PYTHONPATH: pythonPath()
});

const minimalEnv = () => ({
  PATH: process.env.PATH || '/usr/bin:/bin',
  HOME: os.homedir(),
  UDOCKER_DIR: UDIR,
  LANG: 'C',
  PYTHONPATH: pythonPath()
});
const U = (args, o = {}) => spawnSync(bin(), [...pre(), ...args], { env: fullEnv(), encoding: 'utf8', ...o });

const exists = (n) => (U(['ps']).stdout || '').includes(`'${n}'`);
const rootOf = (n) => (U(['inspect', '-p', n]).stdout || '').trim();
const contDir = (n) => path.dirname(rootOf(n));

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
    if (U(['version']).status !== 0) throw fail('no se pudo instalar udocker: ' + String(r.stderr || '').trim().split('\n').pop());
  }
  if (U(['install']).status !== 0) throw fail('udocker no pudo descargar sus herramientas (¿red? ¿curl instalado?)');
}

// ---------- verificación ----------
function fixLoader(name, a) {
  // setup a veces no genera ld.so.path y fakechroot sale en silencio (exit 252)
  const f = path.join(contDir(name), 'ld.so.path');
  if (!fs.existsSync(f) || fs.statSync(f).size === 0) fs.writeFileSync(f, a.loader);
}

function selftest(name) {
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

// ---------- paquetes dentro del contenedor ----------
const wanted = (c) => [...new Set(c.packages || [])].sort();
const markerOf = (name) => path.join(contDir(name), '.fgpt-packages');
const packagesOk = (c) => {
  const pk = wanted(c);
  if (!pk.length) return true;
  try { return fs.readFileSync(markerOf(c.name), 'utf8') === pk.join(' '); } catch { return false; }
};
function ensurePackages(c) {
  const pk = wanted(c);
  if (!pk.length || packagesOk(c)) return;
  for (const p of pk) if (!PKG_RE.test(p)) throw fail(`nombre de paquete no válido: ${p}`);
  const want = pk.join(' ');
  const r = U(['run', '--nosysdirs', c.name, '/bin/sh', '-c',
    `apt-get update && apt-get install -y --no-install-recommends ${want} && rm -rf /var/lib/apt/lists/*`], { timeout: 900000 });
  if (r.status !== 0) throw fail(`no se pudieron instalar paquetes en el sandbox (${want}): ` +
    String(r.stderr || '').trim().split('\n').slice(-3).join(' | '));
  fs.writeFileSync(markerOf(c.name), want);
}

// ---------- creación ----------
function slim(name) {
  const r = rootOf(name);
  for (const p of ['usr/share/doc', 'usr/share/man', 'usr/share/info', 'usr/share/locale'])
    fs.rmSync(path.join(r, p), { recursive: true, force: true });
  for (const p of ['var/cache/apt', 'var/lib/apt/lists', 'var/log']) {
    const d = path.join(r, p);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(r, 'etc/apt/apt.conf.d'), { recursive: true });
  fs.writeFileSync(path.join(r, 'etc/apt/apt.conf.d/99root'), 'APT::Sandbox::User "root";\n');
}

function build(c, a, make, doSlim) {
  const drop = () => { if (exists(c.name)) U(['rm', c.name]); };
  const r = make();
  if (r.status !== 0 || !exists(c.name)) { drop(); return false; }
  U(['setup', '--execmode=F1', c.name]);
  fixLoader(c.name, a);
  if (doSlim) slim(c.name);
  if (!selftest(c.name)) { drop(); return false; }
  return true;
}

async function setup(c) {
  const a = preflight();
  installUdocker();
  if (exists(c.name)) {
    fixLoader(c.name, a);
    if (selftest(c.name)) { ensurePackages(c); return; }
    U(['rm', c.name]); // roto: se recrea
  }
  const tar = path.join(REPO, 'sandbox', a.bundled);
  let ok = false;
  if (fs.existsSync(tar)) // rootfs incluido, solo si es de ESTA arquitectura
    ok = build(c, a, () => U(['import', '--tocontainer', `--name=${c.name}`, tar, 'freegpt-agent:bundled']), false);
  if (!ok) // fallback: imagen oficial para la arquitectura del usuario
    ok = build(c, a, () => {
      const p = U(['pull', `--platform=${a.platform}`, c.image]);
      return p.status === 0 ? U(['create', `--name=${c.name}`, c.image]) : p;
    }, true);
  if (!ok) throw fail('no se pudo crear un sandbox que aísle de verdad.');
  if (!mountcheck(c.name)) { U(['rm', c.name]); throw fail('este udocker no permite montar rutas del host con la misma ruta (necesario para allow_paths).'); }
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
let pending = null, readyFor = null, failure = null;

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
    .filter(([k]) => k !== 'HOME' && k !== 'PATH')       // solo lo que el tool pide explícitamente
    .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const full = [...pre(), '-q', 'run', '--nosysdirs', ...vols, ...envs, `--workdir=${opts.cwd}`, c.name, cmd, ...args];
  return execFile(bin(), full, { ...opts, env: minimalEnv() }, cb);
}

module.exports = { ensureReady, execFileIn, needed, isOn, selftest };
