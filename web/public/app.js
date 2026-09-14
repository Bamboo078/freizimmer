import {
  buildBusy, deriveSlots, analyse, isFree, blockingEntries,
  parseDay, atTime, toDayStr, toTimeStr, minutesToStr, pad, WEEKDAYS,
  buildingOf, buildingsOf, sortRooms, SORT_MODES,
  slotKey, indexReports, reportFor, chancesFor, chanceLabel, chanceTone,
  STATE_LABEL, STATE_SHORT, percent,
} from './core.js';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 * Zeichen für die vier Zustände
 *
 * Bewusst selbst gezeichnete SVG statt Emoji: gleiche Strichstärke,
 * gleiche Grösse, und sie nehmen die Farbe ihres Umfelds an.
 * ------------------------------------------------------------------ */

const ICON_PATHS = {
  frei: '<path d="M3.2 8.4l3.1 3.1 6.5-7"/>',
  drin: '<circle cx="8" cy="8" r="3.2" fill="currentColor" stroke="none"/>',
  besetzt: '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>',
  zu: '<rect x="3.4" y="7.1" width="9.2" height="6.1" rx="1.5"/><path d="M5.8 7.1V5.5a2.2 2.2 0 0 1 4.4 0v1.6"/>',
};

/** Ein Zustands-Zeichen als SVG-Element. */
function stateIcon(key) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICON_PATHS[key] || '';
  return svg;
}

/* ------------------------------------------------------------------ *
 * Startvorgaben
 *
 * So sieht die Seite aus, wenn man sie frisch öffnet. Wer etwas umstellt,
 * dessen Einstellung wird gemerkt (ausser den Lektionen – die werden bei
 * jedem Tageswechsel wieder auf die Vorgabe gesetzt).
 * ------------------------------------------------------------------ */

/** Gebäude, die beim ersten Start angehakt sind. */
const DEFAULT_BUILDINGS = ['HL', 'HM', 'HR'];

/** Lektionen, die beim Laden eines Tages vorgewählt sind – wie auf den Chips. */
const DEFAULT_LESSONS = [6, 7];

/** Sortierung beim ersten Start. */
const DEFAULT_SORT = 'floor-desc';

/** Wie oft die Meldungen der anderen nachgeladen werden (ms). */
const POLL_MS = 45000;

const state = {
  day: null,
  rooms: [],
  busy: new Map(),
  slots: [],
  warning: null,
  tab: 'liste',
  loading: false,
  selected: new Set(),     // Indizes der gewählten Lektionen (mehrere möglich)
  buildings: null,         // Set<string> – null heisst "noch nicht gesetzt"
  sort: DEFAULT_SORT,

  // Geteilte Meldungen
  reports: [],
  index: new Map(),
  stats: {},
  persistent: true,
  me: null,
  sheetRoom: null,
  sheetScope: null,        // 'lektionen' | 'tag'
};

/* ------------------------------------------------------------------ *
 * Einstellungen merken (nur in diesem Browser)
 * ------------------------------------------------------------------ */

function loadPrefs() {
  try {
    const raw = localStorage.getItem('freizimmer.prefs');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePrefs() {
  try {
    localStorage.setItem('freizimmer.prefs', JSON.stringify({
      buildings: state.buildings ? Array.from(state.buildings) : null,
      sort: state.sort,
      only: $('#only').checked,
    }));
  } catch {
    /* privates Fenster o.ä. – dann eben nicht merken */
  }
}

/* ------------------------------------------------------------------ *
 * Serverzugriff
 * ------------------------------------------------------------------ */

async function api(path, options) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* leere Antwort */
  }
  return { status: res.status, ok: res.ok, data };
}

/* ------------------------------------------------------------------ *
 * Anmeldung
 * ------------------------------------------------------------------ */

