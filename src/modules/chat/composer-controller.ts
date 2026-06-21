// Intent citation: docs/architecture/ADR-002-modular-codebase.md
// Intent citation: docs/architecture/ADR-004-chat-rail.md

import type { MutableRefObject } from "react";

import type { DictationController } from "../../dictation/index.js";
import type { ComposerAttachment } from "./types";
import { isTextLikeFile } from "./utils";

type SetState<T> = (value: T | ((current: T) => T)) => void;

export const attachComposerFiles = async (
  files: FileList | null,
  setAttachments: SetState<ComposerAttachment[]>,
  fileInputRef: MutableRefObject<HTMLInputElement | null>,
): Promise<void> => {
  if (!files?.length) {
    return;
  }

  const nextAttachments = await Promise.all(
    Array.from(files).map(async (file, index) => {
      let content: string | undefined;
      let previewState: ComposerAttachment["previewState"] = "metadata-only";
      if (isTextLikeFile(file) && file.size <= 64 * 1024) {
        previewState = "embedded";
        content = (await file.text()).slice(0, 12000);
      }
      return {
        id: `${file.name}-${file.size}-${Date.now()}-${index}`,
        name: file.name,
        size: file.size,
        type: file.type,
        content,
        previewState,
      } satisfies ComposerAttachment;
    }),
  );

  setAttachments((current) => [...current, ...nextAttachments]);
  if (fileInputRef.current) {
    fileInputRef.current.value = "";
  }
};

export const removeComposerAttachment = (
  attachmentId: string,
  setAttachments: SetState<ComposerAttachment[]>,
): void => {
  setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
};

type ToggleDictationInput = {
  controller: DictationController | null;
  setChatNotice: SetState<string | null>;
};

/**
 * Toggle handler for the chat composer mic button. Delegates to the shared
 * dictation engine controller. The `controller` is created in `App.tsx` and
 * passed in; if it's null (engine preload failed or was never kicked off) we
 * surface a notice and do nothing.
 */
export const toggleComposerDictation = ({
  controller,
  setChatNotice,
}: ToggleDictationInput): void => {
  if (!controller) {
    setChatNotice("Dictation engine is not ready yet.");
    return;
  }
  if (!controller.isReady()) {
    setChatNotice("Dictation model is still loading.");
    return;
  }
  void controller.toggle();
};

/**
 * Compose the latest transcript text into the existing composer string.
 * Returns the new composer value via `setComposer`. The controller already
 * inserts at the cursor; this is a fallback used by callers that pass a
 * `text` callback directly to the engine instead of using `insertAtCursor`.
 */
export const appendComposerTranscript = (current: string, transcript: string): string => {
  const text = transcript.trim();
  if (!text) return current;
  return `${current}${current ? " " : ""}${text}`.trim();
};
