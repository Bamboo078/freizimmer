import { getCookies, COOKIE_TOKEN, COOKIE_REFRESH, siteCodeRequired, sendJson } from './_isy.js';

/** Sagt der Seite, ob sie das Login-Formular oder die App zeigen soll. */
export default async function handler(req, res) {
  const jar = getCookies(req);
  return sendJson(res, 200, {
    loggedIn: Boolean(jar[COOKIE_TOKEN] || jar[COOKIE_REFRESH]),
    codeRequired: siteCodeRequired(),
  });
}
