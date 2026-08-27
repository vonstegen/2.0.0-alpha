import {
  parseAmazonShoppingTask,
  parseClickIntent,
  parseFormsIntent,
  parseNaturalBrowserIntent,
  parseNaturalSearchIntent,
  parseReadPageIntent,
  parseScrollIntent,
  parseTypeIntent
} from "./browser-command-parser.js";

export function controlStepLabel(step) {
  if (step.type === "inspect") return "Inspect active page";
  if (step.type === "open") return `Open ${step.target}`;
  if (step.type === "search") return `${step.action === "news" ? "Search news" : "Search web"}: ${step.query}`;
  if (step.type === "read") return "Read active page";
  if (step.type === "forms") return "Inspect page forms";
  if (step.type === "tabs") return "List open tabs";
  if (step.type === "switch_tab") return `Switch to tab ${step.tabId}`;
  if (step.type === "click") return `Click ${step.ref ? `#${step.ref}` : `"${step.text}"`}`;
  if (step.type === "type") return `Type "${step.text}"${step.ref ? ` into #${step.ref}` : step.field ? ` into ${step.field}` : ""}`;
  if (step.type === "scroll") return `Scroll ${step.direction}`;
  if (step.type === "wait") return `Wait ${step.ms ?? 1000}ms`;
  return step.type;
}

