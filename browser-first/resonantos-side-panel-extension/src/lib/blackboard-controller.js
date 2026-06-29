export const BLACKBOARD_CHANNEL = "resonantos.blackboard";
export const BLACKBOARD_RELAY_CHANNEL = "resonantos.blackboard.relay";
export const BLACKBOARD_TO_PANEL_CHANNEL = "resonantos.blackboard.to_panel";
export const BLACKBOARD_EXTENSION_PATH = "src/addons/blackboard/blackboard.html";

export const BLACKBOARD_SYSTEM_PROMPT = [
  "Resonant Blackboard is available as a visual display surface.",
  "When the answer benefits from a diagram, document, table, webpage, image, slide deck, or annotation, include a hidden Blackboard marker and keep the visible prose concise.",
  "Marker format: [BLACKBOARD:command]{valid JSON payload}[/BLACKBOARD].",
  "Allowed commands: draw, document, table, embed, image, present, annotate, clear.",
  "Examples:",
  "[BLACKBOARD:document]{\"markdown\":\"# Summary\\n- Key point\"}[/BLACKBOARD]",
  "[BLACKBOARD:table]{\"title\":\"Status\",\"headers\":[\"Item\",\"State\"],\"rows\":[[\"Bridge\",\"OK\"]]}[/BLACKBOARD]",
  "[BLACKBOARD:draw]{\"shapes\":[{\"type\":\"rect\",\"x\":80,\"y\":80,\"w\":180,\"h\":70,\"label\":\"Augmentor\"},{\"type\":\"arrow\",\"x1\":260,\"y1\":115,\"x2\":420,\"y2\":115},{\"type\":\"rect\",\"x\":430,\"y\":80,\"w\":180,\"h\":70,\"label\":\"Blackboard\"}]}[/BLACKBOARD]"
].join("\n");

const ALLOWED_COMMANDS = new Set([
  "draw",
  "canvas",
  "document",
  "doc",
  "table",
  "embed",
  "web",
  "show",
  "image",
  "present",
  "slides",
  "annotate",
  "clear"
]);

const COMMAND_ALIASES = new Map([
  ["canvas", "draw"],
  ["diagram", "draw"],
  ["doc", "document"],
  ["show", "embed"],
  ["web", "embed"],
  ["slides", "present"]
]);

