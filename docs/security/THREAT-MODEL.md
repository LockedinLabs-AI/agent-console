# Threat model

## Native account capacity

Account profiles are opt-in, local metadata. Their HTTP routes require the
existing signed-in cookie, intent header and loopback Host/connection; browser
Origins are additionally checked against the exact console origin. None of
these routes exists on the reporting listener. Profile IDs are bounded slugs;
native homes must be existing absolute directories. State files use private
permissions and quota replacement is atomic. Native homes are absent from
quota responses and appear only in the authenticated setup response.

The Codex reader starts the installed executable from an absolute PATH entry,
uses an explicit native home, bounded output, a timeout, and only initialization
plus the account-limit read method. It does not start a model turn. Raw stderr,
responses and provider errors are not logged or returned to the browser. A
failed read invalidates selection rather than reusing its last successful
state. Native CLI configuration and the local OS account remain trusted: the
console does not attest to the identity behind a profile or sandbox a user's
installed executable.

The Claude status-line command allowlists quota fields and discards the rest.
No OAuth credential file, password, API key or browser session is imported.
The launcher changes the native home only at process start. It never rotates
accounts mid-session, consumes reset credits, or bypasses provider limits.

Agent Console 0.4.x. What it protects, from whom, how, and what is left. The
data flows this rests on are in [DATA-FLOWS.md](DATA-FLOWS.md); the reporting
process is in [SECURITY.md](../../SECURITY.md).

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| AI coding-agent transcripts (prompts, replies, commands, file contents) | The user's own `~/.claude`, `~/.codex` folders | The most sensitive thing on the machine. Agent Console reads them and must never move them. |
| Usage metadata (token counts, model ids, minutes, salted hashes) | Reporter spool, hub `records-<day>.ndjson` | What the product exists to move. Reveals activity patterns and spend, not content. |
| Project folder names, full project paths and Git branches | Hub's own `names.json`, for its own machine only; a reporter sends only a folder's last name, and only with `--share-project-names` | Can reveal client or project names, and a path can reveal the user name. |
| Console key (`admin.key`) and browser sessions | Hub state directory | Whoever holds them controls the console: can make join links and remove machines. |
| Device tokens | Reporter `credentials.json`; hub keeps SHA-256 verifiers only | Let a machine report as itself. |
| Hub TLS private key | Hub `tls-key.pem` | Whoever holds it can impersonate the hub to its reporters. |
| The release artifacts | GitHub releases, npm, GHCR | A tampered artifact runs as the user on every machine that installs it. |

## Trust boundaries

1. **The local user account.** Everything runs as the user who starts it; no
   component asks for administrator rights ([docs/uninstall.md](../uninstall.md)).
   Other processes running as the same user are inside this boundary: they
   can already read the transcripts and the state directory.
