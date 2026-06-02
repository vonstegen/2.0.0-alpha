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
const controlOverlayScriptPath = path.join(
  repoRoot,
  "browser-first",
  "resonantos-side-panel-extension",
  "src",
  "lib",
  "control-overlay.js",
);
const fieldSafetyScriptPath = path.join(
  repoRoot,
  "browser-first",
  "resonantos-side-panel-extension",
  "src",
  "lib",
  "content-field-safety.js",
);
const inlineActionsScriptPath = path.join(
  repoRoot,
  "browser-first",
  "resonantos-side-panel-extension",
  "src",
  "lib",
  "content-inline-actions.js",
);
const controlRefsScriptPath = path.join(
  repoRoot,
  "browser-first",
  "resonantos-side-panel-extension",
  "src",
  "lib",
  "content-control-refs.js",
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
  dom.window.eval(await readFile(controlOverlayScriptPath, "utf8"));
  dom.window.eval(await readFile(fieldSafetyScriptPath, "utf8"));
  dom.window.eval(await readFile(inlineActionsScriptPath, "utf8"));
  dom.window.eval(await readFile(controlRefsScriptPath, "utf8"));
  dom.window.eval(await readFile(contentScriptPath, "utf8"));
  assert.equal(typeof listener, "function");
  return { dom, listener };
}

test("content inline actions expose stable shortcuts and button markup", async () => {
  const dom = new JSDOM("<!doctype html>", { runScripts: "outside-only" });
  dom.window.eval(await readFile(inlineActionsScriptPath, "utf8"));
  const {
    inlineActionByShortcut,
    inlineActionList,
    renderInlineActions,
  } = dom.window.ResonantOSInlineActions;

  assert.equal(inlineActionByShortcut("s"), "summarize");
  assert.equal(inlineActionByShortcut("P"), "send");
  assert.equal(inlineActionByShortcut("x"), "");
  assert.equal(inlineActionList.length, 8);
  assert.match(renderInlineActions(), /data-action="summarize"/);
  assert.match(renderInlineActions(), /<kbd>S<\/kbd>/);
});

test("content control refs preserve existing refs and find escaped values", async () => {
  const dom = new JSDOM(`
    <!doctype html>
    <button id="first">First</button>
    <button id="escaped" data-resonantos-control-ref='x"y'>Escaped</button>
  `, { runScripts: "outside-only" });
  dom.window.eval(await readFile(controlRefsScriptPath, "utf8"));
  const store = dom.window.ResonantOSContentControlRefs.createControlRefStore({
    querySelectorAllDeep: (selector) => Array.from(dom.window.document.querySelectorAll(selector)),
  });

  const first = dom.window.document.querySelector("#first");
  assert.equal(store.attribute, "data-resonantos-control-ref");
  assert.equal(store.ensureControlRef(first), "r1");
  assert.equal(store.ensureControlRef(first), "r1");
  assert.equal(store.elementByControlRef("r1"), first);
  assert.equal(store.elementByControlRef('x"y')?.id, "escaped");
  assert.equal(store.elementByControlRef(""), null);
});

test("content field safety policy classifies high-risk editable fields before automation", async () => {
  const dom = new JSDOM(`
    <!doctype html>
    <form role="search"><input id="search" type="text" name="q"></form>
    <input id="password" type="password" name="password">
    <input id="card" type="text" name="card-number">
    <input id="login" type="text" name="username">
    <input id="email" type="email" name="email">
    <textarea id="draft"></textarea>
    <input id="generic" type="text" name="topic">
  `, { runScripts: "outside-only", url: "https://example.test/" });
  dom.window.eval(await readFile(fieldSafetyScriptPath, "utf8"));
  const classify = (selector) => dom.window.ResonantOSContentFieldSafety.classifyEditableField(dom.window.document.querySelector(selector));

  const searchSafety = classify("#search");
  assert.equal(searchSafety.kind, "search-query");
  assert.equal(searchSafety.safeToType, true);
  assert.equal(searchSafety.safeToSubmit, true);
  assert.equal(searchSafety.reason, "Search/query fields may be typed and submitted by Agent Control.");
  assert.equal(classify("#password").kind, "credential");
  assert.equal(classify("#card").kind, "payment");
  assert.equal(classify("#login").kind, "login");
  assert.equal(classify("#email").kind, "personal-contact");
  assert.equal(classify("#draft").kind, "document-edit");
  assert.equal(classify("#generic").kind, "generic-text");
  assert.equal(classify("#generic").safeToSubmit, false);
});

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

test("content page snapshots expose accessible field labels for planner targeting", async () => {
  const { listener } = await loadContentScript(`
    <!doctype html>
    <label for="booking-date">Preferred booking date</label>
    <input id="booking-date" type="text" value="">
    <span id="project-label">Project name</span>
    <input id="project-name" type="text" aria-labelledby="project-label" value="">
  `);

  let snapshot = null;
  listener({
    channel: "resonantos.browser_first.content",
    type: "read_page",
  }, {}, (payload) => {
    snapshot = payload.snapshot;
  });

  assert.equal(snapshot.fields.find((field) => field.id === "booking-date")?.label, "preferred booking date");
  assert.equal(snapshot.fields.find((field) => field.id === "project-name")?.label, "Project name");
});
