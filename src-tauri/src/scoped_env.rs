// Intent citation: PR-R04 (finding F2) — agent-runtime subprocess spawns leak
// the full host environment; no env_clear anywhere.
//
// Scoped subprocess environment for agent-runtime spawns.
//
// SAFETY / ROLLOUT POSTURE — DEFAULT-OFF, OPT-IN:
//   env_clear() on the agent runtimes (hermes / opencode / codex / ollama /
//   memory / browser-host) is the highest-risk change in the security set: if
//   the per-runtime allowlist misses any variable a runtime actually needs, the
//   runtime breaks, and these runtimes cannot be exercised in CI/here to verify
//   allowlist completeness. Therefore the scoped-env behaviour is gated behind an
//   explicit operator opt-in:
//
//     RESONANTOS_SCOPED_ENV=1   (or true / yes / on)
//
//   When the flag is OFF (the default), `apply_scoped_env` is a strict NO-OP:
//   spawn behaviour is byte-for-byte unchanged — no env_clear, no allowlist, no
//   regression. Existing `.env(...)` injections at each spawn site continue to
//   layer on top of the inherited ambient environment exactly as before.
//
//   When the flag is ON, `apply_scoped_env` calls `Command::env_clear()` and then
//   re-injects only a small base allowlist (HOME, PATH, LANG, LC_ALL, TMPDIR,
//   forwarded from the parent if present) plus the named per-runtime allowlist
//   below. The existing `.env(...)` calls at each spawn site then re-assert the
//   runtime-specific allowlisted vars (HERMES_HOME, CODEX_HOME pinned PATH, etc.)
//   over that cleared base. Operators may forward additional named vars via the
//   documented opt-in flag:
//
//     RESONANTOS_SCOPED_ENV_ALLOW=DISPLAY,WAYLAND_DISPLAY   (comma-separated)
//
//   Ported from p0-invoke/checks/subprocess/env-allowlist.yml.

use std::process::Command;

/// Environment flag that turns scoped-env ON. Any truthy value enables it.
const SCOPED_ENV_FLAG: &str = "RESONANTOS_SCOPED_ENV";

/// Documented opt-in escape hatch: a comma-separated list of additional variable
/// names to forward from the parent environment after `env_clear` (only honoured
/// when scoped-env is ON). Mirrors `opt_in_flag` in env-allowlist.yml.
const SCOPED_ENV_ALLOW_FLAG: &str = "RESONANTOS_SCOPED_ENV_ALLOW";

/// Universally safe vars to re-inject after `env_clear`, for any runtime that
/// needs a minimal usable shell environment. Kept small on purpose.
/// Ported from `base_allow` in env-allowlist.yml.
///   HOME   — resolve user home for runtime config/profile discovery
///   PATH   — should be pinned per spawn site; forwarded here as a usable default
///   LANG   — locale for correct text handling
///   LC_ALL — locale override
///   TMPDIR — scoped temp dir
const BASE_ALLOW: &[&str] = &["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR"];

/// Per-runtime allowlist of variables to forward from the parent environment
/// after `env_clear`, in addition to `BASE_ALLOW`. Ported from
/// `runtimes.<name>.allow` in env-allowlist.yml.
///
/// Note: the spawn sites also call `.env(VAR, value)` directly for the
/// runtime-specific vars (e.g. HERMES_HOME, the pinned codex PATH); those calls
/// re-assert the value after the clear regardless of whether the var was present
/// in the parent env. This table additionally forwards a var's *parent* value
/// when present, which matters for vars a site reads from the ambient env.
fn runtime_allow(runtime: &str) -> &'static [&'static str] {
    match runtime {
        // Only HERMES_HOME is functionally required beyond base. The install path
        // additionally needs PYTHONPATH / PYTHONHOME absent; under env_clear they
        // are simply never injected, which satisfies that intent.
        "hermes" => &["HERMES_HOME"],
        // OpenCode server is configured entirely via CLI flags; nothing beyond
        // base is required.
        "opencode" => &[],
        // Codex resolution needs a pinned PATH (re-asserted at the site) and an
        // optional CODEX_HOME config/credential home.
        "codex" => &["CODEX_HOME"],
        // `ollama serve` / list / ps: listener bind target + model store location.
        "ollama" => &["OLLAMA_HOST", "OLLAMA_MODELS"],
        // Living Archive memory service (node): all config via CLI flags.
        "memory" => &[],
        // Browser host (node) and visible host (electron): RESONANTOS_NODE is read
        // by the parent to pick the binary; if a forwarded value is present it must
        // be explicit. Electron may also need DISPLAY / WAYLAND_DISPLAY on Linux —
        // forward those via RESONANTOS_SCOPED_ENV_ALLOW when a visible-host platform
        // requires them.
        "browser-host" => &["RESONANTOS_NODE"],
        // Unknown runtime: base allowlist only.
        _ => &[],
    }
}

