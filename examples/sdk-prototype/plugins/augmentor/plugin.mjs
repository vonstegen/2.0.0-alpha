// Augmentor — Manolo's DeepSeek Harness, the preinstalled first-party add-on.
//
// This mirrors the production `addon.deepseek-harness` manifest (imported into
// `apps/augmentor`, #448) and demonstrates the capability model: `status` needs
// only `network` (Public), while `run_task` additionally needs `providers`
// (Privileged) and `agent-delegation` (Public). In demo mode no live service is
// required; the run path stops at the prepare/propose boundary, where a human
// approves the commit.

export default {
  async activate(context) {
    const endpoint = "http://127.0.0.1:3080";

    return {
      tools: {
        "augmentor.status": async () => ({
          online: "simulated",
          endpoint,
          model: "deepseek-chat",
          mode: "demo (simulated loopback service — no live health check)",
        }),
        "augmentor.run_task": async ({ prompt }) => {
          const proposal = context.propose({
            type: "deepseek-completion",
            prompt,
            endpoint,
            transport: "simulated loopback (propose only — no live dispatch)",
          });
          return {
            status: "proposed",
            note: "prepare is not commit — human approval required before execution",
            proposal,
          };
        },
      },
      async onEnable() {
        return { ok: true, note: "Augmentor (DeepSeek Harness) enabled (demo mode)" };
      },
      async onDisable() {
        return { ok: true, note: "Augmentor (DeepSeek Harness) disabled" };
      },
    };
  },
};
