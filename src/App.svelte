<script>
  import Comments from './screens/Comments.svelte';
  import History from './screens/History.svelte';
  import Settings from './screens/Settings.svelte';
  import { initSession, navigateTo, session } from './lib/session.svelte.js';
  import logo from '../ui-design/logo.svg';

  const screens = [
    {
      id: 'comments',
      label: 'Comments',
      icon: 'M4 5h16v10H9l-5 4zM8 9h8M8 12h5',
    },
    {
      id: 'history',
      label: 'History',
      icon: 'M4 12a8 8 0 1 0 3-6.2M4 4v4h4M12 8v4l3 2',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
    },
  ];

  initSession();
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="brand">
      <img class="logo" src={logo} alt="" width="92" height="92" />
      <span class="brand-name">Design<br />Steering</span>
    </div>
    <nav>
      {#each screens as { id, label } (id)}
        <button
          type="button"
          class="nav-item"
          class:active={session.screen === id}
          aria-current={session.screen === id ? 'page' : undefined}
          onclick={() => navigateTo(id)}
        >
          <!-- <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg> -->
          <span>{label}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="panel">
    {#if session.screen === 'comments'}
      <Comments />
    {:else if session.screen === 'history'}
      <History />
    {:else}
      <Settings />
    {/if}
  </main>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 168px 1fr;
    gap: 24px;
    block-size: 100vh;
    padding: 24px;
    box-sizing: border-box;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .brand-name {
    font-size: 16px;
    line-height: 1.3;
  }

  nav {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-block: 0;
    padding-inline: 24px;
    border: 0;
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    block-size: 48px;
    min-inline-size: 90%;
    font-weight: 600;
    cursor: pointer;
    background: var(--nav-item);
  }

  .nav-item.active {
    background: var(--surface-active);

    &::after {
      opacity: 0;
    }
  }

  .panel {
    position: relative;
    min-block-size: 0;
    overflow: hidden;
    border-radius: 20px;
    background: var(--surface);
  }
</style>
