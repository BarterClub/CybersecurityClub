// OIT Cybersecurity Club Portland — main client-side script.
//
// Loaded from index.html via <script src="client.js" defer>. The deferred
// attribute keeps load order sane: the small inline CONFIG <script> at
// the top of <head> runs synchronously during parse, this file runs
// after parse is complete (before DOMContentLoaded), so all globals
// here can safely reference CONFIG and `document.getElementById(...)`.
//
// Was previously inlined in a <script> block at the bottom of the
// document. Split out so PR diffs and editor navigation aren't mixed
// across HTML/CSS/JS in a single 2200-line file.
  /* ============================================================
     ANIMATED STATS (simulated)
     ============================================================ */
  function jitter(b, r) { return Math.max(0, Math.min(100, b + (Math.random()-0.5)*r)); }
  // Like jitter() but without the 0..100 clamp — for values that aren't percentages (e.g. network KB/s).
  function jitterFree(b, r) { return Math.max(0, b + (Math.random()-0.5)*r); }
  // Rolling buffer for the network-in sparkline (most recent N samples)
  const NET_IN_HISTORY = [];
  const NET_IN_MAX_POINTS = 40;
  function drawNetInSparkline() {
    const line = document.getElementById('net-in-spark-line');
    if (!line || NET_IN_HISTORY.length < 2) return;
    const w = 100, h = 24, pad = 2;
    const min = Math.min(...NET_IN_HISTORY);
    const max = Math.max(...NET_IN_HISTORY);
    const span = Math.max(1, max - min);
    const step = w / (NET_IN_MAX_POINTS - 1);
    const pts = NET_IN_HISTORY.map((v, i) => {
      const x = i * step;
      const y = pad + (h - pad*2) * (1 - (v - min) / span);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
    line.setAttribute('points', pts);
  }
  // Memory totals — kept as constants so the displayed MB values are derived
  // from a percentage jitter, not jitter on raw MB. Adjust here to simulate
  // a different machine size (16 GB RAM + 4 GB swap is a reasonable baseline).
  const MEM_TOTAL_MB  = 16384;  // 16 GB
  const SWAP_TOTAL_MB =  4096;  //  4 GB
  setInterval(() => {
    const cpu = jitter(28, 20);
    document.getElementById('cpu-pct').textContent = cpu.toFixed(1)+'%';
    document.getElementById('cpu-bar').style.width = cpu+'%';
    document.querySelectorAll('[data-core]').forEach(el => {
      el.textContent = Math.floor(jitter(30, 40))+'%';
    });
    // RAM hovers around 45% (~7.4 GB), small range so it doesn't visibly thrash.
    const ramPct = jitter(45, 8);
    const ramMB  = Math.round(ramPct / 100 * MEM_TOTAL_MB);
    document.getElementById('ram-val').textContent = `${ramMB} MB / ${MEM_TOTAL_MB} MB`;
    document.getElementById('ram-bar').style.width = ramPct + '%';
    // Swap stays low — typical for a healthy machine.
    const swapPct = jitter(11, 4);
    const swapMB  = Math.round(swapPct / 100 * SWAP_TOTAL_MB);
    document.getElementById('swap-val').textContent = `${swapMB} MB / ${SWAP_TOTAL_MB} MB`;
    document.getElementById('swap-bar').style.width = swapPct + '%';
    const netIn = Math.floor(jitterFree(140, 80));
    document.getElementById('net-in').textContent  = netIn+' KB/s';
    document.getElementById('net-out').textContent = Math.floor(jitterFree(60,  40))+' KB/s';
    NET_IN_HISTORY.push(netIn);
    if (NET_IN_HISTORY.length > NET_IN_MAX_POINTS) NET_IN_HISTORY.shift();
    drawNetInSparkline();
  }, 1500);

  /* ============================================================
     CLOCK + UPTIME
     ============================================================ */
  const start = Date.now();
  setInterval(() => {
    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    document.getElementById('clock').textContent =
      pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
    // Note: there used to be a paired #uptime element rendered in the
    // status bar that this loop also updated. The element was removed
    // during a layout pass; the JS update was orphaned and threw
    // "Cannot set properties of null" once a second. The `uptime`
    // terminal command (defined separately) still works — it computes
    // uptime on demand from `start`.
  }, 1000);

  /* ============================================================
     TAB / PAGE SWITCHING
     ============================================================ */
  const PAGES = ['home', 'about', 'events', 'contact', 'lab', 'faq', 'leaderboard'];
  const FILES = { home:'index.tsx', about:'about.md', events:'events.json', contact:'contact.sh', lab:'lab.sh', faq:'faq.md', leaderboard:'ranks.json' };
  function switchTab(name) {
    if (!PAGES.includes(name)) return;
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));
    document.getElementById('current-file').textContent = FILES[name];
    addActivity('ok', `viewed <span class="term-out-info">${name}</span>`);
    printPage(name);
    document.getElementById('term-input').focus({ preventScroll: true });
  }
  document.querySelectorAll('.tab').forEach(t =>
    t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // Hidden deep-link routes — pages that exist in PAGES but have no visible
  // tab button (e.g. `lab` is members-only; we share the #lab URL with people
  // who have lab access, never with the public). If the URL has a #fragment
  // matching a known page, swap to it shortly after boot finishes. Boot's
  // home-page printer still runs first; this just navigates away from it.
  if (location.hash) {
    const target = location.hash.replace(/^#/, '');
    if (PAGES.includes(target) && target !== 'home') {
      // Defer so the boot animation has time to paint before we switch.
      setTimeout(() => switchTab(target), 600);
    }
  }
  window.addEventListener('hashchange', () => {
    const target = location.hash.replace(/^#/, '');
    if (PAGES.includes(target)) switchTab(target);
  });

  /* ============================================================
     CTF STATE
     ============================================================
     Flags are stored hashed (simple FNV-1a) so casual View Source
     doesn't spoil them. Determined players will still find them —
     that's the point of a CTF. Replace these with your own.
     ============================================================ */
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /* ============================================================
     JWT helpers — used by CTF #10 (jwt_tamper) commands.
     base64url is base64 with `+/` → `-_` and stripped padding.
     _hmacFake stands in for an HMAC-SHA256 — the real point of the
     challenge isn't cracking the secret, it's exploiting alg=none
     in the verifier (`whoami-jwt` accepts unsigned tokens).
     ============================================================ */
  function _b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  function _b64urlDecode(s) {
    s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    try { return decodeURIComponent(escape(atob(s))); }
    catch (_) { return atob(s); }
  }
  function _hmacFake(h, p) {
    return fnv1a(h + '.' + p + '|oit-cybersec-secret');
  }

  // NOTE: hashes are PRECOMPUTED with fnv1a() and pasted in as hex strings.
  // We deliberately don't call `fnv1a('flag{...}')` here — that would put
  // the plaintext flag in the page source for anyone with View Source.
  // To rotate a flag: compute its hash separately (same fnv1a algorithm)
  // and paste the new 8-char hex string below.
  const CHALLENGES = [
    { id:1, name:'recon',          points:50,
      brief:'Some files leave secrets in plain sight. View Page Source — really. Search the HTML for "flag{".',
      hint:'Right-click → View Page Source. Use Ctrl+F. Look near the top of the document.',
      hash: '92e3be71' },
    { id:2, name:'console',        points:75,
      brief:"When this page loaded, something printed to the browser's developer console. Open DevTools → Console tab.",
      hint:'F12 → Console tab. The flag was logged as plaintext.',
      hash: '25baafa9' },
    { id:3, name:'base64',         points:100,
      brief:'Decode this: ZmxhZ3tiNjRfaXNfbm90X2VuY3J5cHRpb259',
      hint:"In the terminal: `python` then `import base64; base64.b64decode('...')`. Or any base64 decoder.",
      hash: '778322a0' },
    { id:4, name:'rot13',          points:100,
      brief:'Decode (ROT13): synt{ebgngr_guvegrra_cynprf}',
      hint:"`python` then `import codecs; codecs.decode('...', 'rot13')`",
      hash: '8390e5db' },
    { id:5, name:'obfuscation',    points:150,
      brief:"There's a 5th flag hidden inside this page's JavaScript, assembled from string fragments. Read the code.",
      hint:"Search the page source for variables named like _x1, _x2, _x3 ... they concatenate.",
      hash: '4e62b813' },
    { id:6, name:'xor',            points:200,
      brief:'XOR these two hex strings together: 0x1c1d090f1d4f4e1c1c100e15531f1700551b1f10110a16  XOR  0x7b7878787878787878787878787878787878787878787878   (note: lengths must match)',
      hint:"Use the `python` command. `bytes(a^b for a,b in zip(bytes.fromhex('...'), bytes.fromhex('...')))`",
      hash: '3f41b02f' },
    { id:7, name:'steganography',  points:175,
      brief:'Sometimes data hides in HTML attributes. Inspect the <body> element. Anything... base64-shaped?',
      hint:'F12 → Elements → click <body>. Look for an unusual data-* attribute. Then base64 decode the value.',
      hash: 'b85f8162' },
    { id:8, name:'nmap_recon',     points:125,
      brief:"A misconfigured service on this host is leaking secrets via its banner. First find out what host you're on, then scan it. Version strings can talk too much.",
      hint:"Run `ifconfig` to see the local IP, then `nmap` that exact IP. Look at the version string of the unusual port.",
      hash: '750288b1' },
    { id:9, name:'sql_injection',  points:150,
      brief:"There's a `login` command on this terminal that talks to a `users` table. The query string is printed before each attempt — read it carefully. Classic SQLi will get you in.",
      hint:"Run `login admin password` and look at the SQL it prints. The username is interpolated unsanitized — `login admin'-- anything` will close the quote and comment out the password check. Or try `login admin' OR '1'='1 anything`. The flag is in the admin row that gets returned.",
      hash: 'f7c7c45b' },
    { id:10, name:'jwt_tamper',    points:175,
      brief:"There's a `token` command that issues JWTs and a `whoami-jwt` command that authenticates them. Tokens carry role=user. The admin debug-note holds the flag — forge your way in.",
      hint:"Use `jwt-decode <token>` to inspect any token. The HS256 signature on server-issued tokens won't budge — but the verifier accepts a second algorithm. Read RFC 7519 §6.1 about `alg: none`. Build a token with header alg=none, payload role=admin, and an empty signature (just leave nothing after the second dot). Use `python` for base64url-encoding (base64.urlsafe_b64encode + strip padding).",
      hash: 'fe5284ab' }
  ];
  // ---- Obfuscated flag #5 (read carefully) ----
  const _x1 = 'flag{';
  const _x2 = 'string_';
  const _x3 = 'concat_';
  const _x4 = 'is_weak_';
  const _x5 = 'obfuscation';
  const _x6 = '}';
  // (the `motto` var below uses the parts so a smart linter won't flag them as unused)
  const _motto = _x1 + _x2 + _x3 + _x4 + _x5 + _x6;

  // ---- Console flag drop ----
  console.log('%c[CTF #2] flag{console_log_is_loud}', 'color:#ffd24f;font-weight:bold;');
  console.log('%cIf you found this, run `flag console_log_is_loud` in the page terminal.', 'color:#7088a3;');

  const ctfState = {
    solved: new Set(),     // ids of solved challenges
    points: 0,
    activeChallenge: null  // id of last `ctf start`
  };

  // ---- Persist CTF progress across reloads (localStorage, this browser only) ----
  const CTF_STORAGE_KEY = 'oit-cybersec-ctf-v1';
  function saveCtfState() {
    try {
      localStorage.setItem(CTF_STORAGE_KEY, JSON.stringify({ solved: Array.from(ctfState.solved) }));
    } catch (_) { /* private mode / quota — silently ignore */ }
  }
  function loadCtfState() {
    try {
      const raw = localStorage.getItem(CTF_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.solved)) return;
      ctfState.solved.clear();
      ctfState.points = 0;
      data.solved.forEach(id => {
        const ch = CHALLENGES.find(c => c.id === id);
        if (ch) { ctfState.solved.add(id); ctfState.points += ch.points; }
      });
    } catch (_) { /* corrupt — ignore */ }
  }
  loadCtfState();

  function updateScoreUI() {
    const total = CHALLENGES.length;
    document.getElementById('score-badge').textContent = `CTF: ${ctfState.solved.size}/${total}`;
    document.getElementById('status-score').textContent = `CTF ${ctfState.solved.size}/${total} · ${ctfState.points}pts`;
  }
  updateScoreUI();

  /* ============================================================
     CTF TIMER — starts on first `ctf start <n>`, stops on the
     10th successful flag. Stored in localStorage so reloads
     mid-attempt don't reset the clock. Drives the leaderboard
     submission's elapsed-time field.
     ============================================================ */
  const CTF_TIMER_KEY = 'oit-cybersec-timer-v1';
  let ctfTimer = null;  // {startedAt, completedAt?, submittedAs?}
  try {
    const raw = localStorage.getItem(CTF_TIMER_KEY);
    if (raw) ctfTimer = JSON.parse(raw);
  } catch (_) { /* corrupt — ignore */ }

  function saveTimer() {
    try { localStorage.setItem(CTF_TIMER_KEY, JSON.stringify(ctfTimer)); }
    catch (_) {}
  }
  function startTimerIfFirstRun() {
    // Idempotent — sets startedAt only if not already set. Preserves any
    // existing fields on ctfTimer (skipped, submittedAs, etc.) so calling
    // this after a player skipped doesn't blow away that state.
    if (!ctfTimer) {
      ctfTimer = { startedAt: Date.now() };
    } else if (!ctfTimer.startedAt) {
      ctfTimer.startedAt = Date.now();
    } else {
      return;  // already started — no save needed
    }
    saveTimer();
  }
  function stopTimerOnCompletion() {
    // Create-if-null so pre-existing 10/10 players (whose localStorage
    // carried completion forward from before the timer feature shipped)
    // get a non-null ctfTimer they can submit against. Their elapsed time
    // resolves to 0 — slight unfairness on the leaderboard, but the
    // alternative is "you can't submit at all", which is worse UX.
    if (!ctfTimer) ctfTimer = { startedAt: Date.now(), completedAt: Date.now() };
    else if (!ctfTimer.completedAt) ctfTimer.completedAt = Date.now();
    saveTimer();
  }
  function elapsedMs() {
    if (!ctfTimer || !ctfTimer.startedAt) return 0;
    const end = ctfTimer.completedAt || Date.now();
    return Math.max(0, end - ctfTimer.startedAt);
  }
  // Format ms as "Xh Ym Zs" (omitting empty leading units)
  function formatElapsed(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}h ${m}m ${sec}s`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  // Fire-and-forget POST of the player's current progress to the leaderboard.
  // Called after every flag solve once the player has a username — so the
  // board updates live as they progress. On success, the API returns the
  // player's fresh rank on both boards; we cache it on ctfTimer so the
  // leaderboard tab can show their standing even when their row is off
  // the visible top 10. Failure is silent (next solve retries).
  async function autoSubmitProgress() {
    if (!ctfTimer || !ctfTimer.submittedAs) return;
    if (ctfState.solved.size < 1) return;
    const solvedIds = Array.from(ctfState.solved).sort((a, b) => a - b);
    try {
      const r = await fetch('/api/submit-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ctfTimer.submittedAs, solvedIds, elapsedMs: elapsedMs() }),
      });
      const d = await r.json().catch(() => null);
      if (d && d.ok) {
        ctfTimer.lastRankCurrent = d.rankCurrent;
        ctfTimer.lastRankAllTime = d.rankAllTime;
        saveTimer();
      }
    } catch (_) { /* offline / no Worker — ignore */ }
  }

  /* ============================================================
     PYODIDE LOADER (real Python, on demand)
     ============================================================ */
  let pyodide = null;
  let pyodideLoading = null;
  async function ensurePyodide(progressFn) {
    if (pyodide) return pyodide;
    if (pyodideLoading) return pyodideLoading;
    pyodideLoading = (async () => {
      progressFn && progressFn('downloading pyodide runtime (~10MB)... this may take a moment');
      // Load the loader script
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
        s.onload = res; s.onerror = () => rej(new Error('failed to load pyodide CDN'));
        document.head.appendChild(s);
      });
      progressFn && progressFn('initializing python interpreter...');
      pyodide = await window.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
      });
      progressFn && progressFn('python ready.');
      return pyodide;
    })().catch(err => { pyodideLoading = null; throw err; });
    return pyodideLoading;
  }

  /* ============================================================
     TERMINAL ENGINE
     ============================================================ */
  const term       = document.getElementById('term');
  const termOutput = document.getElementById('term-output');
  const termInput  = document.getElementById('term-input');
  const termPath   = document.getElementById('term-path');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function out(html, cls = '') {
    const div = document.createElement('div');
    div.className = 'term-line term-out ' + (cls ? 'term-out-' + cls : '');
    div.innerHTML = html;
    termOutput.appendChild(div);
    term.scrollTop = term.scrollHeight;
  }
  function blank() { out('&nbsp;'); }
  function echoCmd(cmd) {
    const div = document.createElement('div');
    div.className = 'term-line prompt-line';
    if (pythonMode) {
      div.innerHTML = '<span class="term-prompt" style="color:var(--info)">&gt;&gt;&gt;</span>' +
        '<span class="term-cmd">'+escapeHtml(cmd)+'</span>';
    } else {
      div.innerHTML = `<span class="term-prompt">hacker@${CONFIG.clubShort}</span>` +
        '<span class="term-path">'+termPath.textContent+'</span>' +
        '<span class="term-dollar">$</span>' +
        '<span class="term-cmd">'+escapeHtml(cmd)+'</span>';
    }
    termOutput.appendChild(div);
  }

  /* ============================================================
     PYTHON REPL — interactive mode state, evaluator, prompt switch
     ============================================================ */
  let pythonMode = false;
  // When true, the next line of input is captured as a leaderboard username
  // rather than executed as a command. Set after a 10/10 completion.
  let submitPromptMode = false;

  function updatePromptUI() {
    const line = document.querySelector('.term-input-line');
    if (!line) return;
    const prompt = line.querySelector('.term-prompt');
    const path   = line.querySelector('.term-path');
    const dollar = line.querySelector('.term-dollar');
    if (pythonMode) {
      prompt.textContent = '>>>';
      prompt.style.color = 'var(--info)';
      path.style.display = 'none';
      dollar.style.display = 'none';
    } else {
      prompt.textContent = 'hacker@cybersec';
      prompt.style.color = '';
      path.style.display = '';
      dollar.style.display = '';
    }
  }

  // Real-Python-REPL behavior: try eval (expression), fall back to exec (statement).
  // Captures stdout/stderr and prints repr() of expression results, like a real REPL.
  async function runPythonLine(line) {
    try {
      const py = await ensurePyodide(msg => out('  '+msg, 'dim'));
      const wrapper = `
import sys, io, traceback
_buf = io.StringIO()
_old_out, _old_err = sys.stdout, sys.stderr
sys.stdout = _buf
sys.stderr = _buf
_repr = None
try:
    try:
        _code = compile(${JSON.stringify(line)}, '<stdin>', 'eval')
        _r = eval(_code, globals())
        if _r is not None:
            _repr = repr(_r)
    except SyntaxError:
        _code = compile(${JSON.stringify(line)}, '<stdin>', 'exec')
        exec(_code, globals())
except Exception:
    traceback.print_exc(limit=-1)
finally:
    sys.stdout = _old_out
    sys.stderr = _old_err
_text = _buf.getvalue()
if _repr is not None:
    _text += _repr + '\\n'
_text
      `.trim();
      const text = py.runPython(wrapper);
      if (text) {
        text.replace(/\n$/, '').split('\n').forEach(ln => out(escapeHtml(ln)));
      }
    } catch (e) {
      out(escapeHtml(String(e.message || e)), 'err');
    }
  }

  /* ============================================================
     ACTIVITY LOG — driven by terminal commands, tab clicks, links
     ============================================================ */
  function addActivity(level, html) {
    const log = document.getElementById('activity-log');
    if (!log) return;
    const tagText = { info:'INFO', ok:' OK ', warn:'WARN', err:' ERR' }[level] || 'INFO';
    const cssLevel = level === 'err' ? 'warn' : level;  // reuse warn red-ish styling for errors
    const div = document.createElement('div');
    div.className = `log-line log-${cssLevel}`;
    div.innerHTML = `<span class="log-tag">[${tagText}]</span> ${html}`;
    log.insertBefore(div, log.firstChild);
    // cap to keep the panel from growing unbounded
    while (log.children.length > 30) log.removeChild(log.lastChild);
  }

  /* ============================================================
     PAGE PRINTERS — render each "page" into the terminal scroll
     line-by-line, like an old teletype
     ============================================================ */
  // Honor prefers-reduced-motion: collapse the typewriter delay so page printers
  // render instantly for users who've opted out of motion at the OS level.
  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LINE_DELAY = REDUCED_MOTION ? 0 : 55;  // ms between printed lines
  let printGen = 0;       // incremented on each new printPage; lets in-flight prints finish fast if the user clicks again
  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function slow(html, cls = '', myGen = printGen) {
    out(html, cls);
    if (myGen !== printGen) return;  // a newer print has started — flush instantly
    await _sleep(LINE_DELAY);
  }
  async function slowBlank(myGen = printGen) {
    blank();
    if (myGen !== printGen) return;
    await _sleep(LINE_DELAY);
  }

  // Emit a "<N> flags captured globally" line when the live counter is known.
  // No-op if the /api/stats fetch hasn't resolved yet, or if the API failed
  // (so the line silently doesn't appear in local previews / offline).
  async function slowSolveCount(myGen = printGen) {
    if (typeof _bootSolvesValue !== 'number' || !isFinite(_bootSolvesValue)) return;
    await slow(
      `<span class="term-out-info">${_bootSolvesValue.toLocaleString()}</span> flags captured across all sessions.`,
      'dim', myGen
    );
    await slowBlank(myGen);
  }

  async function printHome() {
    const g = printGen;
    await slow(`<pre class="ascii-art">
 ██████╗██╗   ██╗██████╗ ███████╗██████╗ ███████╗███████╗ ██████╗
██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝
██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝███████╗█████╗  ██║
██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗╚════██║██╔══╝  ██║
╚██████╗   ██║   ██████╔╝███████╗██║  ██║███████║███████╗╚██████╗
 ╚═════╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝
              ${CONFIG.campusName} · Hustlin' Owls
</pre>`, '', g);
    await slow(`<span class="term-out-ok">$</span> Welcome to the ${CONFIG.clubName} Terminal v1.0.0`, '', g);
    await slow(`${CONFIG.campusName} · ${CONFIG.description}`, 'dim', g);
    await slowBlank(g);
    // Solve count omitted here — already shown in the boot animation's [INFO] line.
    // It's still printed on the CTF tab (printCtf) where the context is relevant.
    await slow('Type <span class="term-out-ok">help</span> for commands. Type <span class="term-out-mag">ctf</span> to start solving challenges.', 'dim', g);
    await slow('New here? Type <span class="term-out-ok">about</span> for how to get started.', 'dim', g);
    // Nudge anyone who's solved anything but hasn't joined the leaderboard.
    // Lowered from "all 10" to "1+" since the leaderboard is now rolling —
    // partial-progress entries are valid and update live as you continue.
    if (ctfState.solved.size >= 1 && (!ctfTimer || (!ctfTimer.submittedAs && !ctfTimer.skipped))) {
      await slowBlank(g);
      await slow(`<span class="term-out-mag">★ You've solved ${ctfState.solved.size}/${CHALLENGES.length} challenges.</span> Run <span class="term-out-ok">submit</span> to join the leaderboard — your row updates live as you solve more.`, '', g);
    }
  }

  async function printAbout() {
    const g = printGen;
    await slow('# about.md', 'mag', g);
    await slowBlank(g);
    await slow(`The <span class="term-out-ok">${CONFIG.clubName}</span> is a student-run cybersecurity / hacking / CTF club at ${CONFIG.campusName}. We meet ${CONFIG.meetingDay}s at ${CONFIG.meetingTime} in ${CONFIG.meetingRoom} to break things, learn new tools, and prep for CTF competitions.`, '', g);
    await slowBlank(g);
    await slow('Areas of focus:', 'dim', g);
    await slow('  <span class="term-out-ok">▸</span> Network &amp; web exploitation (nmap, Burp, sqlmap, Metasploit)', '', g);
    await slow('  <span class="term-out-ok">▸</span> Hardware &amp; wireless security (Pwnagotchi, Flipper, Bash Bunny, Alfa cards)', '', g);
    await slow('  <span class="term-out-ok">▸</span> Reverse engineering &amp; binary exploitation (Ghidra, pwntools, ROP)', '', g);
    await slow('  <span class="term-out-ok">▸</span> Defensive ops &amp; SIEM (Splunk, Wazuh, network forensics)', '', g);
    await slow('  <span class="term-out-ok">▸</span> CTF preparation — internal practice + external competitions', '', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">## How to get started</span>', '', g);
    await slowBlank(g);
    await slow("It's two things:", '', g);
    await slow(`  <span class="term-out-warn">1.</span> <a href="${CONFIG.links.signup}" target="_blank" rel="noopener">Sign up on The Roost</a> — that's the only formal step.`, '', g);
    await slow("  <span class=\"term-out-warn\">2.</span> Show up to meetings you can make. We won't take attendance.", '', g);
    await slowBlank(g);
    await slow('Two kinds of meetings:', 'dim', g);
    await slow(`  <span class="term-out-ok">▸</span> <span class="term-out-info">Weekly labs</span> — every ${CONFIG.meetingDay}, ${CONFIG.meetingTime}, ${CONFIG.meetingRoom}. Hands-on practice on whatever we're working on that week.`, '', g);
    await slow(`  <span class="term-out-ok">▸</span> <span class="term-out-info">Term highlights</span> — bigger events at quarter end (CTFs, guest speakers, showcases). See the <a href="#" onclick="switchTab('events');return false;">events page</a> for what's coming up.`, '', g);
    await slowBlank(g);
    await slow("Can't make every Thursday? Come to whatever you can. No prior experience required. Bring a laptop. Curiosity is mandatory. Membership is free.", '', g);
  }

  /* ============================================================
     UPCOMING-MEETING HELPERS — past Thursdays auto-disappear
     ============================================================ */
  const MONTHS_SHORT = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const MONTHS_NICE  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_NUMS = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
  function upcomingThursdays(count) {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = DAY_NUMS[CONFIG.meetingDay] ?? 4;
    const daysUntil = (target - today.getDay() + 7) % 7;
    const first = new Date(today);
    first.setDate(today.getDate() + daysUntil);
    for (let i = 0; i < count; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i * 7);
      out.push(d);
    }
    return out;
  }
  const _DAY_ABBR = (n) => ['SUN','MON','TUE','WED','THU','FRI','SAT'][n];
  const _Day      = (n) => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][n];
  function fmtEventCard(d) { return `${_DAY_ABBR(d.getDay())} ${MONTHS_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2)}`; }
  function fmtNextMeeting(d) { return `${_Day(d.getDay())} ${MONTHS_NICE[d.getMonth()]} ${d.getDate()} · ${CONFIG.meetingTime}`; }

  // Format a Date as ISO `YYYY-MM-DD` for matching against CONFIG.specialEvents
  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  async function printEvents() {
    const g = printGen;
    await slow(`# events.json — every ${CONFIG.meetingDay} at ${CONFIG.meetingTime}, ${CONFIG.meetingRoom}`, 'mag', g);
    await slowBlank(g);
    for (const d of upcomingThursdays(5)) {
      const special = (CONFIG.specialEvents || []).find(e => e.date === isoDate(d));
      const title      = special ? special.title : 'Weekly meeting';
      const titleClass = special ? 'mag'         : 'info';
      const detail     = (special && special.detail) || `${CONFIG.meetingTime} · ${CONFIG.meetingRoom}`;
      await slow(`  <span class="term-out-warn">${fmtEventCard(d)}</span>  <span class="term-out-${titleClass}">${title}</span>  <span class="term-out-dim">· ${detail}</span>`, '', g);
    }
  }

  async function printContact() {
    const g = printGen;
    await slow('# contact.sh', 'mag', g);
    await slowBlank(g);
    await slow('Reach out — for joining, questions, or anything else.', '', g);
    await slowBlank(g);
    await slow(`  <span class="term-out-dim">sign up    :</span> <a href="${CONFIG.links.signup}" target="_blank">${_u(CONFIG.links.signup)}</a>`, '', g);
    await slow(`  <span class="term-out-dim">the roost  :</span> <a href="${CONFIG.links.roost}" target="_blank">club page</a>`, '', g);
    await slow(`  <span class="term-out-dim">discord    :</span> <a href="${CONFIG.links.discord}" target="_blank">${_u(CONFIG.links.discord)}</a>`, '', g);
    await slow(`  <span class="term-out-dim">advisor    :</span> ${CONFIG.advisor.name}`, '', g);
    await slowBlank(g);
    await slow('# officers.list', 'mag', g);
    const padW = Math.max(...CONFIG.officers.map(o => o.role.length));
    for (const o of CONFIG.officers) {
      await slow(`  <span class="term-out-dim">${o.role.toLowerCase().padEnd(padW)}:</span> ${o.name}`, '', g);
    }
  }

  async function printFaq() {
    const g = printGen;
    await slow('# faq.md', 'mag', g);
    await slowBlank(g);
    await slow('Common questions, kept short. The terminal <span class="term-out-ok">help</span> command is the strict reference.', 'dim', g);
    await slowBlank(g);

    // --- About the club ---
    await slow('<span class="term-out-warn">## About the club</span>', '', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> Do I need experience?', '', g);
    await slow('<span class="term-out-info">A:</span> No. Bring curiosity. We start from wherever you are.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> Do I need to be a CS major?', '', g);
    await slow('<span class="term-out-info">A:</span> No — open to anyone interested in security.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> How do I join?', '', g);
    await slow(`<span class="term-out-info">A:</span> <a href="${CONFIG.links.signup}" target="_blank" rel="noopener">Sign up on The Roost</a> and show up to whatever meetings you can.`, 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> What if I can\'t make every meeting?', '', g);
    await slow('<span class="term-out-info">A:</span> Come to what you can. We don\'t take attendance.', 'dim', g);
    await slowBlank(g);

    // --- About the CTF ---
    await slow('<span class="term-out-warn">## About the CTF</span>', '', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> What is a CTF?', '', g);
    await slow('<span class="term-out-info">A:</span> Capture The Flag. Solve security puzzles, capture flag strings (<span class="term-out-mag">flag{...}</span>), score points.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> How do I play this site\'s CTF?', '', g);
    await slow('<span class="term-out-info">A:</span> Run <span class="term-out-ok">ctf list</span> for the 10 challenges, <span class="term-out-ok">ctf start &lt;n&gt;</span> to open one, <span class="term-out-ok">flag &lt;text&gt;</span> to submit.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> I\'m stuck.', '', g);
    await slow(`<span class="term-out-info">A:</span> Run <span class="term-out-ok">hint &lt;n&gt;</span> for a nudge. Or ask in <a href="${CONFIG.links.discord}" target="_blank" rel="noopener">Discord</a> — no shame.`, 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> Can I try again for a better score?', '', g);
    await slow('<span class="term-out-info">A:</span> Yes. <span class="term-out-ok">ctf retry</span> clears your solves but keeps your leaderboard name — the new run only replaces your entry if it beats your old score.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> How does the leaderboard rank?', '', g);
    await slow('<span class="term-out-info">A:</span> Points first (more = higher). Ties broken by faster time. Updates live as you solve.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> When does the leaderboard reset?', '', g);
    await slow('<span class="term-out-info">A:</span> "This term" resets at the start of each OIT quarter (auto). "All time" never resets.', 'dim', g);
    await slowBlank(g);

    // --- About the site ---
    await slow('<span class="term-out-warn">## About the site</span>', '', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> How do I use this thing?', '', g);
    await slow('<span class="term-out-info">A:</span> Type commands at the prompt. <span class="term-out-ok">help</span> lists them. Tab completes. ↑/↓ scrolls history. Ctrl+L clears.', 'dim', g);
    await slowBlank(g);
    await slow('<span class="term-out-mag">Q:</span> Found a bug?', '', g);
    await slow(`<span class="term-out-info">A:</span> Drop it in <a href="${CONFIG.links.discord}" target="_blank" rel="noopener">Discord</a>, or email any officer (see <a href="#" onclick="switchTab('contact');return false;">contact.sh</a>).`, 'dim', g);
  }

  async function printLab() {
    const g = printGen;
    await slow('# lab.sh — members-only practice environment', 'mag', g);
    await slowBlank(g);
    await slow('Live isolated CTF lab for hands-on practice. All access is gated by Cloudflare Access — your email must be on the lab allowlist before any of the URLs below will work.', 'dim', g);
    await slowBlank(g);

    // --- Services ---
    await slow('<span class="term-out-warn">## Services</span>', '', g);
    await slowBlank(g);
    await slow('  <span class="term-out-ok">[+]</span> <span class="term-out-info">CTFd</span>                <a href="https://ctf.oitcybersec.org" target="_blank" rel="noopener">ctf.oitcybersec.org</a>      <span class="term-out-dim">— CTF challenges + flags</span>', '', g);
    await slow('  <span class="term-out-ok">[+]</span> <span class="term-out-info">Kali</span> <span class="term-out-dim">(Browser SSH)</span>  <a href="https://kali.oitcybersec.org" target="_blank" rel="noopener">kali.oitcybersec.org</a>     <span class="term-out-dim">— attack platform, terminal in browser</span>', '', g);
    await slow('  <span class="term-out-ok">[+]</span> <span class="term-out-info">Proxmox</span>             <a href="https://proxmox.oitcybersec.org" target="_blank" rel="noopener">proxmox.oitcybersec.org</a>  <span class="term-out-dim">— VM management (officers + advanced)</span>', '', g);
    await slowBlank(g);

    // --- How to get access ---
    await slow('<span class="term-out-warn">## How to get access</span>', '', g);
    await slowBlank(g);
    await slow(`  <span class="term-out-mag">1.</span> Ask an officer to add your email to the lab allowlist <span class="term-out-dim">(see <a href="#" onclick="switchTab('contact');return false;">contact.sh</a>)</span>`, '', g);
    await slow('  <span class="term-out-mag">2.</span> Visit any of the URLs above', '', g);
    await slow('  <span class="term-out-mag">3.</span> Enter your email — Cloudflare sends a 6-digit one-time code', '', g);
    await slow('  <span class="term-out-mag">4.</span> Submit the code — you\'re in', '', g);
    await slowBlank(g);

    // --- What's in the lab ---
    await slow('<span class="term-out-warn">## What\'s in the lab</span>', '', g);
    await slowBlank(g);
    await slow('  <span class="term-out-info">DC01</span>      Windows Server 2019 — Active Directory domain controller', '', g);
    await slow('  <span class="term-out-info">Win11</span>     domain-joined workstation', '', g);
    await slow('  <span class="term-out-info">Kali</span>      your attack platform', '', g);
    await slow('  <span class="term-out-info">Wazuh</span>     blue-team SIEM — log analysis, detection rules', '', g);
    await slowBlank(g);
    await slow('Several AD attack paths are baked into the domain. Find them with BloodHound, Rubeus, impacket — whatever your tool of choice is.', 'dim', g);
    await slowBlank(g);

    // --- Etiquette ---
    await slow('<span class="term-out-warn">## Lab etiquette</span>', '', g);
    await slowBlank(g);
    await slow('  • Don\'t attempt to escape the lab subnet — it\'s isolated for a reason', '', g);
    await slow('  • Shared environment — restore a VM snapshot if you break something material', '', g);
    await slow(`  • Help each other out in <a href="${CONFIG.links.discord}" target="_blank" rel="noopener">Discord</a> #ctf channel; brag when you root the DC`, '', g);
  }

  // Render a single leaderboard row inline. Shared between top-10 render and
  // the "below top 10" neighbor render so formatting stays in lockstep.
  // - rank is 1-indexed display position.
  // - highlightUsername (if matched) adds a "← you" suffix and swaps username
  //   color to warn (orange) so the player can spot themselves.
  // - Solve count shows "?" instead of "0" for legacy entries missing `n`
  //   (the worker backfills full-completion entries but can't reverse-engineer
  //   partial-progress legacy data).
  async function _renderBoardRow(e, rank, highlightUsername, total, myGen) {
    const isMe = highlightUsername && e.u === highlightUsername;
    const rankStr = String(rank).padStart(2, ' ');
    const name = String(e.u || '').padEnd(20, ' ');
    const solveCount = (typeof e.n === 'number') ? e.n : '?';
    const solved = `${solveCount}/${total}`.padStart(5, ' ');
    const pts  = String(e.p || 0).padStart(4, ' ');
    const time = formatElapsed(e.t || 0);
    const nameClass = isMe ? 'term-out-warn' : 'term-out-info';
    const suffix = isMe ? ' <span class="term-out-warn">← you</span>' : '';
    await slow(`  <span class="term-out-warn">#${rankStr}</span>  <span class="${nameClass}">${escapeHtml(name)}</span>  <span class="term-out-mag">${solved}</span>  ${pts}pts  <span class="term-out-dim">${time}</span>${suffix}`, '', myGen);
  }

  // Render a single board (current OR all-time) inline via slow().
  // Shows top 10 always; if the highlighted player is below #10, adds a
  // separator line ("⋮") and renders the player's row plus one row above
  // and one below for context — so they see exactly who's nearby.
  async function _slowRenderBoard(title, list, myGen, highlightUsername) {
    await slow(title, 'mag', myGen);
    if (!list || !list.length) {
      await slow('  <span class="term-out-dim">(no entries yet — be the first!)</span>', '', myGen);
      return;
    }
    const total = CHALLENGES.length;
    const top10Count = Math.min(10, list.length);

    // Top 10
    for (let i = 0; i < top10Count; i++) {
      await _renderBoardRow(list[i], i + 1, highlightUsername, total, myGen);
    }

    // If the player is below the visible top 10, drop a separator and render
    // one row above (if not already shown), the player's row, and one below.
    const myIdx = highlightUsername ? list.findIndex(e => e.u === highlightUsername) : -1;
    if (myIdx >= 10) {
      await slow('  <span class="term-out-dim">           ⋮</span>', '', myGen);
      for (let i = myIdx - 1; i <= myIdx + 1; i++) {
        if (i >= 10 && i < list.length) {
          await _renderBoardRow(list[i], i + 1, highlightUsername, total, myGen);
        }
      }
    }
  }

  async function printLeaderboard() {
    const g = printGen;
    await slow('# ranks.json — global CTF leaderboard', 'mag', g);
    await slowBlank(g);
    await slow('Top 10 players ranked by <span class="term-out-mag">points earned</span> (ties broken by faster time). Updates live as players solve.', '', g);
    await slow('Run <span class="term-out-ok">submit &lt;username&gt;</span> after your first solve to join — your row climbs as you capture more flags.', 'dim', g);
    await slow('The "this term" board resets each quarter; "all time" is the permanent record.', 'dim', g);
    await slowBlank(g);
    let d;
    try {
      const r = await fetch('/api/leaderboard');
      if (!r.ok) throw new Error(r.status);
      d = await r.json();
    } catch (_) {
      await slow('<span class="term-out-err">leaderboard unreachable</span> <span class="term-out-dim">(offline / local preview)</span>', '', g);
      return;
    }
    const me = (ctfTimer && ctfTimer.submittedAs) || null;
    // Each board's render handles its own "you" highlight + below-top-10
    // neighbor rows. The standalone "Your standing as of last solve" line
    // is gone — replaced by the contextual rows, which are strictly more
    // informative (you see who's near you, not just an abstract number).
    await _slowRenderBoard('── THIS TERM ──', d && d.current, g, me);
    await slowBlank(g);
    await _slowRenderBoard('── ALL TIME ──', d && d.alltime, g, me);
  }

  async function printPage(name) {
    printGen++;  // any in-flight print sees a stale gen and flushes instantly
    const printers = { home: printHome, about: printAbout, events: printEvents, contact: printContact, lab: printLab, faq: printFaq, leaderboard: printLeaderboard };
    const fn = printers[name];
    if (!fn) return;
    // Scroll to bottom first so the typewriter effect happens in view
    term.scrollTop = term.scrollHeight;
    await fn();
  }

  /* ============================================================
     COMMANDS
     ============================================================ */
  const COMMANDS = {
    help: { desc:'List commands. Run `help <name>` for details on one.', run: (a) => {
      const target = (a[0] || '').toLowerCase();
      // ---- Detail view for a specific command ----
      if (target) {
        const cmd = COMMANDS[target];
        if (!cmd) {
          out(`no help: "${escapeHtml(target)}" is not a command. Try \`help\` for the list.`, 'err');
          return;
        }
        out(`<span class="term-out-warn">━━ ${target} ━━</span>`);
        out(cmd.desc);
        if (cmd.usage) {
          blank();
          out('<span class="term-out-warn">USAGE</span>');
          out('  ' + cmd.usage);
        }
        if (cmd.examples && cmd.examples.length) {
          blank();
          out('<span class="term-out-warn">EXAMPLES</span>');
          cmd.examples.forEach(e => out('  <span class="term-out-info">' + e + '</span>'));
        }
        if (cmd.notes) {
          blank();
          out('<span class="term-out-warn">NOTES</span>');
          cmd.notes.split('\n').forEach(l => out('  ' + l, 'dim'));
        }
        return;
      }
      // ---- Full categorized list ----
      const cats = {
        'Pages':     ['home','about','events','contact','faq','leaderboard'],
        'Network':   ['nmap','ping','dig','whois','traceroute','ifconfig','netstat','curl','ssh','login','token','jwt-decode','whoami-jwt'],
        'Filesystem':['ls','cat','tree','df','pwd'],
        'System':    ['whoami','uname','date','uptime','history','echo','neofetch'],
        'Tools':     ['base64','rot13','hash','python','py','fortune','cowsay','banner'],
        'Club':      ['join','roster','next','discord','roost','signup'],
        'CTF':       ['ctf','flag','hint','score','submit','leaderboard'],
        'Misc':      ['matrix','sudo','vim','emacs','rm','clear','exit','help','h'],
      };
      const seen = new Set();
      Object.entries(cats).forEach(([cat, cmds]) => {
        out(`<span class="term-out-warn">── ${cat} ──</span>`);
        cmds.forEach(n => {
          if (COMMANDS[n] && !seen.has(n)) {
            seen.add(n);
            out(`  <span class="term-out-info">${n.padEnd(12)}</span><span class="term-out-dim">${COMMANDS[n].desc}</span>`);
          }
        });
        blank();
      });
      // surface anything not categorized
      const missing = Object.keys(COMMANDS).filter(n => !seen.has(n));
      if (missing.length) {
        out(`<span class="term-out-warn">── Other ──</span>`);
        missing.forEach(n => out(`  <span class="term-out-info">${n.padEnd(12)}</span><span class="term-out-dim">${COMMANDS[n].desc}</span>`));
        blank();
      }
      out('Run <span class="term-out-info">help &lt;name&gt;</span> for usage + examples on any command.', 'dim');
      out('Tips: ↑/↓ history · Tab complete · Ctrl+L clear · Ctrl+C abort', 'dim');
    }},

    about:   { desc:'Show the about page',    run: () => switchTab('about') },
    events:  { desc:'Show upcoming events',   run: () => switchTab('events') },
    contact: { desc:'Show contact info',      run: () => switchTab('contact') },
    faq:     { desc:'Show frequently asked questions', run: () => switchTab('faq') },
    home:    { desc:'Go to the home page',    run: () => switchTab('home') },

    join:    { desc:'How to join the club', run: () => {
      out('Three steps to join:', 'ok');
      out(`  1. Sign up on The Roost: <a href="${CONFIG.links.signup}" target="_blank">${_u(CONFIG.links.signup)}</a>`);
      out(`  2. Show up to a meeting (see <span class="term-out-info">events</span>) — ${CONFIG.meetingDay}s at ${CONFIG.meetingTime}`);
      out(`  3. Hop in our Discord: <a href="${CONFIG.links.discord}" target="_blank">${_u(CONFIG.links.discord)}</a>`);
      blank();
      out('No experience required.', 'dim');
    }},

    ls: { desc:'List "files" in this directory', run: () => {
      out('<span class="term-out-info">about.md</span>      <span class="term-out-info">events.json</span>     <span class="term-out-info">contact.sh</span>');
      out('<span class="term-out-info">faq.md</span>        <span class="term-out-info">ranks.json</span>     <span class="term-out-info">officers.list</span>');
      out('<span class="term-out-info">README</span>');
    }},

    cat: { desc:'Show contents of a "file"', run: (a) => {
      const f = (a[0]||'').toLowerCase();
      const fs = {
        'readme':()=>switchTab('home'), 'about.md':()=>switchTab('about'),
        'events.json':()=>switchTab('events'), 'contact.sh':()=>switchTab('contact'),
        'faq.md':()=>switchTab('faq'),
        'ranks.json':()=>switchTab('leaderboard'),
        'motto.txt':()=>out('"hack the planet — responsibly."', 'mag'),
        'officers.list':()=>switchTab('contact')
      };
      if (!f) return out('usage: cat <file>   (try: cat README)', 'err');
      if (fs[f]) return fs[f]();
      out('cat: '+escapeHtml(f)+': No such file or directory', 'err');
    }},

    whoami: { desc:'Print current user',     run: () => out('hacker', 'ok') },
    pwd:    { desc:'Print working directory', run: () => out('/home/hacker'+termPath.textContent.replace('~',''), 'ok') },
    date:   { desc:'Show current date',       run: () => out(new Date().toString(), 'ok') },
    uname:  { desc:'Print system info',       run: () => out('Linux club-host 6.9.0-club #1 SMP x86_64 GNU/Linux', 'ok') },
    echo:   { desc:'Echo arguments',          run: (a) => out(escapeHtml(a.join(' '))) },

    sudo:   { desc:'Become root (you wish)',  run: () => {
      out('[sudo] password for hacker:', 'dim');
      setTimeout(() => out('Sorry, user hacker is not in the sudoers file. This incident will be reported.', 'err'), 600);
    }},

    matrix: { desc:'Wake up, Neo...', run: () => {
      const c = '01アイウエオカキクケコｱｲｳｴｵｶｷｸｹｺ';
      for (let i = 0; i < 6; i++) {
        let line = '';
        for (let j = 0; j < 60; j++) line += c[Math.floor(Math.random()*c.length)];
        out('<span class="term-out-ok">'+line+'</span>');
      }
    }},

    clear:  { desc:'Clear the terminal',     run: () => { termOutput.innerHTML=''; }},
    exit:   { desc:'Exit (just kidding)',    run: () => out("nope, you're stuck here. try 'help'", 'warn') },

    /* ============================================================
       CTF COMMANDS
       ============================================================ */
    ctf: { desc:'CTF challenge mode',
      usage: 'ctf [list|start <n>|retry|reset]',
      examples: ['ctf list', 'ctf start 3', 'ctf retry', 'ctf reset'],
      notes: 'Progress saves to localStorage so it survives reloads.\n\n`ctf retry` wipes progress for a fresh attempt but keeps your leaderboard username — your entry only updates if the new run beats your old score.\n`ctf reset` is the nuclear option: wipes everything including your leaderboard registration.',
      run: (a) => {
      const sub = (a[0] || 'list').toLowerCase();
      if (sub === 'list' || sub === 'ls') {
        out('CTF CHALLENGES', 'mag');
        out('──────────────', 'dim');
        CHALLENGES.forEach(ch => {
          const mark = ctfState.solved.has(ch.id) ? '<span class="term-out-ok">[✓]</span>' : '<span class="term-out-dim">[ ]</span>';
          out(`${mark}  <span class="term-out-info">#${ch.id}</span> <span style="color:var(--magenta)">${ch.name.padEnd(16)}</span><span class="term-out-dim">${ch.points}pts</span>`);
        });
        blank();
        out(`Total: ${ctfState.solved.size}/${CHALLENGES.length} solved · ${ctfState.points} points`, 'mag');
        out('Run `ctf start <n>` for details. Submit with `flag <text>`.', 'dim');
        return;
      }
      if (sub === 'start' || sub === 'open') {
        const n = parseInt(a[1], 10);
        const ch = CHALLENGES.find(c => c.id === n);
        if (!ch) return out('usage: ctf start <number>   (1-'+CHALLENGES.length+')', 'err');
        ctfState.activeChallenge = ch.id;
        // Start the leaderboard timer the first time the player engages.
        startTimerIfFirstRun();
        out(`── Challenge #${ch.id}: ${ch.name} (${ch.points}pts) ──`, 'mag');
        out(ch.brief);
        blank();
        out(`Submit with: flag &lt;value&gt;   (the flag{} wrapper is optional)`, 'dim');
        out(`Stuck? hint ${ch.id}`, 'dim');
        return;
      }
      if (sub === 'reset') {
        ctfState.solved.clear();
        ctfState.points = 0;
        ctfState.activeChallenge = null;
        saveCtfState();
        updateScoreUI();
        // Clear the leaderboard timer too — the next ctf start kicks off a fresh run.
        ctfTimer = null;
        try { localStorage.removeItem(CTF_TIMER_KEY); } catch (_) {}
        out('CTF progress cleared.', 'warn');
        return;
      }
      if (sub === 'retry') {
        // Retry = wipe progress for a fresh attempt, but KEEP the player's
        // leaderboard username (and skipped flag) so their entry can be
        // beaten by the new run. insertOrUpgrade on the server side keeps
        // the better entry, so a slower retry simply doesn't replace the
        // old record.
        ctfState.solved.clear();
        ctfState.points = 0;
        ctfState.activeChallenge = null;
        saveCtfState();
        updateScoreUI();
        // Reset the clock without clearing username/skipped/lastRank*.
        if (ctfTimer) {
          delete ctfTimer.startedAt;
          delete ctfTimer.completedAt;
          saveTimer();
        }
        out('Cleared progress for a fresh attempt. Solve again to beat your best time.', 'ok');
        if (ctfTimer && ctfTimer.submittedAs) {
          out(`Your leaderboard entry stays as <span class="term-out-info">${escapeHtml(ctfTimer.submittedAs)}</span> — it'll only update if the new run beats your current best.`, 'dim');
        }
        return;
      }
      out('usage: ctf list  |  ctf start <n>  |  ctf retry  |  ctf reset', 'err');
    }},

    flag: { desc:'Submit a CTF flag (the surrounding flag{} is optional)',
      usage: 'flag <value>',
      examples: ['flag flag{example}', 'flag {example}', 'flag example', 'flag{example}'],
      notes: 'All four formats above are equivalent. The leading `flag` command is even optional — typing `flag{...}` or `{...}` on its own works too.',
      run: (a) => {
      let submission = a.join(' ').trim();
      if (!submission) return out('usage: flag <value>   (you can include flag{...} or just the inside)', 'err');
      // Normalize: accept "flag{x}", "{x}", or bare "x" — wrap into flag{x}
      if (!/^flag\{.*\}$/i.test(submission)) {
        if (/^\{.*\}$/.test(submission)) submission = submission.slice(1, -1);
        submission = `flag{${submission}}`;
      }
      const h = fnv1a(submission);
      const match = CHALLENGES.find(c => c.hash === h);
      if (!match) {
        out('✗ incorrect flag', 'err');
        return;
      }
      if (ctfState.solved.has(match.id)) {
        out(`✓ already solved: #${match.id} ${match.name}`, 'warn');
        return;
      }
      ctfState.solved.add(match.id);
      ctfState.points += match.points;
      saveCtfState();
      // Ensure the leaderboard timer is running (covers solving without
      // ever calling `ctf start` — e.g., typing the recon flag directly).
      startTimerIfFirstRun();
      addActivity('ok', `flag captured: <span class="term-out-mag">#${match.id} ${match.name}</span> +${match.points}pts`);
      out(`✓ CORRECT! Challenge #${match.id} (${match.name}) — +${match.points}pts`, 'ok');
      updateScoreUI();
      // Best-effort: tell the global counter on the Worker. Server re-hashes
      // and verifies before incrementing, so this can't be used to inflate.
      // Fire-and-forget — failure (e.g. local-only preview, no network) is fine.
      fetch('/api/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag: submission }),
      }).then(r => r.ok ? r.json() : null).then(d => {
        if (d && typeof d.total === 'number') updateBootSolves(d.total);
      }).catch(() => {});
      // ROLLING LEADERBOARD —
      // 1) On the FIRST solve, prompt for a username. Subsequent solves
      //    auto-submit updated progress so the player's row climbs live.
      // 2) On every subsequent solve, if they have a username, fire an
      //    auto-submit (fire-and-forget) so the board stays current.
      // 3) On the 10th solve, lock the timer and celebrate. autoSubmitProgress
      //    sends the final state with the locked time.
      const isFirstSolve = (ctfState.solved.size === 1);
      const isCompletion = (ctfState.solved.size === CHALLENGES.length);

      if (isCompletion) {
        stopTimerOnCompletion();
        const totalTime = formatElapsed(elapsedMs());
        blank();
        out('  ╔══════════════════════════════════════════╗', 'mag');
        out('  ║  ALL CHALLENGES SOLVED — nice work, hacker. ║', 'mag');
        out('  ╚══════════════════════════════════════════╝', 'mag');
        out(`  Total time: <span class="term-out-info">${totalTime}</span>`, '');
        blank();
      }

      if (isFirstSolve && (!ctfTimer || !ctfTimer.submittedAs) && !(ctfTimer && ctfTimer.skipped)) {
        // First solve — prompt for a leaderboard username. Their entry will
        // update live as they continue solving (one row per username, latest
        // / best state wins).
        out('<span class="term-out-mag">First solve!</span> Add yourself to the <span class="term-out-mag">leaderboard</span> so your row updates live as you climb.', '');
        out('Type a username (3-20 chars, A-Z 0-9 - _) on the next line, or `skip` to play privately.', 'dim');
        submitPromptMode = true;
      } else if (ctfTimer && ctfTimer.submittedAs) {
        // Already on the leaderboard — fire an updated entry in the background.
        autoSubmitProgress();
        if (isCompletion) {
          out(`Final entry submitted as <span class="term-out-info">${escapeHtml(ctfTimer.submittedAs)}</span>. Run \`leaderboard\` to see standings.`, 'dim');
        }
      } else if (isCompletion && ctfTimer && ctfTimer.skipped) {
        // They skipped the first-solve prompt but completed everything anyway.
        // Offer one more chance to register.
        out('You skipped the leaderboard at first solve. Want to submit your final time now? Run <span class="term-out-ok">submit</span>.', 'dim');
      }
    }},

    score: { desc:'Show CTF progress', run: () => {
      out(`${ctfState.solved.size}/${CHALLENGES.length} challenges solved · ${ctfState.points} points`, 'mag');
      CHALLENGES.forEach(ch => {
        const m = ctfState.solved.has(ch.id) ? '<span class="term-out-ok">[✓]</span>' : '<span class="term-out-dim">[ ]</span>';
        out(`  ${m} #${ch.id} ${ch.name}`);
      });
      if (ctfTimer && ctfTimer.startedAt) {
        out(`Time elapsed: ${formatElapsed(elapsedMs())}${ctfTimer.completedAt ? ' (final)' : ' (running)'}`, 'dim');
      }
    }},

    submit: { desc:'Join the leaderboard (any time after your first solve)',
      usage: 'submit [username]',
      examples: ['submit', 'submit AlphaHacker', 'submit scott_r'],
      notes: 'Username: 3-20 chars, A-Z / 0-9 / hyphen / underscore.\nWith no argument, drops into prompt mode — type the username on the next line.\nRolling leaderboard: each subsequent solve updates your row live (more points / faster time wins).\nSilently no-ops if the API is unreachable (offline / local preview).',
      run: async (a) => {
      const username = (a[0] || '').trim();
      // Rolling-leaderboard semantics: at least one solve is required, but
      // you don't need to be complete. Your entry updates live as you go.
      if (ctfState.solved.size < 1) {
        return out('solve at least one challenge first', 'err');
      }
      // No arg → enter prompt mode so the next typed line is captured as
      // the username. Same prompt the page fires on the first solve, but
      // user-invokable any time (e.g., they skipped earlier and changed
      // their mind, or are running through a fresh session).
      if (!username) {
        out('Type a username (3-20 chars, A-Z 0-9 - _) on the next line, or `skip` to opt out.', 'dim');
        submitPromptMode = true;
        return;
      }
      if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) {
        return out('username must be 3-20 chars, A-Z / 0-9 / hyphen / underscore', 'err');
      }
      // Make sure the timer is running (covers the case of registering at
      // partial progress without having run `ctf start`). We don't lock
      // completedAt here — only the 10/10 celebration branch does that.
      startTimerIfFirstRun();
      const elapsed = elapsedMs();
      const solvedIds = Array.from(ctfState.solved).sort((a, b) => a - b);
      out(`submitting <span class="term-out-info">${escapeHtml(username)}</span> (${formatElapsed(elapsed)})...`, 'dim');
      try {
        const r = await fetch('/api/submit-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, solvedIds, elapsedMs: elapsed }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok) {
          return out(`✗ ${escapeHtml(d && d.error ? d.error : 'submission failed (' + r.status + ')')}`, 'err');
        }
        ctfTimer.submittedAs = username;
        ctfTimer.lastRankCurrent = d.rankCurrent;
        ctfTimer.lastRankAllTime = d.rankAllTime;
        saveTimer();
        out(`✓ submitted as <span class="term-out-mag">${escapeHtml(username)}</span>`, 'ok');
        out(`  this term: rank <span class="term-out-warn">#${d.rankCurrent}</span>${d.rankAllTime ? ` · all-time: <span class="term-out-warn">#${d.rankAllTime}</span>` : ''}`, '');
        out(`Run \`leaderboard\` to see the full standings.`, 'dim');
      } catch (e) {
        out(`✗ submission failed (network unreachable?)`, 'err');
      }
    }},

    leaderboard: { desc:'Show the CTF leaderboard (top 10 each: this term + all-time)', run: () => switchTab('leaderboard') },

    hint: { desc:'Show a CTF challenge hint',
      usage: 'hint [n|name]',
      examples: ['hint 3', 'hint base64', 'hint nmap_recon', 'hint'],
      notes: 'With no argument, shows the hint for the currently active challenge (the last `ctf start <n>`).',
      run: (a) => {
      const arg = (a[0] || '').toLowerCase();
      let ch = null;
      if (arg) {
        const n = parseInt(arg, 10);
        if (!isNaN(n)) ch = CHALLENGES.find(c => c.id === n);
        else ch = CHALLENGES.find(c => c.name.toLowerCase() === arg);
      } else if (ctfState.activeChallenge) {
        ch = CHALLENGES.find(c => c.id === ctfState.activeChallenge);
      }
      if (!ch) {
        out('No challenge matched. Run `ctf start <n>` first, or use `hint <n>` / `hint <name>`.', 'err');
        out('Available challenges:', 'dim');
        CHALLENGES.forEach(c => out(`  <span class="term-out-info">#${c.id}</span> <span class="term-out-mag">${c.name}</span>`));
        return;
      }
      out(`hint #${ch.id} (${ch.name}):`, 'warn');
      out('  '+ch.hint);
    }},

    /* ============================================================
       PYTHON — real Python via Pyodide (loads on first use)
       Type `python` with no args to enter interactive REPL mode.
       ============================================================ */
    python: { desc:'Real Python REPL — `python` for interactive mode, or `python <expr>` for one-shot',
      usage: 'python [expression]',
      examples: ['python', 'python 2 + 2', "python import base64; print(base64.b64decode('aGk=').decode())", 'python [x*x for x in range(5)]'],
      notes: 'No args drops you into an interactive >>> REPL. Type exit() or Ctrl+C to leave.\nFirst use downloads ~10MB Pyodide WASM (cached after).',
      run: async (a) => {
      const expr = a.join(' ').trim();
      try {
        await ensurePyodide(msg => out('  '+msg, 'dim'));
        if (!expr) {
          // Enter interactive REPL mode
          pythonMode = true;
          updatePromptUI();
          out('Python 3.11 (Pyodide on WebAssembly)', 'ok');
          out('Type any Python — every line is sent to the interpreter.', 'dim');
          out('Use <span class="term-out-info">exit()</span> or <span class="term-out-info">quit()</span> to return to bash.', 'dim');
          addActivity('ok', 'entered <span class="term-out-info">python REPL</span>');
          return;
        }
        // One-shot: run via the same evaluator as REPL mode
        await runPythonLine(expr);
      } catch (err) {
        out(escapeHtml(String(err.message || err)), 'err');
      }
    }},

    py: { desc:'Alias for python', run: (a) => COMMANDS.python.run(a) },

    /* ============================================================
       NETWORK / SECURITY (all simulated — no real packets leave the page)
       ============================================================ */
    nmap: { desc:'Port-scan a host (simulated)',
      usage: 'nmap <host>',
      examples: ['nmap localhost', 'nmap oit.edu', 'nmap 10.50.0.1'],
      notes: 'Output is simulated — no packets actually leave your browser.\nScanning the local IP turns up something interesting (CTF #8).',
      run: async (a) => {
      const target = a[0] || 'localhost';
      const safeT = escapeHtml(target);
      const ts = new Date().toISOString().slice(0,19).replace('T',' ');
      out(`Starting Nmap 7.94 ( https://nmap.org ) at ${ts}`, 'dim');
      await new Promise(r => setTimeout(r, 250));
      out(`Nmap scan report for <span class="term-out-info">${safeT}</span>`);
      out(`Host is up (0.0023s latency).`, 'dim');
      blank();
      out(`PORT      STATE     SERVICE         VERSION`, 'warn');
      const ports = [
        ['22/tcp',   'open',     'ssh',          'OpenSSH 9.3'],
        ['80/tcp',   'open',     'http',         'nginx 1.24.0'],
        ['443/tcp',  'open',     'https',        'nginx 1.24.0 (TLS 1.3)'],
        ['3306/tcp', 'filtered', 'mysql',        '?'],
        ['8080/tcp', 'closed',   'http-proxy',   '?'],
        ['9000/tcp', 'open',     'cslistener',   'unknown'],
      ];
      for (const [port, state, svc, ver] of ports) {
        await new Promise(r => setTimeout(r, 220));
        const cls = state === 'open' ? 'ok' : state === 'filtered' ? 'warn' : 'dim';
        out(`${port.padEnd(10)}<span class="term-out-${cls}">${state.padEnd(10)}</span>${svc.padEnd(16)}${ver}`);
      }
      // CTF #8: leak a flag in a service banner only when the player scans
      // the exact IP surfaced by `ifconfig` (10.50.0.1). Bare `nmap` and
      // `nmap localhost` / `nmap 127.0.0.1` deliberately do NOT leak.
      // The banner is base64-encoded so the literal `flag{...}` string
      // never appears in page source — defeats casual `Ctrl+F flag{`.
      if (target === '10.50.0.1') {
        await new Promise(r => setTimeout(r, 280));
        const _banner = atob('ZmxhZ3tubWFwX2ZpbmRzX3doYXRfZXllc19taXNzfQ==');
        out(`1337/tcp  <span class="term-out-ok">open</span>      ctf-banner      <span class="term-out-mag">Banner: ${escapeHtml(_banner)}</span>`);
        out(`|_ctf-banner: service is leaking debug data — submit the banner with \`flag &lt;text&gt;\``, 'dim');
      }
      blank();
      out(`Nmap done: 1 IP address (1 host up) scanned in 1.87 seconds`, 'dim');
    }},

    ping: { desc:'Send ICMP echo requests (simulated)',
      usage: 'ping <host>',
      examples: ['ping localhost', 'ping oit.edu'],
      run: async (a) => {
      const t = escapeHtml(a[0] || 'localhost');
      out(`PING ${t} (10.50.0.1) 56(84) bytes of data.`);
      let received = 0;
      for (let i = 0; i < 4; i++) {
        await new Promise(r => setTimeout(r, 350));
        const time = (Math.random() * 5 + 0.4).toFixed(2);
        out(`64 bytes from ${t}: icmp_seq=${i+1} ttl=64 time=${time} ms`);
        received++;
      }
      blank();
      out(`--- ${t} ping statistics ---`);
      out(`4 packets transmitted, ${received} received, 0% packet loss, time 1612ms`);
    }},

    dig: { desc:'DNS lookup (simulated)',
      usage: 'dig <domain>',
      examples: ['dig oit.edu', 'dig example.com'],
      run: (a) => {
      const t = escapeHtml(a[0] || 'oit.edu');
      out(`; <<>> DiG 9.18 <<>> ${t}`, 'dim');
      blank();
      out(`;; ANSWER SECTION:`, 'warn');
      out(`${t}.\t300\tIN\tA\t199.46.115.21`);
      out(`${t}.\t300\tIN\tAAAA\t2607:f8b0:400a::200e`);
      blank();
      out(`;; Query time: 23 msec`, 'dim');
      out(`;; SERVER: 1.1.1.1#53(1.1.1.1)`, 'dim');
    }},

    whois: { desc:'Domain registration lookup (simulated)', run: (a) => {
      const t = (a[0] || 'oit.edu').toUpperCase();
      out(`Domain Name: ${escapeHtml(t)}`);
      out(`Registry: EDUCAUSE`);
      out(`Registrant: Oregon Institute of Technology`);
      out(`Registration Date: 1989-04-11`);
      out(`Status: clientTransferProhibited`);
      out(`Name Servers: NS1.OIT.EDU, NS2.OIT.EDU`);
    }},

    traceroute: { desc:'Trace route to a host (simulated)',
      usage: 'traceroute <host>',
      examples: ['traceroute oit.edu', 'traceroute google.com'],
      run: async (a) => {
      const t = escapeHtml(a[0] || 'oit.edu');
      out(`traceroute to ${t} (199.46.115.21), 30 hops max, 60 byte packets`);
      const hops = [
        ['10.50.0.1',     '0.5'],
        ['192.168.1.1',   '1.2'],
        ['10.0.0.1',      '8.4'],
        ['72.14.207.115', '15.7'],
        ['108.170.252.1', '22.3'],
        ['199.46.115.21', '24.1'],
      ];
      for (let i = 0; i < hops.length; i++) {
        await new Promise(r => setTimeout(r, 220));
        out(` ${(i+1).toString().padStart(2)}  ${hops[i][0].padEnd(20)}  ${hops[i][1]} ms`);
      }
    }},

    ifconfig: { desc:'Network interface configuration', run: () => {
      out(`eth0: flags=4163&lt;UP,BROADCAST,RUNNING,MULTICAST&gt;  mtu 1500`, 'info');
      out(`        inet 10.50.0.1  netmask 255.255.255.0  broadcast 10.50.0.255`);
      out(`        ether de:ad:be:ef:00:01  txqueuelen 1000  (Ethernet)`);
      out(`        RX packets 1337420  bytes 542109184 (542.1 MB)`);
      out(`        TX packets 998877   bytes 184273920 (184.2 MB)`);
      blank();
      out(`lo:   flags=73&lt;UP,LOOPBACK,RUNNING&gt;  mtu 65536`, 'info');
      out(`        inet 127.0.0.1  netmask 255.0.0.0`);
    }},

    netstat: { desc:'Listening ports + active connections (simulated)', run: () => {
      out(`Active Internet connections (servers and established)`, 'warn');
      out(`Proto Recv-Q Send-Q  Local Address         Foreign Address       State`);
      const rows = [
        ['tcp',  '0',  '0',  '0.0.0.0:22',         '0.0.0.0:*',           'LISTEN'],
        ['tcp',  '0',  '0',  '0.0.0.0:80',         '0.0.0.0:*',           'LISTEN'],
        ['tcp',  '0',  '0',  '0.0.0.0:443',        '0.0.0.0:*',           'LISTEN'],
        ['tcp',  '0',  '0',  '127.0.0.1:5432',     '0.0.0.0:*',           'LISTEN'],
        ['tcp',  '0',  '0',  '10.50.0.1:443',      '142.250.80.78:443',   'ESTABLISHED'],
      ];
      rows.forEach(r => out(`${r[0].padEnd(6)}${r[1].padEnd(7)}${r[2].padEnd(7)} ${r[3].padEnd(22)}${r[4].padEnd(22)}${r[5]}`));
    }},

    curl: { desc:'Make an HTTP request (simulated)',
      usage: 'curl <url>',
      examples: ['curl https://oit.edu', 'curl http://localhost'],
      run: (a) => {
      if (!a[0]) return out('usage: curl &lt;url&gt;', 'err');
      const url = escapeHtml(a[0]);
      out(`* Trying ${url}...`, 'dim');
      out(`&gt; GET / HTTP/2`, 'info');
      out(`&gt; User-Agent: curl/8.0`, 'dim');
      blank();
      out(`&lt; HTTP/2 200`, 'ok');
      out(`&lt; server: nginx`, 'dim');
      out(`&lt; content-type: text/html`, 'dim');
      blank();
      out(`&lt;!doctype html&gt;&lt;title&gt;Hello from ${url}&lt;/title&gt;`);
    }},

    ssh: { desc:'Connect to a remote host', run: (a) => {
      const t = escapeHtml(a[0] || 'localhost');
      out(`Permission denied (publickey).`, 'err');
      out(`ssh: connect to host ${t} port 22: Authentication failure`, 'dim');
    }},

    /* CTF #9 — SQL injection. The `login` command builds a SQL query by
       string-concatenating the user's input, prints it as "debug output"
       (which is the vulnerability hint), then "executes" it against an
       in-memory users table. A classic auth-bypass injection in the
       username field returns the admin row, which carries the flag.
       The flag literal is base64-encoded so View Source doesn't surface it. */
    login: { desc:'Log in to the admin panel (simulated)',
      usage: 'login <username> <password>',
      examples: ['login admin admin', 'login root toor', "login admin'-- ignored"],
      notes: 'Output is simulated — no real auth happens.\nA real login system. Try not to break it.\nNote: arguments split on whitespace, so wrap multi-word values carefully.',
      run: async (a) => {
      const user = a[0] || '';
      const pass = a.slice(1).join(' ') || '';
      if (!user || !pass) return out('usage: login &lt;username&gt; &lt;password&gt;', 'err');

      // The "vulnerability" — interpolate user input straight into SQL and print it
      const sql = `SELECT * FROM users WHERE name='${user}' AND pass='${pass}'`;
      out(`<span class="term-out-dim">[debug] executing: ${escapeHtml(sql)}</span>`);
      await new Promise(r => setTimeout(r, 280));

      // Detect classic auth-bypass patterns. We're matching against the resulting
      // SQL string so single-quote-escapes, comments, and tautologies all count.
      const injected = /'\s*(or|\|\|)\s+('?\d+'?\s*=\s*'?\d+'?|true|'[^']*'\s*=\s*'[^']*')|'\s*(--|#|\/\*)/i.test(sql);

      if (injected) {
        const _flag = atob('ZmxhZ3tzcWxfaW5qZWN0aW9uX2lzX2NsYXNzaWN9');
        out(`<span class="term-out-ok">✓ query returned 1 row (auth check bypassed)</span>`);
        out(`Welcome, admin. Session token issued.`, 'dim');
        blank();
        out(`<span class="term-out-warn">id  name   role   note</span>`);
        out(`1   admin  root   <span class="term-out-mag">${escapeHtml(_flag)}</span>`);
        out(`|_ submit the note value with \`flag &lt;text&gt;\``, 'dim');
        return;
      }

      out(`Authentication failed: invalid credentials`, 'err');
      out(`  hint: the SQL printed above is built by string concatenation.`, 'dim');
      out(`  hint: in real attacks, that pattern is exploitable. (CTF #9)`, 'dim');
    }},

    /* CTF #10 — JWT alg=none. `token` issues a fake-HMAC-signed token; the
       verifier `whoami-jwt` accepts BOTH HS256 (with the deterministic fake
       HMAC) AND alg=none with an empty signature — the classic vulnerability.
       Player must forge a token with alg=none and role=admin to reveal the
       admin debug-note (the flag). The flag literal is base64-encoded so
       View Source doesn't surface it. */
    token: { desc:'Issue a JWT for a username (simulated)',
      usage: 'token <username>',
      examples: ['token alice', 'token bob'],
      notes: 'All issued tokens carry role=user. To see the admin debug-note in whoami-jwt, you will need to forge a token. Hint: read up on JWT alg=none.',
      run: (a) => {
      const user = (a[0] || 'guest').slice(0, 32);
      const header  = { alg: 'HS256', typ: 'JWT' };
      const payload = { user, role: 'user', iat: Math.floor(Date.now()/1000) };
      const h = _b64urlEncode(JSON.stringify(header));
      const p = _b64urlEncode(JSON.stringify(payload));
      const sig = _hmacFake(h, p);
      const tok = `${h}.${p}.${sig}`;
      out(`Issued JWT for <span class="term-out-info">${escapeHtml(user)}</span>:`);
      out(`  <span class="term-out-info">${escapeHtml(tok)}</span>`);
      blank();
      out(`Inspect with \`jwt-decode &lt;token&gt;\`. Authenticate with \`whoami-jwt &lt;token&gt;\`.`, 'dim');
    }},

    'jwt-decode': { desc:'Decode and pretty-print a JWT (no verification)',
      usage: 'jwt-decode <token>',
      examples: ['jwt-decode eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWxpY2UifQ.sig'],
      notes: 'Read-only. Does not check the signature.',
      run: (a) => {
      const tok = (a[0] || '').trim();
      if (!tok) return out('usage: jwt-decode &lt;token&gt;', 'err');
      const parts = tok.split('.');
      if (parts.length !== 3) return out('not a JWT (expected 3 dot-separated parts)', 'err');
      let header, payload;
      try { header  = JSON.parse(_b64urlDecode(parts[0])); }
      catch (e) { return out('header decode failed: ' + escapeHtml(e.message), 'err'); }
      try { payload = JSON.parse(_b64urlDecode(parts[1])); }
      catch (e) { return out('payload decode failed: ' + escapeHtml(e.message), 'err'); }
      out(`<span class="term-out-warn">header:</span>    ${escapeHtml(JSON.stringify(header))}`);
      out(`<span class="term-out-warn">payload:</span>   ${escapeHtml(JSON.stringify(payload))}`);
      out(`<span class="term-out-warn">signature:</span> ${escapeHtml(parts[2] || '(empty)')}`);
    }},

    'whoami-jwt': { desc:'Authenticate with a JWT (simulated server)',
      usage: 'whoami-jwt <token>',
      examples: ['whoami-jwt <paste-token-here>'],
      notes: 'Returns the role-gated admin debug-note when role=admin.',
      run: (a) => {
      const tok = (a[0] || '').trim();
      if (!tok) return out('usage: whoami-jwt &lt;token&gt;', 'err');
      const parts = tok.split('.');
      if (parts.length !== 3) return out('malformed token (expected 3 dot-separated parts)', 'err');
      let header, payload;
      try {
        header  = JSON.parse(_b64urlDecode(parts[0]));
        payload = JSON.parse(_b64urlDecode(parts[1]));
      } catch (e) { return out('decode error: ' + escapeHtml(e.message), 'err'); }
      out(`<span class="term-out-dim">[debug] alg = ${escapeHtml(String(header.alg))}</span>`);

      // Verifier — accepts HS256 with our fake HMAC, OR alg=none with empty sig.
      // The intended exploit is alg=none.
      let sigOk = false;
      if (header.alg === 'none') {
        sigOk = !parts[2];
      } else if (header.alg === 'HS256') {
        sigOk = parts[2] === _hmacFake(parts[0], parts[1]);
      }
      if (!sigOk) {
        out(`✗ signature verification failed (alg=${escapeHtml(String(header.alg))})`, 'err');
        return;
      }
      out(`<span class="term-out-ok">✓ signature accepted (alg=${escapeHtml(String(header.alg))})</span>`);
      out(`Hello, <span class="term-out-info">${escapeHtml(String(payload.user || 'anonymous'))}</span> (role: ${escapeHtml(String(payload.role || 'user'))})`);

      if (payload.role === 'admin') {
        const _flag = atob('ZmxhZ3tub25lX2FsZ19zdHJpa2VzX2FnYWlufQ==');
        blank();
        out(`<span class="term-out-mag">═══ ADMIN DEBUG PANEL ═══</span>`);
        out(`  debug-note: <span class="term-out-mag">${escapeHtml(_flag)}</span>`);
        out(`|_ submit the note value with \`flag &lt;text&gt;\``, 'dim');
      } else {
        out(`(non-admins don't see the debug-note)`, 'dim');
      }
    }},

    /* ============================================================
       UTILITIES
       ============================================================ */
    history: { desc:'Show recent command history', run: () => {
      if (!history.length) return out('(no history yet)', 'dim');
      history.slice().reverse().forEach((h, i) => {
        out(`  ${(i+1).toString().padStart(3)}  ${escapeHtml(h)}`);
      });
    }},

    tree: { desc:'Show directory tree', run: () => {
      out('<span class="term-out-info">~/cybersec/</span>');
      out('├── <span class="term-out-info">about.md</span>');
      out('├── <span class="term-out-info">events.json</span>');
      out('├── <span class="term-out-info">contact.sh</span>');
      out('├── <span class="term-out-info">officers.list</span>');
      out('├── <span class="term-out-info">faq.md</span>');
      out('├── <span class="term-out-mag">ranks.json</span>');
      out('├── motto.txt');
      out('└── <span class="term-out-info">README</span>');
      blank();
      out('1 directory, 8 files', 'dim');
    }},

    df: { desc:'Disk usage', run: () => {
      out('Filesystem      Size  Used  Avail  Use%  Mounted on', 'warn');
      out('/dev/sda1       200G  134G   66G   67%  /');
      out('/dev/sda2        50G   12G   38G   24%  /home');
      out('tmpfs            16G  4.2G   12G   27%  /tmp');
    }},

    uptime: { desc:'Show how long the session has been up', run: () => {
      const e = Math.floor((Date.now()-start)/1000);
      const h = Math.floor(e/3600), m = Math.floor((e%3600)/60), s = e%60;
      out(`up ${h}h ${m}m ${s}s, 1 user, load average: 0.42, 0.31, 0.27`);
    }},

    /* ============================================================
       TOOLS
       ============================================================ */
    base64: { desc:'Encode or decode base64',
      usage: 'base64 (encode|decode) <text>',
      examples: ['base64 encode hello', 'base64 decode aGVsbG8=', 'base64 decode ZmxhZ3tiNjRfaXNfbm90X2VuY3J5cHRpb259'],
      notes: 'Real encoding via the browser btoa/atob — no fake output.',
      run: (a) => {
      const mode = (a[0]||'').toLowerCase();
      const input = a.slice(1).join(' ');
      if (!mode || !input) return out('usage: base64 encode &lt;text&gt;  |  base64 decode &lt;text&gt;', 'err');
      try {
        const result = mode === 'encode' ? btoa(input) : mode === 'decode' ? atob(input) : null;
        if (result === null) return out('mode must be "encode" or "decode"', 'err');
        out(escapeHtml(result), 'ok');
      } catch (e) {
        out('error: '+escapeHtml(e.message), 'err');
      }
    }},

    rot13: { desc:'Apply ROT13 to text',
      usage: 'rot13 <text>',
      examples: ['rot13 hello world', 'rot13 synt{ebgngr_guvegrra_cynprf}'],
      notes: 'ROT13 is its own inverse — encrypting twice gives you the original back.',
      run: (a) => {
      const input = a.join(' ');
      if (!input) return out('usage: rot13 &lt;text&gt;', 'err');
      const r = input.replace(/[a-zA-Z]/g, c => {
        const base = c <= 'Z' ? 65 : 97;
        return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
      });
      out(escapeHtml(r), 'ok');
    }},

    hash: { desc:'SHA-256 hash a string',
      usage: 'hash <text>',
      examples: ['hash hunter2', 'hash flag{example}'],
      notes: 'Real SHA-256 via the browser SubtleCrypto API. Requires HTTPS in production.',
      run: async (a) => {
      const input = a.join(' ');
      if (!input) return out('usage: hash &lt;text&gt;', 'err');
      const buf = new TextEncoder().encode(input);
      const h = await crypto.subtle.digest('SHA-256', buf);
      const hex = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join('');
      out(`<span class="term-out-info">SHA-256:</span> ${hex}`);
    }},

    fortune: { desc:'Print a random hacker fortune', run: () => {
      const quotes = [
        "Talk is cheap. Show me the code. — Linus Torvalds",
        "Hack the planet. — Hackers (1995)",
        "The quieter you become, the more you can hear. — Kali Linux",
        "Security is a process, not a product. — Bruce Schneier",
        "There is no patch for human stupidity. — Kevin Mitnick",
        "If debugging is the process of removing software bugs, then programming must be the process of putting them in. — Edsger Dijkstra",
        "It's not a bug, it's an undocumented feature.",
        "The best way to predict the future is to implement it. — David Heinemeier Hansson",
        "Code never lies, comments sometimes do. — Ron Jeffries",
        "Trust no one. Verify everything.",
        "Given enough eyeballs, all bugs are shallow. — Linus's Law",
      ];
      out(quotes[Math.floor(Math.random()*quotes.length)], 'mag');
    }},

    cowsay: { desc:'ASCII cow says something',
      usage: 'cowsay [message]',
      examples: ['cowsay hello', 'cowsay hack the planet'],
      run: (a) => {
      const msg = a.join(' ') || 'hack the planet';
      const safeMsg = escapeHtml(msg);
      const top = ' ' + '_'.repeat(msg.length + 2);
      const bot = ' ' + '-'.repeat(msg.length + 2);
      out(`<pre style="margin:0;font-family:inherit;color:var(--accent)">${top}
&lt; ${safeMsg} &gt;
${bot}
        \\   ^__^
         \\  (oo)\\_______
            (__)\\       )\\/\\
                ||----w |
                ||     ||</pre>`);
    }},

    banner: { desc:'Reprint the CYBERSEC banner', run: () => printPage('home') },

    neofetch: { desc:'System info, fancied up', run: () => {
      const e = Math.floor((Date.now()-start)/1000);
      const h = Math.floor(e/3600), m = Math.floor((e%3600)/60);
      const ua = navigator.userAgent.split(' ').slice(-1)[0];
      out(`<pre style="margin:0;font-family:inherit"><span class="term-out-ok">     .--.</span>          <span class="term-out-ok">hacker</span>@<span class="term-out-info">cybersec</span>
<span class="term-out-ok">    |o_o |</span>         ----------------------------
<span class="term-out-ok">    |:_/ |</span>         <span class="term-out-warn">OS:</span>       Linux club-host 6.9.0-club
<span class="term-out-ok">   //   \\ \\</span>        <span class="term-out-warn">Host:</span>     OIT Cybersecurity Club Portland
<span class="term-out-ok">  (|     | )</span>       <span class="term-out-warn">Kernel:</span>   6.9.0-club
<span class="term-out-ok"> /'\\_   _/\`\\</span>      <span class="term-out-warn">Uptime:</span>   ${h}h ${m}m
<span class="term-out-ok"> \\___)=(___/</span>      <span class="term-out-warn">Shell:</span>    bash 5.2
                       <span class="term-out-warn">Browser:</span>  ${escapeHtml(ua)}
                       <span class="term-out-warn">Theme:</span>    Hustlin' Owls (navy/gold)</pre>`);
    }},

    /* ============================================================
       CLUB SHORTCUTS
       ============================================================ */
    roster: { desc:'List club officers', run: () => {
      out(`Club Officers — ${new Date().getFullYear()}`, 'mag');
      const padW = Math.max(...CONFIG.officers.map(o => o.role.length), 'Advisor'.length) + 2;
      CONFIG.officers.forEach(o => {
        out(`  <span class="term-out-info">${o.role.padEnd(padW)}</span> ${o.name}`);
      });
      out(`  <span class="term-out-info">${'Advisor'.padEnd(padW)}</span> ${CONFIG.advisor.name}`);
    }},

    next: { desc:'Show date/time of next meeting', run: () => {
      const d = upcomingThursdays(1)[0];
      out(`Next meeting: <span class="term-out-warn">${fmtNextMeeting(d)}</span> · <span class="term-out-info">${CONFIG.meetingRoom}</span>`);
    }},

    discord: { desc:'Open Discord invite', run: () => {
      out(`Opening Discord... <a href="${CONFIG.links.discord}" target="_blank">${_u(CONFIG.links.discord)}</a>`);
      window.open(CONFIG.links.discord, '_blank');
    }},

    roost: { desc:'Open The Roost club page', run: () => {
      out(`Opening The Roost... <a href="${CONFIG.links.roost}" target="_blank">${_u(CONFIG.links.roost).split('?')[0]}</a>`);
      window.open(CONFIG.links.roost, '_blank');
    }},

    signup: { desc:'Open the club signup page', run: () => {
      out(`Opening signup... <a href="${CONFIG.links.signup}" target="_blank">${_u(CONFIG.links.signup)}</a>`);
      window.open(CONFIG.links.signup, '_blank');
    }},

    /* ============================================================
       EASTER EGGS
       ============================================================ */
    vim: { desc:'Open the editor', run: () => {
      out('vim: terminal too small for vim', 'err');
      out('     (try emacs... just kidding, never)', 'dim');
    }},

    emacs: { desc:'Open the other editor', run: () => {
      out('emacs: a great operating system, lacking only a decent editor', 'warn');
    }},

    rm: { desc:'Remove files', run: (a) => {
      if (a.includes('-rf') && (a.includes('/') || a.includes('--no-preserve-root'))) {
        out("you can't be serious", 'err');
        out('rm: it is dangerous to operate recursively on /', 'err');
        out('rm: use --no-preserve-root to override this safety check', 'dim');
        return;
      }
      out('rm: nothing to remove (this is a website, not a real fs)', 'err');
    }}
  };

  // help alias
  COMMANDS.h = { ...COMMANDS.help, desc:'Alias for help' };

  /* ============================================================
     HISTORY + INPUT HANDLING
     ============================================================ */
  const history = [];
  let histIdx = -1;

  async function execute(raw) {
    const line = raw.trim();
    echoCmd(raw);
    if (!line) return;
    history.unshift(line);
    histIdx = -1;

    // ---- Submit-prompt mode: capture next line as a leaderboard username ----
    if (submitPromptMode) {
      submitPromptMode = false;
      if (line.toLowerCase() === 'skip' || line === '') {
        // Remember the skip so we don't re-prompt on every subsequent solve.
        // (User can still run `submit <name>` manually later.)
        if (!ctfTimer) ctfTimer = { startedAt: Date.now() };
        ctfTimer.skipped = true;
        saveTimer();
        out('skipped — playing privately. Run `submit <username>` any time to join the leaderboard.', 'dim');
        return;
      }
      try { await COMMANDS.submit.run([line]); }
      catch (e) { out('error: '+escapeHtml(e.message||e), 'err'); }
      return;
    }

    // ---- Python REPL mode: every line goes to the interpreter ----
    if (pythonMode) {
      if (/^(exit|quit)\s*\(\s*\)\s*$/i.test(line) || /^(:?q|exit|quit)$/i.test(line)) {
        pythonMode = false;
        updatePromptUI();
        out('exited python REPL', 'dim');
        addActivity('info', 'exited python REPL');
        return;
      }
      addActivity('info', `py: <span class="term-out-info">${escapeHtml(line.length > 30 ? line.slice(0,27)+'...' : line)}</span>`);
      await runPythonLine(line);
      return;
    }

    // Shortcut: typing `flag{...}` (or `{...}`) on its own runs the flag command
    if (/^(flag)?\{.*\}$/i.test(line)) {
      addActivity('info', `flag attempt: <span class="term-out-mag">${escapeHtml(line)}</span>`);
      try { await COMMANDS.flag.run([line]); }
      catch (e) { out('error: '+escapeHtml(e.message||e), 'err'); }
      return;
    }
    const [cmdName, ...args] = line.split(/\s+/);
    const cmd = COMMANDS[cmdName.toLowerCase()];
    if (!cmd) {
      addActivity('err', `unknown: ${escapeHtml(cmdName)}`);
      out('command not found: '+escapeHtml(cmdName)+". Type 'help'.", 'err');
      return;
    }
    addActivity('info', `cmd: <span class="term-out-info">${escapeHtml(line.length > 38 ? line.slice(0,35)+'...' : line)}</span>`);
    try { await cmd.run(args); }
    catch (e) { out('error: '+escapeHtml(e.message||e), 'err'); }
  }

  // Global link-click activity logging (any <a> on the page)
  document.body.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || !a.href || !/^https?:/i.test(a.href)) return;
    try {
      const host = new URL(a.href).hostname;
      addActivity('info', `opened <span class="term-out-info">${escapeHtml(host)}</span>`);
    } catch (_) {}
  });

  // Only refocus the input if the user isn't selecting text — preserves drag-to-select
  term.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    termInput.focus({ preventScroll: true });
  });
  termInput.focus({ preventScroll: true });

  termInput.addEventListener('keydown', async (e) => {
    // Any key in the input snaps the output area to the bottom so you can see latest output
    term.scrollTop = term.scrollHeight;
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = termInput.value;
      termInput.value = '';
      await execute(v);
      term.scrollTop = term.scrollHeight;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      histIdx = Math.min(histIdx+1, history.length-1);
      termInput.value = history[histIdx];
      setTimeout(() => termInput.setSelectionRange(termInput.value.length, termInput.value.length), 0);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx <= 0) { histIdx=-1; termInput.value=''; return; }
      histIdx--;
      termInput.value = history[histIdx];
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const part = termInput.value.trim();
      if (!part) return;
      const m = Object.keys(COMMANDS).filter(k => k.startsWith(part));
      if (m.length === 1) termInput.value = m[0];
      else if (m.length > 1) { echoCmd(termInput.value); out(m.join('   '), 'dim'); }
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      termOutput.innerHTML = '';
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      // If user has selected text, let the browser copy it instead of aborting
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      e.preventDefault();
      echoCmd(termInput.value+'^C');
      termInput.value = '';
      histIdx = -1;
      // In Python REPL, Ctrl+C drops back to bash (mirrors real python behavior)
      if (pythonMode) {
        pythonMode = false;
        updatePromptUI();
        out('KeyboardInterrupt', 'warn');
        out('exited python REPL', 'dim');
        addActivity('info', 'exited python REPL (^C)');
      }
      return;
    }
  });

  /* ============================================================
     BOOT
     ============================================================ */
  // Return the active announcement (or null) given CONFIG.announcement and today.
  // Expiry check: announcement disappears after end-of-day on `expires`. Empty/missing
  // message → null. Severity is normalized so the boot line picks up a known CSS class.
  function activeAnnouncement() {
    const a = CONFIG.announcement;
    if (!a || typeof a !== 'object' || !a.message) return null;
    if (a.expires) {
      const exp = new Date(a.expires + 'T23:59:59');
      if (isNaN(exp) || exp < new Date()) return null;
    }
    const sev = a.severity === 'info' ? 'info'
              : a.severity === 'alert' ? 'danger'
              : 'warn';
    return { message: String(a.message), sev };
  }

  function boot() {
    const lines = [
      ['['+new Date().toISOString().slice(11,19)+`] booting ${CONFIG.clubShort} terminal v1.0.0...`, 'dim'],
      ['[ OK ] mounted /dev/club on /', 'ok'],
      ['[ OK ] started network manager', 'ok'],
      ['[ OK ] started session for user hacker', 'ok'],
      ['[ OK ] CTF subsystem ready: '+CHALLENGES.length+' challenges loaded', 'ok'],
    ];
    // Inject an admin-edited announcement line if one is active. Severity maps
    // to the boot-line color (warn/info/danger). Past-expiry → silently skipped.
    const ann = activeAnnouncement();
    if (ann) lines.push([`[ANNOUNCE] ${escapeHtml(ann.message)}`, ann.sev]);
    lines.push(
      // Live counter — fetched from /api/stats at boot. The placeholder span
      // gets its textContent replaced when the fetch resolves; if the API is
      // unreachable, we hide the line entirely so it doesn't sit there as `…`.
      [`[INFO] <span id="boot-solves">…</span> flags captured across all sessions`, 'info'],
      ['', '']
    );
    let i = 0;
    const tick = () => {
      if (i >= lines.length) {
        // Final attempt in case the fetch resolved during the last setTimeout.
        if (typeof applyBootSolves === 'function') applyBootSolves();
        printPage('home');
        return;
      }
      const [t, c] = lines[i++];
      if (t) out(t, c); else blank();
      // After each line prints, retry the live-stats apply. Once the
      // #boot-solves placeholder is rendered, this no-ops on subsequent
      // calls (the element either gets its number or gets removed).
      if (typeof applyBootSolves === 'function') applyBootSolves();
      setTimeout(tick, REDUCED_MOTION ? 0 : 100);
    };
    tick();
  }

  // Populate dynamic Club Info + Recent Activity fields from the upcoming-meeting helper.
  // Named (not IIFE) so we can re-run after the async /api/config fetch updates CONFIG.
  function populateDynamicFields() {
    const next = upcomingThursdays(1)[0];
    const label = fmtNextMeeting(next);
    const infoNext = document.getElementById('info-next');
    const logNext  = document.getElementById('log-next-meeting');
    if (infoNext) infoNext.textContent = label;
    if (logNext)  logNext.textContent  = label;

    // Next special event (CTF night, guest speaker, etc.). Find the soonest
    // entry in CONFIG.specialEvents whose date is today or later, and surface
    // it in the Club Info panel. If there are none upcoming, leave the row hidden.
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const nextSpecial = (CONFIG.specialEvents || [])
      .map(e => ({ ...e, _d: new Date(e.date + 'T00:00:00') }))   // local midnight, not UTC
      .filter(e => !isNaN(e._d) && e._d >= todayMidnight)
      .sort((a, b) => a._d - b._d)[0];
    const eventRow = document.getElementById('info-event-row');
    const eventEl  = document.getElementById('info-event');
    if (nextSpecial && eventRow && eventEl) {
      eventEl.textContent = `${_Day(nextSpecial._d.getDay())} ${MONTHS_NICE[nextSpecial._d.getMonth()]} ${nextSpecial._d.getDate()} · ${nextSpecial.title}`;
      eventRow.style.display = '';
    } else if (eventRow) {
      // Re-run safety: if there are no upcoming specials, hide a row that
      // a previous run may have shown.
      eventRow.style.display = 'none';
    }
  }
  populateDynamicFields();

  /* ============================================================
     APPLY CONFIG — sync the HTML defaults to whatever's in CONFIG
     so editing the CONFIG block updates the page everywhere.
     Named (not IIFE) so loadRemoteConfig() can re-run it after
     fetching admin-edited values from /api/config.
     ============================================================ */
  function applyConfig() {
    const set = (sel, val) => { const el = document.querySelector(sel); if (el) el.textContent = val; };
    const setHref = (sel, href) => { const el = document.querySelector(sel); if (el) el.href = href; };

    // <head> + topbar
    document.title = `${CONFIG.clubName} // terminal`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = CONFIG.description;
    set('.topbar-brand-text', CONFIG.clubName);

    // Center panel header path
    const ph = document.querySelector('.panel-header');
    if (ph) {
      // Rebuild the inner "~ /<short>/<file>" while preserving the current-file span
      const cur = document.getElementById('current-file');
      const curText = cur ? cur.textContent : 'index.tsx';
      const headerSpan = ph.querySelector('span:first-child');
      if (headerSpan) headerSpan.innerHTML = `<span class="panel-header-icon">~</span>/${CONFIG.clubShort}/<span id="current-file">${curText}</span>`;
    }

    // Live terminal prompt
    const livePrompt = document.querySelector('.term-input-line .term-prompt');
    if (livePrompt && !pythonMode) livePrompt.textContent = `hacker@${CONFIG.clubShort}`;

    // Right-column Club Info rows — each value cell has an id="info-*" so we
    // can target it directly. If a row is missing or hidden, the corresponding
    // line is a no-op, so reordering or hiding rows in HTML is safe here.
    set('#info-founded', CONFIG.founded);
    set('#info-members', CONFIG.members);
    set('#info-location', CONFIG.meetingRoom);

    // Recent Activity seed lines — addressed by ID so reordering them in HTML
    // doesn't silently break this rewrite.
    const founded = document.getElementById('log-founded');
    if (founded) founded.innerHTML = `<span class="log-tag">[INFO]</span> Club founded — ${CONFIG.founded}`;
    const memberLink = document.getElementById('log-members');
    if (memberLink) memberLink.textContent = CONFIG.officers.length;
    const workshops = document.getElementById('log-workshops');
    if (workshops) workshops.innerHTML = `<span class="log-tag">[ OK ]</span> Workshops weekly · ${CONFIG.meetingRoom}`;

    // Quick Links + topbar Join button
    setHref('a.btn-register', CONFIG.links.signup);
    document.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (href.includes('PMCYB/club_signup')) a.href = CONFIG.links.signup;
      else if (href.includes('theroost.oit.edu/feeds')) a.href = CONFIG.links.roost;
      else if (href.includes('discord.gg/EXAMPLE') || (href.includes('discord.gg') && a.textContent.includes('EXAMPLE'))) a.href = CONFIG.links.discord;
    });

    // QR widget — show only on the kiosk *.workers.dev deploy, never on the
    // custom-domain "real" site. ?qr=1 forces show, ?qr=0 forces hide (for
    // local testing, since localhost wouldn't otherwise match).
    setupQrWidget();
  }
  applyConfig();

  /* ============================================================
     REMOTE CONFIG — fetch admin-edited values from /api/config
     and merge them over the inline CONFIG defaults, then re-run
     the apply/populate functions so the page reflects them.

     The inline CONFIG in index.html is the *fallback*: it works
     when /api/config is unreachable (local file:// preview, KV
     empty, Worker down). When the API returns a config, we
     overwrite the editable fields in-place — clubShort, QR
     settings, and any other infra-only keys stay intact.
     ============================================================ */
  const EDITABLE_KEYS = [
    'clubName', 'campusName', 'founded', 'description',
    'meetingDay', 'meetingTime', 'meetingRoom',
    'members', 'specialEvents', 'officers', 'advisor', 'links',
    'announcement',
  ];
  function mergeRemoteConfig(remote) {
    if (!remote || typeof remote !== 'object') return;
    for (const k of EDITABLE_KEYS) {
      if (remote[k] === undefined) continue;
      // Arrays and nested objects (advisor, links) are replaced wholesale —
      // the admin form always sends a complete value for each.
      CONFIG[k] = remote[k];
    }
  }
  // Kicks off the fetch immediately at module load; resolves as soon as the
  // API responds (or fails). Returns a promise the boot path waits on (with
  // a short cap) so the home-page terminal printout reflects the latest
  // admin-edited values rather than the inline fallback.
  const remoteConfigReady = fetch('/api/config')
    .then(r => r.ok ? r.json() : null)
    .then(remote => {
      if (!remote) return;
      mergeRemoteConfig(remote);
      populateDynamicFields();
      applyConfig();
    })
    .catch(() => {});

  function setupQrWidget() {
    const widget = document.getElementById('qr-widget');
    if (!widget) return;
    const param = new URLSearchParams(location.search).get('qr');
    let show;
    if (param === '1') show = true;
    else if (param === '0') show = false;
    else show = !!CONFIG.qrShowHostnamePrefix && location.hostname.startsWith(CONFIG.qrShowHostnamePrefix);
    if (!show || !CONFIG.qrTargetUrl) return;
    const img = document.getElementById('qr-widget-img');
    img.alt = `QR code: ${CONFIG.qrTargetUrl}`;
    img.onerror = () => { widget.hidden = true; };
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=0&data=${encodeURIComponent(CONFIG.qrTargetUrl)}`;
    widget.hidden = false;
  }

  /* ============================================================
     LIVE STATS — fetch the global flag-capture count from the
     Cloudflare Worker at /api/stats and show it under the boot
     line. Gracefully degrades if the API is unreachable (e.g.
     during local file:// or python -m http.server preview):
     the boot line silently disappears.

     Race detail: the boot animation prints lines with setTimeout,
     so the #boot-solves placeholder doesn't exist until ~600ms in.
     The fetch usually resolves first. We store the result in
     `_bootSolvesValue` and apply it whenever both (a) we have a
     value and (b) the element has been rendered. boot()'s tick
     calls applyBootSolves() after every line so the "render is
     ready" half of the race is checked frequently.
     ============================================================ */
  let _bootSolvesValue = undefined;  // undefined = pending; null = failed; number = ok
  function applyBootSolves() {
    if (_bootSolvesValue === undefined) return;
    // Boot-line placeholder (under "[ OK ] CTF subsystem ready" in the boot animation)
    const bootEl = document.getElementById('boot-solves');
    if (bootEl) {
      if (_bootSolvesValue === null) {
        const line = bootEl.closest('.term-line');
        if (line) line.remove();
      } else {
        bootEl.textContent = _bootSolvesValue.toLocaleString();
      }
    }
    // QR widget — kiosk-only stats line under the scan→site label.
    // Unhidden only when we have a real number; stays hidden on API failure
    // so the kiosk widget doesn't show "…" indefinitely.
    const qrEl     = document.getElementById('qr-solves');
    const qrLine   = document.getElementById('qr-solves-line');
    if (qrEl && qrLine && typeof _bootSolvesValue === 'number') {
      qrEl.textContent = _bootSolvesValue.toLocaleString();
      qrLine.hidden = false;
    }
  }
  function updateBootSolves(n) {
    _bootSolvesValue = (typeof n === 'number' && isFinite(n)) ? n : null;
    applyBootSolves();
  }
  fetch('/api/stats')
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => updateBootSolves(d && typeof d.total === 'number' ? d.total : null))
    .catch(() => updateBootSolves(null));

  // Periodic refresh so the kiosk QR widget + boot line + sidebar count
  // stay live without a full page reload (which would lose scroll position,
  // python REPL state, and terminal history for anyone actively using the
  // site). One hour is enough motion for a passive display.
  // On poll failure we leave the existing value alone instead of degrading
  // to null — a transient API hiccup shouldn't make the line disappear.
  const STATS_POLL_MS = 60 * 60 * 1000;
  setInterval(() => {
    fetch('/api/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && typeof d.total === 'number') updateBootSolves(d.total);
      })
      .catch(() => {});
  }, STATS_POLL_MS);

  // Wait for /api/config before booting so the home-page printout uses
  // admin-edited values. Cap the wait at 500ms — if the API is unreachable
  // (local file:// preview, Worker down) we fall through to inline defaults.
  Promise.race([
    remoteConfigReady,
    new Promise(r => setTimeout(r, 500)),
  ]).then(() => boot());