// Grok Build — the plugin authored through the SDK for the Grok-Build provider.
//
// Mirrors the production `addon.grok-build` manifest and demonstrates the
// capability model: `status` needs only `network` (Public), while `run_task`
// additionally needs `providers` (Privileged) and `agent-delegation` (Public).
// In demo mode no live service is required; the run path stops at the
// prepare/propose boundary, where a human approves the commit.

export default {
  async activate(context) {
    const endpoint = "http://127.0.0.1:3080";

    return {
      tools: {
        "grok_build.status": async () => ({
          online: true,
          endpoint,
          model: "grok-build",
          mode: "demo (simulated loopback service)",
        }),
        "grok_build.run_task": async ({ prompt }) => {
          const proposal = context.propose({
            type: "grok-completion",
            prompt,
            endpoint,
            dispatch: "host-mediated loopback service",
          });
          return {
            status: "proposed",
            note: "prepare is not commit — human approval required before execution",
            proposal,
          };
        },
      },
      async onEnable() {
        return { ok: true, note: "grok-build enabled (demo mode)" };
      },
      async onDisable() {
        return { ok: true, note: "grok-build disabled" };
      },
    };
  },
};
