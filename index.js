/**
 * FastVpsViewer — host half.
 *
 * Opens an on-demand Openbox desktop on a remote VPS over SSH and serves a
 * noVNC viewer on a loopback port of its own, so the DSH client can embed it
 * in the right sidebar without touching the application origin.
 *
 * Lifecycle: idle → starting → running → stopping → idle
 * Nothing runs on the remote host unless a session is requested.
 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '0.1.0';

export const name = 'fast-vps-viewer';
export const inject = [];

const DEFAULTS = {
  sshHost: 'my-vps',
  sshOptions: [],
  sshUser: '',
  sshPort: 22,
  auth: 'agent',
  identityFile: '',
  password: '',
  display: 1,
  vncPort: 0,
  viewerPort: 19600,
  geometry: '1600x900',
  autoResize: true,
  maximize: true,
  filesRoot: '~',
  uploadDir: '~/Downloads',
  desktop: 'openbox',
  startupCommands: ['browser'],
  apps: [],
  idleMinutes: 1,
  maxSessionMinutes: 120,
  remoteIdleSeconds: 3600,
};

const SETTINGS_FILE = path.join(os.homedir(), '.dsh', 'fast-vps-viewer.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export function apply(ctx, rawConfig) {
  const controller = new Controller(ctx, rawConfig);
  ctx.effect(() => {
    controller.begin();
    return () => controller.dispose();
  });
  return controller;
}

class Controller {
  constructor(ctx, rawConfig) {
    this.ctx = ctx;
    this.baseConfig = rawConfig || {};
    this.stored = readSettings();
    this.cfg = normalizeConfig({ ...this.baseConfig, ...this.stored });
    this.childEnv = askpassEnv(this.cfg);
    this.phase = 'idle';
    this.error = null;
    this.startedAt = 0;
    this.viewerPort = 0;
    this.token = '';
    this.tunnel = null;
    this.tunnelPort = 0;
    this.wsClients = 0;
    this.idleTimer = null;
    this.maxTimer = null;
    this.server = null;
    this.starting = null;
    this.logs = [];
    this.log = (line) => this.pushLog(line);
  }

  /* ─────────────────────────── lifecycle ─────────────────────────── */

  begin() {
    this.bindServer().catch((err) => {
      this.error = describeError(err);
      this.phase = 'error';
      this.log(`server failed: ${this.error}`);
      safeLog(this.ctx, 'error', `[fast-vps-viewer] ${this.error}`);
    });
  }

  async dispose() {
    this.clearTimers();
    if (this.aux) { try { this.aux.kill('SIGTERM'); } catch { /* gone */ } this.aux = null; }
    if (this.auxPath) { try { fs.unlinkSync(this.auxPath); } catch { /* gone */ } }
    await this.stop({ reason: 'dispose', quiet: true }).catch(() => {});
    await new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      setTimeout(resolve, 500).unref?.();
    });
    this.server = null;
  }

  async bindServer() {
    const start = this.cfg.viewerPort;
    for (let port = start; port < start + 20; port += 1) {
      const server = await tryListen(port);
      if (server) {
        this.server = server;
        this.viewerPort = port;
        this.attachRoutes(server);
        this.log(`viewer listening on 127.0.0.1:${port}`);
        return;
      }
    }
    throw new Error(`no free viewer port in ${start}..${start + 19}`);
  }

  attachRoutes(server) {
    server.on('request', (req, res) => this.handleRequest(req, res));
    server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  /* ─────────────────────────── start / stop ─────────────────────── */

  async ensureRunning(startupOverride) {
    if (this.phase === 'running') return this.statusPayload();
    if (this.phase === 'starting' && this.starting) return this.starting;
    this.phase = 'starting';
    this.error = null;
    this.starting = this.startSession(startupOverride)
      .then((payload) => {
        this.phase = 'running';
        this.startedAt = Date.now();
        this.token = crypto.randomBytes(18).toString('hex');
        this.armTimers();
        this.log(`session running on ${this.cfg.sshHost} display :${this.cfg.display}`);
        return this.statusPayload();
      })
      .catch((err) => {
        this.phase = 'error';
        this.error = describeError(err);
        this.log(`start failed: ${this.error}`);
        throw err;
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  async startSession(startupOverride) {
    const cfg = startupOverride === undefined
      ? this.cfg
      : { ...this.cfg, startupCommands: startupOverride };
    const vncPort = cfg.vncPort || 5900 + cfg.display;
    this.vncPort = vncPort;

    const xstartup = buildXstartup(cfg);
    const b64 = Buffer.from(xstartup, 'utf8').toString('base64');
    const startCmd = [
      `vncserver :${cfg.display}`,
      `-geometry ${cfg.geometry}`,
      '-depth 24',
      '-localhost yes',
      '-SecurityTypes None',
      `-rfbport ${vncPort}`,
      '-xstartup ~/.fast-vps-viewer/xstartup.sh',
      '-desktop FastVpsViewer',
      '-autokill yes',
      cfg.remoteIdleSeconds > 0 ? `-MaxIdleTime ${cfg.remoteIdleSeconds}` : '',
    ].filter(Boolean).join(' ');

    // A single multiplexed SSH connection carries every command and the tunnel,
    // so a session costs one TCP connection instead of a burst of short ones.
    this.tunnelPort = await freePort();
    this.controlPath = controlPathFor(this.cfg.display);
    let masterErr = '';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      masterErr = await this.startMaster(vncPort);
      if (this.tunnel) break;
      if (attempt === 3) {
        throw new Error(`ssh 连接失败：${tailText(masterErr) || '控制连接没有建立（认证失败或被拒绝）'}`);
      }
      this.log(`ssh master attempt ${attempt} failed, retrying: ${tailText(masterErr)}`);
      await sleep(1500);
    }

    // One multiplexed round-trip: probe, write xstartup, start the session.
    const script = [
      'if ! command -v vncserver >/dev/null 2>&1; then echo __FVV_MISSING__; exit 0; fi',
      'mkdir -p ~/.fast-vps-viewer',
      `printf %s '${b64}' | base64 -d > ~/.fast-vps-viewer/xstartup.sh`,
      'chmod +x ~/.fast-vps-viewer/xstartup.sh',
      'vncserver -cleanstale >/dev/null 2>&1 || true',
      `vncserver ${startCmd.slice('vncserver '.length)} > ~/.fast-vps-viewer/start.log 2>&1`,
      'rc=$?',
      'tail -3 ~/.fast-vps-viewer/start.log',
      'echo "__FVV_EXIT__$rc"',
    ].join('\n');

    const res = await sshExec(cfg, script, 60000, this.controlPath, this.childEnv);
    if (res.code === 255 && !res.stdout.includes('__FVV_MISSING__')) {
      throw new Error(`ssh 连接失败：${tailText(res.stderr) || '连接被拒绝或认证失败'}`);
    }
    if (res.stdout.includes('__FVV_MISSING__')) {
      throw new Error('远端缺少 TigerVNC。请先执行：apt install -y tigervnc-standalone-server openbox');
    }
    const exitMatch = /__FVV_EXIT__(\d+)/.exec(res.stdout);
    if (!exitMatch || Number(exitMatch[1]) !== 0) {
      const detail = tailText(res.stdout.replace(/__FVV_EXIT__\d+/, '').trim() || res.stderr) || '没有输出';
      throw new Error(`远端启动失败（exit ${exitMatch ? exitMatch[1] : '?'}）：${detail}`);
    }

    const ready = await waitRfb(this.tunnelPort, 30000);
    if (!ready) {
      throw new Error(`远端 ${vncPort} 未在超时内应答 RFB 握手${masterErr ? `：${tailText(masterErr)}` : ''}`);
    }

    return { ok: true };
  }

  /** Start the multiplexed master (and its -L tunnel); returns the stderr tail. */
  async startMaster(vncPort) {
    const cfg = this.cfg;
    let stderr = '';
    const master = spawn('ssh', [
      '-N', '-M',
      '-o', `ControlPath=${this.controlPath}`,
      '-o', 'ControlPersist=300',
      '-o', 'ExitOnForwardFailure=yes',
      '-L', `127.0.0.1:${this.tunnelPort}:127.0.0.1:${vncPort}`,
      ...sshBaseArgs(cfg),
      cfg.sshHost,
    ], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, ...this.childEnv } });
    master.stderr.on('data', (buf) => {
      stderr += buf.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-2000);
    });
    master.on('exit', (code) => {
      if (this.phase === 'running') this.log(`ssh master exited (code ${code}): ${tailText(stderr)}`);
      if (this.tunnel === master) this.tunnel = null;
    });
    this.tunnel = master;

    if (await waitForPath(this.controlPath, 8000)) return stderr;

    try { master.kill('SIGTERM'); } catch { /* already gone */ }
    if (this.tunnel === master) this.tunnel = null;
    try { fs.unlinkSync(this.controlPath); } catch { /* no socket */ }
    return stderr;
  }

  async stop({ reason = 'manual', quiet = false } = {}) {
    if (this.phase === 'idle' && !this.tunnel) return this.statusPayload();
    this.phase = 'stopping';
    this.clearTimers();

    if (this.tunnel) {
      this.tunnel.kill('SIGTERM');
      this.tunnel = null;
    }

    const killCmd = `vncserver -kill :${this.cfg.display} >/dev/null 2>&1 || true`;
    await sshExec(this.cfg, killCmd, 30000, this.controlPath, this.childEnv).catch(() => {});
    if (this.controlPath) {
      try {
        spawn('ssh', [...sshBaseArgs(this.cfg), '-o', `ControlPath=${this.controlPath}`, '-O', 'exit', this.cfg.sshHost]).on('error', () => {});
        fs.unlinkSync(this.controlPath);
      } catch {
        /* socket already gone */
      }
      this.controlPath = null;
    }

    this.phase = 'idle';
    this.startedAt = 0;
    this.token = '';
    if (!quiet) this.log(`session released (${reason})`);
    return this.statusPayload();
  }

  /* ─────────────────────────── timers ───────────────────────────── */

  clearTimers() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
  }

  armTimers() {
    this.clearTimers();
    if (this.cfg.maxSessionMinutes > 0) {
      this.maxTimer = setTimeout(() => {
        this.stop({ reason: 'max-session' }).catch(() => {});
      }, this.cfg.maxSessionMinutes * 60000);
      this.maxTimer.unref?.();
    }
  }

  onClientOpen() {
    this.wsClients += 1;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  onClientClose() {
    this.wsClients = Math.max(0, this.wsClients - 1);
    if (this.wsClients > 0) return;
    if (!this.cfg.idleMinutes) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.wsClients === 0 && this.phase === 'running') {
        this.stop({ reason: `idle ${this.cfg.idleMinutes}m` }).catch(() => {});
      }
    }, this.cfg.idleMinutes * 60000);
    this.idleTimer.unref?.();
  }

  /* ─────────────────────────── HTTP ─────────────────────────────── */

  handleRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.viewerPort}`);
    const origin = req.headers.origin || '';
    if (origin && !isAllowedOrigin(origin)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden origin');
      return;
    }
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-fast-vps-viewer',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    if (url.pathname === '/api/ping') {
      return json(res, 200, { name, version: VERSION, port: this.viewerPort, features: ['settings', 'files', 'browser', 'terminal', 'terminal-init', 'launcher'], pid: process.pid });
    }
    if (url.pathname === '/api/status') return json(res, 200, this.statusPayload());
    if (url.pathname === '/api/logs') return json(res, 200, { lines: this.logs.slice(-200) });
    if (url.pathname === '/api/terminal' && req.method === 'POST') {
      this.termToken = crypto.randomBytes(18).toString('hex');
      return json(res, 200, {
        ok: true,
        url: `http://127.0.0.1:${this.viewerPort}/terminal.html?token=${this.termToken}`,
      });
    }
    if (url.pathname === '/api/files' && req.method === 'GET') {
      this.listFiles(url.searchParams.get('path') || this.cfg.filesRoot)
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 400, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/files/download') {
      this.downloadFile(res, url.searchParams.get('path') || '')
        .catch((err) => json(res, 400, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/files/delete' && req.method === 'POST') {
      readJsonBody(req)
        .then((body) => this.deleteFile(body?.path))
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 400, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/upload' && req.method === 'POST') {
      this.uploadFile(req, url.searchParams.get('dir'))
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 400, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/browser') {
      return this.detectBrowser()
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 200, { browser: null, error: describeError(err) }));
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, { settings: publicSettings(this.cfg), file: SETTINGS_FILE });
    }
    if (url.pathname === '/api/test' && req.method === 'POST') {
      this.testConnection()
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 400, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/settings' && req.method === 'PUT') {
      this.updateSettings(req)
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 400, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/start' && req.method === 'POST') {
      readJsonBody(req)
        .then((body) => this.ensureRunning(Array.isArray(body?.startup) ? body.startup : undefined))
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 500, { ok: false, error: describeError(err) }));
      return;
    }
    if (url.pathname === '/api/stop' && req.method === 'POST') {
      this.stop({ reason: 'http' })
        .then((payload) => json(res, 200, payload))
        .catch((err) => json(res, 500, { ok: false, error: describeError(err) }));
      return;
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return this.serveFile(res, path.join(ROOT, 'viewer', 'index.html'));
    }
    if (url.pathname.startsWith('/assets/')) {
      return this.serveFile(res, safeJoin(path.join(ROOT, 'viewer'), url.pathname.slice('/assets/'.length)));
    }
    if (url.pathname === '/terminal.html') {
      return this.serveFile(res, path.join(ROOT, 'viewer', 'terminal.html'));
    }
    if (url.pathname === '/assets/terminal.js') {
      return this.serveFile(res, path.join(ROOT, 'viewer', 'terminal.js'));
    }
    if (url.pathname.startsWith('/vendor/xterm/')) {
      return this.serveFile(res, safeJoin(path.join(ROOT, 'vendor', 'xterm'), url.pathname.slice('/vendor/xterm/'.length)));
    }
    if (url.pathname.startsWith('/vendor/novnc/')) {
      return this.serveFile(res, safeJoin(path.join(ROOT, 'vendor', 'novnc'), url.pathname.slice('/vendor/novnc/'.length)));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }

  async serveFile(res, file) {
    try {
      const body = await readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  }

  async auxExec(script, timeout = 20000) {
    this.auxPath = this.auxPath || controlPathFor(99);
    return sshExec(this.cfg, script, timeout, this.auxPath, this.childEnv, 'auto');
  }

  async listFiles(rawPath) {
    const target = remotePath(rawPath, this.cfg);
    const script = `find ${target} -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null `;
    return this.auxExec(script, 20000).then((res) => {
      if (res.code === 255) throw new Error(tailText(res.stderr) || 'ssh 连接失败');
      const entries = res.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [type, size, mtime, ...rest] = line.split('\t');
          return { type: type === 'd' ? 'dir' : 'file', size: Number(size), mtime: Number(mtime), name: rest.join('\t') };
        })
        .filter((entry) => entry.name);
      return { path: displayPath(rawPath), parent: parentPath(rawPath), entries };
    });
  }

  async downloadFile(res, rawPath) {
    const target = remotePath(rawPath, this.cfg);
    const child = spawn('ssh', sshArgs(this.cfg, [`cat -- ${target}`]), { env: { ...process.env, ...this.childEnv } });
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${encodeURIComponent(path.basename(String(rawPath)))}"`,
    });
    child.stdout.pipe(res);
    child.stderr.on('data', () => {});
    child.on('error', () => res.destroy());
  }

  async deleteFile(rawPath) {
    const target = remotePath(rawPath, this.cfg);
    if (target === '$HOME' || target === '"$HOME"' || target.endsWith('/')) throw new Error('拒绝删除根目录');
    const script = `if [ -d ${target} ]; then rmdir -- ${target} 2>/dev/null || rm -rf -- ${target}; else rm -f -- ${target}; fi`;
    const res = await this.auxExec(script, 20000);
    if (res.code === 255) throw new Error(tailText(res.stderr) || 'ssh 连接失败');
    return { ok: true };
  }

  async uploadFile(req, dirRaw) {
    const name = sanitizeName(req.headers['x-filename'] || 'upload.bin');
    const dir = remotePath(dirRaw || this.cfg.uploadDir, this.cfg);
    const limit = 512 * 1024 * 1024;
    let size = 0;
    const child = spawn('ssh', sshArgs(this.cfg, [`mkdir -p ${dir} && cat > ${dir}/'${name}'`]), {
      env: { ...process.env, ...this.childEnv },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(tailText(stderr) || `scp exit ${code}`))));
    });
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
          child.kill('SIGKILL');
          reject(new Error('文件超过 512MB 限制'));
          return;
        }
        if (!child.stdin.write(chunk)) req.pause();
        child.stdin.once('drain', () => req.resume());
      });
      req.on('end', () => { child.stdin.end(); resolve(); });
      req.on('error', reject);
    });
    await done;
    return { ok: true, path: `${displayPath(dirRaw || this.cfg.uploadDir)}/${name}`, size };
  }

  async detectBrowser() {
    const now = Date.now();
    if (this.browserCache && now - this.browserCache.at < 60000) return this.browserCache.value;
    const probe = 'for b in firefox firefox-esr chromium chromium-browser google-chrome epiphany-browser; do command -v "$b" >/dev/null 2>&1 && { echo "$b"; exit 0; }; done; echo none';
    const res = await this.auxExec(probe, 20000);
    const found = (res.stdout || '').trim().split('\n').pop() || '';
    if (!found) throw new Error(tailText(res.stderr) || 'ssh 没有返回结果');
    const value = { browser: found === 'none' ? null : found };
    this.browserCache = { at: now, value };
    return value;
  }

  async testConnection() {
    const res = await run('ssh', sshArgs(this.cfg, ['echo __FVV_OK__']), {
      timeout: 20000,
      env: { ...process.env, ...this.childEnv },
    });
    const ok = res.stdout.includes('__FVV_OK__');
    return {
      ok,
      message: ok
        ? 'connected'
        : tailText(res.stderr || res.stdout || `exit ${res.code}`),
    };
  }

  async updateSettings(req) {
    const body = await readJsonBody(req);
    if (body === null) throw new Error('请求体不是合法 JSON');
    const next = { ...this.stored };
    const editable = [
      'sshHost', 'sshOptions', 'sshUser', 'sshPort', 'auth', 'identityFile', 'password',
      'display', 'vncPort', 'geometry', 'autoResize', 'maximize', 'filesRoot', 'uploadDir', 'desktop',
      'startupCommands', 'apps', 'idleMinutes', 'maxSessionMinutes', 'remoteIdleSeconds',
    ];
    for (const key of editable) {
      if (!(key in body)) continue;
      if (body[key] === null || body[key] === '') delete next[key];
      else next[key] = body[key];
    }
    writeSettings(next);
    this.stored = next;
    this.cfg = normalizeConfig({ ...this.baseConfig, ...next });
    this.childEnv = askpassEnv(this.cfg);
    this.log('settings saved');
    return {
      ok: true,
      settings: publicSettings(this.cfg),
      restartRequired: this.phase === 'running',
    };
  }

  statusPayload() {
    return {
      ok: this.phase !== 'error',
      phase: this.phase,
      error: this.error,
      sshHost: this.cfg.sshHost,
      display: this.cfg.display,
      geometry: this.cfg.geometry,
      startedAt: this.startedAt,
      idleMinutes: this.cfg.idleMinutes,
      maxSessionMinutes: this.cfg.maxSessionMinutes,
      clients: this.wsClients,
      viewerUrl: this.phase === 'running'
        ? `http://127.0.0.1:${this.viewerPort}/?token=${this.token}&autoresize=${this.cfg.autoResize ? 1 : 0}`
        : null,
      wsUrl: this.phase === 'running'
        ? `ws://127.0.0.1:${this.viewerPort}/ws?token=${this.token}`
        : null,
    };
  }

  /* ─────────────────────────── WebSocket ────────────────────────── */

  handleUpgrade(req, socket, head) {
    const url = new URL(req.url, `http://127.0.0.1:${this.viewerPort}`);
    if (url.pathname === '/term') return this.handleTerminal(req, socket, url);
    if (!this.token || url.searchParams.get('token') !== this.token) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    if (this.phase !== 'running' || !this.tunnelPort) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      return socket.destroy();
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
    ];
    const proto = req.headers['sec-websocket-protocol'];
    if (proto) headers.push(`Sec-WebSocket-Protocol: ${String(proto).split(',')[0].trim()}`);
    socket.write(`${headers.join('\r\n')}\r\n\r\n`);

    const upstream = net.connect(this.tunnelPort, '127.0.0.1');
    this.onClientOpen();
    this.log('viewer connected');

    const ws = new WsFrameChannel(socket);
    let closed = false;
    const shutdown = (reason) => {
      if (closed) return;
      closed = true;
      this.onClientClose();
      this.log(`viewer disconnected (${reason})`);
      try { upstream.destroy(); } catch {}
      try { socket.destroy(); } catch {}
    };

    ws.onmessage = (payload) => {
      if (!upstream.destroyed) upstream.write(payload);
    };
    ws.onclose = () => shutdown('ws close');
    socket.on('close', () => shutdown('socket close'));
    socket.on('error', () => shutdown('socket error'));
    upstream.on('data', (chunk) => {
      if (!ws.sendBinary(chunk)) shutdown('ws backpressure');
    });
    upstream.on('close', () => shutdown('upstream close'));
    upstream.on('error', (err) => shutdown(`upstream error: ${err.message}`));
    if (head && head.length) upstream.write(head);
  }

  handleTerminal(req, socket, url) {
    if (!this.termToken || url.searchParams.get('token') !== this.termToken) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = crypto.createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    const proto = req.headers['sec-websocket-protocol'];
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
    ];
    if (proto) headers.push(`Sec-WebSocket-Protocol: ${String(proto).split(',')[0].trim()}`);
    socket.write(`${headers.join('\r\n')}\r\n\r\n`);

    const ws = new WsFrameChannel(socket);
    let shell = null;
    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      if (shell) {
        try { shell.kill('SIGTERM'); } catch { /* gone */ }
      }
      try { socket.destroy(); } catch { /* gone */ }
    };

    const spawnShell = (cols, rows) => {
      if (shell) return;
      const remote = [
        'export TERM=xterm-256color',
        `stty rows ${rows} cols ${cols} 2>/dev/null`,
        `export PS1='\\u@\\h:\\w\\$ '`,
        'exec bash -l -i',
      ].join('; ');
      shell = spawn('ssh', [...sshBaseArgs(this.cfg), '-tt', this.cfg.sshHost, remote], {
        env: { ...process.env, ...this.childEnv },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // bash's first prompt is not flushed through the ssh pipe until some
      // input arrives, and writes made before the remote pty is ready are
      // dropped. Nudge with "space + backspace" (invisible on screen) until
      // the shell actually answers.
      let heard = false;
      let tries = 0;
      const nudge = setInterval(() => {
        if (heard || tries >= 8) { clearInterval(nudge); return; }
        tries += 1;
        try { shell.stdin.write(' \b'); } catch { clearInterval(nudge); }
      }, 400);
      const onData = (chunk) => {
        heard = true;
        clearInterval(nudge);
        ws.sendBinary(chunk);
      };
      shell.stdout.on('data', onData);
      shell.stderr.on('data', (chunk) => onData(Buffer.from(chunk)));
      shell.on('close', shutdown);
      shell.on('error', shutdown);
      this.log('terminal connected');
    };

    // The browser announces itself with {"init":{"cols":N,"rows":M}} once its
    // WebSocket is really open; spawning the shell before that loses the first
    // prompt bytes, which are sent the moment bash starts.
    let initialised = false;
    ws.onmessage = (payload, isText) => {
      const text = payload.length < 200 ? payload.toString('utf8') : '';
      if (!initialised && isText && text.startsWith('{')) {
        try {
          const message = JSON.parse(text);
          if (message && message.init) {
            initialised = true;
            spawnShell(
              Math.max(20, Math.min(300, Number(message.init.cols) || 100)),
              Math.max(8, Math.min(100, Number(message.init.rows) || 30)),
            );
            return;
          }
        } catch { /* not our control message */ }
      }
      initialised = true;
      if (!shell) spawnShell(100, 30);
      if (shell && !shell.stdin.destroyed) shell.stdin.write(payload);
    };

    setTimeout(() => { if (!closed) { initialised = true; spawnShell(100, 30); } }, 2000);
    socket.on('close', shutdown);
    socket.on('error', shutdown);
  }

  pushLog(line) {
    const stamp = new Date().toISOString().slice(11, 19);
    this.logs.push(`${stamp} ${line}`);
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400);
  }
}

