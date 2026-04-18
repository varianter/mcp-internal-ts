<script lang="ts">
type Repo = 'public' | 'internal';
type Status = 'idle' | 'checking' | 'available' | 'taken' | 'error';

type McpApp = {
  callServerTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
  }>;
  sendMessage: (msg: { role: string; content: Array<{ type: string; text: string }> }) => void;
  getHostContext: () => { theme?: string } | null | undefined;
  onhostcontextchanged: ((ctx: { theme?: string }) => void) | null;
  ontoolinput: ((params: { arguments?: Record<string, unknown> }) => void) | null;
};

const { app }: { app: McpApp } = $props();

let rawInput = $state('');
let repo = $state<Repo>('public');
let status = $state<Status>('idle');
let errorMessage = $state('');
let dark = $state(false);

// Follow host theme
$effect(() => {
  const ctx = app.getHostContext?.();
  dark = ctx?.theme === 'dark';
  app.onhostcontextchanged = (ctx) => {
    dark = ctx?.theme === 'dark';
  };
});

// Pre-fill from tool arguments if provided by the model
$effect(() => {
  app.ontoolinput = (params) => {
    const args = params.arguments ?? {};
    if (typeof args.app_name === 'string' && args.app_name) {
      rawInput = args.app_name;
    }
    if (args.repo === 'public' || args.repo === 'internal') {
      repo = args.repo;
    }
    if (rawInput) {
      checkAvailability();
    }
  };
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const appName = $derived(slugify(rawInput));
const canCheck = $derived(appName.length > 0 && status !== 'checking');
const canConfirm = $derived(status === 'available' && appName.length > 0);
const canReplace = $derived(status === 'taken' && appName.length > 0);

function onInputChange() {
  if (status !== 'idle') {
    status = 'idle';
    errorMessage = '';
  }
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') checkAvailability();
}

function onRepoChange() {
  if (status !== 'idle') {
    status = 'idle';
    errorMessage = '';
  }
}

async function checkAvailability() {
  if (!canCheck) return;
  status = 'checking';
  errorMessage = '';
  try {
    const result = await app.callServerTool({
      name: 'github-app-exists',
      arguments: { app_name: appName, repo },
    });
    if (result?.structuredContent != null) {
      status = result.structuredContent.exists ? 'taken' : 'available';
    } else {
      // fallback for servers without structured output support
      const text = result?.content?.[0]?.text ?? '';
      if (text === 'exists') {
        status = 'taken';
      } else if (text === 'not_found') {
        status = 'available';
      } else {
        status = 'error';
        errorMessage = text || 'Unexpected response';
      }
    }
  } catch (e) {
    status = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
  }
}

function confirmName(intent: 'deploy' | 'replace') {
  if (intent === 'deploy' && !canConfirm) return;
  if (intent === 'replace' && !canReplace) return;
  app.sendMessage({
    role: 'user',
    content: [
      {
        type: 'text',
        text:
          intent === 'replace'
            ? `App name: ${appName}, repo: ${repo}, action: replace`
            : `App name: ${appName}, repo: ${repo}, action: deploy`,
      },
    ],
  });
}

const repoLabels: Record<Repo, string> = {
  public: 'Public (share.variant.dev)',
  internal: 'Internal (artifacts.variant.dev)',
};
</script>

<div class="widget" class:dark>
  <form onsubmit={(e) => { e.preventDefault(); checkAvailability(); }}>
    <div class="field">
      <label class="field-label" for="name-input">App name</label>
      <input
        id="name-input"
        type="text"
        placeholder="my-app-name"
        bind:value={rawInput}
        oninput={onInputChange}
        onkeydown={onInputKeydown}
        autocomplete="off"
        spellcheck="false"
        aria-describedby={rawInput && appName !== rawInput ? 'slug-hint' : undefined}
      />
      {#if rawInput && appName !== rawInput}
        <p id="slug-hint" class="slug-hint">Will be used as: <strong>{appName || '—'}</strong></p>
      {/if}
    </div>

    <div class="field">
      <span class="field-label">Target repo</span>
      <div class="pill-group" role="radiogroup" aria-label="Target repo">
        {#each Object.entries(repoLabels) as [value, label]}
          <label class="pill" class:selected={repo === value}>
            <input
              type="radio"
              name="repo"
              {value}
              bind:group={repo}
              onchange={onRepoChange}
            />
            {label}
          </label>
        {/each}
      </div>
    </div>

    <div class="actions">
      <button type="submit" class="btn-check" disabled={!canCheck}>
        {status === 'checking' ? 'Checking…' : 'Check availability'}
      </button>

      <span aria-live="polite" aria-atomic="true">
        {#if status === 'available'}
          <span class="badge available">✓ Available</span>
        {:else if status === 'taken'}
          <span class="badge taken">✗ Already taken</span>
        {:else if status === 'error'}
          <span class="badge error">Error: {errorMessage}</span>
        {/if}
      </span>
    </div>
  </form>

  {#if canConfirm}
    <div class="confirm">
      <button class="btn-confirm" onclick={() => confirmName('deploy')}>
        Use "{appName}"
      </button>
    </div>
  {:else if canReplace}
    <div class="confirm">
      <button class="btn-replace" onclick={() => confirmName('replace')}>
        Replace "{appName}"
      </button>
    </div>
  {/if}
</div>

<style>
  .widget {
    font-family: 'Britti Sans', Arial, sans-serif;
    font-size: 1rem;
    font-weight: 300;
    padding: 20px;
    color: #222424;
    background: #fafafa;
    box-sizing: border-box;
    --fg: #222424;
    --fg-inv: #fafafa;
    --border: #222424;
    --border-muted: #c8c8c8;
    --text-secondary: #5e5e5e;
    --success-bg: #e6f5e7;
    --success-text: #035506;
    --error-bg: #fdedec;
    --error-text: #7c2318;
    --warning-bg: #fffbf6;
    --warning-text: #8e6703;
  }
  .widget.dark {
    color: #fafafa;
    background: #2d2d2d;
    --fg: #fafafa;
    --fg-inv: #222424;
    --border: #fafafa;
    --border-muted: #555;
    --text-secondary: #b4b5b5;
    --success-bg: #024105;
    --success-text: #8cd18f;
    --error-bg: #46100a;
    --error-text: #f3948f;
    --warning-bg: #3b2800;
    --warning-text: #fbe186;
  }

  .field {
    margin-bottom: 18px;
  }
  .field-label {
    display: block;
    font-weight: 450;
    margin-bottom: 8px;
    font-size: 0.9375rem;
  }

  input[type='text'] {
    width: 100%;
    padding: 10px 14px;
    border: 1.5px solid var(--border-muted);
    border-radius: 6px;
    font-size: 1rem;
    font-family: inherit;
    font-weight: 300;
    box-sizing: border-box;
    background: inherit;
    color: inherit;
    transition: border-color 0.15s;
  }
  input[type='text']:focus {
    outline: none;
    border-color: var(--fg);
  }
  .slug-hint {
    margin: 5px 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  /* Pill radio group */
  .pill-group {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pill-group input[type='radio'] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 7px 18px;
    border-radius: 999px;
    border: 1.5px solid var(--border);
    font-family: inherit;
    font-size: 0.9375rem;
    font-weight: 400;
    cursor: pointer;
    background: transparent;
    color: var(--fg);
    transition: background 0.15s, color 0.15s;
    user-select: none;
  }
  .pill.selected {
    background: var(--fg);
    color: var(--fg-inv);
  }
  .pill:hover:not(.selected) {
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 9px 22px;
    border-radius: 999px;
    font-size: 1rem;
    font-family: inherit;
    font-weight: 400;
    cursor: pointer;
    border: 1.5px solid var(--fg);
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .btn-check {
    background: var(--fg);
    color: var(--fg-inv);
  }
  .btn-check:hover:not(:disabled) {
    background: color-mix(in srgb, var(--fg) 85%, transparent);
    border-color: color-mix(in srgb, var(--fg) 85%, transparent);
  }

  .badge {
    font-size: 0.875rem;
    font-weight: 450;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1.5px solid transparent;
  }
  .badge.available {
    background: var(--success-bg);
    color: var(--success-text);
  }
  .badge.taken {
    background: var(--error-bg);
    color: var(--error-text);
  }
  .badge.error {
    background: var(--warning-bg);
    color: var(--warning-text);
  }

  .confirm {
    margin-top: 16px;
  }
  .btn-confirm {
    background: var(--fg);
    color: var(--fg-inv);
    width: 100%;
    border-color: var(--fg);
  }
  .btn-confirm:hover {
    opacity: 0.82;
  }
  .btn-replace {
    background: transparent;
    color: var(--error-text);
    width: 100%;
    border-color: var(--error-text);
  }
  .btn-replace:hover {
    background: var(--error-bg);
  }
</style>
