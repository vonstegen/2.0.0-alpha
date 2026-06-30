# Blackboard Security Summary

## Context
This summary covers the key security issues identified for the Blackboard addon and its browser extension integration, with a focus on HTTPS enforcement, iframe embedding, and sandbox configuration.

## 1. HTTPS and mixed-content risk
- Current embed policy is too permissive and may allow HTTP or mixed-content sources.
- HTTP embeds inside an HTTPS extension or host page expose the extension and end user to content injection, downgrade attacks, and insecure third-party resources.
- Recommended fix:
  - enforce HTTPS for embed `src` values wherever possible
  - explicitly block non-HTTPS and mixed-content URLs for Blackboard embeds
  - consider allowlisting trusted sources if some embeds must remain external

## 2. iframe embed behavior
- Blackboard renders external content inside an iframe, which is a high-risk surface.
- The iframe source can originate from untrusted third parties or user-provided URLs.
- Key concerns:
  - untrusted origin executing content inside the extension’s UI surface
  - iframe’s ability to navigate or request privileged actions without proper mediation
- Recommended fix:
  - ensure the iframe uses restrictive sandbox attributes
  - limit embed interactions to only what is required for display
  - handle any navigation or popup requests through extension-mediated APIs rather than direct iframe control

## 3. Sandbox configuration issues
- Current sandbox flags are likely too permissive for secure embed usage.
- A safe iframe sandbox should disable scripting and top-level navigation unless explicitly needed.
- Recommended sandbox policy:
  - enable: `allow-same-origin` only if necessary for the embed platform
  - avoid: `allow-scripts`, `allow-top-navigation`, `allow-popups`, `allow-popups-to-escape-sandbox` unless the embed specifically requires them
  - prefer denying all optional privileges and grant only the minimum required capabilities

## 4. Extension integration and relay trust boundary
- The Blackboard addon and extension background need a clear trust boundary.
- The extension should mediate and validate all requests coming from addon content before performing privileged actions like opening tabs or popups.
- Recommended practices:
  - maintain a strict relay contract in `background.js`
  - accept messages only from authorized extension/host pages
  - avoid letting iframes directly perform navigation or privileged browser actions

## 5. Embed approval system
- For security-sensitive embed content, adopt an approval or allowlist model.
- This should include:
  - whether embeds require explicit approval before activation
  - a documented owner/PM review process for trusted embed sources
  - runtime enforcement of approval decisions in the application code

## Recommended next steps
1. tighten iframe sandbox usage in `browser-first/resonantos-side-panel-extension/src/addons/blackboard/blackboard.js`
2. enforce secure embed URLs in `browser-first/resonantos-side-panel-extension/src/lib/blackboard-url-policy.js`
3. strengthen relay gating in `browser-first/resonantos-side-panel-extension/src/background.js`
4. add tests for embed policy, sandbox enforcement, and extension relay behavior
5. document the addon vs extension responsibility boundary and the embed approval workflow
