# Homebrew tap packaging

This directory contains the formula template for
[Agent Console](https://github.com/LockedinLabs-AI/agent-console), local and
team observability for Claude Code and Codex by LockedIn Labs. It is not a
published tap. Use the main README's installation route until the release
download page confirms that the company tap serves that exact version.

Once published and verified, its command is:

```sh
brew install LockedinLabs-AI/tap/agent-console
agent-console --open
```

The generated formula installs the release's standalone executable for your machine
(macOS on Apple silicon or Intel, Linux on arm64 or x64). It is Node.js with
the console inside, so nothing else is needed. On macOS the executable is
signed with an Apple Developer ID and notarized by Apple.

Homebrew checks every download against the SHA-256 in the formula, and those
values are copied from the release's own `SHA256SUMS`, never computed here.
To check a download yourself:

```sh
gh attestation verify "$(brew --cache agent-console)" -R LockedinLabs-AI/agent-console
```

Upgrade with `brew upgrade agent-console`; remove with
`brew uninstall agent-console`. The console's data in `~/.agent-console/` is
yours and stays until you delete it;
[the uninstall guide](https://github.com/LockedinLabs-AI/agent-console/blob/main/docs/uninstall.md)
lists everything Agent Console creates.

## How this tap is updated

The formula is rendered, never hand-edited, by the Agent Console repository
after each release:

```sh
scripts/update-homebrew-tap.sh vX.Y.Z /path/to/homebrew-tap          # render, check, commit
scripts/update-homebrew-tap.sh vX.Y.Z /path/to/homebrew-tap --push   # and push
```

It downloads the release's `SHA256SUMS` and the four archives, checks each
archive against it and against its signed build attestation, renders
`Formula/agent-console.rb` from the template in
`packaging/homebrew-tap/Formula/agent-console.rb.in`, and commits it.

Agent Console is MIT licensed. Issues belong in the
[Agent Console repository](https://github.com/LockedinLabs-AI/agent-console/issues).
