// @vitest-environment jsdom

// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildDefaultState } from "../../core/defaults";
import { StrategistWorkspace } from "./StrategistWorkspace";

describe("StrategistWorkspace lineage & approval", () => {
  it("renders the user -> Augmentor lineage and an empty approval state", () => {
    render(
      <StrategistWorkspace
        state={buildDefaultState([])}
        displayedStrategistName="Augmentor"
        onStrategistRename={vi.fn()}
        onToggleChannel={vi.fn()}
      />,
    );

    // Lineage panel title and the two architectural steps (user, orchestrator).
    expect(screen.getByText("Lineage & Approval")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.getAllByText("Augmentor").length).toBeGreaterThan(0);

    // Empty approval state (no runtime invocation is wired into the shell yet).
    expect(
      screen.getByText(/No extension invocation is awaiting human approval/),
    ).toBeTruthy();
  });
});