2. **Loopback.** The console's page and API accept only loopback connections
   with a loopback `Host` and no proxy headers
   ([lib/hub/routes.js:90-100](../../lib/hub/routes.js#L90-L100),
   [lib/hub/routes.js:509-512](../../lib/hub/routes.js#L509-L512)); every call
   that reads or changes data also needs a sign-in cookie
   ([lib/hub/admin.js:1-33](../../lib/hub/admin.js#L1-L33),
   [lib/hub/routes.js:619](../../lib/hub/routes.js#L619)). The calls answered
   before that check return no data: the product name and version, the key
   challenge and ticket of a second start, a request to print a sign-in link
   in the console's own window, and sign out
   ([lib/hub/routes.js:571-617](../../lib/hub/routes.js#L571-L617)).
3. **The local network.** Only the reporting port crosses it, and only when the
   console is started with `--listen` ([lib/config.js:123](../../lib/config.js#L123)).
4. **Between a reporter and its hub.** TLS pinned to the certificate named in
   the join link ([lib/collector/pinned.js](../../lib/collector/pinned.js)).
5. **Between the project and its users: the supply chain.** GitHub (source,
   CI, releases), npm and GHCR.
6. **Transcript content entering the console's UI.** Text in a transcript is
   attacker-influenced (a web page an agent read, a repository it cloned) and
   is rendered in the browser.

## Adversaries and what stops them

### A process or person as the same local user

Out of scope as an attacker: they can read the transcripts directly. The
console does not defend against them and says so
([SECURITY.md](../../SECURITY.md), "Local files"). What it does: state files
are mode 600 in 700 directories on macOS and Linux
([lib/hub/admin.js:59-62](../../lib/hub/admin.js#L59-L62),
[lib/hub/tls.js:100-103](../../lib/hub/tls.js#L100-L103),
[lib/reporter.js:216-222](../../lib/reporter.js#L216-L222)); state records are
read by descriptor, refusing symlinks and swapped files
([lib/hub/state-file.js](../../lib/hub/state-file.js)).

### Another local user, a local web page, or a local program on another port

- A web page in the user's browser cannot read or change the console's data:
  apart from `GET /api/hello` (product name and version), every API call needs
  the `X-Agent-Console: 1` header, which a page on another origin cannot send
  without a preflight the console never grants
  ([lib/hub/routes.js:575-578](../../lib/hub/routes.js#L575-L578)); every call
  that reads or changes data needs the sign-in cookie, which is
  `HttpOnly; SameSite=Strict`
  ([lib/hub/admin.js:212](../../lib/hub/admin.js#L212)), and a loopback `Host`,
  which defeats DNS rebinding ([lib/hub/routes.js:90-96](../../lib/hub/routes.js#L90-L96)).
- A program that takes the console's port first learns nothing: a second
  start proves it holds the key by HMAC challenge, and opens the browser only
  on a console that proved itself ([server.js:119-186](../../server.js#L119-L186),
  [lib/hub/admin.js:24-33](../../lib/hub/admin.js#L24-L33)).
- Residual: a browser sends a `127.0.0.1` cookie to every port on that
  address, so another local web server the user visits can see it. It is
  random per browser, expires in 30 days and ends with Sign out
  ([lib/hub/admin.js:44](../../lib/hub/admin.js#L44)).

### An attacker on the same network

- The console's page and API are never on the network, whatever `--listen`
  says ([server.js:348](../../server.js#L348)).
- The reporting port answers only private addresses unless `--allow-public`
  ([lib/hub/routes.js:190-196](../../lib/hub/routes.js#L190-L196)).
- Joins, reports and leaves are refused over plain HTTP
  ([lib/hub/routes.js:212-218](../../lib/hub/routes.js#L212-L218)); TLS 1.2+
  ([server.js:320](../../server.js#L320)).
- A reporter accepts only the certificate whose fingerprint is in its join
  link, on every connection ([lib/collector/pinned.js:68-80](../../lib/collector/pinned.js#L68-L80)),
  so a machine that answers at the hub's address gets no code, no token and
  no record.
- Join codes are 128 random bits in a link (or eight characters typed), single
  use, at most an hour ([lib/hub/registry.js:268](../../lib/hub/registry.js#L268),
  [lib/hub/registry.js:39](../../lib/hub/registry.js#L39)); attempts are
  rate-limited per address and in total ([lib/hub/routes.js:37-39](../../lib/hub/routes.js#L37-L39)).
- The join page itself is plain HTTP and can be altered in transit. The
  command it shows starts with a check whose SHA-256 is published, and the
  console's own **Add a machine** hands out the command built on the hub's
  computer ([SECURITY.md](../../SECURITY.md), "The join page").
- Residual: someone who can see the join link before it is used (it travels
  over whatever channel the console's owner chose) can join once in its place.
  The console shows every machine that joined and **Remove** revokes it.

### A malicious or compromised hub (a reporter joined to the wrong console)

- What it can get: the allowlisted usage metadata of the machines that joined
  it ([lib/collector/collector.js:305-338](../../lib/collector/collector.js#L305-L338)).
  It cannot ask for more: the reporter has no request the hub can make it
  answer, and project hashes use a key the hub never has
  ([lib/reporter.js:383-390](../../lib/reporter.js#L383-L390)).
- What it sends back is checked before use: identifiers must match their
  exact pattern, so none can steer a file path, and text is stripped of
  control characters before printing
  ([lib/reporter.js:108-111](../../lib/reporter.js#L108-L111),
  [lib/reporter.js:360-365](../../lib/reporter.js#L360-L365)). Responses are
  capped at 1 MiB ([lib/collector/pinned.js:20](../../lib/collector/pinned.js#L20)).

### A malicious reporter (a machine that joined, then misbehaves)

- Every record must have the exact shape; anything else is refused before
  storage ([lib/hub/store.js:67](../../lib/hub/store.js#L67),
  [lib/collector/transport.js:82](../../lib/collector/transport.js#L82)).
- Rate-limited to 600 batches a minute and 250,000 records a day
  ([lib/hub/routes.js:37](../../lib/hub/routes.js#L37),
  [lib/hub/store.js:77](../../lib/hub/store.js#L77)); bodies over 4 MiB are refused.
- It can report false numbers for itself. The console shows figures as
  reported by that machine; nothing can prove a reporter's counts are true.

### Malicious content in a transcript, rendered in the UI

- Content security policy: scripts only from the console's own origin, no
  inline script, no framing, no form posts
  ([lib/hub/http.js:27-30](../../lib/hub/http.js#L27-L30)).
- Values are HTML-escaped before they are put in markup
  ([public/console.js:65](../../public/console.js#L65)).
- Credential-shaped strings are masked on the server before the browser
  receives them ([lib/hub/http.js:52-58](../../lib/hub/http.js#L52-L58),
  [lib/redact.js](../../lib/redact.js)).
- Residual: an escaping mistake a future change introduces. CodeQL (extended
  queries) runs on every change and no alert is open in runtime code
  ([SSDF.md](SSDF.md), RV.1); the CSP is the backstop for any escape that is
  missed.

### A compromised supply chain (GitHub, npm, CI, a dependency)

- The package has no runtime or development dependencies
  ([package.json](../../package.json)); the only build-time dependency
  (postject, for the executables) is pinned by lockfile and installed with
  `--ignore-scripts` ([.github/workflows/binaries.yml](../../.github/workflows/binaries.yml)).
- Every workflow action is pinned to a full commit SHA; workflows are
  read-only by default and elevate per job ([.github/workflows/](../../.github/workflows/)).
- A release builds only from a tag on `main` whose required checks passed
  ([scripts/release-source-check.mjs](../../scripts/release-source-check.mjs));
  release tags cannot be moved or deleted (repository ruleset).
- Every release file is in `SHA256SUMS` and carries a signed build provenance
  attestation and a CycloneDX SBOM attestation
  ([.github/workflows/release.yml](../../.github/workflows/release.yml)). The
  installers and the join command refuse a file whose SHA-256 differs
  ([install.sh:71-89](../../install.sh#L71-L89),
  [lib/invocation.js:54](../../lib/invocation.js#L54)). npm receives the exact
  attested file, with npm provenance
  ([.github/workflows/npm-publish.yml](../../.github/workflows/npm-publish.yml)).
- Secrets scanning with push protection, gitleaks in CI, CodeQL, Dependabot
  and OpenSSF Scorecard run on the repository.
- Residual: `SHA256SUMS` comes from the same GitHub release as the file, so it
  proves integrity against corruption and mirror tampering, not against a
  compromised GitHub account; the attestations (`gh attestation verify`) are
  the check that ties a file to this repository's workflow.

## STRIDE by component

| Component | Spoofing | Tampering | Repudiation | Information disclosure | Denial of service | Elevation of privilege |
| --- | --- | --- | --- | --- | --- | --- |
| Console (loopback page and API) | Sign-in cookie + loopback Host + no proxy headers ([routes.js:509](../../lib/hub/routes.js#L509)) | Same; state files mode 600 | Joins and leaves are printed as they happen ([server.js:296-302](../../server.js#L296-L302)); no persistent audit log of console actions | Loopback only ([server.js:348](../../server.js#L348)); redaction ([http.js:52-58](../../lib/hub/http.js#L52-L58)) | Local only | Runs as the user; no privileged operation |
| Reporting listener (hub) | Device tokens, SHA-256 verifiers ([registry.js:352](../../lib/hub/registry.js#L352)) | TLS; exact record shape | Per-device records keyed by device id | Private addresses only by default ([routes.js:190-196](../../lib/hub/routes.js#L190-L196)) | Join, ingest and bad-token rate limits ([routes.js:37-39](../../lib/hub/routes.js#L37-L39)); body caps; socket timeouts ([server.js:322-327](../../server.js#L322-L327)) | Serves only join and ingest routes ([routes.js:1-20](../../lib/hub/routes.js#L1-L20)) |
| Reporter | Pinned hub certificate ([pinned.js:68-80](../../lib/collector/pinned.js#L68-L80)) | Response validation ([reporter.js:360-365](../../lib/reporter.js#L360-L365)) | Local `reporter.log` in background mode | One allowlist for what leaves ([collector.js:305-338](../../lib/collector/collector.js#L305-L338)); opt-ins per run | Bounded retries ([transport.js](../../lib/collector/transport.js)) | Runs as the user |
| Collector | n/a | Reads transcripts read-only; spool mode 600 | n/a | Salted HMAC hashes ([collector.js:96](../../lib/collector/collector.js#L96)) | Bounded by retention window | n/a |
| Installers / join command | HTTPS to github.com | SHA-256 check before install or run | n/a | n/a | n/a | User directories only; no admin ([install.sh:91-94](../../install.sh#L91-L94), [install.ps1:75](../../install.ps1#L75)) |
| Release pipeline | OIDC-signed attestations | Pinned actions; tag ruleset; no `--clobber` | Attestations record workflow, commit and run | Public logs print no secret or certificate name | n/a | Per-job permissions |

## Residual risks, stated plainly

- **Windows executables are not code-signed.** There is no Authenticode
  certificate. SmartScreen may warn and Smart App Control refuses the file.
  Use `install.ps1` (which checks `SHA256SUMS`) or the npm package, and verify
  with `gh attestation verify`.
- **Single maintainer.** One person holds admin rights and owns every path
  (`.github/CODEOWNERS`). There is no second reviewer on changes, and `main`
  does not require reviews or signed commits. Required status checks gate
  every merge except an administrator's, since branch protection does not
  apply to administrators; a release is still refused unless its commit
  passed CI ([scripts/release-source-check.mjs](../../scripts/release-source-check.mjs)).
- **Dismissed CodeQL alerts.** Some code-scanning alerts are dismissed rather
  than fixed: in runtime code, where the flagged value comes only from the
  operator (the hub they joined, their own credentials file or environment) or
  the certificate check is replaced by pinning on purpose; elsewhere, in tests
  and maintainer-only release scripts. Each carries a one-sentence reason in
  the repository's code-scanning history.
- **Presenting mode is display-only.** Real names still reach the browser
  ([DATA-FLOWS.md](DATA-FLOWS.md#presenting-mode)). Use `--demo` for screens
  that must not contain them.
- **No at-rest encryption.** State files rely on file permissions (mode 600 on
  macOS and Linux; the user profile's ACL on Windows), not encryption. Use
  full-disk encryption, as for the transcripts themselves.
- **Self-signed hub certificate.** There is no certificate authority; trust
  comes from the fingerprint in the join link, so the link's channel matters.
- **The join page is plain HTTP.** Mitigated as described above, not removed.
- **No persistent audit log** of console actions (who made a join link, who
  removed a machine); joins and leaves are printed to the console's terminal.
