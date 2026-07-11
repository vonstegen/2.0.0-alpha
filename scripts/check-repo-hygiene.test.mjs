import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { symlinkSync, unlinkSync } from "node:fs";
import { appendFile, mkdtemp, mkdir, open as openFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  classifyContent,
  classifyPath,
  scanRepository,
} from "./check-repo-hygiene.mjs";

const TEN_MIB = 10 * 1024 * 1024;
const SCRIPT_PATH = fileURLToPath(new URL("./check-repo-hygiene.mjs", import.meta.url));
const fileStat = (size = 0) => ({ isFile: () => true, size });
const token = (prefix, body) => `${prefix}${body}`;

async function withTempDirectory(run) {
  const root = await mkdtemp(join(tmpdir(), "repo-hygiene-"));
  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function writeFixture(root, path, content = "fixture\n") {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

test("classifyPath allows ordinary repository files", () => {
  assert.equal(classifyPath("src/index.js", fileStat()), null);
  assert.equal(classifyPath("docs/output-guide.md", fileStat()), null);
});

test("classifyPath rejects generated, local-state, archive, and environment paths", () => {
  const rejectedPaths = [
    "output/report.json",
    "packages/app/runs/result.txt",
    ".abacusai/session.json",
    "tools/.codex/config.toml",
    ".understand-anything/graph.json",
    "ResonantOS_User/settings.json",
    "tools/.venv/bin/python",
    "examples/venv/pyvenv.cfg",
    "release/resonantos.zip",
  ];

  for (const path of rejectedPaths) {
    const violation = classifyPath(path, fileStat());
    assert.ok(violation, `expected ${path} to be rejected`);
    assert.equal(violation.path, path);
    assert.match(violation.message, /remove|archive|outside|allowlist/i);
  }
});

test("classifyPath rejects browser profile databases by exact basename", () => {
  for (const name of ["Cookies", "Login Data", "History", "Web Data", "Local State"]) {
    assert.equal(classifyPath(`profiles/Default/${name}`, fileStat())?.rule, "browser-profile");
  }

  assert.equal(classifyPath("docs/History.md", fileStat()), null);
});

test("classifyPath rejects symbolic links", () => {
  const linkStat = { isFile: () => false, isSymbolicLink: () => true, size: 12 };
  assert.equal(classifyPath("docs/linked.md", linkStat)?.rule, "symlink");
});

test("classifyPath enforces the 10 MiB boundary with an explicit allowlist", () => {
  assert.equal(classifyPath("assets/boundary.bin", fileStat(TEN_MIB)), null);
  assert.equal(classifyPath("assets/large.bin", fileStat(TEN_MIB + 1))?.rule, "large-file");
  assert.equal(
    classifyPath("assets/large.bin", fileStat(TEN_MIB + 1), {
      sizeAllowlist: ["assets/large.bin"],
    }),
    null,
  );
});

test("classifyContent detects founder-specific paths and honors its allowlist", () => {
  const content = "Workspace: /Users/dr.tom/2.0.0-alpha\n";
  assert.equal(classifyContent("docs/setup.md", content)?.rule, "founder-path");
  assert.equal(
    classifyContent("docs/historical-fixture.md", content, {
      contentAllowlist: ["docs/historical-fixture.md"],
    }),
    null,
  );
});

test("classifyContent detects high-confidence provider and source-control credentials", () => {
  const credentials = [
    [token("sk-", "aB3dE5fG7hJ9kL2mN4pQ6rS8"), "credential-openai"],
    [token("sk-api-", "Z9yX7wV5uT3sR1qP8nM6kJ4h"), "credential-openai"],
    [token("sk-ant-api03-", "Q7wE9rT2yU4iO6pA8sD1fG3hJ5kL7zX9"), "credential-anthropic"],
    [token("AIza", "Q7wE9rT2yU4iO6pA8sD1fG3hJ5kL7zX9bC4"), "credential-google-ai"],
    [token("AKIA", "7EXAMPLE9ISBAD2X".replace("EXAMPLE", "Q6M4N8P")), "credential-aws"],
    [token("xai-", "K8mN2pQ4rS6tV9wX3yZ5"), "credential-xai"],
    [token("ghp_", "aB3dE5fG7hJ9kL2mN4pQ6rS8tV1wX3yZ5cD7"), "credential-github"],
    [token("gho_", "bC4eF6gH8jK1mN3pQ5rT7vW9xY2zA4cD6eF8"), "credential-github"],
    [token("ghu_", "cD5fG7hJ9kL2mN4pQ6rS8tV1wX3yZ5aB7cD9"), "credential-github"],
    [token("ghs_", "dE6gH8jK1mN3pQ5rT7vW9xY2zA4bC6dE8fG1"), "credential-github"],
    [token("ghr_", "eF7hJ9kL2mN4pQ6rS8tV1wX3yZ5aB7cD9eF2"), "credential-github"],
    [token("github_pat_", `${"A7bC9dE2fG4hJ6kL8mN1pQ"}_${"R3sT5uV7wX9yZ2aB4cD6eF8gH1jK3mN5pQ7rS9tU2vW4xY6z"}`), "credential-github"],
    [token("gsk_", "B7dF9hJ2kL4mN6pQ8rS1tV3w"), "credential-groq"],
    [token("rpa_", "C8eG1jK3mN5pQ7rT9vX2zA4b"), "credential-replicate"],
  ];

  for (const [credential, expectedRule] of credentials) {
    const result = classifyContent("config/provider.env", `API_KEY=${credential}\n`);
    assert.equal(result?.rule, expectedRule, `expected ${expectedRule}`);
  }
});

test("classifyContent detects supported provider credentials assigned through environment variables", () => {
  const credentials = [
    ["MINIMAX_API_KEY", "mM7qR9sT2uV4wX6yZ8aB1cD3", "credential-minimax"],
    ["ZAI_API_KEY", "zA8bC1dE3fG5hJ7kL9mN2pQ4", "credential-zai"],
    ["GLM_API_KEY", "gL9mN2pQ4rS6tV8wX1yZ3aB5", "credential-glm"],
    ["ZHIPUAI_API_KEY", "zH1jK3mN5pQ7rS9tV2wX4yZ6", "credential-zhipu"],
  ];

  for (const [name, credential, expectedRule] of credentials) {
    const result = classifyContent("config/provider.env", `${name}=${credential}\n`);
    assert.equal(result?.rule, expectedRule, `expected ${expectedRule}`);
  }
});

test("classifyContent does not treat placeholder words embedded in a credential as safe", () => {
  const credential = token("sk-", "aB3dE5testG7hJ9kL2mN4pQ6rS8");
  assert.equal(
    classifyContent("config/provider.env", `OPENAI_API_KEY=${credential}\n`)?.rule,
    "credential-openai",
  );
});

test("classifyContent does not treat repeated or sequential substrings as placeholders", () => {
  const embeddedRepeat = token("sk-", "aB3dE5ffffffffffffG7hJ9kL2mN4pQ6");
  const embeddedSequence = "mM7qR9sT2uV40123456789wX6yZ8aB1cD3";

  assert.equal(
    classifyContent("config/provider.env", `OPENAI_API_KEY=${embeddedRepeat}\n`)?.rule,
    "credential-openai",
  );
  assert.equal(
    classifyContent("config/provider.env", `MINIMAX_API_KEY=${embeddedSequence}\n`)?.rule,
    "credential-minimax",
  );
});

test("classifyContent ignores credential regex source and obvious placeholders", () => {
  const safeContents = [
    String.raw`/\bsk-[A-Za-z0-9_-]{16,}\b/`,
    String.raw`github_pat_[A-Za-z0-9_]{50,}`,
    "OPENAI_API_KEY=sk-abcdefghijklmnop",
    "OPENAI_API_KEY=sk-EXAMPLEEXAMPLEEXAMPLE",
    "ANTHROPIC_API_KEY=sk-ant-api03-REPLACE_WITH_YOUR_KEY",
    "GOOGLE_API_KEY=AIzaPLACEHOLDERPLACEHOLDERPLACEHOLDER123",
    "AWS_ACCESS_KEY_ID=AKIATESTTESTTESTTEST",
    "XAI_API_KEY=xai-REDACTEDREDACTED",
    "GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "GITHUB_TOKEN=gho_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "GITHUB_TOKEN=ghu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "GITHUB_TOKEN=ghs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "GITHUB_TOKEN=ghr_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "GROQ_API_KEY=gsk_DUMMYDUMMYDUMMYDUMMY",
    "REPLICATE_API_TOKEN=rpa_FAKEFAKEFAKEFAKE",
  ];

  for (const content of safeContents) {
    assert.equal(classifyContent("docs/example.md", content), null, content);
  }
});

test("classifyContent accepts the protected provider bridge's explicit synthetic fixture", () => {
  assert.equal(
    classifyContent(
      "browser-first/test/provider-bridge-session-secrets.test.mjs",
      'MINIMAX_API_KEY: "minimax-env-credential"',
    ),
    null,
  );
});

test("classifyContent safely skips binary buffers", () => {
  const binary = Buffer.from([0, 255, 254, ...Buffer.from("/Users/dr.tom/private")]);
  assert.doesNotThrow(() => classifyContent("fixtures/profile.db", binary));
  assert.equal(classifyContent("fixtures/profile.db", binary), null);
});

test("classifyContent checks the entire bounded buffer for binary NUL bytes", () => {
  const binary = Buffer.concat([
    Buffer.alloc(9000, "a"),
    Buffer.from([0]),
    Buffer.from("/Users/dr.tom/private"),
  ]);
  assert.equal(classifyContent("fixtures/late-nul.db", binary), null);
});

test("scanRepository checks content only when enabled", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "docs/setup.md", "Use /Users/dr.tom/project for local setup.\n");

    assert.deepEqual(await scanRepository(root), []);
    const violations = await scanRepository(root, { checkContent: true });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "docs/setup.md");
    assert.equal(violations[0].rule, "founder-path");
  });
});

