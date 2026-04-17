<script lang="ts">
type Repo = 'public' | 'internal';
type Status = 'idle' | 'checking' | 'available' | 'taken' | 'error';

type McpApp = {
  callServerTool: (args: {
    name: string;
    arguments: Record<string, unknown>;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  sendMessage: (msg: { role: string; content: Array<{ type: string; text: string }> }) => void;
  getHostContext: () => { theme?: string } | null | undefined;
  onhostcontextchanged: ((ctx: { theme?: string }) => void) | null;
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
    const text = result?.content?.[0]?.text ?? '';
    if (text === 'exists') {
      status = 'taken';
    } else if (text === 'not_found') {
      status = 'available';
    } else {
      status = 'error';
      errorMessage = text || 'Unexpected response';
    }
  } catch (e) {
    status = 'error';
    errorMessage = e instanceof Error ? e.message : String(e);
  }
}

function confirmName() {
  if (!canConfirm) return;
  app.sendMessage({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `App name: ${appName}, repo: ${repo}`,
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
      <label for="name-input">App name</label>
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
      <fieldset>
        <legend>Target repo</legend>
        {#each Object.entries(repoLabels) as [value, label]}
          <label class="radio">
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
      </fieldset>
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
      <button class="btn-confirm" onclick={confirmName}>
        Use "{appName}"
      </button>
    </div>
  {/if}
</div>

<style>
  .widget {
    font-family: system-ui, sans-serif;
    font-size: 14px;
    padding: 16px;
    color: #111;
    background: #fff;
    box-sizing: border-box;
    --accent: #1a56e8;
    --radius: 6px;
  }
  .widget.dark {
    color: #f0f0f0;
    background: #1a1a1a;
    --accent: #5b8df7;
  }

  .field {
    margin-bottom: 14px;
  }
  label {
    display: block;
    font-weight: 600;
    margin-bottom: 6px;
  }
  input[type='text'] {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #ccc;
    border-radius: var(--radius);
    font-size: 14px;
    box-sizing: border-box;
    background: inherit;
    color: inherit;
  }
  .widget.dark input[type='text'] {
    border-color: #444;
  }
  input[type='text']:focus {
    outline: 2px solid var(--accent);
    border-color: transparent;
  }
  .slug-hint {
    margin: 4px 0 0;
    font-size: 12px;
    color: #666;
  }
  .widget.dark .slug-hint {
    color: #aaa;
  }

  fieldset {
    border: 1px solid #ddd;
    border-radius: var(--radius);
    padding: 8px 12px;
    margin: 0;
  }
  .widget.dark fieldset {
    border-color: #444;
  }
  legend {
    font-weight: 600;
    padding: 0 4px;
    font-size: 14px;
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: normal;
    margin-bottom: 4px;
    cursor: pointer;
  }
  .radio:last-child {
    margin-bottom: 0;
  }
  .radio input {
    accent-color: var(--accent);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  button {
    padding: 8px 16px;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn-check {
    background: var(--accent);
    color: #fff;
  }
  .btn-check:hover:not(:disabled) {
    opacity: 0.88;
  }

  .badge {
    font-size: 13px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 99px;
  }
  .badge.available {
    background: #d1fae5;
    color: #065f46;
  }
  .badge.taken {
    background: #fee2e2;
    color: #991b1b;
  }
  .badge.error {
    background: #fef3c7;
    color: #92400e;
  }
  .widget.dark .badge.available {
    background: #064e3b;
    color: #6ee7b7;
  }
  .widget.dark .badge.taken {
    background: #7f1d1d;
    color: #fca5a5;
  }
  .widget.dark .badge.error {
    background: #78350f;
    color: #fde68a;
  }

  .confirm {
    margin-top: 14px;
  }
  .btn-confirm {
    background: #16a34a;
    color: #fff;
    width: 100%;
  }
  .btn-confirm:hover {
    opacity: 0.88;
  }
</style>
