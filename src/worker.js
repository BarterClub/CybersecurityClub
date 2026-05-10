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

// Per-challenge points — duplicated from CHALLENGES in app.js. Server computes
// total points from the submitted solvedIds rather than trusting client-sent
// totals (cheap defense against spoofed scores).
const CHALLENGE_POINTS = {
  1: 50, 2: 75, 3: 100, 4: 100, 5: 150,
  6: 200, 7: 175, 8: 125, 9: 150, 10: 175,
};
const TOTAL_CHALLENGES = 10;
const LEADERBOARD_LIMIT = 100;        // max entries kept per board
const LB_USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

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

// ============================================================================
// LEADERBOARD
// ============================================================================
//
// Two boards in one KV namespace:
//   leaderboard:current   — current term, manually reset by an officer each
//                           quarter via `wrangler kv key delete`. Newcomers
//                           get a real shot at #1.
//   leaderboard:alltime   — never reset; bragging-rights record book.
//
// Each entry: { u: username, p: points, t: elapsedMs, ts: completedAt }
// Stored as a JSON array sorted descending by p, ascending by t (faster wins ties).
// One entry per username per board: re-submission keeps the *better* entry
// (more points, then faster time).

async function readBoard(env, key) {
  const raw = await env.STATS.get(key);
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch (_) { return []; }
}

function isBetter(a, b) {
  // Returns true if `a` is a better leaderboard entry than `b`.
  // Higher points wins; same points, lower elapsed wins.
  if (a.p !== b.p) return a.p > b.p;
  return a.t < b.t;
}

function insertOrUpgrade(list, entry) {
  // Replace existing entry for this username if the new one is better,
  // otherwise insert. Keep sorted, cap at LEADERBOARD_LIMIT.
  const existingIdx = list.findIndex(e => e.u === entry.u);
  if (existingIdx >= 0) {
    if (!isBetter(entry, list[existingIdx])) {
      // New entry isn't an improvement — keep the existing one.
      return list;
    }
    list.splice(existingIdx, 1);
  }
  list.push(entry);
  list.sort((a, b) => isBetter(a, b) ? -1 : (isBetter(b, a) ? 1 : 0));
  return list.slice(0, LEADERBOARD_LIMIT);
}

async function handleLeaderboard(env) {
  const [current, alltime] = await Promise.all([
    readBoard(env, 'leaderboard:current'),
    readBoard(env, 'leaderboard:alltime'),
  ]);
  return jsonResponse({ current: current.slice(0, 10), alltime: alltime.slice(0, 10) });
}

async function handleSubmitScore(request, env) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const username = String((body && body.username) || '').trim();
  if (!LB_USERNAME_RE.test(username)) {
    return jsonResponse({ error: 'username must be 3-20 chars, A-Z 0-9 - _' }, 400);
  }

  const solvedIds = Array.isArray(body && body.solvedIds) ? body.solvedIds : [];
  const validIds = [...new Set(solvedIds.filter(id =>
    typeof id === 'number' && CHALLENGE_POINTS[id] != null
  ))];
  if (validIds.length !== TOTAL_CHALLENGES) {
    return jsonResponse({ error: `must complete all ${TOTAL_CHALLENGES} challenges first` }, 400);
  }

  const elapsedMs = Math.max(0, Math.floor(Number(body && body.elapsedMs) || 0));
  if (!isFinite(elapsedMs) || elapsedMs > 1000 * 60 * 60 * 24 * 30) {
    return jsonResponse({ error: 'elapsedMs out of range' }, 400);
  }

  // Server computes points from validIds, not from client-sent total.
  const points = validIds.reduce((sum, id) => sum + CHALLENGE_POINTS[id], 0);

  const entry = { u: username, p: points, t: elapsedMs, ts: Date.now() };

  const [current, alltime] = await Promise.all([
    readBoard(env, 'leaderboard:current'),
    readBoard(env, 'leaderboard:alltime'),
  ]);
  const newCurrent = insertOrUpgrade(current, entry);
  const newAlltime = insertOrUpgrade(alltime, entry);
  await Promise.all([
    env.STATS.put('leaderboard:current', JSON.stringify(newCurrent)),
    env.STATS.put('leaderboard:alltime', JSON.stringify(newAlltime)),
  ]);

  // Find the player's rank in each board (1-indexed)
  const findRank = (list) => {
    const i = list.findIndex(e => e.u === username);
    return i < 0 ? null : i + 1;
  };

  return jsonResponse({
    ok: true,
    rankCurrent: findRank(newCurrent),
    rankAllTime: findRank(newAlltime),
    current: newCurrent.slice(0, 10),
    alltime: newAlltime.slice(0, 10),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/stats')        return handleStats(env);
    if (url.pathname === '/api/solve')        return handleSolve(request, env);
    if (url.pathname === '/api/leaderboard')  return handleLeaderboard(env);
    if (url.pathname === '/api/submit-score') return handleSubmitScore(request, env);
    // Everything else → serve from static assets.
    return env.ASSETS.fetch(request);
  },

  // Scheduled handler — fired by Cloudflare Cron Triggers per the schedule
  // in wrangler.jsonc. Wipes the per-term leaderboard at the start of each
  // OIT quarter so newcomers compete on a fresh board. The all-time board
  // is intentionally left alone.
  async scheduled(event, env, ctx) {
    await env.STATS.delete('leaderboard:current');
    // No return needed — Cloudflare logs the cron event in the dashboard.
  },
};