test("scanRepository rejects symbolic link candidates", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "target.txt", "ordinary content\n");
    await symlink("target.txt", join(root, "linked.txt"));

    const violations = await scanRepository(root, { checkContent: true });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "linked.txt");
    assert.equal(violations[0].rule, "symlink");
  });
});

test("scanRepository rejects candidates escaping through a symlinked parent", async () => {
  await withTempDirectory(async (root) => {
    await withTempDirectory(async (outside) => {
      execFileSync("git", ["init", "--quiet", root]);
      await writeFixture(root, "parent/file.txt", "tracked fixture\n");
      execFileSync("git", ["-C", root, "add", "parent/file.txt"]);
      await writeFixture(root, ".gitignore", "parent\n");
      await rm(join(root, "parent"), { recursive: true });
      await writeFixture(outside, "file.txt", "outside fixture\n");
      await symlink(outside, join(root, "parent"));

      const violations = await scanRepository(root, { checkContent: true });
      assert.equal(violations.length, 1);
      assert.equal(violations[0].path, "parent/file.txt");
      assert.equal(violations[0].rule, "path-escape");
    });
  });
});

test("scanRepository does not inspect content after a forbidden path violation", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "runs/private/result.txt", "/Users/dr.tom/private\n");

    const violations = await scanRepository(root, { checkContent: true });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "forbidden-path");
  });
});

