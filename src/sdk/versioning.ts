// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-9 protocol versioning. Task, event, authority, adapter, and manifest
// protocols are versioned independently (doc 12 §Versioning). A declared version
// is compatible under caret semantics; a lower major is rejected as ambiguous
// broadening, never silently aliased.

export const SDK_VERSION = "0.1.0";

export type ProtocolName = "authority" | "task" | "event" | "adapter" | "manifest";

export const PROTOCOL_VERSIONS: Readonly<Record<ProtocolName, string>> = {
  authority: "1.0.0",
  task: "1.0.0",
  event: "1.0.0",
  adapter: "1.0.0",
  manifest: "1.0.0",
};

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(version: string): Semver {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return { major: 0, minor: 0, patch: 0 };
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// Caret compatibility: same major, current >= declared (minor/patch); for 0.x the
// minor is pinned (0.x is pre-stable). Rejects ambiguous broadening.
export function isProtocolCompatible(declared: string, current: string): boolean {
  const d = parseVersion(declared);
  const c = parseVersion(current);
  if (c.major !== d.major) return false;
  if (c.major === 0) {
    if (c.minor !== d.minor) return false;
    return c.patch >= d.patch;
  }
  return c.minor > d.minor || (c.minor === d.minor && c.patch >= d.patch);
}

// Which protocols each extension class depends on (doc 12 §Manifest evolution).
export const EXTENSION_CLASS_PROTOCOLS = {
  "augmentor-extension": ["manifest", "authority", "task", "event"],
  "harness-provider": ["manifest", "authority", "task", "event", "adapter"],
  "system-addon": ["manifest"],
} as const;

export type ExtensionClassKey = keyof typeof EXTENSION_CLASS_PROTOCOLS;

// A manifest is version-compatible when every protocol it declares is compatible
// with the current SDK protocol. Undeclared protocols default to compatible.
export function declaredProtocolsCompatible(
  extensionClass: ExtensionClassKey,
  declared: Partial<Record<ProtocolName, string>>,
): boolean {
  return EXTENSION_CLASS_PROTOCOLS[extensionClass].every(
    (protocol) =>
      declared[protocol] == null ||
      isProtocolCompatible(declared[protocol] as string, PROTOCOL_VERSIONS[protocol]),
  );
}
