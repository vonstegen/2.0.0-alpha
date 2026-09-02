// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// CP-7.5 §7.5.5 follow-on (the deferred UI piece). Modal dialog that
// surfaces the hard-change list produced by the §7.5.5 permission-diff
// gate. The user must explicitly Allow or Cancel; the install does
// NOT proceed on either choice without an explicit click. On Allow,
// the parent re-invokes the sideload path with `forceOverride: true`.
//
// Mirrors the provider-dialog pattern from `SettingsWorkspace.tsx`
// (`provider-dialog-backdrop` / `provider-dialog-card`).

import { useEffect } from "react";

export interface PermissionDiffHardChange {
  /** Dotted JSON path for the changed field (from `diffAddOnManifest`). */
  path: string;
  /** Stable kind identifier (e.g. `"capability-added"`). */
  kind: string;
  /** Optional capability name (for capability-scoped changes). */
  capability?: string;
}

export interface PermissionDiffPromptProps {
  /** The addon id@publisher pair the prompt applies to (for the header). */
  addonKey: string;
  /** Hard changes surfaced by `applyPermissionDiffGate`. */
  hardChanges: PermissionDiffHardChange[];
  /** Allow → parent re-invokes sideload with `forceOverride: true`. */
  onAllow: () => void;
  /** Cancel → parent clears the prompt state; install is rejected. */
  onCancel: () => void;
}

export const PermissionDiffPrompt = ({
  addonKey,
  hardChanges,
  onAllow,
  onCancel,
}: PermissionDiffPromptProps) => {
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

  return (
    <div
      className="provider-dialog-backdrop"
      role="presentation"
      data-testid="permission-diff-prompt-backdrop"
      onClick={onCancel}
    >
      <form
        className="provider-dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={`New permissions requested for ${addonKey}`}
        data-testid="permission-diff-prompt-card"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onAllow();
        }}
      >
        <div className="provider-dialog-head">
          <div>
            <p className="eyebrow">New permissions requested</p>
            <h3>{addonKey}</h3>
          </div>
          <button
            type="button"
            className="button-quiet"
            data-testid="permission-diff-prompt-cancel-close"
            onClick={onCancel}
          >
            Close
          </button>
        </div>
        <p className="permission-diff-prompt-body">
          This install introduces {hardChanges.length} hard change
          {hardChanges.length === 1 ? "" : "s"}. Review the list below
          before allowing the install to proceed. The change list is
          audit-logged either way.
        </p>
        <ul className="permission-diff-prompt-list" data-testid="permission-diff-prompt-list">
          {hardChanges.map((change, index) => (
            <li
              key={`${change.path}-${index}`}
              data-testid={`permission-diff-prompt-item-${index}`}
            >
              <code className="permission-diff-prompt-path">{change.path}</code>
              <span className="permission-diff-prompt-kind">{change.kind}</span>
              {change.capability ? (
                <span className="permission-diff-prompt-capability">
                  ({change.capability})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="permission-diff-prompt-actions">
          <button
            type="button"
            className="button-quiet"
            data-testid="permission-diff-prompt-cancel"
            onClick={onCancel}
          >
            Cancel install
          </button>
          <button
            type="submit"
            className="button-primary"
            data-testid="permission-diff-prompt-allow"
          >
            Allow install
          </button>
        </div>
      </form>
    </div>
  );
};
