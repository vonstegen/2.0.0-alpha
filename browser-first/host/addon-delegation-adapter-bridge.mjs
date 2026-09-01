// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/CP4-LIFECYCLE-EXTRACTION-MIGRATION.md
//
// CP-4 Phase 4 cutover: `.mjs` mirror of the SDK `BaseHarnessProvider` adapter
// pattern. The TypeScript SDK lives under `src/sdk/harnesses/` and the
// bridge-side governed-envelope adapters live in `harness-provider-adapters.mjs`;
// neither shape owns the legacy packet-only `addon-delegation-service.mjs` Hermes
// and OpenCode lifecycles. This file is the canonical author of those lifecycles
// going forward so the host service shrinks to thin glue.
//
// Behavioral parity with the legacy service is preserved bit-for-bit:
//   - Hermes: credential gating (`RESONANTOS_HERMES_EXECUTION`,
//     settings.localCliExecution, payload.enableHermesExecution), `disabledAddons`
//     gate, pre-existing-status guard, MiniMax OpenAI-compatible runtime, Python
//     adapter script (string), env scoping, redact-on-error, deterministic
//     fallback (`adapter === "deterministic"`).
//   - OpenCode: same gates plus workspace-root enforcement, JSON-stream CLI
//     parsing, the explicit `OPENCODE_EXPLICIT_PROVIDER_ENV_KEYS` allowlist, and
//     the same credential-blocked message format.
//
// The bridge takes the host service's existing dependencies (hermesCommand,
// hermesHome, hermesPythonRuntime, opencodeCommand, opencodeRuntimeDiagnostics,
// repoRoot, userRoot, readProviderSecrets, spawnProcess, browserFirstRoot, etc.)
// and returns a structured result. The host service owns the markdown packet
// writes, the host-side `writeDelegationStatus`/`writeXResultArtifact` helpers,
// and the public wire format. The bridge never spawns a real CLI by default —
// the test runtime is dependency-injected so parity tests can exercise the full
// state machine deterministically.

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// ---- Shared markdown helpers (host-side concern, mirrored here so the bridge
// is self-contained for tests; the host service still owns the wire format). ----

function fieldFromMarkdown(content, field) {
  const match = new RegExp(`^- ${field}:\\s*(.+)$`, "mi").exec(content);
  return match ? match[1].trim() : "";
}

