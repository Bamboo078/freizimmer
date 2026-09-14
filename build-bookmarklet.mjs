/*
 * Baut aus freizimmer.user.js das Bookmarklet (bookmarklet.txt).
 *
 *   node build-bookmarklet.mjs
 *
 * Der Code wird komplett prozent-kodiert. Das ist etwas laenger als eine
 * minifizierte Variante, aber dafuer gehen keine Zeilenumbrueche verloren,
 * wenn man den Text in das Adressfeld eines Lesezeichens einfuegt.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const src = await readFile(join(here, 'freizimmer.user.js'), 'utf8');

// UserScript-Metablock entfernen - der wird im Bookmarklet nicht gebraucht.
const code = src.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\n?/, '');

const wrapped = 'window.__freizimmerAutoOpen=true;\n' + code;
const bookmarklet = 'javascript:' + encodeURIComponent(wrapped);

await writeFile(join(here, 'bookmarklet.txt'), bookmarklet, 'utf8');

/* --- Installationsseite mit Zieh-Link ------------------------------- *
 * Der kodierte Code enthaelt keine doppelten Anfuehrungszeichen (die
 * kodiert encodeURIComponent zu %22), darum ist er als href sicher.
 */
const installHtml = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Freizimmer installieren</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 24px; margin-bottom: 4px; }
  .sub { color: #667085; margin-top: 0; }
  .drag { display: inline-block; background: #2a6df4; color: #fff; text-decoration: none;
          font-weight: 600; padding: 12px 22px; border-radius: 10px; font-size: 17px;
          cursor: grab; box-shadow: 0 4px 14px rgba(42,109,244,.35); }
  .box { border: 1px solid #e4e7ec; border-radius: 12px; padding: 20px; margin: 24px 0;
         text-align: center; background: rgba(127,127,127,.06); }
  ol { padding-left: 20px; }
  li { margin-bottom: 8px; }
  code { background: rgba(127,127,127,.15); padding: 1px 5px; border-radius: 4px; font-size: 14px; }
  .warn { font-size: 14px; color: #667085; }
</style>
</head>
<body>
  <h1>Freizimmer installieren</h1>
  <p class="sub">Freie Räume an der Kantonsschule Romanshorn finden.</p>

  <div class="box">
    <p><strong>Diesen Knopf auf die Lesezeichenleiste ziehen:</strong></p>
    <p><a class="drag" href="${bookmarklet}">🔍 Freizimmer</a></p>
    <p class="warn">Nicht anklicken – ziehen. (Lesezeichenleiste einblenden: Strg+Umschalt+B)</p>
  </div>

  <h2>Danach</h2>
  <ol>
    <li>Auf <a href="https://isy.ksr.ch">isy.ksr.ch</a> einloggen.</li>
    <li>Auf das Lesezeichen <strong>Freizimmer</strong> klicken.</li>
    <li>Datum und Zeitfenster eingeben – fertig.</li>
  </ol>

  <h2>Ziehen geht nicht?</h2>
  <p>Dann von Hand: Lesezeichen anlegen, als Adresse den ganzen Inhalt von
     <code>bookmarklet.txt</code> einfügen. Falls der Browser <code>javascript:</code>
     am Anfang wegschneidet, wieder davorschreiben.</p>
</body>
</html>
`;

await writeFile(join(here, 'install.html'), installHtml, 'utf8');

console.log('bookmarklet.txt geschrieben – %d Zeichen', bookmarklet.length);
console.log('install.html geschrieben (Zieh-Link)');
