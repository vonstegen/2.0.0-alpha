import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  dashboardTarget,
  execFileStdout,
  expandUserPath,
  isInsidePath,
  listFilesRecursive,
  parseArgs,
  pathSummary,
  redactDiagnosticText,
  safeFileSlug,
  stableMemorySourceId,
} from "../host/browser-first-host-utils.mjs";

test("browser-first host utils parse launch args and normalize user paths", () => {
  const args = parseArgs(["--bridge-port=47773", "--auto-open-side-panel"]);
  assert.equal(args.get("bridge-port"), "47773");
  assert.equal(args.get("auto-open-side-panel"), "true");
  assert.equal(expandUserPath("~"), os.homedir());
  assert.equal(expandUserPath("~/ResonantOS_User"), path.join(os.homedir(), "ResonantOS_User"));
});

test("browser-first host utils redact secrets and home paths", () => {
  const redacted = redactDiagnosticText(`${os.homedir()}/x api_key=abc token: xyz Bearer secret sk-test`);
  assert.match(redacted, /~/);
  assert.doesNotMatch(redacted, /api_key=abc/);
  assert.doesNotMatch(redacted, /token: xyz/);
  assert.doesNotMatch(redacted, /Bearer secret/);
  assert.doesNotMatch(redacted, /sk-test/);
});

test("browser-first host utils enforce local dashboard targets", () => {
  assert.deepEqual(dashboardTarget("localhost", 9119), {
    host: "127.0.0.1",
    port: 9119,
    url: "http://127.0.0.1:9119",
  });
  assert.throws(() => dashboardTarget("example.com", 9119), /only bind to localhost/);
  assert.throws(() => dashboardTarget("127.0.0.1", 70000), /between 1 and 65535/);
});

test("browser-first host utils keep path checks and slugs deterministic", () => {
  assert.equal(isInsidePath("/tmp/root/a.md", "/tmp/root"), true);
  assert.equal(isInsidePath("/tmp/root-escape/a.md", "/tmp/root"), false);
  assert.equal(safeFileSlug(" My Source/File?.md "), "my-source-file-.md");
  assert.match(stableMemorySourceId("folder", "/tmp/My Vault"), /^source-folder-my-vault-[a-f0-9]{12}$/);
});

test("browser-first host utils list files and summarize paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-host-utils-"));
  try {
    await writeFile(path.join(tempRoot, "a.md"), "# A\n");
    await writeFile(path.join(tempRoot, ".hidden.md"), "# Hidden\n");
    await writeFile(path.join(tempRoot, "b.txt"), "B\n");
    const files = await listFilesRecursive(tempRoot, (filePath) => filePath.endsWith(".md"));
    assert.deepEqual(files.map((file) => path.basename(file)), ["a.md"]);
    const summary = await pathSummary(path.join(tempRoot, "a.md"));
    assert.equal(summary.exists, true);
    assert.equal(summary.bytes, (await stat(path.join(tempRoot, "a.md"))).size);
    assert.equal((await pathSummary(path.join(tempRoot, "missing.md"))).exists, false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("browser-first host utils execute bounded stdout commands", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-host-utils-command-"));
  try {
    const script = path.join(tempRoot, "print.mjs");
    await writeFile(script, "console.log('ok')\n");
    assert.equal(await execFileStdout(process.execPath, [script]), "ok");
    assert.equal(await readFile(script, "utf8"), "console.log('ok')\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("browser-first host utils can pipe sensitive input off argv", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-host-utils-stdin-"));
  try {
    const script = path.join(tempRoot, "stdin.mjs");
    await writeFile(script, [
      "let input = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { input += chunk; });",
      "process.stdin.on('end', () => {",
      "  if (process.argv.slice(2).some((arg) => arg.includes('SECRET-PROMPT'))) process.exit(42);",
      "  console.log(input.trim());",
      "});",
      "",
    ].join("\n"));
    assert.equal(
      await execFileStdout(process.execPath, [script, "-q", "-"], { input: "SECRET-PROMPT" }),
      "SECRET-PROMPT",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
