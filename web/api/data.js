import { withFreshToken, isyGql, IsyAuthError, sendJson } from './_isy.js';

/* ------------------------------------------------------------------ *
 * Abfragen – 1:1 aus der isy-App übernommen
 * ------------------------------------------------------------------ */

const Q_ROOMS_FULL = `
  query freizimmerRooms {
    resources(isRoom: true, order: { descShort: "asc" }, booking_list: [1, 2, 3, 4], showDeleted: false) {
      id _id descShort description
      partOf { id descShort }
      partOfChildren(showDeleted: false) { id descShort }
    }
  }`;

const Q_ROOMS_SLIM = `
  query freizimmerRoomsSlim {
    resources(isRoom: true, order: { descShort: "asc" }, booking_list: [1, 2, 3, 4], showDeleted: false) {
      id _id descShort description
    }
  }`;

const Q_OCCUPIED = `
  query freizimmerOccupied($start: String!, $end: String!, $first: Int, $after: String) {
    messages(
      context: { segment: "appointmentsOccupiedWithResources" }
      withinDateRange: { field: "dt", start: $start, end: $end }
      first: $first
      after: $after
    ) {
      pageInfo { hasNextPage endCursor }
      edges { node {
        id calculatedTitleShort agendaResourceTitle dtFrom dtTo
        resources(showDeleted: false, booked_list: [1, 2]) {
          edges { node { id resource {
            id descShort
            partOf { id descShort }
            partOfChildren(showDeleted: false) { id descShort }
          } } }
        }
      } }
    }
  }`;

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
      edges { node { id title calculatedTitleShort dtFrom dtTo } }
    }
  }`;

/* ------------------------------------------------------------------ *
 * Helfer
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

/** "2026-09-14" -> Start und Ende des Tages im Format, das isy erwartet. */
function dayRange(dayStr, offsetMinutes) {
  const off = Number.isFinite(offsetMinutes) ? offsetMinutes : 120;   // Default: Schweiz Sommerzeit
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const tz = sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  return { start: dayStr + 'T00:00:00' + tz, end: dayStr + 'T23:59:59' + tz };
}

async function fetchAllPages(token, query, variables, pageSize) {
  const nodes = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const data = await isyGql(token, query, { ...variables, first: pageSize, after });
    const conn = data && data.messages;
    if (!conn) break;
    (conn.edges || []).forEach((e) => { if (e && e.node) nodes.push(e.node); });
    const info = conn.pageInfo;
    if (!info || !info.hasNextPage || !info.endCursor) break;
    after = info.endCursor;
  }
  return nodes;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(
    new Array(Math.min(limit, list.length)).fill(0).map(async () => {
      while (i < list.length) {
        const idx = i++;
        out[idx] = await fn(list[idx]);
      }
    })
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

export default async function handler(req, res) {
  const day = String(req.query.day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return sendJson(res, 400, { error: 'Parameter day fehlt oder ist ungültig (YYYY-MM-DD).' });
  }
  const offset = Number.parseInt(req.query.tz, 10);
  const { start, end } = dayRange(day, offset);

  try {
    const payload = await withFreshToken(req, res, async (token) => {
      /* --- Räume ------------------------------------------------- */
      let roomData;
      let roomsDegraded = false;
      try {
        roomData = await isyGql(token, Q_ROOMS_FULL);
      } catch (err) {
        if (err instanceof IsyAuthError) throw err;
        roomData = await isyGql(token, Q_ROOMS_SLIM);
        roomsDegraded = true;
      }

      const rooms = (roomData.resources || []).map((r) => {
        const related = new Set([r.id]);
        if (r.partOf && r.partOf.id) related.add(r.partOf.id);
        (r.partOfChildren || []).forEach((c) => { if (c && c.id) related.add(c.id); });
        return {
          id: r.id,
          numId: r._id,
          name: r.descShort || '(ohne Name)',
          desc: r.description || '',
          related: Array.from(related),
        };
      });

      /* --- Belegungen: Strategie A ------------------------------- */
      let appointments = null;
      let strategy = 'A';
      let warning = roomsDegraded
        ? 'Die Teilraum-Informationen konnten nicht geladen werden – geteilte Räume werden nicht berücksichtigt.'
        : null;

      try {
        const nodes = await fetchAllPages(token, Q_OCCUPIED, { start, end }, 500);
        appointments = nodes.map((n) => ({
          title: n.calculatedTitleShort || n.agendaResourceTitle || 'Belegt',
          start: n.dtFrom,
          end: n.dtTo,
          rooms: ((n.resources && n.resources.edges) || [])
            .map((e) => e && e.node && e.node.resource)
            .filter(Boolean)
            .flatMap((r) => {
              const ids = [r.id];
              if (r.partOf && r.partOf.id) ids.push(r.partOf.id);
              (r.partOfChildren || []).forEach((c) => { if (c && c.id) ids.push(c.id); });
              return ids;
            }),
        }));
      } catch (err) {
        if (err instanceof IsyAuthError) throw err;
        appointments = null;
      }

      /* --- Fallback: Strategie B, pro Raum ------------------------ */
      const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
      const isWeekday = weekday >= 1 && weekday <= 5;

      if (appointments === null || (appointments.length === 0 && isWeekday)) {
        strategy = 'B';
        const failures = [];
        const perRoom = await mapLimit(rooms, 6, async (room) => {
          try {
            const nodes = await fetchAllPages(token, Q_BY_ROOM, { iri: room.id, start, end }, 200);
            return nodes.map((n) => ({
              title: n.calculatedTitleShort || n.title || 'Belegt',
              start: n.dtFrom,
              end: n.dtTo,
              rooms: [room.id],
            }));
          } catch (err) {
            if (err instanceof IsyAuthError) throw err;
            failures.push(room.name);
            return [];
          }
        });
        appointments = perRoom.flat();
        if (failures.length) {
          warning =
            failures.length + ' Raum/Räume konnten nicht geladen werden und gelten hier als frei: ' +
            failures.slice(0, 5).join(', ') + (failures.length > 5 ? ' …' : '');
        }
      }

      return { day, strategy, rooms, appointments, warning };
    });

    return sendJson(res, 200, payload);
  } catch (err) {
    if (err instanceof IsyAuthError) {
      return sendJson(res, 401, { error: err.message, needLogin: true });
    }
    return sendJson(res, 502, {
      error: err.message || 'Unbekannter Fehler beim Laden.',
      detail: err.detail || null,
    });
  }
}
