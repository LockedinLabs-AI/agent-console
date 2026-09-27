# NIST SSDF (SP 800-218) self-assessment

How Agent Console's development follows the practices of the NIST Secure
Software Development Framework, version 1.1. Each practice says what the
project does, where the evidence is, and a status:

- **Met**: done, and the evidence is in this repository or its settings.
- **Partial**: done in part; the gap is stated.
- **Not yet**: not done.

This is the maintainer's own assessment, not an audit. It describes the
repository as of release 0.4.1.

## PO: Prepare the organisation

| Practice | What this project does | Evidence | Status |
| --- | --- | --- | --- |
| PO.1 Define security requirements | The security properties are written down and tested: metadata-only reporting, loopback-only console, pinned TLS, signed releases. | [SECURITY.md](../../SECURITY.md), [docs/PRINCIPLES.md](../PRINCIPLES.md), [THREAT-MODEL.md](THREAT-MODEL.md), `test/security.test.js` | Met |
| PO.2 Roles and responsibilities | One maintainer owns every path and every release. | [.github/CODEOWNERS](../../.github/CODEOWNERS) | Partial: no second person for review or incident cover |
| PO.3 Supporting toolchains | CI on GitHub-hosted runners; every action pinned to a commit SHA; Dependabot keeps actions, build tools and the image base current; gitleaks is checksum-pinned. | [.github/workflows/](../../.github/workflows/), [.github/dependabot.yml](../../.github/dependabot.yml), [public-safety.yml](../../.github/workflows/public-safety.yml) | Met |
| PO.4 Criteria for security checks | Six test jobs (three systems, two Node.js versions) are required to merge; a release is refused unless its commit passed CI, public-safety and performance checks. | Branch protection on `main`; [scripts/release-source-check.mjs](../../scripts/release-source-check.mjs) | Partial: branch protection does not apply to administrators, so an administrator can merge without the required checks; the release check still refuses a commit that did not pass them |
| PO.5 Secure environments | Builds run only on GitHub-hosted runners; workflows are read-only by default and elevate per job; signing keys live in a throwaway keychain for one job and are deleted after. | [release.yml](../../.github/workflows/release.yml), [binaries.yml](../../.github/workflows/binaries.yml) | Met |

## PS: Protect the software

