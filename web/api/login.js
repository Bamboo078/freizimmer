import {
  readJson, isyLogin, setAuthCookies, checkSiteCode, sendJson,
} from './_isy.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Nur POST.' });

  const body = await readJson(req);

  if (!checkSiteCode(body.code)) {
    return sendJson(res, 403, { error: 'Zugangscode stimmt nicht.' });
  }
  if (!body.loginid || !body.password) {
    return sendJson(res, 400, { error: 'Benutzername und Passwort angeben.' });
  }

  const result = await isyLogin(body.loginid, body.password);
  if (!result.ok) {
    return sendJson(res, result.status === 401 ? 401 : 400, { error: result.message });
  }

  // Ab hier wird das Passwort nicht mehr gebraucht und auch nirgends abgelegt.
  setAuthCookies(res, result.token, result.refreshToken);
  return sendJson(res, 200, { ok: true });
}
