// Hello Resonant — example plugin implementation for the prototype SDK.
//
// A plugin is a single module that exports an activate(context) function. The
// activate function returns the plugin's tools and optional lifecycle hooks.

export default {
  async activate(context) {
    // context exposes: manifest, granted (capabilities), capabilityClass,
    // and propose (the prepare/propose boundary — prepare is not commit).
    return {
      tools: {
        "hello-resonant.hello": async ({ name }) => ({
          message: `Hello, ${name ?? "ResonantOS"}! Welcome to the SDK demo.`,
        }),
        "hello-resonant.notify": async ({ message }) => {
          const proposal = context.propose({
            type: "notification",
            payload: message,
            reviewedBy: "host",
          });
          return { delivered: true, message, proposal };
        },
      },
      async onEnable() {
        return { ok: true, note: "hello-resonant enabled" };
      },
      async onDisable() {
        return { ok: true, note: "hello-resonant disabled" };
      },
    };
  },
};
