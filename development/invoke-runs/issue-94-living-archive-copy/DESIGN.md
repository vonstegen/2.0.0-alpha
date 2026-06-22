# Design: Living Archive Human-First Copy

## Copy Model

Use a layered explanation:

1. Promise: Human Knowledge is preserved; AI Memory is the maintained wiki.
2. Plain-language behavior: original materials stay safe; ResonantOS maintains reviewed AI-readable memory.
3. Optional workflow: Obsidian-compatible vaults are one supported way to manage the same files.
4. Technical workflow terms remain in review, advanced, or boundary contexts.

## Surface Design

- Start tab: replace the lead Living Archive Agent headline and assistant placeholder with the human-first promise.
- Importer: describe ordinary folders first and Obsidian-compatible vaults as optional.
- Help tab: repeat the promise and give the plain-language use path.
- Settings Memory: explain the bridge as scoped access to the same memory files, with trusted writes remaining inside ResonantOS.
- First-run: add a short paragraph that explains what the recommended Living Archive default means.
- Manifest: update the first-run card description source.

## Technical Approach

- Modify existing copy in place.
- Avoid new state, routing, or runtime behavior.
- Add App-level regression tests because the affected copy is integrated through the app shell.