function sectionFromMarkdown(content, heading) {
  const normalizedContent = String(content ?? "").replace(/\r\n?/g, "\n");
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`, "i").exec(normalizedContent);
  return match ? match[1].trim() : "";
}

const HERMES_PROVIDER_ENV_KEYS = Object.freeze({
  minimax: ["MINIMAX_API_KEY"],
  "minimax-api": ["MINIMAX_API_KEY"],
  "openai-api": ["OPENAI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  "anthropic-api": ["ANTHROPIC_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  glm: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPUAI_API_KEY"],
  xai: ["XAI_API_KEY"],
  zai: ["ZAI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY"],
  zhipuai: ["ZHIPUAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY"],
});

function sectionListFromMarkdown(content, heading) {
  return sectionFromMarkdown(content, heading)
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function redactCliText(value) {
  return String(value ?? "")
    .replace(/sk-[a-z0-9_-]+/gi, "[redacted-key]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_-]?key\s*[:=]\s*[^\s]+/gi, "api_key=[redacted]")
    .replace(/token\s*[:=]\s*[^\s]+/gi, "token=[redacted]")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret=[redacted]");
}

function redactOpenCodeCliText(value) {
  return String(value ?? "")
    .replace(/sk-[a-z0-9_-]+/gi, "[redacted-key]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_-]?key\s*[:=]\s*[^\s]+/gi, "api_key=[redacted]")
    .replace(/token\s*[:=]\s*[^\s]+/gi, "token=[redacted]")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret=[redacted]");
}

// ---- Provider env keys (shared with the host service's providerEnvKeyDefaults). ----

const OPENCODE_EXPLICIT_PROVIDER_ENV_KEYS = Object.freeze([
  "ANTHROPIC_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "GEMINI_BASE_URL",
  "GOOGLE_GENERATIVE_AI_BASE_URL",
  "GOOGLE_API_BASE_URL",
  "GLM_BASE_URL",
  "MINIMAX_BASE_URL",
  "OPENAI_BASE_URL",
  "OPENROUTER_BASE_URL",
  "XAI_BASE_URL",
  "ZAI_BASE_URL",
  "ZHIPUAI_BASE_URL",
]);

const OPENCODE_PROVIDER_ENV_KEYS = Object.freeze({
  anthropic: ["ANTHROPIC_API_KEY"],
  "anthropic-api": ["ANTHROPIC_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  glm: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPUAI_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-api": ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  xai: ["XAI_API_KEY"],
  zai: ["ZAI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY"],
  zhipuai: ["ZHIPUAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY"],
});

const DEFAULT_OPENCODE_MODEL = "openai/gpt-5.4-mini";
const MINIMAX_OPENCODE_MODEL = "minimax/MiniMax-M3";
const MINIMAX_OPENAI_COMPAT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_HERMES_PROVIDER = "openai-api";
const DEFAULT_HERMES_MODEL = "gpt-5.4-mini";
const DEFAULT_HERMES_MINIMAX_MODEL = "MiniMax-M3";

function openCodeProviderForModel(model) {
  const normalized = String(model ?? "").trim();
  if (/^minimax-m/i.test(normalized)) return "minimax";
  if (/^gpt-/i.test(normalized)) return "openai";
  const slash = normalized.indexOf("/");
  if (slash > 0) return normalized.slice(0, slash).toLowerCase();
  return "openai";
}

function openCodeModel(payload = {}, secrets = {}) {
  const requested = String(payload.model ?? process.env.RESONANTOS_OPENCODE_MODEL ?? "").trim();
  if (requested) return requested;
  if (openCodeProviderEnvKeyListForProvider("minimax").some((k) => providerEnvKeyConfigured(k, secrets))) {
    return MINIMAX_OPENCODE_MODEL;
  }
  return DEFAULT_OPENCODE_MODEL;
}

function isAllowedOpenCodeProviderEnvKey(key) {
  return OPENCODE_EXPLICIT_PROVIDER_ENV_KEYS.includes(key);
}

function openCodeProviderEnvKeys(model) {
  const provider = openCodeProviderForModel(model);
  const explicit = String(process.env.RESONANTOS_OPENCODE_PROVIDER_ENV ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(isAllowedOpenCodeProviderEnvKey);
  return [...new Set([...openCodeProviderEnvKeyListForProvider(provider), ...explicit])];
}

function openCodeProviderEnvKeyListForProvider(provider) {
  return OPENCODE_PROVIDER_ENV_KEYS[provider] ?? [];
}

function providerEnvKeysForProvider(provider) {
  return HERMES_PROVIDER_ENV_KEYS[String(provider ?? "").trim().toLowerCase()] ?? [];
}

function providerEnvKeyConfigured(key, secrets = {}) {
  if (secrets[key]) return true;
  if (String(process.env[key] ?? "").trim()) return true;
  return false;
}

function providerEnvKeysPresent(provider, secrets = {}) {
  const keys = providerEnvKeysForProvider(provider);
  const present = [];
  for (const key of keys) {
    if (providerEnvKeyConfigured(key, secrets)) present.push(key);
  }
  // The host service's `providerSecretIdDefaults` maps a normalized provider
  // to the session secret ids that should be treated as a credential match.
  // We mirror that here so shared-X / X both satisfy the credential gate.
  const providerAliases = {
    "openai-api": ["shared-openai", "openai"],
    "anthropic-api": ["shared-anthropic", "anthropic"],
    "minimax-api": ["shared-minimax", "minimax"],
  };
  const aliases = providerAliases[provider] ?? [`shared-${provider}`, provider];
  for (const [secretId, value] of Object.entries(secrets ?? {})) {
    const normalized = String(secretId).toLowerCase();
    if (aliases.includes(normalized) && value) {
      const apiKey = providerApiKeyForProvider(provider);
      if (apiKey && !present.includes(apiKey)) present.push(apiKey);
    }
    // suppress unused-var lint
    void value;
  }
  return present;
}

function providerApiKeyForProvider(provider) {
  const keys = providerEnvKeysForProvider(provider);
  for (const key of keys) {
    if (key.endsWith("API_KEY")) return key;
  }
  return keys[0] ?? "";
}

function providerEnvFromSecrets(provider, secrets = {}, envKeys = providerEnvKeysForProvider(provider)) {
  const result = {};
  for (const key of envKeys) {
    if (secrets[key]) result[key] = String(secrets[key]);
    else if (String(process.env[key] ?? "").trim()) result[key] = String(process.env[key]);
  }
  const providerAliases = {
    "openai-api": ["shared-openai", "openai"],
    "anthropic-api": ["shared-anthropic", "anthropic"],
    "minimax-api": ["shared-minimax", "minimax"],
  };
  const aliases = providerAliases[provider] ?? [`shared-${provider}`, provider];
  for (const alias of aliases) {
    const sharedValue = secrets[alias];
    if (sharedValue) {
      const apiKey = providerApiKeyForProvider(provider);
      if (apiKey && !result[apiKey]) result[apiKey] = String(sharedValue);
    }
  }
  return result;
}

class HermesProviderAdapterBridge {
  constructor() {
    this.providerId = "hermes";
    this.cancellationSemantics = "cancel";
    this.sandboxStrength = "host-mediated";
  }

  /** Build the deterministic Hermes result (mirror of legacy `deterministicHermesResult`). */
  deterministicResult(packet) {
    const mission = sectionFromMarkdown(packet, "Mission");
    const hasContext = Boolean(sectionFromMarkdown(packet, "Context Packet"));
    return {
      adapter: "deterministic",
      actionsTaken: [
        "Read the governed Hermes delegation packet.",
        "Checked the task boundary and artifact return contract.",
        hasContext ? "Reviewed the attached bounded context packet." : "No additional context packet was attached.",
        "Prepared a reviewable result without external sends or trusted memory writes.",
      ],
      approvalNeeds: [
        "Human approval is required before Hermes sends messages, schedules events, posts publicly, or changes external systems.",
      ],
      finalSummary: `Hermes delegation is ready for review: ${mission}`,
      residualRisks: [
        "This deterministic adapter proves ResonantOS delegation lifecycle behavior; it does not claim the local Hermes model completed real-world research.",
      ],
      verification: [
        "Task packet was parsed.",
        "Safety boundary was preserved.",
        "Result artifact was written under BrowserFirst/DelegationArtifacts/hermes.",
      ],
    };
  }

  /** Build the governed Hermes prompt (mirrors legacy `buildHermesExecutionPrompt`). */
  buildExecutionPrompt(packet) {
    const mission = sectionFromMarkdown(packet, "Mission");
    const context = sectionFromMarkdown(packet, "Context Packet");
    return [
      "You are Hermes operating as a ResonantOS add-on agent.",
      "You are running in reviewable-artifact mode. No interactive tools are available.",
      "",
      "Mission:",
      mission,
      "",
      context ? "Context packet:" : "",
      context,
      "",
      "Rules:",
      "- Return a reviewable artifact only.",
      "- Do not attempt tool calls, function calls, XML tool tags, shell commands, file writes, or local runtime actions.",
      "- Do not include unresolved provider/tool markers such as <tool_call>, tool_call, function_call, or provider control tokens.",
      "- If the mission asks you to create, run, inspect, browse, or execute something, describe the requested action and mark it as requiring approval or unavailable instead of attempting it.",
      "- Do not send messages, schedule events, post publicly, submit forms, operate wallets, expose secrets, or write trusted memory.",
      "- If external action is needed, list it under Approval Needs instead of performing it.",
      "- Keep the output concise and structured with these headings exactly: Final Summary, Actions Taken, Approval Needs, Residual Risks, Verification.",
    ].filter(Boolean).join("\n");
  }

  /** Parse the CLI output (mirror of legacy `parseHermesCliResult`). */
  parseCliOutput(output) {
    const text = String(output ?? "").trim();
    if (/<\s*tool_call\b|tool_call|function_call|]<]minimax\[>\[</i.test(text)) {
      throw new Error("Hermes returned unresolved provider tool-call markup instead of a reviewable artifact.");
    }
    const actionsTaken = sectionListFromMarkdown(text, "Actions Taken");
    const approvalNeeds = sectionListFromMarkdown(text, "Approval Needs");
    const residualRisks = sectionListFromMarkdown(text, "Residual Risks");
    const verification = sectionListFromMarkdown(text, "Verification");
    return {
      adapter: "hermes-cli",
      actionsTaken: actionsTaken.length
        ? actionsTaken
        : ["Hermes returned a result through the local CLI adapter."],
      approvalNeeds: approvalNeeds.length
        ? approvalNeeds
        : ["Human approval is required before any external send, submission, wallet action, or trusted memory write."],
      finalSummary: sectionFromMarkdown(text, "Final Summary") || text.slice(0, 1600) || "Hermes completed without returning a summary.",
      residualRisks: residualRisks.length
        ? residualRisks
        : ["Hermes output was accepted as an add-on artifact and still requires normal human review."],
      verification: verification.length
        ? verification
        : ["Local Hermes CLI returned successfully."],
    };
  }

  /** Loose credential-error detector (mirrors legacy `isHermesProviderCredentialError`). */
  isCredentialError(message) {
    return /(?:selected provider env missing|provider credential unavailable|no inference provider configured|api key|OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY|set an api key)/i
      .test(String(message ?? ""));
  }

  /** Resolve the Hermes provider from the payload + env + session secrets. */
  resolveProvider(payload = {}, secrets = {}) {
    const requested = String(payload.provider ?? process.env.RESONANTOS_HERMES_PROVIDER ?? process.env.HERMES_INFERENCE_PROVIDER ?? "").trim();
    if (requested) return requested;
    if (providerEnvKeysPresent("minimax", secrets).length) return "minimax";
    if (providerEnvKeysPresent("openai-api", secrets).length) return DEFAULT_HERMES_PROVIDER;
    if (providerEnvKeysPresent("openrouter", secrets).length) return "openrouter";
    if (providerEnvKeysPresent("anthropic", secrets).length) return "anthropic";
    return DEFAULT_HERMES_PROVIDER;
  }

  /** Resolve the Hermes model (mirrors legacy `hermesModel`). */
  resolveModel(payload = {}, provider = DEFAULT_HERMES_PROVIDER) {
    const requested = String(payload.model ?? process.env.RESONANTOS_HERMES_MODEL ?? process.env.HERMES_INFERENCE_MODEL ?? "").trim();
    const normalizedProvider = String(provider ?? "").trim().toLowerCase();
    const model = requested || (
      normalizedProvider === "minimax"
        ? DEFAULT_HERMES_MINIMAX_MODEL
        : normalizedProvider === "openrouter"
          ? "openai/gpt-5.4-mini"
          : DEFAULT_HERMES_MODEL
    );
    if ((normalizedProvider === "openai" || normalizedProvider === "openai-api") && model.startsWith("openai/")) {
      return model.slice("openai/".length);
    }
    return model;
  }

  /** Resolve credential state (provider, model, env keys, configured flag). */
  credentialState(payload = {}, secrets = {}) {
    const provider = this.resolveProvider(payload, secrets);
    const model = this.resolveModel(payload, provider);
    const envKeys = providerEnvKeysForProvider(provider);
    const configuredEnvKeys = providerEnvKeysPresent(provider, secrets);
    return {
      provider,
      model,
      envKeys,
      configuredEnvKeys,
      configured: configuredEnvKeys.length > 0,
    };
  }

  /** Build the "credential unavailable" blocked reason. */
  credentialBlockedReason(state) {
    const provider = String(state?.provider ?? DEFAULT_HERMES_PROVIDER);
    const model = String(state?.model ?? DEFAULT_HERMES_MODEL);
    const envHint = state?.envKeys?.length
      ? ` The bridge can also be started with ${state.envKeys.join(" or ")} in its environment.`
      : "";
    return [
      `Hermes provider credential unavailable for ${provider} / ${model}.`,
      "Re-save the provider credential in Settings > Providers so the restarted browser-first bridge has it in session memory.",
      "Provider secrets remain session-only; ResonantOS does not persist plaintext provider credentials for this alpha.",
      envHint.trim(),
    ].filter(Boolean).join(" ");
  }

  /** Build a scoped Hermes env block (HOME/PATH/... + provider keys + HERMES_HOME). */
  scopedEnv({ provider, model, profileHome, secrets = {} } = {}) {
    const providerKeys = providerEnvKeysForProvider(provider);
    const allowed = [
      "HOME", "PATH", "SHELL", "TERM", "TMPDIR", "TEMP", "TMP",
      "LANG", "LC_ALL",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
      "OPENAI_BASE_URL", "HERMES_CONFIG",
      ...providerKeys,
    ];
    const inherited = Object.fromEntries(
      allowed
        .map((key) => [key, process.env[key]])
        .filter(([, value]) => value !== undefined),
    );
    return {
      ...inherited,
      ...providerEnvFromSecrets(provider, secrets, providerKeys),
      HERMES_HOME: profileHome,
      ...(provider ? { HERMES_INFERENCE_PROVIDER: provider } : {}),
      ...(model ? { HERMES_INFERENCE_MODEL: model } : {}),
    };
  }

  /** Mirror of legacy `hermesRuntimeProviderConfig` — MiniMax OpenAI-compat shim. */
  runtimeProviderConfig(provider, secrets = {}) {
    const normalizedProvider = String(provider ?? "").trim().toLowerCase();
    if (normalizedProvider !== "minimax") {
      return { provider, baseUrl: "", apiKey: "", apiMode: "" };
    }
    const baseUrl = String(
      process.env.RESONANTOS_HERMES_MINIMAX_BASE_URL
      ?? process.env.RESONANTOS_MINIMAX_OPENAI_BASE_URL
      ?? MINIMAX_OPENAI_COMPAT_BASE_URL,
    ).trim().replace(/\/+$/, "");
    const apiKey = providerEnvFromSecrets("minimax", secrets).MINIMAX_API_KEY ?? "";
    return {
      provider: "custom",
      baseUrl,
      apiKey,
      apiMode: "chat_completions",
    };
  }

  /** The Python adapter script that runs in the Hermes venv. */
  pythonAdapterScript() {
    return String.raw`import contextlib
import json
import os
import sys
import traceback
from pathlib import Path

prompt_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
agent_root = Path(os.environ["RESONANTOS_HERMES_AGENT_ROOT"])
if str(agent_root) not in sys.path:
    sys.path.insert(0, str(agent_root))

prompt = prompt_path.read_text(encoding="utf-8")
provider = os.environ.get("HERMES_INFERENCE_PROVIDER") or None
model = os.environ.get("HERMES_INFERENCE_MODEL") or ""
base_url = os.environ.get("RESONANTOS_HERMES_BASE_URL") or None
api_key = os.environ.get("RESONANTOS_HERMES_API_KEY") or None
api_mode = os.environ.get("RESONANTOS_HERMES_API_MODE") or None
max_turns = int(os.environ.get("RESONANTOS_HERMES_MAX_TURNS", "20"))

try:
    from run_agent import AIAgent

    agent = AIAgent(
        base_url=base_url,
        api_key=api_key,
        provider=provider,
        api_mode=api_mode,
        model=model,
        max_iterations=max_turns,
        enabled_toolsets=[],
        disabled_toolsets=[],
        quiet_mode=True,
        tool_progress_mode="off",
        platform="cli",
        skip_context_files=False,
        skip_memory=False,
        log_prefix="",
    )
    with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink):
        result = agent.run_conversation(prompt)
    output_path.write_text(json.dumps({
        "ok": True,
        "finalResponse": str(result.get("final_response") or ""),
        "completed": bool(result.get("completed")),
        "apiCalls": int(result.get("api_calls") or 0),
    }), encoding="utf-8")
