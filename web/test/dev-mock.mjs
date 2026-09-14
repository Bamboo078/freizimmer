/*
 * Startet die Website zusammen mit der isy-Attrappe in einem Prozess.
 *
 *   node test/dev-mock.mjs
 *   -> http://localhost:3000   (Login: testuser / geheim)
 *
 * Mit MOCK_NO_SEGMENT=1 tut die Attrappe so, als dürfte der Account die
 * Sammelabfrage nicht – damit lässt sich der Fallback (Strategie B) testen.
 */
process.env.ISY_API = process.env.ISY_API || 'http://localhost:4000';

await import('./mock-isy.mjs');
await import('../server.mjs');
