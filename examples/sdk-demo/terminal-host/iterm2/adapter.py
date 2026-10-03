"""Resonant iTerm2 terminal host adapter — Phase 1 minimum implementation.

Connects to the running iTerm2 instance via the iTerm2 Python API, speaks
JSON-RPC over stdio to the ROS bridge, and emits `terminal.event`
notifications on lifecycle transitions. Implements the minimum surface
required by Phase 1 + Phase 2 of
`prompts/OMP-BUILD-iTerm2-SDK-Addon-Connection.md` v6:

  - launchBootstrap  (creates a session, runs the bootstrap command,
                      returns the grant, emits terminal.session.started)
  - createSession    (opens a tab without a bootstrap command)
  - sendInput        (writes text to an existing session)
  - terminateSession (closes a tab; emits terminal.session.terminated)

The 4-op set above is COMPLETE for a terminal adapter. Per the F2
operation split (TERMINAL-HOST-OPERATION-SPLIT.md), `adoptSession` /
`attachSession` / `detachSession` / `listSessions` / `getSessionState`
are ROS session operations on `RosTerminalSession` and are never
implemented by a terminal adapter.

Wire contract: one JSON-RPC message per line on stdin; one JSON-RPC
message per line on stdout. Notifications use `method: "terminal.event"`
with a `RosTerminalEventEnvelope` body (terminal-host-contract.ts:166).

ADR-040 compliance:
  - never shells out with ambient PATH: iTerm2 is controlled through
    the daemon, not via osascript / spawn.
  - never holds credentials on disk: the SessionBootstrapGrant lives only in
    memory (the `grant_tokens` set) and is never persisted.
  - sendInput rejects any text containing a grant token the adapter has seen
    (exact substring match, not a format heuristic).
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import sys
import traceback
from typing import Any

import iterm2  # type: ignore[import-not-found]

TERMINAL_HOST_CONTRACT_VERSION = 1
JSON_RPC_VERSION = "2.0"

# Methods the adapter implements in this commit.
SUPPORTED_METHODS = {
    "launchBootstrap",
    "createSession",
    "sendInput",
    "terminateSession",
}


def _now_iso() -> str:
    return (
        _dt.datetime.now(_dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _frame(message: dict[str, Any]) -> str:
    return json.dumps(message, separators=(",", ":")) + "\n"


def _validate_session_id(session_id: str) -> None:
    if not isinstance(session_id, str) or not session_id:
        raise ValueError("sessionId must be a non-empty string")


def _reject_known_tokens(text: str, grant_tokens: set[str], field: str) -> None:
    """Raise if `text` contains a grant token the adapter has seen.

    A SessionBootstrapGrant token is a 32-byte base64url string, so it cannot
    be distinguished from arbitrary text by format alone. The check is exact
    containment against the tokens the adapter was actually handed — not the
    old `SessionBootstrapGrant\b` format heuristic, which matched a label that
    never appears in a real token.
    """
    for token in grant_tokens:
        if token and token in text:
            raise PermissionError(
                f"{field} contains a SessionBootstrapGrant token; "
                "tokens must never ride the wire"
            )


def _validate_bootstrap_command(command: str, grant_tokens: set[str]) -> None:
    if not isinstance(command, str) or not command:
        raise ValueError("bootstrapCommand must be a non-empty string")
    _reject_known_tokens(command, grant_tokens, "bootstrapCommand")


def _validate_send_text(text: str, grant_tokens: set[str]) -> None:
    if not isinstance(text, str) or not text:
        raise ValueError("text must be a non-empty string")
    _reject_known_tokens(text, grant_tokens, "text")


class _Adapter:
    """Owns the iTerm2 connection and the in-memory session map."""

    def __init__(self) -> None:
        self.connection: iterm2.Connection | None = None
        # session_id -> iterm2.Session (or None if the iTerm2 tab was
        # closed by the operator and the adapter hasn't observed it).
        self.sessions: dict[str, iterm2.Session] = {}
        # Grant tokens this adapter has been handed (SessionBootstrapGrant),
        # in memory only (never persisted). Used to reject a token that would
        # otherwise ride the wire via sendInput/bootstrapCommand. A future
        # commit clears each token once its bootstrap consumer claims it.
        self.grant_tokens: set[str] = set()

    async def _emit(self, envelope: dict[str, Any]) -> None:
        sys.stdout.write(
            _frame(
                {
                    "jsonrpc": JSON_RPC_VERSION,
                    "method": "terminal.event",
                    "params": envelope,
                }
            )
        )
        sys.stdout.flush()

    def _envelope(
        self,
        session_id: str,
        event: dict[str, Any],
        source: str = "terminal",
    ) -> dict[str, Any]:
        return {
            "version": TERMINAL_HOST_CONTRACT_VERSION,
            "sessionId": session_id,
            "source": source,
            "at": _now_iso(),
            "event": event,
        }

    async def create_session(self, params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("sessionId") or f"iterm2-{_now_iso()}"
        _validate_session_id(session_id)
        if self.connection is None:
            raise RuntimeError("iTerm2 connection not established")
        app = await iterm2.async_get_app(self.connection)
        window = app.current_terminal_window
        if window is None:
            window = await iterm2.Window.async_create(self.connection)
        tab = await window.async_create_tab()
        # Track the session -> iTerm2 Session; the iTerm2 session_id is
        # exposed to the bridge so the bridge can correlate with the
        # RosTerminalSession.
        self.sessions[session_id] = tab.current_session
        await self._emit(
            self._envelope(
                session_id,
                {
                    "type": "terminal.session.started",
                    "sessionId": session_id,
                    "at": _now_iso(),
                },
            )
        )
        return {
            "sessionId": session_id,
            "iTerm2SessionId": tab.current_session.session_id,
        }

    async def launch_bootstrap(self, params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("sessionId") or f"iterm2-{_now_iso()}"
        bootstrap_command = params.get("bootstrapCommand")
        grant = params.get("grant")
        if not isinstance(grant, dict):
            raise ValueError("grant must be an object (SessionBootstrapGrant)")
        grant_token = grant.get("token")
        if grant_token is not None:
            if not isinstance(grant_token, str) or not grant_token:
                raise ValueError("grant.token must be a non-empty string")
            self.grant_tokens.add(grant_token)
        _validate_bootstrap_command(bootstrap_command or "", self.grant_tokens)
        _validate_session_id(session_id)

        if self.connection is None:
            raise RuntimeError("iTerm2 connection not established")
        app = await iterm2.async_get_app(self.connection)
        window = app.current_terminal_window
        if window is None:
            window = await iterm2.Window.async_create(self.connection)
        tab = await window.async_create_tab()
        session = tab.current_session
        self.sessions[session_id] = session

        # The bootstrap command is the FIRST thing typed into the new tab.
        # We do not embed the grant token in the command line; the grant
        # rides the RPC return value (per v5/v6 contract: NOT via argv).
        if bootstrap_command:
            await session.async_send_text(bootstrap_command + "\n")

        await self._emit(
            self._envelope(
                session_id,
                {
                    "type": "terminal.session.started",
                    "sessionId": session_id,
                    "at": _now_iso(),
                },
            )
        )
        return {
            "sessionId": session_id,
            "grant": grant,
            "iTerm2SessionId": session.session_id,
        }

    async def send_input(self, params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("sessionId")
        text = params.get("text")
        _validate_session_id(session_id or "")
        _validate_send_text(text or "", self.grant_tokens)
        if self.connection is None:
            raise RuntimeError("iTerm2 connection not established")
        session = self.sessions.get(session_id)
        if session is None:
            raise LookupError(f"unknown session: {session_id}")

        command_started = _now_iso()
        await self._emit(
            self._envelope(
                session_id,
                {
                    "type": "terminal.command.started",
                    "sessionId": session_id,
                    "at": command_started,
                    "command": text,
                },
            )
        )
        await session.async_send_text(text)
        # We do not currently have a reliable way to observe the exit
        # status of a shell command from the iTerm2 Python API; emit
        # command.ended immediately (exitStatus undefined) as a marker
        # that the input was delivered. A future commit can subscribe
        # to the shell's `prompt` variable to detect command boundaries.
        await self._emit(
            self._envelope(
                session_id,
                {
                    "type": "terminal.command.ended",
                    "sessionId": session_id,
                    "at": _now_iso(),
                },
            )
        )
        return {"sessionId": session_id, "delivered": True, "at": command_started}

    async def terminate_session(self, params: dict[str, Any]) -> dict[str, Any]:
        session_id = params.get("sessionId")
        _validate_session_id(session_id or "")
        session = self.sessions.pop(session_id, None)
        if session is None:
            raise LookupError(f"unknown session: {session_id}")
        await session.async_close()
        await self._emit(
            self._envelope(
                session_id,
                {
                    "type": "terminal.session.terminated",
                    "sessionId": session_id,
                    "at": _now_iso(),
                },
            )
        )
        return {"sessionId": session_id, "terminated": True}


async def _reader(adapter: _Adapter) -> None:
    """Drain stdin line-by-line; dispatch JSON-RPC requests to the adapter."""
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(loop=loop)
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    while True:
        line = await reader.readline()
        if not line:
            return
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as error:
            sys.stderr.write(f"bad json: {error}\n")
            continue
        if not isinstance(msg, dict):
            sys.stderr.write("not an object\n")
            continue
        method = msg.get("method")
        msg_id = msg.get("id")
        params = msg.get("params") or {}
        if not isinstance(method, str) or method not in SUPPORTED_METHODS:
            sys.stdout.write(
                _frame(
                    {
                        "jsonrpc": JSON_RPC_VERSION,
                        "id": msg_id,
                        "error": {
                            "code": -32601,
                            "message": f"method not found: {method}",
                        },
                    }
                )
            )
            sys.stdout.flush()
            continue
        handler = getattr(
            adapter,
            {
                "createSession": "create_session",
                "launchBootstrap": "launch_bootstrap",
                "sendInput": "send_input",
                "terminateSession": "terminate_session",
            }[method],
        )
        try:
            result = await handler(params)
        except PermissionError as error:
            sys.stdout.write(
                _frame(
                    {
                        "jsonrpc": JSON_RPC_VERSION,
                        "id": msg_id,
                        "error": {
                            "code": -32002,
                            "message": f"permission-denied: {error}",
                        },
                    }
                )
            )
            sys.stdout.flush()
            continue
        except LookupError as error:
            sys.stdout.write(
                _frame(
                    {
                        "jsonrpc": JSON_RPC_VERSION,
                        "id": msg_id,
                        "error": {
                            "code": -32003,
                            "message": f"session-not-found: {error}",
                        },
                    }
                )
            )
            sys.stdout.flush()
            continue
        except ValueError as error:
            sys.stdout.write(
                _frame(
                    {
                        "jsonrpc": JSON_RPC_VERSION,
                        "id": msg_id,
                        "error": {
                            "code": -32602,
                            "message": f"invalid params: {error}",
                        },
                    }
                )
            )
            sys.stdout.flush()
            continue
        except Exception as error:  # noqa: BLE001
            sys.stdout.write(
                _frame(
                    {
                        "jsonrpc": JSON_RPC_VERSION,
                        "id": msg_id,
                        "error": {
                            "code": -32001,
                            "message": f"internal: {error}",
                            "data": {"trace": traceback.format_exc(limit=3)},
                        },
                    }
                )
            )
            sys.stdout.flush()
            continue
        sys.stdout.write(
            _frame(
                {
                    "jsonrpc": JSON_RPC_VERSION,
                    "id": msg_id,
                    "result": result,
                }
            )
        )
        sys.stdout.flush()


async def _main(connection: iterm2.Connection) -> int:
    adapter = _Adapter()
    adapter.connection = connection
    # Drain stdin concurrently; asyncio.create_task on the reader so we
    # don't block the main coroutine.
    reader_task = asyncio.create_task(_reader(adapter))
    try:
        await reader_task
    finally:
        for session_id, session in list(adapter.sessions.items()):
            try:
                await session.async_close()
            except Exception:  # noqa: BLE001
                pass
            await adapter._emit(
                adapter._envelope(
                    session_id,
                    {
                        "type": "terminal.session.terminated",
                        "sessionId": session_id,
                        "at": _now_iso(),
                    },
                )
            )
    return 0


def main() -> int:
    return iterm2.run_until_complete(_main)


if __name__ == "__main__":
    sys.exit(main())
