// ==UserScript==
// @name         Freizimmer – KSR Romanshorn
// @namespace    https://isy.ksr.ch/
// @version      1.0.0
// @description  Zeigt, welche Räume der Kantonsschule Romanshorn in einem bestimmten Zeitfenster frei sind.
// @match        https://isy.ksr.ch/*
// @match        https://isytest.ksr.ch/*
// @match        https://isydev.ksr.ch/*
// @match        https://isybox.ksr.ch/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * Freizimmer
 * ----------
 * Laeuft direkt auf der isy-Seite, weil die API (isy-api.ksr.ch) per CORS nur
 * Requests von https://isy.ksr.ch akzeptiert und mit einem Bearer-Token
 * arbeitet, das die isy-App im Browser haelt.
 *
 * Ablauf:
 *   1. Token besorgen (aus dem Pinia-Store der App, sonst aus mitgelesenen Requests).
 *   2. Alle Raeume laden  -> GraphQL "fetchAllResources"
 *   3. Belegungen des Tages laden:
 *        Strategie A: ein Request fuer alle Raeume ("appointmentsOccupiedWithResources")
 *        Strategie B: ein Request pro Raum ("appointmentsByRoom") als Fallback
 *   4. Lokal ausrechnen, welcher Raum im gewaehlten Zeitfenster frei ist.
 */

