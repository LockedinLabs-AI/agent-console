#!/usr/bin/env node
/*
 * CycloneDX software bills of materials for a release, one per shipped file set.
 *
 *   node .github/scripts/release-sbom.mjs --dist dist --runtime sbom-runtime --version 0.4.0 --out sbom
 *
 * The npm package: `npm sbom --sbom-format cyclonedx` over this repository
 * (the package has no dependencies, so npm lists none), with the package's
 * own file hash and the vendored fonts that THIRD_PARTY_NOTICES.md names.
 *
 * Each standalone executable: the same package, plus the Node.js runtime it
 * is built on and every library that runtime reports bundling
 * (`process.versions`). binaries.yml records that runtime on the runner that
 * builds the executable, into <runtime>/<executable>.json, with the same
 * `node` that build.mjs copies into the file. postject, the build tool that
 * injects the package, is listed as a tool: it is not shipped.
 *
 * Writes <out>/lockedinlabs-agent-console-<version>.cdx.json and
 * <out>/agent-console-<target>.cdx.json per executable, checks each document
 * (unique references, every dependency resolves, every hash is SHA-256), and
 * prints what it wrote. It fails, and writes nothing more, on anything missing.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXECUTABLE = /^agent-console-(darwin-arm64|darwin-x64|linux-arm64|linux-x64|win32-x64)(\.exe)?$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
// Keys in process.versions that are interface numbers, not bundled components.
const NOT_COMPONENTS = new Set(["node", "modules", "napi"]);
// Keys in process.versions that are data sets rather than code.
const DATA = new Set(["cldr", "tz", "unicode"]);

function fail(message) {
  process.stderr.write(`release-sbom: ${message}\n`);
  process.exit(1);
}

function args(argv) {
  const given = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (!["--dist", "--runtime", "--version", "--out"].includes(name) || argv[i + 1] === undefined) fail(`usage: --dist D --runtime R --version V --out O (got ${name})`);
    given.set(name, argv[i + 1]);
  }
  for (const needed of ["--dist", "--runtime", "--version", "--out"]) if (!given.get(needed)) fail(`${needed} is required`);
  const out = { dist: given.get("--dist"), runtime: given.get("--runtime"), version: given.get("--version"), out: given.get("--out") };
  if (!VERSION.test(out.version)) fail("--version must be a release version such as 0.4.0");
  return out;
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const hashes = (file) => [{ alg: "SHA-256", content: sha256(file) }];

/** The fonts THIRD_PARTY_NOTICES.md says are vendored byte for byte, with their versions. */
function vendoredFonts() {
  const notices = fs.readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");
  const found = [...notices.matchAll(/`@fontsource\/(ibm-plex-[a-z]+)` ([0-9]+\.[0-9]+\.[0-9]+)/gu)];
  if (found.length === 0) fail("THIRD_PARTY_NOTICES.md names no @fontsource package; the font entries cannot be stated");
  const files = fs.readdirSync(path.join(ROOT, "public", "fonts"));
  return found.map(([, name, version]) => {
    const prefix = name + "-";
    const own = files.filter((f) => f.startsWith(prefix) && f.endsWith(".woff2"));
    if (own.length === 0) fail(`public/fonts has no ${name} file, but THIRD_PARTY_NOTICES.md lists it`);
    return {
      type: "library",
      "bom-ref": `font-${name}@${version}`,
      name: `@fontsource/${name}`,
      version,
      purl: `pkg:npm/%40fontsource/${name}@${version}`,
      licenses: [{ license: { id: "OFL-1.1" } }],
      properties: own.sort().map((f) => ({ name: "agent-console:vendored-file", value: `public/fonts/${f}` })),
    };
  });
}

/** npm's own CycloneDX document for this package, with its name as published. */
function npmSbom() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  let text;
  try {
    text = execFileSync(npm, ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--omit", "dev"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  } catch (error) {
    fail("npm sbom failed: " + String(error.stderr || error.message).trim());
  }
  const bom = JSON.parse(text);
  if (bom.bomFormat !== "CycloneDX" || !bom.metadata || !bom.metadata.component) fail("npm sbom did not produce a CycloneDX document");
  return bom;
}

function postjectTool() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "packaging", "sea", "package-lock.json"), "utf8"));
  const entry = lock.packages && lock.packages["node_modules/postject"];
  if (!entry || !entry.version) fail("packaging/sea/package-lock.json has no postject entry");
  return { type: "application", name: "postject", version: entry.version, purl: `pkg:npm/postject@${entry.version}`,
    description: "Build tool that injects the package into Node.js. Not shipped." };
}

/** Structural checks a consumer relies on; a document that fails one is not written. */
function check(bom, label) {
  const refs = new Set();
  const all = [bom.metadata.component, ...bom.components];
  for (const c of all) {
    if (!c["bom-ref"] || refs.has(c["bom-ref"])) fail(`${label}: missing or repeated bom-ref ${c["bom-ref"]}`);
    refs.add(c["bom-ref"]);
    if (!c.name || !c.version || !c.type) fail(`${label}: component ${c["bom-ref"]} lacks name, version or type`);
    for (const h of c.hashes || []) if (h.alg !== "SHA-256" || !/^[0-9a-f]{64}$/u.test(h.content)) fail(`${label}: bad hash on ${c["bom-ref"]}`);
  }
  for (const d of bom.dependencies) {
    if (!refs.has(d.ref)) fail(`${label}: dependency entry for unknown ${d.ref}`);
    for (const on of d.dependsOn || []) if (!refs.has(on)) fail(`${label}: ${d.ref} depends on unknown ${on}`);
  }
  if (bom.specVersion !== "1.5" || bom.bomFormat !== "CycloneDX" || !/^urn:uuid:[0-9a-f-]{36}$/u.test(bom.serialNumber)) fail(`${label}: not a CycloneDX 1.5 document`);
}

