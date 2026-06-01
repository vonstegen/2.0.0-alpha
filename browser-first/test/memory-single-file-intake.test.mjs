import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedSingleFileIntake,
  singleFileIntakeContent
} from "../resonantos-side-panel-extension/src/lib/memory-single-file-intake.js";

function fakeFile({ name, type = "text/plain", size = 12, text = "source body" }) {
  return {
    name,
    type,
    size,
    text: async () => text
  };
}

test("single-file intake wraps supported text as raw governed intake", async () => {
  const content = await singleFileIntakeContent(fakeFile({
    name: "research.md",
    type: "text/markdown",
    size: 42,
    text: "# Research\n\nClaim."
  }));

  assert.equal(isSupportedSingleFileIntake(fakeFile({ name: "research.md" })), true);
  assert.match(content, /# research\.md/);
  assert.match(content, /raw source evidence/);
  assert.match(content, /## Content\n# Research\n\nClaim\./);
});

test("single-file intake creates metadata stubs for unsupported binary files", async () => {
  const content = await singleFileIntakeContent(fakeFile({
    name: "audio.mp3",
    type: "audio/mpeg",
    size: 2048,
    text: "should not be read"
  }));

  assert.equal(isSupportedSingleFileIntake(fakeFile({ name: "audio.mp3", type: "audio/mpeg" })), false);
  assert.match(content, /metadata-only attachment stub/);
  assert.match(content, /Install or enable a specialist attachment add-on/);
  assert.doesNotMatch(content, /should not be read/);
});

test("single-file intake rejects oversized or empty supported files", async () => {
  await assert.rejects(
    () => singleFileIntakeContent(fakeFile({ name: "large.txt", size: 1_000_001 })),
    /capped at 1 MB/
  );

  await assert.rejects(
    () => singleFileIntakeContent(fakeFile({ name: "empty.txt", size: 1, text: "  " })),
    /Selected file is empty/
  );
});
