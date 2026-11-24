<script>
  import { open } from '@tauri-apps/plugin-dialog';
  import Critique from '../components/Critique.svelte';
  import LoadingLogo from '../components/LoadingLogo.svelte';
  import { copyRun } from '../lib/api.js';
  import {
    backToComments,
    cancelPushReview,
    confirmPush,
    getComments,
    lockCritique,
    navigateTo,
    readyUpdateCount,
    reviewPush,
    session,
    savePartialExport,
    discardPartialExport,
    startNewPage,
    syncRun,
    toggleCritiqueLayout as updateLayout,
    unlockCritique,
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
  const readyCount = $derived(readyUpdateCount(session.outbox, session.replyDrafts));

  function threadLabel(rootId) {
    const thread = session.threadInfo?.threads.find((item) => item.rootId === rootId);
    return thread ? `${thread.frame} — Pin ${thread.pin} (thread ${thread.rootId})` : `Thread ${rootId}`;
  }

  function branchPath(branch) {
    return branch.path.map(({ name, id }) => `${name} (${id})`).join(' / ');
  }
</script>

<section class="screen">
  {#if session.running}
    <div class="center">
      <div class="logo-loading">
        <LoadingLogo />
      </div>

      <p class="muted" role="status">
        {session.step === 'push'
          ? 'Pushing changes to Figma...'
          : session.step === 'generate'
            ? 'Generating the critique...'
            : 'Fetching comments from Figma...'}
      </p>
    </div>
  {:else}
    {#if !session.running}
      {#if showForm}
        {#if session.run}
          <div class="toolbar">
            <div class="toolbar__start">
              <button
                type="button"
                class="action"
                disabled={Boolean(session.pendingCandidate)}
                onclick={backToComments}
              >
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
        <button type="button" class="link" onclick={() => navigateTo('settings')}>Open Settings</button>
      {/if}
    </div>
  {:else if session.running}
    <pre class="log" aria-label="Output">{session.log.join('\n')}</pre>
  {/if}
  {#if session.notice}<pre class="log" aria-label="Output">{session.notice}</pre>{/if}

  {#if session.pendingCandidate}
    <section class="partial-decision" aria-labelledby="partial-decision-heading">
      <h2 id="partial-decision-heading">Review partial export</h2>
      <p>
        {session.pendingCandidate.summary.confirmedThreads} confirmed threads. The scan could not check the whole page, so
        additional comments might be missing.
      </p>
      {#if session.pendingCandidate.summary.unreadable.length}
        <h3>Unreadable branches</h3>
        <ul>
          {#each session.pendingCandidate.summary.unreadable as branch (`unreadable:${branch.id}`)}
            <li>{branchPath(branch)}</li>
          {/each}
        </ul>
      {/if}
      {#if session.pendingCandidate.summary.unexamined.length}
        <h3>Not examined</h3>
        <ul>
          {#each session.pendingCandidate.summary.unexamined as branch (`unexamined:${branch.id}`)}
            <li>{branchPath(branch)}</li>
          {/each}
        </ul>
      {/if}
      <div class="partial-decision__actions">
        <button type="button" class="action" disabled={session.running} onclick={savePartialExport}>
          Save partial export
        </button>
        <button type="button" class="action" disabled={session.running} onclick={discardPartialExport}>Discard</button>
      </div>
    </section>
  {/if}

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
        <button type="submit" class="action" disabled={Boolean(session.pendingCandidate)}>Get comments</button>
      </form>
    {:else}
      <div class="toolbar">
        <div class="toolbar__start">
          <button
            type="button"
            class="action"
            disabled={session.queueBusy || Boolean(session.review) || Boolean(session.pendingCandidate)}
            onclick={startNewPage}
          >
            New page
          </button>
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
          {#if session.unlocked && readyCount}
            <button
              type="button"
              class="action"
              disabled={session.transitionBusy || Boolean(session.review) || Boolean(session.pendingCandidate)}
              onclick={reviewPush}
            >
              Save {readyCount}
              {readyCount === 1 ? 'update' : 'updates'}
            </button>
          {:else}
            <button
              type="button"
              class="action"
              disabled={session.queueBusy ||
                session.transitionBusy ||
                Boolean(session.review) ||
                Boolean(session.pendingCandidate)}
              onclick={syncRun}
            >
              Sync comments
            </button>
          {/if}
          <button type="button" class="action" onclick={download}> Download markdown </button>
          <button
            type="button"
            class="action edit-toggle"
            aria-label="Lock critique"
            aria-pressed={!session.unlocked}
            disabled={!session.unlocked ||
              session.transitionBusy ||
              Boolean(session.review) ||
              Boolean(session.pendingCandidate)}
            onclick={lockCritique}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-lock preview-icon"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
          <button
            type="button"
            class="action edit-toggle"
            aria-label="Unlock critique"
            aria-pressed={session.unlocked}
            disabled={session.unlocked ||
              session.actionsLoading ||
              !session.threadInfo ||
              !session.outbox ||
              Boolean(session.actionsError) ||
              session.transitionBusy ||
              Boolean(session.review) ||
              Boolean(session.pendingCandidate)}
            onclick={unlockCritique}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              stroke-width="1"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="lucide lucide-lock-open preview-icon"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          </button>
        </div>
      </div>
      {#if session.run.partial}
        <p class="partial-label" role="status">Partial export</p>
      {/if}
      <div class="scroll critique-container">
        {#if session.actionsLoading}
          <p class="muted" role="status">Loading thread actions...</p>
        {:else if session.actionsError}
          <p class="muted" role="status">{session.actionsError}</p>
        {/if}
        {#key session.run.id}
          <Critique
            markdown={session.run.markdown}
            runDir={session.run.dir}
            layout={session.critiqueLayout}
            threadInfo={session.threadInfo}
            outbox={session.outbox}
          />
        {/key}
      </div>
      {#if session.review}
        <dialog open class="review" aria-labelledby="review-heading">
          <h2 id="review-heading">Review changes</h2>
          <p>Destination: <span class="destination">{session.review.destination}</span></p>
          <p>Changes will be sent using the account associated with the token saved in Settings.</p>
          <ul>
            {#each session.review.actions as action (action.id)}
              <li>
                <strong>{threadLabel(action.rootId)}</strong> · {action.kind === 'reply' ? 'Reply' : 'Done mark'}
                {#if action.kind === 'reply'}<p class="reply-text">{action.text}</p>{/if}
              </li>
            {/each}
          </ul>
          <div class="review-buttons">
            <button type="button" class="action" onclick={confirmPush}>Send to Figma</button>
            <button type="button" class="action" onclick={cancelPushReview}>Cancel</button>
          </div>
        </dialog>
      {/if}
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

  .partial-decision {
    margin-block: 16px;
    padding: 16px;
    border: 1px solid var(--danger);
    border-radius: 8px;
    background: var(--card);
  }

  .partial-decision h2,
  .partial-decision h3 {
    margin-block: 0 8px;
  }

  .partial-decision p {
    margin-block: 0 12px;
  }

  .partial-decision ul {
    margin-block: 0 12px;
    padding-inline-start: 24px;
  }

  .partial-decision__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .partial-label {
    display: inline-block;
    margin: 0 0 8px;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--surface-item);
    color: var(--ink);
    font-weight: 700;
  }

  .toolbar__start button:hover {
    background: var(--surface-item-hover);
  }

  .toolbar__end {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .layout-toggle,
  .edit-toggle {
    aspect-ratio: 1 / 1;
    width: 48px;
    padding: 0;
    justify-content: center;
  }

  .edit-toggle[aria-pressed='true'] {
    background: var(--surface-item);
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

  .review {
    max-inline-size: min(900px, calc(100% - 64px));
    max-block-size: calc(100% - 64px);
    padding: 20px;
    overflow: auto;
    border: 2px solid var(--accent);
    border-radius: 8px;
    background: var(--card);
    color: var(--ink);
    font-size: 14px;
  }

  .review h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }
  .review ul {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .review li {
    padding: 12px;
    border-radius: 6px;
    background: var(--surface-item);
  }
  .review-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-block-start: 16px;
  }
  .review-buttons .action {
    background: var(--surface-item);
  }
  .destination,
  .reply-text {
    overflow-wrap: anywhere;
  }
  .reply-text {
    white-space: pre-wrap;
  }

  @container screen (inline-size <= 1024px) {
    .layout-toggle {
      display: none !important;
    }
  }
</style>
