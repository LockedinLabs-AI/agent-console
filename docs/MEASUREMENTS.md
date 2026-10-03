# What the numbers mean

## Sources

Claude Code: the JSONL transcripts under `~/.claude/projects`. Codex: the
rollout JSONL under `~/.codex/sessions`. Both are read locally and read-only,
on each machine, by the collector (`lib/collector/`). Only the transcripts
written inside the console's retention window (8 days by default) are read.
The console also keeps daily totals for 400 days, which answer the 30-day
period after the minute detail is gone.
The field-by-field rules are in [COLLECTOR-CONTRACT.md](COLLECTOR-CONTRACT.md).

## Tokens

Four disjoint classes: **uncached input** (fresh input, not from cache), **output**,
**cache write** and **cache read**. Thinking tokens are already inside output;
one-hour cache writes are already inside cache write (the cache-write tooltip
shows the 5-minute, 1-hour and unreported-lifetime parts). A class a tool did
not report is unknown, not zero: the total is then a floor, and the screen says
so. A line that carries usage and cannot be counted is counted as a drop, by
reason, and the screen says how many ([accounting.md](accounting.md) §3.2).

**Periods.** One switch sets the period for every view: 1 hour, 24 hours and
7 days are whole minutes ending now, and the chart's bars add up to the
headline; 30 days are the last 30 UTC days, from the daily totals.

**Cache read share** is cache reads divided by all four classes. The other
common reading, cache reads as a share of input only (cache read ÷ (cache read
+ cache write + input)), is in the cache-read tooltip and in the API, labelled
as such. Neither is a benchmark, and a high share is not a waste score.

**Messages** are API responses. Claude Code writes one response over several
transcript lines; the lines after the first are marked as continuations and
are not counted again. Their token increments are still counted, once.

## Reading cache usage

A cache read means the provider reported reusing cached prompt input. It does
not mean the provider returned a previously generated answer: output tokens
are still a separate class. Long agent sessions can reuse a large prefix over
many responses, so those repeated reads can dominate the token total.

For example, these **synthetic** counts describe one selected period:

| Token class | Count |
| --- | ---: |
| Cache read | 900,000 |
| Uncached input | 50,000 |
| Cache write | 25,000 |
| Output | 25,000 |
| Total | 1,000,000 |

The headline cache read share is **90%** (900,000 ÷ 1,000,000). Its input-only
share is **about 92.3%** (900,000 ÷ 975,000). These are shares of tokens. A
request hit rate would instead count responses meeting a stated hit criterion
and divide by the relevant response count; this token split does not supply
that percentage. It also does not establish a percentage saved on a bill.

To interpret your own reading, select a period, check the model and machine
breakdown, and inspect a session's Context column for recent input readings,
writes and possible cache breaks. A high share shows reuse within that scope;
compare the absolute input size and estimated cost as well. A large reused
context can still be expensive. A possible break is a signal from counts and
timing, not proof of its cause ([analysis contract](ANALYSIS.md#contexthealthsamples-prices-options)).

The console observes the usage the agents recorded. It does not enable
provider caching or change the agent's prompts. Provider rules differ and can
change; see [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
and [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
for prefix matching, retention and pricing.

## Machines and copies

Each machine reports what its own transcripts say, under its own device token.
Record ids come from the transcript itself (session and message ids) under the
console's shared salt, not from a path, so a transcript copied to a second
machine is recognised and counted once, credited to the machine that sent it
first. The reporting machine is not proof of where the work ran.

A machine that stops reporting keeps its last contact time, its sessions show
an unknown five-minute figure, and it is left out of "right now" by name. A
machine still sending a large backlog is shown as "catching up · N of M
records" and is also left out of "right now" until it has sent everything.
Machine counts are machines reporting, never seats or people.

## Costs

Estimates at standard API list prices from an offline, dated table
([`lib/collector/prices.json`](../lib/collector/prices.json)), for Claude and
OpenAI models, so Claude Code and Codex use are both priced where a published
rate exists. Each row names the vendor page it came from and when it was
checked. A model without a verified rate, or a record missing a token class, is
left out of the dollar figure and counted as unpriced: never priced at zero.
Where some usage is unpriced, a figure is marked partial; where all of it is,
the burn rate reads "unpriced" instead of a dollar amount.

Fast mode is priced at its own published rates; another service tier, or fast
mode on a model without published fast rates, is unpriced. The estimate cannot
see subscriptions, negotiated rates, batch, data-residency premiums, taxes or
tool fees. It is not an invoice.

Token share and cost share can differ substantially because each class has
its own rate. Use the console's Spend spectrum and the dated price table to
understand the estimate. Any savings comparison needs a stated baseline,
the same model and service tier, and the cost of writes as well as reads.
Reconcile actual spend against your provider's billing records and plan;
transcript totals alone cannot establish an invoice reduction.

## Cache and latency

Provider prompt caching can reduce input processing time. A cache token share
does not measure how much faster a request or coding task became. The
console's activity buckets and session spans include other work and are not
per-request latency measurements. To evaluate a speed change, compare similar
workloads using request timings such as time to first token and total response
time, alongside model, output length, tool time and cache usage.

## Projects (this machine only)

Tokens, estimated cost, sessions and branches per project folder, from the
console's own machine only, beside what that folder's local Git history
recorded in the same period: commits, lines added and removed, and commits
referencing #N (merge commits of pull requests, and subjects ending `(#N)`,
which can name an issue as well as a merged pull request). Only commits whose
author email is the repository's configured `user.email` are counted; with
none configured, every author is, and the page says so. Git
evidence describes delivery activity. It does not measure value, quality or
causation, and tokens do not measure productivity.
