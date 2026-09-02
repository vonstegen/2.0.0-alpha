// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// CP-7.5 §7.5.4 follow-on (the deferred UI piece). Modal dialog that
// surfaces an `id@publisher` collision before the user can shadow an
// existing add-on entry per ADR-039. The user must explicitly Allow
// (→ install proceeds, existing entry is shadowed) or Cancel (→ install
// is rejected, no change to the catalog).
//
// Mirrors the provider-dialog pattern from `SettingsWorkspace.tsx`
// (`provider-dialog-backdrop` / `provider-dialog-card`) and the
// `PermissionDiffPrompt` (§7.5.5 UI) component shape.

import { useEffect } from "react";

export interface InstallConflictPromptProps {
  /** The `id@publisher` pair the new manifest collides on. */
  collidingAddonKey: string;
  /** Human-readable name of the existing entry (from the manifest). */
  existingName: string;
  /** Version of the existing entry. */
  existingVersion: string;
  /** Where the existing entry lives (bundled or sideloaded). */
  catalog: "bundled" | "sideloaded";
  /** Path the user is trying to install (for the dialog footer). */
  incomingPath: string;
  /** Allow → parent re-invokes sideload with `forceOverride: true`. */
  onAllow: () => void;
  /** Cancel → parent clears the prompt state; install is rejected. */
  onCancel: () => void;
}

export const InstallConflictPrompt = ({
  collidingAddonKey,
  existingName,
  existingVersion,
  catalog,
  incomingPath,
  onAllow,
  onCancel,
}: InstallConflictPromptProps) => {
  // Escape cancels. Mirrors the convention from SettingsWorkspace.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const catalogLabel =
    catalog === "bundled" ? "bundled catalog (shipped with ResonantOS)" : "your sideloaded catalog";

  return (
    <div
      className="provider-dialog-backdrop"
      role="presentation"
      data-testid="install-conflict-prompt-backdrop"
      onClick={onCancel}
    >
      <form
        className="provider-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Install conflict for ${collidingAddonKey}`}
        data-testid="install-conflict-prompt-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onAllow();
        }}
      >
        <div className="provider-dialog-head">
          <div>
            <p className="eyebrow">Install conflict</p>
            <h3>{collidingAddonKey}</h3>
          </div>
          <button
            type="button"
            className="button-quiet"
            data-testid="install-conflict-prompt-cancel-close"
            onClick={onCancel}
          >
            Close
          </button>
        </div>
        <p className="install-conflict-prompt-body">
          The manifest you are installing collides with an existing
          entry in the {catalogLabel}. The existing entry will be
          shadowed (the catalog will only contain the new manifest) if
          you allow the install to proceed.
        </p>
        <dl
          className="install-conflict-prompt-list"
          data-testid="install-conflict-prompt-list"
        >
          <div className="install-conflict-prompt-row">
            <dt>Existing entry</dt>
            <dd data-testid="install-conflict-prompt-existing-name">
              {existingName}
            </dd>
          </div>
          <div className="install-conflict-prompt-row">
            <dt>Existing version</dt>
            <dd data-testid="install-conflict-prompt-existing-version">
              {existingVersion}
            </dd>
          </div>
          <div className="install-conflict-prompt-row">
            <dt>Catalog</dt>
            <dd data-testid="install-conflict-prompt-catalog">{catalogLabel}</dd>
          </div>
          <div className="install-conflict-prompt-row">
            <dt>Incoming path</dt>
            <dd data-testid="install-conflict-prompt-incoming-path">
              <code>{incomingPath}</code>
            </dd>
          </div>
        </dl>
        <p className="install-conflict-prompt-fineprint">
          Shadowing is irreversible from the host UI — to recover the
          previous entry, re-sideload its manifest. The decision is
          audit-logged either way.
        </p>
        <div className="install-conflict-prompt-actions">
          <button
            type="button"
            className="button-quiet"
            data-testid="install-conflict-prompt-cancel"
            onClick={onCancel}
          >
            Cancel install
          </button>
          <button
            type="submit"
            className="button-primary"
            data-testid="install-conflict-prompt-allow"
          >
            Allow install (shadow existing)
          </button>
        </div>
      </form>
    </div>
  );
};
