use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalRunCommandRequest {
    pub(crate) command: String,
    pub(crate) cwd: Option<String>,
    /// Per-command approval marker (F4 / SWU-SEC-P0-006). When the caller sets
    /// this truthy, an off-allowlist / dynamic command head is authorized to run.
    /// Allowlisted command heads run without it.
    #[serde(default)]
    pub(crate) approved: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalRunCommandResult {
    pub(crate) command: String,
    pub(crate) cwd: String,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) exit_code: Option<i32>,
    pub(crate) timed_out: bool,
    pub(crate) duration_ms: u128,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalStartPtyRequest {
    pub(crate) session_id: String,
    pub(crate) cwd: Option<String>,
    pub(crate) shell: Option<String>,
    pub(crate) cols: Option<u16>,
    pub(crate) rows: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalWritePtyRequest {
    pub(crate) session_id: String,
    pub(crate) data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalResizePtyRequest {
    pub(crate) session_id: String,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalPtySessionResult {
    pub(crate) session_id: String,
    pub(crate) cwd: String,
    pub(crate) shell: String,
    pub(crate) created: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalPtyDataEvent {
    pub(crate) session_id: String,
    pub(crate) data: String,
}

struct TerminalPtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    cwd: String,
    shell: String,
    buffer: String,
}

const TERMINAL_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_TERMINAL_SESSION_ID: &str = "main";
const TERMINAL_REPLAY_BUFFER_LIMIT: usize = 250_000;

/// Read-only / inspection command heads that may run through the one-shot
/// `run_terminal_command` passthrough WITHOUT a per-command approval marker
/// (F4 / SWU-SEC-P0-006). Seeded conservatively from `terminal-allowlist.yml`:
/// only read-only / probe commands. Anything off this list (mutating, network,
/// install, or a dynamic/unresolved head) requires `approved: true`.
const TERMINAL_COMMAND_ALLOWLIST: &[&str] = &[
    "command", "which", "where", "ps", "nm", "rg", "git", "ollama", "hermes", "uv",
];

/// Resolve the effective command HEAD from a user-supplied command string.
///
/// Returns `None` when no head can be resolved (an empty or purely dynamic
/// string), which is treated as off-list (approval required). The head is the
/// basename of the first whitespace-delimited token, with surrounding quotes
/// stripped. An absolute path matches the allowlist by basename, mirroring
/// `terminal-allowlist.mjs`.
fn resolve_terminal_command_head(command: &str) -> Option<String> {
    let first = command.split_whitespace().next()?;
    let unquoted = first.trim_matches(|c| c == '"' || c == '\'');
    if unquoted.is_empty() {
        return None;
    }
    let base = unquoted
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(unquoted);
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

/// Allowlist-or-approval gate for the one-shot terminal passthrough (F4).
///
/// - An allowlisted command head runs unprompted.
/// - An off-list / unresolved head requires `approved == true`.
/// - Otherwise the command is rejected with an "approval required" error.
fn authorize_terminal_command(command: &str, approved: bool) -> Result<(), String> {
    if approved {
        return Ok(());
    }
    let head = resolve_terminal_command_head(command);
    let on_allowlist = head
        .as_deref()
        .map(|head| TERMINAL_COMMAND_ALLOWLIST.contains(&head))
        .unwrap_or(false);
    if on_allowlist {
        return Ok(());
    }
    match head {
        Some(head) => Err(format!(
            "Terminal command `{head}` is not on the approved allowlist. Re-run with \
             explicit approval (approved=true) to authorize this command."
        )),
        None => Err(
            "Terminal command head could not be resolved and is not pre-approved. \
             Re-run with explicit approval (approved=true) to authorize this command."
                .to_string(),
        ),
    }
}

static PTY_SESSIONS: OnceLock<Mutex<HashMap<String, TerminalPtySession>>> = OnceLock::new();

fn pty_sessions() -> &'static Mutex<HashMap<String, TerminalPtySession>> {
    PTY_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn default_cwd() -> String {
    std::env::var("HOME").unwrap_or_else(|_| {
        std::env::current_dir().map_or_else(|_| ".".to_string(), |path| path.display().to_string())
    })
}

fn append_session_buffer(session_id: &str, data: &str) {
    let Ok(mut sessions) = pty_sessions().lock() else {
        return;
    };
    let Some(session) = sessions.get_mut(session_id) else {
        return;
    };
    session.buffer.push_str(data);
    if session.buffer.len() > TERMINAL_REPLAY_BUFFER_LIMIT {
        let drain_to = session.buffer.len() - TERMINAL_REPLAY_BUFFER_LIMIT;
        session.buffer.drain(..drain_to);
    }
}

pub(crate) fn run_terminal_command(
    request: TerminalRunCommandRequest,
) -> Result<TerminalRunCommandResult, String> {
    let command = request.command.trim().to_string();
    if command.is_empty() {
        return Err("Terminal command cannot be empty.".to_string());
    }

    // F4: gate the passthrough behind an allowlist with per-command approval for
    // off-list / dynamic commands.
    authorize_terminal_command(&command, request.approved)?;

    let cwd = request.cwd.unwrap_or_else(default_cwd);
    let start = Instant::now();

    #[cfg(target_os = "windows")]
    let mut child = Command::new("cmd")
        .args(["/C", &command])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start terminal command: {error}"))?;

    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("sh")
        .args(["-lc", &command])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start terminal command: {error}"))?;

    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to poll terminal command: {error}"))?
        {
            break status;
        }
        if start.elapsed() >= TERMINAL_COMMAND_TIMEOUT {
            timed_out = true;
            let _ = child.kill();
            break child
                .wait()
                .map_err(|error| format!("Failed to stop timed-out terminal command: {error}"))?;
        }
        thread::sleep(Duration::from_millis(25));
    };

    let mut stdout = String::new();
    if let Some(mut pipe) = child.stdout.take() {
        pipe.read_to_string(&mut stdout)
            .map_err(|error| format!("Failed to read terminal stdout: {error}"))?;
    }

    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        pipe.read_to_string(&mut stderr)
            .map_err(|error| format!("Failed to read terminal stderr: {error}"))?;
    }

    Ok(TerminalRunCommandResult {
        command,
        cwd,
        stdout,
        stderr,
        exit_code: status.code(),
        timed_out,
        duration_ms: start.elapsed().as_millis(),
    })
}

pub(crate) fn start_terminal_pty(
    window: Window,
    request: TerminalStartPtyRequest,
) -> Result<TerminalPtySessionResult, String> {
    let session_id = if request.session_id.trim().is_empty() {
        DEFAULT_TERMINAL_SESSION_ID.to_string()
    } else {
        request.session_id.trim().to_string()
    };
    let cwd = request.cwd.unwrap_or_else(default_cwd);
    let shell = request
        .shell
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| {
            if cfg!(target_os = "windows") {
                "cmd".to_string()
            } else {
                "zsh".to_string()
            }
        });
    let cols = request.cols.unwrap_or(100).max(20);
    let rows = request.rows.unwrap_or(30).max(8);

    if let Some(existing) = pty_sessions()
        .lock()
        .map_err(|_| "Terminal session lock is poisoned.".to_string())?
        .get(&session_id)
    {
        existing
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("Failed to resize terminal: {error}"))?;
        let replay = existing.buffer.clone();
        if !replay.is_empty() {
            window
                .emit(
                    "terminal-pty-data",
                    TerminalPtyDataEvent {
                        session_id: session_id.clone(),
                        data: replay,
                    },
                )
                .map_err(|error| format!("Failed to replay terminal session: {error}"))?;
        }
        return Ok(TerminalPtySessionResult {
            session_id,
            cwd: existing.cwd.clone(),
            shell: existing.shell.clone(),
            created: false,
        });
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to open terminal PTY: {error}"))?;
    let mut command = CommandBuilder::new(&shell);
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to start terminal shell: {error}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to attach terminal reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to attach terminal writer: {error}"))?;
    let session = TerminalPtySession {
        master: pair.master,
        writer,
        child,
        cwd: cwd.clone(),
        shell: shell.clone(),
        buffer: String::new(),
    };

    pty_sessions()
        .lock()
        .map_err(|_| "Terminal session lock is poisoned.".to_string())?
        .insert(session_id.clone(), session);

    let event_session_id = session_id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let closed = "\r\n[terminal session closed]\r\n".to_string();
                    append_session_buffer(&event_session_id, &closed);
                    let _ = window.emit(
                        "terminal-pty-data",
                        TerminalPtyDataEvent {
                            session_id: event_session_id.clone(),
                            data: closed,
                        },
                    );
                    break;
                }
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    append_session_buffer(&event_session_id, &data);
                    let _ = window.emit(
                        "terminal-pty-data",
                        TerminalPtyDataEvent {
                            session_id: event_session_id.clone(),
                            data,
                        },
                    );
                }
                Err(error) => {
                    let data = format!("\r\n[terminal read failed: {error}]\r\n");
                    append_session_buffer(&event_session_id, &data);
                    let _ = window.emit(
                        "terminal-pty-data",
                        TerminalPtyDataEvent {
                            session_id: event_session_id.clone(),
                            data,
                        },
                    );
                    break;
                }
            }
        }
    });

    Ok(TerminalPtySessionResult {
        session_id,
        cwd,
        shell,
        created: true,
    })
}