test("scanRepository does not inspect content after a size violation", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "large.txt", "/Users/dr.tom/private\n");

    const violations = await scanRepository(root, {
      checkContent: true,
      maxFileSize: 8,
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "large-file");
  });
});

test("scanRepository bounds content reads for allowlisted large files", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "large.txt", `safe-prefix-${"x".repeat(64)}/Users/dr.tom/private\n`);

    const violations = await scanRepository(root, {
      checkContent: true,
      contentScanLimit: 32,
      maxFileSize: 16,
      sizeAllowlist: ["large.txt"],
    });
    assert.deepEqual(violations, []);
  });
});

test("scanRepository rejects files changed during a bounded content read", async () => {
  await withTempDirectory(async (root) => {
    const candidatePath = join(root, "changing.txt");
    await writeFixture(root, "changing.txt", "ordinary content\n");

    const probe = await openFile(candidatePath, "r");
    const fileHandlePrototype = Object.getPrototypeOf(probe);
    const originalRead = fileHandlePrototype.read;
    await probe.close();
    let mutated = false;

    fileHandlePrototype.read = async function patchedRead(...args) {
      const result = await originalRead.apply(this, args);
      if (!mutated) {
        mutated = true;
        await appendFile(candidatePath, "changed\n");
      }
      return result;
    };

    try {
      const violations = await scanRepository(root, { checkContent: true });
      assert.equal(mutated, true);
      assert.equal(violations.length, 1);
      assert.equal(violations[0].path, "changing.txt");
      assert.equal(violations[0].rule, "file-changed-during-read");
    } finally {
      fileHandlePrototype.read = originalRead;
    }
  });
});

