# Enterprise security FAQ

Answers to the questions an IT security review asks of a desktop and server
tool, for Agent Console 0.4.x. Each answer points to the code or the document
that supports it. The detail is in [DATA-FLOWS.md](DATA-FLOWS.md),
[THREAT-MODEL.md](THREAT-MODEL.md) and [SSDF.md](SSDF.md).

## Data

**What data does it collect?** On each machine it reads Claude Code and Codex
transcript files that are already on that machine
([DATA-FLOWS.md](DATA-FLOWS.md#the-console)). What leaves a machine that joins
a console is usage metadata only: token counts, model id, the minute, and
salted hashes of the session and project. Never a prompt, a reply, a file
path, file contents, a command or a tool argument
([lib/collector/collector.js:294-327](../../lib/collector/collector.js#L294-L327)).
Project names, alerts and tool-call counts are sent only when the person
running the reporter opts in on that run.

**Where is data stored? (data residency)** Only on your machines: each user's
own state directory (`~/.agent-console/`) and, if you run one, the hub your
organisation hosts. Nothing is sent to LockedIn Labs or any third party. There
is no hosted service.

**How long is it kept?** Usage is kept 8 days by default, configurable from 1
to 90 (`--retention-days`), and deleted a day at a time
([lib/config.js:19](../../lib/config.js#L19)).

**How is it deleted?** `agent-console leave` removes a reporter's enrolment
and credentials; deleting `~/.agent-console/` removes everything else
([docs/uninstall.md](../uninstall.md)).

## Network

**What outbound connections does it make? (egress)** At runtime, none to the
internet. The console connects only to `127.0.0.1`. A reporter connects only to
the hub named in its join link. There is no telemetry, update check, crash
reporting, analytics or licence check. The installers and the printed join
command download release files from `github.com` over HTTPS, and only when
someone runs them. The full list, with code references:
[DATA-FLOWS.md](DATA-FLOWS.md#outbound-network-destinations-all-of-them).

**What does it listen on?** The console: `127.0.0.1:6787`, never on the
network. The reporting port: `127.0.0.1:6788` by default; other machines can
reach it only after the console is started with `--listen <address>`, and even
then only from private address ranges unless `--allow-public`
([lib/config.js:17-18](../../lib/config.js#L17-L18),
[lib/hub/routes.js:190-196](../../lib/hub/routes.js#L190-L196)).

**Does it work behind a proxy or TLS inspection?** Downloads honour
`HTTPS_PROXY`; Node.js downloads also need `NODE_USE_ENV_PROXY=1` and, under TLS
inspection, `NODE_EXTRA_CA_CERTS`
([docs/standalone-install.md](../standalone-install.md#behind-a-proxy)).
Reporter-to-hub traffic stays on your internal network.

## Authentication and encryption

**How do machines authenticate to each other?** The console's owner creates a
join link with a single-use code (128 random bits, at most one hour). The
joining machine spends it once over TLS and receives its own device token,
which it keeps in a mode-600 file. The hub stores only a SHA-256 verifier of
each token, and **Remove** revokes one at once
([lib/hub/registry.js:268](../../lib/hub/registry.js#L268),
[lib/hub/registry.js:318-352](../../lib/hub/registry.js#L318-L352)).

**Who can use the console?** The person at that computer: the console is on
loopback only, and every API call needs a sign-in cookie started from a
single-use link printed in the console's own terminal. The cookie is
`HttpOnly; SameSite=Strict` and lasts 30 days; Sign out ends it
([lib/hub/admin.js:1-33](../../lib/hub/admin.js#L1-L33)). There is no SSO,
LDAP or role model in this version.

**Encryption in transit?** Reporter to hub: TLS 1.2 or later, pinned to the
hub's own ECDSA P-256 certificate, whose fingerprint is in the join link
([server.js:314](../../server.js#L314),
[lib/collector/pinned.js](../../lib/collector/pinned.js)). Browser to console:
plain HTTP on `127.0.0.1`, which never leaves the computer.

**Encryption at rest?** No application-level encryption. State files are
created with mode 600 in mode-700 directories on macOS and Linux; on Windows
they take the user profile's permissions. Use full-disk encryption, as for
the transcripts it reads.

## Installation and privileges

**Does it need administrator or root rights?** No. Every installation path
installs into the user's own account: `~/.local/bin` or
`%LOCALAPPDATA%\Programs\AgentConsole`
([install.sh:91-94](../../install.sh#L91-L94),
[install.ps1:75](../../install.ps1#L75)). It installs no service, driver,
kernel extension, browser extension or system-wide configuration. The
Windows installer adds its folder to the user's own PATH, unless
`AGENT_CONSOLE_NO_MODIFY_PATH=1`.

**What does it install, and how is it removed?** One executable, or the npm
package, plus the state folders above. Removal is three steps:
[docs/uninstall.md](../uninstall.md).

**Can it run on a server?** Yes: `--no-local` runs a hub that reads nothing
from its own disk, and a Linux container image runs as the unprivileged
`node` user with only the reporting port exposed
([Dockerfile](../../Dockerfile), [docs/docker-hub.md](../docker-hub.md)).

**Can it run in a locked-down or offline environment?** Yes. The standalone
executable needs no Node.js and makes no outbound connection; copy it in after
verifying it, and run it
([DATA-FLOWS.md](DATA-FLOWS.md#running-fully-offline)).

## Updates and supply chain

**How is it updated?** It never updates itself. You install a new release the
same way you installed the first (installer, npm or container tag),
and verify it the same way.

**How are updates verified?** Every release file is in `SHA256SUMS` and has a
Sigstore-signed build provenance attestation from this repository's release
workflow; the installers refuse a file whose SHA-256 differs. macOS
executables are Developer ID signed and notarized. The commands:
[SECURITY.md](../../SECURITY.md#verifying-a-download).

**Is there an SBOM?** Yes, from 0.4.0: a CycloneDX 1.5 SBOM for the npm package
and one for each standalone executable (the package, Node.js and the libraries
Node.js bundles), attached to the release, listed in `SHA256SUMS` and attested
([.github/scripts/release-sbom.mjs](../../.github/scripts/release-sbom.mjs)).
The package itself has no dependencies.

**Is the code signed?** macOS: Developer ID and notarized. Windows: **not
code-signed** (no Authenticode certificate); use `install.ps1`, which checks
`SHA256SUMS`, and `gh attestation verify`. Linux: no platform signing scheme;
checksums and attestations are the check. Commits on `main` are not required
to be signed.

**What SLSA level?** Build Level 2 ([SSDF.md](SSDF.md#slsa-build-level)).

## Secure development and vulnerability management

**What security testing runs in CI?** CodeQL (extended queries) on every
change; gitleaks over every commit and the tree; GitHub secret scanning with
push protection; Dependabot; OpenSSF Scorecard; a public-content check;
unit, security and end-to-end tests on macOS, Linux and Windows with Node.js
22 and 24; and, after each release, install tests of the published files on
every platform ([.github/workflows/](../../.github/workflows/)).

**Are there open findings?** Code-scanning results are kept under the
repository's Security tab (visible to maintainers). Open alerts are being triaged; any that are real
are fixed with a regression test. See [SSDF.md](SSDF.md) (RV.1).

**How are vulnerabilities reported and handled? What are the SLAs?** Through
GitHub private vulnerability reporting. Targets: acknowledge within 2 business
days, triage within 5, a fixed release for critical or high severity within 30
days ([SECURITY.md](../../SECURITY.md)). These are targets, not a contract.

## AI and models

**Does it send anything to an AI model or provider?** No. It calls no model
API and has no AI features that send data anywhere
([DATA-FLOWS.md](DATA-FLOWS.md#outbound-network-destinations-all-of-them)). It
reads the transcripts that AI coding tools write, to count their usage.

**Does it change how the AI tools behave?** Only if you run
`agent-console policy apply` in a repository: that writes Claude Code project
settings and a local hook that enforces the repository's `agent-policy.yaml`,
with no network access ([lib/policy/hook.mjs](../../lib/policy/hook.mjs),
[docs/policy.md](../policy.md)). `policy remove` takes it out.

## Logging

**What does it log, and where?** The console prints to its own terminal: the
sign-in link (single use, valid 15 minutes), and each machine that joins or
leaves; `--json` makes these JSON lines. A background reporter writes
`reporter.log` in its state folder. The policy hook appends each decision
(time, rule, action) to `~/.agent-console/policy/`. Nothing is sent to a remote
log. There is no persistent audit log of console actions in this version.

## Licence and support

**Licence?** MIT. Third-party parts (IBM Plex fonts under the OFL 1.1; Node.js
inside the executables) are listed in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and in each SBOM.

**Support?** Questions and bugs through GitHub issues; security reports
through private vulnerability reporting. This repository offers no paid
support terms. It is maintained by one maintainer.
