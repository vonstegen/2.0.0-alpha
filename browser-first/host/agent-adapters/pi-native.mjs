// Pi-native harness adapter (pi-native-v1, testing phase). Implements the SAME
// host session interface as agent-adapters/openai-compatible.mjs — probe,
// createSession, invoke, cancel, history, status, selectModel, dispose — over
// the REAL native Pi process chain:
//
//   host session wrapper  ->  pi-native-session-service (planner + launcher)
//                         ->  reviewed piCommand() executable
//                         ->  REAL provider model (session-environment credential)
//
// Host-owned, never caller-owned:
//   * model selection     — committed per session; a turn may name a model but
//                           only after it passed the planner's catalog gate.
//   * history             — bounded, ephemeral, host-committed; only completed
//                           replies enter it. Failed/cancelled turns never do.
//   * turn ownership      — one turn per session; cancel aborts the turn
//                           signal AND the real Pi child process (SIGTERM→
//                           SIGKILL via the launcher).
//   * session projection  — the launch cwd is the cwd of an already-authorized
//                           Project/Files projection issued by the host and
//                           re-validated inside every plan().
//
// The credential never enters argv, history, or this adapter: it flows only
// through the planner's private session env into the child process. The raw
// launch plan never crosses this boundary; only redacted evidence does.
import { randomUUID } from "node:crypto";
import { publicHarnessError } from "../harness-adapter-contract.mjs";

const fail = (code) => Object.assign(new Error(publicHarnessError({ code }).message), { code });
const MAX_TEXT = 65536;
const MAX_HISTORY = 262144;
const MAX_TURNS = 256;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) => typeof value === "string" && value.trim() && value.length <= 256;
function check(signal) {
  if (signal.aborted) throw fail(signal.reason?.code === "deadline-exceeded" ? "deadline-exceeded" : "cancelled");
}

