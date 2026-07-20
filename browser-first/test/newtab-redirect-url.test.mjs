import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NEW_TAB_URL,
  isRedirectableUrl,
  resolveNewTabRedirectUrl
} from "../resonantos-side-panel-extension/src/lib/newtab-redirect-url.js";

test("default new-tab destination is swisscows", () => {
  assert.equal(DEFAULT_NEW_TAB_URL, "https://swisscows.com/en");
});

test("isRedirectableUrl accepts only http(s)", () => {
  assert.equal(isRedirectableUrl("https://swisscows.com/en"), true);
  assert.equal(isRedirectableUrl("http://example.com"), true);
  assert.equal(isRedirectableUrl("javascript:alert(1)"), false);
  assert.equal(isRedirectableUrl("data:text/html,hi"), false);
  assert.equal(isRedirectableUrl("chrome://settings"), false);
  assert.equal(isRedirectableUrl(""), false);
  assert.equal(isRedirectableUrl("not a url"), false);
});

test("resolveNewTabRedirectUrl falls back to the default for missing or unsafe candidates", () => {
  assert.equal(resolveNewTabRedirectUrl(undefined), DEFAULT_NEW_TAB_URL);
  assert.equal(resolveNewTabRedirectUrl(null), DEFAULT_NEW_TAB_URL);
  assert.equal(resolveNewTabRedirectUrl(""), DEFAULT_NEW_TAB_URL);
  assert.equal(resolveNewTabRedirectUrl("javascript:alert(1)"), DEFAULT_NEW_TAB_URL);
  assert.equal(resolveNewTabRedirectUrl(42), DEFAULT_NEW_TAB_URL);
});

test("resolveNewTabRedirectUrl honors a valid user-chosen destination", () => {
  assert.equal(resolveNewTabRedirectUrl("https://duckduckgo.com"), "https://duckduckgo.com");
});

test("resolveNewTabRedirectUrl allows overriding the default", () => {
  assert.equal(
    resolveNewTabRedirectUrl(undefined, { defaultUrl: "https://example.org" }),
    "https://example.org"
  );
});
