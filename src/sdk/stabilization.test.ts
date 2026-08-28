// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { describe, expect, it } from "vitest";

import { CAPABILITY_GLOSSARY, resolveCapability } from "./glossary";
import { createAugmentorExtensionTemplate, createHarnessProviderTemplate, createSystemAddonTemplate } from "./templates";
import { declaredProtocolsCompatible, isProtocolCompatible, PROTOCOL_VERSIONS } from "./versioning";

describe("protocol versioning", () => {
  it("applies caret semantics and rejects ambiguous broadening", () => {
    expect(isProtocolCompatible("1.0.0", "1.2.0")).toBe(true);
    expect(isProtocolCompatible("1.2.0", "1.0.0")).toBe(false); // current is lower
    expect(isProtocolCompatible("2.0.0", "1.5.0")).toBe(false);  // major mismatch
    expect(isProtocolCompatible("0.1.0", "0.1.5")).toBe(true);   // 0.x pins minor
    expect(isProtocolCompatible("0.1.0", "0.2.0")).toBe(false);  // 0.x minor mismatch
  });

  it("checks the extension-class compatibility matrix", () => {
    expect(declaredProtocolsCompatible("harness-provider", { adapter: "2.0.0" })).toBe(false);
    expect(declaredProtocolsCompatible("harness-provider", { adapter: "1.0.0" })).toBe(true);
    expect(declaredProtocolsCompatible("system-addon", {})).toBe(true);
    expect(declaredProtocolsCompatible("augmentor-extension", { manifest: "0.9.0" })).toBe(false);
  });

  it("versions every protocol independently", () => {
    expect(Object.keys(PROTOCOL_VERSIONS).sort()).toEqual(["adapter", "authority", "event", "manifest", "task"]);
  });
});

describe("capability glossary", () => {
  it("documents every capability in the union", () => {
    expect(Object.keys(CAPABILITY_GLOSSARY)).toHaveLength(13);
    expect(CAPABILITY_GLOSSARY["archive-intake-write"].scope).toBe("intake-only");
  });

  it("resolves known capabilities and rejects unknown names", () => {
    expect(resolveCapability("network")).toBe("network");
    expect(resolveCapability("archive-read")).toBe("archive-read");
    expect(resolveCapability("no-such-capability")).toBeNull();
  });
});

describe("manifest templates", () => {
  it("builds a class-consistent augmentor-extension", () => {
    const manifest = createAugmentorExtensionTemplate({ id: "addon.x", version: "0.1.0", kind: "skill" });
    expect(manifest.extensionClass).toBe("augmentor-extension");
    expect(manifest.kind).toBe("skill");
    expect(manifest.failureBehavior).toBe("fail-closed");
  });

  it("builds a class-consistent harness-provider", () => {
    const manifest = createHarnessProviderTemplate({ id: "addon.h", version: "0.1.0", adapterProtocol: "stdio-json-rpc" });
    expect(manifest.extensionClass).toBe("harness-provider");
    expect(manifest.adapterProtocol).toBe("stdio-json-rpc");
    expect(manifest.cancellationSemantics).toBe("cancel");
  });

  it("builds a class-consistent system-addon", () => {
    const manifest = createSystemAddonTemplate({ id: "addon.s", name: "System", version: "0.1.0" });
    expect(manifest.extensionClass).toBe("system-addon");
    expect(manifest.runtimeType).toBe("ui-module");
  });
});
