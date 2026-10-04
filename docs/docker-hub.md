# Run a team hub in Docker

The **v0.4.3** Linux team hub is published for amd64 and arm64. Its public
arm64 image has passed a fresh pull, version check, join-page health check and
build-provenance verification. Standalone executable downloads have a separate
release gate; container availability does not establish their availability.

The published multi-platform image digest is:

```text
sha256:7d0d0a246a4a033f433b2184e3632429f193e2a70ed9dce1caba301c524c9247
```

Verify the build provenance before running it:

```sh
gh attestation verify oci://ghcr.io/lockedinlabs-ai/agent-console:v0.4.3 \
  --repo LockedinLabs-AI/agent-console
```

The GHCR image is a Linux hub for machines that report to one console. It
starts as the unprivileged `node` user, stores state in a user-owned volume,
and does not read local Claude Code or Codex history (`--no-local`). The image
is built for Linux amd64 and arm64 from a digest-pinned Node base.

The console's administrative page intentionally listens on loopback only.
For a Linux host, use host networking so `127.0.0.1:6787` is the host's own
loopback, while the reporting listener can accept private-network joins on
port 6788:

```sh
docker volume create agent-console-state
docker run --name agent-console-hub --network host \
  -v agent-console-state:/home/dev/.agent-console/hub \
  ghcr.io/lockedinlabs-ai/agent-console:v0.4.3
```

Open `http://127.0.0.1:6787` on that host and use the printed sign-in link.
Keep the terminal open, or run with `-d` and read `docker logs agent-console-hub`.
`docker ps` shows it `healthy` once the reporting port answers its join page
(the image's `HEALTHCHECK`); the reporting port is fixed at 6788 in the image.
Only the reporting port should be reachable from other machines. The default
hub refuses public-network clients; use a private network and do not add
`--allow-public` unless you intend to accept them.

The versioned image appears after its release workflow completes. Replace
`v0.4.3` with the exact release tag you want; do not use a floating `latest`
tag. On macOS and Windows, Docker's host-network behavior differs; use the
native executable for a local hub there.

To remove it, `docker rm -f agent-console-hub`; `docker volume rm
agent-console-state` then deletes the hub's data, and `docker image rm
ghcr.io/lockedinlabs-ai/agent-console:v0.4.3` the image
([uninstall.md](uninstall.md)).
