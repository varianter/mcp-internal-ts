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
const widgetPath = join(__dirname, '../../dist/widgets/emailSignature/index.html');

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

function loadWidgetHtml(): string {
  const html = readFileSync(widgetPath, 'utf8');
  const injected = `<script type="module">${extAppsBundle}</script>`;
  return html.replace('<head>', () => `<head>${injected}`);
}

const RESOURCE_URI = 'ui://widgets/email-signature';

export function registerEmailSignature(server: McpServer): void {
  registerAppTool(
    server,
    'email-signature',
    {
      title: 'Email Signature Generator',
      description:
        'Opens an interactive widget to generate an email signature for Variant employees. ' +
        'Supports all Variant companies across cities and countries with configurable name, title, company, phone, website and address. ' +
        'The widget shows a live preview and lets you copy the signature as formatted HTML ready to paste into your email client. ' +
        'Pass known values as arguments to pre-fill the form.',
      inputSchema: {
        greeting: z
          .string()
          .optional()
          .describe('Greeting line, e.g. "Vennlig hilsen," or "Kind regards,"'),
        name: z.string().optional().describe('Full name of the person'),
        title: z.string().optional().describe('Job title (optional)'),
        company: z
          .string()
          .optional()
          .describe('Company name, e.g. "Variant" or "Variant Stockholm"'),
        phone: z.string().optional().describe('Phone number, e.g. "(+47) 97 98 18 77"'),
        url: z
          .string()
          .optional()
          .describe('Website URL, e.g. "www.variant.no" or "www.variant.se"'),
        address_line1: z.string().optional().describe('First address line, e.g. "Kongens gate 36"'),
        address_line2: z.string().optional().describe('Second address line, e.g. "7012 Trondheim"'),
      },
      annotations: {
        title: 'Email Signature Generator',
        readOnlyHint: true,
        destructiveHint: false,
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: 'Use the widget to build and copy your email signature.',
        },
      ],
    }),
  );

  registerAppResource(server, 'Email Signature Generator', RESOURCE_URI, {}, async () => ({
    contents: [
      {
        uri: RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: loadWidgetHtml(),
      },
    ],
  }));
}