/* ────────────────────── minimal WebSocket framing ─────────────────── */

class WsFrameChannel {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.onmessage = () => {};
    this.onclose = () => {};
    this.closed = false;
    socket.on('data', (chunk) => this.feed(chunk));
  }

  feed(chunk) {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const frame = this.next();
      if (!frame) break;
      this.handle(frame);
    }
  }

  next() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const hi = buf.readUInt32BE(2);
      const lo = buf.readUInt32BE(6);
      if (hi !== 0) throw new Error('frame too large');
      len = lo;
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return null;
    let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
    if (masked) {
      const mask = buf.subarray(offset, offset + 4);
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i += 1) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    this.buffer = buf.subarray(offset + maskLen + len);
    return { fin, opcode, payload };
  }

  handle({ fin, opcode, payload }) {
    if (opcode === 0x0) return; // continuation: noVNC sends whole messages
    if (opcode === 0x1 || opcode === 0x2) {
      this.onmessage(payload, opcode === 0x1);
      return;
    }
    if (opcode === 0x8) {
      this.closed = true;
      this.writeFrame(0x8, Buffer.alloc(0));
      this.onclose();
      return;
    }
    if (opcode === 0x9) {
      this.writeFrame(0xa, payload);
    }
  }

  sendBinary(chunk) {
    if (this.closed || this.socket.destroyed) return false;
    this.writeFrame(0x2, chunk);
    return true;
  }

  writeFrame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.closed = true;
    }
  }
}

