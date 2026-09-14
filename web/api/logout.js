import { clearAuthCookies, sendJson } from './_isy.js';

export default async function handler(req, res) {
  clearAuthCookies(res);
  return sendJson(res, 200, { ok: true });
}
