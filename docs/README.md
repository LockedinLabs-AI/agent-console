# Documentation

Agent Console reads Claude Code and Codex usage on a computer and combines
metadata from machines you explicitly enroll. It shows sessions, agents,
tokens, cache activity and estimated list-price costs. Start with the
[installation guide](../README.md#install), which distinguishes the current
source from published downloads. For a complete first installation, including
installation with Claude Code or Codex, use [INSTALL.md](../INSTALL.md).

## Use the console

| I want to… | Read |
| --- | --- |
| Try it with synthetic data | [Start here](../README.md#start-here); add `--demo` to avoid reading local sessions. |
| Connect another computer | [Add another computer](../README.md#add-another-computer) and [how reporting works](../README.md#how-the-machines-connect). |
| Understand tokens, cache use and dollar figures | [Measurements](MEASUREMENTS.md) and [accounting](accounting.md). Estimates are not invoices. |
| Interpret a high cache read percentage | [Reading cache usage](MEASUREMENTS.md#reading-cache-usage): token share, request hit rate, cost and latency. |
| Run it without keeping a terminal open | [Background operation](BACKGROUND.md). |
| Check a download or use a standalone executable | [Release verification](../README.md#verify-a-release) and [standalone installation](standalone-install.md). |
| Fix a startup or reporting problem | [Troubleshooting](../README.md#troubleshooting). |
| Remove the console and its state | [Uninstall](uninstall.md). |

## Integrate or extend it

| Boundary | Contract |
| --- | --- |
| Reporter → hub | [Collector contract](COLLECTOR-CONTRACT.md): allowed fields, delivery, identity, replay and supported log formats. |
| Shared computation | [Analysis API v1](ANALYSIS.md): pure functions without filesystem, network or runtime-control authority. |
| Console and Projects payloads | [Console schema](console-v0.4.schema.json), [Projects schema](projects-v0.4.schema.json) and [synthetic conformance fixtures](../test/conformance/). |
| Optional local telemetry | [Interop](INTEROP.md): OpenTelemetry ingest, gateway-shaped usage records and Prometheus metrics with separate credentials and accounting scopes. |
| Optional project controls | [Policy](policy.md): explicit local Claude Code hook installation, supported decisions and limitations. |

The [architecture](ARCHITECTURE.md) describes which component owns each
responsibility. The dashboard does not intercept model requests, operate a
model gateway or remotely control agents. A compatible telemetry format is
not a deployed Azure API Management or Kong integration. Local policy hooks
are separately installed and depend on the agent runtime to enforce them.

## Review the engineering

These are reproducible checks and documented boundaries, not certifications.
Read the checks at the same revision as the code you intend to run.

| Question | Design and evidence |
| --- | --- |
| What can read or change sensitive state? | [Trust boundaries](ARCHITECTURE.md#trust-boundaries), [security policy](../SECURITY.md) and [HTTP security tests](../test/security.test.js). |
| Can private transcript content leave a machine? | [Collector contract](COLLECTOR-CONTRACT.md), [metadata projection](../lib/collector/collector.js) and [end-to-end privacy canary](../test/hub-e2e.test.js). |
| Do totals reconcile across copied sessions and machines? | [Accounting rules](accounting.md), [conformance tests](../test/conformance.test.js) and their [synthetic inputs](../test/conformance/). |
| What happens when storage or a retry fails? | [Recovery boundaries](ARCHITECTURE.md#storage-ownership-and-recovery), [store durability tests](../test/store-durability.test.js), [activity delivery tests](../test/extras-custody.test.js) and [session revocation tests](../test/session-revocation.test.js). |
| Does idle polling stay cheap? | [Performance method, budgets and limitations](PERFORMANCE.md), enforced by the [performance workflow](../.github/workflows/perf.yml). |
| Does a change work outside the author's machine? | [Three-platform CI](../.github/workflows/ci.yml), [package install smoke](../scripts/pack-smoke.mjs) and [browser checks](../.github/workflows/ui-probes.yml). |
| What code and dependencies reach a release? | [Release path](ARCHITECTURE.md#ci-and-release-path), [asset completeness check](../scripts/release-assets-check.mjs), [public-content checks](../.github/workflows/public-safety.yml), [source provenance](../PROVENANCE.md) and [third-party notices](../THIRD_PARTY_NOTICES.md). |

The source has no npm runtime dependencies. `npm run lint` validates JavaScript
syntax and JSON; it is not a static type checker. Runtime payload schemas,
behavioral tests and the [contribution requirements](../CONTRIBUTING.md)
provide separate checks. Workflow definitions describe what runs; branch
protection and a successful run on an exact commit establish what was enforced.

## Participate

- [Public website](website.md): how the product site verifies downloads and is published.

- [Contributing](../CONTRIBUTING.md): setup, focused tests and review expectations.
- [Security](../SECURITY.md): private vulnerability reporting; use synthetic reproductions.
- [Principles](PRINCIPLES.md): product constraints and the checks behind them.
- [Changelog](../CHANGELOG.md) and [roadmap](ROADMAP.md): shipped changes and future direction.
- [Code of Conduct](../CODE_OF_CONDUCT.md), [MIT license](../LICENSE) and [third-party notices](../THIRD_PARTY_NOTICES.md).

Maintained by [LockedIn Labs](https://lockedinlabs.ai). Report ordinary bugs or
propose changes through [GitHub Issues](https://github.com/LockedinLabs-AI/agent-console/issues).
