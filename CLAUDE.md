# Project: OIT Cybersecurity Club Portland Website

> This file is read by Claude Code at the start of every session in this folder.
> It captures the project's intent, architecture, and conventions so you don't have to re-explain.

## Overview

A static HTML/CSS/JS website for the OIT Cybersecurity Club Portland (Oregon Tech's Portland-Metro campus). Terminal-aesthetic UI inspired by [beaverhacks.org](https://beaverhacks.org/). Includes a working in-browser command terminal, simulated system stats, animated UI, SPA-style navigation, and a **10-challenge CTF mode** with a real Python REPL via Pyodide.

## Architecture

- **Three-file site**: `index.html` (HTML body + small `<script>` with `CONFIG` at the top), `styles.css` (all CSS), `app.js` (all client-side JS — terminal engine, COMMANDS, CTF, page printers, applyConfig, boot). Was originally one file; split when it grew past ~2200 lines for editor ergonomics and PR diff readability. The CONFIG block stays inlined at the top of `index.html` so club admins can find it without reading three files.
- **No build step**: Pure static HTML. Open directly in a browser, or serve with any static server.
- **One runtime dependency**: [Pyodide](https://pyodide.org) (loaded lazily from jsDelivr CDN when the `python` command is first used; ~10 MB).
- **Embedded image assets**: Two images are base64-embedded in `index.html` rather than served as separate files (keeps the deploy bundle small and lets the page render before any image fetches):
  - Topbar logo (Oregon Tech Owls athletics mark, ~9 KB)
  - Favicon (Hootie owl head, 32×32 PNG, ~2 KB)
- **Deployment**: Cloudflare Workers Static Assets via `wrangler.jsonc`. The Cloudflare dashboard's deploy command is `npx wrangler versions upload`. `.assetsignore` keeps `CLAUDE.md`, `README.md`, and `wrangler.jsonc` off the public site. Production branch: `main`.
- **Future direction (open)**: Could be split into multiple files, or evolve into a Next.js app. Reference architecture: [`OregonStateHackathonClub/website`](https://github.com/OregonStateHackathonClub/website) — Next.js 15 + Tailwind v4 + shadcn/ui + Prisma + Better Auth, monorepo via Turborepo + pnpm.

## Local preview

```bash
# Easiest — just open it
open index.html         # macOS
xdg-open index.html     # Linux
start index.html        # Windows

# Proper local server (recommended for testing Pyodide / fetch behavior)
python3 -m http.server 8000
# → http://localhost:8000
```

## Key components in `index.html`

### Configuration block
- A `CONFIG` object near the top of the first `<script>` block holds all club-specific values: name, officers, advisor, meeting day/time/room, external links, member count.
- `applyConfig()` runs at boot and syncs DOM elements to those values, so editing `CONFIG` and reloading is enough for routine updates.
- The "officers onboarded" count in Recent Activity reads from `CONFIG.officers.length` automatically — add or remove officer entries and the count adjusts. The advisor (`CONFIG.advisor`) is rendered separately on the contact page and isn't counted as an officer.

### Layout
- **Top bar**: Owl logo + brand text on the left; tab nav (`home / about / events / contact / ctf`); CTF score badge + "Join us" button on the right.
- **Three-column grid**: left (system widgets — CPU / memory / disk / network with sparkline), center (page content + terminal), right (club info + quick links + recent activity).
- **Bottom**: vim-style status bar.

### Terminal engine
- The `COMMANDS` object is the source of truth — every command is `{ desc, run(args), [usage, examples, notes] }`.
- Adding a command means adding one entry; it auto-shows in `help` and is tab-completable. No other registration needed.
- Optional `usage` / `examples` / `notes` fields render in `help <command>` detail view.
- The `out(html, cls)` helper writes a line to terminal output. **It uses `innerHTML`** so commands can emit styled markup (`<span class="term-out-info">`). User input is escaped via `escapeHtml()` before display — don't bypass this.

### CTF system
- `CHALLENGES` array defines all 10 challenges.
- **Flags are stored as precomputed FNV-1a hex hashes** (e.g. `'778322a0'`), NOT as `fnv1a('flag{...}')` calls. The hashing function is still defined to hash player submissions — but the array contains literal hex strings so View Source can't harvest the answers via the construction code.
- Challenges 1, 2, 5, 7 *intentionally* have plaintext / fragments / b64 in source — that IS the challenge. Don't remove. See "Hidden flags" below.
- Challenges 3, 4, 6 are presented as encoded text in the brief itself (player decodes b64 / rot13 / XOR).
- Challenge 8 (`nmap_recon`) is revealed only when the player runs `nmap 10.50.0.1` (the IP exposed by `ifconfig`). The banner string is base64-encoded and decoded with `atob()` at runtime — searching the source for `flag{` won't surface it.
- Progress persists in `localStorage` under key `oit-cybersec-ctf-v1` — survives reloads in the same browser, but not incognito or other browsers. `ctf reset` clears.

### Pyodide
- Lazy-loaded the first time `python` or `py` is invoked.
- Pinned to `v0.26.4`. Updating requires testing — the API moves occasionally.
- Loaded from `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/`.

### Simulated stats
- CPU / RAM / disk / network are intentionally fake (random walks via `jitter()` / `jitterFree()`).
- The network-in sparkline plots a rolling 40-sample buffer of those simulated values — so the curve is "real" relative to the fake numbers.
- This is an **aesthetic choice**, not a limitation. No real sites expose `/proc/stat` data.
- If you ever want real metrics, you'd need a backend.

### Open Graph / Twitter Card meta tags
- `<meta property="og:*">` and `<meta name="twitter:*">` in `<head>` control how the page renders when shared on Discord, Slack, iMessage, LinkedIn, etc.
- **Hardcoded** with current `CONFIG` values, NOT driven by JS — most social previewers don't execute JS, so JS-applied values would be invisible to them. If you change `CONFIG.clubName` / `CONFIG.description`, mirror the change in the meta tags.
- `og:image` hot-links the OIT Athletics owl logo at `oregontechowls.com/images/logos/site/site.png`. `data:` URIs aren't fetched by previewers, which is why we can't reuse the embedded favicon.
- `og:url` is set to the Cloudflare Worker URL `https://cybersecurityclub.scott-reinholtz.workers.dev/`. If/when you bind a custom domain (e.g. `cybersec.oit.edu`), update this tag in `<head>` AND `CONFIG.qrTargetUrl` in the script block.

### Favicon
- Embedded as base64 in `<link rel="icon">` and `<link rel="apple-touch-icon">` (32×32 PNG, ~2 KB).
- Source: `oregontechowls.com/favicon.ico` (Hootie owl head, no wordmark — reads cleanly at favicon sizes).
- Browsers cache favicons aggressively. After changing, hard-reload AND close/reopen the tab to actually see the new one.

### Accessibility
- `prefers-reduced-motion`: a CSS block + a `REDUCED_MOTION` JS constant honor the OS-level "reduce motion" preference. Collapses panel fade-ins, the progress shimmer, and the terminal typewriter delay (`LINE_DELAY` → 0).
- `--text-dim` is set to a value (`#8499b5`) that passes WCAG AA contrast on both `--bg-1` and `--bg-2` panel backgrounds.
- Left column (simulated CPU/Memory/Disk/Network) is `aria-hidden="true"` because the values are decorative random walks — nothing for a screen reader to surface.
- Terminal output has `aria-live="polite"` so screen readers announce new lines from page printers and command output without interrupting in-progress speech.
- Terminal input has `aria-label="Terminal command input"`. Decorative prompt spans (`hacker@cybersec`, path, `$`) are `aria-hidden`.

## Placeholders / things still to swap

Most placeholders from the original template are now real values. A few remain:

| Placeholder | What it is | Status |
|---|---|---|
| `og:url` content | Deployed URL for social previews | Placeholder; update post-deploy |
| ASCII art block | Generated at https://patorjk.com/software/taag | Currently shows "CYBERSEC" |

## Design conventions

- **Color palette in CSS variables**: All colors live at `:root`. Currently set to Oregon Tech navy (`#04111f` / `#08192e` / `#0e2542`) + gold (`#ffd24f`). To rebrand, change `--accent` (primary), `--warn` (amber accents), `--info` (blue accents), and the `--bg-*` scale.
- **Monospace throughout**: JetBrains Mono. Don't introduce sans-serif unless there's a clear reason.
- **CRT scanlines**: `body::before` overlay. Some find it intense — easy to remove if needed.
- **CTF localStorage**: progress persists across reloads in the same browser, but not across browsers / incognito / private mode.
- **Animations are intentional**: stat shimmers, panel fade-ins, blinking cursor, typing intro — these are part of the aesthetic, not gratuitous. (TODO: add `prefers-reduced-motion` support.)

## Hidden flags (don't remove)

These are *intentionally* visible / discoverable in source — they ARE the challenge for #1, #2, #5, #7:

| # | Where it's hidden | What to look for |
|---|---|---|
| 1 (recon) | HTML comment in `<head>` | `flag{html_recon_is_step_one}` |
| 2 (console) | `console.log()` call near CTF state setup | `flag{console_log_is_loud}` |
| 5 (obfuscation) | `_x1` … `_x6` JS variables, concatenated to `_motto` | `flag{string_concat_is_weak_obfuscation}` |
| 7 (steganography) | `<body data-z="...">` attribute (base64-encoded) | `flag{css_data_attrs_are_visible}` |

Challenges 3 (base64), 4 (rot13), and 6 (xor) are presented in the terminal itself when the user runs `ctf start <n>`.

Challenge 8 (nmap_recon) is revealed only when the player scans `10.50.0.1` via the `nmap` command. The banner is base64-encoded so `Ctrl+F flag{` doesn't surface it.

Challenge 9 (sql_injection) is revealed only when the player triggers a SQL injection in the `login` command (e.g. `login "admin' --" anything`). The flag is base64-encoded in source and decoded with `atob()` only when the injection regex matches.

Challenge 10 (jwt_tamper) is revealed by `whoami-jwt` only when the presented token has `payload.role === 'admin'` AND passes signature verification. The verifier intentionally accepts `alg=none` with an empty signature — the classic JWT vulnerability — so the player must forge a token rather than crack the fake HS256 HMAC. The flag is base64-encoded in source and decoded with `atob()` only inside the role=admin branch.

Other things:
- Pyodide version is pinned. Don't bump it without smoke-testing the `python` command afterward.
- `escapeHtml()` is the firewall between user input and the DOM. If you add a command that handles user-controlled strings, escape them.
- `term.scrollTop = term.scrollHeight` after `out()` keeps the terminal scrolled to bottom. Already handled by `out()`, but worth knowing.

## How to add a new CTF challenge

1. Pick a hiding spot for the flag (HTML comment, JS variable, encoded attribute, terminal-only reveal, etc.).
2. **Compute the FNV-1a hash of the flag separately** — DO NOT call `fnv1a('flag{...}')` in source, since that puts the plaintext in the page. Use a Node one-liner:
   ```bash
   node -e "function f(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0}return h.toString(16).padStart(8,'0')}; console.log(f('flag{your_flag}'))"
   ```
3. Add an entry to the `CHALLENGES` array with the precomputed hash:
   ```js
   { id: 9,
     name: 'your_challenge_name',
     points: 150,
     brief: 'What the player sees when they run `ctf start 9`',
     hint: 'What they see when they run `hint 9`',
     hash: 'a1b2c3d4' }   // <- precomputed hex, NOT a fnv1a() call
   ```
4. (Optional) Add the challenge to the listing in `printCtf()` for visibility on the CTF page.
5. If the flag plaintext appears anywhere in source as part of the reveal (e.g. a banner leak), encode it (base64, XOR, charCode array) so View Source doesn't surface it.
6. Test: open the file, run `ctf start 9`, confirm the brief shows; submit the flag and confirm it scores.

## How to add a new terminal command

Add an entry to `COMMANDS`:
```js
projects: {
  desc: 'Show our current projects',
  usage: 'projects',
  examples: ['projects'],
  run: (args) => {
    out('CURRENT PROJECTS', 'warn');
    out('  • Project 1');
    out('  • Project 2');
  }
}
```
That's it. It'll appear in `help`, `help projects` shows usage/examples, and tab-complete works. The `args` parameter is the rest of the line split on whitespace. If `run` is `async`, the executor awaits it (used for the `python` command).

## Deployment (Cloudflare Workers Static Assets)

- Cloudflare project name: `cybersecurityclub` (matches `name` in `wrangler.jsonc`)
- Deploy command (Cloudflare dashboard): `npx wrangler versions upload`
- Production branch: `main` — pushes auto-deploy via Cloudflare's GitHub integration
- `.assetsignore` excludes `CLAUDE.md`, `README.md`, `wrangler.jsonc`, `src/`, and `docs/` from the public asset bundle. Dotfiles (`.git/`, `.claude/`, `.gitignore`) are auto-excluded by Cloudflare.
- `wrangler.jsonc` defaults match what `cloudflare-workers-and-pages[bot]` would auto-generate — keeps the bot from re-proposing the same config later.

### Worker (`src/worker.js`) + KV

The deploy is no longer pure-static. `src/worker.js` is a small Cloudflare Worker that handles four API routes and falls through to static assets for everything else:
- `GET  /api/stats`        → `{ total: <int> }` — current global flag-capture counter
- `POST /api/solve`        → `{ flag: string }` → re-hashes (FNV-1a) the submitted flag, verifies against the known-good hash list, increments and returns the counter when valid
- `GET  /api/leaderboard`  → `{ current: [...], alltime: [...] }` — top 10 of each board
- `POST /api/submit-score` → `{ username, solvedIds, elapsedMs }` → validates username, computes points server-side from `solvedIds`, upserts into both boards (better entry per username wins)

Server-side re-hashing is the security boundary: a curl spammer can't inflate the counter without actually knowing a real flag. The hash list duplicates the values in `CHALLENGES` (in `app.js`) intentionally — keep them in sync when adding/rotating challenges. The leaderboard's per-challenge points table (`CHALLENGE_POINTS`) is similarly duplicated and used to compute the score server-side rather than trusting client-sent totals.

Storage is a single Cloudflare Workers KV namespace bound as `STATS`. Three keys live there:
- `total_solves`         (string-encoded int) — global flag-capture counter
- `leaderboard:current`  (JSON array, max 100 entries) — current term's leaderboard
- `leaderboard:alltime`  (JSON array, max 100 entries) — never auto-resets

KV is eventually consistent; for club-scale traffic, occasional duplicate / lost writes are acceptable. If precision ever matters, swap to a Durable Object.

**Resetting the per-term leaderboard at the start of each quarter:**
```
npx wrangler kv key delete --namespace-id 4e2136877ad141eebd0f96a1798b20d3 leaderboard:current
```
The all-time board (`leaderboard:alltime`) is never auto-cleared.

To rotate the KV namespace:
```
npx wrangler kv namespace create STATS
```
Paste the printed `id` into BOTH `wrangler.jsonc` AND `wrangler-qr.jsonc` → `kv_namespaces[0].id`. Both deploys must point at the same namespace so the kiosk QR display and the production site agree on the count.

**Both Workers run the same `src/worker.js`** and bind to the same `STATS` namespace. KV is account-scoped, so two Workers binding to the same id is fine and intentional — it's how the kiosk gets a live count from the same backing store the production site writes to.

`app.js` calls `/api/stats` at boot and shows the count under the `[ OK ] CTF subsystem ready` line in the boot animation. It also surfaces the count on the home + CTF tabs (via `slowSolveCount()`) and in the QR widget (`#qr-solves`). A 1-hour `setInterval` re-polls `/api/stats` so kiosk displays stay current without a full page reload. The flag command POSTs to `/api/solve` after a successful local solve so the global counter increments.

The leaderboard timer (`oit-cybersec-timer-v1` in localStorage) starts on the first `ctf start <n>` call and stops on the 10th successful flag. The completion handler enters `submitPromptMode` (next typed line is captured as a username and routed to the `submit` command), POSTs to `/api/submit-score`, and stores `submittedAs` so we don't re-prompt. `ctf reset` clears the timer too. The `submit` and `leaderboard` commands are also runnable manually any time.

All API calls fail silently if unreachable (e.g. local `python -m http.server` preview); placeholders hide rather than sitting at `…`, and the leaderboard command prints "leaderboard unreachable" instead of erroring.

To deploy elsewhere:
- **GitHub Pages, Netlify, Vercel**: just point at the repo. The `wrangler.jsonc` and `.assetsignore` are harmless to other hosts (they'll just sit there unused).
- **Custom domain**: set in Cloudflare → project → Settings → Custom domains. Update `og:url` in `<head>` to match.

## QA / smoke testing

A Claude Code subagent at `.claude/agents/site-tester.md` runs an end-to-end smoke test of the site:
- Walks through every tab and checks expected content rendered
- Runs sample terminal commands
- Solves all 9 CTF challenges in order, verifies score increments
- Re-runs the nmap and SQLi leak guards (regression check — flags must not surface without the intended interaction)
- Tests mobile layout for horizontal overflow
- Greps `index.html` to confirm the obfuscated flags (#3, #4, #6, #8, #9) don't appear in source

Invoke from a Claude Code session as the `site-tester` subagent; reports a pass/fail summary by section. Use this after non-trivial edits to `index.html`, especially anything touching `CHALLENGES`, `COMMANDS`, page printers, or layout CSS.

## Stack reference (if going multi-file later)

- BeaverHacks's actual stack: Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, PostgreSQL + Prisma, Better Auth, Turborepo + pnpm.
- For a club site that needs auth, registration, persistent CTF leaderboards, this is a sensible blueprint.
- For just a homepage with built-in CTFs (what we have now), static HTML+CSS+JS is fine and zero-cost to host.

## Things to think about before changing

- **Removing the scanline overlay**: Edit `body::before` in CSS. Quick win if it's too intense for an audience.
- **Switching color schemes**: Change `--accent` and `--accent-dim` at `:root`. Try amber `#ffb454`, cyan `#5fd7ff`, or magenta `#d484ff`. Update the topbar logo + favicon if rebranding away from Oregon Tech.
- **Adding a backend** (beyond the existing tiny `src/worker.js`): Worth doing only if you need persistent per-user state (real leaderboards across browsers, accounts, real shells). The current Worker handles only an anonymous global counter. For more, lean toward CTFd self-hosted rather than building from scratch.
- **Updating Pyodide**: Test `python` and the CTF challenges that rely on it (#3, #4, #6) before merging.

## Credits

Visual design inspired by [BeaverHacks](https://beaverhacks.org/) (Oregon State Hackathon Club). Their open-source monorepo is at https://github.com/OregonStateHackathonClub/website.

Owl artwork: Oregon Tech Athletics ("Hootie the Owl" — modernized 2023). Used as topbar logo and favicon.
