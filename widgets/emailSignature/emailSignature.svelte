<script lang="ts">
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

const LOGO_DATA_URI = `https://www.variant.no/_assets/variant-email.png`;

const { app }: { app: McpApp } = $props();

let greeting = $state('');
let name = $state('');
let title = $state('');
let company = $state('');
let phone = $state('');
let url = $state('');
let addressLine1 = $state('');
let addressLine2 = $state('');
let dark = $state(false);
let copied = $state(false);
let copyFailed = $state(false);

// Follow host theme
$effect(() => {
  const ctx = app.getHostContext?.();
  dark = ctx?.theme === 'dark';
  app.onhostcontextchanged = (ctx) => {
    dark = ctx?.theme === 'dark';
  };
});

// All fields come from tool arguments passed by the AI agent
$effect(() => {
  app.ontoolinput = (params) => {
    const args = params.arguments ?? {};
    if (typeof args.greeting === 'string') greeting = args.greeting;
    if (typeof args.name === 'string') name = args.name;
    if (typeof args.title === 'string') title = args.title;
    if (typeof args.company === 'string') company = args.company;
    if (typeof args.phone === 'string') phone = args.phone;
    if (typeof args.url === 'string') url = args.url;
    if (typeof args.address_line1 === 'string') addressLine1 = args.address_line1;
    if (typeof args.address_line2 === 'string') addressLine2 = args.address_line2;
  };
});

const hasAddress = $derived(addressLine1 || addressLine2);
const hasContent = $derived(name.length > 0);

function buildSignatureHtml(): string {
  const lines: string[] = [];

  if (greeting) lines.push(greeting, '<br>');
  lines.push(`<strong>${name}</strong>`);
  if (title) lines.push(title);
  if (company) lines.push(company);
  if (phone || url) lines.push('<br>');
  if (phone) lines.push(phone);
  if (url) lines.push(url);
  if (hasAddress) {
    lines.push('<br>––<br>');
    if (addressLine1) lines.push(addressLine1);
    if (addressLine2) lines.push(addressLine2);
  }
  lines.push('<br>');
  lines.push(
    `<img src="${LOGO_DATA_URI}" alt="${company || 'Variant'}" width="120" style="display:block;" />`,
  );

  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222424;line-height:1.5;">${lines.join('<br>')}</div>`;
}

async function copyHtml() {
  const html = buildSignatureHtml();
  let success = false;

  // Try modern clipboard API first
  try {
    const blob = new Blob([html], { type: 'text/html' });
    const clipItem = new ClipboardItem({ 'text/html': blob });
    await navigator.clipboard.write([clipItem]);
    success = true;
  } catch {
    // Fall back to execCommand, which works in iframes without clipboard-write permission
    try {
      const el = document.createElement('div');
      el.contentEditable = 'true';
      el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
      el.innerHTML = html;
      document.body.appendChild(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      success = document.execCommand('copy');
      sel?.removeAllRanges();
      document.body.removeChild(el);
    } catch {
      success = false;
    }
  }

  if (success) {
    copied = true;
    copyFailed = false;
    setTimeout(() => {
      copied = false;
    }, 2000);
  } else {
    copyFailed = true;
    setTimeout(() => {
      copyFailed = false;
    }, 3000);
  }
}
</script>

<div class="widget" class:dark>
  {#if hasContent}
    <div class="preview-box">
      <button class="btn-copy" class:ok={copied} class:failed={copyFailed} onclick={copyHtml}>
        {copied ? 'OK' : copyFailed ? '!' : 'COPY'}
      </button>
      {#if greeting}<div class="sig-greeting">{greeting}</div>{/if}
      <div class="sig-block">
        <div class="sig-name">{name}</div>
        {#if title}<div class="sig-line">{title}</div>{/if}
        {#if company}<div class="sig-line">{company}</div>{/if}
      </div>
      <div class="sig-block">
        {#if phone}<div class="sig-line">{phone}</div>{/if}
        {#if url}<div class="sig-line sig-url">{url}</div>{/if}
      </div>
      {#if hasAddress}
        <div class="sig-divider">––</div>
        <div class="sig-block sig-address">
          {#if addressLine1}<div class="sig-line">{addressLine1}</div>{/if}
          {#if addressLine2}<div class="sig-line">{addressLine2}</div>{/if}
        </div>
      {/if}
      <div class="sig-logo-wrap">
        <img src={LOGO_DATA_URI} alt={company || 'Variant'} class="sig-logo" />
      </div>
    </div>
  {:else}
    <div class="empty">
      <p>Tell the assistant your name, title, company, phone, website and address to generate your signature.</p>
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
    --border-muted: #c8c8c8;
    --text-secondary: #5e5e5e;
    --bg-preview: #fff;
  }
  .widget.dark {
    color: #fafafa;
    background: #2d2d2d;
    --fg: #fafafa;
    --fg-inv: #222424;
    --border-muted: #555;
    --text-secondary: #b4b5b5;
    --bg-preview: #1e1e1e;
  }

  .empty {
    color: var(--text-secondary);
    font-size: 0.9375rem;
    text-align: center;
    padding: 24px 0;
  }

  .empty p {
    margin: 0;
  }

  .preview-box {
    position: relative;
    background: #f2f2f2;
    border: 1.5px solid var(--border-muted);
    border-radius: 8px;
    padding: 20px 22px 24px;
    font-family: Arial, sans-serif;
    font-size: 13px;
    color: #222424;
    line-height: 1.6;
  }

  .sig-greeting {
    margin-bottom: 14px;
    color: #222424;
  }

  .sig-block {
    margin-bottom: 10px;
  }

  .sig-name {
    font-weight: 600;
  }

  .sig-line {
    color: #222424;
  }

  .sig-url {
    color: #1a6fb3;
  }

  .sig-divider {
    color: #888;
    margin-bottom: 6px;
  }

  .sig-address {
    color: #555;
  }

  .sig-logo-wrap {
    margin-top: 16px;
    padding-bottom: 4px;
    overflow: visible;
  }

  .sig-logo {
    display: block;
    width: 100px;
    height: auto;
    overflow: visible;
  }

  .btn-copy {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 0.6875rem;
    font-family: inherit;
    font-weight: 600;
    letter-spacing: 0.05em;
    cursor: pointer;
    border: 1px solid var(--border-muted);
    background: var(--bg-preview);
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .btn-copy:hover {
    border-color: var(--fg);
    color: var(--fg);
  }

  .btn-copy.ok {
    border-color: #3a8f5e;
    color: #3a8f5e;
  }

  .btn-copy.failed {
    border-color: #b94040;
    color: #b94040;
  }
</style>
