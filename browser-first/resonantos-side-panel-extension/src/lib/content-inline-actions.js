(() => {
  const inlineActionList = Object.freeze([
    { action: "custom", label: "Ask", shortcut: "A" },
    { action: "summarize", label: "Summarize", shortcut: "S" },
    { action: "explain", label: "Explain", shortcut: "E" },
    { action: "fact-check", label: "Fact-check", shortcut: "F" },
    { action: "translate", label: "Translate", shortcut: "T" },
    { action: "rewrite", label: "Rewrite", shortcut: "R" },
    { action: "send", label: "Send to side panel", shortcut: "P" },
    { action: "insert", label: "Insert", shortcut: "I" },
  ]);

  const inlineActionByShortcut = (key) =>
    inlineActionList.find((item) => item.shortcut.toLowerCase() === String(key ?? "").toLowerCase())?.action ?? "";

  const renderInlineActions = () => inlineActionList
    .map((item) => `<button type="button" data-action="${item.action}" title="${item.label} (${item.shortcut})">${item.label}<kbd>${item.shortcut}</kbd></button>`)
    .join("");

  globalThis.ResonantOSInlineActions = Object.freeze({
    inlineActionList,
    inlineActionByShortcut,
    renderInlineActions,
  });
})();
