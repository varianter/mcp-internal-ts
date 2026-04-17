// Config holds runtime configuration loaded from environment variables.
// In AKS, these are injected via ConfigMap. Azure Workload Identity vars
// (AZURE_CLIENT_ID, AZURE_FEDERATED_TOKEN_FILE) are injected automatically
// by the AKS webhook and do not need to be set manually.

export interface Config {
  host: string; // default: "0.0.0.0"  — must be 0.0.0.0 in AKS
  port: number; // default: 8080
  mcpPath: string; // default: "/mcp"
  azureClientId: string;
  azureTenantId: string;
  keyVaultUrl: string; // KEYVAULT_URL — set locally only; empty in k8s
}

export function loadConfig(): Config {
  const host = process.env.HOST ?? '0.0.0.0';

  let port = 8080;
  const rawPort = process.env.PORT;
  if (rawPort) {
    const p = parseInt(rawPort, 10);
    if (Number.isNaN(p) || !Number.isInteger(p)) {
      throw new Error(`invalid PORT "${rawPort}": must be an integer`);
    }
    if (p < 1 || p > 65535) {
      throw new Error(`invalid PORT "${rawPort}": must be between 1 and 65535`);
    }
    port = p;
  }

  const mcpPath = process.env.MCP_PATH ?? '/mcp';

  return {
    host,
    port,
    mcpPath,
    azureClientId: process.env.AZURE_CLIENT_ID ?? '',
    azureTenantId: process.env.AZURE_TENANT_ID ?? '',
    keyVaultUrl: process.env.KEYVAULT_URL ?? '',
  };
}