(function () {
  'use strict';

  // Zweiter Aufruf (z.B. Bookmarklet nochmal geklickt) -> nur oeffnen.
  if (window.__freizimmer__) {
    window.__freizimmer__.open();
    return;
  }

  /* ------------------------------------------------------------------ *
   * Konstanten / Helfer
   * ------------------------------------------------------------------ */

  const API_BY_HOST = {
    'isy.ksr.ch': 'https://isy-api.ksr.ch',
    'isytest.ksr.ch': 'https://isytest-api.ksr.ch',
    'isydev.ksr.ch': 'https://isydev-api.ksr.ch',
    'isybox.ksr.ch': 'https://isybox-api.ksr.ch',
  };
  const API_BASE =
    API_BY_HOST[location.hostname] ||
    'https://' + location.hostname.split('.')[0] + '-api.ksr.ch';
  const GQL_URL = API_BASE + '/graphql';

  const pad = (n) => String(n).padStart(2, '0');

  /** Lokaler UTC-Offset im Format +02:00 (so schickt es die isy-App auch). */
  function tzOffset(d) {
    const off = -d.getTimezoneOffset();
    const sign = off < 0 ? '-' : '+';
    const abs = Math.abs(off);
    return sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  /** Date -> "YYYY-MM-DDTHH:mm:ss+02:00" */
  function toGqlDate(d) {
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      tzOffset(d)
    );
  }

  /** "2026-09-14" -> Date (lokale Mitternacht) */
  function parseDay(str) {
    const parts = String(str).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  }

  /** "2026-09-14" + "13:55" -> Date */
  function atTime(dayStr, timeStr) {
    const day = parseDay(dayStr);
    const parts = String(timeStr).split(':').map(Number);
    day.setHours(parts[0] || 0, parts[1] || 0, 0, 0);
    return day;
  }

  const toDayStr = (d) =>
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const toTimeStr = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());

  const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
  const minutesToStr = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

  /** Laeuft `list` mit begrenzter Parallelitaet durch `fn`. */
  async function mapLimit(list, limit, fn) {
    const out = new Array(list.length);
    let i = 0;
    const workers = new Array(Math.min(limit, list.length)).fill(0).map(async () => {
      while (i < list.length) {
        const idx = i++;
        out[idx] = await fn(list[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Token
   * ------------------------------------------------------------------ */

  const Token = {
    captured: null,

    /**
     * Liest das entschluesselte Token aus dem Pinia-Store der isy-App.
     * Das ist der saubere Weg: wir benutzen die App-eigene Schnittstelle und
     * nicht ihren Storage (dort liegt das Token verschluesselt).
     */
    fromApp() {
      try {
        const roots = [document.querySelector('#app')].concat(
          Array.from(document.body ? document.body.children : [])
        );
        let app = null;
        for (const el of roots) {
          if (el && el.__vue_app__) { app = el.__vue_app__; break; }
        }
        if (!app) return null;

        const provides = (app._context && app._context.provides) || {};
        let pinia = null;
        for (const key of Reflect.ownKeys(provides)) {
          const val = provides[key];
          if (val && val._s && typeof val._s.get === 'function') { pinia = val; break; }
        }
        if (!pinia) return null;

        const store = pinia._s.get('token');
        if (!store) return null;

        const mgr = store.tokenManager;
        const tok =
          (mgr && typeof mgr.getToken === 'function' && mgr.getToken()) ||
          (typeof store.getToken === 'function' && store.getToken()) ||
          null;
        return typeof tok === 'string' && tok.length > 20 ? tok : null;
      } catch (e) {
        return null;
      }
    },

    /** Haengt sich an fetch/XHR, um den Authorization-Header mitzulesen. */
    install() {
      const remember = (value) => {
        if (typeof value === 'string' && /^Bearer\s+\S+/i.test(value)) {
          Token.captured = value.replace(/^Bearer\s+/i, '');
        }
      };
      const scanHeaders = (h) => {
        if (!h) return;
        try {
          if (typeof h.get === 'function') remember(h.get('authorization'));
          else if (Array.isArray(h)) h.forEach((pair) => { if (/^authorization$/i.test(pair[0])) remember(pair[1]); });
          else Object.keys(h).forEach((k) => { if (/^authorization$/i.test(k)) remember(h[k]); });
        } catch (e) { /* egal */ }
      };

      const origFetch = window.fetch;
      if (typeof origFetch === 'function') {
        window.fetch = function (input, init) {
          try {
            if (init) scanHeaders(init.headers);
            if (input && typeof input === 'object') scanHeaders(input.headers);
          } catch (e) { /* egal */ }
          return origFetch.apply(this, arguments);
        };
      }

      const origSet = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (/^authorization$/i.test(name)) remember(value);
        return origSet.apply(this, arguments);
      };
    },

    get() {
      return this.fromApp() || this.captured;
    },

    /**
     * Wenn noch kein Token da ist: die App per SPA-Navigation zu einem
     * Request bewegen und kurz warten (Fall "Bookmarklet nach Seitenaufbau").
     */
    async acquire() {
      let tok = this.get();
      if (tok) return tok;

      try {
        const back = location.pathname + location.search;
        history.pushState({}, '', '/rooms');
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        setTimeout(() => {
          try {
            history.pushState({}, '', back);
            window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          } catch (e) { /* egal */ }
        }, 1200);
      } catch (e) { /* egal */ }

      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 150));
        tok = this.get();
        if (tok) return tok;
      }
      return null;
    },
  };

  Token.install();

  /* ------------------------------------------------------------------ *
   * GraphQL
   * ------------------------------------------------------------------ */

  class GqlError extends Error {
    constructor(message, detail) {
      super(message);
      this.detail = detail;
    }
  }

  async function gql(query, variables) {
    const token = Token.get() || (await Token.acquire());
    if (!token) {
      throw new GqlError(
        'Kein Login-Token gefunden. Bist du in isy angemeldet? Lade die Seite neu und versuche es nochmal.',
        null
      );
    }

    const res = await fetch(GQL_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ query: query, variables: variables || {} }),
    });

    if (res.status === 401 || res.status === 403) {
      throw new GqlError(
        'isy hat den Zugriff abgelehnt (' + res.status + '). Meist hilft: isy-Seite neu laden.',
        null
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new GqlError('HTTP ' + res.status + ' von der isy-API.', body.slice(0, 500));
    }

    const json = await res.json();
    if (json.errors && json.errors.length) {
      throw new GqlError(json.errors.map((e) => e.message).join(' | '), json.errors);
    }
    return json.data;
  }

  /* ------------------------------------------------------------------ *
   * Queries (abgeleitet aus der isy-App selbst)
   * ------------------------------------------------------------------ */

  const Q_ROOMS_FULL = `
    query freizimmerRooms {
      resources(isRoom: true, order: { descShort: "asc" }, booking_list: [1, 2, 3, 4], showDeleted: false) {
        id
        _id
        descShort
        description
        partOf { id descShort }
        partOfChildren(showDeleted: false) { id descShort }
      }
    }`;

  const Q_ROOMS_SLIM = `
    query freizimmerRoomsSlim {
      resources(isRoom: true, order: { descShort: "asc" }, booking_list: [1, 2, 3, 4], showDeleted: false) {
        id
        _id
        descShort
        description
      }
    }`;

  // Strategie A: alle Belegungen im Zeitraum in einem Rutsch.
  const Q_OCCUPIED = `
    query freizimmerOccupied($start: String!, $end: String!, $first: Int, $after: String) {
      messages(
        context: { segment: "appointmentsOccupiedWithResources" }
        withinDateRange: { field: "dt", start: $start, end: $end }
        first: $first
        after: $after
      ) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            calculatedTitleShort
            agendaResourceTitle
            dtFrom
            dtTo
            resources(showDeleted: false, booked_list: [1, 2]) {
              edges {
                node {
                  id
                  resource {
                    id
                    descShort
                    partOf { id descShort }
                    partOfChildren(showDeleted: false) { id descShort }
                  }
                }
              }
            }
          }
        }
      }
    }`;

  // Strategie B: Belegungen eines einzelnen Raums (nutzt die Raum-Ansicht von isy).
  const Q_BY_ROOM = `
    query freizimmerByRoom($iri: String!, $start: String!, $end: String!, $first: Int, $after: String) {
      messages(
        context: { segment: "appointmentsByRoom", iri: $iri }
        withinDateRange: { field: "dt", start: $start, end: $end }
        showDeleted: false
        outputContext: "calendar:resource"
        order: { dtFrom: "asc" }
        first: $first
        after: $after
      ) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            calculatedTitleShort
            dtFrom
            dtTo
          }
        }
      }
    }`;

  /** Holt alle Seiten einer messages-Connection. */
  async function fetchAllPages(query, variables, pageSize) {
    const nodes = [];
    let after = null;
    for (let page = 0; page < 20; page++) {
      const vars = Object.assign({}, variables, { first: pageSize, after: after });
      const data = await gql(query, vars);
      const conn = data && data.messages;
      if (!conn) break;
      (conn.edges || []).forEach((e) => { if (e && e.node) nodes.push(e.node); });
      const info = conn.pageInfo;
      if (!info || !info.hasNextPage || !info.endCursor) break;
      after = info.endCursor;
    }
    return nodes;
  }

  /* ------------------------------------------------------------------ *
   * Datenmodell
   * ------------------------------------------------------------------ */

  const state = {
    rooms: [],
    roomsById: new Map(),
    day: null,
    busy: new Map(),      // Raum-IRI -> [{start, end, title}]
    slots: [],            // aus den Daten abgeleitetes Lektionsraster
    strategy: '',
    warning: null,
  };

  async function loadRooms() {
    let data;
    try {
      data = await gql(Q_ROOMS_FULL);
    } catch (e) {
      data = await gql(Q_ROOMS_SLIM);
    }
    const list = (data && data.resources) || [];
    state.rooms = list.map((r) => {
      const related = new Set([r.id]);
      if (r.partOf && r.partOf.id) related.add(r.partOf.id);
      (r.partOfChildren || []).forEach((c) => { if (c && c.id) related.add(c.id); });
      return {
        id: r.id,
        numId: r._id,
        name: r.descShort || '(ohne Name)',
        desc: r.description || '',
        related: related,
      };
    });
    state.roomsById = new Map(state.rooms.map((r) => [r.id, r]));
    return state.rooms;
  }

  function addBusy(iri, entry) {
    if (!iri) return;
    let arr = state.busy.get(iri);
    if (!arr) { arr = []; state.busy.set(iri, arr); }
    arr.push(entry);
  }

  /**
   * Traegt eine Belegung fuer einen Raum ein - und zusaetzlich fuer den
   * Gesamtraum bzw. die Teilraeume, weil die dann auch nicht nutzbar sind.
   */
  function markBusy(roomIri, entry, extraIris) {
    const targets = new Set([roomIri]);
    const room = state.roomsById.get(roomIri);
    if (room) room.related.forEach((i) => targets.add(i));
    (extraIris || []).forEach((i) => targets.add(i));
    targets.forEach((iri) => addBusy(iri, entry));
  }

  async function loadOccupancy(dayStr) {
    const dayStart = parseDay(dayStr);
    const dayEnd = parseDay(dayStr);
    dayEnd.setHours(23, 59, 59, 0);
    const vars = { start: toGqlDate(dayStart), end: toGqlDate(dayEnd) };

    state.busy = new Map();
    state.day = dayStr;
    state.warning = null;

    // --- Strategie A -------------------------------------------------
    let nodes = null;
    try {
      nodes = await fetchAllPages(Q_OCCUPIED, vars, 500);
      state.strategy = 'A';
    } catch (e) {
      state.strategy = '';
    }

    const isWeekday = dayStart.getDay() >= 1 && dayStart.getDay() <= 5;
    const needFallback = nodes === null || (nodes.length === 0 && isWeekday);

    if (!needFallback) {
      nodes.forEach((n) => {
        const from = new Date(n.dtFrom);
        const to = new Date(n.dtTo);
        if (isNaN(from.getTime()) || isNaN(to.getTime())) return;
        const entry = {
          start: from,
          end: to,
          title: n.calculatedTitleShort || n.agendaResourceTitle || 'Belegt',
        };
        const edges = (n.resources && n.resources.edges) || [];
        edges.forEach((e) => {
          const res = e && e.node && e.node.resource;
          if (!res || !res.id) return;
          const extra = [];
          if (res.partOf && res.partOf.id) extra.push(res.partOf.id);
          (res.partOfChildren || []).forEach((c) => { if (c && c.id) extra.push(c.id); });
          markBusy(res.id, entry, extra);
        });
      });
      finishOccupancy();
      return;
    }

    // --- Strategie B: pro Raum --------------------------------------
    state.strategy = 'B';
    const errors = [];
    await mapLimit(state.rooms, 4, async (room) => {
      try {
        const list = await fetchAllPages(
          Q_BY_ROOM,
          { iri: room.id, start: vars.start, end: vars.end },
          200
        );
        list.forEach((n) => {
          const from = new Date(n.dtFrom);
          const to = new Date(n.dtTo);
          if (isNaN(from.getTime()) || isNaN(to.getTime())) return;
          markBusy(room.id, {
            start: from,
            end: to,
            title: n.calculatedTitleShort || n.title || 'Belegt',
          });
        });
      } catch (e) {
        errors.push(room.name + ': ' + e.message);
      }
    });
    if (errors.length) {
      state.warning =
        errors.length + ' Raum/Räume konnten nicht geladen werden – die gelten hier als frei. (' +
        errors.slice(0, 3).join('; ') + (errors.length > 3 ? ' …' : '') + ')';
    }
    finishOccupancy();
  }

  /** Sortiert Belegungen und leitet das Lektionsraster aus den Daten ab. */
  function finishOccupancy() {
    state.busy.forEach((arr) => arr.sort((a, b) => a.start - b.start));

    const tally = new Map();
    state.busy.forEach((arr) => {
      arr.forEach((b) => {
        const from = minutesOfDay(b.start);
        const to = minutesOfDay(b.end);
        const span = to - from;
        if (span <= 0 || span > 120) return;      // Ganztages-Eintraege ignorieren
        const key = from + '-' + to;
        const cur = tally.get(key) || { from: from, to: to, count: 0 };
        cur.count++;
        tally.set(key, cur);
      });
    });

    const candidates = Array.from(tally.values())
      .filter((s) => s.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 16)
      .sort((a, b) => a.from - b.from);

    // Ueberlappende Varianten (z.B. Doppelstunden) zusammenfassen.
    const clean = [];
    candidates.forEach((s) => {
      const last = clean[clean.length - 1];
      if (last && s.from < last.to) {
        if (s.count > last.count) clean[clean.length - 1] = s;
        return;
      }
      clean.push(s);
    });
    state.slots = clean;
  }

  /* ------------------------------------------------------------------ *
   * Freiheits-Logik
   * ------------------------------------------------------------------ */

  const busyOf = (room) => state.busy.get(room.id) || [];

  /** Ist der Raum im Fenster [from,to) komplett frei? */
  function isFree(room, from, to) {
    return !busyOf(room).some((b) => b.start < to && b.end > from);
  }

  /** Naechste Belegung ab `to` (fuer "frei bis ..."). */
  function freeUntil(room, to) {
    const next = busyOf(room).find((b) => b.start >= to);
    return next ? next.start : null;
  }

  /** Belegungen, die das Fenster blockieren. */
  function blockingEntries(room, from, to) {
    return busyOf(room).filter((b) => b.start < to && b.end > from);
  }

  function analyse(from, to, filterFn) {
    const free = [];
    const taken = [];
    state.rooms.forEach((room) => {
      if (filterFn && !filterFn(room)) return;
      if (isFree(room, from, to)) {
        free.push({ room: room, until: freeUntil(room, to) });
      } else {
        taken.push({ room: room, blocks: blockingEntries(room, from, to) });
      }
    });
    free.sort((a, b) => {
      const av = a.until ? a.until.getTime() : Infinity;
      const bv = b.until ? b.until.getTime() : Infinity;
      if (av !== bv) return bv - av;             // laenger frei zuerst
      return a.room.name.localeCompare(b.room.name);
    });
    taken.sort((a, b) => a.room.name.localeCompare(b.room.name));
    return { free: free, taken: taken };
  }

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Poppins", system-ui, -apple-system, "Segoe UI", sans-serif; }

    .backdrop {
      position: fixed; inset: 0; z-index: 2147483000;
      background: rgba(15, 23, 42, .55);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 24px 16px; overflow: auto;
      -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
    }
    .sheet {
      width: 100%; max-width: 1060px; background: var(--fz-bg);
      color: var(--fz-fg); border-radius: 16px; overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,.35); display: flex; flex-direction: column;
    }

    :host { --fz-bg: #ffffff; --fz-fg: #101828; --fz-muted: #667085; --fz-line: #e4e7ec;
            --fz-soft: #f7f9fc; --fz-accent: #2a6df4; --fz-free: #0f9d58; --fz-free-bg: #e8f6ee;
            --fz-busy: #b42318; --fz-busy-bg: #fdf0ee; }
    :host(.dark) { --fz-bg: #171a21; --fz-fg: #e9edf5; --fz-muted: #98a2b3; --fz-line: #2a2f3a;
            --fz-soft: #1e222b; --fz-accent: #6ea0ff; --fz-free: #4ade80; --fz-free-bg: #15301f;
            --fz-busy: #f97066; --fz-busy-bg: #33201e; }

    header {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 20px; border-bottom: 1px solid var(--fz-line); background: var(--fz-soft);
    }
    header h1 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
    header .sub { font-size: 12px; color: var(--fz-muted); margin-top: 2px; }
    header .spacer { flex: 1; }
    .iconbtn {
      border: 1px solid var(--fz-line); background: var(--fz-bg); color: var(--fz-fg);
      border-radius: 8px; width: 32px; height: 32px; font-size: 16px; cursor: pointer; line-height: 1;
    }
    .iconbtn:hover { background: var(--fz-soft); }

    .controls { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid var(--fz-line); }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--fz-muted); font-weight: 600; }
    input[type=date], input[type=time], input[type=text], select {
      font-size: 14px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--fz-line);
      background: var(--fz-bg); color: var(--fz-fg); min-width: 0;
    }
    input[type=text] { min-width: 160px; }
    .btn {
      font-size: 14px; font-weight: 600; padding: 9px 16px; border-radius: 8px; cursor: pointer;
      border: 1px solid var(--fz-accent); background: var(--fz-accent); color: #fff;
    }
    .btn.ghost { background: var(--fz-bg); color: var(--fz-fg); border-color: var(--fz-line); font-weight: 500; }
    .btn:disabled { opacity: .55; cursor: default; }

    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      font-size: 12px; padding: 5px 10px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--fz-line); background: var(--fz-bg); color: var(--fz-fg);
    }
    .chip:hover { border-color: var(--fz-accent); color: var(--fz-accent); }
    .chip.active { background: var(--fz-accent); border-color: var(--fz-accent); color: #fff; }
    .chips .lbl { font-size: 12px; color: var(--fz-muted); align-self: center; margin-right: 2px; }

    .opts { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; font-size: 13px; color: var(--fz-muted); }
    .opts label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

    .tabs { display: flex; gap: 4px; padding: 12px 20px 0; }
    .tab {
      font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: 8px 8px 0 0;
      border: 1px solid transparent; background: none; color: var(--fz-muted); cursor: pointer;
    }
    .tab.active { color: var(--fz-fg); background: var(--fz-soft); border-color: var(--fz-line); border-bottom-color: var(--fz-soft); }

    .body { padding: 16px 20px 24px; min-height: 220px; }
    .status { font-size: 13px; color: var(--fz-muted); margin-bottom: 12px; }
    .status strong { color: var(--fz-fg); }
    .note { font-size: 12.5px; padding: 9px 12px; border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--fz-line); background: var(--fz-soft); }
    .note.err { border-color: var(--fz-busy); background: var(--fz-busy-bg); color: var(--fz-busy); }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr)); gap: 10px; }
    .card { border: 1px solid var(--fz-line); border-radius: 10px; padding: 11px 12px; background: var(--fz-bg); }
    .card.free { border-color: var(--fz-free); background: var(--fz-free-bg); }
    .card .name { font-weight: 600; font-size: 15px; }
    .card .desc { font-size: 12px; color: var(--fz-muted); margin-top: 1px; }
    .card .meta { font-size: 12px; margin-top: 7px; color: var(--fz-free); font-weight: 600; }
    .card.busy .meta { color: var(--fz-busy); font-weight: 500; }

    .empty { text-align: center; color: var(--fz-muted); padding: 40px 0; font-size: 14px; }

    details.taken { margin-top: 22px; }
    details.taken > summary { cursor: pointer; font-size: 13px; color: var(--fz-muted); margin-bottom: 10px; }

    table.raster { border-collapse: collapse; width: 100%; font-size: 12px; }
    table.raster th, table.raster td { border: 1px solid var(--fz-line); padding: 5px 7px; text-align: center; white-space: nowrap; }
    table.raster th.room { text-align: left; position: sticky; left: 0; background: var(--fz-bg); z-index: 1; }
    table.raster td.f { background: var(--fz-free-bg); color: var(--fz-free); font-weight: 600; }
    table.raster td.b { background: var(--fz-busy-bg); color: var(--fz-busy); }
    .scroll { overflow-x: auto; }

    .spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid var(--fz-line);
               border-top-color: var(--fz-accent); border-radius: 50%; animation: spin .7s linear infinite;
               vertical-align: -2px; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .launcher {
      position: fixed; right: 18px; bottom: 18px; z-index: 2147482000;
      background: var(--fz-accent); color: #fff; border: none; border-radius: 999px;
      padding: 11px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: 0 6px 20px rgba(42,109,244,.4);
    }

    @media (max-width: 640px) {
      .backdrop { padding: 0; }
      .sheet { border-radius: 0; min-height: 100vh; }
      .grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    }
  `;

  const UI = {
    host: null,
    root: null,
    el: {},
    tab: 'liste',
    onlyClassrooms: false,
    search: '',
    activeChip: null,

    mount() {
      this.host = document.createElement('div');
      this.host.id = 'freizimmer-root';
      this.root = this.host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = CSS;
      this.root.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'backdrop';
      wrap.style.display = 'none';
      wrap.innerHTML = this.template();
      this.root.appendChild(wrap);
      document.body.appendChild(this.host);

      this.el.backdrop = wrap;
      const q = (sel) => wrap.querySelector(sel);
      this.el.date = q('#fz-date');
      this.el.from = q('#fz-from');
      this.el.to = q('#fz-to');
      this.el.search = q('#fz-search');
      this.el.onlyCls = q('#fz-only');
      this.el.chips = q('#fz-chips');
      this.el.body = q('#fz-body');
      this.el.status = q('#fz-status');
      this.el.subtitle = q('#fz-subtitle');
      this.el.tabs = wrap.querySelectorAll('.tab');

      this.syncTheme();
      this.bind();
      return this;
    },

    template() {
      return `
        <div class="sheet" part="sheet">
          <header>
            <div>
              <h1>Freizimmer</h1>
              <div class="sub" id="fz-subtitle">Kantonsschule Romanshorn</div>
            </div>
            <div class="spacer"></div>
            <button class="iconbtn" id="fz-close" title="Schliessen (Esc)">&times;</button>
          </header>

          <div class="controls">
            <div class="row">
              <div class="field">
                <label for="fz-date">Datum</label>
                <input type="date" id="fz-date">
              </div>
              <div class="field">
                <label for="fz-from">Von</label>
                <input type="time" id="fz-from" step="300">
              </div>
              <div class="field">
                <label for="fz-to">Bis</label>
                <input type="time" id="fz-to" step="300">
              </div>
              <button class="btn" id="fz-go">Freie Räume zeigen</button>
              <button class="btn ghost" id="fz-now">Jetzt</button>
              <button class="btn ghost" id="fz-reload" title="Daten neu laden">↻</button>
            </div>
            <div class="chips" id="fz-chips"></div>
            <div class="opts">
              <input type="text" id="fz-search" placeholder="Raum suchen, z.B. HL3">
              <label><input type="checkbox" id="fz-only"> nur Unterrichtszimmer</label>
            </div>
          </div>

          <div class="tabs">
            <button class="tab active" data-tab="liste">Freie Räume</button>
            <button class="tab" data-tab="raster">Tagesraster</button>
          </div>

          <div class="body" id="fz-body">
            <div class="status" id="fz-status"></div>
          </div>
        </div>`;
    },

    syncTheme() {
      const theme = document.documentElement.getAttribute('theme');
      const dark = theme === 'dark' ||
        (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
      this.host.classList.toggle('dark', !!dark);
    },

    bind() {
      const wrap = this.el.backdrop;
      wrap.querySelector('#fz-close').addEventListener('click', () => this.close());
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) this.close(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && wrap.style.display !== 'none') this.close();
      });

      wrap.querySelector('#fz-go').addEventListener('click', () => this.run());
      wrap.querySelector('#fz-now').addEventListener('click', () => { this.setNow(); this.run(); });
      wrap.querySelector('#fz-reload').addEventListener('click', () => this.run(true));

      this.el.date.addEventListener('change', () => this.run());
      [this.el.from, this.el.to].forEach((i) =>
        i.addEventListener('change', () => { this.activeChip = null; this.render(); })
      );
      this.el.search.addEventListener('input', (e) => { this.search = e.target.value.trim(); this.render(); });
      this.el.onlyCls.addEventListener('change', (e) => { this.onlyClassrooms = e.target.checked; this.render(); });

      this.el.tabs.forEach((t) =>
        t.addEventListener('click', () => {
          this.tab = t.dataset.tab;
          this.el.tabs.forEach((x) => x.classList.toggle('active', x === t));
          this.render();
        })
      );
    },

    setNow() {
      const now = new Date();
      this.el.date.value = toDayStr(now);
      const start = new Date(now);
      start.setMinutes(Math.floor(start.getMinutes() / 5) * 5, 0, 0);
      const end = new Date(start.getTime() + 45 * 60000);
      this.el.from.value = toTimeStr(start);
      this.el.to.value = toTimeStr(end);
      this.activeChip = null;
    },

    open() {
      this.el.backdrop.style.display = 'flex';
      this.syncTheme();
      if (!this.el.date.value) {
        this.setNow();
        this.run();
      }
    },

    close() {
      this.el.backdrop.style.display = 'none';
    },

    setStatus(html) {
      this.el.status.innerHTML = html;
    },

    /** Laedt (falls noetig) die Daten und rendert danach. */
    async run(force) {
      const day = this.el.date.value;
      if (!day) return;
      if (!force && state.day === day && state.rooms.length) {
        this.render();
        return;
      }
      this.setStatus('<span class="spinner"></span>Lade Räume und Belegungen …');
      this.el.body.querySelectorAll(':scope > *:not(#fz-status)').forEach((n) => n.remove());
      try {
        if (!state.rooms.length || force) await loadRooms();
        await loadOccupancy(day);
        this.renderChips();
        this.render();
      } catch (err) {
        this.renderError(err);
      }
    },

    renderError(err) {
      this.setStatus('');
      this.el.body.querySelectorAll(':scope > *:not(#fz-status)').forEach((n) => n.remove());
      const box = document.createElement('div');
      box.className = 'note err';
      box.textContent = 'Fehler: ' + (err && err.message ? err.message : String(err));
      this.el.body.appendChild(box);
      if (err && err.detail) {
        const pre = document.createElement('details');
        pre.innerHTML = '<summary style="cursor:pointer;font-size:12px;color:var(--fz-muted)">Technische Details</summary>' +
          '<pre style="font-size:11px;white-space:pre-wrap;overflow:auto;max-height:200px"></pre>';
        pre.querySelector('pre').textContent =
          typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail, null, 2);
        this.el.body.appendChild(pre);
      }
      console.error('[Freizimmer]', err);
    },

    /** Lektions-Chips aus dem abgeleiteten Raster. */
    renderChips() {
      const box = this.el.chips;
      box.innerHTML = '';
      if (!state.slots.length) return;
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = 'Lektion:';
      box.appendChild(lbl);

      state.slots.forEach((slot, i) => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = (i + 1) + '. ' + minutesToStr(slot.from) + '–' + minutesToStr(slot.to);
        b.addEventListener('click', () => {
          this.el.from.value = minutesToStr(slot.from);
          this.el.to.value = minutesToStr(slot.to);
          this.activeChip = i;
          this.render();
        });
        box.appendChild(b);
      });

      const all = document.createElement('button');
      all.className = 'chip';
      all.textContent = 'ganzer Tag';
      all.addEventListener('click', () => {
        const first = state.slots[0], last = state.slots[state.slots.length - 1];
        this.el.from.value = minutesToStr(first.from);
        this.el.to.value = minutesToStr(last.to);
        this.activeChip = 'all';
        this.render();
      });
      box.appendChild(all);
    },

    filterFn() {
      const needle = this.search.toLowerCase();
      const only = this.onlyClassrooms;
      return (room) => {
        if (only && !/unt/i.test(room.desc)) return false;
        if (!needle) return true;
        return (room.name + ' ' + room.desc).toLowerCase().indexOf(needle) !== -1;
      };
    },

    render() {
      const chips = this.el.chips.querySelectorAll('.chip');
      chips.forEach((c, i) => {
        const key = i === chips.length - 1 ? 'all' : i;
        c.classList.toggle('active', this.activeChip === key);
      });
      this.el.body.querySelectorAll(':scope > *:not(#fz-status)').forEach((n) => n.remove());

      if (!state.rooms.length) { this.setStatus('Keine Raumdaten geladen.'); return; }

      const day = this.el.date.value;
      const d = parseDay(day);
      this.el.subtitle.textContent =
        'Kantonsschule Romanshorn · ' + WEEKDAYS[d.getDay()] + ', ' +
        pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();

      if (state.warning) {
        const n = document.createElement('div');
        n.className = 'note';
        n.textContent = state.warning;
        this.el.body.appendChild(n);
      }

      if (this.tab === 'raster') this.renderRaster(day);
      else this.renderList(day);
    },

    renderList(day) {
      const from = atTime(day, this.el.from.value || '08:00');
      const to = atTime(day, this.el.to.value || '09:00');
      if (!(to > from)) {
        this.setStatus('Die Endzeit muss nach der Startzeit liegen.');
        return;
      }

      const res = analyse(from, to, this.filterFn());
      const total = res.free.length + res.taken.length;
      this.setStatus(
        '<strong>' + res.free.length + '</strong> von ' + total + ' Räumen frei · ' +
        toTimeStr(from) + '–' + toTimeStr(to)
      );

      if (!res.free.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = 'In diesem Zeitfenster ist kein Raum frei.';
        this.el.body.appendChild(e);
      } else {
        const grid = document.createElement('div');
        grid.className = 'grid';
        res.free.forEach((item) => {
          const c = document.createElement('div');
          c.className = 'card free';
          const until = item.until
            ? 'frei bis ' + toTimeStr(item.until)
            : 'danach nichts gebucht';
          c.innerHTML =
            '<div class="name"></div><div class="desc"></div><div class="meta"></div>';
          c.querySelector('.name').textContent = item.room.name;
          c.querySelector('.desc').textContent = item.room.desc;
          c.querySelector('.meta').textContent = until;
          grid.appendChild(c);
        });
        this.el.body.appendChild(grid);
      }

      if (res.taken.length) {
        const det = document.createElement('details');
        det.className = 'taken';
        det.innerHTML = '<summary>' + res.taken.length + ' belegte Räume anzeigen</summary>';
        const grid = document.createElement('div');
        grid.className = 'grid';
        res.taken.forEach((item) => {
          const c = document.createElement('div');
          c.className = 'card busy';
          c.innerHTML = '<div class="name"></div><div class="desc"></div><div class="meta"></div>';
          c.querySelector('.name').textContent = item.room.name;
          c.querySelector('.desc').textContent = item.room.desc;
          const b = item.blocks[0];
          c.querySelector('.meta').textContent = b
            ? b.title + ' (' + toTimeStr(b.start) + '–' + toTimeStr(b.end) + ')'
            : 'belegt';
          grid.appendChild(c);
        });
        det.appendChild(grid);
        this.el.body.appendChild(det);
      }
    },

    renderRaster(day) {
      if (!state.slots.length) {
        this.setStatus('Für diesen Tag gibt es keine Lektionen – vermutlich schulfrei.');
        return;
      }
      const rooms = state.rooms.filter(this.filterFn());
      this.setStatus(rooms.length + ' Räume · grün = frei');

      const table = document.createElement('table');
      table.className = 'raster';
      const head = document.createElement('tr');
      head.innerHTML = '<th class="room">Raum</th>';
      state.slots.forEach((s, i) => {
        const th = document.createElement('th');
        th.innerHTML = (i + 1) + '.<br>' + minutesToStr(s.from);
        head.appendChild(th);
      });
      table.appendChild(head);

      rooms.forEach((room) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.className = 'room';
        th.textContent = room.name;
        tr.appendChild(th);
        state.slots.forEach((s) => {
          const from = atTime(day, minutesToStr(s.from));
          const to = atTime(day, minutesToStr(s.to));
          const td = document.createElement('td');
          const free = isFree(room, from, to);
          td.className = free ? 'f' : 'b';
          if (free) {
            td.textContent = 'frei';
          } else {
            const b = blockingEntries(room, from, to)[0];
            td.textContent = b ? b.title : '·';
          }
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });

      const scroll = document.createElement('div');
      scroll.className = 'scroll';
      scroll.appendChild(table);
      this.el.body.appendChild(scroll);
    },

    addLauncher() {
      const btn = document.createElement('button');
      btn.className = 'launcher';
      btn.textContent = '🔍 Freizimmer';
      btn.addEventListener('click', () => this.open());
      this.root.appendChild(btn);
    },
  };

  /* ------------------------------------------------------------------ *
   * Start
   * ------------------------------------------------------------------ */

  function boot(openNow) {
    UI.mount();
    if (openNow) UI.open();
    window.__freizimmer__ = {
      open: () => UI.open(),
      close: () => UI.close(),
      state: state,
      reload: () => UI.run(true),
      // Fuer Konsole/Tests: die reine Logik ohne UI.
      _internals: {
        Token: Token,
        gql: gql,
        loadRooms: loadRooms,
        loadOccupancy: loadOccupancy,
        analyse: analyse,
        isFree: isFree,
        freeUntil: freeUntil,
        toGqlDate: toGqlDate,
        atTime: atTime,
        UI: UI,
      },
    };
  }

  // Bookmarklet-Variante setzt window.__freizimmerAutoOpen = true.
  const autoOpen = window.__freizimmerAutoOpen === true;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot(autoOpen);
      if (!autoOpen) UI.addLauncher();
    });
  } else {
    boot(autoOpen);
    if (!autoOpen) UI.addLauncher();
  }
})();
