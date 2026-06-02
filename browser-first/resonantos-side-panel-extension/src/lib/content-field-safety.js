// Intent citation: docs/architecture/ADR-036-wallet-capable-browser-host.md

(() => {
  function classifyEditableField(element, { relatedLabelText = () => "" } = {}) {
    const tagName = element?.tagName?.toLowerCase?.() ?? "";
    const type = element instanceof HTMLInputElement ? String(element.getAttribute("type") || "text").toLowerCase() : "";
    const form = element?.closest?.("form");
    const haystack = [
      type,
      tagName,
      element?.getAttribute?.("name"),
      element?.getAttribute?.("id"),
      element?.getAttribute?.("role"),
      element?.getAttribute?.("aria-label"),
      element?.getAttribute?.("placeholder"),
      element?.getAttribute?.("title"),
      element?.getAttribute?.("autocomplete"),
      relatedLabelText(element),
      form?.getAttribute?.("role"),
      form?.getAttribute?.("aria-label"),
      form?.getAttribute?.("id"),
      form?.getAttribute?.("name"),
      form?.getAttribute?.("action")
    ].filter(Boolean).join(" ").toLowerCase();

    if (
      type === "password" ||
      /\b(password|passcode|passphrase|credential|secret|seed|private\s*key|otp|2fa|mfa|one[-\s]?time|verification\s*code|authenticator)\b/.test(haystack)
    ) {
      return { kind: "credential", safeToType: false, safeToSubmit: false, reason: "Credential fields are human-only until the secure vault approval model exists." };
    }
    if (/\b(card|credit|debit|cc-|cvc|cvv|iban|routing|account\s*number|expiry|expiration|billing|payment|checkout|wallet|phantom)\b/.test(haystack)) {
      return { kind: "payment", safeToType: false, safeToSubmit: false, reason: "Payment and wallet fields are human-only." };
    }
    if (/\b(login|signin|sign[-\s]?in|username|user\s*name|account\s*email)\b/.test(haystack)) {
      return { kind: "login", safeToType: false, safeToSubmit: false, reason: "Login fields are human-only." };
    }
    if (
      ["email", "tel"].includes(type) ||
      /\b(email|e-mail|phone|telephone|mobile|address|street|postcode|postal|zip|city|country|first\s*name|last\s*name|full\s*name|surname|guest\s*name)\b/.test(haystack)
    ) {
      return { kind: "personal-contact", safeToType: false, safeToSubmit: false, reason: "Personal contact fields require a human-controlled autofill flow." };
    }
    if (
      type === "search" ||
      element?.getAttribute?.("role") === "searchbox" ||
      form?.getAttribute?.("role") === "search" ||
      /\b(search|query|find|filter|lookup)\b/.test(haystack) ||
      /\bq\b/.test(haystack)
    ) {
      return { kind: "search-query", safeToType: true, safeToSubmit: true, reason: "Search/query fields may be typed and submitted by Agent Control." };
    }
    if (element instanceof HTMLTextAreaElement || element?.isContentEditable) {
      return { kind: "document-edit", safeToType: true, safeToSubmit: false, reason: "Document-like fields may be edited but not submitted automatically." };
    }
    return { kind: "generic-text", safeToType: true, safeToSubmit: false, reason: "Generic text fields may be edited but not submitted automatically." };
  }

  globalThis.ResonantOSContentFieldSafety = Object.freeze({
    classifyEditableField
  });
})();