/* ─────────────────────────── helpers ─────────────────────────────── */

function normalizeConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw || {}) };
  cfg.display = Number.parseInt(cfg.display, 10) || 1;
  cfg.vncPort = Number.parseInt(cfg.vncPort, 10) || 5900 + cfg.display;
  cfg.viewerPort = Number.parseInt(cfg.viewerPort, 10) || DEFAULTS.viewerPort;
  cfg.idleMinutes = Number.parseFloat(cfg.idleMinutes);
  if (!Number.isFinite(cfg.idleMinutes) || cfg.idleMinutes < 0) cfg.idleMinutes = DEFAULTS.idleMinutes;
  cfg.maxSessionMinutes = Number.parseFloat(cfg.maxSessionMinutes);
  if (!Number.isFinite(cfg.maxSessionMinutes) || cfg.maxSessionMinutes < 0) {
    cfg.maxSessionMinutes = DEFAULTS.maxSessionMinutes;
  }
  cfg.remoteIdleSeconds = Number.parseInt(cfg.remoteIdleSeconds, 10);
  if (!Number.isFinite(cfg.remoteIdleSeconds) || cfg.remoteIdleSeconds < 0) {
    cfg.remoteIdleSeconds = DEFAULTS.remoteIdleSeconds;
  }
  cfg.sshPort = Number.parseInt(cfg.sshPort, 10) || 22;
  cfg.sshUser = typeof cfg.sshUser === 'string' ? cfg.sshUser.trim() : '';
  cfg.auth = ['agent', 'key', 'password'].includes(cfg.auth) ? cfg.auth : 'agent';
  cfg.identityFile = typeof cfg.identityFile === 'string' ? cfg.identityFile.trim() : '';
  cfg.password = typeof cfg.password === 'string' ? cfg.password : '';
  cfg.startupCommands = Array.isArray(cfg.startupCommands) ? cfg.startupCommands : [];
  cfg.apps = Array.isArray(cfg.apps)
    ? cfg.apps
      .filter((app) => app && typeof app.command === 'string' && app.command.trim())
      .map((app) => ({ name: String(app.name || app.command).slice(0, 60), command: app.command.trim() }))
      .slice(0, 24)
    : [];
  cfg.sshOptions = Array.isArray(cfg.sshOptions) ? cfg.sshOptions : [];
  return cfg;
}