function showLogin(codeRequired) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#code-row').hidden = !codeRequired;
  $('#loginid').focus();
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const err = $('#login-err');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'Anmelden …';

  const { ok, data } = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      loginid: $('#loginid').value,
      password: $('#password').value,
      code: $('#code').value,
    }),
  });

  // Passwortfeld sofort leeren – es wird nicht mehr gebraucht.
  $('#password').value = '';
  btn.disabled = false;
  btn.textContent = 'Anmelden';

  if (!ok) {
    err.textContent = data.error || 'Anmeldung fehlgeschlagen.';
    err.hidden = false;
    return;
  }
  showApp();
  setNow();
  load();
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.reload();
});

/* ------------------------------------------------------------------ *
 * Daten laden
 * ------------------------------------------------------------------ */

async function load() {
  const day = $('#date').value;
  if (!day || state.loading) return;
  const sameDay = state.day === day;      // "Neu laden" soll die Auswahl behalten
  state.loading = true;
  setStatus('<span class="spinner"></span>Lade Räume und Belegungen …');
  clearBody();

  const tz = -new Date().getTimezoneOffset();
  const { ok, status, data } = await api('/api/data?day=' + day + '&tz=' + tz);
  state.loading = false;

  if (status === 401) {
    showLogin(false);
    return;
  }
  if (!ok) {
    renderError(data.error || 'Laden fehlgeschlagen.', data.detail);
    return;
  }

  state.day = day;
  state.rooms = data.rooms || [];
  state.busy = buildBusy(state.rooms, data.appointments || []);
  state.slots = deriveSlots(state.busy);
  state.warning = data.warning || null;

  if (sameDay) {
    // Lektionen, die es nach dem Neuladen nicht mehr gibt, fallen weg.
    state.selected = new Set(Array.from(state.selected).filter((i) => i < state.slots.length));
  } else {
    selectDefaultLessons();
  }

  renderChips();
  renderBuildings();
  render();
  loadStatus();
}

/** Meldungen der anderen holen – stört die Darstellung nicht, wenn es klemmt. */
async function loadStatus(silent) {
  const day = $('#date').value;
  if (!day) return;
  const { ok, status, data } = await api('/api/status?day=' + day);
  if (status === 401) { showLogin(false); return; }
  if (!ok) {
    if (!silent) console.warn('[Freizimmer] Meldungen nicht verfügbar:', data.error);
    return;
  }
  state.reports = data.reports || [];
  state.index = indexReports(state.reports);
  state.stats = data.stats || {};
  state.persistent = data.persistent !== false;
  state.me = data.me || null;
  render();
  if (state.sheetRoom) renderSheet();
}

/** Eine eigene Meldung abschicken. */
async function sendReport(room, slots, reportState) {
  let last = null;
  for (const slot of slots) {
    const { ok, data } = await api('/api/status', {
      method: 'POST',
      body: JSON.stringify({
        day: $('#date').value, room: room.id, slot, state: reportState,
      }),
    });
    if (!ok) throw new Error(data.error || 'Melden fehlgeschlagen.');
    last = data;
  }
  if (last) {
    state.reports = last.reports || [];
    state.index = indexReports(state.reports);
    state.stats = last.stats || {};
    state.persistent = last.persistent !== false;
    state.me = last.me || state.me;
  }
}

/* ------------------------------------------------------------------ *
 * Zeitfenster
 * ------------------------------------------------------------------ */

/** Passt das Fenster genau auf eine Lektion? Dann deren Schlüssel benutzen. */
function keyForTimes(fromStr, toStr) {
  const hit = state.slots.find(
    (s) => minutesToStr(s.from) === fromStr && minutesToStr(s.to) === toStr
  );
  return hit ? slotKey(hit) : null;
}

/** Die aktuell gesuchten Fenster – eine Lektion, mehrere, oder eine freie Zeit. */
function windows() {
  const day = $('#date').value;

  if (state.selected.size) {
    return Array.from(state.selected).sort((a, b) => a - b).map((i) => {
      const s = state.slots[i];
      return {
        index: i,
        key: slotKey(s),
        label: (i + 1) + '. ' + minutesToStr(s.from) + '–' + minutesToStr(s.to),
        short: (i + 1) + '.',
        from: atTime(day, minutesToStr(s.from)),
        to: atTime(day, minutesToStr(s.to)),
      };
    });
  }

  const f = $('#from').value || '08:00';
  const t = $('#to').value || '09:00';
  return [{
    index: null,
    key: keyForTimes(f, t),
    label: f + '–' + t,
    short: f,
    from: atTime(day, f),
    to: atTime(day, t),
  }];
}