except BaseException as exc:
    output_path.write_text(json.dumps({
        "ok": False,
        "error": str(exc),
        "traceback": traceback.format_exc(limit=5),
    }), encoding="utf-8")
    raise
`;
  }

  /** Run the Hermes Python adapter in a venv (mirrors legacy `execHermesPythonAdapter`). */
  execPythonAdapter(runtime, promptPath, outputPath, options = {}) {
    const timeout = Math.min(900_000, Math.max(30_000, Number(options.timeout ?? 300_000)));
    const adapterPath = options.adapterPath;
    const spawnProcess = options.spawnProcess;
    return new Promise((resolve, reject) => {
      const child = spawnProcess(runtime.pythonPath, [adapterPath, promptPath, outputPath], {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`Hermes local runtime timed out after ${timeout}ms.`));
      }, timeout);
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const detail = redactCliText(stderr || stdout || `Hermes local runtime exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}.`).trim();
          reject(new Error(detail));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  /**
   * Run a Hermes CLI delegation end-to-end. The host service supplies
   * `browserFirstRoot` and `repoRoot` (absolute paths) so the bridge doesn't
   * need to know the host's `createAddonDelegationService` closure.
   */
  async runCliDelegation({ command, packet, payload = {}, runtime, secrets, profileHome, browserFirstRoot, repoRoot, spawnProcess }) {
    if (!runtime?.installed) {
      throw new Error(
        "Hermes local execution requires an installed Hermes venv with run_agent.py. " +
        "The detected hermes command does not expose a prompt-safe local runtime.",
      );
    }
    const provider = this.resolveProvider(payload, secrets);
    const model = this.resolveModel(payload, provider);
    const runtimeProvider = this.runtimeProviderConfig(provider, secrets);
    const prompt = this.buildExecutionPrompt(packet);
    const tempRoot = path.join(browserFirstRoot, "Runtime", "hermes-prompts");
    await mkdir(tempRoot, { recursive: true });
    const tempDir = await mkdtemp(path.join(tempRoot, "prompt-"));
    const promptPath = path.join(tempDir, "resonantos-hermes-task.md");
    const adapterPath = path.join(tempDir, "resonantos_hermes_adapter.py");
    const outputPath = path.join(tempDir, "result.json");
    try {
      await writeFile(promptPath, prompt, { mode: 0o600 });
      await writeFile(adapterPath, this.pythonAdapterScript(), { mode: 0o600 });
      await chmod(promptPath, 0o600).catch(() => undefined);
      await chmod(adapterPath, 0o600).catch(() => undefined);
      await this.execPythonAdapter(runtime, promptPath, outputPath, {
        adapterPath,
        cwd: repoRoot,
        env: {
          ...this.scopedEnv({ provider, model, profileHome, secrets }),
          ...(runtimeProvider.provider ? { HERMES_INFERENCE_PROVIDER: runtimeProvider.provider } : {}),
          ...(runtimeProvider.baseUrl ? {
            OPENAI_BASE_URL: runtimeProvider.baseUrl,
            RESONANTOS_HERMES_BASE_URL: runtimeProvider.baseUrl,
          } : {}),
          ...(runtimeProvider.apiKey ? {
            OPENAI_API_KEY: runtimeProvider.apiKey,
            RESONANTOS_HERMES_API_KEY: runtimeProvider.apiKey,
          } : {}),
          ...(runtimeProvider.apiMode ? { RESONANTOS_HERMES_API_MODE: runtimeProvider.apiMode } : {}),
          RESONANTOS_HERMES_AGENT_ROOT: runtime.agentRoot,
          RESONANTOS_HERMES_MAX_TURNS: String(Math.min(90, Math.max(1, Number(payload.maxTurns ?? 20)))),
        },
        timeout: Math.min(900_000, Math.max(30_000, Number(payload.timeoutMs ?? 300_000))),
        spawnProcess,
      });
      const rawResult = await readFile(outputPath, "utf8");
      const parsed = JSON.parse(rawResult);
      if (!parsed.ok) {
        throw new Error(redactCliText(parsed.error || "Hermes local runtime failed."));
      }
      return {
        ...this.parseCliOutput(parsed.finalResponse),
        adapter: "hermes-cli",
        model,
        provider,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Run a Hermes delegation end-to-end. Returns one of:
   *   { kind: "blocked", reason, fieldReason, provider?, model? }
   *   { kind: "failed", reason }
   *   { kind: "completed", result, provider, model }
   */
  async startTask({ payload, packet, profileHome, command, runtime, secrets, settings, localExecutionEnabled, disabledAddons, browserFirstRoot, repoRoot, spawnProcess }) {
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_HERMES_ADAPTER ?? "auto").trim().toLowerCase();
    if ((disabledAddons ?? []).includes("addon.hermes")) {
      return {
        kind: "failed",
        reason: "Hermes is switched off in My Add-ons. Enable it before starting a delegation.",
      };
    }
    const currentStatus = fieldFromMarkdown(packet, "status") || "queued";
    if (["completed", "cancelled"].includes(currentStatus)) {
      return {
        kind: "failed",
        reason: `Hermes delegation is already ${currentStatus}.`,
      };
    }
    if (adapter !== "deterministic" && !command) {
      return {
        kind: "blocked",
        reason: "Hermes CLI unavailable. Install or configure Hermes, or run the deterministic adapter in tests.",
        fieldReason: "Hermes CLI unavailable",
      };
    }
    if (adapter !== "deterministic" && !localExecutionEnabled) {
      return {
        kind: "blocked",
        reason: "Hermes CLI was found, but execution is disabled. Set RESONANTOS_HERMES_EXECUTION=enabled or pass enableHermesExecution from a trusted Settings flow.",
        fieldReason: "Hermes execution requires explicit enablement",
      };
    }
    let credentialState = null;
    if (adapter !== "deterministic") {
      credentialState = this.credentialState(payload, secrets);
      if (!credentialState.configured) {
        return {
          kind: "blocked",
          reason: this.credentialBlockedReason(credentialState),
          fieldReason: this.credentialBlockedReason(credentialState),
          provider: credentialState.provider,
          model: credentialState.model,
        };
      }
    }
    let result;
    try {
      result = adapter === "deterministic"
        ? this.deterministicResult(packet)
        : await this.runCliDelegation({
            command,
            packet,
            payload,
            runtime,
            secrets,
            profileHome,
            browserFirstRoot,
            repoRoot,
            spawnProcess,
          });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (adapter !== "deterministic" && this.isCredentialError(message)) {
        const state = credentialState ?? this.credentialState(payload, secrets);
        return {
          kind: "blocked",
          reason: this.credentialBlockedReason(state),
          fieldReason: this.credentialBlockedReason(state),
          provider: state.provider,
          model: state.model,
        };
      }
      return { kind: "failed", reason: message };
    }
    return { kind: "completed", result };
  }
}

// ---- OpenCode provider adapter bridge ----

class OpenCodeProviderAdapterBridge {
  constructor() {
    this.providerId = "opencode";
    this.cancellationSemantics = "finish-atomic";
    this.sandboxStrength = "sandboxed-outer-boundary";
  }

  /** Build a deterministic OpenCode result. */
  deterministicResult(packet, payload, resolveWorkspacePath, repoRoot) {
    const mission = sectionFromMarkdown(packet, "Mission");
    const workspacePath = resolveWorkspacePath(payload ?? {});
    return {
      adapter: "deterministic",
      actionsTaken: [
        "Read the governed OpenCode coding packet.",
        "Checked the coding handoff boundary and required artifact contract.",
        "Prepared a reviewable coding result without shell execution, file edits, provider-secret access, wallet actions, or trusted memory writes.",
      ],
      changedFiles: [],
      commandsRun: [],
      finalSummary: `OpenCode coding delegation is ready for review: ${mission}`,
      residualRisks: [
        "This deterministic adapter proves ResonantOS OpenCode delegation lifecycle behavior; it does not claim code was changed by a local OpenCode runtime.",
      ],
      verification: [
        "Task packet was parsed.",
        "Workspace scope was checked.",
        "Result artifact was written under BrowserFirst/DelegationArtifacts/opencode.",
      ],
      workspacePath: path.relative(repoRoot, workspacePath) || ".",
    };
  }

  /** Build the governed OpenCode prompt. */
  buildExecutionPrompt(packet, workspacePath) {
    const mission = sectionFromMarkdown(packet, "Mission");
    const context = sectionFromMarkdown(packet, "Context Packet");
    return [
      "You are OpenCode operating as a ResonantOS add-on coding agent.",
      "",
      `Workspace: ${workspacePath}`,
      "",
      "Mission:",
      mission,
      "",
      context ? "Context packet:" : "",
      context,
      "",
      "Rules:",
      "- Work only inside the approved workspace.",
      "- Do not access provider secrets, wallets, trusted Living Archive writes, or external send/submission surfaces.",
      "- Return a reviewable artifact.",
      "- Keep the output structured with these headings exactly: Final Summary, Changed Files, Commands Run, Tests, Residual Risks, Verification.",
    ].filter(Boolean).join("\n");
  }

  /** Extract text from a JSON-stream OpenCode CLI output. */
  extractOutputText(output) {
    const raw = String(output ?? "").trim();
    const textEvents = [];
    for (const line of raw.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate.startsWith("{")) continue;
      try {
        const event = JSON.parse(candidate);
        const text = event?.part?.type === "text" ? event.part.text : event?.type === "text" ? event.text : "";
        if (text) textEvents.push(text);
      } catch {
        // Non-JSON output falls back to the raw stream below.
      }
    }
    return textEvents.join("\n\n").trim() || raw;
  }

  /** Parse the OpenCode CLI output. */
  parseCliResult(output, workspacePath, repoRoot) {
    const text = this.extractOutputText(output);
    return {
      adapter: "opencode-cli",
      actionsTaken: ["Local OpenCode CLI returned a coding result through the host adapter."],
      changedFiles: sectionFromMarkdown(text, "Changed Files").split("\n").filter(Boolean),
      commandsRun: sectionFromMarkdown(text, "Commands Run").split("\n").filter(Boolean),
      finalSummary: sectionFromMarkdown(text, "Final Summary") || text.slice(0, 1600) || "OpenCode completed without returning a summary.",
      residualRisks: sectionFromMarkdown(text, "Residual Risks").split("\n").filter(Boolean).length
        ? sectionFromMarkdown(text, "Residual Risks").split("\n").filter(Boolean)
        : ["OpenCode output is an add-on artifact and still requires normal human review."],
      verification: sectionFromMarkdown(text, "Verification").split("\n").filter(Boolean).length
        ? sectionFromMarkdown(text, "Verification").split("\n").filter(Boolean)
        : sectionFromMarkdown(text, "Tests").split("\n").filter(Boolean).length
          ? sectionFromMarkdown(text, "Tests").split("\n").filter(Boolean)
          : ["Local OpenCode CLI returned successfully."],
      workspacePath: path.relative(repoRoot, workspacePath) || ".",
    };
  }

  /** Loose credential-error detector. */
  isCredentialError(message) {
    return /credential|api[_\s-]?key|unauthorized|401|403/i.test(String(message ?? ""));
  }

  /** Resolve credential state for OpenCode. */
  credentialState(payload = {}, secrets = {}) {
    const model = openCodeModel(payload, secrets);
    const provider = openCodeProviderForModel(model);
    const envKeys = openCodeProviderEnvKeys(model);
    const configuredEnvKeys = providerEnvKeysPresent(provider, secrets);
    return {
      provider,
      model,
      envKeys,
      configuredEnvKeys,
      configured: configuredEnvKeys.length > 0,
    };
  }

  /** Build the "credential unavailable" blocked reason. */
  credentialBlockedReason(state) {
    const envHint = state.envKeys.length
      ? ` The bridge can also be started with ${state.envKeys.join(" or ")} in its environment.`
      : "";
    return [
      `OpenCode provider credential unavailable for ${state.provider} / ${state.model}.`,
      "Re-save the provider credential in Settings > Providers so the restarted browser-first bridge has it in session memory.",
      "Provider secrets remain session-only; ResonantOS does not persist plaintext provider credentials for this alpha.",
      envHint.trim(),
    ].filter(Boolean).join(" ");
  }

  /** Scoped OpenCode env. */
  scopedEnv(model, secrets) {
    const allowed = [
      "HOME", "PATH", "SHELL", "TERM", "TMPDIR", "TEMP", "TMP",
      "LANG", "LC_ALL",
      "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
      "OPENCODE_CONFIG", "OPENCODE_DATA", "OPENCODE_CACHE",
      "OPENCODE_SERVER_USERNAME", "OPENCODE_SERVER_PASSWORD",
      ...openCodeProviderEnvKeys(model),
    ];
    const inherited = Object.fromEntries(
      allowed
        .map((key) => [key, process.env[key]])
        .filter(([, value]) => value !== undefined),
    );
    return {
      ...inherited,
      ...providerEnvFromSecrets(openCodeProviderForModel(model), secrets, openCodeProviderEnvKeys(model)),
    };
  }

  /** Run the OpenCode CLI. */
  execCli(command, args, options) {
    const timeout = Math.min(900_000, Math.max(30_000, Number(options.timeout ?? 300_000)));
    const platform = options.platform ?? process.platform;
    const spawnProcess = options.spawnProcess;
    return new Promise((resolve, reject) => {
      if (/\.(?:cmd|bat)$/i.test(String(command))) {
        reject(new Error("OpenCode command shims (.cmd/.bat) are not supported; configure a pinned direct executable."));
        return;
      }
      if (platform === "win32" && !/\.exe$/i.test(String(command))) {
        reject(new Error("OpenCode on Windows requires a pinned direct .exe executable."));
        return;
      }
      const child = spawnProcess(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`OpenCode CLI timed out after ${timeout}ms.`));
      }, timeout);
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const detail = redactOpenCodeCliText(stderr || stdout || `OpenCode CLI exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}.`).trim();
          reject(new Error(detail));
          return;
        }
        resolve(String(stdout ?? "").trim());
      });
    });
  }

  /** Run an OpenCode CLI delegation end-to-end. */
  async runCliDelegation({ command, packet, payload, secrets, resolveWorkspacePath, repoRoot, browserFirstRoot, spawnProcess, platform }) {
    const workspacePath = resolveWorkspacePath(payload ?? {});
    const model = openCodeModel(payload, secrets);
    const prompt = this.buildExecutionPrompt(packet, workspacePath);
    const tempRoot = path.join(browserFirstRoot, "Runtime", "opencode-prompts");
    await mkdir(tempRoot, { recursive: true });
    const tempDir = await mkdtemp(path.join(tempRoot, "prompt-"));
    const promptPath = path.join(tempDir, "resonantos-opencode-task.md");
    try {
      await writeFile(promptPath, prompt, { mode: 0o600 });
      await chmod(promptPath, 0o600).catch(() => undefined);
      const args = [
        "run",
        "Read the attached ResonantOS OpenCode task packet and return the requested artifact.",
        "--file",
        promptPath,
        "--dir",
        workspacePath,
        "-m",
        model,
        "--format",
        "json",
      ];
      const output = await this.execCli(command, args, {
        cwd: workspacePath,
        env: this.scopedEnv(model, secrets),
        timeout: Math.min(900_000, Math.max(30_000, Number(payload.timeoutMs ?? 300_000))),
        spawnProcess,
        platform,
      });
      return {
        ...this.parseCliResult(output, workspacePath, repoRoot),
        model,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Run an OpenCode delegation end-to-end. Same return-shape contract as Hermes:
   *   { kind: "blocked", reason, fieldReason, install*?, model? }
   *   { kind: "failed", reason }
   *   { kind: "completed", result, workspacePath }
   */
  async startTask({ payload, packet, command, runtime, secrets, settings, localExecutionEnabled, disabledAddons, resolveWorkspacePath, repoRoot, browserFirstRoot, spawnProcess, platform }) {
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_OPENCODE_ADAPTER ?? "auto").trim().toLowerCase();
    if ((disabledAddons ?? []).includes("addon.opencode")) {
      return {
        kind: "failed",
        reason: "OpenCode is switched off in My Add-ons. Enable it before starting a delegation.",
      };
    }
    const currentStatus = fieldFromMarkdown(packet, "status") || "queued";
    if (["completed", "cancelled"].includes(currentStatus)) {
      return {
        kind: "failed",
        reason: `OpenCode delegation is already ${currentStatus}.`,
      };
    }
    const workspacePath = resolveWorkspacePath(payload);
    if (adapter !== "deterministic" && !command) {
      return {
        kind: "blocked",
        reason: "OpenCode CLI unavailable.",
        fieldReason: "OpenCode CLI unavailable",
        installHint: runtime?.installHint,
        installCommand: runtime?.installCommand,
        alternativeInstallCommands: runtime?.alternativeInstallCommands,
        configureCommand: runtime?.configureCommand,
        searchedCommands: runtime?.searchedCommands,
        searchedPaths: runtime?.searchedPaths,
        searchedPathCount: runtime?.searchedPathCount,
        searchedPathOmitted: runtime?.searchedPathOmitted,
        overrideConfigured: runtime?.overrideConfigured,
        overridePath: runtime?.overridePath,
        overrideFound: runtime?.overrideFound,
      };
    }
    if (adapter !== "deterministic" && !localExecutionEnabled) {
      return {
        kind: "blocked",
        reason: "OpenCode CLI was found, but execution is disabled. Set RESONANTOS_OPENCODE_EXECUTION=enabled or pass enableOpenCodeExecution from a trusted Settings flow.",
        fieldReason: "OpenCode execution requires explicit enablement",
      };
    }
    if (adapter !== "deterministic") {
      const state = this.credentialState(payload, secrets);
      if (!state.configured) {
        return {
          kind: "blocked",
          reason: this.credentialBlockedReason(state),
          fieldReason: this.credentialBlockedReason(state),
          model: state.model,
        };
      }
    }
    let result;
    try {
      result = adapter === "deterministic"
        ? this.deterministicResult(packet, payload, resolveWorkspacePath, repoRoot)
        : await this.runCliDelegation({
            command,
            packet,
            payload,
            secrets,
            resolveWorkspacePath,
            repoRoot,
            browserFirstRoot,
            spawnProcess,
            platform,
          });
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      };
    }
    return { kind: "completed", result, workspacePath: path.relative(repoRoot, workspacePath) || "." };
  }
}

// ---- Factory ----

export function createHermesProviderAdapterBridge() {
  return new HermesProviderAdapterBridge();
}

export function createOpenCodeProviderAdapterBridge() {
  return new OpenCodeProviderAdapterBridge();
}

// ---- Internal exports (used by parity tests and the host service seam) ----

export const __test = Object.freeze({
  redactCliText,
  redactOpenCodeCliText,
  openCodeProviderForModel,
  openCodeModel,
  openCodeProviderEnvKeys,
  providerEnvKeysForProvider,
  providerEnvKeysPresent,
  providerEnvFromSecrets,
  sectionFromMarkdown,
  sectionListFromMarkdown,
  fieldFromMarkdown,
  OPENCODE_EXPLICIT_PROVIDER_ENV_KEYS,
  MINIMAX_OPENAI_COMPAT_BASE_URL,
});