export function dedupeControlSteps(steps) {
  const seen = new Set();
  return steps.filter((step) => {
    const key = JSON.stringify(step);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactText(value, max = 220) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function snapshotSignals(snapshot = {}) {
  const controls = Array.isArray(snapshot?.controls) ? snapshot.controls : [];
  const fields = Array.isArray(snapshot?.fields) ? snapshot.fields : [];
  const text = compactText(snapshot?.text, 900).toLowerCase();
  const labels = [...controls, ...fields]
    .map((item) => compactText(item.text || item.label || item.placeholder || item.name || item.ref, 80).toLowerCase())
    .filter(Boolean)
    .join(" ");
  return {
    controls: controls.length,
    fields: fields.length,
    haystack: [text, labels, compactText(snapshot?.title, 160).toLowerCase(), compactText(snapshot?.url, 220).toLowerCase()].join(" ")
  };
}

function taskClassForGoal(goal, snapshot = {}) {
  const text = `${compactText(goal, 500)} ${snapshotSignals(snapshot).haystack}`.toLowerCase();
  if (/\b(wallet|phantom|sign|signature|dao|vote|proposal|governance|treasury|transaction|transfer|swap|stake|unstake|claim)\b/.test(text)) return "wallet-dao";
  if (/\b(book|booking|appointment|reservation|slot|calendar|schedule)\b/.test(text)) return "booking";
  if (/\b(shop|buy|cart|checkout|amazon|price|product|jeans|pizza|order)\b/.test(text)) return "shopping";
  if (/\b(form|field|type|fill|input|write|edit)\b/.test(text)) return "form-edit";
  if (/\b(news|research|find|search|compare|summarize|investigate|learn)\b/.test(text)) return "research";
  return "page-work";
}

function scenarioForTask({ taskClass, goal, snapshot = {}, signals }) {
  const text = `${compactText(goal, 700)} ${signals?.haystack ?? snapshotSignals(snapshot).haystack}`.toLowerCase();
  if (taskClass === "wallet-dao") {
    return {
      id: "dao-review",
      name: "DAO / wallet review",
      preferredProbes: [
        "Read domain, title, proposal id/title, visible wallet state, quorum, deadline, vote options, and transaction/treasury values.",
        "Use read-only wallet status and DAO audit helpers where available.",
        "Produce instructions and risk evidence; do not operate wallet controls."
      ],
      successSignals: [
        "proposal identity is visible",
        "vote or governance choices are identified",
        "quorum/deadline/treasury values are captured when visible",
        "all signing/voting/transaction steps are left to the human"
      ],
      stopConditions: [
        "wallet connect, vote, sign, execute, queue, transfer, approve, claim, stake, or submit is required",
        "proposal identity or domain cannot be verified from the page"
      ]
    };
  }
  if (taskClass === "shopping") {
    const priceSensitive = /\b(under|less than|below|price|cheap|budget|€|\$|£)\b/.test(text);
    return {
      id: priceSensitive ? "shopping-comparison" : "shopping-discovery",
      name: priceSensitive ? "shopping comparison" : "shopping discovery",
      preferredProbes: [
        "Open/search the requested marketplace or product page.",
        "Read product cards, names, prices, delivery/quality signals, and constraint matches before clicking.",
        "Prefer filters/search refinements over checkout or account actions."
      ],
      successSignals: [
        "at least one visible product matches the requested item",
        priceSensitive ? "visible price satisfies the user budget" : "visible product evidence supports the recommendation",
        "human-only checkout/payment/login boundaries are not crossed"
      ],
      stopConditions: [
        "checkout, buy now, payment, login, shipping address, or public submit is required",
        "product cards/prices are not readable after search/filter attempts"
      ]
    };
  }
  if (taskClass === "booking") {
    return {
      id: "booking-discovery",
      name: "booking discovery",
      preferredProbes: [
        "Open the booking page and read current availability state.",
        "Inspect date/time controls and form fields before clicking.",
        "Use safe navigation between dates/months only when it is clear which control changes availability."
      ],
      successSignals: [
        "available date or time slot is visible",
        "required booking fields are identified without entering sensitive data",
        "final confirmation/payment/public submit is left to the human"
      ],
      stopConditions: [
        "final booking confirmation, payment, login, personal-contact autofill, or public submit is required",
        "availability is hidden behind unreadable iframe/captcha/login"
      ]
    };
  }
  if (taskClass === "research") {
    const news = /\b(news|today|latest|breaking|current)\b/.test(text);
    return {
      id: news ? "news-research-synthesis" : "web-research-synthesis",
      name: news ? "news research synthesis" : "web research synthesis",
      preferredProbes: [
        "Search/open relevant sources and read page evidence before answering.",
        "Use readable open tabs as supporting context when available.",
        "Prefer source-backed synthesis over generic model knowledge."
      ],
      successSignals: [
        "answer is grounded in readable page or tab evidence",
        news ? "recency is visible or uncertainty is stated" : "source context is cited or summarized",
        "no claim depends only on unverified chat memory"
      ],
      stopConditions: [
        "no readable source evidence is available",
        "source dates/recency cannot be verified for a time-sensitive question"
      ]
    };
  }
  if (taskClass === "form-edit") {
    return {
      id: "safe-form-edit",
      name: "safe form editing",
      preferredProbes: [
        "Inspect fields and classify whether they are search/document fields or sensitive personal/credential/payment fields.",
        "Type only into safe fields using observed refs or exact visible labels.",
        "Submit only search/query fields; stop before public submit or account mutations."
      ],
      successSignals: [
        "target field is visible and safe",
        "typed text appears in the intended field",
        "no sensitive personal, credential, payment, wallet, login, or public-submit action is automated"
      ],
      stopConditions: [
        "field is credential, payment, wallet, login, personal-contact, or ambiguous",
        "submitting would publish/send/save/confirm outside a search/query context"
      ]
    };
  }
  return {
    id: "generic-page-control",
    name: "generic page control",
    preferredProbes: [
      "Read the active page before mutation.",
      "Prefer precise visible refs over ambiguous text.",
      "Verify visible page-state change after every action."
    ],
    successSignals: [
      "current URL/title/content confirms progress",
      "requested outcome is visible or a safe blocker is recorded",
      "no human-only boundary is crossed"
    ],
    stopConditions: [
      "target control is ambiguous or not visible",
      "same action repeats after no visible page-state change"
    ]
  };
}

function phaseTemplates(taskClass) {
  if (taskClass === "wallet-dao") {
    return [
      "Read the page and identify proposal, domain, wallet state, governance controls, and risk fields.",
      "Prepare human-readable instructions and audit evidence without connecting wallet or signing.",
      "Stop before wallet connect, vote, signature, transaction, transfer, execution, or public submission."
    ];
  }
  if (taskClass === "shopping") {
    return [
      "Open or search the requested shopping target.",
      "Read results and filter by the user constraints such as price, product type, and quality signals.",
      "Stop before checkout, payment, login, public submit, or irreversible account actions."
    ];
  }
  if (taskClass === "booking") {
    return [
      "Open the booking target and read the current page state.",
      "Inspect visible forms, dates, times, and availability controls before clicking.",
      "Stop before final booking confirmation, payment, login, or public submission."
    ];
  }
  if (taskClass === "research") {
    return [
      "Search or open the relevant source.",
      "Read the current page and collect visible evidence from readable tabs.",
      "Synthesize the answer with source context and stop if the page lacks evidence."
    ];
  }
  if (taskClass === "form-edit") {
    return [
      "Inspect visible fields and classify whether they are safe document/search fields.",
      "Type only into safe editable targets with precise refs or labels.",
      "Stop before sensitive personal, credential, payment, wallet, login, or public-submit fields."
    ];
  }
  return [
    "Read the active page and identify visible controls, fields, and current URL.",
    "Act only through a precise safe target, preferring observed refs over ambiguous labels.",
    "Verify visible page-state change after every action and stop if progress is not proven."
  ];
}

export function buildControlRunbook(goal, snapshot = {}, history = []) {
  const taskClass = taskClassForGoal(goal, snapshot);
  const signals = snapshotSignals(snapshot);
  const scenario = scenarioForTask({ taskClass, goal, snapshot, signals });
  const phases = phaseTemplates(taskClass);
  const completed = Array.isArray(history) ? history.filter((item) => item?.result?.ok).length : 0;
  const blocked = Array.isArray(history) ? history.filter((item) => item?.result?.ok === false || item?.result?.approvalRequired).length : 0;
  const visibleEvidence = [
    signals.controls ? `${signals.controls} visible controls` : "",
    signals.fields ? `${signals.fields} editable fields` : ""
  ].filter(Boolean).join(", ") || "no visible controls or fields recorded";
  return {
    taskClass,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    strategy: `Use the ${scenario.name} scenario runbook inside the ${taskClass} task class: observe page state, choose one safe action, verify, and stop at human-only boundaries.`,
    phases,
    preferredProbes: scenario.preferredProbes,
    successSignals: scenario.successSignals,
    stopConditions: scenario.stopConditions,
    currentPhase: phases[Math.min(completed, phases.length - 1)] ?? phases[0],
    completionCheck: taskClass === "research"
      ? "The answer must be supported by readable page evidence or open-tab context."
      : taskClass === "wallet-dao"
        ? "The output is complete only when risk evidence is summarized and all wallet/signing actions remain human-only."
        : "The task is complete only when the visible page state proves the requested outcome or the trace explains why it stopped.",
    safetyStops: [
      "wallet/signature/transaction/payment/login/credential actions",
      "public submit/post/send/confirm actions unless an explicit approval flow applies",
      "repeating the same action after no visible page-state change"
    ],
    visibleEvidence,
    historySummary: `${completed} successful steps, ${blocked} blocked or approval steps`
  };
}

export function planControlSteps(goal) {
  const normalized = String(goal ?? "").trim();
  const steps = [{ type: "inspect" }];
  const amazonTask = parseAmazonShoppingTask(normalized);
  const browserIntent = parseNaturalBrowserIntent(normalized);
  const searchIntent = parseNaturalSearchIntent(normalized);
  const typeIntent = parseTypeIntent(normalized);
  const clickIntent = parseClickIntent(normalized);
  const scrollIntent = parseScrollIntent(normalized);
  const formsIntent = parseFormsIntent(normalized);
  const readIntent = parseReadPageIntent(normalized);
  const hasDirectPageActions = Boolean(typeIntent || clickIntent || scrollIntent || formsIntent || readIntent);

  if (amazonTask) {
    steps.push({ type: "open", target: amazonTask.url }, { type: "read" });
  } else if (browserIntent) {
    steps.push({ type: "open", target: browserIntent.target }, { type: "read" });
  }
  if (searchIntent && !hasDirectPageActions) {
    steps.push({ type: "search", action: searchIntent.action, query: searchIntent.query }, { type: "read" });
  }
  if (formsIntent || /\b(form|field|input)\b/i.test(normalized)) {
    steps.push({ type: "forms" });
  }
  if (clickIntent) {
    steps.push({ type: "click", text: clickIntent.text });
  }
  if (typeIntent) {
    steps.push({ type: "type", text: typeIntent.text, submit: typeIntent.submit });
  }
  if (scrollIntent) {
    steps.push({ type: "scroll", direction: scrollIntent.direction });
  }
  if (readIntent || steps.length === 1) {
    steps.push({ type: "read" });
  }

  return dedupeControlSteps(steps).slice(0, 8);
}

export function deterministicNextAction(goal, snapshot, history) {
  const runbook = buildControlRunbook(goal, snapshot, history);
  const planned = planControlSteps(goal).filter((step) => step.type !== "inspect");
  const executedCount = history.filter((item) => item.action?.type !== "read" || planned.some((step) => step.type === "read")).length;
  const next = planned[executedCount] ?? null;
  if (!next) {
    return {
      source: "deterministic-fallback",
      status: history.length ? "done" : "blocked",
      thought: history.length ? "The deterministic browser parser has no further safe steps." : "No safe deterministic browser action matched this request.",
      action: null,
      approvalReason: history.length ? null : "Try phrasing this as a visible page action or use /control with a concrete goal.",
      doneSummary: history.length ? "Completed the safe deterministic browser steps available for this goal." : null,
      strategyPhase: runbook.currentPhase,
      strategyRationale: `${runbook.strategy} Success signals: ${runbook.successSignals.join("; ")}.`,
      completionCheck: runbook.completionCheck
    };
  }
  return {
    source: "deterministic-fallback",
    status: "continue",
    thought: `${runbook.currentPhase} Next safe fallback action: ${controlStepLabel(next)}.`,
    action: next,
    approvalReason: null,
    doneSummary: null,
    snapshotTitle: snapshot?.title ?? null,
    strategyPhase: runbook.currentPhase,
    strategyRationale: `${runbook.strategy} Success signals: ${runbook.successSignals.join("; ")}.`,
    completionCheck: runbook.completionCheck
  };
}
