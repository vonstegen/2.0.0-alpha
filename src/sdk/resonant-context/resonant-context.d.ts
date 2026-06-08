/**
 * Resonant Context SDK v1.0.0 — TypeScript Declarations
 */

// ── ViewportObserver ────────────────────────────────────────────────────────

export interface SectionConfig {
  selector: string;
  label: string;
  priority?: number;
}

export interface ViewportObserverConfig {
  sections?: SectionConfig[];
  overlaySelectors?: string[];
  /** IntersectionObserver threshold (0–1, default 0.5) */
  threshold?: number;
  /** Max chars to capture from visible text (default 500) */
  maxTextChars?: number;
}

export interface VisibleSection {
  id: string;
  label: string;
  dwellMs: number;
  pctVisible: number;
  priority: number;
  currentlyVisible: boolean;
}

export interface ActiveOverlay {
  id: string;
  type: 'dialog' | 'modal' | 'overlay';
  content: string;
}

export declare class ViewportObserver {
  constructor(config: ViewportObserverConfig);
  /** Returns currently visible sections sorted by priority (descending). */
  getVisibleSections(): VisibleSection[];
  /** Detects and returns the topmost active overlay/modal, or null. */
  getActiveOverlay(): ActiveOverlay | null;
  /** Gets visible text from a specific selector, truncated. */
  getVisibleText(selector: string): string;
  /** Cleanup — disconnects IntersectionObserver and clears internal state. */
  destroy(): void;
}

// ── FormsTracker ─────────────────────────────────────────────────────────────

export interface FormConfig {
  selector: string;
  name?: string;
  priority?: number;
  fields?: Array<{ selector: string } | string>;
}

export interface FormsTrackerConfig {
  forms?: FormConfig[];
  ignoreSelector?: string;
}

export interface FieldState {
  name: string;
  value: string;
  touched: boolean;
}

export interface FormState {
  id: string;
  name: string;
  fields: FieldState[];
  /** 0–1 fraction of filled fields */
  completeness: number;
  priority: number;
}

export declare class FormsTracker {
  constructor(config: FormsTrackerConfig);
  /** Get state of a specific tracked form. */
  getFormState(formSelector: string): FormState | null;
  /** Get state of ALL tracked forms, sorted by priority. */
  getAllFormStates(): FormState[];
  /** Cleanup — removes event listeners. */
  destroy(): void;
}

// ── SessionTracker ───────────────────────────────────────────────────────────

export interface SessionTrackerConfig {
  clickSelectors?: string;
  maxHistory?: number;
  maxClicks?: number;
  persistSession?: boolean;
}

export interface NavigationEntry {
  path: string;
  title: string;
  enteredAt: number;
  dwellMs: number;
}

export interface ClickEntry {
  selector: string;
  text: string;
  ts: number;
}

export interface CurrentPage {
  path: string;
  title: string;
  timeOnPageMs: number;
}

export declare class SessionTracker {
  constructor(config: SessionTrackerConfig);
  getHistory(): NavigationEntry[];
  getClickTrail(): ClickEntry[];
  getCurrentPage(): CurrentPage;
  getEntryPoint(): string;
  destroy(): void;
}

// ── ContextCollector / EventCollector ─────────────────────────────────────────

export interface PageExtractor {
  name: string;
  fn: () => unknown;
}

export interface PageConfig {
  match: (path: string) => boolean;
  sections?: SectionConfig[];
  forms?: FormConfig[];
  overlaySelectors?: string[];
  extractors?: PageExtractor[];
}

export interface DomainPlugin {
  domain?: string;
  pages?: Record<string, PageConfig>;
  overlaySelectors?: string[];
  viewportThreshold?: number;
  maxTextChars?: number;
  clickSelectors?: string;
  maxHistory?: number;
  maxClicks?: number;
  persistSession?: boolean;
  ignoreSelectors?: string;
  globalExtractors?: PageExtractor[];
  messageKeywords?: Record<string, string>;
  truncationOrder?: string[];
  formatContext?: (payload: ContextPayload) => string;
}

export interface ContextPayload {
  v: string;
  domain: string;
  ts: string;
  page: CurrentPage;
  viewport: {
    visibleSections: VisibleSection[];
    activeOverlay: ActiveOverlay | null;
  };
  forms: FormState[];
  session: {
    navigation: NavigationEntry[];
    clickTrail: ClickEntry[];
    entryPoint: string;
  };
  domain_data: Record<string, unknown>;
  summary: string;
}

export interface ContextCollectorConfig {
  plugin?: DomainPlugin;
  maxPayloadChars?: number;
  debug?: boolean;
}

/** The orchestrator / "EventCollector" — public API surface. */
export declare class ContextCollector {
  constructor(config: ContextCollectorConfig);
  /** Collect full context payload. */
  getContext(): ContextPayload;
  /** Collect context with message-intent awareness. */
  getContextForMessage(userMessage: string): ContextPayload;
  /** Cleanup all observers and listeners. */
  destroy(): void;
}

// ── ResonantContext namespace ─────────────────────────────────────────────────

export declare const ResonantContext: {
  readonly version: string;
  /**
   * Initialize the SDK with a domain plugin.
   * @returns A ContextCollector (EventCollector) instance.
   */
  init(config?: ContextCollectorConfig): ContextCollector;
};

// ── window augmentation ───────────────────────────────────────────────────────

declare global {
  interface Window {
    _ResonantContext: {
      ViewportObserver: typeof ViewportObserver;
      FormsTracker: typeof FormsTracker;
      SessionTracker: typeof SessionTracker;
    };
    ResonantContext: typeof ResonantContext;
  }
}
