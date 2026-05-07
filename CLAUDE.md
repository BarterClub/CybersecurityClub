# Project: [Club Name] Website

> This file is read by Claude Code at the start of every session in this folder.
> It captures the project's intent, architecture, and conventions so you don't have to re-explain.

## Overview

A single-file HTML website for a student cybersecurity / CTF club. Terminal-aesthetic UI inspired by [beaverhacks.org](https://beaverhacks.org/). Includes a working in-browser command terminal, simulated system stats, animated UI, SPA-style navigation, and a 7-challenge CTF mode with a real Python REPL.

## Architecture

- **Single-file**: All HTML, CSS, and JS live in `index.html` (~970 lines).
- **No build step**: Pure static HTML. Open directly in a browser, or serve with any static server.
- **One runtime dependency**: [Pyodide](https://pyodide.org) (loaded lazily from jsDelivr CDN when the `python` command is first used; ~10MB).
- **Future direction (open)**: Could be split into multiple files, or evolve into a Next.js app. Reference architecture: [`OregonStateHackathonClub/website`](https://github.com/OregonStateHackathonClub/website) — Next.js 15 + Tailwind v4 + shadcn/ui + Prisma + Better Auth, monorepo via Turborepo + pnpm.

## Local preview

```bash
# Easiest — just open it
open index.html         # macOS
xdg-open index.html     # Linux

# Proper local server (recommended for testing Pyodide / fetch behavior)
python3 -m http.server 8000
# → http://localhost:8000
```

## Key components in `index.html`

### Layout
- **Top bar**: Tabs for `home / about / events / contact / ctf`. Tabs swap content via `switchTab(name)` — they don't navigate to separate pages.
- **Three-column grid**: left (system widgets), center (page content + terminal), right (club info + processes + system).
- **Bottom**: Sponsors, quick links, recent-activity log, vim-style status bar.

### Terminal engine
- Lives in the `<script>` block.
- The `COMMANDS` object is the source of truth — every command is `{ desc, run(args) }`.
- Adding a command means adding one entry; it auto-shows in `help` and is tab-completable. No other registration needed.
- The `out(html, cls)` helper writes a line to terminal output. **It uses `innerHTML`** so commands can emit styled markup (`<span class="term-out-info">`). User input is escaped via `escapeHtml()` before display — don't bypass this.

### CTF system
- `CHALLENGES` array defines all challenges.
- **Flags are stored as FNV-1a hashes**, not plaintext. `flag <text>` hashes the submission and looks it up. This keeps casual View-Source from spoiling the answers while still allowing legitimate solving.
- To add a flag: `hash: fnv1a('flag{your_flag_here}')`.
- Hidden clues are scattered through the source — see "Things to be careful about" below.

### Pyodide
- Lazy-loaded the first time `python` or `py` is invoked.
- Pinned to `v0.26.4`. Updating requires testing — the API moves occasionally.
- Loaded from `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/`.

### Simulated stats
- CPU / RAM / disk / network are intentionally fake (random walks via `jitter()`).
- This is an **aesthetic choice**, not a limitation. No real sites expose `/proc/stat` data.
- If you ever want real metrics, you'd need a backend.

## Placeholders to swap

Search the file for these and replace:

| Placeholder | What it is |
|---|---|
| `[YOUR CLUB]` | Club display name |
| `[your-club]` | Lowercase / URL-friendly version |
| `[YEAR]`, `[N]`, `[Day]`, `[Time]` | Generic numeric/text placeholders |
| `[Building / Room]` | Meeting location |
| `[Sponsor 1]`, `[Sponsor 2]`, ... | Sponsor names (replace `<div class="sponsor-slot">` with `<img>` when you have logos) |
| `discord.gg/EXAMPLE` | Discord invite |
| `github.com/EXAMPLE` | Club GitHub org |
| `instagram.com/EXAMPLE` | Instagram |
| `club@example.edu` | Officer email |
| `[Date]` in event cards | Specific event dates |
| ASCII art block | Generate at https://patorjk.com/software/taag (use the "Slant" font to match BeaverHacks style) |

## Design conventions

- **Color palette in CSS variables**: All colors live at `:root`. To rebrand, change `--accent` (primary), `--warn` (amber accents), and `--info` (blue accents). Don't sprinkle hex values around the file.
- **Monospace throughout**: JetBrains Mono. Don't introduce sans-serif unless there's a clear reason.
- **CRT scanlines**: `body::before` overlay. Some find it intense — easy to remove if needed.
- **No `localStorage`**: CTF progress is in-memory only (resets on reload). If adding localStorage, account for the fact that progress will now persist across reloads but not across browsers / incognito.
- **Animations are intentional**: Stat shimmers, panel fade-ins, blinking cursor, typing intro — these are part of the aesthetic, not gratuitous.

## Things to be careful about

These are the hidden flags that make the CTF work. **Don't remove them without updating `CHALLENGES`:**

| # | Where it's hidden | What to look for |
|---|---|---|
| 1 (recon) | HTML comment near the top of `<head>` | `flag{html_recon_is_step_one}` |
| 2 (console) | `console.log()` call near the CTF state setup | `flag{console_log_is_loud}` |
| 5 (obfuscation) | `_x1` … `_x6` JS variables, concatenated to `_motto` | `flag{string_concat_is_weak_obfuscation}` |
| 7 (steganography) | `<body data-z="...">` attribute (base64-encoded) | `flag{css_data_attrs_are_visible}` |

Challenges 3 (base64), 4 (rot13), and 6 (xor) are presented in the terminal itself when the user runs `ctf start <n>`.

Other things:
- Pyodide version is pinned. Don't bump it without smoke-testing the `python` command afterward.
- `escapeHtml()` is the firewall between user input and the DOM. If you add a command that handles user-controlled strings, escape them.
- `term.scrollTop = term.scrollHeight` after `out()` keeps the terminal scrolled to bottom. Already handled by `out()`, but worth knowing.

## How to add a new CTF challenge

1. Pick a hiding spot for the flag (HTML comment, JS variable, encoded attribute, image metadata, etc.).
2. Add an entry to the `CHALLENGES` array:
   ```js
   { id: 8,
     name: 'your_challenge_name',
     points: 150,
     brief: 'What the player sees when they run `ctf start 8`',
     hint: 'What they see when they run `hint 8`',
     hash: fnv1a('flag{your_actual_flag}') }
   ```
3. (Optional) Add the challenge to the listing in `<div class="page" id="page-ctf">` for visibility.
4. Test: open the file, run `ctf start 8`, confirm the brief shows; submit `flag flag{your_actual_flag}` and confirm it scores.

## How to add a new terminal command

Add an entry to `COMMANDS`:
```js
projects: {
  desc: 'Show our current projects',
  run: (args) => {
    out('CURRENT PROJECTS', 'warn');
    out('  • Project 1');
    out('  • Project 2');
  }
}
```
That's it. It'll appear in `help` and tab-complete. The `args` parameter is the rest of the line split on whitespace. If `run` is `async`, the executor awaits it (used for the `python` command).

## Stack reference (if going multi-file later)

- BeaverHacks's actual stack: Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui, PostgreSQL + Prisma, Better Auth, Turborepo + pnpm.
- For a club site that needs auth, registration, persistent CTF leaderboards, this is a sensible blueprint.
- For just a homepage with built-in CTFs (what we have now), single-file static is fine and zero-cost to host.

## Things to think about before changing

- **Removing the scanline overlay**: Edit `body::before` in CSS. Quick win if it's too intense for an audience.
- **Switching color schemes**: Change `--accent` and `--accent-dim` at `:root`. Try amber `#ffb454`, cyan `#5fd7ff`, or magenta `#d484ff`.
- **Hosting**: GitHub Pages, Cloudflare Pages, Netlify, Vercel — all free for a static HTML file. Just push and point.
- **Adding a backend**: Means leaving the single-file model. Worth doing only if you need persistent state (leaderboards, accounts, real shells). Otherwise stay static.

## Credits

Visual design inspired by [BeaverHacks](https://beaverhacks.org/) (Oregon State Hackathon Club). Their open-source monorepo is at https://github.com/OregonStateHackathonClub/website.
