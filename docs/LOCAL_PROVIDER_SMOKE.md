# Local Provider Smoke Workflow

This workflow configures a private OpenAI-compatible local runtime as the active Augmentor route, then verifies that ResonantOS can call it.

## Requirements

- A private endpoint that exposes OpenAI-compatible `GET /v1/models` and `POST /v1/chat/completions`.
- The endpoint must be on `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`.
- A model id returned by `/v1/models`.

The configure script refuses non-private endpoints. Do not commit runtime-state files or provider secrets.

## Commands

Use an isolated state root while testing:

```bash
export RESONANTOS_APP_STATE_ROOT=/tmp/resonantos-local-provider-state
export PRIMARY_LOCAL_ENDPOINT=http://192.168.1.13:8081/v1
export PRIMARY_MODEL_NAME='Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M'

npm run configure:local-provider
npm run smoke:local-provider
```

`configure:local-provider` discovers models from `/v1/models`, writes the provider/runtime node into `runtime-state.json`, and routes `strategy-augmentor-primary` to the selected model.

`smoke:local-provider` reads that runtime state and sends a minimal chat completion request to the configured local route.

## Environment

- `RESONANTOS_APP_STATE_ROOT`: alternate Electron/Tauri app state root for isolated tests.
- `PRIMARY_LOCAL_ENDPOINT`: preferred local OpenAI-compatible base URL, such as `http://192.168.1.13:8081/v1`.
- `PRIMARY_MODEL_NAME`: expected local model id.
- `RESONANTOS_LOCAL_PROVIDER_ENDPOINT`: fallback endpoint variable used by the configure script.
- `RESONANTOS_LOCAL_PROVIDER_MODEL`: fallback model variable used by the configure script.
- `RESONANTOS_LOCAL_PROVIDER_ID`: optional provider id; defaults to `local-llamacpp-primary`.
- `RESONANTOS_LOCAL_PROVIDER_NODE_ID`: optional runtime node id; defaults to `node-local-llamacpp-primary`.
- `RESONANTOS_PROVIDER_SMOKE_*`: Electron product-smoke inputs, including `RESONANTOS_PROVIDER_SMOKE=1`, `RESONANTOS_PROVIDER_SMOKE_PROVIDER_ID`, `RESONANTOS_PROVIDER_SMOKE_PROVIDER_TYPE`, `RESONANTOS_PROVIDER_SMOKE_MODEL`, `RESONANTOS_PROVIDER_SMOKE_BASE_URL`, `RESONANTOS_PROVIDER_SMOKE_RUNTIME_NODE_ID`, `RESONANTOS_PROVIDER_SMOKE_RUNTIME_NODE_KIND`, `RESONANTOS_PROVIDER_SMOKE_RUNTIME_NODE_ENDPOINT`, `RESONANTOS_PROVIDER_SMOKE_AUTH_TIER`, and `RESONANTOS_PROVIDER_SMOKE_PROMPT`.

## Electron Settings

In Electron, Settings provider **Test** and **Smoke Test** reuse the existing `provider_service_chat_completion` IPC path, so a configured OpenAI-compatible local-runtime provider should show the existing smoke result and notice.

Settings **Setup** probing is not implemented for Electron yet. It returns an explicit `adapter-pending` / unsupported result instead of silently failing; use **Check Health** or **Test** to verify the local route in Electron.
