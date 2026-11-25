/**
 * End-to-end smoke test for the host half.
 *
 *   node test/smoke.mjs [sshHost]
 *
 * Starts a real session on the VPS, checks the HTTP API, speaks the first
 * bytes of the RFB handshake through the WebSocket bridge, then releases it.
 */
import net from 'node:net';
import crypto from 'node:crypto';
import { apply } from '../index.js';

const sshHost = process.argv[2] || process.env.FVV_SSH_HOST || 'my-vps';
const port = Number(process.env.FVV_PORT || 19650);

const ctx = {
  effect(fn) {
    const dispose = fn();
    return () => dispose?.();
  },
  logger: {
    info: (...a) => console.log('[info]', ...a),
    warn: (...a) => console.log('[warn]', ...a),
    error: (...a) => console.log('[error]', ...a),
  },
};

const controller = apply(ctx, {
  sshHost,
  viewerPort: port,
  idleMinutes: 1,
  maxSessionMinutes: 10,
  geometry: '1280x800',
  startupCommands: [],
});

const base = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${base}/api/ping`);
      if (res.ok) return res.json();
    } catch {}
    await wait(250);
  }
  throw new Error('viewer server did not come up');
}

function wsHandshake(token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write([
        'GET /ws?token=' + token + ' HTTP/1.1',
        'Host: 127.0.0.1:' + port,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + key,
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: binary',
        '', '',
      ].join('\r\n'));
    });
    let buffered = Buffer.alloc(0);
    let upgraded = false;
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!upgraded) {
        const end = buffered.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffered.subarray(0, end).toString();
        if (!head.startsWith('HTTP/1.1 101')) return reject(new Error('upgrade failed: ' + head));
        upgraded = true;
        buffered = buffered.subarray(end + 4);
        // send an unmasked? no — client frames must be masked.
        const payload = Buffer.from('RFB 003.008\n', 'ascii');
        const mask = crypto.randomBytes(4);
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
        const header = Buffer.from([0x82, 0x80 | payload.length]);
        socket.write(Buffer.concat([header, mask, masked]));
      }
      if (buffered.length >= 2) {
        const len = buffered[1] & 0x7f;
        if (buffered.length >= 2 + len) {
          const text = buffered.subarray(2, 2 + len).toString('ascii');
          socket.destroy();
          resolve(text);
        }
      }
    });
    socket.on('error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 15000);
  });
}

try {
  const ping = await waitUp();
  console.log('ok  ping', JSON.stringify(ping));

  let status = await (await fetch(`${base}/api/status`)).json();
  console.log('ok  initial phase', status.phase);

  console.log('... starting session (this ssh-es into the VPS)');
  const started = await (await fetch(`${base}/api/start`, { method: 'POST' })).json();
  console.log('ok  start', started.phase, started.viewerUrl ? 'has-url' : 'no-url');
  if (started.phase !== 'running') throw new Error('not running: ' + JSON.stringify(started));

  const token = new URL(started.viewerUrl).searchParams.get('token');
  const reply = await wsHandshake(token);
  console.log('ok  rfb handshake through ws bridge:', JSON.stringify(reply));
  if (!reply.startsWith('RFB 003')) throw new Error('unexpected RFB reply: ' + reply);

  const page = await (await fetch(`${base}/`)).text();
  console.log('ok  viewer page bytes', page.length);

  const lib = await fetch(`${base}/vendor/novnc/novnc.js`);
  console.log('ok  novnc bundle', lib.status, lib.headers.get('content-type'));

  status = await (await fetch(`${base}/api/stop`, { method: 'POST' })).json();
  console.log('ok  stop', status.phase);
  if (status.phase !== 'idle') throw new Error('did not release');
} catch (err) {
  console.error('FAIL', err);
  process.exitCode = 1;
} finally {
  await controller.dispose?.();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