export function appendBlackboardSystemPrompt(systemPrompt = "") {
  const current = String(systemPrompt ?? "").trim();
  if (/Resonant Blackboard/i.test(current) && /\[BLACKBOARD:/i.test(current)) {
    return current;
  }
  return [current, BLACKBOARD_SYSTEM_PROMPT].filter(Boolean).join("\n\n");
}

export function normalizeBlackboardCommand(command) {
  const raw = String(command ?? "").trim().toLowerCase();
  if (!ALLOWED_COMMANDS.has(raw) && raw !== "diagram") return null;
  return COMMAND_ALIASES.get(raw) || raw;
}

function tryParseJson(body) {
  const raw = String(body ?? "").trim();
  if (!raw) return null;
  if (!/^[{[]/.test(raw)) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function payloadForSlashCommand(command, body) {
  const json = tryParseJson(body);
  if (json && typeof json === "object") return json;
  const text = String(body ?? "").trim();
  switch (command) {
    case "draw":
      return text
        ? {
            shapes: [
              { type: "text", x: 320, y: 120, fontSize: 28, text },
              { type: "rect", x: 180, y: 180, w: 280, h: 110, label: "Blackboard note" }
            ]
          }
        : { shapes: [] };
    case "document":
      return { markdown: text || "# Blackboard\n\nReady for Augmentor output." };
    case "table":
      return text
        ? { title: "Blackboard Table", headers: ["Value"], rows: [[text]] }
        : { headers: [], rows: [] };
    case "embed":
      return { url: text };
    case "image":
      return { src: text, alt: text ? "Blackboard image" : "Drop or paste an image" };
    case "present":
      return json || { slides: [] };
    case "annotate":
      return json || { annotations: [] };
    case "clear":
      return {};
    default:
      return {};
  }
}

function buildSmilePayload(label = "Smile") {
  return {
    shapes: [
      { type: "ellipse", x: 320, y: 220, w: 240, h: 240, width: 4 },
      { type: "ellipse", x: 280, y: 190, w: 28, h: 28, fill: true },
      { type: "ellipse", x: 360, y: 190, w: 28, h: 28, fill: true },
      {
        type: "path",
        width: 5,
        points: [
          [258, 250],
          [280, 278],
          [315, 292],
          [350, 282],
          [382, 250]
        ]
      },
      { type: "text", x: 320, y: 390, fontSize: 28, text: label }
    ]
  };
}

function payloadForNaturalDraw(text) {
  const prompt = String(text ?? "").trim();
  if (/\b(?:smile|smiley|happy\s+face|smiling\s+face)\b/i.test(prompt)) {
    return buildSmilePayload("Smile");
  }
  const label = prompt
    .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:draw|sketch|diagram|visuali[sz]e|render)\s+(?:me\s+)?/i, "")
    .trim() || "Blackboard sketch";
  return {
    shapes: [
      { type: "text", x: 320, y: 120, fontSize: 28, text: label },
      { type: "rect", x: 170, y: 185, w: 300, h: 120, label: "Visual note" }
    ]
  };
}

export function parseBlackboardSlashCommand(value) {
  const match = /^\/\s*(blackboard|draw|diagram|canvas|table|doc|document|show|web|embed|image|present|slides|annotate|clear)(?:\s+([\s\S]*))?$/i.exec(String(value ?? "").trim());
  if (!match) return null;
  if (match[1].toLowerCase() === "blackboard") {
    return { action: "open", command: "open", payload: {}, body: (match[2] ?? "").trim() };
  }
  const command = normalizeBlackboardCommand(match[1]);
  if (!command) return null;
  const body = (match[2] ?? "").trim();
  return { action: "send", command, payload: payloadForSlashCommand(command, body), body };
}

export function parseBlackboardNaturalIntent(value) {
  const prompt = String(value ?? "").trim();
  if (!prompt || prompt.startsWith("/")) return null;

  const drawingVerb = /^(?:please\s+)?(?:can\s+you\s+)?(?:draw|sketch|diagram|visuali[sz]e|render)\b/i;
  const visualCue = /\b(?:smile|smiley|happy\s+face|smiling\s+face|diagram|flow|workflow|architecture|chart|map|canvas|sketch|visual|whiteboard)\b/i;
  const blackboardCue = /\b(?:blackboard|whiteboard|canvas)\b/i;

  if (drawingVerb.test(prompt) && (visualCue.test(prompt) || blackboardCue.test(prompt))) {
    return {
      action: "send",
      command: "draw",
      payload: payloadForNaturalDraw(prompt),
      body: prompt,
      source: "natural"
    };
  }

  return null;
}

export function isBlackboardSlashCommand(value) {
  return Boolean(parseBlackboardSlashCommand(value));
}

function payloadForMarker(command, rawPayload) {
  const json = tryParseJson(rawPayload);
  if (json && typeof json === "object") return json;
  const text = String(rawPayload ?? "").trim();
  if (command === "document") return { markdown: text };
  if (command === "table") return { title: "Blackboard Table", headers: ["Value"], rows: [[text]] };
  if (command === "embed") return { url: text };
  if (command === "image") return { src: text, alt: "Blackboard image" };
  return {};
}

export function parseBlackboardMarkersFromReply(text) {
  const source = String(text ?? "");
  const commands = [];
  const clean = source.replace(/\[BLACKBOARD:([a-z-]+)\]([\s\S]*?)\[\/BLACKBOARD\]/gi, (full, rawCommand, rawPayload) => {
    const command = normalizeBlackboardCommand(rawCommand);
    if (!command) {
      return "\n*[Blackboard command ignored: unsupported command]*\n";
    }
    commands.push({ command, payload: payloadForMarker(command, rawPayload) });
    return `\n*[Sent to Blackboard: ${command}]*\n`;
  }).trim();
  return { text: clean, commands };
}

export async function processBlackboardAssistantReply(text, { sendCommand } = {}) {
  const parsed = parseBlackboardMarkersFromReply(text);
  if (typeof sendCommand === "function") {
    for (const item of parsed.commands) {
      await sendCommand(item.command, item.payload);
    }
  }
  return parsed.text || (parsed.commands.length ? "Sent to Blackboard." : String(text ?? ""));
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

export function createBlackboardController({
  chromeApi = globalThis.chrome,
  extensionPath = BLACKBOARD_EXTENSION_PATH,
  relayDelayMs = 80
} = {}) {
  let blackboardTabId = null;

  const getBlackboardUrl = () => {
    if (typeof chromeApi?.runtime?.getURL === "function") {
      return chromeApi.runtime.getURL(extensionPath);
    }
    return extensionPath;
  };

  async function openBlackboard() {
    const tabsApi = chromeApi?.tabs;
    const url = getBlackboardUrl();
    if (!tabsApi || typeof tabsApi.create !== "function") {
      return { ok: false, error: "Chrome tabs API is unavailable.", url };
    }

    if (blackboardTabId !== null && typeof tabsApi.get === "function") {
      const existing = await tabsApi.get(blackboardTabId).catch(() => null);
      if (existing?.id !== undefined) {
        await tabsApi.update(existing.id, { active: true }).catch(() => undefined);
        if (existing.windowId !== undefined && typeof chromeApi?.windows?.update === "function") {
          await chromeApi.windows.update(existing.windowId, { focused: true }).catch(() => undefined);
        }
        return { ok: true, tabId: existing.id, url };
      }
      blackboardTabId = null;
    }

    const allTabs = typeof tabsApi.query === "function" ? await tabsApi.query({}).catch(() => []) : [];
    const match = allTabs.find((tab) => String(tab.url ?? "").includes(extensionPath));
    if (match?.id !== undefined) {
      blackboardTabId = match.id;
      await tabsApi.update(match.id, { active: true }).catch(() => undefined);
      if (match.windowId !== undefined && typeof chromeApi?.windows?.update === "function") {
        await chromeApi.windows.update(match.windowId, { focused: true }).catch(() => undefined);
      }
      return { ok: true, tabId: match.id, url };
    }

    const tab = await tabsApi.create({ url, active: true });
    blackboardTabId = tab?.id ?? null;
    return { ok: Boolean(tab?.id), tabId: tab?.id ?? null, url };
  }

  async function sendCommand(command, payload = {}) {
    const normalized = normalizeBlackboardCommand(command);
    if (!normalized) return { ok: false, error: `Unsupported Blackboard command: ${command}` };
    const opened = await openBlackboard();
    if (!opened.ok) return opened;
    let lastError = "";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await delay(relayDelayMs + attempt * 80);
      try {
        const response = await chromeApi.runtime.sendMessage({
          channel: BLACKBOARD_RELAY_CHANNEL,
          payload: { channel: BLACKBOARD_CHANNEL, command: normalized, payload }
        });
        if (response?.ok === false) {
          lastError = response.error || "Blackboard relay rejected the command.";
          continue;
        }
        return { ok: true, tabId: opened.tabId, response };
      } catch (error) {
        lastError = safeErrorMessage(error);
      }
    }
    return { ok: false, error: lastError || "Blackboard relay did not acknowledge the command.", tabId: opened.tabId };
  }

  async function runSlashCommand(value, { addMessage } = {}) {
    const parsed = value && typeof value === "object"
      ? value
      : parseBlackboardSlashCommand(value);
    if (!parsed) return false;
    if (parsed.action === "open") {
      const opened = await openBlackboard();
      if (typeof addMessage === "function") {
        await addMessage("system", opened.ok
          ? "Opened Resonant Blackboard."
          : `Blackboard could not open: ${opened.error}`);
      }
      return true;
    }
    const sent = await sendCommand(parsed.command, parsed.payload);
    if (typeof addMessage === "function") {
      await addMessage("system", sent.ok
        ? `Sent ${parsed.command} to Resonant Blackboard.`
        : `Blackboard command failed: ${sent.error}`);
    }
    return true;
  }

  async function processAssistantReply(text) {
    return processBlackboardAssistantReply(text, { sendCommand });
  }

  return {
    getBlackboardUrl,
    openBlackboard,
    processAssistantReply,
    runSlashCommand,
    sendCommand
  };
}

export function formatBlackboardContextMessage(record) {
  const label = String(record?.label || "Blackboard content");
  const mode = String(record?.mode || "unknown");
  const type = String(record?.type || "text");
  let content = String(record?.content ?? "").trim();
  if (/^data:image\//i.test(content)) {
    content = `[${label} captured as image data; ${content.length} characters omitted from chat context.]`;
  }
  if (content.length > 8000) {
    content = `${content.slice(0, 8000)}\n\n[truncated]`;
  }
  return `From Resonant Blackboard (${label}; mode: ${mode}; type: ${type}):\n${content}`;
}

export function installBlackboardContextReceiver({ chromeApi = globalThis.chrome, addMessage } = {}) {
  const storage = chromeApi?.storage;
  if (!storage?.onChanged || typeof addMessage !== "function") {
    return () => undefined;
  }
  let lastTimestamp = "";
  const listener = (changes, area) => {
    if (area !== "session") return;
    const record = changes?.blackboardToPanel?.newValue;
    if (!record) return;
    const timestamp = String(record.timestamp || record.receivedAt || "");
    if (timestamp && timestamp === lastTimestamp) return;
    lastTimestamp = timestamp;
    void addMessage("user", formatBlackboardContextMessage(record)).catch(() => undefined);
  };
  storage.onChanged.addListener(listener);
  return () => storage.onChanged.removeListener?.(listener);
}