test("scanRepository rejects a candidate swapped to a symlink before content open", async () => {
  await withTempDirectory(async (root) => {
    const candidatePath = join(root, "candidate.txt");
    await writeFixture(root, "candidate.txt", "x".repeat(32));
    await writeFixture(root, "target.txt", "/Users/dr.tom/x");

    const violations = await scanRepository(root, {
      checkContent: true,
      contentAllowlist: ["target.txt"],
      maxFileSize: 20,
      sizeAllowlist: (path) => {
        if (path === "candidate.txt") {
          unlinkSync(candidatePath);
          symlinkSync("target.txt", candidatePath);
        }
        return true;
      },
    });

    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "candidate.txt");
    assert.equal(violations[0].rule, "symlink");
  });
});

test("scanRepository excludes ignored untracked files in a Git repository", async () => {
  await withTempDirectory(async (root) => {
    execFileSync("git", ["init", "--quiet", root]);
    await writeFixture(root, ".gitignore", "output/\n");
    await writeFixture(root, "src/index.js");
    await writeFixture(root, "output/local-report.json");

    assert.deepEqual(await scanRepository(root), []);
  });
});

test("scanRepository rejects untracked nonignored forbidden files in a Git repository", async () => {
  await withTempDirectory(async (root) => {
    execFileSync("git", ["init", "--quiet", root]);
    await writeFixture(root, "runs/private/result.json");

    const violations = await scanRepository(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "runs/private/result.json");
    assert.equal(violations[0].rule, "forbidden-path");
  });
});

test("scanRepository preserves POSIX backslashes in Git candidate filenames", {
  skip: process.platform === "win32",
}, async () => {
  await withTempDirectory(async (root) => {
    execFileSync("git", ["init", "--quiet", root]);
    await writeFixture(root, "docs\\setup.md", "/Users/dr.tom/project\n");

    const violations = await scanRepository(root, { checkContent: true });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "docs\\setup.md");
    assert.equal(violations[0].rule, "founder-path");
  });
});

test("scanRepository reports Git candidate paths that are not valid UTF-8", {
  skip: process.platform === "win32",
}, async () => {
  await withTempDirectory(async (root) => {
    execFileSync("git", ["init", "--quiet", root]);
    const blobHash = execFileSync("git", ["-C", root, "hash-object", "-w", "--stdin"], {
      encoding: "utf8",
      input: "fixture\n",
    }).trim();
    const indexEntry = Buffer.concat([
      Buffer.from(`100644 ${blobHash}\tinvalid-`),
      Buffer.from([0xff, 0]),
    ]);
    execFileSync("git", ["-C", root, "update-index", "-z", "--index-info"], {
      input: indexEntry,
    });

    const violations = await scanRepository(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "unsupported-path-encoding");
    assert.match(violations[0].message, /UTF-8|encoding/i);
  });
});

