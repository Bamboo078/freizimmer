# Freizimmer – freie Räume an der Kantonsschule Romanshorn finden

Du gibst ein Zeitfenster ein (Datum, von, bis) und bekommst die Liste der Räume,
die in dieser Zeit frei sind – inklusive Angabe, wie lange sie noch frei bleiben.
Dazu gibt es ein Tagesraster (alle Räume × alle Lektionen auf einen Blick).

Die Daten kommen live aus isy, mit deinem normalen Schul-Login.

---

## Es gibt zwei Varianten

| | Läuft wo | Braucht |
|---|---|---|
| **[Website](web/README.md)** (Ordner `web`) | eigene URL, z. B. auf Vercel | einmal veröffentlichen; danach nur die URL – auch am Handy |
| **Bookmarklet / Userscript** (diese Anleitung) | direkt auf der isy-Seite | nichts installieren, aber ein offener isy-Tab |

Die Website ist bequemer, das Bookmarklet ist harmloser. Alles Weitere hier
betrifft das Bookmarklet – die Website hat ihre eigene Anleitung in
[`web/README.md`](web/README.md).

## Warum läuft das Bookmarklet auf der isy-Seite und nicht auf einer eigenen Website?

Kurz: isy lässt das nicht zu, und daran lässt sich von aussen nichts ändern.

* Die isy-Oberfläche (`isy.ksr.ch`) holt ihre Daten von einer getrennten API
  (`isy-api.ksr.ch/graphql`).
* Diese API schickt `Access-Control-Allow-Origin: https://isy.ksr.ch` – also
  **nur** die isy-Seite selbst darf sie aus dem Browser ansprechen. Eine Website
  auf einer anderen Adresse wird vom Browser blockiert (CORS).
* Die Anmeldung läuft über einen Bearer-Token, den die isy-App im Browser hält.

Deshalb läuft das Bookmarklet *innerhalb* der isy-Seite: dort ist der Login schon
da und die API erlaubt die Anfragen. Du musst dich also nirgends zusätzlich
einloggen und gibst dein Passwort nirgendwo ein.

Die CORS-Sperre gilt nur für Browser. Ein *Server* darf die API normal anfragen –
genau das macht die Website-Variante im Ordner `web`.

---

## Variante 1: Bookmarklet (nichts installieren) – empfohlen

Funktioniert auf jedem Rechner, auch auf Schul-PCs ohne Installationsrechte.

1. **`install.html` im Browser öffnen** (Doppelklick auf die Datei).
2. Den blauen Knopf **🔍 Freizimmer** auf die Lesezeichenleiste **ziehen**
   (nicht anklicken). Leiste einblenden mit `Strg`+`Umschalt`+`B`.
3. Auf `isy.ksr.ch` einloggen.
4. Auf das Lesezeichen **Freizimmer** klicken – die App öffnet sich über der Seite.

Ohne Ziehen geht es auch von Hand: Lesezeichen anlegen, als Adresse den ganzen
Inhalt von `bookmarklet.txt` einfügen.

> Falls der Browser beim Einfügen das `javascript:` am Anfang wegschneidet
> (macht Firefox manchmal), einfach `javascript:` wieder davorschreiben.

## Variante 2: Userscript (bequemer, dauerhaft)

Damit erscheint auf jeder isy-Seite unten rechts ein Knopf **🔍 Freizimmer**.

