<script>
  import { appVersion, detectNode } from '../lib/api.js';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../lib/settings.js';

  let settings = $state({ ...DEFAULT_SETTINGS });
  let loaded = $state(false);
  let status = $state(null);
  let nodeStatus = $state(null);
  let version = $state(null);

  appVersion().then(
    (value) => (version = value),
    () => {},
  );

  loadSettings().then(
    (value) => {
      settings = value;
      loaded = true;
    },
    (error) => {
      status = { ok: false, text: `Could not read settings: ${error}` };
      loaded = true;
    },
  );

  async function save() {
    try {
      await saveSettings($state.snapshot(settings));
      status = { ok: true, text: 'Settings saved.' };
    } catch (error) {
      status = { ok: false, text: `Could not save settings: ${error}` };
    }
  }

  function clearToken() {
    settings.token = '';
    status = {
      ok: true,
      text: 'Token cleared. Save to remove it from the settings file.',
    };
  }

  async function detect() {
    try {
      const { path, version } = await detectNode(settings.nodePath);
      nodeStatus = { ok: true, text: `Found Node ${version} at ${path}` };
    } catch (error) {
      nodeStatus = { ok: false, text: String(error) };
    }
  }
</script>

<section class="screen">
  <div class="scroll">
    <h1>Settings</h1>

    {#if loaded}
      <form onsubmit={(event) => (event.preventDefault(), save())}>
        <label>
          <span>Figma Personal Access Token</span>
          <span class="row">
            <input
              type="password"
              autocomplete="off"
              bind:value={settings.token}
              placeholder="figd_abcdefghijklmopqrstuvwxyz-12345"
            />
            <button type="button" class="action" onclick={clearToken} disabled={!settings.token}>Clear token</button>
          </span>
        </label>

        <label class="toggle">
          <span>Include frame images</span>
          <input type="checkbox" role="switch" bind:checked={settings.images} />
        </label>

        <label class="toggle">
          <span>Show comment author</span>
          <input type="checkbox" role="switch" bind:checked={settings.user} />
        </label>

        <label>
          <span>Node path (optional)</span>
          <span class="row">
            <input type="text" bind:value={settings.nodePath} placeholder="Detected automatically when empty" />
            <button type="button" class="action" onclick={detect}>Detect</button>
          </span>
          {#if nodeStatus}
            <span class="note" class:error={!nodeStatus.ok} role="status">{nodeStatus.text}</span>
          {/if}
        </label>

        <div class="footer">
          {#if status}
            <span class="note" class:error={!status.ok} role="status">{status.text}</span>
          {/if}
          <button type="submit" class="action">Save</button>
        </div>

        {#if version}
          <p class="note version">Version {version}</p>
        {/if}
      </form>
    {/if}
  </div>
</section>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-inline-size: 560px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 15px;
  }

  input[type='text'],
  input[type='password'] {
    flex: 1;
    padding-block: 0;
    padding-inline: 12px;
    border: 0;
    border-radius: 6px;
    background: var(--card);
    font-size: 14px;
  }

  .row {
    display: flex;
    gap: 12px;
    align-items: stretch;
  }

  .toggle {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .toggle input {
    inline-size: 20px;
    block-size: 20px;
  }

  .note {
    font-size: 13px;
    color: var(--muted);
  }

  .note.error {
    color: var(--danger);
  }

  .version {
    margin: 0;
  }

  .footer {
    margin-block-start: 1rem;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
  }
</style>
