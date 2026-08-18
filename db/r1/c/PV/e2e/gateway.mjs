// PV-E2E gateway — makes a real GoTrue + real PostgREST look like one
// Supabase origin to the real app build. No auth logic of its own:
// it only routes /auth/v1/* and /rest/v1/* and adds CORS for the app origin.
// Usage: node gateway.mjs <listenPort> <authPort> <restPort>
import http from 'node:http';

const [, , LISTEN, AUTH, REST] = process.argv;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-expose-headers': 'content-range,content-location,x-total-count',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  let target = null, path = req.url;
  if (req.url.startsWith('/auth/v1')) { target = Number(AUTH); path = req.url.slice('/auth/v1'.length) || '/'; }
  else if (req.url.startsWith('/rest/v1')) { target = Number(REST); path = req.url.slice('/rest/v1'.length) || '/'; }
  if (!target) { res.writeHead(404, CORS); return res.end('{"error":"pve-gateway: no route"}'); }

  const headers = { ...req.headers, host: `127.0.0.1:${target}` };
  delete headers['accept-encoding'];
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;

  const up = http.request({ host: '127.0.0.1', port: target, path, method: req.method, headers }, (ur) => {
    res.writeHead(ur.statusCode || 500, { ...ur.headers, ...CORS });
    ur.pipe(res);
  });
  up.on('error', (e) => {
    res.writeHead(502, { ...CORS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'pve-gateway upstream', detail: String(e) }));
  });
  req.pipe(up);
});

// realtime is out of scope for this stage: close the upgrade instead of hanging.
server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(Number(LISTEN), '127.0.0.1', () => console.log(`pve-gateway ${LISTEN} -> auth ${AUTH} / rest ${REST}`));
