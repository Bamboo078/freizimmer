/*
 * Gemeinsame Helfer für die Serverless-Funktionen.
 *
 * Wichtig: Das läuft auf dem Server, nicht im Browser. Deshalb gilt hier die
 * CORS-Sperre von isy nicht – der Server darf die API ganz normal anfragen.
 *
 * Das isy-Passwort wird NIE gespeichert. Es geht einmal durch /api/login,
 * wird dort gegen Token getauscht und danach verworfen. Gespeichert werden
 * nur die Token, und zwar als httpOnly-Cookie im Browser des Benutzers –
 * dieser Server legt gar keine Daten ab.
 */

export const ISY_HOST = process.env.ISY_HOST || 'isy.ksr.ch';
export const API_BASE =
  process.env.ISY_API || 'https://' + ISY_HOST.split('.')[0] + '-api.ksr.ch';

export const COOKIE_TOKEN = 'fz_token';
export const COOKIE_REFRESH = 'fz_refresh';

/* ------------------------------------------------------------------ *
 * Request-/Cookie-Helfer
 * ------------------------------------------------------------------ */

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function cookie(name, value, maxAgeSeconds) {
  return [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds,
  ].join('; ');
}

export function setAuthCookies(res, token, refreshToken) {
  const list = [];
  if (token) list.push(cookie(COOKIE_TOKEN, token, 60 * 60 * 24 * 30));
  if (refreshToken) list.push(cookie(COOKIE_REFRESH, refreshToken, 60 * 60 * 24 * 30));
  if (list.length) res.setHeader('Set-Cookie', list);
}

export function clearAuthCookies(res) {
  res.setHeader('Set-Cookie', [
    cookie(COOKIE_TOKEN, '', 0),
    cookie(COOKIE_REFRESH, '', 0),
  ]);
}

/* ------------------------------------------------------------------ *
 * isy-Aufrufe
 * ------------------------------------------------------------------ */

/** Meldet sich mit Benutzername/Passwort an und gibt die Token zurück. */
export async function isyLogin(loginid, password) {
  const res = await fetch(API_BASE + '/authentication_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ loginid: String(loginid || '').trim(), password: String(password || '') }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignorieren */
  }

  if (!res.ok) {
    const msg =
      (data && (data.message || (data.error && data.error.message))) ||
      (res.status === 401 ? 'Benutzername oder Passwort stimmt nicht.' : 'Anmeldung fehlgeschlagen (' + res.status + ').');
    return { ok: false, status: res.status, message: msg };
  }
  if (data && data.proceed === false) {
    return { ok: false, status: 403, message: data.message || 'isy hat die Anmeldung nicht abgeschlossen.' };
  }
  if (!data || !data.token) {
    return { ok: false, status: 502, message: 'isy hat kein Token zurückgegeben.' };
  }
  return { ok: true, token: data.token, refreshToken: data.refresh_token || null };
}

/** Holt mit dem Refresh-Token ein frisches Zugriffs-Token. */
export async function isyRefresh(refreshToken) {
  if (!refreshToken) return null;
  const res = await fetch(API_BASE + '/token/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data || !data.token) return null;
  return { token: data.token, refreshToken: data.refresh_token || refreshToken };
}

export class IsyAuthError extends Error {}

/** Eine GraphQL-Abfrage. Wirft IsyAuthError, wenn das Token nicht (mehr) gilt. */
export async function isyGql(token, query, variables) {
  const res = await fetch(API_BASE + '/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new IsyAuthError('Token abgelaufen');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error('isy-API antwortete mit HTTP ' + res.status);
    err.detail = body.slice(0, 300);
    throw err;
  }

  const json = await res.json();
  if (json.errors && json.errors.length) {
    const err = new Error(json.errors.map((e) => e.message).join(' | '));
    err.graphql = true;
    throw err;
  }
  return json.data;
}

/**
 * Führt `fn(token)` aus und wiederholt einmal mit frischem Token,
 * falls das alte abgelaufen ist.
 */
export async function withFreshToken(req, res, fn) {
  const jar = getCookies(req);
  const token = jar[COOKIE_TOKEN];
  const refresh = jar[COOKIE_REFRESH];

  if (!token && !refresh) {
    const e = new IsyAuthError('nicht angemeldet');
    e.needLogin = true;
    throw e;
  }

  if (token) {
    try {
      return await fn(token);
    } catch (err) {
      if (!(err instanceof IsyAuthError)) throw err;
    }
  }

  const fresh = await isyRefresh(refresh);
  if (!fresh) {
    clearAuthCookies(res);
    const e = new IsyAuthError('Sitzung abgelaufen – bitte neu anmelden.');
    e.needLogin = true;
    throw e;
  }
  setAuthCookies(res, fresh.token, fresh.refreshToken);
  return await fn(fresh.token);
}

/** Optionaler Zugangscode, damit nicht jeder das Login-Formular sieht. */
export function checkSiteCode(code) {
  const expected = process.env.FREIZIMMER_CODE;
  if (!expected) return true;
  return String(code || '') === expected;
}

export function siteCodeRequired() {
  return Boolean(process.env.FREIZIMMER_CODE);
}

export function sendJson(res, status, payload) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

/* ------------------------------------------------------------------ *
 * Wer meldet? – aus dem isy-Token gelesen
 * ------------------------------------------------------------------ */

function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Kennung des angemeldeten Benutzers – nur damit jede Person höchstens
 * eine Meldung pro Raum und Lektion hat und ihre eigene zurücknehmen kann.
 * Es wird kein Passwort und kein Token gespeichert.
 */
export function identityOf(req) {
  const jar = getCookies(req);
  const claims = decodeJwt(jar[COOKIE_TOKEN]) || {};
  const name =
    claims.username || claims.loginid || claims.preferred_username ||
    (claims.sub != null ? String(claims.sub) : '');
  if (!name) return { id: 'anonym', name: 'jemand' };
  return { id: String(name).toLowerCase(), name: String(name) };
}
