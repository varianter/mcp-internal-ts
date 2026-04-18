import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const widgetPath = join(__dirname, '../../dist/widgets/findGithubAppName/index.html');

// Transform the ext-apps ESM bundle into a globalThis assignment so the widget
// can access it without any network fetches (CSP blocks CDN imports in the iframe).
const require = createRequire(import.meta.url);
const rawBundle = readFileSync(
  require.resolve('@modelcontextprotocol/ext-apps/app-with-deps'),
  'utf8',
);
const extAppsBundle = rawBundle.replace(/export\{([^}]+)\};?\s*$/, (_, body: string) => {
  const entries = body.split(',').map((p: string) => {
    const parts = p.split(' as ').map((s: string) => s.trim());
    const local = parts[0];
    const exported = parts[1] ?? parts[0];
    return `${exported}:${local}`;
  });
  return `globalThis.ExtApps={${entries.join(',')}};`;
});

// Read the widget HTML per-request so that `vite build --watch` rebuilds
// are reflected immediately without a server restart (important in dev).
// The ext-apps bundle is injected as a <script> tag in <head> so it runs
// before the Svelte module (module scripts execute in document order).
function loadWidgetHtml(): string {
  const html = readFileSync(widgetPath, 'utf8');
  const injected = `<script type="module">${extAppsBundle}</script>`;
  // Inject as the very first script in <head> so globalThis.ExtApps is set
  // before the Svelte bundle (module scripts execute in document order).
  // Use a replacer function to prevent `$&`, `$'`, `$\`` etc. in the bundle
  // from being interpreted as special replacement patterns by String.replace().
  return html.replace('<head>', () => `<head>${injected}`);
}

const RESOURCE_URI = 'ui://widgets/find-github-app-name';

export function registerFindGithubAppName(server: McpServer): void {
  registerAppTool(
    server,
    'find-github-app-name',
    {
      title: 'Find GitHub App Name',
      description:
        'Opens an interactive widget to find and confirm a GitHub app name for deploying on Variant host. ' +
        'Used to check what URL slug to use when deploying in Variant internal or public hosting. ' +
        'The user types a slug-friendly name, selects public or internal repo, and checks availability. ' +
        'If the name is free they confirm to deploy; if already taken they can choose to replace it. ' +
        'Returns the confirmed app name, target repo, and action (deploy or replace). ' +
        'Pass app_name and repo if already known from context — the widget will pre-fill them and auto-check availability.',
      inputSchema: {
        app_name: z
          .string()
          .optional()
          .describe(
            'Pre-fill the app name if already known from context (e.g. a previous deployment). Widget will auto-check availability on open.',
          ),
        repo: z
          .enum(['public', 'internal'])
          .optional()
          .describe('Pre-select the target repo if already known from context.'),
      },
      annotations: {
        title: 'Find GitHub App Name',
        readOnlyHint: true,
        destructiveHint: false,
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => ({
      content: [{ type: 'text', text: 'Use the widget to choose a free app name.' }],
    }),
  );

  registerAppResource(server, 'Find GitHub App Name', RESOURCE_URI, {}, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: loadWidgetHtml(),
      },
    ],
  }));
}
