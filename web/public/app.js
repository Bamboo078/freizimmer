import {
  buildBusy, deriveSlots, analyse, isFree, blockingEntries,
  parseDay, atTime, toDayStr, toTimeStr, minutesToStr, pad, WEEKDAYS,
} from './core.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  day: null,
  rooms: [],
  busy: new Map(),
  slots: [],
  warning: null,
  tab: 'liste',
  activeChip: null,
  loading: false,
};

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

  renderChips();
  render();
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
    pre.style.cssText = 'font-size:11px;white-space:pre-wrap;overflow:auto;max-height:200px';
    pre.textContent = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    d.append(s, pre);
    $('#body').append(d);
  }
}

function renderChips() {
  const box = $('#chips');
  box.textContent = '';
  if (!state.slots.length) return;

  const lbl = document.createElement('span');
  lbl.className = 'lbl';
  lbl.textContent = 'Lektion:';
  box.append(lbl);

  state.slots.forEach((slot, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = (i + 1) + '. ' + minutesToStr(slot.from) + '–' + minutesToStr(slot.to);
    b.addEventListener('click', () => {
      $('#from').value = minutesToStr(slot.from);
      $('#to').value = minutesToStr(slot.to);
      state.activeChip = i;
      render();
    });
    box.append(b);
  });

  const all = document.createElement('button');
  all.className = 'chip';
  all.type = 'button';
  all.textContent = 'ganzer Tag';
  all.addEventListener('click', () => {
    const first = state.slots[0];
    const last = state.slots[state.slots.length - 1];
    $('#from').value = minutesToStr(first.from);
    $('#to').value = minutesToStr(last.to);
    state.activeChip = 'all';
    render();
  });
  box.append(all);
}

function filterFn() {
  const needle = $('#search').value.trim().toLowerCase();
  const only = $('#only').checked;
  return (room) => {
    if (only && !/unt/i.test(room.desc)) return false;
    if (!needle) return true;
    return (room.name + ' ' + room.desc).toLowerCase().includes(needle);
  };
}

function render() {
  const chips = $('#chips').querySelectorAll('.chip');
  chips.forEach((c, i) => {
    const key = i === chips.length - 1 ? 'all' : i;
    c.classList.toggle('is-active', state.activeChip === key);
  });

  clearBody();
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

  if (state.tab === 'raster') renderRaster(day);
  else renderList(day);
}

function roomCard(room, metaText, cls) {
  const card = document.createElement('div');
  card.className = 'room-card ' + cls;
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = room.name;
  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = room.desc;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaText;
  card.append(name, desc, meta);
  return card;
}

function renderList(day) {
  const from = atTime(day, $('#from').value || '08:00');
  const to = atTime(day, $('#to').value || '09:00');
  if (!(to > from)) {
    setStatus('Die Endzeit muss nach der Startzeit liegen.');
    return;
  }

  const { free, taken } = analyse(state.busy, state.rooms, from, to, filterFn());
  setStatus(
    '<strong>' + free.length + '</strong> von ' + (free.length + taken.length) +
    ' Räumen frei · ' + toTimeStr(from) + '–' + toTimeStr(to)
  );

  if (!free.length) {
    const e = document.createElement('p');
    e.className = 'empty';
    e.textContent = 'In diesem Zeitfenster ist kein Raum frei.';
    $('#body').append(e);
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    free.forEach((item) => {
      grid.append(roomCard(
        item.room,
        item.until ? 'frei bis ' + toTimeStr(item.until) : 'danach nichts gebucht',
        'is-free'
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
      grid.append(roomCard(
        item.room,
        b ? b.title + ' (' + toTimeStr(b.start) + '–' + toTimeStr(b.end) + ')' : 'belegt',
        'is-busy'
      ));
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
  const rooms = state.rooms.filter(filterFn());
  setStatus(rooms.length + ' Räume · grün = frei');

  const table = document.createElement('table');
  table.className = 'raster';

  const head = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'room';
  corner.textContent = 'Raum';
  head.append(corner);
  state.slots.forEach((s, i) => {
    const th = document.createElement('th');
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
    tr.append(th);

    state.slots.forEach((s) => {
      const from = atTime(day, minutesToStr(s.from));
      const to = atTime(day, minutesToStr(s.to));
      const td = document.createElement('td');
      const free = isFree(state.busy, room, from, to);
      td.className = free ? 'is-f' : 'is-b';
      if (free) {
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
 * Bedienelemente
 * ------------------------------------------------------------------ */

function setNow() {
  const now = new Date();
  $('#date').value = toDayStr(now);
  const start = new Date(now);
  start.setMinutes(Math.floor(start.getMinutes() / 5) * 5, 0, 0);
  $('#from').value = toTimeStr(start);
  $('#to').value = toTimeStr(new Date(start.getTime() + 45 * 60000));
  state.activeChip = null;
}

$('#go').addEventListener('click', () => {
  if ($('#date').value !== state.day) load();
  else render();
});

$('#now').addEventListener('click', () => {
  const wasDay = state.day;
  setNow();
  if ($('#date').value !== wasDay) load();
  else render();
});

$('#date').addEventListener('change', load);
$('#from').addEventListener('change', () => { state.activeChip = null; render(); });
$('#to').addEventListener('change', () => { state.activeChip = null; render(); });
$('#search').addEventListener('input', render);
$('#only').addEventListener('change', render);

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('is-active', x === t));
    render();
  });
});

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

(async () => {
  const { data } = await api('/api/me');
  if (data.loggedIn) {
    showApp();
    setNow();
    load();
  } else {
    showLogin(Boolean(data.codeRequired));
  }
})();