function sshBaseArgs(cfg) {
  const args = [
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'LogLevel=ERROR',
    '-o', 'StrictHostKeyChecking=accept-new',
  ];
  if (cfg.sshPort && cfg.sshPort !== 22) args.push('-p', String(cfg.sshPort));
  if (cfg.sshUser) args.push('-l', cfg.sshUser);
  if (cfg.identityFile) args.push('-i', expandHome(cfg.identityFile), '-o', 'IdentitiesOnly=yes');
  if (cfg.auth === 'password') {
    args.push('-o', 'PreferredAuthentications=password,keyboard-interactive');
    args.push('-o', 'NumberOfPasswordPrompts=1');
  } else {
    args.push('-o', 'BatchMode=yes');
    if (cfg.auth === 'key') args.push('-o', 'PreferredAuthentications=publickey');
  }
  return [...args, ...cfg.sshOptions];
}

function expandHome(file) {
  if (file === '~') return os.homedir();
  if (file.startsWith('~/')) return path.join(os.homedir(), file.slice(2));
  return file;
}

function sshArgs(cfg, extra) {
  return [...sshBaseArgs(cfg), cfg.sshHost, ...extra];
}

function controlPathFor(display) {
  return path.join(os.tmpdir(), `fvv-${process.pid}-${display}-${crypto.randomBytes(3).toString('hex')}.sock`);
}