// One non-secret proof message per turn: the committed host transcript plus the
// caller's latest user message. The launcher passes this single string as the
// final argv element; it never carries the session credential (the credential
// travels only through the private env).
function buildPrompt(messages) {
  return messages.map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`).join("\n\n");
}

export function createPiNativeAdapter({
  addonId,
  runtime,
  manifest,
  sessionService,
  providerProfileId,
  issueProjection,
  stageSkills,
  cleanupSkills,
  turnTimeoutMs = 120000,
  maxSessions = 64,
} = {}) {
  // Declaration gate: this adapter is ONLY the reviewed pi-native-v1
  // session-environment chain. Any other declaration fails closed.
  if (runtime?.adapterId !== "pi-native-v1" || runtime.authScheme !== "session-environment") throw fail("permission-denied");
  if (!identifier(addonId)) throw fail("permission-denied");
  if (!record(manifest)) throw fail("permission-denied");
  if (!identifier(providerProfileId)) throw fail("permission-denied");
  if (!sessionService || typeof sessionService.launchProof !== "function" ||
      typeof sessionService.probe !== "function") throw fail("runtime-unavailable");
  if (typeof issueProjection !== "function") throw fail("runtime-unavailable");
  if (!Number.isSafeInteger(turnTimeoutMs) || turnTimeoutMs < 1 || turnTimeoutMs > 2147483647) throw fail("runtime-unavailable");
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1) throw fail("runtime-unavailable");

  const sessions = new Map();
  let closed = false;

  function stateFor(session) {
    const state = sessions.get(session);
    if (closed || !state) throw fail("session-not-found");
    return state;
  }

  // Bounded, ephemeral, host-committed history. Only the caller's validated
  // messages may enter; a failed or cancelled turn never commits.
  function messagesFor(state, input) {
    if (!Array.isArray(input?.messages) || !input.messages.length || input.messages.length > 256 ||
        input.messages.some((message) => !record(message) || !["user", "assistant"].includes(message.role) ||
          typeof message.content !== "string" || Buffer.byteLength(message.content) > MAX_TEXT) ||
        input.messages.at(-1).role !== "user") throw fail("invalid-event");
    const messages = state.messages.length ? [...state.messages, input.messages.at(-1)] : input.messages;
    const copy = messages.map(({ role, content }) => ({ role, content }));
    if (copy.length > MAX_TURNS || Buffer.byteLength(JSON.stringify(copy)) > MAX_HISTORY) throw fail("invalid-event");
    return copy;
  }

  // Session-local preparation, run once per session under turn ownership: issue
  // the authorized Project/Files projection (the ONLY launch cwd source) and,
  // when the host wired Phase 2C skills, stage them inside the projected cwd.
  async function prepare(state) {
    if (!state.projection) {
      const issued = await issueProjection({ addonId, sessionId: state.sessionId, manifest });
      if (issued?.ok !== true || !record(issued.projection)) throw fail("permission-denied");
      state.projection = issued.projection;
      state.projectionView = issued.view ?? null;
    }
    if (stageSkills && !state.skillsProjection) {
      const staged = await stageSkills({ addonId, sessionId: state.sessionId, manifest, projection: state.projection });
      state.skillsProjection = staged?.ok === true && record(staged.projection) ? staged.projection : null;
    }
  }

  return {
    async probe() { return { available: !closed && Boolean((await sessionService.probe()).available) }; },

    async createSession({ signal } = {}) {
      if (closed) throw fail("runtime-unavailable");
      if (signal?.aborted) throw fail("cancelled");
      if (sessions.size >= maxSessions) throw fail("runtime-unavailable");
      const session = { piSessionId: randomUUID() };
      sessions.set(session, {
        sessionId: session.piSessionId,
        messages: [],
        selection: null,
        turn: null,
        projection: null,
        projectionView: null,
        skillsProjection: null,
      });
      return session;
    },

    async *invoke({ session, input, signal }) {
      const state = stateFor(session);
      if (state.turn) throw fail("ownership-conflict");
      const controller = new AbortController();
      const turnSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      state.turn = controller;
      const timer = setTimeout(() => controller.abort(fail("deadline-exceeded")), turnTimeoutMs);
      let result;
      try {
        check(turnSignal);
        const messages = messagesFor(state, input);
        const model = input.model ?? state.selection?.model;
        if (!identifier(model)) throw fail("invalid-event");
        await prepare(state);
        check(turnSignal);
        const { evidence } = await sessionService.launchProof({
          addonId,
          manifest,
          providerProfileId,
          selectedModel: model,
          projection: state.projection,
          sessionId: state.sessionId,
          prompt: buildPrompt(messages),
          signal: turnSignal,
        });
        check(turnSignal);
        if (evidence.spawnError || (evidence.exitCode !== 0 && evidence.exitCode !== null)) {
          throw fail("runtime-unavailable");
        }
        const text = typeof evidence.stdout === "string" ? evidence.stdout.trim() : "";
        if (!text || Buffer.byteLength(text) > MAX_TEXT) throw fail("runtime-unavailable");
        const committed = [...messages, { role: "assistant", content: text }];
        while (committed.length > MAX_TURNS || Buffer.byteLength(JSON.stringify(committed)) > MAX_HISTORY) {
          committed.splice(0, 2);
        }
        state.messages = committed;
        result = { type: "final", data: { text } };
      } catch (error) {
        result = turnSignal.aborted && turnSignal.reason?.code !== "deadline-exceeded"
          ? { type: "cancelled", data: {} }
          : { type: "error", data: publicHarnessError(turnSignal.aborted ? turnSignal.reason : error) };
      } finally {
        clearTimeout(timer);
        controller.abort();
        if (state.turn === controller) state.turn = null;
      }
      yield result;
    },

    async cancel({ session }) { stateFor(session).turn?.abort(); },

    async history({ session }) { return { messages: structuredClone(stateFor(session).messages), hasMore: false }; },

    async status({ session }) { return { status: stateFor(session).turn ? "running" : "idle" }; },

    async selectModel({ session, input }) {
      const state = stateFor(session);
      if (state.turn) throw fail("ownership-conflict");
      if (!record(input) || !identifier(input.provider) || !identifier(input.model)) throw fail("invalid-event");
      state.selection = { provider: input.provider, model: input.model };
      return { ...state.selection };
    },

    async dispose({ session } = {}) {
      if (session) {
        const state = sessions.get(session);
        if (state) {
          state.turn?.abort();
          if (cleanupSkills && state.skillsProjection) {
            try { await cleanupSkills({ addonId, sessionId: state.sessionId, projection: state.skillsProjection, resourceProjection: state.projection }); } catch { /* Cleanup never blocks disposal. */ }
          }
          sessions.delete(session);
        }
      } else {
        for (const state of sessions.values()) {
          state.turn?.abort();
          if (cleanupSkills && state.skillsProjection) {
            try { await cleanupSkills({ addonId, sessionId: state.sessionId, projection: state.skillsProjection, resourceProjection: state.projection }); } catch { /* Cleanup never blocks disposal. */ }
          }
        }
        sessions.clear();
      }
      // Host composition creates one adapter per boundary session. Full dispose
      // (no session) marks the adapter closed so no new session can launch.
      if (!sessions.size) closed = true;
    },
  };
}
