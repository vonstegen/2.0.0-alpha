import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createDockTabs } from "../resonantos-side-panel-extension/src/lib/dock-tabs.js";

function setup() {
  const dom = new JSDOM(`
    <nav>
      <button id="tab-site">Site<span id="dot-site" hidden></span></button>
      <button id="tab-jobs">Jobs<span id="dot-jobs" hidden></span></button>
    </nav>
    <section id="popout" hidden><strong id="title"></strong><button id="close">x</button>
      <section id="site-panel">site body</section>
      <section id="jobs-panel">jobs body</section>
    </section>
  `);
  const d = dom.window.document;
  const tabs = [
    { name: "site", button: d.getElementById("tab-site"), dot: d.getElementById("dot-site"), panel: d.getElementById("site-panel") },
    { name: "jobs", button: d.getElementById("tab-jobs"), dot: d.getElementById("dot-jobs"), panel: d.getElementById("jobs-panel") }
  ];
  const controller = createDockTabs({
    tabs,
    popout: d.getElementById("popout"),
    popoutTitle: d.getElementById("title"),
    closeButton: d.getElementById("close"),
    titles: { site: "Site", jobs: "Jobs" },
    observe: false
  });
  return { dom, d, tabs, controller };
}

test("dock tabs open a panel as a titled popout and toggle it closed", () => {
  const { d, controller } = setup();
  controller.bind();
  assert.equal(d.getElementById("popout").hidden, true);

  d.getElementById("tab-jobs").click();
  assert.equal(d.getElementById("popout").hidden, false);
  assert.equal(d.getElementById("popout").dataset.open, "jobs");
  assert.equal(d.getElementById("title").textContent, "Jobs");
  assert.equal(d.getElementById("tab-jobs").getAttribute("aria-expanded"), "true");

  d.getElementById("tab-jobs").click(); // clicking the open tab closes it
  assert.equal(d.getElementById("popout").hidden, true);
  assert.equal(d.getElementById("tab-jobs").getAttribute("aria-expanded"), "false");
});

test("only one panel is open at a time", () => {
  const { d, controller } = setup();
  controller.bind();
  controller.open("site");
  controller.open("jobs");
  assert.equal(d.getElementById("popout").dataset.open, "jobs");
  assert.equal(d.getElementById("tab-site").getAttribute("aria-expanded"), "false");
  assert.equal(d.getElementById("tab-jobs").getAttribute("aria-expanded"), "true");
});

test("new content lights the dot only while the panel is closed", () => {
  const { d, controller } = setup();
  controller.bind();

  d.getElementById("jobs-panel").textContent = "a new job";
  controller.notePanelActivity("jobs");
  assert.equal(d.getElementById("dot-jobs").hidden, false, "closed panel with new content flags activity");

  controller.open("jobs"); // opening clears the dot
  assert.equal(d.getElementById("dot-jobs").hidden, true);

  d.getElementById("jobs-panel").textContent = "another job while open";
  controller.notePanelActivity("jobs");
  assert.equal(d.getElementById("dot-jobs").hidden, true, "an open panel never flags activity");
});

test("identical content does not re-flag activity", () => {
  const { d, controller } = setup();
  controller.bind();
  controller.notePanelActivity("site"); // no change vs baseline
  assert.equal(d.getElementById("dot-site").hidden, true);
});

test("the close button dismisses the open popout", () => {
  const { d, controller } = setup();
  controller.bind();
  controller.open("site");
  d.getElementById("close").click();
  assert.equal(d.getElementById("popout").hidden, true);
  assert.equal(d.getElementById("popout").dataset.open, "none");
});
