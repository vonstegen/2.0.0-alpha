(() => {
  if (globalThis.ResonantOSContentControlRefs) return;
  const defaultControlRefAttribute = "data-resonantos-control-ref";

  const escapeAttributeValue = (value) =>
    globalThis.CSS?.escape?.(value) ?? String(value).replace(/["\\]/g, "\\$&");

  const createControlRefStore = ({
    attribute = defaultControlRefAttribute,
    querySelectorAllDeep,
    refPrefix = "r",
  } = {}) => {
    if (typeof querySelectorAllDeep !== "function") {
      throw new TypeError("createControlRefStore requires querySelectorAllDeep");
    }
    let nextControlRef = 1;

    const ensureControlRef = (element) => {
      if (!element?.getAttribute) return "";
      const existing = element.getAttribute(attribute);
      if (existing) return existing;
      const ref = `${refPrefix}${nextControlRef}`;
      nextControlRef += 1;
      element.setAttribute(attribute, ref);
      return ref;
    };

    const elementByControlRef = (ref) => {
      const normalized = String(ref ?? "").trim();
      if (!normalized) return null;
      const escaped = escapeAttributeValue(normalized);
      return querySelectorAllDeep(`[${attribute}="${escaped}"]`)[0] ?? null;
    };

    return Object.freeze({
      attribute,
      elementByControlRef,
      ensureControlRef,
    });
  };

  globalThis.ResonantOSContentControlRefs = Object.freeze({
    controlRefAttribute: defaultControlRefAttribute,
    createControlRefStore,
  });
})();
