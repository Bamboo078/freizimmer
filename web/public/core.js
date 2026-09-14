/*
 * Reine Rechenlogik: aus Räumen + Belegungen wird "frei / belegt".
 * Kein DOM, keine Netzwerkzugriffe – damit gut testbar.
 */

export const pad = (n) => String(n).padStart(2, '0');

export const toDayStr = (d) =>
  d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export const toTimeStr = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());

export const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

export const minutesToStr = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

export function parseDay(str) {
  const p = String(str).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
}

export function atTime(dayStr, timeStr) {
  const day = parseDay(dayStr);
  const p = String(timeStr).split(':').map(Number);
  day.setHours(p[0] || 0, p[1] || 0, 0, 0);
  return day;
}

export const WEEKDAYS = [
  'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
];

/**
 * Baut aus der Server-Antwort die Belegungstabelle.
 * Eine Belegung zählt auch für Gesamt- bzw. Teilräume, weil die dann
 * ebenfalls nicht nutzbar sind.
 */
export function buildBusy(rooms, appointments) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const busy = new Map();

  const add = (iri, entry) => {
    let arr = busy.get(iri);
    if (!arr) { arr = []; busy.set(iri, arr); }
    arr.push(entry);
  };

  (appointments || []).forEach((a) => {
    const start = new Date(a.start);
    const end = new Date(a.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
    const entry = { start, end, title: a.title || 'Belegt' };

    const targets = new Set();
    (a.rooms || []).forEach((iri) => {
      targets.add(iri);
      const room = byId.get(iri);
      if (room) (room.related || []).forEach((x) => targets.add(x));
    });
    targets.forEach((iri) => add(iri, entry));
  });

  busy.forEach((arr) => arr.sort((a, b) => a.start - b.start));
  return busy;
}

/** Erkennt das Lektionsraster aus den tatsächlichen Belegungszeiten. */
export function deriveSlots(busy) {
  const tally = new Map();
  busy.forEach((arr) => {
    arr.forEach((b) => {
      const from = minutesOfDay(b.start);
      const to = minutesOfDay(b.end);
      const span = to - from;
      if (span <= 0 || span > 120) return;        // Ganztages-Einträge ignorieren
      const key = from + '-' + to;
      const cur = tally.get(key) || { from, to, count: 0 };
      cur.count++;
      tally.set(key, cur);
    });
  });

  const candidates = Array.from(tally.values())
    .filter((s) => s.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 16)
    .sort((a, b) => a.from - b.from);

  const clean = [];
  candidates.forEach((s) => {
    const last = clean[clean.length - 1];
    if (last && s.from < last.to) {
      if (s.count > last.count) clean[clean.length - 1] = s;
      return;
    }
    clean.push(s);
  });
  return clean;
}

/* ------------------------------------------------------------------ *
 * Gebäude und Sortierung
 * ------------------------------------------------------------------ */

/** Buchstaben vor der Nummer: "HL3.02" -> "HL", "xt1" -> "xt". */
export function buildingOf(name) {
  const m = String(name).match(/^[A-Za-z]+/);
  return m ? m[0] : '?';
}

/** Erste Zahl nach den Buchstaben: "HL3.02" -> 3, "S0.19" -> 0. */
export function floorOf(name) {
  const m = String(name).match(/^[A-Za-z]+\s*(\d+)/);
  return m ? Number(m[1]) : -1;
}

/** Sortiert "P1.2" vor "P1.11" (Zahlen als Zahlen, nicht als Text). */
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
export const compareName = (a, b) => collator.compare(a, b);

export const SORT_MODES = {
  'name-asc': 'Raum A–Z',
  'name-desc': 'Raum Z–A',
  'floor-desc': 'Stockwerk – oben zuerst',
  'free': 'Längste freie Zeit',
};

/** Vergleichsfunktion für Räume. null = Spezialfall "freie Zeit". */
export function roomComparator(mode) {
  switch (mode) {
    case 'name-desc':
      return (a, b) => compareName(b.name, a.name);
    case 'floor-desc':
      return (a, b) => (floorOf(b.name) - floorOf(a.name)) || compareName(a.name, b.name);
    case 'free':
      return null;
    default:
      return (a, b) => compareName(a.name, b.name);
  }
}

export function sortRooms(rooms, mode) {
  const cmp = roomComparator(mode) || roomComparator('name-asc');
  return rooms.slice().sort(cmp);
}

/** Alle vorkommenden Gebäude-Kürzel mit Anzahl Räume. */
export function buildingsOf(rooms) {
  const map = new Map();
  rooms.forEach((r) => {
    const b = buildingOf(r.name);
    map.set(b, (map.get(b) || 0) + 1);
  });
  return Array.from(map, ([key, count]) => ({ key, count }))
    .sort((a, b) => compareName(a.key, b.key));
}

export const busyOf = (busy, room) => busy.get(room.id) || [];

/** Frei heisst: keine Belegung überlappt das Fenster [from, to). */
export function isFree(busy, room, from, to) {
  return !busyOf(busy, room).some((b) => b.start < to && b.end > from);
}

/** Wann beginnt die nächste Belegung nach `to`? */
export function freeUntil(busy, room, to) {
  const next = busyOf(busy, room).find((b) => b.start >= to);
  return next ? next.start : null;
}

export function blockingEntries(busy, room, from, to) {
  return busyOf(busy, room).filter((b) => b.start < to && b.end > from);
}

/** Teilt die Räume in frei und belegt und sortiert nach `sortMode`. */
export function analyse(busy, rooms, from, to, filterFn, sortMode) {
  const free = [];
  const taken = [];
  rooms.forEach((room) => {
    if (filterFn && !filterFn(room)) return;
    if (isFree(busy, room, from, to)) {
      free.push({ room, until: freeUntil(busy, room, to) });
    } else {
      taken.push({ room, blocks: blockingEntries(busy, room, from, to) });
    }
  });

  const cmp = roomComparator(sortMode);
  if (cmp) {
    free.sort((a, b) => cmp(a.room, b.room));
  } else {
    // "Längste freie Zeit": wer am längsten frei bleibt, zuerst.
    free.sort((a, b) => {
      const av = a.until ? a.until.getTime() : Infinity;
      const bv = b.until ? b.until.getTime() : Infinity;
      if (av !== bv) return bv - av;
      return compareName(a.room.name, b.room.name);
    });
  }

  // Belegte Räume immer nach Name – "freie Zeit" ergibt dort keinen Sinn.
  const takenCmp = cmp || roomComparator('name-asc');
  taken.sort((a, b) => takenCmp(a.room, b.room));

  return { free, taken };
}
