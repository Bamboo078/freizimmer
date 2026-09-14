/*
 * Kleiner Schlüssel-Wert-Speicher für die geteilten Meldungen
 * ("Zimmer abgeschlossen", "besetzt", "wir sind drin") und die daraus
 * gerechnete Statistik.
 *
 * Zwei Betriebsarten:
 *
 *   1. Redis über HTTP (Vercel KV bzw. Upstash). Wird automatisch benutzt,
 *      sobald die Umgebungsvariablen gesetzt sind:
 *         KV_REST_API_URL      + KV_REST_API_TOKEN          (Vercel KV)
 *         UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash direkt)
 *
 *   2. Ohne diese Variablen: nur im Arbeitsspeicher. Zum Ausprobieren gut,
 *      auf Vercel aber nutzlos – dort lebt jede Funktion nur kurz. Die
 *      Website sagt dem Benutzer dann, dass Meldungen nicht geteilt werden.
 *
 * Es werden ausschliesslich Meldungen gespeichert, keine Logindaten.
 */

function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

export const isPersistent = () => Boolean(config());

/* ------------------------------------------------------------------ *
 * Redis über HTTP
 * ------------------------------------------------------------------ */

async function call(path, body) {
  const cfg = config();
  const res = await fetch(cfg.url + path, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + cfg.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Speicher antwortete mit HTTP ' + res.status + ' ' + text.slice(0, 200));
  }
  return res.json();
}

const one = async (command) => (await call('', command)).result;

const many = async (commands) => {
  if (!commands.length) return [];
  const out = await call('/pipeline', commands);
  return out.map((x) => x.result);
};

/* ------------------------------------------------------------------ *
 * Ersatz im Arbeitsspeicher
 * ------------------------------------------------------------------ */

const memory = new Map();          // key -> Map(field -> string)
const hash = (key) => {
  let m = memory.get(key);
  if (!m) { m = new Map(); memory.set(key, m); }
  return m;
};

/* ------------------------------------------------------------------ *
 * Öffentliche Helfer – immer dieselbe Form, egal welche Betriebsart
 * ------------------------------------------------------------------ */

/** Alle Felder eines Hashes als einfaches Objekt. */
export async function hGetAll(key) {
  if (!isPersistent()) return Object.fromEntries(hash(key));

  const raw = await one(['HGETALL', key]);
  if (!raw) return {};
  // Upstash liefert je nach Version ein Objekt oder eine flache Liste.
  if (!Array.isArray(raw)) return raw;
  const out = {};
  for (let i = 0; i + 1 < raw.length; i += 2) out[raw[i]] = raw[i + 1];
  return out;
}

export async function hGet(key, field) {
  if (!isPersistent()) return hash(key).get(field) ?? null;
  const v = await one(['HGET', key, field]);
  return v == null ? null : String(v);
}

/** Setzt/löscht Felder und zählt Statistik-Felder hoch – in einem Rutsch. */
export async function apply({ set = [], del = [], incr = [], expire = [] }) {
  if (!isPersistent()) {
    set.forEach(([key, field, value]) => hash(key).set(field, value));
    del.forEach(([key, field]) => hash(key).delete(field));
    incr.forEach(([key, field, by]) => {
      const cur = Number(hash(key).get(field) || 0);
      hash(key).set(field, String(Math.max(0, cur + by)));
    });
    return;
  }

  const commands = [];
  set.forEach(([key, field, value]) => commands.push(['HSET', key, field, value]));
  del.forEach(([key, field]) => commands.push(['HDEL', key, field]));
  incr.forEach(([key, field, by]) => commands.push(['HINCRBY', key, field, String(by)]));
  expire.forEach(([key, seconds]) => commands.push(['EXPIRE', key, String(seconds)]));
  await many(commands);
}
