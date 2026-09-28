# Security

## Reporting a vulnerability

Report it privately through GitHub Security Advisories:
[**Security → Report a vulnerability**](https://github.com/LockedinLabs-AI/agent-console/security/advisories/new).
Only the maintainers can read the report, and the advisory is where the fix and
the disclosure are coordinated. Please do not open a public issue for a
vulnerability.

Include the affected version (the console's footer shows it), your operating
system and Node.js version, and a reproduction that uses synthetic data. Never
include real transcripts, device tokens, join links or codes, credentials or
customer data. `--demo` is useful for reproductions and screenshots.

## What happens after you report

These are targets, not contractual commitments:

| Step | Target |
| --- | --- |
| We confirm we have your report | 2 business days |
| We tell you whether we can reproduce it, and how severe we think it is (CVSS) | 5 business days |
| A fixed release for a critical or high-severity issue | 30 days |
| A fixed release for anything else | 90 days |

We keep you updated in the advisory until it is fixed, credit you in the
release notes unless you would rather we didn't, and publish the advisory
when the fixed release is out. If a fix will take longer than these times, we
say why in the advisory and agree a disclosure date with you.

## Supported versions

| Version | Security fixes |
| --- | --- |
| 0.4.x | Yes |
| Earlier | No: upgrade to the latest 0.4 release |

Fixes go into a new patch release of the supported line. Please reproduce on
the latest release before you report.

## Scope

In scope: the code in this repository, the files attached to its GitHub
releases (the npm package, the standalone executables and their archives,
`SHA256SUMS`, the SBOMs), the `@lockedinlabs/agent-console` npm package and the
team hub image on GHCR, and the installers (`install.sh`, `install.ps1`).

Out of scope: attacks that need code already running as the same user on the
same computer (it can read the agents' transcripts directly); Claude Code,
Codex and other tools whose transcripts the console reads; denial of service
by volume against a hub deliberately exposed with `--allow-public`; and
findings in the website (`site/`) that do not affect the product.

## Verifying a download

Every file on a release is listed in its `SHA256SUMS` and has a signed build
provenance attestation. From 0.4.1 on, each also has a CycloneDX SBOM on the
release page (`*.cdx.json`), attested against the files it describes.

```sh
# 1. The SHA-256 matches the release's SHA256SUMS
shasum -a 256 -c SHA256SUMS --ignore-missing                     # macOS, Linux
Get-FileHash agent-console-win32-x64.exe                         # Windows: compare by eye

# 2. It was built by this repository's release workflow (GitHub CLI)
gh attestation verify agent-console-darwin-arm64 -R LockedinLabs-AI/agent-console

# 3. Its SBOM is the one the release workflow attested
gh attestation verify agent-console-darwin-arm64 -R LockedinLabs-AI/agent-console \
  --predicate-type https://cyclonedx.org/bom

# 4. macOS: signed with a Developer ID and notarized
codesign --verify --strict --verbose=2 agent-console-darwin-arm64
spctl --assess --type install -vv agent-console-darwin-arm64     # "source=Notarized Developer ID"
```

`install.sh` and `install.ps1` perform step 1 themselves and install nothing
that does not match. The Windows executable is not code-signed: steps 1 to 3
are its checks. The hub image's digest is attested too:
`gh attestation verify oci://ghcr.io/lockedinlabs-ai/agent-console:v<version> -R LockedinLabs-AI/agent-console`.

## Security documentation

- [Data flows](docs/security/DATA-FLOWS.md): what each part reads, writes and
  sends, with the code that does it.
- [Threat model](docs/security/THREAT-MODEL.md): assets, trust boundaries,
  mitigations and residual risks.
- [NIST SSDF self-assessment](docs/security/SSDF.md), with the SLSA build level.
- [Enterprise security FAQ](docs/security/ENTERPRISE-FAQ.md): the questions a
  security review asks, answered.

## How the console is protected

**Metadata only.** What leaves a machine is token counts, model ids, minutes and
hashes. One allowlist decides that (`projectRecord` in
`lib/collector/collector.js`), and an end-to-end test checks every request that
crosses the wire.

**Two listeners.** The console (its pages, its data, making join links,
removing machines) listens on 127.0.0.1 only, on its own port. Every console
request needs a loopback connection with a loopback Host header (which also
defeats DNS rebinding) and no proxy headers (`Forwarded`, `X-Forwarded-For`,
`Via` and the like are refused), and every API call that reads or changes data
also needs the sign-in cookie. The few calls that answer before the cookie
check return no data: the product name and version, the key challenge a
second start answers, a request to print a new sign-in link in the console's
own window, and sign out. Other machines talk to a
second port, which serves only the join page, the join exchange and
token-checked reporting. Nothing of the console is on it, whatever `--listen`
says.

When `--interop` is enabled, its loopback `/metrics` and telemetry ingest
paths require separate read and ingest bearer credentials. Domain-separated
HMACs under the console key are printed by `metrics-token --scope read|ingest`
to the user who can read that key and compared in constant time. `--rotate`
revokes one scope immediately without changing the other scope or browser
sessions. Corrupt rotation state refuses access; protect generation files
alongside the key because deleting them restores initial credentials. The
console key itself, wrong-scope credentials and sign-in cookies are refused
there (`401`). Ingest also requires
`X-Agent-Console-Interop: 1` and rejects browser `Origin` headers. These paths are disabled without `--interop` and never
appear on the reporting listener.

**Signing in.** The console makes a random key on first start (`admin.key` in
its state directory, mode 600). A single-use sign-in link, printed at start and
opened by `--open`, starts a session for that browser: a random id in an
HttpOnly, SameSite=Strict cookie that lasts 30 days. The console keeps only a
verifier of each session (an HMAC under the key, in `sessions.json`, mode 600);
**Sign out** ends one, and a new key ends them all. Each state directory's
cookie has a name of its own, so two consoles on one computer do not share or
overwrite it. A browser sends a 127.0.0.1 cookie to every port on that address,
so another local web server you visit can see it; that is why it is random per
browser, ends with **Sign out** and expires. Only someone who can read the key
file, or who has a sign-in link, can sign in.

Sign-out succeeds only after the verifier is removed from the saved session
file. If storage fails, the running console denies that session and returns
an error with a retry action. Restore write access or free disk space and
retry before restarting: an unsaved revocation cannot survive a restart.

The browser clears its cached readings and private rendered content as soon as
sign-out starts, even if durable revocation needs a retry. Late responses cannot
repopulate those caches, and signed-in navigation remains disabled until a new
sign-in reloads the page. This does not erase copies already saved by the user
or clear the operating system's clipboard.

**A second start.** Starting the console again while it runs asks the running
one for a sign-in link, and never sends the key to do it. The running console
issues a single-use nonce; the second start answers with an HMAC of it under
the key, bound to the port it connected to; the console answers with an HMAC of
its own, which the second start checks before it prints a link or opens the
browser. A program that took the port first learns nothing and gets nothing
opened, and a proof relayed to the console from another port is refused.

**TLS, pinned.** The console makes its own certificate on first start and puts
its SHA-256 fingerprint in every join link. Joining and reporting go over TLS,
and the reporter accepts that certificate only: a different machine answering
at that address gets nothing.

**Local files.** Static assets reject symlinks beneath the canonical package
directory and are read from the validated open file, with an 8 MiB limit.
Owner and telemetry-generation records use bounded descriptor reads. Each file
is identified by the descriptor it is read from: after opening, the path must
still name exactly that regular file (exact 64-bit device and inode), or the
read is refused. A record that disappears after opening, or a dangling link, is
an error, not an initial credential state.
Keep the installed package and state directories writable only by trusted users.
These checks and the cooperative single-writer lock do not isolate the console
from a hostile process with direct write access to those directories.

**The join page.** A join link opens a page on the console's reporting port,
served over plain HTTP so a browser opens it without a certificate warning. The
code is in the link's fragment, which a browser never sends. The page hands out
a command to paste into a terminal, so it builds that command only from what it
can check: the release's download link, and a join link it rebuilds from its
own address and a fragment that must be exactly a code and a fingerprint. Every
character of that link must be one no shell gives a meaning to, and it goes in
single quotes, which sh, bash, zsh, fish and PowerShell all take literally.
A plain-HTTP page can still be changed by anyone who can change traffic on the
network, so the page is not what to trust. **Add a machine** leads with the
command itself: it is built on the console's own computer, and its owner sends
it over whatever channel they already trust to carry the link. On a network you
do not trust, send the command rather than the link. Whoever joins should run
the command they were sent, and check that it starts with `node -e`, names
`https://github.com/LockedinLabs-AI/agent-console/releases/download/`, and ends
with the link in single quotes, with nothing after it. Those parts alone do not
pin what runs: the check between the first two single quotes must be the
published one. Its SHA-256 is `77aea0b4b487f2e39065b5739377f16678d6977b0fbd6d1ab0ef901052e581bc`, listed in the README
("The check in every command") and in each release's notes. This command
prints the SHA-256 of the check in a command pasted into it, without running
anything (paste, Return, then Ctrl+D; Ctrl+Z and Return in PowerShell):

```sh
node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(require('crypto').createHash('sha256').update(s.split(String.fromCharCode(39))[1]).digest('hex')))"
```

**No code from the console.** The console never serves Agent Console itself.
Every command it prints installs the package from its GitHub release over
HTTPS, and starts with a short check for `node -e` that downloads the file
and the release's `SHA256SUMS` and runs nothing unless the file's SHA-256
matches. The check holds no quote, backslash or dollar sign, so it pastes
literally into sh, bash, zsh, fish and PowerShell. Release files are uploaded
without replacing one that exists. From 0.2.1 on, CI builds each release's package, attaches its SHA-256
checksum and records a signed build provenance attestation for it (see the
README's "Verify a release").

**Joining.** A join link carries a 128-bit code; the eight-character code for
typing by hand exists too. Either works once and lives at most an hour. Join
attempts are counted before they are read, ten per address per ten minutes (a
global IPv6 address by its /64; a unique-local or link-local one by itself,
since that /64 is usually the whole office network). Typed codes also share a
total of sixty per ten minutes, the guard against guessing from many
addresses; an address over its own limit does not count toward it. A join by
link is never held off by other addresses' attempts: its code cannot be
guessed. The console stores only SHA-256 verifiers of codes and device
tokens, in files with mode 600.

**Reporting.** Each machine has its own bearer token; **Remove** revokes it at
once. Every record is checked for its exact shape before it is stored: exact
keys, ids and hashes of exactly 64 hex characters, plain model ids and labels,
minute timestamps, non-negative counts. Each machine may send 600 batches a
minute and 250,000 records a day. Callers outside private networks (RFC 1918,
link-local, IPv6 unique-local) are refused unless the console was started with
`--allow-public`. Carrier-grade NAT (100.64.0.0/10, which Tailscale also
uses) is shared with other customers of the same provider, so it counts as
private only with `--allow-cgnat`.

**Storage.** Usage is kept one file per day for the retention period (8 days by
default), read back line by line with over-long or malformed lines skipped, and
deleted a day at a time. Derived state lives outside any repository
(`~/.agent-console/`); uninstalling does not delete it.

**The reporter.** Everything a console sends back is checked before use:
identifiers must have their exact shape, so none can steer a file path, and
text has control characters removed before it is printed, so none can drive
the terminal. Project hashes use a key only that machine holds. `leave`
deletes everything the enrolment left on the machine.

Known credential patterns are redacted from the console's answers before they
reach a browser; redaction cannot recognise every private business detail, so
use demo mode for screenshots and presentations.
