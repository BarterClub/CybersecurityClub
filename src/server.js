// Cloudflare Worker handler for cybersecurityclub.
//
// Routes on top of the static-asset serving:
//   Public:
//     GET  /api/stats          → { total }                       global solve count
//     POST /api/solve          → { flag } → { ok, total }        re-hash, verify, increment
//     GET  /api/leaderboard    → { current, alltime }
//     POST /api/submit-score   → { username, solvedIds, elapsedMs }
//     GET  /api/config         → { ...siteConfig }               editable site config (KV-backed)
//
//   Admin (require valid Cloudflare Access JWT — see verifyAccessJwt):
//     GET  /api/admin/me                                          → { email }
//     POST /api/admin/config                                      replace siteConfig
//     POST /api/admin/leaderboard/delete  { username, board }     remove an entry
//     POST /api/admin/leaderboard/reset   { board }               wipe a board
//
// Everything else falls through to env.ASSETS.fetch().

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

// Per-challenge points — duplicated from CHALLENGES in client.js. Server
// computes total points from the submitted solvedIds rather than trusting
// client-sent totals (cheap defense against spoofed scores).
const CHALLENGE_POINTS = {
  1: 50, 2: 75, 3: 100, 4: 100, 5: 150,
  6: 200, 7: 175, 8: 125, 9: 150, 10: 175,
};
const TOTAL_CHALLENGES = 10;
const LEADERBOARD_LIMIT = 100;
const LB_USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

// Default site config — used by /api/config when KV has no override yet.
// Duplicates the inline CONFIG in index.html on purpose: that copy is the
// fallback when the API is unreachable; this copy is the seed when an
// admin loads the editor before any saves exist. Keep them in sync.
const DEFAULT_SITE_CONFIG = {
  clubName:    'OIT Cybersecurity Club Portland',
  campusName:  'Oregon Tech Portland-Metro',
  founded:     2025,
  description: "Hands-on security, CTFs, and hacking workshops at Oregon Tech's Portland-Metro campus.",
  meetingDay:  'Thursday',
  meetingTime: '4:00 PM',
  meetingRoom: 'Room 259',
  specialEvents: [
    { date: '2026-06-04',
      title: 'CTF Practice Night',
      detail: '4:00 PM · Room 259 · CTF practice problems + pizza · all skill levels' },
  ],
  members: 12,
  officers: [
    { role: 'President',        name: 'Joshua Brady',     email: 'joshua.brady@oit.edu',     main: true },
    { role: 'Vice-President',   name: 'Anteneh Demissie', email: 'anteneh.demissie@oit.edu' },
    { role: 'Treasurer',        name: 'Chris Hall',       email: 'chris.hall@oit.edu' },
    { role: 'Secretary',        name: 'Scott Reinholtz',  email: 'scott.reinholtz@oit.edu' },
    { role: 'Training Officer', name: 'Miguel Torres',    email: 'miguel.torres@oit.edu' },
  ],
  advisor: { name: 'Malini Nagasundaram', email: 'malini.nagasundaram@oit.edu' },
  links: {
    signup:  'https://theroost.oit.edu/PMCYB/club_signup',
    roost:   'https://theroost.oit.edu/feeds?type=club&type_id=35576&tab=about',
    discord: 'https://discord.gg/bJ2ZjDKhtT',
  },
};

// Same FNV-1a as the page (function intentionally identical to client.js's).
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

  if (!/^flag\{.*\}$/i.test(submitted)) {
    if (/^\{.*\}$/.test(submitted)) submitted = submitted.slice(1, -1);
    submitted = `flag{${submitted}}`;
  }

  const hash = fnv1a(submitted);
  const current = parseInt(await env.STATS.get('total_solves'), 10) || 0;

  if (!KNOWN_HASHES.has(hash)) {
    return jsonResponse({ ok: false, total: current });
  }

  const next = current + 1;
  await env.STATS.put('total_solves', String(next));
  return jsonResponse({ ok: true, total: next });
}

// ============================================================================
// LEADERBOARD
// ============================================================================

