import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const contentScriptPath = path.join(
  repoRoot,
  "browser-first",
  "resonantos-side-panel-extension",
  "src",
  "content.js",
);

async function loadContentScript(html) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://example.test/login",
  });
  let listener = null;
  dom.window.chrome = {
    runtime: {
      onMessage: {
        addListener(callback) {
          listener = callback;
        },
      },
      sendMessage: () => Promise.resolve(),
    },
    storage: {
      onChanged: {
        addListener() {},
      },
    },
  };
  dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  dom.window.eval(await readFile(contentScriptPath, "utf8"));
  assert.equal(typeof listener, "function");
  return { dom, listener };
}

test("content page snapshots redact sensitive and ambiguous editable values", async () => {
  const { listener } = await loadContentScript(`
    <!doctype html>
    <form>
      <input type="password" name="password" value="hunter2-secret">
      <input type="email" name="email" value="human@example.com">
      <input type="text" name="card-number" value="4111111111111111">
      <input type="text" name="nickname" value="private nickname">
      <input type="search" name="q" value="resonantos browser">
      <textarea name="notes">private textarea draft</textarea>
    </form>
  `);
  let response = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "read_page",
  }, {}, (payload) => {
    response = payload;
  });

  assert.equal(response?.ok, true);
  const serialized = JSON.stringify(response.snapshot.fields);
  assert.doesNotMatch(serialized, /hunter2-secret|human@example\.com|4111111111111111|private nickname|private textarea draft/);
  assert.match(serialized, /\[redacted:credential\]/);
  assert.match(serialized, /\[redacted:personal-contact\]/);
  assert.match(serialized, /\[redacted:payment\]/);
  assert.match(serialized, /\[redacted:generic-text\]/);
  assert.match(serialized, /\[redacted:document-edit\]/);
  assert.match(serialized, /resonantos browser/);
  assert.ok(response.snapshot.fields.every((field) => typeof field.fieldKind === "string"));
});

test("content click actions reject repeated text unless a control ref is supplied", async () => {
  const { listener } = await loadContentScript(`
    <!doctype html>
    <button id="primary">Add</button>
    <button id="secondary">Add</button>
  `);
  let snapshot = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "read_page",
  }, {}, (payload) => {
    snapshot = payload.snapshot;
  });

  let response = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "click_text",
    text: "Add",
  }, {}, (payload) => {
    response = payload;
  });

  assert.equal(response?.ok, false);
  assert.equal(response.ambiguousTarget, true);
  assert.match(response.error, /matched 2 visible candidates/i);
  assert.deepEqual(Array.from(response.candidates, (candidate) => candidate.text), ["Add", "Add"]);
  assert.ok(response.candidates.every((candidate) => /^r\d+$/.test(candidate.ref)));
  assert.equal(snapshot.controls.length, 2);
});

test("content typing actions reject ambiguous fields and preserve existing values", async () => {
  const { dom, listener } = await loadContentScript(`
    <!doctype html>
    <label for="first-search">Search</label>
    <input id="first-search" type="search" value="">
    <label for="second-search">Search</label>
    <input id="second-search" type="search" value="">
  `);

  let response = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "type_text",
    field: "Search",
    text: "resonantos",
  }, {}, (payload) => {
    response = payload;
  });

  assert.equal(response?.ok, false);
  assert.equal(response.ambiguousTarget, true);
  assert.match(response.error, /matched 2 visible candidates/i);
  assert.deepEqual(Array.from(response.candidates, (candidate) => candidate.label), ["search", "search"]);
  assert.equal(dom.window.document.querySelector("#first-search").value, "");
  assert.equal(dom.window.document.querySelector("#second-search").value, "");
});

test("content typing actions use exact editable refs when repeated labels exist", async () => {
  const { dom, listener } = await loadContentScript(`
    <!doctype html>
    <label for="first-search">Search</label>
    <input id="first-search" type="search" value="">
    <label for="second-search">Search</label>
    <input id="second-search" type="search" value="">
  `);
  let snapshot = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "read_page",
  }, {}, (payload) => {
    snapshot = payload.snapshot;
  });
  const secondRef = snapshot.fields.find((field) => field.id === "second-search").ref;

  let response = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "type_text",
    ref: secondRef,
    text: "resonantos",
  }, {}, (payload) => {
    response = payload;
  });

  assert.equal(response?.ok, true);
  assert.equal(response.ref, secondRef);
  assert.equal(dom.window.document.querySelector("#first-search").value, "");
  assert.equal(dom.window.document.querySelector("#second-search").value, "resonantos");
});

test("content page snapshots and typing include open shadow DOM controls safely", async () => {
  const { dom, listener } = await loadContentScript(`
    <!doctype html>
    <div id="shadow-host"></div>
  `);
  const host = dom.window.document.querySelector("#shadow-host");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <button id="shadow-action">Shadow Action</button>
    <label for="shadow-search">Shadow Search</label>
    <input id="shadow-search" type="search" value="private shadow query">
    <label for="shadow-password">Shadow Password</label>
    <input id="shadow-password" type="password" value="shadow-secret">
  `;

  let snapshot = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "read_page",
  }, {}, (payload) => {
    snapshot = payload.snapshot;
  });

  assert.ok(snapshot.controls.some((control) => control.text === "Shadow Action"));
  const searchField = snapshot.fields.find((field) => field.id === "shadow-search");
  const passwordField = snapshot.fields.find((field) => field.id === "shadow-password");
  assert.equal(searchField?.fieldKind, "search-query");
  assert.equal(searchField.valuePreview, "private shadow query");
  assert.equal(passwordField?.fieldKind, "credential");
  assert.equal(passwordField.valuePreview, "[redacted:credential]");

  let response = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "type_text",
    ref: searchField.ref,
    text: "resonantos shadow",
  }, {}, (payload) => {
    response = payload;
  });

  assert.equal(response?.ok, true);
  assert.equal(shadow.querySelector("#shadow-search").value, "resonantos shadow");
});
