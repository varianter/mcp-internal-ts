# variant-internal-mcp (TypeScript)

TypeScript port of the Variant internal MCP server. Implements the same 5 tools as the original Go version using the official `@modelcontextprotocol/sdk`.

## Tools

| Tool                    | Description                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `random-joke`           | Returns a random IT/programming/design joke                                             |
| `get-cv-for-consultant` | Fetches a consultant's full CV from FlowCase by name                                    |
| `search-cv-by-keyword`  | Searches FlowCase for consultants ranked by years of experience with given technologies |
| `github-app-exists`     | Checks if `apps/<app_name>/` exists in a Variant artifact repo                          |
| `github-deploy-app`     | Deploys files to `apps/<app_name>/` via an atomic Git commit                            |

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Configure env vars
cp .env.example .env
# Edit .env with your FLOWCASE_API_KEY, FLOWCASE_ORG, GITHUB_TOKEN
# It uses KeyVault by default so with access to Variant Azure, you only "KEYVAULT_URL" is needed.

# 3. Start with hot-reload, using KeyVault
pnpm dev

# 4. Open MCP Inspector in another terminal
pnpm inspect
```

## Environment variables

| Variable           | Default   | Description                                          |
| ------------------ | --------- | ---------------------------------------------------- |
| `HOST`             | `0.0.0.0` | Bind address (`127.0.0.1` locally, `0.0.0.0` in AKS) |
| `PORT`             | `8080`    | HTTP port                                            |
| `MCP_PATH`         | `/mcp`    | MCP endpoint path                                    |
| `AZURE_CLIENT_ID`  | —         | Injected by AKS Workload Identity webhook            |
| `AZURE_TENANT_ID`  | —         | Set in k8s ConfigMap                                 |
| `KEYVAULT_URL`     | —         | Local only; e.g. `https://my-vault.vault.azure.net/` |
| `FLOWCASE_ORG`     | —         | FlowCase subdomain (e.g. `variant`)                  |
| `FLOWCASE_API_KEY` | —         | FlowCase API token                                   |
| `GITHUB_TOKEN`     | —         | GitHub PAT with Contents R+W on both artifact repos  |

Secrets are resolved in order: **env var → Azure Key Vault**. Set the env var directly in production (k8s Secret), or set `KEYVAULT_URL` for local dev with `az login`.

## Docker

```bash
docker build -t variant-internal-mcp-ts:latest .

docker run \
  -e FLOWCASE_API_KEY=... \
  -e FLOWCASE_ORG=variant \
  -e GITHUB_TOKEN=... \
  -p 8080:8080 \
  variant-internal-mcp-ts:latest
```