/** Auf welche Lektionsschlüssel sich eine Meldung beziehen soll. */
function reportSlots(scope) {
  if (scope === 'tag') return ['tag'];
  const keys = windows().map((w) => w.key).filter(Boolean);
  return keys.length ? keys : ['tag'];
}

/* ------------------------------------------------------------------ *
 * Darstellung
 * ------------------------------------------------------------------ */

const setStatus = (html) => { $('#status').innerHTML = html; };

function clearBody() {
  document.querySelectorAll('#body > *:not(#status)').forEach((n) => n.remove());
}

function renderError(message, detail) {
  setStatus('');
  clearBody();
  const box = document.createElement('p');
  box.className = 'note is-err';
  box.textContent = 'Fehler: ' + message;
  $('#body').append(box);
  if (detail) {
    const d = document.createElement('details');
    const s = document.createElement('summary');
    s.textContent = 'Technische Details';
    const pre = document.createElement('pre');
    pre.className = 'detailpre';
    pre.textContent = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    d.append(s, pre);
    $('#body').append(d);
  }
}

/* ---- Lektions-Chips: mehrere wählbar ---- */

function renderChips() {
  const box = $('#chips');
  box.textContent = '';

  if (!state.slots.length) {
    const p = document.createElement('span');
    p.className = 'lbl';
    p.textContent = 'Für diesen Tag kennt isy keine Lektionen – bitte Zeit von Hand eingeben.';
    box.append(p);
    updateSlotNote();
    return;
  }

  state.slots.forEach((slot, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip slotchip';
    b.dataset.slot = String(i);
    b.setAttribute('aria-label',
      (i + 1) + '. Lektion, ' + minutesToStr(slot.from) + ' bis ' + minutesToStr(slot.to));

    const num = document.createElement('strong');
    num.textContent = (i + 1) + '.';
    const time = document.createElement('span');
    time.className = 'chiptime';
    time.textContent = minutesToStr(slot.from) + '–' + minutesToStr(slot.to);
    b.append(num, time);

    b.addEventListener('click', () => {
      if (state.selected.has(i)) state.selected.delete(i);
      else state.selected.add(i);
      syncTimesFromSelection();
      updateChips();
      render();
    });
    box.append(b);
  });

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'chip chip-all';
  all.dataset.slot = 'all';
  all.addEventListener('click', () => {
    state.selected = state.selected.size === state.slots.length
      ? new Set()
      : new Set(state.slots.map((_, i) => i));
    syncTimesFromSelection();
    updateChips();
    render();
  });
  box.append(all);

  updateChips();
}

