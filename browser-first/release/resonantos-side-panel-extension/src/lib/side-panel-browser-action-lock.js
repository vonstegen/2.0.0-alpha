// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md

export function createBrowserActionLock() {
  let queue = Promise.resolve();

  async function withBrowserActionLock(task) {
    const previous = queue.catch(() => undefined);
    let release;
    queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  return { withBrowserActionLock };
}
