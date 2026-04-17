// SecretsLoader retrieves secrets from env vars (k8s) or Key Vault (local dev).
// In k8s, KEYVAULT_URL is not set and secrets are injected as env vars via values.yaml.
// Locally, KEYVAULT_URL is set and DefaultAzureCredential uses `az login`.

import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

export class SecretsLoader {
  private kv: SecretClient | null = null;

  constructor(vaultUrl: string) {
    if (vaultUrl) {
      const cred = new DefaultAzureCredential();
      this.kv = new SecretClient(vaultUrl, cred);
    }
  }

  async get(name: string): Promise<string> {
    if (this.kv === null) {
      throw new Error(`secret "${name}": env var not set and no KEYVAULT_URL configured`);
    }
    const resp = await this.kv.getSecret(name);
    if (!resp.value) {
      throw new Error(`secret "${name}": Key Vault returned empty value`);
    }
    return resp.value;
  }
}

// loadSecret checks the env var first (local dev / k8s), then falls back to Key Vault.
// Key Vault does not allow underscores in names, hence the two separate name parameters.
export async function loadSecret(
  loader: SecretsLoader,
  envName: string,
  kvName: string,
): Promise<string> {
  const envVal = process.env[envName];
  if (envVal) return envVal;

  try {
    return await loader.get(kvName);
  } catch (e) {
    throw new Error(
      `secret ${envName} / Key Vault ${kvName}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
