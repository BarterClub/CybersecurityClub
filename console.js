// Admin console for OIT Cybersecurity Club Portland.
//
// Page is behind Cloudflare Access (configured at the edge — /admin* +
// /api/admin/* require a valid Access session). This script:
//   1. Checks /api/admin/me to confirm the session and grab the email
//   2. Loads the current site config from /api/config and renders the form
//   3. On save, POSTs the form back to /api/admin/config
//   4. Lets the admin moderate the leaderboard (delete entries, reset a board)
//   5. Shows the audit log
//
// All /api/admin/* requests rely on the CF_Authorization cookie that CF
// Access sets after login — same-origin fetches pick it up automatically.

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function setStatus(msg, level) {
  const el = $('save-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (level ? ` ${level}` : '');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, body };
}

// ============================================================================
// AUTH GATE
// ============================================================================

async function checkAuth() {
  const gate = $('auth-gate');
  const admin = $('admin');
  gate.hidden = false;
  admin.hidden = true;

  const r = await api('/api/admin/me');
  if (r.ok && r.body && r.body.email) {
    $('who').textContent = r.body.email;
    gate.hidden = true;
    admin.hidden = false;
    return true;
  }

  // Failure modes: 401 (not logged in / no CF Access JWT), 503 (admin auth
  // not configured on this Worker), other (network / unknown). Show a
  // helpful message tailored to each so the admin knows what to fix.
  if (r.status === 503) {
    $('auth-title').textContent = 'admin auth not configured';
    $('auth-msg').innerHTML =
      'Cloudflare Access env vars (<code>CF_ACCESS_TEAM_DOMAIN</code>, ' +
      '<code>CF_ACCESS_AUD</code>) are not set on this Worker. ' +
      'See <code>CLAUDE.md</code> for setup steps.';
  } else if (r.status === 401) {
    $('auth-title').textContent = 'not signed in';
    $('auth-msg').innerHTML =
      'You don\'t have a valid Cloudflare Access session for /admin. ' +
      'Either Access isn\'t configured to protect this path yet, or ' +
      'your email isn\'t in the allowed-users policy.';
  } else {
    $('auth-title').textContent = 'admin unreachable';
    $('auth-msg').textContent =
      'Couldn\'t reach /api/admin/me. If you\'re running locally without ' +
      'wrangler dev, the admin API only exists on the deployed Worker.';
  }
  return false;
}

// ============================================================================
// CONFIG FORM
// ============================================================================

let currentConfig = null;
const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function renderOfficer(o) {
  const div = document.createElement('div');
  div.className = 'row row-officer';
  div.innerHTML = `
    <input class="of-role"  type="text" placeholder="Role"  maxlength="80"  value="${escapeHtml(o.role || '')}">
    <input class="of-name"  type="text" placeholder="Name"  maxlength="120" value="${escapeHtml(o.name || '')}">
    <input class="of-email" type="email" placeholder="email@oit.edu" maxlength="200" value="${escapeHtml(o.email || '')}">
    <button type="button" class="main-tag${o.main ? ' on' : ''}" title="Mark as primary contact">&#9733;</button>
    <div class="row-actions">
      <button type="button" class="btn btn-small btn-danger of-del">remove</button>
    </div>`;
  const mainBtn = div.querySelector('.main-tag');
  mainBtn.addEventListener('click', () => {
    document.querySelectorAll('#officers-list .main-tag.on').forEach(b => b.classList.remove('on'));
    mainBtn.classList.add('on');
  });
  div.querySelector('.of-del').addEventListener('click', () => div.remove());
  return div;
}

function renderEvent(e) {
  const div = document.createElement('div');
  div.className = 'row row-event';
  div.innerHTML = `
    <input class="ev-date"   type="date" value="${escapeHtml(e.date || '')}">
    <input class="ev-title"  type="text" placeholder="Title" maxlength="200" value="${escapeHtml(e.title || '')}">
    <input class="ev-detail" type="text" placeholder="Optional detail" maxlength="400" value="${escapeHtml(e.detail || '')}">
    <div class="row-actions">
      <button type="button" class="btn btn-small btn-danger ev-del">remove</button>
    </div>`;
  div.querySelector('.ev-del').addEventListener('click', () => div.remove());
  return div;
}

function populateForm(cfg) {
  currentConfig = cfg;

  $('f-clubName').value    = cfg.clubName    || '';
  $('f-campusName').value  = cfg.campusName  || '';
  $('f-founded').value     = cfg.founded     ?? '';
  $('f-members').value     = cfg.members     ?? '';
  $('f-description').value = cfg.description || '';

  $('f-meetingDay').value  = DAYS.includes(cfg.meetingDay) ? cfg.meetingDay : 'Thursday';
  $('f-meetingTime').value = cfg.meetingTime || '';
  $('f-meetingRoom').value = cfg.meetingRoom || '';

  const offList = $('officers-list');
  offList.innerHTML = '';
  (cfg.officers || []).forEach(o => offList.appendChild(renderOfficer(o)));

  $('f-advisor-name').value  = (cfg.advisor && cfg.advisor.name)  || '';
  $('f-advisor-email').value = (cfg.advisor && cfg.advisor.email) || '';

  $('f-link-signup').value  = (cfg.links && cfg.links.signup)  || '';
  $('f-link-roost').value   = (cfg.links && cfg.links.roost)   || '';
  $('f-link-discord').value = (cfg.links && cfg.links.discord) || '';

  const evList = $('events-list');
  evList.innerHTML = '';
  (cfg.specialEvents || []).forEach(e => evList.appendChild(renderEvent(e)));
}

function collectForm() {
  const officers = [];
  document.querySelectorAll('#officers-list .row-officer').forEach(row => {
    const role  = row.querySelector('.of-role').value.trim();
    const name  = row.querySelector('.of-name').value.trim();
    const email = row.querySelector('.of-email').value.trim();
    if (!role && !name && !email) return;
    const entry = { role, name, email };
    if (row.querySelector('.main-tag').classList.contains('on')) entry.main = true;
    officers.push(entry);
  });

  const specialEvents = [];
  document.querySelectorAll('#events-list .row-event').forEach(row => {
    const date   = row.querySelector('.ev-date').value.trim();
    const title  = row.querySelector('.ev-title').value.trim();
    const detail = row.querySelector('.ev-detail').value.trim();
    if (!date && !title) return;
    const entry = { date, title };
    if (detail) entry.detail = detail;
    specialEvents.push(entry);
  });

  return {
    clubName:    $('f-clubName').value.trim(),
    campusName:  $('f-campusName').value.trim(),
    founded:     Number($('f-founded').value),
    description: $('f-description').value.trim(),
    meetingDay:  $('f-meetingDay').value,
    meetingTime: $('f-meetingTime').value.trim(),
    meetingRoom: $('f-meetingRoom').value.trim(),
    members:     Number($('f-members').value),
    officers,
    advisor: {
      name:  $('f-advisor-name').value.trim(),
      email: $('f-advisor-email').value.trim(),
    },
    links: {
      signup:  $('f-link-signup').value.trim(),
      roost:   $('f-link-roost').value.trim(),
      discord: $('f-link-discord').value.trim(),
    },
    specialEvents,
  };
}

async function loadConfig() {
  setStatus('loading...');
  const r = await api('/api/config');
  if (!r.ok || !r.body) {
    setStatus('failed to load config', 'err');
    return;
  }
  populateForm(r.body);
  setStatus('loaded.');
}

async function saveConfig() {
  const saveBtn = $('save');
  saveBtn.disabled = true;
  setStatus('saving...');
  const payload = collectForm();
  const r = await api('/api/admin/config', { method: 'POST', body: JSON.stringify(payload) });
  saveBtn.disabled = false;
  if (!r.ok) {
    setStatus('save failed: ' + ((r.body && r.body.error) || `HTTP ${r.status}`), 'err');
    return;
  }
  currentConfig = r.body.config;
  setStatus('saved ' + new Date().toLocaleTimeString(), 'ok');
  loadAudit();
}

// ============================================================================
// LEADERBOARD MODERATION
// ============================================================================

let currentBoard = 'current';
let leaderboards = { current: [], alltime: [] };

function fmtElapsed(ms) {
  if (!isFinite(ms) || ms <= 0) return '-';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}m`;
  if (m > 0) return `${m}m${String(sec).padStart(2,'0')}s`;
  return `${sec}s`;
}

function renderLeaderboard() {
  const list = leaderboards[currentBoard] || [];
  const container = $('lb-list');
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = `<div class="row" style="color: var(--text-dim); justify-content: center; display: flex;">board is empty</div>`;
    return;
  }
  list.forEach((e) => {
    const div = document.createElement('div');
    div.className = 'row row-lb';
    div.innerHTML = `
      <span><b>${escapeHtml(e.u)}</b></span>
      <span class="lb-points">${e.p} pts</span>
      <span class="lb-time">${fmtElapsed(e.t)}</span>
      <span class="lb-solves">${typeof e.n === 'number' ? `${e.n}/10` : '?/10'}</span>
      <div class="row-actions">
        <button type="button" class="btn btn-small btn-danger lb-del">delete</button>
      </div>`;
    div.querySelector('.lb-del').addEventListener('click', () => deleteEntry(e.u));
    container.appendChild(div);
  });
}

async function loadLeaderboards() {
  const r = await api('/api/leaderboard');
  if (!r.ok || !r.body) return;
  leaderboards = { current: r.body.current || [], alltime: r.body.alltime || [] };
  renderLeaderboard();
}

async function deleteEntry(username) {
  if (!confirm(`Remove "${username}" from the ${currentBoard} board?`)) return;
  const r = await api('/api/admin/leaderboard/delete', {
    method: 'POST',
    body: JSON.stringify({ username, board: currentBoard }),
  });
  if (!r.ok) {
    setStatus('delete failed: ' + ((r.body && r.body.error) || `HTTP ${r.status}`), 'err');
    return;
  }
  setStatus(`removed "${username}" from ${currentBoard}`, 'ok');
  await loadLeaderboards();
  await loadAudit();
}

async function resetBoard() {
  const label = currentBoard === 'alltime' ? 'ALL-TIME' : 'current term';
  if (!confirm(`Wipe the ${label} board? This cannot be undone.`)) return;
  if (currentBoard === 'alltime' && !confirm('The all-time board is never auto-reset. Are you ABSOLUTELY sure?')) return;
  const r = await api('/api/admin/leaderboard/reset', {
    method: 'POST',
    body: JSON.stringify({ board: currentBoard }),
  });
  if (!r.ok) {
    setStatus('reset failed: ' + ((r.body && r.body.error) || `HTTP ${r.status}`), 'err');
    return;
  }
  setStatus(`reset ${label} board`, 'ok');
  await loadLeaderboards();
  await loadAudit();
}

// ============================================================================
// AUDIT LOG
// ============================================================================

async function loadAudit() {
  const r = await api('/api/admin/audit');
  const container = $('audit');
  if (!r.ok || !r.body) {
    container.innerHTML = `<div class="audit-row"><span class="ts">-</span><span class="who">audit log unavailable</span><span class="act"></span><span class="det"></span></div>`;
    return;
  }
  const entries = r.body.entries || [];
  if (!entries.length) {
    container.innerHTML = `<div class="audit-row"><span class="ts">-</span><span class="who">no entries yet</span><span class="act"></span><span class="det"></span></div>`;
    return;
  }
  container.innerHTML = entries.map(e => {
    const ts = new Date(e.ts);
    const tsStr = isNaN(ts) ? '?' : ts.toLocaleString();
    const det = e.detail ? JSON.stringify(e.detail) : '';
    return `<div class="audit-row">
      <span class="ts">${escapeHtml(tsStr)}</span>
      <span class="who">${escapeHtml(e.email || '?')}</span>
      <span class="act">${escapeHtml(e.action || '')}</span>
      <span class="det" title="${escapeHtml(det)}">${escapeHtml(det)}</span>
    </div>`;
  }).join('');
}

// ============================================================================
// BOOT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  $('add-officer').addEventListener('click', () => {
    $('officers-list').appendChild(renderOfficer({}));
  });
  $('add-event').addEventListener('click', () => {
    $('events-list').appendChild(renderEvent({}));
  });
  $('save').addEventListener('click', saveConfig);
  $('reload').addEventListener('click', loadConfig);
  $('lb-refresh').addEventListener('click', loadLeaderboards);
  $('lb-reset').addEventListener('click', resetBoard);
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentBoard = tab.dataset.board;
      renderLeaderboard();
    });
  });

  const authed = await checkAuth();
  if (!authed) return;

  await Promise.all([loadConfig(), loadLeaderboards(), loadAudit()]);
});
