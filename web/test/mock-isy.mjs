/*
 * Attrappe der isy-API – nur zum Testen der Website ohne echten Login.
 *
 * Start:  node test/mock-isy.mjs          (Port 4000)
 * Dann:   ISY_API=http://localhost:4000 node server.mjs
 *
 * Zugang: Benutzer "testuser", Passwort "geheim".
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4000);
const USER = 'testuser';
const PASS = 'geheim';

let validTokens = new Set(['tok-initial']);
let issued = 0;
let noSegment = process.env.MOCK_NO_SEGMENT === '1';

/* --- Testdaten ------------------------------------------------------ */

// Absichtlich gemischte Kürzel (HL/HM/HR und anderes), damit sich der
// Gebäude-Filter testen lässt.
const ROOMS = [
  { id: '/resources/1', _id: 1, descShort: 'A1.01', description: 'Aussen / Sonnensegel', partOf: null, partOfChildren: [] },
  { id: '/resources/2', _id: 2, descShort: 'HL1.02', description: 'Instr Unt', partOf: null, partOfChildren: [] },
  { id: '/resources/3', _id: 3, descShort: 'HM2.02', description: 'Ch Unt, 30 Pl', partOf: null, partOfChildren: [] },
  { id: '/resources/4', _id: 4, descShort: 'HR2.03', description: 'Ph Unt, 28 Pl', partOf: null, partOfChildren: [] },
  { id: '/resources/5', _id: 5, descShort: 'HL3.01', description: 'Unt, 26 Pl',
    partOf: { id: '/resources/9', descShort: 'HL3.0' }, partOfChildren: [] },
  { id: '/resources/10', _id: 10, descShort: 'HL3.02', description: 'Unt, 26 Pl',
    partOf: { id: '/resources/9', descShort: 'HL3.0' }, partOfChildren: [] },
  { id: '/resources/9', _id: 9, descShort: 'HL3.0', description: 'Unt gross, 52 Pl', partOf: null,
    partOfChildren: [{ id: '/resources/5', descShort: 'HL3.01' }, { id: '/resources/10', descShort: 'HL3.02' }] },
  { id: '/resources/11', _id: 11, descShort: 'HL3.03', description: 'G Vorb/Bespr, 3 Pl', partOf: null, partOfChildren: [] },
  { id: '/resources/12', _id: 12, descShort: 'HM3.04', description: 'Unt, 18 Pl', partOf: null, partOfChildren: [] },
  { id: '/resources/13', _id: 13, descShort: 'HR2.04', description: 'Ph Unt, 30 Pl', partOf: null, partOfChildren: [] },
  { id: '/resources/14', _id: 14, descShort: 'K1.01', description: 'Mensa, 120 Pl', partOf: null, partOfChildren: [] },
  { id: '/resources/15', _id: 15, descShort: 'xt1', description: 'Extern', partOf: null, partOfChildren: [] },
];

const SLOTS = [
  ['08:45', '09:30'], ['09:40', '10:25'], ['10:35', '11:20'], ['11:25', '12:10'],
  ['13:05', '13:50'], ['13:55', '14:40'], ['14:50', '15:35'], ['15:45', '16:30'],
];

// Wer ist wann belegt? (Raum-IRI -> Lektionsnummern)
const PLAN = {
  '/resources/10': [0, 1, 2, 3, 5],
  '/resources/3': [1, 2, 6],
  '/resources/4': [0, 4, 5, 6, 7],
  '/resources/5': [2, 3],
  '/resources/9': [7],          // Gesamtraum -> blockiert HL3.01 und HL3.02
};
const TITLES = ['M hcs 4Me', 'D wdr 4Mc', 'F wus 4Ma', 'BG sca 2Mb', 'M sig 2Mb', 'E frl 3Fb', 'CH lab 2Fa', 'S joh 1Ma'];

function appointmentsFor(dayStr) {
  const list = [];
  let i = 0;
  for (const [iri, slots] of Object.entries(PLAN)) {
    const room = ROOMS.find((r) => r.id === iri);
    for (const s of slots) {
      list.push({
        id: '/messages/' + (i++),
        title: TITLES[s % TITLES.length],
        calculatedTitleShort: TITLES[s % TITLES.length],
        agendaResourceTitle: TITLES[s % TITLES.length],
        dtFrom: dayStr + 'T' + SLOTS[s][0] + ':00+02:00',
        dtTo: dayStr + 'T' + SLOTS[s][1] + ':00+02:00',
        room,
      });
    }
  }
  return list;
}