/** Nur den An/Aus-Zustand der Chips nachziehen – ohne sie neu zu bauen. */
function updateChips() {
  const allOn = state.slots.length > 0 && state.selected.size === state.slots.length;
  $('#chips').querySelectorAll('.chip').forEach((c) => {
    if (c.dataset.slot === 'all') {
      c.classList.toggle('is-active', allOn);
      c.textContent = allOn ? 'keine' : 'ganzer Tag';
      return;
    }
    const on = state.selected.has(Number(c.dataset.slot));
    c.classList.toggle('is-active', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  revealSelectedChip();
  updateSlotNote();
}

/**
 * Am Handy ist die Lektionsleiste eine Wischzeile. Steht die Auswahl weit
 * rechts, sieht man sonst nur unmarkierte Chips und darunter "Gewählt: 6. 7."
 * – deshalb die erste gewählte Lektion in den sichtbaren Bereich schieben.
 * Bewusst über scrollLeft statt scrollIntoView: das würde die Seite mitziehen.
 */
function revealSelectedChip() {
  const box = $('#chips');
  if (box.scrollWidth <= box.clientWidth) return;
  const first = box.querySelector('.slotchip.is-active');
  if (!first) return;
  const target = first.offsetLeft - (box.clientWidth - first.offsetWidth) / 2;
  box.scrollLeft = Math.max(0, target);        // ohne Animation: sonst sieht
                                               // man beim Laden kurz die
                                               // falschen Lektionen
}

function updateSlotNote() {
  const note = $('#slot-note');
  const clear = $('#slot-clear');
  const n = state.selected.size;

  clear.hidden = n === 0;

  if (!n) {
    note.hidden = false;
    note.textContent = 'Keine Lektion gewählt – es gilt die Zeit unter „Eigene Zeit“.';
    return;
  }
  // Bei einer Lektion sagt der markierte Chip schon alles.
  note.hidden = n === 1;
  note.textContent = 'Gesucht sind Räume, die in allen ' + n + ' Lektionen frei sind.';
}

/** Von/Bis auf die Spanne der Auswahl setzen, damit die Felder stimmig bleiben. */
function syncTimesFromSelection() {
  if (!state.selected.size) return;
  const idx = Array.from(state.selected).sort((a, b) => a - b);
  $('#from').value = minutesToStr(state.slots[idx[0]].from);
  $('#to').value = minutesToStr(state.slots[idx[idx.length - 1]].to);
}

$('#slot-clear').addEventListener('click', () => {
  state.selected = new Set();
  updateChips();
  render();
});

/* ---- Gebäude ---- */

function renderBuildings() {
  const list = buildingsOf(state.rooms);
  const known = new Set(list.map((b) => b.key));

  // Beim ersten Mal: HL/HM/HR vorauswählen, sofern es sie gibt.
  if (state.buildings === null) {
    const wanted = DEFAULT_BUILDINGS.filter((b) => known.has(b));
    state.buildings = new Set(wanted.length ? wanted : known);
  } else {
    state.buildings = new Set(Array.from(state.buildings).filter((b) => known.has(b)));
    if (!state.buildings.size) state.buildings = new Set(known);
  }

  const box = $('#buildings');
  box.textContent = '';

  list.forEach(({ key, count }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (state.buildings.has(key) ? ' is-active' : '');
    b.textContent = key + ' (' + count + ')';
    b.title = count + ' Räume';
    b.addEventListener('click', () => {
      if (state.buildings.has(key)) state.buildings.delete(key);
      else state.buildings.add(key);
      if (!state.buildings.size) state.buildings = new Set(known);   // nie leer
      savePrefs();
      renderBuildings();
      render();
    });
    box.append(b);
  });

  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'chip chip-all';
  const allOn = state.buildings.size === known.size;
  all.textContent = allOn ? 'nur HL/HM/HR' : 'alle';
  all.addEventListener('click', () => {
    state.buildings = allOn
      ? new Set(DEFAULT_BUILDINGS.filter((b) => known.has(b)))
      : new Set(known);
    if (!state.buildings.size) state.buildings = new Set(known);
    savePrefs();
    renderBuildings();
    render();
  });
  box.append(all);
}

function filterFn() {
  const needle = $('#search').value.trim().toLowerCase();
  const only = $('#only').checked;
  const buildings = state.buildings;
  return (room) => {
    if (buildings && buildings.size && !buildings.has(buildingOf(room.name))) return false;
    if (only && !/unt/i.test(room.desc)) return false;
    if (!needle) return true;
    return (room.name + ' ' + room.desc).toLowerCase().includes(needle);
  };
}

/** Zusammenfassung der aktiven Filter neben dem Aufklapper. */
function updateMoreMark() {
  const bits = [];
  if ($('#search').value.trim()) bits.push('Suche');
  if ($('#only').checked) bits.push('nur Unterricht');
  if (state.buildings && state.buildings.size) bits.push(Array.from(state.buildings).join('/'));
  $('#more-mark').textContent = bits.join(' · ');
}

/* ---- Haupt-Render ---- */

function render() {
  clearBody();
  updateMoreMark();

  if (!state.rooms.length) { setStatus('Keine Raumdaten geladen.'); return; }

  const day = $('#date').value;
  const d = parseDay(day);
  $('#subtitle').textContent =
    WEEKDAYS[d.getDay()] + ', ' + pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();

  if (state.warning) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent = state.warning;
    $('#body').append(n);
  }
  if (!state.persistent) {
    const n = document.createElement('p');
    n.className = 'note';
    n.textContent =
      'Meldungen werden gerade nur im Arbeitsspeicher gehalten und nicht mit anderen geteilt '
      + '– dafür muss auf dem Server ein Speicher eingerichtet sein (siehe README).';
    $('#body').append(n);
  }

  if (state.tab === 'raster') renderRaster(day);
  else renderList(day);
}

/* ---- Raumkarte ---- */

function roomCard(room, metaText, cls, wins) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'room-card ' + cls;

  const report = reportFor(state.index, room, wins);
  if (report) card.classList.add('r-' + report.state);

  const top = document.createElement('div');
  top.className = 'card-top';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = room.name;
  top.append(name);

  if (report) {
    const badge = document.createElement('span');
    badge.className = 'badge b-' + report.state;
    badge.append(stateIcon(report.state), document.createTextNode(STATE_SHORT[report.state]));
    top.append(badge);
  }
  card.append(top);

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = room.desc;
  card.append(desc);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaText;
  card.append(meta);

  const chance = chancesFor(state.stats, room, wins);
  if (chance) {
    const c = document.createElement('div');
    c.className = 'chance t-' + chanceTone(chance);
    c.textContent = chanceLabel(chance);
    card.append(c);
  }

  card.addEventListener('click', () => openSheet(room));
  return card;
}

/** Gemeldet "zu"/"besetzt" nach hinten sortieren – frei bleibt frei. */
function demoteReported(list, wins) {
  const rank = (item) => {
    const r = reportFor(state.index, item.room, wins);
    if (!r) return 1;
    if (r.state === 'zu') return 3;
    if (r.state === 'besetzt' || r.state === 'drin') return 2;
    return 0;                       // ausdrücklich als frei gemeldet: nach vorne
  };
  return list.map((item, i) => ({ item, i, r: rank(item) }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.item);
}

function renderList(day) {
  const wins = windows();
  if (wins.some((w) => !(w.to > w.from))) {
    setStatus('Die Endzeit muss nach der Startzeit liegen.');
    return;
  }

  const { free, taken } = analyse(state.busy, state.rooms, wins, filterFn(), state.sort);
  const ordered = demoteReported(free, wins);

  const when = state.selected.size
    ? wins.map((w) => w.short).join(' ') + ' Lektion'
    : toTimeStr(wins[0].from) + '–' + toTimeStr(wins[0].to);

  setStatus(
    '<strong>' + free.length + '</strong> von ' + (free.length + taken.length)
    + ' Räumen frei · ' + when
  );

  if (!free.length) {
    const e = document.createElement('p');
    e.className = 'empty';
    e.textContent = state.selected.size > 1
      ? 'Kein Raum ist in allen gewählten Lektionen frei.'
      : 'In diesem Zeitfenster ist kein Raum frei.';
    $('#body').append(e);
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    ordered.forEach((item) => {
      grid.append(roomCard(
        item.room,
        item.until ? 'frei bis ' + toTimeStr(item.until) : 'frei bis Schulschluss',
        'is-free',
        wins
      ));
    });
    $('#body').append(grid);
  }

  if (taken.length) {
    const det = document.createElement('details');
    det.className = 'taken';
    const sum = document.createElement('summary');
    sum.textContent = taken.length + ' belegte Räume anzeigen';
    const grid = document.createElement('div');
    grid.className = 'grid';
    taken.forEach((item) => {
      const b = item.blocks[0];
      let meta = b ? b.title + ' (' + toTimeStr(b.start) + '–' + toTimeStr(b.end) + ')' : 'belegt';
      if (state.selected.size > 1 && item.blockedIn.length < wins.length) {
        meta = 'belegt in ' + item.blockedIn.map((i) => wins[i].short).join(' ') + ' · ' + meta;
      }
      grid.append(roomCard(item.room, meta, 'is-busy', wins));
    });
    det.append(sum, grid);
    $('#body').append(det);
  }
}

function renderRaster(day) {
  if (!state.slots.length) {
    setStatus('Für diesen Tag kennt isy keine Lektionen – vermutlich schulfrei.');
    return;
  }
  const rooms = sortRooms(state.rooms.filter(filterFn()), state.sort);
  setStatus(rooms.length + ' Räume · grün = frei · tippen zum Melden');

  const table = document.createElement('table');
  table.className = 'raster';

  const head = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'room';
  corner.textContent = 'Raum';
  head.append(corner);
  state.slots.forEach((s, i) => {
    const th = document.createElement('th');
    th.className = state.selected.has(i) ? 'is-sel' : '';
    th.textContent = (i + 1) + '.';
    th.append(document.createElement('br'));
    th.append(minutesToStr(s.from));
    head.append(th);
  });
  table.append(head);

  rooms.forEach((room) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.className = 'room';
    th.textContent = room.name;
    th.addEventListener('click', () => openSheet(room));
    tr.append(th);

    state.slots.forEach((s, i) => {
      const from = atTime(day, minutesToStr(s.from));
      const to = atTime(day, minutesToStr(s.to));
      const td = document.createElement('td');
      const free = isFree(state.busy, room, from, to);
      td.className = (free ? 'is-f' : 'is-b') + (state.selected.has(i) ? ' is-sel' : '');

      const rep = reportFor(state.index, room, [{ key: slotKey(s) }]);
      if (rep) {
        td.classList.add('r-' + rep.state);
        td.append(stateIcon(rep.state));
        td.title = STATE_LABEL[rep.state] + ' – gemeldet von ' + rep.name;
      } else if (free) {
        td.textContent = 'frei';
      } else {
        const b = blockingEntries(state.busy, room, from, to)[0];
        td.textContent = b ? b.title : '·';
      }
      tr.append(td);
    });
    table.append(tr);
  });

  const scroll = document.createElement('div');
  scroll.className = 'scroll';
  scroll.append(table);
  $('#body').append(scroll);
}

/* ------------------------------------------------------------------ *
 * Aktionsblatt: Raum melden
 * ------------------------------------------------------------------ */

function openSheet(room) {
  state.sheetRoom = room;
  state.sheetScope = state.selected.size ? 'lektionen' : 'tag';
  $('#sheet').hidden = false;
  document.body.classList.add('no-scroll');
  renderSheet();
}

function closeSheet() {
  state.sheetRoom = null;
  $('#sheet').hidden = true;
  document.body.classList.remove('no-scroll');
}

$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.sheetRoom) closeSheet(); });

