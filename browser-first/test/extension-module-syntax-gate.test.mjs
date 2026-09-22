#!/usr/bin/env node

// SDK-DEMO-001B Task 2: syntax/load gate for the browser-first extension
//
// `npm run build` (tsc + vite) does NOT load the extension as a module in
// a real Chrome context - it only type-checks and bundles. That means a
// SyntaxError that fires when Chrome parses `main-workspace.js` (or any
// module script entry) escapes the standard test path entirely.
//
// This test enumerates every JS module under
// browser-first/resonantos-side-panel-extension/src/ and runs
// `node --check` against each (the repo's package.json declares
// "type": "module" so `--check` parses as ESM). It also runs the same
// check against browser-first/host/*.mjs so that an addon-side
// regression surfaces here too.
//
// Excluded: bridge-config.generated.js (generated at runtime by the
// bridge from auth tokens - it MUST NOT be present in committed state
// and is not part of the shipped source surface).
//
// The gate is intentionally hermetic: no Chrome runtime, no DOM, no
// network. A real extension load failure would normally surface as
// `Uncaught SyntaxError: Unexpected reserved word` in the chrome://extensions
// UI; this gate surfaces it as a `node --test` failure instead.

import { readdir, stat, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const SOURCE_ROOTS = [
  {
    label: "browser-first/resonantos-side-panel-extension/src",
    abs: path.join(repoRoot, "browser-first/resonantos-side-panel-extension/src"),
    exclude: new Set(["bridge-config.generated.js"]),
  },
  {
    label: "browser-first/host",
    abs: path.join(repoRoot, "browser-first", "host"),
    exclude: new Set(),
  },
];

async function enumerateJsFiles(rootAbs) {
  const out = [];
  async function walk(dirAbs) {
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const entryAbs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(entryAbs);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".js") || entry.name.endsWith(".mjs"))
      ) {
        out.push(entryAbs);
      }
    }
  }
  await walk(rootAbs);
  out.sort();
  return out;
}

function parseNodeCheckOutput(buffer) {
  // Reserved for future diagnostic formatting. Currently unused; kept
  // as a hook for nicer error messages if --check ever starts using
  // a different stderr shape.
  return { text: buffer.toString("utf8") };
}

function runNodeCheck(absPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", absPath], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      resolve({ ok: false, code: -1, stderr: `${stderr}${stdout}\n${error.message}`, stdout });
    });
    child.on("exit", (code) => {
      const ok = code === 0;
      resolve({ ok, code, stderr: `${stdout}${stderr}`, stdout: "" });
    });
  });
}

async function resolveFileList() {
  const all = [];
  for (const root of SOURCE_ROOTS) {
    let info;
    try {
      info = await stat(root.abs);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isDirectory()) continue;
    const files = await enumerateJsFiles(root.abs);
    for (const file of files) {
      const base = path.basename(file);
      if (root.exclude.has(base)) continue;
      all.push({ abs: file, rel: path.relative(repoRoot, file), rootLabel: root.label });
    }
  }
  return all;
}

test("every browser-first extension module parses as ESM (SyntaxError gate)", async (t) => {
  const files = await resolveFileList();
  if (!files.length) {
    t.diagnostic("no extension modules discovered - gate has nothing to check");
    return;
  }
  const failures = [];
  for (const file of files) {
    const result = await runNodeCheck(file.abs);
    if (result.ok) continue;
    failures.push({
      file: file.rel,
      code: result.code,
      stderr: result.stderr.slice(0, 600),
    });
  }
  if (failures.length) {
    const lines = failures.map(({ file, code, stderr }) =>
      `\n---\n${file} (exit=${code})\n${stderr.trim()}\n`
    );
    throw new Error(
      `Syntax/load gate failed for ${failures.length}/${files.length} module(s).\n` +
      `A parse failure here means the same failure would occur when Chrome loads\n` +
      `the extension as a module script. Fix the listed module(s), then re-run.\n` +
      lines.join("")
    );
  }
  t.diagnostic(`checked ${files.length} modules across ${SOURCE_ROOTS.length} root(s)`);
});

test("main-workspace.js exposes the generic workspace-addon renderer", async (t) => {
  // Companion assertion: even if every file parses, the generic Open
  // affordance plumbing must remain in place. This is what makes the
  // open-in-iframe button work for any addon whose manifest declares
  // `contributions.workspace.proxyPath`.
  const mainWorkspaceAbs = path.join(
    repoRoot,
    "browser-first/resonantos-side-panel-extension/src/main-workspace.js"
  );
  const source = await readFile(mainWorkspaceAbs, "utf8");
  for (const token of [
    "async function renderMessages",
    "renderGenericAddonWorkspace",
    "isGenericAddonWorkspaceId",
    "getWorkspaceAddonById",
    "hydrateWorkspaceAddonRegistry",
    "setActiveWorkspace",
  ]) {
    if (!source.includes(token)) {
      throw new Error(
        `main-workspace.js is missing required identifier '${token}'. ` +
        `A regression here would break generic workspace-addon discovery.`
      );
    }
  }
});
