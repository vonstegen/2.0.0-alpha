// Cross-tab comparison resolver for the Augmentor (#220).
//
// Pure, deterministic: given a user message carrying one or more @tab mentions
// and the open browser tabs, resolve each mention into a comparison item that
// carries tab title/URL provenance, surface unreadable/internal tabs as skipped
// with a visible reason, and detect ambiguous mentions (multiple candidate
// tabs) so the caller can ask for clarification or present candidate refs.
//
// No browsing/navigation authority is added (#220 non-goal). The resolver only
// classifies mentions against the supplied tab list; the controller decides how
// to bind context and post the visible messages.

const MENTION_PATTERN = /@([a-z0-9][a-z0-9 .:_-]{0,80})/gi;

// All unique @tab mentions in a message, in first-seen order, case-insensitively
// de-duplicated. Mirrors parseTabMention's token shape but returns every mention
// so cross-tab comparison can resolve more than one.
export function parseTabMentions(message) {
  const seen = new Set();
  const out = [];
  const text = String(message ?? "");
  const re = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags.replace("g", "g"));
  let match;
  while ((match = re.exec(text))) {
    const mention = match[1].trim().replace(/[.,;!?]+$/g, "");
    if (!mention) continue;
    const key = mention.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mention);
  }
  return out;
}

function tabMatches(tab, needle) {
  const n = String(needle).toLowerCase();
  return String(tab?.title ?? "").toLowerCase().includes(n) ||
    String(tab?.url ?? "").toLowerCase().includes(n);
}

function resolveAmongReadable(mention, readableTabs) {
  // `tab <N>` resolves against the ranked readable tabs (1-indexed), matching
  // the pre-existing resolveTabMention semantics.
  if (/^tab\s+\d+$/i.test(mention)) {
    const index = Number(/\d+/.exec(mention)[0]) - 1;
    const tab = readableTabs[index] ?? null;
    return tab ? { kind: "resolved", tab } : { kind: "missing", mention };
  }
  const matches = readableTabs.filter((tab) => tabMatches(tab, mention));
  if (matches.length === 0) return { kind: "missing", mention };
  if (matches.length === 1) return { kind: "resolved", tab: matches[0] };
  return { kind: "ambiguous", mention, candidates: matches.map((tab) => ({ title: tab.title ?? "", url: tab.url ?? "" })) };
}

// Resolve every @tab mention in `message` against `allTabs`.
// Returns { items, skipped, ambiguous }:
//   items     — resolved readable tabs, each { mention, tabId, title, url }
//               (title/URL provenance), de-duplicated by tab id.
//   skipped   — mentions that did not resolve, each { mention, reason, title, url }
//               where reason names an unreadable/internal tab when one matched,
//               otherwise states no open tab matched.
//   ambiguous — mentions matching more than one readable tab, each
//               { mention, candidates: [{ title, url }] } so the caller can ask
//               for clarification or present candidate refs.
export function resolveTabComparison(message, allTabs, isReadableBrowserTab) {
  const tabs = Array.isArray(allTabs) ? allTabs : [];
  const readable = tabs.filter(isReadableBrowserTab);
  const unreadable = tabs.filter((tab) => !isReadableBrowserTab(tab));
  const mentions = parseTabMentions(message);

  const items = [];
  const skipped = [];
  const ambiguous = [];
  const seenIds = new Set();

  for (const mention of mentions) {
    const result = resolveAmongReadable(mention, readable);
    if (result.kind === "resolved") {
      const tab = result.tab;
      if (tab.id != null) {
        if (seenIds.has(tab.id)) continue;
        seenIds.add(tab.id);
      }
      items.push({ mention, tabId: tab.id ?? null, title: tab.title ?? "", url: tab.url ?? "" });
      continue;
    }
    if (result.kind === "ambiguous") {
      ambiguous.push({ mention, candidates: result.candidates });
      continue;
    }
    // missing: did the mention name an unreadable/internal tab?
    const unreadableHit = unreadable.find((tab) => tabMatches(tab, mention));
    if (unreadableHit) {
      skipped.push({
        mention,
        reason: `Skipped: "${unreadableHit.title || unreadableHit.url || "internal tab"}" is not a readable web page.`,
        title: unreadableHit.title ?? "",
        url: unreadableHit.url ?? ""
      });
    } else if (/^tab\s+\d+$/i.test(mention)) {
      skipped.push({
        mention,
        reason: `Skipped: no readable tab at position ${Number(/\d+/.exec(mention)[0])}.`,
        title: "",
        url: ""
      });
    } else {
      skipped.push({ mention, reason: "Skipped: no open tab matched this reference.", title: "", url: "" });
    }
  }

  return { items, skipped, ambiguous };
}
