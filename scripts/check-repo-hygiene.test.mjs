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