test("scanRepository still rejects tracked files under ignored paths", async () => {
  await withTempDirectory(async (root) => {
    execFileSync("git", ["init", "--quiet", root]);
    await writeFixture(root, ".gitignore", "output/\n");
    await writeFixture(root, "output/tracked-report.json");
    execFileSync("git", ["-C", root, "add", "-f", "output/tracked-report.json"]);

    const violations = await scanRepository(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "output/tracked-report.json");
    assert.equal(violations[0].rule, "forbidden-path");
  });
});

test("scanRepository does not allow tracked credentials to bypass content scanning", async () => {
  await withTempDirectory(async (root) => {
    execFileSync("git", ["init", "--quiet", root]);
    await writeFixture(root, ".gitignore", "*.env\n");
    const credential = token("sk-api-", "N8pQ2rS4tV6wX9yZ3aB5cD7e");
    await writeFixture(root, "provider.env", `OPENAI_API_KEY=${credential}\n`);
    execFileSync("git", ["-C", root, "add", "-f", "provider.env"]);

    const violations = await scanRepository(root, {
      checkContent: true,
      contentAllowlist: ["provider.env"],
    });

    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, "provider.env");
    assert.equal(violations[0].rule, "credential-openai");
  });
});

test("CLI exits zero for a clean repository", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "README.md", "Clean fixture\n");
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: root,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed/i);
    assert.match(result.stdout, /prefix/i);
    assert.match(result.stdout, /10 MiB|10485760/);
  });
});

test("CLI enables founder-path content scanning", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "docs/setup.md", "/Users/dr.tom/project\n");
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /docs\/setup\.md/);
    assert.match(`${result.stdout}\n${result.stderr}`, /founder-path/);
  });
});

test("CLI credential diagnostics identify the path and rule without logging the value", async () => {
  await withTempDirectory(async (root) => {
    const credential = token("ghp_", "qR3sT5uV7wX9yZ2aB4cD6eF8gH1jK3mN5pQ7");
    await writeFixture(root, "config/provider.txt", `TOKEN=${credential}\n`);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: root,
      encoding: "utf8",
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.notEqual(result.status, 0);
    assert.match(output, /config\/provider\.txt/);
    assert.match(output, /credential-github/);
    assert.equal(output.includes(credential), false);
  });
});

test("CLI accepts an explicit content allowlist path", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "docs/historical.md", "/Users/dr.tom/archive\n");
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--content-allowlist", "docs/historical.md"],
      { cwd: root, encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed/i);
  });
});

test("CLI executes when the script path is a symbolic link", async () => {
  await withTempDirectory(async (root) => {
    const repositoryRoot = join(root, "repository");
    const linkedScript = join(root, "check-repo-hygiene-link.mjs");
    await mkdir(repositoryRoot);
    await writeFixture(repositoryRoot, "README.md", "Clean fixture\n");
    await symlink(SCRIPT_PATH, linkedScript);

    const result = spawnSync(process.execPath, [linkedScript], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed/i);
  });
});

test("CLI prints actionable violations and exits nonzero", async () => {
  await withTempDirectory(async (root) => {
    await writeFixture(root, "runs/private/result.json");
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /runs\/private\/result\.json/);
    assert.match(`${result.stdout}\n${result.stderr}`, /remove|archive|outside/i);
  });
});

test("CLI quotes and escapes control characters in diagnostic paths", {
  skip: process.platform === "win32",
}, async () => {
  await withTempDirectory(async (root) => {
    const filename = "bad\n\u001b[31m.zip";
    await writeFixture(root, filename);
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.includes("\u001b"), false);
    assert.equal(result.stderr.includes(JSON.stringify(filename)), true);
  });
});