1. Browser-Erweiterung [Tampermonkey](https://www.tampermonkey.net/) oder
   Violentmonkey installieren.
2. Im Tampermonkey-Dashboard → *Neues Script erstellen*, alles löschen,
   den Inhalt von `freizimmer.user.js` einfügen, speichern (Strg+S).
3. isy neu laden – der Knopf ist da.

---

## Bedienung

| Element | Bedeutung |
|---|---|
| **Datum / Von / Bis** | Das Zeitfenster, in dem der Raum frei sein soll. |
| **Jetzt** | Setzt das Fenster auf die nächsten 45 Minuten ab jetzt. |
| **Lektions-Chips** | Werden aus den Stundenplandaten des Tages erkannt, ein Klick füllt Von/Bis. |
| **Raum suchen** | Filtert nach Raumname, z. B. `HL3` oder `Lab`. |
| **nur Unterrichtszimmer** | Blendet Labors, Vorbereitungs- und Besprechungsräume aus. |
| **frei bis 14:50** | Ab dann ist der Raum wieder gebucht. |
| **danach nichts gebucht** | Für den Rest des Tages frei. |
| **Tagesraster** | Tabelle aller Räume über alle Lektionen des Tages. |

Geteilte Räume werden berücksichtigt: Ist der Gesamtraum gebucht, gelten auch
seine Teilräume als belegt – und umgekehrt.

---

## Wichtig zu wissen

* **„Frei“ heisst „laut isy nicht gebucht“.** Das ist keine Reservation. Wenn du
  einen Raum verbindlich brauchst, geht das weiterhin nur über die normale
  Raumreservation bzw. das Sekretariat.
* Kurzfristige Änderungen, die nicht in isy stehen, sieht das Tool nicht.
* Das Tool **liest nur** – es bucht, ändert und löscht nichts.

---

## Mit echten Daten prüfen (`diagnose.js`)

Wenn etwas nicht wie erwartet aussieht, sagt dieses Skript, welcher Teil klemmt:

1. Auf `isy.ksr.ch` einloggen.
2. `F12` → Reiter **Console**.
3. Warnt Chrome/Edge vor dem Einfügen: `allow pasting` tippen, Enter.
4. Ganzen Inhalt von `diagnose.js` einfügen, Enter.

Es wird nur gelesen. Der Bericht zeigt: Token gefunden? Wie viele Räume? Geht die
Sammelabfrage oder nur die Abfrage pro Raum? In welchem Format kommen die
Zeitangaben? Der Text landet auch in der Zwischenablage.

## Wenn etwas nicht geht

| Meldung / Verhalten | Ursache und Lösung |
|---|---|
| „Kein Login-Token gefunden“ | Du bist nicht (mehr) in isy angemeldet. isy-Tab neu laden, einloggen, nochmal klicken. |
| „isy hat den Zugriff abgelehnt (401/403)“ | Login abgelaufen → isy-Seite neu laden. |
| Alles wird als frei angezeigt | Die Belegungsabfrage lief ins Leere. Im Browser die Konsole (F12) öffnen und schauen, ob `[Freizimmer]` einen Fehler meldet. |
| Nichts passiert beim Lesezeichen-Klick | Du bist nicht auf `isy.ksr.ch`. Das Bookmarklet funktioniert nur dort. |
| Keine Lektions-Chips | An diesem Tag hat isy keine Lektionen – z. B. Wochenende oder Ferien. |

Zum Nachschauen in der Browser-Konsole:

```js
__freizimmer__.state          // geladene Räume und Belegungen
__freizimmer__.state.strategy // "A" = eine Sammelabfrage, "B" = pro Raum
__freizimmer__.reload()       // Daten neu laden
```

---

## Dateien

| Datei | Zweck |
|---|---|
| `freizimmer.user.js` | Der ganze Code (Userscript-Variante, gut lesbar). |
| `install.html` | Installationsseite mit Zieh-Link für die Lesezeichenleiste. |
| `bookmarklet.txt` | Daraus gebaute Bookmarklet-Zeile. |
| `diagnose.js` | Prüft auf der echten isy-Seite, was funktioniert. |
| `build-bookmarklet.mjs` | Baut `bookmarklet.txt` und `install.html` neu: `node build-bookmarklet.mjs` |
| `test/mock-test.html` | Testet die Logik gegen eine nachgebaute isy-API (ohne Login). |
| `test/bookmarklet-test.html` | Prüft, ob das gebaute Bookmarklet startet. |
| `test/diagnose-test.html` | Prüft, ob `diagnose.js` durchläuft. |
| `test/serve.mjs` | Kleiner lokaler Server für die Tests. |

Tests starten:

```bash
node test/serve.mjs
```

Dann öffnen:
`http://localhost:5173/` (Logik),
`http://localhost:5173/test/bookmarklet-test.html` (Bookmarklet),
`http://localhost:5173/test/diagnose-test.html` (Diagnose).

---

## Wie es technisch funktioniert

1. **Token**: aus dem Pinia-Store der isy-App (`tokenManager.getToken()`).
   Klappt das nicht, wird der `Authorization`-Header aus den laufenden Requests
   der App mitgelesen. Es wird nichts entschlüsselt und nichts gespeichert.
2. **Räume**: GraphQL `resources(isRoom: true, …)` – dieselbe Abfrage, die auch
   die Raumliste in isy benutzt.
3. **Belegungen**, zwei Wege:
   * **A** – `messages(context: { segment: "appointmentsOccupiedWithResources" })`
     holt alle Belegungen des Tages in einer Abfrage.
   * **B** – Fallback: `messages(context: { segment: "appointmentsByRoom" })`
     pro Raum (das benutzt auch die Raum-Ansicht von isy). Wird automatisch
     verwendet, wenn A fehlschlägt oder an einem Schultag nichts zurückgibt.
4. **Auswertung** passiert lokal im Browser: ein Raum ist frei, wenn keine
   Belegung das gewählte Fenster überlappt (`start < bis && ende > von`).
