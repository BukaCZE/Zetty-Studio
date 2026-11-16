/** Optional single-broadcaster Kick webhook bridge. Run behind an HTTPS reverse proxy. */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { validToken, verifyKick } from './security.js';
const token = process.env.RELAY_TOKEN ?? '';
const broadcasterId = process.env.KICK_BROADCASTER_ID ?? '';
const port = Number(process.env.PORT ?? 8787);
const bind = process.env.RELAY_BIND ?? '127.0.0.1';
if (token.length < 32 || !/^\d+$/.test(broadcasterId))
  throw new Error('Nastav RELAY_TOKEN (min. 32 znaků) a KICK_BROADCASTER_ID.');
let key = '';
let keyTime = 0;
async function publicKey(force = false) {
  if (!force && key && Date.now() - keyTime < 3600000) return key;
  const response = await fetch('https://api.kick.com/public/v1/public-key', {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Kick public key unavailable');
  const data = (await response.json()) as any;
  const next = data.data?.public_key;
  if (typeof next !== 'string' || !next.includes('BEGIN PUBLIC KEY'))
    throw new Error('Invalid Kick public key');
  key = next;
  keyTime = Date.now();
  return key;
}
const seen = new Map<string, number>();
const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
const allowed = new Set([
  'chat.message.sent',
  'channel.followed',
  'channel.subscription.new',
  'channel.subscription.renewal',
  'channel.subscription.gifts',
  'kicks.gifted',
]);
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.url !== '/webhooks/kick' || req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 256 * 1024) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const header = (name: string) => String(req.headers[name] ?? '');
    const id = header('kick-event-message-id');
    const timestamp = header('kick-event-message-timestamp');
    const signature = header('kick-event-signature');
    const event = header('kick-event-type');
    let verified = verifyKick(await publicKey(), id, timestamp, body, signature);
    // One bounded re-fetch on a plausible rotation; do not fetch for every invalid request.
    if (!verified && Date.now() - keyTime > 60000)
      verified = verifyKick(await publicKey(true), id, timestamp, body, signature);
    if (!verified) {
      res.writeHead(401).end();
      return;
    }
    if (seen.has(id)) {
      res.writeHead(200).end('duplicate');
      return;
    }
    const payload = JSON.parse(body.toString('utf8'));
    if (String(payload.broadcaster?.user_id) !== broadcasterId || !allowed.has(event)) {
      res.writeHead(200).end('ignored');
      return;
    }
    seen.set(id, Date.now());
    if (seen.size > 5000) seen.delete(seen.keys().next().value!);
    const message = JSON.stringify({ id, platform: 'kick', event, payload });
    for (const client of sockets.clients)
      if (client.readyState === client.OPEN && client.bufferedAmount < 2 * 1024 * 1024)
        client.send(message);
    res.writeHead(200).end('ok');
  } catch {
    res.writeHead(503).end('Unable to process event');
  }
});
server.on('upgrade', (req, socket, head) => {
  if (
    req.url !== '/events' ||
    !validToken(req.headers.authorization, token) ||
    sockets.clients.size >= 5
  ) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(req, socket, head, (client) => {
    client.on('error', () => {});
    client.on('message', () => client.close());
  });
});
const heartbeat = setInterval(() => {
  for (const client of sockets.clients) client.ping();
  for (const [id, time] of seen) if (Date.now() - time > 600000) seen.delete(id);
}, 30000);
server.requestTimeout = 10000;
server.listen(port, bind, () =>
  console.log(`Zetty Kick relay: http://${bind}:${port} (one broadcaster)`),
);
function close() {
  clearInterval(heartbeat);
  for (const client of sockets.clients) client.terminate();
  sockets.close();
  server.close();
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
