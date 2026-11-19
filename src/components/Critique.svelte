<script>
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { handleCritiqueClick, renderCritique } from '../lib/render.js';

  let { markdown, runDir, layout = 'single' } = $props();

  const html = $derived(renderCritique(markdown, { runDir }));
</script>

<!-- The HTML was sanitized by renderCritique, which also limits images to this run's frames. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="critique" class:grid={layout === 'grid'} onclick={(event) => handleCritiqueClick(event, openUrl)}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>

<style>
  .critique {
    max-inline-size: 1440px;
    margin-block: 0;
    margin-inline: auto;
    font-size: 16px;
    line-height: 1.6;
  }

  .critique :global(h1) {
    margin-block: 0 24px;
    margin-inline: 0;
    font-size: 40px;
    font-weight: 400;
    text-transform: none;
    line-height: 1.15;
  }

  .critique :global(h2) {
    margin-block: 32px 12px;
    margin-inline: 0;
    font-size: 24px;
    font-weight: 500;
  }

  .critique :global(img) {
    display: block;
    max-inline-size: 1376px;
    block-size: auto;
    margin-block: 24px 12px;
    margin-inline: 0;
    border-radius: 8px;
    inline-size: 100%;
  }

  .critique :global(ul) {
    padding: 0;
    list-style: none;
  }

  .critique :global(li) {
    margin-block: 8px;
    margin-inline: 0;
  }

  .critique :global(a) {
    color: var(--accent);
  }

  @container screen (inline-size > 1024px) {
    .critique.grid {
      display: grid;
      gap: 32px;
      overflow-wrap: anywhere;
    }

    .critique.grid > :global(*),
    .critique.grid > :global(.frame > *) {
      min-inline-size: 0;
      margin-block: 0;
    }

    .critique.grid > :global(.frame) {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
      gap: 32px;
      align-items: start;
    }

    .critique.grid > :global(.frame > p) {
      grid-area: 1 / 2;
    }

    /* A sticky element is bounded by its parent, so each list stays beside its own image. */
    .critique.grid > :global(.frame > ul) {
      grid-area: 1 / 1;
      position: sticky;
      inset-block-start: 0;
    }

    .critique.grid > :global(.frame img) {
      max-inline-size: 100%;
      margin-block: 0;
    }

    .critique.grid > :global(.frame > ul > li:first-child) {
      margin-block-start: 0;
    }

    .critique.grid > :global(.frame > ul > li:last-child) {
      padding-block-end: 1rem;
    }
  }
</style>
