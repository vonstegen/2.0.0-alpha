// @ts-check

/**
 * Returns true when the given element is a text-editable target the dictation
 * shortcut should fire on. Mirrors the predicate at
 * `src/modules/obsidian/ObsidianWorkspace.tsx:577-580` so the React app and the
 * extension agree on what counts as "editable".
 *
 * @param {Element | null} target
 * @returns {boolean}
 */
export function isEditableTarget(target) {
  if (!target) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target instanceof Element && target.closest("[contenteditable='true']")) return true;
  return false;
}

/**
 * Inserts text at the current cursor position of an input or textarea, or at
 * the end if there is no selection. Falls back to appending when the element
 * type does not support `selectionStart`. Dispatches an `input` event so
 * frameworks observing the field re-render.
 *
 * @param {HTMLTextAreaElement | HTMLInputElement} input
 * @param {string} text
 */
export function insertAtCursor(input, text) {
  const value = String(text ?? "").trim();
  if (!value) return;
  const current = input.value ?? "";
  if (typeof input.selectionStart === "number" && typeof input.selectionEnd === "number") {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const prefix = before.length && !before.endsWith(" ") ? " " : "";
    const suffix = after.length && !after.startsWith(" ") ? " " : "";
    input.value = `${before}${prefix}${value}${suffix}${after}`.replace(/\s+/g, " ").trimStart();
    const next = start + (prefix.length + value.length + suffix.length);
    input.setSelectionRange(Math.min(next, input.value.length), Math.min(next, input.value.length));
  } else {
    const prefix = current.trim().length ? " " : "";
    input.value = `${current}${prefix}${value}`.trim();
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
