import { mount } from 'svelte';
import FindGithubAppName from './findGithubAppName.svelte';

// globalThis.ExtApps is injected by the server before this script runs
// biome-ignore lint/suspicious/noExplicitAny: ExtApps is injected server-side, no type available
const { App } = (globalThis as any).ExtApps;

const mcpApp = new App({ name: 'FindGithubAppName', version: '1.0.0' }, {});

// Use Svelte 5 mount() instead of the legacy `new Component()` API.
// The legacy API tries to wrap props in $state which fails on class instances.
mount(FindGithubAppName, {
  target: document.getElementById('app') as HTMLElement,
  props: { app: mcpApp },
});

// Connect after mounting so the UI is visible immediately.
mcpApp.connect().catch((err: unknown) => {
  console.error('[FindGithubAppName] Failed to connect to host:', err);
});
