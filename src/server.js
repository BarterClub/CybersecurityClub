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
  announcement: null,   // { message, severity?: 'info'|'warn'|'alert', expires?: 'YYYY-MM-DD' } or null
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

// Picks the Cache-Control value for a static-asset path. See the comment
// block in the router for the why behind each bucket. Returns null for
// path types we don't override (e.g. unknown extensions) — those keep
// Cloudflare's default.
function pickCacheControl(path) {
  if (path.endsWith('.js') || path.endsWith('.css') || path.endsWith('.html') ||
      path === '/' || !path.includes('.')) {
    return 'public, max-age=300, stale-while-revalidate=86400';
  }
  if (/\.(woff2|woff|ttf|otf|eot)$/.test(path)) {
    return 'public, max-age=604800, stale-while-revalidate=2592000';
  }
  if (/\.(png|jpg|jpeg|svg|gif|webp|avif|ico)$/.test(path)) {
    return 'public, max-age=86400, stale-while-revalidate=604800';
  }
  return null;
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

async function handleSubmitScore(request, env, ctx) {
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

  // Capture pre-upsert state for Discord event detection. `wasOnCurrentBefore`
  // distinguishes "first time appearing on the board" from "score improvement",
  // and `prevWasComplete` keeps us from re-posting the celebration on every
  // subsequent submit-score call after a player has already completed all 10.
  const prevCurrentEntry = current.find(e => e.u === username);
  const wasOnCurrentBefore = !!prevCurrentEntry;
  const prevWasComplete = !!prevCurrentEntry &&
    (prevCurrentEntry.n === TOTAL_CHALLENGES || prevCurrentEntry.p === FULL_POINTS);

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
  const rankCurrent = findRank(newCurrent);

  // Fire-and-forget Discord notification. waitUntil keeps the Worker alive
  // past the response so the POST doesn't block the player on Discord's
  // latency. If post fails (no token, no permission, Discord down), it logs
  // and the player still sees their score saved.
  const isFirstCompletion = validIds.length === TOTAL_CHALLENGES && !prevWasComplete;
  const isFirstLanding = !wasOnCurrentBefore && rankCurrent != null && !isFirstCompletion;
  if (ctx && (isFirstLanding || isFirstCompletion)) {
    ctx.waitUntil((async () => {
      const totalSolves = parseInt(await env.STATS.get('total_solves'), 10) || 0;
      // Inline-code the username so any markdown chars (_) don't render as
      // italic, and so it visually reads as a handle on the terminal-themed site.
      const msg = isFirstCompletion
        ? `🏆 \`${username}\` completed all 10 CTF challenges! Rank #${rankCurrent} · ${formatElapsed(elapsedMs)} · ${totalSolves} flags captured site-wide`
        : `🚩 \`${username}\` just landed on the leaderboard at #${rankCurrent} — solved ${validIds.length}/${TOTAL_CHALLENGES} · ${totalSolves} flags captured site-wide`;
      await postDiscordMessage(env, msg);
    })());
  }

  return jsonResponse({
    ok: true,
    rankCurrent,
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

  // Optional announcement — a single banner shown in the public boot terminal.
  // Empty/missing message → null (no banner). Invalid severity falls back to 'warn'.
  // Invalid/past expiry is dropped on read (the public site re-checks anyway).
  const ann = input.announcement;
  if (ann && typeof ann === 'object') {
    const msg = str(ann.message, 200);
    if (!msg) {
      out.announcement = null;
    } else {
      const sev = ['info', 'warn', 'alert'].includes(ann.severity) ? ann.severity : 'warn';
      const expires = (typeof ann.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ann.expires))
        ? ann.expires : null;
      out.announcement = { message: msg, severity: sev, ...(expires ? { expires } : {}) };
    }
  } else {
    out.announcement = null;
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
// STATS (admin) — computed from existing KV at request time. No new tracking
// infrastructure: distribution comes from leaderboard entries' `n` field,
// completion stats from full-board players, audit summary from audit_log.
// ============================================================================

async function handleAdminStats(env) {
  const [totalRaw, currentBoard, alltimeBoard, auditRaw] = await Promise.all([
    env.STATS.get('total_solves'),
    readBoard(env, 'leaderboard:current'),
    readBoard(env, 'leaderboard:alltime'),
    env.STATS.get('audit_log'),
  ]);

  const totalSolves = parseInt(totalRaw, 10) || 0;

  // Distribution: bucket players by number of challenges solved (0..TOTAL).
  // Entries missing `n` get bucketed as 0 unless they're a full completion
  // (point total == FULL_POINTS), which we can confidently call 10.
  const distribute = (board) => {
    const dist = new Array(TOTAL_CHALLENGES + 1).fill(0);
    for (const e of board) {
      let n;
      if (typeof e.n === 'number') n = e.n;
      else if (e.p === FULL_POINTS) n = TOTAL_CHALLENGES;
      else n = 0;
      n = Math.min(TOTAL_CHALLENGES, Math.max(0, Math.floor(n)));
      dist[n]++;
    }
    return dist;
  };

  // Completion stats over players who solved everything. Times come from `t`
  // (elapsed ms from first solve → last solve).
  const completionStats = (board) => {
    const times = board
      .filter(e => e.p === FULL_POINTS || e.n === TOTAL_CHALLENGES)
      .map(e => e.t)
      .filter(t => typeof t === 'number' && isFinite(t) && t > 0)
      .sort((a, b) => a - b);
    if (!times.length) return null;
    return {
      count: times.length,
      fastest: times[0],
      median: times[Math.floor(times.length / 2)],
      slowest: times[times.length - 1],
    };
  };

  // Audit summary: last 7 days. Group counts by user; keep the latest 20 raw
  // entries too so the page can show a short recent-activity list.
  let auditLog = [];
  try { if (auditRaw) { const parsed = JSON.parse(auditRaw); if (Array.isArray(parsed)) auditLog = parsed; } }
  catch (_) {}
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = auditLog.filter(e => typeof e.ts === 'number' && e.ts >= sevenDaysAgo);
  const byUser = {};
  for (const e of recent) {
    const u = e.email || '?';
    byUser[u] = (byUser[u] || 0) + 1;
  }
  const latestAudit = auditLog.length ? auditLog[auditLog.length - 1] : null;

  return jsonResponse({
    totalSolves,
    challengeCount: TOTAL_CHALLENGES,
    players: {
      current: currentBoard.length,
      alltime: alltimeBoard.length,
    },
    distribution: {
      current: distribute(currentBoard),
      alltime: distribute(alltimeBoard),
    },
    completion: {
      current: completionStats(currentBoard),
      alltime: completionStats(alltimeBoard),
    },
    top10: {
      current: currentBoard.slice(0, 10).map(normalizeEntry),
      alltime: alltimeBoard.slice(0, 10).map(normalizeEntry),
    },
    audit: {
      last7Days: recent.length,
      byUser,
      latest: latestAudit,
      recentEntries: recent.slice().reverse().slice(0, 20),
    },
  });
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
// DISCORD INTEGRATION
// ============================================================================
//
// Two surfaces, both via the same bot identity:
//
//   1. Hourly channel rename — sets the channel's name to
//      "🚩-<N>-flags-captured" using total_solves from KV. Hourly stays well
//      under Discord's 2-per-10-min rename rate limit.
//
//   2. Leaderboard event messages — when handleSubmitScore detects a player
//      first landing on the current-term board, or completing all 10
//      challenges, it posts a celebratory message to the same channel.
//
// Required env on the production Worker:
//   DISCORD_BOT_TOKEN   (secret)  — bot with Manage Channels + Send Messages
//   DISCORD_CHANNEL_ID  (var)     — channel snowflake ID to rename + post to
// If either is missing/blank, both functions silently no-op so a half-
// configured deploy doesn't surface as cron errors in observability.

const DISCORD_HEADERS = (token) => ({
  'Authorization': `Bot ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'CybersecurityClubBot (cloudflare-workers, 1.0)',
});

async function updateDiscordChannelName(env) {
  const token = (env.DISCORD_BOT_TOKEN || '').trim();
  const channelId = (env.DISCORD_CHANNEL_ID || '').trim();
  if (!token || !channelId) return;

  const total = parseInt(await env.STATS.get('total_solves'), 10) || 0;
  const name = `🚩-${total}-flags-captured`;

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      method: 'PATCH',
      headers: DISCORD_HEADERS(token),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`discord channel rename failed: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`discord channel rename threw: ${e && e.message}`);
  }
}

// allowed_mentions: { parse: [] } neutralizes any @here / @everyone / role /
// user mention even though LB_USERNAME_RE already forbids `@` — belt + braces
// so a future regex change doesn't silently start pinging the server.
async function postDiscordMessage(env, content) {
  const token = (env.DISCORD_BOT_TOKEN || '').trim();
  const channelId = (env.DISCORD_CHANNEL_ID || '').trim();
  if (!token || !channelId) return;

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: DISCORD_HEADERS(token),
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`discord message post failed: ${res.status} ${text.slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`discord message post threw: ${e && e.message}`);
  }
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// ============================================================================
// DISCORD SLASH COMMANDS (/leaderboard)
// ============================================================================
//
// Discord posts interactions to POST /discord/interactions when a user runs
// our registered slash command. Each request is signed with Ed25519 using
// the application's public key — we verify before doing anything, including
// the PING that Discord sends to confirm the endpoint is valid.
//
// The endpoint is intentionally outside the /api/admin/* gated path so
// Discord can reach it without going through Cloudflare Access.
//
// Slash commands are registered separately via the admin-only endpoint
// `POST /api/admin/discord/register-commands` — see handleAdminDiscordRegister
// below. That's a one-time op (or whenever the command list changes).

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function verifyDiscordSignature(publicKeyHex, signatureHex, timestamp, body) {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  const pubBytes = hexToBytes(publicKeyHex);
  const sigBytes = hexToBytes(signatureHex);
  if (!pubBytes || !sigBytes) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', pubBytes, { name: 'Ed25519' }, false, ['verify']
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sigBytes,
      new TextEncoder().encode(timestamp + body)
    );
  } catch (_) {
    return false;
  }
}

function formatLeaderboardBoard(board, label) {
  if (!board.length) return `**${label}**\n_(no entries yet)_`;
  const lines = board.slice(0, 10).map((e, i) => {
    const rank = String(i + 1).padStart(2);
    const user = (e.u || '?').padEnd(12).slice(0, 12);
    const pts  = String(e.p || 0).padStart(4);
    const t    = formatElapsed(e.t || 0);
    const n    = (typeof e.n === 'number') ? `${e.n}/${TOTAL_CHALLENGES}` : '   ';
    return `${rank}. ${user} ${pts}  ${n}  ${t}`;
  });
  return `**${label}**\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

async function handleLeaderboardCommand(env) {
  const [current, alltime, totalRaw] = await Promise.all([
    readBoard(env, 'leaderboard:current'),
    readBoard(env, 'leaderboard:alltime'),
    env.STATS.get('total_solves'),
  ]);
  const total = parseInt(totalRaw, 10) || 0;

  // type:4 = CHANNEL_MESSAGE_WITH_SOURCE — visible to everyone in the channel.
  // Use a single embed description so the two boards stack predictably; inline
  // embed fields don't side-by-side reliably once code blocks get involved.
  return jsonResponse({
    type: 4,
    data: {
      embeds: [{
        title: '🚩 CTF Leaderboard',
        description:
          formatLeaderboardBoard(current, 'Current Term — top 10') +
          '\n' +
          formatLeaderboardBoard(alltime, 'All-Time — top 10'),
        color: 0xffd24f,
        footer: { text: `${total} flags captured site-wide` },
      }],
      allowed_mentions: { parse: [] },
    },
  });
}

async function handleDiscordInteraction(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const publicKey = (env.DISCORD_PUBLIC_KEY || '').trim();
  if (!publicKey) {
    return new Response('discord interactions not configured', { status: 503 });
  }

  const signature = request.headers.get('X-Signature-Ed25519') || '';
  const timestamp = request.headers.get('X-Signature-Timestamp') || '';
  // Body must be the raw text — signature is over `timestamp + body`.
  const body = await request.text();

  const valid = await verifyDiscordSignature(publicKey, signature, timestamp, body);
  if (!valid) {
    return new Response('invalid request signature', { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(body); }
  catch (_) { return jsonResponse({ error: 'invalid JSON' }, 400); }

  // type 1 = PING (Discord uses this to verify the endpoint when you save the
  // Interactions Endpoint URL in the Developer Portal).
  if (payload.type === 1) return jsonResponse({ type: 1 });

  // type 2 = APPLICATION_COMMAND
  if (payload.type === 2) {
    const name = payload.data && payload.data.name;
    if (name === 'leaderboard') return handleLeaderboardCommand(env);
    return jsonResponse({
      type: 4,
      data: { content: `Unknown command: \`${name}\``, flags: 64 }, // 64 = EPHEMERAL
    });
  }

  return jsonResponse({ error: 'unsupported interaction type' }, 400);
}

// One-time-ish admin endpoint to (re)register the slash command set with
// Discord. PUT is idempotent — it replaces the full command list for the
// scope. If DISCORD_GUILD_ID is set, registers as a guild command (instant);
// otherwise registers globally (~1 hour to propagate).
async function handleAdminDiscordRegister(request, env, auth) {
  if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  const token = (env.DISCORD_BOT_TOKEN || '').trim();
  const appId = (env.DISCORD_APPLICATION_ID || '').trim();
  if (!token) return jsonResponse({ error: 'DISCORD_BOT_TOKEN not set' }, 503);
  if (!appId) return jsonResponse({ error: 'DISCORD_APPLICATION_ID not set' }, 503);

  const guildId = (env.DISCORD_GUILD_ID || '').trim();
  const url = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`;

  const commands = [{
    name: 'leaderboard',
    description: 'Show current and all-time CTF leaderboards',
    type: 1, // CHAT_INPUT
  }];

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: DISCORD_HEADERS(token),
      body: JSON.stringify(commands),
    });
    const text = await res.text();
    if (!res.ok) {
      return jsonResponse(
        { error: `discord returned ${res.status}`, body: text.slice(0, 500) },
        502,
      );
    }
    await appendAudit(env, auth.email, 'discord.register-commands', {
      scope: guildId ? 'guild' : 'global',
      guildId: guildId || null,
      count: commands.length,
    });
    return jsonResponse({
      ok: true,
      scope: guildId ? 'guild' : 'global',
      note: guildId
        ? 'Registered as guild command — available immediately.'
        : 'Registered as global command — up to 1 hour to propagate.',
    });
  } catch (e) {
    return jsonResponse({ error: (e && e.message) || 'fetch threw' }, 500);
  }
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === '/api/stats')           return handleStats(env);
    if (p === '/api/solve')           return handleSolve(request, env);
    if (p === '/api/leaderboard')     return handleLeaderboard(env);
    if (p === '/api/submit-score')    return handleSubmitScore(request, env, ctx);
    if (p === '/api/config')          return handleConfigGet(env);
    // Public — must NOT be gated by CF Access; Discord POSTs here directly
    // and we verify its Ed25519 signature inside the handler instead.
    if (p === '/discord/interactions') return handleDiscordInteraction(request, env);

    if (p.startsWith('/api/admin/')) {
      const gate = await requireAdmin(request, env);
      if (!gate.ok) return gate.response;
      const auth = gate.auth;
      if (p === '/api/admin/me')                        return jsonResponse({ email: auth.email });
      if (p === '/api/admin/config')                    return handleAdminConfigPost(request, env, auth);
      if (p === '/api/admin/leaderboard/delete')        return handleAdminLeaderboardDelete(request, env, auth);
      if (p === '/api/admin/leaderboard/reset')         return handleAdminLeaderboardReset(request, env, auth);
      if (p === '/api/admin/audit')                     return handleAdminAudit(env);
      if (p === '/api/admin/stats')                     return handleAdminStats(env);
      if (p === '/api/admin/discord/register-commands') return handleAdminDiscordRegister(request, env, auth);
      return jsonResponse({ error: 'unknown admin route' }, 404);
    }

    // Static assets — fall through to Cloudflare's static-assets binding,
    // but override Cache-Control per asset type. Cloudflare's default for
    // static assets is ~4h; that's fine for HTML during dev but leaves
    // gains on the floor for fonts/images that essentially never change.
    //
    // Three buckets, all using stale-while-revalidate so updates propagate
    // to the next pageview after a deploy without anyone ever waiting:
    //
    //   HTML / JS / CSS   max-age=300  swr=86400    (5 min + 1 day)
    //     Frequently-edited code. Short hot cache so changes go live fast.
    //     Replaces the previous `max-age=0, must-revalidate` which forced
    //     a 304 round-trip per navigation — ~150–600 ms mobile latency.
    //
    //   Fonts             max-age=604800  swr=2592000  (1 week + 30 days)
    //     Essentially immutable. If JetBrains Mono is ever replaced, also
    //     rename the woff2 (e.g. ...v2.woff2) and update styles.css so
    //     browsers fetch the new file via a new URL.
    //
    //   Images            max-age=86400  swr=604800   (1 day + 1 week)
    //     Logos / favicons / screenshots. Change rarely but DO change;
    //     a day of hot cache balances repeat-visit speed against update
    //     propagation. SWR window means updates land within ~1 day.
    //
    // User-facing content (announcement banner, members count, etc.) lives
    // in KV behind /api/config which is `no-store` and always fresh — so
    // editor changes propagate to the next pageload regardless of any of
    // these headers.
    const assetResponse = await env.ASSETS.fetch(request);
    const cacheHeader = pickCacheControl(p.toLowerCase());
    if (cacheHeader) {
      const headers = new Headers(assetResponse.headers);
      headers.set('Cache-Control', cacheHeader);
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }
    return assetResponse;
  },

  async scheduled(event, env, ctx) {
    // The hourly cron updates the Discord channel name with the current flag
    // count. Every other configured cron is a quarterly term-start trigger
    // that resets the per-term leaderboard. Branch on event.cron so we don't
    // wipe the leaderboard 24× per day.
    if (event.cron === '0 * * * *') {
      ctx.waitUntil(updateDiscordChannelName(env));
      return;
    }
    await env.STATS.delete('leaderboard:current');
  },
};
