<script>
  import { open } from '@tauri-apps/plugin-dialog';
  import Critique from '../components/Critique.svelte';
  import LoadingLogo from '../components/LoadingLogo.svelte';
  import { copyRun } from '../lib/api.js';
  import {
    backToComments,
    getComments,
    session,
    startNewPage,
    syncRun,
    toggleCritiqueLayout as updateLayout,
  } from '../lib/session.svelte.js';

  async function download() {
    try {
      const dest = await open({
        directory: true,
        title: 'Choose where to save this run',
      });
      if (!dest) return;
      const saved = await copyRun(session.run.id, dest);
      session.error = null;
      session.notice = `Saved to ${saved}`;
    } catch (error) {
      session.notice = null;
      session.error = `Could not save the run: ${error}`;
    }
  }

  const showForm = $derived(!session.run || session.newPage);
</script>

<section class="screen">
  {#if session.running}
    <div class="center">
      <div class="logo-loading">
        <LoadingLogo />
      </div>

      <p class="muted" role="status">
        {session.step === 'generate' ? 'Generating the critique...' : 'Fetching comments from Figma...'}
      </p>
    </div>
  {:else}
    {#if !session.running}
      {#if showForm}
        {#if session.run}
          <div class="toolbar">
            <div class="toolbar__start">
              <button type="button" class="action" onclick={backToComments}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>Back to Comments
              </button>
            </div>
          </div>
        {/if}
      {/if}
    {/if}
  {/if}

  {#if session.error}
    <div class="error" role="alert">
      <p>{session.error}</p>
      {#if session.errorNeedsSettings}
        <button type="button" class="link" onclick={() => (session.screen = 'settings')}>Open Settings</button>
      {/if}
    </div>
  {:else if session.running}
    <pre class="log" aria-label="Output">{session.log.join('\n')}</pre>
  {/if}
  {#if session.notice}<pre class="log" aria-label="Output">{session.notice}</pre>{/if}

  {#if !session.running}
    {#if showForm}
      <form class="center page-form" onsubmit={(event) => (event.preventDefault(), getComments())}>
        <label>
          <span>Figma Page URL</span>
          <input
            type="text"
            bind:value={session.draft.pageUrl}
            aria-invalid={session.urlError ? 'true' : undefined}
            placeholder="https://www.figma.com/design/…?node-id=…"
          />
          {#if session.urlError}
            <span class="field-error" role="alert">{session.urlError}</span>
          {/if}
        </label>
        <label>
          <span>Run name (optional)</span>
          <input type="text" bind:value={session.draft.runName} placeholder="Defaults to the Figma page name" />
        </label>
        <button type="submit" class="action">Get comments</button>
      </form>
    {:else}
      <div class="toolbar">
        <div class="toolbar__start">
          <button type="button" class="action" onclick={startNewPage}>New page</button>
        </div>
        <div class="toolbar__end">
          <button
            type="button"
            class="action layout-toggle"
            aria-label="Two-column layout"
            aria-pressed={session.critiqueLayout === 'grid'}
            title="Two-column layout (stacks when the content is 1024px wide or narrower)"
            disabled={!session.critiqueLayoutReady || session.critiqueLayoutSaving}
            onclick={updateLayout}
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-columns-2 preview-icon"
            >
              <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M12 3v18" />
            </svg>
          </button>
          <button type="button" class="action" onclick={syncRun}>Sync comments</button>
          <button type="button" class="action" onclick={download}> Download markdown </button>
        </div>
      </div>
      <div class="scroll critique-container">
        <Critique markdown={session.run.markdown} runDir={session.run.dir} layout={session.critiqueLayout} />
      </div>
    {/if}
  {/if}
</section>

<style>
  /* Auto margins center a fit-content box in both axes; a translate would not flip in RTL. */
  .center {
    position: absolute;
    inset: 0;
    margin: auto;
    inline-size: fit-content;
    block-size: fit-content;
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .logo-loading {
    margin-block: 2rem;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .toolbar__start button:hover {
    background: var(--surface-item-hover);
  }

  .toolbar__end {
    display: flex;
    gap: 0.5rem;
  }

  .layout-toggle {
    aspect-ratio: 1 / 1;
    width: 48px;
    padding: 0;
    justify-content: center;
  }

  .layout-toggle[aria-pressed='true'] svg {
    rotate: 90deg;
  }

  .page-form {
    inline-size: 100%;
    max-inline-size: 420px;
    align-self: center;
    align-items: stretch;
    gap: 16px;
  }

  .page-form button:last-of-type {
    margin-block-start: 1rem;
  }

  .page-form label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 15px;
  }

  .page-form input {
    padding-block: 0;
    padding-inline: 12px;
    border: 0;
    border-radius: 6px;
    background: var(--card);
    font: inherit;
    font-size: 14px;
  }

  .field-error {
    font-size: 13px;
    color: var(--danger);
  }

  .muted {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }

  .error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 0;
    padding-inline: 4px;
    color: var(--danger);
  }

  .error p {
    margin: 0;
    white-space: pre-wrap;
    font-size: 14px;
  }

  .link {
    padding-block: 6px;
    padding-inline: 10px;
    border: 0;
    border-radius: 8px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .log {
    max-block-size: 220px;
    margin: 0;
    padding: 12px;
    overflow: auto;
    border-radius: 8px;
    font-size: 12px;
    white-space: pre-wrap;
  }

  @container screen (inline-size <= 1024px) {
    .layout-toggle {
      display: none !important;
    }
  }
</style>