async function readBoard(env, key) {
  const raw = await env.STATS.get(key);
  if (!raw) return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch (_) { return []; }
}

function isBetter(a, b) {
  if (a.p !== b.p) return a.p > b.p;
  return a.t < b.t;
}

function insertOrUpgrade(list, entry) {
  const existingIdx = list.findIndex(e => e.u === entry.u);
  if (existingIdx >= 0) {
    if (!isBetter(entry, list[existingIdx])) return list;
    list.splice(existingIdx, 1);
  }
  list.push(entry);
  list.sort((a, b) => isBetter(a, b) ? -1 : (isBetter(b, a) ? 1 : 0));
  return list.slice(0, LEADERBOARD_LIMIT);
}

const FULL_POINTS = Object.values(CHALLENGE_POINTS).reduce((a, b) => a + b, 0);

function normalizeEntry(e) {
  if (typeof e.n === 'number') return e;
  if (e.p === FULL_POINTS) return { ...e, n: TOTAL_CHALLENGES };
  return e;
}

async function handleLeaderboard(env) {
  const [current, alltime] = await Promise.all([
    readBoard(env, 'leaderboard:current'),
    readBoard(env, 'leaderboard:alltime'),
  ]);
  return jsonResponse({
    current: current.map(normalizeEntry),
    alltime: alltime.map(normalizeEntry),
  });
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
  if (validIds.length < 1) {
    return jsonResponse({ error: 'must solve at least one challenge first' }, 400);
  }

  const elapsedMs = Math.max(0, Math.floor(Number(body && body.elapsedMs) || 0));
  if (!isFinite(elapsedMs) || elapsedMs > 1000 * 60 * 60 * 24 * 30) {
    return jsonResponse({ error: 'elapsedMs out of range' }, 400);
  }

  const points = validIds.reduce((sum, id) => sum + CHALLENGE_POINTS[id], 0);
  const entry = { u: username, p: points, t: elapsedMs, n: validIds.length, ts: Date.now() };

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

// ============================================================================
// SITE CONFIG (public read, admin write)
// ============================================================================

async function readSiteConfig(env) {
  const raw = await env.STATS.get('site_config');
  if (!raw) return DEFAULT_SITE_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : DEFAULT_SITE_CONFIG;
  } catch (_) { return DEFAULT_SITE_CONFIG; }
}

async function handleConfigGet(env) {
  return jsonResponse(await readSiteConfig(env));
}

