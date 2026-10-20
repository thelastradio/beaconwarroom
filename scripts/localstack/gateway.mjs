// LOCAL TEST ONLY. Stands in for the Supabase gateway + Vercel functions so the app can be
// tested without cloud accounts. Routes:
//   /auth/v1/*    -> Supabase Auth (GoTrue) on :9999
//   /rest/v1/*    -> PostgREST on :3000
//   /storage/v1/* -> tiny fake file store (no access rules; real rules are tested in Supabase)
//   /api/*        -> the real server functions in /api
//   /mock-anthropic/v1/messages -> canned research answers (no real API key here)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = '/opt/bwr/storage';
fs.mkdirSync(files, { recursive: true });
const PORT = 54321;

function proxy(req, res, port, stripPrefix) {
  const url = req.url.replace(stripPrefix, '') || '/';
  const p = http.request({ host: '127.0.0.1', port, path: url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, 'access-control-allow-origin': '*' });
    r.pipe(res);
  });
  p.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(p);
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-upsert, prefer, range, accept-profile, content-profile',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

async function body(req) {
  const c = [];
  for await (const x of req) c.push(x);
  return Buffer.concat(c);
}

function mockAnthropic(raw, res) {
  const j = JSON.parse(raw.toString() || '{}');
  const p = j.messages?.[0]?.content || '';
  const cat = (p.match(/Research ONLY this category: ([^:]+):/) || [])[1] || '';
  const url = 'https://licensing.example.gov/events/performance';
  const findings = /permit/i.test(cat)
    ? [{ requirement: 'Apply for a public performance licence', authority: 'City Police Licensing Unit', lead_time_days: 30, fee: '', source_url: url, source_quote: 'apply at least 30 days in advance', official: true },
       { requirement: 'Unsourced claim that should not be official', authority: 'Blog', lead_time_days: 5, fee: '', source_url: 'https://made-up.example.com/x', source_quote: 'x', official: true }]
    : /Music rights/i.test(cat)
      ? [{ requirement: 'Event music licence from the collecting society', authority: 'Music Society', lead_time_days: null, fee: '', source_url: 'https://musicsociety.example.org/events', source_quote: 'events need a licence', official: true }]
      : [];
  const out = {
    id: 'msg_mock', type: 'message', role: 'assistant', stop_reason: 'end_turn',
    usage: { input_tokens: 1200, output_tokens: 300, server_tool_use: { web_search_requests: 2 } },
    content: [
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: cat } },
      { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [
        { type: 'web_search_result', url, title: 'Licensing' },
        { type: 'web_search_result', url: 'https://musicsociety.example.org/events', title: 'Music' }] },
      { type: 'text', text: `<json>${JSON.stringify({ findings })}</json>` },
    ],
  };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(out));
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/auth/v1')) return proxy(req, res, 9999, '/auth/v1');
  if (u.pathname.startsWith('/rest/v1')) return proxy(req, res, 3000, '/rest/v1');
  if (u.pathname.startsWith('/realtime/v1')) { res.writeHead(404, cors); return res.end(); }
  if (u.pathname === '/mock-anthropic/v1/messages') return mockAnthropic(await body(req), res);

  if (u.pathname.startsWith('/storage/v1/object/sign/')) {
    const rest = decodeURIComponent(u.pathname.replace('/storage/v1/object/sign/', ''));
    if (req.method === 'POST') {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ signedURL: `/object/sign/${rest}?token=local` }));
    }
    const f = path.join(files, rest);
    if (!fs.existsSync(f)) { res.writeHead(404, cors); return res.end(); }
    res.writeHead(200, { ...cors, 'content-type': 'image/jpeg' });
    return fs.createReadStream(f).pipe(res);
  }
  if (u.pathname.startsWith('/storage/v1/object/')) {
    const rest = decodeURIComponent(u.pathname.replace('/storage/v1/object/', ''));
    if (!req.headers.authorization) { res.writeHead(401, cors); return res.end(); }
    const f = path.join(files, rest);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, await body(req));
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ Key: rest, Id: rest }));
  }

  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z-]/g, '');
    const file = path.join(root, 'api', `${name}.js`);
    if (!fs.existsSync(file)) { res.writeHead(404, cors); return res.end(); }
    const raw = await body(req);
    try { req.body = raw.length ? JSON.parse(raw.toString()) : {}; } catch { req.body = {}; }
    for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
    const mod = await import(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`);
    return mod.default(req, res);
  }
  res.writeHead(404, cors); res.end('not found');
}).listen(PORT, () => console.log(`gateway on :${PORT}`));
