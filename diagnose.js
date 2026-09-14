/*
 * Freizimmer – Diagnose
 * =====================
 * Prueft auf der echten isy-Seite, was funktioniert und was nicht.
 * Es wird nur gelesen, nichts gebucht oder geaendert.
 *
 * Anwendung:
 *   1. Auf https://isy.ksr.ch einloggen
 *   2. F12 -> Reiter "Console"
 *   3. Falls Chrome/Edge warnt: "allow pasting" tippen und Enter
 *   4. Den ganzen Inhalt dieser Datei einfuegen und Enter
 *   5. Den ausgegebenen Bericht kopieren
 */

(async () => {
  const report = [];
  const add = (line) => { report.push(line); console.log('[Freizimmer-Check] ' + line); };

  const API_BY_HOST = {
    'isy.ksr.ch': 'https://isy-api.ksr.ch',
    'isytest.ksr.ch': 'https://isytest-api.ksr.ch',
    'isydev.ksr.ch': 'https://isydev-api.ksr.ch',
    'isybox.ksr.ch': 'https://isybox-api.ksr.ch',
  };
  const API = API_BY_HOST[location.hostname] ||
    'https://' + location.hostname.split('.')[0] + '-api.ksr.ch';

  add('--- Freizimmer Diagnose ---');
  add('Seite:      ' + location.origin);
  add('API:        ' + API);

  if (!/^isy/.test(location.hostname) || !/ksr\.ch$/.test(location.hostname)) {
    add('ABBRUCH: Das muss auf isy.ksr.ch laufen, nicht auf ' + location.hostname + '.');
    console.log(report.join('\n'));
    return;
  }

  /* --- 1. Token ---------------------------------------------------- */
  let token = null;
  let tokenSource = 'nicht gefunden';
  try {
    const roots = [document.querySelector('#app')].concat(
      Array.from(document.body ? document.body.children : [])
    );
    let app = null;
    for (const el of roots) { if (el && el.__vue_app__) { app = el.__vue_app__; break; } }

    if (!app) {
      add('1. Token:    KEINE Vue-App gefunden (ist die isy-Seite fertig geladen?)');
    } else {
      const provides = (app._context && app._context.provides) || {};
      let pinia = null;
      for (const key of Reflect.ownKeys(provides)) {
        const v = provides[key];
        if (v && v._s && typeof v._s.get === 'function') { pinia = v; break; }
      }
      if (!pinia) {
        add('1. Token:    Vue-App da, aber kein Pinia-Store gefunden');
      } else {
        add('           Stores: ' + Array.from(pinia._s.keys()).join(', '));
        const store = pinia._s.get('token');
        if (!store) {
          add('1. Token:    Store "token" fehlt');
        } else {
          const mgr = store.tokenManager;
          add('           tokenManager: ' + (mgr ? 'ja' : 'nein') +
              ', Methoden: ' + (mgr ? Object.getOwnPropertyNames(Object.getPrototypeOf(mgr)).join(',') : '-'));
          const t = (mgr && typeof mgr.getToken === 'function' && mgr.getToken()) ||
                    (typeof store.getToken === 'function' && store.getToken()) || null;
          if (typeof t === 'string' && t.length > 20) {
            token = t;
            tokenSource = 'Pinia-Store';
          }
        }
      }
    }
  } catch (e) {
    add('1. Token:    Fehler beim Auslesen: ' + e.message);
  }

  add('1. Token:    ' + (token
    ? 'OK (' + tokenSource + ', Laenge ' + token.length + ', beginnt mit "' + token.slice(0, 6) + '...")'
    : 'FEHLT'));

  if (!token) {
    add('   -> Ohne Token geht nichts. Seite neu laden, einloggen, nochmal versuchen.');
    console.log('\n===== BERICHT (kopieren) =====\n' + report.join('\n'));
    window.__fzReport = report.join('\n');
    return;
  }

  /* --- Hilfsfunktion ------------------------------------------------ */
  async function gql(name, query, variables) {
    const res = await fetch(API + '/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify({ query: query, variables: variables || {} }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: 'HTTP ' + res.status + ' ' + body.slice(0, 200) };
    }
    const json = await res.json();
    if (json.errors && json.errors.length) {
      return { error: json.errors.map((e) => e.message).join(' | ').slice(0, 300) };
    }
    return { data: json.data };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const off = -now.getTimezoneOffset();
  const tz = (off < 0 ? '-' : '+') + pad(Math.floor(Math.abs(off) / 60)) + ':' + pad(Math.abs(off) % 60);
  const dayStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  const start = dayStr + 'T00:00:00' + tz;
  const end = dayStr + 'T23:59:59' + tz;
  add('Datum:      ' + dayStr + ' (' + start + ' bis ' + end + ')');

  /* --- 2. Raeume ---------------------------------------------------- */
  const Q_ROOMS_FULL = `query freizimmerRooms {
    resources(isRoom: true, order: { descShort: "asc" }, booking_list: [1,2,3,4], showDeleted: false) {
      id _id descShort description partOf { id descShort } partOfChildren(showDeleted: false) { id descShort }
    } }`;
  const Q_ROOMS_SLIM = `query freizimmerRoomsSlim {
    resources(isRoom: true, order: { descShort: "asc" }, booking_list: [1,2,3,4], showDeleted: false) {
      id _id descShort description
    } }`;

  let rooms = [];
  let r = await gql('rooms-full', Q_ROOMS_FULL);
  if (r.error) {
    add('2. Räume:    Abfrage MIT Teilraum-Feldern fehlgeschlagen: ' + r.error);
    r = await gql('rooms-slim', Q_ROOMS_SLIM);
    if (r.error) add('2. Räume:    auch die einfache Abfrage schlug fehl: ' + r.error);
    else add('2. Räume:    OK über den Fallback (ohne Teilraum-Logik)');
  }
  if (r.data) {
    rooms = r.data.resources || [];
    add('2. Räume:    ' + rooms.length + ' gefunden' +
        (rooms.length ? ', z.B. ' + rooms.slice(0, 4).map((x) => x.descShort).join(', ') : ''));
    if (rooms[0]) add('           Beispiel-ID: ' + rooms[0].id + '  (_id ' + rooms[0]._id + ')');
  }

  /* --- 3. Strategie A ----------------------------------------------- */
  const Q_OCC = `query freizimmerOccupied($start: String!, $end: String!, $first: Int) {
    messages(context: { segment: "appointmentsOccupiedWithResources" },
             withinDateRange: { field: "dt", start: $start, end: $end }, first: $first) {
      pageInfo { hasNextPage endCursor }
      edges { node { id calculatedTitleShort agendaResourceTitle dtFrom dtTo
        resources(showDeleted: false, booked_list: [1,2]) {
          edges { node { id resource { id descShort } } } } } } } }`;

  const a = await gql('occupied', Q_OCC, { start, end, first: 500 });
  let aCount = null;
  if (a.error) {
    add('3. Sammelabfrage (Strategie A): FEHLER -> ' + a.error);
  } else {
    const edges = (a.data.messages && a.data.messages.edges) || [];
    aCount = edges.length;
    add('3. Sammelabfrage (Strategie A): OK, ' + aCount + ' Belegungen heute' +
        (a.data.messages.pageInfo && a.data.messages.pageInfo.hasNextPage ? ' (weitere Seiten vorhanden)' : ''));
    const n = edges[0] && edges[0].node;
    if (n) {
      add('           Beispiel: "' + (n.calculatedTitleShort || n.agendaResourceTitle) + '"');
      add('           dtFrom=' + n.dtFrom + '  dtTo=' + n.dtTo);
      const res0 = n.resources && n.resources.edges && n.resources.edges[0];
      add('           Raum dazu: ' + (res0 ? res0.node.resource.descShort + ' / ' + res0.node.resource.id : 'KEINER!'));
    }
  }

  /* --- 4. Strategie B ----------------------------------------------- */
  const Q_ROOM = `query freizimmerByRoom($iri: String!, $start: String!, $end: String!, $first: Int) {
    messages(context: { segment: "appointmentsByRoom", iri: $iri },
             withinDateRange: { field: "dt", start: $start, end: $end },
             showDeleted: false, outputContext: "calendar:resource",
             order: { dtFrom: "asc" }, first: $first) {
      pageInfo { hasNextPage endCursor }
      edges { node { id title calculatedTitleShort dtFrom dtTo } } } }`;

  if (rooms.length) {
    // Einen Raum nehmen, der heute moeglichst belegt ist.
    const probe = rooms[Math.min(3, rooms.length - 1)];
    const b = await gql('byRoom', Q_ROOM, { iri: probe.id, start, end, first: 200 });
    if (b.error) {
      add('4. Pro-Raum-Abfrage (Strategie B): FEHLER -> ' + b.error);
    } else {
      const edges = (b.data.messages && b.data.messages.edges) || [];
      add('4. Pro-Raum-Abfrage (Strategie B): OK für ' + probe.descShort + ', ' + edges.length + ' Belegungen');
      const n = edges[0] && edges[0].node;
      if (n) add('           Beispiel: "' + (n.calculatedTitleShort || n.title) + '" ' + n.dtFrom + ' → ' + n.dtTo);
    }
  } else {
    add('4. Pro-Raum-Abfrage: übersprungen (keine Räume geladen)');
  }

  /* --- Fazit -------------------------------------------------------- */
  const weekday = now.getDay() >= 1 && now.getDay() <= 5;
  add('---');
  if (!rooms.length) {
    add('FAZIT: Räume lassen sich nicht laden – ohne die geht es nicht.');
  } else if (aCount === null) {
    add('FAZIT: Strategie A geht nicht, das Tool nimmt automatisch Strategie B. Prüfen, ob Punkt 4 OK ist.');
  } else if (aCount === 0 && weekday) {
    add('FAZIT: Strategie A liefert an einem Schultag 0 Belegungen – das Tool schaltet dann auf Strategie B um.');
  } else {
    add('FAZIT: Sieht gut aus, Freizimmer sollte mit echten Daten laufen.');
  }

  const text = report.join('\n');
  window.__fzReport = text;
  console.log('\n===== BERICHT (kopieren und schicken) =====\n' + text);
  try {
    await navigator.clipboard.writeText(text);
    console.log('(Bericht liegt auch in der Zwischenablage)');
  } catch (e) {
    console.log('(Zwischenablage nicht erlaubt – Text oben markieren, oder copy(__fzReport) eingeben)');
  }
})();
