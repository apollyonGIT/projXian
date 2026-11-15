'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROOMS = 500;
const CODE_LENGTH = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const PUBLIC_FILES = new Set([
  '/index.html',
  '/styles.css',
  '/game.js',
  '/README.md',
]);

const rooms = new Map();

function send(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    console.warn('send failed', error.message);
  }
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = '';
    const bytes = crypto.randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').slice(0, CODE_LENGTH).toUpperCase();
}

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

function roomOf(ws) {
  return ws.roomCode ? rooms.get(ws.roomCode) : null;
}

function peerOf(ws, room) {
  if (!room) return null;
  return ws.roomRole === 'host' ? room.guest : room.host;
}

function notifyPeer(ws, room, payload) {
  const peer = peerOf(ws, room);
  if (peer) send(peer, payload);
}

function clearMembership(ws) {
  ws.roomCode = null;
  ws.roomRole = null;
}

function leaveRoom(ws, notify = true) {
  const room = roomOf(ws);
  if (!room) {
    clearMembership(ws);
    return;
  }

  if (ws.roomRole === 'host') {
    if (notify && room.guest) {
      send(room.guest, { t: 'peer-left', role: 'host', reason: 'host-left' });
      clearMembership(room.guest);
    }
    rooms.delete(room.code);
  } else {
    if (room.guest === ws) room.guest = null;
    if (notify && room.host) {
      send(room.host, { t: 'peer-left', role: 'guest', reason: 'guest-left' });
    }
  }

  clearMembership(ws);
}

function roomView(room, role) {
  return {
    t: 'room',
    code: room.code,
    role,
    peer: role === 'host' ? Boolean(room.guest) : Boolean(room.host),
  };
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (pathname === '/healthz') {
    const body = JSON.stringify({
      ok: true,
      rooms: rooms.size,
      uptime: Math.round(process.uptime()),
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  let filePath = pathname === '/' ? '/index.html' : pathname;
  if (!PUBLIC_FILES.has(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const fullPath = path.join(ROOT, filePath);
  try {
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(fullPath).pipe(res);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 128 * 1024,
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  send(ws, { t: 'hello', version: 1 });

  ws.on('message', (buffer) => {
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch (error) {
      send(ws, { t: 'error', message: '消息格式错误' });
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (message.t === 'create') {
      if (roomOf(ws)) {
        send(ws, { t: 'error', message: '你已经在一个房间中' });
        return;
      }
      if (rooms.size >= MAX_ROOMS) {
        send(ws, { t: 'error', message: '当前房间过多，请稍后再试' });
        return;
      }
      const code = makeRoomCode();
      const room = {
        code,
        host: ws,
        guest: null,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      rooms.set(code, room);
      ws.roomCode = code;
      ws.roomRole = 'host';
      send(ws, roomView(room, 'host'));
      console.log(`room ${code} created; rooms=${rooms.size}`);
      return;
    }

    if (message.t === 'join') {
      if (roomOf(ws)) {
        send(ws, { t: 'error', message: '你已经在一个房间中' });
        return;
      }
      const code = normalizeCode(message.code);
      const room = rooms.get(code);
      if (!room || !room.host) {
        send(ws, { t: 'error', message: '房间不存在或已解散' });
        return;
      }
      if (room.guest) {
        send(ws, { t: 'error', message: '房间已满' });
        return;
      }
      room.guest = ws;
      room.lastActivity = Date.now();
      ws.roomCode = code;
      ws.roomRole = 'guest';
      send(ws, roomView(room, 'guest'));
      send(room.host, { t: 'peer-joined', role: 'guest', code });
      console.log(`room ${code} joined; rooms=${rooms.size}`);
      return;
    }

    if (message.t === 'relay') {
      const room = roomOf(ws);
      if (!room) {
        send(ws, { t: 'error', message: '尚未加入房间' });
        return;
      }
      const peer = peerOf(ws, room);
      if (!peer) {
        send(ws, { t: 'error', message: '对手尚未加入' });
        return;
      }
      room.lastActivity = Date.now();
      send(peer, { t: 'relay', from: ws.roomRole, d: message.d });
      return;
    }

    if (message.t === 'leave') {
      leaveRoom(ws, true);
      send(ws, { t: 'left' });
      return;
    }

    if (message.t === 'ping') {
      send(ws, { t: 'pong', at: message.at });
    }
  });

  ws.on('close', () => {
    leaveRoom(ws, true);
  });

  ws.on('error', (error) => {
    console.warn('socket error', error.message);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (error) {
      ws.terminate();
    }
  }

  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      send(room.host, { t: 'error', message: '房间长时间无活动，已关闭' });
      if (room.guest) send(room.guest, { t: 'error', message: '房间长时间无活动，已关闭' });
      if (room.host) room.host.terminate();
      if (room.guest) room.guest.terminate();
      rooms.delete(room.code);
    }
  }
}, 30000);

server.on('close', () => {
  clearInterval(heartbeat);
});

server.listen(PORT, HOST, () => {
  console.log(`问道·斗法 online server listening on http://${HOST}:${PORT}`);
  console.log(`health: http://127.0.0.1:${PORT}/healthz`);
});

module.exports = { server, wss, rooms };
