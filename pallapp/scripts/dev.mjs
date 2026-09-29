// Lokal utprøving uten Microsoft 365: npm run dev → http://localhost:8080
// Appen bruker da en simulert Excel-fil (lagres i .dev-data.json, ikke i Git).
// Bytt bruker med ?bruker=navn@gard.no i adressen.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockGraph } from '../test/mock-graph.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const dataFile = join(root, '.dev-data.json');
const persist = !process.env.NO_PERSIST;

const mock = createMockGraph({ latency: Number(process.env.LATENCY) || 300 });
if (persist && existsSync(dataFile)) {
  const saved = JSON.parse(readFileSync(dataFile, 'utf8'));
  mock.sheets = new Map(saved.sheets);
  mock.table = saved.table;
}
const save = () => persist && writeFileSync(dataFile, JSON.stringify({ sheets: [...mock.sheets], table: mock.table }));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const devConfig = `window.PALL_CONFIG = ${JSON.stringify({
  dev: { user: 'pakkeri@klokkargarden.no' }, graphBase: '/mock-graph/v1.0', fileUrl: 'https://klokkargarden.sharepoint.com/:x:/demo',
})};`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/mock-graph/')) {
    let body = '';
    for await (const c of req) body += c;
    const r = await mock.handle(req.method, url.pathname + url.search, body ? JSON.parse(body) : undefined);
    if (req.method !== 'GET') save();
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(r.body));
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end(devConfig);
  }
  if (url.pathname === '/vendor/msal-browser.min.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    return res.end('/* ikke brukt i utviklingsmodus */');
  }
  const file = join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(join(root, 'public')) || !existsSync(file)) {
    res.writeHead(404);
    return res.end('Ikke funnet');
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Pallsporing (utviklingsmodus, simulert Excel): http://localhost:${PORT}`);
});
