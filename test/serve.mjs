// Winziger statischer Server, nur fuer den lokalen Mock-Test.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = normalize(join(ROOT, path === '/' ? '/test/mock-test.html' : path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('nope'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5173, () => console.log('http://localhost:5173/'));
