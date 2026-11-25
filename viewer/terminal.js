/* Renders a real SSH shell: xterm.js in the browser, sshd on the other end. */
(() => {
  const status = document.getElementById('status');
  const token = new URLSearchParams(location.search).get('token') || '';
  const term = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    convertEol: false,
    theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#2f81f7' },
    scrollback: 5000,
  });
  term.open(document.getElementById('term'));

  const box = document.getElementById('term');
  const cols = Math.max(40, Math.min(220, Math.floor(box.clientWidth / 8.2)));
  const rows = Math.max(12, Math.min(70, Math.floor(box.clientHeight / 17)));
  term.resize(cols, rows);

  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/term?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`, ['binary']);
  ws.binaryType = 'arraybuffer';
  let closed = false;

  const cleanup = (message) => {
    if (closed) return;
    closed = true;
    if (message) status.textContent = message;
    else status.textContent = 'disconnected';
  };

  ws.addEventListener('open', () => {
    status.textContent = 'connected';
    // Tell the host we are ready before it starts bash, otherwise the first
    // prompt (written immediately) races the WebSocket handshake.
    ws.send(JSON.stringify({ init: { cols, rows } }));
    term.focus();
  });
  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') term.write(event.data);
    else term.write(new Uint8Array(event.data));
  });
  ws.addEventListener('close', () => cleanup('session ended'));
  ws.addEventListener('error', () => cleanup('connection failed'));

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  window.addEventListener('beforeunload', () => {
    try { ws.close(); } catch {}
  });
})();