function renderSheet() {
  const room = state.sheetRoom;
  if (!room) return;
  const wins = windows();
  const body = $('#sheet-body');
  body.textContent = '';

  $('#sheet-title').textContent = room.name;
  $('#sheet-sub').textContent = room.desc || '';

  /* --- laut isy --- */
  const isy = document.createElement('p');
  isy.className = 'sheet-isy';
  const blocked = wins.filter((w) => !isFree(state.busy, room, w.from, w.to));
  if (!blocked.length) {
    isy.innerHTML = '<span class="ok">Laut isy frei</span> – ' + wins.map((w) => w.label).join(', ');
  } else {
    const b = blockingEntries(state.busy, room, blocked[0].from, blocked[0].to)[0];
    isy.innerHTML = '<span class="no">Laut isy belegt</span> in '
      + blocked.map((w) => w.short).join(' ') + (b ? ' · ' + b.title : '');
  }
  body.append(isy);

  /* --- Geltungsbereich --- */
  const scopeBox = document.createElement('div');
  scopeBox.className = 'seg';
  const scopes = [
    ['lektionen', state.selected.size
      ? Array.from(state.selected).sort((a, b) => a - b).map((i) => (i + 1) + '.').join(' ') + ' Lektion'
      : 'diese Zeit'],
    ['tag', 'ganzer Tag'],
  ];
  scopes.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segbtn' + (state.sheetScope === key ? ' is-active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { state.sheetScope = key; renderSheet(); });
    scopeBox.append(b);
  });
  const scopeLbl = document.createElement('p');
  scopeLbl.className = 'lbl';
  scopeLbl.textContent = 'Meldung gilt für:';
  body.append(scopeLbl, scopeBox);

  /* --- Melde-Knöpfe --- */
  const acts = document.createElement('div');
  acts.className = 'acts';
  const buttons = [
    ['frei', 'war frei', 'Zimmer ist offen und leer.'],
    ['drin', 'wir sind drin', 'Wir benutzen den Raum gerade.'],
    ['besetzt', 'besetzt', 'Da ist schon jemand anderes drin.'],
    ['zu', 'abgeschlossen', 'Tür ist zu, Zimmer nicht nutzbar.'],
  ];
  buttons.forEach(([key, label, hint]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'actbtn a-' + key;
    const head = document.createElement('span');
    head.className = 'actbtn-head';
    const strong = document.createElement('strong');
    strong.textContent = label;
    head.append(stateIcon(key), strong);
    const small = document.createElement('small');
    small.textContent = hint;
    b.append(head, small);
    b.addEventListener('click', () => submit(room, key, b));
    acts.append(b);
  });
  body.append(acts);

  /* --- eigene Meldung zurücknehmen --- */
  const slots = new Set(reportSlots(state.sheetScope));
  const mine = state.reports.filter((r) => r.mine && r.room === room.id && slots.has(r.slot));
  if (mine.length) {
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'linkbtn undo';
    undo.textContent = 'Meine Meldung zurücknehmen';
    undo.addEventListener('click', () => submit(room, 'weg', undo));
    body.append(undo);
  }

  /* --- was andere gemeldet haben --- */
  const all = state.reports.filter((r) => r.room === room.id);
  if (all.length) {
    const h = document.createElement('p');
    h.className = 'lbl sheet-h';
    h.textContent = 'Heute gemeldet';
    const ul = document.createElement('ul');
    ul.className = 'replist';
    all.slice(0, 12).forEach((r) => {
      const li = document.createElement('li');
      li.className = 'r-' + r.state;
      const what = document.createElement('span');
      what.className = 'repwhat';
      what.append(stateIcon(r.state), document.createTextNode(STATE_LABEL[r.state]));
      const who = document.createElement('small');
      who.textContent = (r.slot === 'tag' ? 'ganzer Tag' : r.slot) + ' · ' + (r.mine ? 'du' : r.name);
      li.append(what, who);
      ul.append(li);
    });
    body.append(h, ul);
  }

  /* --- Erfahrungswerte --- */
  const chance = chancesFor(state.stats, room, wins);
  const h2 = document.createElement('p');
  h2.className = 'lbl sheet-h';
  h2.textContent = 'Erfahrung ' + WEEKDAYS[parseDay($('#date').value).getDay()]
    + (state.selected.size ? ', gewählte Lektionen' : '');
  body.append(h2);

  if (!chance) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Noch keine Meldungen für diesen Raum zu dieser Zeit. '
      + 'Sobald jemand meldet, entsteht hier eine Einschätzung.';
    body.append(p);
  } else {
    const bars = document.createElement('div');
    bars.className = 'bars';
    [
      ['nutzbar', chance.usable, 'good'],
      ['besetzt', chance.occupied, 'bad'],
      ['abgeschlossen', chance.closed, 'warn'],
    ].forEach(([label, value, tone]) => {
      const row = document.createElement('div');
      row.className = 'barrow';
      const l = document.createElement('span');
      l.className = 'barlbl';
      l.textContent = label;
      const track = document.createElement('span');
      track.className = 'bartrack';
      const fill = document.createElement('span');
      fill.className = 'barfill t-' + tone;
      fill.style.width = Math.round(value * 100) + '%';
      track.append(fill);
      const v = document.createElement('span');
      v.className = 'barval';
      v.textContent = percent(value);
      row.append(l, track, v);
      bars.append(row);
    });
    const n = document.createElement('p');
    n.className = 'muted tiny';
    n.textContent = 'Beruht auf ' + chance.n + ' Meldung' + (chance.n === 1 ? '' : 'en')
      + ' (' + chance.counts.frei + '× frei, ' + chance.counts.drin + '× drin, '
      + chance.counts.besetzt + '× besetzt, ' + chance.counts.zu + '× abgeschlossen).';
    body.append(bars, n);
  }
}

