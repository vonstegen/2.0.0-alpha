/**
 * Tests for the Resonant Context SDK (resonant-context.js)
 *
 * The SDK is an IIFE that exports via window._ResonantContext / window.ResonantContext
 * in a browser context.  We load it in jsdom so the globals are available.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ── helpers ───────────────────────────────────────────────────────────────────

const sdkPath = path.resolve(
  fileURLToPath(import.meta.url),
  "../resonant-context.js"
);

/**
 * Evaluate the SDK inside jsdom's window so its IIFE sets up
 * window._ResonantContext and window.ResonantContext.
 */
function loadSdk(): void {
  const src = readFileSync(sdkPath, "utf8");
  // eslint-disable-next-line no-eval
  (window as unknown as Record<string, unknown>).eval
    ? (window as unknown as { eval: (s: string) => void }).eval(src)
    : eval(src); // jsdom provides window.eval
}

/** Minimal IntersectionObserver stub for jsdom. */
function stubIntersectionObserver(): void {
  if (typeof window.IntersectionObserver === "undefined") {
    const MockIO = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      configurable: true,
      value: MockIO,
    });
  }
}

// ── ViewportObserver ──────────────────────────────────────────────────────────

describe("ViewportObserver", () => {
  beforeEach(() => {
    stubIntersectionObserver();
    loadSdk();
  });

  afterEach(() => {
    // Clear SDK globals so each test starts clean
    delete (window as unknown as Record<string, unknown>)._ResonantContext;
    delete (window as unknown as Record<string, unknown>).ResonantContext;
  });

  it("instantiates with a minimal config without throwing", () => {
    const { ViewportObserver } = (window as unknown as {
      _ResonantContext: { ViewportObserver: new (cfg: object) => object };
    })._ResonantContext;

    expect(() => new ViewportObserver({ sections: [] })).not.toThrow();
  });

  it("instantiates with section config", () => {
    const { ViewportObserver } = (window as unknown as {
      _ResonantContext: { ViewportObserver: new (cfg: object) => {
        getVisibleSections: () => unknown[];
      } };
    })._ResonantContext;

    const observer = new ViewportObserver({
      sections: [
        { selector: "main",    label: "Main content", priority: 8 },
        { selector: "article", label: "Article",      priority: 7 },
      ],
      threshold: 0.4,
    });

    expect(observer).toBeDefined();
    // getVisibleSections returns an array (empty in jsdom — no visible elements yet)
    expect(Array.isArray(observer.getVisibleSections())).toBe(true);
  });

  it("start / stop lifecycle: destroy() does not throw", () => {
    const { ViewportObserver } = (window as unknown as {
      _ResonantContext: { ViewportObserver: new (cfg: object) => {
        destroy: () => void;
      } };
    })._ResonantContext;

    const observer = new ViewportObserver({
      sections: [{ selector: "body", label: "Body", priority: 5 }],
    });

    expect(() => observer.destroy()).not.toThrow();
    // Calling destroy() twice should also be safe
    expect(() => observer.destroy()).not.toThrow();
  });

  it("returns correct snapshot shape from getVisibleSections()", () => {
    const { ViewportObserver } = (window as unknown as {
      _ResonantContext: { ViewportObserver: new (cfg: object) => {
        getVisibleSections: () => Array<{
          id: string; label: string; dwellMs: number;
          pctVisible: number; priority: number; currentlyVisible: boolean;
        }>;
      } };
    })._ResonantContext;

    const observer = new ViewportObserver({
      sections: [{ selector: "#does-not-exist", label: "Ghost", priority: 3 }],
    });

    const sections = observer.getVisibleSections();
    // Selector doesn't match anything in jsdom → empty array
    expect(sections).toEqual([]);
  });

  it("getActiveOverlay returns null when no overlay is present", () => {
    const { ViewportObserver } = (window as unknown as {
      _ResonantContext: { ViewportObserver: new (cfg: object) => {
        getActiveOverlay: () => null | { id: string; type: string; content: string };
      } };
    })._ResonantContext;

    const observer = new ViewportObserver({ sections: [] });
    expect(observer.getActiveOverlay()).toBeNull();
  });

  it("getVisibleText returns empty string for missing selector", () => {
    const { ViewportObserver } = (window as unknown as {
      _ResonantContext: { ViewportObserver: new (cfg: object) => {
        getVisibleText: (sel: string) => string;
      } };
    })._ResonantContext;

    const observer = new ViewportObserver({ sections: [] });
    expect(observer.getVisibleText("#missing")).toBe("");
  });
});