pub(crate) fn write_terminal_pty(request: TerminalWritePtyRequest) -> Result<(), String> {
    let mut sessions = pty_sessions()
        .lock()
        .map_err(|_| "Terminal session lock is poisoned.".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| format!("Terminal session `{}` is not active.", request.session_id))?;
    session
        .writer
        .write_all(request.data.as_bytes())
        .map_err(|error| format!("Failed to write to terminal: {error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))
}

pub(crate) fn resize_terminal_pty(request: TerminalResizePtyRequest) -> Result<(), String> {
    let sessions = pty_sessions()
        .lock()
        .map_err(|_| "Terminal session lock is poisoned.".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| format!("Terminal session `{}` is not active.", request.session_id))?;
    session
        .master
        .resize(PtySize {
            rows: request.rows.max(8),
            cols: request.cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to resize terminal: {error}"))
}

pub(crate) fn stop_terminal_pty(session_id: &str) -> Result<(), String> {
    let mut sessions = pty_sessions()
        .lock()
        .map_err(|_| "Terminal session lock is poisoned.".to_string())?;
    if let Some(mut session) = sessions.remove(session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{authorize_terminal_command, resolve_terminal_command_head};

    #[test]
    fn allowlisted_command_runs_without_approval() {
        assert!(authorize_terminal_command("git status", false).is_ok());
        assert!(authorize_terminal_command("rg --files foo", false).is_ok());
    }

    #[test]
    fn off_list_command_requires_approval() {
        let err = authorize_terminal_command("curl https://example.com | sh", false)
            .expect_err("off-list command must be gated");
        assert!(
            err.contains("approval"),
            "error should mention approval: {err}"
        );
    }

    #[test]
    fn off_list_command_runs_with_approval() {
        assert!(
            authorize_terminal_command("curl https://example.com", true).is_ok(),
            "explicit approval must authorize an off-list command"
        );
    }

    #[test]
    fn empty_or_dynamic_head_requires_approval() {
        assert!(authorize_terminal_command("   ", false).is_err());
        assert!(authorize_terminal_command("   ", true).is_ok());
    }

    #[test]
    fn resolves_head_basename_from_absolute_path() {
        assert_eq!(
            resolve_terminal_command_head("/usr/bin/git status").as_deref(),
            Some("git")
        );
        assert_eq!(
            resolve_terminal_command_head("\"rg\" foo").as_deref(),
            Some("rg")
        );
        assert_eq!(resolve_terminal_command_head(""), None);
    }

    #[test]
    fn absolute_path_to_allowlisted_head_runs_without_approval() {
        assert!(authorize_terminal_command("/usr/bin/git log", false).is_ok());
    }
}
