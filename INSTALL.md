# Install Agent Console

Agent Console runs on your computer and opens in a browser. It reads local
Claude Code and Codex usage; it needs no model API key, cloud account, or
browser extension. This guide is for people installing it themselves and
coding assistants helping them install it.

Official repository: <https://github.com/LockedinLabs-AI/agent-console>

## Choose what to run

| You want | Use |
| --- | --- |
| The current interface and features | The source on `main`, using Git and Node.js 22 or newer. |
| A versioned install with npm | The `.tgz` attached to a published GitHub release. |
| To run without installing Node.js | A standalone executable from that release for your operating system and processor. |

After starting, open **Accounts** to connect existing native Codex or Claude Code
profiles. Quota setup is optional; the token console needs no provider login of
its own. [Account setup](docs/ACCOUNTS.md) explains source support and the native
launcher. No proxy, OAuth import, or extra runtime dependency is installed.

**Source version:** v0.4.3. Versioned downloads are listed on
[GitHub Releases](https://github.com/LockedinLabs-AI/agent-console/releases/latest).
The registry name `@lockedinlabs/agent-console` is not published yet. Check the
[release page](https://github.com/LockedinLabs-AI/agent-console/releases/latest)
for the version and exact assets available; a version in `package.json` alone
does not mean a downloadable release exists.

## Run the current source

Check `node --version` first: it must be 22 or newer. Use an existing Node.js
installation or install the LTS release from [nodejs.org](https://nodejs.org).
Choose a new folder outside any project you are working on, then run:

```sh
git clone https://github.com/LockedinLabs-AI/agent-console.git
cd agent-console
node bin/agent-console.mjs --version
node bin/agent-console.mjs --open
```

These commands also work in Windows PowerShell. There are no dependencies to
install and no build step. If a clone already exists, inspect its changes before
updating it; never reset another project's work to install the console.

Without Git, choose **Code → Download ZIP** on GitHub, extract it, and run the
last two commands from the folder containing `package.json`. If extraction
creates two nested `agent-console-main` folders, use the inner one.

To try the interface before reading local sessions, use
`node bin/agent-console.mjs --demo --open`. Every figure is synthetic and
marked DEMO. Stop it with Ctrl+C before starting the normal console.

## Install a published version with npm

Node.js 22 or newer includes npm. npm can install a GitHub release archive
directly; this does not require publication to the npm registry. Once its
archive appears in the release Assets, install **v0.4.3** with:

```sh
npm install --global --ignore-scripts https://github.com/LockedinLabs-AI/agent-console/releases/download/v0.4.3/lockedinlabs-agent-console-0.4.3.tgz
agent-console --version
agent-console --open
```

On Windows PowerShell:

```powershell
npm.cmd install --global --ignore-scripts https://github.com/LockedinLabs-AI/agent-console/releases/download/v0.4.3/lockedinlabs-agent-console-0.4.3.tgz
agent-console.cmd --version
agent-console.cmd --open
```

Use the archive for the version you chose, not a guessed asset URL.
`--ignore-scripts` works because the archive already contains the runnable
console. If npm cannot write its global directory, use the source route above
instead of running as administrator. If the command is not found after a
successful install, open a new terminal and check npm's configured prefix.

## Download without Node.js

Open [GitHub Releases](https://github.com/LockedinLabs-AI/agent-console/releases/latest)
and expand **Assets**. Choose the executable that matches your computer:

| Computer | Asset |
| --- | --- |
| Mac with Apple silicon | `agent-console-darwin-arm64` |
| Mac with an Intel processor | `agent-console-darwin-x64` |
| Linux, ARM64 | `agent-console-linux-arm64` |
| Linux, Intel or AMD 64-bit | `agent-console-linux-x64` |
| Windows, 64-bit | `agent-console-win32-x64.exe` |

These are command-line launchers with Node.js included. They open the web
console; they are not `.dmg` or `.msi` installers. **Source code (zip)** is
source, not a desktop application. For checksums, signing status, Linux
requirements and the user-level installer, follow
[standalone installation](docs/standalone-install.md). Start the installed
executable with `--open`.

## Check it worked

1. Run `--version` with the command you installed and confirm the chosen version.
2. Start it with `--open`. The console normally opens at
   `http://127.0.0.1:6787`; if that port is occupied, use the address it reports.
3. In normal mode, check that the source locations match your Claude Code or
   Codex installation. No session history is a valid empty state, not a failed
   installation. Demo data is always marked DEMO.

The browser address works while the process runs. Closing its terminal or
pressing Ctrl+C stops it; run the same command to open it tomorrow. To start
automatically on login, follow [background operation](docs/BACKGROUND.md).
Keep one console running per state directory and reuse an existing instance
instead of stopping a process you did not start.

A coding assistant should report the installed version, method, and how to
start or stop it. It should keep the console local, preserve existing state,
and keep one-time sign-in links and join credentials out of chat and logs.
Network reporting, startup services and local policy hooks are separate opt-ins;
ordinary installation does not require them.

See [troubleshooting](README.md#troubleshooting),
[connecting another computer](README.md#add-another-computer), and
[uninstalling](docs/uninstall.md).