function main() {
  const opts = args(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (pkg.version !== opts.version) fail(`package.json is ${pkg.version}, not ${opts.version}`);
  if (Object.keys(pkg.dependencies || {}).length) fail("package.json now has dependencies: list them from npm sbom's components, not by hand");
  const tarball = path.join(opts.dist, `lockedinlabs-agent-console-${opts.version}.tgz`);
  if (!fs.existsSync(tarball)) fail(`${tarball} is missing`);
  const fonts = vendoredFonts();
  const tool = postjectTool();

  const base = npmSbom();
  const packageRef = `${pkg.name}@${pkg.version}`;
  const packageComponent = {
    ...base.metadata.component,
    "bom-ref": packageRef,
    name: pkg.name,
    version: pkg.version,
    supplier: { name: "LockedIn Labs", url: ["https://github.com/LockedinLabs-AI"] },
  };
  delete packageComponent.properties;

  fs.mkdirSync(opts.out, { recursive: true });
  const written = [];
  const write = (name, bom) => {
    check(bom, name);
    fs.writeFileSync(path.join(opts.out, name), JSON.stringify(bom, null, 2) + "\n");
    written.push(`${name}  ${bom.components.length} components`);
  };

  // The npm package (and the release tarball, which is the same file).
  write(`lockedinlabs-agent-console-${opts.version}.cdx.json`, {
    ...base,
    metadata: { ...base.metadata, component: { ...packageComponent, hashes: hashes(tarball) } },
    components: [...(base.components || []), ...fonts],
    dependencies: [{ ref: packageRef, dependsOn: fonts.map((f) => f["bom-ref"]) }, ...fonts.map((f) => ({ ref: f["bom-ref"], dependsOn: [] }))],
  });

  // Each standalone executable: the package inside the Node.js it was built with.
  const executables = fs.readdirSync(opts.dist).filter((f) => EXECUTABLE.test(f)).sort();
  const runtimes = fs.existsSync(opts.runtime) ? fs.readdirSync(opts.runtime).filter((f) => f.endsWith(".json")).sort() : [];
  if (JSON.stringify(runtimes) !== JSON.stringify(executables.map((e) => e + ".json"))) {
    fail(`every executable needs its runtime record and nothing else: executables ${executables.join(", ") || "none"}; records ${runtimes.join(", ") || "none"}`);
  }
  for (const exe of executables) {
    const target = EXECUTABLE.exec(exe)[1];
    const runtime = JSON.parse(fs.readFileSync(path.join(opts.runtime, exe + ".json"), "utf8"));
    if (runtime.target !== target || !runtime.versions || !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(runtime.versions.node || "")) fail(`${exe}: runtime record is not for ${target}`);
    const nodeVersion = runtime.versions.node;
    const nodeRef = `nodejs@${nodeVersion}`;
    const bundled = Object.entries(runtime.versions)
      .filter(([key, value]) => !NOT_COMPONENTS.has(key) && typeof value === "string" && value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        type: DATA.has(key) ? "data" : "library",
        "bom-ref": `nodejs-${key}@${value}`,
        name: key,
        version: value,
        description: `Bundled in Node.js ${nodeVersion} (process.versions.${key}).`,
        properties: [{ name: "agent-console:licence", value: "Stated in Node.js's LICENSE, shipped inside the executable as LICENSE.node" }],
      }));
    const node = {
      type: "platform",
      "bom-ref": nodeRef,
      name: "Node.js",
      version: nodeVersion,
      purl: `pkg:generic/node@${nodeVersion}?download_url=${encodeURIComponent(`https://nodejs.org/dist/v${nodeVersion}/`)}`,
      licenses: [{ license: { id: "MIT" } }],
      supplier: { name: "OpenJS Foundation", url: ["https://nodejs.org"] },
    };
    const archive = exe + ".tar.gz";
    const archiveNote = fs.existsSync(path.join(opts.dist, archive))
      ? [{ name: "agent-console:also-covers", value: `${archive} (the same executable with its licence files)` }] : [];
    write(`agent-console-${target}.cdx.json`, {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      serialNumber: "urn:uuid:" + crypto.randomUUID(),
      version: 1,
      metadata: {
        timestamp: new Date().toISOString(),
        lifecycles: [{ phase: "build" }],
        tools: { components: [...(base.metadata.tools || []).map((t) => ({ type: "application", name: `${t.vendor || ""} ${t.name}`.trim(), version: t.version })), tool] },
        component: {
          type: "application",
          "bom-ref": exe,
          name: exe,
          version: pkg.version,
          description: `Agent Console ${pkg.version} standalone executable for ${target}: Node.js ${nodeVersion} with the npm package inside.`,
          supplier: packageComponent.supplier,
          licenses: [{ license: { id: "MIT" } }],
          hashes: hashes(path.join(opts.dist, exe)),
          properties: archiveNote,
        },
      },
      components: [packageComponent, ...fonts, node, ...bundled],
      dependencies: [
        { ref: exe, dependsOn: [packageRef, nodeRef] },
        { ref: packageRef, dependsOn: fonts.map((f) => f["bom-ref"]) },
        ...fonts.map((f) => ({ ref: f["bom-ref"], dependsOn: [] })),
        { ref: nodeRef, dependsOn: bundled.map((b) => b["bom-ref"]) },
        ...bundled.map((b) => ({ ref: b["bom-ref"], dependsOn: [] })),
      ],
    });
  }
  process.stdout.write(written.map((w) => "  " + w).join("\n") + "\n");
}

main();