| Practice | What this project does | Evidence | Status |
| --- | --- | --- | --- |
| PS.1 Protect all forms of code | `main` accepts only changes whose required checks pass; force pushes and deletion are off; release tags cannot be moved or deleted (ruleset); secret scanning with push protection; gitleaks over every commit in a change. | Branch protection, `protect-release-tags` ruleset, [public-safety.yml](../../.github/workflows/public-safety.yml) | Partial: reviews and signed commits are not required on `main`, and administrators can bypass the required checks |
| PS.2 Verify software release integrity | Every release file is listed in `SHA256SUMS` and has a Sigstore-signed build provenance attestation; macOS executables are Developer ID signed and notarized; installers and the join command refuse a mismatched file. | [release.yml](../../.github/workflows/release.yml), [install.sh](../../install.sh), [lib/invocation.js:54](../../lib/invocation.js#L54), [SECURITY.md](../../SECURITY.md#verifying-a-download) | Partial: Windows executables are not code-signed |
| PS.3 Archive and protect each release | Releases are immutable in practice: files are uploaded without replacing existing ones, tags are protected, and each release carries its provenance, its SBOMs (CycloneDX, attested) and its checksums. npm receives the exact attested file, with npm provenance. | [release.yml](../../.github/workflows/release.yml), [npm-publish.yml](../../.github/workflows/npm-publish.yml), [.github/scripts/release-sbom.mjs](../../.github/scripts/release-sbom.mjs) | Met |

## PW: Produce well-secured software

| Practice | What this project does | Evidence | Status |
| --- | --- | --- | --- |
| PW.1 Design to meet security requirements | Written threat model and data flows; the console is loopback-only by design and the network port carries only join and ingest. | [THREAT-MODEL.md](THREAT-MODEL.md), [DATA-FLOWS.md](DATA-FLOWS.md), [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | Met |
| PW.2 Review the design | The design documents are public and changed by pull request. | Pull request history | Partial: reviewed by the maintainer only |
| PW.4 Reuse well-secured software | No runtime or development dependencies; Node.js standard library only. One pinned build tool (postject) for the executables. The hub image base is pinned by digest. | [package.json](../../package.json), [packaging/sea/package-lock.json](../../packaging/sea/package-lock.json), [Dockerfile](../../Dockerfile) | Met |
| PW.5 Secure coding practices | Input shapes checked at every boundary; bounded reads; constant-time comparisons; HTML escaping and a strict content security policy; server-side credential redaction. | [lib/collector/transport.js](../../lib/collector/transport.js), [lib/hub/http.js](../../lib/hub/http.js), [lib/redact.js](../../lib/redact.js) | Met |
| PW.6 Build configuration | No build step for the package; executables built by a script in the repository from the packed package, each file checked by SHA-256 at start. | [packaging/sea/build.mjs](../../packaging/sea/build.mjs), [packaging/sea/main.cjs](../../packaging/sea/main.cjs) | Met |
| PW.7 Review and analyse code | CodeQL (extended query suite) on every change; lint in CI. | Security → Code scanning; [ci.yml](../../.github/workflows/ci.yml) | Partial: no second human reviewer |
| PW.8 Test executable code | Unit, security and end-to-end tests on three systems and two Node.js versions; browser probes with axe; install tests of the published files on every platform after each release. | [ci.yml](../../.github/workflows/ci.yml), [ui-probes.yml](../../.github/workflows/ui-probes.yml), [release.yml](../../.github/workflows/release.yml) acceptance jobs | Met |
| PW.9 Secure defaults | The console and reporting port listen on 127.0.0.1 until `--listen`; public addresses refused until `--allow-public`; project names, alerts and tool activity are not shared unless opted into on each run; `--interop` is off. | [lib/config.js:17](../../lib/config.js#L17), [lib/hub/routes.js:190-196](../../lib/hub/routes.js#L190-L196), [lib/reporter.js:90-100](../../lib/reporter.js#L90-L100) | Met |

## RV: Respond to vulnerabilities

| Practice | What this project does | Evidence | Status |
| --- | --- | --- | --- |
| RV.1 Identify and confirm vulnerabilities | Private vulnerability reporting is on; CodeQL, Dependabot alerts, secret scanning and OpenSSF Scorecard run continuously. | [SECURITY.md](../../SECURITY.md), [scorecard.yml](../../.github/workflows/scorecard.yml) | Met: every CodeQL alert is either fixed in code with a regression test or dismissed with a written reason after its code path was read; none is open in runtime code |
| RV.2 Assess, prioritise and remediate | Published response targets; fixes ship as a new release through the same pipeline; advisories published when fixed. | [SECURITY.md](../../SECURITY.md#what-happens-after-you-report) | Met |
| RV.3 Analyse root causes | Fixes come with a regression test; the changelog records them. | `test/`, [CHANGELOG.md](../../CHANGELOG.md) | Partial: no written root-cause record per vulnerability yet |

## SLSA build level

The release workflow runs on GitHub-hosted runners and generates provenance
with `actions/attest-build-provenance`: an in-toto statement with a SLSA
Provenance v1 predicate, signed through Sigstore with the workflow's GitHub
OIDC identity and recorded in GitHub's attestation store. That meets **SLSA
Build Level 2** (a hosted build platform producing signed provenance).

It does **not** claim Level 3: the provenance is generated by a step inside
the same job that builds the files, not by an isolated, reusable workflow the
build cannot influence.

Check a file's provenance:

```sh
gh attestation verify <file> -R LockedinLabs-AI/agent-console
```

and its SBOM attestation:

```sh
gh attestation verify <file> -R LockedinLabs-AI/agent-console --predicate-type https://cyclonedx.org/bom
```

SBOM attestations are made from 0.4.1 on; earlier releases have provenance
and checksums only.