async function submit(room, reportState, button) {
  const old = button.textContent;
  button.disabled = true;
  try {
    await sendReport(room, reportSlots(state.sheetScope), reportState);
    render();
    renderSheet();
  } catch (err) {
    button.disabled = false;
    button.textContent = old;
    const p = document.createElement('p');
    p.className = 'note is-err';
    p.textContent = err.message;
    $('#sheet-body').prepend(p);
  }
}

/* ------------------------------------------------------------------ *
 * Bedienelemente
 * ------------------------------------------------------------------ */

function setNow() {
  const now = new Date();
  $('#date').value = toDayStr(now);
  const start = new Date(now);
  start.setMinutes(Math.floor(start.getMinutes() / 5) * 5, 0, 0);
  $('#from').value = toTimeStr(start);
  $('#to').value = toTimeStr(new Date(start.getTime() + 45 * 60000));
  state.selected = new Set();
}

/** Die Vorgabe-Lektionen wählen, soweit es sie an diesem Tag gibt. */
function selectDefaultLessons() {
  const idx = DEFAULT_LESSONS
    .map((n) => n - 1)
    .filter((i) => i >= 0 && i < state.slots.length);
  state.selected = new Set(idx);
  syncTimesFromSelection();
}

/** "Jetzt" wählt zusätzlich die Lektion, in der wir gerade stecken. */
function selectCurrentSlot() {
  const now = new Date();
  if (toDayStr(now) !== $('#date').value) return;
  const mins = now.getHours() * 60 + now.getMinutes();
  const i = state.slots.findIndex((s) => mins < s.to);
  if (i >= 0) {
    state.selected = new Set([i]);
    syncTimesFromSelection();
  }
}