// Schema-style validator — accepts an admin-submitted config and returns
// { ok: true, value } on success or { ok: false, error } on failure. Drops
// unknown keys so a buggy admin UI can't smuggle extra fields into KV.
function validateSiteConfig(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'config must be an object' };
  const out = {};
  const str = (v, max = 500) => typeof v === 'string' && v.length <= max ? v : null;
  const num = (v) => typeof v === 'number' && isFinite(v) ? v : null;

  const requiredStrings = {
    clubName: 200, campusName: 200, description: 1000,
    meetingDay: 20, meetingTime: 40, meetingRoom: 80,
  };
  for (const [k, max] of Object.entries(requiredStrings)) {
    const v = str(input[k], max);
    if (v == null) return { ok: false, error: `${k} must be a non-empty string` };
    out[k] = v;
  }

  const founded = num(input.founded);
  if (founded == null || founded < 1900 || founded > 2100) {
    return { ok: false, error: 'founded must be a year' };
  }
  out.founded = founded;

  const members = num(input.members);
  if (members == null || members < 0 || members > 100000) {
    return { ok: false, error: 'members must be a non-negative number' };
  }
  out.members = members;

  if (!Array.isArray(input.officers)) return { ok: false, error: 'officers must be an array' };
  if (input.officers.length > 50)     return { ok: false, error: 'too many officers' };
  out.officers = [];
  for (const [i, o] of input.officers.entries()) {
    if (!o || typeof o !== 'object') return { ok: false, error: `officer #${i+1} invalid` };
    const role = str(o.role, 80), name = str(o.name, 120), email = str(o.email, 200);
    if (!role || !name || !email) return { ok: false, error: `officer #${i+1} missing role/name/email` };
    const entry = { role, name, email };
    if (o.main === true) entry.main = true;
    out.officers.push(entry);
  }

  if (!input.advisor || typeof input.advisor !== 'object') {
    return { ok: false, error: 'advisor must be an object' };
  }
  const advName = str(input.advisor.name, 120);
  const advEmail = str(input.advisor.email, 200);
  if (!advName || !advEmail) return { ok: false, error: 'advisor missing name/email' };
  out.advisor = { name: advName, email: advEmail };

  if (!input.links || typeof input.links !== 'object') {
    return { ok: false, error: 'links must be an object' };
  }
  out.links = {};
  for (const k of ['signup', 'roost', 'discord']) {
    const v = str(input.links[k], 500);
    if (!v) return { ok: false, error: `links.${k} missing` };
    if (!/^https?:\/\//i.test(v)) return { ok: false, error: `links.${k} must be a URL` };
    out.links[k] = v;
  }

  if (!Array.isArray(input.specialEvents)) {
    return { ok: false, error: 'specialEvents must be an array' };
  }
  if (input.specialEvents.length > 100) return { ok: false, error: 'too many specialEvents' };
  out.specialEvents = [];
  for (const [i, e] of input.specialEvents.entries()) {
    if (!e || typeof e !== 'object') return { ok: false, error: `specialEvents #${i+1} invalid` };
    const date = str(e.date, 10), title = str(e.title, 200);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: `specialEvents #${i+1} date must be YYYY-MM-DD` };
    }
    if (!title) return { ok: false, error: `specialEvents #${i+1} missing title` };
    const entry = { date, title };
    const detail = str(e.detail, 400);
    if (detail) entry.detail = detail;
    out.specialEvents.push(entry);
  }

  return { ok: true, value: out };
}

async function handleAdminConfigPost(request, env, auth) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const result = validateSiteConfig(body);
  if (!result.ok) return jsonResponse({ error: result.error }, 400);

  await env.STATS.put('site_config', JSON.stringify(result.value));
  await appendAudit(env, auth.email, 'config.update', { keys: Object.keys(result.value) });
  return jsonResponse({ ok: true, config: result.value });
}

// ============================================================================
// LEADERBOARD MODERATION (admin)
// ============================================================================

async function handleAdminLeaderboardDelete(request, env, auth) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const username = String((body && body.username) || '').trim();
  if (!username) return jsonResponse({ error: 'missing username' }, 400);
  const board = String((body && body.board) || 'both');
  if (!['current', 'alltime', 'both'].includes(board)) {
    return jsonResponse({ error: 'board must be current|alltime|both' }, 400);
  }

  const targets = board === 'both' ? ['current', 'alltime'] : [board];
  const removed = {};
  for (const b of targets) {
    const key = `leaderboard:${b}`;
    const list = await readBoard(env, key);
    const before = list.length;
    const filtered = list.filter(e => e.u !== username);
    removed[b] = before - filtered.length;
    if (removed[b] > 0) await env.STATS.put(key, JSON.stringify(filtered));
  }
  await appendAudit(env, auth.email, 'leaderboard.delete', { username, board, removed });
  return jsonResponse({ ok: true, removed });
}

async function handleAdminLeaderboardReset(request, env, auth) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const board = String((body && body.board) || '');
  if (!['current', 'alltime'].includes(board)) {
    return jsonResponse({ error: 'board must be current|alltime' }, 400);
  }
  await env.STATS.delete(`leaderboard:${board}`);
  await appendAudit(env, auth.email, 'leaderboard.reset', { board });
  return jsonResponse({ ok: true });
}

// ============================================================================
// AUDIT LOG
// ============================================================================

const AUDIT_CAP = 200;

