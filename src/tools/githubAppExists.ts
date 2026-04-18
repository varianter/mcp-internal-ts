import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { GitHubClient, repoForTarget } from '../github/github.js';
import { log } from '../log.js';
import { loadSecret, type SecretsLoader } from '../secrets/secrets.js';

export function registerGithubAppExists(server: McpServer, loader: SecretsLoader): void {
  server.registerTool(
    'github-app-exists',
    {
      title: 'Check GitHub App Availability',
      description: `Check whether apps/<app_name>/ already exists in a Variant artifact repo.
Use this before deploying to decide whether to use commit prefix "deploy:" (new) or "update:" (replacing).`,
      inputSchema: {
        app_name: z
          .string()
          .describe(
            'The app identifier. Becomes the path prefix apps/<app_name>/ in the repo. Use kebab-case (e.g. "budget-tracker"). Must not contain "/" or "..".',
          ),
        repo: z
          .enum(['public', 'internal'])
          .describe(
            'Deployment target. "public" → varianter/external-artifacts (share.variant.dev). "internal" → varianter/vibe-artifacts (artifacts.variant.dev, Variant employees only).',
          ),
      },
      outputSchema: {
        exists: z.boolean().describe('Whether the app directory already exists in the repo.'),
      },
      annotations: {
        title: 'Check GitHub App Availability',
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
      },
    },
    async ({ app_name, repo: repoTarget }) => {
      app_name = app_name.trim();

      if (!app_name) {
        return { content: [{ type: 'text', text: 'app_name is required' }], isError: true };
      }
      if (app_name.includes('..') || app_name.includes('/')) {
        return {
          content: [{ type: 'text', text: 'app_name must not contain ".." or "/"' }],
          isError: true,
        };
      }

      let token: string;
      try {
        token = await loadSecret(loader, 'GITHUB_TOKEN', 'mcp-github-token');
      } catch (e) {
        log('error', 'github-app-exists: failed to load token', {
          error: e instanceof Error ? e.message : String(e),
        });
        return { content: [{ type: 'text', text: 'GitHub token not configured' }], isError: true };
      }

      let owner: string;
      let repoName: string;
      try {
        ({ owner, repo: repoName } = repoForTarget(repoTarget));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { content: [{ type: 'text', text: msg }], isError: true };
      }

      log('info', 'github-app-exists: checking', { app: app_name, repo: repoTarget });
      try {
        const exists = await new GitHubClient(token).appExists(owner, repoName, app_name);
        return {
          structuredContent: { exists },
          content: [{ type: 'text' as const, text: exists ? 'exists' : 'not_found' }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log('error', 'github-app-exists: API error', { error: msg });
        return { content: [{ type: 'text', text: `GitHub API error: ${msg}` }], isError: true };
      }
    },
  );
}