// ── ResonantContext.init (ContextCollector / EventCollector) ───────────────────

describe("ResonantContext.init", () => {
  beforeEach(() => {
    stubIntersectionObserver();
    loadSdk();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)._ResonantContext;
    delete (window as unknown as Record<string, unknown>).ResonantContext;
  });

  it("ResonantContext.init returns a ContextCollector instance", () => {
    const ResonantContext = (window as unknown as {
      ResonantContext: { init: (cfg?: object) => {
        getContext: () => object;
        destroy: () => void;
      }; version: string };
    }).ResonantContext;

    expect(ResonantContext).toBeDefined();
    expect(typeof ResonantContext.init).toBe("function");

    const collector = ResonantContext.init({});
    expect(typeof collector.getContext).toBe("function");
    expect(typeof collector.destroy).toBe("function");
  });

  it("getContext() returns a well-shaped payload", () => {
    const ResonantContext = (window as unknown as {
      ResonantContext: { init: (cfg?: object) => {
        getContext: () => Record<string, unknown>;
        destroy: () => void;
      } };
    }).ResonantContext;

    const collector = ResonantContext.init({
      plugin: { domain: "test-domain" },
    });

    const payload = collector.getContext();

    // Schema version
    expect(payload.v).toBe("1.0");

    // Domain echoed through
    expect(payload.domain).toBe("test-domain");

    // Required top-level keys
    expect(payload).toHaveProperty("ts");
    expect(payload).toHaveProperty("page");
    expect(payload).toHaveProperty("viewport");
    expect(payload).toHaveProperty("forms");
    expect(payload).toHaveProperty("session");
    expect(payload).toHaveProperty("domain_data");
    expect(payload).toHaveProperty("summary");

    // Viewport shape
    const viewport = payload.viewport as { visibleSections: unknown[]; activeOverlay: unknown };
    expect(Array.isArray(viewport.visibleSections)).toBe(true);
    expect(viewport).toHaveProperty("activeOverlay");

    // Session shape
    const session = payload.session as {
      navigation: unknown[]; clickTrail: unknown[]; entryPoint: string;
    };
    expect(Array.isArray(session.navigation)).toBe(true);
    expect(Array.isArray(session.clickTrail)).toBe(true);
    expect(typeof session.entryPoint).toBe("string");

    // Forms is an array
    expect(Array.isArray(payload.forms)).toBe(true);

    // domain_data is an object
    expect(typeof payload.domain_data).toBe("object");

    // summary is a string
    expect(typeof payload.summary).toBe("string");
  });

  it("destroy() is idempotent", () => {
    const ResonantContext = (window as unknown as {
      ResonantContext: { init: (cfg?: object) => { destroy: () => void } };
    }).ResonantContext;

    const collector = ResonantContext.init({});
    expect(() => collector.destroy()).not.toThrow();
    expect(() => collector.destroy()).not.toThrow();
  });

  it("version is exposed on ResonantContext namespace", () => {
    const ResonantContext = (window as unknown as {
      ResonantContext: { version: string };
    }).ResonantContext;

    expect(typeof ResonantContext.version).toBe("string");
    expect(ResonantContext.version.length).toBeGreaterThan(0);
  });
});
