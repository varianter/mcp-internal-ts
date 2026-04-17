# AGENTS.md

Operational reference for agents (Claude Code, Copilot, etc.) working in this repository.

---

## What this is

An MCP (Model Context Protocol) server that exposes Variant internal data as MCP tools. Clients (Claude Desktop, Cursor, etc.) connect to it and can read company data in context.

Built with [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk), deployed in AKS behind oauth2-proxy, using Azure Workload Identity for Key Vault access.

---

## Project layout

```
src/
  index.ts                  # Entry point — wire tools here, start HTTP server
  log.ts                    # Shared structured JSON logger
  config/config.ts          # Env-var config loader
  secrets/secrets.ts        # Secret loader: env var first, Key Vault fallback
  flowcase/flowcase.ts      # FlowCase API client, types, and formatting helpers
  github/github.ts          # GitHub Git Data API client
  secretscanner/            # Regex-based secret detection (public deploys only)
  tools/                    # One file per tool
Dockerfile                  # Multi-stage: node:22-alpine builder + runtime
biome.json                  # Linter + formatter config
.env.example                # Local env var template
```

---

## Adding a tool

1. Create `src/tools/<name>.ts` exporting a `register*` function:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { log } from '../log.js';

export function registerMyTool(server: McpServer): void {
  server.tool(
    'my-tool',
    'Does something useful',
    {
      param: z.string().describe('The input parameter'),
    },
    async ({ param }) => {
      log('info', 'my-tool: called', { param });
      return { content: [{ type: 'text', text: param }] };
    },
  );
}
```

2. Register it in `src/index.ts`:

```typescript
import { registerMyTool } from './tools/myTool.js';

// inside buildServer():
registerMyTool(server);
```

**Error handling:** Return tool-level errors as `{ content: [{ type: 'text', text: 'Error: ...' }], isError: true }`. Throw only for unexpected infrastructure failures — those propagate as MCP protocol errors.

**Secrets:** Use `loadSecret(loader, 'ENV_VAR_NAME', 'keyvault-secret-name')` — checks env var first, falls back to Key Vault. Pass the `SecretsLoader` instance from `buildServer`'s argument.

---

## Configuration

All config comes from environment variables. See `src/config/config.ts`.

| Var | Default | Notes |
|---|---|---|
| `HOST` | `0.0.0.0` | Use `127.0.0.1` locally — **must** be `0.0.0.0` in AKS |
| `PORT` | `8080` | |
| `MCP_PATH` | `/mcp` | HTTP endpoint path for MCP |
| `AZURE_TENANT_ID` | — | Set in k8s ConfigMap |
| `AZURE_CLIENT_ID` | — | Injected automatically by AKS Workload Identity webhook |
| `AZURE_FEDERATED_TOKEN_FILE` | — | Injected automatically by AKS Workload Identity webhook |
| `KEYVAULT_URL` | — | Set locally only; empty in k8s (secrets injected as env vars) |

New config values: add a field to `Config` in `src/config/config.ts`, read from `process.env`, and add to the k8s ConfigMap (non-sensitive) or Secret (sensitive).

---

## Azure / Managed Identity

In AKS, `DefaultAzureCredential` picks up the Workload Identity token automatically (via `AZURE_CLIENT_ID` + `AZURE_FEDERATED_TOKEN_FILE`). Locally it falls through to `az login`. No code changes needed between environments.

When adding Key Vault access:

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

const cred = new DefaultAzureCredential();
const client = new SecretClient(vaultUrl, cred);
```

The ServiceAccount `internal-mcp-sa` in AKS must be annotated with the managed identity client ID:

```yaml
annotations:
  azure.workload.identity/client-id: "<managed-identity-client-id>"
```

---

## Transport

Uses `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` — not stdio. The server manages sessions via a `Map<sessionId, transport>`:

- `POST /mcp` — MCP endpoint (new sessions and existing session messages)
- `GET /mcp` — SSE stream for server-to-client messages
- `DELETE /mcp` — session teardown
- `GET /healthz` — liveness/readiness probe; returns `200 OK`

oauth2-proxy sits in front in AKS. Ensure it does **not** strip `Mcp-Session-Id` headers — the transport uses them to route requests to the correct session. AKS probes should target port 8080 at `/healthz`.

Each new session (POST without `Mcp-Session-Id`) creates a fresh `McpServer` + `StreamableHTTPServerTransport` pair. Sessions are cleaned up when the transport closes.

---

## Local development

```bash
pnpm install
cp .env.example .env  # fill in secrets

pnpm dev              # tsx watch — hot-reload
pnpm inspect          # opens MCP Inspector at http://localhost:6274

pnpm build            # tsc — type-check + emit
pnpm check            # biome lint + format check
pnpm format           # biome format --write
```

---

## Deployment

Trigger the **Deploy** GitHub Actions workflow from the repository UI. It builds, pushes to `variantplatformacr.azurecr.io/mcp-internal`, and updates `values.yaml` in the gitops repo for Argo CD to pick up.

Registry: `variantplatformacr.azurecr.io`  
Namespace: `variant-internal`

The Dockerfile uses a non-root user (`mcp`) and `node:22-alpine`. No shell access in the runtime image.

---

## SDK internals (things to know)

- **Tool registration**: `server.tool(name, description, zodSchema, handler)`. The Zod schema is used for both runtime validation and MCP capability advertisement.
- **Error model**: Tool errors go in `{ content: [{ type: 'text', text: '...' }], isError: true }`. The LLM sees the error message. Throwing from a handler is a protocol-level failure.
- **Session lifecycle**: One `McpServer` instance per session. `server.connect(transport)` is called once per session. The session map in `index.ts` owns all active transports.
- **Logging**: Use `log(level, msg, extra?)` from `src/log.ts` — emits newline-delimited JSON to stdout. Levels: `'info'`, `'warn'`, `'error'`.
- **Health endpoint**: Added manually in `index.ts` — the SDK does not create it automatically.