/* --- Server --------------------------------------------------------- */

const json = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

async function body(req) {
  let raw = '';
  for await (const c of req) raw += c;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const data = req.method === 'POST' ? await body(req) : {};

  // --- Anmeldung ---
  if (url.pathname === '/authentication_token') {
    if (data.loginid === USER && data.password === PASS) {
      const tok = 'tok-' + (++issued);
      validTokens.add(tok);
      console.log('[mock] Login ok ->', tok);
      return json(res, 200, { proceed: true, token: tok, refresh_token: 'ref-1', mercure_token: 'm-1' });
    }
    console.log('[mock] Login abgelehnt für', JSON.stringify(data.loginid));
    return json(res, 401, { message: 'Benutzername oder Passwort ist falsch.' });
  }

  // --- Token erneuern ---
  if (url.pathname === '/token/refresh') {
    if (data.refresh_token === 'ref-1') {
      const tok = 'tok-' + (++issued);
      validTokens.add(tok);
      console.log('[mock] Refresh ->', tok);
      return json(res, 200, { token: tok, refresh_token: 'ref-1' });
    }
    return json(res, 401, { message: 'refresh token ungültig' });
  }

  // --- Alle Token entwerten (Test für den Refresh-Pfad) ---
  if (url.pathname === '/_expire') {
    validTokens = new Set();
    console.log('[mock] alle Token entwertet');
    return json(res, 200, { ok: true });
  }

  // --- Sammelabfrage sperren/freigeben (Test für Strategie B) ---
  if (url.pathname === '/_nosegment') {
    noSegment = url.searchParams.get('on') === '1';
    console.log('[mock] Sammelabfrage ' + (noSegment ? 'gesperrt' : 'erlaubt'));
    return json(res, 200, { noSegment });
  }

  // --- GraphQL ---
  if (url.pathname === '/graphql') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!validTokens.has(token)) {
      console.log('[mock] 401 für Token', JSON.stringify(token));
      return json(res, 401, { message: 'Expired JWT Token' });
    }

    const q = data.query || '';
    if (q.includes('freizimmerRooms')) return json(res, 200, { data: { resources: ROOMS } });
    if (q.includes('freizimmerRoomsSlim')) {
      return json(res, 200, { data: { resources: ROOMS.map(({ partOf, partOfChildren, ...r }) => r) } });
    }

    const day = (data.variables.start || '').slice(0, 10);
    const all = appointmentsFor(day);

    if (q.includes('freizimmerOccupied')) {
      if (noSegment) {
        return json(res, 200, { errors: [{ message: 'Access Denied for segment appointmentsOccupiedWithResources.' }] });
      }
      return json(res, 200, { data: { messages: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: all.map((a) => ({ node: {
          id: a.id, calculatedTitleShort: a.calculatedTitleShort, agendaResourceTitle: a.agendaResourceTitle,
          dtFrom: a.dtFrom, dtTo: a.dtTo,
          resources: { edges: [{ node: { id: '/mr' + a.id, resource: {
            id: a.room.id, descShort: a.room.descShort,
            partOf: a.room.partOf, partOfChildren: a.room.partOfChildren,
          } } }] },
        } })),
      } } });
    }

    if (q.includes('freizimmerByRoom')) {
      const iri = data.variables.iri;
      const mine = all.filter((a) => a.room.id === iri);
      return json(res, 200, { data: { messages: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: mine.map((a) => ({ node: {
          id: a.id, title: a.title, calculatedTitleShort: a.calculatedTitleShort,
          dtFrom: a.dtFrom, dtTo: a.dtTo,
        } })),
      } } });
    }

    return json(res, 200, { errors: [{ message: 'unbekannte Abfrage' }] });
  }

  json(res, 404, { message: 'not found' });
}).listen(PORT, () => {
  console.log('isy-Attrappe auf http://localhost:' + PORT + '  (Login: ' + USER + ' / ' + PASS + ')');
});
