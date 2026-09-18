#!/usr/bin/env node
'use strict';

const fs = require('fs');

const chatRoomUuid = process.argv[2];
const message = process.argv[3];
const dealUsid = process.argv[4] || '';
const userId = process.argv[5] || '';
const cookiePath = process.env.GRAYTAG_COOKIE_PATH || '/home/ubuntu/graytag-session/cookies.json';

if (!chatRoomUuid || !message || !dealUsid || !userId) {
  console.log(JSON.stringify({ ok: false, error: 'chatRoomUuid, message, dealUsid and userId are required' }));
  process.exit(1);
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.3 Safari/605.1.15',
];
const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

function loadCookieHeader() {
  const raw = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
  return ['AWSALB', 'AWSALBCORS', 'JSESSIONID']
    .filter((name) => typeof raw[name] === 'string' && raw[name])
    .map((name) => `${name}=${raw[name]}`)
    .join('; ');
}

function connectAndSend(cookieHeader) {
  return new Promise((resolve, reject) => {
    const WebSocket = require('/home/ubuntu/node_modules/ws');
    const serverId = String(Math.random()).slice(2, 5);
    const sessionId = Array.from({ length: 8 }, () => Math.random().toString(36).charAt(2)).join('');
    const socket = new WebSocket(`wss://graytag.co.kr/chat-web/websocketHandler/${serverId}/${sessionId}/websocket`, {
      headers: { 'User-Agent': userAgent, Cookie: cookieHeader, Origin: 'https://graytag.co.kr' },
    });
    let sent = false;
    const timer = setTimeout(() => { socket.close(); reject(new Error('timeout 15s')); }, 25_000);

    function sendFrame(command, headers, body = '') {
      const lines = [command];
      if (body) headers['content-length'] = Buffer.byteLength(body, 'utf8');
      for (const [name, value] of Object.entries(headers)) lines.push(`${name}:${value}`);
      lines.push('', body);
      socket.send(JSON.stringify([`${lines.join('\n')}\0`]));
    }

    function parseFrames(payload) {
      if (!payload.startsWith('a[')) return [];
      try {
        return JSON.parse(payload.slice(1)).map((entry) => {
          const parts = entry.replace(/\0$/, '').split('\n');
          const command = parts[0];
          const headers = {};
          let index = 1;
          for (; index < parts.length && parts[index] !== ''; index += 1) {
            const colon = parts[index].indexOf(':');
            if (colon > 0) headers[parts[index].slice(0, colon)] = parts[index].slice(colon + 1);
          }
          return { command, headers, body: parts.slice(index + 1).join('\n') };
        });
      } catch {
        return [];
      }
    }

    socket.on('message', (data) => {
      const payload = data.toString();
      if (payload === 'o') {
        sendFrame('CONNECT', { 'accept-version': '1.1,1.0', 'heart-beat': '10000,10000' });
        return;
      }
      if (payload === 'h') return;
      for (const frame of parseFrames(payload)) {
        if (frame.command === 'CONNECTED') {
          sendFrame('SUBSCRIBE', { id: 'sub-0', destination: `/topic/${chatRoomUuid}` });
          sendFrame('SEND', { destination: `/app/chat/${chatRoomUuid}/connect`, 'content-type': 'application/json;charset=UTF-8' }, JSON.stringify({ userId }));
          setTimeout(() => {
            sendFrame('SEND', { destination: `/app/chat/${chatRoomUuid}/send`, 'content-type': 'application/json;charset=UTF-8' }, JSON.stringify({ userId, message, dealUsid }));
            sent = true;
          }, 600);
        }
        if (frame.command === 'MESSAGE' && sent) {
          try {
            const echoed = JSON.parse(frame.body);
            if (echoed.messageType === 'Send' && String(echoed.userId) === String(userId)) {
              clearTimeout(timer);
              socket.close();
              resolve({ ok: true, echo: true, preview: String(echoed.message || '').slice(0, 50) });
              return;
            }
          } catch {}
        }
        if (frame.command === 'ERROR') {
          clearTimeout(timer);
          socket.close();
          reject(new Error(`STOMP: ${String(frame.headers.message || frame.body).slice(0, 100)}`));
        }
      }
    });
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    socket.on('close', () => {
      clearTimeout(timer);
      if (sent) resolve({ ok: true, echo: false, note: 'ws closed before echo' });
      else reject(new Error('ws closed before send'));
    });
  });
}

(async () => {
  try {
    const result = await connectAndSend(loadCookieHeader());
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error?.message || 'unknown').slice(0, 200) }));
    process.exit(1);
  }
})();
