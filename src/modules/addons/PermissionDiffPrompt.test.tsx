// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// CP-7.5 §7.5.5 (deferred UI). Verifies that the PermissionDiffPrompt
// component:
//   1. Renders the addon key + the hard-change list with path + kind.
//   2. Calls onAllow when the Allow button is clicked.
//   3. Calls onCancel when the Cancel button is clicked (also when the
//      Close button or the backdrop is clicked).
//   4. Calls onCancel when Escape is pressed.
//   5. Does not call onAllow when Escape is pressed (Cancel wins).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// @vitest-environment jsdom

import { PermissionDiffPrompt } from "./PermissionDiffPrompt";

const sampleChanges = [
  { path: "requestedCapabilities", kind: "capability-added", capability: "filesystem" },
  { path: "requestedCapabilities", kind: "capability-scope-widened", capability: "network" },
];

describe("CP-7.5 §7.5.5 PermissionDiffPrompt", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the addon key + the hard-change list", () => {
    render(
      <PermissionDiffPrompt
        addonKey="addon.deepseek-harness@local"
        hardChanges={sampleChanges}
        onAllow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: /addon\.deepseek-harness@local/ })).toBeTruthy();
    expect(screen.getByTestId("permission-diff-prompt-item-0")).toBeTruthy();
    expect(screen.getByTestId("permission-diff-prompt-item-1")).toBeTruthy();
    expect(screen.getByText("capability-added")).toBeTruthy();
    expect(screen.getByText("capability-scope-widened")).toBeTruthy();
    expect(screen.getByText("(filesystem)")).toBeTruthy();
    expect(screen.getByText("(network)")).toBeTruthy();
    expect(screen.getByText(/introduces 2 hard changes/i)).toBeTruthy();
  });

  it("calls onAllow when the Allow button is clicked", () => {
    const onAllow = vi.fn();
    const onCancel = vi.fn();
    render(
      <PermissionDiffPrompt
        addonKey="addon.test@local"
        hardChanges={sampleChanges}
        onAllow={onAllow}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("permission-diff-prompt-allow"));
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when the Cancel button is clicked", () => {
    const onAllow = vi.fn();
    const onCancel = vi.fn();
    render(
      <PermissionDiffPrompt
        addonKey="addon.test@local"
        hardChanges={sampleChanges}
        onAllow={onAllow}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("permission-diff-prompt-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it("calls onCancel when the Close button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <PermissionDiffPrompt
        addonKey="addon.test@local"
        hardChanges={sampleChanges}
        onAllow={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("permission-diff-prompt-cancel-close"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <PermissionDiffPrompt
        addonKey="addon.test@local"
        hardChanges={sampleChanges}
        onAllow={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("permission-diff-prompt-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape is pressed (and not onAllow)", () => {
    const onAllow = vi.fn();
    const onCancel = vi.fn();
    render(
      <PermissionDiffPrompt
        addonKey="addon.test@local"
        hardChanges={sampleChanges}
        onAllow={onAllow}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAllow).not.toHaveBeenCalled();
  });

  it("renders a singular hard-change copy when there is exactly one change", () => {
    render(
      <PermissionDiffPrompt
        addonKey="addon.test@local"
        hardChanges={[sampleChanges[0]]}
        onAllow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/introduces 1 hard change(?!s)/)).toBeTruthy();
  });
});
