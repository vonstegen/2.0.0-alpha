import assert from "node:assert/strict";
import test from "node:test";

import {
  daoAffordances,
  daoControlLines,
  daoFieldLines,
  daoRiskChecklistMarkdown,
  walletDaoAuditMarkdown
} from "../resonantos-side-panel-extension/src/lib/wallet-dao-audit-markdown.js";

const snapshot = {
  title: "DAO Vote",
  url: "https://dao.example/proposal/12",
  text: "Proposal #12 asks quorum to move treasury funds. Voting deadline closes on Friday.",
  controls: [
    { text: "Vote For", ref: "btn-1" },
    { text: "Read more", ref: "btn-2" },
    { ariaLabel: "Connect Wallet", ref: "btn-3" },
    { role: "button", text: "Execute Proposal", ref: "btn-4" }
  ],
  fields: [
    { label: "Treasury recipient", ref: "field-1" },
    { placeholder: "Search docs", ref: "field-2" },
    { label: "Vote reason", ref: "field-3" }
  ]
};

test("DAO affordances extract wallet and governance controls without generic page chrome", () => {
  const affordances = daoAffordances(snapshot);

  assert.deepEqual(affordances.visibleControls.map((control) => control.ref), ["btn-1", "btn-3", "btn-4"]);
  assert.deepEqual(affordances.fields.map((field) => field.ref), ["field-1", "field-3"]);
  assert.deepEqual(daoControlLines(affordances.visibleControls), [
    "- Vote For · ref btn-1",
    "- Connect Wallet · ref btn-3",
    "- Execute Proposal · ref btn-4"
  ]);
  assert.deepEqual(daoFieldLines(affordances.fields), [
    "- Treasury recipient · ref field-1",
    "- Vote reason · ref field-3"
  ]);
});

test("DAO risk checklist captures bounded governance evidence", () => {
  const checklist = daoRiskChecklistMarkdown(snapshot);

  assert.ok(checklist.some((line) => line === "- domain: dao.example"));
  assert.ok(checklist.some((line) => /proposal #12/i.test(line)));
  assert.ok(checklist.some((line) => /quorum/i.test(line)));
  assert.ok(checklist.some((line) => /treasury/i.test(line)));
  assert.ok(checklist.some((line) => /deadline closes on Friday/i.test(line)));
});

test("wallet DAO audit markdown preserves read-only human boundary", () => {
  const markdown = walletDaoAuditMarkdown({
    goal: "review proposal 12",
    snapshot,
    walletState: {
      detected: true,
      detectionOnly: true,
      source: "page-probe",
      providers: {
        phantomSolana: { detected: true, isConnected: false }
      }
    }
  });

  assert.match(markdown, /^# Wallet \/ DAO Audit: review proposal 12/m);
  assert.match(markdown, /## Wallet Provider State/);
  assert.match(markdown, /phantom/i);
  assert.match(markdown, /## Visible Wallet \/ Governance Controls[\s\S]*Vote For[\s\S]*Connect Wallet[\s\S]*Execute Proposal/);
  assert.match(markdown, /## Relevant Fields[\s\S]*Treasury recipient[\s\S]*Vote reason/);
  assert.match(markdown, /ResonantOS did not request wallet connection/);
  assert.match(markdown, /did not expose seed\/private keys/);
  assert.match(markdown, /must be completed manually by the human/);
});