async function appendAudit(env, email, action, detail) {
  let log = [];
  try {
    const raw = await env.STATS.get('audit_log');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) log = parsed;
    }
  } catch (_) {}
  log.push({ ts: Date.now(), email: email || '?', action, detail });
  if (log.length > AUDIT_CAP) log = log.slice(-AUDIT_CAP);
  try { await env.STATS.put('audit_log', JSON.stringify(log)); }
  catch (_) {}
}

async function handleAdminAudit(env) {
  let log = [];
  try {
    const raw = await env.STATS.get('audit_log');
    if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) log = parsed; }
  } catch (_) {}
  return jsonResponse({ entries: log.slice().reverse() });
}

// ============================================================================
// CLOUDFLARE ACCESS JWT VERIFICATION
// ============================================================================
//
// CF Access sits in front of /admin* and /api/admin/* (configured in the
// Zero Trust dashboard). When a request makes it through, CF injects a
// signed JWT in the `Cf-Access-Jwt-Assertion` header (also available as
// the `CF_Authorization` cookie). We verify it against CF's public keys
// to make sure no one bypassed Access by hitting the Worker URL directly.

let _jwksCache = { teamDomain: null, data: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(teamDomain) {
  if (_jwksCache.data && _jwksCache.teamDomain === teamDomain
      && Date.now() - _jwksCache.fetchedAt < JWKS_TTL_MS) {
    return _jwksCache.data;
  }
  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json();
  _jwksCache = { teamDomain, data, fetchedAt: Date.now() };
  return data;
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

function b64urlToBytes(s) {
  const bin = b64urlDecode(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyAccessJwt(token, teamDomain, expectedAud) {
  if (!token || !teamDomain || !expectedAud) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch (_) { return null; }

  if (header.alg !== 'RS256') return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 60) return null;

  const expectedIss = `https://${teamDomain}.cloudflareaccess.com`;
  if (payload.iss !== expectedIss) return null;

  const audClaim = payload.aud;
  const audList = Array.isArray(audClaim) ? audClaim : [audClaim];
  if (!audList.includes(expectedAud)) return null;

  let jwks;
  try { jwks = await getJwks(teamDomain); }
  catch (_) { return null; }
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) return null;

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
  } catch (_) { return null; }

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  let valid = false;
  try { valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data); }
  catch (_) { return null; }

  return valid ? payload : null;
}

async function requireAdmin(request, env) {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN || '').trim();
  const aud = (env.CF_ACCESS_AUD || '').trim();
  if (!teamDomain || !aud) {
    return { ok: false, response: jsonResponse({ error: 'admin auth not configured' }, 503) };
  }

  let token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    const cookie = request.headers.get('Cookie') || '';
    const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) {
    return { ok: false, response: jsonResponse({ error: 'no access token' }, 401) };
  }

  const payload = await verifyAccessJwt(token, teamDomain, aud);
  if (!payload) {
    return { ok: false, response: jsonResponse({ error: 'invalid access token' }, 401) };
  }
  return { ok: true, auth: { email: payload.email || payload.sub || '?' } };
}

// ============================================================================
// ROUTER
// ============================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/api/stats')        return handleStats(env);
    if (p === '/api/solve')        return handleSolve(request, env);
    if (p === '/api/leaderboard')  return handleLeaderboard(env);
    if (p === '/api/submit-score') return handleSubmitScore(request, env);
    if (p === '/api/config')       return handleConfigGet(env);

    if (p.startsWith('/api/admin/')) {
      const gate = await requireAdmin(request, env);
      if (!gate.ok) return gate.response;
      const auth = gate.auth;
      if (p === '/api/admin/me')                     return jsonResponse({ email: auth.email });
      if (p === '/api/admin/config')                 return handleAdminConfigPost(request, env, auth);
      if (p === '/api/admin/leaderboard/delete')     return handleAdminLeaderboardDelete(request, env, auth);
      if (p === '/api/admin/leaderboard/reset')      return handleAdminLeaderboardReset(request, env, auth);
      if (p === '/api/admin/audit')                  return handleAdminAudit(env);
      return jsonResponse({ error: 'unknown admin route' }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    await env.STATS.delete('leaderboard:current');
  },
};
