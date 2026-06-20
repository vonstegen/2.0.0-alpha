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

- `RESONANTOS_APP_STATE_ROOT`: alternate app state root for isolated tests.
- `PRIMARY_LOCAL_ENDPOINT`: preferred local OpenAI-compatible base URL, such as `http://192.168.1.13:8081/v1`.
- `PRIMARY_MODEL_NAME`: expected local model id.
- `RESONANTOS_LOCAL_PROVIDER_ENDPOINT`: fallback endpoint variable used by the configure script.
- `RESONANTOS_LOCAL_PROVIDER_MODEL`: fallback model variable used by the configure script.
- `RESONANTOS_LOCAL_PROVIDER_ID`: optional provider id; defaults to `local-llamacpp-primary`.
- `RESONANTOS_LOCAL_PROVIDER_NODE_ID`: optional runtime node id; defaults to `node-local-llamacpp-primary`.
