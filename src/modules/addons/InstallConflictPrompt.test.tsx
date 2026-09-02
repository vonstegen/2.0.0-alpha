// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// CP-7.5 §7.5.4 follow-on (the deferred UI piece). Verifies that the
// InstallConflictPrompt component:
//   1. Renders the colliding addon key + the existing entry details
//      (name, version, catalog, incoming path).
//   2. Calls onAllow when the Allow button is clicked.
//   3. Calls onCancel when the Cancel button is clicked (also when the
//      Close button or the backdrop is clicked).
//   4. Calls onCancel when Escape is pressed.
//   5. Does not call onAllow when Escape is pressed (Cancel wins).
//   6. Renders the bundled catalog label distinctly from the sideloaded
//      catalog label.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// @vitest-environment jsdom

import { InstallConflictPrompt } from "./InstallConflictPrompt";

describe("CP-7.5 §7.5.4 InstallConflictPrompt", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the colliding addon key + existing entry details (bundled)", () => {
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.hermes@local"
        existingName="Hermes (bundled)"
        existingVersion="0.4.2"
        catalog="bundled"
        incomingPath="/path/to/hermes-shadow.json"
        onAllow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: /addon\.hermes@local/ })).toBeTruthy();
    expect(screen.getByTestId("install-conflict-prompt-existing-name").textContent).toBe(
      "Hermes (bundled)",
    );
    expect(screen.getByTestId("install-conflict-prompt-existing-version").textContent).toBe(
      "0.4.2",
    );
    expect(screen.getByTestId("install-conflict-prompt-catalog").textContent).toMatch(
      /bundled catalog/i,
    );
    expect(screen.getByTestId("install-conflict-prompt-incoming-path").textContent).toBe(
      "/path/to/hermes-shadow.json",
    );
  });

  it("renders the sideloaded catalog label distinctly", () => {
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.deepseek-harness@local"
        existingName="DeepSeek (sideloaded)"
        existingVersion="0.2.0"
        catalog="sideloaded"
        incomingPath="/path/to/deepseek-shadow.json"
        onAllow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("install-conflict-prompt-catalog").textContent).toMatch(
      /sideloaded catalog/i,
    );
  });

  it("calls onAllow when the Allow button is clicked", () => {
    const onAllow = vi.fn();
    const onCancel = vi.fn();
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.test@local"
        existingName="Test"
        existingVersion="1.0.0"
        catalog="sideloaded"
        incomingPath="/path/to/test.json"
        onAllow={onAllow}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("install-conflict-prompt-allow"));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when the Cancel button is clicked", () => {
    const onAllow = vi.fn();
    const onCancel = vi.fn();
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.test@local"
        existingName="Test"
        existingVersion="1.0.0"
        catalog="sideloaded"
        incomingPath="/path/to/test.json"
        onAllow={onAllow}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("install-conflict-prompt-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it("calls onCancel when the Close button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.test@local"
        existingName="Test"
        existingVersion="1.0.0"
        catalog="sideloaded"
        incomingPath="/path/to/test.json"
        onAllow={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("install-conflict-prompt-cancel-close"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.test@local"
        existingName="Test"
        existingVersion="1.0.0"
        catalog="bundled"
        incomingPath="/path/to/test.json"
        onAllow={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("install-conflict-prompt-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape is pressed (and not onAllow)", () => {
    const onAllow = vi.fn();
    const onCancel = vi.fn();
    render(
      <InstallConflictPrompt
        collidingAddonKey="addon.test@local"
        existingName="Test"
        existingVersion="1.0.0"
        catalog="bundled"
        incomingPath="/path/to/test.json"
        onAllow={onAllow}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAllow).not.toHaveBeenCalled();
  });
});
