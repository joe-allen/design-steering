<script>
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { renderThreadText, threadLink } from '../lib/render.js';
  import {
    addDone,
    discardDraft,
    navigateTo,
    openReplyEditor,
    removeAction,
    retryAction,
    retryDraftSave,
    session,
    updateDraft,
  } from '../lib/session.svelte.js';

  let { thread, runDir, showAuthors = false } = $props();
  let verifyingId = $state(null);

  const actions = $derived((session.outbox?.actions ?? []).filter((action) => action.rootId === thread.rootId));
  const drafts = $derived(session.replyDrafts.filter((draft) => draft.rootId === thread.rootId));
  const mark = $derived(actions.find((action) => action.kind === 'done'));
  const markLocked = $derived(
    thread.done || ['confirmed', 'alreadyDone', 'inFlight', 'uncertain'].includes(mark?.status),
  );
  const editable = $derived(
    session.unlocked && !session.running && !session.pendingCandidate && !session.review && !session.transitionBusy,
  );
  const disabled = $derived(!editable || session.queueBusy || Boolean(session.actionsError));
  const href = $derived(threadLink(session.threadInfo.destination, session.threadInfo.fileKey, thread));
  const message = $derived(renderThreadText(thread.message, { runDir }, { root: true }));

  function statusLabel(status) {
    return {
      pending: 'Queued',
      rejected: 'Rejected',
      confirmed: 'Sent',
      alreadyDone: 'Already done in Figma',
      inFlight: 'Needs verification in Figma',
      uncertain: 'Needs verification in Figma',
    }[status];
  }

  async function toggleMark(event) {
    const input = event.currentTarget;
    const changed = input.checked ? await addDone(thread.rootId) : mark && (await removeAction(mark.id));
    if (!changed) input.checked = thread.done || Boolean(mark);
  }

  async function openThread() {
    try {
      await openUrl(href);
    } catch (error) {
      session.error = `Could not open the thread in Figma: ${error}`;
      session.errorNeedsSettings = false;
    }
  }
</script>

<li class="thread">
  <div class="root">
    <input
      type="checkbox"
      aria-label={`Mark pin ${thread.pin} done`}
      checked={thread.done || Boolean(mark)}
      disabled={disabled || markLocked}
      onchange={toggleMark}
    />
    <strong><a {href}>{thread.pin}</a>:</strong>
    <div class="comment">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html message}
    </div>
    {#if showAuthors}<span> ({thread.user})</span>{/if}
    {#if thread.resolved}<span> [Resolved]</span>{/if}
    {#if editable}
      <button
        type="button"
        class="inline"
        disabled={Boolean(session.actionsError)}
        onclick={() => openReplyEditor(thread.rootId)}
      >
        Reply
      </button>
    {/if}
  </div>

  {#if thread.replies?.length}
    <ul class="replies">
      {#each thread.replies as reply (reply.id)}
        <li>
          <div class="comment">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html renderThreadText(reply.message, { runDir })}
          </div>
          {#if showAuthors}<span> ({reply.user})</span>{/if}
          {#if reply.resolved}<span> [Resolved]</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}

  {#each actions as action (action.id)}
    <div class="result">
      <small class="muted text-sm">
        {action.kind === 'reply' ? 'Reply' : 'Done mark'} <span class="lowercase">{statusLabel(action.status)}</span>
      </small>

      {#if action.kind === 'reply' && !drafts.some((draft) => draft.actionId === action.id)}
        <span class="muted text-sm">{action.text}</span>
      {/if}
      {#if action.error}<p class="result-error">{action.error}</p>{/if}
      {#if action.error && /\b(?:401|403)\b|token|file_comments:write/i.test(action.error)}
        <button type="button" class="small" onclick={() => navigateTo('settings')}>Open Settings</button>
      {/if}
      {#if editable && ['inFlight', 'uncertain'].includes(action.status)}
        <div class="buttons">
          <button type="button" class="small" {disabled} onclick={openThread}>Open in Figma</button>
          <button type="button" class="small" {disabled} onclick={() => (verifyingId = action.id)}>
            Retry after checking
          </button>
        </div>
        {#if verifyingId === action.id}
          <div class="verification">
            <p>Check Figma first. Retrying an action that was already sent can create a duplicate.</p>
            <div class="buttons">
              <button
                type="button"
                class="small"
                {disabled}
                onclick={async () => {
                  if (await retryAction(action.id)) verifyingId = null;
                }}
              >
                I checked Figma; retry
              </button>
              <button type="button" class="small" {disabled} onclick={() => (verifyingId = null)}>Cancel retry</button>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/each}

  {#each drafts as draft (draft.key)}
    <div class="draft">
      {#if editable}
        <label>
          <span class="visually-hidden">Reply to pin {thread.pin}</span>
          <textarea
            value={draft.text}
            placeholder="Add reply"
            rows="3"
            disabled={draft.discarding}
            oninput={(event) => updateDraft(draft.key, event.currentTarget.value)}></textarea>
        </label>
        <div class="buttons">
          <button
            type="button"
            class="inline inline--bg-light"
            aria-label="Discard reply"
            disabled={draft.discarding}
            onclick={() => discardDraft(draft.key)}
          >
            Discard
          </button>
          {#if draft.error}
            <button
              type="button"
              class="inline inline--bg-light"
              aria-label="Retry saving draft"
              disabled={draft.discarding}
              onclick={retryDraftSave}
            >
              Retry
            </button>
          {/if}
        </div>
      {:else if draft.text.trim()}
        <p class="reply-text">{draft.text}</p>
      {/if}
      {#if draft.error}<p class="result-error">{draft.error}</p>{/if}
    </div>
  {/each}
</li>

<style>
  .root {
    display: block;
  }
  .root input {
    margin-inline: 0 4px 0;
    width: 1.1rem;
    height: 1.1rem;
  }
  .comment,
  .reply-text {
    overflow-wrap: anywhere;
  }
  .comment {
    display: inline;
  }
  .comment :global(p:first-child) {
    display: inline;
  }
  .reply-text {
    white-space: pre-wrap;
    margin-block-end: 2rem !important;
    font-style: italic;
  }
  .inline {
    min-block-size: 0;
    margin-inline-start: 4px;
    padding: 0;
    border: 0;
    background: none;
    padding: 3px 6px 4px;
    border-radius: 3px;
    background: var(--ink);
    color: #fff;
    font-weight: 700;
    cursor: pointer;
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;

    &.inline--bg-light {
      background: #fff;
      color: var(--ink);
    }
  }

  .inline::after {
    display: none;
  }

  .replies {
    padding-inline-start: 24px;
  }
  .replies li::before {
    content: '– ';
  }
  .result {
    margin-block: 8px 0;
    line-height: 1.2;

    & + .result {
      margin-block: 0 8px;
    }
  }

  .result + .draft {
    margin-block: 8px;
  }

  .draft {
    margin-block: 0 8px;
  }
  .result p,
  .draft p {
    margin: 4px 0;
  }
  .result-error {
    color: var(--danger);
  }
  textarea {
    box-sizing: border-box;
    inline-size: 100%;
    padding: 12px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--card);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  textarea:focus {
    outline: 2px solid var(--ink);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-block: 8px 2rem;
  }
  .small {
    min-block-size: 36px;
    padding: 6px 12px;
    border: 0;
    border-radius: 6px;
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .visually-hidden {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
