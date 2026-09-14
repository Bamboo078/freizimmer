# Freizimmer – Website

Eigene Website statt Bookmarklet: du öffnest eine normale URL, meldest dich mit
deinem isy-Login an und siehst die freien Räume. Funktioniert auf dem Handy
genauso wie am Computer, ohne Add-on und ohne offenen isy-Tab.

## Warum das hier geht, im Browser aber nicht

Die isy-API erlaubt Browser-Anfragen nur von `isy.ksr.ch` (CORS). Diese Regel
gilt aber **nur für Browser**. Der Server dieser Website fragt isy serverseitig
an – dort greift die Sperre nicht.

```
Dein Browser  ──►  deine Website (Vercel)  ──►  isy-api.ksr.ch
              ◄──  fertige Raumliste      ◄──
```

## Umgang mit dem Passwort

* Dein isy-Passwort geht **einmal** an `/api/login`, wird dort sofort gegen ein
  Token getauscht und danach verworfen. Es wird nirgends gespeichert.
* Gespeichert werden nur die Token, und zwar als `HttpOnly`-Cookie in **deinem**
  Browser. Der Server selbst legt gar nichts ab – es gibt keine Datenbank.
* Läuft das Token ab, erneuert der Server es automatisch über den Refresh-Token.

**Gib die URL nicht weiter.** Eine Seite, die nach isy-Passwörtern fragt, ist für
andere nicht von einer Phishing-Seite zu unterscheiden – auch wenn sie es nicht
ist. Für dich allein ist das in Ordnung; als Angebot an die Klasse nicht.
Mit der Umgebungsvariable `FREIZIMMER_CODE` kannst du zusätzlich einen
Zugangscode davorschalten, dann sieht ein Fremder nicht einmal das Login-Formular.

---

## Auf Vercel veröffentlichen

Du brauchst einen kostenlosen Vercel-Account (Hobby-Tarif reicht) und Node auf
dem Rechner.

**Wichtig: alle Befehle im Ordner `web` ausführen**, nicht im Hauptordner.

```bash
cd web
npx vercel login
npx vercel
```

Beim ersten `npx vercel` fragt es ein paar Sachen – überall die Vorgabe mit
Enter bestätigen reicht:

| Frage | Antwort |
|---|---|
| Set up and deploy? | `y` |
| Which scope? | dein Account |
| Link to existing project? | `n` |
| Project name? | z. B. `freizimmer` |
| In which directory is your code located? | `./` (du bist ja schon in `web`) |

Danach die richtige Veröffentlichung:

```bash
npx vercel --prod
```

Am Ende steht die URL, z. B. `https://freizimmer.vercel.app`. Die im Handy-Browser
öffnen → anmelden → fertig.

### Optional: Zugangscode

```bash
npx vercel env add FREIZIMMER_CODE production
```

Code eingeben, danach nochmal `npx vercel --prod`. Ab dann verlangt die Seite
zusätzlich diesen Code.

### Optional: Server näher an die Schweiz

Im Vercel-Dashboard unter *Settings → Functions → Function Region* auf
**Frankfurt (fra1)** stellen. Macht das Laden spürbar schneller, ist aber nicht nötig.

### Aufs Handy legen

Die Seite ist eine PWA: in Safari bzw. Chrome auf *Teilen → Zum Home-Bildschirm*.
Dann sieht sie aus wie eine App.

---

## Falls Vercel nicht klappt

`server.mjs` liefert Website **und** API aus einem Node-Prozess. Damit läuft das
Ganze überall, wo Node laufen darf:

```bash
npm start          # startet auf Port 3000, PORT=... setzt einen anderen
```

Das passt z. B. für Render, Railway, Fly.io oder einen Raspberry Pi zu Hause.
Als Startbefehl `npm start` angeben, Node 20 oder neuer.

---

## Lokal ausprobieren (ohne echten isy-Login)

Es gibt eine Attrappe der isy-API mit Beispieldaten:

```bash
npm run mock
```

Dann `http://localhost:3000` öffnen, Login **testuser / geheim**.

Testschalter der Attrappe, während sie läuft:

```bash
curl http://localhost:4000/_expire            # Token entwerten -> testet die Token-Erneuerung
curl "http://localhost:4000/_nosegment?on=1"  # Sammelabfrage sperren -> testet Strategie B
curl "http://localhost:4000/_nosegment?on=0"  # wieder erlauben
```

Gegen das **echte** isy lokal testen:

```bash
node server.mjs
```

(ohne `ISY_API` geht es automatisch an `https://isy-api.ksr.ch`)

---

## Aufbau

| Datei | Zweck |
|---|---|
| `api/login.js` | Anmeldung bei isy, setzt die Token-Cookies. |
| `api/logout.js` | Cookies löschen. |
| `api/me.js` | Sagt der Seite, ob angemeldet. |
| `api/data.js` | Räume + Belegungen eines Tages, inklusive Fallback-Strategie. |
| `api/_isy.js` | Gemeinsame Helfer: Login, Token-Erneuerung, GraphQL, Cookies. |
| `public/index.html` | Aufbau der Seite. |
| `public/app.js` | Bedienung und Darstellung. |
| `public/core.js` | Reine Rechenlogik frei/belegt – ohne DOM, gut testbar. |
| `server.mjs` | Server für lokal und für Hosts ohne Serverless. |
| `test/mock-isy.mjs` | Attrappe der isy-API. |
| `test/dev-mock.mjs` | Startet Website + Attrappe zusammen. |

### Wie „frei“ berechnet wird

1. `resources(isRoom: true, …)` → alle Räume.
2. Belegungen des Tages, zwei Wege:
   * **A**: `messages(context: { segment: "appointmentsOccupiedWithResources" })`
     – alles in einer Abfrage.
   * **B**: `messages(context: { segment: "appointmentsByRoom" })` pro Raum –
     wird automatisch genommen, wenn A nicht erlaubt ist oder an einem Schultag
     leer bleibt.
3. Ein Raum ist frei, wenn keine Belegung das Fenster überlappt:
   `start < bis && ende > von`.
4. Ist ein Gesamtraum gebucht, gelten seine Teilräume ebenfalls als belegt – und
   umgekehrt.