function waitForPath(target, timeout) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve) => {
    const tick = () => {
      if (fs.existsSync(target)) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function buildXstartup(cfg) {
  const logFile = '~/.fast-vps-viewer/start.log';
  const lines = [
    '#!/bin/sh',
    'unset SESSION_MANAGER',
    'unset DBUS_SESSION_BUS_ADDRESS',
  ];
  const desktop = (cfg.desktop || '').trim().split(/\s+/)[0];
  if (desktop === 'openbox' && cfg.maximize) {
    // Openbox matches a wildcard application rule, so every window (the
    // browser included) opens maximized. Use a private rc.xml; never touch
    // the user's own ~/.config/openbox.
    const rule = '<application class=\\"*\\"><maximized>yes</maximized></application>';
    lines.push(
      'if command -v openbox >/dev/null 2>&1; then',
      '  rc=/etc/xdg/openbox/rc.xml; [ -f "$rc" ] || rc=/usr/share/openbox/rc.xml',
      `  if [ -f "$rc" ]; then awk '{ if ($0 ~ /<\\/applications>/) print "  ${rule}"; print }' "$rc" > ~/.fast-vps-viewer/openbox-rc.xml; openbox --config-file ~/.fast-vps-viewer/openbox-rc.xml & else openbox & fi`,
      `else echo "window manager not found: openbox" >> ${logFile}; fi`,
    );
  } else if (desktop) {
    lines.push(
      `if command -v ${desktop} >/dev/null 2>&1; then ${cfg.desktop} & else echo "window manager not found: ${desktop}" >> ${logFile}; fi`,
    );
  }
  const commands = cfg.startupCommands || [];
  const browserCalls = commands
    .map((cmd) => String(cmd || '').trim())
    .filter((text) => text === 'browser' || text.startsWith('browser '))
    .map((text) => text.slice('browser'.length).trim());
  if (browserCalls.length > 0) {
    lines.push(
      'open_browser() {',
      '  for b in firefox firefox-esr chromium chromium-browser google-chrome epiphany-browser; do',
      '    command -v "$b" >/dev/null 2>&1 || continue',
      '    case "$b" in',
      '      chromium|chromium-browser|google-chrome) ( "$b" --no-sandbox --disable-dev-shm-usage --disable-gpu "$@" ) & ;;',
      '      *) ( "$b" "$@" ) & ;;',
      '    esac',
      '    return 0',
      '  done',
      `  echo "no browser found on this host (install firefox-esr or chromium)" >> ${logFile}`,
      '}',
    );
    for (const target of browserCalls) {
      lines.push(target ? `open_browser '${target.replace(/'/g, '')}'` : 'open_browser');
    }
  }
  for (const cmd of commands) {
    const text = String(cmd || '').trim();
    if (!text || text === 'browser' || text.startsWith('browser ')) continue;
    const bin = text.split(/\s+/)[0];
    lines.push(
      `if command -v ${bin} >/dev/null 2>&1; then ( ${text} ) & else echo "startup command not found: ${bin}" >> ${logFile}; fi`,
    );
  }
  lines.push('wait', '');
  return lines.join('\n');
}

async function sshExec(cfg, script, timeout, controlPath, env, controlMode = 'no') {
  const args = controlPath
    ? [...sshBaseArgs(cfg), '-o', `ControlPath=${controlPath}`,
      '-o', `ControlMaster=${controlMode}`, '-o', 'ControlPersist=60', cfg.sshHost, script]
    : sshArgs(cfg, [script]);
  let res = await run('ssh', args, { timeout, env });
  if (res.code === 255) {
    await sleep(1200);
    res = await run('ssh', args, { timeout, env });
  }
  return res;
}

function tailText(text, width = 300) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > width ? `…${clean.slice(-width)}` : clean;
}

/** Wait until the forwarded port answers with the RFB version banner. */
function waitRfb(port, timeout) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      let buffered = '';
      const done = (ok) => {
        socket.removeAllListeners();
        socket.destroy();
        if (ok) resolve(true);
        else if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 500);
      };
      socket.setTimeout(2000, () => done(false));
      socket.on('data', (buf) => {
        buffered += buf.toString('ascii');
        if (buffered.startsWith('RFB ')) done(true);
      });
      socket.on('error', () => done(false));
      socket.on('close', () => done(false));
    };
    attempt();
  });
}

