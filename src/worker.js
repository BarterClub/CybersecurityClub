// Cloudflare Worker handler for cybersecurityclub.
//
// Adds two API routes on top of the static-asset serving:
//   GET  /api/stats  → { total: <int> }                  current global solve count
//   POST /api/solve  → { flag: string } → { ok, total }  re-hash, verify, increment
//
// Everything else falls through to env.ASSETS.fetch() (the bound static-asset
// directory, configured in wrangler.jsonc).
//
// Why we re-hash server-side: if /api/solve just trusted the client's "I solved
// one" message, anyone with curl could spam +1s and inflate the counter. Forcing
// the caller to send a flag string and verifying its hash here means the API
// only counts when the caller actually knows a real flag. The hash list below
// duplicates the values in CHALLENGES (in index.html) on purpose — it's the
// security boundary, not a leak.

const KNOWN_HASHES = new Set([
  '92e3be71', // 1  recon
  '25baafa9', // 2  console
  '778322a0', // 3  base64
  '8390e5db', // 4  rot13
  '4e62b813', // 5  obfuscation
  '3f41b02f', // 6  xor
  'b85f8162', // 7  steganography
  '750288b1', // 8  nmap_recon
  'f7c7c45b', // 9  sql_injection
  'fe5284ab', // 10 jwt_tamper
]);

// Same FNV-1a as the page (function intentionally identical to index.html's).
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function handleStats(env) {
  const raw = await env.STATS.get('total_solves');
  return jsonResponse({ total: parseInt(raw, 10) || 0 });
}

async function handleSolve(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonResponse({ error: 'invalid JSON' }, 400); }

  let submitted = String((body && body.flag) || '').trim();
  if (!submitted) return jsonResponse({ error: 'missing flag' }, 400);

  // Normalize the same way the page does: accept "flag{x}", "{x}", or bare "x".
  if (!/^flag\{.*\}$/i.test(submitted)) {
    if (/^\{.*\}$/.test(submitted)) submitted = submitted.slice(1, -1);
    submitted = `flag{${submitted}}`;
  }

  const hash = fnv1a(submitted);
  const current = parseInt(await env.STATS.get('total_solves'), 10) || 0;

  if (!KNOWN_HASHES.has(hash)) {
    // Not a real flag — don't count it. Return current total so the client
    // can keep its display in sync without a separate fetch.
    return jsonResponse({ ok: false, total: current });
  }

  // Increment. KV is eventually consistent so we don't try to atomic-CAS;
  // for a club-scale counter, occasional duplicate / lost increments are
  // acceptable. If precision ever matters, swap to a Durable Object.
  const next = current + 1;
  await env.STATS.put('total_solves', String(next));
  return jsonResponse({ ok: true, total: next });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/stats') return handleStats(env);
    if (url.pathname === '/api/solve') return handleSolve(request, env);
    // Everything else → serve from static assets.
    return env.ASSETS.fetch(request);
  },
};
