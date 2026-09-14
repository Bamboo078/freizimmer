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

/* ------------------------------------------------------------------ *
 * Mehrere Zeitfenster gleichzeitig
 *
 * Ein Fenster ist { from: Date, to: Date, key?: string, label?: string }.
 * Gesucht sind Räume, die in *allen* gewählten Fenstern frei sind. Die
 * Fenster müssen nicht aneinandergrenzen – 2. und 5. Lektion geht genauso.
 * ------------------------------------------------------------------ */

/** Frei in jedem einzelnen Fenster. */
export function isFreeInAll(busy, room, windows) {
  return windows.every((w) => isFree(busy, room, w.from, w.to));
}

/** Alle blockierenden Termine über alle Fenster, ohne Doppelte. */
export function blockingInAll(busy, room, windows) {
  const seen = new Set();
  const out = [];
  windows.forEach((w) => {
    blockingEntries(busy, room, w.from, w.to).forEach((b) => {
      const id = b.start.getTime() + '-' + b.end.getTime() + '-' + b.title;
      if (seen.has(id)) return;
      seen.add(id);
      out.push(b);
    });
  });
  return out.sort((a, b) => a.start - b.start);
}

/** In welchen der gewählten Fenster ist der Raum belegt? (Index-Liste) */
export function blockedWindows(busy, room, windows) {
  const out = [];
  windows.forEach((w, i) => {
    if (!isFree(busy, room, w.from, w.to)) out.push(i);
  });
  return out;
}

export const windowStart = (windows) =>
  windows.reduce((min, w) => (min === null || w.from < min ? w.from : min), null);

export const windowEnd = (windows) =>
  windows.reduce((max, w) => (max === null || w.to > max ? w.to : max), null);

/** Teilt die Räume in frei und belegt und sortiert nach `sortMode`. */
export function analyse(busy, rooms, windows, filterFn, sortMode) {
  const free = [];
  const taken = [];
  const last = windowEnd(windows);

  rooms.forEach((room) => {
    if (filterFn && !filterFn(room)) return;
    if (isFreeInAll(busy, room, windows)) {
      free.push({ room, until: freeUntil(busy, room, last) });
    } else {
      taken.push({
        room,
        blocks: blockingInAll(busy, room, windows),
        blockedIn: blockedWindows(busy, room, windows),
      });
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

/* ------------------------------------------------------------------ *
 * Geteilte Meldungen: "abgeschlossen", "besetzt", "wir sind drin", "frei"
 * ------------------------------------------------------------------ */

export const STATE_LABEL = {
  frei: 'war frei',
  drin: 'wir sind drin',
  besetzt: 'besetzt',
  zu: 'abgeschlossen',
};

export const STATE_SHORT = {
  frei: 'frei gemeldet',
  drin: 'wir sind drin',
  besetzt: 'besetzt',
  zu: 'abgeschlossen',
};

/** Schlüssel einer Lektion, so wie ihn der Server erwartet. */
export const slotKey = (slot) => minutesToStr(slot.from) + '-' + minutesToStr(slot.to);

/**
 * Meldungen nach Raum und Lektion einsortieren.
 * Rückgabe: Map<roomId, Map<slotKey, {state, name, at, mine, count}>>
 * Bei mehreren Meldungen zur selben Lektion gewinnt die neueste.
 */
export function indexReports(reports) {
  const byRoom = new Map();
  (reports || []).forEach((r) => {
    let slots = byRoom.get(r.room);
    if (!slots) { slots = new Map(); byRoom.set(r.room, slots); }
    const cur = slots.get(r.slot);
    if (!cur) {
      slots.set(r.slot, { ...r, count: 1 });
    } else if (r.at > cur.at) {
      slots.set(r.slot, { ...r, count: cur.count + 1, mine: r.mine || cur.mine });
    } else {
      cur.count += 1;
      cur.mine = cur.mine || r.mine;
    }
  });
  return byRoom;
}

/**
 * Was ist für diesen Raum in den gewählten Fenstern gemeldet?
 * "abgeschlossen" schlägt "besetzt" schlägt "drin" schlägt "frei".
 */
const RANK = { zu: 4, besetzt: 3, drin: 2, frei: 1 };

export function reportFor(index, room, windows) {
  const slots = index.get(room.id);
  if (!slots) return null;
  const keys = ['tag', ...windows.map((w) => w.key).filter(Boolean)];
  let best = null;
  keys.forEach((k) => {
    const r = slots.get(k);
    if (!r) return;
    if (!best || RANK[r.state] > RANK[best.state]) best = r;
  });
  return best;
}

/** Eigene Meldung für genau dieses Fenster (für "zurücknehmen"). */
export function myReportFor(index, room, key) {
  const slots = index.get(room.id);
  const r = slots && slots.get(key);
  return r && r.mine ? r : null;
}

/* ------------------------------------------------------------------ *
 * Erfahrungswerte
 * ------------------------------------------------------------------ */

/**
 * Wahrscheinlichkeiten aus den gesammelten Meldungen.
 * `stats` ist { "<raum>|<lektionsbeginn>": {frei, drin, besetzt, zu, total} }
 * und enthält nur den Wochentag, um den es gerade geht.
 *
 * Gerechnet wird mit Laplace-Glättung (+1 je Gruppe). Damit behauptet eine
 * einzelne Meldung nicht gleich "100 %", und Räume ohne Meldungen liefern
 * ehrlicherweise gar nichts.
 */
export function chancesFor(stats, room, windows) {
  const totals = { frei: 0, drin: 0, besetzt: 0, zu: 0, total: 0 };
  const buckets = new Set(['tag']);
  windows.forEach((w) => { if (w.key) buckets.add(w.key.split('-')[0]); });

  buckets.forEach((bucket) => {
    const e = stats && stats[room.id + '|' + bucket];
    if (!e) return;
    totals.frei += e.frei || 0;
    totals.drin += e.drin || 0;
    totals.besetzt += e.besetzt || 0;
    totals.zu += e.zu || 0;
    totals.total += e.total || 0;
  });

  if (!totals.total) return null;

  const smoothed = totals.total + 3;           // drei Gruppen: nutzbar / besetzt / zu
  return {
    n: totals.total,
    usable: (totals.frei + totals.drin + 1) / smoothed,
    occupied: (totals.besetzt + 1) / smoothed,
    closed: (totals.zu + 1) / smoothed,
    counts: totals,
  };
}

export const percent = (x) => Math.round(x * 100) + ' %';

/** Kurzer Text für die Raumkarte. */
export function chanceLabel(chance) {
  if (!chance) return null;
  if (chance.closed >= 0.4) return 'oft abgeschlossen · ' + percent(chance.closed);
  if (chance.occupied >= 0.4) return 'oft besetzt · ' + percent(chance.occupied);
  if (chance.n >= 3 && chance.usable >= 0.7) return 'meist nutzbar · ' + percent(chance.usable);
  return percent(chance.usable) + ' nutzbar (' + chance.n + ')';
}

/** Welche Farbe die Erfahrung bekommt: gut / mittel / schlecht. */
export function chanceTone(chance) {
  if (!chance) return '';
  if (chance.closed >= 0.4 || chance.occupied >= 0.4) return 'bad';
  if (chance.n >= 3 && chance.usable >= 0.7) return 'good';
  return 'mid';
}