function run(cmd, args, { timeout = 20000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out after ${timeout}ms`));
    }, timeout);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function tryListen(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitPort(host, port, timeout) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect(port, host);
      socket.setTimeout(1500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      const fail = () => {
        socket.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(attempt, 400);
      };
      socket.once('error', fail);
      socket.once('timeout', fail);
    };
    attempt();
  });
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  return target.startsWith(path.resolve(base)) ? target : path.join(base, '__missing__');
}

function isAllowedOrigin(origin) {
  if (origin === 'null') return true;
  if (origin.startsWith('dsh-app://')) return true;
  try {
    const url = new URL(origin);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') return true;
  } catch {}
  return false;
}

function describeError(err) {
  if (!err) return 'unknown error';
  const msg = err.message || String(err);
  return msg.length > 600 ? `${msg.slice(0, 600)}…` : msg;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeLog(ctx, level, message) {
  try {
    const logger = ctx?.logger;
    if (logger && typeof logger[level] === 'function') logger[level](message);
    else console.warn(message);
  } catch {}
}

function expandRemote(p) {
  const text = String(p || '').trim();
  if (text === '~') return '"$HOME"';
  if (text.startsWith('~/')) return `"$HOME"/'${text.slice(2).replace(/'/g, '')}'`;
  return `'${text.replace(/'/g, '')}'`;
}

