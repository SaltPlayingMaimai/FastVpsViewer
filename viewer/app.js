import RFB from '/vendor/novnc/novnc.js';

const dot = document.getElementById('dot');
const label = document.getElementById('label');
const meta = document.getElementById('meta');
const releaseBtn = document.getElementById('release');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const retryBtn = document.getElementById('retry');
const screen = document.getElementById('screen');

const params = new URLSearchParams(location.search);
const token = params.get('token') || '';
const embedded = params.get('chrome') === '0';
const autoResize = params.get('autoresize') !== '0';
if (embedded) document.body.dataset.embedded = 'true';
let rfb = null;
let timer = null;
let remoteClipboard = '';

function setState(state, text) {
  dot.dataset.state = state;
  label.textContent = text;
}

function showOverlay(text) {
  overlayText.textContent = text;
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'x-fast-vps-viewer': '1', 'content-type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function ensureSession() {
  setState('starting', '正在启动远端桌面…');
  let status = await api('/api/status');
  if (status.phase !== 'running') {
    status = await api('/api/start', { method: 'POST', body: '{}' });
  }
  if (!status.wsUrl) throw new Error('远端会话没有就绪');
  return status;
}

function connect(wsUrl) {
  if (rfb) {
    try { rfb.disconnect(); } catch {}
    rfb = null;
  }
  hideOverlay();
  rfb = new RFB(screen, wsUrl, { shared: true, wsProtocols: ['binary'] });
  rfb.scaleViewport = !autoResize;
  rfb.resizeSession = autoResize;
  rfb.focusOnClick = true;
  rfb.background = '#0d1117';

  rfb.addEventListener('connect', () => {
    setState('running', '已连接');
    hideOverlay();
    screen.focus?.();
    scheduleEmptyHint();
  });
  rfb.addEventListener('disconnect', (event) => {
    setState('idle', '已断开');
    if (event.detail?.clean) {
      showOverlay('会话已结束。远端资源正在释放。');
    } else {
      showOverlay('连接中断。点「重新连接」重试。');
    }
  });
  rfb.addEventListener('securityfailure', (event) => {
    setState('error', '认证失败');
    showOverlay(`认证失败：${event.detail?.reason || 'unknown'}`);
  });
  rfb.addEventListener('clipboard', (event) => {
    remoteClipboard = event.detail?.text || '';
    try {
      window.parent?.postMessage({ type: 'fvv-clipboard', text: remoteClipboard }, '*');
    } catch { /* embedded elsewhere */ }
  });
  rfb.addEventListener('credentialsrequired', () => {
    setState('error', '需要密码');
    showOverlay('远端要求密码，但本插件以无密码回环模式运行。');
  });
}

let emptyHintTimer = null;

function scheduleEmptyHint() {
  if (emptyHintTimer) clearTimeout(emptyHintTimer);
  emptyHintTimer = setTimeout(() => {
    const canvas = screen.querySelector('canvas');
    if (!canvas || !canvas.width) return;
    let lit = 0;
    try {
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const step = 4 * 401;
      for (let i = 0; i < data.length; i += step) {
        if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) { lit += 1; if (lit > 3) break; }
      }
    } catch {
      return;
    }
    if (lit > 3) return;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = t(
      'Connected, but the desktop is empty. Add a program to startupCommands in the plugin config (for example xterm or firefox), or open a window on the remote host.',
      '已连接到桌面，但桌面是空的：在插件配置的 startupCommands 里加一个程序（例如 xterm / firefox），或先在远端开一个窗口。',
    );
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 15000);
  }, 3500);
}

const zhLocale = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '');
function t(en, cn) {
  return zhLocale ? cn : en;
}

async function boot() {
  try {
    const status = await ensureSession();
    const wsUrl = token ? `${status.wsUrl}` : status.wsUrl;
    meta.textContent = `${status.sshHost} · :${status.display} · ${status.geometry}`;
    connect(wsUrl);
  } catch (err) {
    setState('error', '启动失败');
    showOverlay(String(err?.message || err));
    const logs = await api('/api/logs').catch(() => null);
    if (logs?.lines?.length) {
      overlayText.textContent += `\n\n${logs.lines.slice(-6).join('\n')}`;
    }
  }
}

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'fvv-paste' || typeof data.text !== 'string') return;
  if (!rfb || typeof rfb.clipboardPasteFrom !== 'function') return;
  rfb.clipboardPasteFrom(data.text);
  if (data.sendCtrlV && typeof rfb.sendKey === 'function') {
    // Control_L + v, pressed and released in order
    rfb.sendKey(0xffe3, 'ControlLeft', true);
    rfb.sendKey(0x76, 'KeyV', true);
    setTimeout(() => {
      rfb.sendKey(0x76, 'KeyV', false);
      rfb.sendKey(0xffe3, 'ControlLeft', false);
    }, 60);
  }
  try {
    window.parent?.postMessage({ type: 'fvv-paste-ack' }, '*');
  } catch { /* ignore */ }
});

window.addEventListener('message', (event) => {
  if (event.data?.type === 'fvv-read-clipboard') {
    try {
      window.parent?.postMessage({ type: 'fvv-clipboard', text: remoteClipboard }, '*');
    } catch { /* ignore */ }
  }
});

releaseBtn.addEventListener('click', async () => {
  releaseBtn.disabled = true;
  setState('idle', '正在释放…');
  try {
    if (rfb) { try { rfb.disconnect(); } catch {} }
    await api('/api/stop', { method: 'POST', body: '{}' });
    showOverlay('会话已结束，远端图形进程已释放。');
    setState('idle', '已释放');
  } catch (err) {
    showOverlay(`释放失败：${err.message}`);
  } finally {
    releaseBtn.disabled = false;
  }
});

retryBtn.addEventListener('click', () => {
  hideOverlay();
  boot();
});

window.addEventListener('beforeunload', () => {
  if (timer) clearInterval(timer);
});

boot();
