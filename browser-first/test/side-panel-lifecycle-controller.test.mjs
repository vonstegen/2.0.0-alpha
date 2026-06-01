import assert from "node:assert/strict";
import test from "node:test";

import { createSidePanelLifecycleController } from "../resonantos-side-panel-extension/src/lib/side-panel-lifecycle-controller.js";

function createEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      return listeners.get(type)?.(event);
    }
  };
}

function createHarness({ pendingPrompt = "", turnBusy = false, statusLabel = "Ready" } = {}) {
  const events = [];
  const storageState = pendingPrompt ? {
    augmentorPendingSidebarPrompt: { prompt: pendingPrompt }
  } : {};
  let busy = turnBusy;
  const storageChanged = {
    handler: null,
    addListener(handler) {
      this.handler = handler;
    }
  };
  const commandInput = {
    value: "",
    dispatchEvent: (event) => events.push(["input-event", event.type]),
    focus: () => events.push(["focus"])
  };
  const sendButton = createEventTarget();
  const commandForm = {
    querySelector: () => sendButton,
    ...createEventTarget()
  };
  const controller = createSidePanelLifecycleController({
    addMessage: async (role, content) => events.push(["message", role, content]),
    browserJobStore: {
      async toggleMonitorCollapsed() {
        events.push(["toggle-jobs"]);
      }
    },
    clearActivitySoon: (...args) => events.push(["clear-activity", ...args]),
    commandForm,
    commandInput,
    composerController: {
      bind: () => events.push(["composer-bind"]),
      resetUndoStack: (value) => events.push(["reset-undo", value])
    },
    getStatusLabel: () => statusLabel,
    getTurnBusy: () => busy,
    messageActions: {
      attachFiles: async () => events.push(["attach-files"])
    },
    respondToCommand: async (prompt) => events.push(["respond", prompt]),
    setTurnBusy: (value) => {
      busy = value;
      events.push(["busy", value]);
    },
    storage: {
      async get(key) {
        return { [key]: storageState[key] };
      },
      async remove(key) {
        delete storageState[key];
        events.push(["remove", key]);
      }
    },
    storageOnChanged: storageChanged,
    storageKeys: {
      pendingSidebarPrompt: "augmentorPendingSidebarPrompt"
    },
    windowRef: {
      Event: class {
        constructor(type) {
          this.type = type;
        }
      }
    }
  });
  return {
    commandForm,
    commandInput,
    controller,
    events,
    getBusy: () => busy,
    sendButton,
    storageChanged,
    storageState
  };
}

test("side panel lifecycle controller consumes pending sidebar prompt once", async () => {
  const harness = createHarness({ pendingPrompt: "  /browser read  " });

  const consumed = await harness.controller.consumePendingSidebarPrompt();

  assert.equal(consumed, true);
  assert.equal(harness.getBusy(), false);
  assert.equal(harness.storageState.augmentorPendingSidebarPrompt, undefined);
  assert.deepEqual(harness.events, [
    ["remove", "augmentorPendingSidebarPrompt"],
    ["busy", true],
    ["message", "user", "/browser read"],
    ["respond", "/browser read"],
    ["busy", false]
  ]);
});

test("side panel lifecycle controller leaves pending prompt untouched while busy", async () => {
  const harness = createHarness({ pendingPrompt: "/control work", turnBusy: true });

  const consumed = await harness.controller.consumePendingSidebarPrompt();

  assert.equal(consumed, false);
  assert.equal(harness.storageState.augmentorPendingSidebarPrompt.prompt, "/control work");
  assert.deepEqual(harness.events, []);
});

test("side panel lifecycle controller binds storage wakeup and form submit", async () => {
  const harness = createHarness({ statusLabel: "Ready" });
  harness.commandInput.value = "hello Augmentor";

  harness.controller.bindListeners();
  await harness.commandForm.dispatch("submit", {
    preventDefault: () => harness.events.push(["prevent"])
  });

  assert.ok(harness.events.some((event) => event[0] === "composer-bind"));
  assert.deepEqual(harness.events.filter((event) => event[0] !== "composer-bind"), [
    ["prevent"],
    ["busy", true],
    ["message", "user", "hello Augmentor"],
    ["reset-undo", ""],
    ["respond", "hello Augmentor"],
    ["busy", false],
    ["clear-activity"]
  ]);
  assert.equal(harness.commandInput.value, "");
  assert.equal(typeof harness.storageChanged.handler, "function");
});

test("side panel lifecycle controller turns send button into stop while busy", () => {
  const harness = createHarness({ turnBusy: true });
  const stopEvents = [];
  const controller = createSidePanelLifecycleController({
    browserJobStore: {},
    commandForm: {
      querySelector: () => harness.sendButton,
      addEventListener: () => undefined
    },
    commandInput: harness.commandInput,
    composerController: { bind: () => undefined },
    getTurnBusy: () => true,
    messageActions: { attachFiles: async () => undefined },
    stopChatTurn: () => stopEvents.push("stop")
  });

  controller.bindListeners();
  harness.sendButton.dispatch("click", {
    preventDefault: () => stopEvents.push("prevent")
  });

  assert.deepEqual(stopEvents, ["prevent", "stop"]);
});
