# Data flows

What each part of Agent Console reads, writes and sends, as the code does it
at version 0.4.0. Every statement cites the file and line that does it. Where
the code cannot answer a question, the section says so.

The parts:

- **The console** (`agent-console`, no command): a local web page plus a hub
  that other machines may report to. [server.js](../../server.js)
- **The reporter** (`agent-console join | report | stop | leave`): runs on a
  machine that reports to someone's console. [lib/reporter.js](../../lib/reporter.js)
- **The collector**: the code both use to read transcripts and turn them into
  records. [lib/collector/](../../lib/collector/)
- **The installers and the join command**: [install.sh](../../install.sh),
  [install.ps1](../../install.ps1), and the check at the start of every printed
  command ([lib/invocation.js:54](../../lib/invocation.js#L54)).
- **The standalone executable**: Node.js with the package inside.
  [packaging/sea/main.cjs](../../packaging/sea/main.cjs)

## Outbound network destinations, all of them

A search of `server.js`, `bin/`, `lib/` and `public/` for `fetch(`,
`http.request`, `https.request`, `tls.connect`, `net.connect`, `WebSocket`,
`EventSource` and `sendBeacon` finds only the call sites below.

| From | To | When | What is sent | Where |
| --- | --- | --- | --- | --- |
| Console | `http://127.0.0.1:<port>` (itself, or an earlier copy) | A second start, to find out whether a console already runs there | A nonce challenge and an HMAC answer; never the key | [lib/hub/port.js:35](../../lib/hub/port.js#L35), [lib/hub/admin.js:272](../../lib/hub/admin.js#L272), [server.js:143](../../server.js#L143) |
| Reporter | The hub address in the join link, TLS | `join`: fetch the hub's certificate and compare its SHA-256 with the link's fingerprint | A TLS handshake only | [lib/collector/pinned.js:33-48](../../lib/collector/pinned.js#L33-L48) |
| Reporter | Same hub, TLS pinned to that certificate | `join` | The single-use join code, an optional machine name, and (on a rejoin) the previous device token | [lib/reporter.js:327-334](../../lib/reporter.js#L327-L334) |
| Reporter | Same hub, plain HTTP `GET /api/hello` | Only when the TLS probe above failed, to say "that is the console's own port" | No body, no credential | [lib/reporter.js:301-308](../../lib/reporter.js#L301-L308), [lib/reporter.js:319](../../lib/reporter.js#L319) |
| Reporter | Same hub, TLS pinned | Every report interval (default 10 s, [lib/reporter.js:57](../../lib/reporter.js#L57)) | Allowlisted usage records (below) with `Authorization: Bearer <device token>` | [lib/collector/transport.js:352-363](../../lib/collector/transport.js#L352-L363) |
| Reporter | Ports up to `REPORTER_SEARCH` either side of the hub's port, TLS | When the hub stops answering, to find it after it moved | A TLS handshake only; nothing is sent to a port whose certificate differs | [lib/reporter.js:497-507](../../lib/reporter.js#L497-L507) |
| Reporter | Same hub, TLS pinned, `POST /api/leave` | `leave` | The device token, to be removed | [lib/reporter.js:765-767](../../lib/reporter.js#L765-L767) |
| Standalone collector CLI | A URL the operator passes with `--post` | Only when run by hand as `node lib/collector/collector.js --post <url>` | The same allowlisted records, bearer token from `AGENT_CONSOLE_TOKEN` | [lib/collector/collector.js:859](../../lib/collector/collector.js#L859), [lib/collector/transport.js:72-80](../../lib/collector/transport.js#L72-L80) |
| Join command | `https://github.com/LockedinLabs-AI/agent-console/releases/download/v…/` | When a person runs a printed `join` command | Two HTTPS GETs: the release `.tgz` and `SHA256SUMS` | [lib/invocation.js:54](../../lib/invocation.js#L54) |
| `install.sh` / `install.ps1` | `https://github.com/LockedinLabs-AI/agent-console/releases/…` | When run | HTTPS GETs: `releases/latest` (unless a version is pinned), `SHA256SUMS`, the executable | [install.sh:23](../../install.sh#L23), [install.sh:71-72](../../install.sh#L71-L72), [install.ps1:37](../../install.ps1#L37), [install.ps1:67](../../install.ps1#L67) |
| Browser page | Its own origin only | Always | The console's API calls | CSP `default-src 'self'; connect-src 'self'` [lib/hub/http.js:27-30](../../lib/hub/http.js#L27-L30); service worker handles same-origin requests only [public/sw.js:21](../../public/sw.js#L21) |

**There is no telemetry, no update check and no crash reporting** in the
console, the reporter or the collector: no call site above reaches a
LockedIn Labs server or any third party. The console makes no outbound
connection other than to `127.0.0.1` ([lib/hub/port.js:35](../../lib/hub/port.js#L35),
[server.js:143](../../server.js#L143)). The only outbound connections a reporter
makes are to the hub named in its join link. The GitHub URLs in the page
([public/index.html:365](../../public/index.html#L365),
[public/join.html:56](../../public/join.html#L56)) are links a person may click;
nothing loads from them, and every answer carries `referrer-policy: no-referrer`
([lib/hub/http.js:37](../../lib/hub/http.js#L37)).

**No AI model is called.** The code contains no request to a model provider's
API. Model names appear only as data: the model id read from a transcript
([lib/collector/collector.js:304](../../lib/collector/collector.js#L304)) and the
published price table, whose `source` fields are citations, not endpoints
([lib/collector/prices.json](../../lib/collector/prices.json)).

**Not answerable from this code:**

- `npx`, when it runs the package, is npm's own program. With no
  dependencies there is nothing for npm to resolve, but whether npm contacts
  its configured registry (for example its own update notice) depends on npm
  and its configuration, not on this code. The standalone executable does not
  use npm.
- Node.js itself sends nothing on its own; this is Node's behaviour, not
  something this repository controls or tests.

## The console

**Listens on.** The console's page and API: `127.0.0.1` only, default port
6787 ([server.js:342](../../server.js#L342), [lib/config.js:18](../../lib/config.js#L18)).
The reporting port, where other machines join: the `--listen` address, default
`127.0.0.1` ([lib/config.js:17](../../lib/config.js#L17), [lib/config.js:123](../../lib/config.js#L123),
[server.js:344](../../server.js#L344)). Until someone starts it with
`--listen 0.0.0.0` (or another address), no other machine can reach either port.

**Reads.**

- Claude Code transcripts: `$CLAUDE_CONFIG_DIR/projects` (each entry of a
  comma-separated list), `~/.claude/projects`, `~/.config/claude/projects`.
  Codex transcripts: `$CODEX_HOME/sessions` and `archived_sessions`, or
  `~/.codex/sessions` and `~/.codex/archived_sessions`
  ([lib/collector/collector.js:65-93](../../lib/collector/collector.js#L65-L93)).
  `--claude-root` and `--codex-root` replace them; `--no-local` reads none
  ([lib/config.js:148-149](../../lib/config.js#L148-L149), [lib/config.js:164](../../lib/config.js#L164)).
  `--demo` reads nothing from the machine ([lib/config.js:113-115](../../lib/config.js#L113-L115)).
- The Git repositories that sessions worked in, with local `git log`,
  `git config --get user.email`, `git rev-parse`, `git symbolic-ref` and
  `git show-ref`; no command that contacts a remote
  ([lib/gitstats.js:28-40](../../lib/gitstats.js#L28-L40),
  [lib/gitstats.js:51](../../lib/gitstats.js#L51), [lib/gitstats.js:71-80](../../lib/gitstats.js#L71-L80),
  [lib/gitstats.js:99](../../lib/gitstats.js#L99)).
- Its own package files under `public/` ([server.js:48](../../server.js#L48)) and
  price table ([server.js:207](../../server.js#L207)).

On its own machine the console also keeps, for its own screen only, each
project's folder name and each session's Git branch; this map is never part
of a record and never sent ([lib/hub/local.js:1-12](../../lib/hub/local.js#L1-L12)).

**Writes** (default state directory `~/.agent-console/hub`,
[lib/config.js:162](../../lib/config.js#L162); directories are created mode 700,
files mode 600):

| File | Holds | Where |
| --- | --- | --- |
| `admin.key` | 32 random bytes; signs sessions and scrape tokens | [lib/hub/admin.js:52-62](../../lib/hub/admin.js#L52-L62) |
| `sessions.json` | HMAC verifiers of browser sessions, never the cookie | [lib/hub/admin.js:136](../../lib/hub/admin.js#L136) |
| `tls-cert.pem`, `tls-key.pem` | The hub's self-signed ECDSA P-256 certificate and key | [lib/hub/tls.js:83-105](../../lib/hub/tls.js#L83-L105) |
| `hub.json`, `devices.json` | Organisation id and salt; machines, with SHA-256 verifiers of tokens and join codes | [lib/hub/registry.js:128-129](../../lib/hub/registry.js#L128-L129), [lib/hub/registry.js:352](../../lib/hub/registry.js#L352) |
| `records-<day>.ndjson`, `daily-v1.json` | Usage records and daily rollups | [lib/hub/store.js:501](../../lib/hub/store.js#L501), [lib/hub/store.js:337](../../lib/hub/store.js#L337) |
| `names.json` | This machine's folder names and branches (above) | [lib/hub/local.js:29](../../lib/hub/local.js#L29) |
| `local/` | This machine's collector cursor and spool | [lib/hub/local.js:93-100](../../lib/hub/local.js#L93-L100) |
| `reporting.json` | The reporting port, so joined machines find it after a restart | [server.js:92](../../server.js#L92), [server.js:350](../../server.js#L350) |
| `interop-<scope>-generation.json` | Only with `--interop`: rotation state of scrape tokens | [lib/hub/interop-credentials.js:7](../../lib/hub/interop-credentials.js#L7) |

Usage is kept 8 days by default, at most 90 ([lib/config.js:19](../../lib/config.js#L19),
[lib/config.js:130-132](../../lib/config.js#L130-L132)).

**Runs.** The platform's browser opener, when `--open` is given
([server.js:85-89](../../server.js#L85-L89)); `git` as above; and, only with
`--desktop-alerts`, the platform's notifier (`osascript`, PowerShell or
`notify-send`) with a fixed message ([lib/config.js:165](../../lib/config.js#L165),
[lib/hub/alerts.js:11-28](../../lib/hub/alerts.js#L11-L28)).

**What the browser receives.** Every JSON answer passes credential redaction
first ([lib/hub/http.js:52-58](../../lib/hub/http.js#L52-L58),
[lib/redact.js](../../lib/redact.js)). The page loads nothing from any other
origin ([lib/hub/http.js:27-30](../../lib/hub/http.js#L27-L30)).

## Presenting mode

Presenting (the `P` key) replaces every project, branch, machine and person
name on screen with a stable stand-in ("project A", "machine 1"), hides the
restart command, and keeps figures, states and times as they are
([public/console.js:176-190](../../public/console.js#L176-L190),
[public/console.js:2105-2128](../../public/console.js#L2105-L2128)).

It is a display mode **in the browser**. The server sends the same data with
it on or off, so real names are still in the page's memory and network
responses (readable in developer tools). For a screen that must not contain
real names at all, start the console with `--demo`, which reads nothing from
the machine ([lib/config.js:113-115](../../lib/config.js#L113-L115)).

## What a joined machine sends to a hub

**Transport and authentication.** A join link carries the hub's address, a
single-use code that lives at most an hour, and the SHA-256 fingerprint of the
hub's certificate ([lib/reporter.js:175-197](../../lib/reporter.js#L175-L197),
[lib/hub/registry.js:39](../../lib/hub/registry.js#L39),
[lib/hub/registry.js:268](../../lib/hub/registry.js#L268)). The reporter
accepts that certificate and no other, on every connection
([lib/collector/pinned.js:57-69](../../lib/collector/pinned.js#L57-L69)). The hub
answers the join with a device token (`acd_` and 32 random bytes,
[lib/hub/registry.js:318](../../lib/hub/registry.js#L318)), which every later
request carries as a bearer token
([lib/collector/transport.js:363](../../lib/collector/transport.js#L363)). The hub
refuses joins, reports and leaves over plain HTTP
([lib/hub/routes.js:212-218](../../lib/hub/routes.js#L212-L218)) and callers
outside private address ranges unless started with `--allow-public`
([lib/hub/routes.js:190-196](../../lib/hub/routes.js#L190-L196)). The TLS listener
requires TLS 1.2 or later ([server.js:314](../../server.js#L314)).

**What a record contains.** Exactly these fields, built by one allowlist
([lib/collector/collector.js:294-327](../../lib/collector/collector.js#L294-L327)):
record id, tool (`claude-code` or `codex`), model id, session hash, parent
session hash, whether it is a subagent, project hash, an optional project
label, the minute, a reporting-device id, an execution-origin hash, token
counts (fresh, output, cache write, cache read, 5-minute and 1-hour cache
writes), cache TTL kind, price tier, and two flags. Hashes are HMAC-SHA-256
under the organisation's salt ([lib/collector/collector.js:96](../../lib/collector/collector.js#L96));
project hashes are keyed by a key only that machine holds
([lib/reporter.js:364-371](../../lib/reporter.js#L364-L371)). No prompt, reply,
file path, file content, command or tool argument is in a record. The hub
refuses any record that is not exactly this shape
([lib/hub/store.js:67](../../lib/hub/store.js#L67),
[lib/collector/transport.js:82](../../lib/collector/transport.js#L82)).

**Opt-in, per run.** Each of these is off unless its flag is given on that
run ([lib/reporter.js:90-100](../../lib/reporter.js#L90-L100)):

- `--share-project-names`: a project folder's last name, reduced to
  `[a-z0-9-]`, never its path ([lib/reporter.js:381-401](../../lib/reporter.js#L381-L401)).
- `--share-alerts`: alert kind, minute, a salted session hash and one count.
- `--share-tool-activity`: tool calls per minute by kind (read, edit, shell,
  search, web, agent, mcp, other) and error counts; never a tool's name,
  arguments or output ([lib/reporter.js:524-547](../../lib/reporter.js#L524-L547)).

**Reporter files** (default `~/.agent-console/reporter`,
[lib/reporter.js:199-201](../../lib/reporter.js#L199-L201)): `credentials.json`
with the device token (mode 600, [lib/reporter.js:211-221](../../lib/reporter.js#L211-L221)),
`devices/<id>/` with the enrolment, `project.key`, the collector's cursor and
spool, `reporter.lock`, and `reporter.log` when run with `--background`
([lib/reporter.js:742-745](../../lib/reporter.js#L742-L745)). `leave` deletes
the credentials, the enrolment and the log
([lib/reporter.js:717-719](../../lib/reporter.js#L717-L719)).

## The policy command

`agent-console policy apply` writes Claude Code project files into a
repository: `.claude/settings.json` (backed up first),
`.claude/agent-console-policy.json`, `.claude/hooks/` and `.claude/agents/`
([lib/policy/cli.js:117-147](../../lib/policy/cli.js#L117-L147)). The hook it
installs makes no network call ([lib/policy/hook.mjs:2](../../lib/policy/hook.mjs#L2))
and appends each decision (time, rule, action) to
`~/.agent-console/policy/<hash>/decisions.ndjson`
([lib/policy/hook.mjs:15-23](../../lib/policy/hook.mjs#L15-L23)).

## Installers, the join command and the executable

- `install.sh` puts one file in `~/.local/bin` (or `$XDG_BIN_HOME`, or
  `AGENT_CONSOLE_INSTALL_DIR`), only if its SHA-256 matches `SHA256SUMS`
  ([install.sh:71-94](../../install.sh#L71-L94)). No root, no system directory.
- `install.ps1` puts one file in `%LOCALAPPDATA%\Programs\AgentConsole` and adds
  that folder to the user's own PATH unless `AGENT_CONSOLE_NO_MODIFY_PATH=1`
  ([install.ps1:75](../../install.ps1#L75), [install.ps1:95](../../install.ps1#L95)).
  No administrator rights.
- The join command downloads the release `.tgz` and `SHA256SUMS`, refuses to
  run a file whose SHA-256 differs, keeps the file in
  `~/.agent-console/releases` and runs it with `npx`
  ([lib/invocation.js:54](../../lib/invocation.js#L54)).
- The standalone executable unpacks the package it carries into the user's
  cache folder (`~/Library/Caches/agent-console`, `$XDG_CACHE_HOME/agent-console`
  or `%LOCALAPPDATA%\agent-console\Cache`), checks every file's SHA-256, and
  fetches nothing ([packaging/sea/main.cjs:2-14](../../packaging/sea/main.cjs#L2-L14),
  [packaging/sea/main.cjs:27-34](../../packaging/sea/main.cjs#L27-L34)).

## Running fully offline

1. Get the release files on a connected machine, verify them (see
   [SECURITY.md](../../SECURITY.md#verifying-a-download)) and copy them in: the
   standalone executable, or the `.tgz` and Node.js 22 or newer.
2. Run the executable, or `node <unpacked package>/bin/agent-console.mjs`.
   Neither makes an outbound connection beyond `127.0.0.1` (above).
3. To connect other machines on the same isolated network, start the console
   with `--listen <address>` and have each machine run the package it already
   has with `join '<link>'`: `agent-console join '<link>'` makes connections
   only to the hub in the link. (The printed join command, by contrast,
   downloads the package from GitHub first; on an isolated network use the
   installed copy.)

Mode 600 and 700 apply on macOS and Linux. On Windows, Node.js does not apply
these modes; the files take the permissions of the user's profile folder.
This is Node.js behaviour, not something this code sets.