$('#now').addEventListener('click', () => {
  const wasDay = state.day;
  setNow();
  if ($('#date').value !== wasDay) {
    load().then(selectCurrentSlot).then(() => { updateChips(); render(); });
  } else {
    selectCurrentSlot();
    updateChips();
    render();
  }
});

$('#reload').addEventListener('click', () => { load(); });

$('#date').addEventListener('change', load);
$('#from').addEventListener('change', () => { state.selected = new Set(); updateChips(); render(); });
$('#to').addEventListener('change', () => { state.selected = new Set(); updateChips(); render(); });
$('#search').addEventListener('input', render);
$('#only').addEventListener('change', () => { savePrefs(); render(); });

// Sortier-Auswahl aufbauen
Object.entries(SORT_MODES).forEach(([value, label]) => {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  $('#sort').append(opt);
});
$('#sort').value = state.sort;
$('#sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  savePrefs();
  render();
});

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('is-active', x === t));
    render();
  });
});

// Filterbereich: am grossen Bildschirm offen, am Handy eingeklappt.
if (window.matchMedia('(min-width: 760px)').matches) $('#more').open = true;

// Meldungen der anderen regelmässig nachladen.
setInterval(() => { if (!document.hidden && state.day) loadStatus(true); }, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.day) loadStatus(true); });

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

(async () => {
  // Gemerkte Einstellungen übernehmen, bevor zum ersten Mal gerendert wird.
  const prefs = loadPrefs();
  if (prefs) {
    if (Array.isArray(prefs.buildings) && prefs.buildings.length) {
      state.buildings = new Set(prefs.buildings);
    }
    if (prefs.sort && SORT_MODES[prefs.sort]) {
      state.sort = prefs.sort;
      $('#sort').value = prefs.sort;
    }
    if (typeof prefs.only === 'boolean') $('#only').checked = prefs.only;
  }

  const { data } = await api('/api/me');
  if (data.loggedIn) {
    showApp();
    setNow();
    await load();          // wählt die Vorgabe-Lektionen gleich mit
  } else {
    showLogin(Boolean(data.codeRequired));
  }
})();
