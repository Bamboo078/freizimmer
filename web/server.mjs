/*
 * Lokaler Server, der sich verhält wie Vercel:
 *   public/        -> statische Dateien
 *   api/xyz.js     -> /api/xyz
 *
 * Start:  node server.mjs
 * Dann:   http://localhost:3000
 *
 * Auf Vercel wird diese Datei nicht gebraucht – sie ist nur zum Ausprobieren.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = normalize(fileURLToPath(new URL('.', import.meta.url)));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Gibt einer Node-Response die Vercel-Methoden. */
function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.end(body); return res; };
  res.json = (obj) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

createServer(async (req, res) => {
  decorate(res);
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-zA-Z0-9_-]/g, '');
    try {
      const mod = await import(pathToFileURL(join(ROOT, 'api', name + '.js')).href);
      req.query = Object.fromEntries(url.searchParams);
      await mod.default(req, res);
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        res.status(404).json({ error: 'Keine API-Funktion namens ' + name });
      } else {
        console.error('[api/' + name + ']', err);
        res.status(500).json({ error: String(err && err.message || err) });
      }
    }
    return;
  }

  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.status(403).send('nope'); return; }

  try {
    const body = await readFile(file);
    res.setHeader('content-type', TYPES[extname(file)] || 'application/octet-stream');
    res.status(200).send(body);
  } catch {
    // Unbekannter Pfad -> index.html (wie bei einer Single-Page-App)
    try {
      const body = await readFile(join(PUBLIC, 'index.html'));
      res.setHeader('content-type', TYPES['.html']);
      res.status(200).send(body);
    } catch {
      res.status(404).send('not found');
    }
  }
}).listen(PORT, () => {
  console.log('Freizimmer läuft auf http://localhost:' + PORT);
  if (process.env.ISY_API) console.log('ISY_API = ' + process.env.ISY_API);
});
