# The public website

The repository includes a static product and download site in `site/`. It
explains Agent Console and links to verified release files. It does not host
anyone's usage dashboard, read session logs, collect analytics, or enroll a
machine. The console still runs locally unless the user configures sharing.

## Build and publish

The existing **Download page** GitHub Actions workflow builds `dist/site`.
At build time it reads the latest published release, checks its archive and
attestation, and includes only installation channels it can verify. A failed
verification stops the build. Standalone downloads require the matching
assets and checksums; the npm registry shortcut requires the exact released
package to be available there.

For the repository maintainer:

1. Review the site and release it will advertise. Source on `main` can be
   newer than the available download; do not describe source-only changes as
   part of that download.
2. In **Settings → Pages**, choose **GitHub Actions** as the publishing source.
   Use the existing workflow and repository, not a second deployment project.
3. Run **Actions → Download page → Run workflow** on the reviewed `main`.
4. Open the URL reported by the **github-pages** deployment. Check installation
   on desktop and phone, copy commands, version labels and download links.
5. Set the repository's **About → Website** to that verified live URL.

The standard GitHub Pages address for this repository is
`https://lockedinlabs-ai.github.io/agent-console/`. That address is not a
publication receipt: the successful deployment and live page establish
availability. A company domain can be attached later in Pages settings and
DNS, without changing the console or its local address.

Pushes touching the site rebuild it. After publishing a new release or making
its npm package available, run **Download page** again so its verified facts
refresh. A build that skips deployment because Pages is disabled is not a
published website.

## Local preview

With Node.js and an authenticated GitHub CLI available, run
`node scripts/site-facts.mjs` from the repository. Serve the resulting
`dist/site` directory with a local static web server. The unbuilt `site/`
template contains the original release facts; the generated output is what
should be reviewed and published.

Keep UI images as real, clearly marked synthetic demo captures. Claims,
screenshots and install paths should describe the versions they actually
show. The product's architecture, security policy and licensing remain in
the repository and are linked from the site.
