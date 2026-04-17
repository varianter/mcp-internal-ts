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
      description:
        'Opens an interactive widget to find and confirm a free GitHub app name. ' +
        'The user types a slug-friendly name, selects public or internal repo, ' +
        'checks availability, and confirms their choice. ' +
        'Returns the confirmed app name and target repo.',
      inputSchema: {},
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
