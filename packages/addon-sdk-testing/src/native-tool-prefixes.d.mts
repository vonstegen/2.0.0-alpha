// Type declarations for native-tool-prefixes.mjs. The source is a
// plain `.mjs` module shared with the JS-only bridge runtime (which
// cannot import TypeScript); this declaration file gives the TypeScript
// validator (src/sdk/addons/validation.ts) a typed view of the module.

export const NATIVE_TOOL_CAPABILITIES: readonly string[];
export const NATIVE_TOOL_RESERVED_LITERALS: readonly string[];

export type NativeToolNameKind = "none" | "direct-shadow" | "reserved-literal";

export interface NativeToolNameClassification {
  kind: NativeToolNameKind;
  toolName: string;
  nativeCapability?: string;
}

export function classifyAddOnToolName(toolName: string): NativeToolNameClassification;
export function isAddOnToolNameAllowed(toolName: string): boolean;
