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
* Die Token liegen als `HttpOnly`-Cookie in **deinem** Browser, nicht auf dem
  Server. Läuft das Token ab, erneuert der Server es über den Refresh-Token.
* Gespeichert wird auf dem Server nur, was du selbst meldest („Raum HL3.02 war
  am 14.09. in der 3. Lektion abgeschlossen“) – mit deinem isy-Benutzernamen
  dran, damit andere sehen, von wem die Meldung kommt, und du sie zurücknehmen
  kannst. Keine Passwörter, keine Token, kein Stundenplan.

**Gib die URL nicht weiter.** Eine Seite, die nach isy-Passwörtern fragt, ist für
andere nicht von einer Phishing-Seite zu unterscheiden – auch wenn sie es nicht
ist. Für dich allein ist das in Ordnung; als Angebot an die Klasse nicht.
Mit der Umgebungsvariable `FREIZIMMER_CODE` kannst du zusätzlich einen
Zugangscode davorschalten, dann sieht ein Fremder nicht einmal das Login-Formular.

---

## Bedienung

| Element | Bedeutung |
|---|---|
| **Datum** | Der Tag, um den es geht. |
| **Jetzt** | Springt auf heute und wählt die laufende Lektion. |
| **Lektionen** | Ein Knopf pro Lektion des Tages. **Mehrere gleichzeitig möglich** – auch solche, die nicht aufeinanderfolgen (z. B. 2. und 5.). Nochmal tippen wählt wieder ab. |
| **ganzer Tag** | Wählt alle Lektionen auf einmal; nochmal tippen wählt alle ab. |
| **Von / Bis** | Freie Zeitspanne statt Lektionen – nur wirksam, solange keine Lektion gewählt ist. |
| **Gebäude** | Ein Knopf pro Kürzel (HL, HM, HR, K, xt …) mit Anzahl Räume. Standardmässig sind nur **HL, HM und HR** an; *alle* schaltet um. |
| **Raum suchen** | Zusätzlicher Textfilter, z. B. `3.0` oder `Lab`. |
| **Sortieren** | Raum A–Z, Raum Z–A, *Stockwerk – oben zuerst* (3.01 vor 1.01) oder längste freie Zeit. |
| **nur Unterrichtszimmer** | Blendet Labors, Vorbereitungs- und Besprechungsräume aus. |

Sind mehrere Lektionen gewählt, zeigt die Liste nur Räume, die in **allen**
gewählten Lektionen frei sind. Bei den belegten Räumen steht dazu, in welcher
der gewählten Lektionen es klemmt.

Gebäudeauswahl, Sortierung und der Haken bleiben gespeichert – allerdings nur in
dem Browser, in dem du sie eingestellt hast (`localStorage`).

Am Handy sind die Lektionsknöpfe eine Zeile zum Wischen, und alles unter
*Eigene Zeit, Gebäude & Filter* ist eingeklappt, bis man es braucht.

Das Gebäude-Kürzel sind die Buchstaben vor der Nummer: `HL3.02` → `HL`,
`xt1` → `xt`. `HMR1` bildet deshalb eine eigene Gruppe `HMR` und ist
standardmässig nicht dabei – bei Bedarf einfach dazuschalten.

---

## Meldungen: was isy nicht weiss

isy weiss, was gebucht ist. isy weiss nicht, dass ein Zimmer abgeschlossen ist
oder dass schon jemand drinsitzt. Deshalb kann man das melden – und alle, die
die Seite benutzen, sehen es sofort.

Ein Tipp auf eine Raumkarte (oder auf den Raumnamen im Tagesraster) öffnet das
Meldefenster:

| Meldung | Bedeutung |
|---|---|
| ✓ **war frei** | Tür offen, niemand drin – hat geklappt. |
| ● **wir sind drin** | Wir benutzen den Raum gerade, bitte nicht doppelt hinlaufen. |
| ✕ **besetzt** | Es sitzt schon jemand anderes drin. |
| 🔒 **abgeschlossen** | Tür zu, Raum heute nicht nutzbar. |

Dazu wählt man, **wofür** die Meldung gilt: nur für die gewählten Lektionen
oder für den ganzen Tag. Ein abgeschlossenes Zimmer meldet man sinnvollerweise
für den ganzen Tag, „wir sind drin“ nur für die Lektion.

Jede Person hat pro Raum und Lektion genau eine Meldung; eine neue ersetzt die
alte, und *Meine Meldung zurücknehmen* löscht sie wieder. Gemeldete Räume
rutschen in der Liste nach unten und bekommen ein farbiges Etikett.

### Wahrscheinlichkeiten

Aus allen Meldungen wächst mit der Zeit eine Einschätzung – getrennt nach
**Wochentag und Lektion**, weil genau das der Unterschied ist: HL3.02 ist am
Montag in der 3. Lektion vielleicht immer zu und am Donnerstag nie.

Im Meldefenster stehen drei Balken:

* **nutzbar** – frei angetroffen oder selbst benutzt
* **besetzt** – jemand anderes war drin
* **abgeschlossen** – Tür war zu

Gerechnet wird mit Laplace-Glättung (+1 pro Gruppe). Eine einzige Meldung sagt
darum nicht gleich „100 %“, sondern bleibt vorsichtig. Auf der Raumkarte steht
eine Kurzfassung („oft abgeschlossen · 60 %“), sobald es überhaupt Meldungen
gibt.

Was gespeichert wird: Raum, Tag, Lektion, Zustand, isy-Benutzername und der
Zeitpunkt. Kein Passwort, kein Token. Die Meldungen eines Tages verfallen nach
30 Tagen, die reine Zählstatistik bleibt.

### Speicher einrichten (sonst wird nichts geteilt)

Die Meldungen brauchen einen Ort, an dem sie liegen können. Ohne den läuft die
Seite ganz normal weiter, aber die Meldungen bleiben im Arbeitsspeicher der
Funktion – auf Vercel heisst das: praktisch sofort weg. Die Seite sagt das dann
auch selbst in einem Hinweiskasten.

Auf Vercel im Dashboard: *Storage → Create Database → Upstash for Redis*
(kostenloser Tarif reicht locker) und mit dem Projekt verbinden. Vercel setzt
die Variablen dann selbst:

```
KV_REST_API_URL
KV_REST_API_TOKEN
```

Alternativ direkt bei [Upstash](https://upstash.com) eine Redis-Datenbank
anlegen und die zwei Werte von Hand eintragen:

```bash
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
npx vercel --prod
```

Beide Namenspaare funktionieren; es genügt eines davon.

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
| `api/status.js` | Geteilte Meldungen lesen und schreiben, Statistik mitführen. |
| `api/_isy.js` | Gemeinsame Helfer: Login, Token-Erneuerung, GraphQL, Cookies. |
| `api/_store.js` | Speicher für die Meldungen (Redis über HTTP, sonst Arbeitsspeicher). |
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
4. Sind mehrere Lektionen gewählt, muss das für **jede** einzeln gelten.
5. Ist ein Gesamtraum gebucht, gelten seine Teilräume ebenfalls als belegt – und
   umgekehrt.
6. Die Meldungen der anderen kommen getrennt davon aus `/api/status` und werden
   alle 45 Sekunden nachgeladen.
