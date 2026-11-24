<script>
  import { listRuns } from '../lib/api.js';
  import { filterRuns, formatDate } from '../lib/history.js';
  import { openRun, removeAllRuns, removeRun, session } from '../lib/session.svelte.js';

  let runs = $state([]);
  let loaded = $state(false);
  let error = $state(null);
  let query = $state('');
  // What the user is being asked to confirm: { all: true } or { id, label }.
  let confirming = $state(null);
  let removeError = $state(null);

  async function load() {
    try {
      runs = await listRuns();
      error = null;
    } catch (reason) {
      error = `Could not read past runs: ${reason}`;
    }
    loaded = true;
  }
  load();

  async function confirmRemoval() {
    const target = confirming;
    confirming = null;
    removeError = null;
    removeError = target.all ? await removeAllRuns() : await removeRun(target.id);
    if (target.all) query = '';
    await load();
  }

  const visible = $derived(filterRuns(runs, query));
</script>

<section class="screen">
  <div class="scroll">
    <h1>History</h1>

    {#if error}
      <p class="note error" role="alert">{error}</p>
    {/if}
    {#if removeError}
      <p class="note error" role="alert">{removeError}</p>
    {/if}

    {#if confirming}
      <div class="confirm" role="alertdialog" aria-label="Confirm removal">
        <p>
          {#if confirming.all}
            Permanently delete all runs, including their comments and images?
          {:else}
            Permanently delete “{confirming.label}”, including its comments and images?
          {/if}
        </p>
        <div class="confirm__actions">
          <button type="button" class="danger" onclick={confirmRemoval}>Remove</button>
          <button type="button" onclick={() => (confirming = null)}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if !error && loaded && runs.length === 0}
      <p class="note">No runs yet. Use “Get comments” to create the first one.</p>
    {:else if !error && loaded}
      <div class="tools">
        <input type="search" aria-label="Search" placeholder="Search" bind:value={query} />
        <button
          type="button"
          class="remove-all"
          disabled={session.running || session.queueBusy || Boolean(session.pendingCandidate)}
          onclick={() => (confirming = { all: true })}
        >
          Remove all
        </button>
      </div>
      {#if visible.length === 0}
        <p class="note">No runs match “{query.trim()}”.</p>
      {:else}
        <ul>
          {#each visible as run (run.id)}
            {@const label = `${formatDate(run.modifiedMs)} - ${run.name}`}
            <li>
              <button type="button" class="open" onclick={() => openRun(run.id)}>
                {label}{#if run.partial}
                  <span class="partial-label">Partial export</span>{/if}
              </button>
              <button
                type="button"
                class="remove"
                aria-label={`Remove ${label}`}
                title="Remove"
                disabled={session.running || session.queueBusy || Boolean(session.pendingCandidate)}
                onclick={() => (confirming = { id: run.id, label })}
              >
                Remove
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</section>

<style>
  .tools {
    display: flex;
    align-items: stretch;
    gap: 8px;
    max-inline-size: 560px;
    margin-block-end: 24px;
  }

  input[type='search'] {
    box-sizing: border-box;
    flex: 1;
    padding-block: 0;
    padding-inline: 12px;
    border: 0;
    border-radius: 6px;
    background: var(--card);
    font: inherit;
    font-size: 14px;
  }

  .remove-all,
  .remove,
  .confirm button {
    padding-block: 8px;
    padding-inline: 12px;
    border: 0;
    border-radius: 8px;
    background: var(--surface-item);
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .remove-all:disabled,
  .remove:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .confirm {
    max-inline-size: 560px;
    margin-block-end: 24px;
    padding-block: 12px;
    padding-inline: 16px;
    border-radius: 8px;
    background: var(--card);
  }

  .confirm p {
    margin-block: 0 12px;
    margin-inline: 0;
    font-size: 14px;
  }

  .confirm__actions {
    display: flex;
    gap: 8px;
  }

  .confirm .danger {
    background: var(--danger);
    color: #fff;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-inline-size: 560px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    gap: 8px;
  }

  li .open {
    flex: 1;
    padding: 12px;
    border: 0;
    border-radius: 6px;
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    text-align: start;
    cursor: pointer;
  }

  .partial-label {
    display: inline-block;
    margin-inline-start: 8px;
    padding: 3px 6px;
    border-radius: 4px;
    background: var(--surface-item);
    font-size: 11px;
    font-weight: 700;
  }

  .note {
    font-size: 14px;
    color: var(--muted);
  }

  .note.error {
    color: var(--danger);
  }
</style>