function remotePath(p, cfg) {
  const text = String(p || '').trim();
  if (!text || text.includes('\n')) throw new Error('非法路径');
  const root = expandRemote(cfg.filesRoot);
  const target = expandRemote(text);
  if (target !== root && !target.startsWith(`${root}/`)) throw new Error('路径超出允许的范围');
  return target;
}

function displayPath(p) {
  return String(p || '').trim() || '~';
}

function parentPath(p) {
  const text = displayPath(p);
  if (text === '~' || text === '/') return null;
  const cut = text.replace(/\/+$/, '').lastIndexOf('/');
  if (cut <= 0) return '~';
  return text.slice(0, cut);
}

function sanitizeName(name) {
  const base = path.basename(String(name)).replace(/[^\w.\- ()\[\]]/g, '_').slice(0, 180);
  return base || 'upload.bin';
}

function publicSettings(cfg) {
  return {
    sshHost: cfg.sshHost,
    sshOptions: cfg.sshOptions,
    sshUser: cfg.sshUser,
    sshPort: cfg.sshPort,
    auth: cfg.auth,
    identityFile: cfg.identityFile,
    hasPassword: Boolean(cfg.password),
    display: cfg.display,
    vncPort: cfg.vncPort,
    viewerPort: cfg.viewerPort,
    geometry: cfg.geometry,
    autoResize: cfg.autoResize,
    maximize: cfg.maximize,
    filesRoot: cfg.filesRoot,
    uploadDir: cfg.uploadDir,
    desktop: cfg.desktop,
    startupCommands: cfg.startupCommands,
    apps: cfg.apps,
    idleMinutes: cfg.idleMinutes,
    maxSessionMinutes: cfg.maxSessionMinutes,
    remoteIdleSeconds: cfg.remoteIdleSeconds,
  };
}

function askpassEnv(cfg) {
  if (cfg.auth !== 'password' || !cfg.password) return {};
  const dir = path.join(os.homedir(), '.dsh', 'fast-vps-viewer');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const script = path.join(dir, 'askpass.sh');
  const secret = path.join(dir, 'password');
  fs.writeFileSync(script, `#!/bin/sh\ncat '${secret}'\n`, { mode: 0o700 });
  fs.writeFileSync(secret, cfg.password, { mode: 0o600 });
  return { SSH_ASKPASS: script, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: process.env.DISPLAY || ':0' };
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(value && typeof value === 'object' ? value : null);
      } catch (err) {
        reject(new Error(`JSON 解析失败：${err.message}`));
      }
    });
    req.on('error', reject);
  });
}
