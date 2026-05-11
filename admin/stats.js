// Admin stats page — fetches /api/admin/stats and renders numbers + ASCII bars.
// Same CF Access flow as the main /admin page: auth gate checks /api/admin/me,
// renders an error if not authenticated, otherwise loads the dashboard.

const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  let body = null;
  try { body = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, body };
}

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

// Make an ASCII bar of width N, scaled to maxValue. Returns markup with
// classed spans so the <pre> can color the filled vs empty parts.
function makeBar(value, maxValue, width = 20) {
  if (maxValue <= 0 || value <= 0) {
    return `<span class="empty">${'░'.repeat(width)}</span>`;
  }
  const filled = Math.max(0, Math.min(width, Math.round((value / maxValue) * width)));
  return `<span class="bar">${'▓'.repeat(filled)}</span><span class="empty">${'░'.repeat(width - filled)}</span>`;
}

// ============================================================================
// AUTH GATE — same pattern as console.js
// ============================================================================

async function checkAuth() {
  const gate = $('auth-gate');
  const stats = $('stats');
  gate.hidden = false;
  stats.hidden = true;

  const r = await api('/api/admin/me');
  if (r.ok && r.body && r.body.email) {
    $('who').textContent = r.body.email;
    gate.hidden = true;
    stats.hidden = false;
    return true;
  }
  if (r.status === 503) {
    $('auth-title').textContent = 'admin auth not configured';
    $('auth-msg').innerHTML = 'Cloudflare Access env vars are not set on this Worker.';
  } else if (r.status === 401) {
    $('auth-title').textContent = 'not signed in';
    $('auth-msg').textContent = 'You don\'t have a valid Cloudflare Access session for /admin.';
  } else {
    $('auth-title').textContent = 'admin unreachable';
    $('auth-msg').textContent = 'Couldn\'t reach /api/admin/me. Admin only works on the deployed Worker.';
  }
  return false;
}

// ============================================================================
// RENDER
// ============================================================================

let statsData = null;
let distBoard = 'current';
let topBoard  = 'current';

function renderOverview(d) {
  $('s-total').textContent = d.totalSolves.toLocaleString();
  $('s-current-players').textContent = d.players.current.toLocaleString();
  $('s-alltime-players').textContent = d.players.alltime.toLocaleString();
  $('s-audit7').textContent = d.audit.last7Days.toLocaleString();
  if (d.audit.latest) {
    const ts = new Date(d.audit.latest.ts);
    const tsStr = isNaN(ts) ? '?' : ts.toLocaleString();
    $('s-audit-latest').textContent = `latest: ${tsStr} (${d.audit.latest.email || '?'})`;
  } else {
    $('s-audit-latest').textContent = 'latest: never';
  }
}

function renderDistribution() {
  if (!statsData) return;
  const dist = statsData.distribution[distBoard] || [];
  const max = Math.max(1, ...dist);
  const total = statsData.challengeCount;
  const lines = [];
  for (let i = 0; i <= total; i++) {
    const label = `${String(i).padStart(2)}/${total}`;
    const count = dist[i] || 0;
    const bar = makeBar(count, max);
    lines.push(`<span class="label">${label}</span>  ${bar}  <span class="count">${count}</span>`);
  }
  $('distribution-chart').innerHTML = lines.join('\n');
}

function renderCompletion() {
  if (!statsData) return;
  const cur = statsData.completion.current;
  const alt = statsData.completion.alltime;
  const grid = $('completion-grid');
  grid.innerHTML = '';

  const card = (label, value, sub) => `
    <div class="stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      <div class="stat-sub">${escapeHtml(sub)}</div>
    </div>`;

  if (cur) {
    grid.insertAdjacentHTML('beforeend', card('full-completions · term', String(cur.count), 'players who solved 10/10'));
    grid.insertAdjacentHTML('beforeend', card('fastest · term', fmtElapsed(cur.fastest), 'first-solve → last-solve'));
    grid.insertAdjacentHTML('beforeend', card('median · term', fmtElapsed(cur.median), `among ${cur.count} completers`));
    grid.insertAdjacentHTML('beforeend', card('slowest · term', fmtElapsed(cur.slowest), 'longest time to 10/10'));
  } else {
    grid.insertAdjacentHTML('beforeend', `<div class="empty-state">no completers this term yet</div>`);
  }
  if (alt) {
    grid.insertAdjacentHTML('beforeend', card('full-completions · all time', String(alt.count), 'players who solved 10/10'));
    grid.insertAdjacentHTML('beforeend', card('fastest · all time', fmtElapsed(alt.fastest), 'all-time record'));
    grid.insertAdjacentHTML('beforeend', card('median · all time', fmtElapsed(alt.median), `among ${alt.count} completers`));
  }
}

function renderTop10() {
  if (!statsData) return;
  const list = statsData.top10[topBoard] || [];
  const tbody = $('top10-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-dim); padding: 12px;">— board is empty —</td></tr>`;
    return;
  }
  list.forEach((e, i) => {
    const solveCol = typeof e.n === 'number' ? `${e.n}/${statsData.challengeCount}` : '?';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rank">${i + 1}</td>
      <td class="user">${escapeHtml(e.u)}</td>
      <td class="pts">${e.p}</td>
      <td class="time">${fmtElapsed(e.t)}</td>
      <td class="solves">${solveCol}</td>`;
    tbody.appendChild(tr);
  });
}

function renderAudit() {
  if (!statsData) return;
  // By-user counts
  const byUser = statsData.audit.byUser || {};
  const list = $('by-user-list');
  list.innerHTML = '';
  const entries = Object.entries(byUser).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    list.innerHTML = `<li style="justify-content: center;"><span class="who">no admin writes in the last 7 days</span></li>`;
  } else {
    entries.forEach(([who, cnt]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="who">${escapeHtml(who)}</span> <span class="cnt">${cnt}</span>`;
      list.appendChild(li);
    });
  }
  // Recent entries
  const recent = statsData.audit.recentEntries || [];
  const auditBox = $('audit-list');
  if (!recent.length) {
    auditBox.innerHTML = `<div class="empty-state">no recent admin writes</div>`;
    return;
  }
  auditBox.innerHTML = recent.map(e => {
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

async function loadStats() {
  const r = await api('/api/admin/stats');
  if (!r.ok || !r.body) return;
  statsData = r.body;
  renderOverview(statsData);
  renderDistribution();
  renderCompletion();
  renderTop10();
  renderAudit();
}

// ============================================================================
// BOOT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.board-tab[data-board]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.board-tab[data-board]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      distBoard = tab.dataset.board;
      renderDistribution();
    });
  });
  document.querySelectorAll('.board-tab[data-board2]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.board-tab[data-board2]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      topBoard = tab.dataset.board2;
      renderTop10();
    });
  });

  const authed = await checkAuth();
  if (!authed) return;
  await loadStats();
});