/// Returns true when the scoped-env opt-in flag is set to a truthy value.
fn scoped_env_enabled() -> bool {
    matches!(
        std::env::var(SCOPED_ENV_FLAG).ok().as_deref(),
        Some("1")
            | Some("true")
            | Some("TRUE")
            | Some("yes")
            | Some("YES")
            | Some("on")
            | Some("ON")
    )
}

/// Operator-supplied extra var names to forward (comma-separated). Empty when the
/// opt-in flag is unset.
fn opt_in_vars() -> Vec<String> {
    std::env::var(SCOPED_ENV_ALLOW_FLAG)
        .ok()
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Apply the scoped-environment policy to a `Command` immediately before spawn.
///
/// - When `RESONANTOS_SCOPED_ENV` is NOT truthy (the default): NO-OP. The command
///   is left exactly as the caller built it; behaviour is unchanged.
/// - When it IS truthy: `cmd.env_clear()`, then re-inject ONLY the allowlisted
///   vars (base allowlist + this runtime's allowlist + operator opt-in vars). For
///   each allowlisted name, a caller-injected value (set via `.env(...)` BEFORE
///   this call, e.g. `HERMES_HOME` / the pinned codex `PATH`) takes precedence;
///   otherwise the value is forwarded from the parent process environment when
///   present. Any caller-injected var that is NOT allowlisted is dropped by the
///   clear and never re-injected.
///
/// Because `env_clear()` also discards the caller's pending `.env(...)` calls,
/// this MUST run AFTER the site has set its allowlisted vars. All wired sites call
/// it right before `.spawn()` / `.output()` / `.status()`.
pub(crate) fn apply_scoped_env(cmd: &mut Command, runtime: &str) {
    if !scoped_env_enabled() {
        return;
    }

    // The set of names allowed to survive the clear.
    let allowed: Vec<String> = BASE_ALLOW
        .iter()
        .map(|s| s.to_string())
        .chain(runtime_allow(runtime).iter().map(|s| s.to_string()))
        .chain(opt_in_vars())
        .collect();

    // Capture the caller's already-injected env (.env(...) calls made before this
    // helper). These take precedence over the parent-process value.
    let mut caller_injected: Vec<(String, String)> = Vec::new();
    for (key, value) in cmd.get_envs() {
        if let (Some(k), Some(v)) = (key.to_str(), value.and_then(|v| v.to_str())) {
            caller_injected.push((k.to_string(), v.to_string()));
        }
    }

    // Resolve each allowlisted name to a value: caller-injected first, else parent.
    let mut forward: Vec<(String, String)> = Vec::new();
    for name in &allowed {
        if forward.iter().any(|(existing, _)| existing == name) {
            continue;
        }
        if let Some((_, value)) = caller_injected.iter().find(|(k, _)| k == name) {
            forward.push((name.clone(), value.clone()));
        } else if let Ok(value) = std::env::var(name) {
            forward.push((name.clone(), value));
        }
    }

    cmd.env_clear();
    for (name, value) in forward {
        cmd.env(name, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::sync::Mutex;

    // Env mutation is process-global; serialize the tests that touch it.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Snapshot the env vars a built Command will set, as (name, value) pairs.
    fn command_envs(cmd: &Command) -> Vec<(String, String)> {
        cmd.get_envs()
            .filter_map(|(k, v)| {
                v.map(|v| {
                    (
                        k.to_string_lossy().into_owned(),
                        v.to_string_lossy().into_owned(),
                    )
                })
            })
            .collect()
    }

    #[test]
    fn off_by_default_is_noop() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var(SCOPED_ENV_FLAG);
        std::env::remove_var(SCOPED_ENV_ALLOW_FLAG);

        let mut cmd = Command::new("true");
        cmd.env("HERMES_HOME", "/tmp/hermes");
        let before = command_envs(&cmd);

        apply_scoped_env(&mut cmd, "hermes");

        let after = command_envs(&cmd);
        // No-op: the only injected env is the caller's own, untouched.
        assert_eq!(before, after);
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].0, "HERMES_HOME");
    }

    #[test]
    fn on_clears_and_injects_allowlist() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(SCOPED_ENV_FLAG, "1");
        std::env::remove_var(SCOPED_ENV_ALLOW_FLAG);

        // Parent env: one allowlisted (HERMES_HOME) + one NOT allowlisted (secret).
        std::env::set_var("HERMES_HOME", "/tmp/hermes-on");
        std::env::set_var("PATH", "/usr/bin:/bin");
        std::env::set_var("RESONANTOS_SECRET_TOKEN", "leak-me");

        let mut cmd = Command::new("true");
        apply_scoped_env(&mut cmd, "hermes");

        let envs = command_envs(&cmd);
        let names: Vec<&str> = envs.iter().map(|(k, _)| k.as_str()).collect();

        // Allowlisted parent vars are forwarded.
        assert!(names.contains(&"HERMES_HOME"), "HERMES_HOME forwarded");
        assert!(names.contains(&"PATH"), "PATH forwarded (base allow)");
        // Non-allowlisted ambient var is absent.
        assert!(
            !names.contains(&"RESONANTOS_SECRET_TOKEN"),
            "non-allowlisted ambient var must NOT be forwarded"
        );

        std::env::remove_var(SCOPED_ENV_FLAG);
        std::env::remove_var("RESONANTOS_SECRET_TOKEN");
    }

    #[test]
    fn on_applies_env_clear_flag() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(SCOPED_ENV_FLAG, "1");
        let mut cmd = Command::new("true");
        // Caller injects a runtime var BEFORE the scoped call; it must survive.
        cmd.env("HERMES_HOME", "/tmp/keep");
        apply_scoped_env(&mut cmd, "hermes");
        // After env_clear + re-inject, the caller's var is still present.
        let envs = command_envs(&cmd);
        assert!(envs
            .iter()
            .any(|(k, v)| k == "HERMES_HOME" && v == "/tmp/keep"));
        std::env::remove_var(SCOPED_ENV_FLAG);
    }

    #[test]
    fn opt_in_vars_forwarded_only_when_named() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(SCOPED_ENV_FLAG, "1");
        std::env::set_var("DISPLAY", ":0");

        // Without the opt-in flag, DISPLAY is not forwarded for browser-host.
        std::env::remove_var(SCOPED_ENV_ALLOW_FLAG);
        let mut cmd = Command::new("true");
        apply_scoped_env(&mut cmd, "browser-host");
        let names: Vec<String> = command_envs(&cmd).into_iter().map(|(k, _)| k).collect();
        assert!(!names.contains(&"DISPLAY".to_string()));

        // With the opt-in flag naming DISPLAY, it is forwarded.
        std::env::set_var(SCOPED_ENV_ALLOW_FLAG, "DISPLAY,WAYLAND_DISPLAY");
        let mut cmd2 = Command::new("true");
        apply_scoped_env(&mut cmd2, "browser-host");
        let names2: Vec<String> = command_envs(&cmd2).into_iter().map(|(k, _)| k).collect();
        assert!(names2.contains(&"DISPLAY".to_string()));

        std::env::remove_var(SCOPED_ENV_FLAG);
        std::env::remove_var(SCOPED_ENV_ALLOW_FLAG);
        std::env::remove_var("DISPLAY");
    }

    #[test]
    fn flag_must_be_truthy() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(SCOPED_ENV_FLAG, "0");
        let mut cmd = Command::new("true");
        cmd.env("HERMES_HOME", "/tmp/x");
        apply_scoped_env(&mut cmd, "hermes");
        // "0" is not truthy => no-op => only the caller's var.
        assert_eq!(command_envs(&cmd).len(), 1);
        std::env::remove_var(SCOPED_ENV_FLAG);
    }
}
