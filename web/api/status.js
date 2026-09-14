/*
 * Geteilte Meldungen zu einem Raum – und die Statistik, die daraus wächst.
 *
 *   GET  /api/status?day=YYYY-MM-DD
 *        -> alle Meldungen des Tages + Erfahrungswerte für diesen Wochentag
 *
 *   POST /api/status   { day, room, slot, state }
 *        state: "frei" | "drin" | "besetzt" | "zu" | "weg"  ("weg" = zurücknehmen)
 *        slot:  "08:45-09:30" oder "tag"
 *
 * Gespeichert wird nur: Raum, Tag, Lektion, Zustand, Benutzername, Zeitpunkt.
 * Die Meldungen des Tages verfallen nach 30 Tagen; die reine Zählstatistik
 * (wie oft war Raum X am Montag in der 3. Lektion zu?) bleibt.
 */
import { getCookies, COOKIE_TOKEN, COOKIE_REFRESH, identityOf, readJson, sendJson } from './_isy.js';
import { hGetAll, hGet, apply, isPersistent } from './_store.js';

export const STATES = ['frei', 'drin', 'besetzt', 'zu'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_RE = /^(tag|\d{2}:\d{2}-\d{2}:\d{2})$/;

const dayKey = (day) => 'fz:day:' + day;
const statsKey = (weekday) => 'fz:stats:' + weekday;

/** Der Statistik-Topf, in den eine Meldung fällt: Wochentag + Lektionsbeginn. */
const bucketOf = (slot) => (slot === 'tag' ? 'tag' : slot.split('-')[0]);

const weekdayOf = (day) => new Date(day + 'T12:00:00Z').getUTCDay();

function loggedIn(req) {
  const jar = getCookies(req);
  return Boolean(jar[COOKIE_TOKEN] || jar[COOKIE_REFRESH]);
}

/* ------------------------------------------------------------------ *
 * Lesen
 * ------------------------------------------------------------------ */

function parseReports(raw, meId) {
  const out = [];
  Object.entries(raw || {}).forEach(([field, value]) => {
    const parts = String(field).split('|');
    if (parts.length < 3) return;
    const [room, slot, user] = parts;
    let body;
    try {
      body = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      return;
    }
    if (!body || !STATES.includes(body.state)) return;
    out.push({
      room,
      slot,
      state: body.state,
      name: body.name || 'jemand',
      at: body.at || 0,
      mine: user === meId,
    });
  });
  return out.sort((a, b) => b.at - a.at);
}

/** { "<raum>|<lektion>": { frei: 3, zu: 1, … , total: 4 } } */
function parseStats(raw) {
  const out = {};
  Object.entries(raw || {}).forEach(([field, value]) => {
    const parts = String(field).split('|');
    if (parts.length < 3) return;
    const [room, bucket, state] = parts;
    if (!STATES.includes(state)) return;
    const n = Number(value) || 0;
    if (n <= 0) return;
    const key = room + '|' + bucket;
    const cur = out[key] || { frei: 0, drin: 0, besetzt: 0, zu: 0, total: 0 };
    cur[state] += n;
    cur.total += n;
    out[key] = cur;
  });
  return out;
}

async function readAll(day, meId) {
  const [reportsRaw, statsRaw] = await Promise.all([
    hGetAll(dayKey(day)),
    hGetAll(statsKey(weekdayOf(day))),
  ]);
  return {
    day,
    persistent: isPersistent(),
    me: meId,
    reports: parseReports(reportsRaw, meId),
    stats: parseStats(statsRaw),
  };
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (!loggedIn(req)) {
    return sendJson(res, 401, { error: 'nicht angemeldet', needLogin: true });
  }
  const me = identityOf(req);

  try {
    if (req.method === 'GET') {
      const day = String((req.query && req.query.day) || '').trim();
      if (!DAY_RE.test(day)) {
        return sendJson(res, 400, { error: 'Parameter day fehlt oder ist ungültig (YYYY-MM-DD).' });
      }
      return sendJson(res, 200, await readAll(day, me.id));
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Nur GET oder POST.' });

    const body = await readJson(req);
    const day = String(body.day || '').trim();
    const room = String(body.room || '').trim();
    const slot = String(body.slot || 'tag').trim();
    const state = String(body.state || '').trim();

    if (!DAY_RE.test(day)) return sendJson(res, 400, { error: 'Tag ungültig.' });
    if (!room || room.length > 200) return sendJson(res, 400, { error: 'Raum ungültig.' });
    if (!SLOT_RE.test(slot)) return sendJson(res, 400, { error: 'Lektion ungültig.' });
    if (state !== 'weg' && !STATES.includes(state)) return sendJson(res, 400, { error: 'Zustand ungültig.' });

    const key = dayKey(day);
    const field = room + '|' + slot + '|' + me.id;
    const sKey = statsKey(weekdayOf(day));
    const bucket = room + '|' + bucketOf(slot);

    // Alte Meldung derselben Person lesen, damit die Statistik nicht doppelt zählt.
    let previous = null;
    const rawOld = await hGet(key, field);
    if (rawOld) {
      try {
        const old = typeof rawOld === 'string' ? JSON.parse(rawOld) : rawOld;
        if (old && STATES.includes(old.state)) previous = old.state;
      } catch { /* kaputter Eintrag – einfach überschreiben */ }
    }

    const incr = [];
    if (previous && previous !== state) incr.push([sKey, bucket + '|' + previous, -1]);

    if (state === 'weg') {
      await apply({ del: [[key, field]], incr, expire: [[key, 60 * 60 * 24 * 30]] });
    } else {
      if (previous !== state) incr.push([sKey, bucket + '|' + state, 1]);
      const value = JSON.stringify({ state, name: me.name, at: Date.now() });
      await apply({ set: [[key, field, value]], incr, expire: [[key, 60 * 60 * 24 * 30]] });
    }

    return sendJson(res, 200, await readAll(day, me.id));
  } catch (err) {
    return sendJson(res, 502, { error: err.message || 'Meldung konnte nicht gespeichert werden.' });
  }
}
